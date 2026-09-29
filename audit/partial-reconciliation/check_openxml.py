#!/usr/bin/env python3
"""Independent ZIP/XML check of a PR01 partial-result export; standard library only.

Financial truth comes from the frozen literal contract, never the candidate engine.
Workbook sheet/header adapters may be completed against the export schema before
the first check. No candidate engine is invoked by this script.
"""

import argparse
import csv
import datetime as dt
import hashlib
import json
import posixpath
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

BASE = Path(__file__).resolve().parent
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
FROZEN_HASH = "0b10b982659d984e9298082c0a76bb183fcd6d30abb8c34a5be520fed9a57e7e"
BROWSER_ORACLES = {
    "892a5d52634752a1b976cfb25836381ae054c4c72fb706d9e6df8234f983cbc6": {
        "id": "browser-original-displaced-amount",
        "scope": "Original unread-1..13 completion contract. Still requires both positive pairs; its recorded completion miss is not reclassified as a pass.",
    },
    "c2d5a00ade4e27354e3e9a24bc8136b371ef1728c2516253dc55630a1adf2ac3": {
        "id": "browser-isolated-amount",
        "scope": "Separately authored plain-unread positive contract. Passing this contract does not satisfy the original unread-1..13 contract.",
    },
}


def need(test, message):
    if not test:
        raise AssertionError(message)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def frozen():
    manifest = BASE / "frozen/SHA256SUMS"
    need(sha(manifest) == FROZEN_HASH, "Frozen manifest changed")
    for line in manifest.read_text().splitlines():
        expected, name = line.split("  ", 1)
        need(sha(manifest.parent / name) == expected, "Frozen file changed: " + name)
    return FROZEN_HASH


class Workbook:
    def __init__(self, filename):
        with zipfile.ZipFile(filename) as z:
            need(z.testzip() is None, "ZIP CRC failure")
            need(len(z.namelist()) == len(set(z.namelist())), "Duplicate ZIP entries")
            need(not any("vbaProject" in n or n.startswith("xl/externalLinks/") for n in z.namelist()), "Unexpected external workbook or macros")
            parts = {n: ET.fromstring(z.read(n)) for n in z.namelist() if n.endswith((".xml", ".rels"))}
        self.xml_parts = len(parts)
        shared = ["".join(e.itertext()) for e in parts["xl/sharedStrings.xml"].findall("s:si", NS)]
        relations = {e.get("Id"): e for e in parts["xl/_rels/workbook.xml.rels"]}
        book = parts["xl/workbook.xml"]
        props = book.find("s:workbookPr", NS)
        need(props is None or props.get("date1904", "0") in ("0", "false"), "Unexpected Excel date epoch")
        self.sheets = {}
        for s in book.findall("s:sheets/s:sheet", NS):
            rel = relations[s.get(RID)]
            need(rel.get("TargetMode") != "External", "External sheet")
            name = posixpath.normpath(posixpath.join("xl", rel.get("Target"))).lstrip("/")
            rows = []
            for r in parts[name].findall("s:sheetData/s:row", NS):
                cells = {}
                for c in r.findall("s:c", NS):
                    column = re.sub(r"\d", "", c.get("r"))
                    need(column not in cells, "Duplicate cell address")
                    v = c.find("s:v", NS)
                    value = v.text if v is not None and v.text is not None else ""
                    kind = c.get("t", "n")
                    if kind == "s":
                        value = shared[int(value)]
                    if kind == "inlineStr":
                        value = "".join(c.find("s:is", NS).itertext())
                    cells[column] = {"value": value, "kind": kind, "formula": c.find("s:f", NS) is not None, "address": c.get("r")}
                rows.append(cells)
            self.sheets[s.get("name")] = rows

    def records(self, name):
        need(name in self.sheets, "Missing sheet: " + name)
        rows = self.sheets[name]
        headers = {column: cell["value"] for column, cell in rows[0].items()}
        return [{headers[column]: cell for column, cell in row.items()} for row in rows[1:]]

    def fields(self, name):
        return {row["A"]["value"]: row.get("B", {"value": "", "kind": "n", "formula": False}) for row in self.sheets[name][1:] if "A" in row}


def val(cell):
    need(not cell["formula"], "Unexpected formula in original/evidence cell")
    return cell["value"]


def pick(row, names):
    present = [name for name in names if name in row]
    need(len(present) == 1, "Missing/ambiguous schema field: " + "/".join(names))
    return row[present[0]]


def text(cell, expected):
    need(val(cell) == expected, f"Literal mismatch {val(cell)!r} != {expected!r}")
    if expected:
        need(cell["kind"] in ("s", "inlineStr"), "Original text was coerced to a number")


def number(cell, expected):
    need(cell["kind"] == "n" and val(cell) != "", "Expected native numeric cell")
    need(Decimal(val(cell)) == Decimal(expected), f"Numeric mismatch {val(cell)} != {expected}")


def summary_count(cell, expected):
    # Exported Summary counters are generated Excel formulas with cached values.
    # Compare their numeric caches to independently counted raw worksheet rows;
    # this does not execute/recalculate formulas or permit source-cell formulas.
    need(cell["kind"] == "n" and cell["value"] != "", "Summary count must have a native numeric cache")
    need(Decimal(cell["value"]) == Decimal(expected), "Summary counter differs from actual source/evidence rows")


def native_date(cell, expected):
    number(cell, (dt.date.fromisoformat(expected) - dt.date(1899, 12, 30)).days)


def money(cell, expected_minor):
    number(cell, Decimal(expected_minor) / 100)


def load_contract(case_id, browser_oracle):
    if browser_oracle:
        oracle_hash = sha(browser_oracle)
        need(oracle_hash in BROWSER_ORACLES, "Unknown or changed browser literal oracle")
        descriptor = BROWSER_ORACLES[oracle_hash]
        oracle = json.loads(browser_oracle.read_text())
        case = {"id": descriptor["id"], "requiredAutoGroups": []}
        for side in ("supplier", "ledger"):
            source = browser_oracle.parent / f"partial-{side}.csv"
            need(sha(source) == oracle["fileSha256"][side], "Browser original CSV changed")
            with source.open(newline="") as stream:
                rows = list(csv.reader(stream))
            need(rows[0] == ["Date", "Reference", "Amount", "Description"], "Browser input schema changed")
            issue_by_row = {r["row"]: r for r in oracle["readingIssues"] if r["side"] == side}
            facts = []
            for number, raw in enumerate(rows[1:], 2):
                fact = {"row": number, "values": raw, "disposition": "error" if number in issue_by_row else "transaction"}
                if number in issue_by_row:
                    need(raw == issue_by_row[number]["rawValues"], "Browser error raw cells differ from oracle")
                    need(issue_by_row[number]["sheet"] == "CSV" and issue_by_row[number]["page"] is None, "Browser issue source trace changed")
                else:
                    amount = Decimal(raw[2]) * 100
                    need(amount == int(amount), "Browser literal amount is not exact minor units")
                    fact.update(date=raw[0], reference=raw[1], amountMinor=int(amount), currency="SAR")
                facts.append(fact)
            need(sum(f["amountMinor"] for f in facts if f["disposition"] == "transaction") == oracle["validTotalMinorPerSide"], "Browser literal subtotal disagrees with oracle")
            case[side] = {"file": str(source), "sourcePath": source, "header": rows[0], "expectedRows": facts, "mapping": {"amount": 2, "reference": 1}}
        for left, right in oracle["requiredPairs"]:
            need(left.startswith("supplier:0:") and right.startswith("ledger:0:"), "Browser pair ID roles changed")
            case["requiredAutoGroups"].append({"supplierRows": [int(left.split(":")[-1])], "ledgerRows": [int(right.split(":")[-1])]})
        provenance = {"oracleSha256": oracle_hash, "sourceSha256": oracle["fileSha256"], "contractScope": descriptor["scope"],
                      "originalCompletionMiss": "audit/partial-input/browser/original-contract-miss.json"}
    else:
        data = json.loads((BASE / "frozen/contracts.json").read_text())
        case = next(c for c in data["cases"] if c["id"] == case_id)
        need(case_id == "PR01", "Select PR01 or supply the independent browser oracle")
        for side in ("supplier", "ledger"):
            case[side]["sourcePath"] = BASE / "frozen" / case[side]["file"]
        provenance = {"manifestSha256": FROZEN_HASH}
    return case, provenance


def verify(filename, case_id, require_reviewed, browser_oracle, observations, expected_engine="0.3.21-experimental"):
    case, source_provenance = load_contract(case_id, browser_oracle)
    book = Workbook(filename)
    facts = {}
    invalid = {}
    subtotal = {}
    for side, sheet in (("supplier", "Supplier transactions"), ("ledger", "Ledger transactions")):
        definition = case[side]
        subtotal[side] = sum(f["amountMinor"] for f in definition["expectedRows"] if f["disposition"] == "transaction")
        for f in definition["expectedRows"]:
            identity = f"{side}:0:{f['row']}"
            (invalid if f["disposition"] == "error" else facts)[identity] = (side, f)
        expected = {key: f for key, (which, f) in facts.items() if which == side and f["disposition"] == "transaction"}
        rows = book.records(sheet)
        need(len(rows) == len(expected), "Readable transaction count differs: " + side)
        seen = set()
        for row in rows:
            identity = val(row["المعرف"])
            need(identity in expected and identity not in seen, "Unknown/duplicate source transaction: " + identity)
            seen.add(identity)
            f = expected[identity]
            number(row["صف المصدر"], f["row"])
            text(row["الورقة"], "CSV")
            native_date(row["التاريخ"], f["date"])
            money(row["المبلغ الموحد"], f["amountMinor"])
            text(row["المبلغ الأصلي"], f["values"][definition["mapping"]["amount"]])
            # Document No and the selected Reference are distinct legitimate
            # roles. Exact selected cells are checked in Parsed Source below.
            need(val(row["المرجع الأصلي"]) in (f["values"][1], f["reference"]), "Displayed original identity absent from source")
        parsed = book.records("Parsed " + side.title() + " Source")
        expected_raw = {1: definition["header"], **{f["row"]: f["values"] for f in definition["expectedRows"]}}
        need(len(parsed) == len(expected_raw), "Incomplete original source rows")
        seen = set()
        for row in parsed:
            source_row = int(val(row["صف المصدر"]))
            need(source_row in expected_raw and source_row not in seen, "Unknown/duplicate parsed row")
            seen.add(source_row)
            for index, expected_cell in enumerate(expected_raw[source_row], 1):
                text(row[f"عمود {index}"], expected_cell)

    issues = book.records("Reading Issues")
    need(len(issues) == len(invalid), "Missing or extra invalid rows in Reading Issues")
    issue_ids = set()
    issue_details = []
    for row in issues:
        # Reading Issues exports separate source provenance columns, not the
        # opaque engine ID used by Match Evidence. These single-CSV contracts
        # bind sheet 0, so reconstruct the contract ID from side + source row.
        side_value = val(pick(row, ["Side", "الطرف"]))
        side = {"المورد": "supplier", "الدفتر": "ledger"}.get(side_value, side_value)
        need(side in ("supplier", "ledger"), "Invalid Reading Issues side")
        source_row_cell = pick(row, ["Source Row", "Row", "صف المصدر"])
        source_row = int(val(source_row_cell))
        identity = f"{side}:0:{source_row}"
        need(identity in invalid and identity not in issue_ids, "Unknown/duplicate Reading Issues row: " + identity)
        issue_ids.add(identity)
        expected_side, f = invalid[identity]
        need(side == expected_side, "Invalid row side changed")
        need(side_value in (side, "المورد" if side == "supplier" else "الدفتر"), "Invalid row side changed")
        text(pick(row, ["Source Sheet", "Sheet", "الورقة"]), "CSV")
        number(source_row_cell, f["row"])
        for label in ("PDF Page", "صفحة PDF"):
            if label in row:
                text(row[label], "")
        for label in ("Source File", "Filename", "Source Name", "اسم الملف"):
            if label in row:
                text(row[label], Path(case[side]["file"]).name)
        raw_cell = pick(row, ["Original Cells", "Raw Cells", "Raw Values", "Original Values", "Original Row", "القيم الأصلية", "الخلايا الأصلية", "المحتوى الأصلي"])
        need(raw_cell["kind"] in ("s", "inlineStr"), "Invalid original row is not text")
        need(json.loads(val(raw_cell)) == f["values"], "Invalid row original cells differ")
        reason = val(pick(row, ["Reason", "Error", "Issue", "Message", "Reading Issue", "سبب الخطأ", "سبب عدم القراءة", "السبب", "رسالة الخطأ"]))
        need(bool(reason.strip()) and re.search(r"مبلغ|amount|money|رقم|numeric", reason, re.I), "Missing specific amount error reason")
        # Provenance row/page indexes may be numbers; unread money may not.
        for header, cell in row.items():
            need(not cell["formula"], "Formula in Reading Issues")
            if re.search(r"amount|مبلغ", header, re.I):
                need(cell["kind"] in ("s", "inlineStr") or not val(cell), "Invalid amount invented as a numeric cell")
        issue_details.append({"sourceRowId": identity, "reason": reason, "originalAmount": f["values"][case[side]["mapping"]["amount"]]})

    observations["originalSourcePreservation"] = {"passed": True, "readableRows": len(facts), "readingIssues": issue_details,
        "issueTraceEncoding": "Source File + Side + Source Sheet CSV + Source Row; contract IDs reconstructed for selected sheet 0"}
    summary_observation = check_summary(book, subtotal, invalid, len(facts), require_reviewed)
    observations["partialSummaryAndReview"] = summary_observation
    metadata = book.fields("Export Metadata")
    text(metadata["Engine version"], expected_engine)
    for side in ("supplier", "ledger"):
        text(metadata[side.title() + " SHA-256"], sha(case[side]["sourcePath"]))
    observations["originalSourceHashBinding"] = {"passed": True, "sourceProvenance": source_provenance}

    required = {tuple([tuple(g["supplierRows"]), tuple(g["ledgerRows"])]) for g in case["requiredAutoGroups"]}
    observations["requiredCompletion"] = {"requiredPairs": len(required), "actualMatchedCases": len(book.records("Matches")),
        "requiredMemberSets": case["requiredAutoGroups"]}
    cases = defaultdict(lambda: {"supplier": [], "ledger": []})
    evidence = book.records("Match Evidence")
    expected_matched_ids = {f"{side}:0:{r}" for g in case["requiredAutoGroups"] for side in ("supplier", "ledger") for r in g[side + "Rows"]}
    seen = set()
    for row in evidence:
        identity = val(row["Source Row ID"])
        need(identity in facts and identity not in seen, "Unknown/duplicate evidence member")
        seen.add(identity)
        side, f = facts[identity]
        text(row["Side"], side)
        number(row["Source Row"], f["row"])
        native_date(row["Date"], f["date"])
        money(row["Amount"], f["amountMinor"])
        text(row["Currency"], "SAR")
        if val(row["Status"]) == "Matched":
            need(identity in expected_matched_ids, "False approved readable member")
            cases[val(row["Case ID"])][side].append(f["row"])
        else:
            need(identity not in expected_matched_ids, "Required pair not matched")
    need(seen == set(facts), "Readable member missing from evidence/cases")
    actual = {(tuple(sorted(c["supplier"])), tuple(sorted(c["ledger"]))) for c in cases.values()}
    need(actual == required, "False/missing automatic pair membership")
    matches = book.records("Matches")
    need(len(matches) == len(required), "Wrong count of automatic pairs")
    seen_cases = set()
    for row in matches:
        case_id = val(row["Case ID"])
        need(case_id in cases and case_id not in seen_cases, "Unknown/duplicate match case")
        seen_cases.add(case_id)
        text(row["Match Decision"], "Auto")
        text(row["Match Type"], "1:1")
        text(row["Status"], "Matched")
        for side in ("supplier", "ledger"):
            source_row = cases[case_id][side][0]
            f = facts[f"{side}:0:{source_row}"][1]
            money(row[side.title() + " Amount"], f["amountMinor"])
            native_date(row[side.title() + " Date"], f["date"])
            number(row[side.title() + " Source Rows"], 1)
    need(seen_cases == set(cases), "Match/evidence case sets differ")

    metadata = book.fields("Export Metadata")
    text(metadata["Engine version"], expected_engine)
    for side in ("supplier", "ledger"):
        text(metadata[side.title() + " SHA-256"], sha(case[side]["sourcePath"]))
    return {"passed": True, "contract": case["id"], "requiredPairs": len(required), "requiredPairsSatisfied": len(actual),
            "falseApprovedPairs": len(actual - required), "matchedSourceRows": len(expected_matched_ids),
            "readableSourceRows": len(facts), "invalidRowsRetained": issue_details, "processedTotalsMinor": subtotal,
            **summary_observation, "xmlPartsParsed": book.xml_parts,
            "sourceProvenance": source_provenance,
            "scope": "Independent synthetic literal sources, error preservation and financial member sets. No engine/ExcelJS imports or formula recalculation."}


def check_summary(book, subtotal, invalid, readable_count, require_reviewed):
    summary = book.fields("Summary")
    # The exact display labels are export schema, not financial truth. Require
    # unambiguous processed-only subtotal labels for each side, never source totals.
    subtotal_fields = {}
    for side in ("supplier", "ledger"):
        matches = [label for label in summary if side in label.lower() and re.search(r"processed|readable|valid movement", label, re.I) and re.search(r"total|subtotal", label, re.I)]
        need(len(matches) == 1, "Missing/ambiguous processed-only subtotal label for " + side)
        money(summary[matches[0]], subtotal[side])
        subtotal_fields[side] = matches[0]
    # Summary can contain legitimate generated bridge formulas unrelated to
    # these plain-text status fields. Never evaluate them or treat their cached
    # values as original source cells.
    partial_fields = {label: val(summary[label]) for label in ("Reading Status", "Workbook Mode")}
    need(re.search(r"partial|جزئي", partial_fields["Reading Status"], re.I), "Reading Status does not identify partial reconciliation")
    need(re.search(r"not a complete reconciliation|ليست.*تسوية.*كاملة", partial_fields["Workbook Mode"], re.I), "Workbook Mode lacks the incomplete-reconciliation qualification")
    number(summary["Processed Transactions"], readable_count)
    number(summary["Rows Needing Reading Review"], len(invalid))
    need(re.search(r"processed transactions only", val(summary["Totals Basis"]), re.I), "Missing processed-only totals basis")
    need(re.search(r"unknown,? not zero", val(summary["Totals Basis"]), re.I), "Unread money described without unknown/not-zero qualification")
    # Check the Summary against actual workbook rows here. Required independent
    # positive membership is still mandatory in verify(), separately from a
    # truthful description of a missed-positive/partial result.
    summary_count(summary["Auto Matched Cases"], len(book.records("Matches")))
    matched_evidence = [r for r in book.records("Match Evidence") if val(r["Status"]) == "Matched"]
    summary_count(summary["Matched Source Rows"], len(matched_evidence))
    summary_count(summary["Manual Matches"], 0)
    bridge = val(summary["Bridge Status"])
    need(re.search(r"incomplete|unavailable|غير مكتمل|غير متاح|لم يكتمل", bridge, re.I), "Partial source displayed as a complete balance bridge")
    for label in ("Adjusted Supplier Balance", "Residual"):
        need(val(summary[label]) == "", "Invented complete balance value: " + label)
    for side in {side for side, _ in invalid.values()}:
        label = side.title() + " Balance Arithmetic"
        need(val(summary[label]) != "BALANCE_ARITHMETIC_VERIFIED", "Invalid source certified as a verified balance")
    signoff = book.fields("Review Sign-off")
    if require_reviewed:
        need(re.search(r"review recorded|completed|complete|مكتمل|تمت", val(signoff["Review Completed"]), re.I), "Expected reviewed export was not reviewed")
        need(not re.search(r"pending|not complete|غير مكتمل", val(signoff["Review Completed"]), re.I), "Review is still pending")
    approval = val(signoff["Approved / Not Approved"])
    need(re.search(r"not approved|غير معتمد|لا.*اعتماد", approval, re.I), "Review completion incorrectly declares approval")
    return {"passed": True, "processedTotalsMinor": subtotal, "processedTotalFields": subtotal_fields,
            "partialSummaryFields": partial_fields, "bridgeStatus": bridge,
            "reviewCompleted": val(signoff["Review Completed"]), "reviewApproval": approval}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xlsx", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--case", default="PR01")
    parser.add_argument("--browser-oracle", type=Path, help="The separately authored 13-error browser oracle.json")
    parser.add_argument("--require-reviewed", action="store_true")
    parser.add_argument("--expected-engine", default="0.3.21-experimental", help="Exact candidate release version; frozen financial expectations stay unchanged")
    args = parser.parse_args()
    need(not args.out.exists(), "Refusing to overwrite an existing result")
    result = {"checkerSha256": sha(__file__), "observedAtUtc": dt.datetime.now(dt.timezone.utc).isoformat(), "passed": False}
    try:
        result["frozenBefore"] = frozen()
        result["workbookSha256"] = sha(args.xlsx)
        result["observations"] = {}
        result.update(verify(args.xlsx, args.case, args.require_reviewed, args.browser_oracle, result["observations"], args.expected_engine))
        load_contract(args.case, args.browser_oracle)  # Check original source hashes again.
        result["frozenAfter"] = frozen()
        need(result["workbookSha256"] == sha(args.xlsx), "Workbook changed during verification")
    except Exception as error:
        result.update(passed=False, error={"type": type(error).__name__, "message": str(error)})
    try:
        result["frozenAfter"] = frozen()
        load_contract(args.case, args.browser_oracle)
        need(result.get("workbookSha256") == sha(args.xlsx), "Workbook changed during verification")
    except Exception as error:
        result.update(passed=False, finalIntegrityError={"type": type(error).__name__, "message": str(error)})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("x") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
