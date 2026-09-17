"""Unit tests for WikiSkill Evolution Plugin."""
import datetime
import json
import os
import shlex
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# Add plugin dir to path
import sys
plugin_dir = Path(__file__).resolve().parent.parent
if str(plugin_dir) not in sys.path:
    sys.path.insert(0, str(plugin_dir))

from main import RUN_EVOLUTION_SCHEMA, WikiSkillEvolutionPlugin, ERROR_RULES
from __init__ import register


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

    def test_registers_hermes_tool_contract(self):
        """Should register a flat schema and an args-only Hermes handler."""
        registrations = []

        class Context:
            def register_tool(self, **kwargs):
                registrations.append(kwargs)

            def register_hook(self, *args):
                pass

        register(Context())

        self.assertEqual(len(registrations), 1)
        tool = registrations[0]
        self.assertEqual(tool["schema"], RUN_EVOLUTION_SCHEMA)
        self.assertIn("description", tool["schema"])
        self.assertIn("parameters", tool["schema"])
        self.assertNotIn("function", tool["schema"])

        result = json.loads(tool["handler"]({"dry_run": True}))
        self.assertIn("status", result)

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

    def test_post_tool_call_capture_supports_hermes_error_kwargs_and_result(self):
        """Should capture Hermes hook error fields and tool-result errors."""
        cases = [
            (
                "hermes_error_message",
                {"error_message": "Some Error", "status": "error"},
                None,
                "Some Error",
            ),
            (
                "hermes_status_with_type",
                {"status": "error", "error_type": "RuntimeError"},
                None,
                "RuntimeError",
            ),
            (
                "tool_result_error",
                {},
                {"error": "Some Error"},
                "Some Error",
            ),
        ]

        log_path = self.hermes_home / "logs" / "evolution_errors.jsonl"
        for tool_name, hook_kwargs, result, expected_error in cases:
            with self.subTest(tool_name=tool_name):
                self.plugin.on_post_tool_call(
                    tool_name=tool_name,
                    args={"case": tool_name},
                    result=result,
                    **hook_kwargs,
                )

                self.assertEqual(self.plugin.recent_errors[-1]["tool"], tool_name)
                self.assertEqual(self.plugin.recent_errors[-1]["error"], expected_error)

        persisted_records = [
            json.loads(line)
            for line in log_path.read_text(encoding="utf-8").splitlines()
        ]
        self.assertEqual(
            [record["error"] for record in persisted_records[-len(cases):]],
            [case[3] for case in cases],
        )

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

    def test_persisted_timestamp_is_timezone_aware(self):
        self.plugin.on_post_tool_call(tool_name="bash", error="ImportError: missing mod")
        record = json.loads((self.hermes_home / "logs" / "evolution_errors.jsonl").read_text(encoding="utf-8"))
        self.assertIsNotNone(datetime.datetime.fromisoformat(record["ts"]).tzinfo)

    def test_pending_errors_are_bounded(self):
        import main

        original_persist = self.plugin._persist_error
        try:
            self.plugin._persist_error = lambda record: False
            for i in range(main.MAX_PENDING_ERRORS + 10):
                self.plugin.on_post_tool_call(tool_name="bash", error=f"error-{i}")
            self.assertEqual(len(self.plugin._pending_errors), main.MAX_PENDING_ERRORS)
        finally:
            self.plugin._persist_error = original_persist

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

    def test_run_cycle_dry_run_does_not_create_missing_skill(self):
        self.plugin.on_post_tool_call(tool_name="bash", error="ImportError: missing mod")

        res = self.plugin.run_cycle(skill_name="new_skill", dry_run=True)

        self.assertEqual(res["status"], "dry_run")
        self.assertFalse((self.hermes_home / "skills" / "new_skill" / "SKILL.md").exists())

    def _create_skill_file(self, skill_name="existing_skill"):
        skill_dir = self.hermes_home / "skills" / skill_name
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_text(
            f"# {skill_name}\n\n## 実行手順\n- 基本タスクを実行する。\n",
            encoding="utf-8",
        )
        return skill_dir, skill_file

    def _initialize_git_repository(self, skill_dir):
        self.assertEqual(
            self.plugin._run_terminal_command(["git", "init"], cwd=skill_dir)["exit_code"],
            0,
        )
        self.assertEqual(
            self.plugin._run_terminal_command(
                ["git", "config", "user.name", "WikiSkill Tests"], cwd=skill_dir
            )["exit_code"],
            0,
        )
        self.assertEqual(
            self.plugin._run_terminal_command(
                ["git", "config", "user.email", "wikiskill-tests@example.com"], cwd=skill_dir
            )["exit_code"],
            0,
        )
        self.assertEqual(
            self.plugin._run_terminal_command(["git", "add", "SKILL.md"], cwd=skill_dir)["exit_code"],
            0,
        )
        self.assertEqual(
            self.plugin._run_terminal_command(
                ["git", "commit", "-m", "Initial test commit"], cwd=skill_dir
            )["exit_code"],
            0,
        )

    def test_run_cycle_existing_unmanaged_skill_reports_updated_uncommitted(self):
        _, skill_file = self._create_skill_file()
        self.plugin.on_post_tool_call(tool_name="python_run", error="ImportError: missing mod")

        result = self.plugin.run_cycle(skill_name="existing_skill")

        self.assertEqual(result["status"], "updated_uncommitted")
        self.assertTrue(result["patch_applied"])
        self.assertTrue(result["gating_passed"])
        self.assertFalse(result["committed"])
        self.assertEqual(result["commit_error"], "skill directory is not a git repository")
        self.assertIn(ERROR_RULES[0]["patch"], skill_file.read_text(encoding="utf-8"))

    def test_run_cycle_commit_failure_is_reported(self):
        skill_dir, _ = self._create_skill_file("dedicated_skill")
        self._initialize_git_repository(skill_dir)
        self.plugin.on_post_tool_call(tool_name="python_run", error="ImportError: missing mod")

        original_run = self.plugin._run_terminal_command

        def fail_commit(cmd, cwd=None):
            args = shlex.split(cmd) if isinstance(cmd, str) else list(cmd)
            if args[:2] == ["git", "commit"]:
                return {"exit_code": 1, "stdout": "", "stderr": "simulated commit failure"}
            return original_run(cmd, cwd=cwd)

        self.plugin._run_terminal_command = fail_commit
        result = self.plugin.run_cycle(skill_name="dedicated_skill")

        self.assertEqual(result["status"], "commit_failed")
        self.assertTrue(result["patch_applied"])
        self.assertTrue(result["gating_passed"])
        self.assertFalse(result["committed"])
        self.assertIn("simulated commit failure", result["commit_error"])

    def test_run_cycle_gating_failure_does_not_checkout_user_changes(self):
        _, skill_file = self._create_skill_file("gating_skill")
        original_content = skill_file.read_text(encoding="utf-8")
        self.plugin.on_post_tool_call(tool_name="python_run", error="ImportError: missing mod")

        commands = []
        original_run = self.plugin._run_terminal_command

        def track_commands(cmd, cwd=None):
            args = shlex.split(cmd) if isinstance(cmd, str) else list(cmd)
            commands.append(args)
            return original_run(cmd, cwd=cwd)

        with patch.object(self.plugin, "_run_terminal_command", side_effect=track_commands):
            with patch.object(self.plugin, "_run_gating", return_value=False):
                result = self.plugin.run_cycle(skill_name="gating_skill")

        self.assertEqual(result["status"], "rollback")
        self.assertEqual(skill_file.read_text(encoding="utf-8"), original_content)
        self.assertFalse(any(command[:2] == ["git", "checkout"] for command in commands))

    def test_run_cycle_new_skill_commits_initial_and_evolution_updates(self):
        self.plugin.on_post_tool_call(tool_name="python_run", error="ImportError: missing mod")
        git_identity = {
            "GIT_AUTHOR_NAME": "WikiSkill Tests",
            "GIT_AUTHOR_EMAIL": "wikiskill-tests@example.com",
            "GIT_COMMITTER_NAME": "WikiSkill Tests",
            "GIT_COMMITTER_EMAIL": "wikiskill-tests@example.com",
        }
        previous_identity = {key: os.environ.get(key) for key in git_identity}
        os.environ.update(git_identity)
        try:
            result = self.plugin.run_cycle(skill_name="new_skill")
        finally:
            for key, value in previous_identity.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        skill_dir = self.hermes_home / "skills" / "new_skill"
        log_result = self.plugin._run_terminal_command(
            ["git", "log", "--format=%s"], cwd=skill_dir
        )
        self.assertEqual(result["status"], "success")
        self.assertTrue(result["patch_applied"])
        self.assertTrue(result["gating_passed"])
        self.assertTrue(result["committed"])
        self.assertEqual(log_result["exit_code"], 0)
        self.assertEqual(len(log_result["stdout"].splitlines()), 2)


if __name__ == "__main__":
    unittest.main()
