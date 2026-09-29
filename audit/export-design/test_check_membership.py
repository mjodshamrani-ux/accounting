"""Accounting mutations against a frozen exported workbook, not engine output."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED


BASE = Path(__file__).resolve().parent
WORKBOOK = BASE / "frozen/performance-100-csv.xlsx"
FROZEN_SHA256 = "a14c8c8ebf86e583052b7a0c799c0985aa2ea1266d3bca9e612c5f7f5073cd88"
CHECKER = BASE / "check_membership.py"
XML = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def cell(root, address):
    for entry in root.iter(XML + "c"):
        if entry.get("r") == address:
            return entry.find(XML + "v")
    raise AssertionError("missing cell " + address)


def change_parts(destination, changes):
    with ZipFile(WORKBOOK) as original, ZipFile(destination, "w", compression=ZIP_DEFLATED) as updated:
        for info in original.infolist():
            data = original.read(info)
            if info.filename in changes:
                data = changes[info.filename](data)
            updated.writestr(info, data)


def rewrite_xml(data, mutate):
    root = ET.fromstring(data)
    mutate(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


class MembershipOracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert hashlib.sha256(WORKBOOK.read_bytes()).hexdigest() == FROZEN_SHA256

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.changed = Path(temp.name) / "changed.xlsx"

    def check(self, workbook, expected_success):
        result = subprocess.run(
            [sys.executable, str(CHECKER), str(workbook), "--rows=100", "--format=csv"],
            capture_output=True, text=True, check=False,
        )
        self.assertFalse(result.stderr, result.stderr)
        detail = json.loads(result.stdout)
        self.assertEqual(result.returncode, 0 if expected_success else 1, detail)
        self.assertEqual(detail["verified"], expected_success, detail)

    def mutate_sheet(self, sheet, mutate):
        change_parts(self.changed, {sheet: lambda data: rewrite_xml(data, mutate)})
        self.check(self.changed, False)

    def test_frozen_product_workbook_passes(self):
        self.check(WORKBOOK, True)

    def test_equal_amount_cross_block_member_swap_fails_with_source_sheets_unchanged(self):
        def mutate(root):
            # A2/A4 refer to two approved 127.00 supplier rows in different
            # blocks. Swap case IDs; totals, counts and source sheets stay equal.
            first, second = cell(root, "A2"), cell(root, "A4")
            first.text, second.text = second.text, first.text
        change_parts(self.changed, {
            "xl/worksheets/sheet8.xml": lambda data: rewrite_xml(data, mutate),
        })
        with ZipFile(WORKBOOK) as old, ZipFile(self.changed) as changed:
            for name in ("xl/worksheets/sheet10.xml", "xl/worksheets/sheet11.xml"):
                self.assertEqual(old.read(name), changed.read(name))
        self.check(self.changed, False)

    def test_signed_amount_mutation_fails(self):
        self.mutate_sheet("xl/worksheets/sheet8.xml", lambda root: setattr(cell(root, "S2"), "text", "-127"))

    def test_fractional_cent_evidence_fails(self):
        self.mutate_sheet("xl/worksheets/sheet8.xml", lambda root: setattr(cell(root, "S2"), "text", "127.009"))

    def test_fractional_cent_match_total_fails(self):
        self.mutate_sheet("xl/worksheets/sheet2.xml", lambda root: setattr(cell(root, "E2"), "text", "127.009"))

    def test_fraction_beyond_decimal_context_precision_fails(self):
        self.mutate_sheet("xl/worksheets/sheet8.xml", lambda root: setattr(cell(root, "S2"), "text", "127.0000000000000000000000000001"))

    def test_non_finite_or_malformed_amount_returns_json_failure(self):
        for amount in ("NaN", "Infinity", "not a number"):
            with self.subTest(amount=amount):
                self.mutate_sheet("xl/worksheets/sheet8.xml", lambda root: setattr(cell(root, "S2"), "text", amount))

    def test_moved_parsed_row_breaks_actual_link_destination(self):
        def mutate(root):
            row = next(row for row in root.iter(XML + "row") if row.get("r") == "17")
            row.set("r", "17000")
            for item in row.findall(XML + "c"):
                item.set("r", item.get("r")[:-2] + "17000")
            # Preserve valid ascending OOXML row order. The destination check,
            # rather than the ordering check, must catch this missing address.
            data = root.find(XML + "sheetData")
            data.remove(row)
            data.append(row)
        self.mutate_sheet("xl/worksheets/sheet14.xml", mutate)

    def test_cell_address_must_agree_with_physical_row(self):
        def mutate(root):
            item = next(item for item in root.iter(XML + "c") if item.get("r") == "A17")
            item.set("r", "A17000")
        self.mutate_sheet("xl/worksheets/sheet14.xml", mutate)

    def test_duplicate_physical_row_fails(self):
        def mutate(root):
            import copy
            data = root.find(XML + "sheetData")
            data.append(copy.deepcopy(data[16]))
        self.mutate_sheet("xl/worksheets/sheet14.xml", mutate)

    def test_match_displayed_date_fails(self):
        self.mutate_sheet("xl/worksheets/sheet2.xml", lambda root: setattr(cell(root, "C2"), "text", "46219"))

    def test_match_displayed_reference_fails(self):
        self.mutate_sheet("xl/worksheets/sheet2.xml", lambda root: setattr(cell(root, "D2"), "text", cell(root, "D3").text))

    def test_match_rule_must_agree_with_evidence(self):
        self.mutate_sheet("xl/worksheets/sheet2.xml", lambda root: setattr(cell(root, "K2"), "text", cell(root, "D2").text))

    def test_review_total_fails(self):
        self.mutate_sheet("xl/worksheets/sheet3.xml", lambda root: setattr(cell(root, "E2"), "text", "163"))

    def test_review_source_text_fails(self):
        self.mutate_sheet("xl/worksheets/sheet3.xml", lambda root: setattr(cell(root, "P2"), "text", cell(root, "P3").text))

    def test_review_source_link_fails_even_when_relationship_agrees(self):
        def sheet(root):
            link = next(link for link in root.iter(XML + "hyperlink") if link.get("ref") == "P2")
            link.set("location", "#'Parsed Supplier Source'!A25")
        def relations(root):
            next(link for link in root if link.get("Id") == "rId1").set("Target", "#'Parsed Supplier Source'!A25")
        change_parts(self.changed, {
            "xl/worksheets/sheet3.xml": lambda data: rewrite_xml(data, sheet),
            "xl/worksheets/_rels/sheet3.xml.rels": lambda data: rewrite_xml(data, relations),
        })
        self.check(self.changed, False)

    def test_duplicate_evidence_member_fails(self):
        self.mutate_sheet("xl/worksheets/sheet8.xml", lambda root: setattr(cell(root, "G4"), "text", cell(root, "G2").text))

    def test_missing_evidence_member_fails(self):
        def mutate(root):
            data = root.find(XML + "sheetData")
            data.remove(next(row for row in data if row.get("r") == "2"))
        self.mutate_sheet("xl/worksheets/sheet8.xml", mutate)

    def test_ambiguous_duplicate_cannot_be_approved(self):
        def mutate(root):
            matched_index = cell(root, "C2").text
            for row in root.find(XML + "sheetData"):
                cells = {"".join(letter for letter in item.get("r") if letter.isalpha()): item
                         for item in row.findall(XML + "c")}
                if "I" in cells and cells["I"].find(XML + "v") is not None:
                    if cells["I"].find(XML + "v").text in ("14", "15"):
                        cells["C"].find(XML + "v").text = matched_index
        self.mutate_sheet("xl/worksheets/sheet8.xml", mutate)

    def test_wrong_link_target_fails_even_when_relationship_agrees(self):
        def sheet(root):
            link = next(link for link in root.iter(XML + "hyperlink") if link.get("ref") == "T2")
            link.set("location", "#'Parsed Supplier Source'!A27")
        def relations(root):
            link = next(link for link in root if link.get("Id") == "rId1")
            link.set("Target", "#'Parsed Supplier Source'!A27")
        change_parts(self.changed, {
            "xl/worksheets/sheet8.xml": lambda data: rewrite_xml(data, sheet),
            "xl/worksheets/_rels/sheet8.xml.rels": lambda data: rewrite_xml(data, relations),
        })
        self.check(self.changed, False)

    def test_match_source_text_change_fails(self):
        self.mutate_sheet("xl/worksheets/sheet2.xml", lambda root: setattr(cell(root, "R2"), "text", cell(root, "R3").text))


if __name__ == "__main__":
    unittest.main()
