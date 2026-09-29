"""Focused CLI checks for package identity, including non-transaction parts."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile


SCRIPT = Path(__file__).with_name("check_package_identity.py")
PARTS = {
    "[Content_Types].xml": b"<Types/>",
    "xl/workbook.xml": b"<workbook/>",
    "xl/worksheets/sheet1.xml": b"<transactions>same</transactions>",
    "xl/worksheets/sheet2.xml": b"<Matches>same</Matches>",
}


def write_package(path, parts, compression, duplicate=None):
    with zipfile.ZipFile(path, "w", compression=compression) as archive:
        archive.comment = b"different container metadata"
        for name, data in parts.items():
            archive.writestr(name, data)
        if duplicate:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                archive.writestr(duplicate, parts[duplicate])


class PackageIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.baseline = Path(self.temp.name) / "baseline.xlsx"
        self.candidate = Path(self.temp.name) / "candidate.xlsx"
        write_package(self.baseline, PARTS, zipfile.ZIP_DEFLATED)

    def check(self):
        process = subprocess.run(
            [sys.executable, str(SCRIPT), str(self.baseline), str(self.candidate)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertFalse(process.stderr, process.stderr)
        return process.returncode, json.loads(process.stdout)

    def test_recompressed_identical_package_passes(self):
        write_package(self.candidate, PARTS, zipfile.ZIP_STORED)
        code, result = self.check()
        self.assertEqual(code, 0)
        self.assertTrue(result["identical"])

    def test_explicit_directory_entries_are_container_only(self):
        write_package(self.candidate, PARTS, zipfile.ZIP_STORED)
        with zipfile.ZipFile(self.candidate, "a") as archive:
            archive.writestr("xl/worksheets/", b"")
        code, result = self.check()
        self.assertEqual(code, 0)
        self.assertTrue(result["identical"])

    def test_changed_matches_fails_even_when_transactions_unchanged(self):
        parts = dict(PARTS)
        parts["xl/worksheets/sheet2.xml"] = b"<Matches>changed</Matches>"
        write_package(self.candidate, parts, zipfile.ZIP_STORED)
        code, result = self.check()
        self.assertEqual(code, 1)
        self.assertEqual(result["changed"], ["xl/worksheets/sheet2.xml"])

    def test_missing_or_extra_part_fails(self):
        for parts, key in (
            ({k: v for k, v in PARTS.items() if k != "xl/workbook.xml"}, "missingFromCandidate"),
            ({**PARTS, "xl/extra.xml": b"<extra/>"}, "extraInCandidate"),
        ):
            with self.subTest(key=key):
                write_package(self.candidate, parts, zipfile.ZIP_STORED)
                code, result = self.check()
                self.assertEqual(code, 1)
                self.assertEqual(len(result[key]), 1)

    def test_duplicate_name_fails(self):
        write_package(
            self.candidate, PARTS, zipfile.ZIP_STORED, duplicate="xl/workbook.xml"
        )
        code, result = self.check()
        self.assertEqual(code, 1)
        self.assertEqual(result["duplicateNames"]["candidate"], ["xl/workbook.xml"])

    def test_crc_error_fails(self):
        write_package(self.candidate, PARTS, zipfile.ZIP_STORED)
        damaged = self.candidate.read_bytes().replace(
            b"<Matches>same</Matches>", b"<Matches>evil</Matches>", 1
        )
        self.candidate.write_bytes(damaged)
        code, result = self.check()
        self.assertEqual(code, 1)
        self.assertEqual(result["errors"][0]["archive"], "candidate")

    def test_corrupt_deflate_returns_json_failure(self):
        write_package(self.candidate, PARTS, zipfile.ZIP_DEFLATED)
        with zipfile.ZipFile(self.candidate) as archive:
            offset = archive.getinfo("xl/worksheets/sheet2.xml").header_offset
        damaged = bytearray(self.candidate.read_bytes())
        name_length = int.from_bytes(damaged[offset + 26 : offset + 28], "little")
        extra_length = int.from_bytes(damaged[offset + 28 : offset + 30], "little")
        compressed_start = offset + 30 + name_length + extra_length
        damaged[compressed_start] = 0xFF  # Invalid raw DEFLATE block type.
        self.candidate.write_bytes(damaged)
        code, result = self.check()
        self.assertEqual(code, 1)
        self.assertEqual(result["errors"][0]["archive"], "candidate")


if __name__ == "__main__":
    unittest.main()
