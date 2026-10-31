"""The REVIEW-1 oracle agrees with every hand-written intent, reads neither the
recipe nor the intent, keeps every case needing a decision in exactly one
group of one evidence, records a group decision as one decision per case,
returns an undone case to the queue, offers no group accept for an
exception or a group of one, and refuses decisions after a source changed.

  python3 -B -m unittest discover -s audit/bank-review-foundation -p test_oracle.py -v
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
    spec = importlib.util.spec_from_file_location('review_oracle', os.environ.get('ORACLE', HERE / 'oracle.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


oracle = load()
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))


def shape(g):
    return (g['reason'], g['direction'], g['statement'], g['cashbook'], g.get('gap'),
            g['cases'] if isinstance(g['cases'], int) else len(g['cases']))


def disagreements(judged, story):
    """Where the judged story differs from its intent."""
    intent = story['intent']
    out = []
    if judged['held'] != intent.get('held', False):
        out.append('held')
    if sorted(map(shape, judged['queue'])) != sorted(map(shape, intent['queue'])):
        out.append('queue')
    if 'order' in intent and [[g['reason'], g['direction']] for g in judged['queue']] != intent['order']:
        out.append('order')
    if 'caseOrder' in intent:
        group = next(g for g in judged['queue'] if g['direction'] == 'out')
        if [c['cashbook'][0] for c in group['cases']] != intent['caseOrder']:
            out.append('caseOrder')
    if judged['refusal'] != intent.get('refusal'):
        out.append('refusal')
    if 'refusal' not in intent and judged['after'] != intent['after']:
        out.append('after')
    if judged['actions'] != intent['actions']:
        out.append('actions')
    return out


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
        # Each story judged on its own: an oracle that refuses a story's own
        # actions fails that story's assertion, not the whole run.
        cls.result, cls.errors = {}, {}
        for story in FACTS['stories']:
            try:
                cls.result[story['id']] = judge_edited(story['id'], lambda s: None)
            except Exception as error:  # noqa: BLE001
                cls.errors[story['id']] = repr(error)

    def judged(self, sid):
        self.assertNotIn(sid, self.errors, f'{sid} not judged')
        return self.result[sid]

    def test_agrees_with_every_intent(self):
        for story in FACTS['stories']:
            with self.subTest(story=story['id']):
                self.assertEqual(disagreements(self.judged(story['id']), story), [])

    def test_reads_neither_recipe_nor_intent(self):
        blind = copy.deepcopy(FACTS)
        for s in blind['stories']:
            s['recipe'] = 'removed'
            s['intent'] = {'queue': []}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'stories.json'
            path.write_text(json.dumps(blind), encoding='utf-8')
            self.assertEqual(self.errors, {})
            self.assertEqual(oracle.run(FROZEN, path)['stories'], self.result)

    def test_imports_neither_generator_nor_product(self):
        source = Path(oracle.__file__).read_text(encoding='utf-8')
        self.assertNotRegex(source, r'stories\.mjs[\'"]|lib/reconciliation|\.ts[\'"]')
        self.assertNotIn('recipe', re.sub(r'""".*?"""', '', source, flags=re.S))

    def test_every_case_needing_a_decision_is_in_one_group(self):
        for story in FACTS['stories']:
            sid = story['id']
            with self.subTest(story=sid):
                judged = self.judged(sid)
                cases = [c['case'] for g in judged['queue'] for c in g['cases']]
                self.assertEqual(len(cases), len(set(cases)))
                self.assertEqual(len(cases), judged['actions']['single'])
                for g in judged['queue']:
                    self.assertTrue(all(c['impact'] <= g['impact'] for c in g['cases']))

    def test_a_group_decision_is_one_decision_per_case(self):
        judged = self.judged('Q01')
        accepted = [case for kind, case in judged['decisions'] if kind == 'accept']
        self.assertEqual(len(accepted), 20)
        self.assertEqual(len(set(accepted)), 20)
        self.assertEqual(sorted(accepted, key=lambda c: int(c[1:])),
                         sorted((c['case'] for g in judged['queue'] for c in g['cases']), key=lambda c: int(c[1:])))

    def test_an_undone_case_is_back_in_the_queue_alone(self):
        judged = self.judged('Q01')
        undone = [case for kind, case in judged['decisions'] if kind == 'undo']
        self.assertEqual([[c['case'] for c in g['cases']] for g in judged['queueAfter']], [undone])

    def test_a_later_group_decision_covers_only_the_cases_still_open(self):
        judged = self.judged('Q15')
        rejected = [case for kind, case in judged['decisions'] if kind == 'reject']
        undone = [case for kind, case in judged['decisions'] if kind == 'undo']
        self.assertEqual(sorted(rejected), sorted(undone))

    def test_no_group_accept_for_exceptions_or_a_group_of_one(self):
        def refused_by_the_queue(sid, edit):
            try:
                judge_edited(sid, edit)
            except oracle.StoryError:
                return True
            except Exception:  # noqa: BLE001 - refused later, by the lifecycle, is not the queue refusing
                return False
            return False

        def accept(story):
            story['actions'][0]['group']['type'] = 'accept'
        self.assertTrue(refused_by_the_queue('Q06', accept))
        self.assertTrue(refused_by_the_queue('Q16', lambda s: s['actions'].append({'group': {'type': 'accept', 'with': 'PV-Q16-62'}})))
        self.assertTrue(refused_by_the_queue('Q16', lambda s: s['actions'].append({'group': {'type': 'reject', 'with': 'PV-Q16-61'}})))

    def test_a_changed_source_refuses_every_decision_and_nothing_else_does(self):
        self.assertEqual(self.judged('Q08')['refusal'], 'BANK_STATEMENT_DECISION')
        kept = judge_edited('Q08', lambda s: s.update(actions=s['actions'][:1]))
        self.assertIsNone(kept['refusal'])
        self.assertEqual(kept['after'], {'accepted': 3, 'rejected': 0, 'open': 0})
        replaced_first = judge_edited('Q08', lambda s: s.update(actions=[s['actions'][1]]))
        self.assertIsNone(replaced_first['refusal'])

    def test_one_gap_one_group(self):
        def five(story):
            for page in story['periods'][0]['statement']['pages']:
                for line in page['lines']:
                    if line.get('reference', '').startswith('CHQ-Q05N'):
                        line['date'] = '2026-11-15'
                        line['valueDate'] = '2026-11-15'
        judged = judge_edited('Q05', five)
        self.assertEqual([(g['gap'], len(g['cases'])) for g in judged['queue']], [(5, 3)])


if __name__ == '__main__':
    unittest.main()
