"""The cashbook check against planted faults (G16): a clean cashbook reads
with the entries it was written with, and each workbook built with one
refusal the product declares is refused with the product's code and row.
Workbooks are built here with zipfile, so neither the product nor a writer a
holdout uses makes them. Standard library only.

  python3 -B -m unittest discover -s audit/bank-statement-eligibility -p test_cashbook.py -v
"""
import csv
import glob
import io
import sys
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cashbook  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix='cashbook-'))
MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties'
DC = 'http://purl.org/dc/elements/1.1/'
ROWS = [
    ['Date', 'Voucher', 'Description', 'Reference', 'Receipts', 'Payments'],
    ['2027-01-05', 'RV-1', 'Synthetic receipt', 'FT1', '1150.00', ''],
    ['2027-01-06', 'PV-1', 'Synthetic payment', 'FT2', '', '200.00'],
    ['2027-01-07', 'RV-2', 'Synthetic transfer', 'FT3', '75.50', ''],
]
SEALED = sorted(glob.glob(str(cashbook.ROOT / 'audit/bank-statement-*/frozen/*-cashbook.xlsx')))


def serial(day):
    return (day - date(1899, 12, 30)).days


def book(name, rows=ROWS, cells=None, fonts=('<font/>',), fills=(), xfs=('<xf/>',), formats=(),
         cols='', merges=(), state=None, core=None, sheets=1, view='', conditional='', doctype=False):
    """A workbook of inline strings, with `cells` replacing single cells by
    raw <c> XML ({'E2': '<c r="E2" s="1"><v>1150</v></c>'}; None drops it)."""
    cells = cells or {}
    lines = []
    for r, row in enumerate(rows, 1):
        xml = []
        for c, text in enumerate(row, 1):
            ref = f'{chr(64 + c)}{r}'
            if ref in cells:
                if cells[ref] is not None:
                    xml.append(cells[ref])
            elif text != '':
                xml.append(f'<c r="{ref}" t="inlineStr"><is><t>{text}</t></is></c>')
        extra = [v for k, v in cells.items() if v is not None and int(k[1:]) == r and ord(k[0]) - 64 > len(row)]
        lines.append(f'<row r="{r}">{"".join(xml + extra)}</row>')
    merged = ''.join('<mergeCell ref="%s"/>' % m for m in merges)
    merge = '<mergeCells count="%d">%s</mergeCells>' % (len(merges), merged) if merges else ''
    columns = '<cols>%s</cols>' % cols if cols else ''
    sheet = (f'<?xml version="1.0" encoding="UTF-8"?>{"<!DOCTYPE worksheet>" if doctype else ""}'
             f'<worksheet xmlns="{MAIN}" xmlns:r="{REL}"><sheetViews><sheetView workbookViewId="0"{view}/></sheetViews>'
             f'{columns}<sheetData>{"".join(lines)}</sheetData>{merge}{conditional}</worksheet>')
    fill_xml = ''.join(['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', *fills])
    number_formats = '<numFmts>%s</numFmts>' % ''.join(formats) if formats else ''
    styles = (f'<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="{MAIN}">'
              f'{number_formats}'
              f'<fonts>{"".join(fonts)}</fonts><fills>{fill_xml}</fills><borders><border/></borders>'
              f'<cellStyleXfs><xf/></cellStyleXfs><cellXfs>{"".join(xfs)}</cellXfs></styleSheet>')
    shown = ' state="%s"' % state if state else ''
    entries = ''.join(f'<sheet name="S{i}" sheetId="{i}" r:id="rId{i}"{shown if i == 1 else ""}/>'
                      for i in range(1, sheets + 1))
    workbook = f'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="{MAIN}" xmlns:r="{REL}"><sheets>{entries}</sheets></workbook>'
    rels = ('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + ''.join(f'<Relationship Id="rId{i}" Type="{REL}/worksheet" Target="worksheets/sheet{i}.xml"/>'
                      for i in range(1, sheets + 1)) + '</Relationships>')
    path = TMP / f'{name}.xlsx'
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('xl/workbook.xml', workbook)
        z.writestr('xl/_rels/workbook.xml.rels', rels)
        z.writestr('xl/styles.xml', styles)
        for i in range(1, sheets + 1):
            z.writestr(f'xl/worksheets/sheet{i}.xml', sheet)
        if core is not None:
            z.writestr('docProps/core.xml', core)
    return path


def verdict(path, **kw):
    r = cashbook.check(path, **kw)
    return (r['refused']['code'], r['refused']['row']) if r['refused'] else None


class Cashbook(unittest.TestCase):
    def test_a_clean_cashbook_reads_with_the_entries_written(self):
        r = cashbook.check(book('clean'))
        self.assertIsNone(r['refused'])
        want = [{'id': v, 'row': i + 2, 'date': d, 'description': t, 'reference': f,
                 'direction': 'in' if rc else 'out', 'amount': int((rc or pc).replace('.', ''))}
                for i, (d, v, t, f, rc, pc) in enumerate(ROWS[1:])]
        self.assertEqual(r['entries'], want)

    def test_typed_amounts_hold_their_value_and_dates_their_day(self):
        typed = {'E2': '<c r="E2" s="1"><v>366445</v></c>', 'F3': '<c r="F3" s="1"><v>200</v></c>',
                 'E4': '<c r="E4" s="1"><v>75.5</v></c>',
                 'A2': f'<c r="A2" s="2"><v>{serial(date(2027, 1, 5))}</v></c>'}
        xfs = ('<xf/>', '<xf numFmtId="2" applyNumberFormat="1"/>', '<xf numFmtId="14" applyNumberFormat="1"/>')
        r = cashbook.check(book('typed', cells=typed, xfs=xfs))
        self.assertIsNone(r['refused'])
        self.assertEqual([e['amount'] for e in r['entries']], [36644500, 20000, 7550])
        self.assertEqual(r['entries'][0]['date'], '2027-01-05')
        self.assertEqual(r['exercised']['typedAmounts'], 3)
        self.assertEqual(r['exercised']['typedDates'], 1)
        # Before G8 a typed number needed its printed decimals.
        self.assertEqual(verdict(book('typed', cells=typed, xfs=xfs), typed_amounts=False), ('AMOUNT', 2))
        three = {'E2': '<c r="E2" s="1"><v>12.345</v></c>'}
        self.assertEqual(verdict(book('three', cells=three, xfs=xfs)), ('AMOUNT', 2))
        self.assertEqual(verdict(book('text-whole', rows=[ROWS[0], ['2027-01-05', 'RV-1', 'x', 'y', '1150', '']])), ('AMOUNT', 2))

    def test_unreadable_hidden_computed_merged_or_errors_are_refused(self):
        white = ('<font/>', '<font><color rgb="FFFFFFFF"/></font>')
        cases = {
            'white-font': (dict(cells={'F3': '<c r="F3" s="1" t="inlineStr"><is><t>200.00</t></is></c>'}, fonts=white,
                                xfs=('<xf/>', '<xf fontId="1" applyFont="1"/>')), ('CELL', 3)),
            'gray-on-gray': (dict(cells={'C2': '<c r="C2" s="1" t="inlineStr"><is><t>x</t></is></c>'},
                                  fonts=('<font/>', '<font><color rgb="FF808080"/></font>'),
                                  fills=('<fill><patternFill patternType="solid"><fgColor rgb="FF7F7F7F"/></patternFill></fill>',),
                                  xfs=('<xf/>', '<xf fontId="1" fillId="2" applyFont="1" applyFill="1"/>')), ('CELL', 2)),
            'hidden-column': (dict(cols='<col min="5" max="5" hidden="1"/>'), ('CELL', 1)),
            'zero-width-column': (dict(cols='<col min="3" max="3" width="0"/>'), ('CELL', 1)),
            'formula': (dict(cells={'E2': '<c r="E2"><f>1000+150</f><v>1150</v></c>'}), ('CELL', 2)),
            'error': (dict(cells={'C3': '<c r="C3" t="e"><v>#N/A</v></c>'}), ('CELL', 3)),
            'merged': (dict(merges=('C2:D2',)), ('CELL', 2)),
            'voucher-too-long': (dict(cells={'B3': '<c r="B3"><v>12345678901234567890</v></c>'}), ('CELL', 3)),
            # Exact digits, no precision note: only the 1e15 rule refuses it.
            'voucher-1e16': (dict(cells={'B3': '<c r="B3"><v>10000000000000000</v></c>'}), ('CELL', 3)),
            'sign-hidden': (dict(cells={'F3': '<c r="F3" s="1"><v>-200</v></c>'}, formats=('<numFmt numFmtId="164" formatCode="0.00;0.00"/>',),
                                 xfs=('<xf/>', '<xf numFmtId="164" applyNumberFormat="1"/>')), ('CELL', 3)),
            'text-format': (dict(cells={'C2': '<c r="C2" s="1" t="inlineStr"><is><t>x</t></is></c>'},
                                 formats=('<numFmt numFmtId="164" formatCode="0;0;0;&quot;x&quot;"/>',),
                                 xfs=('<xf/>', '<xf numFmtId="164" applyNumberFormat="1"/>')), ('CELL', 2)),
            'zero-hidden': (dict(cells={'F2': '<c r="F2"><v>0</v></c>'}, view=' showZeros="0"'), ('CELL', 2)),
            'conditional-format': (dict(conditional='<conditionalFormatting sqref="E2:E4"><cfRule type="cellIs" operator="greaterThan" priority="1"><formula>1000</formula></cfRule></conditionalFormatting>'), ('CELL', 1)),
        }
        for name, (kw, want) in cases.items():
            with self.subTest(name):
                self.assertEqual(verdict(book(name, **kw)), want)

    def test_an_identifier_is_refused_where_an_amount_is_read_by_its_value(self):
        xfs = ('<xf/>', '<xf numFmtId="2" applyNumberFormat="1"/>', '<xf numFmtId="164" applyNumberFormat="1"/>')
        formats = ('<numFmt numFmtId="164" formatCode="000000"/>',)
        self.assertEqual(verdict(book('ref-format', cells={'D3': '<c r="D3" s="1"><v>17</v></c>'}, xfs=xfs)), ('CELL', 3))
        padded = cashbook.check(book('ref-padded', cells={'D3': '<c r="D3" s="2"><v>17</v></c>'}, xfs=xfs, formats=formats))
        self.assertIsNone(padded['refused'])
        self.assertEqual(padded['entries'][1]['reference'], '000017')
        self.assertEqual(verdict(book('ref-lexeme', cells={'D2': '<c r="D2"><v>1709.0999999999999</v></c>'})), ('CELL', 2))
        amount = cashbook.check(book('amount-lexeme', cells={'E2': '<c r="E2"><v>1149.9999999999999</v></c>'}))
        self.assertIsNone(amount['refused'])
        self.assertEqual(amount['entries'][0]['amount'], 115000)
        self.assertEqual(amount['exercised']['precisionNotes'], 1)

    def test_the_table_rules(self):
        cases = {
            'hidden-sheet': (dict(state='hidden'), ('SHEET', 1)),
            'two-sheets': (dict(sheets=2), ('HEADER', 1)),
            'extra-column': (dict(cells={'G3': '<c r="G3" t="inlineStr"><is><t>note</t></is></c>'}), ('HEADER', 1)),
            'styled-empty-column': (dict(cells={'G2': '<c r="G2" s="0"/>'}), ('HEADER', 1)),
            'header': (dict(rows=[['Date', 'Voucher No', *ROWS[0][2:]], *ROWS[1:]]), ('HEADER', 1)),
            'empty-row': (dict(rows=[*ROWS[:2], ['', '', '', '', '', ''], *ROWS[2:]],
                               cells={'A3': '<c r="A3" t="inlineStr"><is><t></t></is></c>'}), ('ROW', 3)),
            'repeated-voucher': (dict(rows=[*ROWS[:3], ['2027-01-07', 'RV-1', 'x', 'y', '1.00', '']]), ('VOUCHER', 4)),
            'invalid-date': (dict(rows=[*ROWS[:2], ['2027-02-30', *ROWS[2][1:]], ROWS[3]]), ('DATE', 3)),
            'both-amounts': (dict(rows=[ROWS[0], ['2027-01-05', 'RV-1', 'x', 'y', '1150.00', '1.00']]), ('AMOUNT', 2)),
        }
        for name, (kw, want) in cases.items():
            with self.subTest(name):
                self.assertEqual(verdict(book(name, **kw)), want)

    def test_a_hidden_row_reads_and_is_noted_while_the_decision_is_open(self):
        path = book('hidden-row', rows=ROWS)
        with zipfile.ZipFile(path) as z:
            parts = {n: z.read(n) for n in z.namelist()}
        parts['xl/worksheets/sheet1.xml'] = parts['xl/worksheets/sheet1.xml'].replace(b'<row r="3">', b'<row r="3" hidden="1">')
        with zipfile.ZipFile(path, 'w') as z:
            for n, b in parts.items():
                z.writestr(n, b)
        r = cashbook.check(path)
        self.assertIsNone(r['refused'])
        self.assertEqual(r['notes'], {'hiddenRows': [3]})

    def test_core_properties_as_exceljs_reads_them(self):
        default = (f'<?xml version="1.0"?><coreProperties xmlns="{CP}" xmlns:dc="{DC}">'
                   '<dc:creator>s</dc:creator><lastModifiedBy>s</lastModifiedBy></coreProperties>')
        self.assertIsNone(verdict(book('core-default', core=default)))
        self.assertEqual(cashbook.check(book('core-default', core=default))['exercised']['coreProperties'], 'left out')
        self.assertEqual(verdict(book('core-default', core=default), renamed_core=False), ('XLSX', 0))
        other = default.replace('</coreProperties>', '<appVersion>1</appVersion></coreProperties>')
        self.assertEqual(verdict(book('core-other', core=other)), ('XLSX', 0))
        literal = f'<?xml version="1.0"?><cp:coreProperties xmlns:cp="{CP}" xmlns:dc="{DC}"><dc:creator>s</dc:creator>'
        self.assertEqual(verdict(book('core-literal-other', core=literal + '<cp:appVersion>1</cp:appVersion></cp:coreProperties>')), ('XLSX', 0))
        # ExcelJS reads leniently: an unclosed part with literal names reads.
        self.assertIsNone(verdict(book('core-unclosed', core=literal + '<cp:lastModifiedBy>')))
        self.assertEqual(verdict(book('doctype', doctype=True)), ('XLSX', 0))

    def test_before_g8_and_g15_it_finds_what_those_runs_refused(self):
        refused = lambda **kw: {Path(p).name[:3]: cashbook.check(p, **kw)['refused'] for p in SEALED}  # noqa: E731
        before_g8 = {k: v for k, v in refused(typed_amounts=False).items() if v}
        # G9's run on the product before G8's fix, the only one that reached
        # its cashbooks: N02 and N10 refused at row 2, these payments.
        self.assertEqual((before_g8['N02']['row'], before_g8['N02']['detail']), (2, "payments '12732'"))
        self.assertEqual((before_g8['N10']['row'], before_g8['N10']['detail']), (2, "payments '14267'"))
        self.assertEqual(sorted(before_g8), ['K02', 'N02', 'N10', 'P04', 'Q03', 'R03', 'T03'])
        self.assertEqual(sorted(k for k, v in refused(renamed_core=False).items() if v), ['T03', 'T10'])
        self.assertFalse(any(refused().values()))

    def test_each_sealed_workbook_reads_as_its_text_twin(self):
        self.assertEqual(len(SEALED), 15)
        for path in SEALED:
            with self.subTest(Path(path).name):
                rows = list(csv.reader(io.StringIO(Path(path[:-4] + 'csv').read_text(encoding='utf-8'))))
                want = [{'id': v, 'row': i + 2, 'date': d, 'description': t, 'reference': f,
                         'direction': 'in' if rc else 'out', 'amount': int((rc or pc).replace('.', ''))}
                        for i, (d, v, t, f, rc, pc) in enumerate(rows[1:]) if any([d, v, t, f, rc, pc])]
                self.assertEqual(cashbook.check(path)['entries'], want)

    def test_numbers_are_written_as_javascript_writes_them(self):
        for x, want in ((1150.0, '1150'), (8620.08, '8620.08'), (1e-5, '0.00001'), (1e21, '1e+21'),
                        (1.2345678901234567e19, '12345678901234567000'), (2.5e-7, '2.5e-7'), (-0.5, '-0.5')):
            self.assertEqual(cashbook.js_number(x), want)

    def test_what_it_copies_is_still_the_products(self):
        self.assertEqual(cashbook.drift(), [])


if __name__ == '__main__':
    unittest.main()
