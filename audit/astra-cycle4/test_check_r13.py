import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from check_r13 import check, Book

XML = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
SOURCE = Path('work/layered-headers/r13-fixed-workpaper.xlsx')
EXPECTED_ENGINE = '0.3.24-experimental'

class R13OracleTests(unittest.TestCase):
    def test_exact_failure_replay(self):
        self.assertTrue(check(SOURCE, EXPECTED_ENGINE)['verified'])

    def test_financial_membership_or_source_tampering_is_rejected(self):
        for sheet, address, changed in [
            ('Supplier transactions','H2','781'),
            ('Excluded Rows','D8','[]'),
            ('Parsed Supplier Source','C12','INV-FORGED'),
            ('Export Metadata','B3','0' * 64),
            ('Export Metadata','B2','0.3.22-experimental'),
            ('Matches','A2','Invented approval'),
        ]:
            with self.subTest(sheet=sheet, address=address), tempfile.TemporaryDirectory() as tmp:
                book = Book(SOURCE)
                part = book.sheets[sheet]
                book.close()
                target = Path(tmp) / 'changed.xlsx'
                with ZipFile(SOURCE) as source, ZipFile(target, 'w', ZIP_DEFLATED) as output:
                    for item in source.infolist():
                        data = source.read(item.filename)
                        if item.filename == part:
                            root = ET.fromstring(data)
                            cell = next((c for c in root.iter(XML+'c') if c.get('r') == address), None)
                            if cell is None:
                                row = ET.SubElement(root.find(XML+'sheetData'), XML+'row', {'r': '2'})
                                cell = ET.SubElement(row, XML+'c')
                            cell.clear(); cell.set('r', address); cell.set('t', 'inlineStr')
                            ET.SubElement(ET.SubElement(cell, XML+'is'), XML+'t').text = changed
                            data = ET.tostring(root, encoding='utf-8')
                        output.writestr(item, data)
                with self.assertRaises(AssertionError):
                    check(target, EXPECTED_ENGINE)

if __name__ == '__main__':
    unittest.main()
