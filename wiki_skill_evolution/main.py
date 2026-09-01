"""WikiSkill Evolution Plugin for Hermes Agent.

自律進化ループ（Raw/Error → Wiki/Knowledge → Skill）を公式仕様に準拠して実行するプラグイン。
"""

from __future__ import annotations

import datetime
import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

PLUGIN_NAME = "wiki_skill_evolution"
DEFAULT_SKILL_NAME = "default_skill"

GOLDEN_TASKS = [
    {"goal": "echo hello", "context": ""},
    {"goal": "pwd", "context": ""},
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
                    "description": "The skill name to evolve (default 'default_skill').",
                    "default": DEFAULT_SKILL_NAME,
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
    if "HERMES_HOME" in os.environ and os.environ["HERMES_HOME"].strip():
        return Path(os.path.expanduser(os.environ["HERMES_HOME"].strip()))

    prof = os.environ.get("HERMES_PROFILE", "").strip()
    if prof:
        prof_dir = Path(os.path.expanduser(f"~/.hermes/profiles/{prof}"))
        if prof_dir.exists():
            return prof_dir

    try:
        active_prof_file = Path(os.path.expanduser("~/.hermes/active_profile"))
        if active_prof_file.exists():
            prof_name = active_prof_file.read_text(encoding="utf-8").strip()
            if prof_name:
                prof_dir = Path(os.path.expanduser(f"~/.hermes/profiles/{prof_name}"))
                if prof_dir.exists():
                    return prof_dir
    except Exception:
        pass

    return Path(os.path.expanduser("~/.hermes"))


def _get_skills_dir() -> Path:
    """Get the skills directory for the active profile."""
    hermes_home = _get_hermes_home_dir()
    skills_dir = hermes_home / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)
    return skills_dir


def _levenshtein_ratio(a: str, b: str) -> float:
    """Calculate Levenshtein similarity ratio between two strings (0.0 to 1.0)."""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    len_a, len_b = len(a), len(b)
    dp = list(range(len_b + 1))
    for i in range(1, len_a + 1):
        prev = dp[0]
        dp[0] = i
        for j in range(1, len_b + 1):
            cur = dp[j]
            if a[i - 1] == b[j - 1]:
                dp[j] = prev
            else:
                dp[j] = 1 + min(prev, dp[j], dp[j - 1])
            prev = cur
    distance = dp[len_b]
    max_len = max(len_a, len_b)
    return 1.0 - (distance / max_len)


class WikiSkillEvolutionPlugin:
    """WikiSkill autonomous evolution loop manager."""

    def __init__(self, ctx: Optional[Any] = None) -> None:
        self.ctx = ctx
        self.recent_errors: List[Dict[str, Any]] = []

    def on_post_tool_call(self, tool_name: str = "", args: Any = None, result: Any = None, error: Any = None, **kwargs: Any) -> None:
        """Hook called after any tool execution in Hermes."""
        if error:
            err_msg = str(error)
            self.recent_errors.append({
                "ts": _now_str(),
                "tool": tool_name,
                "error": err_msg,
            })
            logger.info("[%s] Captured tool error from %s: %s", PLUGIN_NAME, tool_name, err_msg[:100])

    def on_session_end(self, session_id: str = "", **kwargs: Any) -> None:
        """Hook called when a session ends."""
        if self.recent_errors:
            logger.info("[%s] Session %s ended with %d captured errors. Evaluating evolution...", PLUGIN_NAME, session_id, len(self.recent_errors))

    def _extract_lesson_from_error(self, error_text: str) -> Optional[str]:
        """Extract rule-based lesson from error text."""
        err_lower = error_text.lower()
        if "importerror" in err_lower or "modulenotfounderror" in err_lower or "no module named" in err_lower:
            return (
                "[Python/Path] ImportError が発生。"
                " 解決策: 実行スクリプトの先頭で sys.path にプロジェクトルートを明示追加する。"
            )
        if "filenotfounderror" in err_lower or "no such file" in err_lower:
            return (
                "[IO/FileNotFound] ファイルが見つからない。"
                " 解決策: ファイルパスを絶対パスに変換するか、作業ディレクトリを確認する。"
            )
        if "timeout" in err_lower or "timed out" in err_lower:
            return (
                "[Net/Timeout] ネットワークタイムアウトが発生。"
                " 解決策: リトライロジックまたはタイムアウト値を増やす。"
            )
        if "permission denied" in err_lower:
            return (
                "[OS/Permission] 権限エラーが発生。"
                " 解決策: ファイルパーミッションまたは実行権限を確認する。"
            )
        return f"[General] 失敗: {error_text[:200]}"

    def _get_skill_file(self, skill_name: str) -> Optional[Path]:
        """Resolve skill markdown file path."""
        skills_dir = _get_skills_dir()
        skill_path = skills_dir / skill_name / "SKILL.md"
        if skill_path.exists():
            return skill_path
        
        # Fallback to direct .md file
        direct_md = skills_dir / f"{skill_name}.md"
        if direct_md.exists():
            return direct_md

        return None

    def _run_terminal_command(self, cmd: str, cwd: Optional[Path] = None) -> Dict[str, Any]:
        """Safely execute shell command in working directory."""
        try:
            res = subprocess.run(
                cmd,
                shell=True,
                cwd=str(cwd) if cwd else None,
                capture_output=True,
                text=True,
                timeout=30,
            )
            return {
                "exit_code": res.returncode,
                "stdout": res.stdout,
                "stderr": res.stderr,
            }
        except Exception as e:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": str(e),
            }

    def _propose_skill_patch(self, skill_file: Path, lessons: List[str]) -> Optional[str]:
        """Propose an updated version of skill markdown."""
        try:
            current_text = skill_file.read_text(encoding="utf-8")
        except Exception as e:
            logger.error("Failed to read skill file: %s", e)
            return None

        pattern = r"(## 実行手順\n)(.*?)(?=\n## |\Z)"
        match = re.search(pattern, current_text, flags=re.DOTALL)
        if not match:
            # If no execution steps section, append one
            old_block = ""
            section_header = "\n## 実行手順\n"
        else:
            old_block = match.group(0)
            section_header = match.group(1)

        additions: List[str] = []
        for lesson in lessons:
            if "[IO/FileNotFound]" in lesson or "FileNotFound" in lesson:
                additions.append("- ファイルパスは絶対パスで指定し、FileNotFound エラーを回避する。")
            elif "[Python/Path]" in lesson or "ImportError" in lesson:
                additions.append("- 実行スクリプトの先頭で sys.path にプロジェクトルートを追加する。")
            elif "[Net/Timeout]" in lesson or "timeout" in lesson.lower():
                additions.append("- ネットワーク操作にはリトライとタイムアウト延長を設定する。")
            elif "[OS/Permission]" in lesson:
                additions.append("- 実行前に必要なファイルパーミッションを確認する。")
            else:
                short = lesson.split(" v")[0].strip()
                if len(short) > 100:
                    short = short[:97] + "..."
                additions.append(f"- {short}")

        # Unique additions
        unique_additions: List[str] = []
        for item in additions:
            if item not in unique_additions and item not in current_text:
                unique_additions.append(item)

        if not unique_additions:
            return None

        if old_block:
            new_block = old_block.rstrip("\n") + "\n" + "\n".join(unique_additions)
            new_text = current_text.replace(old_block, new_block, 1)
        else:
            new_text = current_text.rstrip("\n") + section_header + "\n".join(unique_additions) + "\n"

        return new_text

    def _run_gating(self, skill_file: Path) -> bool:
        """Run golden set validation."""
        for task in GOLDEN_TASKS:
            goal = task["goal"]
            res = self._run_terminal_command(goal, cwd=skill_file.parent)
            if res.get("exit_code") != 0:
                return False

        try:
            content = skill_file.read_text(encoding="utf-8")
            if "## 実行手順" not in content:
                return False
        except Exception:
            return False

        return True

    def run_cycle(self, skill_name: str = DEFAULT_SKILL_NAME, hours: int = 6, dry_run: bool = False) -> Dict[str, Any]:
        """Execute a full WikiSkill evolution cycle."""
        report: Dict[str, Any] = {
            "ts": _now_str(),
            "skill_name": skill_name,
            "status": "pending",
            "lessons_extracted": [],
            "patch_applied": False,
            "gating_passed": False,
            "committed": False,
        }

        # 1. Gather error lessons
        lessons: List[str] = []
        for err_entry in self.recent_errors:
            lesson = self._extract_lesson_from_error(err_entry.get("error", ""))
            if lesson and lesson not in lessons:
                lessons.append(lesson)

        if not lessons:
            report["status"] = "skipped"
            report["message"] = "直近のエラーログまたは教訓が検出されませんでした。"
            return report

        report["lessons_extracted"] = lessons

        # 2. Locate skill file
        skill_file = self._get_skill_file(skill_name)
        if not skill_file:
            # Create a basic skill file if not found
            skills_dir = _get_skills_dir()
            target_dir = skills_dir / skill_name
            target_dir.mkdir(parents=True, exist_ok=True)
            skill_file = target_dir / "SKILL.md"
            skill_file.write_text(
                f"# {skill_name}\n\n自動生成されたスキル定義。\n\n## 実行手順\n- 基本タスクを実行する。\n",
                encoding="utf-8",
            )
            # Initialize git repo in skill folder if needed
            self._run_terminal_command("git init && git add SKILL.md && git commit -m 'Initial commit'", cwd=target_dir)

        skill_dir = skill_file.parent
        original_content = skill_file.read_text(encoding="utf-8")

        # 3. Propose patch
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

        # 4. Apply patch and test
        skill_file.write_text(new_content, encoding="utf-8")
        report["patch_applied"] = True

        gating_passed = self._run_gating(skill_file)
        report["gating_passed"] = gating_passed

        if gating_passed:
            # 5. Commit
            self._run_terminal_command("git add SKILL.md", cwd=skill_dir)
            self._run_terminal_command(f"git commit -m 'WikiSkill 自律更新: {_now_str()}'", cwd=skill_dir)
            report["committed"] = True
            report["status"] = "success"
            report["message"] = f"スキル '{skill_name}' の自律更新とテスト・コミットが成功しました。"
            # Clear processed errors
            self.recent_errors.clear()
        else:
            # Rollback
            skill_file.write_text(original_content, encoding="utf-8")
            self._run_terminal_command("git checkout HEAD -- SKILL.md", cwd=skill_dir)
            report["status"] = "rollback"
            report["message"] = "Gating テストに失敗したため、スキルをロールバックしました。"

        return report

    def handle_tool_call(self, tool_name: str, args: dict, **kwargs: Any) -> str:
        """Handle execution of plugin tools."""
        if tool_name == "run_wiki_skill_evolution":
            skill_name = args.get("skill_name", DEFAULT_SKILL_NAME)
            hours = int(args.get("hours", 6))
            dry_run = bool(args.get("dry_run", False))
            result = self.run_cycle(skill_name=skill_name, hours=hours, dry_run=dry_run)
            return json.dumps(result, ensure_ascii=False, indent=2)

        return json.dumps({"error": f"Unknown tool: {tool_name}"})
