"""The holdout's expectation against the intent written by hand in every
story, the composed oracle held to the sealed oracles it composes wherever
they can judge a month alone, the foundation's properties, and the
composition points these stories add, each as the story says it.

  python3 -B -m unittest discover -s audit/bank-cycle-holdout-c4 -p test_intent.py

C4_FROZEN names another frozen folder (a draft before the seal).
"""
import copy
import importlib.util
import json
import os
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = Path(os.environ.get('C4_FROZEN', HERE / 'frozen'))
_spec = importlib.util.spec_from_file_location('c4_expected', HERE / 'expected.py')
expected = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(expected)
corrected = expected.oracle()
oracle = corrected.sealed

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


def expanded(snapshot):
    """The month's decisions, each group as the decisions of its cases in the
    queue's order: [(kind, case)]."""
    by_id = {c['id']: c for c in snapshot['_kept']['cases']}
    month = snapshot['period'].split('-')[1]
    out = []
    for step in snapshot['_state']['decisions']:
        if 'group' in step:
            wanted = sorted(sorted(oracle.keys_of(month, m)) for m in step['group']['cases'])
            g = next(g for g in snapshot['queue']
                     if sorted(sorted(by_id[c]['members']) for c in g['cases']) == wanted)
            out += [(step['group']['type'], by_id[c]) for c in g['cases']]
        else:
            kind = 'accept' if 'accept' in step else 'reject'
            key = sorted(oracle.keys_of(month, step[kind]))
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
        self.assertEqual(count, 15)

    def test_the_expectation_is_the_corrected_oracle_on_these_files(self):
        got = expected.run(FROZEN)
        self.assertEqual(got['version'], 'bank-cycle-foundation-oracle-1-correction-1')
        for story, label, snapshot in saves():
            with self.subTest(save=label):
                # The judge here runs through the correction too.
                kept = {k: v for k, v in snapshot.items() if not k.startswith('_')}
                self.assertEqual(json.loads(json.dumps(kept)), got['stories'][story['id']][label])


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
        self.assertEqual(sorted(checked), ['Z02-MAR', 'Z04-MAY', 'Z04-MAY-open', 'Z05-JUN'])

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
                    oracle.queue(oracle.numbered(base, snapshot['_kept']['settled']['cleared']), base))
            checked.append(label)
        self.assertEqual(sorted(checked), ['Z02-MAR', 'Z03-APR', 'Z04-MAY-open', 'Z06-JAN'])

    def test_sheets_without_a_standing_tolerance_are_the_sheet_oracles(self):
        checked = []
        for story, label, snapshot in saves():
            if snapshot['tolerated'] or snapshot.get('refused'):
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
                        self.assertEqual([(i['item'], i['origin'], i['age'], i['amount'])
                                          for i in want['sections'][name]['items']],
                                         [(i['item'], i['origin'], i['age'], i['amount'])
                                          for i in got['sections'][name]['items']], name)
            checked.append(label)
        self.assertEqual(sorted(checked), ['Z01-MAR', 'Z02-MAR', 'Z03-APR', 'Z04-JUN', 'Z04-JUN-draft',
                                           'Z04-JUN-refused', 'Z04-MAY-open', 'Z05-JUL', 'Z06-JAN'])


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
        self.assertGreaterEqual(mixed, 3)

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

    def test_a_standing_tolerated_case_carries_none_of_its_members(self):
        for _, label, snapshot in saves():
            month = snapshot['period'].split('-')[1]
            members = {f'{month}:{x}' for c in snapshot.get('cases', []) if c['status'] == 'matched-tolerated'
                       for x in c['statement'] + c['cashbook']}
            with self.subTest(save=label):
                self.assertFalse(members & {o['item'] for o in snapshot.get('outstanding', [])})

    def test_no_tolerance_reaches_a_carried_case(self):
        for _, label, snapshot in saves():
            with self.subTest(save=label):
                self.assertFalse(any(c['kind'] == 'carried' and c['status'] == 'matched-tolerated'
                                     for c in snapshot.get('cases', [])))


class Composition(unittest.TestCase):
    """What each story was written to hold, as the expectation holds it."""

    def save(self, label):
        return JUDGED[label.split('-')[0]][label]

    def test_sign_offs_given_before_a_later_decision_no_longer_stand(self):
        feb = self.save('Z01-FEB')
        self.assertEqual({k: v['valid'] for k, v in feb['signoffs'].items()}, {'prepared': False, 'reviewed': False})
        self.assertTrue(any(c['reason'] == 'within-tolerance' and c['status'] == 'rejected' for c in feb['cases']))
        self.assertEqual({k: v['valid'] for k, v in self.save('Z01-MAR')['signoffs'].items()},
                         {'prepared': True, 'reviewed': True})

    def test_a_column_added_at_the_end_keeps_the_saved_map(self):
        mar = self.save('Z01-MAR')['reading']
        self.assertEqual((mar['by'], mar['misfit']), ('map', None))
        self.assertEqual([u['label'] for u in mar['unread']], ['Type', 'Balance', 'Reconciled'])

    def test_a_header_moved_down_a_row_does_not_fit_the_saved_map(self):
        may = self.save('Z03-MAY')['reading']
        self.assertEqual(may['header'], 5)
        self.assertEqual(len(may['misfit']), 6)
        self.assertTrue(all(p['kind'] == 'column' and len(p['elsewhere']) == 1 and p['elsewhere'][0].endswith('5')
                            for p in may['misfit']))

    def test_a_renamed_column_does_not_fit_the_saved_map(self):
        jul = self.save('Z05-JUL')['reading']
        self.assertEqual([(p['role'], p['found'], p['elsewhere']) for p in jul['misfit']],
                         [('reference', 'رقم المرجع', [])])

    def test_a_carried_cheque_within_the_new_item_limit_is_not_tolerated(self):
        apr = self.save('Z02-APR')
        carried = [c for c in apr['cases'] if c['kind'] == 'carried']
        self.assertEqual([(c['reason'], c['status']) for c in carried], [('carried-amount-difference', 'rejected')])
        self.assertEqual(apr['policy']['perItem'], 2)
        cheque = next(i for i in apr['carried'] if i['reference'] == 'CHQ-004512')
        presented = next(i for i in apr['outstanding'] if i['reference'] == 'CHQ-004512' and i['side'] == 'statement')
        self.assertEqual(presented['amount'] - cheque['amount'], 2)

    def test_two_carried_deposits_claiming_the_same_deposits_are_one_ambiguous_case(self):
        may = self.save('Z03-MAY')
        carried = [c for c in may['cases'] if c['kind'] == 'carried']
        self.assertEqual([(c['reason'], len(c['carried']), len(c['statement'])) for c in carried],
                         [('carried-ambiguous', 2, 2)])

    def test_a_policy_declared_after_a_save_and_before_any_decision_settles_the_case(self):
        self.assertEqual(self.save('Z04-MAY-open')['pending'], 1)
        may = self.save('Z04-MAY')
        self.assertEqual((may['pending'], len(may['tolerated']), may['policy']['perItem']), (0, 1, 2))

    def test_a_carrying_month_saved_in_draft(self):
        draft = self.save('Z04-JUN-draft')
        self.assertEqual((draft['sheet']['status'], draft['pending']), ('draft', 2))
        self.assertEqual(sorted(c['kind'] for c in draft['cases'] if c['status'] == 'needs-review'),
                         ['carried', 'review'])

    def test_an_ambiguity_by_amount_and_date_and_a_wrong_book_balance(self):
        jan = self.save('Z06-JAN')
        self.assertIn(('ambiguous-amount-date', 'rejected'), [(c['reason'], c['status']) for c in jan['cases']])
        self.assertEqual(jan['sheet']['unexplained'], 10000)
        self.assertEqual(self.save('Z06-FEB')['sheet']['unexplained'], 0)

    def test_carried_items_cleared_by_amount(self):
        feb = self.save('Z06-FEB')
        self.assertEqual(sorted((c['reason'], c['status']) for c in feb['cases'] if c['kind'] == 'carried'),
                         [('carried-amount-suggestion', 'matched-accepted')] * 2)



class Planted(unittest.TestCase):
    """The intent check fails when a story is changed in one decisive step:
    the expectation follows the files and steps, not the intent."""

    def judged(self, sid, change, upto=None):
        """The story changed, and played up to the save `upto` when given:
        a later step may rest on what the change undid."""
        story = copy.deepcopy(STORIES[sid])
        change(story['steps'])
        if upto:
            story['steps'] = story['steps'][:story['steps'].index({'save': upto}) + 1]
        return oracle.judge(story, FROZEN)

    def differs(self, sid, change, label):
        got = summary(self.judged(sid, change, label)[label])
        self.assertNotEqual(got, STORIES[sid]['intent'][label])
        return got

    def test_the_tolerated_case_left_standing(self):
        at = next(k for k, s in enumerate(STORIES['Z01']['steps']) if 'reject' in s)
        got = self.differs('Z01', lambda steps: steps.pop(at), 'Z01-FEB')
        self.assertEqual(got['tolerated'], 2)

    def test_no_policy_after_the_first_save(self):
        at = next(k for k, s in enumerate(STORIES['Z04']['steps']) if 'policy' in s)
        got = self.differs('Z04', lambda steps: steps.pop(at), 'Z04-MAY')
        self.assertEqual(got['pending'], 1)

    def test_a_period_limit_one_halala_short_in_june(self):
        def narrower(steps):
            next(s for s in steps if 'policy' in s)['policy']['perPeriod'] = 3
        got = self.differs('Z05', narrower, 'Z05-JUN')
        self.assertEqual((got['tolerated'], got['exceeded']), (0, {'sum': 4, 'cap': 3}))

    def test_a_saved_map_that_does_not_fit_and_nothing_by_hand(self):
        def bare(steps):
            next(s for s in steps if s.get('open') == 'Z03-MAY')['ledger'].pop('then')
        with self.assertRaisesRegex(oracle.StoryError, 'does not fit'):
            self.judged('Z03', bare)

    def test_a_carried_amount_difference_cannot_be_accepted(self):
        def accepted(steps):
            at = next(k for k, s in enumerate(steps) if 'reject' in s and s['reject']['carried'])
            steps[at] = {'accept': steps[at]['reject']}
        with self.assertRaisesRegex(oracle.StoryError, 'cannot be accepted'):
            self.judged('Z02', accepted)


if __name__ == '__main__':
    unittest.main()
