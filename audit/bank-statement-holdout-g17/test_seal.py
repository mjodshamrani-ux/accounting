"""The seal check passes on the frozen holdout and rejects each tampering.

  python3 -B -m unittest discover -s audit/bank-statement-holdout-g17 -p test_seal.py -v
"""
import json
import re
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
            p = frozen / 'V05-statement.pdf'
            b = bytearray(p.read_bytes())
            b[len(b) // 2] ^= 1
            p.write_bytes(bytes(b))
        self.tampered(change)

    def test_a_changed_cashbook_amount(self):
        def change(frozen, _):
            p = frozen / 'V03-cashbook.csv'
            text = p.read_bytes()
            amount = re.search(rb',(\d+\.\d\d)\r\n', text).group(1)
            p.write_bytes(text.replace(b',' + amount + b'\r\n', b',' + amount[:-1] + bytes([amount[-1] ^ 1]) + b'\r\n', 1))
        self.tampered(change)

    def test_an_extra_file(self):
        self.tampered(lambda frozen, _: (frozen / 'V13-statement.pdf').write_bytes(b'%PDF-1.4'))

    def test_eligibility_changed_after_the_seal(self):
        def change(_, holdout):
            data = json.loads(holdout.read_text(encoding='utf-8'))
            data['eligibility']['positives'].remove('V03')
            holdout.write_text(json.dumps(data), encoding='utf-8')
        self.tampered(change)

    def test_an_expected_pair_removed(self):
        def change(frozen, _):
            p = frozen / 'EXPECTED.json'
            text = p.read_text(encoding='utf-8')
            p.write_text(text.replace('["b:V1","c:V1"],', '', 1), encoding='utf-8')
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

    def eligibility(self, alter):
        def change(frozen, _):
            p = frozen / 'ELIGIBILITY.json'
            data = json.loads(p.read_text(encoding='utf-8'))
            alter(data)
            p.write_text(json.dumps(data), encoding='utf-8')
        self.tampered(change)

    def test_an_eligibility_finding(self):
        finding = {'ruleClearance': [{'page': 1, 'at': ['2', -9.35]}]}
        self.eligibility(lambda d: d['statements']['V08'].update(found=finding))

    def test_eligibility_for_other_bytes(self):
        self.eligibility(lambda d: d['statements']['V02'].update(sha256='0' * 64))

    def test_eligibility_without_a_statement(self):
        self.eligibility(lambda d: d['statements'].pop('V12'))

    def test_a_decision_story_the_page_cannot_decide(self):
        self.eligibility(lambda d: d['decision'].update(problems=['no case the page accepts: []']))

    def test_eligibility_of_another_decision_story(self):
        self.eligibility(lambda d: d['decision'].update(story='V08'))

    def test_a_statement_that_does_not_reach_the_rule_it_was_written_for(self):
        self.eligibility(lambda d: d['statements']['V07']['exercised'].pop('reversedDate'))

    def test_a_statement_whose_values_are_not_placed_by_their_end_edge(self):
        self.eligibility(lambda d: d['statements']['V10']['exercised'].pop('endAligned'))

    def test_a_cashbook_the_check_refused(self):
        self.eligibility(lambda d: d['cashbooks']['V10'].update(refused={'code': 'CELL', 'row': 4, 'detail': 'formula'}))

    def test_a_cashbook_read_short(self):
        self.eligibility(lambda d: d['cashbooks']['V03'].update(entries=d['cashbooks']['V03']['entries'] - 1))

    def test_a_typed_cashbook_read_as_text(self):
        self.eligibility(lambda d: d['cashbooks']['V03']['exercised'].pop('typedAmounts'))

    def test_eligibility_without_a_cashbook(self):
        self.eligibility(lambda d: d['cashbooks'].pop('V03'))

    def test_verification_with_a_glyph_drawn_as_notdef(self):
        def change(frozen, _):
            p = frozen / 'VERIFY.json'
            data = json.loads(p.read_text(encoding='utf-8'))
            data['statements'][8]['notdefGlyphs'] = 3
            p.write_text(json.dumps(data), encoding='utf-8')
        self.tampered(change)

    def test_a_rule_declared_for_a_statement_that_does_not_reach_it(self):
        def change(_, holdout):
            data = json.loads(holdout.read_text(encoding='utf-8'))
            data['eligibility']['writtenFor']['reversedDate'].append('V10')
            holdout.write_text(json.dumps(data), encoding='utf-8')
        self.tampered(change)


if __name__ == '__main__':
    unittest.main()
