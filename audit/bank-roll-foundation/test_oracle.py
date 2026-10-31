"""The ROLL-1 oracle agrees with every hand-written intent, reads neither the
recipe nor the intent, and moves its verdict when a decisive fact moves.

  python3 -B -m unittest discover -s audit/bank-roll-foundation -p test_oracle.py -v
ORACLE=<path> runs the same tests on another copy of oracle.py (mutate_oracle.py).
"""
import base64
import copy
import hashlib
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'


def load():
    spec = importlib.util.spec_from_file_location('roll_oracle', os.environ.get('ORACLE', HERE / 'oracle.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


oracle = load()
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))


def summary(judged):
    return {
        'previous': judged['previous'],
        'carried': [c['item'] for c in judged['carried']],
        'cases': [{'reason': c['reason'], 'carried': c['carried'], 'current': c['current']} for c in judged['cases']],
        'stillCarried': judged['stillCarried'],
    }


class Oracle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = oracle.run(FROZEN, FROZEN / 'stories.json')['stories']

    def test_agrees_with_every_intent(self):
        for story in FACTS['stories']:
            with self.subTest(story=story['id']):
                self.assertEqual(summary(self.result[story['id']]), story['intent'])

    def test_reads_neither_recipe_nor_intent(self):
        blind = copy.deepcopy(FACTS)
        for s in blind['stories']:
            s['recipe'] = 'removed'
            s['intent'] = {'previous': 'removed'}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'stories.json'
            path.write_text(json.dumps(blind), encoding='utf-8')
            self.assertEqual(oracle.run(FROZEN, path)['stories'], self.result)

    def test_carried_items_name_their_origin(self):
        r01 = self.result['R01']['carried'][0]
        self.assertEqual((r01['side'], r01['id'], r01['period'], r01['origin'], r01['age'], r01['amount']),
                         ('cashbook', 'PV-R01-90', 'JUL', 'unmatched', 1, 482500))
        r09 = {c['id']: c['origin'] for c in self.result['R09']['carried']}
        self.assertEqual(sorted(r09.values()), ['C5', 'C5'])

    def judged_with_session(self, story, change):
        """The story judged with its session file changed by `change`."""
        with tempfile.TemporaryDirectory() as tmp:
            frozen = Path(tmp) / 'frozen'
            shutil.copytree(FROZEN, frozen)
            path = frozen / f'{story}-previous-session.json'
            doc = json.loads(path.read_bytes())
            change(doc)
            path.write_bytes(json.dumps(doc).encode())
            return oracle.run(frozen, frozen / 'stories.json')['stories'][story]

    def test_a_decision_from_another_context_refuses_the_session(self):
        def change(doc):
            doc['decisions'][0]['context'] = doc['decisions'][0]['context'].replace('"printed"', '"confirmed-closing"')
        self.assertEqual(self.judged_with_session('R09', change)['previous'], 'ROLL_PREVIOUS_UNREADABLE')

    def test_accepting_an_ineligible_case_refuses_the_session(self):
        def change(doc):
            doc['decisions'][0].update(case='C1', statement=['S1'], cashbook=[])
        self.assertEqual(self.judged_with_session('R18', change)['previous'], 'ROLL_PREVIOUS_UNREADABLE')

    def test_without_its_decision_the_period_is_not_closed(self):
        self.assertEqual(self.judged_with_session('R09', lambda doc: doc.update(decisions=[]))['previous'],
                         'ROLL_PREVIOUS_UNDECIDED')

    def test_a_file_whose_bytes_change_with_its_fingerprint(self):
        """A session edited consistently (bytes and fingerprint) is another
        July: it no longer matches any sealed statement."""
        def change(doc):
            raw = base64.b64decode(doc['files'][0]['data']) + b'\n'
            doc['files'][0].update(data=base64.b64encode(raw).decode(), sha256=hashlib.sha256(raw).hexdigest())
        self.assertEqual(self.judged_with_session('R01', change)['previous'], 'ROLL_PREVIOUS_UNREADABLE')

    def test_an_unknown_session_version(self):
        self.assertEqual(self.judged_with_session('R01', lambda doc: doc.update(version='bank-statement-lifecycle-2'))['previous'],
                         'ROLL_PREVIOUS_UNREADABLE')


def built_period(movements, cash, opening=100000):
    """A one-page July statement and its cashbook CSV, from (date, ref,
    withdrawal, deposit) and (date, voucher, ref, receipt, payment)."""
    balance, lines = opening, [{'kind': 'opening', 'balance': opening}]
    for k, (when, ref, wd, dep) in enumerate(movements):
        balance += dep - wd
        lines.append({'kind': 'movement', 'key': f'S{k + 1}', 'date': when, 'valueDate': when, 'description': 'x',
                      'reference': ref, 'withdrawal': wd, 'deposit': dep, 'balance': balance})
    lines += [{'kind': 'closing', 'balance': balance},
              {'kind': 'totals', 'withdrawal': sum(m[2] for m in movements), 'deposit': sum(m[3] for m in movements)}]
    period = {'id': 'T01-JUL', 'statement': {'account': 'x', 'currency': 'SAR',
                                             'period': {'start': '2026-07-01', 'end': '2026-07-31'},
                                             'pages': [{'number': 1, 'of': 1, 'lines': lines}]}}
    rows = ['Date,Voucher,Description,Reference,Receipts,Payments']
    money = lambda minor: f'{minor / 100:.2f}' if minor else ''  # noqa: E731
    rows += [f'{when},{voucher},x,{ref},{money(r)},{money(p)}' for when, voucher, ref, r, p in cash]
    return period, ('\r\n'.join(rows) + '\r\n').encode()


class Rules(unittest.TestCase):
    def test_a_case_whose_reason_cannot_be_accepted(self):
        period, cash = built_period([('2026-07-10', 'TRF-1', 0, 50000)], [('2026-07-10', 'RV-1', 'TRF-1', 50100, 0)])
        base = oracle.period_result(period, cash, 'a' * 64, 'b' * 64, [], 3)
        self.assertEqual([(c['id'], c['reason']) for c in base['cases']], [('C1', 'amount-difference')])
        decision = {'id': 'D1', 'type': 'accept', 'context': base['context'], 'case': 'C1',
                    'statement': ['S1'], 'cashbook': ['RV-1']}
        with self.assertRaises(oracle.Refused):
            oracle.period_result(period, cash, 'a' * 64, 'b' * 64, [decision], 3)
        decision['type'] = 'reject'
        self.assertEqual(oracle.period_result(period, cash, 'a' * 64, 'b' * 64, [decision], 3)['outstanding'],
                         [('S', 'S1', 'C1'), ('C', 'RV-1', 'C1')])

    def test_a_carried_item_never_pairs_with_what_the_period_matched(self):
        period, cash = built_period([('2026-07-10', 'TRF-1', 0, 50000)], [('2026-07-10', 'RV-1', 'TRF-1', 50000, 0)])
        base = oracle.period_result(period, cash, 'a' * 64, 'b' * 64, [], 3)
        carried = [{'item': 'JUN:RV-9', 'side': 'cashbook', 'id': 'RV-9', 'date': '2026-06-29', 'direction': 'in',
                    'amount': 50000, 'reference': '', 'age': 1}]
        cleared = oracle.clear(carried, period, base, 3)
        self.assertEqual(len(cleared['own']['auto']), 1)
        self.assertEqual(cleared['cases'], [])
        self.assertEqual([c['item'] for c in cleared['still']], ['JUN:RV-9'])


if __name__ == '__main__':
    unittest.main()
