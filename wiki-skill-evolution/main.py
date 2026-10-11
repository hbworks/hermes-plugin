"""WikiSkill Evolution Plugin for Hermes Agent.

ツール実行エラーを記録し、既知のパターンに一致する教訓をスキル（SKILL.md）へ追記する。
追記後は Hermes と同じ形式検査で検証し、合格した場合のみ残す。
"""

from __future__ import annotations

import contextlib
import datetime
import fcntl
import json
import logging
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

logger = logging.getLogger(__name__)

PLUGIN_NAME = "wiki-skill-evolution"
DEFAULT_SKILL_NAME = "default_skill"  # 旧版が推定不能時に書いた名前（既存ログの互換用）
# 新規の推定不能は作り話のスキル名にせず unknown と記録する。unknown は決してスキルとして作らない。
UNKNOWN_SKILL_NAME = "unknown"
ERROR_LOG_RELATIVE_PATH = Path("logs") / "evolution_errors.jsonl"
ERROR_LOG_MAX_BYTES = 5 * 1024 * 1024
MAX_RECENT_ERRORS = 50
MAX_PENDING_ERRORS = 50
PRIVATE_FILE_MODE = 0o600
PRIVATE_DIR_MODE = 0o700

# 新規スキルの description。Hermes の skill_manage が案内する先頭57文字以内に収める。
NEW_SKILL_DESCRIPTION = "Use when a recorded error hits this skill. Apply lessons."

# Tool names are intentionally matched from most-specific to least-specific.
SKILL_MAPPINGS = {
    "python_exec": "python",
    "python_run": "python",
    "git_": "git_workflow",
    "git": "git_workflow",
}
# 支援ディレクトリ（スキル内の補助ファイル置き場）。Hermes の agent/skill_utils.py:SKILL_SUPPORT_DIRS と同じ。
SKILL_SUPPORT_DIR_NAMES = frozenset(("references", "templates", "assets", "scripts"))

# Python 実行系ツールは、コマンド内の skills/<name>/ を優先してスキルを特定する
PYTHON_EXEC_TOOLS = frozenset({"python_exec", "python_run"})

# 終了コード 1 が「失敗」ではなく「結果あり／差分あり」を表すプログラム（実行ファイル名で判定）
INFORMATIONAL_EXIT_ONE_PROGRAMS = frozenset({"diff", "grep", "egrep", "fgrep", "rg", "cmp", "test", "["})

# エラー パターンと対応する教訓・スキル追記ルールの定義
ERROR_RULES = [
    {
        "keywords": ["importerror", "modulenotfounderror", "no module named"],
        "lesson": "[Python/Path] ImportError が発生。解決策: 実行スクリプトの先頭で sys.path にプロジェクトルートを追加する。",
        "patch": "- 実行スクリプトの先頭で sys.path にプロジェクトルートを追加する。",
    },
    {
        "keywords": ["filenotfounderror", "no such file"],
        "lesson": "[IO/FileNotFound] ファイルが見つからない。解決策: ファイルパスを絶対パスに変換するか、作業ディレクトリを確認する。",
        "patch": "- ファイルパスは絶対パスで指定し、FileNotFound エラーを回避する。",
    },
    {
        "keywords": ["timeout", "timed out"],
        "lesson": "[Net/Timeout] ネットワークタイムアウトが発生。解決策: リトライロジックまたはタイムアウト値を増やす。",
        "patch": "- ネットワーク操作にはリトライとタイムアウト延長を設定する。",
    },
    {
        "keywords": ["permission denied"],
        "lesson": "[OS/Permission] 権限エラーが発生。解決策: ファイルパーミッションまたは実行権限を確認する。",
        "patch": "- 実行前に必要なファイルパーミッションを確認する。",
    },
    {
        "keywords": [
            "first 57 chars",
            "first 57 characters",
            "description must start with",
            "description budget",
            "description is too long",
            "description exceeds",
            "new skills must fit",
        ],
        "lesson": "[Hermes/Skill] skill_manage の description が形式・長さ制約に違反。解決策: 先頭57文字以内を 'Use when <trigger>. <one-line behavior>.' 形式の自己完結したトリガーにする。",
        "patch": "- skill_manage の description は、先頭57文字以内に 'Use when <trigger>. <one-line behavior>.' 形式の自己完結したトリガーを置く。",
    },
    {
        "keywords": [
            "failed to find unique match",
            "old_string mismatch",
            "could not find a unique match",
            "matches for old_string",
            "found matches for old_string",
            "found multiple matches for old_string",
            "could not find match for old_string",
            "could not find a match for old_string",
            "could not find a match for the old_string",
            "old_string not found",
            "old_string is empty",
            "old_string is only whitespace",
        ],
        "lesson": "[Hermes/Patch] patch が old_string を一意に特定できない。解決策: read_file で最新内容を確認し、固有の周辺文脈を含めて再指定する。",
        "patch": "- patch 実行前に read_file で最新内容を確認し、一意な周辺文脈を含めて old_string を指定する。",
    },
    {
        "keywords": [
            "must start with yaml frontmatter",
            "invalid frontmatter",
            "invalid yaml frontmatter",
            "yaml frontmatter",
            "frontmatter must be a yaml",
            "frontmatter is not closed",
            "frontmatter must include",
            "must have content after the frontmatter",
            "content cannot be empty",
        ],
        "lesson": "[Hermes/Skill] SKILL.md の YAML frontmatter が不正。解決策: ファイル先頭を '---' で囲み、name と description を定義する。",
        "patch": "- SKILL.md は先頭に '---' で囲んだ YAML frontmatter を置き、name と description を定義する。",
    },
    {
        # 終了コードは数値で判定する（英語 "exit 2" / 日本語ロケール "終了コード 2" の両方）。
        # キーワードだけでは一致させない。
        "exit_code_rule": True,
        "lesson": "[Terminal/Exit] コマンドが非ゼロ終了。解決策: コマンド・引数・前提条件を確認し、終了コードと stderr を調べる。",
        "patch": "- CLI 実行時はコマンド・引数・前提条件を検証し、非ゼロ終了時は終了コードと stderr を確認する。",
        # 成功(0)や情報的な非ゼロ終了（diff/grep/git diff など）は教訓にしない
        "exclude_keywords": [
            "files differ",
            "no matches found",
        ],
    },
]

# Tool Schema for run_wiki_skill_evolution
RUN_EVOLUTION_SCHEMA = {
    "description": "Trigger the WikiSkill autonomous evolution cycle: analyze recent errors, extract lessons into wiki/memory, and update target skill if tests pass.",
    "parameters": {
        "type": "object",
        "properties": {
            "skill_name": {
                "type": "string",
                "description": "The skill name to evolve. If omitted, infer it from the recent error context.",
            },
            "hours": {
                "type": "integer",
                "description": "Lookback window in hours for error logs (default 6).",
                "default": 6,
            },
            "dry_run": {
                "type": "boolean",
                "description": "If true, propose the patch and do not write any file.",
                "default": False,
            },
            "commit": {
                "type": "boolean",
                "description": "If true, commit the change to git after gating passes (a new skill becomes its own repository). Default false: files are written but not committed.",
                "default": False,
            },
        },
    },
}


def _now_str() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def _get_hermes_home_dir() -> Path:
    """Hermes home of the profile this call runs under.

    Uses Hermes' own resolver, which honours the context-local override that Hermes sets
    per profile (``hermes_constants.set_hermes_home_override``). Outside Hermes the plugin
    falls back to ``HERMES_HOME`` (default ``~/.hermes``).
    """
    try:
        from hermes_constants import get_hermes_home
    except Exception:  # ImportError に加え、Python 3.9 で型注釈が解決できない場合も含む
        return Path(os.path.expanduser(os.environ.get("HERMES_HOME", "~/.hermes").strip()))
    return get_hermes_home()


SKILL_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$")
# Hermes の skill_manage が新規作成で受け付ける名前の規則（小文字・数字・._-）
HERMES_CREATE_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
EXIT_CODE_PATTERN = re.compile(r"(?:exit(?:ed)?(?: with)?(?: code)?:?|終了コード)\s*:?\s*(-?\d+)")

# 秘密情報らしき文字列をエラー本文から取り除く（保存・ログ出力の前に必ず通す）
_SECRET_PATTERNS = (
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+"), "Bearer ***"),
    (re.compile(r"(?i)(\bauthorization[\"']?\s*[:=]\s*)[^\r\n\"']+"), r"\1***"),
    (
        re.compile(
            r"(?i)(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|"
            r"client[_-]?secret|secret|password|passwd|pwd)[\"']?\s*[:=]\s*)[^\s\"',;&]+"
        ),
        r"\1***",
    ),
    (re.compile(r"\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|xox[abprs])[-_][A-Za-z0-9_-]{8,}"), "***"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "***"),
    (re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://)[^/\s:@]+:[^/\s@]+@"), r"\1***:***@"),
)


def _mask_secrets(text: str) -> str:
    """Mask credentials in free text. Local patterns always run; Hermes' redactor adds more when present."""
    masked = text
    for pattern, replacement in _SECRET_PATTERNS:
        masked = pattern.sub(replacement, masked)
    try:
        from agent.redact import redact_sensitive_text
    except Exception:
        return masked
    return redact_sensitive_text(masked, force=True)


def _open_private_append(path: Path):
    """Open *path* for appending with owner-only permissions, tightening an existing file too."""
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, PRIVATE_FILE_MODE)
    try:
        os.fchmod(fd, PRIVATE_FILE_MODE)
        return os.fdopen(fd, "a", encoding="utf-8")
    except OSError:
        os.close(fd)
        raise


def _has_nonzero_exit_code(err_lower: str) -> bool:
    """True when the error reports a non-zero exit (explicit non-zero number or wording).

    Exit 0 is success and must never produce an exit-code lesson. A failure described
    only as \"non-zero\" (no number) still counts as a failure.
    """
    codes = [int(m.group(1)) for m in EXIT_CODE_PATTERN.finditer(err_lower)]
    if codes:
        return any(code != 0 for code in codes)
    return "non-zero" in err_lower or "nonzero" in err_lower


def _validated_skill_path(skill_name: str) -> str:
    """Accept 'name' or 'category/name'; every segment must pass the plain-identifier check."""
    if not isinstance(skill_name, str):
        raise ValueError(f"invalid skill name: {skill_name!r}")
    segments = skill_name.split("/")
    if len(segments) > 2:
        raise ValueError(f"invalid skill name: {skill_name!r}")
    for segment in segments:
        _validated_skill_name(segment)
    return skill_name


def _validated_skill_name(skill_name: str) -> str:
    """Accept only a single safe path segment so skill names cannot escape skills/."""
    if not isinstance(skill_name, str) or not SKILL_NAME_PATTERN.fullmatch(skill_name):
        raise ValueError(f"invalid skill name: {skill_name!r}")
    if skill_name in {".", ".."} or skill_name.endswith("."):
        raise ValueError(f"invalid skill name: {skill_name!r}")
    return skill_name


def _get_skills_dir() -> Path:
    """Get the skills directory for the active profile."""
    skills_dir = _get_hermes_home_dir() / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)
    return skills_dir


class UnsafeSkillPathError(ValueError):
    """The skill location is a symlink or resolves outside the skills directory."""


class AmbiguousSkillError(ValueError):
    """More than one skill claims the same directory name; refusing to guess which one to change."""


# Hermes の skill scanner が読み飛ばすディレクトリ（agent/skill_utils.py:EXCLUDED_SKILL_DIRS と同じ集合）
_EXCLUDED_SKILL_DIR_NAMES = frozenset((
    ".git", ".github", ".hub", ".archive", ".curator_backups", ".locks",
    ".venv", "venv", "node_modules", "site-packages", "__pycache__",
    ".tox", ".nox", ".pytest_cache", ".mypy_cache", ".ruff_cache",
))


def _is_excluded_skill_path(skill_md: Path, skills_root: Path) -> bool:
    """True when a SKILL.md sits under a directory Hermes never treats as a skill."""
    try:
        parts = skill_md.relative_to(skills_root).parts
    except ValueError:
        parts = skill_md.parts
    return any(part in _EXCLUDED_SKILL_DIR_NAMES for part in parts)


def _refuse_unsafe_candidate(
    candidate: Path,
    skills_root: Path,
    *,
    check_symlink: bool = True,
    check_containment: bool = True,
) -> None:
    """Raise UnsafeSkillPathError when *candidate* is a symlink or resolves outside *skills_root*.

    Both checks are independent so each can be verified on its own; production code enables both.
    """
    if check_symlink and candidate.is_symlink():
        raise UnsafeSkillPathError(f"refusing to write through symlink: {candidate.name}")
    if check_containment and not candidate.resolve().is_relative_to(skills_root.resolve()):
        raise UnsafeSkillPathError(f"path resolves outside the skills directory: {candidate.name}")


def _new_skill_template(skill_name: str) -> str:
    """Initial SKILL.md for a skill that does not exist yet, in the format Hermes accepts."""
    return (
        "---\n"
        f"name: {json.dumps(skill_name, ensure_ascii=False)}\n"
        f"description: {json.dumps(NEW_SKILL_DESCRIPTION, ensure_ascii=False)}\n"
        "---\n\n"
        f"# {skill_name}\n\n"
        "自動生成されたスキル定義。\n\n"
        "## 実行手順\n"
        "- 基本タスクを実行する。\n"
    )


def _validate_frontmatter_local(content: str, *, new_skill: bool = False) -> Optional[str]:
    """Stdlib mirror of Hermes' skill_manage frontmatter check, used when Hermes is not importable.

    Hermes' own validator stays authoritative inside Hermes. This fallback handles the common
    single-line ``key: value`` frontmatter and rejects what Hermes rejects for those shapes.
    """
    if not content.strip():
        return "Content cannot be empty."
    lines = content.lstrip("\ufeff").replace("\r\n", "\n").split("\n")
    if not lines or lines[0].strip() != "---":
        return "SKILL.md must start with YAML frontmatter (---)."
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return "SKILL.md frontmatter is not closed. Ensure you have a closing '---' line."

    fields: Dict[str, str] = {}
    for line in lines[1:end]:
        if not line.strip() or line[:1].isspace() or line.lstrip().startswith("#"):
            continue  # blank, comment, or indented continuation of a block scalar
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$", line)
        if not match:
            return f"YAML frontmatter line is not a 'key: value' pair: {line.strip()!r}"
        fields[match.group(1)] = match.group(2).strip().strip("'\"")

    for field in ("name", "description"):
        if not fields.get(field):
            return f"Frontmatter must include '{field}' field."
    description = fields["description"]
    if len(description) > 1024:
        return "Description exceeds 1024 characters."
    if new_skill and len(description) > 60:
        return f"Description is {len(description)} chars — new skills must fit the 60-char budget."
    if not "\n".join(lines[end + 1:]).strip():
        return "SKILL.md must have content after the frontmatter (instructions, procedures, etc.)."
    return None


def _validate_skill_document(content: str, *, new_skill: bool = False) -> Optional[str]:
    """Return None when *content* is an acceptable SKILL.md, else the reason it is rejected.

    Hermes' own skill_manage validator is authoritative. It is used whenever Hermes is importable;
    the stdlib mirror is only a fallback and is announced once so a weaker check is never silent.
    """
    global _FALLBACK_WARNED
    try:
        hermes_validate = _load_hermes_frontmatter_validator()
    except Exception as exc:  # Hermes 外、または依存が読めない場合
        if not _FALLBACK_WARNED:
            _FALLBACK_WARNED = True
            logger.warning(
                "[%s] Hermes skill validator unavailable (%s); using the built-in fallback check.",
                PLUGIN_NAME,
                exc,
            )
        return _validate_frontmatter_local(content, new_skill=new_skill)
    return hermes_validate(content, new_skill=new_skill)


_FALLBACK_WARNED = False


def _load_hermes_frontmatter_validator():
    """Import Hermes' skill validator, adding a local hermes-agent checkout to sys.path if needed."""
    try:
        from tools.skill_manager_tool import _validate_frontmatter
        return _validate_frontmatter
    except ImportError:
        pass
    checkout = Path(os.environ.get("HERMES_AGENT_DIR", Path.home() / ".hermes" / "hermes-agent"))
    if (checkout / "tools" / "skill_manager_tool.py").is_file() and str(checkout) not in sys.path:
        sys.path.insert(0, str(checkout))
    from tools.skill_manager_tool import _validate_frontmatter
    return _validate_frontmatter


class WikiSkillEvolutionPlugin:
    """WikiSkill autonomous evolution loop manager."""

    def __init__(self, ctx: Optional[Any] = None) -> None:
        self.ctx = ctx
        # プロファイル（Hermes home）ごとに分けて保持する。同一プロセスで切り替えても混ざらない。
        self._buckets: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}

    def _bucket(self) -> Dict[str, List[Dict[str, Any]]]:
        """In-memory recent/pending error records for the profile this call runs under."""
        return self._buckets.setdefault(str(_get_hermes_home_dir()), {"recent": [], "pending": []})

    @property
    def recent_errors(self) -> List[Dict[str, Any]]:
        return self._bucket()["recent"]

    @property
    def _pending_errors(self) -> List[Dict[str, Any]]:
        return self._bucket()["pending"]

    def _error_log_path(self) -> Path:
        """Return the persistent error log path, creating its parent directory."""
        log_path = _get_hermes_home_dir() / ERROR_LOG_RELATIVE_PATH
        log_path.parent.mkdir(parents=True, exist_ok=True, mode=PRIVATE_DIR_MODE)
        return log_path

    def _rotate_error_log_if_needed(self, log_path: Path, additional_bytes: int) -> None:
        """Keep one bounded backup before appending to the JSONL log."""
        if not log_path.exists() or log_path.stat().st_size + additional_bytes <= ERROR_LOG_MAX_BYTES:
            return
        backup_path = log_path.with_suffix(log_path.suffix + ".1")
        if backup_path.exists():
            backup_path.unlink()
        os.replace(log_path, backup_path)

    def _persist_error(self, error_record: Dict[str, Any]) -> bool:
        """Append one (already masked) error record; the log is owner-readable only (0600)."""
        try:
            log_path = self._error_log_path()
            line = json.dumps(error_record, ensure_ascii=False, separators=(",", ":")) + "\n"
            encoded = line.encode("utf-8")
            lock_path = log_path.with_suffix(log_path.suffix + ".lock")
            with _open_private_append(lock_path) as lock_handle:
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
                try:
                    self._rotate_error_log_if_needed(log_path, len(encoded))
                    with _open_private_append(log_path) as handle:
                        handle.write(line)
                        handle.flush()
                finally:
                    fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
            return True
        except OSError as exc:
            logger.error("[%s] Failed to persist error log: %s", PLUGIN_NAME, exc)
            return False

    def _flush_pending_errors(self) -> None:
        """Retry records that could not be written during the tool hook (current profile only)."""
        pending = self._pending_errors
        retry = list(pending)
        pending.clear()
        for error_record in retry:
            if not self._persist_error(error_record):
                pending.append(error_record)
        del pending[:-MAX_PENDING_ERRORS]

    def _is_informational_exit(self, tool_name: str, args: Any, error: str) -> bool:
        """True for a non-zero exit that reports a result, not a failure (e.g. ``git diff`` exit 1).

        Only exit code 1 from diff/grep-style programs qualifies, and only for a plain single
        command: pipelines and chains are judged on their last stage, so they are treated as failures.
        """
        codes = [int(m.group(1)) for m in EXIT_CODE_PATTERN.finditer(error.lower())]
        if codes != [1]:
            return False
        command = self._extract_context_value(args, ("command", "cmd"))
        if not command or re.search(r"[|;&<>`$()]", command):
            return False
        try:
            words = shlex.split(command)
        except ValueError:
            return False
        while words and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", words[0]):
            words.pop(0)  # leading ENV=value assignments
        if not words:
            return False
        program = os.path.basename(words[0])
        if program == "git":
            return len(words) > 1 and words[1] in {"diff", "grep"}
        return program in INFORMATIONAL_EXIT_ONE_PROGRAMS

    def _normalize_record(self, record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Return the in-memory form of a stored record: masked text, resolved skill, no raw args.

        Legacy lines may still carry raw ``args``; they are used here to resolve the skill and
        then dropped, so they never re-enter memory or get written back out.
        """
        tool = str(record.get("tool", ""))
        legacy_args = record.pop("args", None)
        error = _mask_secrets(str(record.get("error", "")))
        if self._is_informational_exit(tool, legacy_args, error):
            return None
        skill = str(record.get("skill") or self._resolve_skill_name(tool, legacy_args, error))
        return {"ts": str(record.get("ts", "")), "tool": tool, "skill": skill, "error": error}

    def _read_error_log(self, hours: int) -> List[Dict[str, Any]]:
        """Read valid error records from the requested lookback window."""
        lookback = datetime.timedelta(hours=max(0, hours))
        cutoff = datetime.datetime.now(datetime.timezone.utc) - lookback
        legacy_cutoff = datetime.datetime.now() - lookback
        records: List[Dict[str, Any]] = []
        log_path = self._error_log_path()
        log_paths = [log_path, log_path.with_suffix(log_path.suffix + ".1")]
        for current_path in log_paths:
            try:
                handle = current_path.open("r", encoding="utf-8")
            except FileNotFoundError:
                continue
            try:
                with handle:
                    for line_number, line in enumerate(handle, start=1):
                        try:
                            record = json.loads(line)
                            if not isinstance(record, dict):
                                continue
                            timestamp = datetime.datetime.fromisoformat(str(record["ts"]))
                            if timestamp.tzinfo is None:
                                is_recent = timestamp >= legacy_cutoff
                            else:
                                is_recent = timestamp >= cutoff
                            if not is_recent:
                                continue
                            normalized = self._normalize_record(record)
                            if normalized is not None:
                                records.append(normalized)
                        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
                            logger.warning(
                                "[%s] Ignoring malformed error log line %d: %s",
                                PLUGIN_NAME,
                                line_number,
                                exc,
                            )
            except OSError as exc:
                logger.error("[%s] Failed to read error log: %s", PLUGIN_NAME, exc)
        return sorted(records, key=lambda record: record["ts"])

    def _extract_context_value(self, args: Any, keys: tuple[str, ...]) -> str:
        if isinstance(args, dict):
            for key in keys:
                value = args.get(key)
                if isinstance(value, (str, Path)):
                    return str(value)
        return ""

    @staticmethod
    def _skill_from_context(context: str) -> Optional[str]:
        """Name of the skill a command path points into, or None when the path does not name one.

        Hermes lays skills out as skills/<name>/ or skills/<category>/<name>/. Inside a skill, the
        support directories (scripts, references, templates, assets) and file names (run.py, SKILL.md)
        are not skills, so the segment that owns them is the skill.
        """
        match = re.search(r"skills[/\\]((?:[^/\\\s]+)(?:[/\\][^/\\\s]+)?)", context)
        if not match:
            return None
        parts = [part for part in re.split(r"[/\\]", match.group(1)) if part]
        first = parts[0]
        if first in SKILL_SUPPORT_DIR_NAMES:
            return None
        if len(parts) == 1:
            return first
        second = parts[1]
        if "." in second or second in SKILL_SUPPORT_DIR_NAMES:
            return first
        return second

    def _inferred_skill_name(self, tool_name: str, args: Any = None, error: str = "") -> Optional[str]:
        """The skill this call is about, or None when nothing in it names one (no fallback)."""
        explicit = self._extract_context_value(args, ("skill_name", "skill"))
        if explicit:
            return explicit
        mapped = None
        for mapped_tool, skill_name in sorted(SKILL_MAPPINGS.items(), key=lambda item: -len(item[0])):
            if tool_name == mapped_tool or tool_name.startswith(mapped_tool):
                mapped = skill_name
                break
        if mapped and tool_name not in PYTHON_EXEC_TOOLS:
            return mapped
        context = " ".join(
            value for value in (
                self._extract_context_value(args, ("command", "cmd", "script", "path")),
                error,
            ) if value
        )
        from_path = self._skill_from_context(context)
        if from_path:
            return from_path
        # Python 実行ツールのマッピング名（"python"）はツール種別であってスキル名ではない
        return None if tool_name in PYTHON_EXEC_TOOLS else mapped

    def _resolve_skill_name(self, tool_name: str, args: Any = None, error: str = "") -> str:
        """Map tool/command context to a skill, labelled UNKNOWN_SKILL_NAME when nothing names one."""
        return self._inferred_skill_name(tool_name, args, error) or UNKNOWN_SKILL_NAME

    # Hermes の汎用ラベル。これだけでは教訓の材料にならないため、文言が無ければ記録しない。
    _GENERIC_ERROR_LABELS = frozenset({"tool_error", "tool execution failed", "error"})

    @staticmethod
    def _error_text_from_result(result: Any) -> Optional[str]:
        """Return the error message carried by a tool result (dict or JSON string)."""
        parsed = result
        if isinstance(result, str):
            try:
                parsed = json.loads(result)
            except (TypeError, ValueError):
                return None
        if isinstance(parsed, dict) and parsed.get("error"):
            return str(parsed["error"])
        return None

    def on_post_tool_call(self, tool_name: str = "", args: Any = None, result: Any = None, error: Any = None, **kwargs: Any) -> None:
        """Hook called after any tool execution in Hermes."""
        # Hermes reports failures through the legacy ``error`` argument, the hook
        # kwargs (error_message / status), or the tool result (JSON string or dict).
        err_msg: Optional[str] = None
        if error:
            err_msg = str(error)
        elif kwargs.get("error_message"):
            err_msg = str(kwargs["error_message"])
        else:
            # 結果本体の文言を優先し、無ければ具体的な error_type（例: RuntimeError）を使う。
            # Hermes の汎用ラベル（tool_error 等）は教訓の材料にしない。
            err_msg = self._error_text_from_result(result)
            if not err_msg and kwargs.get("status") == "error" and kwargs.get("error_type"):
                err_msg = str(kwargs["error_type"])

        if err_msg and err_msg.strip().lower() in self._GENERIC_ERROR_LABELS:
            err_msg = None
        if not err_msg:
            return
        if self._is_informational_exit(tool_name, args, err_msg):
            return

        # 生の引数は保存しない。スキル判定はメモリ上でのみ行い、結果（スキル名）だけを残す。
        masked = _mask_secrets(err_msg)
        error_record = {
            "ts": _now_str(),
            "tool": tool_name,
            "skill": self._resolve_skill_name(tool_name, args, masked),
            "error": masked,
        }
        bucket = self._bucket()
        recent = bucket["recent"]
        recent.append(error_record)
        del recent[:-MAX_RECENT_ERRORS]
        if not self._persist_error(error_record):
            pending = bucket["pending"]
            pending.append(error_record)
            del pending[:-MAX_PENDING_ERRORS]
        logger.info("[%s] Captured tool error from %s: %s", PLUGIN_NAME, tool_name, masked[:100])

    def on_session_end(self, session_id: str = "", **kwargs: Any) -> None:
        """Hook called when a session ends."""
        self._flush_pending_errors()
        if self.recent_errors:
            logger.info("[%s] Session %s ended with %d captured errors. Evaluating evolution...", PLUGIN_NAME, session_id, len(self.recent_errors))

    def _extract_lesson_from_error(self, error_text: str) -> Optional[str]:
        """Extract a rule-based lesson, leaving unknown errors in the raw log only."""
        err_lower = error_text.lower()
        for rule in ERROR_RULES:
            if any(k in err_lower for k in rule.get("exclude_keywords", ())):
                continue
            if rule.get("exit_code_rule"):
                if _has_nonzero_exit_code(err_lower):
                    return rule["lesson"]
                continue
            if any(k in err_lower for k in rule["keywords"]):
                return rule["lesson"]
        return None

    def _find_existing_skill(self, skill_name: str) -> Optional[Path]:
        """Find an existing SKILL.md the way Hermes does: by directory name, or 'category/name'.

        Searches every SKILL.md under skills/ (so category-nested skills are found), skips
        directories Hermes excludes, and refuses an ambiguous directory name instead of guessing.
        """
        name = _validated_skill_path(skill_name)
        skills_root = _get_skills_dir()
        matches: List[Path] = []
        for skill_md in sorted(skills_root.rglob("SKILL.md")):
            if _is_excluded_skill_path(skill_md, skills_root):
                continue
            rel_dir = skill_md.parent.relative_to(skills_root).as_posix()
            if "/" in name:
                if rel_dir == name:
                    return skill_md
                continue
            if skill_md.parent.name == name:
                matches.append(skill_md)
        if len(matches) > 1:
            listing = ", ".join(p.parent.relative_to(skills_root).as_posix() for p in matches)
            raise AmbiguousSkillError(f"skill name {skill_name!r} matches several skills: {listing}")
        return matches[0] if matches else None

    def _skill_locations(self, skill_name: str) -> Dict[str, Path]:
        """Resolve where a skill lives, refusing symlinks and any path that leaves skills/.

        An existing skill is found wherever it sits under skills/ (Hermes' category layout). A new
        skill is created at skills/<name>/, and only when no category directory already has that name.
        Two independent checks guard each candidate: no symlink at the path itself, and the real
        location stays under the skills root.
        """
        name = _validated_skill_path(skill_name)
        skills_root_path = _get_hermes_home_dir() / "skills"
        if skills_root_path.is_symlink():
            raise UnsafeSkillPathError("skills directory is a symlink; refusing to write through it")
        skills_root = _get_skills_dir()

        existing = self._find_existing_skill(name)
        if existing is not None:
            skill_dir = existing.parent
            flat_file = skills_root / f"{name}.md"
            for candidate in (skill_dir, existing):
                _refuse_unsafe_candidate(candidate, skills_root, check_symlink=True, check_containment=True)
            return {"skill_dir": skill_dir, "skill_file": existing, "flat_file": flat_file}

        if "/" in name:
            raise UnsafeSkillPathError(f"categorized skill {name!r} does not exist; refusing to create it")
        skill_dir = skills_root / name
        skill_file = skill_dir / "SKILL.md"
        flat_file = skills_root / f"{name}.md"
        for candidate in (skill_dir, skill_file, flat_file):
            _refuse_unsafe_candidate(candidate, skills_root, check_symlink=True, check_containment=True)
        return {"skill_dir": skill_dir, "skill_file": skill_file, "flat_file": flat_file}

    def _existing_skill_file(self, locations: Dict[str, Path]) -> Optional[Path]:
        if locations["skill_file"].is_file():
            return locations["skill_file"]
        if locations["flat_file"].is_file():
            return locations["flat_file"]
        return None

    def _get_skill_file(self, skill_name: str) -> Optional[Path]:
        """Resolve an existing skill markdown file path (None when absent, invalid, or unsafe)."""
        try:
            locations = self._skill_locations(skill_name)
        except ValueError:
            return None
        return self._existing_skill_file(locations)

    def _run_terminal_command(self, cmd: Union[str, List[str]], cwd: Optional[Path] = None) -> Dict[str, Any]:
        """Safely execute command in working directory with shell=False."""
        try:
            cmd_args = shlex.split(cmd) if isinstance(cmd, str) else list(cmd)
            if not cmd_args:
                return {"exit_code": 0, "stdout": "", "stderr": ""}
            res = subprocess.run(
                cmd_args,
                shell=False,
                cwd=str(cwd) if cwd else None,
                capture_output=True,
                text=True,
                timeout=30,
            )
            return {"exit_code": res.returncode, "stdout": res.stdout, "stderr": res.stderr}
        except Exception as e:
            return {"exit_code": -1, "stdout": "", "stderr": str(e)}

    def _format_command_error(self, action: str, result: Dict[str, Any]) -> str:
        detail = str(result.get("stderr") or result.get("stdout") or "unknown error").strip()
        return f"{action} failed: {detail}"

    def _git_repository_info(self, skill_dir: Path) -> Dict[str, Any]:
        """Return whether the skill is in Git and the repository root when known."""
        result = self._run_terminal_command(["git", "rev-parse", "--show-toplevel"], cwd=skill_dir)
        root_text = str(result.get("stdout", "")).strip()
        if result.get("exit_code") != 0 or not root_text:
            return {
                "is_repository": False,
                "root": None,
                "error": "skill directory is not a git repository",
            }
        return {"is_repository": True, "root": Path(root_text).resolve(), "error": None}

    def _commit_skill_update(self, skill_dir: Path, message: str) -> Dict[str, Any]:
        """Stage and commit SKILL.md, returning verified Git status details."""
        repository = self._git_repository_info(skill_dir)
        if not repository["is_repository"]:
            return {"ok": False, "git_repository": False, "error": repository["error"]}

        add_result = self._run_terminal_command(["git", "add", "--", "SKILL.md"], cwd=skill_dir)
        if add_result.get("exit_code") != 0:
            error = self._format_command_error("git add", add_result)
            logger.error("[%s] %s", PLUGIN_NAME, error)
            return {"ok": False, "git_repository": True, "error": error}

        commit_result = self._run_terminal_command(
            ["git", "commit", "--only", "-m", message, "--", "SKILL.md"],
            cwd=skill_dir,
        )
        if commit_result.get("exit_code") != 0:
            error = self._format_command_error("git commit", commit_result)
            logger.error("[%s] %s", PLUGIN_NAME, error)
            return {"ok": False, "git_repository": True, "error": error}

        return {"ok": True, "git_repository": True, "error": None}

    def _initialize_skill_repository(self, skill_dir: Path, message: str) -> Dict[str, Any]:
        """Create a dedicated Git repository for a newly generated skill and commit its SKILL.md."""
        init_result = self._run_terminal_command(["git", "init"], cwd=skill_dir)
        if init_result.get("exit_code") != 0:
            error = self._format_command_error("git init", init_result)
            logger.error("[%s] %s", PLUGIN_NAME, error)
            return {"ok": False, "git_repository": False, "error": error}
        return self._commit_skill_update(skill_dir, message)

    def _propose_skill_text(self, current_text: str, lessons: List[str]) -> Optional[str]:
        """Return the skill markdown with known lessons added, or None when nothing new applies."""
        additions: List[str] = []
        for lesson in lessons:
            for rule in ERROR_RULES:
                if rule["lesson"] == lesson:
                    additions.append(rule["patch"])
                    break

        # Only known, actionable rules may change a skill; raw errors stay in the JSONL log.
        unique_additions = list(dict.fromkeys(
            item for item in additions if item not in current_text
        ))
        if not unique_additions:
            return None

        frontmatter_match = re.match(
            r"\A(?:\ufeff)?---[ \t]*\r?\n.*?^---[ \t]*\r?\n",
            current_text,
            flags=re.DOTALL | re.MULTILINE,
        )
        starts_with_frontmatter = bool(re.match(r"\A(?:\ufeff)?---[ \t]*(?:\r?\n|\Z)", current_text))
        if starts_with_frontmatter and not frontmatter_match:
            logger.warning("Cannot patch skill with unterminated YAML frontmatter")
            return None

        body_start = frontmatter_match.end() if frontmatter_match else 0
        newline = "\r\n" if "\r\n" in current_text else "\n"
        supported_sections = {
            "実行手順",
            "pitfalls",
            "pitfalls & lessons",
            "lessons learned",
            "workflow",
            "instructions",
            "注意事項",
        }
        heading_pattern = re.compile(r"(?m)^##[ \t]+([^\r\n]+?)[ \t]*\r?$")
        headings = list(heading_pattern.finditer(current_text, body_start))
        section_index = next(
            (
                index
                for index, heading in enumerate(headings)
                if heading.group(1).strip().casefold() in supported_sections
            ),
            None,
        )

        additions_text = newline.join(unique_additions)
        if section_index is not None:
            section_start = headings[section_index].start()
            section_end = (
                headings[section_index + 1].start()
                if section_index + 1 < len(headings)
                else len(current_text)
            )
            section = current_text[section_start:section_end]
            new_section = section.rstrip("\r\n") + newline + additions_text + newline * 2
            return current_text[:section_start] + new_section + current_text[section_end:]

        # 対応見出しが無い場合は gating が受理する見出しを新規作成する（未対応の既存セクションには書き込まない）
        prefix = current_text.rstrip("\r\n")
        separator = newline * 2 if prefix else ""
        return f"{prefix}{separator}## Pitfalls & Lessons{newline}{additions_text}{newline}"

    def _propose_skill_patch(self, skill_file: Path, lessons: List[str]) -> Optional[str]:
        """Propose an updated version of a skill file on disk."""
        try:
            with skill_file.open("r", encoding="utf-8", newline="") as handle:
                current_text = handle.read()
        except Exception as e:
            logger.error("Failed to read skill file: %s", e)
            return None
        return self._propose_skill_text(current_text, lessons)

    def _run_gating(self, skill_file: Path) -> bool:
        """Gate a written SKILL.md: Hermes-compatible frontmatter and body, plus a section patches can extend."""
        try:
            skill_text = skill_file.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            logger.error("[%s] Gating could not read %s: %s", PLUGIN_NAME, skill_file, exc)
            return False

        validation_error = _validate_skill_document(skill_text)
        if validation_error:
            logger.warning("[%s] Gating rejected %s: %s", PLUGIN_NAME, skill_file, validation_error)
            return False

        return bool(re.search(
            r"(?m)^##[ \t]+(?:実行手順|Pitfalls(?: & Lessons)?|Lessons Learned|Workflow|Instructions|注意事項)[ \t]*$",
            skill_text,
            flags=re.IGNORECASE,
        ))

    def _finish_cycle(self, report: Dict[str, Any], skill_name: str, skill_dir: Path, skill_file: Path, created: bool, commit: bool) -> None:
        """Apply the commit policy after a skill passed gating. Commits only when explicitly requested."""
        if not commit:
            report.update({
                "status": "created_uncommitted" if created else "updated_uncommitted",
                "message": "スキルを書き込み、Gating に成功しました。コミットは commit=true の場合のみ実行します。",
            })
            return

        message = f"WikiSkill 自律更新: {_now_str()}"
        if created:
            result = self._initialize_skill_repository(skill_dir, message)
        elif skill_file.name != "SKILL.md":
            report.update({
                "status": "updated_uncommitted",
                "message": "単一ファイルのスキルは自動コミットの対象外です。",
                "commit_error": "only SKILL.md skill directories can be committed",
            })
            return
        else:
            repository = self._git_repository_info(skill_dir)
            if not (repository["is_repository"] and repository["root"] == skill_dir.resolve()):
                report.update({
                    "status": "updated_uncommitted",
                    "message": "スキル更新と Gating は成功しました。既存スキルの専用リポジトリではないため、コミットしていません。",
                    "commit_error": repository["error"] or "existing skill repository is not dedicated to this skill",
                })
                return
            result = self._commit_skill_update(skill_dir, message)

        report["committed"] = bool(result["ok"])
        if result["ok"]:
            report.update({
                "status": "success",
                "message": f"スキル '{skill_name}' の{'作成' if created else '更新'}と Gating・コミットが成功しました。",
            })
            self.recent_errors.clear()
        elif result["git_repository"]:
            report.update({
                "status": "commit_failed",
                "message": "スキル更新と Gating は成功しましたが、Git コミットに失敗しました。",
                "commit_error": result["error"],
            })
        else:
            report.update({
                "status": "created_uncommitted" if created else "updated_uncommitted",
                "message": "スキルの書き込みと Gating は成功しましたが、Git コミットは実行されませんでした。",
                "commit_error": result["error"],
            })

    def run_cycle(self, skill_name: Optional[str] = None, hours: int = 6, dry_run: bool = False, commit: bool = False) -> Dict[str, Any]:
        """Execute a full WikiSkill evolution cycle."""
        self._flush_pending_errors()
        error_records = self._read_error_log(hours)
        if not error_records:
            error_records = list(self.recent_errors)
        if not skill_name:
            latest_error = error_records[-1] if error_records else {}
            skill_name = str(latest_error.get("skill") or UNKNOWN_SKILL_NAME)
        report: Dict[str, Any] = {
            "ts": _now_str(),
            "skill_name": skill_name,
            "status": "pending",
            "lessons_extracted": [],
            "patch_applied": False,
            "gating_passed": False,
            "committed": False,
        }

        try:
            skill_name = _validated_skill_path(skill_name)
        except ValueError as exc:
            report.update({"status": "invalid_skill_name", "message": str(exc)})
            return report
        report["skill_name"] = skill_name

        # 1. 教訓収集: 対象スキルに帰属するエラーだけを対象にする
        target_records = [err for err in error_records if err.get("skill") == skill_name]
        lessons = list(dict.fromkeys([
            lesson for err in target_records
            if (lesson := self._extract_lesson_from_error(err.get("error", "")))
        ]))

        if not lessons:
            report["status"] = "skipped"
            report["message"] = "直近のエラーログまたは教訓が検出されませんでした。"
            return report

        report["lessons_extracted"] = lessons

        # 2. 書き込み先の検査（symlink・領域外パスは書き込まない）
        try:
            locations = self._skill_locations(skill_name)
        except UnsafeSkillPathError as exc:
            report.update({"status": "unsafe_skill_path", "message": str(exc)})
            return report
        except AmbiguousSkillError as exc:
            report.update({"status": "ambiguous_skill", "message": str(exc)})
            return report
        except ValueError as exc:
            report.update({"status": "invalid_skill_name", "message": str(exc)})
            return report

        skill_file = self._existing_skill_file(locations)
        if skill_file is None:
            # 3a. 新規スキル: 生成内容を形式検査してから初めて書き込む
            if "/" in skill_name:
                report.update({
                    "status": "unsafe_skill_path",
                    "message": "カテゴリ付きのスキルは既存のものだけを更新できます（新規作成はしません）。",
                })
                return report
            if not HERMES_CREATE_NAME_PATTERN.fullmatch(skill_name):
                report.update({
                    "status": "invalid_skill_name",
                    "message": "新規スキル名は小文字・数字・'.', '_', '-' のみを使用できます（Hermes の規則）。",
                })
                return report
            if skill_name in (DEFAULT_SKILL_NAME, UNKNOWN_SKILL_NAME):
                report.update({
                    "status": "fallback_skill_refused",
                    "message": "対象スキルを特定できませんでした。skill_name を指定してください（'default_skill' は新規作成しません）。",
                })
                return report
            category_dir = _get_skills_dir() / skill_name
            if category_dir.is_dir() and not (category_dir / "SKILL.md").is_file():
                report.update({
                    "status": "name_conflicts_with_category",
                    "message": f"'{skill_name}' は既存のカテゴリ名です。同名のスキルは作成しません。",
                })
                return report
            candidate = self._propose_skill_text(_new_skill_template(skill_name), lessons)
            if not candidate:
                report["status"] = "skipped"
                report["message"] = "適用すべき新規の差分はありません。"
                return report
            if dry_run:
                report["status"] = "dry_run"
                report["message"] = "ドライラン完了（変更は適用されませんでした）。"
                report["diff_preview"] = f"追加候補: {len(lessons)} 件"
                return report

            validation_error = _validate_skill_document(candidate, new_skill=True)
            if validation_error:
                report.update({
                    "status": "validation_failed",
                    "message": "生成したスキルが形式検査に通らなかったため、書き込みを行いませんでした。",
                    "validation_error": validation_error,
                })
                return report

            target_dir = locations["skill_dir"]
            target_dir.mkdir(parents=True, exist_ok=True)
            skill_file = target_dir / "SKILL.md"
            skill_file.write_bytes(candidate.encode("utf-8"))
            report["patch_applied"] = True
            if not self._run_gating(skill_file):
                skill_file.unlink()
                with contextlib.suppress(OSError):
                    target_dir.rmdir()  # 中身が無い場合のみ（作成したディレクトリを残さない）
                report.update({"status": "rollback", "message": "Gating に失敗したため、作成したスキルを削除しました。"})
                return report
            report["gating_passed"] = True
            self._finish_cycle(report, skill_name, target_dir, skill_file, created=True, commit=commit)
            return report

        # 3b. 既存スキル: パッチ提案
        skill_dir = skill_file.parent
        original_bytes = skill_file.read_bytes()
        original_content = original_bytes.decode("utf-8")
        new_content = self._propose_skill_text(original_content, lessons)
        if not new_content or new_content == original_content:
            report["status"] = "skipped"
            report["message"] = "適用すべき新規の差分はありません。"
            return report

        if dry_run:
            report["status"] = "dry_run"
            report["message"] = "ドライラン完了（変更は適用されませんでした）。"
            report["diff_preview"] = f"変更行数: {len(new_content.splitlines()) - len(original_content.splitlines())}"
            return report

        # 4. パッチ適用と Gating テスト
        skill_file.write_bytes(new_content.encode("utf-8"))
        report["patch_applied"] = True

        if self._run_gating(skill_file):
            report["gating_passed"] = True
            self._finish_cycle(report, skill_name, skill_dir, skill_file, created=False, commit=commit)
        else:
            # Gating 失敗: 元のバイト列に戻す
            skill_file.write_bytes(original_bytes)
            report.update({"status": "rollback", "message": "Gating テストに失敗したため、スキルをロールバックしました。"})

        return report

    def handle_tool_call(self, tool_name: str, args: dict, **kwargs: Any) -> str:
        """Handle execution of plugin tools."""
        if tool_name == "run_wiki_skill_evolution":
            result = self.run_cycle(
                skill_name=args.get("skill_name"),
                hours=int(args.get("hours", 6)),
                dry_run=bool(args.get("dry_run", False)),
                commit=bool(args.get("commit", False)),
            )
            return json.dumps(result, ensure_ascii=False, indent=2)

        return json.dumps({"error": f"Unknown tool: {tool_name}"})
