"""The sealed foundation oracle, run on PAY-1 H1, agrees with every intent
written by hand: each employee's status and codes, the components of each
employee that is not held, the excluded sections, the shared payee
accounts, the unplaced rows, the run sums and the run codes. And
EXPECTED.json is what the oracle returns.

  python3 -B -m unittest discover -s audit/payroll-long-register-holdout-h1 -p test_intent.py -v
"""
import json
import unittest
from pathlib import Path

import judge

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))


def summary(j):
    if 'refused' in j:
        return {'refused': j['refused']}
    return {
        'employees': {k: [v['status'], v['codes']] for k, v in j['employees'].items()},
        'components': {k: [v['earnings'], v['deductions'], v['employer'], v['net']]
                       for k, v in j['employees'].items() if v['status'] != 'held'},
        'excludedSections': j['excludedSections'],
        'sharedPayees': j['sharedPayees'],
        'unplaced': j['unplaced'],
        'totals': j['totals'],
        'run': j['run'],
    }


class Intent(unittest.TestCase):
    result = judge.oracle().run(FROZEN)['stories']

    def test_every_intent(self):
        self.assertEqual(sorted(self.result), sorted(s['id'] for s in FACTS['stories']))
        for story in FACTS['stories']:
            with self.subTest(story=story['id']):
                got = summary(self.result[story['id']])
                if got != story['intent']:
                    first = next(k for k in sorted(set(got) | set(story['intent']))
                                 if got.get(k) != story['intent'].get(k))
                    self.fail(f"{first}: {str(got.get(first))[:300]} != {str(story['intent'].get(first))[:300]}")

    def test_expected_is_the_oracle(self):
        expected = json.loads((FROZEN / 'EXPECTED.json').read_text(encoding='utf-8'))
        self.assertEqual(expected['stories'], self.result)


if __name__ == '__main__':
    unittest.main()
