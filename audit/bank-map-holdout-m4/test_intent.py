"""The sealed MAP-1 foundation oracle, run on this holdout, agrees with every
intent written by hand in stories.py, and reads neither the recipe nor the
intent. The comparison is the foundation's own (test_oracle.disagreements),
pointed at this package.

  python3 -B -m unittest discover -s audit/bank-map-holdout-m4 -p test_intent.py -v
M4_FROZEN=<dir> runs it on a draft before the seal.
"""
import copy
import importlib.util
import json
import os
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUDIT = HERE.parent
FROZEN = Path(os.environ.get('M4_FROZEN', HERE / 'frozen'))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


oracle = load('m4_oracle', AUDIT / 'bank-map-foundation' / 'oracle.py')
compare = load('m4_compare', AUDIT / 'bank-map-foundation' / 'test_oracle.py')
compare.FROZEN = FROZEN
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))
WINDOW = compare.WINDOW


def judged(story):
    return oracle.judge(copy.deepcopy(story), FROZEN, WINDOW)


class Intent(unittest.TestCase):
    def test_every_story_agrees_with_its_intent(self):
        found = {}
        for story in FACTS['stories']:
            try:
                d = compare.disagreements(story, judged(story))
            except Exception as e:  # noqa: BLE001
                d = [f"{story['id']} {type(e).__name__}: {e}"]
            if d:
                found[story['id']] = d
        self.assertEqual(found, {})

    def test_the_oracle_reads_neither_recipe_nor_intent(self):
        for story in FACTS['stories']:
            bare = {k: v for k, v in story.items() if k not in ('recipe', 'intent')}
            self.assertEqual(oracle.judge(bare, FROZEN, WINDOW), judged(story), story['id'])

    def test_the_stories_exercise_every_kind_of_outcome(self):
        outcomes = [got for story in FACTS['stories'] for got in judged(story)]
        reads = [o for o in outcomes if o['do'] == 'read']
        self.assertTrue(any(o.get('period') for o in reads))
        self.assertTrue(any(o.get('fit') and not o['fit']['fits'] for o in reads))
        self.assertTrue(any(o.get('reading') and o['reading']['refused'] for o in reads))
        self.assertTrue(any(o['do'] == 'import' and not o['accepted'] for o in outcomes))
        self.assertTrue(any(o['do'] == 'export' for o in outcomes))


if __name__ == '__main__':
    unittest.main()
