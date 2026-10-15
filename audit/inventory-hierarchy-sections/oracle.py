"""Independent CSV/OpenXML discovery and financial oracle, no producer/product imports."""
import argparse,csv,json,re,hashlib
from pathlib import Path
from decimal import Decimal
from zipfile import ZipFile
from xml.etree import ElementTree as E
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
FIELDS=['Item ID','Quantity','Unit','Quantity precision','Posted value','Valuation reference']
SCOPE=['Entity','Inventory ledger','GL ledger','Currency','Currency basis','Posting status','Posting layer','As of','Chart version','Map version','Valuation policy version','Inventory account set version']
TRUTH={('0009','warehouse=W1;batch=B7'):[125,'KG',2,40000,'VAL-A','INV-A','branch=10'],('009','warehouse=W1;batch=B7'):[250,'KG',2,60000,'VAL-B','INV-A','branch=20'],('9','warehouse=W2;batch=B7'):[4,'EA',0,100000,'VAL-C','INV-B','branch=10'],('009','warehouse=W1;batch=B8'):[3,'EA',0,25000,'VAL-D','INV-B','branch=20'],('00','warehouse=W2;batch=Z0'):[0,'EA',0,0,'VAL-Z','INV-B','branch=30']}
def amount(s,precision):
 assert isinstance(s,str) and re.fullmatch(r'[+-]?\d+(?:\.\d+)?',s),'NUMBER'
 v=Decimal(s)*10**precision;assert v==int(v),'PRECISION';return int(v)
def read(p):
 if p.suffix=='.csv':return list(csv.reader(p.open())),[],{}
 with ZipFile(p) as z:
  shared=[]
  if 'xl/sharedStrings.xml' in z.namelist():shared=[''.join(t.text or '' for t in si.findall('.//s:t',NS)) for si in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',NS)]
  tree=E.fromstring(z.read('xl/worksheets/sheet1.xml'));rows=[];stored={}
  for row in tree.findall('s:sheetData/s:row',NS):
   n=int(row.attrib['r'])
   while len(rows)<n:rows.append([])
   for cell in row.findall('s:c',NS):
    assert cell.find('s:f',NS) is None,'FORMULA';m=re.fullmatch(r'([A-Z]+)([1-9]\d*)',cell.attrib['r']);c=0
    for a in m[1]:c=c*26+ord(a)-64
    value=cell.findtext('s:v','',NS);kind=cell.attrib.get('t','n')
    if kind=='s':value=shared[int(value)]
    elif kind=='inlineStr':value=''.join(t.text or '' for t in cell.findall('.//s:t',NS))
    while len(rows[n-1])<c:rows[n-1].append('')
    rows[n-1][c-1]=value;stored[(n,c)]=(value,kind)
  merges=[m.attrib['ref'] for m in tree.findall('s:mergeCells/s:mergeCell',NS)]
  return rows,merges,stored
def interpret(rows,merges,stored):
 rows=[r[:] for r in rows];scope={};facts=[];parent=None;batch=None;header=None;header_row=None;ended=False;report=False;parent_kind=None
 def padded(r):return r+['']*(7-len(r))
 def token(v):assert v and v==v.strip() and not re.search('[;=]',v),'DIMENSION'
 def close_batch(row):
  nonlocal batch,header,header_row
  if batch:
   for f in facts:
    if f['batchRow']==batch[1]:f['batchEnd']=row
  batch=None;header=None;header_row=None
 def close_parent(row):
  nonlocal parent
  close_batch(row)
  if parent:
   for f in facts:
    if f['parentRow']==parent[2]:f['parentEnd']=row
  parent=None
 for address in merges:
  m=re.fullmatch(r'B([1-9]\d*):([FG])([1-9]\d*)',address);assert m and m[1]==m[3],'MERGE_GEOMETRY';row=int(m[1]);r=rows[row-1];assert r[0] in ['Plant','Warehouse','Batch'] and r[1],'MERGE_ROLE'
  for c in range(3,ord(m[2])-63):assert not stored.get((row,c),('',''))[0],'MERGE_PAYLOAD'
 for n,source in enumerate(rows,1):
  r=source[:]
  while r and r[-1]=='':r.pop()
  if not r:continue
  assert not ended,'TRAILING'
  if n==1:assert r==['Inventory carrying-value register'],'TITLE';continue
  if r[0] in SCOPE:
   assert parent_kind is None and len(r)==2 and r[0] not in scope and r[1],'SCOPE';scope[r[0]]=r[1];continue
  if r[0] in ['Plant','Warehouse']:
   assert len(scope)==12 and len(r)==2 and not report,'PARENT';token(r[1]);close_parent(n)
   assert parent_kind in [None,r[0]],'PARENT_KIND';parent_kind=r[0];parent=(r[0].lower(),r[1],n);continue
  if r[0]=='Batch':
   close_batch(n);assert parent and len(r)==2 and not report,'BATCH';token(r[1]);batch=(r[1],n);continue
  if r[0] in ['End batch','Batch total']:
   assert batch,'ORPHAN_END'
   if r[0]=='Batch total':assert len(r)==2 and amount(r[1],2)==sum(f['values'][5] for f in facts if f['batchRow']==batch[1]),'BATCH_TOTAL'
   else:assert len(r)==1,'END_WIDTH'
   close_batch(n);continue
  if r[0] in ['End warehouse','End plant','Parent total']:
   assert parent,'ORPHAN_END'
   if r[0]=='Parent total':assert len(r)==2 and amount(r[1],2)==sum(f['values'][5] for f in facts if f['parentRow']==parent[2]),'PARENT_TOTAL'
   else:assert len(r)==1 and r[0]=='End '+parent_kind.lower(),'END_KIND'
   close_parent(n);continue
  if r[0]=='Report total':
   assert not report and len(r)==2 and amount(r[1],2)==sum(f['values'][5] for f in facts),'REPORT_TOTAL';close_parent(n);report=True;continue
  if r[0]=='End report':assert len(r)==1;close_parent(n);ended=True;continue
  if 'Item ID' in r:
   assert parent and batch and len(r) in [6,7] and len(set(r))==len(r) and set(r)==set(FIELDS+(['Item dimensions'] if len(r)==7 else [])),'HEADER';header=r;header_row=n;continue
  assert parent and batch and header and len(r)==len(header),'ORPHAN_DETAIL'
  raw=dict(zip(header,r));dims=parent[0]+'='+parent[1]+';batch='+batch[0]
  assert 'Item dimensions' not in raw or raw['Item dimensions']==dims,'DIMENSION_CONFLICT'
  assert all(raw[f] for f in FIELDS),'MISSING_VALUE';assert raw['Item ID']==raw['Item ID'].strip(),'IDENTITY'
  for col in [header.index('Item ID')+1]:assert stored.get((n,col),('','s'))[1]!='n','NUMERIC_IDENTITY'
  precision=int(raw['Quantity precision']);assert re.fullmatch('[0-6]',raw['Quantity precision']),'QUANTITY_PRECISION'
  values=[raw['Item ID'],dims,amount(raw['Quantity'],precision),raw['Unit'],precision,amount(raw['Posted value'],2),raw['Valuation reference']]
  assert not any(f['values'][:2]==values[:2] for f in facts),'DUPLICATE'
  facts.append(dict(row=n,values=values,raw=raw,parentRow=parent[2],batchRow=batch[1],headerRow=header_row,fields={k:[n,header.index(k)+1,raw[k]] for k in header}))
 assert ended and len(scope)==12 and facts,'INCOMPLETE'
 return scope,facts

def inspect(folder):
 register=next(p for p in folder.glob('register.*'));rows,merges,stored=read(register)
 try:scope,facts=interpret(rows,merges,stored)
 except (AssertionError,ValueError,IndexError) as e:return dict(id=folder.name,financial='source-error',reason=str(e),facts=[])
 companions=[list(csv.DictReader((folder/f'source-{i}.csv').open())) for i in range(1,4)]
 supported={};missing=False
 for f in facts:
  v=f['values'];maps=[m for m in companions[0] if [m['Item ID'],m['Item dimensions']]==v[:2]]
  if len(maps)!=1:missing=True;continue
  m=maps[0];pol=[p for p in companions[1] if p['Evidence ID']==m['Evidence ID']]
  if len(pol)!=1 or [pol[0][k] for k in ['Item ID','Item dimensions','Unit','Quantity precision','Valuation reference','GL account','GL dimensions']]!=[v[0],v[1],v[3],str(v[4]),v[6],m['GL account'],m['GL dimensions']]:missing=True;continue
  key=(m['GL account'],m['GL dimensions']);supported[key]=supported.get(key,0)+v[5]
 comparisons=[]
 for gl in companions[2]:
  key=(gl['GL account'],gl['GL dimensions']);value=amount(gl['Debit'],2)-amount(gl['Credit'],2)
  if key not in supported:missing=True
  comparisons.append([*key,supported.get(key,0),amount(gl['Debit'],2),amount(gl['Credit'],2),value,supported.get(key,0)-value])
 financial='missing' if missing else 'difference' if any(c[-1] for c in comparisons) else 'ready'
 return dict(id=folder.name,financial=financial,facts=facts,comparisons=comparisons,totals=dict(registerMinor=sum(supported.values()),glMinor=sum(c[5] for c in comparisons)),scope=scope)
def verify(result):
 code=result['id'].split('-')[-1]
 expected='ready' if code.startswith('P') else 'difference' if code=='N01' else 'missing' if code=='N02' else 'source-error'
 assert result['financial']==expected,(code,result)
 if expected=='source-error':return
 assert len(result['facts'])==5
 if expected=='ready':
  assert result['totals']==dict(registerMinor=225000,glMinor=225000)
  for f in result['facts']:
   v=f['values'];t=TRUTH[tuple(v[:2])];assert v[2:]==[t[0],t[1],t[2],t[3],t[4]]
 if code=='N01':assert sorted(c[-1] for c in result['comparisons'])==[-20000,0,0,0,20000]
 if code=='N02':assert result['totals']==dict(registerMinor=0,glMinor=225000)
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--root',required=True);args=a.parse_args();results=[inspect(p) for p in sorted(Path(args.root).glob('INV1D-*'))]
 for r in results:verify(r)
 print(json.dumps({'cases':results}))
