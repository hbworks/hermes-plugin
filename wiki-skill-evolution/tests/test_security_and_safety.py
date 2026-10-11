"""Security and safety tests: secret handling, log permissions, generated-skill validity,
symlink containment, and terminal exit-code classification against real Hermes payloads.
"""
import json
import os
import shutil
import stat
import sys
import tempfile
import unittest
from pathlib import Path

plugin_dir = Path(__file__).resolve().parent.parent
if str(plugin_dir) not in sys.path:
    sys.path.insert(0, str(plugin_dir))

import main  # noqa: E402
from main import ERROR_RULES, WikiSkillEvolutionPlugin  # noqa: E402

# Hermes 本体が近くにあれば、その検査（tools.skill_manager_tool）を実際に使えるよう sys.path に足す。
# 無ければ main 側のローカル検査にフォールバックする。
_HERMES_AGENT = Path(os.environ.get("HERMES_AGENT_DIR", Path.home() / ".hermes" / "hermes-agent"))
if (_HERMES_AGENT / "tools" / "skill_manager_tool.py").exists() and str(_HERMES_AGENT) not in sys.path:
    sys.path.insert(0, str(_HERMES_AGENT))

# 合成した秘密値（実在の資格情報ではない）
SYNTH_TOKEN = "sk-TESTSYNTHETIC1234567890abcdef"
SYNTH_PASSWORD = "hunter2-synthetic-pass"
SYNTH_BEARER = "Bearer SYNTHBEARERTOKEN987654"

TERMINAL_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "hermes_terminal_exit_payloads.json"


class _HomeMixin:
    def make_home(self):
        self.tmpdir = tempfile.mkdtemp()
        self.hermes_home = Path(self.tmpdir) / ".hermes"
        self.hermes_home.mkdir(parents=True, exist_ok=True)
        self._saved_home = os.environ.get("HERMES_HOME")
        os.environ["HERMES_HOME"] = str(self.hermes_home)
        self.plugin = WikiSkillEvolutionPlugin()

    def drop_home(self):
        if self._saved_home is None:
            os.environ.pop("HERMES_HOME", None)
        else:
            os.environ["HERMES_HOME"] = self._saved_home
        shutil.rmtree(self.tmpdir, ignore_errors=True)


class TestSecretHandling(_HomeMixin, unittest.TestCase):
    def setUp(self):
        self.make_home()

    def tearDown(self):
        self.drop_home()

    def test_raw_arguments_are_never_persisted(self):
        """Tool args can carry credentials; the JSONL must never contain them."""
        self.plugin.on_post_tool_call(
            tool_name="python_run",
            args={"command": f"python skills/web/run.py --token {SYNTH_TOKEN}", "api_key": SYNTH_TOKEN},
            error="ModuleNotFoundError: No module named 'requests'",
        )
        raw = (self.hermes_home / "logs" / "evolution_errors.jsonl").read_text(encoding="utf-8")
        self.assertNotIn(SYNTH_TOKEN, raw)
        self.assertNotIn('"args"', raw)

    def test_secrets_in_error_text_are_masked_before_storage(self):
        """Error bodies can echo secrets; they must be masked in memory and on disk."""
        self.plugin.on_post_tool_call(
            tool_name="python_run",
            args={"command": "python skills/web/run.py"},
            error=(
                f"ModuleNotFoundError: No module named 'x' (password={SYNTH_PASSWORD}) "
                f"Authorization: {SYNTH_BEARER} https://user:{SYNTH_PASSWORD}@example.com/x"
            ),
        )
        for text in (
            json.dumps(self.plugin.recent_errors, ensure_ascii=False),
            (self.hermes_home / "logs" / "evolution_errors.jsonl").read_text(encoding="utf-8"),
        ):
            with self.subTest(store="memory" if text.startswith("[") else "disk"):
                self.assertNotIn(SYNTH_PASSWORD, text)
                self.assertNotIn(SYNTH_BEARER.split(" ", 1)[1], text)
        # 秘密を除いた本文は残り、教訓の分類は失われない
        lesson = self.plugin._extract_lesson_from_error(self.plugin.recent_errors[-1]["error"])
        self.assertTrue(lesson.startswith("[Python/Path]"), lesson)

    def test_legacy_log_lines_with_raw_args_are_dropped_on_read(self):
        """Old records that still contain raw args or secrets are sanitized when read back."""
        log_path = self.hermes_home / "logs" / "evolution_errors.jsonl"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        import datetime
        record = {
            "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "tool": "python_run",
            "error": f"ModuleNotFoundError: No module named 'x' token={SYNTH_TOKEN}",
            "args": {"command": f"python skills/legacy/run.py --key {SYNTH_TOKEN}"},
        }
        log_path.write_text(json.dumps(record) + "\n", encoding="utf-8")

        records = self.plugin._read_error_log(hours=6)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["skill"], "legacy")
        self.assertNotIn("args", records[0])
        self.assertNotIn(SYNTH_TOKEN, json.dumps(records, ensure_ascii=False))

    def test_error_log_is_owner_only(self):
        """The JSONL and its lock file must be 0600 (and their directory 0700)."""
        self.plugin.on_post_tool_call(tool_name="bash", error="ImportError: missing mod")
        log_path = self.hermes_home / "logs" / "evolution_errors.jsonl"
        self.assertEqual(stat.S_IMODE(log_path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(log_path.with_suffix(".jsonl.lock").stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(log_path.parent.stat().st_mode), 0o700)

    def test_existing_world_readable_log_is_tightened(self):
        """A pre-existing 0644 log is brought down to 0600 on the next append."""
        log_path = self.hermes_home / "logs" / "evolution_errors.jsonl"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("", encoding="utf-8")
        os.chmod(log_path, 0o644)
        self.plugin.on_post_tool_call(tool_name="bash", error="ImportError: missing mod")
        self.assertEqual(stat.S_IMODE(log_path.stat().st_mode), 0o600)


class TestGeneratedSkillValidity(_HomeMixin, unittest.TestCase):
    def setUp(self):
        self.make_home()

    def tearDown(self):
        self.drop_home()

    def _record(self, skill, error="ModuleNotFoundError: No module named 'requests'"):
        self.plugin.on_post_tool_call(
            tool_name="python_run", args={"command": f"python skills/{skill}/run.py"}, error=error
        )

    def test_new_skill_has_valid_frontmatter_and_passes_hermes_check(self):
        """A generated skill must start with name/description frontmatter and pass Hermes' validator."""
        from tools.skill_manager_tool import _validate_frontmatter

        self._record("fresh_skill")
        result = self.plugin.run_cycle(skill_name="fresh_skill")

        skill_file = self.hermes_home / "skills" / "fresh_skill" / "SKILL.md"
        content = skill_file.read_text(encoding="utf-8")
        self.assertEqual(result["status"], "created_uncommitted")
        self.assertTrue(content.startswith("---\n"))
        self.assertIsNone(_validate_frontmatter(content, new_skill=True))
        self.assertIn(main.ERROR_RULES[0]["patch"], content)

    def test_new_skill_description_fits_hermes_budget(self):
        """The description must fit the 60-char new-skill budget Hermes enforces."""
        self.assertLessEqual(len(main.NEW_SKILL_DESCRIPTION), 57)
        self.assertTrue(main.NEW_SKILL_DESCRIPTION.startswith("Use when "))

    def test_invalid_generated_skill_is_not_written(self):
        """If the candidate fails validation, nothing is written and no directory is left behind."""
        self._record("bad_candidate")
        original = main._new_skill_template
        try:
            main._new_skill_template = lambda name: "# no frontmatter here\n"
            result = self.plugin.run_cycle(skill_name="bad_candidate")
        finally:
            main._new_skill_template = original

        self.assertEqual(result["status"], "validation_failed")
        self.assertFalse((self.hermes_home / "skills" / "bad_candidate").exists())

    def test_new_skill_name_must_satisfy_hermes_name_rule(self):
        """Hermes only creates lowercase names; an uppercase LLM-supplied name is refused."""
        self._record("MixedCase")
        result = self.plugin.run_cycle(skill_name="MixedCase")
        self.assertEqual(result["status"], "invalid_skill_name")
        self.assertFalse((self.hermes_home / "skills" / "MixedCase").exists())

    def test_failed_gating_removes_the_new_skill_directory(self):
        """A rejected new skill leaves neither SKILL.md nor an empty directory."""
        self._record("gated_out")
        original = WikiSkillEvolutionPlugin._run_gating
        try:
            WikiSkillEvolutionPlugin._run_gating = lambda self, path: False
            result = self.plugin.run_cycle(skill_name="gated_out")
        finally:
            WikiSkillEvolutionPlugin._run_gating = original
        self.assertEqual(result["status"], "rollback")
        self.assertFalse((self.hermes_home / "skills" / "gated_out").exists())


class TestSymlinkContainment(_HomeMixin, unittest.TestCase):
    def setUp(self):
        self.make_home()
        self.outside = Path(self.tmpdir) / "outside"
        self.outside.mkdir()
        self.victim = self.outside / "SKILL.md"
        self.victim_text = (
            "---\nname: victim\ndescription: Use when victim runs. Keep it.\n---\n\n"
            "# Victim\n\n## Workflow\n- Keep.\n"
        )
        self.victim.write_text(self.victim_text, encoding="utf-8")
        (self.hermes_home / "skills").mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        self.drop_home()

    def _record(self, skill):
        self.plugin.on_post_tool_call(
            tool_name="python_run",
            args={"command": f"python skills/{skill}/run.py"},
            error="ModuleNotFoundError: No module named 'requests'",
        )

    def test_symlinked_skill_md_is_not_written_through(self):
        skill_dir = self.hermes_home / "skills" / "linked_file"
        skill_dir.mkdir()
        os.symlink(self.victim, skill_dir / "SKILL.md")
        self._record("linked_file")

        result = self.plugin.run_cycle(skill_name="linked_file")

        self.assertEqual(result["status"], "unsafe_skill_path")
        self.assertEqual(self.victim.read_text(encoding="utf-8"), self.victim_text)

    def test_symlinked_skill_directory_is_not_written_through(self):
        target_dir = self.outside / "elsewhere"
        target_dir.mkdir()
        (target_dir / "SKILL.md").write_text(self.victim_text, encoding="utf-8")
        os.symlink(target_dir, self.hermes_home / "skills" / "linked_dir")
        self._record("linked_dir")

        result = self.plugin.run_cycle(skill_name="linked_dir")

        self.assertEqual(result["status"], "unsafe_skill_path")
        self.assertEqual((target_dir / "SKILL.md").read_text(encoding="utf-8"), self.victim_text)

    def test_symlinked_skills_root_is_refused(self):
        real_root = self.outside / "skills_root"
        (real_root / "root_target").mkdir(parents=True)
        (real_root / "root_target" / "SKILL.md").write_text(self.victim_text, encoding="utf-8")
        shutil.rmtree(self.hermes_home / "skills")
        os.symlink(real_root, self.hermes_home / "skills")
        self._record("root_target")

        result = self.plugin.run_cycle(skill_name="root_target")

        self.assertEqual(result["status"], "unsafe_skill_path")
        self.assertEqual((real_root / "root_target" / "SKILL.md").read_text(encoding="utf-8"), self.victim_text)

    def test_new_skill_creation_refuses_symlinked_directory(self):
        """A dangling/redirected skill directory must not let a new SKILL.md land outside."""
        target = self.outside / "newdir_target"
        target.mkdir()
        os.symlink(target, self.hermes_home / "skills" / "newdir")
        self._record("newdir")

        result = self.plugin.run_cycle(skill_name="newdir")

        self.assertEqual(result["status"], "unsafe_skill_path")
        self.assertFalse((target / "SKILL.md").exists())

    def test_symlink_check_alone_refuses_a_symlink_into_the_skills_root(self):
        """The symlink check must stand on its own: a link even to an in-root target is refused."""
        skills_root = self.hermes_home / "skills"
        real = skills_root / "real_target"
        real.mkdir(parents=True)
        link = skills_root / "inside_link"
        os.symlink(real, link)

        with self.assertRaises(main.UnsafeSkillPathError):
            main._refuse_unsafe_candidate(link, skills_root, check_symlink=True, check_containment=False)
        # With the symlink check off, containment alone accepts this in-root target.
        main._refuse_unsafe_candidate(link, skills_root, check_symlink=False, check_containment=True)

    def test_skill_locations_refuses_symlink_at_every_level(self):
        """_skill_locations (the real entry point) must refuse a symlink at SKILL.md, the dir, or the flat file."""
        skills_root = self.hermes_home / "skills"
        skills_root.mkdir(parents=True, exist_ok=True)

        os.symlink(self.victim, skills_root / "lvl_file")
        (skills_root / "lvl_file_dir").mkdir()
        os.symlink(self.victim, skills_root / "lvl_file_dir" / "SKILL.md")
        os.symlink(self.outside, skills_root / "lvl_dir")
        os.symlink(self.victim, skills_root / "lvl_flat.md")

        for name in ("lvl_file_dir", "lvl_dir", "lvl_flat", "lvl_file"):
            with self.subTest(skill=name):
                with self.assertRaises(main.UnsafeSkillPathError):
                    self.plugin._skill_locations(name)

    def test_containment_check_alone_refuses_a_link_that_leaves_the_root(self):
        """The containment check must stand on its own: an outside target is refused without the symlink check."""
        skills_root = self.hermes_home / "skills"
        skills_root.mkdir(parents=True, exist_ok=True)
        link = skills_root / "outside_link"
        os.symlink(self.victim, link)

        with self.assertRaises(main.UnsafeSkillPathError):
            main._refuse_unsafe_candidate(link, skills_root, check_symlink=False, check_containment=True)
        # Only the symlink check off AND containment off would let it through (sanity, not production).
        main._refuse_unsafe_candidate(link, skills_root, check_symlink=False, check_containment=False)


class TestTerminalExitClassification(_HomeMixin, unittest.TestCase):
    """Classify failures from the payload shape Hermes actually emits (error_message='終了コード N')."""

    def setUp(self):
        self.make_home()
        self.cases = json.loads(TERMINAL_FIXTURE.read_text(encoding="utf-8"))

    def tearDown(self):
        self.drop_home()

    def test_real_failure_payloads_are_recorded_and_classified(self):
        for name, case in self.cases.items():
            if name.startswith("_") or not case["expect_record"]:
                continue
            with self.subTest(case=name):
                before = len(self.plugin.recent_errors)
                self.plugin.on_post_tool_call(
                    tool_name=case["tool_name"], args=case["args"], result=case["result"],
                    status=case["status"], error_type=case["error_type"], error_message=case["error_message"],
                )
                new = self.plugin.recent_errors[before:]
                self.assertEqual(len(new), 1, f"{name}: expected one recorded failure")
                lesson = self.plugin._extract_lesson_from_error(new[0]["error"])
                self.assertEqual(lesson is not None, case["expect_lesson"], f"{name}: lesson={lesson}")
                if lesson is not None:
                    self.assertTrue(lesson.startswith("[Terminal/Exit]"), lesson)

    def test_informational_nonzero_exits_are_not_recorded(self):
        for name, case in self.cases.items():
            if name.startswith("_") or case["expect_record"]:
                continue
            with self.subTest(case=name):
                before = len(self.plugin.recent_errors)
                self.plugin.on_post_tool_call(
                    tool_name=case["tool_name"], args=case["args"], result=case["result"],
                    status=case["status"], error_type=case["error_type"], error_message=case["error_message"],
                )
                self.assertEqual(self.plugin.recent_errors[before:], [], f"{name}: must not be recorded")

    def test_exit_zero_is_never_a_lesson(self):
        for text in ("終了コード 0", "exit 0", "exit code 0", "Process finished with exit code 0"):
            with self.subTest(text=text):
                self.assertIsNone(self.plugin._extract_lesson_from_error(text))

    def test_hermes_observer_output_is_the_fixture_source(self):
        """Guard: the fixture's error text must match what Hermes' observer emits for exit 1."""
        self.assertEqual(self.cases["terminal_exit1_real_failure"]["error_message"], "終了コード 1")

    def test_exit_rule_is_exercised_by_real_error_rules(self):
        self.assertTrue(any(rule.get("exit_code_rule") for rule in ERROR_RULES))

    def test_exit_number_is_judged_not_keyword_presence(self):
        """'exit code 0' is success even with the word 'exit'; non-zero numbers in either locale count."""
        self.assertIsNone(self.plugin._extract_lesson_from_error("終了コード 0"))
        self.assertIsNone(self.plugin._extract_lesson_from_error("exit code 0"))
        self.assertIsNotNone(self.plugin._extract_lesson_from_error("終了コード 1"))
        self.assertIsNotNone(self.plugin._extract_lesson_from_error("command failed with exit code 127"))


class TestCommitPolicy(_HomeMixin, unittest.TestCase):
    def setUp(self):
        self.make_home()

    def tearDown(self):
        self.drop_home()

    def test_existing_dedicated_repository_is_committed_when_requested(self):
        """With commit=true, an existing skill that is its own repository root gets one new commit."""
        skill_dir = self.hermes_home / "skills" / "dedicated"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            "---\nname: dedicated\ndescription: Use when dedicated runs. Keep.\n---\n\n# D\n\n## Workflow\n- keep\n",
            encoding="utf-8",
        )
        self.plugin._run_terminal_command(["git", "init"], cwd=skill_dir)
        self.plugin._run_terminal_command(["git", "config", "user.name", "t"], cwd=skill_dir)
        self.plugin._run_terminal_command(["git", "config", "user.email", "t@example.com"], cwd=skill_dir)
        self.plugin._run_terminal_command(["git", "add", "SKILL.md"], cwd=skill_dir)
        self.plugin._run_terminal_command(["git", "commit", "-m", "seed"], cwd=skill_dir)
        self.plugin.on_post_tool_call(
            tool_name="python_run", args={"command": "python skills/dedicated/run.py"},
            error="ModuleNotFoundError: No module named 'x'",
        )

        result = self.plugin.run_cycle(skill_name="dedicated", commit=True)

        log = self.plugin._run_terminal_command(["git", "log", "--format=%s"], cwd=skill_dir)["stdout"].splitlines()
        self.assertEqual(result["status"], "success")
        self.assertTrue(result["committed"])
        self.assertEqual(len(log), 2)
        self.assertEqual(log[-1], "seed")

    def test_default_run_never_commits(self):
        """Without commit=true, a successful update is written but no commit is created."""
        skill_dir = self.hermes_home / "skills" / "dedicated2"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            "---\nname: dedicated2\ndescription: Use when dedicated2 runs. Keep.\n---\n\n# D\n\n## Workflow\n- keep\n",
            encoding="utf-8",
        )
        self.plugin._run_terminal_command(["git", "init"], cwd=skill_dir)
        self.plugin._run_terminal_command(["git", "config", "user.name", "t"], cwd=skill_dir)
        self.plugin._run_terminal_command(["git", "config", "user.email", "t@example.com"], cwd=skill_dir)
        self.plugin._run_terminal_command(["git", "add", "SKILL.md"], cwd=skill_dir)
        self.plugin._run_terminal_command(["git", "commit", "-m", "seed"], cwd=skill_dir)
        self.plugin.on_post_tool_call(
            tool_name="python_run", args={"command": "python skills/dedicated2/run.py"},
            error="ModuleNotFoundError: No module named 'x'",
        )

        result = self.plugin.run_cycle(skill_name="dedicated2")

        log = self.plugin._run_terminal_command(["git", "log", "--format=%s"], cwd=skill_dir)["stdout"].splitlines()
        self.assertEqual(result["status"], "updated_uncommitted")
        self.assertFalse(result["committed"])
        self.assertEqual(log, ["seed"])
        self.assertIn(main.ERROR_RULES[0]["patch"], (skill_dir / "SKILL.md").read_text(encoding="utf-8"))

    def test_tool_call_without_commit_argument_does_not_commit(self):
        """The tool entry point must default to no commit, the same as run_cycle."""
        skill_dir = self.hermes_home / "skills" / "tooldefault"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            "---\nname: tooldefault\ndescription: Use when tooldefault runs. Keep.\n---\n\n# D\n\n## Workflow\n- keep\n",
            encoding="utf-8",
        )
        self.plugin._run_terminal_command(["git", "init"], cwd=skill_dir)
        self.plugin._run_terminal_command(["git", "config", "user.name", "t"], cwd=skill_dir)
        self.plugin._run_terminal_command(["git", "config", "user.email", "t@example.com"], cwd=skill_dir)
        self.plugin._run_terminal_command(["git", "add", "SKILL.md"], cwd=skill_dir)
        self.plugin._run_terminal_command(["git", "commit", "-m", "seed"], cwd=skill_dir)
        self.plugin.on_post_tool_call(
            tool_name="python_run", args={"command": "python skills/tooldefault/run.py"},
            error="ModuleNotFoundError: No module named 'x'",
        )

        result = json.loads(self.plugin.handle_tool_call(
            "run_wiki_skill_evolution", {"skill_name": "tooldefault"}
        ))

        log = self.plugin._run_terminal_command(["git", "log", "--format=%s"], cwd=skill_dir)["stdout"].splitlines()
        self.assertFalse(result["committed"])
        self.assertEqual(log, ["seed"])


if __name__ == "__main__":
    unittest.main()
