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
        self.current["distributionSha256After"] = copy.deepcopy(self.current["distributionSha256"])
        self.current["measurementCompleted"] = True
        for pair in self.current["rounds"]:
            for side in ("baseline", "candidate"):
                pair[side]["memorySamplesSuccessful"] = 12
                pair[side]["memorySamplesDuringExport"] = 8
                pair[side]["memorySamplingErrors"] = 0
                pair[side]["independentExportSourceCheck"] = True
                pair[side]["independentExportMembershipCheck"] = True

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

    def test_runner_failure_cannot_be_overridden_by_stale_acceptance(self):
        for failure in (None, "", False, 0, [], {}, "candidate build changed during measurement"):
            with self.subTest(failure=failure):
                report = copy.deepcopy(self.current)
                report["failure"] = failure
                report["acceptance"] = {"accepted": True}
                decision = evaluate(report)
                self.assertFalse(decision["accepted"])
                self.assertIn("runner recorded a failure", decision["reasons"][0])

    def test_last_pair_checkpoint_is_not_a_completed_measurement(self):
        # The runner writes all six pairs before its final build checks. A
        # process interruption at that checkpoint must not become acceptance.
        for complete in (None, False, 1, "true"):
            with self.subTest(complete=complete):
                report = copy.deepcopy(self.current)
                if complete is None:
                    report.pop("measurementCompleted")
                else:
                    report["measurementCompleted"] = complete
                self.assertFalse(evaluate(report)["accepted"])

    def test_missing_changed_or_malformed_final_build_fingerprints_fail(self):
        for bad in (None, {}, {"baseline": self.current["distributionSha256"]["baseline"]}):
            with self.subTest(bad=bad):
                report = copy.deepcopy(self.current)
                report["distributionSha256After"] = bad
                self.assertFalse(evaluate(report)["accepted"])
        for variant in ("baseline", "candidate"):
            for field, bad in (("sha256", "a" * 64), ("fileCount", 4), ("fileCount", True)):
                with self.subTest(variant=variant, field=field, bad=bad):
                    report = copy.deepcopy(self.current)
                    report["distributionSha256After"][variant][field] = bad
                    self.assertFalse(evaluate(report)["accepted"])

    def test_required_recovery_attestations_are_individually_required(self):
        for variant in ("baseline", "candidate"):
            for flag in ("cancelAndExportRecovery", "independentRecoveryExportCheck",
                         "independentRecoveryMembershipCheck"):
                for bad in (None, False, 1, "true"):
                    with self.subTest(variant=variant, flag=flag, bad=bad):
                        report = copy.deepcopy(self.current)
                        pair = next(p for p in report["rounds"] if p["round"] == 2 and p["format"] == "xlsx")
                        if bad is None:
                            pair[variant].pop(flag)
                        else:
                            pair[variant][flag] = bad
                        self.assertFalse(evaluate(report)["accepted"])

    def test_source_and_membership_attestations_are_required_for_both_variants(self):
        for pair_index in range(6):
            for variant in ("baseline", "candidate"):
                for flag in ("independentExportSourceCheck", "independentExportMembershipCheck"):
                    for bad in (None, False, 1, "true"):
                        with self.subTest(pair=pair_index, variant=variant, flag=flag, bad=bad):
                            report = copy.deepcopy(self.current)
                            item = report["rounds"][pair_index][variant]
                            if bad is None:
                                item.pop(flag)
                            else:
                                item[flag] = bad
                            self.assertFalse(evaluate(report)["accepted"])

    def test_contradictory_or_incomplete_package_verdicts_fail(self):
        for package_field in ("packageIdentity", "recoveryPackageIdentity"):
            mutations = [
                lambda p: p.pop("errors"),
                lambda p: p.update(errors=[{"archive": "candidate", "message": "Bad CRC"}]),
                lambda p: p.update(changed=["xl/worksheets/sheet1.xml"]),
                lambda p: p.update(missingFromCandidate=["xl/workbook.xml"]),
                lambda p: p.update(extraInCandidate=["extra.xml"]),
                lambda p: p.update(errors={}),
                lambda p: p.update(duplicateNames={"baseline": [], "candidate": ["xl/workbook.xml"]}),
                lambda p: p.update(duplicateNames={"baseline": []}),
                lambda p: p.update(candidate=p["baseline"]),
                lambda p: p.update(candidate="/unrelated/export.xlsx"),
            ]
            for index, mutate in enumerate(mutations):
                with self.subTest(package=package_field, mutation=index):
                    report = copy.deepcopy(self.current)
                    pair = next(p for p in report["rounds"] if p["round"] == 2 and p["format"] == "xlsx")
                    mutate(pair[package_field])
                    self.assertFalse(evaluate(report)["accepted"])

    def test_export_sample_count_cannot_exceed_all_samples(self):
        self.current["rounds"][0]["candidate"].update(memorySamplesSuccessful=1, memorySamplesDuringExport=999)
        decision = evaluate(self.current)
        self.assertFalse(decision["accepted"])
        self.assertIn("export memory samples exceed", decision["reasons"][0])

    def test_extreme_numbers_and_nonfinite_ratios_refuse_without_crashing(self):
        for field in ("exportToDownloadMs", "exportBytes", "peakChromiumRssBytes"):
            with self.subTest(field=field):
                report = copy.deepcopy(self.current)
                report["rounds"][0]["candidate"][field] = 10 ** 400
                self.assertFalse(evaluate(report)["accepted"])
        report = copy.deepcopy(self.current)
        for pair in report["rounds"]:
            pair["baseline"]["exportToDownloadMs"] = 1e-300
            pair["candidate"]["exportToDownloadMs"] = 1e300
        decision = evaluate(report)
        self.assertFalse(decision["accepted"])
        json.dumps(decision, allow_nan=False)

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
