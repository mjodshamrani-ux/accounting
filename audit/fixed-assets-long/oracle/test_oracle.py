"""Oracle self-checks authored independently; no product/reference/generator use."""
import copy
import csv
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest
from hashlib import sha256

from compute import COMPONENTS, HEADERS, LIMIT, POLICY, SCOPE, Invalid, compute, csv_rows, day, identity, minor, utf16_length


class OracleSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='oracle-selfcheck-', dir=Path(__file__).parent)
        self.folder = Path(self.temp.name)
        self.scope = dict(zip(SCOPE, ['SYN', 'A', 'G', 'SAR', 'functional', 'posted', 'actual', '2026-09-30', 'C1', 'M1', 'P1', 'S1']))
        self.scope['confirmed'] = True
        repeated = [self.scope[k] for k in SCOPE]
        self.rows = [[list(h)] for h in HEADERS]
        for component, value in [('cost', '100.00'), ('depreciation', '20.00'), ('impairment', '5.00'), ('carrying', '75.00')]:
            self.rows[0].append(['001', 'DIM', component, value, 'VAL'] + repeated)
        for index, component in enumerate(COMPONENTS):
            account, evidence = f'A{index}', f'E{index}'
            self.rows[1].append([f'M{index}', '001', 'DIM', component, account, 'GD', evidence] + repeated)
            self.rows[2].append([evidence, '001', 'DIM', component, 'VAL', account, 'GD', *POLICY[component], 'provided-posted-component', '2026-01-01', '2026-12-31', 'Independent synthetic reference'] + repeated)
            self.rows[3].append([account, 'GD', POLICY[component][0], '100.00' if index == 0 else '0', '20.00' if index == 1 else '5.00' if index == 2 else '0'] + repeated)
        self.metadata = {'scope': self.scope, 'expectedFinancial': 'NEVER_READ', 'assertions': {'totals': 'NEVER_READ'}}

    def tearDown(self):
        self.temp.cleanup()

    def calculate(self):
        (self.folder / 'case.json').write_text(json.dumps(self.metadata), encoding='utf-8')
        for source, rows in enumerate(self.rows):
            with (self.folder / f'source-{source}.csv').open('w', encoding='utf-8', newline='') as file:
                csv.writer(file, lineterminator='\n').writerows(rows)
        return compute(self.folder)

    def test_complete_set_and_independent_exact_truth(self):
        result = self.calculate()
        self.assertEqual(result['financial'], 'ready')
        self.assertEqual(result['totals'], {'register': {'cost': 10000, 'depreciation': 2000, 'impairment': 500, 'carrying': 7500}, 'gl': {'cost': 10000, 'depreciation': 2000, 'impairment': 500, 'carrying': 7500}})
        self.assertEqual(len(result['physicalMembers']), 13)
        self.assertEqual(len(result['evidence']), 10)
        self.assertEqual(result['evidence'][0]['column'], 4)
        self.assertEqual(result['evidence'][0]['text'], '100.00')
        before = copy.deepcopy(result)
        self.metadata['expectedFinancial'] = 'source-error'
        self.metadata['assertions'] = {'totals': None}
        self.assertEqual(self.calculate(), before, 'Changing expected values cannot change compute.')

    def test_zero_is_a_required_physical_component(self):
        self.rows[0][3][3] = '0.00'
        self.rows[0][4][3] = '80.00'
        self.rows[3][3][4] = '0.00'
        self.assertEqual(self.calculate()['financial'], 'ready')
        self.rows[0].pop(3)
        result = self.calculate()
        self.assertEqual(result['financial'], 'source-error')
        self.assertIsNone(result['totals'])
        self.assertTrue(any(i['code'] == 'COMPONENT_SET' for i in result['issues']))

    def test_bad_raw_competitor_invalidates_both_original_rows(self):
        competitor = self.rows[0][1].copy()
        competitor[3] = 'not-money'
        self.rows[0].append(competitor)
        result = self.calculate()
        self.assertEqual(result['financial'], 'source-error')
        duplicate_rows = {i['row'] for i in result['issues'] if i['source'] == 0 and i['code'] == 'DUPLICATE'}
        self.assertEqual(duplicate_rows, {2, 6})
        self.assertEqual(result['evidence'][4]['text'], 'not-money')
        self.assertIsNone(result['evidence'][4]['minor'])
        self.assertEqual(len(result['physicalMembers']), 14)
        self.assertTrue(all(c['register'] is None and c['gl'] is None and c['difference'] is None for c in result['comparisons']))

    def test_valuation_scope_policy_and_equation_are_separate_gates(self):
        saved = copy.deepcopy(self.rows)
        changes = [
            lambda: self.rows[0][4].__setitem__(4, 'OTHER'),
            lambda: self.rows[0][4].__setitem__(5, 'FOREIGN'),
            lambda: self.rows[0][4].__setitem__(3, '74.99'),
            lambda: self.rows[2][1].__setitem__(8, 'credit-positive'),
            lambda: self.rows[2][1].__setitem__(11, '2026-09-29'),
        ]
        for change in changes:
            self.rows = copy.deepcopy(saved)
            change()
            result = self.calculate()
            self.assertEqual(result['financial'], 'source-error')
            self.assertIsNone(result['totals'])

    def test_absent_links_remain_missing_with_inherited_empty_allocation_diagnostic(self):
        self.rows[1].pop(1)
        result = self.calculate()
        self.assertEqual(result['financial'], 'missing')
        self.assertEqual(result['totals']['register']['cost'], 10000)
        cost = next(c for c in result['comparisons'] if c['component'] == 'cost')
        self.assertEqual(cost['register'], 0)
        self.assertEqual(cost['difference'], -10000)
        self.assertTrue(any(m['reason'] == 'orphan-evidence' for m in result['missing']))

    def test_negative_gl_stays_negative_and_components_do_not_net(self):
        self.rows[3][2][3:5] = ['20.00', '0.00']
        result = self.calculate()
        depreciation = next(c for c in result['comparisons'] if c['component'] == 'depreciation')
        self.assertEqual((depreciation['gl'], depreciation['difference']), (-2000, 4000))
        self.assertEqual(result['financial'], 'difference')
        self.rows[3][1][3] = '99.99'
        self.rows[3][2][3:5] = ['0', '19.99']
        result = self.calculate()
        self.assertEqual(result['totals']['register']['carrying'], result['totals']['gl']['carrying'])
        self.assertEqual([c['difference'] for c in result['comparisons']], [1, 1, 0])
        self.assertEqual(result['financial'], 'difference')

    def test_reordering_coordinates_and_literal_identity(self):
        self.rows[0] = [list(reversed(row)) for row in self.rows[0]]
        result = self.calculate()
        self.assertEqual(result['financial'], 'ready')
        self.assertEqual(result['evidence'][0]['column'], 14)
        self.assertEqual(identity('001'), '001')
        self.assertNotEqual(identity('001'), identity('1'))
        self.assertEqual(identity('DIM:01'), 'DIM:01')

    def test_blank_records_count_but_do_not_become_members(self):
        self.rows[0].insert(2, [])
        self.rows[1].append([''])
        result = self.calculate()
        self.assertEqual(result['financial'], 'ready')
        self.assertEqual(len(result['physicalMembers']), 13)
        self.assertEqual(sum(i['kind'] != 'header' for i in result['inventory']), 15)

    def test_exact_money_grammar_dates_utf16_and_csv(self):
        self.assertEqual(minor('1000000000000.00', 2), LIMIT)
        self.assertEqual(minor('0', 0), 0)
        self.assertEqual(minor('1.001', 3), 1001)
        for value in ['-0', '+0', '0.000', '1,000', '1e2', ' 1', '1 ', '١', '1.', '=1', '#N/A', '1000000000000.01']:
            with self.assertRaises(Invalid):
                minor(value, 2)
        self.assertEqual(day('0001-01-01'), '0001-01-01')
        self.assertEqual(day('2024-02-29'), '2024-02-29')
        for value in ['0000-01-01', '2026-02-29', '2026-09-31']:
            with self.assertRaises(Invalid):
                day(value)
        self.assertEqual(utf16_length('😀'), 2)
        self.assertEqual(identity('😀' * 250), '😀' * 250)
        with self.assertRaises(Invalid):
            identity('😀' * 251)
        for value in [' A', 'A\u200b', '#REF!', '=A', '-A']:
            with self.assertRaises(Invalid):
                identity(value)
        self.assertEqual(csv_rows(b'one,two\n\n"",x\n'), [['one', 'two'], [], ['', 'x']])
        self.assertEqual(csv_rows(b'"a,b","say ""yes"""\n'), [['a,b', 'say "yes"']])
        for value in [b'a"b,c\n', b'"a"x,c\n', b'"a,c\n', b'\xff']:
            with self.assertRaises(Invalid):
                csv_rows(value)

    def test_late_bad_policy_competitor_cannot_restore_uniqueness(self):
        competitor = self.rows[2][1].copy()
        competitor[8] = 'bad-sign'
        self.rows[2].append(competitor)
        result = self.calculate()
        self.assertEqual(result['financial'], 'source-error')
        self.assertEqual({i['row'] for i in result['issues'] if i['source'] == 2 and i['code'] == 'DUPLICATE'}, {2, 5})

    def test_derived_difference_can_be_twice_individual_bound(self):
        maximum = '1000000000000.00'
        for row in self.rows[0][1:]:
            row[3] = maximum if row[2] in ('cost', 'carrying') else '0.00'
        self.rows[3][1][3:5] = ['0.00', maximum]
        self.rows[3][2][3:5] = ['0.00', '0.00']
        self.rows[3][3][3:5] = ['0.00', '0.00']
        result = self.calculate()
        self.assertEqual(result['financial'], 'difference')
        self.assertEqual(result['comparisons'][0]['difference'], LIMIT * 2)
        self.assertEqual(result['totals']['gl']['cost'], -LIMIT)

    def test_physical_blanks_do_not_evade_combined_row_capacity(self):
        self.rows[0].extend([[] for _ in range(20000)])
        result = self.calculate()
        self.assertEqual(result['financial'], 'source-error')
        self.assertTrue(any(i['code'] == 'SOURCE_LIMIT' for i in result['issues']))

    def test_gl_running_bound_does_not_disappear_after_cancellation(self):
        first = self.rows[3][1].copy()
        first[0], first[3], first[4] = 'EXTRA-COST-PLUS', '1000000000000.00', '0.00'
        second = first.copy()
        second[0], second[3], second[4] = 'EXTRA-COST-MINUS', '0.00', '1000000000000.00'
        self.rows[3].extend([first, second])
        result = self.calculate()
        self.assertEqual(result['financial'], 'source-error')
        self.assertTrue(any(i['source'] == 3 and i['code'] == 'AGGREGATE_BOUND' for i in result['issues']))

    def test_initial_utf8_signature_preserves_original_hash_embedded_bom_refuses(self):
        original = self.calculate()
        file = self.folder / 'source-0.csv'
        bytes_with_bom = b'\xef\xbb\xbf' + file.read_bytes()
        file.write_bytes(bytes_with_bom)
        result = compute(self.folder)
        self.assertEqual(result['financial'], 'ready')
        self.assertEqual(result['totals'], original['totals'])
        self.assertEqual(result['sources'][0]['sha256'], sha256(bytes_with_bom).hexdigest())
        self.assertNotEqual(result['sources'][0]['sha256'], original['sources'][0]['sha256'])
        self.rows[0][1][0] = '00\ufeff1'
        result = self.calculate()
        self.assertEqual(result['financial'], 'source-error')
        self.assertTrue(any(i['code'] == 'IDENTITY' for i in result['issues']))
        self.rows[0][1][0] = '001'
        self.calculate()
        file.write_bytes(b'\xef\xbb\xbf\xef\xbb\xbf' + file.read_bytes())
        result = compute(self.folder)
        self.assertEqual(result['financial'], 'source-error')
        self.assertTrue(any(i['code'] == 'COLUMNS' for i in result['issues']))

    def test_global_text_guard_precedes_blank_or_identity_classification(self):
        self.rows[0].append(['\x0b'])
        result = self.calculate()
        self.assertEqual(result['financial'], 'source-error')
        self.assertTrue(any(i['source'] == 0 and i['code'] == 'CSV_CHARACTER' for i in result['issues']))
        self.rows[0].pop()
        self.rows[0][1][0] = 'ID\uffff'
        result = self.calculate()
        self.assertEqual(result['financial'], 'source-error')
        self.assertTrue(any(i['source'] == 0 and i['code'] == 'CSV_CHARACTER' for i in result['issues']))
        for char in ('\x00', '\x08', '\x0b', '\x0c', '\x0e', '\x1f', '\ufffe', '\uffff'):
            with self.assertRaises(Invalid):
                csv_rows(f'header\n{char}\n'.encode('utf-8'))
        self.assertEqual(csv_rows(b'header\r\n\t\r\n'), [['header'], ['\t']])

    def test_amount_cell_presence_distinguishes_physical_blank_and_truncated_row(self):
        self.rows[0][1][3] = ''
        self.rows[0].append(['SYN-INCOMPLETE'])
        result = self.calculate()
        self.assertEqual(result['financial'], 'source-error')
        blank = next(e for e in result['evidence'] if e['source'] == 0 and e['row'] == 2)
        absent = next(e for e in result['evidence'] if e['source'] == 0 and e['row'] == 6)
        self.assertEqual((blank['column'], blank['present'], blank['text'], blank['minor']), (4, True, '', None))
        self.assertEqual((absent['column'], absent['present'], absent['text'], absent['minor']), (4, False, None, None))
        raw = next(i for i in result['inventory'] if i['source'] == 0 and i['row'] == 6)
        self.assertEqual(raw['values'], ['SYN-INCOMPLETE'])
        for evidence in result['evidence']:
            original = next(i for i in result['inventory'] if i['source'] == evidence['source'] and i['row'] == evidence['row'])['values']
            self.assertEqual(evidence['present'], evidence['column'] <= len(original))

    def test_frozen_missing_cell_provenance_regressions_20_and_42(self):
        frozen = Path(__file__).resolve().parent.parent / 'frozen'
        for name, row, present, text in [
            ('20-blank-amount-not-zero', 8, True, ''),
            ('42-malformed-last-row-width', 10, False, None),
        ]:
            result = compute(frozen / name)
            self.assertEqual(result['financial'], 'source-error')
            self.assertIsNone(result['totals'])
            evidence = next(e for e in result['evidence'] if e['source'] == 0 and e['row'] == row)
            self.assertEqual((evidence['column'], evidence['present'], evidence['text'], evidence['minor']), (4, present, text, None))

    def test_invalid_header_cannot_define_an_absent_cell_position(self):
        for source in (0, 3):
            with self.subTest(source=source):
                original = copy.deepcopy(self.rows)
                self.rows[source][0][0] = 'UNKNOWN HEADER'
                self.rows[source].append(['TRUNCATED'])
                result = self.calculate()
                row = len(self.rows[source])
                self.assertEqual(result['financial'], 'source-error')
                self.assertFalse(any(e['source'] == source and e['row'] == row for e in result['evidence']))
                self.assertTrue(any(e['source'] == source and e['present'] for e in result['evidence']))
                self.rows = original


if __name__ == '__main__':
    unittest.main()
