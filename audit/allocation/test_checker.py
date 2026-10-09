import copy,json,unittest,zipfile,tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch
import check_export as checker
original_sheets=checker.sheets
class AllocationOracleTests(unittest.TestCase):
    def test_all_original_and_restored_frozen_contracts(self):
        truth=json.loads((Path(__file__).parent/'frozen/expected.json').read_text())
        for c in truth['cases']:
            for suffix in ['direct','restored']:self.assertTrue(checker.verify(f"work/allocation/{c['name']}-{suffix}.xlsx",c['name'])['passed'])
    def reject(self,change,contract='one-to-many'):
        book=copy.deepcopy(checker.sheets(f'work/allocation/{contract}-direct.xlsx'));change(book)
        with patch.object(checker,'sheets',return_value=book):
            with self.assertRaises((AssertionError,KeyError,ValueError,TypeError)):checker.verify('tampered.xlsx',contract)
    def test_changed_capacity_remaining_or_allocated_rejected(self):
        for col in [5,6,7,8]:self.reject(lambda b:b['Value ledger'][1].__setitem__(col,'99999'))
    def test_lost_link_wrong_member_or_proof_rejected(self):
        self.reject(lambda b:b['Active links'].pop())
        self.reject(lambda b:b['Decision links'][1].__setitem__(2,b['Decision links'][2][3]))
        self.reject(lambda b:b['Decision links'][1].__setitem__(8,'fake'))
        self.reject(lambda b:b['Remittance evidence'][1].__setitem__(5,'1'))
    def test_decision_context_timestamp_reason_history_rejected(self):
        self.reject(lambda b:b['Events'][1].__setitem__(3,'STALE'))
        self.reject(lambda b:b['Events'][1].__setitem__(2,'2026-02-30T00:00:00.000Z'))
        self.reject(lambda b:b['Decision links'][1].__setitem__(7,''))
        self.reject(lambda b:b['Events'].pop(),'undo')
        self.reject(lambda b:b['Events'][2].__setitem__(5,'unknown'),'undo')
    def test_source_bytes_reading_scope_inventory_trace_rejected(self):
        self.reject(lambda b:b['Sources'][1].__setitem__(6,'ZmFrZQ=='))
        self.reject(lambda b:next(r for r in b['Reading'][1:] if r[1]=='role').__setitem__(2,'supplier'))
        self.reject(lambda b:next(r for r in b['Summary'][1:] if r[0]=='party').__setitem__(1,'Other'))
        self.reject(lambda b:b['Inventory'].pop())
        self.reject(lambda b:b['Cell evidence'][1].__setitem__(6,'1'))
    def test_real_workbook_invisible_human_evidence_rejected(self):
        source=Path('work/allocation/two-choices-direct.xlsx')
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'tampered.xlsx'
            with zipfile.ZipFile(source) as original, zipfile.ZipFile(target,'w') as output:
                for name in original.namelist():
                    raw=original.read(name)
                    if name=='xl/sharedStrings.xml':
                        root=ET.fromstring(raw);changed=0
                        for node in root.findall('s:si',checker.NS):
                            if ''.join(node.itertext())=='Synthetic accountant instruction for this payment only':
                                node.clear();ET.SubElement(node,'{'+checker.NS['s']+'}t').text='\u200b';changed+=1
                        self.assertEqual(changed,1);raw=ET.tostring(root,encoding='utf-8',xml_declaration=True)
                    output.writestr(name,raw)
            with self.assertRaises(AssertionError):checker.verify(target,'two-choices')
    def test_non_visible_trimmed_or_excessive_evidence_and_note_rejected(self):
        for text in ['\u200b',' reason ','reason\nline','x'*2001,'\U0001F600'*1001]:
            self.reject(lambda b:b['Decision links'][1].__setitem__(7,text))
            self.reject(lambda b:b['Events'][1].__setitem__(4,text))
        self.reject(lambda b:b['Decision links'][1].__setitem__(6,'\u200b'))
        self.reject(lambda b:b['Events'][1].__setitem__(0,'=D1'))
    def test_native_original_and_restored(self):
        sources=[f'work/allocation/native-source-{i}.xlsx' for i in range(3)]
        for suffix in ['direct','restored']:self.assertTrue(checker.verify(f'work/allocation/native-{suffix}.xlsx',native_sources=sources)['passed'])
    def test_native_tampered_money_rejected(self):
        book=checker.sheets('work/allocation/native-direct.xlsx');book['Value ledger'][1][6]='99999'
        with patch.object(checker,'sheets',side_effect=lambda p:book if p=='tampered.xlsx' else original_sheets(p)):
            with self.assertRaises(AssertionError):checker.verify('tampered.xlsx',native_sources=[f'work/allocation/native-source-{i}.xlsx' for i in range(3)])
if __name__=='__main__':unittest.main()
