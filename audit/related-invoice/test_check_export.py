import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile
from check_export import check, Book
ROOT=Path(__file__).resolve().parent.parent.parent
CANDIDATE=ROOT/'work/f03-native'
if not CANDIDATE.exists(): CANDIDATE=Path(__file__).resolve().parent/'candidate-0417'
FILE=CANDIDATE/'own-credit-note-direct.xlsx'
XML='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
class RelatedInvoiceOracle(unittest.TestCase):
    def test_all_native_and_restored_sources(self):
        self.assertTrue(FILE.exists(),'run F03 native runner before oracle')
        for p in sorted(CANDIDATE.glob('*.xlsx')):self.assertTrue(check(p)['verified'])
    def test_role_source_amount_and_membership_tampering(self):
        probes=[('Match Evidence','Related Invoice Reference','INV-999'),('Match Evidence','Related Invoice Header','Document No'),('Match Evidence','Related Invoice Column','2'),('Match Evidence','Document Number Header','Invoice No'),('Match Evidence','Primary Reference','INV-401'),('Match Evidence','Amount','-50.01'),('Parsed Supplier Source','عمود 2','CN-999'),('Matches','Supplier Source 1','supplier · Statement · row 3')]
        for sheet,field,wrong in probes:
            with self.subTest(field=field),tempfile.TemporaryDirectory() as temp:
                b=Book(FILE);rows,_=b.rows(sheet,{field});index=1 if sheet=='Parsed Supplier Source' else 0
                address=rows[index][field][1];parts={n:b.archive.read(n) for n in b.names}
                xml=ET.fromstring(parts[b.sheets[sheet]])
                cell=next(c for c in xml.iter(XML+'c') if c.get('r')==address)
                for child in list(cell):cell.remove(child)
                cell.set('t','inlineStr');ET.SubElement(ET.SubElement(cell,XML+'is'),XML+'t').text=wrong
                parts[b.sheets[sheet]]=ET.tostring(xml);b.close()
                out=Path(temp)/'tampered.xlsx'
                with ZipFile(out,'w') as z:
                    for n,v in parts.items():z.writestr(n,v)
                with self.assertRaises(AssertionError):check(out)
if __name__=='__main__':unittest.main()
