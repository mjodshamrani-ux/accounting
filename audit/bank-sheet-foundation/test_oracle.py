"""The REPORT-1 oracle agrees with every hand-written intent, reads neither the
recipe nor the intent, moves the difference exactly as a moved book balance
does, voids a sign-off on any change of content, refuses in the contract's
order, and refuses an action the contract does not allow.

  python3 -B -m unittest discover -s audit/bank-sheet-foundation -p test_oracle.py -v
ORACLE=<path> runs the same tests on another copy of oracle.py (mutate_oracle.py).
"""
import copy
import importlib.util
import json
import os
import re
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'


def load():
    spec = importlib.util.spec_from_file_location('sheet_oracle', os.environ.get('ORACLE', HERE / 'oracle.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


oracle = load()
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))


def summary(judged):
    """The judged sheet in the intent's terms."""
    if judged['refusal']:
        out = {'refusal': judged['refusal']}
        if judged['previous'] != 'none':
            out['previous'] = judged['previous']
        return out
    items = []
    for name, section in judged['sections'].items():
        for i in section['items']:
            entry = {'item': i['item'], 'section': name, 'origin': i['origin']}
            if i['reason']:
                entry['reason'] = i['reason']
            if i['age'] is not None:
                entry['age'] = i['age']
            items.append(entry)
    return {'status': judged['status'], 'difference': judged['difference'],
            'items': sorted(items, key=lambda i: i['item']),
            'signoffs': {k: 'valid' if v['valid'] else 'void' for k, v in judged['signoffs'].items() if v}}


def intended(story):
    intent = dict(story['intent'])
    if 'items' in intent:
        intent['items'] = sorted(intent['items'], key=lambda i: i['item'])
    return intent


def judge_edited(story_id, edit):
    """Judge one story after editing its facts."""
    data = copy.deepcopy(FACTS)
    story = next(s for s in data['stories'] if s['id'] == story_id)
    edit(story)
    data['stories'] = [story]
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / 'stories.json'
        path.write_text(json.dumps(data), encoding='utf-8')
        return oracle.run(FROZEN, path)['stories'][story_id]


class Oracle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = oracle.run(FROZEN, FROZEN / 'stories.json')['stories']

    def test_agrees_with_every_intent(self):
        for story in FACTS['stories']:
            with self.subTest(story=story['id']):
                self.assertEqual(summary(self.result[story['id']]), intended(story))

    def test_reads_neither_recipe_nor_intent(self):
        blind = copy.deepcopy(FACTS)
        for s in blind['stories']:
            s['recipe'] = 'removed'
            s['intent'] = {'status': 'removed'}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'stories.json'
            path.write_text(json.dumps(blind), encoding='utf-8')
            self.assertEqual(oracle.run(FROZEN, path)['stories'], self.result)

    def test_imports_neither_generator_nor_product(self):
        source = Path(oracle.__file__).read_text(encoding='utf-8')
        self.assertNotRegex(source, r'stories\.mjs[\'"]|lib/reconciliation|\.ts[\'"]')
        self.assertNotIn('recipe', re.sub(r'""".*?"""', '', source, flags=re.S))

    def test_sections_add_up(self):
        for sid, judged in self.result.items():
            if judged['refusal']:
                continue
            with self.subTest(story=sid):
                s = judged['sections']
                for section in s.values():
                    self.assertEqual(section['total'], sum(i['amount'] for i in section['items']))
                self.assertEqual(judged['adjustedBank'], judged['bank']['balance']
                                 + s['bookReceiptsNotOnStatement']['total'] - s['bookPaymentsNotOnStatement']['total'])
                self.assertEqual(judged['adjustedBook'], judged['book']['balance']
                                 + s['statementDepositsNotInBook']['total'] - s['statementWithdrawalsNotInBook']['total'])
                self.assertEqual(judged['difference'], judged['adjustedBank'] - judged['adjustedBook'])

    def test_a_moved_book_balance_moves_the_difference_and_nothing_else(self):
        before = self.result['T02']
        after = judge_edited('T02', lambda s: s['sheet'][0]['book'].update(balance=s['sheet'][0]['book']['balance'] + 12345))
        self.assertEqual(after['difference'], before['difference'] - 12345)
        self.assertEqual(after['status'], 'difference')
        self.assertEqual(after['sections'], before['sections'])
        self.assertEqual(after['bank'], before['bank'])

    def test_a_changed_note_voids_a_signoff(self):
        def edit(story):
            story['sheet'] = [story['sheet'][0], story['sheet'][1],
                              {'book': dict(story['sheet'][0]['book'], note='Read from the trial balance')}]
        after = judge_edited('T02', edit)
        self.assertEqual(after['status'], 'reconciled')
        self.assertFalse(after['signoffs']['prepared']['valid'])
        self.assertIsNone(after['signoffs']['reviewed'])

    def test_a_signoff_on_the_final_content_is_valid(self):
        after = judge_edited('T24', lambda s: s['sheet'].append(s['sheet'][2]))
        self.assertFalse(after['signoffs']['prepared']['valid'])
        self.assertTrue(after['signoffs']['reviewed']['valid'])

    def test_refusals_in_the_contracts_order(self):
        held = judge_edited('T21', lambda s: s.update(sheet=[]))
        self.assertEqual(held['refusal'], 'SHEET_STATEMENT_HELD')
        refused = judge_edited('T20', lambda s: s.update(sheet=[]))
        self.assertEqual(refused['refusal'], 'SHEET_PREVIOUS_REFUSED')
        self.assertEqual(oracle.CONTRACT['refusals']['order'],
                         ['SHEET_STATEMENT_HELD', 'SHEET_PREVIOUS_REFUSED', 'SHEET_NO_BOOK_BALANCE'])

    def test_accepting_what_the_contract_does_not_let_the_accountant_accept(self):
        def accept(story):
            story['sheet'][1]['decide']['type'] = 'accept'
        for sid in ('T14', 'T18', 'T19'):
            with self.subTest(story=sid):
                with self.assertRaises(oracle.StoryError):
                    judge_edited(sid, accept)

    def test_a_decision_must_name_one_case_exactly(self):
        def partial(story):
            story['sheet'][1]['decide']['cashbook'] = []
        with self.assertRaises(oracle.StoryError):
            judge_edited('T19', partial)

    def test_no_signoff_on_a_refused_sheet(self):
        with self.assertRaises(oracle.StoryError):
            judge_edited('T22', lambda s: s.update(sheet=[{'prepare': {'name': 'X', 'date': '2026-12-01'}}]))


if __name__ == '__main__':
    unittest.main()
