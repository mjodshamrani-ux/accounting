#!/usr/bin/env python3
"""Fail-closed acceptance of a paired browser export measurement.

The policy is the one recorded before the 0.4.14 comparison. This reader never
imports the product engine and never treats a downloaded workbook as proof by
itself. The runner must complete its independent accounting/package checks.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parent
POLICY = ROOT / "performance-thresholds.json"
PINNED_POLICY_SHA256 = "1bc08114623656d163657c17863db8c033097a4bf47d7ebbb32af0dbe0840269"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
METRICS = ("exportToDownloadMs", "workerExportMs", "exportSerializationMs",
           "peakChromiumRssBytes", "exportBytes")


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def positive_number(value, label):
    require(type(value) in (int, float) and math.isfinite(value) and value > 0,
            f"{label}: missing or invalid positive measurement")
    return value


def positive_integer(value, label):
    require(type(value) is int and value > 0, f"{label}: missing or invalid count")
    return value


def sha256(value, label):
    require(isinstance(value, str) and SHA256.fullmatch(value) is not None,
            f"{label}: missing or invalid SHA-256")


def median(values):
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def bundle_sha256(path):
    """Fingerprint exact built bytes and paths, without following symlinks."""
    root = Path(path)
    require(root.is_dir() and not root.is_symlink(), f"invalid build root: {root}")
    files = sorted(root.rglob("*"))
    require(files and (root / "index.html").is_file(), f"missing build index: {root}")
    fingerprint = hashlib.sha256()
    count = 0
    for file in files:
        require(not file.is_symlink(), f"build symlink: {file}")
        if file.is_dir():
            continue
        require(file.is_file(), f"unexpected build entry: {file}")
        relative = file.relative_to(root).as_posix()
        data_hash = hashlib.sha256(file.read_bytes()).hexdigest()
        fingerprint.update(relative.encode("utf-8") + b"\0" +
                           str(file.stat().st_size).encode("ascii") + b"\0" +
                           data_hash.encode("ascii") + b"\n")
        count += 1
    require(count > 0, f"empty build: {root}")
    return {"sha256": fingerprint.hexdigest(), "fileCount": count}


def evaluate(report, *, require_build_hashes=True):
    """Return a complete decision; the only legacy concession is provenance."""
    policy_bytes = POLICY.read_bytes()
    policy = json.loads(policy_bytes)
    try:
        require(hashlib.sha256(policy_bytes).hexdigest() == PINNED_POLICY_SHA256,
                "declared performance policy changed")
        schema = report["schema"]
        require(schema in ("tarasuf-paired-export-1", "tarasuf-paired-export-2"),
                "unsupported paired report")
        require(require_build_hashes or schema == "tarasuf-paired-export-1",
                "historical metrics mode applies only to the archived report schema")
        require(report["clock"] == "2026-07-31T12:00:00.000Z", "test clock changed")
        builds = report.get("distributionSha256")
        if require_build_hashes:
            require(schema == "tarasuf-paired-export-2", "build fingerprints absent")
            require(isinstance(builds, dict), "build fingerprints absent")
            for variant in ("baseline", "candidate"):
                sha256(builds[variant]["sha256"], f"{variant} build")
                positive_integer(builds[variant]["fileCount"], f"{variant} file count")
            require(builds["baseline"]["sha256"] != builds["candidate"]["sha256"],
                    "baseline and candidate builds are identical")
        rounds = report["rounds"]
        require(isinstance(rounds, list) and len(rounds) == 6, "expected exactly three pairs per format")
        seen = set()
        measurements = {fmt: {variant: {metric: [] for metric in METRICS}
                               for variant in ("baseline", "candidate")}
                        for fmt in ("csv", "xlsx")}
        sources = {}
        for pair in rounds:
            number, fmt = pair["round"], pair["format"]
            require(type(number) is int and number in (1, 2, 3) and fmt in measurements,
                    "unexpected round or format")
            require((number, fmt) not in seen, f"duplicate pair {number}/{fmt}")
            seen.add((number, fmt))
            require(list(pair["order"]) == (["baseline", "candidate"] if number % 2 else
                                            ["candidate", "baseline"]), "pair order changed")
            require(pair["packageIdentity"]["identical"] is True, "workbook parts differ")
            if number == 2 and fmt == "xlsx":
                require(pair["recoveryPackageIdentity"]["identical"] is True,
                        "cancel/retry workbook parts differ")
            else:
                require(pair["recoveryPackageIdentity"] is None,
                        "unexpected recovery result")
            pair_sources = None
            for variant in ("baseline", "candidate"):
                item = pair[variant]
                require(item["console"]["completed"] is True and
                        item["console"]["exportVerified"] is True and
                        item["console"]["rows"] == 20000 and
                        item["console"]["format"] == fmt,
                        f"{number}/{fmt}/{variant}: browser gate failed")
                hashes = item["sourceSha256"]
                require(isinstance(hashes, list) and len(hashes) == 2,
                        "expected exactly two input hashes")
                for i, item_hash in enumerate(hashes):
                    sha256(item_hash, f"source {i}")
                if pair_sources is None:
                    pair_sources = hashes
                require(hashes == pair_sources, f"{number}/{fmt}: inputs differ")
                require(fmt not in sources or sources[fmt] == hashes,
                        f"{fmt}: inputs changed between rounds")
                sha256(item["exportSha256"], "export workbook")
                worker = item["workerExport"]
                require(worker["action"] == "export" and worker["ok"] is True,
                        f"{number}/{fmt}/{variant}: worker export failed")
                if schema == "tarasuf-paired-export-2":
                    positive_integer(item["memorySamplesSuccessful"], "memory samples")
                    positive_integer(item["memorySamplesDuringExport"], "memory samples during export")
                    require(type(item["memorySamplingErrors"]) is int and
                            item["memorySamplingErrors"] == 0, "missing or invalid memory samples")
                for metric, raw in (
                    ("exportToDownloadMs", item["exportToDownloadMs"]),
                    ("workerExportMs", worker["ms"]),
                    ("exportSerializationMs", worker["timings"]["exportSerializationMs"]),
                    ("peakChromiumRssBytes", item["peakChromiumRssBytes"]),
                    ("exportBytes", item["exportBytes"]),
                ):
                    measurements[fmt][variant][metric].append(
                        positive_integer(raw, f"{number}/{fmt}/{variant}/{metric}")
                        if metric in ("peakChromiumRssBytes", "exportBytes")
                        else positive_number(raw, f"{number}/{fmt}/{variant}/{metric}"))
            sources[fmt] = pair_sources
        require(len(seen) == 6, "missing pair")
        result = {"accepted": True, "policySha256": hashlib.sha256(policy_bytes).hexdigest(),
                  "buildProvenance": "recorded" if require_build_hashes else "historical-unavailable",
                  "perFormat": {}, "reasons": []}
        limits = {
            "exportSerializationMs": -policy["minimumSerializationImprovementPct"],
            "workerExportMs": -policy["minimumWorkerExportImprovementPct"],
            "exportBytes": policy["maximumWorkbookGrowthPct"],
            "peakChromiumRssBytes": policy["maximumPeakRssGrowthPct"],
            "exportToDownloadMs": policy["maximumExportDownloadRegressionPct"],
        }
        for fmt in ("csv", "xlsx"):
            baseline = {key: median(values) for key, values in measurements[fmt]["baseline"].items()}
            candidate = {key: median(values) for key, values in measurements[fmt]["candidate"].items()}
            changes = {key: 100 * (candidate[key] / baseline[key] - 1) for key in METRICS}
            failed = [key for key, limit in limits.items() if changes[key] > limit]
            if failed:
                result["reasons"].extend(f"{fmt}: {key} exceeded declared limit" for key in failed)
            result["perFormat"][fmt] = {"baselineMedian": baseline, "candidateMedian": candidate,
                                        "changePct": changes, "passed": not failed}
        result["accepted"] = not result["reasons"]
        return result
    except (KeyError, IndexError, TypeError, ValueError) as error:
        return {"accepted": False, "policySha256": hashlib.sha256(policy_bytes).hexdigest(),
                "reasons": [f"invalid paired report: {error}"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--historical-metrics-only", action="store_true",
                        help="recompute old published metrics; cannot certify missing build provenance")
    args = parser.parse_args()
    try:
        decision = evaluate(json.loads(args.report.read_text()),
                            require_build_hashes=not args.historical_metrics_only)
    except (OSError, ValueError) as error:
        decision = {"accepted": False, "reasons": [str(error)]}
    print(json.dumps(decision, indent=2, sort_keys=True))
    return 0 if decision["accepted"] else 1


if __name__ == "__main__":
    sys.exit(main())
