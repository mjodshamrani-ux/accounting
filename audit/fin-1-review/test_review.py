"""Review tests for the FIN-1A oracle, which is left as it is: each test edits
one thing in a copy of FIN-1A's positive story and states what the contract
decides. They pin the oracle rules that neither FIN-1A's own tests nor the H1
intents held (results/oracle-mutants-2.json). An oracle crash is a failure,
not an error, so a fault that makes the oracle crash is caught by assertion.

  python3 -B -m unittest discover -s audit/fin-1-review -p test_review.py -v
"""
import csv
import importlib.util
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIN1A = HERE.parent / 'tb-financial-hierarchy'
BASE = FIN1A / 'frozen' / 'positive-nested'
_spec = importlib.util.spec_from_file_location('fin1a_oracle', FIN1A / 'oracle.py')
oracle = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oracle)
TB, MAP, PROOF, STATEMENT = 0, 1, 2, 3


def rows(role):
    return list(csv.DictReader(io.StringIO((BASE / (role + '.csv')).read_text(encoding='utf-8'), newline='')))


def write(folder, role, table, columns=None):
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=columns or list(table[0]), lineterminator='\n')
    writer.writeheader()
    writer.writerows(table)
    (folder / (role + '.csv')).write_text(stream.getvalue(), encoding='utf-8')


class Review(unittest.TestCase):
    def judge(self, edit=None, raw=None):
        """Evaluate a copy of the positive story after edit(tables) and/or
        raw(folder); a crash fails the test."""
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            for role in oracle.ROLES:
                shutil.copy(BASE / (role + '.csv'), folder / (role + '.csv'))
            if edit:
                tables = {role: rows(role) for role in oracle.ROLES}
                edit(tables)
                for role, table in tables.items():
                    write(folder, role, table)
            if raw:
                raw(folder)
            try:
                return oracle.evaluate(folder)
            except Exception as error:  # noqa: BLE001
                self.fail(f'the oracle stopped: {error!r}')

    def codes(self, result):
        return {i['code'] for i in result['issues']}

    def has(self, result, code, source, field=None):
        hits = [i for i in result['issues'] if i['code'] == code and i.get('source') == source
                and (field is None or i.get('field') == field)]
        self.assertTrue(hits, (code, source, field, result['issues']))

    def test_base_story_is_eligible(self):
        self.assertEqual(self.judge()['status'], 'eligible')

    def test_negative_debit_is_not_money(self):
        def edit(t):
            allow = t['trial-balance'][3]
            allow['Debit'], allow['Credit'] = '-100.00', '0.00'
        result = self.judge(edit)
        self.assertEqual(result['status'], 'blocked')
        self.has(result, 'MONEY', TB, 'Debit')

    def test_negative_credit_is_not_money(self):
        def edit(t):
            t['trial-balance'][4]['Credit'] = '-0.01'
        result = self.judge(edit)
        self.assertEqual(result['status'], 'blocked')
        self.has(result, 'MONEY', TB, 'Credit')

    def test_leading_zero_is_not_money(self):
        def edit(t):
            t['trial-balance'][0]['Debit'] = '0500.00'
        result = self.judge(edit)
        self.assertEqual(result['status'], 'blocked')
        self.has(result, 'MONEY', TB, 'Debit')

    def test_one_value_above_the_limit_is_not_money(self):
        def edit(t):
            t['financial-position'][-1]['Amount'] = '1000000000000.01'
        result = self.judge(edit)
        self.has(result, 'MONEY', STATEMENT, 'Amount')

    def test_absent_parent(self):
        def edit(t):
            t['financial-position'][5]['Parent ID'] = 'NOWHERE'
        result = self.judge(edit)
        self.assertEqual(result['status'], 'blocked')
        self.has(result, 'PARENT', STATEMENT, 'Parent ID')

    def test_child_class_must_be_its_parents(self):
        def edit(t):
            for role, table in t.items():
                for r in table:
                    if role == 'trial-balance' and r['Account ID'] == '001':
                        r['Account class'] = 'noncurrent-asset'
                    if role == 'presentation-evidence' and r['Line ID'] == 'REC':
                        r['Account class'] = r['Line class'] = 'noncurrent-asset'
                    if role == 'financial-position' and r['Node ID'] == 'REC':
                        r['Line class'] = 'noncurrent-asset'
        result = self.judge(edit)
        self.assertEqual(self.codes(result), {'CLASSIFICATION'})
        self.has(result, 'CLASSIFICATION', STATEMENT, 'Line class')

    def test_title_carries_no_amount(self):
        def edit(t):
            t['financial-position'][0]['Amount'] = '0.00'
        result = self.judge(edit)
        self.assertEqual(self.codes(result), {'TITLE'})

    def test_unknown_tb_class_is_named_on_the_tb_row(self):
        def edit(t):
            t['trial-balance'][0]['Account class'] = 'current-assets'
        self.has(self.judge(edit), 'CLASSIFICATION', TB, 'Account class')

    def test_unknown_line_class_is_named_on_the_statement_row(self):
        """A root parent and its only child share an unknown class, so no
        parent-child rule can name the statement rows."""
        def edit(t):
            for r in t['financial-position']:
                if r['Node ID'] in ('LIABILITIES', 'PAY'):
                    r['Line class'] = 'liability'
        self.has(self.judge(edit), 'CLASSIFICATION', STATEMENT, 'Line class')

    def test_proof_account_class_is_held_to_the_tb(self):
        def edit(t):
            t['presentation-evidence'][0]['Account class'] = 'noncurrent-asset'
        self.has(self.judge(edit), 'CLASSIFICATION', PROOF, 'Account class')

    def test_proof_label_is_held_to_the_statement(self):
        def edit(t):
            t['presentation-evidence'][1]['Line label'] = 'Cash, branch 20'
        result = self.judge(edit)
        self.assertEqual(self.codes(result), {'CLASSIFICATION'})
        self.has(result, 'CLASSIFICATION', PROOF, 'Line class')

    def test_proof_line_class_is_held_to_the_statement(self):
        def edit(t):
            proof = t['presentation-evidence'][2]
            proof['Account class'] = proof['Line class'] = 'noncurrent-asset'
            t['trial-balance'][2]['Account class'] = 'noncurrent-asset'
        result = self.judge(edit)
        self.assertEqual(self.codes(result), {'CLASSIFICATION'})
        self.has(result, 'CLASSIFICATION', PROOF, 'Line class')

    def test_proof_account_class_is_held_to_its_line_class(self):
        def edit(t):
            t['presentation-evidence'][5]['Account class'] = 'noncurrent-liability'
            t['trial-balance'][5]['Account class'] = 'noncurrent-liability'
        result = self.judge(edit)
        self.assertEqual(self.codes(result), {'CLASSIFICATION'})

    def test_sign_policy_on_the_proof_alone(self):
        def edit(t):
            t['presentation-evidence'][0]['Sign'] = 'credit-positive'
        result = self.judge(edit)
        self.assertEqual(self.codes(result), {'MAPPING_PROOF', 'SIGN_POLICY'})
        self.has(result, 'SIGN_POLICY', PROOF, 'Sign')

    def test_sign_policy_on_the_mapping_alone(self):
        def edit(t):
            t['proposed-mapping'][0]['Sign'] = 'credit-positive'
        result = self.judge(edit)
        self.has(result, 'SIGN_POLICY', MAP, 'Sign')
        self.has(result, 'MAPPING_PROOF', MAP)

    def test_mapping_dimensions_are_held_to_the_proof(self):
        def edit(t):
            first = t['proposed-mapping'][0]
            first['Evidence ID'], first['Line ID'] = 'E2', 'CASH-B'
        result = self.judge(edit)
        self.has(result, 'MAPPING_PROOF', MAP)

    def test_proof_may_not_cite_a_parent(self):
        def edit(t):
            proof = t['presentation-evidence'][0]
            proof['Line ID'], proof['Line label'] = 'CASH', 'Cash subtotal'
        result = self.judge(edit)
        self.has(result, 'PROOF_LINE', PROOF, 'Line ID')

    def test_short_row_is_width_not_a_stop(self):
        def raw(folder):
            path = folder / 'trial-balance.csv'
            path.write_bytes(path.read_bytes() + b'0011,branch=10\n')
        result = self.judge(raw=raw)
        self.has(result, 'WIDTH', TB)
        self.assertEqual(result['inventory'][7]['raw'], ['0011', 'branch=10'])

    def test_two_hundred_and_one_records(self):
        def edit(t):
            tb = t['trial-balance']
            tb += [dict(tb[4], **{'Account ID': f'09{n:03d}'}) for n in range(201 - len(tb))]
        result = self.judge(edit)
        self.assertIn('ROWS', self.codes(result))

    def test_two_hundred_records_are_not_rows(self):
        def edit(t):
            tb = t['trial-balance']
            tb += [dict(tb[4], **{'Account ID': f'09{n:03d}'}) for n in range(200 - len(tb))]
        result = self.judge(edit)
        self.assertNotIn('ROWS', self.codes(result))

    def test_field_of_two_thousand_and_one_characters(self):
        def edit(t):
            t['trial-balance'][1]['Account label'] = 'ن' * 2001
        self.has(self.judge(edit), 'TEXT', TB, 'Account label')

    def test_source_above_the_byte_limit(self):
        def edit(t):
            tb = t['trial-balance']
            tb += [dict(tb[4], **{'Account ID': f'09{n:03d}', 'Account label': 'x' * 1500}) for n in range(100)]
        result = self.judge(edit)
        self.assertIn('BYTES', self.codes(result))

    def test_duplicate_evidence_id(self):
        def edit(t):
            t['presentation-evidence'][1]['Evidence ID'] = 'E1'
        result = self.judge(edit)
        self.has(result, 'DUPLICATE_PROOF', PROOF)

    def test_blank_account_id(self):
        def edit(t):
            t['trial-balance'][2]['Account ID'] = ''
        self.has(self.judge(edit), 'IDENTITY', TB)

    def test_statement_equation_above_the_limit(self):
        """Reported assets at the limit and liabilities at minus the limit:
        every term is within it, the equation is twice it."""
        def edit(t):
            removed = ('ASSETS', 'CASH')
            for r in t['financial-position']:
                if r['Parent ID'] in removed:
                    r['Parent ID'] = ''
                if r['Node ID'] == 'CASH-A':
                    r['Amount'] = '999999999300.00'
                if r['Node ID'] in ('PAY', 'LIABILITIES'):
                    r['Amount'] = '-1000000000000.00'
            t['financial-position'] = [r for r in t['financial-position'] if r['Node ID'] not in removed]
        result = self.judge(edit)
        self.assertEqual(result['facts']['categoryMinor']['current-asset'], 100000000000000)
        self.assertIn('SUM', self.codes(result))

    def test_text_after_a_closing_quote(self):
        def raw(folder):
            path = folder / 'proposed-mapping.csv'
            data = path.read_bytes()
            assert b'\nM1,' in data
            path.write_bytes(data.replace(b'\nM1,', b'\n"M"1,', 1))
        self.assertIn('CSV', self.codes(self.judge(raw=raw)))

    def test_date_rule_is_held_by_the_round_trip_alone(self):
        """The ISO pattern in the oracle repeats what the round trip already
        holds: a date that survives date.fromisoformat and isoformat() is
        YYYY-MM-DD in ASCII digits. Recorded as an equivalent fault."""
        for value in ['2026-01-01', '٢٠٢٦-٠١-٠١', '20260101', '2026-W01-1', '2026-001']:
            try:
                from datetime import date
                same = date.fromisoformat(value).isoformat() == value
            except ValueError:
                same = False
            self.assertEqual(same, value == '2026-01-01', value)


if __name__ == '__main__':
    unittest.main()
