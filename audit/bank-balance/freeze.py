"""Synthetic B2.1 balance facts, independently calculated before product code."""
import csv,hashlib,json
from decimal import Decimal
from pathlib import Path
from datetime import date,timedelta
ROOT=Path(__file__).parent/'frozen';ROOT.mkdir(parents=True,exist_ok=True)
bank=json.loads(Path('audit/bank/frozen/expected.json').read_text());scope=bank['scope'];start=(date.fromisoformat(scope['start'])-timedelta(days=1)).isoformat()
HEADERS=['Record ID','Balance kind','As of','Entity','Ledger','Bank account','Currency','Period start','Period end','Balance basis','Status','Amount']
def row(side,kind,minor):return [f'{side}-{kind}',kind,start if kind=='opening' else scope['end'],*scope.values(),'movement-date','posted' if side else 'booked',format(Decimal(minor)/100,'.2f')]
cases=[]
def add(name,bankname='outgoing-fees',edit=None,error=False,invalid=None):
 b=next(c for c in bank['cases'] if c['name']==bankname);totals=[sum(r['signed'] for r in b['records'] if r['side']==s) for s in [0,1]];rows=[[row(s,'opening',200000),row(s,'closing',200000+totals[s])] for s in [0,1]]
 if edit:edit(rows)
 invalid=invalid or [];files=[];inventory=[];records=[]
 for side,data in enumerate(rows):
  filename=f'{name}-{side}.csv';p=ROOT/filename
  with p.open('w',newline='') as stream:csv.writer(stream,lineterminator='\n').writerows([HEADERS,*data])
  files.append(dict(file=filename,sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
  inventory.append(dict(side=side,row=1,kind='header'))
  for index,r in enumerate(data,2):
   kind='blank' if not any(r) else 'error' if (side,index) in invalid else r[1]
   inventory.append(dict(side=side,row=index,kind=kind))
   if kind not in ['blank','error']:records.append(dict(side=side,row=index,reference=r[0],kind=kind,asOf=r[2],amount=int(Decimal(r[-1])*100)))
 bad=error or b['sourceError'];amounts=[];absent=[]
 for side in [0,1]:
  amount={}
  for kind in ['opening','closing']:
   found=[r for r in records if r['side']==side and r['kind']==kind]
   amount[kind]=found[0]['amount'] if len(found)==1 and not bad else None
   if not found:absent.append([side,kind])
  amount['movement']=totals[side] if not bad else None
  amount['residual']=amount['opening']+totals[side]-amount['closing'] if amount['opening'] is not None and amount['closing'] is not None else None
  amounts.append(amount)
 differences={kind:amounts[0][kind]-amounts[1][kind] if all(a[kind] is not None for a in amounts) else None for kind in ['opening','closing']}
 status='source-error' if bad else 'missing' if absent else 'inconsistent' if any(a['residual']!=0 for a in amounts) or any(v!=0 for v in differences.values()) else 'balances-consistent'
 cases.append(dict(name=name,bankCase=bankname,files=files,records=records,inventory=inventory,sourceError=bad,missing=absent,components=amounts,differences=differences,status=status,timingItems=len(b['timingItems']),bankTruth=dict(file='audit/bank/frozen/expected.json',sha256=hashlib.sha256(Path('audit/bank/frozen/expected.json').read_bytes()).hexdigest(),case=bankname,records=b['records'],groups=b['groups'],actions=b['actions'],timingItems=b['timingItems'],sourceError=b['sourceError'])))
add('balanced')
add('zero-opening',edit=lambda rs:[r.__setitem__(11,format(Decimal(int(Decimal(r[11])*100)-200000)/100,'.2f')) for side in rs for r in side])
# Negative own cash balance is valid, without inferred debit/credit sign.
add('negative-closing',edit=lambda rs:[r.__setitem__(11,format(Decimal(int(Decimal(r[11])*100)-150000)/100,'.2f')) for side in rs for r in side])
add('opening-and-closing-difference',edit=lambda rs:[r.__setitem__(11,format(Decimal(r[11])+1,'.2f')) for r in rs[1]])
add('cash-bridge-difference',edit=lambda rs:rs[1][1].__setitem__(11,'982.76'))
add('bank-bridge-difference',edit=lambda rs:rs[0][1].__setitem__(11,'982.76'))
add('missing-opening',edit=lambda rs:rs[0].pop(0))
add('missing-closing',edit=lambda rs:rs[1].pop(1))
add('missing-both',edit=lambda rs:rs[0].clear())
add('blank-row-retained',edit=lambda rs:rs[1].append(['']*12))
add('duplicate-own-id',edit=lambda rs:rs[0][1].__setitem__(0,rs[0][0][0]),error=True,invalid=[(0,2),(0,3)])
add('duplicate-opening',edit=lambda rs:rs[0].append(['extra-opening',*rs[0][0][1:11],'2000.00']),error=True,invalid=[(0,2),(0,4)])
add('malformed-competing-id',edit=lambda rs:rs[0].append([*rs[0][0][:11],'broken']),error=True,invalid=[(0,2),(0,4)])
for name,col,value in [('scope-mismatch',5,'BANK-OTHER'),('opening-date-mismatch',2,'2026-09-01'),('closing-date-mismatch',2,'2026-10-01'),('value-basis',9,'value-date'),('available-basis',9,'available'),('wrong-status',10,'pending'),('unknown-kind',1,'summary'),('blank-amount',11,''),('precision-loss',11,'982.751')]:
 index=1 if name.startswith('closing') or name in ['blank-amount','precision-loss'] else 0
 add(name,edit=lambda rs,col=col,value=value,index=index:rs[0][index].__setitem__(col,value),error=True,invalid=[(0,index+2)])
add('pending-movement-policy','balanced-extra-members')
add('timing-kept-after-undo','timing-after-cutoff')
add('movement-source-error','wrong-fee-parent')
add('empty-movement-period','empty-sources')
add('zero-net-full-reversal','reversal-fees')
add('zero-closing',edit=lambda rs:[r.__setitem__(11,format(Decimal(int(Decimal(r[11])*100)-98275)/100,'.2f')) for side in rs for r in side])
add('positive-limit','empty-sources',edit=lambda rs:[r.__setitem__(11,'1000000000000.00') for side in rs for r in side])
add('negative-limit','empty-sources',edit=lambda rs:[r.__setitem__(11,'-1000000000000.00') for side in rs for r in side])
add('positive-over-limit','empty-sources',edit=lambda rs:rs[0][0].__setitem__(11,'1000000000000.01'),error=True,invalid=[(0,2)])
add('negative-over-limit','empty-sources',edit=lambda rs:rs[0][0].__setitem__(11,'-1000000000000.01'),error=True,invalid=[(0,2)])
add('residual-over-limit','empty-sources',edit=lambda rs:[(side[0].__setitem__(11,'1000000000000.00'),side[1].__setitem__(11,'-1000000000000.00')) for side in rs])
cases[-1]['reject']='BALANCE_SUM'
add('difference-over-limit','empty-sources',edit=lambda rs:([r.__setitem__(11,'1000000000000.00') for r in rs[0]],[r.__setitem__(11,'-1000000000000.00') for r in rs[1]]))
cases[-1]['reject']='BALANCE_SUM'
add('intermediate-cancellation',edit=lambda rs:[r.__setitem__(11,'-1000000000000.00') for side in rs for r in side])
expected=dict(version='bank-balance-evidence-1',sample='synthetic-not-field',scope=scope,openingAsOf=start,closingAsOf=scope['end'],headers=HEADERS,cases=cases)
(ROOT/'expected.json').write_text(json.dumps(expected,ensure_ascii=False,indent=2)+'\n');print(len(cases),'cases',len(cases)*2,'CSV originals')
