#!/usr/bin/env python3
"""Targeted counterexamples for named naive algorithms, not product mutations.

Each deliberately wrong candidate below is independently written and compared
to handwritten truths. Passing means the corpus kills these simple shortcuts;
it does not establish that a future product mutation harness executed.
"""
from datetime import datetime, timezone
from decimal import Decimal
import argparse
import csv
import io
import json
from pathlib import Path
import zipfile
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent

def raw_rows(path):
    if path.suffix == ".csv":
        return list(csv.reader(io.StringIO(path.read_text(encoding="utf-8")), strict=True))
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            shared = ["".join(t.text or "" for t in si.iter("{" + ns + "}t")) for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
        sheet = ET.fromstring(z.read("xl/worksheets/original.xml"))
        out = []
        for row in sheet.findall("{" + ns + "}sheetData/{" + ns + "}row"):
            values = []
            for cell in row.findall("{" + ns + "}c"):
                if cell.get("t") == "inlineStr":
                    value = "".join(t.text or "" for t in cell.iter("{" + ns + "}t"))
                else:
                    v = cell.find("{" + ns + "}v").text
                    value = shared[int(v)] if cell.get("t") == "s" else v
                values.append(value)
            out.append(values)
        return out

def execute_candidate(case, mode):
    directory = ROOT / "fixtures" / case
    bundle = json.loads((directory / "bundle.json").read_text(encoding="utf-8"))
    grids = bundle["suppliedParsedGrids"] if mode == "trust-cache" else [raw_rows(directory / p) for p in bundle["files"]]
    rows = [[dict(zip(grid[0], row)) for row in grid[1:] if row] for grid in grids]
    gross = refunds = Decimal(0)
    for transaction in rows[0]:
        amount = Decimal(transaction["Signed amount"])
        kind = transaction["Kind"]
        if mode == "derive-kind":
            kind = "sale" if amount >= 0 else "refund"
        if mode in ("abs-first", "derive-kind", "drop-negative-zero", "trust-cache", "infer-fees", "net-only"):
            amount = abs(amount)
        if kind == "sale":
            gross += amount
        else:
            refunds += amount
    fees = sum((Decimal(r["Amount"]) for r in rows[1]), Decimal(0))
    summary = rows[2][0]
    if mode == "infer-fees" and not rows[1]:
        fees = Decimal(summary["Fees"])
    totals = [gross, refunds, fees, gross - refunds - fees]
    residuals = [a - Decimal(summary[h]) for a, h in zip(totals, ["Gross sales", "Refunds", "Fees", "Net"])] + [Decimal(summary["Net"]) - Decimal(rows[3][0]["Credit"])]
    if mode == "net-only":
        residuals = residuals[3:]
    missing = Decimal(summary["Fees"]) > 0 and not rows[1] and mode != "infer-fees"
    prediction = "missing" if missing else "difference" if any(residuals) else "ready"
    return prediction, {"totals": list(map(str, totals)), "consideredResiduals": list(map(str, residuals)), "inputFilesRead": bundle["files"]}

def main(output_dir=ROOT):
    output_dir.mkdir(parents=True, exist_ok=True)
    truth = json.loads((ROOT / "handcrafted_truths.json").read_text(encoding="utf-8"))
    candidates = [
        {"candidate": "absolute-before-kind-validation", "mode": "abs-first", "fixture": "negative-sale-negative", "reason": "abs(-100) becomes sale magnitude100 and source-error becomes financial difference"},
        {"candidate": "derive-kind-from-sign", "mode": "derive-kind", "fixture": "negative-refund-positive", "reason": "positive explicit refund silently becomes sale; invalid source downgraded to arithmetic difference"},
        {"candidate": "negative-zero-after-numeric-coercion", "mode": "drop-negative-zero", "fixture": "negative-native-negative-zero", "reason": "abs drops original minus sign and source-error becomes financial difference"},
        {"candidate": "infer-fee-from-summary-or-net", "mode": "infer-fees", "fixture": "missing-positive-fee-detail", "reason": "inventing fee3 restores net127 but there is no supplied independent fee row"},
        {"candidate": "compare-net-only", "mode": "net-only", "fixture": "sar-component-cancellation", "reason": "gross101/refund21 and actual100/refund20 have equal net77; gross/refund residuals survive"},
        {"candidate": "trust-supplied-native-grid", "mode": "trust-cache", "fixture": "negative-native-cache-mismatch", "reason": "forged grid999 is arithmetic difference; raw numeric OOXML100 and cached999 require source-error"},
    ]
    # Actual calculations in the intentionally wrong candidates demonstrate the
    # shortcuts. Values here are authored constants matching physical fixtures.
    assert abs(Decimal("-100")) == Decimal("100")
    assert ("sale" if Decimal("+100") >= 0 else "refund") == "sale"
    assert int(Decimal("-0.00")) == 0
    assert Decimal("150") - Decimal("20") - Decimal("127") == Decimal("3")
    assert Decimal("101") - Decimal("21") - Decimal("3") == Decimal("100") - Decimal("20") - Decimal("3")
    assert Decimal("999.00") != Decimal("+100.00")
    for candidate in candidates:
        prediction, evidence = execute_candidate(candidate["fixture"], candidate["mode"])
        expected = truth[candidate["fixture"]]["financial"]
        assert prediction != expected
        candidate.update({"computedWrongPrediction": prediction, "executedArithmetic": evidence, "handDeclaredTruth": expected, "killed": True})
    receipt = {"executedAtUTC": datetime.now(timezone.utc).isoformat(), "kind": "independent naive-candidate falsification", "productMutationRunnerExecuted": False, "candidateCount": len(candidates), "killedCount": len(candidates), "passed": True, "candidates": candidates}
    (output_dir / "falsification_receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": True, "naiveCandidatesKilled": len(candidates), "productMutationsExecuted": 0}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=ROOT)
    main(parser.parse_args().output_dir)
