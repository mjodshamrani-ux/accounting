"""The sealed foundation oracle, run on CLR-1 H1, agrees with every intent
written by hand: each group with its member rows, net, status and every
reason in contract order, each faulty line with its code, and the blank
lines, except the one difference named in DIFFERS, which must be exactly
that. And EXPECTED.json is what the oracle returns.

  python3 -B -m unittest discover -s audit/clearing-groups-holdout-h1 -p test_intent.py -v
"""
import json
import os
import unittest
from pathlib import Path

import judge

HERE = Path(__file__).resolve().parent
FROZEN = Path(os.environ.get('CLR_GROUPS_H1_FOLDER', HERE / 'frozen'))
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))


def seen(result):
    if result['refused']:
        return {'refused': result['refused'], 'groups': [], 'errors': [], 'blank': []}
    return {'refused': None,
            'groups': [[g['reference'], [m[0] for m in g['members']], g['net'], g['status'], g['reasons']]
                       for g in result['groups']],
            'errors': [[r, c] for r, c, _ in result['errors']], 'blank': result['blank']}


# Found on the first comparison, before the seal, and kept as written: the
# contract's RESIDUAL applies to a group whose net is not zero or that lacks
# a positive or a negative member, and names no exception, so the hand intent
# gives a line without a document both reasons. The sealed foundation oracle,
# the foundation's own stories and the engine give it MISSING_REFERENCE
# alone. Neither the oracle nor the intent is changed; the question is the
# owner's.
DIFFERS = {('H25', ''): (['MISSING_REFERENCE', 'RESIDUAL'], ['MISSING_REFERENCE'])}


def as_oracle_reads(sid, intent):
    groups = []
    for g in intent['groups']:
        if (sid, g[0]) in DIFFERS:
            written, read = DIFFERS[(sid, g[0])]
            assert g[4] == written, (sid, g)
            g = g[:4] + [read]
        groups.append(g)
    return {**intent, 'groups': groups}


class Intent(unittest.TestCase):
    result = judge.run(FROZEN)['stories']

    def test_every_intent(self):
        self.assertEqual(sorted(self.result), sorted(s['id'] for s in FACTS['stories']))
        for story in FACTS['stories']:
            with self.subTest(story=story['id']):
                got, want = seen(self.result[story['id']]), as_oracle_reads(story['id'], story['intent'])
                if got != want:
                    first = next(k for k in sorted(set(got) | set(want)) if got.get(k) != want.get(k))
                    self.fail(f'{first}: {str(got.get(first))[:300]} != {str(want.get(first))[:300]}')

    def test_expected_is_the_oracle(self):
        expected = json.loads((FROZEN / 'EXPECTED.json').read_text(encoding='utf-8'))
        self.assertEqual(expected['stories'], self.result)


if __name__ == '__main__':
    unittest.main()
