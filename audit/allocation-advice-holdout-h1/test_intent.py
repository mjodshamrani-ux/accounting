"""The sealed foundation oracle, run on ALL-1 H1, agrees with every intent
written by hand: the refusal, or each advice line by its row with its status,
every reason in contract order, the rows it competes with and its twins, and
each transfer and invoice with what is left on it and the open advice on it.
And EXPECTED.json is what the oracle returns.

  python3 -B -m unittest discover -s audit/allocation-advice-holdout-h1 -p test_intent.py -v
"""
import json
import os
import unittest
from pathlib import Path

import judge

HERE = Path(__file__).resolve().parent
FROZEN = Path(os.environ.get("ALL_ADVICE_H1_FOLDER", HERE / "frozen"))
FACTS = json.loads((FROZEN / "stories.json").read_text(encoding="utf-8"))


def seen(result):
    if result["refused"]:
        return {"refused": result["refused"], "lines": [], "items": []}
    return {"refused": None,
            "lines": [[l["row"], l["status"], l["reasons"], l["competitors"], l["twins"]] for l in result["lines"]],
            "items": [[i["side"], i["reference"], i["remaining"], i["advised"]] for i in result["items"]]}


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
