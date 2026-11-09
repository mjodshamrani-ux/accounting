"""UX-6(c): the signed checker reads the page's workpaper, the reconciliation
sheet first and set aside, and the evidence after it held exactly as
without it; a sheet out of place, hidden, or with its cell formats among the
evidence's is refused. The workpapers are written by export-workpapers.mjs
into a private folder; synthetic only."""
import importlib.util
import re
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "signed_checker", ROOT / "scripts/check-payment-gateway-signed-exports.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def rewrite(source, target, edit):
    """The same package with one part changed by `edit(name, data)`."""
    with zipfile.ZipFile(source) as z:
        parts = {name: z.read(name) for name in z.namelist()}
    for name in list(parts):
        parts[name] = edit(name, parts[name])
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
    return target


def sheet_part(path, name):
    """The part a sheet of the workbook is written in, by its name."""
    with zipfile.ZipFile(path) as z:
        book = z.read("xl/workbook.xml").decode()
        rels = z.read("xl/_rels/workbook.xml.rels").decode()
    tag = next(t for t in re.findall(r"<sheet [^>]*/>", book) if f'name="{name}"' in t)
    rid = re.search(r'r:id="([^"]+)"', tag).group(1)
    target = re.search(rf'Id="{rid}"[^>]*Target="([^"]+)"', rels).group(1)
    return "xl/" + target.lstrip("/").removeprefix("xl/")


class SheetFirst(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls.tmp.name)
        subprocess.run(
            ["node", "--experimental-strip-types",
             str(ROOT / "audit/payment-gateway-signed/export-workpapers.mjs"), str(cls.dir)],
            check=True, cwd=ROOT, capture_output=True)
        cls.session = cls.dir / "session.json"

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def verify(self, path):
        return checker.verify_artifact(path, self.session, "sar-mixed")

    def test_the_workpaper_in_either_language_and_the_evidence_alone(self):
        for name, title in [("workpaper-ar.xlsx", "ورقة التسوية"),
                            ("workpaper-en.xlsx", "Reconciliation sheet"),
                            ("evidence.xlsx", None)]:
            path = self.dir / name
            with zipfile.ZipFile(path) as z:
                book = z.read("xl/workbook.xml").decode()
            first = re.findall(r'<sheet [^>]*name="([^"]+)"', book)[0]
            self.assertEqual(first, title or "Summary", name)
            result = self.verify(path)
            self.assertTrue(result["passed"], name)
            self.assertEqual(len(result["all15TablesCompared"]), 15, name)

    def test_a_sheet_out_of_place_is_refused(self):
        def last(name, data):
            if name != "xl/workbook.xml":
                return data
            text = data.decode()
            first = re.search(r'<sheet name="Reconciliation sheet"[^>]*/>', text).group(0)
            text = text.replace(first, "", 1).replace("</sheets>", first + "</sheets>", 1)
            return text.encode()
        moved = rewrite(self.dir / "workpaper-en.xlsx", self.dir / "moved.xlsx", last)
        with self.assertRaisesRegex(checker.Rejected, "reconciliation sheet out of place"):
            self.verify(moved)

    def test_a_hidden_sheet_is_refused(self):
        def hide(name, data):
            if name != "xl/workbook.xml":
                return data
            return data.decode().replace(
                '<sheet name="Reconciliation sheet"', '<sheet state="hidden" name="Reconciliation sheet"', 1).encode()
        hidden = rewrite(self.dir / "workpaper-en.xlsx", self.dir / "hidden.xlsx", hide)
        with self.assertRaisesRegex(checker.Rejected, "hidden reconciliation sheet"):
            self.verify(hidden)

    def test_a_sheet_whose_formats_are_the_evidence_formats_is_refused(self):
        source = self.dir / "workpaper-en.xlsx"
        part = sheet_part(source, "Reconciliation sheet")
        def borrow(name, data):
            if name != part:
                return data
            text = data.decode()
            changed = re.sub(r' s="\d+"', ' s="1"', text, count=1)
            self.assertNotEqual(changed, text)
            return changed.encode()
        borrowed = rewrite(source, self.dir / "borrowed.xlsx", borrow)
        with self.assertRaisesRegex(checker.Rejected, "reconciliation sheet styles among the evidence styles"):
            self.verify(borrowed)


if __name__ == "__main__":
    unittest.main()
