#!/usr/bin/env python3
"""Independent AR exported-workbook/session checker. Standard library only.

Reads sealed preparation originals and its independent oracle. Never reads/imports
product implementation, product tests, product fixture builders, or driver expectations.
"""
from __future__ import annotations
import argparse, base64, copy, datetime, hashlib, importlib.util, json, posixpath, re
import sys, zipfile
from pathlib import Path
from xml.etree import ElementTree as E

HERE = Path(__file__).resolve().parent
DEFAULT_PREP = HERE.parent if (HERE.parent/'oracle/ar_oracle.py').exists() else HERE.parents[1] / 'ar-scope-details-preparation-20261011'
SHEETS = ['Summary','Movements','Cases','Membership','Ledger inventory','Statement inventory','Reading','Decisions','Sources']
HEADERS = {
 'Summary':['Property','Value'],
 'Movements':['Movement ID','Side','Source row','Posting ID','Document type','Own document number','Posting date','Amount minor units','Related invoice','Description','Case ID','Status','Basis','Related evidence JSON'],
 'Cases':['Case ID','Document type','Own document number','Status','Basis','Reason','Member count','Note'],
 'Membership':['Case ID','Movement ID','Side','Source row'],
 'Reading':['Side','Field','Value'],
 'Decisions':['Sequence','Context','Action','Members JSON','Note','Recorded at UTC'],
 'Sources':['Side','Role','Source name','Source SHA-256','Sheet','Chunk','Original bytes base64']}
APPENDED = {'Movements':['Source family','Original signed amount raw','Open balance raw','Open balance role','Parent scope ID','Parent cell JSON','Inherited source cells JSON','Line span JSON'], 'Cases':['Error inventory refs JSON']}
INV_EXTRA = ['Inventory ID','Classification','Errors JSON','Line span JSON']
NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
ROLES=['company-ar-ledger','company-issued-customer-statement']
READING_KEYS=['sheet','header','posting','kind','document','date','amount','entity','ledger','customer','account','currency','related','description','role','perspective','basis','confirmed']
SUMMARY_KEYS=['Domain','Version','Perspective','Amount basis','entity','ledger','customer','account','currency','start','end','Decimals','Valid movements','Reading errors','Matched document pairs','Ledger total minor units','Statement total minor units','Economic coverage']
SUMMARY_EXTRA=['Receipt allocations','Financial completeness asserted','Ledger total available','Statement total available','Source issues JSON','Error inventory refs JSON','Source scopes JSON']
COVERAGE='Not independently verified. Document comparison is not receipt allocation, balance reconciliation or proof of completeness.'
PRECISION={**{k:2 for k in ['SAR','USD','EUR','GBP','AED','QAR','EGP']},**{k:3 for k in ['KWD','BHD','OMR']},'JPY':0}

class CheckFailure(AssertionError): pass
def require(condition, message):
 if not condition: raise CheckFailure(message)
def eq(actual, expected, message):
 require(actual == expected, f'{message}: actual={actual!r}; expected={expected!r}')
def sha(data): return hashlib.sha256(data).hexdigest()
def canonical(value): return json.dumps(value,ensure_ascii=False,separators=(',',':'))
def scalar(value):
 return 'true' if value is True else 'false' if value is False else '' if value is None else str(value)
def context_for(session):
 newkeys=['family','sheet','header','parent','posting','kind','document','date','amount','related','open','description','role','perspective','basis','confirmed']
 values=[[r.get(k) for k in (newkeys if r.get('family')=='ar-scope-details-1' else READING_KEYS)] for r in session['readings']]
 return canonical([session['version'],[f['sha256'] for f in session['files']],values,[session['scope'][k] for k in ['entity','ledger','customer','account','currency','start','end','confirmed']]])
def decoded(value):
 try: return json.loads(value)
 except (ValueError,TypeError) as error: raise CheckFailure(f'invalid JSON evidence: {value!r}') from error
def integer(value):
 require(isinstance(value,str) and re.fullmatch(r'-?(0|[1-9][0-9]*)',value) is not None, f'noncanonical integer {value!r}')
 return int(value)
def unescape(value):
 # ST_Xstring escape processing is a single pass: escaped underscore must not
 # make a literal _xNNNN_ sequence decode for a second time.
 value=re.sub(r'_x([0-9a-fA-F]{4})_',lambda m:chr(int(m[1],16)),value)
 return value.encode('utf-16-le',errors='surrogatepass').decode('utf-16-le')
def xml(data):
 require(b'<!DOCTYPE' not in data.upper() and b'<!ENTITY' not in data.upper(),'unsafe XML declaration')
 return E.fromstring(data)
def column(ref):
 match=re.fullmatch(r'([A-Z]+)([1-9][0-9]*)',ref or '')
 require(match is not None,'invalid cell coordinate')
 n=0
 for c in match[1]:n=n*26+ord(c)-64
 return n-1,int(match[2])

def read_workbook(path):
 """Extract actual raw OOXML using workbook relationships, no repair library."""
 require(path.stat().st_size<=100663296,'export exceeds 96 MiB')
 with zipfile.ZipFile(path) as z:
  require(len(z.infolist())<=1000 and len(z.namelist())==len(set(z.namelist())),'invalid ZIP part count/duplicate')
  require(sum(i.file_size for i in z.infolist())<=256*1024*1024,'export ZIP expansion bound')
  strings=[]
  if 'xl/sharedStrings.xml' in z.namelist():
   strings=[unescape(''.join(t.text or '' for t in si.findall('.//m:t',NS))) for si in xml(z.read('xl/sharedStrings.xml')).findall('m:si',NS)]
  relations={n.get('Id'):n.get('Target') for n in xml(z.read('xl/_rels/workbook.xml.rels')) if n.get('TargetMode')!='External'}
  book={}
  for sheet in xml(z.read('xl/workbook.xml')).findall('m:sheets/m:sheet',NS):
   name=sheet.get('name');require(name not in book,'duplicate worksheet')
   require(sheet.get('state','visible')=='visible','hidden export worksheet')
   target=relations.get(sheet.get(REL));require(target is not None,'missing sheet relationship')
   target=posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join('xl',target))
   require(target.startswith('xl/') and '..' not in target.split('/'),'invalid sheet target')
   root=xml(z.read(target));require(root.find('m:mergeCells',NS) is None,'merged export evidence')
   for col in root.findall('m:cols/m:col',NS):require(col.get('hidden') not in ('1','true'),'hidden export column')
   rows=[];last=0
   for row in root.findall('m:sheetData/m:row',NS):
    n=int(row.get('r'));require(last<n<=500000,'unordered/overbound export row');last=n
    require(row.get('hidden') not in ('1','true'),'hidden export row')
    while len(rows)<n:rows.append([])
    seen=set()
    for cell in row.findall('m:c',NS):
     c,cr=column(cell.get('r'));require(cr==n and c not in seen and c<1000,'duplicate/misaligned/overbound cell');seen.add(c)
     require(cell.find('m:f',NS) is None,'formula in exported evidence')
     kind=cell.get('t','n');v=cell.find('m:v',NS);raw='' if v is None else v.text or ''
     if kind=='s':
      try:raw=strings[int(raw)]
      except (ValueError,IndexError):raise CheckFailure('invalid shared-string index')
     elif kind=='inlineStr':raw=unescape(''.join(t.text or '' for t in cell.findall('.//m:t',NS)))
     elif kind=='b':eq(raw in ('0','1'),True,'invalid boolean');raw='true' if raw=='1' else 'false'
     else:require(kind in ('n','str'),'error/unsupported export cell');raw=unescape(raw) if kind=='str' else raw
     while len(rows[n-1])<=c:rows[n-1].append('')
     rows[n-1][c]=raw
   book[name]=rows
  eq(list(book),SHEETS,'all nine worksheets and order')
  return book

def oracle_for(prep,bundle_path):
 spec=importlib.util.spec_from_file_location('independent_preparation_ar_oracle',prep/'oracle/ar_oracle.py')
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 bundle=json.loads(bundle_path.read_text());actual=module.reconcile(bundle,bundle_path.parent)
 truths=json.loads((prep/'fixtures/TRUTHS.json').read_text())
 truth=truths.get(bundle_path.parent.name)
 if truth:
  for key,value in truth['expected'].items():
   if key=='allocationAuthority':eq(actual['receiptAllocations'],[],'manual truth no allocation');eq(actual['financialCompletenessAsserted'],False,'manual truth completeness')
   elif key=='requiredReasons':require(set(value)<={c['reason'] for c in actual['cases']},'sealed manual required reasons')
   elif key=='requiredIssueCategories':require(set(value)<=set(actual['requiredIssueCategories']),'sealed manual required issue categories')
   elif key in actual:eq(actual[key],value,'oracle agrees with sealed manual truth '+key)
  eq([s['sha256'] for s in actual['sources']],truth['sourceHashes'],'sealed manual source hashes')
  bundle['_manualExpected']=truth['expected']
 return bundle,actual

def table(book,name,headers):
 rows=book[name];require(rows,'missing table header '+name);eq(rows[0],headers,'headers '+name)
 result=[]
 for r in rows[1:]:
  require(len(r)<=len(headers),'extra table values '+name)
  result.append(dict(zip(headers,r+['']*(len(headers)-len(r)))))
 return result

def id_for(side,source,row):return f'{side}:{source["sha256"]}:{source["sheetIndex"]}:{row}'
def inventory_id(side,source,row):return f'{side}:{source["sha256"]}:{source["sheetIndex"]}:inventory:{row}'
def parent_cell(rec):return f'{rec["parentCell"]["row"]}:{rec["parentCell"]["column"]}'
def inherited_cells(source,rec):
 return {c['field'].lower():{'hash':c['sourceSha256'],'sheet':source['sheetIndex'],'sheetName':source['sheet'],'row':c['headerRow'],'column':c['headerValueColumn'],'raw':c['raw'],'parentScopeId':c['scopeId'],'detailRow':c['detailRow'],'parentCell':parent_cell(rec)} for c in rec['inheritedSourceCells']}
def scopes_for(sources):
 result=[]
 for side,source in enumerate(sources):
  header=source['scopeHeader']
  if source['family']!='ar-scope-details-1' or header is None or (source['structuralError'] and not all(e['code']=='total-bound' for e in source['errors'])):continue
  sid=header['scopeId'];cells={k:{'hash':source['sha256'],'sheet':source['sheetIndex'],'sheetName':source['sheet'],'row':v['row'],'column':v['column'],'raw':v['raw'],'parentScopeId':sid,'detailRow':0,'parentCell':''} for k,v in header['fields'].items()}
  marker=next((r['physicalRow'] for r in source['inventory'] if r['classification']=='details-marker'),0)
  end=next((r['physicalRow'] for r in source['inventory'] if r['classification']=='end-marker'),0)
  result.append({'side':side,'scopeId':sid,'reference':header['fields'].get('Scope reference',{}).get('raw',''),'cells':cells,'detailsMarkerRow':marker,'headerRow':header['detailHeaderRow'] or 0,'endRow':end})
 return result

def verify_book(book,bundle,oracle,session,originals):
 """Every claimed table is compared with independently computed original facts."""
 new=any(f=='ar-scope-details-1' for f in bundle['families'])
 version='ar-scope-details-1' if new else 'ar-limited-1'
 summary_rows=table(book,'Summary',HEADERS['Summary'])
 eq([r['Property'] for r in summary_rows],SUMMARY_KEYS+(SUMMARY_EXTRA if new else []),'Summary legacy row order and all new rows')
 summary={r['Property']:r['Value'] for r in summary_rows};eq(len(summary),len(summary_rows),'unique Summary keys')
 required={'Domain':'customer-ar-document-comparison','Version':version,'Perspective':'seller-receivable','Amount basis':'original-movement'}
 required.update({k:scalar(bundle['scope'][k]) for k in ('entity','ledger','customer','account','currency','start','end')})
 for k,v in required.items():eq(summary.get(k),v,'Summary '+k)
 eq(summary['Economic coverage'],COVERAGE,'no invented economic coverage authority')
 eq(integer(summary['Decimals']),PRECISION[bundle['scope']['currency']],'currency exact decimal precision')
 movements=table(book,'Movements',HEADERS['Movements']+(APPENDED['Movements'] if new else []))
 cases=table(book,'Cases',HEADERS['Cases']+(APPENDED['Cases'] if new else []))
 members=table(book,'Membership',HEADERS['Membership'])
 readings=table(book,'Reading',HEADERS['Reading'])
 decisions=table(book,'Decisions',HEADERS['Decisions'])
 sources=table(book,'Sources',HEADERS['Sources'])
 require(all(integer(r['Side']) in (0,1) for r in sources),'all source chunks belong to original two sides')
 readmap={}
 for row in readings:
  key=(integer(row['Side']),row['Field']);require(key not in readmap,'duplicate reading field');readmap[key]=row['Value']
 eq(set(readmap),{(i,k) for i,r in enumerate(session['readings']) for k in r},'Reading field set')
 for i,reading in enumerate(session['readings']):
  for k,v in reading.items():eq(readmap[(i,k)],scalar(v),'Reading value')
 osources=copy.deepcopy(oracle['sources']);expected_records={};expected_inventory_ids=[];inventory_errors=0
 for side,source in enumerate(osources):
  reading=session['readings'][side];source['sheetIndex']=reading['sheet']
  sr=[r for r in sources if integer(r['Side'])==side]
  require(sr,'missing original source chunks');eq([integer(r['Chunk']) for r in sr],list(range(1,len(sr)+1)),'source chunk sequence')
  chunks=[r['Original bytes base64'] for r in sr]
  require(all(0<len(c)<=30000 for c in chunks),'source chunk bounds')
  encoded=''.join(chunks)
  try:data=base64.b64decode(encoded,validate=True)
  except ValueError:raise CheckFailure('invalid source base64')
  eq(base64.b64encode(data).decode(),encoded,'canonical original base64');eq(data,originals[side],'exact original bytes')
  for row in sr:
   eq(row['Role'],ROLES[side],'source role');eq(row['Source SHA-256'],sha(data),'source hash');eq(row['Source name'],session['files'][side]['name'],'source name');eq(row['Sheet'],source['sheet'],'selected source sheet')
  width=max((len(r['rawCells']) for r in source['inventory']),default=0)
  ih=['Source row','Kind','Error']+[f'Original column {i+1}' for i in range(width)]+(INV_EXTRA if new else [])
  inventory=table(book,SHEETS[4+side],ih)
  eq(len(inventory),len(source['inventory']),'complete raw inventory')
  for row,expected in zip(inventory,source['inventory']):
   inventory_errors+=row['Kind']=='error'
   eq(integer(row['Source row']),expected['physicalRow'],'original physical inventory row')
   for col in range(width):eq(row[f'Original column {col+1}'],expected['rawCells'][col] if col<len(expected['rawCells']) else '','untouched inventory cell')
   if source['family']=='ar-limited-1':
    kind='error' if expected['errors'] or expected['classification'] in ('invalid-movement','structural-error') else 'movement' if expected['classification']=='movement' else 'blank' if expected['classification']=='blank' else 'header'
    eq(row['Kind'],kind,'retained legacy inventory Kind')
    require(bool(row['Error'])==(kind=='error'),'retained legacy inventory first Error')
   if new:
    iid=inventory_id(side,source,expected['physicalRow']);expected_inventory_ids.append(iid)
    eq(row['Inventory ID'],iid,'inventory identity')
    klass=expected['classification'];allowed={'detail-columns':{'legacy-header'} if source['family']=='ar-limited-1' else {'detail-header'},'movement':{'movement','detail'},'invalid-movement':{'error','detail'} if source['structuralError'] else {'error'},'structural-error':{'error'}}.get(klass,{klass})
    source_row_error=bool(expected['errors']) or any(e['row']==expected['physicalRow'] or e['row'] is None for e in source['errors'])
    require(row['Classification'] in allowed or (row['Classification']=='error' and source_row_error),'inventory original classification')
    expected_kind='error' if expected['errors'] or klass in ('invalid-movement','structural-error') else 'movement' if klass=='movement' else 'blank' if klass=='blank' else 'header'
    if row['Classification']=='error' and source_row_error:expected_kind='error'
    if source['structuralError'] and row['Classification']=='detail':expected_kind='error' if decoded(row['Errors JSON']) else 'header'
    eq(row['Kind'],expected_kind,'inventory financial eligibility Kind')
    # Product AR diagnostic codes differ from the preparation vocabulary.
    # Require retained error evidence; exact alias comparison needs a supplied
    # finite protocol mapping, never guessed from product implementation.
    exported_errors=decoded(row['Errors JSON'])
    require(isinstance(exported_errors,list),'inventory errors array')
    require(all(isinstance(e,str) and bool(e) for e in exported_errors),'inventory literal diagnostic code strings')
    eq(row['Error'],exported_errors[0] if exported_errors else '','first Error agrees with complete Errors JSON')
    if row['Classification']=='error' or row['Kind']=='error':require(exported_errors and row['Error'],'rejected row preserves diagnostics')
    elif not source['structuralError']:eq(exported_errors,[],'valid row has no invented diagnostic');eq(row['Error'],'','valid row first diagnostic')
    if source['family']=='ar-scope-details-1':eq(decoded(row['Line span JSON']) if row['Line span JSON'] else None,expected.get('lineSpan'),'inventory original line span')
    else:eq(row['Line span JSON'],'','legacy appended inventory line span remains unavailable')
  for rec in source['records']:
   mid=id_for(side,source,rec['physicalRow']);require(mid not in expected_records,'duplicate authoritative membership');expected_records[mid]=(side,source,rec)
 eq(len(movements),len(expected_records),'eligible original movement count')
 byid={r['Movement ID']:r for r in movements};eq(len(byid),len(movements),'unique movement ids');eq(set(byid),set(expected_records),'physical source membership')
 for mid,(side,source,rec) in expected_records.items():
  row=byid[mid]
  for k,v in {'Side':side,'Source row':rec['physicalRow'],'Posting ID':rec['postingId'],'Document type':rec['documentType'],'Own document number':rec['ownDocumentNumber'],'Posting date':rec['postingDate'],'Amount minor units':rec['amountMinor'],'Related invoice':rec['relatedInvoice'],'Description':rec['descriptionRaw']}.items():eq(row[k],scalar(v),'original movement '+k)
  eq(decoded(row['Related evidence JSON']),[rec['relatedInvoice']] if rec['relatedInvoice'] else [],'related negative evidence')
  if new:
   eq(row['Source family'],source['family'],'explicit family')
   if source['family']=='ar-scope-details-1':
    eq(row['Original signed amount raw'],rec['originalRaw'],'original amount raw cannot be open');eq(row['Open balance raw'],scalar(rec['openBalanceRaw']),'descriptive open raw');eq(row['Open balance role'],'descriptive-unverified','open role')
    eq(row['Parent scope ID'],rec['parentScopeId'],'explicit original parent')
    parent=decoded(row['Parent cell JSON']);eq(parent,parent_cell(rec),'original parent cell')
    inherited=decoded(row['Inherited source cells JSON'])
    expected=inherited_cells(source,rec)
    eq(inherited,expected,'five exact inherited source cells')
    inv=next(x for x in source['inventory'] if x['physicalRow']==rec['physicalRow'])
    eq(decoded(row['Line span JSON']) if row['Line span JSON'] else None,inv.get('lineSpan'),'movement original line span')
   else:
    for k in APPENDED['Movements'][1:]:eq(row[k],'','legacy appended fields remain blank')
 eq(integer(summary['Valid movements']),len(movements),'Summary eligible count')
 eq(integer(summary['Reading errors']),inventory_errors,'Summary inventory reading-error count')
 for side,key in enumerate(['Ledger total minor units','Statement total minor units']):eq(summary[key],scalar(oracle['totalsMinor'][side]),'original signed total')
 if new:
  eq(decoded(summary['Receipt allocations']),[],'no receipt allocation authority');eq(summary['Financial completeness asserted'],'false','no completeness authority')
  for side,key in enumerate(['Ledger total available','Statement total available']):eq(summary[key],scalar(oracle['totalsMinor'][side] is not None),'explicit total availability')
  refs=decoded(summary['Error inventory refs JSON']);require(isinstance(refs,list) and len(refs)==len(set(refs)),'unique diagnostic original refs')
  require(set(refs)<=set(expected_inventory_ids),'diagnostics reference retained original inventory')
  eq(decoded(summary['Source scopes JSON']),scopes_for(osources),'source header cells and original block boundaries')
  issues=decoded(summary['Source issues JSON']);require(isinstance(issues,list),'source issues array')
  for issue in issues:
   eq(set(issue),{'side','code','category','inventoryIds'},'source issue exact evidence fields');require(issue['side'] in (0,1) and isinstance(issue['code'],str) and issue['code'],'source issue identity')
   require(set(issue['inventoryIds'])<=set(refs),'source issue references diagnostic inventory only')
   require(all(i.startswith(str(issue['side'])+':') for i in issue['inventoryIds']),'issue refs original correct side')
  eq(set(refs),{r for i in issues for r in i['inventoryIds']},'all issue refs appear in Summary')
  for side,s in enumerate(osources):
   eq(bool([i for i in issues if i['side']==side]),bool(s['errors']),'source-level diagnostics agree with independent acceptance')
   cats={i['category'] for i in issues if i['side']==side};expected_cats={e['code'] for e in s['errors']}
   allowed=expected_cats | ({'repeated-or-late-header'} if 'data-after-end' in expected_cats else set())
   require(cats<=allowed,'source diagnostic categories independently supported by original')
   if s['errors']:require(cats & expected_cats,'retained independent source error category')
   # Compare explicit cause coordinates for categories the product retains.
   for e in s['errors']:
    if e['code'] in cats and e['row'] is not None:
     accepted={e['code']}
     if e['code']=='data-after-end':accepted.add('repeated-or-late-header')
     require(inventory_id(side,s,e['row']) in {r for i in issues if i['side']==side and i['category'] in accepted for r in i['inventoryIds']},'direct rejected original cause row retained')
   if 'total-bound' in cats:require({inventory_id(side,s,r['physicalRow']) for r in s['records']}<=set(refs),'all total-overflow contributor refs')
  require(set(bundle.get('_manualExpected',{}).get('requiredIssueCategories',[]))<={i['category'] for i in issues},'export preserves sealed manual required diagnostic categories')
 case_map={c['Case ID']:c for c in cases};eq(len(case_map),len(cases),'unique cases')
 ownership={}
 for member in members:
  mid=member['Movement ID'];require(mid in byid and mid not in ownership,'foreign/duplicate membership');cid=member['Case ID'];require(cid in case_map,'membership unknown case')
  eq([member['Side'],member['Source row']],[byid[mid]['Side'],byid[mid]['Source row']],'membership physical origin');ownership[mid]=cid
 eq(set(ownership),set(byid),'complete exactly-once financial membership')
 expected_groups=[]
 def convert(mid):
  side=0 if mid.startswith('left:') else 1;source=osources[side];return id_for(side,source,int(mid.rsplit(':',1)[1]))
 for pair in oracle['pairs']:expected_groups.append((frozenset([convert(pair['leftMember']),convert(pair['rightMember'])]),'matched','own-document','exact-own-document'))
 for case in oracle['cases']:
  mids=[convert(mid) for mid in case['leftMembers']+case['rightMembers']]
  if case['reason']=='source-errors' and mids:
   buckets={}
   for mid in mids:
    record=expected_records[mid][2];buckets.setdefault((record['documentType'],record['ownDocumentNumber']),[]).append(mid)
   expected_groups.extend((frozenset(group),'review','none','source-errors') for group in buckets.values())
  else:expected_groups.append((frozenset(mids),'review','none',case['reason']))
 actual_groups={cid:frozenset(mid for mid,c in ownership.items() if c==cid) for cid in case_map}
 require(len(set(actual_groups.values()))==len(actual_groups),'duplicate case membership groups')
 eq(set(actual_groups.values()),set(g[0] for g in expected_groups),'cases from original unique document facts')
 states={}
 for cid,group in actual_groups.items():
  _,status,basis,reason=next(g for g in expected_groups if g[0]==group);states[cid]=[status,basis,reason,'']
  case=case_map[cid];eq(integer(case['Member count']),len(group),'case member count')
  if new:eq(decoded(case['Error inventory refs JSON']),refs if reason=='source-errors' else [],'case rejected inventory separate from members')
  if group:
   keys={(byid[mid]['Document type'],byid[mid]['Own document number']) for mid in group}
   if len(keys)==1:eq((case['Document type'],case['Own document number']),next(iter(keys)),'case own document')
  else:eq((case['Document type'],case['Own document number']),('scope',''),'empty case scope identity')
 eq(len(decisions),len(session['events']),'all session events exported')
 for sequence,(row,event) in enumerate(zip(decisions,session['events']),1):
  eq(integer(row['Sequence']),sequence,'decision sequence')
  for k,ek in [('Context','context'),('Action','action'),('Note','note'),('Recorded at UTC','at')]:eq(row[k],event[ek],'literal session decision '+k)
  ids=decoded(row['Members JSON']);eq(ids,event['ids'],'decision ordered members')
  require(len(ids)==2 and len(set(ids))==2 and all(mid in ownership for mid in ids),'decision members')
  owners={ownership[mid] for mid in ids};require(len(owners)==1,'decision case ownership');cid=next(iter(owners));eq(frozenset(ids),actual_groups[cid],'decision complete member set')
  a,b=[byid[mid] for mid in sorted(ids,key=lambda x:integer(byid[x]['Side']))]
  eq([a['Side'],b['Side']],['0','1'],'decision one member per side')
  eq([a[k] for k in ['Document type','Own document number','Posting date','Amount minor units']],[b[k] for k in ['Document type','Own document number','Posting date','Amount minor units']],'decision remains exact original pair')
  require(not oracle['sources'][0]['errors'] and not oracle['sources'][1]['errors'],'decision cannot override source errors')
  action=event['action'];prior=states[cid][0]
  require((action=='reopen' and prior=='matched') or (action=='accept' and prior=='review'),'legal decision replay order')
  states[cid]=['review','none','reopened',event['note']] if action=='reopen' else ['matched','human-confirmation','human-confirmation',event['note']]
 for cid,expected in states.items():
  case=case_map[cid];actual=[case[k] for k in ['Status','Basis','Reason','Note']]
  # Original matching exports use existing UI reason 'exact-own-document'.
  eq(actual,expected,'case after independent decision replay')
  for mid in actual_groups[cid]:eq([byid[mid][k] for k in ['Case ID','Status','Basis']],[cid,expected[0],expected[1]],'movement replayed state')
 matched=sum(s[0]=='matched' for s in states.values());eq(integer(summary['Matched document pairs']),matched,'Summary replayed match count')
 return {'passed':True,'version':version,'oracleStatus':oracle['status'],'matchedPairs':matched,'movementCount':len(movements),'inventoryRows':[len(s['inventory']) for s in oracle['sources']],'eventCount':len(decisions),'tablesChecked':SHEETS}

def verify_session(session,bundle,oracle,originals):
 eq(set(session),{'format','version','files','readings','scope','events'},'session exact envelope, no derived cache')
 eq(session['format'],'tarasuf-ar-session','session format')
 new=any(f=='ar-scope-details-1' for f in bundle['families']);eq(session['version'],'ar-scope-details-1' if new else 'ar-limited-1','session explicit family version')
 eq(session['scope'],bundle['scope'],'original confirmed external scope');eq(len(session['files']),2,'two saved original files');eq(len(session['readings']),2,'two readings')
 require(type(session['scope']['confirmed']) is bool,'scope confirmation exact boolean')
 for side,(file,reading) in enumerate(zip(session['files'],session['readings'])):
  eq(set(file),{'name','sha256','data'},'session source exact fields');eq(file['sha256'],sha(originals[side]),'session original hash');eq(file['data'],base64.b64encode(originals[side]).decode(),'session exact original bytes')
  eq(reading.get('family','ar-limited-1'),bundle['families'][side],'session explicit source family');require(type(reading['confirmed']) is bool,'reading confirmation exact boolean');eq(reading['confirmed'],bundle['readingConfirmed'][side],'exact boolean reading confirmation')
  eq(reading['role'],ROLES[side],'reading source role');eq(reading['perspective'],'seller-receivable','reading seller perspective');eq(reading['basis'],'original-movement','reading original amount basis')
  require(type(reading['sheet']) is int,'sheet selection index is integer')
  if bundle['files'][side].lower().endswith('.csv'):eq(reading['sheet'],0,'CSV sheet selection')
  else:
   with zipfile.ZipFile(bundle['_directory']/bundle['files'][side]) as z:
    names=[s.get('name') for s in xml(z.read('xl/workbook.xml')).findall('m:sheets/m:sheet',NS)]
   eq(names[reading['sheet']],oracle['sources'][side]['sheet'],'explicit original native sheet')
  source=oracle['sources'][side]
  if source['family']=='ar-scope-details-1' and not source['structuralError']:
   header=source['scopeHeader']['detailHeaderRow'];cols=next(r['rawCells'] for r in source['inventory'] if r['physicalRow']==header)
   eq(reading['header'],header-1,'original detail header selection')
   for key,col in [('parent','Parent scope ID'),('posting','Posting ID'),('kind','Document type'),('document','Own document number'),('date','Posting date'),('amount',bundle.get('selectedAmountHeaders',['Original signed amount']*2)[side]),('related','Related invoice'),('open','Open balance'),('description','Description')]:
    eq(reading[key],cols.index(col) if col in cols else -1,'original column selection '+key)
 require(isinstance(session['events'],list) and len(session['events'])<=1000,'bounded session events')
 # The exact context algorithm is protocol-defined separately from product code.
 context=context_for(session)
 for event in session['events']:
  eq(set(event),{'context','action','ids','note','at'},'session event exact fields');eq(event['context'],context,'decision bound to exact original bytes/readings/scope')
  require(isinstance(event['note'],str) and 8<=len(event['note'].strip().encode('utf-16-le'))//2<=200,'decision note bounds')
  require(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z',event['at']) is not None,'decision UTC format')
  try:datetime.datetime.strptime(event['at'],'%Y-%m-%dT%H:%M:%S.%fZ')
  except ValueError:raise CheckFailure('decision invalid UTC calendar')
 return context

def verify(workbook,bundle_path,session_path,prep=DEFAULT_PREP):
 bundle,oracle=oracle_for(prep,bundle_path)
 bundle['_directory']=bundle_path.parent
 # The preparation oracle keeps correctly parsed originals as diagnostics after
 # an external wrong-amount reading. The product rejects that reading before
 # eligible detail construction. This conservative suppression has no financial
 # authority and is allowed only for this explicit wrong-role input, while every
 # original inventory cell, rejection and source byte remains mandatory.
 for side,header in enumerate(bundle.get('selectedAmountHeaders',['Original signed amount']*2)):
  if header!='Original signed amount':
   source=oracle['sources'][side];source['records']=[];source['totalMinor']=None;source['structuralError']=True
   oracle['totalsMinor'][side]=None;oracle['validRowCounts'][side]=0
 identical=oracle['sources'][0]['sha256']==oracle['sources'][1]['sha256']
 if identical:
  # Identical original bytes cannot represent two independent AR sources.
  # Reject before eligible financial construction on both sides, preserving the
  # full inventories and exact hash-backed same-source rejection evidence.
  for side,source in enumerate(oracle['sources']):
   source['records']=[];source['totalMinor']=None;source['structuralError']=True;oracle['totalsMinor'][side]=None;oracle['validRowCounts'][side]=0
 if identical or any(h!='Original signed amount' for h in bundle.get('selectedAmountHeaders',[])):
  oracle['cases']=[{'reason':'source-errors','leftMembers':[r['memberId'] for r in oracle['sources'][0]['records']],'rightMembers':[r['memberId'] for r in oracle['sources'][1]['records']]}]
 originals=[(bundle_path.parent/f).read_bytes() for f in bundle['files']]
 session=json.loads(session_path.read_text());verify_session(session,bundle,oracle,originals)
 report=verify_book(read_workbook(workbook),bundle,oracle,session,originals)
 report.update({'workbook':str(workbook),'workbookSHA256':sha(workbook.read_bytes()),'session':str(session_path),'sessionSHA256':sha(session_path.read_bytes()),'bundle':str(bundle_path),'checkerSHA256':sha(Path(__file__).read_bytes()),'oracleSHA256':sha((prep/'oracle/ar_oracle.py').read_bytes()),'contractSHA256':sha((prep/'CONTRACT.ar.md').read_bytes()),'syntheticOnly':True,'fieldOriginals':0})
 return report

def verify_claim(path,workbook,session_path):
 """Compare actual result/replay claims to the independently verified workbook.

Call only after verify() succeeded. This is consistency against independently
verified originals, never the use of the product result as an expectation.
"""
 claim=json.loads(path.read_text());session=json.loads(session_path.read_text());book=read_workbook(workbook)
 new=session['version']=='ar-scope-details-1';summary={r['Property']:r['Value'] for r in table(book,'Summary',HEADERS['Summary'])}
 for k,expected in [('version',session['version']),('readings',session['readings']),('scope',session['scope'])]:eq(claim[k],expected,'actual replay '+k)
 context=context_for(session)
 eq(claim['context'],context,'actual replay bound original request context')
 eq(claim['decimals'],integer(summary['Decimals']),'actual replay currency precision')
 source_table=table(book,'Sources',HEADERS['Sources'])
 expected_sources=[]
 for side in (0,1):
  row=next(r for r in source_table if integer(r['Side'])==side)
  expected_sources.append({'hash':row['Source SHA-256'],'name':row['Source name'],'sheet':row['Sheet'],'role':row['Role']})
 eq(claim['sources'],expected_sources,'actual replay bound original source identity')
 movement_rows=table(book,'Movements',HEADERS['Movements']+(APPENDED['Movements'] if new else []));eq(len(claim['rows']),len(movement_rows),'actual replay movement count')
 actualrows={r['id']:r for r in claim['rows']};eq(len(actualrows),len(claim['rows']),'actual replay unique members')
 for row in movement_rows:
  require(row['Movement ID'] in actualrows,'actual replay missing physical member');r=actualrows[row['Movement ID']]
  for column,key in [('Side','side'),('Source row','row'),('Posting ID','posting'),('Document type','kind'),('Own document number','document'),('Posting date','date'),('Amount minor units','amount'),('Related invoice','related'),('Description','description')]:eq(scalar(r[key]),row[column],'actual replay original '+key)
  eq(r['relatedEvidence'],decoded(row['Related evidence JSON']),'actual replay related evidence')
  if new and row['Source family']=='ar-scope-details-1':
   for column,key in [('Original signed amount raw','originalRaw'),('Open balance raw','openBalanceRaw'),('Open balance role','openBalanceRole'),('Parent scope ID','parentScopeId')]:eq(scalar(r[key]),row[column],'actual replay provenance '+key)
   eq(r['parentCell'],decoded(row['Parent cell JSON']),'actual replay parent cell');eq(r['inheritedSourceCells'],decoded(row['Inherited source cells JSON']),'actual replay inherited cells')
 cr=table(book,'Cases',HEADERS['Cases']+(APPENDED['Cases'] if new else []));mr=table(book,'Membership',HEADERS['Membership']);eq(len(claim['cases']),len(cr),'actual replay case count');bycase={x['id']:x for x in claim['cases']};eq(len(bycase),len(cr),'actual replay unique cases')
 for row in cr:
  require(row['Case ID'] in bycase,'actual replay missing case');case=bycase[row['Case ID']]
  for col,key in [('Document type','kind'),('Own document number','document'),('Status','status'),('Basis','basis'),('Reason','reason'),('Note','note')]:eq(case[key],row[col],'actual replay case '+key)
  eq(case['ids'],[x['Movement ID'] for x in mr if x['Case ID']==row['Case ID']],'actual replay exact case members')
 eq(claim['totals'],[int(summary[k]) if summary[k] else None for k in ['Ledger total minor units','Statement total minor units']],'actual replay exact original totals')
 if new:
  for key,col in [('sourceScopes','Source scopes JSON'),('sourceIssues','Source issues JSON'),('errorInventoryRefs','Error inventory refs JSON'),('receiptAllocations','Receipt allocations')]:eq(claim[key],decoded(summary[col]),'actual replay '+key)
  eq(claim['financialCompletenessAsserted'],False,'actual replay no completeness')
  expected_status='source-error' if claim['sourceIssues'] else 'matched' if cr and all(r['Status']=='matched' for r in cr) else 'review'
  eq(claim['status'],expected_status,'actual replay document status')
 expected_inventory=[]
 for side,name in enumerate(SHEETS[4:6]):
  rows=book[name];headers=rows[0]
  for row in rows[1:]:
   r=dict(zip(headers,row+['']*(len(headers)-len(row))));expected_inventory.append((side,integer(r['Source row']),r))
 eq(len(claim['inventory']),len(expected_inventory),'actual replay complete inventory')
 for actual,(side,n,row) in zip(claim['inventory'],expected_inventory):
  eq((actual['side'],actual['row']),(side,n),'actual replay original inventory row')
  raw=actual['values'];cols=[k for k in row if k.startswith('Original column ')]
  eq(raw+['']*(len(cols)-len(raw)),[row[k] for k in cols],'actual replay untouched inventory cells')
  eq(actual['kind'],row['Kind'],'actual replay inventory eligibility')
  if new:eq(actual['inventoryId'],row['Inventory ID'],'actual replay inventory ID');eq(actual['classification'],row['Classification'],'actual replay classification')
 return {'passed':True,'file':str(path),'sha256':sha(path.read_bytes()),'scope':'actual claim and replay consistency with independently checked exported originals'}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('workbook',type=Path);p.add_argument('--bundle',type=Path,required=True);p.add_argument('--session',type=Path,required=True);p.add_argument('--prep',type=Path,default=DEFAULT_PREP);p.add_argument('--output',type=Path);a=p.parse_args()
 try:report=verify(a.workbook,a.bundle,a.session,a.prep)
 except (CheckFailure,ValueError,KeyError,TypeError,OSError,zipfile.BadZipFile,E.ParseError) as error:
  report={'passed':False,'error':str(error),'errorType':type(error).__name__,'workbook':str(a.workbook)}
 rendered=json.dumps(report,ensure_ascii=False,indent=2)+'\n'
 if a.output:a.output.write_text(rendered)
 print(rendered,end='');return 0 if report['passed'] else 1
if __name__=='__main__':sys.exit(main())
