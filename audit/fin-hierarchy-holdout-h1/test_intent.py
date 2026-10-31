"""The FIN-1A oracle, unchanged, agrees on H1 with every intent written by
hand from the contract, and reads neither the stories nor their intent.
Agreement: the same status; every code the intent names is among the
oracle's codes; for an eligible story, the same facts and ownership. The
codes the oracle adds beyond the intent are listed in the README.

  python3 -B -m unittest discover -s audit/fin-hierarchy-holdout-h1 -p test_intent.py -v
"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
sys.path.insert(0, str(HERE))
import judge  # noqa: E402

FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))


class Intent(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = judge.run(FROZEN)['stories']

    def test_agrees_with_every_intent(self):
        self.assertEqual(sorted(self.result), sorted(s['id'] for s in FACTS['stories']))
        for story in FACTS['stories']:
            with self.subTest(story=story['id']):
                got, intent = self.result[story['id']], story['intent']
                self.assertEqual(got['status'], intent['status'])
                self.assertLessEqual(set(intent['codes']), set(got['codes']))
                if intent['status'] == 'eligible':
                    self.assertEqual(got['codes'], [])
                    self.assertEqual(got['facts'], intent['facts'])
                    self.assertEqual(got['ownership'], intent['ownership'])

    def test_reads_neither_stories_nor_intent(self):
        with tempfile.TemporaryDirectory() as tmp:
            for story in FACTS['stories']:
                shutil.copytree(FROZEN / story['id'], Path(tmp) / story['id'])
            self.assertEqual(judge.run(tmp)['stories'], self.result)

    def test_expected_is_this_oracle_on_these_files(self):
        self.assertEqual(json.loads((FROZEN / 'EXPECTED.json').read_text(encoding='utf-8')),
                         json.loads(json.dumps(judge.run(FROZEN), ensure_ascii=False)))


if __name__ == '__main__':
    unittest.main()
