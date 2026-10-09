"""Immutable synthetic asset originals/Decimal truths, before any product engine."""
import copy
import csv
import hashlib
import io
import json
from pathlib import Path
from reference import FIELDS, HEADERS, COMPONENTS, CLASSES, SIGNS, inspect
ROOT = Path(__file__).resolve().parent
SCOPE = dict(zip(FIELDS, ['Synthetic Asset Owner', 'ASSET-BOOK', 'GL-BOOK', 'SAR', 'functional', 'posted',
                         'Current', '2026-09-30', 'CHART-1', 'MAP-1', 'provided-components-1', 'ASSET-SET-1']))
BASE = [
    [['A', 'site=01', '1000', '200', '50', '750', 'V-A'], ['B', 'site=02', '400', '100', '0', '300', 'V-B']],
    [[f'MAP-{asset}-{component}', asset, f'site={site}', component, f'GL-{component}', 'branch=01', f'POL-{asset}-{component}']
     for asset, site in [('A', '01'), ('B', '02')] for component in COMPONENTS],
    [[f'POL-{asset}-{component}', asset, f'site={site}', component, f'V-{asset}', f'GL-{component}', 'branch=01', CLASSES[index],
      SIGNS[index], 'provided-posted-component', '2026-01-01', '2026-12-31', f'SYN-POL-{asset}-{component}']
     for asset, site in [('A', '01'), ('B', '02')] for index, component in enumerate(COMPONENTS)],
    [['GL-cost', 'branch=01', CLASSES[0], '1400', '0'], ['GL-depreciation', 'branch=01', CLASSES[1], '0', '300'],
     ['GL-impairment', 'branch=01', CLASSES[2], '0', '50']],
]
CASES = []
def add(name, rows=None, kind='ready', scope=None, override=None):
    CASES.append(dict(name=name, rows=copy.deepcopy(BASE if rows is None else rows), kind=kind,
                      scope=copy.deepcopy(SCOPE if scope is None else scope), override=override))
def changed(source, row, column, value):
    rows=copy.deepcopy(BASE); rows[source][row][column]=value; return rows
add('three-components-positive')
for name, src, row, col, value, kind in [
    ('cost-one-minor-difference',3,0,3,'1399.99','difference'),
    ('depreciation-one-minor-difference',3,1,4,'299.99','difference'),
    ('impairment-one-minor-difference',3,2,4,'49.99','difference'),
    ('negative-cost-gl-not-flipped',3,0,4,'1500','difference'),
    ('negative-contra-gl-not-flipped',3,1,3,'400','difference'),
    ('cost-missing',0,0,2,'','source-error'),
    ('negative-cost-unsupported',0,0,2,'-1000','source-error'),
    ('negative-accumulated-depreciation-unsupported',0,0,3,'-200','source-error'),
    ('negative-impairment-unsupported',0,0,4,'-50','source-error'),
    ('carrying-equation-fails',0,0,5,'751','source-error'),
    ('carrying-negative-unsupported',0,0,5,'-750','source-error'),
    ('precision-not-rounded',0,0,2,'1000.001','source-error'),
    ('arabic-numeric-not-inferred',0,0,2,'١٠٠٠','source-error'),
    ('decimal-comma-not-inferred',0,0,2,'1,000','source-error'),
    ('exponent-not-inferred',0,0,2,'1e3','source-error'),
    ('asset-identity-literal',1,0,1,'001','missing'),
    ('asset-dimensions-complete',1,0,2,'site=02','missing'),
    ('component-not-inferred',1,0,3,'net','source-error'),
    ('evidence-component-match',2,0,1,'B','missing'),
    ('evidence-valuation-match',2,0,4,'V-B','missing'),
    ('gl-dimensions-match',1,0,5,'branch=02','missing'),
    ('evidence-sign-not-inferred',2,1,8,'debit-positive','source-error'),
    ('evidence-basis-not-inferred',2,0,9,'cost-over-life','source-error'),
    ('evidence-class-not-inferred',2,1,7,'fixed-asset-cost','source-error'),
    ('gl-class-not-inferred',3,1,2,'expense','source-error'),
    ('expired-evidence',2,0,11,'2026-09-29','source-error'),
    ('inclusive-validity',2,0,11,'2026-09-30','ready'),
    ('year-zero-invalid-evidence',2,0,10,'0000-01-01','source-error'),
    ('compact-date-invalid-evidence',2,0,10,'20260101','source-error'),
    ('week-date-invalid-evidence',2,0,10,'2026-W01-1','source-error'),
]:add(name,changed(src,row,col,value),kind)
rows=copy.deepcopy(BASE); rows[0][0][3:6]=['1000','0','0'];rows[3][1][4]='1100';rows[3][2][4]='0';add('zero-carrying-valid',rows)
rows=copy.deepcopy(BASE);rows[0][0][3:6]=['1001','0','0'];add('contra-exceeds-cost-source-error',rows,'source-error')
rows=copy.deepcopy(BASE);rows[3][0][3]='1399';rows[3][1][4]='299';add('component-differences-masked-by-net',rows,'difference')
for source, name in enumerate(['register','mapping','evidence','gl']):
 rows=copy.deepcopy(BASE);rows[source].append(copy.deepcopy(rows[source][0]));add('duplicate-'+name,rows,'source-error')
 rows=copy.deepcopy(BASE);rows[source]=[];add('empty-'+name,rows,'missing')
rows=copy.deepcopy(BASE);rows[0].append(['A','site=01','broken','200','50','750','V-A']);add('malformed-register-competitor-full-member',rows,'source-error')
rows=copy.deepcopy(BASE);rows[1].append(['MAP-OTHER','A','site=01','cost','GL-cost','branch=01','POL-A-cost']);add('mapping-id-does-not-prove-component-uniqueness',rows,'source-error')
rows=copy.deepcopy(BASE);rows[3].append(['GL-zero','branch=01',CLASSES[0],'0','0']);add('unmapped-zero-cost-account-not-dropped',rows,'missing')
rows=copy.deepcopy(BASE);rows[3].append(['GL-zero','branch=01',CLASSES[1],'0','0']);add('unmapped-zero-contra-account-not-dropped',rows,'missing')
rows=copy.deepcopy(BASE);rows[1].pop(2);add('zero-impairment-still-needs-mapping',rows,'missing')
rows=copy.deepcopy(BASE);rows[1].pop(5);add('zero-asset-component-still-needs-mapping',rows,'missing')
rows=copy.deepcopy(BASE);rows[2].pop(5);add('zero-component-still-needs-evidence',rows,'missing')
rows=copy.deepcopy(BASE);rows[1].append(['MAP-Z','Z','site=03','cost','GL-cost','branch=01','POL-A-cost']);add('orphan-mapping-visible',rows,'missing')
rows=copy.deepcopy(BASE);p=copy.deepcopy(rows[2][0]);p[0]='POL-Z';p[1]='Z';rows[2].append(p);add('orphan-evidence-visible',rows,'missing')
rows=copy.deepcopy(BASE)
for source, acct_col in [(1,4),(2,5)]:
 for row in rows[source]:
  if row[1]=='B' and row[3]=='cost':row[acct_col]='GL-cost-B'
rows[3][0][3]='900';rows[3].append(['GL-cost-B','branch=01',CLASSES[0],'500','0']);add('opposite-cost-differences-zero-grand',rows,'difference')
rows=copy.deepcopy(BASE);rows[0][0][2:6]=['1000000000000','0','0','1000000000000'];rows[0][1][2:6]=['0','0','0','0'];rows[3][0][3]='1000000000000';rows[3][1][4]='0';rows[3][2][4]='0';add('minor-bound-inclusive',rows)
rows=copy.deepcopy(rows);rows[0][1][2:6]=['0.01','0','0','0.01'];add('register-aggregate-bound-plus-one',rows,'source-error')
rows=changed(0,0,2,'1000000000000.01');add('value-bound-plus-one',rows,'source-error')
# A declared class different from the component maps is missing even when monetary net matches.
rows=changed(3,0,2,CLASSES[1]);add('account-class-component-mismatch',rows,'missing')
for name,field,value in [('foreign-entity','entity','OTHER'),('unposted-row','postingStatus','draft'),
                          ('foreign-component-policy','componentPolicyVersion','POLICY-OTHER')]:
 add(name,kind='source-error',override=[0,0,field,value])
for currency, name in [('JPY','jpy-zero-precision-positive'),('KWD','kwd-three-precision-positive')]:
 scope=copy.deepcopy(SCOPE);scope['currency']=currency;add(name,scope=scope)

def encode(rows, source, scope, override=None):
 full=[HEADERS[source]]+[r+[scope[k] for k in FIELDS] for r in rows]
 if override and override[0]==source:
  _, row, field, value=override;full[row+1][len(VALUES_SOURCE[source])+FIELDS.index(field)]=value
 stream=io.StringIO(newline='');csv.writer(stream,lineterminator='\n').writerows(full);return stream.getvalue().encode()
VALUES_SOURCE=[h[:len(h)-len(FIELDS)] for h in HEADERS]

def freeze():
 manifest=[];catalog=[]
 for case in CASES:
  folder=ROOT/'cases'/case['name'];folder.mkdir(parents=True,exist_ok=True)
  paths=[]
  for source,rows in enumerate(case['rows']):
   path=folder/f'source-{source}.csv';content=encode(rows,source,case['scope'],case['override'])
   if path.exists():assert path.read_bytes()==content,path
   else:path.write_bytes(content)
   paths.append(path)
  result=inspect(paths,case['scope']);assert result['kind']==case['kind'],(case['name'],result['kind'],case['kind'])
  content=(json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode();path=folder/'expected.json'
  if path.exists():assert path.read_bytes()==content,path
  else:path.write_bytes(content)
  catalog.append(dict(name=case['name'],kind=case['kind'],scope=case['scope']))
  for path in [*paths,folder/'expected.json']:
   b=path.read_bytes();manifest.append(dict(path=path.relative_to(ROOT).as_posix(),bytes=len(b),sha256=hashlib.sha256(b).hexdigest()))
 for filename, data in [('cases.json',catalog),('source-manifest.json',sorted(manifest,key=lambda x:x['path']))]:
  content=(json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode();path=ROOT/filename
  if path.exists():assert path.read_bytes()==content,path
  else:path.write_bytes(content)
 positive=json.loads((ROOT/'cases/three-components-positive/expected.json').read_text())
 assert positive['totals']==dict(register=dict(cost=140000,depreciation=30000,impairment=5000,carrying=105000),gl=dict(cost=140000,depreciation=30000,impairment=5000,carrying=105000))
 assert len(positive['members'])==17
 masked=json.loads((ROOT/'cases/component-differences-masked-by-net/expected.json').read_text())
 assert masked['totals']['register']['carrying']==masked['totals']['gl']['carrying']==105000
 assert [c['difference'] for c in masked['comparisons']]==[100,100,0] and masked['kind']=='difference'
 opposed=json.loads((ROOT/'cases/opposite-cost-differences-zero-grand/expected.json').read_text())
 assert [c['difference'] for c in opposed['comparisons']]==[10000,0,0,-10000] and opposed['kind']=='difference'
 bad=json.loads((ROOT/'cases/malformed-register-competitor-full-member/expected.json').read_text())
 assert len(bad['members'])==18 and bad['totals'] is None and all(c['difference'] is None for c in bad['comparisons'])
 print(json.dumps(dict(cases=len(CASES),files=len(manifest),manualChecks=7,synthetic=True)))
if __name__=='__main__':freeze()
