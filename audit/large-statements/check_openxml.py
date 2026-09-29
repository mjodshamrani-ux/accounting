#!/usr/bin/env python3
"""Check the browser's long-PDF XLSX against frozen literal sources, using stdlib only.

No engine, ExcelJS, formula evaluator, or source-generator code is imported. Case IDs
are opaque: exact required membership is obtained from literal source row IDs.
This is a transaction/export check, not a balance-completeness or field-accuracy claim.
"""

import argparse
import csv
import datetime as dt
import hashlib
import json
import posixpath
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

BASE = Path(__file__).resolve().parent
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
FROZEN_MANIFEST = "97b9454ad63b2f26b64d742b90072230b7da3f36b6bb197aa0e5da1b2ec4c7a2"


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def freeze_check():
    manifest = BASE / "frozen/SHA256SUMS"
    require(digest(manifest) == FROZEN_MANIFEST, "Frozen manifest changed")
    entries = []
    for line in manifest.read_text().splitlines():
        expected, name = line.split(maxsplit=1)
        name = name.lstrip("*")
        require(digest(manifest.parent / name) == expected, f"Frozen input changed: {name}")
        entries.append(name)
    return {"manifestSha256": FROZEN_MANIFEST, "verifiedFiles": len(entries)}


class Workbook:
    def __init__(self, path):
        self.sheets = {}
        self.links = {}
        with zipfile.ZipFile(path) as archive:
            require(archive.testzip() is None, "ZIP CRC failure")
            names = archive.namelist()
            require(len(names) == len(set(names)), "Duplicate ZIP entries")
            require(not any("vbaProject" in n or n.startswith("xl/externalLinks/") for n in names),
                    "Unexpected macro or external workbook relationship")
            # Parse every XML part, not only the inspected sheets.
            xml = {n: ET.fromstring(archive.read(n)) for n in names if n.endswith((".xml", ".rels"))}
            self.xml_parts = len(xml)
            strings = ["".join(si.itertext()) for si in xml["xl/sharedStrings.xml"].findall("s:si", NS)]
            workbook = xml["xl/workbook.xml"]
            props = workbook.find("s:workbookPr", NS)
            require(props is None or props.get("date1904", "0") in ("0", "false"), "Unexpected date epoch")
            relationships = {r.get("Id"): r for r in xml["xl/_rels/workbook.xml.rels"]}
            styles = xml["xl/styles.xml"]
            custom = {int(f.get("numFmtId")): f.get("formatCode") for f in styles.findall("s:numFmts/s:numFmt", NS)}
            self.formats = [custom.get(int(f.get("numFmtId", "0")), int(f.get("numFmtId", "0")))
                            for f in styles.findall("s:cellXfs/s:xf", NS)]
            for sheet in workbook.findall("s:sheets/s:sheet", NS):
                relation = relationships[sheet.get(REL_ID)]
                require(relation.get("TargetMode") != "External", "External sheet")
                part = posixpath.normpath(posixpath.join("xl", relation.get("Target")))
                part = part.lstrip("/")
                root = xml[part]
                table = []
                for row in root.findall("s:sheetData/s:row", NS):
                    cells = {}
                    for c in row.findall("s:c", NS):
                        address = c.get("r")
                        column = "".join(ch for ch in address if ch.isalpha())
                        require(column not in cells, f"Duplicate cell: {sheet.get('name')}!{address}")
                        v = c.find("s:v", NS)
                        raw = v.text if v is not None and v.text is not None else ""
                        kind = c.get("t", "n")
                        value = strings[int(raw)] if kind == "s" else raw
                        if kind == "inlineStr":
                            value = "".join(c.find("s:is", NS).itertext())
                        cells[column] = {"value": value, "kind": kind, "formula": c.find("s:f", NS) is not None,
                                         "format": self.formats[int(c.get("s", "0"))], "address": address}
                    table.append(cells)
                self.sheets[sheet.get("name")] = table
                self.links[sheet.get("name")] = {h.get("ref"): h.get("location") for h in root.findall("s:hyperlinks/s:hyperlink", NS)}

    def records(self, name):
        table = self.sheets[name]
        header = {column: cell["value"] for column, cell in table[0].items()}
        return [{header[column]: cell for column, cell in row.items()} for row in table[1:]]


def value(row, key):
    cell = row[key]
    require(not cell["formula"], f"Unexpected source/evidence formula: {key} {cell['address']}")
    return cell["value"]


def text(row, key, expected):
    require(value(row, key) == expected, f"Text mismatch {key}: {value(row, key)!r} != {expected!r}")
    if expected:
        require(row[key]["kind"] in ("s", "inlineStr"), f"Original text coerced: {key}")


def number(row, key, expected):
    actual = value(row, key)
    require(row[key]["kind"] == "n" and actual != "", f"Non-numeric {key}: {actual!r}")
    require(Decimal(actual) == Decimal(expected), f"Numeric mismatch {key}: {actual} != {expected}")


def date(row, key, expected):
    serial = (dt.date.fromisoformat(expected) - dt.date(1899, 12, 30)).days
    number(row, key, serial)
    require(row[key]["format"] == "yyyy-mm-dd" or row[key]["format"] in range(14, 23),
            f"Missing native date format: {key}")


def money(row, key, minor):
    number(row, key, Decimal(minor) / 100)
    require(row[key]["format"] in (2, 4, "0.00", "#,##0.00"), f"Missing 2-decimal money format: {key}")


def verify(workbook_path, pages):
    oracle_path = BASE / f"frozen/fixtures/oracle-{pages}.json"
    csv_path = BASE / f"frozen/fixtures/ledger-{pages}.csv"
    pdf_path = BASE / f"frozen/fixtures/native-{pages}.pdf"
    oracle = json.loads(oracle_path.read_text())
    transactions = oracle["transactions"]
    require(len(transactions) == oracle["requiredPairs"], "Inconsistent literal oracle")
    require(sum(t["amountMinor"] for t in transactions) == oracle["totalMinor"], "Oracle total mismatch")
    with csv_path.open(newline="") as stream:
        ledger_raw = list(csv.reader(stream))
    require(len(ledger_raw) == len(transactions) + 1, "CSV size differs from oracle")
    raw = {}
    page_by_row = {}
    required_members = {}
    required_pairs = set()
    for t in transactions:
        cells = [t["date"], t["reference"], t["amount"], t["description"]]
        require(Decimal(t["amount"]) * 100 == t["amountMinor"], "Oracle decimal inconsistency")
        require(ledger_raw[t["ledgerSourceRow"] - 1][:4] == cells, "CSV/oracle literal mismatch")
        raw[t["supplierSourceRow"]] = cells
        page_by_row[t["supplierSourceRow"]] = t["sourcePage"]
        pair = []
        for side in ("supplier", "ledger"):
            member = f"{side}:0:{t[side + 'SourceRow']}"
            require(member not in required_members, f"Duplicate oracle ID: {member}")
            required_members[member] = (side, t)
            pair.append(member)
        required_pairs.add(tuple(pair))
    labels = {"page-total": "Page total", "carry-forward": "Balance carried forward", "closing": "Closing balance"}
    for excluded in oracle["excluded"]:
        raw[excluded["row"]] = (["Date", "Reference", "Amount", "Description"] if excluded["kind"] == "header"
                                else ["", labels[excluded["kind"]], f"{Decimal(excluded['amountMinor']) / 100:.2f}", ""])
        page_by_row[excluded["row"]] = excluded["page"]
    require(set(raw) == set(range(1, oracle["extractedRows"] + 1)), "Oracle raw source coverage gap")
    book = Workbook(workbook_path)
    counts = {}
    for side, sheet in (("supplier", "Supplier transactions"), ("ledger", "Ledger transactions")):
        rows = book.records(sheet)
        require(len(rows) == len(transactions), f"{side}: missing/extra transaction")
        seen = set()
        total = 0
        for row in rows:
            member = value(row, "المعرف")
            require(member in required_members and member not in seen, f"Unexpected/duplicate transaction {member}")
            expected_side, t = required_members[member]
            require(expected_side == side, "Transaction on wrong side")
            seen.add(member)
            text(row, "الورقة", "PDF" if side == "supplier" else "CSV")
            number(row, "صف المصدر", t[side + "SourceRow"])
            date(row, "التاريخ", t["date"])
            text(row, "المرجع الأصلي", t["reference"])
            text(row, "الوصف", t["description"])
            money(row, "المبلغ الموحد", t["amountMinor"])
            text(row, "المبلغ الأصلي", t["amount"])
            if side == "supplier":
                number(row, "صفحة PDF الأصلية", t["sourcePage"])
            else:
                text(row, "صفحة PDF الأصلية", "")
            total += int(Decimal(value(row, "المبلغ الموحد")) * 100)
        require(total == oracle["totalMinor"], f"{side}: total differs")
        counts[side + "Transactions"] = len(rows)
    cases = defaultdict(dict)
    evidence = book.records("Match Evidence")
    require(len(evidence) == len(required_members), "Evidence count mismatch")
    seen_members = set()
    for row in evidence:
        member = value(row, "Source Row ID")
        require(member in required_members and member not in seen_members, f"Unexpected/duplicate evidence member {member}")
        seen_members.add(member)
        side, t = required_members[member]
        case = value(row, "Case ID")
        require(case and side not in cases[case], f"Duplicate/missing case side {case}")
        cases[case][side] = member
        text(row, "Side", side)
        text(row, "Source Sheet", "PDF" if side == "supplier" else "CSV")
        number(row, "Source Row", t[side + "SourceRow"])
        text(row, "Classification", "EXACT_1_TO_1")
        text(row, "Status", "Matched")
        text(row, "Primary Reference", t["reference"])
        text(row, "Currency", "SAR")
        date(row, "Date", t["date"])
        money(row, "Amount", t["amountMinor"])
        if side == "supplier":
            number(row, "PDF Page", t["sourcePage"])
        else:
            text(row, "PDF Page", "")
    actual_pairs = set()
    for case, members in cases.items():
        require(set(members) == {"supplier", "ledger"}, f"Incomplete case: {case}")
        actual_pairs.add((members["supplier"], members["ledger"]))
    require(actual_pairs == required_pairs, "Missing required pair or false approved pair")
    matches = book.records("Matches")
    require(len(matches) == len(required_pairs), "Match row count mismatch")
    seen_cases = set()
    for row in matches:
        case = value(row, "Case ID")
        require(case in cases and case not in seen_cases, f"Unknown/duplicate match case {case}")
        seen_cases.add(case)
        t = required_members[cases[case]["supplier"]][1]
        text(row, "Match Type", "1:1")
        text(row, "Status", "Matched")
        text(row, "Match Decision", "Auto")
        number(row, "Date Gap", 0)
        for side in ("Supplier", "Ledger"):
            text(row, side + " References", t["reference"])
            date(row, side + " Date", t["date"])
            money(row, side + " Amount", t["amountMinor"])
            number(row, side + " Source Rows", 1)
    require(seen_cases == set(cases), "Evidence/matches case set mismatch")
    require(not book.records("Needs Review") and not book.records("Unmatched"), "Unexpected unresolved source rows")
    for sheet, expected_rows in (("Parsed Supplier Source", raw), ("Parsed Ledger Source", dict(enumerate(ledger_raw, 1)))):
        rows = book.records(sheet)
        require(len(rows) == len(expected_rows), f"{sheet}: incomplete raw rows")
        seen = set()
        for row in rows:
            source_row = int(value(row, "صف المصدر"))
            require(source_row in expected_rows and source_row not in seen, f"{sheet}: duplicate/unknown source row")
            seen.add(source_row)
            for i, expected in enumerate(expected_rows[source_row], 1):
                text(row, f"عمود {i}", expected)
    origins = book.records("PDF Row Origins")
    require(len(origins) == len(raw), "PDF origin count mismatch")
    seen = set()
    for row in origins:
        source_row = int(value(row, "صف الاستخراج"))
        require(source_row in raw and source_row not in seen, "Duplicate/unknown PDF origin")
        seen.add(source_row)
        text(row, "الطرف", "المورد")
        number(row, "صفحة PDF", page_by_row[source_row])
        require(json.loads(value(row, "المحتوى المستخرج")) == raw[source_row], "PDF origin content differs")
    exclusions = book.records("Excluded Rows")
    expected_excluded = {("المورد", e["row"]): raw[e["row"]] for e in oracle["excluded"]}
    expected_excluded[("الدفتر", 1)] = ledger_raw[0]
    require(len(exclusions) == len(expected_excluded), "Excluded rows count mismatch")
    seen = set()
    for row in exclusions:
        key = (value(row, "الطرف"), int(value(row, "صف المصدر")))
        require(key in expected_excluded and key not in seen, "Duplicate/unexpected exclusion")
        seen.add(key)
        require(bool(value(row, "سبب الاستبعاد")), "Missing exclusion reason")
        require(json.loads(value(row, "المحتوى")) == expected_excluded[key], "Excluded original cells differ")
    metadata = {value(r, "Field"): value(r, "Value") for r in book.records("Export Metadata")}
    require(metadata["Supplier SHA-256"] == digest(pdf_path), "Export not bound to frozen PDF")
    require(metadata["Ledger SHA-256"] == digest(csv_path), "Export not bound to frozen CSV")
    require(metadata["Engine version"] == "0.3.21-experimental", "Unexpected export engine")
    settings = {value(r, "الحقل"): value(r, "القيمة") for r in book.records("Run Settings")}
    scope = json.loads(settings["Scope"])
    require(scope["currency"] == "SAR" and scope["decimals"] == 2 and scope["coverageConfirmed"] is False,
            "Unexpected transaction-only scope")
    layout = json.loads(settings["Supplier PDF layout"])
    require(layout == {"cuts": [25, 49, 68], "pages": pages}, "Explicit layout mismatch")
    warnings = [value(r, "التفسير") for r in book.records("Diagnostics") if value(r, "الرمز") != "EXACT_1_TO_1"]
    return {"passed": True, "engine": metadata["Engine version"], "counts": {
        **counts, "requiredPairs": len(required_pairs), "requiredPairsSatisfied": len(actual_pairs),
        "falseApprovedPairs": len(actual_pairs - required_pairs), "missingPairs": len(required_pairs - actual_pairs),
        "exactEvidenceMembers": len(evidence), "parsedSupplierRows": len(raw), "parsedLedgerRows": len(ledger_raw),
        "pdfOrigins": len(origins), "excludedSupplierRows": len(oracle["excluded"]), "excludedLedgerRows": 1,
        "totalMinorEachSide": oracle["totalMinor"], "xmlPartsParsed": book.xml_parts},
        "lastPage": {"page": pages, "reference": oracle["lastRequiredReference"],
                     "supplierSourceRow": transactions[-1]["supplierSourceRow"], "checked": True},
        "explicitPdfLayout": layout, "scope": scope, "retainedDiagnostics": warnings,
        "sourceSha256": {"pdf": digest(pdf_path), "csv": digest(csv_path), "oracle": digest(oracle_path)},
        "limitations": ["Synthetic known-layout transaction export, not field validation or automatic layout inference.",
                        "Balance carry-forward/closing candidates remain conflicting; no balance completeness claim.",
                        "ZIP/XML verification checks original values and case membership; no Excel rendering or formula recalculation."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--pages", type=int, choices=(70, 100), default=70)
    args = parser.parse_args()
    require(not args.out.exists(), "Refusing to overwrite an existing result")
    workbook = args.browser_dir / f"native-{args.pages}.xlsx"
    report = {"checker": "Python standard library zipfile + ElementTree + Decimal; no engine/ExcelJS imports",
              "observedAtUtc": dt.datetime.now(dt.timezone.utc).isoformat(),
              "workbook": str(workbook.relative_to(BASE)) if workbook.is_relative_to(BASE) else str(workbook),
              "checkerSha256": digest(__file__), "passed": False}
    try:
        report["frozenBefore"] = freeze_check()
        report["workbookSha256"] = digest(workbook)
        report.update(verify(workbook, args.pages))
        report["frozenAfter"] = freeze_check()
        require(digest(workbook) == report["workbookSha256"], "Workbook changed during verification")
    except Exception as error:
        report.update(passed=False, error={"type": type(error).__name__, "message": str(error)})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("x") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps({"passed": report["passed"], "result": str(args.out), "counts": report.get("counts"), "error": report.get("error")}, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
