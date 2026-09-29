#!/usr/bin/env python3
"""Independent literal membership oracle for the synthetic browser fixture.

Reads OOXML with the Python standard library, never imports the accounting engine
or fixture generator. Case IDs only associate workbook sheets. It checks actual
source rows and exact approved groups against membership-contract.json.
"""

import argparse
from collections import defaultdict
from datetime import date
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import posixpath
import re
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parent
CONTRACT = ROOT / "membership-contract.json"
XML = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
SERIAL = (date(2026, 7, 15) - date(1899, 12, 30)).days
NAME = re.compile(r"^([A-Z]+)([1-9][0-9]*)$")


def require(condition, reason):
    if not condition:
        raise AssertionError(reason)


def cell_value(cell, strings):
    require(cell.find(XML + "f") is None, f"unexpected formula {cell.get('r')}")
    raw = cell.find(XML + "v")
    value = raw.text if raw is not None and raw.text is not None else ""
    kind = cell.get("t", "n")
    if kind == "s":
        require(value.isdigit() and int(value) < len(strings), "invalid shared string index")
        return strings[int(value)], kind
    if kind == "inlineStr":
        part = cell.find(XML + "is")
        return "".join(part.itertext()) if part is not None else "", kind
    return value, kind


class Book:
    def __init__(self, path):
        self.archive = ZipFile(path)
        names = self.archive.namelist()
        require(len(names) == len(set(names)), "duplicate ZIP part")
        self.names = set(names)
        self.strings = []
        if "xl/sharedStrings.xml" in self.names:
            with self.archive.open("xl/sharedStrings.xml") as stream:
                root = None
                for event, element in ET.iterparse(stream, events=("start", "end")):
                    if root is None:
                        root = element
                    if event == "end" and element.tag == XML + "si":
                        self.strings.append("".join(element.itertext()))
                        element.clear()
                        root.clear()
        workbook = ET.fromstring(self.archive.read("xl/workbook.xml"))
        properties = workbook.find(XML + "workbookPr")
        require(properties is None or properties.get("date1904", "0") in ("0", "false"), "unexpected date epoch")
        relationships = ET.fromstring(self.archive.read("xl/_rels/workbook.xml.rels"))
        targets = {relationship.get("Id"): relationship for relationship in relationships}
        self.sheets = {}
        for sheet in workbook.find(XML + "sheets"):
            relationship = targets[sheet.get(REL + "id")]
            require(relationship.get("TargetMode") != "External", "external worksheet")
            part = relationship.get("Target")
            name = part.lstrip("/") if part.startswith("/") else posixpath.normpath("xl/" + part)
            require(name in self.names and name.startswith("xl/worksheets/"), "invalid worksheet path")
            self.sheets[sheet.get("name")] = name

    def rows(self, sheet_name, wanted):
        """Read only selected cells, streaming long worksheets row by row."""
        path = self.sheets[sheet_name]
        headers = {}
        rows = []
        links = {}
        with self.archive.open(path) as stream:
            root = None
            for event, element in ET.iterparse(stream, events=("start", "end")):
                if root is None:
                    root = element
                if event != "end":
                    continue
                if element.tag == XML + "row":
                    cells = {}
                    for cell in element.findall(XML + "c"):
                        address = cell.get("r", "")
                        match = NAME.fullmatch(address)
                        require(match is not None, f"bad cell address in {sheet_name}")
                        column = match.group(1)
                        require(column not in cells, f"duplicate cell in {sheet_name} row {element.get('r')}")
                        cells[column] = cell_value(cell, self.strings)
                    row_number = int(element.get("r"))
                    if row_number == 1:
                        headers = {column: value for column, (value, _) in cells.items()}
                        require(wanted <= set(headers.values()), f"missing headers in {sheet_name}: {wanted - set(headers.values())}")
                    elif wanted:
                        selected = {title: (cells.get(column, ("", "n")), column + str(row_number))
                                    for column, title in headers.items() if title in wanted}
                        require(len(selected) == len(wanted), f"missing selected cell in {sheet_name}")
                        rows.append(selected)
                    element.clear()
                    root.clear()
                elif element.tag == XML + "hyperlink":
                    reference = element.get("ref")
                    require(reference not in links, f"duplicate hyperlink at {sheet_name}!{reference}")
                    links[reference] = (element.get("location"), element.get(REL + "id"))
                    element.clear()
                    root.clear()
        return rows, links

    def hyperlink_targets(self, sheet_name):
        path = self.sheets[sheet_name]
        folder, file = posixpath.split(path)
        relpath = posixpath.join(folder, "_rels", file + ".rels")
        require(relpath in self.names, f"missing link relationships for {sheet_name}")
        return {entry.get("Id"): entry.get("Target")
                for entry in ET.fromstring(self.archive.read(relpath))}

    def close(self):
        self.archive.close()


def value(row, field, kind=None):
    (raw, actual_kind), _ = row[field]
    if kind is not None:
        require(actual_kind == kind, f"{field}: expected {kind}, got {actual_kind}")
    return raw


def minor(row, field):
    return int(Decimal(value(row, field, "n")) * 100)


def integer(row, field):
    raw = value(row, field, "n")
    result = int(raw)
    require(str(result) == raw or Decimal(raw) == result, f"{field}: not an integer")
    return result


def reference(side, index):
    base, offset = divmod(index, 10)
    ident = str(100000 + base * 10)
    if offset == 9:
        return "ONE-" + ident
    if offset in (7, 8):
        return "DUP-" + ident
    if offset <= 3:
        return "INV-" + ident + ("B" if (side == "supplier" and offset > 0) or (side == "ledger" and offset == 3) else "")
    return "PAY-" + ident + ("B" if (side == "supplier" and offset > 4) or (side == "ledger" and offset == 6) else "")


def expected_members(contract, rows_per_side):
    amount = contract["amountsMinor"]
    expected = set()
    groups = set()
    leftovers = set()
    for base in range(0, rows_per_side, contract["blockSizePerSide"]):
        for spec in contract["requiredMatchedCases"]:
            members = frozenset((side, contract["firstTransactionSourceRowOneBased"] + base + offset)
                                for side in ("supplier", "ledger") for offset in spec[side + "Offsets"])
            groups.add((members, spec["type"], spec["amountMinorEachSide"]))
            expected.update(members)
        for side in ("supplier", "ledger"):
            leftovers.update((side, contract["firstTransactionSourceRowOneBased"] + base + offset)
                             for offset in contract["mustRemainUnapprovedOffsets"][side])
        for side in ("supplier", "ledger"):
            require(sum(amount[side]) == contract["expectedPerBlock"]["sourceTotalMinorEachSide"], "oracle total inconsistent")
    return groups, expected, leftovers


def link_check(row, field, links, targets, side, source_row, parsed_rows):
    _, cell = row[field]
    require(cell in links, f"missing hyperlink at {cell}")
    location, relation = links[cell]
    require(targets.get(relation) == location, f"relationship mismatch at {cell}")
    require(parsed_rows[side][source_row + 1] == source_row, f"parsed source row missing: {side}:{source_row}")
    expected = f"#'Parsed {side.capitalize()} Source'!A{source_row + 1}"
    require(location == expected, f"wrong source hyperlink at {cell}: {location}")


def verify(path, rows_per_side, file_format):
    contract = json.loads(CONTRACT.read_text())
    require(rows_per_side > 0 and rows_per_side % 10 == 0, "rows must be a positive multiple of ten")
    require(file_format in ("csv", "xlsx"), "unsupported fixture format")
    source_sheet = "CSV" if file_format == "csv" else "Statement"
    required_groups, approved, unresolved = expected_members(contract, rows_per_side)
    book = Book(path)
    try:
        parsed_rows = {}
        for side in ("supplier", "ledger"):
            sheet = f"Parsed {side.capitalize()} Source"
            rows, _ = book.rows(sheet, {"صف المصدر"})
            parsed_rows[side] = {number + 2: integer(row, "صف المصدر") for number, row in enumerate(rows)}
            require(len(parsed_rows[side]) == rows_per_side + 6, f"{sheet}: missing source rows")
            require(all(number == source + 1 for number, source in parsed_rows[side].items()), f"{sheet}: row shift")
        expected_all = approved | unresolved
        for side, name in (("supplier", "Supplier transactions"), ("ledger", "Ledger transactions")):
            rows, _ = book.rows(name, {"المعرف", "الورقة", "صف المصدر", "التاريخ", "المرجع الأصلي", "المبلغ الموحد"})
            require(len(rows) == rows_per_side, f"{side}: wrong transaction count")
            seen = set()
            for row in rows:
                source_row = integer(row, "صف المصدر")
                member = (side, source_row)
                require(member in expected_all and member not in seen, f"{side}: wrong or duplicate source transaction {source_row}")
                seen.add(member)
                index = source_row - contract["firstTransactionSourceRowOneBased"]
                require(value(row, "المعرف") == f"{side}:0:{source_row}", "transaction ID differs from source row")
                require(value(row, "الورقة") == source_sheet, "source sheet mismatch")
                docref = reference(side, index)
                primary = "BANK-" + docref[4:] if docref.startswith("PAY-") else docref
                require(value(row, "المرجع الأصلي") == primary, f"source reference mismatch {side}:{source_row}: {value(row, 'المرجع الأصلي')!r} != {primary!r}")
                require(integer(row, "التاريخ") == SERIAL, "source date mismatch")
                require(minor(row, "المبلغ الموحد") == contract["amountsMinor"][side][index % 10], "source amount/sign mismatch")
        evidence_fields = {"Case ID", "Classification", "Status", "Rule", "Side", "Source Row ID", "Source Sheet", "Source Row", "Date", "Primary Reference", "Document Reference", "Bank Reference", "Currency", "Amount", "Source Link"}
        evidence, evidence_links = book.rows("Match Evidence", evidence_fields)
        evidence_targets = book.hyperlink_targets("Match Evidence")
        require(len(evidence) == rows_per_side * 2, "evidence member count mismatch")
        cases = defaultdict(lambda: {"supplier": set(), "ledger": set(), "amounts": defaultdict(int), "status": set(), "rules": set()})
        seen = set()
        for row in evidence:
            side = value(row, "Side")
            source_row = integer(row, "Source Row")
            member = (side, source_row)
            require(member in expected_all and member not in seen, f"unexpected or repeated evidence member {member}")
            seen.add(member)
            index = source_row - contract["firstTransactionSourceRowOneBased"]
            require(value(row, "Source Row ID") == f"{side}:0:{source_row}", "evidence source ID mismatch")
            require(value(row, "Source Sheet") == source_sheet, "evidence source sheet mismatch")
            require(integer(row, "Date") == SERIAL, "evidence date mismatch")
            require(value(row, "Currency") == contract["currency"], "evidence currency mismatch")
            require(minor(row, "Amount") == contract["amountsMinor"][side][index % 10], "evidence amount/sign mismatch")
            docref = reference(side, index)
            require(value(row, "Document Reference") == docref, "document reference mismatch")
            bankref = "BANK-" + docref[4:] if docref.startswith("PAY-") else ""
            require(value(row, "Bank Reference") == bankref, "bank reference mismatch")
            require(value(row, "Primary Reference") == (bankref or docref), "primary reference mismatch")
            require(value(row, "Source Link") == f"{side} · {source_sheet} · row {source_row}", "source link text mismatch")
            link_check(row, "Source Link", evidence_links, evidence_targets, side, source_row, parsed_rows)
            case_id = value(row, "Case ID")
            require(case_id, "empty case ID")
            case = cases[case_id]
            case[side].add(member)
            case["amounts"][side] += minor(row, "Amount")
            case["status"].add(value(row, "Status"))
            case["rules"].add(value(row, "Rule"))
        require(seen == expected_all, "incomplete evidence coverage")
        actual = set()
        for case_id, case in cases.items():
            require(len(case["status"]) == 1 and len(case["rules"]) == 1 and next(iter(case["rules"])), f"inconsistent case {case_id}")
            members = frozenset(case["supplier"] | case["ledger"])
            if next(iter(case["status"])) == "Matched":
                require(members <= approved and not members & unresolved, f"unapproved member in matched case {case_id}")
                require(case["amounts"]["supplier"] == case["amounts"]["ledger"], f"case amounts differ {case_id}")
                kind = "1:1" if len(case["supplier"]) == len(case["ledger"]) == 1 else "1:M" if len(case["supplier"]) == 1 else "M:1" if len(case["ledger"]) == 1 else "N:M"
                actual.add((members, kind, case["amounts"]["supplier"]))
            else:
                require(members <= unresolved and next(iter(case["status"])) == "Needs Review", f"unexpected unapproved case {case_id}")
        require(actual == required_groups, "approved membership differs from literal oracle")
        matches, match_links = book.rows("Matches", {"Case ID", "Match Type", "Supplier Amount", "Ledger Amount", "Status", "Supplier Source Rows", "Ledger Source Rows", "Match Decision"} |
                                          {f"{side} Source {n}" for side in ("Supplier", "Ledger") for n in range(1, 4)})
        match_targets = book.hyperlink_targets("Matches")
        require(len(matches) == len(required_groups), "Matches case count mismatch")
        seen_cases = set()
        for row in matches:
            case_id = value(row, "Case ID")
            require(case_id in cases and case_id not in seen_cases, f"missing or duplicated Match case {case_id}")
            seen_cases.add(case_id)
            case = cases[case_id]
            require(case["status"] == {"Matched"} and value(row, "Status") == "Matched", "Match/evidence status mismatch")
            require(value(row, "Match Decision") == "Auto", "unexpected manual match")
            kind = "1:1" if len(case["supplier"]) == len(case["ledger"]) == 1 else "1:M" if len(case["supplier"]) == 1 else "M:1" if len(case["ledger"]) == 1 else "N:M"
            require(value(row, "Match Type") == kind, "Match/evidence type mismatch")
            require(minor(row, "Supplier Amount") == case["amounts"]["supplier"] and minor(row, "Ledger Amount") == case["amounts"]["ledger"], "Match/evidence total mismatch")
            for side in ("supplier", "ledger"):
                require(integer(row, side.capitalize() + " Source Rows") == len(case[side]), "Match member count mismatch")
                links = sorted(case[side], key=lambda member: member[1])
                for n in range(1, 4):
                    field = f"{side.capitalize()} Source {n}"
                    listed = value(row, field)
                    if n <= len(links):
                        member = links[n - 1]
                        require(listed == f"{side} · {source_sheet} · row {member[1]}", "Match source text mismatch")
                        link_check(row, field, match_links, match_targets, side, member[1], parsed_rows)
                    else:
                        require(listed == "", "extra Match source text")
        require(seen_cases == {case_id for case_id, case in cases.items() if case["status"] == {"Matched"}}, "Matches/evidence approved case mismatch")
        review, _ = book.rows("Needs Review", {"Case ID", "Status", "Supplier Source Rows", "Ledger Source Rows"})
        require(len(review) == rows_per_side // 10, "ambiguous case count mismatch")
        require({value(row, "Case ID") for row in review} == set(cases) - seen_cases, "review/evidence case IDs differ")
        for row in review:
            require(value(row, "Status") == "Needs Review" and integer(row, "Supplier Source Rows") == 2 and integer(row, "Ledger Source Rows") == 2, "ambiguous case corrupted")
        unmatched, _ = book.rows("Unmatched", {"Case ID"})
        require(not unmatched, "unexpected unmatched case")
        return {"verified": True, "rowsPerSide": rows_per_side, "format": file_format,
                "matchedCases": len(actual), "matchedEvidenceMembers": len(approved),
                "allCaseMembers": len(evidence), "needsReviewMembers": len(unresolved),
                "literalOracleSha256": hashlib.sha256(CONTRACT.read_bytes()).hexdigest()}
    finally:
        book.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--rows", type=int, required=True)
    parser.add_argument("--format", choices=("csv", "xlsx"), required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.workbook, args.rows, args.format), sort_keys=True))
        return 0
    except (AssertionError, KeyError, ValueError, OSError, ET.ParseError) as error:
        print(json.dumps({"verified": False, "error": str(error)}, sort_keys=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
