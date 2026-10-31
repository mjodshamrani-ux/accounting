"""Plant one fault at a time in a copy of oracle.py and require test_oracle.py
to fail with an assertion. A crash or a stale anchor is not a detection.

    python3 -B audit/payment-gateway-batches-foundation/mutate_oracle.py [--out results/oracle-mutants-1.json]
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
    ("sales-unchecked", 'if comp["sales"] != s["gross"]:', "if False:"),
    ("refunds-unchecked", 'if comp["refunds"] != s["refunds"]:', "if False:"),
    ("fees-unchecked", 'if comp["fees"] != s["fees"]:', "if False:"),
    ("net-arithmetic-unchecked", 'if s["gross"] - s["refunds"] - s["fees"] != s["net"]:', "if False:"),
    ("net-ignores-refunds", 's["gross"] - s["refunds"] - s["fees"] != s["net"]', 's["gross"] - s["fees"] != s["net"]'),
    ("paid-short-unchecked", 'if paid < s["net"]:', "if False:"),
    ("paid-over-unchecked", 'if paid > s["net"]:', "if False:"),
    ("payout-review-not-held", 'if any(payout_status[p] == "review" for p in its):', "if False:"),
    ("credit-unchecked", 'elif c["amount"] != total:', "elif False:"),
    ("missing-credit-called-a-difference", 'reasons.append("NOT_DEPOSITED")', 'reasons.append("CREDIT")'),
    ("in-transit-on-the-end-day", 'c["valueDate"] > end', 'c["valueDate"] >= end'),
    ("late-credit-consistent", 'status = "review" if reasons else "in-transit" if c["valueDate"] > end else "consistent"',
     'status = "review" if reasons else "consistent"'),
    ("batch-in-transit-ignored", 'if any(payout_status[p] == "in-transit" for p in its)', "if False"),
    ("unlinked-credits-dropped", 'for c in credits if c["payout"] not in payouts]', "for c in credits if False]"),
    ("sales-of-every-batch", 't["batch"] == b and t["kind"] == "sale"', 't["kind"] == "sale"'),
    ("refunds-read-as-sales", 't["batch"] == b and t["kind"] == "refund"', 't["batch"] == b and t["kind"] == "sale"'),
    ("fees-of-every-batch", 'mine_fees = [f for f in fees if f["batch"] == b]', "mine_fees = list(fees)"),
    ("lines-of-every-batch", 'mine_lines = [ln for ln in lines if ln["batch"] == b]', "mine_lines = list(lines)"),
    ("row-scope-unchecked", 'raise RowError("ROW_SCOPE")', "pass"),
    ("kind-unchecked", 'if cell("Kind") not in ("sale", "refund"):', "if False:"),
    ("posting-period-unchecked", 'day(cell("Posting date"), scope["start"], scope["end"])',
     'day(cell("Posting date"), "0001-01-01", "9999-12-31")'),
    ("value-date-only-in-the-period", 'day(cell("Value date"), scope["start"], scope["asOf"])',
     'day(cell("Value date"), scope["start"], scope["end"])'),
    ("signed-amounts-accepted", 'm = re.fullmatch(r"([0-9]+)(?:\.([0-9]+))?", v)',
     'm = re.fullmatch(r"-?([0-9]+)(?:\.([0-9]+))?", v)'),
    ("extra-decimals-accepted", ' or len(m.group(2) or "") > places', ""),
    ("duplicates-kept", 'bad |= {e["row"] for e in entries if count[e[key[0]]] > 1}', "bad |= set()"),
    ("a-payout-credited-twice-kept", 'keys = [("id",)] + ([("payout",)] if side == 4 else [])', 'keys = [("id",)]'),
    ("members-without-a-settlement-kept", 'if e["batch"] not in batches:', "if False:"),
    ("hidden-rows-read", "            if r in flagged:\n                raise RowError(\"CELL\")\n            if any(",
     "            if False:\n                raise RowError(\"CELL\")\n            if any("),
    ("ceiling-one-short", "    if len(rows) > LIMIT:\n        raise Refused(\"ROWS\")\n    return rows, set()",
     "    if len(rows) >= LIMIT:\n        raise Refused(\"ROWS\")\n    return rows, set()"),
    ("columns-in-fixed-order", "col = {h: head.index(h) for h in want}", "col = {h: want.index(h) for h in want}"),
    ("arabic-indic-digits-unread", 'if "\\u0660" <= c <= "\\u0669":', "if False:"),
    ("scope-dates-in-any-order", "not days[0] <= days[1] <= days[2]", "False"),
    ("payouts-in-id-order", "    for p in order:\n", "    for p in sorted(order):\n"),
]


def tests(text):
    """Run test_oracle.py in a private copy of this folder with oracle.py
    replaced by `text`."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "audit" / "payment-gateway-batches-foundation"
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
    record = {"schema": "tarasuf-pg1-oracle-mutants/1", "baselinePassed": baseline, "killed": killed,
              "of": len(FAULTS), "faults": results}
    if argv[:1] == ["--out"]:
        (HERE / argv[1]).write_text(json.dumps(record, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"baselinePassed": baseline, "killed": killed, "of": len(FAULTS),
                      "survivors": [r["fault"] for r in results if not r["killed"]]}))
    if killed != len(FAULTS):
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
