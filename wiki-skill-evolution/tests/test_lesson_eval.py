"""Golden evaluation for lesson extraction and skill patching.

Uses fixtures/lesson_eval_set.json. Positive cases must map to the expected rule prefix,
negative cases must produce no lesson. Also checks that re-running an update does not
duplicate lessons (idempotency) and that a patch never touches an unrelated skill.
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

from main import ERROR_RULES, WikiSkillEvolutionPlugin  # noqa: E402

EVAL_SET = Path(__file__).resolve().parent / "fixtures" / "lesson_eval_set.json"


class TestLessonEvaluation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = json.loads(EVAL_SET.read_text(encoding="utf-8"))

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.hermes_home = Path(self.tmpdir) / ".hermes"
        self.hermes_home.mkdir(parents=True, exist_ok=True)
        os.environ["HERMES_HOME"] = str(self.hermes_home)
        os.environ.pop("HERMES_PROFILE", None)
        self.plugin = WikiSkillEvolutionPlugin()

    def tearDown(self):
        os.environ.pop("HERMES_HOME", None)
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_positive_cases_map_to_expected_rule(self):
        for case in self.cases["positive"]:
            with self.subTest(case=case["id"]):
                lesson = self.plugin._extract_lesson_from_error(case["error"])
                self.assertIsNotNone(lesson, f"{case['id']}: no lesson produced")
                self.assertTrue(lesson.startswith(case["expect_prefix"]), lesson)

    def test_negative_cases_produce_no_lesson(self):
        for case in self.cases["negative"]:
            with self.subTest(case=case["id"]):
                self.assertIsNone(
                    self.plugin._extract_lesson_from_error(case["error"]),
                    f"{case['id']}: must not become a skill lesson",
                )

    def test_every_rule_has_a_positive_case(self):
        """A rule without any positive example is unverified; keep the eval set honest."""
        covered = {case["expect_prefix"] for case in self.cases["positive"]}
        for rule in ERROR_RULES:
            prefix = rule["lesson"].split("]")[0] + "]"
            self.assertIn(prefix, covered, f"no positive eval case for {prefix}")

    def test_repeated_update_does_not_duplicate_lessons(self):
        """Applying the same lesson twice must leave the skill unchanged the second time."""
        skill_dir = self.hermes_home / "skills" / "idem_skill"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_text("# Idem\n\n## Workflow\n- Existing.\n", encoding="utf-8")
        lesson = self.plugin._extract_lesson_from_error(
            "ModuleNotFoundError: No module named 'requests'"
        )

        first = self.plugin._propose_skill_patch(skill_file, [lesson])
        self.assertIsNotNone(first)
        skill_file.write_text(first, encoding="utf-8")
        second = self.plugin._propose_skill_patch(skill_file, [lesson])

        self.assertIsNone(second)
        self.assertEqual(skill_file.read_text(encoding="utf-8").count(ERROR_RULES[0]["patch"]), 1)

    def test_patch_for_one_skill_does_not_touch_another(self):
        """A lesson recorded against skill A must not modify skill B."""
        for name in ("skill_a", "skill_b"):
            d = self.hermes_home / "skills" / name
            d.mkdir(parents=True, exist_ok=True)
            (d / "SKILL.md").write_text(
                f"---\nname: {name}\ndescription: Use when {name} runs. Keep it.\n---\n\n# {name}\n\n## Workflow\n- Keep.\n",
                encoding="utf-8",
            )
        before_b = (self.hermes_home / "skills" / "skill_b" / "SKILL.md").read_text(encoding="utf-8")

        self.plugin.on_post_tool_call(
            tool_name="python_run",
            args={"command": "python skills/skill_a/run.py"},
            error="ModuleNotFoundError: No module named 'requests'",
        )
        result = self.plugin.run_cycle(skill_name="skill_a")

        self.assertIn(result["status"], {"success", "updated_uncommitted", "commit_failed"})
        self.assertEqual(
            (self.hermes_home / "skills" / "skill_b" / "SKILL.md").read_text(encoding="utf-8"),
            before_b,
        )


if __name__ == "__main__":
    unittest.main()
