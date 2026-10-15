"""Independent fixture PDF/CSV source and Decimal oracle. No producer/product import.
The PDF reader is deliberately restricted to this synthetic Type1/Tm/Tj grammar;
it is NOT a general PDF parser or a product implementation.
"""
import argparse,csv,hashlib,json,re
from decimal import Decimal
from pathlib import Path
SCOPE=['Entity','Inventory ledger','GL ledger','Currency','Currency basis','Posting status','Posting layer','As of','Chart version','Map version','Valuation policy version','Inventory account set version']
VALUES=['Synthetic INV1F Owner','STOCK-PDF','GL-PDF','KWD','functional','posted','Current','2026-10-31','CHART-F','MAP-F','SUPPLIED-F','SET-F']
FIELDS=['Item ID','Item dimensions','Quantity','Unit','Quantity precision','Posted value','Valuation reference']
TRUTH={('0008','warehouse=NORTH;batch=LOT-X'):[1250,'KG',3,410125,'VAL-FA'],('08','warehouse=NORTH;batch=LOT-Y'):[250,'KG',2,189875,'VAL-FB'],('0008','warehouse=SOUTH;batch=LOT-X'):[1250,'G',0,600000,'VAL-FC'],('8','warehouse=SOUTH;batch=LOT-Z'):[3,'EA',0,42500,'VAL-FD'],('008','warehouse=EAST;batch=LOT-X'):[50,'KG',2,42500,'VAL-FE'],('00','warehouse=NORTH;batch=LOT-X'):[0,'EA',0,0,'VAL-FZ'],('00008','warehouse=WEST;batch=RETURN'):[125,'KG',3,750,'VAL-FF']}
def number(raw,precision):
 assert isinstance(raw,str) and re.fullmatch(r'[+-]?\d+(?:\.\d+)?',raw),'NUMBER'
 v=Decimal(raw)*10**precision;assert v.is_finite() and v==v.to_integral_value(),'PRECISION';return int(v)
def pdf_read(path):
 data=path.read_bytes();assert data.startswith(b'%PDF-1.7\n') and len(data)<1000000,'PDF_FILE'
 text=data.decode('ascii');xref=re.search(r'startxref\n(\d+)\n%%EOF\n$',text);assert xref and text[int(xref[1]):].startswith('xref\n'),'XREF'
 entries=re.match(r'xref\n0 (\d+)\n0000000000 65535 f \n((?:\d{10} 00000 n \n)+)trailer',text[int(xref[1]):]);assert entries and len(entries[2].splitlines())==int(entries[1])-1,'XREF_COUNT'
 for identifier,line in enumerate(entries[2].splitlines(),1):assert text[int(line[:10]):].startswith(f'{identifier} 0 obj\n'),'XREF_OFFSET'
 objects={int(m[1]):m[2] for m in re.finditer(r'(?m)^(\d+) 0 obj\n(.*?)\nendobj\n',text,re.S)}
 assert len(objects)==len(re.findall(r'(?m)^\d+ 0 obj$',text)),'OBJECT_ID'
 root=objects[2];match=re.fullmatch(r'<< /Type /Pages /Kids \[(.*?)\] /Count (\d+) >>',root);assert match,'PAGE_TREE'
 kids=[int(v) for v in re.findall(r'(\d+) 0 R',match[1])];assert len(kids)==int(match[2]) and len(kids)==len(set(kids)),'PAGE_COUNT'
 pages=[]
 for page_no,identifier in enumerate(kids,1):
  page=objects[identifier];size=re.search(r'/MediaBox \[0 0 (\d+) (\d+)\]',page);assert size,'PAGE_SIZE'
  content=int(re.search(r'/Contents (\d+) 0 R',page)[1]);m=re.fullmatch(r'<< /Length (\d+) >>\nstream\n(.*?)\nendstream',objects[content],re.S);assert m and len(m[2])==int(m[1]),'STREAM_LENGTH'
  tokens=[]
  for command in m[2].splitlines():
   block=re.fullmatch(r'BT /F1 (\d+) Tf 1 0 0 1 (\d+) (\d+) Tm ((?:\((?:\\.|[^\\()])*\) Tj ?)+) ET',command);assert block,'PDF_GRAMMAR'
   raw=''.join(re.sub(r'\\([\\()])',r'\1',v) for v in re.findall(r'\(((?:\\.|[^\\()])*)\) Tj',block[4]))
   x,y,height=int(block[2]),int(block[3]),int(block[1]);width=float(Decimal(len(raw))*height*Decimal('.6'))
   assert 0<=x<x+width<=int(size[1]) and 0<y<y+height<int(size[2]),'VISIBLE_BOX'
   tokens.append(dict(page=page_no,x=x,y=y,width=width,height=height,raw=raw))
  lines=[]
  for y in sorted({t['y'] for t in tokens},reverse=True):lines.append(sorted([t for t in tokens if t['y']==y],key=lambda t:t['x']))
  pages.append(lines)
 return pages

def parse_pdf(path):
 pages=pdf_read(path);facts=[];scope=None;pending=None;all_rows=[];seen=set();ended=False;report=False;document_scope=None
 for pn,lines in enumerate(pages,1):
  assert len(lines)>=8,'PAGE_STRUCTURE'
  raw=lambda line:[t['raw'] for t in line]
  assert raw(lines[0])==['Inventory carrying-value register'],'TITLE'
  assert raw(lines[1])==['Report ID','INV1F-OCT2026'],'REPORT_ID'
  assert raw(lines[2])==['Page',f'{pn} of {len(pages)}'],'PAGE_SEQUENCE'
  current={};scope_end=3
  while scope_end<len(lines) and lines[scope_end][0]['raw'] in SCOPE:
   cells=raw(lines[scope_end]);assert len(cells)==2 and cells[0] not in current,'SCOPE';current[cells[0]]=cells[1];scope_end+=1
  if pn==1:
   assert len(current)==12 and [current[k] for k in SCOPE]==VALUES,'SCOPE_CONFLICT';scope=current
   document_scope=[dict(role=line[0],value=line[1]) for line in lines[3:scope_end]]
  else:
   assert set(current) in [set(SCOPE),{'Currency','As of'}] and all(scope[k]==v for k,v in current.items()),'SCOPE_CONFLICT'
  if pending:assert lines[scope_end][0]['raw']=='Continued section','CONTINUATION'
  parent=batch=None;parent_cite=batch_cite=None;headers=None;header_cites=None;continued=None;next_pending=None;page_sum=0;page_total=False;end_page=False;section_facts=[];page_facts=[];section_continuation=None
  for rn,line in enumerate(lines[scope_end:],scope_end+1):
   values=raw(line);tag=values[0];kind='control'
   assert not ended,'TRAILING_AFTER_REPORT'
   if tag=='Continued section':
    assert rn==scope_end+1 and pending and len(values)==2 and values[1]==pending['key'],'CONTINUATION';continued=dict(key=values[1],role=line[0],value=line[1],prior=pending['citation'])
   elif tag=='Warehouse':
    assert not end_page and len(values)==2 and values[1],'PARENT'
    for f in section_facts:f['sectionEnd']=line[0]
    section_facts=[];section_continuation=None;parent=values[1];parent_cite=line[1];batch=None;headers=None
   elif tag=='Batch':
    assert parent and not batch and len(values)==2 and values[1],'BATCH';batch=values[1];batch_cite=line[1]
    if continued is not None:assert f'warehouse={parent};batch={batch}'==continued['key'],'CONTINUATION';section_continuation=continued;continued=None;pending=None
   elif set(values)==set(FIELDS) or set(values)==set(FIELDS)-{'Item dimensions'}:
    assert not end_page and len(values)==len(set(values)),'HEADER'
    assert ('Item dimensions' in values) or parent and batch,'HEADER_DIMENSIONS'
    headers=values;header_cites=line;kind='header'
   elif tag=='End section':
    assert parent and batch and len(values)==1,'END_SECTION'
    for f in section_facts:f['sectionEnd']=line[0]
    section_facts=[];section_continuation=None;parent=batch=headers=None
   elif tag=='Continues section':
    assert parent and batch and len(values)==2 and values[1]==f'warehouse={parent};batch={batch}' and pn<len(pages),'CONTINUATION';next_pending=dict(key=values[1],citation=dict(role=line[0],value=line[1]))
    for f in section_facts:f['sectionEnd']=line[0];f['outgoingContinuation']=next_pending['citation']
    section_facts=[];parent=batch=headers=None
   elif tag=='Page total':
    if parent:
     assert batch,'BATCH'
     for f in section_facts:f['sectionEnd']=line[0]
     section_facts=[];parent=batch=headers=None
    assert not page_total and not parent and not pending and len(values)==2 and number(values[1],3)==page_sum,'PAGE_TOTAL';page_total=True;headers=None
    for f in page_facts:f['pageTotal']=dict(role=line[0],value=line[1])
   elif tag=='End page':
    assert page_total and not end_page and not parent and len(values)==1,'END_PAGE';end_page=True
    for f in page_facts:f['pageEnd']=line[0]
   elif tag=='Report total':
    assert pn==len(pages) and end_page and not report and len(values)==2 and number(values[1],3)==sum(f['values'][5] for f in facts),'REPORT_TOTAL';report=True
   elif tag=='End report':
    assert pn==len(pages) and end_page and report and len(values)==1,'END_REPORT';ended=True
    for f in facts:f['reportEnd']=line[0]
   else:
    assert headers and not page_total and not end_page and tag!='Unassigned value','UNCLASSIFIED_ROW'
    cells={}
    for t in line:
     ci=min(range(len(header_cites)),key=lambda i:abs(t['x']-header_cites[i]['x']))
     assert abs(t['x']-header_cites[ci]['x'])<.01 and headers[ci] not in cells,'CELL_COLUMN';cells[headers[ci]]=t
    assert set(cells)==set(headers),'MISSING_FIELD'
    get=lambda k:cells[k]['raw']
    dims=get('Item dimensions') if 'Item dimensions' in cells else f'warehouse={parent};batch={batch}'
    assert re.fullmatch(r'warehouse=[A-Z]+;batch=[A-Z0-9-]+',dims),'DIMENSIONS'
    identity=(get('Item ID'),dims);assert identity not in seen,'DUPLICATE_ITEM';seen.add(identity)
    precision=get('Quantity precision');assert re.fullmatch('[0-6]',precision),'QUANTITY_PRECISION';precision=int(precision)
    v=[get('Item ID'),dims,number(get('Quantity'),precision),get('Unit'),precision,number(get('Posted value'),3),get('Valuation reference')]
    assert v[0] and v[3] and v[6],'IDENTITY'
    facts.append(dict(page=pn,row=rn,values=v,fields={k:{'role':header_cites[headers.index(k)],'value':t} for k,t in cells.items()},parent=parent_cite if 'Item dimensions' not in cells else None,batch=batch_cite if 'Item dimensions' not in cells else None,incomingContinuation=section_continuation,sectionEnd=None,scopeEvidence=[dict(role=r[0],value=r[1]) for r in lines[3:scope_end]],documentScopeEvidence=document_scope))
    page_facts.append(facts[-1]);section_facts.append(facts[-1])
    page_sum+=v[5];kind='record'
   all_rows.append(dict(page=pn,row=rn,kind=kind,text=values,tokens=line))
  assert page_total and end_page and pending is None,'PAGE_END'
  pending=next_pending
 assert ended and report and pending is None,'REPORT_END'
 return scope,facts,all_rows

def inspect(folder):
 source=next(folder.glob('register.*'))
 try:
  if source.suffix=='.pdf':scope,facts,rows=parse_pdf(source)
  else:
   data=list(csv.DictReader(source.open()));scope={k:data[0][k] for k in SCOPE};assert [scope[k] for k in SCOPE]==VALUES,'SCOPE'
   facts=[dict(row=n,values=[r['Item ID'],r['Item dimensions'],number(r['Quantity'],int(r['Quantity precision'])),r['Unit'],int(r['Quantity precision']),number(r['Posted value'],3),r['Valuation reference']]) for n,r in enumerate(data,2)];rows=[]
 except AssertionError as error:return dict(id=folder.name,financial='source-error',reason=str(error),totals=None)
 companions=[list(csv.DictReader((folder/f).open())) for f in ['mapping.csv','policy.csv','gl.csv']]
 for table in companions:
  assert all([r[k] for k in SCOPE]==VALUES for r in table),'COMPANION_SCOPE'
 supported={};missing=[];links=[]
 for f in facts:
  v=f['values'];m=[r for r in companions[0] if [r['Item ID'],r['Item dimensions']]==v[:2]];assert len(m)==1,'MAPPING';m=m[0]
  p=[r for r in companions[1] if r['Evidence ID']==m['Evidence ID']];assert len(p)==1,'POLICY_ID';p=p[0]
  actual=[p[k] for k in ['Item ID','Item dimensions','Unit','Quantity precision','Valuation reference','GL account','GL dimensions']]
  expected=[v[0],v[1],v[3],str(v[4]),v[6],m['GL account'],m['GL dimensions']]
  links.append(dict(key=v[:2],mapping=m['Mapping ID'],policy=p['Evidence ID'],account=[m['GL account'],m['GL dimensions']],supported=actual==expected,mappingRow=companions[0].index(m)+2,policyRow=companions[1].index(p)+2,glRow=next(i for i,g in enumerate(companions[2],2) if [g['GL account'],g['GL dimensions']]==[m['GL account'],m['GL dimensions']])))
  if actual!=expected:missing.append(v[:2]);continue
  assert p['Valid from']<=scope['As of']<=p['Valid to'] and p['Value basis']=='provided-posted-carrying-value' and p['Sign']=='debit-positive','POLICY'
  key=(m['GL account'],m['GL dimensions']);supported[key]=supported.get(key,0)+v[5]
 comparisons=[]
 for g in companions[2]:
  key=(g['GL account'],g['GL dimensions']);debit,credit=number(g['Debit'],3),number(g['Credit'],3);value=debit-credit
  if key not in supported:missing.append(list(key))
  comparisons.append([*key,supported.get(key,0),debit,credit,value,supported.get(key,0)-value])
 return dict(id=folder.name,financial='missing' if missing else 'difference' if any(c[-1] for c in comparisons) else 'ready',facts=facts,links=links,comparisons=comparisons,totals=dict(registerMinor=sum(supported.values()),glMinor=sum(c[5] for c in comparisons)),scope=scope,rows=rows,sourceHash=hashlib.sha256(source.read_bytes()).hexdigest())
def verify(r):
 code=r['id'].split('-')[-1];expected='ready' if code.startswith('P') else 'difference' if code=='N04' else 'missing' if code in ['N05','N11'] else 'source-error'
 assert r['financial']==expected,(code,r)
 if expected=='source-error':
  reasons={'N01':'PAGE_SEQUENCE','N02':'PAGE_SEQUENCE','N03':'CONTINUATION','N06':'MISSING_FIELD','N07':'UNCLASSIFIED_ROW','N08':'REPORT_END','N09':'PAGE_TOTAL','N10':'SCOPE_CONFLICT','N12':'PRECISION','N13':'HEADER_DIMENSIONS','N14':'REPORT_ID','N15':'CONTINUATION'}
  assert r['totals'] is None and r['reason']==reasons[code],'ERROR_REASON';return
 assert len(r['facts'])==7 and len(r['links'])==7,'FACT_COUNT'
 keys=list(TRUTH);provided={k:v[:] for k,v in TRUTH.items()}
 if code=='N04':provided[keys[0]][3],provided[keys[1]][3]=provided[keys[1]][3],provided[keys[0]][3]
 if code=='N05':provided[keys[3]][4],provided[keys[4]][4]=provided[keys[4]][4],provided[keys[3]][4]
 if code=='N11':provided[keys[2]][1]='KG'
 actual={tuple(f['values'][:2]):f['values'][2:] for f in r['facts']}
 assert actual==provided,'FACT'
 accounts=[['INV-RAW','branch=10'],['INV-RAW','branch=20'],['INV-RAW','branch=30'],['INV-PACK','branch=40'],['INV-PACK','branch=50'],['INV-RAW','branch=60'],['INV-RET','branch=70']]
 links={tuple(l['key']):l for l in r['links']};comparisons=[]
 for i,(key,account) in enumerate(zip(keys,accounts)):
  supported=not(code=='N05' and i in [3,4] or code=='N11' and i==2)
  assert links[key]==dict(key=list(key),mapping=f'MAP-F-{i}',policy=f'POL-F-{i}',account=account,supported=supported,mappingRow=i+2,policyRow=i+2,glRow=i+2),'LINK_MEMBERSHIP'
  money=provided[key][3] if supported else 0;gl=TRUTH[key][3]
  comparisons.append([*account,money,gl,0,gl,money-gl])
 assert sorted(r['comparisons'])==sorted(comparisons),'BRANCH_COMPARISONS'
 total=1200750 if code=='N05' else 685750 if code=='N11' else 1285750
 assert r['totals']==dict(registerMinor=total,glMinor=1285750),'TOTAL'

def verify_citations(result,folder):
 """Check each fact against its physical row, local header and dimension owner."""
 source=next(folder.glob('register.*'));assert result['sourceHash']==hashlib.sha256(source.read_bytes()).hexdigest(),'SOURCE_HASH'
 if source.suffix!='.pdf':return
 pages=pdf_read(source)
 for fact in result['facts']:
  lines=pages[fact['page']-1];row=lines[fact['row']-1];fields=fact['fields']
  previous=[r for r in lines[:fact['row']-1] if set(t['raw'] for t in r) in [set(FIELDS),set(FIELDS)-{'Item dimensions'}]]
  assert previous,'CITATION_HEADER';header=previous[-1]
  for field,pair in fields.items():
   assert pair['value'] in row and pair['role'] in header and pair['role']['raw']==field and pair['role']['x']==pair['value']['x'],'FIELD_OWNERSHIP'
  after=lines[fact['row']:]
  page_end=next(line[0] for line in after if line[0]['raw']=='End page')
  page_total=next(dict(role=line[0],value=line[1]) for line in after if line[0]['raw']=='Page total')
  assert fact['pageEnd']==page_end and fact['pageTotal']==page_total,'PAGE_BOUNDARY'
  report_end=pages[-1][-1][0];assert report_end['raw']=='End report' and fact['reportEnd']==report_end,'REPORT_BOUNDARY'
  local_scope=[]
  for line in lines[3:]:
   if line[0]['raw'] not in SCOPE:break
   local_scope.append(dict(role=line[0],value=line[1]))
  assert fact['scopeEvidence']==local_scope and fact['documentScopeEvidence']==[dict(role=line[0],value=line[1]) for line in pages[0][3:15]],'SCOPE_CITATIONS'
  if fact['parent'] is not None:
   boundary=next(line for line in after if line[0]['raw'] in ['End section','Continues section','Warehouse','Page total'])
   assert fact['sectionEnd']==boundary[0],'SECTION_BOUNDARY'
   if boundary[0]['raw']=='Continues section':assert fact['outgoingContinuation']==dict(role=boundary[0],value=boundary[1]),'CONTINUATION_CITATION'
  incoming=fact['incomingContinuation']
  if incoming:
   assert fact['page']>1,'CONTINUATION_PAGE'
   previous=pages[fact['page']-2]
   outgoing=next(line for line in previous if line[0]['raw']=='Continues section')
   local=next(line for line in lines[:fact['row']-1] if line[0]['raw']=='Continued section')
   assert incoming==dict(key=local[1]['raw'],role=local[0],value=local[1],prior=dict(role=outgoing[0],value=outgoing[1])) and local[1]['raw']==outgoing[1]['raw'],'CONTINUATION_CITATION'
  get=lambda k:fields[k]['value']['raw']
  if 'Item dimensions' in fields:dim=get('Item dimensions');assert fact['parent'] is None and fact['batch'] is None,'DIRECT_DIMENSIONS'
  else:
   owners={}
   for line in lines[:fact['row']-1]:
    if line[0]['raw'] in ['Warehouse','Batch']:owners[line[0]['raw']]=line[1]
   assert fact['parent']==owners['Warehouse'] and fact['batch']==owners['Batch'],'DIMENSION_OWNER'
   dim='warehouse='+fact['parent']['raw']+';batch='+fact['batch']['raw']
  precision=int(get('Quantity precision'))
  assert fact['values']==[get('Item ID'),dim,number(get('Quantity'),precision),get('Unit'),precision,number(get('Posted value'),3),get('Valuation reference')],'CITED_VALUES'

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--geometry',action='store_true');a=p.parse_args();cases=[inspect(f) for f in sorted(a.root.glob('INV1F-*'))]
 for c in cases:
  verify(c)
  if c['financial']!='source-error':verify_citations(c,a.root/c['id'])
 output=dict(cases=cases)
 if a.geometry:output['geometry']={folder.name:pdf_read(folder/'register.pdf') for folder in sorted(a.root.glob('INV1F-*')) if (folder/'register.pdf').exists()}
 print(json.dumps(output))
