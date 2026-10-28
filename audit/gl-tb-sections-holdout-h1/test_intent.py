"""The sealed GLT-1 foundation oracle, unchanged, agrees on H1 with every
intent written by hand from the contract, and reads neither the stories nor
their intent.

  python3 -B -m unittest discover -s audit/gl-tb-sections-holdout-h1 -p test_intent.py -v
"""
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
ORACLE = HERE.parent / 'gl-tb-sections-foundation' / 'oracle.py'
_spec = importlib.util.spec_from_file_location('glt1_oracle', ORACLE)
oracle = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oracle)
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))


def summary(judged):
    return {
        'accounts': {k: [v['status'], v['codes']] for k, v in judged['accounts'].items()},
        'excludedSections': judged['excludedSections'],
        'excludedPages': judged['excludedPages'],
        'orphanTotals': judged['orphanTotals'],
        'unplaced': judged['unplaced'],
        'run': judged['run'],
    }


class Intent(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = oracle.run(FROZEN)['stories']

    def test_agrees_with_every_intent(self):
        self.assertEqual(sorted(self.result), sorted(s['id'] for s in FACTS['stories']))
        for story in FACTS['stories']:
            with self.subTest(story=story['id']):
                self.assertEqual(summary(self.result[story['id']]), story['intent'])

    def test_reads_neither_stories_nor_intent(self):
        with tempfile.TemporaryDirectory() as tmp:
            for p in [*FROZEN.glob('*.csv'), *FROZEN.glob('*-scope.json')]:
                shutil.copy(p, Path(tmp) / p.name)
            self.assertEqual(oracle.run(tmp)['stories'], self.result)

    def test_expected_is_this_oracle_on_these_files(self):
        self.assertEqual(json.loads((FROZEN / 'EXPECTED.json').read_text(encoding='utf-8')),
                         json.loads(json.dumps(oracle.run(FROZEN), ensure_ascii=False)))


if __name__ == '__main__':
    unittest.main()
