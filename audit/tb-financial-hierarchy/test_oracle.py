"""Acceptance-source and oracle controls, not application support tests."""
import copy
import csv
import hashlib
import io
import json
import tempfile
from decimal import Decimal
import unittest
from pathlib import Path
from unittest.mock import patch

import generate
import oracle
import run

ROOT = Path(__file__).resolve().parent

class FoundationTests(unittest.TestCase):
    def test_frozen_contract_and_every_serialized_input(self):
        manifest = run.verify_frozen()
        self.assertEqual(len(manifest['sha256']), 74)
        self.assertTrue(manifest['synthetic'])
        self.assertEqual(manifest['baseline'], '296d97f65c55dc3e4ee412119c82ea0ef258dcf7')

    def test_all_cases_have_predeclared_eligibility_and_specific_rejection(self):
        cases = json.loads((ROOT / 'frozen/cases.json').read_text(encoding='utf-8'))['cases']
        self.assertEqual(len(cases), 18)
        for case in cases:
            with self.subTest(case=case['id']):
                result = oracle.evaluate(ROOT / 'frozen' / case['id'])
                self.assertEqual(result['status'], case['expected'])
                codes = {issue['code'] for issue in result['issues']}
                self.assertTrue(set(case['requiredCodes']) <= codes, (case['id'], codes))
                if case['expected'] == 'eligible':
                    self.assertEqual(result['issues'], [])
                    contract = json.loads((ROOT / 'contract.json').read_text(encoding='utf-8'))
                    self.assertEqual(result['facts'], contract['expectedStory'])

    def test_nested_parents_are_controls_not_money_counted_twice(self):
        result = oracle.evaluate(ROOT / 'frozen/positive-nested')
        self.assertEqual(result['facts']['categoryMinor']['current-asset'], 120000)
        self.assertEqual(sum(result['facts']['leafMinor'].values()), 240000)
        self.assertEqual(sum(result['facts']['parentMinor'].values()), 340000)
        self.assertEqual(result['ownership']['CASH-A'], 'CASH')
        self.assertEqual(result['ownership']['CASH'], 'ASSETS')
        self.assertEqual(result['facts']['members']['CASH-A'], ['0010|branch=10'])
        self.assertEqual(result['facts']['members']['CASH-B'], ['0010|branch=20'])
        self.assertEqual(result['facts']['members']['REC'], ['001|branch=10'])
        self.assertEqual(result['facts']['leafMinor']['ALLOW'], -10000)
        self.assertEqual(result['facts']['leafMinor']['ZERO'], 0)

    def test_equal_totals_cannot_hide_wrong_owner_or_classification(self):
        original = oracle.evaluate(ROOT / 'frozen/positive-nested')
        for name, reason in [('equal-amount-wrong-owner', 'MAPPING_PROOF'), ('wrong-classification-balanced', 'CLASSIFICATION')]:
            bad = oracle.evaluate(ROOT / 'frozen' / name)
            self.assertEqual(bad['facts']['debitMinor'], original['facts']['debitMinor'])
            self.assertEqual(bad['facts']['creditMinor'], original['facts']['creditMinor'])
            self.assertEqual(bad['facts']['categoryMinor'], original['facts']['categoryMinor'])
            self.assertEqual(bad['facts']['equationMinor'], 0)
            self.assertIn(reason, {issue['code'] for issue in bad['issues']})
            self.assertEqual(bad['status'], 'blocked')
        missing = oracle.evaluate(ROOT / 'frozen/missing-zero-leaf')
        self.assertEqual(missing['facts']['categoryMinor'], original['facts']['categoryMinor'])
        self.assertEqual(missing['status'], 'blocked')

    def test_reordered_sources_preserve_facts_but_change_original_citations(self):
        first = oracle.evaluate(ROOT / 'frozen/positive-nested')
        reordered = oracle.evaluate(ROOT / 'frozen/positive-reordered')
        self.assertEqual(first['facts'], reordered['facts'])
        self.assertEqual(first['ownership'], reordered['ownership'])
        self.assertNotEqual(first['sources'], reordered['sources'])
        self.assertNotEqual(first['citations'], reordered['citations'])
        for name, result in [('positive-nested', first), ('positive-reordered', reordered)]:
            count = 0
            for source, role in enumerate(oracle.ROLES):
                data = (ROOT / 'frozen' / name / (role + '.csv')).read_bytes()
                rows = list(csv.reader(io.StringIO(data.decode('utf-8'), newline='')))
                source_citations = [c for c in result['citations'] if c['source'] == source]
                self.assertEqual(len(source_citations), len(rows[0]) * (len(rows) - 1))
                for cite in source_citations:
                    self.assertEqual(cite['sha256'], hashlib.sha256(data).hexdigest())
                    self.assertEqual(cite['field'], rows[0][cite['column'] - 1])
                    self.assertEqual(cite['raw'], rows[cite['row'] - 1][cite['column'] - 1])
                count += len(rows) - 1
            self.assertEqual(len(result['inventory']), count)
        raw = (ROOT / 'frozen/positive-nested/trial-balance.csv').read_text(encoding='utf-8')
        self.assertIn('نقد، الفرع الأول', raw)

    def test_forged_adapter_claims_fail_with_balanced_totals(self):
        actual = oracle.evaluate(ROOT / 'frozen/positive-nested')
        oracle.verify_claim(actual, copy.deepcopy(actual))
        mutations = []
        wrong_member = copy.deepcopy(actual)
        wrong_member['facts']['members']['CASH-A'], wrong_member['facts']['members']['CASH-B'] = wrong_member['facts']['members']['CASH-B'], wrong_member['facts']['members']['CASH-A']
        mutations.append(wrong_member)
        wrong_parent = copy.deepcopy(actual); wrong_parent['ownership']['CASH-A'] = 'ASSETS'; mutations.append(wrong_parent)
        wrong_row = copy.deepcopy(actual); wrong_row['citations'][0]['row'] += 1; mutations.append(wrong_row)
        wrong_hash = copy.deepcopy(actual); wrong_hash['sources'][0]['sha256'] = '0' * 64; mutations.append(wrong_hash)
        dropped_zero = copy.deepcopy(actual); del dropped_zero['facts']['leafMinor']['ZERO']; mutations.append(dropped_zero)
        bool_zero = copy.deepcopy(actual); bool_zero['facts']['leafMinor']['ZERO'] = False; mutations.append(bool_zero)
        hidden_row = copy.deepcopy(actual); hidden_row['inventory'].pop(); mutations.append(hidden_row)
        changed_text = copy.deepcopy(actual); changed_text['citations'][0]['raw'] = '10'; mutations.append(changed_text)
        for index, claimed in enumerate(mutations):
            with self.subTest(mutation=index):
                self.assertEqual(claimed['facts']['categoryMinor'], actual['facts']['categoryMinor'])
                with self.assertRaisesRegex(AssertionError, 'FIN1A_CLAIM_MISMATCH'):
                    oracle.verify_claim(actual, claimed)
        blocked = oracle.evaluate(ROOT / 'frozen/equal-amount-wrong-owner')
        approved = copy.deepcopy(blocked); approved['status'] = 'eligible'; approved['issues'] = []
        with self.assertRaisesRegex(AssertionError, 'FIN1A_CLAIM_MISMATCH'):
            oracle.verify_claim(blocked, approved)

    def test_writer_is_byte_reproducible_and_independent_of_oracle(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            generate.generate(destination)
            expected = sorted(p.relative_to(ROOT / 'frozen') for p in (ROOT / 'frozen').rglob('*') if p.is_file())
            actual = sorted(p.relative_to(destination) for p in destination.rglob('*') if p.is_file())
            self.assertEqual(actual, expected)
            for relative in expected:
                self.assertEqual((destination / relative).read_bytes(), (ROOT / 'frozen' / relative).read_bytes(), str(relative))
        text = (ROOT / 'oracle.py').read_text(encoding='utf-8')
        self.assertNotIn('import generate', text)
        self.assertNotIn('lib/reconciliation', text)

    def test_manifest_rejects_changed_source_without_resealing(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            generate.generate(destination / 'frozen')
            for name in ['contract.json', 'INPUT-MANIFEST.json']:
                (destination / name).write_bytes((ROOT / name).read_bytes())
            with patch.object(run, 'ROOT', destination):
                run.verify_frozen()
                file = destination / 'frozen/positive-nested/trial-balance.csv'
                file.write_bytes(file.read_bytes().replace(b'500.00', b'500.01', 1))
                with self.assertRaisesRegex(AssertionError, 'FIN1A_INPUT_CHANGED'):
                    run.verify_frozen()

    def test_manifest_rejects_unreviewed_files_and_deeper_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            generate.generate(destination / 'frozen')
            for name in ['contract.json', 'INPUT-MANIFEST.json']:
                (destination / name).write_bytes((ROOT / name).read_bytes())
            with patch.object(run, 'ROOT', destination):
                run.verify_frozen()
                for name in ['extra.txt', 'nested/extra/source.csv']:
                    with self.subTest(extra=name):
                        file = destination / 'frozen' / name
                        file.parent.mkdir(parents=True, exist_ok=True)
                        file.write_bytes(b'unreviewed synthetic input\n')
                        with self.assertRaisesRegex(AssertionError, 'FIN1A_MANIFEST_PATHS'):
                            run.verify_frozen()
                        file.unlink()

    def test_header_only_sources_do_not_establish_zero_financial_truth(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            for role in oracle.ROLES:
                data = (ROOT / 'frozen/positive-nested' / (role + '.csv')).read_bytes()
                (folder / (role + '.csv')).write_bytes(data.split(b'\n', 1)[0] + b'\n')
            result = oracle.evaluate(folder)
            codes = {issue['code'] for issue in result['issues']}
            self.assertEqual(result['status'], 'blocked')
            self.assertTrue({'EMPTY_SOURCE', 'NO_ACCOUNT', 'NO_FINANCIAL_LEAF'} <= codes)
            self.assertEqual(sum(result['facts']['categoryMinor'].values()), 0)
            self.assertEqual(len([issue for issue in result['issues'] if issue['code'] == 'EMPTY_SOURCE']), 4)

    def test_title_only_statement_cannot_supply_financial_scope_or_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            for role in oracle.ROLES:
                (folder / (role + '.csv')).write_bytes((ROOT / 'frozen/positive-nested' / (role + '.csv')).read_bytes())
            file = folder / 'financial-position.csv'
            rows = list(csv.reader(io.StringIO(file.read_text(encoding='utf-8'), newline='')))
            stream = io.StringIO(newline=''); writer = csv.writer(stream, lineterminator='\n')
            writer.writerows(rows[:2]); file.write_text(stream.getvalue(), encoding='utf-8')
            result = oracle.evaluate(folder)
            self.assertEqual(result['status'], 'blocked')
            self.assertIn('NO_FINANCIAL_LEAF', {issue['code'] for issue in result['issues']})
            self.assertEqual(result['facts']['equationMinor'], 0)

    def test_coherent_sign_inversion_is_blocked_even_when_equations_balance(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            for role in oracle.ROLES:
                source = ROOT / 'frozen/positive-nested' / (role + '.csv')
                rows = list(csv.DictReader(io.StringIO(source.read_text(encoding='utf-8'), newline='')))
                for row in rows:
                    if role in ('proposed-mapping', 'presentation-evidence'):
                        row['Sign'] = 'credit-positive' if row['Sign'] == 'debit-positive' else 'debit-positive'
                    if role == 'financial-position' and row['Kind'] != 'title' and row['Amount'] not in ('0', '0.00'):
                        row['Amount'] = row['Amount'][1:] if row['Amount'].startswith('-') else '-' + row['Amount']
                stream = io.StringIO(newline=''); writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator='\n')
                writer.writeheader(); writer.writerows(rows)
                (folder / (role + '.csv')).write_text(stream.getvalue(), encoding='utf-8')
            result = oracle.evaluate(folder)
            self.assertEqual(result['status'], 'blocked')
            self.assertEqual(result['facts']['equationMinor'], 0)
            self.assertEqual(result['facts']['debitMinor'], result['facts']['creditMinor'])
            self.assertEqual({issue['code'] for issue in result['issues']}, {'SIGN_POLICY'})
            self.assertEqual(result['facts']['leafMinor']['ALLOW'], 10000)

    def test_proof_validity_covers_whole_period_inclusively(self):
        baseline = oracle.evaluate(ROOT / 'frozen/positive-nested')
        checks = [
            ('2026-01-01', '2026-09-30', 'eligible'),
            ('2025-12-31', '2026-10-01', 'eligible'),
            ('2026-01-02', '2026-09-30', 'blocked'),
            ('2026-01-01', '2026-09-29', 'blocked'),
            ('2026-10-01', '2026-09-30', 'blocked'),
        ]
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            for role in oracle.ROLES:
                (folder / (role + '.csv')).write_bytes((ROOT / 'frozen/positive-nested' / (role + '.csv')).read_bytes())
            file = folder / 'presentation-evidence.csv'
            original = file.read_text(encoding='utf-8')
            for start, end, expected in checks:
                with self.subTest(start=start, end=end):
                    rows = list(csv.DictReader(io.StringIO(original, newline='')))
                    rows[0]['Valid from'], rows[0]['Valid to'] = start, end
                    stream = io.StringIO(newline=''); writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator='\n')
                    writer.writeheader(); writer.writerows(rows)
                    file.write_text(stream.getvalue(), encoding='utf-8')
                    result = oracle.evaluate(folder)
                    self.assertEqual(result['status'], expected)
                    self.assertEqual(result['facts'], baseline['facts'])
                    self.assertEqual({issue['code'] for issue in result['issues']}, {'VALIDITY'} if expected == 'blocked' else set())

    def test_proof_validity_dates_use_strict_iso_calendar_lexemes(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            for role in oracle.ROLES:
                (folder / (role + '.csv')).write_bytes((ROOT / 'frozen/positive-nested' / (role + '.csv')).read_bytes())
            file = folder / 'presentation-evidence.csv'
            original = file.read_text(encoding='utf-8')
            for field in ['Valid from', 'Valid to']:
                for value in ['20260101', '2026-1-01', '2026-02-30', '2026-01-01T00:00:00', '2026-01-01 ', '0000-01-01']:
                    with self.subTest(field=field, value=value):
                        rows = list(csv.DictReader(io.StringIO(original, newline='')))
                        rows[0][field] = value
                        stream = io.StringIO(newline=''); writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator='\n')
                        writer.writeheader(); writer.writerows(rows)
                        file.write_text(stream.getvalue(), encoding='utf-8')
                        result = oracle.evaluate(folder)
                        self.assertEqual(result['status'], 'blocked')
                        self.assertEqual({issue['code'] for issue in result['issues']}, {'DATE'})
                        self.assertEqual(result['issues'][0]['field'], field)

    def test_both_tb_sides_positive_block_despite_unchanged_net_and_controls(self):
        baseline = oracle.evaluate(ROOT / 'frozen/positive-nested')
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            for role in oracle.ROLES:
                (folder / (role + '.csv')).write_bytes((ROOT / 'frozen/positive-nested' / (role + '.csv')).read_bytes())
            file = folder / 'trial-balance.csv'
            rows = list(csv.DictReader(io.StringIO(file.read_text(encoding='utf-8'), newline='')))
            rows[0]['Debit'], rows[0]['Credit'] = '510.00', '10.00'
            stream = io.StringIO(newline=''); writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator='\n')
            writer.writeheader(); writer.writerows(rows)
            file.write_text(stream.getvalue(), encoding='utf-8')
            result = oracle.evaluate(folder)
            self.assertEqual(result['status'], 'blocked')
            self.assertEqual({issue['code'] for issue in result['issues']}, {'BOTH_SIDES'})
            self.assertEqual(result['facts']['debitMinor'], result['facts']['creditMinor'])
            self.assertEqual(result['facts']['debitMinor'], baseline['facts']['debitMinor'] + 1000)
            for field in ['members', 'leafMinor', 'parentMinor', 'categoryMinor', 'equationMinor']:
                self.assertEqual(result['facts'][field], baseline['facts'][field])

    def test_exact_aggregate_limit_blocks_balanced_overflow_and_allows_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            for mode in ['known-story-overflow', 'exact-boundary', 'one-minor-above']:
                with self.subTest(mode=mode):
                    for role in oracle.ROLES:
                        source = ROOT / 'frozen/positive-nested' / (role + '.csv')
                        rows = list(csv.DictReader(io.StringIO(source.read_text(encoding='utf-8'), newline='')))
                        if role == 'trial-balance':
                            for row in rows:
                                for field in ['Debit', 'Credit']:
                                    row[field] = format(Decimal(row[field]) * 1000000000, '.2f')
                                if mode != 'known-story-overflow' and row['Account ID'] == '001':
                                    row['Debit'] = '0.00'
                                if mode != 'known-story-overflow' and row['Account ID'] == '3000':
                                    row['Credit'] = '400000000000.00'
                                if mode == 'one-minor-above' and row['Account ID'] == '0010' and row['Complete dimensions'] == 'branch=10':
                                    row['Debit'] = '500000000000.01'
                                if mode == 'one-minor-above' and row['Account ID'] == '3000':
                                    row['Credit'] = '400000000000.01'
                        elif role == 'financial-position':
                            excluded = ['ASSETS'] if mode == 'known-story-overflow' else ['ASSETS', 'CASH']
                            rows = [row for row in rows if row['Node ID'] not in excluded]
                            for row in rows:
                                if row['Amount']:
                                    row['Amount'] = format(Decimal(row['Amount']) * 1000000000, '.2f')
                                if row['Parent ID'] in excluded:
                                    row['Parent ID'] = ''
                                if mode != 'known-story-overflow' and row['Node ID'] == 'REC':
                                    row['Amount'] = '0.00'
                                if mode != 'known-story-overflow' and row['Node ID'] in ['CAP', 'EQUITY']:
                                    row['Amount'] = '400000000000.00'
                                if mode == 'one-minor-above' and row['Node ID'] == 'CASH-A':
                                    row['Amount'] = '500000000000.01'
                                if mode == 'one-minor-above' and row['Node ID'] in ['CAP', 'EQUITY']:
                                    row['Amount'] = '400000000000.01'
                        stream = io.StringIO(newline=''); writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator='\n')
                        writer.writeheader(); writer.writerows(rows)
                        (folder / (role + '.csv')).write_text(stream.getvalue(), encoding='utf-8')
                    result = oracle.evaluate(folder)
                    self.assertEqual(result['facts']['equationMinor'], 0)
                    self.assertEqual(result['facts']['debitMinor'], result['facts']['creditMinor'])
                    codes = {issue['code'] for issue in result['issues']}
                    if mode == 'exact-boundary':
                        self.assertEqual(result['status'], 'eligible')
                        self.assertEqual(codes, set())
                        self.assertEqual(result['facts']['debitMinor'], 100000000000000)
                    else:
                        self.assertEqual(result['status'], 'blocked')
                        self.assertEqual(codes, {'SUM'})
                        self.assertGreater(result['facts']['debitMinor'], 100000000000000)
                    if mode == 'known-story-overflow':
                        self.assertEqual(result['facts']['parentMinor']['CASH'], 100000000000000)
                        self.assertGreater(result['facts']['categoryMinor']['current-asset'], 100000000000000)
                        self.assertTrue(all(abs(value) <= 100000000000000 for value in result['facts']['leafMinor'].values()))

    def test_malformed_serialized_source_is_not_an_accounting_rejection_guess(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            for role in oracle.ROLES:
                (folder / (role + '.csv')).write_bytes((ROOT / 'frozen/positive-nested' / (role + '.csv')).read_bytes())
            file = folder / 'financial-position.csv'
            data = file.read_bytes()
            file.write_bytes(data + b'unknown,short,row\n')
            result = oracle.evaluate(folder)
            self.assertEqual(result['status'], 'blocked')
            self.assertIn('WIDTH', {issue['code'] for issue in result['issues']})
            self.assertEqual(result['inventory'][-1]['raw'], ['unknown', 'short', 'row'])
            self.assertEqual(result['inventory'][-1]['row'], 14)

if __name__ == '__main__':
    unittest.main()
