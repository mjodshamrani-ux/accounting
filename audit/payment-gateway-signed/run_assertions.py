#!/usr/bin/env python3
"""Compare independent oracle output against literal handwritten declarations."""
import hashlib
import argparse
import json
from pathlib import Path
import sys
from datetime import datetime, timezone
from oracle import evaluate, identity, InvalidSource, money

ROOT = Path(__file__).resolve().parent

def check(output_dir=ROOT):
    output_dir.mkdir(parents=True, exist_ok=True)
    expected = json.loads((ROOT / "handcrafted_truths.json").read_text(encoding="utf-8"))
    all_results = {}
    checks = []
    for name, truth in expected.items():
        actual = evaluate(ROOT / "fixtures" / name / "bundle.json")
        all_results[name] = actual
        for field in ("financial", "totalsMinor", "residualsMinor", "missing"):
            if field in truth:
                assert actual[field] == truth[field], (name, field, actual[field], truth[field])
        actual_codes = sorted(set(i["code"] for i in actual["issues"]))
        if "issueCodes" in truth:
            assert actual_codes == truth["issueCodes"], (name, actual_codes, truth["issueCodes"])
        for code in truth.get("requiredIssueCodes", []):
            assert code in actual_codes, (name, "missing expected issue", code, actual_codes)
        checks.append({"case": name, "passed": True, "financial": actual["financial"], "actualIssueCodes": actual_codes})
    pairs = []
    for name, truth in expected.items():
        if "formatEquivalentTo" in truth:
            counterpart = truth["formatEquivalentTo"]
            for field in ("financial", "totalsMinor", "residualsMinor", "missing", "signedProvenance"):
                assert all_results[name][field] == all_results[counterpart][field], (name, "format equivalence", field)
            for a, b in zip(all_results[name]["inventory"], all_results[counterpart]["inventory"]):
                assert {k: v for k, v in a.items() if k != "lineSpan"} == {k: v for k, v in b.items() if k != "lineSpan"}, (name, "inventory equivalence")
            assert len(all_results[name]["inventory"]) == len(all_results[counterpart]["inventory"])
            pairs.append({"xlsx": name, "csv": counterpart, "passed": True, "compared": ["financial", "totals", "residuals", "missing", "raw money/sign provenance", "raw grid inventory and rows"]})
    # These are additional literal assertions, not expected values copied out of
    # calculation: physical record positions and preserved lexical signs matter.
    mixed = all_results["sar-mixed"]["signedProvenance"]
    assert [(p["physicalRow"], p["rawLexeme"], p["originalSign"], p["signedMinor"], p["canonicalMagnitudeMinor"]) for p in mixed] == [(2, "+100.00", "+", 10000, 10000), (3, "-20.00", "-", -2000, 2000), (4, "50", "unsigned", 5000, 5000)]
    assert [p["physicalRow"] for p in all_results["sar-blank-row-permutation"]["signedProvenance"]] == [3, 5, 6]
    assert [(p["kind"], p["originalSign"]) for p in all_results["sar-zero-kinds"]["signedProvenance"]] == [("sale", "unsigned"), ("refund", "+"), ("sale", "+"), ("refund", "unsigned")]
    assert len(all_results["sar-zero-kinds"]["signedProvenance"]) == 4
    assert len(all_results["sar-zero-kinds"]["memberIds"]) == 7
    assert len(all_results["negative-duplicate-transaction-even-invalid"]["memberIds"]) == 8
    assert [p["rawLexeme"] for p in all_results["sar-arabic-persian"]["signedProvenance"]] == ["+١٢٫٥٠", "-۲٫۵۰"]
    assert [(p["normalizedLexeme"], p["signedMinor"]) for p in all_results["sar-arabic-persian"]["signedProvenance"]] == [("+12.50", 1250), ("-2.50", -250)]
    assert all(len({s["sha256"] for s in r["sources"]}) == 4 for r in all_results.values() if r["sources"])
    identity("😀" * 250)
    identity("😀" * 1000, relaxed=True)
    assert money("+" + "0" * 5000 + "7.00", 2, signed=True, kind="sale")[0] == 700
    try:
        money("1" + "0" * 5000 + ".00", 2, signed=True, kind="sale")
        raise AssertionError("long raw amount escaped bound")
    except InvalidSource as exc:
        assert str(exc) == "AMOUNT_BOUND"
    valid_names = [name for name, t in expected.items() if t["financial"] in ("ready", "difference") and "formatEquivalentTo" not in t]
    topology_groups = {}
    for name in valid_names:
        actual = all_results[name]
        p = actual["signedProvenance"]
        key = json.dumps({"nonzeroSaleRows": sum(v["kind"] == "sale" and v["canonicalMagnitudeMinor"] > 0 for v in p), "nonzeroRefundRows": sum(v["kind"] == "refund" and v["canonicalMagnitudeMinor"] > 0 for v in p), "zeroSaleRows": sum(v["kind"] == "sale" and v["canonicalMagnitudeMinor"] == 0 for v in p), "zeroRefundRows": sum(v["kind"] == "refund" and v["canonicalMagnitudeMinor"] == 0 for v in p), "feeRows": sum(v["source"] == 1 and v["kind"] == "fee-evidence" for v in actual["inventory"])}, sort_keys=True)
        topology_groups.setdefault(key, []).append(name)
    named_controls = ["mixed raw/sign/minor/row tuple", "blank logical-record row positions", "explicit zero kinds/signs", "four zero transactions retained", "all seven zero-case members retained", "invalid duplicate row retained in eight-member set", "Arabic/Persian original raw text retained", "Arabic/Persian normalized signed minors", "four independent original hashes per loaded bundle", "500 UTF16-unit identity boundary accepted", "2000 UTF16-unit reference boundary accepted", "5000 leading zeros preserve exact minor units", "5001 integer digits reject at bound without Decimal rounding"]
    counts = {"totalSyntheticBundles": len(expected), "validSourceCases": len(valid_names), "financialReadySourceCases": sum(expected[n]["financial"] == "ready" for n in valid_names), "financialDifferenceSourceCases": sum(expected[n]["financial"] == "difference" for n in valid_names), "distinctSemanticTopologyGroups": len(topology_groups), "formatEquivalenceBundles": len(pairs), "negativeOrMissingBundles": len(expected) - len(valid_names) - len(pairs), "csvOriginalFiles": len(list((ROOT / "fixtures").glob("*/*.csv"))), "xlsxOriginalFiles": len(list((ROOT / "fixtures").glob("*/*.xlsx"))), "realFieldBundles": 0}
    receipt = {"executedAtUTC": datetime.now(timezone.utc).isoformat(), "python": sys.version, "command": "python3 -B oracle/run_assertions.py", "scope": "Independent pre-product oracle against handcrafted synthetic truth only", "productImported": False, "productExecuted": False, "oldReferenceImported": False, "releaseTestsRerun": False, "clientSessionBrowserCIExercised": False, "counts": counts, "caseAssertions": checks, "semanticTopologyGroups": [{"topology": json.loads(key), "cases": value} for key, value in topology_groups.items()], "formatEquivalenceAssertions": pairs, "namedAdditionalControls": named_controls, "passed": True}
    (output_dir / "actual_results.json").write_text(json.dumps(all_results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "oracle_receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": True, **counts}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=ROOT)
    check(parser.parse_args().output_dir)
