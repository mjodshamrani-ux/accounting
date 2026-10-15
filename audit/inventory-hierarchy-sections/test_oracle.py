import unittest,tempfile,subprocess,sys,copy
from pathlib import Path
import oracle
class SourceOracle(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.temp=tempfile.TemporaryDirectory();cls.root=Path(cls.temp.name)
  subprocess.run([sys.executable,str(Path(__file__).with_name('generate.py')),'--output-dir',str(cls.root)],check=True)
 @classmethod
 def tearDownClass(cls):cls.temp.cleanup()
 def test_all_financial_cases(self):
  cases=[oracle.inspect(p) for p in sorted(self.root.glob('INV1D-*'))]
  self.assertEqual(len(cases),18)
  for case in cases:oracle.verify(case)
 def test_header_ownership(self):
  for code in ['P01','P02','P03','P04','P05','P06']:
   folder=self.root/('INV1D-'+code);p=next(folder.glob('register.*'));rows,merges,stored=oracle.read(p)
   for fact in oracle.interpret(rows,merges,stored)[1]:
    self.assertIn('Item ID',rows[fact['headerRow']-1]);self.assertLess(fact['parentRow'],fact['batchRow']);self.assertLess(fact['batchRow'],fact['row']);self.assertLess(fact['row'],fact['batchEnd']);self.assertLessEqual(fact['batchEnd'],fact['parentEnd'])
 def test_changed_amount_is_not_approved_by_equal_total(self):
  value=oracle.inspect(self.root/'INV1D-N01');self.assertEqual(value['financial'],'difference');value['id']='INV1D-P01'
  with self.assertRaises(AssertionError):oracle.verify(value)
 def test_changed_parent_has_no_supported_money(self):
  value=oracle.inspect(self.root/'INV1D-N02');self.assertEqual(value['totals']['registerMinor'],0)
 def test_parent_change_cannot_keep_old_batch(self):
  self.assertEqual(oracle.inspect(self.root/'INV1D-N03')['financial'],'source-error')
 def test_explicit_zero_is_required(self):
  self.assertEqual(oracle.inspect(self.root/'INV1D-N06')['financial'],'source-error')
 def test_merged_money_and_vertical_header_are_not_dimensions(self):
  for code in ['N09','N10']:self.assertEqual(oracle.inspect(self.root/('INV1D-'+code))['financial'],'source-error')
if __name__=='__main__':unittest.main()
