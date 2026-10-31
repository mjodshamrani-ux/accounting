"""Plant one fault at a time in a copy of oracle.py and require test_oracle.py
to fail with an assertion. A crash or a stale anchor is not a detection.

    python3 -B audit/inventory-links-foundation/mutate_oracle.py [--out results/oracle-mutants-1.json]
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAULTS = [
    ("no-mapping-read-as-two", 'reasons = ["NO_MAPPING"]', 'reasons = ["MAPPINGS"]'),
    ("first-of-two-mappings-chosen", "elif len(found) > 1:", "elif False:"),
    ("no-evidence-read-as-two", 'reasons = ["NO_EVIDENCE"]', 'reasons = ["EVIDENCES"]'),
    ("first-of-two-evidence-chosen", "elif len(named) > 1:", "elif False:"),
    ("first-differing-field-only", 'named[0]["values"][1:8]) if a != b]', 'named[0]["values"][1:8]) if a != b][:1]'),
    ("account-fields-not-compared", 'named[0]["values"][1:8])', 'named[0]["values"][1:6])'),
    ("dimensions-case-folded", "found = by_key.get((v[0], v[1]), [])", "found = by_key.get((v[0], v[1].lower()), [])"),
    ("leading-zeros-dropped", "found = by_key.get((v[0], v[1]), [])",
     'found = by_key.get((v[0].lstrip("0") or "0", v[1]), [])'),
    ("gl-rows-not-listed", 'gl = [g["row"] for g in gl_by.get((m[3], m[4]), [])]', "gl = []"),
    ("unlinked-rows-make-accounts-linked", "if not reasons and (m[3], m[4]) not in accounts:",
     "if (m[3], m[4]) not in accounts:"),
    ("orphan-mappings-missed", 'for m in maps if tuple(m["values"][1:3]) not in register_keys]', "for m in maps if False]"),
    ("orphan-evidence-missed", 'for e in evs if e["values"][0] not in named_ids]', "for e in evs if False]"),
    ("unused-gl-rows-missed", 'for g in gls if tuple(g["values"][:2]) not in linked]', "for g in gls if False]"),
    ("accounts-without-gl-missed", "for a in accounts if a not in gl_by]", "for a in accounts if False]"),
    ("no-row-budget", "    if sum(max(0, len(rows_of(p)) - 1) for p in paths) > LIMIT:",
     "    if False:"),
    ("budget-one-short", ") > LIMIT:", ") >= LIMIT:"),
    ("reference-check-removed", '    if sorted(derived) != r["missing"]:', "    if False:"),
    ("product-key-spaced", 'separators=(",", ":"))\n\n\ndef judge', 'separators=(", ", ": "))\n\n\ndef judge'),
    ("related-rows-reversed", '[m["row"] for m in found], evidence, account, gl])',
     'sorted([m["row"] for m in found], reverse=True), evidence, account, gl])'),
    ("evidence-rows-dropped", 'evidence = [e["row"] for e in named]', "evidence = []"),
]


def tests(text):
    """Run test_oracle.py in a private copy of this folder and of the reference
    oracle it imports, with oracle.py replaced by `text`."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "inventory-links-foundation"
        shutil.copytree(HERE, work, ignore=shutil.ignore_patterns("results", "__pycache__"))
        (Path(tmp) / "inventory-register").mkdir()
        shutil.copy(HERE.parent / "inventory-register" / "reference.py", Path(tmp) / "inventory-register")
        (work / "oracle.py").write_text(text, encoding="utf-8")
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
        run = subprocess.run([sys.executable, "-B", "-m", "unittest", "discover", "-s", str(work), "-p",
                              "test_oracle.py"], capture_output=True, text=True, env=env, cwd=tmp)
        return run.returncode, run.stdout + run.stderr


def main(argv):
    source = (HERE / "oracle.py").read_text(encoding="utf-8")
    code, _ = tests(source)
    baseline = code == 0
    results = []
    for name, old, new in FAULTS if baseline else []:
        if source.count(old) != 1:
            results.append({"fault": name, "killed": False, "why": "stale anchor"})
            continue
        code, text = tests(source.replace(old, new))
        asserted = "AssertionError" in text or "FAIL:" in text
        crashed = "ERROR:" in text
        results.append({"fault": name, "killed": code != 0 and asserted and not crashed,
                        "returncode": code, "assertion": asserted, "error": crashed})
    killed = sum(r["killed"] for r in results)
    record = {"schema": "tarasuf-inv3-oracle-mutants/1", "baselinePassed": baseline, "killed": killed,
              "of": len(FAULTS), "faults": results}
    if argv[:1] == ["--out"]:
        (HERE / argv[1]).write_text(json.dumps(record, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"killed": killed, "of": len(FAULTS),
                      "survivors": [r["fault"] for r in results if not r["killed"]]}))
    if killed != len(FAULTS):
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
