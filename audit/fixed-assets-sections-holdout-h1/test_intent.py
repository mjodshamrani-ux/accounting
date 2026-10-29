"""The sealed foundation oracle, run on FA-1 H1, agrees with every intent
written by hand: the refusal, or the run codes, every section with its rows,
labels, status and codes, every asset's status and codes, every pair the map
leaves unplaced, every account's status, codes, amounts and members, every
row that cannot be placed and the inventory. And EXPECTED.json is what the
oracle returns.

  python3 -B -m unittest discover -s audit/fixed-assets-sections-holdout-h1 -p test_intent.py -v
"""
import json
import os
import unittest
from pathlib import Path

import judge

HERE = Path(__file__).resolve().parent
FROZEN = Path(os.environ.get("FA_SECTIONS_H1_FOLDER", HERE / "frozen"))
FACTS = json.loads((FROZEN / "stories.json").read_text(encoding="utf-8"))


def seen(result):
    if result["refused"]:
        return {"refused": result["refused"]}
    return {"refused": None, "run": result["run"], "sections": result["sections"],
            "assets": {"|".join([a["section"], a["assetId"], a["dimensions"]]): [a["status"], a["codes"]]
                       for a in result["assets"]},
            "unmapped": result["unmapped"],
            "accounts": {f'{a["account"]}|{a["dimensions"]}': [a["status"], a["codes"], a["register"], a["gl"],
                                                               a["difference"], a["members"]]
                         for a in result["accounts"]},
            "unplaced": result["unplaced"], "inventory": result["inventory"]}


class Intent(unittest.TestCase):
    result = judge.run(FROZEN)["stories"]

    def test_every_intent(self):
        self.assertEqual(sorted(self.result), sorted(s["id"] for s in FACTS["stories"]))
        for story in FACTS["stories"]:
            with self.subTest(story=story["id"]):
                got, want = seen(self.result[story["id"]]), story["intent"]
                if got != want:
                    first = next(k for k in sorted(set(got) | set(want)) if got.get(k) != want.get(k))
                    self.fail(f"{first}: {str(got.get(first))[:600]} != {str(want.get(first))[:600]}")

    def test_expected_is_the_oracle(self):
        expected = json.loads((FROZEN / "EXPECTED.json").read_text(encoding="utf-8"))
        self.assertEqual(expected["stories"], self.result)


if __name__ == "__main__":
    unittest.main()
