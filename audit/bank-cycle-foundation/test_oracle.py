"""The cycle oracle against the intent written by hand in every story, held
to the sealed oracles it composes wherever they can judge a month alone,
and refusing what the contracts refuse.

  python3 -B -m unittest discover -s audit/bank-cycle-foundation -p test_oracle.py

CYCLE_ORACLE names another copy of oracle.py (mutate_oracle.py's planted
faults); CYCLE_FROZEN another frozen folder.
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
FROZEN = Path(os.environ.get('CYCLE_FROZEN', HERE / 'frozen'))
_spec = importlib.util.spec_from_file_location('cycle_oracle_under_test',
                                               os.environ.get('CYCLE_ORACLE', HERE / 'oracle.py'))
oracle = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oracle)

FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))
STORIES = {s['id']: s for s in FACTS['stories']}
JUDGED, REFUSED = {}, {}
for _sid, _story in STORIES.items():
    # A story whose recorded steps the oracle refuses is a failed expectation,
    # asserted below, not an error before the tests run.
    try:
        JUDGED[_sid] = oracle.judge(copy.deepcopy(_story), FROZEN, keep=True)
    except oracle.StoryError as error:
        JUDGED[_sid], REFUSED[_sid] = {}, str(error)
STATUS = {'matched': 'matched-automatic', 'accepted': 'matched-accepted'}


def offers(o):
    return '+'.join(k for k in ('accept', 'reject') if o[k])


def summary(snapshot):
    """A save in the intent's terms."""
    sheet = snapshot.get('sheet') or {}
    return {
        'previous': snapshot['previous'],
        'tolerated': len(snapshot.get('tolerated', [])),
        'exceeded': snapshot.get('exceeded'),
        'groups': [[g['reason'], len(g['cases']), offers(g['offers'])] for g in snapshot.get('queue', [])],
        'carried': len(snapshot.get('carried', [])),
        'still': len(snapshot.get('still', [])),
        'pending': snapshot.get('pending', 0),
        'sheet': sheet['refusal'] if sheet.get('refusal') else
        [sheet.get('status'), sheet.get('difference'), sheet.get('tolerated'), sheet.get('unexplained')],
    }


def saves():
    for sid, story in STORIES.items():
        for label, snapshot in JUDGED[sid].items():
            yield story, label, snapshot


def first_month(snapshot):
    return snapshot['previous'] == 'none'


def decisions_of(snapshot):
    return snapshot['_state']['decisions']


def expanded(snapshot):
    """The month's decisions, each group as the decisions of its cases in the
    queue's order: [(kind, case)]."""
    by_id = {c['id']: c for c in snapshot['_kept']['cases']}
    out = []
    for step in decisions_of(snapshot):
        if 'group' in step:
            wanted = sorted(sorted(oracle.keys_of(snapshot['period'].split('-')[1], m)) for m in step['group']['cases'])
            g = next(g for g in snapshot['queue']
                     if sorted(sorted(by_id[c]['members']) for c in g['cases']) == wanted)
            out += [(step['group']['type'], by_id[c]) for c in g['cases']]
        else:
            kind = 'accept' if 'accept' in step else 'reject'
            key = sorted(oracle.keys_of(snapshot['period'].split('-')[1], step[kind]))
            out.append((kind, next(c for c in snapshot['_kept']['cases'] if sorted(c['members']) == key)))
    return out


class Intent(unittest.TestCase):
    def test_every_story_is_judged_as_recorded(self):
        self.assertEqual(REFUSED, {})

    def test_every_save_agrees_with_its_intent(self):
        count = 0
        for story, label, snapshot in saves():
            with self.subTest(save=label):
                self.assertEqual(summary(snapshot), story['intent'][label])
                count += 1
        self.assertEqual(count, sum(len(s['intent']) for s in STORIES.values()))
        self.assertEqual(count, 14)


class SealedOracles(unittest.TestCase):
    """The glue against the sealed oracles, on every month they judge alone."""

    def test_first_months_without_accepts_are_the_tolerance_oracles(self):
        checked = []
        for story, label, snapshot in saves():
            if not first_month(snapshot) or any(kind == 'accept' for kind, _ in expanded(snapshot)):
                continue
            state = snapshot['_state']
            actions = ([{'policy': state['policy']}] if state['policy'] else []) + \
                [{'reject': {'statement': c['statement'], 'cashbook': c['cashbook']}} for _, c in expanded(snapshot)]
            period = next(p for p in story['periods'] if p['id'] == snapshot['period'])
            alone = {'id': story['id'], 'periods': [period], 'actions': actions, 'book': state['book']}
            want = oracle.tolerance.judge(alone, FROZEN)
            with self.subTest(save=label):
                self.assertEqual([(c['id'], c['kind'], c['reason'], STATUS.get(c['status'], c['status']),
                                   c['statement'], c['cashbook']) for c in want['cases']],
                                 [(c['id'], c['kind'], c['reason'], c['status'], c['statement'], c['cashbook'])
                                  for c in snapshot['cases']])
                self.assertEqual(want['exceeded'], snapshot['exceeded'])
                self.assertEqual([list(o) for o in want['outstanding']],
                                 [['S' if o['side'] == 'statement' else 'C', o['id'], o['origin']]
                                  for o in snapshot['outstanding']])
                sheet = snapshot['sheet']
                for key in ('status', 'difference', 'tolerated', 'unexplained'):
                    self.assertEqual(want['sheet'][key], sheet[key], key)
                for name, listed in want['sheet']['sections'].items():
                    self.assertEqual(listed, [[i['id'], i['amount']] for i in sheet['sections'][name]['items']], name)
            checked.append(label)
        self.assertEqual(sorted(checked), ['Y02-AUG', 'Y03-SEP', 'Y04-OCT-open', 'Y05-NOV'])

    def test_first_months_without_policy_are_roll_period_result_with_decisions(self):
        checked = []
        for story, label, snapshot in saves():
            if not first_month(snapshot) or snapshot['policy'] is not None:
                continue
            base = snapshot['_kept']['base']
            period = next(p for p in story['periods'] if p['id'] == snapshot['period'])
            declared = (FROZEN / f"{period['id']}-cashbook.csv").read_bytes()
            ledger = (FROZEN / f"{period['id']}-ledger.xlsx").read_bytes()
            statement = (FROZEN / f"{period['id']}-statement.pdf").read_bytes()
            decisions = [{'id': f'D{k + 1}', 'type': kind, 'context': base['context'], 'case': c['id'],
                          'statement': c['statement'], 'cashbook': c['cashbook']}
                         for k, (kind, c) in enumerate(expanded(snapshot))]
            want = oracle.roll.period_result(period, declared, oracle.sha(statement), oracle.sha(ledger), decisions,
                                             oracle.WINDOW)
            with self.subTest(save=label):
                self.assertEqual([(c['id'], STATUS.get(c['status'], c['status'])) for c in want['cases']],
                                 [(c['id'], c['status']) for c in snapshot['cases']])
                self.assertEqual([list(o) for o in want['outstanding']],
                                 [['S' if o['side'] == 'statement' else 'C', o['id'], o['origin']]
                                  for o in snapshot['outstanding']])
                self.assertEqual(oracle.review.queue(oracle.roll.period_result(
                    period, declared, oracle.sha(statement), oracle.sha(ledger), [], oracle.WINDOW)),
                    oracle.queue(oracle.numbered(dict(base, id=base['id']), snapshot['_kept']['settled']['cleared']),
                                 base))
            checked.append(label)
        self.assertEqual(sorted(checked), ['Y04-OCT', 'Y04-OCT-open'])

    def test_sheets_without_a_standing_tolerance_are_the_sheet_oracles(self):
        checked = []
        for story, label, snapshot in saves():
            if snapshot['tolerated'] or snapshot.get('refused') or label.startswith('Y06'):
                continue
            kept = snapshot['_kept']
            want = oracle.sheets.sheet(kept['settled'], oracle.view(kept['cases']), snapshot['_state']['book'])
            got = snapshot['sheet']
            with self.subTest(save=label):
                self.assertEqual(want['refusal'], got['refusal'])
                if want['refusal'] is None:
                    for key in ('status', 'adjustedBank', 'adjustedBook', 'difference'):
                        self.assertEqual(want[key], got[key], key)
                    self.assertEqual(want['bank'], got['bank'])
                    for name in want['sections']:
                        self.assertEqual([(i['item'], i['origin'], i['age'], i['amount']) for i in want['sections'][name]['items']],
                                         [(i['item'], i['origin'], i['age'], i['amount']) for i in got['sections'][name]['items']],
                                         name)
            checked.append(label)
        self.assertEqual(sorted(checked), ['Y02-AUG', 'Y03-SEP', 'Y04-NOV', 'Y04-NOV-refused', 'Y04-OCT',
                                           'Y04-OCT-open', 'Y05-DEC'])


class Properties(unittest.TestCase):
    def test_sections_list_earlier_periods_first(self):
        mixed = 0
        for _, label, snapshot in saves():
            sheet = snapshot.get('sheet') or {}
            month = snapshot['period'].split('-')[1]
            for name, section in (sheet.get('sections') or {}).items():
                flags = [i['period'] == month for i in section['items']]
                with self.subTest(save=label, section=name):
                    self.assertEqual(flags, sorted(flags))
                mixed += len(set(flags)) > 1
        # The year end: December's unpresented cheque before January's items.
        jan = JUDGED['Y06']['Y06-JAN']['sheet']['sections']['bookPaymentsNotOnStatement']['items']
        self.assertEqual(jan[0]['item'], 'DEC:PV-Y06-10')
        self.assertGreaterEqual(mixed, 1)

    def test_carried_items_are_two_period_ends_old_at_the_second_month_end(self):
        for _, label, snapshot in saves():
            if first_month(snapshot) or snapshot['previous'] != 'accepted':
                continue
            with self.subTest(save=label):
                self.assertTrue(all(c['age'] == 1 for c in snapshot['carried']))
                self.assertTrue(all(c['age'] == 2 for c in snapshot['still']))
                carried = {c['item'] for c in snapshot['carried']}
                for o in snapshot['outstanding']:
                    self.assertEqual(o['age'], 2 if o['item'] in carried else 1, o['item'])

    def test_cases_are_numbered_automatic_then_own_review_then_carried(self):
        rank = {'automatic': 0, 'review': 1, 'tolerated': 1, 'carried': 2}
        for _, label, snapshot in saves():
            cases = snapshot.get('cases', [])
            with self.subTest(save=label):
                self.assertEqual([c['id'] for c in cases], [f'C{k + 1}' for k in range(len(cases))])
                order = [rank[c['kind']] for c in cases]
                self.assertEqual(order, sorted(order))
        self.assertTrue(any(c['kind'] == 'carried' for _, _, s in saves() for c in s.get('cases', [])))

    def test_a_standing_tolerated_case_carries_none_of_its_members(self):
        for _, label, snapshot in saves():
            month = snapshot['period'].split('-')[1]
            members = {f'{month}:{x}' for c in snapshot.get('cases', []) if c['status'] == 'matched-tolerated'
                       for x in c['statement'] + c['cashbook']}
            with self.subTest(save=label):
                self.assertFalse(members & {o['item'] for o in snapshot.get('outstanding', [])})

    def test_a_rejected_tolerated_case_carries_both_members(self):
        aug = JUDGED['Y02']['Y02-AUG']
        rejected = [c for c in aug['cases'] if c['reason'] == 'within-tolerance' and c['status'] == 'rejected']
        self.assertEqual(len(rejected), 1)
        keys = {f"AUG:{x}" for x in rejected[0]['statement'] + rejected[0]['cashbook']}
        self.assertEqual({o['item']: o['origin'] for o in aug['outstanding'] if o['item'] in keys},
                         dict.fromkeys(keys, rejected[0]['id']))
        self.assertTrue(keys <= {c['item'] for c in JUDGED['Y02']['Y02-SEP']['carried']})

    def test_no_tolerance_reaches_a_carried_case(self):
        sep = JUDGED['Y02']['Y02-SEP']
        carried = [c for c in sep['cases'] if c['kind'] == 'carried']
        self.assertEqual([c['reason'] for c in carried], ['carried-amount-difference'])
        self.assertIsNotNone(sep['policy'])


class Refusals(unittest.TestCase):
    """What the contracts refuse, the oracle refuses."""

    def judge(self, story, frozen=FROZEN):
        return oracle.judge(story, frozen)

    def test_a_ledger_that_does_not_read_as_its_declared_cashbook_is_refused(self):
        with tempfile.TemporaryDirectory() as work:
            folder = Path(work)
            for p in FROZEN.iterdir():
                shutil.copy(p, folder / p.name)
            shutil.copy(FROZEN / 'Y01-AUG-ledger.xlsx', folder / 'Y01-JUL-ledger.xlsx')
            with self.assertRaisesRegex(oracle.StoryError, 'does not read as its declared cashbook'):
                self.judge(copy.deepcopy(STORIES['Y01']), folder)

    def test_a_second_month_that_does_not_open_on_the_first_months_closing_is_refused(self):
        story = copy.deepcopy(STORIES['Y01'])
        for page in story['periods'][1]['statement']['pages']:
            for line in page['lines']:
                if 'balance' in line:
                    line['balance'] += 100
        # Refused, it carries nothing: the month is opened and saved as it is.
        at = next(k for k, s in enumerate(story['steps']) if s.get('open') == 'Y01-AUG')
        story['steps'] = story['steps'][:at + 1] + [{'save': 'Y01-AUG'}]
        aug = self.judge(story)['Y01-AUG']
        self.assertEqual(aug['previous'], 'ROLL_OPENING')
        self.assertEqual(aug['carried'], [])

    def test_a_tolerated_case_cannot_be_accepted(self):
        story = copy.deepcopy(STORIES['Y01'])
        tolerated = next(c for c in JUDGED['Y01']['Y01-JUL']['cases'] if c['status'] == 'matched-tolerated')
        at = next(k for k, s in enumerate(story['steps']) if 'save' in s)
        story['steps'].insert(at, {'accept': {'statement': tolerated['statement'], 'cashbook': tolerated['cashbook'],
                                              'carried': []}})
        with self.assertRaisesRegex(oracle.StoryError, 'cannot be accepted'):
            self.judge(story)

    def test_a_group_decision_the_queue_does_not_offer_is_refused(self):
        story = copy.deepcopy(STORIES['Y03'])
        step = next(s for s in story['steps'] if 'group' in s)
        step['group']['type'] = 'accept'
        with self.assertRaisesRegex(oracle.StoryError, 'does not offer accept'):
            self.judge(story)

    def test_a_policy_declared_after_a_decision_is_refused(self):
        story = copy.deepcopy(STORIES['Y02'])
        at = next(k for k, s in enumerate(story['steps']) if 'group' in s)
        story['steps'].insert(at + 1, {'policy': {'perItem': 1, 'perPeriod': 3, 'note': 'later'}})
        with self.assertRaisesRegex(oracle.StoryError, 'after a decision'):
            self.judge(story)

    def test_an_undecided_first_month_is_refused_as_previous(self):
        self.assertEqual(JUDGED['Y04']['Y04-NOV-refused']['previous'], 'ROLL_PREVIOUS_UNDECIDED')
        self.assertEqual(JUDGED['Y04']['Y04-NOV-refused']['sheet'], {'refusal': 'SHEET_PREVIOUS_REFUSED'})
        self.assertEqual(JUDGED['Y04']['Y04-NOV-refused']['carried'], [])


if __name__ == '__main__':
    unittest.main()
