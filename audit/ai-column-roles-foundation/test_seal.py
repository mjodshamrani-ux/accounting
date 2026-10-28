"""The seal check passes on the frozen AI-1a set and rejects each tampering.

  python3 -B -m unittest discover -s audit/ai-column-roles-foundation -p test_seal.py -v
"""
import hashlib
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import check_seal  # noqa: E402
from check_seal import check  # noqa: E402


class Seal(unittest.TestCase):
    def test_frozen_holdout_is_sealed(self):
        result = check()
        self.assertEqual(result['statements'], 24)
        self.assertEqual(result['positives'], 24)
        self.assertEqual(result['classes'], {'K0': 2, 'K1': 5, 'K2': 4, 'K3': 5, 'K4': 5, 'K5': 3})

    def tampered(self, change):
        with tempfile.TemporaryDirectory() as tmp:
            frozen = Path(tmp) / 'frozen'
            shutil.copytree(HERE / 'frozen', frozen)
            change(frozen)
            with self.assertRaises(AssertionError):
                check(frozen)

    def rewrite(self, frozen, name, edit):
        path = frozen / name
        data = json.loads(path.read_text(encoding='utf-8'))
        edit(data)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    def test_a_changed_pdf_byte(self):
        def change(frozen):
            p = frozen / 'D04-statement.pdf'
            b = bytearray(p.read_bytes())
            b[len(b) // 2] ^= 1
            p.write_bytes(bytes(b))
        self.tampered(change)

    def test_a_changed_ledger_amount(self):
        def change(frozen):
            p = frozen / 'N03-ledger.csv'
            p.write_bytes(p.read_bytes().replace(b'.', b',', 1))
        self.tampered(change)

    def test_an_extra_file(self):
        self.tampered(lambda frozen: (frozen / 'Z99-statement.pdf').write_bytes(b'%PDF-1.4'))

    def test_a_required_pair_removed_with_the_manifest_rehashed(self):
        def change(frozen):
            self.rewrite(frozen, 'expected.json', lambda d: d['stories'][0]['approve'].pop())
            raw = (frozen / 'expected.json').read_bytes()

            def entry(m):
                for e in m['files']:
                    if e['file'] == 'expected.json':
                        e.update(sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw))
            self.rewrite(frozen, 'INPUT-MANIFEST.json', entry)
        self.tampered(change)

    def test_verification_not_passed(self):
        self.tampered(lambda frozen: self.rewrite(frozen, 'VERIFY.json',
                                                  lambda d: d['statements'][4].update(ok=False)))

    def test_verification_without_its_self_test(self):
        self.tampered(lambda frozen: self.rewrite(frozen, 'VERIFY.json', lambda d: d['selfTest'].pop()))

    def test_verification_of_other_bytes(self):
        self.tampered(lambda frozen: self.rewrite(frozen, 'VERIFY.json',
                                                  lambda d: d['statements'][2].update(sha256='0' * 64)))

    def test_eligibility_found_a_refusal(self):
        self.tampered(lambda frozen: self.rewrite(
            frozen, 'ELIGIBILITY.json',
            lambda d: d['statements']['A03']['found'].update(drawings=[{'page': 1}])))

    def test_eligibility_missing_a_statement(self):
        self.tampered(lambda frozen: self.rewrite(frozen, 'ELIGIBILITY.json',
                                                  lambda d: d['statements'].pop('U03')))

    def test_a_role_heading_changed_with_the_manifest_rehashed(self):
        def change(frozen):
            self.rewrite(frozen, 'expected.json', lambda d: d['stories'][2]['roles'].update(amount='Doc #'))
            raw = (frozen / 'expected.json').read_bytes()

            def entry(m):
                for e in m['files']:
                    if e['file'] == 'expected.json':
                        e.update(sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw))
            self.rewrite(frozen, 'INPUT-MANIFEST.json', entry)
        self.tampered(change)

    def test_the_measure_changed_after_the_seal(self):
        self.tampered(lambda frozen: self.rewrite(frozen, 'SEAL.json',
                                                  lambda d: d['pinned'].update({'score.mjs': '0' * 64})))

    def test_the_seal_bound_to_another_verification(self):
        self.tampered(lambda frozen: self.rewrite(frozen, 'SEAL.json', lambda d: d.update(verifySha256='0' * 64)))

    def test_the_judge_changed_after_the_seal(self):
        def change(frozen):
            self.rewrite(frozen, 'SEAL.json', lambda d: d['pinned'].update({'judge.mjs': '0' * 64}))
        self.tampered(change)

    def test_the_facts_changed(self):
        with mock.patch.object(check_seal, 'facts_json', lambda: '[]\n'):
            with self.assertRaises(AssertionError):
                check()


if __name__ == '__main__':
    unittest.main()
