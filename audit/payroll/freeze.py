"""Frozen synthetic payroll originals and independent CSV/Decimal truths before engine."""
import copy, csv, hashlib, io, json
from pathlib import Path
from reference import FIELDS, HEADERS, VALUES, COMPONENTS, CLASSES, SIGNS, PHASES, inspect
ROOT=Path(__file__).resolve().parent
SCOPE=dict(zip(FIELDS,['Synthetic Payroll Owner','RUN-2026-09','PAYROLL-BOOK','GL-BOOK','SAR','functional','posted','Current','2026-09-01','2026-09-30','2026-09-30','2026-10-01','BANK-001','PAYOUT-2026-09','CHART-1','MAP-1','PAYROLL-POL-1','BANK-MAP-1','ACCOUNT-SET-1']))
def acct(c):return 'GL-net-payable' if c=='net-clearing' else 'GL-'+c
BASE=[
 [['A','department=01','1000','100','50','900','PAY-A'],['B','department=02','400','40','20','360','PAY-B']],
 [[f'MAP-{employee}-{c}',employee,f'department={dept}',c,acct(c),'branch=01',f'POL-{employee}-{c}'] for employee,dept in [('A','01'),('B','02')] for c in COMPONENTS],
 [[f'POL-{employee}-{c}',employee,f'department={dept}',c,f'PAY-{employee}',acct(c),'branch=01',CLASSES[i],SIGNS[i],'provided-posted-payroll-component','2026-01-01','2026-12-31',f'SYN-POL-{employee}-{c}'] for employee,dept in [('A','01'),('B','02')] for i,c in enumerate(COMPONENTS)],
 [[f'ENTRY-{c}',PHASES[i],c,acct(c),'branch=01',CLASSES[i],str(v) if SIGNS[i]=='debit-positive' else '0','0' if SIGNS[i]=='debit-positive' else str(v),SCOPE['payrollPostingDate'] if i<5 else SCOPE['paymentDate'],SCOPE['payrollRun'] if i<5 else SCOPE['payoutReference']] for i,(c,v) in enumerate(zip(COMPONENTS,[1400,140,1260,70,70,1260,1260]))],
 [['BANK-TXN-01',SCOPE['bankAccount'],'outflow','1260',SCOPE['paymentDate'],SCOPE['payoutReference']]],
]
CASES=[]
def add(name,rows=None,kind='ready',scope=None,override=None):CASES.append(dict(name=name,rows=copy.deepcopy(BASE if rows is None else rows),kind=kind,scope=copy.deepcopy(SCOPE if scope is None else scope),override=override))
def changed(src,row,col,value):
 rows=copy.deepcopy(BASE);rows[src][row][col]=value;return rows
add('seven-components-and-bank-positive')
for i,c in enumerate(COMPONENTS):add(c+'-one-minor-difference',changed(3,i,6 if SIGNS[i]=='debit-positive' else 7,str([1400,140,1260,70,70,1260,1260][i]-0.01)),'difference')
for name,src,row,col,value,kind in [
 ('bank-one-minor-difference',4,0,3,'1259.99','difference'),('gross-missing',0,0,2,'','source-error'),('negative-gross',0,0,2,'-1000','source-error'),('negative-deductions',0,0,3,'-100','source-error'),('negative-employer',0,0,4,'-50','source-error'),('negative-net',0,0,5,'-900','source-error'),('net-equation-contradiction',0,0,5,'901','source-error'),('deductions-exceed-gross',0,0,3,'1001','source-error'),('precision-no-round',0,0,2,'1000.001','source-error'),('arabic-no-inference',0,0,2,'١٠٠٠','source-error'),('comma-no-inference',0,0,2,'1,000','source-error'),('exponent-no-inference',0,0,2,'1e3','source-error'),
 ('employee-literal-id',1,0,1,'001','missing'),('employee-dimensions-complete',1,0,2,'department=02','missing'),('employee-payroll-reference',2,0,4,'PAY-B','missing'),('evidence-employee-identity',2,0,1,'B','missing'),('component-no-inference',1,0,3,'salary','source-error'),('gl-dimensions-match',1,0,5,'branch=02','missing'),('policy-sign-explicit',2,1,8,'debit-positive','source-error'),('policy-class-explicit',2,1,7,'payroll-expense','source-error'),('policy-basis-provided',2,0,9,'tax-calculated','source-error'),('policy-expired-payroll',2,0,11,'2026-09-29','source-error'),('policy-expired-disbursement',2,5,11,'2026-09-30','source-error'),('policy-inclusive-payroll',2,0,11,'2026-09-30','ready'),('policy-inclusive-disbursement',2,5,11,'2026-10-01','ready'),('policy-year-zero',2,0,10,'0000-01-01','source-error'),('policy-compact-date',2,0,10,'20260101','source-error'),
 ('gl-phase-explicit',3,5,1,'payroll','source-error'),('gl-class-explicit',3,0,5,'cash','source-error'),('gl-posting-day',3,0,8,'2026-10-01','source-error'),('gl-run-reference',3,0,9,'OTHER-RUN','source-error'),('gl-disbursement-reference',3,5,9,'OTHER-PAYOUT','source-error'),('gl-date-zero',3,0,8,'0000-09-30','source-error'),('negative-gl-not-flipped',3,2,6,'1500','difference'),
 ('bank-direction-explicit',4,0,2,'inflow','source-error'),('bank-account-literal',4,0,1,'BANK-1','source-error'),('bank-payout-reference',4,0,5,'OTHER-PAYOUT','source-error'),('bank-value-day',4,0,4,'2026-10-02','source-error'),('bank-zero-not-fabricated',4,0,3,'0','source-error'),('bank-negative-not-flipped',4,0,3,'-1260','source-error'),('bank-precision',4,0,3,'1260.001','source-error'),('bank-id-formula-rejected',4,0,0,'=X','source-error')]:add(name,changed(src,row,col,value),kind)
rows=copy.deepcopy(BASE);rows[3][0][6]='1399';rows[3][1][7]='139';add('gross-deduction-differences-net-masked',rows,'difference')
rows=copy.deepcopy(BASE);rows[3][2][7]='1259';rows[3][5][6]='1259';add('net-liability-cleared-zero-still-two-differences',rows,'difference')
rows=copy.deepcopy(BASE);rows[0][1][2:6]=['0','0','0','0'];values=[1000,100,900,50,50,900,900]
for i,v in enumerate(values):rows[3][i][6 if SIGNS[i]=='debit-positive' else 7]=str(v)
rows[4][0][3]='900';add('zero-employee-keeps-seven-mappings',rows)
rows=copy.deepcopy(rows);rows[1].pop(13);add('zero-employee-cash-map-required',rows,'missing')
rows=copy.deepcopy(BASE)
for r in rows[0]:r[2:6]=['0','0','0','0']
for r in rows[3]:r[6:8]=['0','0']
rows[4]=[];add('zero-entire-run-explicit-unsupported',rows,'source-error')
for src,label in enumerate(['register','mapping','policy','gl','bank']):
 rows=copy.deepcopy(BASE);rows[src].append(copy.deepcopy(rows[src][0]));add('duplicate-'+label,rows,'source-error')
 rows=copy.deepcopy(BASE);rows[src]=[];add('empty-'+label,rows,'missing')
rows=copy.deepcopy(BASE);rows[0].append(['A','department=01','broken','100','50','900','PAY-A']);add('malformed-register-competitor-full-member',rows,'source-error')
rows=copy.deepcopy(BASE);rows[4].append(['BANK-TXN-02',SCOPE['bankAccount'],'outflow','broken',SCOPE['paymentDate'],SCOPE['payoutReference']]);add('malformed-bank-competitor-full-member',rows,'source-error')
rows=copy.deepcopy(BASE);rows[4][0][3]='600';rows[4].append(['BANK-TXN-02',SCOPE['bankAccount'],'outflow','660',SCOPE['paymentDate'],SCOPE['payoutReference']]);add('two-bank-payouts-sum-does-not-prove-family',rows,'source-error')
rows=copy.deepcopy(BASE);rows[1][7][0]=rows[1][0][0];add('mapping-id-independent-uniqueness',rows,'source-error')
rows=copy.deepcopy(BASE);rows[3][1][0]=rows[3][0][0];add('entry-id-independent-uniqueness',rows,'source-error')
rows=copy.deepcopy(BASE)
for src,col in [(1,4),(2,5)]:rows[src][5][col]='GL-OTHER-NET'
rows[3][5][3]='GL-OTHER-NET';add('clearing-different-liability-account',rows,'missing')
rows=copy.deepcopy(BASE)
for src,col in [(1,4),(2,5)]:
 for r in rows[src]:
  if r[3]=='bank-cash':r[col]='GL-gross-expense'
rows[3][6][3]='GL-gross-expense';add('cash-account-cannot-be-expense-across-phases',rows,'source-error')
rows=copy.deepcopy(BASE);rows[3].append(['ZERO','payroll','gross-expense','GL-ZERO','branch=01',CLASSES[0],'0','0',SCOPE['payrollPostingDate'],SCOPE['payrollRun']]);add('unmapped-zero-gl-visible',rows,'missing')
rows=copy.deepcopy(BASE)
for src,col in [(1,4),(2,5)]:
 for r in rows[src]:
  if r[1]=='B' and r[3]=='gross-expense':r[col]='GL-gross-B'
rows[3][0][6]='900';rows[3].append(['ENTRY-B','payroll','gross-expense','GL-gross-B','branch=01',CLASSES[0],'500','0',SCOPE['payrollPostingDate'],SCOPE['payrollRun']]);add('opposed-account-differences-zero-grand',rows,'difference')
rows=copy.deepcopy(BASE);rows[1].append(['ORPHAN','Z','department=03','gross-expense','GL-gross-expense','branch=01','POL-A-gross-expense']);add('orphan-mapping-visible',rows,'missing')
rows=copy.deepcopy(BASE);row=copy.deepcopy(rows[2][0]);row[0]='ORPHAN';row[1]='Z';rows[2].append(row);add('orphan-policy-visible',rows,'missing')
for field in FIELDS:add('foreign-row-scope-'+field,kind='source-error',override=[0,0,field,'OTHER'])
for currency in ['JPY','KWD']:
 scope=copy.deepcopy(SCOPE);scope['currency']=currency;add(currency.lower()+'-precision-positive',scope=scope)
rows=copy.deepcopy(BASE);rows[0][0][2:6]=['1000000000000','0','0','1000000000000'];rows[0][1][2:6]=['0','0','0','0']
for i,v in enumerate([1000000000000,0,1000000000000,0,0,1000000000000,1000000000000]):rows[3][i][6 if SIGNS[i]=='debit-positive' else 7]=str(v)
rows[4][0][3]='1000000000000';add('minor-bound-inclusive',rows)
rows=copy.deepcopy(rows);rows[3][0][6:8]=['0','1000000000000'];add('derived-difference-two-times-minor-bound',rows,'difference')
add('amount-bound-plus-one',changed(0,0,2,'1000000000000.01'),'source-error')
def encode(rows,source,scope,override=None):
 full=[HEADERS[source]]+[r+[scope[k] for k in FIELDS] for r in rows]
 if override and override[0]==source:
  _,row,field,value=override;full[row+1][len(VALUES[source])+FIELDS.index(field)]=value
 stream=io.StringIO(newline='');csv.writer(stream,lineterminator='\n').writerows(full);return stream.getvalue().encode()
def freeze():
 manifest=[];catalog=[]
 for case in CASES:
  folder=ROOT/'cases'/case['name'];folder.mkdir(parents=True,exist_ok=True);paths=[]
  for source,rows in enumerate(case['rows']):
   path=folder/f'source-{source}.csv';data=encode(rows,source,case['scope'],case['override'])
   if path.exists():assert path.read_bytes()==data,path
   else:path.write_bytes(data)
   paths.append(path)
  result=inspect(paths,case['scope']);assert result['kind']==case['kind'],(case['name'],result['kind'],case['kind'])
  path=folder/'expected.json';data=(json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode()
  if path.exists():assert path.read_bytes()==data,path
  else:path.write_bytes(data)
  for path in [*paths,path]:manifest.append(dict(path=str(path.relative_to(ROOT)),bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
  catalog.append({k:case[k] for k in ['name','kind','scope']})
 for name,content in [('cases.json',catalog),('source-manifest.json',manifest)]:
  path=ROOT/name;data=(json.dumps(content,ensure_ascii=False,indent=2)+'\n').encode()
  if path.exists():assert path.read_bytes()==data,path
  else:path.write_bytes(data)
 print(json.dumps(dict(cases=len(catalog),sealedFiles=len(manifest))))
if __name__=='__main__':freeze()
