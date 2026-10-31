"""Plant one fault at a time in a copy of oracle.py and require test_oracle.py
to fail with an assertion. A crash or a stale anchor is not a detection.

    python3 -B audit/allocation-advice-foundation/mutate_oracle.py [--out results/oracle-mutants-1.json]
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
    ("invoice-competition-ignored", "        if crowded[1] and not over[1]:\n", "        if False:\n"),
    ("payment-competition-ignored", "        if crowded[0] and not over[0]:\n", "        if False:\n"),
    ("an-over-line-also-competes", "        if crowded[0] and not over[0]:\n", "        if crowded[0]:\n"),
    ("crowded-at-equality", "crowded = [advised[pay] > room[0], advised[inv] > room[1]]",
     "crowded = [advised[pay] >= room[0], advised[inv] >= room[1]]"),
    ("over-at-equality", 'over = [p["amount"] > room[0], p["amount"] > room[1]]',
     'over = [p["amount"] >= room[0], p["amount"] >= room[1]]'),
    ("allocated-lines-still-advise", "open_ = [p for p in proofs if pid(p) not in used_proofs]", "open_ = list(proofs)"),
    ("twins-ignore-the-amount", 'twin_key = lambda p: (p["payment"], p["invoice"], p["amount"])',
     'twin_key = lambda p: (p["payment"], p["invoice"])'),
    ("twins-among-open-lines-only", "    for p in proofs:\n        same.setdefault(", "    for p in open_:\n        same.setdefault("),
    ("twin-reason-dropped", '        if twins:\n            reasons.append("TWIN")', '        if False:\n            reasons.append("TWIN")'),
    ("competitors-on-every-item", "            if c:\n                competitors |=", "            if True:\n                competitors |="),
    ("human-links-take-no-capacity", "                allocated[x] = allocated.get(x, 0) + m\n            if proof:\n                used_proofs",
     "                allocated[x] = allocated.get(x, 0) + (m if proof else 0)\n            if proof:\n                used_proofs"),
    ("undo-ignored", '            del active[e["target"]]', "            pass"),
    ("replay-capacity-unchecked", 'if used.get(x, 0) + m > it["available"]:', "if False:"),
    ("proof-reuse-allowed", ' or b["proofId"] in proofs_used):', "):"),
    ("row-scope-unchecked", "                if get(h) != scope[k]:\n", "                if False:\n"),
    ("duplicate-references-kept", '        if count[e["reference"]] > 1:', "        if False:"),
    ("proof-members-unchecked", 'if p["payment"] in refs[0] and p["invoice"] in refs[1]:', "if True:"),
    ("hidden-rows-read", "            if r in hidden:\n", "            if False:\n"),
    ("extra-decimals-accepted", ' or len(m.group(2) or "") > places', ""),
    ("ceiling-one-short", "    if len(rows) > LIMIT:\n        raise Refused", "    if len(rows) >= LIMIT:\n        raise Refused"),
    ("cut-off-excluded", 'when > scope["cutoff"]', 'when >= scope["cutoff"]'),
    ("available-above-original-accepted", "if original <= 0 or available > original:", "if original <= 0:"),
    ("zero-advice-accepted", '                if e["amount"] <= 0:', '                if e["amount"] < 0:'),
    ("arabic-indic-digits-unread", 'v = digits(raw.strip()).replace("\\u066b", ".")', 'v = raw.strip().replace("\\u066b", ".")'),
    ("excess-may-be-negative", '"excess": max(0, advised.get(k, 0) - remaining[k])', '"excess": advised.get(k, 0) - remaining[k]'),
    ("columns-in-fixed-order", "col = {h: head.index(h) for h in want}", "col = {h: want.index(h) for h in want}"),
]


def tests(text):
    """Run test_oracle.py in a private copy of this folder with oracle.py
    replaced by `text`."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "audit" / "allocation-advice-foundation"
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
    record = {"schema": "tarasuf-all1-oracle-mutants/1", "baselinePassed": baseline, "killed": killed,
              "of": len(FAULTS), "faults": results}
    if argv[:1] == ["--out"]:
        (HERE / argv[1]).write_text(json.dumps(record, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"baselinePassed": baseline, "killed": killed, "of": len(FAULTS),
                      "survivors": [r["fault"] for r in results if not r["killed"]]}))
    if killed != len(FAULTS):
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
