#!/usr/bin/env python3
"""Run three ordered browser pairs against two explicitly built test distributions.

Both distributions must have the same version and fixed test-only export clock.
The browser harness fixes the UI clock and verifies source rows and exact matches.
Raw reports and workbooks stay in --output outside the repository.
"""

import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys

from accept_paired import bundle_sha256, evaluate


ROOT = Path(__file__).resolve().parents[2]
CHECK_PACKAGE = ROOT / "audit/export-design/check_package_identity.py"
BROWSER = ROOT / "scripts/browser-performance.mjs"
FIXED_CLOCK = "2026-07-31T12:00:00.000Z"


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def command(arguments):
    result = subprocess.run(arguments, text=True, capture_output=True, check=False)
    require(result.returncode == 0,
            f"command failed ({result.returncode}): {arguments[0]}\n{result.stdout[-1500:]}\n{result.stderr[-1500:]}")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-dist", type=Path, required=True)
    parser.add_argument("--candidate-dist", type=Path, required=True)
    parser.add_argument("--fixtures-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    result = {
        "schema": "tarasuf-paired-export-2",
        "platform": platform.platform(),
        "machine": platform.machine(),
        "node": command([args.node, "--version"]).strip(),
        "clock": FIXED_CLOCK,
        "distributions": {
            "baseline": str(args.baseline_dist.resolve()),
            "candidate": str(args.candidate_dist.resolve()),
        },
        "distributionSha256": {
            "baseline": bundle_sha256(args.baseline_dist),
            "candidate": bundle_sha256(args.candidate_dist),
        },
        "fixturesDir": str(args.fixtures_dir.resolve()),
        "measurementCompleted": False,
        "rounds": [],
    }
    report_path = args.output / "results.json"
    try:
        for round_number in range(1, 4):
            order = ("baseline", "candidate") if round_number % 2 else ("candidate", "baseline")
            for fmt in ("csv", "xlsx"):
                reports = {}
                for variant in order:
                    output = args.output / f"round-{round_number}-{fmt}-{variant}"
                    output.mkdir(exist_ok=True)
                    cmd = [args.node, str(BROWSER),
                           f"--dist={result['distributions'][variant]}",
                           f"--fixtures-dir={args.fixtures_dir.resolve()}",
                           f"--output={output}", "--sizes=20000", f"--formats={fmt}",
                           f"--fixed-clock={FIXED_CLOCK}"]
                    if round_number == 2 and fmt == "xlsx":
                        cmd.append("--lifecycle=yes")
                    summary = command(cmd).strip().splitlines()[-1]
                    run = json.loads((output / "results.json").read_text())["runs"][0]
                    require(run["completed"] and run["independentExportMembershipCheck"]
                            and run["independentExportSourceCheck"], f"failed browser gate: {output}")
                    require(run["memorySamplesSuccessful"] > 0 and
                            run["memorySamplesDuringExport"] > 0 and
                            run["memorySamplingErrors"] == 0 and
                            run["peakChromiumRssBytes"] > 0,
                            f"missing Chromium memory measurement: {output}")
                    reports[variant] = {
                        "output": str(output),
                        "console": json.loads(summary),
                        "sourceSha256": run["sourceSha256"],
                        "exportBytes": (output / f"export-20000-{fmt}.xlsx").stat().st_size,
                        "exportSha256": digest(output / f"export-20000-{fmt}.xlsx"),
                        "exportToDownloadMs": run["stages"]["exportToDownloadMs"],
                        "totalUiMs": run["stages"]["totalUiMs"],
                        "peakChromiumRssBytes": run["peakChromiumRssBytes"],
                        "memorySamplesSuccessful": run["memorySamplesSuccessful"],
                        "memorySamplesDuringExport": run["memorySamplesDuringExport"],
                        "memorySamplingErrors": run["memorySamplingErrors"],
                        "workerExport": next(action for action in run["workerActions"] if action["action"] == "export"),
                        "independentExportSourceCheck": run["independentExportSourceCheck"],
                        "independentExportMembershipCheck": run["independentExportMembershipCheck"],
                        "cancelAndExportRecovery": run.get("cancelAndExportRecovery", False),
                        "independentRecoveryExportCheck": run.get("independentRecoveryExportCheck", False),
                        "independentRecoveryMembershipCheck": run.get("independentRecoveryMembershipCheck", False),
                    }
                    print(json.dumps({"round": round_number, "format": fmt, "variant": variant,
                                      "exportToDownloadMs": round(reports[variant]["exportToDownloadMs"]),
                                      "workerExportMs": round(reports[variant]["workerExport"]["ms"])}), flush=True)
                require(reports["baseline"]["sourceSha256"] == reports["candidate"]["sourceSha256"],
                        "input file bytes differ between variants")
                baseline = Path(reports["baseline"]["output"])
                candidate = Path(reports["candidate"]["output"])
                original = baseline / f"export-20000-{fmt}.xlsx"
                compressed = candidate / f"export-20000-{fmt}.xlsx"
                package = json.loads(command([sys.executable, str(CHECK_PACKAGE), str(original), str(compressed)]))
                require(package["identical"], f"workbook parts differ: {package}")
                recovery = None
                if round_number == 2 and fmt == "xlsx":
                    for data in reports.values():
                        require(data["cancelAndExportRecovery"] and data["independentRecoveryExportCheck"]
                                and data["independentRecoveryMembershipCheck"], "cancel/retry verification failed")
                    recovery = json.loads(command([sys.executable, str(CHECK_PACKAGE),
                                                   str(baseline / "cancel-recovery-20000.xlsx"),
                                                   str(candidate / "cancel-recovery-20000.xlsx")]))
                    require(recovery["identical"], "cancel/retry workbook content differs")
                result["rounds"].append({"round": round_number, "format": fmt, "order": order,
                                         "baseline": reports["baseline"], "candidate": reports["candidate"],
                                         "packageIdentity": package, "recoveryPackageIdentity": recovery})
                report_path.write_text(json.dumps(result, indent=2) + "\n")
        result["distributionSha256After"] = {
            variant: bundle_sha256(result["distributions"][variant])
            for variant in ("baseline", "candidate")
        }
        for variant in ("baseline", "candidate"):
            require(result["distributionSha256After"][variant] == result["distributionSha256"][variant],
                    f"{variant} build changed during measurement")
        result["measurementCompleted"] = True
        result["acceptance"] = evaluate(result)
        report_path.write_text(json.dumps(result, indent=2) + "\n")
        require(result["acceptance"]["accepted"],
                f"performance acceptance failed: {result['acceptance']['reasons']}")
        return 0
    except (AssertionError, OSError, KeyError, ValueError, IndexError) as error:
        result["failure"] = str(error)
        report_path.write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps({"failure": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
