# -*- coding: utf-8 -*-
from pathlib import Path
import json,csv,io,hashlib
from decimal import Decimal
root=Path('audit/bank/frozen');root.mkdir(parents=True,exist_ok=True)
scope=dict(entity='Synthetic Cash Owner',ledger='Primary Book',account='BANK-001',currency='SAR',start='2026-09-01',end='2026-09-30')
headers=['Record ID','Settlement ID','Movement date','Value date','Cash direction','Role','Parent payment ID','Reverses record ID','Policy','Status','Entity','Ledger','Bank account','Currency','Period start','Period end','Amount']
meta=list(scope.values());cases=[]
def row(id,ref,amount,direction='outflow',role='principal',policy='individual',parent='',reverse='',day='2026-09-15',value='2026-09-16',side=0):return [id,ref,day,value,direction,role,parent,reverse,policy,'booked' if side==0 else 'posted',*meta,str(amount)]
def base(incoming=False):
 policy='incoming-net' if incoming else 'outgoing-inclusive';direction='inflow' if incoming else 'outflow';n='982.75' if incoming else '1017.25'
 return [[row('B1','S1',n,direction,'settlement',policy)],[row('L1','S1',1000,direction,'principal',policy,side=1),row('F1','S1',15,'outflow','fee',policy,parent='L1',side=1),row('T1','S1','2.25','outflow','fee-tax',policy,parent='L1',side=1)]]
def add(name,tables,statuses,actions=(),bad=()):
 files=[]
 for side,lines in enumerate(tables):
  out=io.StringIO();csv.writer(out,lineterminator='\n').writerows([headers,*lines]);raw=out.getvalue().encode();f=f'{name}-{side}.csv';(root/f).write_bytes(raw);files.append(dict(file=f,sha256=hashlib.sha256(raw).hexdigest()))
 records=[];inventory=[]
 for side,lines in enumerate(tables):
  inventory.append(dict(side=side,row=1,kind='header',values=headers))
  for index,line in enumerate(lines,2):
   wrong=(side,index) in bad;inventory.append(dict(side=side,row=index,kind='error' if wrong else 'movement',values=line))
   if wrong:continue
   amount=int(Decimal(line[-1])*100);signed=amount if line[4]=='inflow' else -amount
   records.append(dict(side=side,row=index,reference=line[0],settlement=line[1],movementDate=line[2],valueDate=line[3],direction=line[4],role=line[5],parent=line[6],reverses=line[7],policy=line[8],amount=amount,signed=signed))
 groups=[]
 for key,state,reason,eligible in statuses:
  if key.startswith('blank:'):
   _,si,own=key.split(':');members=[r for r in records if r['side']==int(si) and r['reference']==own]
  else:members=[r for r in records if r['settlement']==key]
  bank=[r['reference'] for r in members if r['side']==0];cash=[r['reference'] for r in members if r['side']==1]
  b=sum(r['signed'] for r in members if r['side']==0);l=sum(r['signed'] for r in members if r['side']==1)
  groups.append(dict(key=key,bank=bank,cash=cash,bankMinor=b,cashMinor=l,deltaMinor=b-l,status=state,reason=reason,eligible=eligible))
 timing=[dict(side=side,row=index,reference=r[0],movementDate=r[2],valueDate=r[3],outsidePeriod=True,validMovement=(side,index) not in bad) for side,lines in enumerate(tables) for index,r in enumerate(lines,2) if not(scope['start'] <= r[3] <= scope['end'])]
 cases.append(dict(name=name,files=files,records=records,inventory=inventory,groups=groups,actions=list(actions),timingItems=timing,sourceError=bool(bad)))
matched=lambda key='S1':(key,'matched-evidence','explicit-identity',True)
review=lambda reason,eligible=False,key='S1':(key,'needs-review',reason,eligible)
badstatus=lambda key='S1':(key,'source-error','source-error',False)
add('outgoing-fees',base(),[matched()])
add('incoming-net',base(True),[matched()])
add('individual',[[row('B1','S1',1000)],[row('L1','S1',1000,side=1)]],[matched()],actions=[dict(type='undo',bank=['B1'],cash=['L1'],expectedStatus='needs-review'),dict(type='accept',bank=['B1'],cash=['L1'],expectedStatus='matched-manual')])
t=base();t[1]=t[1][:1];add('missing-fees',t,[review('amount-difference')])
t=base();t[0].append(row('B2','S2','2017.25','outflow','settlement','outgoing-inclusive'));t[1]+= [row('L2','S2',2000,'outflow','principal','outgoing-inclusive',side=1),row('F2','S2',15,'outflow','fee','outgoing-inclusive',parent='L2',side=1),row('T2','S2','2.25','outflow','fee-tax','outgoing-inclusive',parent='L2',side=1)];add('equal-fees-independent-members',t,[matched('S1'),matched('S2')])
t=base();t[1].append(row('L2','S2',2000,side=1));t[1][1][6]='L2';add('wrong-fee-parent',t,[badstatus(),badstatus('S2')],bad=[(1,3)])
add('no-identity',[[row('B1','',1000)],[row('L1','',1000,side=1)]],[review('missing-identity',key='blank:0:B1'),review('missing-identity',key='blank:1:L1')],actions=[dict(type='accept',bank=['B1'],cash=['L1'],expectedStatus='matched-manual'),dict(type='undo',bank=['B1'],cash=['L1'],expectedStatus='needs-review')])
add('wrong-settlement-id',[[row('B1','S1',1000)],[row('L1','S2',1000,side=1)]],[review('missing-counterpart',key='S1'),review('missing-counterpart',key='S2')])
add('competing-members',[[row('B1','S1',1000)],[row('L1','S1',1000,side=1),row('L2','S1',1000,side=1)]],[review('policy-members')])
add('duplicate-bank-record',[[row('B1','S1',1000),row('B1','S1',1000)],[row('L1','S1',1000,side=1)]],[badstatus()],bad=[(0,2),(0,3)])
for name,column,value,side in [('currency-mismatch',13,'USD',0),('account-mismatch',12,'BANK-OTHER',0),('unposted-cash',9,'draft',1),('late-booking',2,'2026-10-01',0),('blank-amount',16,'',0)]:
 t=[[row('B1','S1',1000)],[row('L1','S1',1000,side=1)]];t[side][0][column]=value;add(name,t,[badstatus()],bad=[(side,2)])
t=[[row('B1','S1',1000,day='2026-09-30',value='2026-10-02')],[row('L1','S1',1000,day='2026-09-29',value='2026-09-30',side=1)]];add('timing-after-cutoff',t,[review('timing-review',True)],actions=[dict(type='accept',bank=['B1'],cash=['L1'],expectedStatus='matched-manual'),dict(type='undo',bank=['B1'],cash=['L1'],expectedStatus='needs-review')])
add('periodic-fee',[[row('BF','FEE-01',25,role='periodic-fee')],[row('LF','FEE-01',25,role='periodic-fee',side=1)]],[matched('FEE-01')])
for name,t in [('reversal-individual',[[row('B1','S1',1000)],[row('L1','S1',1000,side=1)]]),('reversal-fees',base()),('reversal-net',base(True))]:
 for side in [0,1]:
  originals=list(t[side]);t[side]+=[row('R-'+r[0],'S1-R',r[-1],'outflow' if r[4]=='inflow' else 'inflow','reversal','reversal',reverse=r[0],day='2026-09-20',value='2026-09-21',side=side) for r in originals]
 add(name,t,[matched('S1'),matched('S1-R')])
t=base();t[0].append(row('RB1','S1-R','1017.25','inflow','reversal','reversal',reverse='B1',day='2026-09-20',value='2026-09-21'));t[1].append(row('RL1','S1-R',1000,'inflow','reversal','reversal',reverse='L1',day='2026-09-20',value='2026-09-21',side=1));add('missing-fee-refund',t,[matched(),review('incomplete-reversal',key='S1-R')])
t=[[row('B1','S1',1000),row('B2','S2',1000)],[row('L1','S1',1000,side=1),row('L2','S2',1000,side=1)]];t[0].append(row('RB','REV',1000,'inflow','reversal','reversal',reverse='B1',day='2026-09-20',value='2026-09-21'));t[1].append(row('RL','REV',1000,'inflow','reversal','reversal',reverse='L2',day='2026-09-20',value='2026-09-21',side=1));add('reversal-wrong-origin',t,[matched('S1'),matched('S2'),review('reversal-origin-conflict',key='REV')])
t=base();t[0][0][-1]='987.25';t[1][1][4]='inflow';add('net-equality-with-wrong-fee-sign',t,[badstatus()],actions=[dict(type='accept',bank=['B1'],cash=['L1','F1','T1'],reject=True)],bad=[(1,3)])
add('bank-only',[[row('B1','S1',1000)],[]],[review('missing-counterpart')])

add('balanced-policy-conflict',[[row('B1','S1',1000)],[row('L1','S1',1000,policy='outgoing-inclusive',side=1)]],[review('policy-members')],actions=[dict(type='accept',bank=['B1'],cash=['L1'],reject=True)])

add('empty-sources',[[],[]],[])
add('duplicate-cash-record',[[row('B1','S1',1000)],[row('L1','S1',1000,side=1),row('L1','S1',1000,side=1)]],[badstatus()],bad=[(1,2),(1,3)])
add('over-member-limit',[[row('B1','S1',10100,role='settlement',policy='outgoing-inclusive')],[row(f'L{i}','S1',100,policy='outgoing-inclusive',side=1) for i in range(101)]],[review('member-limit')],actions=[dict(type='accept',bank=['B1'],cash=['L0'],reject=True)])

# سلبيات معزولة: تساوي الصافي لا يثبت الدور أو العضوية أو الأصل.
reject=lambda bank,cash:dict(type='accept',bank=bank,cash=cash,reject=True)
t=base();t[1]=t[1][:1];add('human-amount-override',t,[review('amount-difference')],actions=[reject(['B1'],['L1'])])
add('human-reference-override',[[row('B1','S1',1000)],[row('L1','S2',1000,side=1)]],[review('missing-counterpart',key='S1'),review('missing-counterpart',key='S2')],actions=[reject(['B1'],['L1'])])
add('one-empty-reference',[[row('B1','',1000)],[row('L1','S1',1000,side=1)]],[review('missing-identity',key='blank:0:B1'),review('missing-counterpart')],actions=[reject(['B1'],['L1'])])
t=[[row('B1','S1',1000),row('B2','S1',200,'inflow'),row('B3','S1',200)],[row('L1','S1',1000,side=1)]]
add('balanced-extra-members',t,[review('policy-members')],actions=[reject(['B1'],['L1']),reject(['B1','B2','B3'],['L1'])])
add('balanced-role-conflict',[[row('B1','S1',25,role='periodic-fee')],[row('L1','S1',25,side=1)]],[review('policy-members')],actions=[reject(['B1'],['L1'])])
t=base(True);t[1]+=[row('L2','S1',20,'inflow','principal','incoming-net',side=1),row('F2','S1',20,'outflow','fee','incoming-net',parent='L2',side=1)]
for side in [0,1]:
 originals=list(t[side]) if side==0 else list(t[side][:3])
 t[side]+=[row('R-'+r[0],'S1-R',r[-1],'outflow' if r[4]=='inflow' else 'inflow','reversal','reversal',reverse=r[0],day='2026-09-20',value='2026-09-21',side=side) for r in originals]
add('balanced-partial-reversal',t,[matched(),review('incomplete-reversal',key='S1-R')],actions=[reject(['R-B1'],['R-L1','R-F1','R-T1'])])
for name,ref in [('missing-fee-parent','MISSING'),('fee-parent-is-fee','F1')]:
 t=base();t[1][2][6]=ref;add(name,t,[badstatus()],actions=[reject(['B1'],['L1','F1'])],bad=[(1,4)])
# تاريخ الحركة والقيمة كلاهما لا يسبق الأصل؛ كل عكس كامل يستهلك أصله مرة واحدة.
for name,change in [('reversal-self-origin',(7,'RB')),('reversal-missing-origin',(7,'MISSING')),('reversal-cross-side-origin',(7,'L1')),('reversal-partial-amount',(16,'900')),('reversal-wrong-direction',(4,'outflow')),('reversal-earlier-booking',(2,'2026-09-14')),('reversal-earlier-value',(3,'2026-09-15'))]:
 t=[[row('B1','S1',1000),row('RB','REV',1000,'inflow','reversal','reversal',reverse='B1',day='2026-09-20',value='2026-09-21')],[row('L1','S1',1000,side=1),row('RL','REV',1000,'inflow','reversal','reversal',reverse='L1',day='2026-09-20',value='2026-09-21',side=1)]]
 t[0][1][change[0]]=change[1];add(name,t,[badstatus(),badstatus('REV')],bad=[(0,3)],actions=[reject(['B1'],['L1'])])
for name,secondref in [('duplicate-reversal-same-group','REV'),('duplicate-reversal-other-group','REV2')]:
 t=[[row('B1','S1',1000),row('RB','REV',1000,'inflow','reversal','reversal',reverse='B1',day='2026-09-20',value='2026-09-21'),row('RB2',secondref,1000,'inflow','reversal','reversal',reverse='B1',day='2026-09-22',value='2026-09-23')],[row('L1','S1',1000,side=1),row('RL','REV',1000,'inflow','reversal','reversal',reverse='L1',day='2026-09-20',value='2026-09-21',side=1),row('RL2',secondref,1000,'inflow','reversal','reversal',reverse='L1',day='2026-09-22',value='2026-09-23',side=1)]]
 # كل العكوس المتنافسة ظاهرة وغير صالحة، والأصل لا يختفي.
 add(name,t,[badstatus()],bad=[(0,3),(0,4),(1,3),(1,4)])
t=[[row('B1','S1',1000),row('RB','REV',1000,'inflow','reversal','reversal',reverse='B1',day='2026-09-20',value='2026-09-21'),row('RRB','REV2',1000,'outflow','reversal','reversal',reverse='RB',day='2026-09-22',value='2026-09-23')],[row('L1','S1',1000,side=1),row('RL','REV',1000,'inflow','reversal','reversal',reverse='L1',day='2026-09-20',value='2026-09-21',side=1),row('RRL','REV2',1000,'outflow','reversal','reversal',reverse='RL',day='2026-09-22',value='2026-09-23',side=1)]]
add('reversal-of-reversal',t,[badstatus(),badstatus('REV')],bad=[(0,4),(1,4)])
t=[[row('B1','',1000),row('RB','REV',1000,'inflow','reversal','reversal',reverse='B1',day='2026-09-20',value='2026-09-21')],[row('L1','',1000,side=1),row('RL','REV',1000,'inflow','reversal','reversal',reverse='L1',day='2026-09-20',value='2026-09-21',side=1)]]
add('reversal-origin-no-identity',t,[badstatus('blank:0:B1'),badstatus('blank:1:L1')],bad=[(0,3),(1,3)])
t=[[row('B1','S1',1000,day='2026-08-31',value='2026-08-31'),row('RB','REV',1000,'inflow','reversal','reversal',reverse='B1',day='2026-09-20',value='2026-09-21')],[row('L1','S1',1000,day='2026-08-31',value='2026-08-31',side=1),row('RL','REV',1000,'inflow','reversal','reversal',reverse='L1',day='2026-09-20',value='2026-09-21',side=1)]]
add('reversal-previous-period',t,[],bad=[(0,2),(0,3),(1,2),(1,3)])
for name,column in [('within-period-booking-difference',2),('within-period-value-difference',3)]:
 t=[[row('B1','S1',1000)],[row('L1','S1',1000,side=1)]];t[1][0][column]='2026-09-17'
 add(name,t,[review('timing-review',True)],actions=[dict(type='accept',bank=['B1'],cash=['L1'],expectedStatus='matched-manual')])
t=base();t[1][1][2]='2026-09-17';add('fee-within-period-timing',t,[review('timing-review',True)],actions=[dict(type='accept',bank=['B1'],cash=['L1','F1','T1'],expectedStatus='matched-manual')])
for name,side in [('bank-value-before-period',0),('cash-value-after-period',1)]:
 t=[[row('B1','S1',1000)],[row('L1','S1',1000,side=1)]];t[side][0][3]='2026-08-31' if side==0 else '2026-10-02'
 add(name,t,[review('timing-review',True)],actions=[dict(type='accept',bank=['B1'],cash=['L1'],expectedStatus='matched-manual'),dict(type='undo',bank=['B1'],cash=['L1'],expectedStatus='needs-review')])

(root/'expected.json').write_text(json.dumps(dict(sample='synthetic-not-field',version='bank-cash-movements-1',scope=scope,headers=headers,cases=cases),ensure_ascii=False,indent=2)+'\n')
print('Frozen bank truth:',len(cases),'cases',2*len(cases),'CSV sources; movements only, no balance close')
