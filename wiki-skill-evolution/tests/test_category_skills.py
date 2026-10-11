"""Hermes stores most skills under a category directory (skills/<category>/<name>/SKILL.md).

These tests pin the lookup rules to Hermes' own: a skill is found by its directory name anywhere
under skills/, an ambiguous name is refused, excluded directories are skipped, and a new skill is
never created on top of an existing category directory.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

plugin_dir = Path(__file__).resolve().parent.parent
if str(plugin_dir) not in sys.path:
    sys.path.insert(0, str(plugin_dir))

import main  # noqa: E402
from main import WikiSkillEvolutionPlugin  # noqa: E402


def _skill_md(name, body="## Workflow\n- Keep.\n"):
    return f"---\nname: {name}\ndescription: Use when {name} runs. Follow steps.\n---\n\n# {name}\n\n{body}"


class TestCategorySkillLookup(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.hermes_home = Path(self.tmpdir) / ".hermes"
        (self.hermes_home / "skills").mkdir(parents=True)
        self._saved = os.environ.get("HERMES_HOME")
        os.environ["HERMES_HOME"] = str(self.hermes_home)
        self.plugin = WikiSkillEvolutionPlugin()
        self.skills = self.hermes_home / "skills"

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("HERMES_HOME", None)
        else:
            os.environ["HERMES_HOME"] = self._saved
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _put(self, rel_dir, name, body="## Workflow\n- Keep.\n"):
        d = self.skills / rel_dir
        d.mkdir(parents=True, exist_ok=True)
        (d / "SKILL.md").write_text(_skill_md(name, body), encoding="utf-8")
        return d / "SKILL.md"

    def _record(self, skill):
        self.plugin.on_post_tool_call(
            tool_name="python_run",
            args={"command": f"python skills/{skill}/run.py"},
            error="ModuleNotFoundError: No module named 'requests'",
        )

    def test_finds_skill_inside_a_category_directory(self):
        """A bare directory name must resolve to a skill nested under a category."""
        target = self._put("software-development/systematic-debugging", "systematic-debugging")
        found = self.plugin._find_existing_skill("systematic-debugging")
        self.assertEqual(found, target)

    def test_categorized_relative_name_resolves(self):
        """The categorized form 'category/name' (as Hermes skill_view accepts) also resolves."""
        target = self._put("software-development/systematic-debugging", "systematic-debugging")
        self.assertEqual(self.plugin._find_existing_skill("software-development/systematic-debugging"), target)

    def test_ambiguous_directory_name_is_refused(self):
        """Two skills with the same directory name in different categories must not be guessed."""
        self._put("alpha-cat/dup", "dup")
        self._put("beta-cat/dup", "dup")
        with self.assertRaises(main.AmbiguousSkillError):
            self.plugin._find_existing_skill("dup")

    def test_excluded_directories_are_skipped(self):
        """A SKILL.md under .git / node_modules etc. is not a skill."""
        self._put(".git/hidden", "hidden")
        self._put("node_modules/pkg", "pkg")
        self.assertIsNone(self.plugin._find_existing_skill("hidden"))
        self.assertIsNone(self.plugin._find_existing_skill("pkg"))

    def test_missing_skill_returns_none(self):
        self.assertIsNone(self.plugin._find_existing_skill("nope"))

    def test_unknown_skill_is_never_created(self):
        """A failure whose skill cannot be inferred is recorded as 'unknown', and no skill is created for it."""
        self.plugin.on_post_tool_call(
            tool_name="terminal", args={"command": "ls /missing"}, error="終了コード 2",
        )

        self.assertEqual([r["skill"] for r in self.plugin.recent_errors], [main.UNKNOWN_SKILL_NAME])
        result = self.plugin.run_cycle(skill_name=main.UNKNOWN_SKILL_NAME)

        self.assertEqual(result["status"], "fallback_skill_refused")
        self.assertFalse((self.skills / main.UNKNOWN_SKILL_NAME).exists())
        self.assertFalse((self.skills / "default_skill").exists())

    def test_legacy_default_skill_name_is_never_created_either(self):
        """Old records carry 'default_skill'; an explicit request for it must not create a skill."""
        self.plugin.on_post_tool_call(
            tool_name="python_run", args={"skill_name": "default_skill"},
            error="ModuleNotFoundError: No module named 'x'",
        )
        result = self.plugin.run_cycle(skill_name="default_skill")

        self.assertEqual(result["status"], "fallback_skill_refused")
        self.assertFalse((self.skills / "default_skill").exists())

    def test_terminal_failure_without_an_inferable_skill_is_recorded_as_unknown(self):
        """The record is kept (so it can be inspected later), labelled 'unknown' rather than guessed."""
        self.plugin.on_post_tool_call(
            tool_name="terminal", args={"command": "ls /missing"}, error="終了コード 2",
        )
        log = self.hermes_home / "logs" / "evolution_errors.jsonl"
        recs = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines() if l.strip()]
        self.assertEqual([r["skill"] for r in recs], [main.UNKNOWN_SKILL_NAME])

    def test_other_tools_failures_are_recorded_with_the_unknown_label(self):
        """A failure from another tool with no inferable skill is recorded as 'unknown' too."""
        self.plugin.on_post_tool_call(
            tool_name="bash", args={"command": "ls /nope"}, error="No such file or directory",
        )
        self.assertEqual(len(self.plugin.recent_errors), 1)
        self.assertEqual(self.plugin.recent_errors[0]["skill"], main.UNKNOWN_SKILL_NAME)

    def test_failure_with_a_skill_path_is_still_recorded(self):
        """The same terminal failure is recorded once the command names a skill directory."""
        self.plugin.on_post_tool_call(
            tool_name="terminal", args={"command": "python skills/x/run.py"}, error="終了コード 2",
        )
        self.assertEqual(len(self.plugin.recent_errors), 1)
        self.assertEqual(self.plugin.recent_errors[0]["skill"], "x")

    def test_categorized_skill_path_resolves_to_the_skill_not_the_category(self):
        """skills/<category>/<name>/... must resolve to <name>, not to the category directory."""
        self.assertEqual(
            self.plugin._resolve_skill_name("terminal", {"command": "python skills/software-development/x/run.py"}, "終了コード 2"),
            "x",
        )

    def test_support_directories_are_not_skill_names(self):
        """skills/<name>/scripts/... belongs to <name>; 'scripts' itself is never a skill."""
        for command, expected in (
            ("python ~/.hermes/skills/web_scraper/scripts/fetch.py", "web_scraper"),
            ("python skills/web_scraper/references/notes.py", "web_scraper"),
            ("python skills/cat/web_scraper/scripts/fetch.py", "web_scraper"),
            ("python skills/web_scraper/fetch.py", "web_scraper"),
        ):
            with self.subTest(command=command):
                self.assertEqual(
                    self.plugin._resolve_skill_name("python_run", {"command": command}, ""),
                    expected,
                )

    def test_a_path_that_only_reaches_a_support_directory_names_no_skill(self):
        """With no skill segment (skills/scripts/x.py alone), nothing is inferred and nothing is recorded."""
        self.assertIsNone(self.plugin._inferred_skill_name("python_run", {"command": "python skills/scripts/x.py"}, ""))

    def test_explicit_default_skill_name_in_args_is_still_recorded(self):
        """An explicit skill_name, even 'default_skill', is an inference the caller made and is kept."""
        self.plugin.on_post_tool_call(
            tool_name="python_run", args={"skill_name": "default_skill"},
            error="ModuleNotFoundError: No module named 'x'",
        )
        self.assertEqual([r["skill"] for r in self.plugin.recent_errors], ["default_skill"])

    def test_run_cycle_updates_the_categorized_skill_in_place(self):
        """A lesson for a category-nested skill is applied to that file, not to a new top-level skill."""
        target = self._put("software-development/systematic-debugging", "systematic-debugging")
        self._record("systematic-debugging")

        result = self.plugin.run_cycle(skill_name="systematic-debugging")

        self.assertIn(result["status"], {"updated_uncommitted", "success"})
        self.assertIn(main.ERROR_RULES[0]["patch"], target.read_text(encoding="utf-8"))
        self.assertFalse((self.skills / "systematic-debugging").exists())

    def test_new_skill_is_not_created_over_an_existing_category_directory(self):
        """If skills/<name> is an existing category directory, a same-named top-level skill is refused."""
        self._put("github/github-auth", "github-auth")  # 'github' is a category, not a skill
        self._record("github")

        result = self.plugin.run_cycle(skill_name="github")

        self.assertEqual(result["status"], "name_conflicts_with_category")
        self.assertFalse((self.skills / "github" / "SKILL.md").exists())

    def test_ambiguous_skill_in_run_cycle_is_reported_not_written(self):
        self._put("alpha-cat/dup", "dup")
        self._put("beta-cat/dup", "dup")
        self._record("dup")

        result = self.plugin.run_cycle(skill_name="dup")

        self.assertEqual(result["status"], "ambiguous_skill")
        self.assertIn("dup", result["message"])
        self.assertEqual(
            (self.skills / "alpha-cat" / "dup" / "SKILL.md").read_text(encoding="utf-8"),
            _skill_md("dup"),
        )


class TestCategorySymlinkSafety(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.hermes_home = Path(self.tmpdir) / ".hermes"
        (self.hermes_home / "skills").mkdir(parents=True)
        self._saved = os.environ.get("HERMES_HOME")
        os.environ["HERMES_HOME"] = str(self.hermes_home)
        self.plugin = WikiSkillEvolutionPlugin()
        self.skills = self.hermes_home / "skills"

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("HERMES_HOME", None)
        else:
            os.environ["HERMES_HOME"] = self._saved
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _record(self, skill):
        self.plugin.on_post_tool_call(
            tool_name="python_run",
            args={"command": f"python skills/{skill}/run.py"},
            error="ModuleNotFoundError: No module named 'requests'",
        )

    def test_symlinked_category_skill_is_refused(self):
        """A categorized SKILL.md that is a symlink to outside must not be written through."""
        outside = Path(self.tmpdir) / "outside.md"
        outside.write_text(_skill_md("victim"), encoding="utf-8")
        d = self.skills / "cat" / "linked"
        d.mkdir(parents=True)
        os.symlink(outside, d / "SKILL.md")
        self._record("linked")

        result = self.plugin.run_cycle(skill_name="linked")

        self.assertEqual(result["status"], "unsafe_skill_path")
        self.assertEqual(outside.read_text(encoding="utf-8"), _skill_md("victim"))


if __name__ == "__main__":
    unittest.main()
