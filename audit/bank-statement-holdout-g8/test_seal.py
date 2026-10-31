"""The seal check passes on the frozen holdout and rejects each tampering.

  python3 -B -m unittest discover -s audit/bank-statement-holdout-g8 -p test_seal.py -v
"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from check_seal import check  # noqa: E402


class Seal(unittest.TestCase):
    def test_frozen_holdout_is_sealed(self):
        result = check()
        self.assertEqual(result['statements'], 12)
        self.assertEqual(result['positives'], 9)

    def tampered(self, change):
        with tempfile.TemporaryDirectory() as tmp:
            frozen = Path(tmp) / 'frozen'
            shutil.copytree(HERE / 'frozen', frozen)
            holdout = Path(tmp) / 'holdout.json'
            shutil.copy(HERE / 'holdout.json', holdout)
            change(frozen, holdout)
            with self.assertRaises(AssertionError):
                check(frozen, holdout)

    def test_a_changed_pdf_byte(self):
        def change(frozen, _):
            p = frozen / 'K05-statement.pdf'
            b = bytearray(p.read_bytes())
            b[len(b) // 2] ^= 1
            p.write_bytes(bytes(b))
        self.tampered(change)

    def test_a_changed_cashbook_amount(self):
        def change(frozen, _):
            p = frozen / 'K02-cashbook.csv'
            p.write_bytes(p.read_bytes().replace(b'3333.33', b'3333.34', 1))
        self.tampered(change)

    def test_an_extra_file(self):
        self.tampered(lambda frozen, _: (frozen / 'K13-statement.pdf').write_bytes(b'%PDF-1.4'))

    def test_eligibility_changed_after_the_seal(self):
        def change(_, holdout):
            data = json.loads(holdout.read_text(encoding='utf-8'))
            data['eligibility']['positives'].remove('K03')
            holdout.write_text(json.dumps(data), encoding='utf-8')
        self.tampered(change)

    def test_an_expected_pair_removed(self):
        def change(frozen, _):
            p = frozen / 'EXPECTED.json'
            text = p.read_text(encoding='utf-8')
            p.write_text(text.replace('["b:A1","c:A1"],', '', 1), encoding='utf-8')
        self.tampered(change)

    def test_an_expected_reason_changed(self):
        def change(frozen, _):
            p = frozen / 'EXPECTED.json'
            p.write_text(p.read_text(encoding='utf-8').replace('"date-gap"', '"amount-date-suggestion"', 1), encoding='utf-8')
        self.tampered(change)

    def test_verification_marked_failed(self):
        def change(frozen, _):
            p = frozen / 'VERIFY.json'
            data = json.loads(p.read_text(encoding='utf-8'))
            data['statements'][2]['ok'] = False
            p.write_text(json.dumps(data), encoding='utf-8')
        self.tampered(change)

    def test_verification_for_other_bytes(self):
        def change(frozen, _):
            p = frozen / 'VERIFY.json'
            data = json.loads(p.read_text(encoding='utf-8'))
            data['statements'][0]['sha256'] = '0' * 64
            p.write_text(json.dumps(data), encoding='utf-8')
        self.tampered(change)


if __name__ == '__main__':
    unittest.main()
