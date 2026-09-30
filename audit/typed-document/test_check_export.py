import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
from check_export import check, Book

ROOT=Path(__file__).resolve().parent.parent.parent
XML='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
FILES=[ROOT/'work/qa'/('typed-'+i+'-'+suffix+'.xlsx') for i in ['0','1'] for suffix in ['direct','restored']]
if not all(p.exists() for p in FILES):
    FILES=[ROOT/'work/typed-documents'/(kind+'-'+suffix+'.xlsx') for kind in ['proven','conflict'] for suffix in ['direct','restored']]


class TypedExportOracle(unittest.TestCase):
    def test_all_native_and_restored_workbooks(self):
        self.assertTrue(all(p.exists() for p in FILES),'run native/browser export before the oracle')
        for p in FILES:
            self.assertTrue(check(p)['verified'])

    def test_deliberate_financial_and_source_tampering_is_rejected(self):
        probes=[
            ('Matches','Supplier Amount',1,'-51'),
            ('Matches','Supplier Source 1',1,'supplier · Statement · row 8'),
            ('Matches','Rule',1,'AI_APPROVED'),
            ('Matches','Date Gap',1,'1'),
            ('Parsed Supplier Source','عمود 6',8,'Payment'),
            ('Parsed Supplier Source','عمود 2',6,'INV-934'),
            ('Parsed Supplier Source','عمود 8',7,'BANK-OTHER'),
            ('Match Evidence','Document Number Role',2,'invoice-number'),
        ]
        for sheet,field,index,wrong in probes:
            with self.subTest(sheet=sheet,field=field,index=index),tempfile.TemporaryDirectory() as tmp:
                b=Book(FILES[0])
                rows,_=b.rows(sheet,{field})
                address=rows[index][field][1]
                parts={n:b.archive.read(n) for n in b.names}
                xml=ET.fromstring(parts[b.sheets[sheet]])
                cell=next(c for c in xml.iter(XML+'c') if c.get('r')==address)
                for child in list(cell): cell.remove(child)
                cell.set('t','inlineStr')
                ET.SubElement(ET.SubElement(cell,XML+'is'),XML+'t').text=wrong
                parts[b.sheets[sheet]]=ET.tostring(xml)
                b.close()
                dest=Path(tmp)/'tampered.xlsx'
                with ZipFile(dest,'w') as z:
                    for n,v in parts.items():z.writestr(n,v)
                with self.assertRaises(AssertionError):check(dest)


if __name__=='__main__':unittest.main()
