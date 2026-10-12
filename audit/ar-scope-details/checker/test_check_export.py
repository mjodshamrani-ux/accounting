"""Checker falsification controls, authored without product code/builders.

These synthetic in-memory tables are checker controls, NOT product acceptance.
"""
import base64,copy,importlib.util,io,json,re,tempfile,unittest,zipfile
from pathlib import Path
from xml.sax.saxutils import escape
import check_export as c

def specimen(name='three-document-kinds'):
 bundle_path=c.DEFAULT_PREP/'fixtures'/name/'bundle.json'
 bundle,oracle=c.oracle_for(c.DEFAULT_PREP,bundle_path)
 bundle['_directory']=bundle_path.parent
 originals=[(bundle_path.parent/f).read_bytes() for f in bundle['files']]
 session={'format':'tarasuf-ar-session','version':'ar-scope-details-1','files':[],'readings':[],'scope':bundle['scope'],'events':[]}
 for side,source in enumerate(oracle['sources']):
  source['sheetIndex']=0
  session['files'].append({'name':bundle['files'][side],'sha256':c.sha(originals[side]),'data':base64.b64encode(originals[side]).decode()})
  cols=next(r['rawCells'] for r in source['inventory'] if r['classification']=='detail-columns')
  reading={'family':bundle['families'][side],'sheet':0,'header':source['scopeHeader']['detailHeaderRow']-1}
  for key,col in [('parent','Parent scope ID'),('posting','Posting ID'),('kind','Document type'),('document','Own document number'),('date','Posting date'),('amount','Original signed amount'),('related','Related invoice'),('open','Open balance'),('description','Description')]:reading[key]=cols.index(col) if col in cols else -1
  reading.update(role=c.ROLES[side],perspective='seller-receivable',basis='original-movement',confirmed=True);session['readings'].append(reading)
 book={k:[c.HEADERS[k]+c.APPENDED.get(k,[])] for k in c.HEADERS}
 summary={'Domain':'customer-ar-document-comparison','Version':'ar-scope-details-1','Perspective':'seller-receivable','Amount basis':'original-movement',**{k:c.scalar(v) for k,v in bundle['scope'].items()},'Valid movements':str(sum(len(s['records']) for s in oracle['sources'])),'Matched document pairs':str(len(oracle['pairs'])),'Ledger total minor units':c.scalar(oracle['totalsMinor'][0]),'Statement total minor units':c.scalar(oracle['totalsMinor'][1]),'Receipt allocations':'[]','Financial completeness asserted':'false','Ledger total available':c.scalar(oracle['totalsMinor'][0] is not None),'Statement total available':c.scalar(oracle['totalsMinor'][1] is not None)}
 book['Summary']=[c.HEADERS['Summary']]+[[k,v] for k,v in summary.items()]
 for side,source in enumerate(oracle['sources']):
  width=max(len(r['rawCells']) for r in source['inventory']);head=['Source row','Kind','Error']+[f'Original column {i+1}' for i in range(width)]+c.INV_EXTRA
  rows=[]
  for r in source['inventory']:
   kind='error' if r['errors'] else 'movement' if r['classification']=='movement' else 'blank' if r['classification']=='blank' else 'header'
   klass='detail-header' if r['classification']=='detail-columns' else r['classification']
   rows.append([str(r['physicalRow']),kind,'',*(r['rawCells']+['']*(width-len(r['rawCells']))),c.inventory_id(side,source,r['physicalRow']),klass,c.canonical(r['errors']),c.canonical(r['lineSpan']) if 'lineSpan' in r else ''])
  book[c.SHEETS[4+side]]=[head]+rows
  book['Sources'].append([str(side),c.ROLES[side],bundle['files'][side],source['sha256'],source['sheet'],'1',session['files'][side]['data']])
  for k,v in session['readings'][side].items():book['Reading'].append([str(side),k,c.scalar(v)])
 book['Summary'] += [['Source issues JSON','[]'],['Error inventory refs JSON','[]'],['Source scopes JSON',c.canonical(c.scopes_for(oracle['sources']))]]
 sv={r[0]:r[1] for r in book['Summary'][1:]};sv.update({'Decimals':str(c.PRECISION[bundle['scope']['currency']]),'Reading errors':'0','Economic coverage':c.COVERAGE});book['Summary']=[c.HEADERS['Summary']]+[[k,sv[k]] for k in c.SUMMARY_KEYS+c.SUMMARY_EXTRA]
 records={c.id_for(side,s,r['physicalRow']):(side,s,r) for side,s in enumerate(oracle['sources']) for r in s['records']}
 def converted(mid):return c.id_for(0 if mid.startswith('left:') else 1,oracle['sources'][0 if mid.startswith('left:') else 1],int(mid.rsplit(':',1)[1]))
 groups=[([converted(p['leftMember']),converted(p['rightMember'])],'matched','own-document','exact-own-document') for p in oracle['pairs']]
 groups += [([converted(m) for m in ca['leftMembers']+ca['rightMembers']],'review','none',ca['reason']) for ca in oracle['cases']]
 for index,(mids,status,basis,reason) in enumerate(groups):
  cid='case-'+str(index);r=records[mids[0]][2] if mids else None
  book['Cases'].append([cid,r['documentType'] if r else '',r['ownDocumentNumber'] if r else '',status,basis,reason,str(len(mids)),'','[]'])
  for mid in mids:
   side,s,r=records[mid];inv=next(i for i in s['inventory'] if i['physicalRow']==r['physicalRow'])
   book['Movements'].append([mid,str(side),str(r['physicalRow']),r['postingId'],r['documentType'],r['ownDocumentNumber'],r['postingDate'],str(r['amountMinor']),r['relatedInvoice'],r['descriptionRaw'],cid,status,basis,c.canonical([r['relatedInvoice']] if r['relatedInvoice'] else []),s['family'],r['originalRaw'],c.scalar(r['openBalanceRaw']),'descriptive-unverified',r['parentScopeId'],c.canonical(c.parent_cell(r)),c.canonical(c.inherited_cells(s,r)),c.canonical(inv['lineSpan']) if 'lineSpan' in inv else ''])
   book['Membership'].append([cid,mid,str(side),str(r['physicalRow'])])
 return {k:book[k] for k in c.SHEETS},bundle,oracle,session,originals

def add_reopen(book,session):
 ids=[r[1] for r in book['Membership'][1:] if r[0]=='case-0'];keys=['family','sheet','header','parent','posting','kind','document','date','amount','related','open','description','role','perspective','basis','confirmed']
 context=c.canonical([session['version'],[f['sha256'] for f in session['files']],[[r.get(k) for k in keys] for r in session['readings']],[session['scope'][k] for k in ['entity','ledger','customer','account','currency','start','end','confirmed']]])
 event={'context':context,'action':'reopen','ids':ids,'note':'Independent reopen control','at':'2026-10-11T12:00:00.000Z'};session['events'].append(event)
 book['Decisions'].append(['1',context,'reopen',c.canonical(ids),event['note'],event['at']])
 book['Cases'][1][3:8]=['review','none','reopened','2',event['note']]
 for row in book['Movements'][1:]:
  if row[10]=='case-0':row[11:13]=['review','none']
 for row in book['Summary'][1:]:
  if row[0]=='Matched document pairs':row[1]=str(int(row[1])-1)

def write_raw_book(book,path):
 namespace=c.NS['m'];workbook=f'<workbook xmlns="{namespace}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
 rel='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
 with zipfile.ZipFile(path,'w') as z:
  for index,(name,rows) in enumerate(book.items(),1):
   workbook+=f'<sheet name="{name}" sheetId="{index}" r:id="r{index}"/>';rel+=f'<Relationship Id="r{index}" Target="worksheets/sheet{index}.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>'
   data=f'<worksheet xmlns="{namespace}"><sheetData>'
   for rn,row in enumerate(rows,1):
    data+=f'<row r="{rn}">'
    for ci,value in enumerate(row,1):
     n=ci;letters=''
     while n:n,rem=divmod(n-1,26);letters=chr(65+rem)+letters
     data+=f'<c r="{letters}{rn}" t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>'
    data+='</row>'
   z.writestr(f'xl/worksheets/sheet{index}.xml',data+'</sheetData></worksheet>')
  z.writestr('xl/workbook.xml',workbook+'</sheets></workbook>');z.writestr('xl/_rels/workbook.xml.rels',rel+'</Relationships>')

class Controls(unittest.TestCase):
 def run_claim(self,parts):
  book,bundle,oracle,session,originals=parts;c.verify_session(session,bundle,oracle,originals);return c.verify_book(book,bundle,oracle,session,originals)
 def test_originals(self):
  for name in ['three-document-kinds','one-invoice-open-differs','two-receipts-no-allocation','blanks-and-multiline-description']:
   with self.subTest(name=name):self.assertTrue(self.run_claim(specimen(name))['passed'])
 def test_native_raw_ooxml(self):
  parts=specimen()
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'own-checker-control.xlsx';write_raw_book(parts[0],p);self.assertEqual(c.read_workbook(p),parts[0]);parts=list(parts);parts[0]=c.read_workbook(p);self.assertTrue(self.run_claim(parts)['passed'])
 def test_native_original_lexeme_and_concealment(self):
  spec=importlib.util.spec_from_file_location('checker_control_oracle',c.DEFAULT_PREP/'oracle/ar_oracle.py');oracle=importlib.util.module_from_spec(spec);spec.loader.exec_module(oracle)
  bundle_path=c.DEFAULT_PREP/'fixtures/one-invoice-open-differs/bundle.json';bundle,actual=c.oracle_for(c.DEFAULT_PREP,bundle_path)
  rows=[r['rawCells'] for r in actual['sources'][0]['inventory']]
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'own-original-native.xlsx';write_raw_book({'Original':rows},path)
   with zipfile.ZipFile(path) as z:parts={n:z.read(n) for n in z.namelist()}
   sheet=parts['xl/worksheets/sheet1.xml'].decode();sheet=re.sub(r'<c r="F16".*?</c>','<c r="F16"><v>100.00</v></c>',sheet)
   def native(edit=lambda x:x,extra=None):
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as z:
     for n,raw in parts.items():z.writestr(n,edit(sheet).encode() if n=='xl/worksheets/sheet1.xml' else raw)
     for n,raw in (extra or {}).items():z.writestr(n,raw)
    return output.getvalue()
   name,inventory,issues=oracle.read_xlsx(native(),0);self.assertEqual(inventory[15]['rawCells'][5],'100.00');self.assertEqual(inventory[15]['rawCells'][7],'40');self.assertEqual(issues,[])
   name,inventory,issues=oracle.read_xlsx(native(lambda x:x.replace('<row r="16">','<row r="16" ht="0">')),0)
   self.assertIn('hidden-row',{e['code'] for r in inventory for e in r['errors']}|{e['code'] for e in issues})
   styles=f'<styleSheet xmlns="{c.NS["m"]}"><numFmts count="1"><numFmt numFmtId="164" formatCode=";;;"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>'
   name,inventory,issues=oracle.read_xlsx(native(lambda x:x.replace('<c r="B6"','<c r="B6" s="1"'),{'xl/styles.xml':styles}),0)
   self.assertIn('unsupported-number-format',{e['code'] for r in inventory for e in r['errors']})
 def test_replay(self):
  parts=specimen();add_reopen(parts[0],parts[3]);self.assertEqual(self.run_claim(parts)['matchedPairs'],2)
 def test_corruption_controls(self):
  def summary(b,k,v):next(r for r in b['Summary'][1:] if r[0]==k)[1]=v
  controls={
   'original-open-substitution':lambda b,s:b['Movements'][1].__setitem__(15,b['Movements'][1][16]),
   'source-chunk-tamper':lambda b,s:b['Sources'][1].__setitem__(6,base64.b64encode(b'foreign').decode()),
   'inventory-drop':lambda b,s:b['Ledger inventory'].pop(1),
   'parent-provenance-drop':lambda b,s:b['Movements'][1].__setitem__(20,'{}'),
   'foreign-member':lambda b,s:b['Movements'][1].__setitem__(0,'0:foreign:0:16'),
   'foreign-amount':lambda b,s:b['Movements'][1].__setitem__(7,'40'),
   'foreign-document':lambda b,s:b['Movements'][1].__setitem__(5,'foreign'),
   'foreign-date':lambda b,s:b['Movements'][1].__setitem__(6,'2026-10-03'),
   'fraudulent-allocation':lambda b,s:summary(b,'Receipt allocations','[{"invoice":"I01","receipt":"RC1"}]'),
   'fraudulent-completeness':lambda b,s:summary(b,'Financial completeness asserted','true'),
   'double-coverage':lambda b,s:b['Membership'].append(copy.deepcopy(b['Membership'][1])),
   'session-cache':lambda b,s:s.__setitem__('totals',[3500,3500]),
   'family-migration':lambda b,s:s['readings'][0].__setitem__('family','ar-limited-1'),
   'reading-column-tamper':lambda b,s:s['readings'][0].__setitem__('amount',7),
   'source-head-drop':lambda b,s:summary(b,'Source scopes JSON','[]'),
  }
  for name,mutate in controls.items():
   with self.subTest(name=name):
    parts=specimen('one-invoice-open-differs');mutate(parts[0],parts[3]);self.assertRaises(c.CheckFailure,self.run_claim,parts)
 def test_replayed_decisions_rejected(self):
  for target in ['case-state','context','action-order','event-loss']:
   with self.subTest(target=target):
    parts=specimen();b,s=parts[0],parts[3];add_reopen(b,s)
    if target=='case-state':b['Cases'][1][3]='matched'
    if target=='context':s['events'][0]['context']='foreign'
    if target=='action-order':s['events'][0]['action']='accept';b['Decisions'][1][2]='accept'
    if target=='event-loss':b['Decisions'].pop()
    self.assertRaises(c.CheckFailure,self.run_claim,parts)
if __name__=='__main__':unittest.main(verbosity=2)
