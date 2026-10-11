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

    def test_default_fallback_name_is_never_created(self):
        """When no skill can be inferred, the fallback 'default_skill' must not become a new skill."""
        self.plugin.on_post_tool_call(
            tool_name="terminal", args={"command": "ls /missing"}, error="終了コード 2",
        )

        result = self.plugin.run_cycle()

        self.assertEqual(result["status"], "fallback_skill_refused")
        self.assertFalse((self.skills / "default_skill").exists())

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
