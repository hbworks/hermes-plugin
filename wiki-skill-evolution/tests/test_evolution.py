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

    def test_error_rule_classification_includes_hermes_workflows(self):
        """Should classify common Hermes skill, patch, and CLI failures."""
        cases = [
            (
                "description must start with 'Use when' and fit in the first 57 chars",
                "[Hermes/Skill]",
            ),
            (
                "Description is 90 chars — new skills must fit the 57-char system-prompt budget.",
                "[Hermes/Skill]",
            ),
            ("Description exceeds 1024 characters.", "[Hermes/Skill]"),
            ("patch tool failed: old_string not found in target", "[Hermes/Patch]"),
            ("Could not find match for old_string in SKILL.md", "[Hermes/Patch]"),
            ("Could not find a match for old_string in the file", "[Hermes/Patch]"),
            ("Found 2 matches for old_string. Provide more context to make it unique.", "[Hermes/Patch]"),
            ("old_string is empty — nothing to match.", "[Hermes/Patch]"),
            ("SKILL.md must start with YAML frontmatter; invalid frontmatter", "[Hermes/Skill]"),
            ("SKILL.md frontmatter is not closed.", "[Hermes/Skill]"),
            ("Frontmatter must include 'description' field.", "[Hermes/Skill]"),
            ("Frontmatter must be a YAML mapping.", "[Hermes/Skill]"),
            ("Content cannot be empty.", "[Hermes/Skill]"),
            ("command failed with exit code 1", "[Terminal/Exit]"),
            # Hermes ツールラッパの定型メッセージ
            ("File not found: /Users/masato/missing.md", "[IO/FileNotFound]"),
            ("Path not found: src/", "[IO/FileNotFound]"),
            (
                "Refusing to overwrite main.py: the file changed on disk since it was last read. "
                "The file was NOT modified. Reload the current contents with read_file.",
                "[Hermes/Write]",
            ),
            ("Failed to read file: binary content detected", "[Hermes/IO]"),
            ("File search failed while running ripgrep.", "[Hermes/Search]"),
            ("tool_call 'calls' is not valid JSON: Expecting value", "[Hermes/ToolCall]"),
            ("tool_call calls[0] requires a 'name'", "[Hermes/ToolCall]"),
            ("tool_call calls[1].arguments is not valid JSON: bad token", "[Hermes/ToolCall]"),
            (
                "execute_code sandbox is unavailable in this environment. Use normal tool calls instead.",
                "[Hermes/ExecuteCode]",
            ),
            ("execute_code refused: profile terminal policy unresolved", "[Hermes/ExecuteCode]"),
        ]

        for error_text, expected_prefix in cases:
            with self.subTest(error_text=error_text):
                lesson = self.plugin._extract_lesson_from_error(error_text)
                self.assertTrue(lesson.startswith(expected_prefix), lesson)

    def test_exit_code_rule_ignores_success_and_informational_exits(self):
        """Exit-code lessons must not fire for exit 0 or expected non-zero exits (e.g. git diff=1)."""
        not_errors = [
            "Process finished with exit code 0",
            "Build succeeded, see exit code docs",
            "git diff returned exit code 1 (files differ)",
            "grep: no matches found (exit code 1)",
            "diff: files differ (exit code 1)",
        ]
        for text in not_errors:
            with self.subTest(error_text=text):
                self.assertIsNone(self.plugin._extract_lesson_from_error(text))

    def test_exit_code_rule_still_classifies_real_failures(self):
        """Genuine non-zero failures must still produce the exit-code lesson."""
        real_failures = [
            "command failed with exit code 2",
            "Command failed with exit code 127: command not found",
            "exit code 1: fatal: not a git repository",
            "process exited with non-zero exit code 3",
        ]
        for text in real_failures:
            with self.subTest(error_text=text):
                lesson = self.plugin._extract_lesson_from_error(text)
                self.assertIsNotNone(lesson)
                self.assertTrue(lesson.startswith("[Terminal/Exit]"), lesson)

    def test_unknown_errors_do_not_become_skill_lessons(self):
        """Unknown raw errors should remain in logs, not become skill instructions."""
        lesson = self.plugin._extract_lesson_from_error("Opaque provider failure: secret detail")

        self.assertIsNone(lesson)

        skill_dir = self.hermes_home / "skills" / "safe_skill"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        original = "# Safe Skill\n\n## Workflow\n- Keep this workflow.\n"
        skill_file.write_text(original, encoding="utf-8")
        self.plugin.on_post_tool_call(tool_name="bash", args={"skill_name": "safe_skill"}, error="Opaque provider failure: secret detail")
        raw_records = self.plugin._read_error_log(hours=6)

        self.assertEqual(raw_records[0]["error"], "Opaque provider failure: secret detail")

        result = self.plugin.run_cycle(skill_name="safe_skill")

        self.assertEqual(result["status"], "skipped")
        self.assertEqual(skill_file.read_text(encoding="utf-8"), original)

    def test_propose_skill_patch_uses_existing_english_section(self):
        """Should add only recognized rules under a supported English heading."""
        skill_dir = self.hermes_home / "skills" / "english_skill"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_text(
            "# English Skill\n\n## Overview\nKeep overview.\n\n"
            "## Workflow\n- Existing workflow.\n\n## Reference\nKeep reference.\n",
            encoding="utf-8",
        )

        known_lesson = ERROR_RULES[0]["lesson"]
        patched = self.plugin._propose_skill_patch(
            skill_file,
            [known_lesson, "[General] 失敗: raw provider detail"],
        )

        self.assertIsNotNone(patched)
        self.assertIn("## Workflow\n- Existing workflow.\n" + ERROR_RULES[0]["patch"], patched)
        self.assertIn("## Reference\nKeep reference.", patched)
        self.assertNotIn("raw provider detail", patched)

    def test_propose_skill_patch_adds_fallback_section_after_frontmatter(self):
        """Should add a fallback section without inserting Markdown into YAML frontmatter."""
        skill_dir = self.hermes_home / "skills" / "frontmatter_skill"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        frontmatter = (
            "---\nname: frontmatter_skill\n"
            "description: Use when needed. Apply the skill.\n---\n"
        )
        skill_file.write_text(frontmatter + "\n# Frontmatter Skill\n", encoding="utf-8")

        patched = self.plugin._propose_skill_patch(skill_file, [ERROR_RULES[0]["lesson"]])

        self.assertIsNotNone(patched)
        self.assertTrue(patched.startswith(frontmatter))
        self.assertIn("\n## Pitfalls & Lessons\n" + ERROR_RULES[0]["patch"], patched)

    def test_propose_skill_patch_skips_unclosed_frontmatter(self):
        """Should refuse to patch a skill whose YAML frontmatter is not closed."""
        skill_dir = self.hermes_home / "skills" / "broken_skill"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_text("---\nname: broken_skill\n## Workflow\n- Body\n", encoding="utf-8")
        self.assertIsNone(self.plugin._propose_skill_patch(skill_file, [ERROR_RULES[0]["lesson"]]))

    def test_propose_skill_patch_preserves_crlf_in_existing_section(self):
        """Should retain CRLF line endings while adding to an existing section."""
        skill_dir = self.hermes_home / "skills" / "crlf_section_skill"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_bytes(b"# CRLF Section\r\n\r\n## Workflow\r\n- Existing workflow.\r\n")

        patched = self.plugin._propose_skill_patch(skill_file, [ERROR_RULES[0]["lesson"]])

        self.assertIsNotNone(patched)
        self.assertNotRegex(patched, r"(?<!\r)\n")
        self.assertIn("## Workflow\r\n- Existing workflow.\r\n" + ERROR_RULES[0]["patch"] + "\r\n", patched)
        self.assertNotIn("## Pitfalls & Lessons", patched)

    def test_propose_skill_patch_preserves_crlf(self):
        """Should preserve CRLF line endings in an edited section and fallback section."""
        skill_dir = self.hermes_home / "skills" / "crlf_skill"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        original = "# CRLF Skill\r\n\r\n## Workflow\r\n- Existing workflow.\r\n"
        skill_file.write_bytes(original.encode("utf-8"))

        patched = self.plugin._propose_skill_patch(skill_file, [ERROR_RULES[0]["lesson"]])

        self.assertIsNotNone(patched)
        self.assertNotRegex(patched, r"(?<!\r)\n")
        self.assertIn("## Workflow\r\n- Existing workflow.\r\n" + ERROR_RULES[0]["patch"] + "\r\n", patched)
        self.assertNotIn("## Pitfalls & Lessons", patched)

    def test_propose_skill_patch_creates_crlf_fallback_section(self):
        """Should create a CRLF fallback section when no supported heading exists."""
        skill_dir = self.hermes_home / "skills" / "crlf_fallback"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_bytes(b"# CRLF Fallback\r\n\r\n## Steps\r\n- Run it.\r\n")

        patched = self.plugin._propose_skill_patch(skill_file, [ERROR_RULES[0]["lesson"]])

        self.assertIsNotNone(patched)
        self.assertNotRegex(patched, r"(?<!\r)\n")
        self.assertIn("## Steps\r\n- Run it.\r\n", patched)
        self.assertIn("## Pitfalls & Lessons\r\n" + ERROR_RULES[0]["patch"], patched)

    def test_propose_skill_patch_preserves_existing_section_spacing(self):
        """Should append before trailing blank lines without adding extra section spacing."""
        skill_dir = self.hermes_home / "skills" / "spacing_skill"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_text(
            "# Spacing Skill\n\n## Workflow\n- Existing workflow.\n\n## Reference\n- Keep reference.\n",
            encoding="utf-8",
        )

        patched = self.plugin._propose_skill_patch(skill_file, [ERROR_RULES[0]["lesson"]])

        self.assertIn(
            "## Workflow\n- Existing workflow.\n" + ERROR_RULES[0]["patch"] + "\n\n## Reference",
            patched,
        )

    def test_gating_accepts_supported_english_and_fallback_sections(self):
        """Gating should accept the headings that skill patching supports."""
        skill_dir = self.hermes_home / "skills" / "gating_skill"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"

        for heading in ("## Workflow", "## Pitfalls & Lessons"):
            with self.subTest(heading=heading):
                skill_file.write_text(
                    f"---\nname: gating_skill\ndescription: Use when gating runs. Check it.\n---\n\n# Gating Skill\n\n{heading}\n- Content.\n",
                    encoding="utf-8",
                )
                self.assertTrue(self.plugin._run_gating(skill_file))

        skill_file.write_bytes(
            b"---\r\nname: gating_skill\r\ndescription: Use when gating runs. Check it.\r\n---\r\n\r\n# Gating Skill\r\n\r\n## Workflow\r\n- Content.\r\n"
        )
        self.assertTrue(self.plugin._run_gating(skill_file))

    def test_gating_rejects_skill_without_hermes_frontmatter(self):
        """Gating must use Hermes' acceptance rules: a body with no frontmatter is refused."""
        skill_dir = self.hermes_home / "skills" / "no_fm"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_text("# No FM\n\n## Workflow\n- Content.\n", encoding="utf-8")
        self.assertFalse(self.plugin._run_gating(skill_file))


    def test_post_tool_call_capture(self):
        """Should capture tool execution errors in recent_errors list up to 50 items."""
        # Successful call - should not record
        self.plugin.on_post_tool_call(tool_name="bash", args={}, result="success", error=None)
        self.assertEqual(len(self.plugin.recent_errors), 0)

        # Failure call - should record
        self.plugin.on_post_tool_call(tool_name="bash", args={"skill_name": "bash_skill"}, result=None, error="ImportError: missing mod")
        self.assertEqual(len(self.plugin.recent_errors), 1)
        self.assertEqual(self.plugin.recent_errors[0]["tool"], "bash")
        self.assertIn("ImportError", self.plugin.recent_errors[0]["error"])

        # Overflow limit check (50 entries)
        for i in range(60):
            self.plugin.on_post_tool_call(tool_name="bash", args={"skill_name": "bash_skill"}, error=f"Error {i}")
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
                    args={"case": tool_name, "skill_name": "hook_skill"},
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
        self.plugin.on_post_tool_call(tool_name="bash", args={"skill_name": "bash_skill"}, error="ImportError: missing mod")
        record = json.loads((self.hermes_home / "logs" / "evolution_errors.jsonl").read_text(encoding="utf-8"))
        self.assertIsNotNone(datetime.datetime.fromisoformat(record["ts"]).tzinfo)

    def test_pending_errors_are_bounded(self):
        import main

        original_persist = self.plugin._persist_error
        try:
            self.plugin._persist_error = lambda record: False
            for i in range(main.MAX_PENDING_ERRORS + 10):
                self.plugin.on_post_tool_call(tool_name="bash", args={"skill_name": "bash_skill"}, error=f"error-{i}")
            self.assertEqual(len(self.plugin._pending_errors), main.MAX_PENDING_ERRORS)
        finally:
            self.plugin._persist_error = original_persist

    def test_error_log_is_scoped_to_active_profile(self):
        """Records go to the profile Hermes assigned to the call, not to a guessed profile dir."""
        from hermes_constants import reset_hermes_home_override, set_hermes_home_override

        profile_dir = self.hermes_home / "profiles" / "coding"
        profile_dir.mkdir(parents=True, exist_ok=True)
        token = set_hermes_home_override(profile_dir)
        try:
            self.plugin.on_post_tool_call(tool_name="git_status", error="Permission denied")
        finally:
            reset_hermes_home_override(token)

        profile_log = profile_dir / "logs" / "evolution_errors.jsonl"
        global_log = self.hermes_home / "logs" / "evolution_errors.jsonl"
        self.assertTrue(profile_log.exists())
        self.assertFalse(global_log.exists())

    def test_two_profiles_in_one_process_stay_isolated(self):
        """Same process, switching A and B: B's error lands only in B, and A never sees it."""
        from hermes_constants import reset_hermes_home_override, set_hermes_home_override

        home_a = self.hermes_home / "profiles" / "a"
        home_b = self.hermes_home / "profiles" / "b"
        home_a.mkdir(parents=True)
        home_b.mkdir(parents=True)

        token = set_hermes_home_override(home_a)
        try:
            self.plugin.on_post_tool_call(tool_name="python_run", args={"command": "python skills/skill_a/run.py"},
                                          error="ModuleNotFoundError: No module named 'x'")
        finally:
            reset_hermes_home_override(token)

        token = set_hermes_home_override(home_b)
        try:
            self.plugin.on_post_tool_call(tool_name="python_run", args={"command": "python skills/skill_b/run.py"},
                                          error="ModuleNotFoundError: No module named 'y'")
            b_records = self.plugin._read_error_log(hours=6)
        finally:
            reset_hermes_home_override(token)

        self.assertEqual([r["skill"] for r in b_records], ["skill_b"])
        self.assertFalse((home_a / "logs" / "evolution_errors.jsonl").exists() and
                         "skill_b" in (home_a / "logs" / "evolution_errors.jsonl").read_text(encoding="utf-8"))
        self.assertTrue((home_b / "logs" / "evolution_errors.jsonl").exists())

        token = set_hermes_home_override(home_a)
        try:
            a_records = self.plugin._read_error_log(hours=6)
            a_memory = [r["skill"] for r in self.plugin.recent_errors]
        finally:
            reset_hermes_home_override(token)
        self.assertEqual([r["skill"] for r in a_records], ["skill_a"])
        # メモリ上のバッファもプロファイル単位。A で見えるのは A の記録だけ（B の skill_b は混ざらない）
        self.assertEqual(a_memory, ["skill_a"])

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
        # python_run is the same Python execution tool and must resolve the same way
        self.assertEqual(
            self.plugin._resolve_skill_name(
                "python_run",
                {"command": "python skills/existing_skill/run.py"},
            ),
            "existing_skill",
        )
        self.assertEqual(self.plugin._resolve_skill_name("unknown_tool"), "unknown")

    def test_error_log_rotates_at_size_limit(self):
        """Should rotate an oversized JSONL file before appending."""
        import main

        original_limit = main.ERROR_LOG_MAX_BYTES
        try:
            main.ERROR_LOG_MAX_BYTES = 100
            for i in range(3):
                self.plugin.on_post_tool_call(tool_name="bash", args={"skill_name": "bash_skill"}, error=f"error-{i}-" + ("x" * 60))
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
        self._record_skill_error("web_scraper", error="ImportError: No module named 'requests'")

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
        self._record_skill_error("new_skill")

        res = self.plugin.run_cycle(skill_name="new_skill", dry_run=True)

        self.assertEqual(res["status"], "dry_run")
        self.assertFalse((self.hermes_home / "skills" / "new_skill" / "SKILL.md").exists())

    def _record_skill_error(self, skill_name, error="ImportError: missing mod"):
        """Record a tool error attributed to skill_name via its command path."""
        self.plugin.on_post_tool_call(
            tool_name="python_run",
            args={"command": f"python skills/{skill_name}/run.py"},
            error=error,
        )

    def _create_skill_file(self, skill_name="existing_skill"):
        skill_dir = self.hermes_home / "skills" / skill_name
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_text(
            f"---\nname: {skill_name}\ndescription: Use when {skill_name} runs. Follow steps.\n---\n\n"
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
        self._record_skill_error("existing_skill")

        result = self.plugin.run_cycle(skill_name="existing_skill", commit=True)

        self.assertEqual(result["status"], "updated_uncommitted")
        self.assertTrue(result["patch_applied"])
        self.assertTrue(result["gating_passed"])
        self.assertFalse(result["committed"])
        self.assertEqual(result["commit_error"], "skill directory is not a git repository")
        self.assertIn(ERROR_RULES[0]["patch"], skill_file.read_text(encoding="utf-8"))

    def test_run_cycle_commit_failure_is_reported(self):
        skill_dir, _ = self._create_skill_file("dedicated_skill")
        self._initialize_git_repository(skill_dir)
        self._record_skill_error("dedicated_skill")

        original_run = self.plugin._run_terminal_command

        def fail_commit(cmd, cwd=None):
            args = shlex.split(cmd) if isinstance(cmd, str) else list(cmd)
            if args[:2] == ["git", "commit"]:
                return {"exit_code": 1, "stdout": "", "stderr": "simulated commit failure"}
            return original_run(cmd, cwd=cwd)

        self.plugin._run_terminal_command = fail_commit
        result = self.plugin.run_cycle(skill_name="dedicated_skill", commit=True)

        self.assertEqual(result["status"], "commit_failed")
        self.assertTrue(result["patch_applied"])
        self.assertTrue(result["gating_passed"])
        self.assertFalse(result["committed"])
        self.assertIn("simulated commit failure", result["commit_error"])

    def test_run_cycle_gating_failure_does_not_checkout_user_changes(self):
        _, skill_file = self._create_skill_file("gating_skill")
        original_content = skill_file.read_text(encoding="utf-8")
        self._record_skill_error("gating_skill")

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
        self._record_skill_error("new_skill")
        git_identity = {
            "GIT_AUTHOR_NAME": "WikiSkill Tests",
            "GIT_AUTHOR_EMAIL": "wikiskill-tests@example.com",
            "GIT_COMMITTER_NAME": "WikiSkill Tests",
            "GIT_COMMITTER_EMAIL": "wikiskill-tests@example.com",
        }
        previous_identity = {key: os.environ.get(key) for key in git_identity}
        os.environ.update(git_identity)
        try:
            result = self.plugin.run_cycle(skill_name="new_skill", commit=True)
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
        # 新規スキルは検証済みの内容を一度だけ書き込み、その 1 回だけコミットする
        self.assertEqual(len(log_result["stdout"].splitlines()), 1)

    def test_skill_name_path_traversal_is_rejected(self):
        """An LLM-supplied skill_name must not escape the skills directory."""
        self._record_skill_error("safe_skill")
        outside_abs = Path(self.tmpdir) / "outside_abs_skill"
        bad_names = (
            "../escaped_skill",
            "a/../../escaped_skill",
            "..",
            str(outside_abs),
        )
        targets = (
            self.hermes_home / "escaped_skill" / "SKILL.md",
            self.hermes_home / "SKILL.md",
            outside_abs / "SKILL.md",
        )

        for bad_name in bad_names:
            with self.subTest(skill_name=bad_name):
                result = json.loads(self.plugin.handle_tool_call(
                    "run_wiki_skill_evolution", {"skill_name": bad_name}
                ))
                self.assertEqual(result["status"], "invalid_skill_name")

        for target in targets:
            with self.subTest(target=str(target)):
                self.assertFalse(target.exists())

    def test_skill_name_must_be_a_plain_identifier(self):
        """Names with separators or dot-only segments are rejected before any IO."""
        import main
        self.assertIsNone(self.plugin._get_skill_file("../x"))
        with self.assertRaises(ValueError):
            main._validated_skill_name("nested/name")
        self.assertEqual(main._validated_skill_name("web_scraper-v2.1"), "web_scraper-v2.1")

    def test_lessons_only_come_from_errors_of_the_target_skill(self):
        """An unrelated tool's error must not change the target skill's update."""
        skill_dir, skill_file = self._create_skill_file("target_skill")
        original = skill_file.read_text(encoding="utf-8")
        self.plugin.on_post_tool_call(
            tool_name="git_status", args={"command": "git status"}, error="Permission denied: x"
        )
        self._record_skill_error("target_skill", error="ImportError: missing mod")

        result = self.plugin.run_cycle(skill_name="target_skill", dry_run=True)

        self.assertEqual(result["lessons_extracted"], [ERROR_RULES[0]["lesson"]])
        self.assertEqual(skill_file.read_text(encoding="utf-8"), original)

    def test_propose_skill_patch_detects_crlf_section_heading(self):
        """A CRLF '## Workflow' heading must be matched as an existing section."""
        skill_dir = self.hermes_home / "skills" / "crlf_heading"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_bytes(b"# T\r\n\r\n## Workflow\r\n- Existing.\r\n\r\n## Reference\r\n- Keep.\r\n")

        patched = self.plugin._propose_skill_patch(skill_file, [ERROR_RULES[0]["lesson"]])

        self.assertIn("## Workflow\r\n- Existing.\r\n" + ERROR_RULES[0]["patch"], patched)
        self.assertNotIn("## Pitfalls & Lessons", patched)

    def test_gating_failure_restores_crlf_bytes_exactly(self):
        """Rollback after a gating failure must restore the original bytes, including CRLF."""
        skill_dir = self.hermes_home / "skills" / "crlf_rollback"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        original = b"# T\r\n\r\n## Workflow\r\n- Existing.\r\n"
        skill_file.write_bytes(original)
        self._record_skill_error("crlf_rollback")

        with patch.object(WikiSkillEvolutionPlugin, "_run_gating", return_value=False):
            result = self.plugin.run_cycle(skill_name="crlf_rollback")

        self.assertEqual(result["status"], "rollback")
        self.assertEqual(skill_file.read_bytes(), original)

    def test_outline_fallback_section_passes_gating(self):
        """A skill without a supported heading gets a Pitfalls section that gating accepts."""
        skill_dir = self.hermes_home / "skills" / "outline_skill"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_text(
            "---\nname: outline_skill\ndescription: Use when x. y.\n---\n\n# O\n\n## Steps\n- s1\n",
            encoding="utf-8",
        )
        self._record_skill_error("outline_skill")

        result = self.plugin.run_cycle(skill_name="outline_skill")

        self.assertEqual(result["status"], "updated_uncommitted")
        self.assertTrue(result["gating_passed"])
        self.assertIn("## Pitfalls & Lessons", skill_file.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
