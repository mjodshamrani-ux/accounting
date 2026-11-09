"""UX-6(c): the five inventory readers (section components, transposed
register, hierarchy sections, column hierarchy and the printed register's
foundation) read the page's workpaper, the reconciliation sheet first and
set aside, exactly as they read the evidence alone; and each refuses a
sheet out of place, hidden, alone or with its cell formats among the
evidence's, and still holds the evidence after it to its own display
profile. The workpapers are written by inventory-workpapers.mjs into a
private folder; synthetic only."""
import importlib.util
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
READERS = [
    'inventory-section-components/check_export.py',
    'inventory-transposed-register/check_export.py',
    'inventory-hierarchy-sections/check_export.py',
    'inventory-column-hierarchy/check_export.py',
    'inventory-pdf-foundation/check_control.py',
]


def load(relative):
    """A reader, with its own family's oracle beside it."""
    path = ROOT / 'audit' / relative
    sys.modules.pop('oracle', None)
    sys.path.insert(0, str(path.parent))
    try:
        spec = importlib.util.spec_from_file_location(
            'reader_' + path.parent.name.replace('-', '_'), path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(path.parent))
        sys.modules.pop('oracle', None)
    return module


def rewrite(source, target, edit):
    """The same package with its parts changed by `edit(name, text)`."""
    with zipfile.ZipFile(source) as z:
        parts = {name: z.read(name) for name in z.namelist()}
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            if name.endswith('.xml') or name.endswith('.rels'):
                data = edit(name, data.decode()).encode()
            z.writestr(name, data)
    return target


def sheet_part(path, name):
    """The part a sheet of the workbook is written in, by its name."""
    with zipfile.ZipFile(path) as z:
        book = z.read('xl/workbook.xml').decode()
        rels = z.read('xl/_rels/workbook.xml.rels').decode()
    tag = next(t for t in re.findall(r'<sheet [^>]*/>', book)
               if f'name="{name}"' in t)
    rid = re.search(r'r:id="([^"]+)"', tag).group(1)
    target = re.search(rf'Id="{rid}"[^>]*Target="([^"]+)"', rels).group(1)
    return 'xl/' + target.lstrip('/').removeprefix('xl/')


class SetAside(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls.tmp.name)
        subprocess.run(
            ['node', '--experimental-strip-types',
             str(ROOT / 'audit/reconciliation-sheet/inventory-workpapers.mjs'),
             str(cls.dir)],
            check=True, cwd=ROOT, capture_output=True)
        cls.readers = {r: load(r) for r in READERS}
        cls.paper = cls.dir / 'workpaper-en.xlsx'

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def refused(self, path, code):
        for name, reader in self.readers.items():
            with self.subTest(reader=name):
                with self.assertRaisesRegex(AssertionError, code):
                    reader.read_workbook(path)

    def test_the_workpaper_in_either_language_reads_as_the_evidence(self):
        for name, reader in self.readers.items():
            with self.subTest(reader=name):
                evidence = reader.read_workbook(self.dir / 'evidence.xlsx')
                self.assertEqual(list(evidence)[0], 'Summary')
                for lang in ('ar', 'en'):
                    self.assertEqual(
                        reader.read_workbook(self.dir / f'workpaper-{lang}.xlsx'),
                        evidence, lang)

    def test_a_sheet_out_of_place_is_refused(self):
        def second(name, text):
            if name != 'xl/workbook.xml':
                return text
            first, summary = re.findall(r'<sheet [^>]*/>', text)[:2]
            return text.replace(first + summary, summary + first, 1)
        self.refused(rewrite(self.paper, self.dir / 'second.xlsx', second),
                     'RECONCILIATION_SHEET_ORDER')

        def twice(name, text):
            if name != 'xl/workbook.xml':
                return text
            return text.replace('name="Register"', 'name="ورقة التسوية"', 1)
        self.refused(rewrite(self.paper, self.dir / 'twice.xlsx', twice),
                     'RECONCILIATION_SHEET_ORDER')

    def test_a_hidden_or_lone_sheet_is_refused(self):
        def hidden(name, text):
            if name != 'xl/workbook.xml':
                return text
            return text.replace('<sheet name="Reconciliation sheet"',
                                '<sheet state="hidden" name="Reconciliation sheet"', 1)
        self.refused(rewrite(self.paper, self.dir / 'hidden.xlsx', hidden),
                     'RECONCILIATION_SHEET_VISIBILITY')

        def alone(name, text):
            if name != 'xl/workbook.xml':
                return text
            tags = re.findall(r'<sheet [^>]*/>', text)
            for tag in tags[1:]:
                text = text.replace(tag, '', 1)
            return text
        self.refused(rewrite(self.paper, self.dir / 'alone.xlsx', alone),
                     'RECONCILIATION_SHEET_ALONE')

    def test_an_evidence_cell_in_the_sheets_format_is_refused(self):
        summary = sheet_part(self.paper, 'Summary')
        with zipfile.ZipFile(self.paper) as z:
            styles = z.read('xl/styles.xml').decode()
        last = int(re.search(r'<cellXfs count="(\d+)"', styles).group(1)) - 1

        def borrow(name, text):
            if name != summary:
                return text
            return text.replace('<c r="A1" t="s">', f'<c r="A1" s="{last}" t="s">', 1)
        self.refused(rewrite(self.paper, self.dir / 'borrow.xlsx', borrow),
                     'RECONCILIATION_SHEET_STYLES')

    def test_the_evidence_after_the_sheet_keeps_its_display_profile(self):
        def number_format(name, text):
            if name != 'xl/styles.xml':
                return text
            return text.replace('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
                                '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0"/>', 1)
        self.refused(rewrite(self.paper, self.dir / 'format.xlsx', number_format),
                     'OUTPUT_DISPLAY_XF')

        def font(name, text):
            if name != 'xl/styles.xml':
                return text
            return text.replace('<font><color theme="1"/>',
                                '<font><color rgb="FFFFFFFF"/>', 1)
        self.refused(rewrite(self.paper, self.dir / 'font.xlsx', font),
                     'OUTPUT_DISPLAY_FONT')

        def hidden_evidence(name, text):
            if name != 'xl/workbook.xml':
                return text
            return text.replace('name="Register" state="visible"',
                                'name="Register" state="hidden"', 1)
        self.refused(rewrite(self.paper, self.dir / 'evidence-hidden.xlsx',
                             hidden_evidence), 'SHEET_IDENTITY')

    def test_without_the_sheet_every_format_is_held_as_before(self):
        def number_format(name, text):
            if name != 'xl/styles.xml':
                return text
            return text.replace(
                '<fonts ', '<numFmts count="1"><numFmt numFmtId="164" '
                'formatCode="0.00"/></numFmts><fonts ', 1)
        self.refused(rewrite(self.dir / 'evidence.xlsx', self.dir / 'evidence-format.xlsx',
                             number_format), 'OUTPUT_DISPLAY_FORMAT')


if __name__ == '__main__':
    unittest.main()
