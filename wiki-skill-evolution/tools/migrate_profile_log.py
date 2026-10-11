#!/usr/bin/env python3
"""Migrate one Hermes home's evolution_errors.jsonl from the old plugin format.

Usage:
    python3 tools/migrate_profile_log.py <hermes_home> [--apply]

Without --apply it only reports what would change (read-only). With --apply it:
  1. copies the live log and the old plugin directory into a backup folder (0600/0700),
  2. rewrites the live log: drops raw "args", derives "skill" with the current plugin's resolver,
     drops informational non-zero exits exactly as the current hook would have refused them,
  3. reads the result back and verifies counts, order, key shape, mode, and secret-like text.

The plugin code is taken from this checkout (the directory above tools/), so the rules always
match the version being installed. Prints counts only; never prints log contents or argument values.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import stat
import sys
import datetime
from pathlib import Path

CHECKOUT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(CHECKOUT))

SECRET_LIKE = re.compile(
    r"(?i)(sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._~+/=-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}"
    r"|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}"
    r"|(api[_-]?key|token|password|passwd|secret)[\"']?\s*[:=]\s*[^\s\"',;&]{6,})"
)


def _load_plugin(home: Path):
    os.environ["HERMES_HOME"] = str(home)
    import main  # the checkout's plugin; resolves skill names and informational exits
    return main.WikiSkillEvolutionPlugin()


def _read_lines(path: Path):
    records = []
    bad = 0
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not raw.strip():
            continue
        try:
            records.append(json.loads(raw))
        except ValueError:
            bad += 1
    return records, bad


def _transform(records, plugin):
    out, stats = [], {"in": len(records), "out": 0, "dropped_args": 0,
                      "skill_derived": 0, "dropped_informational": 0}
    for r in records:
        tool, err = str(r.get("tool", "")), str(r.get("error", ""))
        legacy_args = r.get("args")
        if plugin._is_informational_exit(tool, legacy_args, err):
            stats["dropped_informational"] += 1
            continue
        if "skill" not in r:
            r["skill"] = plugin._resolve_skill_name(tool, legacy_args, err)
            stats["skill_derived"] += 1
        if "args" in r:
            r.pop("args")
            stats["dropped_args"] += 1
        out.append(r)
        stats["out"] += 1
    return out, stats


def _is_informational(plugin, record) -> bool:
    return plugin._is_informational_exit(str(record.get("tool", "")), record.get("args"), str(record.get("error", "")))


def _verify(plugin, old, new, log: Path):
    checks = {
        "count_matches": len(new) == sum(1 for _ in new) and len(new) <= len(old),
        "count_matches_after_informational_drop": len(new) == len(old) - sum(1 for r in old if _is_informational(plugin, r)),
        "order_and_content_kept": all(
            a.get("tool") == b.get("tool") and a.get("error") == b.get("error") and a.get("ts") == b.get("ts")
            for a, b in zip((x for x in old if not _is_informational(plugin, x)), new)
        ),
        "no_raw_args": all("args" not in r for r in new),
        "all_have_skill": all("skill" in r for r in new),
        "no_secret_like_text": not any(SECRET_LIKE.search(str(r.get("error", ""))) for r in new),
        "mode_0600": stat.S_IMODE(os.stat(log).st_mode) == 0o600,
    }
    return checks


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    home = Path(sys.argv[1]).expanduser().resolve()
    apply = "--apply" in sys.argv[2:]
    log = home / "logs" / "evolution_errors.jsonl"
    plugin_dir = home / "plugins" / "wiki-skill-evolution"

    if not log.exists():
        print(f"{home}: no log, nothing to migrate (install the plugin only)")
        return 0

    records, bad = _read_lines(log)
    raw_args = sum(1 for r in records if "args" in r)
    print(f"{home}: lines={len(records)} bad_json={bad} raw_args={raw_args} "
          f"old_plugin_present={plugin_dir.exists()}")
    if raw_args == 0 and all("skill" in r for r in records):
        print("already in the new format; nothing to do")
        return 0

    plugin = _load_plugin(home)
    before = json.loads(json.dumps(records))  # _transform edits in place; verify against a snapshot
    new_records, stats = _transform(records, plugin)
    print("would change:", stats)
    if not apply:
        print("dry run only (add --apply to write)")
        return 0

    stamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    backup = home / "logs" / f"migration-backup-{stamp}"
    backup.mkdir(mode=0o700)
    shutil.copy2(log, backup / "evolution_errors.jsonl")
    os.chmod(backup / "evolution_errors.jsonl", 0o600)
    if plugin_dir.exists():
        shutil.copytree(plugin_dir, backup / "plugin-old", ignore=shutil.ignore_patterns("__pycache__"))
    print(f"backup: {backup}")

    tmp = log.with_name(log.name + ".migrating")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        for r in new_records:
            f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
    os.replace(tmp, log)
    os.chmod(log, 0o600)

    back, _ = _read_lines(log)
    checks = _verify(plugin, before, back, log)
    print("verify:", checks)
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
