"""Tests for the independent source/financial checker, not product acceptance."""
import copy,json,tempfile,unittest
from pathlib import Path
from generate import generate
from oracle import inspect,verify,verify_citations,pdf_read
class OracleTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory();cls.root=Path(cls.tmp.name);generate(cls.root)
 @classmethod
 def tearDownClass(cls):cls.tmp.cleanup()
 def case(self,code):return self.root/('INV1F-'+code)
 def test_all_sixteen_classifications(self):
  for f in sorted(self.root.glob('INV1F-*')):
   with self.subTest(id=f.name):
    r=inspect(f);verify(r)
    if r['financial']!='source-error':verify_citations(r,f)
 def test_four_ready_presentations_same_seven_facts_and_links(self):
  values=[]
  for code in ['P00','P01','P02','P03']:
   r=inspect(self.case(code));verify(r);values.append(sorted([f['values'] for f in r['facts']]))
   self.assertEqual(sum(l['supported'] for l in r['links']),7)
  for v in values[1:]:self.assertEqual(v,values[0])
 def test_layouts_are_not_numeric_variants(self):
  a,b,c=[pdf_read(self.case(code)/'register.pdf') for code in ['P01','P02','P03']]
  self.assertEqual([len(x) for x in [a,b,c]],[2,3,3])
  flatheaders=[[t['raw'] for t in line] for page in a for line in page if any(t['raw']=='Item ID' for t in line)]
  self.assertNotEqual(flatheaders[0],flatheaders[1])
  self.assertTrue(any(t['raw']=='Continues section' for page in c for row in page for t in row))
  self.assertFalse(any(t['raw']=='Continues section' for page in b for row in page for t in row))
 def test_global_total_does_not_hide_branch_swap(self):
  r=inspect(self.case('N04'));self.assertEqual(r['financial'],'difference');self.assertEqual(r['totals']['registerMinor'],1285750)
  self.assertEqual(sorted(c[-1] for c in r['comparisons']),[-220250,0,0,0,0,0,220250])
 def test_equal_value_reference_swap_is_not_supported(self):
  r=inspect(self.case('N05'));self.assertEqual(r['financial'],'missing');self.assertEqual(r['totals']['registerMinor'],1200750)
 def test_zero_and_missing_are_different(self):
  r=inspect(self.case('P03'));self.assertIn(['00','warehouse=NORTH;batch=LOT-X',0,'EA',0,0,'VAL-FZ'],[f['values'] for f in r['facts']])
  self.assertEqual(inspect(self.case('N06'))['reason'],'MISSING_FIELD')
 def test_missing_and_repeated_pages_block(self):
  for code in ['N01','N02']:self.assertEqual(inspect(self.case(code))['reason'],'PAGE_SEQUENCE')
 def test_continuation_is_not_inferred_from_preceding_page(self):self.assertEqual(inspect(self.case('N03'))['reason'],'CONTINUATION')
 def test_end_and_control_and_scope_and_precision(self):
  for code,reason in [('N07','UNCLASSIFIED_ROW'),('N08','REPORT_END'),('N09','PAGE_TOTAL'),('N10','SCOPE_CONFLICT'),('N12','PRECISION')]:
   with self.subTest(code=code):self.assertEqual(inspect(self.case(code))['reason'],reason)
 def test_quantity_unit_policy_remains_separate(self):
  r=inspect(self.case('N11'));self.assertEqual(r['financial'],'missing');self.assertEqual(r['totals']['registerMinor'],685750)
 def test_checker_rejects_changed_money_quantity_and_dimensions(self):
  for position,value in [(2,1251),(5,410124),(1,'warehouse=SOUTH;batch=LOT-X')]:
   r=inspect(self.case('P03'));r['facts'][0]['values'][position]=value
   with self.subTest(position=position),self.assertRaises(AssertionError):verify(r)
 def test_checker_rejects_foreign_same_text_parent(self):
  folder=self.case('P03');r=inspect(folder)
  self.assertEqual(r['facts'][0]['parent']['raw'],r['facts'][1]['parent']['raw'])
  r['facts'][1]['parent']=r['facts'][0]['parent']
  with self.assertRaisesRegex(AssertionError,'DIMENSION_OWNER'):verify_citations(r,folder)
 def test_checker_rejects_foreign_same_text_role(self):
  folder=self.case('P03');r=inspect(folder);r['facts'][1]['fields']['Posted value']['role']=r['facts'][0]['fields']['Posted value']['role']
  with self.assertRaisesRegex(AssertionError,'FIELD_OWNERSHIP'):verify_citations(r,folder)
 def test_checker_rejects_foreign_mapping_and_wrong_branch_even_when_totals_hold(self):
  for field,value in [('mapping','MAP-F-1'),('policy','POL-F-1'),('account',['INV-RAW','branch=20'])]:
   r=inspect(self.case('P03'));r['links'][0][field]=value
   with self.subTest(field=field),self.assertRaisesRegex(AssertionError,'LINK_MEMBERSHIP'):verify(r)
  r=inspect(self.case('N04'));r['comparisons'][0][0]='INV-PACK'
  with self.assertRaisesRegex(AssertionError,'BRANCH_COMPARISONS'):verify(r)
 def test_checker_rejects_foreign_section_and_continuation_boundary(self):
  folder=self.case('P03');r=inspect(folder);r['facts'][1]['sectionEnd']=r['facts'][2]['sectionEnd']
  with self.assertRaisesRegex(AssertionError,'SECTION_BOUNDARY'):verify_citations(r,folder)
  r=inspect(folder);r['facts'][1]['incomingContinuation']['prior']['value']['page']=2
  with self.assertRaisesRegex(AssertionError,'CONTINUATION_CITATION'):verify_citations(r,folder)
 def test_checker_rejects_foreign_source_hash(self):
  folder=self.case('P03');r=inspect(folder);r['sourceHash']='0'*64
  with self.assertRaisesRegex(AssertionError,'SOURCE_HASH'):verify_citations(r,folder)
 def test_reader_rejects_invalid_xref_even_if_text_is_visible(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'bad.pdf';raw=(self.case('P01')/'register.pdf').read_bytes()
   # Rewrite the first in-use offset in place, without changing PDF length.
   import re
   p.write_bytes(re.sub(rb'(xref\n0 \d+\n0000000000 65535 f \n)\d{10}',rb'\g<1>0000000000',raw,count=1))
   with self.assertRaisesRegex(AssertionError,'XREF_OFFSET'):pdf_read(p)
 def test_additive_scope_and_implicit_boundaries(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);generate(root,True)
   self.assertEqual(len(list(root.glob('INV1F-*'))),20)
   for code in ['P04','N13','N14','N15']:
    r=inspect(root/('INV1F-'+code));verify(r)
    if r['financial']!='source-error':verify_citations(r,root/r['id'])
   r=inspect(root/'INV1F-P04');self.assertEqual(r['totals']['registerMinor'],1285750)
   self.assertEqual(len(r['facts'][1]['scopeEvidence']),2)
   self.assertEqual(len(r['facts'][1]['documentScopeEvidence']),12)
 def test_v2_does_not_rewrite_any_v1_original(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);generate(root,True)
   for file in self.root.rglob('*'):
    if file.is_file() and file.name!='corpus.json':self.assertEqual(file.read_bytes(),(root/file.relative_to(self.root)).read_bytes())
 def test_v1_seal_remains_exact(self):
  import hashlib
  seal=json.loads((Path(__file__).parent/'INPUT-MANIFEST.json').read_text())
  self.assertEqual(len(seal['files']),65)
  for entry in seal['files']:
   data=(self.root/entry['path']).read_bytes();self.assertEqual(len(data),entry['bytes']);self.assertEqual(hashlib.sha256(data).hexdigest(),entry['sha256'])
 def test_v2_seal_remains_exact(self):
  import hashlib
  seal=json.loads((Path(__file__).parent/'INPUT-MANIFEST.v2.json').read_text());self.assertEqual(len(seal['files']),81)
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);generate(root,True)
   for entry in seal['files']:
    data=(root/entry['path']).read_bytes();self.assertEqual(len(data),entry['bytes']);self.assertEqual(hashlib.sha256(data).hexdigest(),entry['sha256'])
 def test_generator_is_byte_deterministic(self):
  with tempfile.TemporaryDirectory() as tmp:
   other=Path(tmp);generate(other)
   for p in self.root.rglob('*'):
    if p.is_file():self.assertEqual(p.read_bytes(),(other/p.relative_to(self.root)).read_bytes())
if __name__=='__main__':unittest.main()
