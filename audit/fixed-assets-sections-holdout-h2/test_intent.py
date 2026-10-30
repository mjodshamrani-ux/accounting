"""The sealed foundation oracle, run on FA-1 H2, agrees with every intent:
the refusal, or the run codes, every section with its rows, labels, status
and codes, every asset with its place, status, codes, amounts, rows, unread
rows and valuation reference, every pair the map leaves unplaced, every
account with its component, status, codes, amounts, GL row and members,
every row that cannot be placed and the inventory. The statuses and codes
are written by hand; the rest follows from each story's own model of its
rows, not from the files. And EXPECTED.json is what the oracle returns.

  python3 -B -m unittest discover -s audit/fixed-assets-sections-holdout-h2 -p test_intent.py -v
"""
import json
import os
import unittest
from pathlib import Path

import judge

HERE = Path(__file__).resolve().parent
FROZEN = Path(os.environ.get("FA_SECTIONS_H2_FOLDER", HERE / "frozen"))
FACTS = json.loads((FROZEN / "stories.json").read_text(encoding="utf-8"))
ASSET = ["location", "category", "sectionRow", "status", "codes", "amounts", "rows", "unread", "valuation"]
ACCOUNT = ["component", "status", "codes", "register", "gl", "difference", "glRow", "members"]


def seen(result):
    if result["refused"]:
        return {"refused": result["refused"]}
    return {"refused": None, "run": result["run"], "sections": result["sections"],
            "assets": {"|".join([a["section"], a["assetId"], a["dimensions"]]): {k: a[k] for k in ASSET}
                       for a in result["assets"]},
            "unmapped": result["unmapped"],
            "accounts": {f'{a["account"]}|{a["dimensions"]}': {k: a[k] for k in ACCOUNT}
                         for a in result["accounts"]},
            "unplaced": result["unplaced"], "inventory": result["inventory"]}


def first_difference(got, want, path=""):
    if type(got) is not type(want):
        return path, got, want
    if isinstance(got, dict):
        for k in sorted(set(got) | set(want)):
            if got.get(k) != want.get(k):
                return first_difference(got.get(k), want.get(k), f"{path}.{k}")
    if isinstance(got, list) and len(got) == len(want):
        for i, (g, w) in enumerate(zip(got, want)):
            if g != w:
                return first_difference(g, w, f"{path}[{i}]")
    return path, got, want


class Intent(unittest.TestCase):
    result = judge.run(FROZEN)["stories"]

    def test_every_intent(self):
        self.assertEqual(sorted(self.result), sorted(s["id"] for s in FACTS["stories"]))
        for story in FACTS["stories"]:
            with self.subTest(story=story["id"]):
                got, want = seen(self.result[story["id"]]), story["intent"]
                if got != want:
                    where, g, w = first_difference(got, want)
                    self.fail(f"{where}: {str(g)[:400]} != {str(w)[:400]}")

    def test_expected_is_the_oracle(self):
        expected = json.loads((FROZEN / "EXPECTED.json").read_text(encoding="utf-8"))
        self.assertEqual(expected["stories"], self.result)


if __name__ == "__main__":
    unittest.main()
