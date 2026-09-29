import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import xml.etree.ElementTree as ET

from check_export import check, Book

XML = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
SOURCE = Path('work/layered-headers/f02-workpaper.xlsx')

class ExportOracleTests(unittest.TestCase):
    def test_positive(self):
        self.assertTrue(check(SOURCE)['verified'])

    def test_reject_changed_evidence_and_financial_members(self):
        cases = [('XLSX Header Provenance','J3','A3:B4'),
                 ('XLSX Header Provenance','B3','0' * 64),
                 ('XLSX Header Provenance','F3','1'),
                 ('XLSX Header Provenance','O3','AI_APPROVAL'),
                 ('Supplier transactions','H2','781'),
                 ('Matches','R2','supplier · Statement · row 6'),
                 ('Parsed Supplier Source','A7','7')]
        for sheet, address, changed in cases:
            with self.subTest(sheet=sheet, address=address), tempfile.TemporaryDirectory() as tmp:
                book = Book(SOURCE)
                part = book.sheets[sheet]
                book.close()
                target = Path(tmp) / 'changed.xlsx'
                with ZipFile(SOURCE) as source, ZipFile(target,'w',ZIP_DEFLATED) as output:
                    for item in source.infolist():
                        data = source.read(item.filename)
                        if item.filename == part:
                            root = ET.fromstring(data)
                            cell = next(c for c in root.iter(XML+'c') if c.get('r') == address)
                            cell.clear(); cell.set('r',address); cell.set('t','inlineStr')
                            ET.SubElement(ET.SubElement(cell,XML+'is'),XML+'t').text = changed
                            data = ET.tostring(root,encoding='utf-8')
                        output.writestr(item,data)
                with self.assertRaises(AssertionError):
                    check(target)

if __name__ == '__main__':
    unittest.main()
