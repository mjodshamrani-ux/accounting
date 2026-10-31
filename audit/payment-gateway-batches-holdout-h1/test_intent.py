"""The sealed foundation oracle, run on PG-1 H1, agrees with every intent
written by hand: the refusal, or each batch by its settlement row with its
status, every reason in contract order, its members by row, what was paid and
its payouts; each payout with its status, reasons, lines and credit row; and
each bank credit no line names. And EXPECTED.json is what the oracle returns.

  python3 -B -m unittest discover -s audit/payment-gateway-batches-holdout-h1 -p test_intent.py -v
"""
import json
import os
import unittest
from pathlib import Path

import judge

HERE = Path(__file__).resolve().parent
FROZEN = Path(os.environ.get("PG_BATCHES_H1_FOLDER", HERE / "frozen"))
FACTS = json.loads((FROZEN / "stories.json").read_text(encoding="utf-8"))


def seen(result):
    if result["refused"]:
        return {"refused": result["refused"], "batches": [], "payouts": [], "credits": []}
    return {"refused": None,
            "batches": [[b["row"], b["status"], b["reasons"], b["sales"], b["refunds"], b["fees"], b["paid"],
                         b["payouts"]] for b in result["batches"]],
            "payouts": [[p["payout"], p["status"], p["reasons"], p["lines"],
                         p["credit"]["row"] if p["credit"] else None] for p in result["payouts"]],
            "credits": [[c["row"], c["payout"]] for c in result["credits"]]}


class Intent(unittest.TestCase):
    result = judge.run(FROZEN)["stories"]

    def test_every_intent(self):
        self.assertEqual(sorted(self.result), sorted(s["id"] for s in FACTS["stories"]))
        for story in FACTS["stories"]:
            with self.subTest(story=story["id"]):
                got, want = seen(self.result[story["id"]]), story["intent"]
                if got != want:
                    first = next(k for k in sorted(set(got) | set(want)) if got.get(k) != want.get(k))
                    self.fail(f"{first}: {str(got.get(first))[:400]} != {str(want.get(first))[:400]}")

    def test_expected_is_the_oracle(self):
        expected = json.loads((FROZEN / "EXPECTED.json").read_text(encoding="utf-8"))
        self.assertEqual(expected["stories"], self.result)


if __name__ == "__main__":
    unittest.main()
