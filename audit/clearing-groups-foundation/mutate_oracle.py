"""Plant one fault at a time in a copy of oracle.py and require test_oracle.py
to fail with an assertion. A crash or a stale anchor is not a detection.

    python3 -B audit/clearing-groups-foundation/mutate_oracle.py [--out results/oracle-mutants-1.json]
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
    ("unisolated-lines-ignored", "        if unisolated:\n", "        if False:\n"),
    ("connected-by-reference-cell-only", 'e["keys"] = sorted({v.strip() for v in values if v.strip()})',
     'e["keys"] = [ref.strip()]'),
    ("posting-numbers-not-keys", '(ref in e["keys"] or postings & set(e["keys"]))', '(ref in e["keys"])'),
    ("connected-lines-ignored", 'if e["isolated"] and ref and (', 'if False and ('),
    ("empty-reference-isolated", "ref_ok = bool(identity(ref)) and not", "ref_ok = True and not"),
    ("summary-labels-isolated", 'and not SUMMARY.match(re.split(r"[:：]", ref.strip())[0].strip())', ""),
    ("cells-past-the-header-ignored", "and not any(v.strip() for v in values[width:])", "and True"),
    ("header-copies-isolated", "and sorted(v.strip() for v in values[:width]) != head", "and True"),
    ("formula-lines-isolated", "and not any(rr == r for rr, _ in sheet[\"formulaCells\"])", "and True"),
    ("hidden-lines-isolated", 'e["isolated"] = (role and r not in sheet["hidden"]', 'e["isolated"] = (role'),
    ("isolation-without-a-clearing-header", 'e["isolated"] = (role and', 'e["isolated"] = (True and'),
    ("duplicates-ignored", "duplicate_sets = [rows_ for rows_ in seen.values() if len(rows_) > 1]",
     "duplicate_sets = []"),
    ("duplicates-by-amount-only", 'seen.setdefault((mv["posting"], mv["reference"], mv["date"], mv["amount"], mv["description"])',
     'seen.setdefault((mv["reference"], mv["amount"])'),
    ("repeated-posting-is-an-error", "            if not posting:\n",
     "            if not posting or posting in [m[\"posting\"] for m in movements]:\n"),
    ("group-limit-one-short", "if len(members) > GROUP_LIMIT:", "if len(members) >= GROUP_LIMIT:"),
    ("period-end-excluded", 'when > scope["end"]', 'when >= scope["end"]'),
    ("currency-not-checked", 'or cell(reading["currency"]).strip() != scope["currency"]:', ":"),
    ("extra-decimals-accepted", 'len(m.group(3) or "") > decimals', "False"),
    ("ceiling-one-short", "    if len(rows) > LIMIT:\n        raise Refused", "    if len(rows) >= LIMIT:\n        raise Refused"),
    ("unreferenced-lines-pooled", 'key = ("ref", mv["reference"]) if mv["reference"] else ("row", mv["row"])',
     'key = ("ref", mv["reference"])'),
    ("one-sided-zero-cleared", ' or not any(m["amount"] > 0 for m in members) or not any(m["amount"] < 0 for m in members):',
     ":"),
    ("hidden-lines-read", 'if index in sheet["hidden"] or any(', "if any("),
]


def tests(text):
    """Run test_oracle.py in a private copy of this folder with oracle.py
    replaced by `text`."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "audit" / "clearing-groups-foundation"
        shutil.copytree(HERE, work, ignore=shutil.ignore_patterns("results", "__pycache__"))
        # render.mjs imports ExcelJS from the application's node_modules.
        (Path(tmp) / "node_modules").symlink_to(HERE.parents[1] / "node_modules")
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
    record = {"schema": "tarasuf-clr1-oracle-mutants/1", "baselinePassed": baseline, "killed": killed,
              "of": len(FAULTS), "faults": results}
    if argv[:1] == ["--out"]:
        (HERE / argv[1]).write_text(json.dumps(record, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"baselinePassed": baseline, "killed": killed, "of": len(FAULTS),
                      "survivors": [r["fault"] for r in results if not r["killed"]]}))
    if killed != len(FAULTS):
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
