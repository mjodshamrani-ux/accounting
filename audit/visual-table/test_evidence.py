import copy
import json
import unittest
from pathlib import Path
from check_record import check, png

ROOT = Path(__file__).parent

class TableEvidence(unittest.TestCase):
    def setUp(self):
        self.record = json.loads((ROOT / "baseline/reviewed.json").read_text())
        self.source = (ROOT / "fixtures/statement.png").read_bytes()

    def test_known_native_record(self):
        self.assertEqual(check(self.record, self.source)["unreadableRows"], 1)

    def test_detects_omission_sign_role_reuse_geometry_receipt_and_source_corruption(self):
        mutations = [
            lambda p: p["rows"].pop(1),
            lambda p: p["rows"][0]["cells"].__setitem__(2, "region:4"),
            lambda p: p["rows"][1].__setitem__("disposition", "non-movement"),
            lambda p: p["image"]["regions"][2].__setitem__("value", "250.00"),
            lambda p: p["grid"]["roles"].__setitem__(2, "balance"),
            lambda p: p["grid"]["rowCuts"].__setitem__(1, 450),
            lambda p: p["image"]["regions"][2]["region"].__setitem__("x1", 900),
            lambda p: p["coverage"].__setitem__("fingerprint", "0" * 64),
            lambda p: p["rows"][2]["review"].__setitem__("fingerprint", "0" * 64),
            lambda p: p["image"]["source"].__setitem__("sha256", "0" * 64),
            lambda p: p.__setitem__("sheets", []),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                p = copy.deepcopy(self.record)
                mutate(p)
                with self.assertRaises((AssertionError, KeyError, ValueError)):
                    check(p, self.source)

    def test_independent_truth_detects_wrong_literal_even_after_every_public_checksum_is_recomputed(self):
        p = copy.deepcopy(self.record)
        cell, image = p["image"]["regions"][2], p["image"]
        cell["value"] = "250.00"
        cell["review"]["fingerprint"] = png.fingerprint(["tarasuf-visual-region-v1", image["revision"], cell["id"], cell["origin"], cell["role"], cell["observed"], cell["value"], cell["region"]])
        p["revision"] = png.fingerprint(["tarasuf-visual-table-v1", image, p["grid"]])
        row = p["rows"][2]
        row["review"]["fingerprint"] = png.fingerprint(["tarasuf-table-exclusion-v1", p["revision"], row["id"], row["disposition"], row["note"], row["cells"]])
        p["coverage"]["fingerprint"] = png.fingerprint(["tarasuf-table-coverage-v1", p["revision"], p["rows"]])
        with self.assertRaises(AssertionError):
            check(p, self.source)

if __name__ == "__main__":
    unittest.main()
