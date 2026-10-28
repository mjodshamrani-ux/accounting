"""The sealed foundation oracle, run on INV-2 H1, agrees with every intent
written by hand: each position's and account's status and codes, the
components of each position that is not held, the sides of each account
compared, the excluded and dated lines, the unseen origins, the repeated
headers, the unplaced rows, the totals and the run codes. And EXPECTED.json
is what the oracle returns.

  python3 -B -m unittest discover -s audit/inventory-movement-holdout-h1 -p test_intent.py -v
"""
import json
import unittest
from pathlib import Path

import judge

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))


class Intent(unittest.TestCase):
    result = judge.oracle().run(FROZEN)['stories']

    def test_every_intent(self):
        self.assertEqual(sorted(self.result), sorted(s['id'] for s in FACTS['stories']))
        for story in FACTS['stories']:
            with self.subTest(story=story['id']):
                got, want = self.result[story['id']], story['intent']
                if got != want:
                    first = next(k for k in sorted(set(got) | set(want)) if got.get(k) != want.get(k))
                    self.fail(f'{first}: {str(got.get(first))[:300]} != {str(want.get(first))[:300]}')

    def test_expected_is_the_oracle(self):
        expected = json.loads((FROZEN / 'EXPECTED.json').read_text(encoding='utf-8'))
        self.assertEqual(expected['stories'], self.result)


if __name__ == '__main__':
    unittest.main()
