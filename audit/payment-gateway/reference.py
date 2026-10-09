"""Independent, pre-engine CSV/Decimal reference for the declared one-batch family."""
import csv,io,json,re,unicodedata,hashlib,collections
from pathlib import Path
from decimal import Decimal
from datetime import date,datetime
ROOT=Path(__file__).parent
VERSION='payment-gateway-batch-1'
ROLES=['transactions','fee-evidence','settlement','payout']
CLAIM='Consistency of supplied sales, refunds and independently evidenced fees with one gateway settlement and bank credit only; no posting, revenue recognition, fee legitimacy, source authenticity or completeness opinion'
LIMIT=10**14
PRECISION={'SAR':2,'JPY':0,'KWD':3}
def identity(v,strict=True,limit=500):
 if not isinstance(v,str) or not v or v!=v.strip() or len(v.encode('utf-16-le'))//2>limit or any(unicodedata.category(c) in ['Cc','Cf'] for c in v) or strict and re.match(r'^[=+@-]|^#(?:REF!|VALUE!|N/A|DIV/0!)',v,re.I):raise ValueError('IDENTITY')
 return v
def day(v):
 if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',v):raise ValueError('DATE')
 try:assert date.fromisoformat(v).isoformat()==v
 except (ValueError,AssertionError):raise ValueError('DATE')
 return v
def money(v,dec):
 v=v.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789')).replace('٫','.')
 if not re.fullmatch(r'\d+(?:\.\d+)?',v) or '.' in v and len(v.split('.')[1])>dec:raise ValueError('AMOUNT')
 n=Decimal(v)*10**dec
 if n!=n.to_integral_value() or n>LIMIT:raise ValueError('AMOUNT')
 return int(n)
def validate_scope(scope):
 conf=json.loads((ROOT/'frozen/expected.json').read_text())
 if not isinstance(scope,dict) or set(scope)!=set(conf['scopeFields']):raise ValueError('SCOPE')
 for k in conf['scopeFields']:identity(scope[k])
 if scope['currency'] not in PRECISION:raise ValueError('CURRENCY')
 if scope['currencyBasis']!='functional' or scope['fxPolicy']!='same-currency-no-conversion' or day(scope['start'])>day(scope['end']) or day(scope['asOf'])!=scope['end']:raise ValueError('SCOPE')
def physical_ids(tables,hashes):
 return [json.dumps([VERSION,src,hashes[src],0,row],separators=(',',':')) for src,tab in enumerate(tables) for row,raw in enumerate(tab,1) if row>1 and any(v.strip() for v in raw)]
def validate_metadata(readings,complete,scope_confirmed):
 if scope_confirmed is not True:raise ValueError('SCOPE')
 if not isinstance(readings,list) or len(readings)!=4:raise ValueError('INPUT')
 for src,r in enumerate(readings):
  if not isinstance(r,dict) or set(r)!=set(['sheet','role','family','confirmed']) or type(r['sheet']) is not int or r['sheet']!=0 or r['role']!=ROLES[src] or r['family']!=VERSION or r['confirmed'] is not True:raise ValueError('READING')
 if not isinstance(complete,dict) or set(complete)!=set(['confirmed','reference','note']) or type(complete['confirmed']) is not bool or not isinstance(complete['reference'],str) or not isinstance(complete['note'],str):raise ValueError('COMPLETENESS')
 if complete['confirmed'] or complete['reference']:identity(complete['reference'],False,2000)
 if complete['confirmed'] or complete['note']:identity(complete['note'],False,2000)
def review_events(result,scope,hashes,readings,complete,events,tables,scope_confirmed=True):
 validate_scope(scope)
 validate_metadata(readings,complete,scope_confirmed)
 context=json.dumps([VERSION,hashes,readings,{**scope,'confirmed':True},complete],ensure_ascii=False,separators=(',',':'))
 review='needs-review';seen=set();members=physical_ids(tables,hashes)
 if isinstance(events,list) and all(isinstance(e,dict) and isinstance(e.get('memberIds'),list) for e in events) and sum(len(e['memberIds']) for e in events)>100000:raise ValueError('EVENT_CAPACITY')
 if not isinstance(events,list) or len(events)>1000:raise ValueError('INPUT')
 for e in events:
  if not isinstance(e,dict) or set(e)!=set(['id','type','batchId','memberIds','context','at','reference','note']) or e['type'] not in ['accept','reject','undo'] or not isinstance(e['memberIds'],list) or len(e['memberIds'])>20000 or not all(isinstance(v,str) for v in e['memberIds']):raise ValueError('EVENT')
  identity(e['id']);identity(e['batchId']);identity(e['reference'],False,2000);identity(e['note'],False,2000)
  for v in e['memberIds']:identity(v)
  if e['id'] in seen:raise ValueError('EVENT_ID')
  seen.add(e['id'])
  if e['batchId']!=scope['batchId']:raise ValueError('EVENT_BATCH')
  if e['context']!=context:raise ValueError('EVENT_CONTEXT')
  try:
   assert re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z',e['at'])
   assert datetime.fromisoformat(e['at'].replace('Z','+00:00')).isoformat(timespec='milliseconds').replace('+00:00','Z')==e['at']
  except (ValueError,AssertionError,TypeError):raise ValueError('EVENT_DATE')
  if not members or len(e['memberIds'])!=len(members) or len(set(e['memberIds']))!=len(e['memberIds']) or set(e['memberIds'])!=set(members):raise ValueError('EVENT_MEMBERS')
  if e['type']=='accept' and (result['financial']!='ready' or not complete['confirmed']):raise ValueError('EVENT_FINANCIAL')
  if e['type']=='undo':
   if review=='needs-review':raise ValueError('EVENT_STATE')
   review='needs-review'
  else:
   if review!='needs-review':raise ValueError('EVENT_STATE')
   review='accepted' if e['type']=='accept' else 'rejected'
 return dict(review=review,status=result['financial'] if result['financial']!='ready' else 'consistent-with-evidence' if complete['confirmed'] and review=='accepted' else 'needs-review',context=context,memberIds=members)
def evaluate(tables,scope,hashes):
 validate_scope(scope)
 conf=json.loads((ROOT/'frozen/expected.json').read_text());heads=conf['sourceHeaders'];fields=conf['scopeFields'];sh=conf['scopeHeaders'];dec=PRECISION[scope['currency']]
 if any(len(v.encode('utf-16-le'))//2>32767 for tab in tables for r in tab for v in r):raise ValueError('CELL_LIMIT')
 records=[[],[],[],[]];issues=[];missing=[];cells=[];inventory=[]
 def problem(code,src,row,key=''):issues.append(dict(code=code,source=src,row=row,key=key))
 def absent(kind):
  if kind not in missing:missing.append(kind)
 for src,tab in enumerate(tables):
  head=tab[0] if tab else [];ok=len(head)==len(heads[src]) and set(head)==set(heads[src]);col={h:i for i,h in enumerate(head)}
  for rn,raw in enumerate(tab,1):
   cells.extend(dict(source=src,row=rn,column=i+1,field=head[i] if i<len(head) else '',text=v) for i,v in enumerate(raw))
   kind='header' if rn==1 else 'blank' if not any(v.strip() for v in raw) else ROLES[src]
   inventory.append(dict(source=src,row=rn,kind=kind,errors=[]))
   if not ok:problem('COLUMNS',src,rn);continue
   if rn==1 or kind=='blank':continue
   try:
    if len(raw)!=len(head):raise ValueError('COLUMNS')
    get=lambda h:raw[col[h]]
    if any(get(h)!=scope[k] for h,k in zip(sh,fields)):raise ValueError('ROW_SCOPE')
    base=[get(h) for h in heads[src][:-len(sh)]]
    if src==0:
     identity(base[0]);identity(base[4],False,2000)
     if base[1] not in ['sale','refund']:raise ValueError('KIND')
     if not scope['start']<=day(base[2])<=scope['end']:raise ValueError('PERIOD')
     base[3]=money(base[3],dec)
    elif src==1:
     identity(base[0]);identity(base[1]);identity(base[3],False,2000);base[2]=money(base[2],dec)
     if day(base[4])>scope['start'] or day(base[5])<scope['end'] or base[4]>base[5]:raise ValueError('VALIDITY')
    elif src==2:
     identity(base[0]);identity(base[6]);identity(base[7],False,2000)
     if not scope['start']<=day(base[1])<=scope['end']:raise ValueError('PERIOD')
     for i in range(2,6):base[i]=money(base[i],dec)
    else:
     identity(base[0]);identity(base[3],False,2000)
     if not scope['start']<=day(base[1])<=scope['end']:raise ValueError('PERIOD')
     base[2]=money(base[2],dec)
    rid=json.dumps([VERSION,src,hashes[src],0,rn],separators=(',',':'))
    records[src].append(dict(id=rid,source=src,row=rn,values=base))
   except ValueError as e:problem(str(e),src,rn)
  if ok:
   names=[heads[src][0]]+(['Fee ID'] if src==1 else [])
   for name in names:
    groups=collections.defaultdict(list)
    for rn,r in enumerate(tab[1:],2):
     value=r[col[name]] if col[name]<len(r) else ''
     if value and value==value.strip():groups[value].append(rn)
    for value,rows in groups.items():
     if len(rows)>1:
      for rn in rows:problem('DUPLICATE',src,rn,json.dumps([name,value],separators=(',',':')))
 for src in [2,3]:
  count=sum(any(v.strip() for v in r) for r in tables[src][1:])
  if count>1:problem('CARDINALITY',src,0)
 for src in [0,2,3]:
  if not records[src]:absent(ROLES[src])
 if len(records[2])==1 and records[2][0]['values'][4]>0 and not records[1]:absent('fee-evidence')
 if len(records[2])==1 and len(records[3])==1 and records[2][0]['values'][6]!=records[3][0]['values'][0]:problem('PAYOUT_LINK',3,records[3][0]['row'])
 sums=[sum(r['values'][3] for r in records[0] if r['values'][1]=='sale'),sum(r['values'][3] for r in records[0] if r['values'][1]=='refund'),sum(r['values'][2] for r in records[1])]
 totals=sums+[sums[0]-sums[1]-sums[2]]
 if any(abs(x)>LIMIT for x in totals):problem('TOTAL_BOUND',0,0)
 difference=False;residuals=None
 if not issues and len(records[2])==1 and len(records[3])==1:
  settle=records[2][0]['values'];payout=records[3][0]['values'];residuals=[totals[i]-settle[2+i] for i in range(4)]+[settle[5]-payout[2]]
  if any(abs(x)>LIMIT for x in residuals):problem('RESIDUAL_BOUND',2,records[2][0]['row'])
  difference=any(residuals)
 for inv in inventory:
  inv['errors']=sorted(set(i['code'] for i in issues if i['source']==inv['source'] and i['row']==inv['row']))
  if inv['errors']:inv['kind']='invalid'
 return dict(records=records,issues=issues,missing=missing,cells=cells,inventory=inventory,totals=None if issues else totals,residuals=None if issues else residuals,financial='source-error' if issues else 'missing' if missing else 'difference' if difference else 'ready')
def main():
 p=ROOT/'frozen/expected.json';j=json.loads(p.read_text())
 for c in j['cases']:
  tables=[list(csv.reader(io.StringIO((ROOT/'frozen'/f['file']).read_text()))) for f in c['files']]
  try:r=evaluate(tables,c['scope'],[f['sha256'] for f in c['files']])
  except ValueError as e:
   assert c['status']=='throws:'+str(e),(c['name'],str(e));continue
  actual='needs-review' if r['financial']=='ready' else r['financial']
  if actual=='needs-review' and c['complete'] and c['actions'] and c['actions'][-1]=='accept':actual='consistent-with-evidence'
  assert actual==c['status'],(c['name'],actual,c['status'])
  assert r['totals']==c['totals'],(c['name'],r['totals'],c['totals'])
  assert set(c['issues'])==set(i['code'] for i in r['issues']),(c['name'],r['issues'],c['issues'])
  assert set(c['missing']).issubset(r['missing']),(c['name'],r['missing'])
  c['expected']=r
 p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
 print(len(j['cases']),'manual pre-engine truths independently checked and sealed')
if __name__=='__main__':main()
