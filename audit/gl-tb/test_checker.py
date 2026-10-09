import copy,json,unittest
from pathlib import Path
from unittest.mock import patch
import check_export as checker
checker_original=checker.sheets
class BalanceOracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.book=checker.sheets('work/gl-tb/positive-direct.xlsx')
    def reject(self,change,contract='positive'):
        b=copy.deepcopy(self.book);change(b)
        with patch.object(checker,'sheets',return_value=b):
            with self.assertRaises((AssertionError,KeyError,ValueError,TypeError)):
                checker.verify('tampered.xlsx',contract)
    def test_original_and_restored_sixteen_contracts(self):
        truth=json.loads((Path(__file__).parent/'frozen/expected.json').read_text())
        for c in truth['cases']:
            for suffix in ['direct','restored']:self.assertTrue(checker.verify('work/gl-tb/'+c['name']+'-'+suffix+'.xlsx',c['name'])['passed'])
    def test_same_net_changed_turnover_rejected(self):
        def change(b):b['Balances'][3][1]='35000';b['Balances'][4][1]='15000'
        self.reject(change)
    def test_numeric_date_native_xlsx_equivalent_source_and_replay_pass(self):
        sources=['work/gl-tb/native-source-gl.xlsx','work/gl-tb/native-source-tb.xlsx']
        for suffix in ['direct','restored']:self.assertTrue(checker.verify('work/gl-tb/native-'+suffix+'.xlsx',native_sources=sources)['passed'])
    def test_numeric_native_source_tampered_export_rejected(self):
        book=checker.sheets('work/gl-tb/native-direct.xlsx');book['Balances'][3][1]='30001'
        with patch.object(checker,'sheets',side_effect=lambda path:book if path=='tampered.xlsx' else checker_original(path)):
            with self.assertRaises(AssertionError):
                checker.verify('tampered.xlsx',native_sources=['work/gl-tb/native-source-gl.xlsx','work/gl-tb/native-source-tb.xlsx'])
    def test_changed_scope_or_reading_rejected(self):
        self.reject(lambda b:next(r for r in b['Summary'][1:] if r[0]=='dimensions').__setitem__(1,'OTHER'))
        self.reject(lambda b:next(r for r in b['Reading'][1:] if r[1]=='role').__setitem__(2,'supplier'))
    def test_lost_zero_activity_balance_rejected(self):
        self.reject(lambda b:b['Records'].pop(1))
    def test_cell_membership_or_original_amount_rejected(self):
        self.reject(lambda b:b['Cell evidence'][1].__setitem__(6,'100001'))
        self.reject(lambda b:b['Component members'].pop(1))
    def test_lost_original_inventory_or_bytes_rejected(self):
        self.reject(lambda b:b['GL inventory'].pop())
        self.reject(lambda b:b['Sources'][1].__setitem__(6,'ZmFrZQ=='))
    def test_forged_bridge_or_result_rejected(self):
        self.reject(lambda b:next(r for r in b['Summary'][1:] if r[0]=='GL bridge minor units').__setitem__(1,'1'))
        self.reject(lambda b:next(r for r in b['Summary'][1:] if r[0]=='Status').__setitem__(1,'difference'))
if __name__=='__main__':unittest.main()
