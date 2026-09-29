"""Adversarial acceptance checks using the retained real paired-run report."""

import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parent))
from accept_paired import bundle_sha256, evaluate  # noqa: E402


ARCHIVE = Path(__file__).resolve().parents[1] / "sol-cycle-2/paired-run.json"


class PairedAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.historical = json.loads(ARCHIVE.read_text())
        self.current = copy.deepcopy(self.historical)
        self.current["schema"] = "tarasuf-paired-export-2"
        self.current["distributionSha256"] = {
            "baseline": {"sha256": "0" * 64, "fileCount": 3},
            "candidate": {"sha256": "1" * 64, "fileCount": 3},
        }
        for pair in self.current["rounds"]:
            for side in ("baseline", "candidate"):
                pair[side]["memorySamplesSuccessful"] = 12
                pair[side]["memorySamplesDuringExport"] = 8
                pair[side]["memorySamplingErrors"] = 0

    def test_retained_measurements_pass_with_original_declared_limits(self):
        result = evaluate(self.historical, require_build_hashes=False)
        self.assertTrue(result["accepted"], result)
        self.assertEqual(result["buildProvenance"], "historical-unavailable")
        self.assertAlmostEqual(result["perFormat"]["csv"]["changePct"]["exportSerializationMs"], -13.4465733384)
        self.assertAlmostEqual(result["perFormat"]["xlsx"]["changePct"]["exportSerializationMs"], -13.1162752337)

    def test_historical_report_cannot_claim_complete_new_acceptance(self):
        result = evaluate(self.historical)
        self.assertFalse(result["accepted"])
        self.assertIn("build fingerprints absent", result["reasons"][0])

    def test_current_schema_with_valid_samples_and_builds_passes(self):
        self.assertTrue(evaluate(self.current)["accepted"])

    def test_regression_in_xlsx_fails_despite_csv_improvement(self):
        for pair in self.current["rounds"]:
            if pair["format"] == "xlsx":
                pair["candidate"]["workerExport"]["timings"]["exportSerializationMs"] *= 1.2
        result = evaluate(self.current)
        self.assertFalse(result["accepted"])
        self.assertTrue(any(reason.startswith("xlsx: exportSerializationMs") for reason in result["reasons"]))
        self.assertTrue(result["perFormat"]["csv"]["passed"])

    def test_missing_and_bad_memory_samples_fail(self):
        for field, bad in (("memorySamplesSuccessful", 0),
                           ("memorySamplesDuringExport", 0),
                           ("memorySamplingErrors", 1),
                           ("peakChromiumRssBytes", float("nan"))):
            with self.subTest(field=field):
                report = copy.deepcopy(self.current)
                report["rounds"][0]["candidate"][field] = bad
                self.assertFalse(evaluate(report)["accepted"])

    def test_missing_worker_timing_fails_instead_of_looking_fast(self):
        self.current["rounds"][0]["candidate"]["workerExport"]["timings"].pop("exportSerializationMs")
        self.assertFalse(evaluate(self.current)["accepted"])

    def test_swapped_input_bytes_or_nonidentical_workbook_fails(self):
        for change in ("sourceSha256", "packageIdentity"):
            with self.subTest(change=change):
                report = copy.deepcopy(self.current)
                if change == "sourceSha256":
                    report["rounds"][0]["candidate"][change][0] = "e" * 64
                else:
                    report["rounds"][0][change]["identical"] = False
                self.assertFalse(evaluate(report)["accepted"])

    def test_one_missing_or_repeated_pair_fails(self):
        self.current["rounds"][0] = copy.deepcopy(self.current["rounds"][1])
        self.assertFalse(evaluate(self.current)["accepted"])

    def test_build_fingerprint_changes_with_asset_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "index.html").write_text("<html></html>")
            (root / "app.js").write_text("one")
            first = bundle_sha256(root)
            (root / "app.js").write_text("two")
            second = bundle_sha256(root)
            self.assertNotEqual(first["sha256"], second["sha256"])
            (root / "linked.js").symlink_to(root / "app.js")
            with self.assertRaisesRegex(ValueError, "symlink"):
                bundle_sha256(root)


if __name__ == "__main__":
    unittest.main()
