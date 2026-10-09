"""Pre-engine one-batch truths: stdlib CSV/Decimal only, never product imports."""
from pathlib import Path
from copy import deepcopy
from decimal import Decimal
import csv,io,json,hashlib
ROOT=Path(__file__).parent
FIELDS=['entity','gateway','merchantAccount','bankAccount','dimensions','currency','currencyBasis','fxPolicy','start','end','asOf','policyVersion','batchId']
SH=['Entity','Gateway','Merchant account','Bank account','Complete dimensions','Currency','Currency basis','FX policy','Period start','Period end','As of','Policy version','Batch ID']
SCOPE=dict(zip(FIELDS,['Synthetic Merchant','Gateway example','001','BANK-01','department=01','SAR','functional','same-currency-no-conversion','2026-09-01','2026-09-30','2026-09-30','PG-1','BATCH-001']))
HEADS=[['Transaction ID','Kind','Posting date','Amount','Reference'],['Evidence ID','Fee ID','Amount','Reference','Valid from','Valid to'],['Settlement ID','Settlement date','Gross sales','Refunds','Fees','Net','Payout ID','Reference'],['Payout ID','Value date','Credit','Reference']]
BASE=[[
 ['T-001','sale','2026-09-10','80.00','Order 001'],['T-002','sale','2026-09-11','40.00','Order 002'],['T-003','refund','2026-09-12','20.00','Refund order 001']],
 [['E-001','F-001','2.00','Independent fee detail 1','2026-09-01','2026-09-30'],['E-002','F-002','1.00','Independent fee detail 2','2026-09-01','2026-09-30']],
 [['S-001','2026-09-15','120.00','20.00','3.00','97.00','P-001','Gateway settlement statement']],
 [['P-001','2026-09-16','97.00','Bank credit original']]]
CASES=[]
def add(name,rows=None,status='needs-review',totals=(12000,2000,300,9700),issues=(),missing=(),actions=(),complete=True,scope=None,scope_overrides=None,header_overrides=None):
 CASES.append(dict(name=name,rows=deepcopy(BASE if rows is None else rows),status=status,totals=list(totals) if totals is not None else None,issues=list(issues),missing=list(missing),actions=list(actions),complete=complete,scope=deepcopy(scope or SCOPE),scopeOverrides=scope_overrides or {},headerOverrides=header_overrides or {}))
def changed(source,row,col,value):
 r=deepcopy(BASE);r[source][row][col]=value;return r
add('pending');add('accepted',status='consistent-with-evidence',actions=['accept']);add('reject',actions=['reject']);add('undo',actions=['accept','undo']);add('incomplete',complete=False)
r=deepcopy(BASE);r[0]=[['T-000','sale','2026-09-10','0.00','Explicit zero sale']];r[1]=[];r[2][0][2:6]=['0.00']*4;r[3][0][2]='0.00';add('zero',r,totals=(0,0,0,0),status='consistent-with-evidence',actions=['accept'])
r=deepcopy(BASE);r[2][0][2:4]=['130.00','30.00'];add('gross-errors-net-cancels',r,status='difference')
add('wrong-net',changed(2,0,5,'96.99'),status='difference');add('wrong-payout',changed(3,0,2,'96.99'),status='difference')
r=deepcopy(BASE);r[1]=[];add('fee-proof-missing',r,status='missing',totals=(12000,2000,0,10000),missing=['fee-evidence'])
r=deepcopy(BASE);r[1]=[];r[2][0][4:6]=['0.00','100.00'];r[3][0][2]='100.00';add('no-fee',r,totals=(12000,2000,0,10000),status='consistent-with-evidence',actions=['accept'])
r=deepcopy(BASE);r[1]=[];r[2][0][4:6]=['0.00','97.00'];add('do-not-invent-fee',r,status='difference',totals=(12000,2000,0,10000))
for src,name in [(0,'transactions'),(2,'settlement'),(3,'payout')]:
 r=deepcopy(BASE);r[src]=[];add('missing-'+name,r,status='missing',totals=((0,0,300,-300) if src==0 else (12000,2000,300,9700)),missing=[name])
for src,name in [(2,'settlement'),(3,'payout')]:
 r=deepcopy(BASE);r[src].append(deepcopy(r[src][0]));add('extra-'+name,r,status='source-error',totals=None,issues=['CARDINALITY','DUPLICATE'])
r=deepcopy(BASE);r[0].append(deepcopy(r[0][0]));r[0][-1][3]='broken';add('malformed-competing-transaction',r,status='source-error',totals=None,issues=['AMOUNT','DUPLICATE'])
r=deepcopy(BASE);r[1].append(deepcopy(r[1][0]));add('duplicate-fee-evidence',r,status='source-error',totals=None,issues=['DUPLICATE'])
add('expired-fee-proof',changed(1,0,5,'2026-09-14'),status='source-error',totals=None,issues=['VALIDITY'])
add('transaction-after-period',changed(0,0,2,'2026-10-01'),status='source-error',totals=None,issues=['PERIOD'])
add('bank-after-period',changed(3,0,1,'2026-10-01'),status='source-error',totals=None,issues=['PERIOD'],missing=['payout'])
add('wrong-payout-id',changed(3,0,0,'P-002'),status='source-error',totals=None,issues=['PAYOUT_LINK'])
add('unknown-kind',changed(0,0,1,'reserve'),status='source-error',totals=None,issues=['KIND'])
add('negative-amount',changed(0,0,3,'-80.00'),status='source-error',totals=None,issues=['AMOUNT'])
add('excess-precision',changed(0,0,3,'80.001'),status='source-error',totals=None,issues=['AMOUNT'])
for src,key,value,name in [(0,'batchId','BATCH-002','foreign-batch'),(1,'merchantAccount','1','leading-zero-merchant'),(3,'bankAccount','BANK-02','foreign-bank'),(0,'dimensions','department=1','dimensions'),(2,'currency','USD','foreign-currency')]:
 add(name,status='source-error',totals=None,issues=['ROW_SCOPE'],scope_overrides={str(src):{key:value}})
r=deepcopy(BASE);r[0][0][3]='٨٠٫٠٠';add('arabic-digits',r,status='consistent-with-evidence',actions=['accept'])
r=deepcopy(BASE);r[0].reverse();r[1].reverse();add('order-permutation',r,status='consistent-with-evidence',actions=['accept'])
r=deepcopy(BASE);r[0].insert(1,[]);r[1].append([]);add('blank-rows-retained',r,status='consistent-with-evidence',actions=['accept'])
r=deepcopy(BASE);r[0]=[['T-MAX','sale','2026-09-10','1000000000000.00','Maximum exact amount']];r[1]=[];r[2][0][2:6]=['1000000000000.00','0.00','0.00','1000000000000.00'];r[3][0][2]='1000000000000.00';add('inclusive-bound',r,totals=(10**14,0,0,10**14),status='consistent-with-evidence',actions=['accept'])
r=deepcopy(BASE);r[0][0][3]='1000000000000.00';add('gross-bound',r,status='source-error',totals=None,issues=['TOTAL_BOUND'])
r=deepcopy(BASE);r[0][2][3]='200.00';add('negative-net',r,status='difference',totals=(12000,20000,300,-8300))
add('missing-reference',changed(1,0,3,''),status='source-error',totals=None,issues=['IDENTITY'])
add('formula-like-id',changed(0,0,0,'=T-001'),status='source-error',totals=None,issues=['IDENTITY'])
r=deepcopy(BASE);r[0][0][4]='=literal narrative';add('formula-like-reference-literal',r,status='consistent-with-evidence',actions=['accept'])
add('unknown-column',status='source-error',totals=None,issues=['COLUMNS'],header_overrides={'0':['Extra']})
for size in [32767,32768]:
 r=deepcopy(BASE);r[0][0][4]='x'*size;add('cell-'+str(size),r,status='source-error' if size==32767 else 'throws:CELL_LIMIT',totals=None,issues=['IDENTITY'] if size==32767 else [])
# Independently computed expected data, fixed before engine creation.
def emit():
 dest=ROOT/'frozen';dest.mkdir(exist_ok=True);out=[]
 for c in CASES:
  files=[]
  for src,rows in enumerate(c.pop('rows')):
   common=c['scope']|c['scopeOverrides'].get(str(src),{});header=HEADS[src]+SH+c['headerOverrides'].get(str(src),[])
   table=[header]+[row+[common[k] for k in FIELDS]+(['extra'] if str(src) in c['headerOverrides'] else []) if row else [] for row in rows]
   buf=io.StringIO(newline='');csv.writer(buf,lineterminator='\n').writerows(table);b=buf.getvalue().encode();p=dest/(c['name']+'-'+str(src)+'.csv');p.write_bytes(b);files.append(dict(file=p.name,bytes=len(b),sha256=hashlib.sha256(b).hexdigest()))
  out.append(c|dict(files=files))
 payload=dict(version='payment-gateway-batch-1',sample='synthetic-not-field',scopeFields=FIELDS,scopeHeaders=SH,sourceHeaders=[h+SH for h in HEADS],cases=out)
 (dest/'expected.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
 print(len(out),'pre-engine cases',len(out)*4,'CSV originals')
if __name__=='__main__':emit()
