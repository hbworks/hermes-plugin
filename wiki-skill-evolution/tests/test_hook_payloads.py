"""Replay tests: feed recorded Hermes post_tool_call payloads through the plugin hook.

Fixture: fixtures/hermes_post_tool_call_payloads.json, shaped after
hermes-agent model_tools.py:_emit_post_tool_call_hook. Each case states whether the
plugin should record an error and, when it does, the expected error text.
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

from main import WikiSkillEvolutionPlugin  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "hermes_post_tool_call_payloads.json"

# Expected behavior per fixture case: (should_record, expected_error_substring)
EXPECTATIONS = {
    "error_message_present": (True, "No module named 'requests'"),
    "result_json_error_without_status": (True, "Permission denied"),
    "status_error_type_only": (True, "No such file or directory"),
    "success_ok": (False, None),
    "terminal_nonzero_informational": (False, None),
}


def _hook_kwargs(payload):
    """Pass the payload exactly the way Hermes invokes the hook (keyword arguments)."""
    kwargs = {k: v for k, v in payload.items() if k not in {"tool_name", "args", "result"}}
    return payload["tool_name"], payload["args"], payload["result"], kwargs


class TestHermesPayloadReplay(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.hermes_home = Path(self.tmpdir) / ".hermes"
        self.hermes_home.mkdir(parents=True, exist_ok=True)
        os.environ["HERMES_HOME"] = str(self.hermes_home)
        os.environ.pop("HERMES_PROFILE", None)
        self.plugin = WikiSkillEvolutionPlugin()
        self.fixtures = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def tearDown(self):
        os.environ.pop("HERMES_HOME", None)
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _replay(self, name):
        tool_name, args, result, kwargs = _hook_kwargs(self.fixtures[name])
        before = len(self.plugin.recent_errors)
        self.plugin.on_post_tool_call(tool_name=tool_name, args=args, result=result, **kwargs)
        return self.plugin.recent_errors[before:]

    def test_fixture_covers_every_expectation(self):
        """Every recorded payload must have an explicit expectation (no silent gaps)."""
        self.assertEqual(sorted(self.fixtures.keys() - {"_source", "_note"}), sorted(EXPECTATIONS))

    def test_each_payload_matches_expected_recording(self):
        for name, (should_record, expected_text) in EXPECTATIONS.items():
            with self.subTest(payload=name):
                new_records = self._replay(name)
                if should_record:
                    self.assertEqual(len(new_records), 1, f"{name}: expected one error record")
                    self.assertIn(expected_text, new_records[0]["error"])
                else:
                    self.assertEqual(new_records, [], f"{name}: must not be recorded as an error")

    def test_error_message_is_preferred_over_generic_error_type(self):
        """status=error with error_type=tool_error must keep the real message, not the generic label."""
        new_records = self._replay("error_message_present")
        self.assertEqual(len(new_records), 1)
        self.assertNotEqual(new_records[0]["error"], "tool_error")

    def test_recorded_error_is_classified_into_a_lesson(self):
        """A replayed real error should reach the rule engine with the real text."""
        self._replay("error_message_present")
        records = self.plugin._read_error_log(hours=6)
        self.assertEqual(len(records), 1)
        lesson = self.plugin._extract_lesson_from_error(records[0]["error"])
        self.assertIsNotNone(lesson)
        self.assertTrue(lesson.startswith("[Python/Path]"), lesson)

    def test_generic_error_type_alone_is_not_recorded_as_error_text(self):
        """error_type=tool_error without a message is a label, not a lesson source."""
        self.plugin.on_post_tool_call(
            tool_name="python_run",
            args={"command": "python skills/web_scraper/fetch.py"},
            result="",
            status="error",
            error_type="tool_error",
            error_message=None,
        )
        self.assertEqual(self.plugin.recent_errors, [])


if __name__ == "__main__":
    unittest.main()
