"""The TOL-1 oracle agrees with every hand-written intent, reads neither the
recipe nor the intent, settles every two-decimal period as the sealed ROLL-1
oracle does (cases, members, reasons, numbering and unmatched items), never
tolerates a case of another reason, never changes an amount, and keeps the
sheet's difference equal to the tolerated sum plus the unexplained rest.

  python3 -B -m unittest discover -s audit/bank-tolerance-foundation -p test_oracle.py -v
ORACLE=<path> runs the same tests on another copy of oracle.py (mutate_oracle.py).
"""
import copy
import hashlib
import importlib.util
import json
import os
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


oracle = load('tolerance_oracle', os.environ.get('ORACLE', HERE / 'oracle.py'))
roll = load('tolerance_roll_oracle', HERE.parent / 'bank-roll-foundation' / 'oracle.py')
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))


def judged(story):
    return oracle.judge(copy.deepcopy(story), FROZEN)


def reference(story, key):
    return next(l['reference'] for p in story['periods'][0]['statement']['pages'] for l in p['lines']
                if l['kind'] == 'movement' and l['key'] == key)


def disagreements(story, got):
    """Where the judged story differs from its intent."""
    intent, out = story['intent'], []
    if got['refused'] != intent.get('refused'):
        return ['refused']
    if intent.get('refused'):
        return []
    tolerated = sorted([reference(story, c['statement'][0]), c['amounts']['difference']]
                       for c in got['cases'] if c['status'] == 'matched-tolerated')
    if tolerated != sorted(intent['tolerated']):
        out.append('tolerated')
    if got['exceeded'] != intent['exceeded']:
        out.append('exceeded')
    if sum(c['status'] == 'needs-review' for c in got['cases']) != intent['open']:
        out.append('open')
    if sum(c['status'] == 'rejected' for c in got['cases']) != intent.get('rejected', 0):
        out.append('rejected')
    if 'unmatched' in intent and sum(o[2] == 'unmatched' for o in got['outstanding']) != intent['unmatched']:
        out.append('unmatched')
    sheet = got['sheet'] or {}
    if {k: sheet.get(k) for k in intent['sheet']} != intent['sheet']:
        out.append('sheet')
    return out


class Intent(unittest.TestCase):
    def test_every_story_agrees_with_its_intent(self):
        found = {}
        for story in FACTS['stories']:
            try:
                d = disagreements(story, judged(story))
            except Exception as error:  # noqa: BLE001  a crash on a story is a disagreement
                d = [f'{type(error).__name__}: {error}']
            if d:
                found[story['id']] = d
        self.assertEqual(found, {})

    def test_the_oracle_reads_neither_recipe_nor_intent(self):
        for story in FACTS['stories']:
            bare = {k: v for k, v in story.items() if k not in ('recipe', 'intent')}
            self.assertEqual(oracle.judge(bare, FROZEN), judged(story), story['id'])

    def test_the_stories_exercise_every_outcome(self):
        got = [judged(s) for s in FACTS['stories']]
        statuses = {g['sheet']['status'] for g in got if g['sheet']}
        self.assertEqual(statuses, set(oracle.CONTRACT['sheet']['status']))
        refusals = {g['refused'] for g in got if g['refused']}
        self.assertEqual(refusals, {'DECISION', 'TOLERANCE:PER_ITEM', 'TOLERANCE:PER_PERIOD', 'TOLERANCE:NOTE'})
        self.assertTrue(any(g['exceeded'] for g in got))
        self.assertTrue(any(s['periods'][0]['statement']['currency'] == 'KWD' for s in FACTS['stories']))


class Settlement(unittest.TestCase):
    def test_every_two_decimal_period_is_settled_as_the_sealed_roll_oracle_settles_it(self):
        window = json.loads((roll.BANK / 'contract.json').read_text(encoding='utf-8'))['matching']['dateWindowDays']
        self.assertEqual(window, oracle.WINDOW)
        compared = 0
        for story in FACTS['stories']:
            period = story['periods'][0]
            if oracle.EXPONENT[period['statement']['currency']] != 2:
                continue
            cash = (FROZEN / f"{period['id']}-cashbook.csv").read_bytes()
            pdf = (FROZEN / f"{period['id']}-statement.pdf").read_bytes()
            theirs = roll.period_result(period, cash, hashlib.sha256(pdf).hexdigest(),
                                        hashlib.sha256(cash).hexdigest(), [], window)
            ours = oracle.settle(period, cash)
            shape = lambda c: [c['id'], c['kind'], c['reason'], c['statement'], c['cashbook'], c['status']]  # noqa: E731
            self.assertEqual([shape(c) for c in ours['cases']], [shape(c) for c in theirs['cases']], story['id'])
            unmatched = [['S', s, 'unmatched'] for s in ours['match']['bankOnly']] + \
                        [['C', c, 'unmatched'] for c in ours['match']['cashOnly']]
            self.assertEqual(sorted(unmatched), sorted(list(o) for o in theirs['outstanding']), story['id'])
            compared += 1
        self.assertGreaterEqual(compared, 20)


class Rules(unittest.TestCase):
    def test_only_amount_differences_are_tolerated_and_no_amount_changes(self):
        for story in FACTS['stories']:
            got = judged(story)
            if got['refused']:
                continue
            period = story['periods'][0]
            plain = oracle.settle(period, (FROZEN / f"{period['id']}-cashbook.csv").read_bytes())
            before = {c['id']: c for c in plain['cases']}
            for c in got['cases']:
                b = before[c['id']]
                self.assertEqual((c['statement'], c['cashbook']), (b['statement'], b['cashbook']), story['id'])
                if c['kind'] == 'tolerated':
                    self.assertEqual(b['reason'], 'amount-difference', story['id'])
                    a = c['amounts']
                    self.assertEqual(a['difference'], a['statement'] - a['cashbook'])
                    self.assertLessEqual(abs(a['difference']), got['policy']['perItem'])

    def test_the_sheet_keeps_every_difference_in_view(self):
        for story in FACTS['stories']:
            sheet = judged(story)['sheet']
            if not sheet:
                continue
            self.assertEqual(sheet['difference'], sheet['tolerated'] + sheet['unexplained'], story['id'])
            self.assertEqual(sheet['tolerated'], sum(e for _, e in sheet['toleratedDifferences']), story['id'])

    def test_a_policy_change_after_a_decision_refuses_and_before_does_not(self):
        story = copy.deepcopy(next(s for s in FACTS['stories'] if s['id'] == 'T15'))
        self.assertEqual(oracle.judge(story, FROZEN)['refused'], 'DECISION')
        story['actions'] = [story['actions'][2], story['actions'][1]]
        self.assertIsNone(oracle.judge(story, FROZEN)['refused'])


if __name__ == '__main__':
    unittest.main()
