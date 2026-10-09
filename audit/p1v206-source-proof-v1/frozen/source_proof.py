#!/usr/bin/env python3
"""Standalone finite source proof. No engine imports, writes, or network calls."""

import csv
from decimal import Decimal
import hashlib
import io
import itertools
import json
from pathlib import Path


FROZEN = Path(__file__).resolve().parent
ROOT = FROZEN.parents[2]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_rows(data, header):
    rows = list(csv.reader(io.StringIO(data.decode("utf-8"), newline="")))
    require(rows[0] == header, "Native CSV header differs from frozen contract")
    require(len(rows) == 5, "Proof requires exactly four native movement rows")
    require(all(len(row) == len(header) for row in rows[1:]), "Invalid row width")
    require(all(Decimal(row[5]).is_finite() for row in rows[1:]), "Nonfinite amount")
    return rows[1:]


def compatible(a, b, missing):
    return (
        a[1] == b[1]
        and a[0] == b[0]
        and a[6] == b[6]
        and Decimal(a[5]) == Decimal(b[5])
        and (a[2] in missing or b[2] in missing or a[2] == b[2])
    )


def enumerate_bijections(left, right, missing):
    candidates = []
    for order in itertools.permutations(range(4)):
        if all(compatible(left[i], right[j], missing) for i, j in enumerate(order)):
            candidates.append(tuple((i + 2, j + 2) for i, j in enumerate(order)))
    return candidates


def forced_pairs(candidates):
    require(bool(candidates), "No compatible complete bijection")
    return sorted(set.intersection(*(set(candidate) for candidate in candidates)))


def main():
    manifest = json.loads((FROZEN / "MANIFEST.json").read_bytes())
    for name, expected in manifest["frozenArtifactSha256"].items():
        require(digest((FROZEN / name).read_bytes()) == expected, "Frozen artifact changed: " + name)
    sources = {}
    for name, expected in manifest["originalSourceSha256"].items():
        data = (ROOT / name).read_bytes()
        require(digest(data) == expected, "Original source changed: " + name)
        sources[name] = data
    contract = json.loads((FROZEN / "contract.json").read_bytes())
    original = contract["original"]
    required = {tuple(pair) for pair in original["requiredAutoPairs"]}
    source_contracts = json.loads(sources[contract["originalContractFile"]])
    cases = source_contracts["cases"]
    source_case = next(case for case in cases if case["id"] == contract["originalCaseId"])
    for key in ("requiredAutoPairs", "forbidOtherAutoPairs", "forbidAutoGroups", "readPolicy", "decisions"):
        require(source_case[key] == original[key], "Original acceptance changed: " + key)
    header = contract["header"]
    missing = set(contract["proofAssumptions"]["missingMarkers"])
    left = read_rows(sources[original["supplierFile"]], header)
    right = read_rows(sources[original["ledgerFile"]], header)
    require(left == original["supplierRows"], "Supplier facts differ from manual contract")
    require(right == original["ledgerRows"], "Ledger facts differ from manual contract")
    candidates = enumerate_bijections(left, right, missing)
    forced = forced_pairs(candidates)
    neither = [candidate for candidate in candidates if not required.intersection(candidate)]
    require(len(candidates) == original["expectedCompatibleBijectionCount"], "Original candidate count differs")
    require(forced == [tuple(pair) for pair in original["expectedForcedPairs"]], "Original forced pairs differ")
    require(len(neither) == original["expectedNeitherRequiredPairBijectionCount"], "Neither-pair count differs")
    witness = tuple(tuple(pair) for pair in original["witnessPairs"])
    require(witness in neither, "Witness is incompatible or includes a required pair")
    completion = original["witnessMissingReferenceCompletion"]
    completed = []
    for side, rows in (("supplier", left), ("ledger", right)):
        filled = [row.copy() for row in rows]
        for item in completion[side]:
            index = item["row"] - 2
            require(filled[index][2] in missing, "Witness replaces a usable native reference")
            filled[index][2] = item["hypotheticalReference"]
        require(all(row[2] not in missing for row in filled), "Incomplete hypothetical witness")
        completed.append(filled)
    require(all(compatible(completed[0][s - 2], completed[1][l - 2], missing) for s, l in witness), "Hypothetical completion does not support witness")
    control = contract["positiveControl"]
    positive_rows = []
    for side in ("supplier", "ledger"):
        data = control[side + "Csv"].encode("utf-8")
        require(digest(data) == manifest["positiveControlCsvSha256"][side], "Positive source bytes changed")
        rows = read_rows(data, header)
        require(all(row[2] not in missing for row in rows), "Positive control has a missing reference")
        require(len({row[2] for row in rows}) == 4, "Positive control references are not distinct")
        positive_rows.append(rows)
    positive_candidates = enumerate_bijections(*positive_rows, missing)
    positive_forced = forced_pairs(positive_candidates)
    require(len(positive_candidates) == control["expectedCompatibleBijectionCount"], "Positive candidate count differs")
    require(positive_forced == [tuple(pair) for pair in control["expectedForcedPairs"]], "Positive forced pairs differ")
    require(required.issubset(positive_forced) == control["expectedOriginalRequiredPairsForced"], "Positive required-pair property differs")
    print(json.dumps({
        "proofId": contract["id"],
        "sourceProofStatus": "PASS",
        "originalPositiveRequirementStatus": "UNFULFILLED_BY_NATIVE_EVIDENCE",
        "originalRequiredAutoPairs": original["requiredAutoPairs"],
        "compatibleBijectionCount": len(candidates),
        "forcedPairs": forced,
        "requiredPairsForced": [list(pair) for pair in sorted(required.intersection(forced))],
        "neitherRequiredPairBijectionCount": len(neither),
        "hypotheticalWitnessPairs": witness,
        "hypotheticalMissingReferenceCompletion": completion,
        "positiveControlCompatibleBijectionCount": len(positive_candidates),
        "positiveControlForcedPairs": positive_forced,
        "approvalAuthority": False,
        "interpretation": contract["proofAssumptions"]["safetyConclusion"],
        "compatibleBijections": candidates,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
