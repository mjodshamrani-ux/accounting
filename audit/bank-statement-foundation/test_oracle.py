"""Tests for the frozen seal and the independent statement oracle, not
product acceptance. Needs node on PATH to regenerate the facts file."""
import copy
import csv
import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import oracle

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
RECORDS = {'INPUT-MANIFEST.json', 'VERIFY.json', 'EXPECTED.json'}


def sha(b):
    return hashlib.sha256(b).hexdigest()


def by_id(expected):
    return {s['id']: s for s in expected['stories']}


class OracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.facts_bytes = subprocess.run(['node', str(HERE / 'stories.mjs')], check=True, capture_output=True).stdout
        cls.facts_path = cls.root / 'stories.json'
        cls.facts_path.write_bytes(cls.facts_bytes)
        cls.facts = json.loads(cls.facts_bytes)
        cls.manifest = json.loads((FROZEN / 'INPUT-MANIFEST.json').read_text(encoding='utf-8'))
        cls.contract = json.loads((HERE / 'contract.json').read_text(encoding='utf-8'))
        cls.expected = oracle.run(FROZEN, cls.facts_path)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def variant(self, facts=None, files=None, only=('BS01',)):
        """Run the oracle for the stories `only` on a changed copy:
        facts(story-by-id) edits the printed lines, files(folder) edits
        copied sources."""
        work = Path(tempfile.mkdtemp(dir=self.root))
        for f in FROZEN.iterdir():
            if f.name.split('-')[0] in only and not f.name.endswith('.pdf'):
                shutil.copy(f, work / f.name)
        data = copy.deepcopy(self.facts)
        if facts:
            facts({s['id']: s for s in data['stories']})
        (work / 'stories.json').write_text(json.dumps(data), encoding='utf-8')
        if files:
            files(work)
        return by_id(oracle.run(work, work / 'stories.json', only=only)), {s['id']: s for s in data['stories']}

    @staticmethod
    def edit_csv(path, change):
        with open(path, encoding='utf-8', newline='') as f:
            rows = list(csv.reader(f))
        change(rows)
        with open(path, 'w', encoding='utf-8', newline='') as f:
            csv.writer(f, lineterminator='\r\n').writerows(rows)

    @staticmethod
    def lines(story, kind):
        return [l for p in story['statement']['pages'] for l in p['lines'] if l['kind'] == kind]

    # The seal and the records bound to it.

    def test_seal_covers_every_frozen_source_and_the_regenerated_facts(self):
        listed = {e['file']: e for e in self.manifest['files']}
        present = {f.name for f in FROZEN.iterdir()}
        self.assertEqual(present, set(listed) | RECORDS)
        for name, e in listed.items():
            b = (FROZEN / name).read_bytes()
            self.assertEqual((sha(b), len(b)), (e['sha256'], e['bytes']), name)
        self.assertFalse(self.manifest['facts']['stored'])
        self.assertEqual(sha(self.facts_bytes), self.manifest['facts']['sha256'])
        self.assertEqual(len(self.facts_bytes), self.manifest['facts']['bytes'])

    def test_pdf_check_record_is_bound_to_the_sealed_pdfs_and_facts(self):
        verify = json.loads((FROZEN / 'VERIFY.json').read_text(encoding='utf-8'))
        self.assertTrue(verify['ok'])
        self.assertTrue(verify['reader'].startswith('pdfminer.six'))
        self.assertEqual(verify['factsSha256'], self.manifest['facts']['sha256'])
        listed = {e['file']: e['sha256'] for e in self.manifest['files']}
        stories = {s['id']: s for s in self.facts['stories']}
        self.assertEqual([s['id'] for s in verify['statements']], list(stories))
        for s in verify['statements']:
            self.assertEqual(s['sha256'], listed[s['file']], s['id'])
            self.assertEqual(s['pages'], len(stories[s['id']]['statement']['pages']), s['id'])
            self.assertTrue(s['ok'] and not s['problems'] and s['valuesFound'] > 0, s['id'])

    def test_expected_record_is_reproduced_exactly(self):
        self.assertEqual(oracle.dumps(self.expected), (FROZEN / 'EXPECTED.json').read_text(encoding='utf-8'))

    def test_contract_counts_and_policy(self):
        e, c = self.expected['stories'], self.contract['counts']
        self.assertEqual(len(e), c['stories'])
        self.assertEqual(sum(s['printedPages'] for s in e), c['statementPdfPages'])
        self.assertEqual(sum(s['movements'] for s in e), c['statementMovementsPrinted'])
        self.assertEqual(sum(s['cashbookRows'] for s in e), c['cashbookRows'])
        self.assertEqual(sum(s['statement'] == 'verified' for s in e), c['verifiedStatements'])
        self.assertEqual(sum(s['statement'] != 'verified' for s in e), c['heldStatements'])
        self.assertEqual(sorted(s['id'] for s in e), sorted(self.contract['stories']))
        self.assertEqual(self.facts['dateWindowDays'], self.contract['matching']['dateWindowDays'])
        self.assertEqual(by_id(self.expected)['BS14']['printedPages'], 70)
        self.assertEqual(by_id(self.expected)['BS15']['printedPages'], 100)

    # The oracle against the designer's intent, and its independence.

    def test_every_story_agrees_with_the_hand_written_intent(self):
        for result, story in zip(self.expected['stories'], self.facts['stories']):
            with self.subTest(id=story['id']):
                self.assertEqual(oracle.agrees_with_intent(result, story), [])

    def test_oracle_reads_neither_recipe_nor_intent(self):
        data = copy.deepcopy(self.facts)
        for s in data['stories']:
            for k in ('recipe', 'intent', 'title'):
                del s[k]
        path = self.root / 'bare.json'
        path.write_text(json.dumps(data), encoding='utf-8')
        self.assertEqual(oracle.run(FROZEN, path), self.expected)

    def test_intent_comparison_itself_detects_a_wrong_result(self):
        result = copy.deepcopy(by_id(self.expected)['BS05'])
        story = next(s for s in self.facts['stories'] if s['id'] == 'BS05')
        result['review'][0]['reason'] = 'amount-date-suggestion'
        self.assertTrue(oracle.agrees_with_intent(result, story))
        result = copy.deepcopy(by_id(self.expected)['BS01'])
        result['auto'][0], result['auto'][1] = [result['auto'][0][0], result['auto'][1][1]], [result['auto'][1][0], result['auto'][0][1]]
        self.assertTrue(oracle.agrees_with_intent(result, next(s for s in self.facts['stories'] if s['id'] == 'BS01')))

    def test_three_formats_of_bs01_tell_one_story(self):
        self.assertEqual(by_id(self.expected)['BS01']['formats'], {'statementCsv': True, 'statementXlsx': True, 'cashbookXlsx': True})

        def change(work):
            self.edit_csv(work / 'BS01-statement.csv', lambda rows: rows[3].__setitem__(6, str(float(rows[3][6]) + 0.01)))
        r, _ = self.variant(files=change)
        self.assertEqual(r['BS01']['formats'], {'statementCsv': False, 'statementXlsx': True, 'cashbookXlsx': True})

    def test_continuation_and_control_lines_are_not_movements(self):
        e = by_id(self.expected)
        self.assertEqual(e['BS08']['nonMovementLines'].get('continuation'), 1)
        self.assertEqual(e['BS08']['movements'], e['BS08']['cashbookRows'])
        self.assertEqual(e['BS14']['nonMovementLines']['page-totals'], 70)
        self.assertEqual(e['BS14']['movements'], 1680)

    # Statement proof: a changed printed fact holds the whole statement.

    def test_balance_chain_changes_hold_the_statement(self):
        cases = {
            'printed balance': lambda s: self.lines(s['BS01'], 'movement')[3].update(balance=self.lines(s['BS01'], 'movement')[3]['balance'] + 1),
            'brought forward': lambda s: self.lines(s['BS01'], 'brought-forward')[0].update(balance=self.lines(s['BS01'], 'brought-forward')[0]['balance'] - 1),
            'carried forward': lambda s: self.lines(s['BS01'], 'carried-forward')[0].update(balance=self.lines(s['BS01'], 'carried-forward')[0]['balance'] + 1),
            'closing': lambda s: self.lines(s['BS01'], 'closing')[0].update(balance=self.lines(s['BS01'], 'closing')[0]['balance'] + 1),
            'totals': lambda s: self.lines(s['BS01'], 'totals')[0].update(deposit=self.lines(s['BS01'], 'totals')[0]['deposit'] + 1),
            'page totals': lambda s: self.lines(s['BS14'], 'page-totals')[40].update(withdrawal=self.lines(s['BS14'], 'page-totals')[40]['withdrawal'] + 1),
            'both columns': lambda s: self.lines(s['BS01'], 'movement')[0].update(deposit=1, withdrawal=self.lines(s['BS01'], 'movement')[0]['withdrawal'] or 1),
        }
        for name, change in cases.items():
            with self.subTest(change=name):
                sid = 'BS14' if name == 'page totals' else 'BS01'
                r, _ = self.variant(facts=change, only=(sid,))
                self.assertEqual(r[sid]['statement'], 'balance-broken')
                self.assertEqual((r[sid]['auto'], r[sid]['review'], r[sid]['bankOnly'], r[sid]['cashOnly']), ([], [], [], []))
                self.assertEqual(r[sid]['held'], {'bank': r[sid]['movements'], 'cash': r[sid]['cashbookRows']})

    def test_page_sequence_changes_hold_the_statement(self):
        def drop_first(s):
            del s['BS01']['statement']['pages'][0]

        def repeat(s):
            s['BS01']['statement']['pages'].insert(1, copy.deepcopy(s['BS01']['statement']['pages'][0]))

        def other_total(s):
            s['BS01']['statement']['pages'][1]['of'] = 3

        def swap(s):
            p = s['BS14']['statement']['pages']
            p[10], p[11] = p[11], p[10]
        for name, change in [('first page missing', drop_first), ('page repeated', repeat),
                             ('page count disagrees', other_total), ('pages out of order', swap)]:
            with self.subTest(change=name):
                sid = 'BS14' if name == 'pages out of order' else 'BS01'
                r, _ = self.variant(facts=change, only=(sid,))
                self.assertEqual(r[sid]['statement'], 'incomplete-pages')
                self.assertEqual(r[sid]['auto'], [])

    # Matching: only an explicit identical reference approves.

    def test_cashbook_changes_turn_a_match_into_review(self):
        def first_payment(rows):
            return next(r for r in rows[1:] if r[5])
        cases = {
            'amount-difference': lambda rows: first_payment(rows).__setitem__(5, f'{float(first_payment(rows)[5]) + 0.01:.2f}'),
            'direction-conflict': lambda rows: first_payment(rows).__setitem__(4, first_payment(rows)[5]) or first_payment(rows).__setitem__(5, ''),
            'date-gap': lambda rows: next(r for r in rows[1:] if r[0] >= '2026-07-10').__setitem__(0, '2026-07-01'),
        }
        for reason, change in cases.items():
            with self.subTest(reason=reason):
                r, stories = self.variant(files=lambda work: self.edit_csv(work / 'BS01-cashbook.csv', change))
                self.assertEqual(len(r['BS01']['auto']), 9)
                self.assertEqual([g['reason'] for g in r['BS01']['review']], [reason])
                self.assertTrue(oracle.agrees_with_intent(r['BS01'], stories['BS01']))

    def test_reference_is_compared_literally(self):
        def lower(rows):
            rows[1][3] = rows[1][3].lower()
        r, _ = self.variant(files=lambda work: self.edit_csv(work / 'BS01-cashbook.csv', lower))
        self.assertEqual(len(r['BS01']['auto']), 9)
        self.assertEqual([g['reason'] for g in r['BS01']['review']], ['amount-date-suggestion'])

    def test_equal_amounts_without_references_are_never_paired(self):
        """BS02 without references: two equal transfers on one day on each
        side. Totals agree and every row has a candidate, yet no pairing is
        proven, so all four go to review together."""
        def bank(s):
            for l in self.lines(s['BS02'], 'movement'):
                if l['key'] in ('b:x1', 'b:x2'):
                    l['reference'] = ''

        def cash(work):
            self.edit_csv(work / 'BS02-cashbook.csv', lambda rows: [r.__setitem__(3, '') for r in rows[1:] if r[1] in ('RV-X1', 'RV-X2')])
        r, _ = self.variant(facts=bank, files=cash, only=('BS02',))
        self.assertEqual(len(r['BS02']['auto']), 10)
        self.assertEqual(r['BS02']['review'], [{'bank': ['b:x1', 'b:x2'], 'cash': ['c:x1', 'c:x2'], 'reason': 'ambiguous-amount-date'}])
        self.assertEqual((r['BS02']['bankOnly'], r['BS02']['cashOnly']), ([], []))

    def test_malformed_cashbook_is_refused(self):
        for name, change in [('duplicate voucher', lambda rows: rows[2].__setitem__(1, rows[1][1])),
                             ('both columns', lambda rows: rows[1].__setitem__(4, rows[1][5] or '1.00') or rows[1].__setitem__(5, rows[1][5] or '1.00')),
                             ('three decimals', lambda rows: rows[1].__setitem__(4 if rows[1][4] else 5, '10.001'))]:
            with self.subTest(change=name), self.assertRaises(ValueError):
                self.variant(files=lambda work: self.edit_csv(work / 'BS01-cashbook.csv', change))


if __name__ == '__main__':
    unittest.main()
