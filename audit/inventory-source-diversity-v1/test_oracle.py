"""Pre-product hand-fixed truth and negative controls for the independent oracle."""
import copy
import csv
import json
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest
from zipfile import ZipFile
from oracle import check_case, read_rows

HERE = Path(__file__).resolve().parent
# Intentionally hand-fixed, not imported from producer, product, or corpus.json.
KEYS = [
    ['0007', 'warehouse=W1;batch=B01'], ['0007', 'warehouse=W1;batch=B02'],
    ['0007', 'warehouse=W2;batch=B01'], ['0008', 'warehouse=W1;batch=B00'],
]
VALUES = ['600.00', '400.00', '500.00', '0.00']
MINORS = [60000, 40000, 50000, 0]
QUANTITIES = ['10', '10', '10', '0']
VALUATIONS = ['V-0007-W1-B01', 'V-0007-W1-B02', 'V-0007-W2-B01', 'V-0008-W1-B00']
EXPECTED_SCOPE = {
    'Entity': 'Synthetic INV1 Owner', 'Inventory ledger': 'STOCK-BOOK', 'GL ledger': 'GL-BOOK',
    'Currency': 'SAR', 'Currency basis': 'functional', 'Posting status': 'posted', 'Posting layer': 'Current',
    'As of': '2026-09-30', 'Chart version': 'CHART-INV1', 'Map version': 'MAP-INV1',
    'Valuation policy version': 'provided-posted-values-1', 'Inventory account set version': 'INV-SET-1',
}
# Hand-written source-role columns, deliberately not imported from oracle.py.
COLUMNS = [
    ['Item ID', 'Item dimensions', 'Quantity', 'Unit', 'Quantity precision', 'Posted value', 'Valuation reference'],
    ['Mapping ID', 'Item ID', 'Item dimensions', 'GL account', 'GL dimensions', 'Evidence ID'],
    ['Evidence ID', 'Item ID', 'Item dimensions', 'Unit', 'Quantity precision', 'Valuation reference', 'GL account', 'GL dimensions', 'Account class', 'Sign', 'Value basis', 'Valid from', 'Valid to', 'Reference'],
    ['GL account', 'GL dimensions', 'Account class', 'Debit', 'Credit'],
]


class OracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='inv1a-independent-')
        cls.root = Path(cls.temp.name) / 'sources'
        subprocess.run([sys.executable, str(HERE / 'generate.py'), '--output-dir', str(cls.root)], check=True)
    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()
    def inspect(self, name):
        return check_case(self.root / 'cases' / name)
    def mutate_csv_case(self, filename, edit):
        with tempfile.TemporaryDirectory(dir=self.temp.name) as tmp:
            folder = Path(tmp) / 'case'
            shutil.copytree(self.root / 'cases/INV1A-P02', folder)
            path = folder / filename
            _, rows = read_rows(path); edit(rows)
            with path.open('w', encoding='utf-8', newline='') as stream:
                csv.writer(stream, lineterminator='\n').writerows(rows)
            return check_case(folder)
    def citations_are_literal(self, result):
        self.assertEqual(len(result['sources']), 4)
        for source_index, source in enumerate(result['sources']):
            self.assertEqual(source['role'], source_index)
            for row_number, row in enumerate(source['inventory'], 1):
                self.assertEqual(row['row'], row_number)
                self.assertNotEqual(row['fate'], 'unclassified')
                for column, cell in enumerate(row['cells'], 1):
                    self.assertEqual((cell['source'], cell['row'], cell['column']), (source_index, row_number, column))
            rows = {row['row']: row for row in source['inventory']}
            for record in source['records']:
                for values, citations in [('raw', 'citations'), ('scope', 'scopeCitations')]:
                    self.assertEqual(set(record[values]), set(record[citations]))
                    for field, citation in record[citations].items():
                        self.assertEqual(citation['source'], source_index)
                        self.assertIn(citation['row'], rows)
                        self.assertIn(citation['column'], range(1, len(rows[citation['row']]['cells']) + 1))
                        actual = rows[citation['row']]['cells'][citation['column'] - 1]
                        self.assertEqual(actual, citation)
                        self.assertEqual(record[values][field], actual['raw'])
    def assert_positive(self, result):
        self.assertEqual(result['financial'], 'ready')
        self.assertEqual(result['review'], 'needs-review')
        self.assertEqual(result['issues'], [])
        self.assertEqual(result['missing'], [])
        self.assertEqual(result['totals'], {'registerMinor': 150000, 'glMinor': 150000})
        self.assertEqual([len(s['records']) for s in result['sources']], [4, 4, 4, 2])
        for index, record in enumerate(result['sources'][0]['records']):
            self.assertEqual(record['raw'], {'Item ID': KEYS[index][0], 'Item dimensions': KEYS[index][1], 'Quantity': QUANTITIES[index], 'Unit': 'EA', 'Quantity precision': '0', 'Posted value': VALUES[index], 'Valuation reference': VALUATIONS[index]})
            self.assertEqual(record['postedValueMinor'], MINORS[index])
            self.assertEqual(record['quantityUnits'], [10, 10, 10, 0][index])
        for source in result['sources']:
            self.assertTrue(all(r['scope'] == EXPECTED_SCOPE for r in source['records']))
        self.assertEqual(result['comparisons'], [
            {'account': 'INV-1', 'dimensions': 'branch=01', 'members': [KEYS[0], KEYS[1], KEYS[3]], 'registerMinor': 100000, 'debitMinor': 100000, 'creditMinor': 0, 'differenceMinor': 0},
            {'account': 'INV-1', 'dimensions': 'branch=02', 'members': [KEYS[2]], 'registerMinor': 50000, 'debitMinor': 50000, 'creditMinor': 0, 'differenceMinor': 0},
        ])
        self.citations_are_literal(result)
        self.assert_fact_locations(result)
    def assert_fact_locations(self, result):
        section_rows = {'Item ID': 15, 'Item dimensions': 16, 'Quantity': 21, 'Unit': 17, 'Quantity precision': 18, 'Posted value': 22, 'Valuation reference': 19}
        matrix_rows = {'Item ID': 15, 'Item dimensions': 16, 'Quantity': 17, 'Unit': 18, 'Quantity precision': 19, 'Posted value': 20, 'Valuation reference': 21}
        for source_index, source in enumerate(result['sources']):
            inventory = source['inventory']
            structured = source_index == 0 and result['layout'] in ['sections', 'matrix']
            for fact_index, record in enumerate(source['records']):
                for field_index, field in enumerate(COLUMNS[source_index]):
                    row, column = (section_rows[field] + 10 * fact_index, 2) if structured and result['layout'] == 'sections' else (matrix_rows[field], fact_index + 2) if structured else (fact_index + 2, field_index + 1)
                    self.assertEqual((record['citations'][field]['row'], record['citations'][field]['column']), (row, column))
                    self.assertEqual(inventory[row - 1 if structured else 0]['cells'][0 if structured else column - 1]['raw'], field)
                for scope_index, field in enumerate(EXPECTED_SCOPE):
                    row, column = (scope_index + 2, 3) if structured else (fact_index + 2, len(COLUMNS[source_index]) + scope_index + 1)
                    self.assertEqual((record['scopeCitations'][field]['row'], record['scopeCitations'][field]['column']), (row, column))
                    self.assertEqual(inventory[row - 1 if structured else 0]['cells'][1 if structured else column - 1]['raw'], field)
                if structured and result['layout'] == 'sections':
                    for row, marker in [(14 + 10 * fact_index, 'Section'), (23 + 10 * fact_index, 'End section')]:
                        self.assertEqual([c['raw'] for c in inventory[row - 1]['cells']], [marker])
    def test_four_positive_presentations_and_fixed_source_coordinates(self):
        coordinates = {'P01': (2, 3, 2, 6, 5), 'P02': (21, 2, 22, 2, 54), 'P03': (21, 2, 22, 2, 54), 'P04': (17, 2, 20, 2, 22)}
        for suffix, (qr, qc, vr, vc, row_count) in coordinates.items():
            with self.subTest(suffix=suffix):
                result = self.inspect('INV1A-' + suffix)
                self.assert_positive(result)
                self.assertEqual(len(result['sources'][0]['inventory']), row_count)
                first = result['sources'][0]['records'][0]['citations']
                self.assertEqual((first['Quantity']['row'], first['Quantity']['column']), (qr, qc))
                self.assertEqual((first['Posted value']['row'], first['Posted value']['column']), (vr, vc))
        self.assertEqual(self.inspect('INV1A-P04')['runtimeCommitment'], 'exploratory-unsupported')
        matrix = self.inspect('INV1A-P04')['sources'][0]
        field_rows = {'Item ID': 15, 'Item dimensions': 16, 'Quantity': 17, 'Unit': 18, 'Quantity precision': 19, 'Posted value': 20, 'Valuation reference': 21}
        for index, record in enumerate(matrix['records']):
            for field, row in field_rows.items():
                self.assertEqual(record['citations'][field], {'source': 0, 'row': row, 'column': index + 2, 'raw': record['raw'][field]})
    def test_eight_structural_counterexamples_preserve_all_physical_rows(self):
        required = {'N01': 'MISSING_SECTION_FIELD', 'N02': 'ORPHAN_COMPONENT', 'N03': 'MISSING_COMPONENT', 'N04': 'DUPLICATE_COMPONENT', 'N06': 'SCOPE_CONFLICT', 'N07': 'CONTROL_MISMATCH', 'N08': 'DUPLICATE_FIELD'}
        for suffix, code in required.items():
            with self.subTest(suffix=suffix):
                result = self.inspect('INV1A-' + suffix)
                self.assertEqual(result['financial'], 'source-error')
                self.assertIsNone(result['totals'])
                self.assertIn(code, [i['code'] for i in result['issues']])
                self.assertTrue(all(c['registerMinor'] is None and c['differenceMinor'] is None for c in result['comparisons']))
                self.citations_are_literal(result)
        swapped = self.inspect('INV1A-N05')
        self.assertEqual(swapped['financial'], 'missing')
        self.assertEqual(swapped['missing'], ['POLICY_BINDING', 'POLICY_BINDING'])
        self.assertEqual(swapped['issues'], [])
        self.assertEqual([r['raw']['Posted value'] for r in swapped['sources'][0]['records']], VALUES)
        missing = self.inspect('INV1A-N03')['sources'][0]['records'][3]
        self.assertEqual(missing['raw']['Quantity'], '0')
        self.assertNotIn('Posted value', missing['raw'])
        self.assertNotIn('Posted value', missing['citations'])
        self.assertEqual(self.inspect('INV1A-N08')['runtimeCommitment'], 'exploratory-unsupported')
    def test_hand_truth_rejects_balanced_wrong_members_and_changed_per_key_values(self):
        result = self.inspect('INV1A-P02')
        changed = copy.deepcopy(result)
        changed['comparisons'][0]['members'][0] = KEYS[2]
        with self.assertRaises(AssertionError): self.assert_positive(changed)
        changed = copy.deepcopy(result)
        changed['sources'][0]['records'][0]['raw']['Posted value'] = '400.00'
        changed['sources'][0]['records'][1]['raw']['Posted value'] = '600.00'
        with self.assertRaises(AssertionError): self.assert_positive(changed)
        changed = copy.deepcopy(result)
        changed['sources'][0]['records'][3]['raw'].pop('Posted value')
        with self.assertRaises(AssertionError): self.assert_positive(changed)
    def test_bad_citation_is_rejected_independently_from_financial_totals(self):
        result = self.inspect('INV1A-P03')
        result['sources'][0]['records'][0]['citations']['Posted value']['row'] = 32
        with self.assertRaises(AssertionError): self.citations_are_literal(result)
        for field in ['citations', 'scopeCitations']:
            changed = self.inspect('INV1A-P03')
            for source in changed['sources']:
                for record in source['records']: record[field] = {}
            with self.assertRaises(AssertionError): self.citations_are_literal(changed)
        for fact, field, wrong_row in [(3, 'Quantity', 48), (0, 'Item ID', 25)]:
            changed = self.inspect('INV1A-P03')
            changed['sources'][0]['records'][fact]['citations'][field]['row'] = wrong_row
            self.citations_are_literal(changed)  # Equal text alone is insufficient.
            with self.assertRaises(AssertionError): self.assert_fact_locations(changed)
    def test_duplicate_native_cell_cannot_be_hidden_by_dictionary_overwrite(self):
        source = self.root / 'cases/INV1A-P03/register.xlsx'
        bad = Path(self.temp.name) / 'duplicate.xlsx'
        with ZipFile(source) as z, ZipFile(bad, 'w') as out:
            for item in z.infolist():
                body = z.read(item.filename)
                if item.filename == 'xl/worksheets/report.xml':
                    body = body.replace(b'</row>', b'<c r="A1" t="inlineStr"><is><t>bad</t></is></c></row>', 1)
                out.writestr(item, body)
        with self.assertRaisesRegex(ValueError, 'CELL_DUPLICATE_OR_BOUND'): read_rows(bad)
    def test_unchecked_native_display_features_cannot_enter_the_oracle(self):
        controls = [
            ('row', 'xl/worksheets/report.xml', b'<row r="14">', b'<row r="14" hidden="1">', 'FIXTURE_ROW_DISPLAY'),
            ('sheet', 'xl/workbook.xml', b'sheetId="1"', b'sheetId="1" state="hidden"', 'FIXTURE_SHEET_VISIBILITY'),
            ('width', 'xl/worksheets/report.xml', b'width="30"', b'width="0"', 'FIXTURE_COLUMN_DISPLAY'),
            ('merge', 'xl/worksheets/report.xml', b'</worksheet>', b'<mergeCells count="1"><mergeCell ref="A15:B15"/></mergeCells></worksheet>', 'FIXTURE_MERGE'),
            ('format', 'xl/worksheets/report.xml', b'<cols>', b'<sheetFormatPr zeroHeight="1"/><cols>', 'FIXTURE_SHEET_FORMAT'),
            ('formula', 'xl/worksheets/report.xml', b'<c r="B22" t="inlineStr">', b'<c r="B22" t="inlineStr"><f>1</f>', 'FIXTURE_FORMULA_OR_STYLE'),
            ('styles', None, None, None, 'FIXTURE_STYLES'),
        ]
        for name, part, before, after, error in controls:
            with self.subTest(control=name):
                bad = Path(self.temp.name) / f'{name}.xlsx'
                with ZipFile(self.root / 'cases/INV1A-P03/register.xlsx') as z, ZipFile(bad, 'w') as out:
                    for item in z.infolist():
                        body = z.read(item.filename)
                        if item.filename == part:
                            self.assertIn(before, body); body = body.replace(before, after, 1)
                        out.writestr(item, body)
                    if name == 'styles': out.writestr('xl/styles.xml', '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><color rgb="FFFFFFFF"/></font></fonts><cellXfs count="1"><xf fontId="0"/></cellXfs></styleSheet>')
                with self.assertRaisesRegex(ValueError, error): read_rows(bad)
    def test_missing_gl_or_orphan_source_members_cannot_be_ready(self):
        def drop_gl(rows): rows.pop(2)
        def zero_gl(rows):
            extra = list(rows[1]); extra[1], extra[3] = 'branch=99', '0.00'; rows.append(extra)
        def duplicate_map(rows):
            extra = list(rows[1]); extra[0] = 'MAP-DUP'; rows.append(extra)
        def orphan_map(rows):
            extra = list(rows[1]); extra[0], extra[1] = 'MAP-ORPHAN', '0099'; rows.append(extra)
        def orphan_policy(rows):
            extra = list(rows[1]); extra[0] = 'POL-ORPHAN'; rows.append(extra)
        controls = [('source-3.csv', drop_gl, 'GL_BINDING'), ('source-3.csv', zero_gl, 'GL_ACCOUNT_BINDING'), ('source-1.csv', orphan_map, 'ORPHAN_MAPPING'), ('source-2.csv', orphan_policy, 'ORPHAN_POLICY')]
        for filename, edit, missing in controls:
            with self.subTest(control=edit.__name__):
                result = self.mutate_csv_case(filename, edit)
                self.assertEqual(result['financial'], 'missing')
                self.assertIn(missing, result['missing'])
                self.citations_are_literal(result)
        result = self.mutate_csv_case('source-1.csv', duplicate_map)
        self.assertEqual(result['financial'], 'source-error')
        self.assertIn('DUPLICATE_MAPPING', [i['code'] for i in result['issues']])
        self.assertIsNone(result['totals'])
        self.assertTrue(all(all(c[field] is None for field in ['registerMinor', 'debitMinor', 'creditMinor', 'differenceMinor']) for c in result['comparisons']))
    def test_scope_identity_and_end_boundaries_are_not_retroactive(self):
        # Private fault controls are temporary mutations, not more frozen fixtures.
        def move_scope(rows): rows.insert(-1, rows.pop(1))
        def early_quantity(rows): rows.insert(18, rows.pop(20))
        def late_unit(rows): rows.insert(21, rows.pop(16))
        def no_detail_header(rows): rows.pop(19)
        def unknown_format(rows): rows[0][1] = 'INV1A-SECTIONS-2'
        def after_end(rows): rows.append(['Posted value', '600.00'])
        controls = [(move_scope, 'INCOMPLETE_SCOPE_AT_SECTION'), (early_quantity, 'INCOMPLETE_IDENTITY_AT_COMPONENT'), (late_unit, 'IDENTITY_AFTER_COMPONENT'), (no_detail_header, 'MISSING_DETAIL_HEADER'), (unknown_format, 'UNKNOWN_FORMAT'), (after_end, 'AFTER_REPORT_END')]
        for edit, expected in controls:
            with self.subTest(control=edit.__name__):
                result = self.mutate_csv_case('register.csv', edit)
                self.assertEqual(result['financial'], 'source-error')
                self.assertIsNone(result['totals'])
                self.assertIn(expected, [i['code'] for i in result['issues']])
                if edit == late_unit: self.assertNotIn('Unit', result['sources'][0]['records'][0]['raw'])
                if edit == unknown_format: self.assertEqual(result['sources'][0]['records'], [])
                self.citations_are_literal(result)
    def test_inputs_have_no_generated_expected_results_and_exact_case_budget(self):
        manifest = json.loads((self.root / 'corpus.json').read_text())
        self.assertEqual(len(manifest['cases']), 12)
        self.assertEqual({c['id'] for c in manifest['cases']}, {f'INV1A-P{n:02}' for n in range(1, 5)} | {f'INV1A-N{n:02}' for n in range(1, 9)})
        self.assertTrue(all(set(c) == {'id', 'layout', 'container', 'sourceRole', 'mutation', 'files'} for c in manifest['cases']))
        self.assertEqual(len(list((self.root / 'cases').rglob('*.csv'))), 43)
        self.assertEqual(len(list((self.root / 'cases').rglob('*.xlsx'))), 5)


if __name__ == '__main__':
    unittest.main()
