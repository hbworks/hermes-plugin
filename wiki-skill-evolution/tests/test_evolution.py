"""Unit tests for WikiSkill Evolution Plugin."""
import datetime
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

# Add plugin dir to path
import sys
plugin_dir = Path(__file__).resolve().parent.parent
if str(plugin_dir) not in sys.path:
    sys.path.insert(0, str(plugin_dir))

from main import WikiSkillEvolutionPlugin, ERROR_RULES


class TestWikiSkillEvolution(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.hermes_home = Path(self.tmpdir) / ".hermes"
        self.hermes_home.mkdir(parents=True, exist_ok=True)
        os.environ["HERMES_HOME"] = str(self.hermes_home)
        self.plugin = WikiSkillEvolutionPlugin()

    def tearDown(self):
        os.environ.pop("HERMES_HOME", None)
        os.environ.pop("HERMES_PROFILE", None)
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_error_rule_classification(self):
        """Should classify known tool errors into actionable lessons."""
        # 1. ImportError
        err1 = "ModuleNotFoundError: No module named 'pandas'"
        lesson1 = self.plugin._extract_lesson_from_error(err1)
        self.assertIn("sys.path", lesson1)

        # 2. FileNotFoundError
        err2 = "FileNotFoundError: [Errno 2] No such file or directory: 'config.json'"
        lesson2 = self.plugin._extract_lesson_from_error(err2)
        self.assertIn("絶対パス", lesson2)

        # 3. Permission denied
        err3 = "PermissionError: [Errno 13] Permission denied: '/var/log/app.log'"
        lesson3 = self.plugin._extract_lesson_from_error(err3)
        self.assertIn("パーミッション", lesson3)

        # 4. Timeout
        err4 = "urllib.error.URLError: <urlopen error timed out>"
        lesson4 = self.plugin._extract_lesson_from_error(err4)
        self.assertIn("リトライ", lesson4)

    def test_post_tool_call_capture(self):
        """Should capture tool execution errors in recent_errors list up to 50 items."""
        # Successful call - should not record
        self.plugin.on_post_tool_call(tool_name="bash", args={}, result="success", error=None)
        self.assertEqual(len(self.plugin.recent_errors), 0)

        # Failure call - should record
        self.plugin.on_post_tool_call(tool_name="bash", args={}, result=None, error="ImportError: missing mod")
        self.assertEqual(len(self.plugin.recent_errors), 1)
        self.assertEqual(self.plugin.recent_errors[0]["tool"], "bash")
        self.assertIn("ImportError", self.plugin.recent_errors[0]["error"])

        # Overflow limit check (50 entries)
        for i in range(60):
            self.plugin.on_post_tool_call(tool_name="bash", error=f"Error {i}")
        self.assertEqual(len(self.plugin.recent_errors), 50)

    def test_error_log_persists_and_is_loaded_with_lookback(self):
        """Should persist errors and ignore records outside the requested window."""
        self.plugin.on_post_tool_call(tool_name="git_status", args={"command": "git status"}, error="Permission denied")
        log_path = self.hermes_home / "logs" / "evolution_errors.jsonl"
        old_record = {
            "ts": (datetime.datetime.now() - datetime.timedelta(hours=8)).isoformat(timespec="seconds"),
            "tool": "bash",
            "error": "ImportError: old",
            "args": {},
        }
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(old_record) + "\n")

        records = self.plugin._read_error_log(hours=6)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["tool"], "git_status")

        restarted = WikiSkillEvolutionPlugin()
        self.assertEqual(len(restarted._read_error_log(hours=6)), 1)

    def test_error_log_is_scoped_to_active_profile(self):
        """Should store logs below the active profile directory."""
        profile_dir = self.hermes_home / "profiles" / "coding"
        profile_dir.mkdir(parents=True, exist_ok=True)
        os.environ["HERMES_PROFILE"] = "coding"

        self.plugin.on_post_tool_call(tool_name="git_status", error="Permission denied")

        profile_log = profile_dir / "logs" / "evolution_errors.jsonl"
        global_log = self.hermes_home / "logs" / "evolution_errors.jsonl"
        self.assertTrue(profile_log.exists())
        self.assertFalse(global_log.exists())

    def test_skill_mapping_uses_tool_and_script_context(self):
        """Should infer a target skill and fall back for unknown tools."""
        self.assertEqual(self.plugin._resolve_skill_name("git_commit"), "git_workflow")
        self.assertEqual(
            self.plugin._resolve_skill_name(
                "python_exec",
                {"command": "python ~/.hermes/skills/web_scraper/scripts/fetch.py"},
            ),
            "web_scraper",
        )
        self.assertEqual(self.plugin._resolve_skill_name("unknown_tool"), "default_skill")

    def test_error_log_rotates_at_size_limit(self):
        """Should rotate an oversized JSONL file before appending."""
        import main

        original_limit = main.ERROR_LOG_MAX_BYTES
        try:
            main.ERROR_LOG_MAX_BYTES = 100
            for i in range(3):
                self.plugin.on_post_tool_call(tool_name="bash", error=f"error-{i}-" + ("x" * 60))
            self.assertTrue((self.hermes_home / "logs" / "evolution_errors.jsonl.1").exists())
        finally:
            main.ERROR_LOG_MAX_BYTES = original_limit

    def test_propose_skill_patch(self):
        """Should patch skill markdown by injecting lessons under execution procedure."""
        skill_dir = self.hermes_home / "skills" / "my_skill"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_text(
            "# My Skill\n\nOverview of the skill.\n\n## 実行手順\n- 基本タスクを実行する。\n",
            encoding="utf-8"
        )

        rule = ERROR_RULES[0]
        lessons = [rule["lesson"]]
        patched = self.plugin._propose_skill_patch(skill_file, lessons)
        self.assertIsNotNone(patched)
        self.assertIn(rule["patch"], patched)
        self.assertIn("基本タスクを実行する", patched)

        # Re-applying the same lesson should return None (no new changes)
        skill_file.write_text(patched, encoding="utf-8")
        patched_again = self.plugin._propose_skill_patch(skill_file, lessons)
        self.assertIsNone(patched_again)

    def test_run_terminal_command_safe(self):
        """Should execute commands safely using shell=False with argument lists."""
        res = self.plugin._run_terminal_command(["echo", "safe_execution"])
        self.assertEqual(res["exit_code"], 0)
        self.assertIn("safe_execution", res["stdout"])

        # String format should also be safely parsed with shlex
        res_str = self.plugin._run_terminal_command("echo hello_world")
        self.assertEqual(res_str["exit_code"], 0)
        self.assertIn("hello_world", res_str["stdout"])

    def test_run_cycle_dry_run(self):
        """Should simulate evolution cycle in dry-run mode without modifying disk files."""
        # Record an error
        self.plugin.on_post_tool_call(tool_name="python_run", error="ImportError: No module named 'requests'")

        # Create target skill
        skill_dir = self.hermes_home / "skills" / "web_scraper"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_text("# Web Scraper\n\n## 実行手順\n- 対象URLにアクセスする。\n", encoding="utf-8")

        res = self.plugin.run_cycle(skill_name="web_scraper", dry_run=True)
        self.assertEqual(res["status"], "dry_run")
        self.assertIn("ドライラン完了", res["message"])
        self.assertIn("diff_preview", res)

        # File content should remain unchanged
        content = skill_file.read_text(encoding="utf-8")
        self.assertNotIn("依存ライブラリ", content)


if __name__ == "__main__":
    unittest.main()
