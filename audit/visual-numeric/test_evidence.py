import copy
import gzip
import json
import unittest
from check_record import ROOT, check
from check_observation import check as check_ocr

class EvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.record = json.loads((ROOT / "audit/visual-numeric/local/p6-region-reviewed.json").read_text())
        cls.source = (ROOT / "audit/visual-numeric/fixtures/amounts.png").read_bytes()
        cls.report = json.loads(gzip.decompress((ROOT / "audit/visual-numeric/baseline/report.json.gz").read_bytes()))

    def test_native_manual_arabic_receipt(self):
        self.assertEqual(check(self.record, self.source)["status"], "pass")

    def test_receipt_corruption_is_detected(self):
        mutations = [
            lambda p: p["regions"][0].update(value="٢٥٠٫٠٠"),
            lambda p: p["regions"][0].update(role="reference"),
            lambda p: p["regions"][0].update(origin="verified-ocr"),
            lambda p: p["regions"][0].update(observed=[]),
            lambda p: p["regions"][0]["region"].update(x0=0),
            lambda p: p["regions"][0]["review"].update(fingerprint="0" * 64),
            lambda p: p["regions"][0]["review"].update(checkedAt="2026-02-30T00:00:00.000Z"),
            lambda p: p["regions"].append(p["regions"][0]),
            lambda p: p.update(version=1),
        ]
        for mutate in mutations:
            p = copy.deepcopy(self.record)
            mutate(p)
            with self.assertRaises((AssertionError, ValueError)):
                check(p, self.source)

    def test_failed_ocr_observations_remain_visible_and_metrics_are_recomputed(self):
        self.assertEqual(check_ocr(self.report)["status"], "evidence-consistent")
        for change in [
            lambda p: p["summary"][0].update(amountExact=13),
            lambda p: p["comparisons"][0].update(exactDisplay=True),
            lambda p: p.update(financialPromotion=True),
            lambda p: p["requests"].append({"method": "POST", "url": "https://example.com/upload"}),
        ]:
            p = copy.deepcopy(self.report)
            change(p)
            with self.assertRaises(AssertionError):
                check_ocr(p)

if __name__ == "__main__":
    unittest.main()
