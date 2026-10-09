import json
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile
from check_export import check, check_answers, Book
ROOT = Path(__file__).resolve().parents[2]
CANDIDATE = ROOT / 'work/p5-native'
# CI runs the synthetic native exporter before this oracle. Historical raw
# output directories are intentionally outside the public dependency boundary.
FILE = CANDIDATE / 'untyped-credit-direct.xlsx'
XML = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

class AssistantEvidenceOracle(unittest.TestCase):
    def test_native_and_restored_exports_and_answers(self):
        files = sorted(CANDIDATE.glob('*.xlsx'))
        self.assertEqual(len(files), 8, 'run P5 native runner first')
        for f in files: self.assertTrue(check(f)['verified'])
        self.assertEqual(check_answers(CANDIDATE / 'observations.json')['answersVerified'], 4)

    def test_oracle_rejects_source_money_and_answer_tampering(self):
        probes = [('Retained Evidence', ''), ('Retained Evidence', 'unverifiedCreditNoteNumber (Credit Note No): CN-999'), ('Document Type', 'Credit Note'), ('Status', 'Matched'), ('Amount', '-50.01'), ('Source Row', '3')]
        for field, wrong in probes:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temp:
                b = Book(FILE); rows, _ = b.rows('Match Evidence', {field}); address = rows[0][field][1]
                parts = {n: b.archive.read(n) for n in b.names}; part = b.sheets['Match Evidence']; b.close()
                xml = ET.fromstring(parts[part]); cell = next(c for c in xml.iter(XML + 'c') if c.get('r') == address)
                for child in list(cell): cell.remove(child)
                cell.set('t', 'inlineStr'); ET.SubElement(ET.SubElement(cell, XML + 'is'), XML + 't').text = wrong
                parts[part] = ET.tostring(xml); out = Path(temp) / 'tampered.xlsx'
                with ZipFile(out, 'w') as z:
                    for n, v in parts.items(): z.writestr(n, v)
                with self.assertRaises(AssertionError): check(out)
        for alter in [lambda r: r['observations'][0]['answer'].update(sourceIds=[]), lambda r: r['observations'][2]['probes'][0]['answer'].update(kind='transaction')]:
            with tempfile.TemporaryDirectory() as temp:
                r = json.loads((CANDIDATE / 'observations.json').read_text()); alter(r)
                out = Path(temp) / 'answers.json'; out.write_text(json.dumps(r))
                with self.assertRaises(AssertionError): check_answers(out)

if __name__ == '__main__': unittest.main()
