"""Independent G5a OpenXML + unchanged G3 original/Decimal/owner oracle.
No product or generator imports. This learned corpus proves export parity only.
"""
import argparse
import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

g3 = load('g5_g3', BASE/'inventory-pdf-accounting/check_result.py')
g4 = load('g5_g4', BASE/'inventory-pdf-lifecycle/check_lifecycle.py')
reader = load('g5_openxml', BASE/'inventory-pdf-foundation/check_control.py')
ROLES = ['register', 'mapping', 'policy-evidence', 'gl']
NAMES = ['register.pdf', 'mapping.csv', 'policy.csv', 'gl.csv']
VALUES = [
    ['Item ID','Item dimensions','Quantity scaled integer','Unit','Quantity precision','Posted value minor','Valuation reference'],
    ['Mapping ID','Item ID','Item dimensions','GL account','GL dimensions','Evidence ID'],
    ['Evidence ID','Item ID','Item dimensions','Unit','Quantity precision','Valuation reference','GL account','GL dimensions','Account class','Sign','Value basis','Valid from','Valid to','Reference'],
    ['GL account','GL dimensions','Account class','Debit minor','Credit minor'],
]
SHEETS = ['Summary','Register','Mapping','Policy evidence','GL balances','Account comparisons','Missing','Issues','Cell evidence','Inventory','Reading','Events','Event members','Sources','PDF records','PDF literals','PDF links','PDF controls','PDF diagnostics','PDF evidence']
def normal(value):
    if isinstance(value, list): return [normal(v) for v in value]
    return None if value == '' else value

def check_workbook(book, folder, r):
    return check_tables(reader.read_workbook(book), folder, r)

def check_tables(tables, folder, r):
    assert list(tables) == SHEETS, 'SHEET_SET_ORDER'
    def table(name, headers):
        data = tables[name]
        assert data[0] == headers, 'HEADERS_'+name
        assert all(len(row) <= len(headers) for row in data[1:]), 'ROW_WIDTH'
        return normal([row + ['']*(len(headers)-len(row)) for row in data[1:]])
    def expect(name, headers, expected):
        assert g3.same_value(table(name, headers), normal(expected)), 'TABLE_'+name
    summary_rows = table('Summary',['Field','Value'])
    assert len({row[0] for row in summary_rows}) == len(summary_rows), 'SUMMARY_DUPLICATE'
    s = dict(summary_rows)
    assert set(s) == {'Version','Claim','Status','Financial','Review','Context','Decimals','Scope confirmed','Completeness confirmed','Completeness reference','Completeness note','Register minor','Register minor basis','GL minor'} | (set(r['scope'])-{'confirmed'}), 'SUMMARY_FIELDS'
    assert s['Claim'] == 'Supplied posted carrying value consistency with evidenced mapping and selected inventory GL accounts; no valuation, quantity aggregation, posting or completeness opinion', 'CLAIM'
    assert s['Register minor basis'] == 'Only values with proven item/dimension mapping and policy evidence contribute; see Register for all supplied parsed values', 'SUPPORTED_BASIS'
    for k,v in {'Version':r['version'],'Status':r['status'],'Financial':r['financial'],'Review':r['review'],'Context':r['context'],'Decimals':r['decimals'],'Scope confirmed':'true',
                'Completeness confirmed':str(r['completeness']['confirmed']).lower(),
                'Completeness reference':r['completeness']['reference'], 'Completeness note':r['completeness']['note'],
                'Register minor':r['totals']['registerMinor'] if r['totals'] else None,
                'GL minor':r['totals']['glMinor'] if r['totals'] else None,
                **{k:v for k,v in r['scope'].items() if k!='confirmed'}}.items():
        assert g3.same_value(s[k], normal(v)), 'SUMMARY_'+k
    for source,name in enumerate(['Register','Mapping','Policy evidence','GL balances']):
        headers=['Record ID','Source','Source row']+(['Source page'] if source==0 else [])+VALUES[source]
        expected=[[v['id'],v['source'],v['row']]+([v.get('page')] if source==0 else [])+v['values'] for v in r['records'][source]]
        expect(name,headers,expected)
    expect('Account comparisons',['GL account','GL dimensions','Register minor','Debit minor','Credit minor','GL minor','Difference minor'],
           [[v[k] for k in ['account','dimensions','registerMinor','debitMinor','creditMinor','glMinor','differenceMinor']] for v in r['comparisons']])
    expect('Missing',['Missing'],[[v] for v in r['missing']])
    expect('Issues',['Source','Source row','Code'],[[v['source'],v['row'],v['code']] for v in r['issues']])
    expect('Cell evidence',['Source','Source row','Column','Field','Text'],[[v[k] for k in ['source','row','column','field','text']] for v in r['cells']])
    expect('Inventory',['Source','Source row','Kind'],[[v[k] for k in ['source','row','kind']] for v in r['inventory']])
    expect('Reading',['Source','Role','Family','Sheet','Confirmed'],[[i,v['role'],v['family'],v['sheet'],str(v['confirmed']).lower()] for i,v in enumerate(r['readings'])])
    expect('Events',['Event ID','Type','Context','At','Reference','Note','Member count'],[[v[k] for k in ['id','type','context','at','reference','note']]+[len(v['memberIds'])] for v in r['events']])
    expect('Event members',['Event ID','Member ID'],[[v['id'],member] for v in r['events'] for member in v['memberIds']])
    sources = table('Sources',['Source','Role','Name','Sheet','SHA256','Part','Parts','Base64'])
    assert {row[0] for row in sources} == {0,1,2,3}, 'SOURCE_SET'
    for i,name in enumerate(NAMES):
        parts=[row for row in sources if row[0]==i]
        data=(folder/name).read_bytes(); digest=hashlib.sha256(data).hexdigest()
        assert all(row[:5]==[i,ROLES[i],name,'CSV' if i else 'PDF',digest] and row[5:7]==[n+1,len(parts)] for n,row in enumerate(parts)), 'SOURCE_PARTS_IDENTITY'
        encoded=''.join(row[7] for row in parts)
        assert base64.b64decode(encoded,validate=True)==data and base64.b64encode(data).decode()==encoded, 'SOURCE_BYTES'
    e=r['pdfEvidence']
    expect('PDF records',['Record ID','Page','Line','Source row','Field','Raw text'],[[v['id'],v['page'],v['line'],v['row'],field,raw] for v in e['records'] for field,raw in v['raw'].items()])
    literal_rows=table('PDF literals',['SHA256','Page','Line','Items','Start UTF16','End UTF16','Operators','Part','Parts','Literal text'])
    cursor=0
    for v in e['literals']:
        # Derive grouping from sequence and bound count, not a first-wins key.
        assert cursor<len(literal_rows), 'LITERAL_MISSING'
        count=literal_rows[cursor][8]
        assert type(count) is int and 0<count<=1000, 'LITERAL_PART_COUNT'
        parts=literal_rows[cursor:cursor+count]
        for i,row in enumerate(parts):
            assert row[:3]==[v['span']['sourceHash'],v['span']['page'],v['span']['line']], 'LITERAL_OWNER'
            assert json.loads(row[3])==v['span']['items'] and row[4:6]==[v['start'],v['end']] and json.loads(row[6])==v['operators'], 'LITERAL_OFFSETS'
            assert row[7:9]==[i+1,count] and len(row[9].encode('utf-16-le'))//2<=30000, 'LITERAL_PARTS'
        assert ''.join(row[9] for row in parts)==v['text'], 'LITERAL_TEXT'
        cursor+=count
    assert cursor==len(literal_rows), 'LITERAL_EXTRA'
    links=[]
    for v in e['links']:
        for role,ids in [('mapping',v['mappingIds']),('policy',v['policyIds']),('gl',v['glIds']),('register',[v['registerId']])]:
            links.extend([[v['registerId'],role,identity,str(v['supported']).lower()] for identity in ids])
    expect('PDF links',['Register ID','Related role','Related ID','Supported'],links)
    controls=[['page',v['page'],v['declaredMinor'],v['actualMinor']] for v in e['pageTotals']]
    if e['reportTotal']:controls.append(['report',None,e['reportTotal']['declaredMinor'],e['reportTotal']['actualMinor']])
    expect('PDF controls',['Kind','Page','Declared minor','Actual minor'],controls)
    expect('PDF diagnostics',['Page','Line','Code'],[[v['page'],v['line'],v['code']] for v in e['issues']])
    parts=table('PDF evidence',['Format','SHA256','Part','Parts','JSON text'])
    assert parts and all(row[:4]==['inventory-pdf-workbook-evidence-1',e['reading']['source']['sha256'],i+1,len(parts)] and len(row[4].encode('utf-16-le'))//2<=30000 for i,row in enumerate(parts)), 'EVIDENCE_PARTS'
    assert g3.same_value(json.loads(''.join(row[4] for row in parts)), e), 'EVIDENCE_PARITY'
    return dict(records=len(r['records'][0]),members=len(r['memberIds']),pdfEvidenceParts=len(parts))

def check(root, report, books):
    expected={'INV1F-'+code for code in g3.CONTRACT['ready']+g3.CONTRACT['difference']+g3.CONTRACT['missing']+list(g3.CONTRACT['sourceErrors'])}
    assert report.keys()==expected, 'CASE_SET'
    baselines={}; exports=0
    for name,phases in report.items():
        positive=name[6:] in g3.CONTRACT['ready']
        required=['unreviewed','complete','accepted','undone','rejected','reopened'] if positive else ['unreviewed']
        assert list(phases)==required, 'PHASE_SET'
        baseline=phases['unreviewed']
        baselines[name]=baseline
        for phase,r in phases.items():
            complete=phase!='unreviewed'
            assert g3.same_value(r['scope'],g4.SCOPE) and g3.same_value(r['readings'],g4.READINGS), 'SCOPE_READINGS'
            assert type(r['decimals']) is int and r['decimals']==3 and r['version']=='inventory-posted-register-gl-1', 'VERSION_DECIMALS'
            assert g3.same_value(r['completeness'],dict(confirmed=complete,reference='Synthetic completeness review' if complete else '',note='All original pages reviewed' if complete else '')), 'COMPLETENESS'
            types={'unreviewed':[],'complete':[],'accepted':['accept'],'undone':['accept','undo'],'rejected':['accept','undo','reject'],'reopened':['accept','undo','reject','undo']}[phase]
            assert [e['type'] for e in r['events']]==types, 'EVENT_TYPES'
            assert r['review']==('accepted' if phase=='accepted' else 'rejected' if phase=='rejected' else 'needs-review'), 'REVIEW'
            assert r['status']==(r['financial'] if r['financial']!='ready' else 'consistent-with-evidence' if phase=='accepted' else 'needs-review'), 'STATUS'
            context=json.loads(r['context'])
            assert context[0]=='inventory-pdf-lifecycle-1' and context[1]==[hashlib.sha256((root/name/f).read_bytes()).hexdigest() for f in NAMES] and g3.same_value(context[2],r['readings']) and g3.same_value(context[3],r['scope']) and g3.same_value(context[4],r['completeness']), 'CONTEXT'
            for i,event in enumerate(r['events']):
                assert event==dict(id='decision-'+str(i),type=types[i],context=r['context'],memberIds=baseline['memberIds'],at='2026-10-16T09:00:00.000Z',reference='Synthetic source review',note='All supplied scope reviewed'), 'DECISION'
            normalized=copy.deepcopy(r)
            normalized.update(completeness=baseline['completeness'],events=[],review='needs-review',status=baseline['status'],context=baseline['context'])
            assert g3.same_value(normalized,baseline), 'FINANCIAL_PHASE_PARITY'
            check_workbook(books/(name+'-'+phase+'.xlsx'),root/name,r);exports+=1
    accounting=g3.check(root,baselines)
    return dict(passed=True,cases=len(baselines),workbooks=exports,accounting=accounting)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--result',type=Path,required=True);p.add_argument('--books',type=Path,required=True);p.add_argument('--single',type=Path);p.add_argument('--case');p.add_argument('--phase',default='unreviewed');a=p.parse_args()
    report=json.loads(a.result.read_text())
    value=check_workbook(a.single,a.root/a.case,report[a.case][a.phase]) if a.single else check(a.root,report,a.books)
    print(json.dumps(value,ensure_ascii=False))
