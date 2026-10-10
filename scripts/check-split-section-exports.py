#!/usr/bin/env python3
"""Independent ZIP/XML/Decimal verification; imports no product calculations."""
import argparse
import base64
import csv
import hashlib
import io
import json
from decimal import Decimal
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
HEADER = ["Date", "Reference", "Description", "Debit", "Credit"]


def sha(value):
    return hashlib.sha256(value).hexdigest()


def minor(text):
    assert re.fullmatch(r"[0-9]+(?:\.[0-9]{1,2})?", text), text
    value = Decimal(text) * 100
    assert value == value.to_integral_value()
    return int(value)


def workbook_rows(filename):
    # ST_Xstring escapes decode once, including an escaped opening underscore.
    def decode_text(value):
        return re.sub(r"_x([0-9A-Fa-f]{4})_", lambda match: chr(int(match[1], 16)), value)

    with zipfile.ZipFile(filename) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            tree = ET.fromstring(z.read("xl/sharedStrings.xml"))
            shared = [decode_text("".join(item.itertext())) for item in tree.findall("s:si", NS)]
        book = ET.fromstring(z.read("xl/workbook.xml"))
        formats = ET.fromstring(z.read("xl/styles.xml")).findall("s:cellXfs/s:xf", NS)
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        targets = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
        result = {}
        cell_count = 0
        for sheet in book.findall("s:sheets/s:sheet", NS):
            target = targets[sheet.attrib[f"{{{NS['r']}}}id"]]
            target = target.lstrip("/") if target.startswith("/") else "xl/" + target
            tree = ET.fromstring(z.read(target))
            assert not tree.findall(".//s:f", NS), "formula cells must never be exported"
            rows = []
            for row in tree.findall("s:sheetData/s:row", NS):
                cells = {}
                for cell in row.findall("s:c", NS):
                    address = cell.attrib["r"]
                    column = 0
                    for letter in re.match(r"[A-Z]+", address)[0]:
                        column = column * 26 + ord(letter) - ord("A") + 1
                    kind = cell.attrib.get("t")
                    assert kind in ("s", "inlineStr"), (sheet.attrib["name"], address, kind)
                    assert cell.attrib.get("s") is not None, "text formatting must be explicit"
                    assert formats[int(cell.attrib["s"])].attrib["numFmtId"] == "49", "cell format must be literal text (@)"
                    if kind == "s":
                        value = shared[int(cell.findtext("s:v", namespaces=NS))]
                    else:
                        value = decode_text("".join(cell.find("s:is", NS).itertext()))
                    assert len(value.encode("utf-16-le")) // 2 <= 32767, "Excel text cell capacity exceeded"
                    cells[column] = value
                    cell_count += 1
                rows.append([cells.get(i, "") for i in range(1, max(cells, default=0) + 1)])
            result[sheet.attrib["name"]] = rows
        return result, cell_count


def validate_proof(proof, oracle):
    assert proof["sourceHash"] == oracle["sourceSha256"]
    assert proof["sheet"] == 1
    row = oracle["inventory"][proof["row"] - 1]
    assert proof["page"] == row["page"]
    literal = row["values"][proof["column"] - 1]
    assert proof["literal"] == literal == proof["cellText"]
    start, end = proof["spanStartInclusive"], proof["spanEndExclusive"]
    assert 0 <= start <= end <= len(literal)
    assert proof["spanText"] == literal[start:end]


def independent_movements(oracle):
    active = None
    groups = {}
    page_totals = {}
    movement = []
    totals = []
    pending = None
    for row in oracle["inventory"]:
        values = row["values"]
        text = values[0]
        page = row["page"]
        if text.startswith("Invoice: "):
            active = text[9:]
            assert active not in groups
            groups[active] = [0, 0]
        elif text.startswith("Continued invoice: "):
            assert active == text[19:]
        elif re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", text):
            assert active is not None
            assert values[1] in ("", active)
            debit, credit = minor(values[3]), minor(values[4])
            assert not (debit > 0 and credit > 0)
            groups[active][0] += debit
            groups[active][1] += credit
            page_totals.setdefault(page, [0, 0])[0] += debit
            page_totals[page][1] += credit
            movement.append({"originalRow": row["row"], "page": page,
                             "derivedRow": len(movement) + 2, "reference": active,
                             "referenceOrigin": "explicit-source-cell" if values[1] else "accepted-section-proposal",
                             "date": text, "description": values[2],
                             "debit": values[3], "credit": values[4],
                             "debitMinor": str(debit), "creditMinor": str(credit)})
        elif text.startswith("Section total: ") or text in ("Page total", "Grand total", "Carried forward", "Brought forward"):
            actual = [minor(values[3]), minor(values[4])]
            if text.startswith("Section total: "):
                assert active == text[15:]
                expected = groups[active][:]
                active = None
            elif text == "Page total":
                expected = page_totals.get(page, [0, 0])[:]
            elif text == "Grand total":
                expected = [sum(int(m["debitMinor"]) for m in movement), sum(int(m["creditMinor"]) for m in movement)]
            elif text == "Carried forward":
                expected = groups[active][:]
                assert pending is None
                pending = expected[:]
            else:
                assert pending is not None
                expected = pending
                pending = None
            assert expected == actual, (row["row"], text, expected, actual)
            totals.append({"originalRow": row["row"], "page": page, "role": text,
                           "expectedDebitMinor": str(expected[0]), "expectedCreditMinor": str(expected[1]),
                           "actualDebitMinor": str(actual[0]), "actualCreditMinor": str(actual[1])})
        elif text == "---":
            active = None
    assert pending is None
    return movement, totals


def check_case(case_dir, evidence):
    oracle = json.loads((case_dir / "oracle.json").read_text())
    case = case_dir.name
    expected_csv = (case_dir / "expected.csv").read_bytes()
    original = (case_dir / "source.pdf").read_bytes()
    payload = json.loads((evidence / f"{case}.split").read_bytes())
    artifact = payload["artifact"]
    provenance = artifact["provenance"]
    review = provenance["review"]
    pdf = base64.b64decode(payload["pdf"], validate=True)
    derived = base64.b64decode(payload["derived"], validate=True)
    assert pdf == original and sha(pdf) == oracle["sourceSha256"]
    assert derived == expected_csv == artifact["csv"].encode("utf-8")
    assert sha(derived) == provenance["derivedSha256"] == payload["csvMetadata"]["sha256"]
    assert payload["sourceMetadata"]["sheets"][0]["rows"] == [row["values"] for row in oracle["inventory"]]
    assert payload["sourceMetadata"]["sheets"][0]["rowPages"] == {str(row["row"]): row["page"] for row in oracle["inventory"]}
    expected, totals = independent_movements(oracle)
    assert len(expected) == len(oracle["movements"])
    assert [{key: m[key] for key in expected[0]} for m in review["movements"]] == expected
    assert provenance["links"] == review["movements"]
    assert provenance["inventory"] == review["rows"]
    assert [(m["originalRow"], m["page"], m["kind"], m["values"]) for m in review["rows"]] == [(m["row"], m["page"], m["kind"], m["values"]) for m in oracle["inventory"]]
    if totals:
        assert [{key: t[key] for key in totals[0]} for t in review["totals"]] == totals
    else:
        assert review["totals"] == []
    debit = sum(int(m["debitMinor"]) for m in expected)
    credit = sum(int(m["creditMinor"]) for m in expected)
    assert review["grossDebitMinor"] == str(debit)
    assert review["grossCreditMinor"] == str(credit)
    assert review["netMinor"] == str(debit - credit)
    selected = provenance["selection"]
    assert selected["selectedMovementRows"] == [m["originalRow"] for m in expected]
    assert selected["selectedProposalIds"] == [p["id"] for p in review["proposals"]]
    assert len(review["proposals"]) == sum(oracle["inventory"][m["originalRow"] - 1]["values"][1] == "" for m in expected)
    for m in review["movements"]:
        for key in ("dateEvidence", "descriptionEvidence", "referenceEvidence", "debitEvidence", "creditEvidence"):
            validate_proof(m[key], oracle)
    for proposal in review["proposals"]:
        proofs = proposal["evidence"]
        validate_proof(proofs["target"], oracle)
        validate_proof(proofs["parent"], oracle)
        assert proofs["parent"]["spanText"] == proposal["reference"]
        for proof in proofs["continuations"]:
            validate_proof(proof, oracle)
            assert proof["spanText"] == proposal["reference"]
        for band in proofs["headers"]:
            for proof in band:
                validate_proof(proof, oracle)
    assert artifact["financialApproval"] is False and artifact["scopeConfirmed"] is False
    assert provenance["financialApproval"] is False and provenance["scopeConfirmed"] is False
    assert review["financialApproval"] is False and review["scopeConfirmed"] is False
    sheets, cell_count = workbook_rows(evidence / f"{case}.xlsx")
    assert set(sheets) == {"DerivedReading", "OriginalInventory", "MovementEvidence", "SourceCellEvidence", "ComponentTotals", "ReviewHistory", "OriginalPdf"}
    csv_rows = list(csv.reader(io.StringIO(expected_csv.decode("utf-8"), newline="")))
    assert sheets["DerivedReading"] == csv_rows
    assert csv_rows[0] == HEADER
    assert sheets["OriginalInventory"][1:] == [[str(m["originalRow"]), str(m["page"]), m["kind"], str(m["derivedRow"]) if m["derivedRow"] is not None else "", *m["values"]] for m in review["rows"]]
    evidence_rows = sheets["MovementEvidence"]
    assert len(evidence_rows) == len(expected) + 1
    for row, m in zip(evidence_rows[1:], expected):
        assert row[:6] == [str(m["originalRow"]), str(m["page"]), str(m["derivedRow"]), m["reference"], m["debitMinor"], m["creditMinor"]]
        assert len(row) == 7
        assert row[6] == next(item for item in review["movements"] if item["originalRow"] == m["originalRow"]).get("proposalId", "")
    matrix = [["MovementOriginalRow", "Role", "SourceHash", "ExtractionHash", "ExtractionRevision", "Sheet", "Row", "Page", "Column", "Literal", "SpanStartInclusive", "SpanEndExclusive", "SpanText"]]
    def proof_row(movement, role, proof):
        validate_proof(proof, oracle)
        matrix.append([str(movement), role, proof["sourceHash"], proof["extractionHash"], proof["extractionRevision"], str(proof["sheet"]), str(proof["row"]), str(proof["page"]), str(proof["column"]), proof["literal"], str(proof["spanStartInclusive"]), str(proof["spanEndExclusive"]), proof["spanText"]])
    for movement in review["movements"]:
        for role in ("date", "description", "reference", "debit", "credit"):
            proof_row(movement["originalRow"], role, movement[role + "Evidence"])
        if movement["referenceOrigin"] == "accepted-section-proposal":
            assert movement["referenceEvidence"]["spanText"] == movement["reference"]
            assert movement["referenceEvidence"]["column"] == 1
        else:
            assert movement["referenceEvidence"]["cellText"] == movement["reference"]
            assert movement["referenceEvidence"]["column"] == 2
    for proposal in review["proposals"]:
        proofs = proposal["evidence"]
        original_row = proofs["target"]["row"]
        proof_row(original_row, "proposal-target", proofs["target"])
        proof_row(original_row, "parent", proofs["parent"])
        for proof in proofs["continuations"]:
            proof_row(original_row, "continuation", proof)
        for band in proofs["headers"]:
            for proof in band:
                proof_row(original_row, "proposal-header", proof)
    for proof in review["currencyEvidence"]:
        proof_row("", "currency", proof)
    for band in review["headerEvidence"]:
        for proof in band:
            proof_row("", "header", proof)
    for total in review["totals"]:
        proof_row("", "total-debit", total["debitEvidence"])
        proof_row("", "total-credit", total["creditEvidence"])
    assert sheets["SourceCellEvidence"] == matrix, "every stored source proof must export literally and in full"
    assert sheets["ComponentTotals"][1:] == [[str(t["originalRow"]), str(t["page"]), t["role"], t["expectedDebitMinor"], t["expectedCreditMinor"], t["actualDebitMinor"], t["actualCreditMinor"]] for t in totals]
    history = dict(sheets["ReviewHistory"][1:])
    assert history["OriginalSha256"] == sha(original) and history["DerivedSha256"] == sha(expected_csv)
    assert history["GrossDebitMinor"] == str(debit) and history["GrossCreditMinor"] == str(credit)
    assert history["NetMinor"] == str(debit - credit)
    assert history["FinancialApproval"] == "false" and history["ScopeConfirmed"] == "false"
    assert base64.b64decode("".join(row[1] for row in sheets["OriginalPdf"][1:]), validate=True) == original
    return {"case": case, "passed": True, "originalSha256": sha(pdf), "csvSha256": sha(derived),
            "originalRows": len(oracle["inventory"]), "movementCount": len(expected),
            "debitMinor": debit, "creditMinor": credit, "netMinor": debit - credit,
            "componentTotals": len(totals), "textCellsVerified": cell_count}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path, help="Directory containing actual .split and .xlsx exports")
    parser.add_argument("--frozen", type=Path, default=Path(__file__).resolve().parent.parent / "audit/split-section/frozen")
    args = parser.parse_args()
    results = []
    for path in sorted(args.frozen.iterdir()):
        if not path.is_dir() or not (path / "oracle.json").exists():
            continue
        if not json.loads((path / "oracle.json").read_text())["accepted"]:
            continue
        try:
            results.append(check_case(path, args.evidence))
        except Exception as error:
            results.append({"case": path.name, "passed": False, "error": str(error), "errorType": type(error).__name__})
    result = {"checker": "independent-Python-Decimal-ZIP-XML", "caseCount": len(results),
              "passed": len(results) == 12 and all(r["passed"] for r in results), "cases": results}
    args.evidence.mkdir(parents=True, exist_ok=True)
    (args.evidence / "INDEPENDENT-EXPORT-CHECK.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
