"""Synthetic B2.2 originals and Decimal endpoint facts, frozen before engine code."""
import csv,json,hashlib,copy
from pathlib import Path
from decimal import Decimal
ROOT=Path(__file__).parent/'frozen';ROOT.mkdir(parents=True,exist_ok=True)
b=json.loads(Path('audit/bank/frozen/expected.json').read_text());s=b['scope'];scope=list(s.values());opening='2026-08-31';closing=s['end']
LH=['Item ID','Point','Adjust side','Evidence ID','Amount','Explanation','Entity','Ledger','Bank account','Currency','Period start','Period end']
PH=['Evidence ID','Lifecycle ID','Kind','Source side','Record ID','Movement date','Value date','Document reference','Entity','Ledger','Bank account','Currency','Period start','Period end','Signed amount']
BH=['Record ID','Balance kind','As of','Entity','Ledger','Bank account','Currency','Period start','Period end','Balance basis','Status','Amount']
def amt(n):return format(Decimal(n)/100,'.2f')
def movement(side,ref,minor,date='2026-09-20',value='2026-10-02'):
 return [ref,'GROUP-'+ref,date,value,'inflow' if minor>0 else 'outflow','principal','','','individual','posted' if side else 'booked',*scope,amt(abs(minor))]
def proof(pid='P1',life='L1',kind='timing',side='cashbook',record='C1',date='2026-09-20',minor=-10000,value='2026-10-02'):
 return [pid,life,kind,side,record,date,value,'DOC-'+pid,*scope,amt(minor)]
def item(ref='I1',point='closing',side='bank',pid='P1',minor=-10000):return [ref,point,side,pid,amt(minor),'Explicit original evidence '+pid,*scope]
def model(kind='empty'):
 m=[[],[]];o=[200000,200000];p=[];l=[]
 if kind=='closing-out':m[1]=[movement(1,'C1',-10000)];p=[proof()];l=[item()]
 if kind=='closing-in':m[0]=[movement(0,'B1',10000)];p=[proof(side='bank',record='B1',minor=10000)];l=[item(side='cashbook',minor=10000)]
 if kind in ['carry','cleared']:
  o[1]=190000;p=[proof(record='OLD1',date='2026-08-20',value='2026-08-20')];l=[item('I-open','opening')]
  if kind=='carry':l.append(item('I-close','closing'))
  else:m[0]=[movement(0,'B-clear',-10000,date='2026-09-10',value='2026-09-10')];p.append(proof('P-clear','L1','settlement','bank','B-clear','2026-09-10',-10000,'2026-09-10'))
 if kind=='correction':o[1]=199900;p=[proof(kind='cashbook-error',record='BOOK-ERR',date='2026-08-20',minor=100,value='2026-08-20')];l=[item('I-open','opening','cashbook',minor=100),item('I-close','closing','cashbook',minor=100)]
 totals=[sum((int(Decimal(r[-1])*100) if r[4]=='inflow' else -int(Decimal(r[-1])*100)) for r in rows) for rows in m]
 return dict(movements=m,opening=o,closing=[o[i]+totals[i] for i in [0,1]],proofs=p,items=l)
cases=[]
def paired_clear(x,undone=False):
 x['movements']=[[movement(0,'B-clear',10000,'2026-09-10','2026-09-10')],[movement(1,'C-clear',10000,'2026-09-10','2026-09-10')]]
 for rows in x['movements']:rows[0][1]='CLEAR'
 if not undone:x['movements'][0][0][5]='periodic-fee'
 x['closing']=[210000,210000]
 x['proofs']=[proof('OLD-C','LC','timing','cashbook','HIST-C','2026-08-20',10000,'2026-08-20'),proof('OLD-B','LB','timing','bank','HIST-B','2026-08-20',10000,'2026-08-20'),proof('CLEAR-B','LC','settlement','bank','B-clear','2026-09-10',10000,'2026-09-10'),proof('CLEAR-C','LB','settlement','cashbook','C-clear','2026-09-10',10000,'2026-09-10')]
 x['items']=[item('OPEN-C','opening','bank','OLD-C',10000),item('OPEN-B','opening','cashbook','OLD-B',10000)]
 x['bankActions']=['undo'] if undone else []
def add(name,kind='empty',edit=None,invalid=False,actions=None,expect=None):
 x=model(kind)
 if edit:edit(x)
 files=[];rows=[*x['movements'],*[[[f'{i}-open','opening',opening,*scope,'movement-date','posted' if i else 'booked',amt(x['opening'][i])],[f'{i}-close','closing',closing,*scope,'movement-date','posted' if i else 'booked',amt(x['closing'][i])]] for i in [0,1]],x['items'],x['proofs']]
 headers=[b['headers'],b['headers'],BH,BH,LH,PH]
 for i,(head,data) in enumerate(zip(headers,rows)):
  file=f'{name}-{i}.csv';p=ROOT/file
  with p.open('w',newline='') as f:csv.writer(f,lineterminator='\n').writerows([head,*data])
  files.append(dict(file=file,sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
 actions=actions if actions is not None else ['accept'] if x['items'] else []
 accepted=bool(actions and actions[-1]=='accept')
 adjustment={point:[0,0] for point in ['opening','closing']}
 if accepted and not invalid:
  for r in x['items']:
   if any(r):adjustment[r[1]][0 if r[2]=='bank' else 1]+=int(Decimal(r[4])*100)
 raw={point:x[point][:] for point in ['opening','closing']}
 adjusted={point:[raw[point][i]+adjustment[point][i] for i in [0,1]] for point in raw}
 differences={point:adjusted[point][0]-adjusted[point][1] for point in raw}
 totals=[sum((int(Decimal(r[-1])*100) if r[4]=='inflow' else -int(Decimal(r[-1])*100)) for r in data) for data in x['movements']]
 residual=[raw['opening'][i]+totals[i]-raw['closing'][i] for i in [0,1]]
 status=expect or ('source-error' if invalid else 'needs-review' if x['items'] and not accepted else 'inconsistent' if any(differences.values()) or any(residual) else 'reconciled-with-evidence')
 cases.append(dict(name=name,bankActions=x.get('bankActions',[]),files=files,actions=actions,invalid=invalid,status=status,raw=raw,adjustments=None if invalid else adjustment,adjusted=None if invalid else adjusted,differences=None if invalid else differences,residual=residual,movements=totals,itemIds=[r[0] for r in x['items']],proofIds=[r[0] for r in x['proofs']],itemRows=x['items'],proofRows=x['proofs']))
add('equal-empty')
add('closing-outflow','closing-out')
add('closing-inflow','closing-in')
add('old-carried','carry')
add('old-cleared','cleared')
add('old-correction-carried','correction')
add('pending','closing-out',actions=[])
add('undo','closing-out',actions=['accept','undo'])
add('reject','closing-out',actions=['reject'])
add('reject-undo-accept','closing-out',actions=['reject','undo','accept'])
add('carry-undo','carry',actions=['accept','undo'])
add('wrong-adjust-side','closing-out',lambda x:x['items'][0].__setitem__(2,'cashbook'),True)
add('amount-not-proof','closing-out',lambda x:x['items'][0].__setitem__(4,'-99.99'),True)
add('blank-evidence','closing-out',lambda x:x['items'][0].__setitem__(3,''),True)
add('duplicate-item','closing-out',lambda x:x['items'].append(copy.deepcopy(x['items'][0])),True)
add('malformed-competing-item','closing-out',lambda x:(x['items'].append(copy.deepcopy(x['items'][0])),x['items'][-1].__setitem__(4,'broken')),True)
add('duplicate-proof','closing-out',lambda x:x['proofs'].append(copy.deepcopy(x['proofs'][0])),True)
add('malformed-competing-proof','closing-out',lambda x:(x['proofs'].append(copy.deepcopy(x['proofs'][0])),x['proofs'][-1].__setitem__(14,'broken')),True)
add('item-scope-mismatch','closing-out',lambda x:x['items'][0].__setitem__(8,'BANK-OTHER'),True)
add('proof-scope-mismatch','closing-out',lambda x:x['proofs'][0].__setitem__(10,'BANK-OTHER'),True)
add('unlisted-old-closing','carry',lambda x:x['items'].pop(0),True)
add('missing-clearing-proof','cleared',lambda x:x['proofs'].pop(),True)
add('wrong-clearing-sign','cleared',lambda x:x['proofs'][-1].__setitem__(14,'100.00'),True)
add('wrong-clearing-record','cleared',lambda x:x['proofs'][-1].__setitem__(4,'UNKNOWN'),True)
add('wrong-current-record','closing-out',lambda x:x['proofs'][0].__setitem__(4,'UNKNOWN'),True)
add('wrong-current-date','closing-out',lambda x:x['proofs'][0].__setitem__(5,'2026-09-21'),True)
add('zero-adjustment','closing-out',lambda x:(x['items'][0].__setitem__(4,'0.00'),x['proofs'][0].__setitem__(14,'0.00')),True)
add('unknown-fee-kind','closing-out',lambda x:x['proofs'][0].__setitem__(2,'assumed-fee'),True)
add('unused-proof','closing-out',lambda x:x['proofs'].append(proof('UNUSED','L-unused')),True)
add('proof-reuse','closing-out',lambda x:x['items'].append(item('I2',pid='P1')),True)
add('movement-reuse','closing-out',lambda x:(x['proofs'].append(proof('P2','L2')),x['items'].append(item('I2',pid='P2'))),True)
add('own-bridge-gap','closing-out',lambda x:x['closing'].__setitem__(0,x['closing'][0]+1),expect='inconsistent')
add('uncovered-movement','closing-out',lambda x:(x['items'].clear(),x['proofs'].clear()),expect='inconsistent')
add('unresolved-equal-net','empty',lambda x:(x['movements'][0].extend([movement(0,'B-in',10000),movement(0,'B-out',-10000)])),expect='needs-review')
add('blank-inventory','closing-out',lambda x:(x['items'].append(['']*len(LH)),x['proofs'].append(['']*len(PH))))
cases[-1]['itemIds']=['I1'];cases[-1]['proofIds']=['P1']
add('isolated-own-bridge-gap','empty',lambda x:(x['closing'].__setitem__(0,200001),x['proofs'].append(proof('P-gap','L-gap','bank-error','bank','ERR','2026-09-20',-1,'2026-09-20')),x['items'].append(item('I-gap','closing','bank','P-gap',-1))),expect='inconsistent')
add('settlement-cannot-hide-policy','empty',lambda x:paired_clear(x),expect='needs-review')
add('settlement-cannot-hide-undo','empty',lambda x:paired_clear(x,True),expect='needs-review')
add('changed-carry-proof','carry',lambda x:(x['proofs'].append(proof('P2','L1',record='OLD2',date='2026-08-20',value='2026-08-20')),x['items'][1].__setitem__(3,'P2')),True)
add('wrong-value-date','closing-out',lambda x:x['proofs'][0].__setitem__(6,'2026-10-03'),True)
add('wrong-clearing-date','cleared',lambda x:x['proofs'][-1].__setitem__(5,'2026-09-11'),True)
add('wrong-clearing-side','cleared',lambda x:x['proofs'][-1].__setitem__(3,'cashbook'),True)
add('positive-adjusted-overflow','correction',lambda x:(x.__setitem__('opening',[10**14,10**14]),x.__setitem__('closing',[10**14,10**14])))
cases[-1]['reject']='ADJUSTMENT_SUM'
add('negative-adjusted-overflow','correction',lambda x:(x.__setitem__('opening',[-10**14,-10**14]),x.__setitem__('closing',[-10**14,-10**14]),x['proofs'][0].__setitem__(14,'-1.00'),[r.__setitem__(4,'-1.00') for r in x['items']]))
cases[-1]['reject']='ADJUSTMENT_SUM'
add('carry-with-future-value','carry',lambda x:x['proofs'][0].__setitem__(6,'2026-10-02'))
add('settlement-before-original-value','cleared',lambda x:x['proofs'][0].__setitem__(6,'2026-10-02'),True)
expected=dict(version='bank-adjustment-ledger-1',sample='synthetic-not-field',scope=s,openingAsOf=opening,closingAsOf=closing,headers=[LH,PH],cases=cases)
(ROOT/'expected.json').write_text(json.dumps(expected,indent=2)+'\n');print(len(cases),'cases',len(cases)*6,'CSV originals')
# Child-workpaper facts are computed from originals, not from the product.
bankcases=[];balancecases=[]
for c in cases:
 records=[];inventory=[];groups=[];timing=[]
 for side,f in enumerate(c['files'][:2]):
  rows=list(csv.reader((ROOT/f['file']).open()))
  for index,row in enumerate(rows,1):
   inventory.append(dict(side=side,row=index,kind='header' if index==1 else 'movement'))
   if index==1:continue
   minor=int(Decimal(row[16])*100);signed=minor if row[4]=='inflow' else -minor
   record=dict(side=side,row=index,reference=row[0],settlement=row[1],movementDate=row[2],valueDate=row[3],direction=row[4],role=row[5],parent=row[6],reverses=row[7],policy=row[8],amount=minor,signed=signed);records.append(record)
   pass # Groups below use whole source membership, including paired policy competitors.
   if row[3]<s['start'] or row[3]>s['end']:timing.append(dict(side=side,row=index,reference=row[0],movementDate=row[2],valueDate=row[3],outsidePeriod=True,validMovement=True))
 for key in dict.fromkeys(r['settlement'] for r in records):
  members=[r for r in records if r['settlement']==key];bank=[r for r in members if r['side']==0];cash=[r for r in members if r['side']==1];bm=sum(r['signed'] for r in bank);cm=sum(r['signed'] for r in cash)
  eligible=len(bank)==len(cash)==1 and bank[0]['role']==cash[0]['role'] and bank[0]['direction']==cash[0]['direction'] and bm==cm
  reason='explicit-identity' if eligible else 'missing-counterpart' if not bank or not cash else 'policy-members'
  groups.append(dict(key=key,bank=[r['reference'] for r in bank],cash=[r['reference'] for r in cash],bankMinor=bm,cashMinor=cm,deltaMinor=bm-cm,status='matched-evidence' if eligible else 'needs-review',reason=reason,eligible=eligible))
 actions=[dict(type=t,bank=['B-clear'],cash=['C-clear'],expectedStatus='needs-review') for t in c['bankActions']]
 bc=dict(name=c['name'],files=c['files'][:2],records=records,inventory=inventory,groups=groups,actions=actions,timingItems=timing,sourceError=False);bankcases.append(bc)
 br=[];bi=[]
 for side,f in enumerate(c['files'][2:4]):
  rows=list(csv.reader((ROOT/f['file']).open()))
  for index,row in enumerate(rows,1):
   bi.append(dict(side=side,row=index,kind='header' if index==1 else row[1]))
   if index>1:br.append(dict(side=side,row=index,reference=row[0],kind=row[1],asOf=row[2],amount=int(Decimal(row[11])*100)))
 components=[dict(opening=c['raw']['opening'][side],closing=c['raw']['closing'][side],movement=c['movements'][side],residual=c['residual'][side]) for side in [0,1]]
 diff={point:c['raw'][point][0]-c['raw'][point][1] for point in ['opening','closing']}
 balancecases.append(dict(name=c['name'],bankCase=c['name'],files=c['files'][2:4],records=br,inventory=bi,missing=[],components=components,differences=diff,status='inconsistent' if any(diff.values()) or any(c['residual']) else 'balances-consistent',timingItems=len(timing),bankTruth=dict(case=c['name'],records=records,groups=groups,actions=actions,timingItems=timing,sourceError=False)))
bankprofile=dict(sample='synthetic-not-field',version=b['version'],scope=s,headers=b['headers'],cases=bankcases)
(ROOT/'expected-bank.json').write_text(json.dumps(bankprofile,indent=2)+'\n');bankhash=hashlib.sha256((ROOT/'expected-bank.json').read_bytes()).hexdigest()
for c in balancecases:c['bankTruth']['sha256']=bankhash
(ROOT/'expected-balance.json').write_text(json.dumps(dict(version='bank-balance-evidence-1',sample='synthetic-not-field',scope=s,openingAsOf=opening,closingAsOf=closing,headers=BH,cases=balancecases),indent=2)+'\n')
print('Child facts frozen for',len(cases),'B1/B2.1 workpapers')
