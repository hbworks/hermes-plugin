"""WikiSkill Evolution Plugin for Hermes Agent.

自律進化ループ（Raw/Error → Wiki/Knowledge → Skill）を公式仕様に準拠して実行するプラグイン。
"""

from __future__ import annotations

import datetime
import json
import logging
import os
import re
import shlex
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

logger = logging.getLogger(__name__)

PLUGIN_NAME = "wiki-skill-evolution"
DEFAULT_SKILL_NAME = "default_skill"
ERROR_LOG_RELATIVE_PATH = Path("logs") / "evolution_errors.jsonl"
ERROR_LOG_MAX_BYTES = 5 * 1024 * 1024
MAX_RECENT_ERRORS = 50

# Tool names are intentionally matched from most-specific to least-specific.
SKILL_MAPPINGS = {
    "python_exec": "python",
    "python_run": "python",
    "git_": "git_workflow",
    "git": "git_workflow",
}

GOLDEN_TASKS = [
    {"goal": "echo hello", "context": ""},
    {"goal": "pwd", "context": ""},
]

# エラーパターンと対応する教訓・スキル追記ルールの定義
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
]

# Tool Schema for run_wiki_skill_evolution
RUN_EVOLUTION_SCHEMA = {
    "type": "function",
    "function": {
        "name": "run_wiki_skill_evolution",
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
                    "description": "If true, propose patch without applying git commit.",
                    "default": False,
                },
            },
        },
    },
}


def _now_str() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


def _get_hermes_home_dir() -> Path:
    """Resolve active Hermes home directory respecting active profiles."""
    prof = os.environ.get("HERMES_PROFILE", "").strip()
    if prof:
        hermes_root = Path(os.path.expanduser(os.environ.get("HERMES_HOME", "~/.hermes").strip()))
        prof_dir = hermes_root / "profiles" / prof
        if prof_dir.exists():
            return prof_dir

    try:
        hermes_root = Path(os.path.expanduser(os.environ.get("HERMES_HOME", "~/.hermes").strip()))
        active_prof = hermes_root / "active_profile"
        if active_prof.exists():
            prof_name = active_prof.read_text(encoding="utf-8").strip()
            if prof_name:
                p_dir = hermes_root / "profiles" / prof_name
                if p_dir.exists():
                    return p_dir
    except Exception:
        pass

    return Path(os.path.expanduser(os.environ.get("HERMES_HOME", "~/.hermes").strip()))


def _get_skills_dir() -> Path:
    """Get the skills directory for the active profile."""
    skills_dir = _get_hermes_home_dir() / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)
    return skills_dir


class WikiSkillEvolutionPlugin:
    """WikiSkill autonomous evolution loop manager."""

    def __init__(self, ctx: Optional[Any] = None) -> None:
        self.ctx = ctx
        self.recent_errors: List[Dict[str, Any]] = []
        self._pending_errors: List[Dict[str, Any]] = []

    def _error_log_path(self) -> Path:
        """Return the persistent error log path, creating its parent directory."""
        log_path = _get_hermes_home_dir() / ERROR_LOG_RELATIVE_PATH
        log_path.parent.mkdir(parents=True, exist_ok=True)
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
        """Append one error record and rotate the log when it reaches its size limit."""
        try:
            log_path = self._error_log_path()
            line = json.dumps(error_record, ensure_ascii=False, separators=(",", ":")) + "\n"
            encoded = line.encode("utf-8")
            self._rotate_error_log_if_needed(log_path, len(encoded))
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(line)
                handle.flush()
            return True
        except OSError as exc:
            logger.error("[%s] Failed to persist error log: %s", PLUGIN_NAME, exc)
            return False

    def _flush_pending_errors(self) -> None:
        """Retry records that could not be written during the tool hook."""
        pending = list(self._pending_errors)
        self._pending_errors.clear()
        for error_record in pending:
            if not self._persist_error(error_record):
                self._pending_errors.append(error_record)

    def _read_error_log(self, hours: int) -> List[Dict[str, Any]]:
        """Read valid error records from the requested lookback window."""
        cutoff = datetime.datetime.now() - datetime.timedelta(hours=max(0, hours))
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
                            timestamp = datetime.datetime.fromisoformat(str(record["ts"]))
                            if timestamp >= cutoff and isinstance(record, dict):
                                records.append(record)
                        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
                            logger.warning(
                                "[%s] Ignoring malformed error log line %d: %s",
                                PLUGIN_NAME,
                                line_number,
                                exc,
                            )
            except OSError as exc:
                logger.error("[%s] Failed to read error log: %s", PLUGIN_NAME, exc)
        return sorted(records, key=lambda record: str(record.get("ts", "")))

    def _extract_context_value(self, args: Any, keys: tuple[str, ...]) -> str:
        if isinstance(args, dict):
            for key in keys:
                value = args.get(key)
                if isinstance(value, (str, Path)):
                    return str(value)
        return ""

    def _resolve_skill_name(self, tool_name: str, args: Any = None, error: str = "") -> str:
        """Map tool/command context to a skill, falling back only when unknown."""
        explicit = self._extract_context_value(args, ("skill_name", "skill"))
        if explicit:
            return explicit

        for mapped_tool, skill_name in sorted(SKILL_MAPPINGS.items(), key=lambda item: -len(item[0])):
            if tool_name == mapped_tool or tool_name.startswith(mapped_tool):
                if mapped_tool == "python_exec":
                    context = " ".join(
                        value for value in (
                            self._extract_context_value(args, ("command", "cmd", "script", "path")),
                            error,
                        ) if value
                    )
                    match = re.search(r"(?:skills[/\\])([^/\\\s]+)", context)
                    if match:
                        return match.group(1)
                return skill_name

        context = " ".join(
            value for value in (
                self._extract_context_value(args, ("command", "cmd", "script", "path")),
                error,
            ) if value
        )
        match = re.search(r"(?:skills[/\\])([^/\\\s]+)", context)
        return match.group(1) if match else DEFAULT_SKILL_NAME

    def on_post_tool_call(self, tool_name: str = "", args: Any = None, result: Any = None, error: Any = None, **kwargs: Any) -> None:
        """Hook called after any tool execution in Hermes."""
        if error:
            err_msg = str(error)
            context_args: Any = args
            try:
                json.dumps(context_args, ensure_ascii=False)
            except (TypeError, ValueError):
                context_args = str(args)
            error_record = {
                "ts": _now_str(),
                "tool": tool_name,
                "error": err_msg,
                "args": context_args,
            }
            self.recent_errors.append(error_record)
            # 直近50件を保持（メモリ上限管理）
            self.recent_errors = self.recent_errors[-MAX_RECENT_ERRORS:]
            if not self._persist_error(error_record):
                self._pending_errors.append(error_record)
            logger.info("[%s] Captured tool error from %s: %s", PLUGIN_NAME, tool_name, err_msg[:100])

    def on_session_end(self, session_id: str = "", **kwargs: Any) -> None:
        """Hook called when a session ends."""
        self._flush_pending_errors()
        if self.recent_errors:
            logger.info("[%s] Session %s ended with %d captured errors. Evaluating evolution...", PLUGIN_NAME, session_id, len(self.recent_errors))

    def _extract_lesson_from_error(self, error_text: str) -> Optional[str]:
        """Extract rule-based lesson from error text."""
        err_lower = error_text.lower()
        for rule in ERROR_RULES:
            if any(k in err_lower for k in rule["keywords"]):
                return rule["lesson"]
        return f"[General] 失敗: {error_text[:200]}"

    def _get_skill_file(self, skill_name: str) -> Optional[Path]:
        """Resolve skill markdown file path."""
        skills_dir = _get_skills_dir()
        skill_path = skills_dir / skill_name / "SKILL.md"
        if skill_path.exists():
            return skill_path

        direct_md = skills_dir / f"{skill_name}.md"
        return direct_md if direct_md.exists() else None

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

    def _propose_skill_patch(self, skill_file: Path, lessons: List[str]) -> Optional[str]:
        """Propose an updated version of skill markdown."""
        try:
            current_text = skill_file.read_text(encoding="utf-8")
        except Exception as e:
            logger.error("Failed to read skill file: %s", e)
            return None

        pattern = r"(## 実行手順\n)(.*?)(?=\n## |\Z)"
        match = re.search(pattern, current_text, flags=re.DOTALL)
        old_block = match.group(0) if match else ""
        section_header = match.group(1) if match else "\n## 実行手順\n"

        additions: List[str] = []
        for lesson in lessons:
            matched = False
            for rule in ERROR_RULES:
                if rule["lesson"] == lesson or any(k in lesson.lower() for k in rule["keywords"]):
                    additions.append(rule["patch"])
                    matched = True
                    break
            if not matched:
                short = lesson.split(" v")[0].strip()
                additions.append(f"- {short[:97]}..." if len(short) > 100 else f"- {short}")

        # 重複排除
        unique_additions = [item for item in additions if item not in current_text]
        if not unique_additions:
            return None

        if old_block:
            new_block = old_block.rstrip("\n") + "\n" + "\n".join(dict.fromkeys(unique_additions))
            return current_text.replace(old_block, new_block, 1)
        return current_text.rstrip("\n") + section_header + "\n".join(dict.fromkeys(unique_additions)) + "\n"

    def _run_gating(self, skill_file: Path) -> bool:
        """Run golden set validation."""
        for task in GOLDEN_TASKS:
            if self._run_terminal_command(task["goal"], cwd=skill_file.parent).get("exit_code") != 0:
                return False

        try:
            return "## 実行手順" in skill_file.read_text(encoding="utf-8")
        except Exception:
            return False

    def run_cycle(self, skill_name: Optional[str] = None, hours: int = 6, dry_run: bool = False) -> Dict[str, Any]:
        """Execute a full WikiSkill evolution cycle."""
        self._flush_pending_errors()
        error_records = self._read_error_log(hours)
        if not error_records:
            error_records = list(self.recent_errors)
        if not skill_name:
            latest_error = error_records[-1] if error_records else {}
            skill_name = self._resolve_skill_name(
                str(latest_error.get("tool", "")),
                latest_error.get("args"),
                str(latest_error.get("error", "")),
            )
        report: Dict[str, Any] = {
            "ts": _now_str(),
            "skill_name": skill_name,
            "status": "pending",
            "lessons_extracted": [],
            "patch_applied": False,
            "gating_passed": False,
            "committed": False,
        }

        # 1. 教訓収集
        lessons = list(dict.fromkeys([
            lesson for err in error_records
            if (lesson := self._extract_lesson_from_error(err.get("error", "")))
        ]))

        if not lessons:
            report["status"] = "skipped"
            report["message"] = "直近のエラーログまたは教訓が検出されませんでした。"
            return report

        report["lessons_extracted"] = lessons

        # 2. スキルファイルの取得または生成
        skill_file = self._get_skill_file(skill_name)
        if not skill_file:
            target_dir = _get_skills_dir() / skill_name
            target_dir.mkdir(parents=True, exist_ok=True)
            skill_file = target_dir / "SKILL.md"
            skill_file.write_text(f"# {skill_name}\n\n自動生成されたスキル定義。\n\n## 実行手順\n- 基本タスクを実行する。\n", encoding="utf-8")
            self._run_terminal_command(["git", "init"], cwd=target_dir)
            self._run_terminal_command(["git", "add", "SKILL.md"], cwd=target_dir)
            self._run_terminal_command(["git", "commit", "-m", "Initial commit"], cwd=target_dir)

        skill_dir = skill_file.parent
        original_content = skill_file.read_text(encoding="utf-8")

        # 3. パッチ提案
        new_content = self._propose_skill_patch(skill_file, lessons)
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
        skill_file.write_text(new_content, encoding="utf-8")
        report["patch_applied"] = True

        if self._run_gating(skill_file):
            # 5. テスト合格: コミット
            self._run_terminal_command(["git", "add", "SKILL.md"], cwd=skill_dir)
            self._run_terminal_command(["git", "commit", "-m", f"WikiSkill 自律更新: {_now_str()}"], cwd=skill_dir)
            report.update({"committed": True, "gating_passed": True, "status": "success", "message": f"スキル '{skill_name}' の自律更新とテスト・コミットが成功しました。"})
            self.recent_errors.clear()
        else:
            # 6. テスト失敗: ロールバック
            skill_file.write_text(original_content, encoding="utf-8")
            self._run_terminal_command(["git", "checkout", "HEAD", "--", "SKILL.md"], cwd=skill_dir)
            report.update({"status": "rollback", "message": "Gating テストに失敗したため、スキルをロールバックしました。"})

        return report

    def handle_tool_call(self, tool_name: str, args: dict, **kwargs: Any) -> str:
        """Handle execution of plugin tools."""
        if tool_name == "run_wiki_skill_evolution":
            result = self.run_cycle(
                skill_name=args.get("skill_name"),
                hours=int(args.get("hours", 6)),
                dry_run=bool(args.get("dry_run", False)),
            )
            return json.dumps(result, ensure_ascii=False, indent=2)

        return json.dumps({"error": f"Unknown tool: {tool_name}"})
