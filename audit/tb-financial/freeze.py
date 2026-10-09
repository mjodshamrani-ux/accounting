"""Pre-engine synthetic originals. Financial facts use csv + Decimal only."""
import csv,json,hashlib,copy
from pathlib import Path
from decimal import Decimal
ROOT=Path(__file__).parent/'frozen';ROOT.mkdir(parents=True,exist_ok=True)
SH=['Entity','Ledger','Currency','Currency basis','Posting status','Posting layer','Period start','Period end','As of','Chart version','Map version','Closing basis']
S=dict(zip(['entity','ledger','currency','currencyBasis','postingStatus','postingLayer','start','end','asOf','chartVersion','mapVersion','closingBasis'],['Synthetic Financial Owner','Primary Book','SAR','functional','posted','actual','2026-09-01','2026-09-30','2026-09-30','CHART-1','MAP-1','post-closing']))
HEADERS=[['Account ID','Complete dimensions','Account label','Account class','Debit','Credit']+SH,['Mapping ID','Account ID','Complete dimensions','Line ID','Sign','Evidence ID']+SH,['Evidence ID','Account ID','Complete dimensions','Account class','Line ID','Line label','Line class','Sign','Valid from','Valid to','Evidence reference']+SH,['Line ID','Line label','Line class','Amount']+SH]
classes=['current-asset','noncurrent-asset','current-liability','noncurrent-liability','equity']
lines=[['CASH','Cash','current-asset','1000.00'],['REC','Receivables net','current-asset','500.00'],['PPE','Equipment','noncurrent-asset','500.00'],['PAY','Payables','current-liability','800.00'],['LOAN','Loan','noncurrent-liability','200.00'],['CAP','Capital','equity','1000.00']]
accounts=[['001','none','Cash','current-asset','1000.00','0.00','CASH'],['002','none','Receivables','current-asset','600.00','0.00','REC'],['003','none','Allowance','current-asset','0.00','100.00','REC'],['004','none','Equipment','noncurrent-asset','500.00','0.00','PPE'],['101','none','Payables','current-liability','0.00','800.00','PAY'],['102','none','Loan','noncurrent-liability','0.00','200.00','LOAN'],['201','none','Capital','equity','0.00','1000.00','CAP']]
def model():
 scope=list(S.values());tb=[];mp=[];ev=[]
 for a in accounts:
  aid,dim,label,cls,d,c,lid=a;line=next(l for l in lines if l[0]==lid);sign='debit-positive' if 'asset' in cls else 'credit-positive';pid='P-'+aid
  tb.append([aid,dim,label,cls,d,c,*scope]);mp.append(['M-'+aid,aid,dim,lid,sign,pid,*scope]);ev.append([pid,aid,dim,cls,lid,line[1],line[2],sign,'2026-01-01','2026-12-31','Approved presentation document '+aid,*scope])
 return dict(rows=[tb,mp,ev,[[*l,*scope] for l in lines]],headers=copy.deepcopy(HEADERS),scope=copy.deepcopy(S),complete=True)
def change_scope(x,key,value):
 idx=list(S).index(key);x['scope'][key]=value
 for side,rows in enumerate(x['rows']):
  for r in rows:r[len(HEADERS[side])-len(S)+idx]=value
cases=[]
def money(v,dec):
 n=Decimal(v)*(10**dec)
 if n!=n.to_integral_value():raise ValueError(v)
 return int(n)
def facts(x,actions,status):
 dec={'SAR':2,'JPY':0,'KWD':3}.get(x['scope']['currency'],2)
 raw=[dict(headers=h,rows=rs) for h,rs in zip(x['headers'],x['rows'])]
 good=status not in ['source-error','missing']
 out=dict(originalTables=raw,financialFacts=None)
 if not good:return out
 tb,mp,ev,fs=x['rows'];tb=[r for r in tb if any(r)];debits=sum(money(r[4],dec) for r in tb);credits=sum(money(r[5],dec) for r in tb)
 account_facts=[dict(account=r[0],dimensions=r[1],debit=money(r[4],dec),credit=money(r[5],dec),net=money(r[4],dec)-money(r[5],dec),sourceRow=i+2) for i,r in enumerate(x['rows'][0]) if any(r)]
 line_facts=[];accepted=set();rejected=set()
 for action in actions:
  if action=='accept-all':accepted={r[0] for r in fs};rejected=set()
  elif action=='accept-rec':accepted.add('REC');rejected.discard('REC')
  elif action=='reject-rec':accepted.discard('REC');rejected.add('REC')
  elif action=='undo-rec':accepted.discard('REC');rejected.discard('REC')
 for i,line in enumerate(fs):
  members=[]
  for j,m in enumerate(mp):
   if m[3]!=line[0]:continue
   a=next(r for r in tb if r[0:2]==m[1:3]);e=next(r for r in ev if r[0]==m[5]);net=money(a[4],dec)-money(a[5],dec);v=net if m[4]=='debit-positive' else -net
   members.append(dict(mappingId=m[0],account=a[0],dimensions=a[1],evidenceId=e[0],accountRow=x['rows'][0].index(a)+2,mappingRow=j+2,evidenceRow=ev.index(e)+2,contribution=v,debit=money(a[4],dec),credit=money(a[5],dec),net=net))
  calculated=sum(m['contribution'] for m in members);reported=money(line[3],dec)
  line_facts.append(dict(id=line[0],label=line[1],category=line[2],row=i+2,calculated=calculated,reported=reported,difference=calculated-reported,review='accepted' if line[0] in accepted else 'rejected' if line[0] in rejected else 'needs-review',members=members))
 grouped={field:{cls:sum(l[field] for l in line_facts if l['category']==cls) for cls in classes} for field in ['calculated','reported']}
 equation=lambda g:g['current-asset']+g['noncurrent-asset']-g['current-liability']-g['noncurrent-liability']-g['equity']
 out['financialFacts']=dict(decimals=dec,debit=debits,credit=credits,tbResidual=debits-credits,accounts=account_facts,lines=line_facts,totals=grouped,grandTotals={k:dict(assets=v['current-asset']+v['noncurrent-asset'],liabilities=v['current-liability']+v['noncurrent-liability'],equity=v['equity']) for k,v in grouped.items()},equations={k:equation(v) for k,v in grouped.items()})
 return out

def add(name,edit=None,status='consistent-with-evidence',actions=None,reject=None):
 x=model()
 if edit:edit(x)
 if actions is None:actions=['accept-all'] if status=='consistent-with-evidence' and not reject else []
 files=[]
 for i,(h,rows) in enumerate(zip(x['headers'],x['rows'])):
  p=ROOT/f'{name}-{i}.csv'
  with p.open('w',newline='') as f:csv.writer(f,lineterminator='\n').writerows([h,*rows])
  files.append(dict(file=p.name,sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
 cases.append(dict(name=name,scope=x['scope'],complete=x['complete'],status=status,actions=actions,reject=reject,files=files,**facts(x,actions,status)))
add('whole-post-closing')
add('pending',status='needs-review',actions=[])
add('undo',status='needs-review',actions=['accept-all','undo-rec'])
add('reject',status='needs-review',actions=['accept-all','undo-rec','reject-rec'])
add('reject-undo-accept',actions=['reject-rec','undo-rec','accept-all'])
add('zero-account-included',lambda x:(x['rows'][0].append(['009','none','Zero account','current-asset','0.00','0.00',*list(S.values())]),x['rows'][1].append(['M-009','009','none','CASH','debit-positive','P-009',*list(S.values())]),x['rows'][2].append(['P-009','009','none','current-asset','CASH','Cash','current-asset','debit-positive','2026-01-01','2026-12-31','Zero account presentation evidence',*list(S.values())])))
def dimensions(x):
 for side,index in [(0,1),(1,2),(2,2)]:x['rows'][side][1][index]='branch=B'
add('complete-dimensions',dimensions)
def leading(x):
 for side,index in [(0,0),(1,1),(2,1)]:x['rows'][side][1][index]='1'
add('literal-leading-zero-account',leading)
def negative_equity(x):
 x['rows'][0][0][4]='1000.00';x['rows'][0][6][4:6]=['500.00','0.00'];x['rows'][0][4][5]='2300.00';x['rows'][3][3][3]='2300.00';x['rows'][3][5][3]='-500.00'
add('negative-equity',negative_equity)
def currency(x,c):
 change_scope(x,'currency',c)
 if c=='JPY':
  for r in x['rows'][0]:r[4:6]=[str(int(Decimal(v))) for v in r[4:6]]
  for r in x['rows'][3]:r[3]=str(int(Decimal(r[3])))
 elif c=='KWD':
  for r in x['rows'][0]:r[4:6]=[format(Decimal(v),'.3f') for v in r[4:6]]
  for r in x['rows'][3]:r[3]=format(Decimal(r[3]),'.3f')
add('jpy-zero-decimals',lambda x:currency(x,'JPY'))
def kwd(x):
 currency(x,'KWD');x['rows'][0][0][4]='1000.001';x['rows'][0][6][5]='1000.001';x['rows'][3][0][3]='1000.001';x['rows'][3][5][3]='1000.001'
add('kwd-three-decimals',kwd)
add('offsetting-line-differences',lambda x:(x['rows'][3][0].__setitem__(3,'1000.01'),x['rows'][3][1].__setitem__(3,'499.99')),status='difference')
add('unbalanced-tb',lambda x:x['rows'][0][0].__setitem__(4,'1000.01'),status='inconsistent')
add('unbalanced-statement',lambda x:x['rows'][3][0].__setitem__(3,'1000.01'),status='inconsistent')
add('incomplete-attestation',lambda x:x.__setitem__('complete',False),status='needs-review',actions=[])
add('missing-mapping',lambda x:x['rows'][1].pop(1),status='missing')
add('missing-evidence',lambda x:x['rows'][2].pop(1),status='missing')
add('missing-statement-line',lambda x:x['rows'][3].pop(1),status='missing')
add('empty-tb',lambda x:x['rows'][0].clear(),status='source-error')
add('empty-all',lambda x:[r.clear() for r in x['rows']],status='missing')
add('zero-account-unmapped',lambda x:x['rows'][0].append(['009','none','Zero account','current-asset','0.00','0.00',*list(S.values())]),status='missing')
add('orphan-zero-line',lambda x:x['rows'][3].append(['ZERO','Orphan zero','current-asset','0.00',*list(S.values())]),status='missing')
def wrong_mapping(x):
 x['rows'][1][0][3]='REC';x['rows'][1][1][3]='CASH';x['rows'][3][0][3]='600.00';x['rows'][3][1][3]='900.00'
add('wrong-lines-equal-totals',wrong_mapping,status='source-error')
add('wrong-current-classification',lambda x:x['rows'][3][0].__setitem__(2,'noncurrent-asset'),status='source-error')
add('wrong-account-class',lambda x:x['rows'][0][0].__setitem__(3,'noncurrent-asset'),status='source-error')
add('wrong-line-label',lambda x:x['rows'][3][0].__setitem__(1,'Other cash'),status='source-error')
add('wrong-sign',lambda x:x['rows'][1][4].__setitem__(4,'debit-positive'),status='source-error')
add('wrong-proof-sign',lambda x:x['rows'][2][4].__setitem__(7,'debit-positive'),status='source-error')
add('expired-evidence',lambda x:x['rows'][2][0].__setitem__(9,'2026-09-20'),status='source-error')
add('future-evidence',lambda x:x['rows'][2][0].__setitem__(8,'2026-09-02'),status='source-error')
add('missing-proof-reference',lambda x:x['rows'][2][0].__setitem__(10,''),status='source-error')
for name,side in [('duplicate-account',0),('duplicate-mapping',1),('duplicate-proof',2),('duplicate-line',3)]:add(name,lambda x,i=side:x['rows'][i].append(copy.deepcopy(x['rows'][i][0])),status='source-error')
def bad_competitor(x):
 r=copy.deepcopy(x['rows'][1][1]);r[0]='M-OTHER';r[4]='unknown';x['rows'][1].append(r)
add('malformed-mapping-competitor',bad_competitor,status='source-error')
add('mapping-wrong-dimension',lambda x:x['rows'][1][1].__setitem__(2,'branch=B'),status='source-error')
add('mapping-unknown-proof',lambda x:x['rows'][1][0].__setitem__(5,'P-MISSING'),status='source-error')
add('mapping-proof-for-another-account',lambda x:x['rows'][1][0].__setitem__(5,'P-002'),status='source-error')
add('mapping-unknown-account',lambda x:x['rows'][1][0].__setitem__(1,'404'),status='source-error')
add('proof-extra-account',lambda x:(x['rows'][2].append(copy.deepcopy(x['rows'][2][0])),x['rows'][2][-1].__setitem__(0,'P-EXTRA'),x['rows'][2][-1].__setitem__(1,'404')),status='source-error')
add('source-wrong-currency',lambda x:x['rows'][1][0].__setitem__(8,'USD'),status='source-error')
add('source-wrong-map-version',lambda x:x['rows'][1][0].__setitem__(16,'MAP-2'),status='source-error')
add('source-wrong-chart-version',lambda x:x['rows'][2][0].__setitem__(20,'CHART-2'),status='source-error')
add('source-wrong-asof',lambda x:x['rows'][3][0].__setitem__(12,'2026-09-29'),status='source-error')
add('both-debit-credit',lambda x:x['rows'][0][0].__setitem__(5,'1.00'),status='source-error')
add('negative-debit',lambda x:x['rows'][0][0].__setitem__(4,'-1000.00'),status='source-error')
add('excess-precision',lambda x:x['rows'][0][0].__setitem__(4,'1000.001'),status='source-error')
add('unknown-income-account',lambda x:x['rows'][0][0].__setitem__(3,'income'),status='source-error')
add('formula-like-money',lambda x:x['rows'][0][0].__setitem__(4,'=1000'),status='source-error')
add('blank-inventory-row',lambda x:x['rows'][0].append(['']*len(HEADERS[0])))
add('blank-before-and-middle',lambda x:(x['rows'][0].insert(0,['']*len(HEADERS[0])),x['rows'][0].insert(4,['']*len(HEADERS[0]))))
for name,action,reject in [('partial-line-accept','partial-accept','EVENT_MEMBERS'),('extra-line-member','extra-member','EVENT_MEMBERS'),('wrong-line-decision','unknown-line','EVENT_LINE'),('repeat-decision','repeat-accept','EVENT_STATE'),('undo-before-decision','undo-rec','EVENT_STATE'),('stale-decision-context','stale-context','EVENT_CONTEXT'),('missing-decision-reference','missing-reference','EVENT_EVIDENCE'),('missing-utc-zone','missing-utc','EVENT_DATE')]:add(name,actions=[action],reject=reject,status='needs-review')
add('sum-final-limit',lambda x:(x['rows'][0][0].__setitem__(4,'1000000000000.00'),x['rows'][0][6].__setitem__(5,'1000000000000.00')),status='needs-review',actions=[],reject='SUM')
for name,key,value,reason in [('unknown-currency','currency','ZZZ','SCOPE'),('preclosing-unsupported','closingBasis','pre-closing','SCOPE'),('asof-not-end','asOf','2026-09-29','SCOPE')]:add(name,lambda x,k=key,v=value:change_scope(x,k,v),status='needs-review',actions=[],reject=reason)
def two_dimensions(x):
 scope=list(S.values());x['rows'][0].append(['002','branch=B','Receivables branch B','current-asset','100.00','0.00',*scope]);x['rows'][1].append(['M-002-B','002','branch=B','REC','debit-positive','P-002-B',*scope]);x['rows'][2].append(['P-002-B','002','branch=B','current-asset','REC','Receivables net','current-asset','debit-positive','2026-01-01','2026-12-31','Separate branch B presentation evidence',*scope]);x['rows'][0][6][5]='1100.00';x['rows'][3][1][3]='600.00';x['rows'][3][5][3]='1100.00'
add('same-account-two-dimensions',two_dimensions)
add('same-account-one-dimension-unmapped',lambda x:(two_dimensions(x),x['rows'][1].pop()),status='missing')
add('coherent-unsupported-reclassification',lambda x:(x['rows'][2][0].__setitem__(6,'noncurrent-asset'),x['rows'][3][0].__setitem__(2,'noncurrent-asset')),status='source-error')
def exact_limit(x):
 for r in x['rows'][0]:r[4:6]=['0.00','0.00']
 for r in x['rows'][3]:r[3]='0.00'
 x['rows'][0][0][4]='1000000000000.00';x['rows'][0][6][5]='1000000000000.00';x['rows'][3][0][3]='1000000000000.00';x['rows'][3][5][3]='1000000000000.00'
add('inclusive-exact-limit',exact_limit)
add('difference-final-limit',lambda x:(exact_limit(x),x['rows'][3][0].__setitem__(3,'-1000000000000.00'),x['rows'][3][5].__setitem__(3,'-1000000000000.00')),status='needs-review',actions=[],reject='SUM')
add('statement-equation-final-limit',lambda x:(exact_limit(x),x['rows'][3][3].__setitem__(3,'-1000000000000.00'),x['rows'][3][5].__setitem__(3,'0.00')),status='needs-review',actions=[],reject='SUM')
add('category-total-final-limit',lambda x:(exact_limit(x),x['rows'][3][1].__setitem__(3,'1000000000000.00'),x['rows'][3][3].__setitem__(3,'1000000000000.00')),status='needs-review',actions=[],reject='SUM')
add('equation-cancellation-within-limit',lambda x:(exact_limit(x),x['rows'][3][3].__setitem__(3,'-1000000000000.00')),status='inconsistent',actions=[])

def zero_accounts(x):
 for r in x['rows'][0]:r[4:6]=['0.00','0.00']
 for r in x['rows'][3]:r[3]='0.00'
def asset_total_limit(x):
 zero_accounts(x)
 for i in [0,2,3,5]:x['rows'][3][i][3]='1000000000000.00'
def liability_total_limit(x):
 zero_accounts(x)
 for i in [0,3,4]:x['rows'][3][i][3]='1000000000000.00'
 x['rows'][3][5][3]='-1000000000000.00'
add('asset-total-independent-limit',asset_total_limit,status='needs-review',actions=[],reject='SUM')
add('liability-total-independent-limit',liability_total_limit,status='needs-review',actions=[],reject='SUM')

# Reject-action cases only need originals, not a pretend accepted result.
for c in cases:
 if c['reject']:c['financialFacts']=None
manifest=dict(version='tb-financial-position-1',syntheticOnly=True,frozenBeforeEngine=True,scope=S,scopeHeaders=SH,headers=HEADERS,categories=classes,cases=cases,claim='Consistency with supplied confirmed presentation evidence only; no source authenticity, ERP completeness, fair-presentation or accounting-standards compliance opinion')
(ROOT/'expected.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(len(cases),'cases;',len(cases)*4,'original CSVs; no product imports')
