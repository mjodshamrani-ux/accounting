import copy
import json
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile
from check_record import check, png
from check_export import check as check_export
ROOT=Path(__file__).parent

def receipts(p):
    table=p['table']; image=table['image']
    for cell in image['regions']:
        cell['review']['fingerprint']=png.fingerprint(['tarasuf-visual-region-v1',image['revision'],cell['id'],cell['origin'],cell['role'],cell['observed'],cell['value'],cell['region']])
    table['revision']=png.fingerprint(['tarasuf-visual-table-v1',image,table['grid']])
    for row in table['rows']:
        if row['review']:row['review']['fingerprint']=png.fingerprint(['tarasuf-table-exclusion-v1',table['revision'],row['id'],row['disposition'],row['note'],row['cells']])
    table['coverage']['fingerprint']=png.fingerprint(['tarasuf-table-coverage-v1',table['revision'],table['rows']])
    p['review']['fingerprint']=png.fingerprint(['tarasuf-reviewed-visual-source-v1',table,p['headers'],p['currencyProof'],p['context']])

class ReviewedSourceOracle(unittest.TestCase):
    def setUp(self):
        self.record=json.loads((ROOT/'baseline/with-footer.json').read_text())
        self.png=(ROOT.parent/'visual-table/fixtures/statement.png').read_bytes()
    def test_previous_unproved_footer_export_is_detected(self):
        with self.assertRaises(AssertionError):check_export(ROOT/'baseline/direct.xlsx')
    def test_known_record_and_excel(self):
        self.assertEqual(check(self.record,self.png)['missingAmounts'],1)
        self.assertEqual(check_export(ROOT/'baseline/with-footer.xlsx')['matches'],1)
    def test_wrong_literals_context_headers_and_row_omission_fail_even_with_recomputed_public_hashes(self):
        edits=[lambda p:p['table']['image']['regions'][2].__setitem__('value','250.00'),
               lambda p:p['table']['image']['regions'][2].__setitem__('value','٩٬٩٩٩٫٠٠'),
               lambda p:p['table']['image']['regions'][10].__setitem__('value','KWD'),
               lambda p:p['context'].__setitem__('multiplier',-1),
               lambda p:p['context'].__setitem__('currency','USD'),
               lambda p:p['headers'].__setitem__(2,'region:8'),
               lambda p:p['table']['rows'].pop(1)]
        for edit in edits:
            with self.subTest(edit=edit):
                p=copy.deepcopy(self.record);edit(p);receipts(p)
                with self.assertRaises(AssertionError):check(p,self.png)
    def test_changed_workbook_membership_image_and_missing_error_are_detected(self):
        NS='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
        for fault in ['signed-amount','missing-error','omitted-image','record-chunk']:
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp)/'changed.xlsx'
                with ZipFile(ROOT/'baseline/with-footer.xlsx') as src,ZipFile(path,'w') as out:
                    wb=ET.fromstring(src.read('xl/workbook.xml'))
                    names=[e.get('name') for e in wb.find(NS+'sheets')]
                    target='xl/worksheets/sheet%d.xml'%(names.index('Matches' if fault=='signed-amount' else 'Reading Issues' if fault=='missing-error' else 'Visual Source Record')+1)
                    for name in src.namelist():
                        if fault=='omitted-image' and name.startswith('xl/media/') and not name.endswith('/'):continue
                        data=src.read(name)
                        if name==target and fault!='omitted-image':
                            root=ET.fromstring(data)
                            if fault=='signed-amount':root.find('.//'+NS+'c[@r="E2"]/'+NS+'v').text='250'
                            elif fault=='missing-error':root.find(NS+'sheetData').remove(root.find('.//'+NS+'row[@r="2"]'))
                            else:root.find('.//'+NS+'c[@r="C2"]/'+NS+'v').text='0'
                            data=ET.tostring(root)
                        out.writestr(name,data)
                with self.assertRaises((AssertionError,KeyError,ValueError)):check_export(path)
if __name__=='__main__':unittest.main()
