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
    t=p['table'];im=t['image']
    for r in im['regions']:r['review']['fingerprint']=png.fingerprint(['tarasuf-visual-region-v1',im['revision'],r['id'],r['origin'],r['role'],r['observed'],r['value'],r['region']])
    t['revision']=png.fingerprint(['tarasuf-visual-table-v2',im,t['grid']])
    for r in t['rows']:
        if r['review']:r['review']['fingerprint']=png.fingerprint(['tarasuf-table-exclusion-v2',t['revision'],r['id'],r['disposition'],r['note'],r['cells']])
    t['coverage']['fingerprint']=png.fingerprint(['tarasuf-table-coverage-v2',t['revision'],t['rows']])
    p['review']['fingerprint']=png.fingerprint(['tarasuf-reviewed-visual-source-v2',t,p['headers'],p['currencyProof'],p['context']])
class SplitOracle(unittest.TestCase):
    def test_both_known_languages_and_exported_originals(self):
        for lang in ['en','ar']:
            with self.subTest(lang=lang):
                p=json.loads((ROOT/f'baseline/{lang}.json').read_text());original=(ROOT/f'fixtures/{lang}.png').read_bytes()
                self.assertEqual(check(p,original)['manualCrops'],39)
                self.assertEqual(check_export(ROOT/f'baseline/{lang}-direct.xlsx')['matchedMembers'],6)
    def test_wrong_literals_headers_context_and_missing_rows_fail_despite_recomputed_public_receipts(self):
        edits=[lambda p:p['table']['image']['regions'][8].__setitem__('value','0.00'),
               lambda p:p['table']['image']['regions'][14].__setitem__('value','-250.00'),
               lambda p:p['headers'].__setitem__(2,p['headers'][3]),
               lambda p:p['context'].__setitem__('multiplier',-1),
               lambda p:p['table']['grid']['roles'].__setitem__(2,'credit'),
               lambda p:p['table']['rows'].pop(5),
               lambda p:p.__setitem__('version',1)]
        for edit in edits:
            with self.subTest(edit=edit):
                p=json.loads((ROOT/'baseline/en.json').read_text());edit(p);receipts(p)
                with self.assertRaises(AssertionError):check(p,(ROOT/'fixtures/en.png').read_bytes())
    def test_fictional_zero_in_printed_blank_is_not_source_truth(self):
        p=json.loads((ROOT/'baseline/en.json').read_text())
        # A reviewer can type a wrong value. Public hashes cannot make that
        # value true; the independent frozen pixel contract must catch it.
        r=copy.deepcopy(p['table']['image']['regions'][0]);r.update(id='region:40',role='amount',value='0.00',region={'x0':878,'x1':1082,'y0':628,'y1':692},observed=[])
        p['table']['image']['regions'].append(r);p['table']['rows'][5]['cells'][3]='region:40';receipts(p)
        with self.assertRaises(AssertionError):check(p,(ROOT/'fixtures/en.png').read_bytes())
    def test_changed_workbook_sign_missing_error_and_missing_image_are_detected(self):
        NS='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
        for fault in ['signed-amount','missing-error','missing-image']:
            with self.subTest(fault=fault),tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp)/'bad.xlsx'
                with ZipFile(ROOT/'baseline/en-direct.xlsx') as src,ZipFile(path,'w') as out:
                    wb=ET.fromstring(src.read('xl/workbook.xml'));names=[e.get('name') for e in wb.find(NS+'sheets')]
                    target='xl/worksheets/sheet%d.xml'%(names.index('Matches' if fault=='signed-amount' else 'Reading Issues')+1)
                    for name in src.namelist():
                        if fault=='missing-image' and name.startswith('xl/media/') and not name.endswith('/'):continue
                        data=src.read(name)
                        if name==target and fault!='missing-image':
                            root=ET.fromstring(data)
                            if fault=='signed-amount':root.find('.//'+NS+'c[@r="E3"]/'+NS+'v').text='250'
                            else:root.find(NS+'sheetData').remove(root.find('.//'+NS+'row[@r="4"]'))
                            data=ET.tostring(root)
                        out.writestr(name,data)
                with self.assertRaises((AssertionError,KeyError,ValueError)):check_export(path)
if __name__=='__main__':unittest.main()
