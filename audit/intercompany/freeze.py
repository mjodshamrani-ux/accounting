"""Independent Decimal financial facts and byte originals, before any engine."""
import csv,json,hashlib,copy
from decimal import Decimal
from pathlib import Path
ROOT=Path(__file__).parent;F=ROOT/'frozen';F.mkdir(exist_ok=True)
S=dict(entityA='Synthetic Entity A',entityB='Synthetic Entity B',ledgerA='Book A',ledgerB='Book B',accountA='001',accountB='901',dimensionsA='department=01',dimensionsB='department=09',currency='SAR',currencyBasis='functional',fxPolicy='same-currency-no-conversion',postingStatus='posted',postingLayer='actual',start='2026-09-01',end='2026-09-30',asOf='2026-09-30',policyVersion='IC-1')
SH=['Entity A','Entity B','Ledger A','Ledger B','Account A','Account B','Dimensions A','Dimensions B','Currency','Currency basis','FX policy','Posting status','Posting layer','Period start','Period end','As of','Policy version']
COMMON=SH[8:]
HEAD=[['Entity','Counterparty','Ledger','Account ID','Complete dimensions','Transaction ID','Counterparty transaction ID','Posting date','Debit','Credit',*COMMON]]*2
HEAD=copy.deepcopy(HEAD)+[['Relation ID','Left transaction ID','Right transaction ID','Left account','Left dimensions','Right account','Right dimensions','Left posting date','Right posting date','Valid from','Valid to','Relationship reference',*SH],['Evidence ID','Side','Transaction ID','Counterparty transaction ID','Counterparty posting date','Expected counterparty amount','Timing reference',*SH]]
ROLES=['left-ledger','right-ledger','relationship-evidence','timing-evidence']
def model():
 a=[];b=[];r=[];scope=list(S.values());common=scope[8:]
 for n,d,c in [('001','100.00','0.00'),('002','0.00','30.00'),('003','0.00','0.00')]:
  aid='A-'+n;bid='B-'+n;ad='2026-09-10';bd='2026-09-11'
  a.append([S['entityA'],S['entityB'],S['ledgerA'],S['accountA'],S['dimensionsA'],aid,bid,ad,d,c,*common]);b.append([S['entityB'],S['entityA'],S['ledgerB'],S['accountB'],S['dimensionsB'],bid,aid,bd,c,d,*common]);r.append(['R-'+n,aid,bid,S['accountA'],S['dimensionsA'],S['accountB'],S['dimensionsB'],ad,bd,'2026-01-01','2026-12-31','Independent reciprocal document '+n,*scope])
 return dict(scope=copy.deepcopy(S),headers=copy.deepcopy(HEAD),rows=[a,b,r,[]],complete=True)
cases=[]
def change_scope(x,k,v):
 i=list(S).index(k);x['scope'][k]=v
 for s,rows in enumerate(x['rows']):
  for r in rows:
   if s<2 and i>=8:r[10+i-8]=v
   elif s>=2:r[len(HEAD[s])-len(S)+i]=v
 if i<8:
  side=0 if k.endswith('A') else 1;column={'entity':0,'ledger':2,'account':3,'dimensions':4}[k[:-1]]
  for r in x['rows'][side]:r[column]=v
  if k.startswith('entity'):
   for r in x['rows'][1-side]:r[1]=v
  if k.startswith('account'):
   for r in x['rows'][2]:r[3 if side==0 else 5]=v
  if k.startswith('dimensions'):
   for r in x['rows'][2]:r[4 if side==0 else 6]=v

def cents(v,dec):
 v=v.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789')).replace('٫','.');n=Decimal(v)*(10**dec);assert n==n.to_integral_value();return int(n)
def facts(x,status,actions):
 if status in ['source-error'] :return None
 dec={'SAR':2,'JPY':0,'KWD':3}.get(x['scope']['currency'],2)
 entries=[]
 for side in [0,1]:
  entries.append([dict(transactionId=r[5],counterpartyTransactionId=r[6],account=r[3],dimensions=r[4],date=r[7],debit=cents(r[8],dec),credit=cents(r[9],dec),net=cents(r[8],dec)-cents(r[9],dec),row=i+2) for i,r in enumerate(x['rows'][side]) if any(r)])
 groups=[]
 for i,r in enumerate(x['rows'][2]):
  left=next((e for e in entries[0] if e['transactionId']==r[1]),None);right=next((e for e in entries[1] if e['transactionId']==r[2]),None)
  timing=[dict(id=t[0],side=t[1],transactionId=t[2],counterpartyTransactionId=t[3],date=t[4],amount=cents(t[5],dec),row=j+2) for j,t in enumerate(x['rows'][3]) if any(t) and t[2] in [r[1],r[2]]]
  review='needs-review'
  for action in actions:
   kind,target=action.split(':')
   if target in ['all',r[0]]:review={'accept':'accepted','reject':'rejected','undo':'needs-review'}[kind]
  groups.append(dict(id=r[0],relationRow=i+2,left=left,right=right,residual=left['net']+right['net'] if left and right else None,timing=timing,review=review))
 return dict(decimals=dec,entries=entries,groups=groups,totals=[dict(debit=sum(e['debit'] for e in es),credit=sum(e['credit'] for e in es),net=sum(e['net'] for e in es)) for es in entries])
def add(name,edit=None,status='consistent-with-evidence',actions=None,reject=None):
 x=model()
 if edit:edit(x)
 if actions is None:actions=['accept:all'] if status=='consistent-with-evidence' and not reject else []
 files=[]
 for i,(head,rows) in enumerate(zip(x['headers'],x['rows'])):
  p=F/f'{name}-{i}.csv'
  with p.open('w',encoding='utf-8',newline='') as f:csv.writer(f,lineterminator='\n').writerows([head,*rows])
  files.append(dict(file=p.name,sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
 cases.append(dict(name=name,scope=x['scope'],complete=x['complete'],status=status,actions=actions,reject=reject,files=files,originalTables=[dict(headers=h,rows=rs) for h,rs in zip(x['headers'],x['rows'])],financialFacts=None if reject else facts(x,status,actions)))
add('reciprocal-three-including-zero')
add('pending',status='needs-review',actions=[])
add('undo',status='needs-review',actions=['accept:all','undo:R-002'])
add('reject',status='needs-review',actions=['reject:R-002'])
add('reject-undo-accept',actions=['reject:R-002','undo:R-002','accept:all'])
add('gross-differences-cancel',lambda x:(x['rows'][1][0].__setitem__(9,'90.00'),x['rows'][1][1].__setitem__(8,'20.00')),status='difference')
add('amount-difference',lambda x:x['rows'][1][0].__setitem__(9,'99.99'),status='difference')
add('same-sign',lambda x:x['rows'][1][0].__setitem__(slice(8,10),['100.00','0.00']),status='difference')
add('one-counterparty-missing',lambda x:x['rows'][1].pop(0),status='missing')
def timing(x,side='left',date='2026-10-01'):
 src=0 if side=='left' else 1;r=x['rows'][src][0];x['rows'][1-src].pop(0);x['rows'][2][0][8 if side=='left' else 7]=date;x['rows'][3].append(['T-001',side,r[5],r[6],date,'-100.00' if side=='left' else '100.00','Counterparty dated supplied subsequent/prior ledger document',*list(x['scope'].values())])
add('future-left-timing-evidence',timing,status='needs-review')
add('prior-left-timing-evidence',lambda x:timing(x,date='2026-08-31'),status='needs-review')
add('future-right-timing-evidence',lambda x:timing(x,side='right'),status='needs-review')
for name,edit in [
 ('timing-inside-period',lambda x:timing(x,date='2026-09-30')),
 ('timing-wrong-amount',lambda x:(timing(x),x['rows'][3][0].__setitem__(5,'-99.99'))),
 ('timing-wrong-sign',lambda x:(timing(x),x['rows'][3][0].__setitem__(5,'100.00'))),
 ('timing-with-present-counterpart',lambda x:x['rows'][3].append(['T-001','left','A-001','B-001','2026-10-01','-100.00','Timing document',*list(S.values())])),
 ('timing-missing-reference',lambda x:(timing(x),x['rows'][3][0].__setitem__(6,''))),
 ('wrong-entity',lambda x:x['rows'][0][0].__setitem__(0,'Other owner')),
 ('wrong-counterparty',lambda x:x['rows'][1][0].__setitem__(1,'Other party')),
 ('wrong-ledger',lambda x:x['rows'][0][0].__setitem__(2,'Other book')),
 ('wrong-account-leading-zero',lambda x:x['rows'][0][0].__setitem__(3,'1')),
 ('wrong-complete-dimensions',lambda x:x['rows'][1][0].__setitem__(4,'department=9')),
 ('wrong-row-currency',lambda x:x['rows'][1][0].__setitem__(10,'USD')),
 ('wrong-row-period',lambda x:x['rows'][1][0].__setitem__(15,'2026-08-01')),
 ('draft-row',lambda x:x['rows'][0][0].__setitem__(13,'draft')),
 ('cross-reference-wrong',lambda x:x['rows'][0][0].__setitem__(6,'B-002')),
 ('relationship-wrong-date',lambda x:x['rows'][2][0].__setitem__(7,'2026-09-12')),
 ('relationship-wrong-dimensions',lambda x:x['rows'][2][0].__setitem__(6,'none')),
 ('relationship-wrong-account',lambda x:x['rows'][2][0].__setitem__(3,'1')),
 ('relationship-no-reference',lambda x:x['rows'][2][0].__setitem__(11,'')),
 ('relationship-expired',lambda x:x['rows'][2][0].__setitem__(10,'2026-09-29')),
 ('relationship-wrong-version',lambda x:x['rows'][2][0].__setitem__(-1,'IC-2')),
 ('posting-outside-period',lambda x:x['rows'][0][0].__setitem__(7,'2026-10-01')),
 ('both-debit-credit',lambda x:x['rows'][0][0].__setitem__(9,'1.00')),
 ('bad-money-precision',lambda x:x['rows'][0][0].__setitem__(8,'100.001')),
 ('negative-debit',lambda x:x['rows'][0][0].__setitem__(8,'-100.00')),
 ('cell-formula',lambda x:x['rows'][0][0].__setitem__(5,'=A2')),
 ('duplicate-left-entry',lambda x:x['rows'][0].append(copy.deepcopy(x['rows'][0][0]))),
 ('malformed-duplicate-contender',lambda x:(x['rows'][0].append(copy.deepcopy(x['rows'][0][0])),x['rows'][0][-1].__setitem__(8,'bad'))),
 ('duplicate-relationship-id',lambda x:x['rows'][2][1].__setitem__(0,'R-001')),
 ('duplicate-relationship-member',lambda x:x['rows'][2][1].__setitem__(1,'A-001')),
 ('unproven-extra-left',lambda x:(x['rows'][0].append(copy.deepcopy(x['rows'][0][0])),x['rows'][0][-1].__setitem__(5,'A-009'))),
 ('blank-header',lambda x:x['headers'][0].__setitem__(0,'')),
 ('missing-header',lambda x:(x['headers'][0].pop(),[r.pop() for r in x['rows'][0]])),
 ('oversized-amount',lambda x:x['rows'][0][0].__setitem__(8,'1000000000000.01')),
]:add(name,edit,status='source-error')
add('missing-relationship',lambda x:x['rows'][2].pop(0),status='missing')
add('missing-zero-relationship',lambda x:x['rows'][2].pop(2),status='missing')
add('empty-left-source',lambda x:x['rows'][0].clear(),status='missing')
add('incomplete-inventory',lambda x:x.__setitem__('complete',False),status='needs-review')
add('blank-inventory',lambda x:(x['rows'][0].insert(0,['']*len(HEAD[0])),x['rows'][1].append(['']*len(HEAD[1]))))
add('arabic-money',lambda x:(x['rows'][0][0].__setitem__(8,'١٠٠٫٠٠'),x['rows'][1][0].__setitem__(9,'١٠٠٫٠٠')))
def precision(x,currency,amount):
 change_scope(x,'currency',currency);x['rows'][0][0][8]=amount;x['rows'][1][0][9]=amount
 # Other amounts have no fractional digits so they remain valid for every currency.
 for side in [0,1]:
  for r in x['rows'][side]:
   for i in [8,9]:
    if r[i].endswith('.00'):r[i]=r[i][:-3]
add('jpy',lambda x:precision(x,'JPY','100'))
add('kwd',lambda x:precision(x,'KWD','100.001'))
for name,k,v,code in [('same-entity','entityB',S['entityA'],'SCOPE'),('currency-conversion','fxPolicy','spot-translation','SCOPE'),('transaction-basis','currencyBasis','transaction','SCOPE'),('unsupported-currency','currency','ZZZ','CURRENCY'),('scope-draft','postingStatus','draft','SCOPE'),('scope-asof','asOf','2026-09-29','SCOPE')]:add(name,lambda x,k=k,v=v:change_scope(x,k,v),status='needs-review',actions=[],reject=code)
add('accept-difference',lambda x:x['rows'][1][0].__setitem__(9,'99.99'),status='difference',actions=['accept:R-001'],reject='EVENT_FINANCIAL')
add('accept-incomplete',lambda x:x.__setitem__('complete',False),status='needs-review',actions=['accept:R-001'],reject='EVENT_FINANCIAL')
add('repeat-decision',status='needs-review',actions=['reject:R-001','reject:R-001'],reject='EVENT_STATE')
# Arabic digits affect Decimal input only here, independently of any product parser.

add('amount-inclusive-limit',lambda x:(x['rows'][0][0].__setitem__(8,'1000000000000.00'),x['rows'][1][0].__setitem__(9,'1000000000000.00')))
add('gross-overflow-with-offsetting-net',lambda x:(x['rows'][0][0].__setitem__(8,'1000000000000.00'),x['rows'][0][2].__setitem__(8,'0.01')),status='source-error')
add('pair-residual-overflow',lambda x:(x['rows'][0][0].__setitem__(8,'1000000000000.00'),x['rows'][1][0].__setitem__(slice(8,10),['1000000000000.00','0.00']),x['rows'][0][1].__setitem__(9,'0.00'),x['rows'][1][1].__setitem__(8,'0.00')),status='source-error')
add('accept-timing',timing,status='needs-review',actions=['accept:R-001'],reject='EVENT_FINANCIAL')
add('accept-missing',lambda x:x['rows'][1].pop(0),status='missing',actions=['accept:R-001'],reject='EVENT_FINANCIAL')
add('accept-source-error',lambda x:x['rows'][2][0].__setitem__(11,''),status='source-error',actions=['accept:R-001'],reject='EVENT_FINANCIAL')
add('duplicate-timing',lambda x:(timing(x),x['rows'][3].append(copy.deepcopy(x['rows'][3][0]))),status='source-error')
add('malformed-relationship-competitor',lambda x:(x['rows'][2].append(copy.deepcopy(x['rows'][2][0])),x['rows'][2][-1].__setitem__(11,'')),status='source-error')
add('cross-id-reused',lambda x:x['rows'][0][1].__setitem__(6,'B-001'),status='source-error')
add('future-timing-beyond-proof-validity',lambda x:(timing(x),x['rows'][2][0].__setitem__(10,'2026-09-30')),status='source-error')
add('prior-timing-before-proof-validity',lambda x:(timing(x,date='2026-08-31'),x['rows'][2][0].__setitem__(9,'2026-09-01')),status='source-error')
def zero_second(x):
 for side in [0,1]:x['rows'][side][1][8:10]=['0.00','0.00']
def negative_limit(x):
 zero_second(x);x['rows'][0][0][8:10]=['0.00','1000000000000.00'];x['rows'][1][0][8:10]=['1000000000000.00','0.00']
add('negative-net-inclusive-limit',negative_limit)
add('negative-timing-inclusive-limit',lambda x:(timing(x),x['rows'][0][0].__setitem__(8,'1000000000000.00'),x['rows'][3][0].__setitem__(5,'-1000000000000.00')),status='needs-review')
add('negative-timing-beyond-limit',lambda x:(timing(x),x['rows'][3][0].__setitem__(5,'-1000000000000.01')),status='source-error')
def residual(x,left,right):
 zero_second(x);x['rows'][0][0][8:10]=left;x['rows'][1][0][8:10]=right
add('negative-residual-inclusive-limit',lambda x:residual(x,['0.00','1000000000000.00'],['0.00','0.00']),status='difference')
add('negative-residual-beyond-limit',lambda x:residual(x,['0.00','1000000000000.00'],['0.00','0.01']),status='source-error')
add('positive-residual-inclusive-limit',lambda x:residual(x,['1000000000000.00','0.00'],['0.00','0.00']),status='difference')
add('positive-residual-beyond-limit',lambda x:residual(x,['1000000000000.00','0.00'],['0.01','0.00']),status='source-error')
def credit_overflow(x):
 x['rows'][0][0][8:10]=['0.00','1000000000000.00'];x['rows'][1][0][8:10]=['1000000000000.00','0.00'];x['rows'][0][1][8:10]=['30.00','0.00'];x['rows'][1][1][8:10]=['0.00','30.00'];x['rows'][0][2][9]='0.01'
add('gross-credit-overflow-with-offsetting-net',credit_overflow,status='source-error')
add('raw-cell-inclusive-32767',lambda x:x['rows'][2][0].__setitem__(11,'X'*32767),status='source-error')
add('raw-cell-over-32767',lambda x:x['rows'][2][0].__setitem__(11,'X'*32768),status='needs-review',actions=[],reject='CELL_LIMIT')
add('raw-cell-astral-over-32767',lambda x:x['rows'][2][0].__setitem__(11,'😀'*16384),status='needs-review',actions=[],reject='CELL_LIMIT')
add('reference-astral-inclusive-2000',lambda x:x['rows'][2][0].__setitem__(11,'😀'*1000))
(F/'expected.json').write_text(json.dumps(dict(sample='synthetic-not-field',version='intercompany-ledger-1',scopeHeaders=SH,roles=ROLES,sourceHeaders=HEAD,cases=cases),ensure_ascii=False,indent=2)+'\n')
print(len(cases),len(cases)*4,'frozen CSV originals before engine')
