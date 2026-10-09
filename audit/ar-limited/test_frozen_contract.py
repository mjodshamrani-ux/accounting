"""Check the independently authored source contract; does not test an AR engine."""
import csv
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).parent / 'frozen'

class FrozenContractTests(unittest.TestCase):
    def test_frozen_sources_and_truth(self):
        truth = json.loads((ROOT / 'expected.json').read_text())
        self.assertEqual(truth['sample'], 'synthetic-development-not-field')
        self.assertEqual(len(truth['cases']), 5)
        for case in truth['cases']:
            sources = []
            for file in case['files']:
                raw = (ROOT / file['file']).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), file['sha256'])
                rows = list(csv.DictReader(io.StringIO(raw.decode())))
                self.assertEqual(len(rows), file['sourceRows'])
                self.assertEqual([int(Decimal(r['Original signed amount']) * 100) for r in rows], file['amountsMinor'])
                sources.append(rows)
            left, right = sources
            keys = lambda r: (r['Document type'], r['Own document number'], r['Posting date'], Decimal(r['Original signed amount']))
            unique_pairs = [[i + 2, j + 2] for i, a in enumerate(left) for j, b in enumerate(right)
                            if keys(a) == keys(b)
                            and sum((x['Document type'], x['Own document number']) == (a['Document type'], a['Own document number']) for x in left) == 1
                            and sum((x['Document type'], x['Own document number']) == (b['Document type'], b['Own document number']) for x in right) == 1]
            self.assertEqual(unique_pairs, case['requiredPairs'])
            self.assertEqual(len(unique_pairs), case['automaticPairCount'])

    def test_allocation_reference_is_not_own_document(self):
        rows = list(csv.DictReader(io.StringIO((ROOT / 'receipt-is-not-invoice-allocation-statement.csv').read_text())))
        self.assertEqual(rows[0]['Related invoice'], 'I003')
        self.assertEqual(rows[0]['Own document number'], 'RC003')
        self.assertEqual(rows[0]['Document type'], 'receipt')

if __name__ == '__main__':
    unittest.main()
