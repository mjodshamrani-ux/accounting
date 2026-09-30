import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile
from check_export import check, Book
ROOT=Path(__file__).resolve().parents[3]
CANDIDATE=ROOT/'work/unknown-role'
if not CANDIDATE.exists():CANDIDATE=Path(__file__).resolve().parent/'candidate-0418'
FILE=CANDIDATE/'different-untyped-credit-xlsx-direct.xlsx'
XML='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
class UnknownCreditOracle(unittest.TestCase):
    def test_native_and_restored_exports(self):
        self.assertTrue(FILE.exists(),'run unknown-role runner first')
        for f in sorted(CANDIDATE.glob('*.xlsx')):self.assertTrue(check(f)['verified'])
    def test_native_role_and_financial_tampering(self):
        probes=[('Retained Evidence',''),('Retained Evidence','unverifiedCreditNoteNumber (Credit Note No): CN-999'),('Document Type','Credit Note'),('Document Number Role','document-number'),('Status','Matched'),('Amount','-50.01'),('Source Row','3'),('Evidence','')]
        for field,wrong in probes:
            with self.subTest(field=field),tempfile.TemporaryDirectory() as temp:
                b=Book(FILE);rows,_=b.rows('Match Evidence',{field});address=rows[0][field][1]
                parts={n:b.archive.read(n) for n in b.names};part=b.sheets['Match Evidence'];b.close()
                xml=ET.fromstring(parts[part]);cell=next(c for c in xml.iter(XML+'c') if c.get('r')==address)
                for child in list(cell):cell.remove(child)
                cell.set('t','inlineStr');ET.SubElement(ET.SubElement(cell,XML+'is'),XML+'t').text=wrong
                parts[part]=ET.tostring(xml);out=Path(temp)/'tampered.xlsx'
                with ZipFile(out,'w') as z:
                    for n,v in parts.items():z.writestr(n,v)
                with self.assertRaises(AssertionError):check(out)
if __name__=='__main__':unittest.main()
