"""The sealed foundation oracle, run on INV-3 H1, agrees with every intent
written by hand: each register row linked or unlinked with its reasons in
contract order, every other unlinked record with its role, row, key and
reason, and the financial outcome. And EXPECTED.json is what the oracle
returns.

  python3 -B -m unittest discover -s audit/inventory-links-holdout-h1 -p test_intent.py -v
"""
import json
import os
import unittest
from pathlib import Path

import judge

HERE = Path(__file__).resolve().parent
FROZEN = Path(os.environ.get('INV_LINKS_H1_FOLDER', HERE / 'frozen'))
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))


def seen(result):
    return {'financial': result['financial'], 'links': [link[:3] for link in result['links']],
            'unlinked': result['unlinked']}


class Intent(unittest.TestCase):
    result = judge.run(FROZEN)['stories']

    def test_every_intent(self):
        self.assertEqual(sorted(self.result), sorted(s['id'] for s in FACTS['stories']))
        for story in FACTS['stories']:
            with self.subTest(story=story['id']):
                got, want = seen(self.result[story['id']]), story['intent']
                if got != want:
                    first = next(k for k in sorted(set(got) | set(want)) if got.get(k) != want.get(k))
                    diff = [(a, b) for a, b in zip(got[first], want[first]) if a != b] if first != 'financial' else []
                    self.fail(f'{first}: {str(got.get(first))[:200]} != {str(want.get(first))[:200]} {str(diff)[:300]}')

    def test_expected_is_the_oracle(self):
        expected = json.loads((FROZEN / 'EXPECTED.json').read_text(encoding='utf-8'))
        self.assertEqual(expected['stories'], self.result)


if __name__ == '__main__':
    unittest.main()
