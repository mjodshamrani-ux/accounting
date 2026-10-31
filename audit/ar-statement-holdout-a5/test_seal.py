"""The seal check passes on the frozen holdout and rejects each tampering.

  python3 -B -m unittest discover -s audit/ar-statement-holdout-a5 -p test_seal.py -v
"""
import copy
import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from check_seal import disagreement, problems  # noqa: E402


class Seal(unittest.TestCase):
    def test_frozen_holdout_is_sealed(self):
        self.assertEqual(problems(), [])
        holdout = json.loads((HERE / 'holdout.json').read_text(encoding='utf-8'))
        self.assertEqual(len(holdout['positives']) + len(holdout['held']), 18)

    def tampered(self, change):
        with tempfile.TemporaryDirectory() as tmp:
            frozen = Path(tmp) / 'frozen'
            shutil.copytree(HERE / 'frozen', frozen)
            change(frozen)
            found = problems(frozen)
            self.assertNotEqual(found, [])
            return found

    def test_a_changed_pdf_byte(self):
        def change(frozen):
            p = frozen / 'B09-statement.pdf'
            b = bytearray(p.read_bytes())
            b[len(b) // 2] ^= 1
            p.write_bytes(bytes(b))
        self.tampered(change)

    def test_a_changed_ledger_amount(self):
        def change(frozen):
            p = frozen / 'B01-ledger.csv'
            text = p.read_bytes()
            amount = re.search(rb',(\d+\.\d\d),Synthetic', text).group(1)
            p.write_bytes(text.replace(amount, amount[:-1] + bytes([amount[-1] ^ 1]), 1))
        self.tampered(change)

    def test_an_extra_file(self):
        self.tampered(lambda frozen: (frozen / 'B19-statement.pdf').write_bytes(b'%PDF-1.4'))

    def test_an_expected_match_changed(self):
        def change(frozen):
            p = frozen / 'EXPECTED.json'
            data = json.loads(p.read_text(encoding='utf-8'))
            data['stories']['B09']['matched'] -= 1
            p.write_text(json.dumps(data), encoding='utf-8')
        found = self.tampered(change)
        self.assertIn('the oracle no longer reproduces EXPECTED.json', found)

    def test_a_planted_fault_the_reading_accepted(self):
        def change(frozen):
            p = frozen / 'VERIFY.json'
            data = json.loads(p.read_text(encoding='utf-8'))
            data['selfTest'][0]['rejected'] = False
            p.write_text(json.dumps(data), encoding='utf-8')
        self.assertIn('the independent PDF reading did not pass', self.tampered(change))

    def test_a_refusal_found_before_the_seal(self):
        def change(frozen):
            p = frozen / 'ELIGIBILITY.json'
            data = json.loads(p.read_text(encoding='utf-8'))
            data['statements']['B03']['found']['images'] = [{'page': 1, 'at': 1}]
            p.write_text(json.dumps(data), encoding='utf-8')
        self.assertIn("B03: falls into a refusal the reader declares: ['images']", self.tampered(change))

    def test_the_bank_column_model_is_not_a_refusal_here(self):
        eligibility = json.loads((HERE / 'frozen' / 'ELIGIBILITY.json').read_text(encoding='utf-8'))
        self.assertTrue(all(set(r['found']) <= {'columns'} for r in eligibility['statements'].values()))

    def test_an_intent_the_oracle_does_not_share(self):
        facts = json.loads((HERE / 'frozen' / 'stories.json').read_text(encoding='utf-8'))
        expected = json.loads((HERE / 'frozen' / 'EXPECTED.json').read_text(encoding='utf-8'))['stories']
        story = next(s for s in facts['stories'] if s['id'] == 'B10')
        self.assertEqual(disagreement(story, expected['B10']), [])
        for key, value in (('matched', 4), ('review', {}), ('errors', ['AR_AMOUNT']), ('outOfScopeLines', 5)):
            changed = copy.deepcopy(story)
            changed['intent'][key] = value
            self.assertNotEqual(disagreement(changed, expected['B10']), [], key)


if __name__ == '__main__':
    unittest.main()
