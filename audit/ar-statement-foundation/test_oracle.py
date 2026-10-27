"""The oracle agrees with the hand-written intent, reads nothing it must not,
and moves its verdict when a printed fact moves as the contract says.

  python3 -B -m unittest audit/ar-statement-foundation/test_oracle.py
ORACLE=<path> swaps in another oracle module (mutate_oracle.py uses it).
"""
import copy
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
spec = importlib.util.spec_from_file_location('oracle', os.environ.get('ORACLE', HERE / 'oracle.py'))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))


def story(sid):
    return copy.deepcopy(next(s for s in FACTS['stories'] if s['id'] == sid))


def lines(s):
    return [line for page in s['statement']['pages'] for line in page]


def cells(s, document):
    return next(dict(line['cells']) for line in lines(s)
                if 'cells' in line and dict(line['cells']).get('Document No', dict(line['cells']).get('رقم المستند')) == document)


def set_cell(s, document, heading, value):
    for line in lines(s):
        if 'cells' in line and any(h in ('Document No', 'رقم المستند') and v == document for h, v in line['cells']):
            pairs = [[h, v] for h, v in line['cells'] if h != heading]
            if value is not None:
                pairs.append([heading, value])
            line['cells'] = pairs
            return
    raise AssertionError(document)


def judge(s, ledger=None):
    if ledger is None:
        return oracle.judge(s, FROZEN)
    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, f"{s['id']}-ledger.csv").write_text(ledger, encoding='utf-8', newline='')
        return oracle.judge(s, Path(tmp))


def ledger_text(sid):
    return (FROZEN / f'{sid}-ledger.csv').read_text(encoding='utf-8')


class Intent(unittest.TestCase):
    def test_every_story_agrees_with_its_intent(self):
        for s in FACTS['stories']:
            with self.subTest(s['id']):
                got, want = judge(s), s['intent']
                self.assertEqual(got['status'], want['status'])
                self.assertEqual(got['matched'], want['matched'])
                self.assertEqual(got['review'], want.get('review', {}))
                self.assertEqual(got['errorCodes'], sorted(want.get('errors', [])))
                if 'outOfScopeLines' in want:
                    self.assertEqual(got['outOfScopeLines'], want['outOfScopeLines'])

    def test_recipe_intent_and_ledger_facts_are_not_read(self):
        for s in FACTS['stories']:
            blind = copy.deepcopy(s)
            for key in ('recipe', 'intent', 'ledger', 'title'):
                blind.pop(key)
            self.assertEqual(judge(blind), judge(s), s['id'])

    def test_expected_file_is_the_oracle_output(self):
        expected = json.loads((FROZEN / 'EXPECTED.json').read_text(encoding='utf-8'))
        self.assertEqual(expected, json.loads(json.dumps(oracle.run(FACTS, FROZEN))))


class Sections(unittest.TestCase):
    def test_a_continuation_page_with_another_customer_splits_the_scope(self):
        s = story('A05')
        for line in s['statement']['pages'][1]:
            if line.get('text', '').startswith('Customer ID:'):
                line['text'] = 'Customer ID: C0009'
        got = judge(s)
        self.assertEqual(got['errorCodes'], ['AR_PDF_SCOPE_REPEATED'])
        self.assertEqual(got['matched'], 0)

    def test_swapping_two_customers_moves_the_compared_lines(self):
        s = story('A03')
        heads = [line for line in lines(s) if line.get('text', '').startswith('Customer ID:')]
        heads[0]['text'], heads[1]['text'] = heads[1]['text'], heads[0]['text']
        got = judge(s)
        self.assertEqual(got['status'], 'review')
        reasons = {c['document']: c['reason'] for c in got['cases']}
        self.assertEqual(reasons, {'2001': 'exact-own-document', '2002': 'missing-counterpart',
                                   '2003': 'missing-counterpart'})

    def test_a_header_identical_to_the_first_continues_it(self):
        s = story('A06')
        for line in s['statement']['pages'][1]:
            if line.get('text') == 'Currency: USD':
                line['text'] = 'Currency: SAR'
        got = judge(s)
        reasons = {c['document']: c['reason'] for c in got['cases']}
        self.assertEqual(reasons['3005'], 'exact-own-document')
        self.assertEqual(reasons['3006'], 'missing-counterpart')
        self.assertEqual(got['outOfScopeLines'], 0)

    def test_a_section_without_its_period_is_a_header_error(self):
        s = story('A01')
        s['statement']['pages'][0] = [l for l in s['statement']['pages'][0]
                                      if not l.get('text', '').startswith('Period:')]
        self.assertEqual(judge(s)['errorCodes'], ['AR_PDF_HEADER'])

    def test_another_entity_on_a_later_page_is_a_document_header_error(self):
        s = story('A05')
        for line in s['statement']['pages'][2]:
            if line.get('text', '').startswith('Issued by:'):
                line['text'] = 'Issued by: Other Seller LLC'
        self.assertIn('AR_PDF_DOCUMENT_HEADER', judge(s)['errorCodes'])

    def test_a_renamed_required_heading_is_a_columns_error(self):
        s = story('A01')
        for line in lines(s):
            if 'headings' in line:
                line['headings'] = ['Doc' if h == 'Document No' else h for h in line['headings']]
            if 'cells' in line:
                line['cells'] = [['Doc' if h == 'Document No' else h, v] for h, v in line['cells']]
        self.assertEqual(judge(s)['errorCodes'], ['AR_PDF_COLUMNS'])

    def test_the_section_of_another_customer_never_errs_and_never_matches(self):
        s = story('A03')
        set_cell(s, '2003', 'Original amount', '31,0O0.00')
        got = judge(s)
        self.assertEqual(got['errorCodes'], ['AR_AMOUNT'])
        self.assertEqual(got['matched'], 0)


class Lines(unittest.TestCase):
    def test_original_missing_with_an_open_amount(self):
        s = story('A07')
        set_cell(s, '4001', 'Original amount', None)
        self.assertEqual(judge(s)['errorCodes'], ['AR_ORIGINAL_MISSING'])

    def test_the_open_amount_never_decides(self):
        s = story('A07')
        set_cell(s, '4003', 'Open amount', '800.00')
        reasons = {c['document']: c['reason'] for c in judge(s)['cases']}
        self.assertEqual(reasons['4003'], 'amount-difference')
        s = story('A07')
        set_cell(s, '4001', 'Open amount', '999.99')
        self.assertEqual(judge(s)['matched'], 2)

    def test_arabic_indic_digits_are_digits(self):
        s = story('A12')
        value = cells(s, 'INV-1002')['المبلغ الأصلي']
        set_cell(s, 'INV-1002', 'المبلغ الأصلي', value.replace('٨', '٩', 1))
        reasons = {c['document']: c['reason'] for c in judge(s)['cases']}
        self.assertEqual(reasons['INV-1002'], 'amount-difference')

    def test_each_line_fault_has_its_code(self):
        faults = [
            ('Type', 'inv', 'AR_KIND'),
            ('Date', '2026-10-01', 'AR_PERIOD'),
            ('Date', '2026-09-31', 'AR_DATE'),
            ('Original amount', '0.00', 'AR_AMOUNT'),
            ('Original amount', '1,25,000.00', 'AR_AMOUNT'),
            ('Original amount', '1,250.000', 'AR_AMOUNT'),
            ('Original amount', '-1,250.00', 'AR_DIRECTION'),
            ('Document No', ' ', 'AR_DOCUMENT'),
        ]
        for heading, value, code in faults:
            with self.subTest(code=code, value=value):
                s = story('A01')
                set_cell(s, 'INV-1001', heading, value)
                got = judge(s)
                self.assertEqual(got['errorCodes'], [code])
                self.assertEqual(got['status'], 'source-error')
                self.assertTrue(all(c['reason'] == 'source-errors' for c in got['cases']))

    def test_the_type_is_never_inferred_from_the_sign(self):
        s = story('A02')
        set_cell(s, '1002', 'Type', 'receipt')
        got = judge(s)
        self.assertEqual(got['errorCodes'], ['AR_DIRECTION'])

    def test_identity_is_type_and_number(self):
        s = story('A02')
        got = judge(s)
        self.assertEqual({(c['kind'], c['document']): c['reason'] for c in got['cases']}[('invoice', '1002')],
                         'missing-counterpart')


class Ledger(unittest.TestCase):
    def test_a_ledger_row_of_another_customer(self):
        text = ledger_text('A01').replace(',C0001,', ',C0002,', 1)
        self.assertEqual(judge(story('A01'), text)['errorCodes'], ['AR_ROW_SCOPE'])

    def test_a_duplicate_posting_id(self):
        text = ledger_text('A01').replace('L0002,', 'L0001,', 1)
        got = judge(story('A01'), text)
        self.assertEqual(got['errorCodes'], ['AR_DUPLICATE_POSTING'])

    def test_one_halala_and_one_day(self):
        text = ledger_text('A01').replace('1250.00', '1250.01', 1)
        reasons = {c['document']: c['reason'] for c in judge(story('A01'), text)['cases']}
        self.assertEqual(reasons['INV-1001'], 'amount-difference')
        text = ledger_text('A01').replace('2026-09-04', '2026-09-05', 1)
        reasons = {c['document']: c['reason'] for c in judge(story('A01'), text)['cases']}
        self.assertEqual(reasons['INV-1002'], 'date-difference')


class Frozen(unittest.TestCase):
    def test_the_folder_holds_exactly_the_sealed_files(self):
        manifest = json.loads((FROZEN / 'INPUT-MANIFEST.json').read_text(encoding='utf-8'))
        names = {p.name for p in FROZEN.iterdir()} - {'INPUT-MANIFEST.json', 'SEAL.json', 'EXPECTED.json', 'VERIFY.json', 'BASELINE.json'}
        self.assertEqual(names, set(manifest['files']))


if __name__ == '__main__':
    unittest.main()
