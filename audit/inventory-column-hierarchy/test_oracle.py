import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import oracle


class ColumnSourceOracle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        subprocess.run([sys.executable, str(Path(__file__).with_name('generate.py')), '--output-dir', str(cls.root), '--include-layout-controls', '--negative-layout-controls'], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def result(self, code):
        return oracle.inspect(self.root / ('INV1E-' + code))

    def test_forty_financial_source_expectations(self):
        results = [oracle.inspect(p) for p in sorted(self.root.glob('INV1E-*'))]
        self.assertEqual(len(results), 40)
        for result in results:
            oracle.verify(result)

    def test_frozen_originals(self):
        manifest = json.loads(Path(__file__).with_name('INPUT-MANIFEST.v3.json').read_text())
        self.assertEqual(len(manifest['files']), 161)
        for entry in manifest['files']:
            data = (self.root / entry['path']).read_bytes()
            self.assertEqual(len(data), entry['bytes'])
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry['sha256'])

    def test_positive_control_inputs_are_unchanged(self):
        original = self.root / 'positive-controls-only'
        subprocess.run([sys.executable, str(Path(__file__).with_name('generate.py')), '--output-dir', str(original), '--include-layout-controls'], check=True)
        manifest = json.loads(Path(__file__).with_name('INPUT-MANIFEST.v2.json').read_text())
        self.assertEqual(len(manifest['files']), 97)
        for entry in manifest['files']:
            data = (original / entry['path']).read_bytes()
            self.assertEqual(len(data), entry['bytes'])
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry['sha256'])

    def test_negative_controls_retain_the_original_defect(self):
        for i in range(1, 17):
            original, control = self.result(f'N{i:02d}'), self.result(f'D{i:02d}')
            for result in [original, control]:
                oracle.verify(result)
            self.assertEqual(original['financial'], control['financial'])
            self.assertEqual(original['facts'], control['facts'])
            if original['facts']:
                self.assertEqual(original['comparisons'], control['comparisons'])
                self.assertEqual(control['scope']['Currency'], 'KWD')
            else:
                self.assertEqual(original['reason'], control['reason'])

    def test_original_bhd_inputs_are_unchanged(self):
        original = self.root / 'original-only'
        subprocess.run([sys.executable, str(Path(__file__).with_name('generate.py')), '--output-dir', str(original)], check=True)
        manifest = json.loads(Path(__file__).with_name('INPUT-MANIFEST.json').read_text())
        self.assertEqual(len(manifest['files']), 81)
        for entry in manifest['files']:
            data = (original / entry['path']).read_bytes()
            self.assertEqual(len(data), entry['bytes'])
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry['sha256'])

    def test_layout_controls_change_only_the_source_currency(self):
        for code in ['01', '02', '03', '04']:
            original, control = self.result('P' + code), self.result('C' + code)
            self.assertEqual(original['scope']['Currency'], 'BHD')
            self.assertEqual(control['scope']['Currency'], 'KWD')
            self.assertEqual(original['facts'], control['facts'])
            self.assertEqual(original['links'], control['links'])
            self.assertEqual(original['comparisons'], control['comparisons'])

    def test_original_coordinates_across_all_four_presentations(self):
        for code in ['P01', 'P02', 'P03', 'P04']:
            result = self.result(code)
            oracle.verify_citations(result, self.root / result['id'])
        self.assertEqual(self.result('P04')['sourcePart'], 'xl/worksheets/ledger.xml')
        self.assertTrue(any(f['merge'] for f in self.result('P02')['facts']))
        self.assertEqual(len({f['parent'][0] for f in self.result('P03')['facts']}), 2)
        self.assertEqual(sorted({f['column'] for f in self.result('P04')['facts']}), [2, 3, 4, 6])

    def test_quantity_change_with_correct_money_is_detected(self):
        result = self.result('P01')
        result['facts'][0]['values'][2] += 1
        with self.assertRaises(AssertionError):
            oracle.verify(result)

    def test_equal_total_and_account_aggregate_do_not_prove_branch(self):
        bad = self.result('N01')
        self.assertEqual(bad['providedMinor'], 1125000)
        self.assertEqual(sum(c[-1] for c in bad['comparisons']), 0)
        self.assertEqual(bad['financial'], 'difference')
        bad['id'] = 'INV1E-P01'
        with self.assertRaises(AssertionError):
            oracle.verify(bad)

    def test_equal_value_foreign_reference_is_not_supported(self):
        bad = self.result('N14')
        self.assertEqual(bad['providedMinor'], 1125000)
        self.assertEqual(bad['totals']['registerMinor'], 1000000)
        self.assertEqual(len(bad['links']), 4)

    def test_amounts_do_not_override_unit_or_parent(self):
        for code, supported in [('N02', 62500), ('N15', 625000)]:
            bad = self.result(code)
            self.assertEqual(bad['financial'], 'missing')
            self.assertEqual(bad['totals']['registerMinor'], supported)

    def test_orphan_separator_zero_and_missing_explicit_zero(self):
        for code in ['N04', 'N05']:
            self.assertEqual(self.result(code)['financial'], 'source-error')

    def test_vertical_merged_finance_and_covered_zero(self):
        for code, reason in [('N08', 'MERGE_GEOMETRY'), ('N09', 'MERGE_PAYLOAD'), ('N10', 'MERGE_ROLE')]:
            bad = self.result(code)
            self.assertEqual(bad['reason'], reason)

    def test_new_panel_cannot_inherit_prior_dimensions(self):
        for code in ['N11', 'N12']:
            self.assertEqual(self.result(code)['financial'], 'source-error')

    def test_conflicting_explicit_dimensions_and_duplicate_zero(self):
        self.assertEqual(self.result('N07')['reason'], 'DIMENSION_CONFLICT')
        self.assertEqual(self.result('N13')['reason'], 'DUPLICATE_FACT')

    def test_same_text_from_foreign_column_or_panel_is_not_a_citation(self):
        result = self.result('P03')
        # Both records have the literal LOT-A, but belong to different panels.
        fact = next(f for f in result['facts'] if f['values'][:2] == ['0007', 'warehouse=NORTH;batch=LOT-A'])
        foreign = next(f for f in result['facts'] if f['values'][:2] == ['0007', 'warehouse=SOUTH;batch=LOT-A'])
        fact['batch'] = copy.deepcopy(foreign['batch'])
        with self.assertRaises(AssertionError):
            oracle.verify_citations(result, self.root / result['id'])

    def test_foreign_mapping_identity_with_same_money_is_detected(self):
        result = self.result('P01')
        result['links'][0]['mapping'] = 'MAP-E-2'
        with self.assertRaises(AssertionError):
            oracle.verify(result)

    def test_foreign_mapping_row_is_not_a_source_link(self):
        result = self.result('P01')
        result['links'][0]['mappingRow'] = result['links'][1]['mappingRow']
        with self.assertRaises(AssertionError):
            oracle.verify_citations(result, self.root / result['id'])

    def test_swapped_gl_dimension_with_correct_grand_total_is_detected(self):
        result = self.result('P01')
        first, second = result['comparisons'][:2]
        first[1], second[1] = second[1], first[1]
        with self.assertRaises(AssertionError):
            oracle.verify_citations(result, self.root / result['id'])


if __name__ == '__main__':
    unittest.main()
