#!/usr/bin/env python3
"""Standalone stdlib CSV/ZIP/XML lifecycle checker; imports no product code.

Financial recomputation delegates only to the byte-exact accepted independent
Decimal/CSV oracle. Workbook, source-byte, cell-presence, member, event, session
and export checks below are independent of the product and proof producer.
"""
from __future__ import annotations
import base64
from decimal import Decimal
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
VERSION = 'fixed-assets-posted-components-gl-1'
LONG = 'fixed-assets-long-components-gl-1'
ORACLE_SHA = '5d5e9abd877b4e758663af40c28863ff5375252b039d784a415e6cc9fb3babd0'
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
COMPONENTS = ('cost', 'depreciation', 'impairment', 'carrying')

def sha(b): return hashlib.sha256(b).hexdigest()
def require(condition, message):
    if not condition: raise AssertionError(message)
def read_json(p): return json.loads(p.read_text(encoding='utf-8'))

def oracle():
    path = ROOT / 'oracle.py'
    require(sha(path.read_bytes()) == ORACLE_SHA, 'Accepted independent oracle changed')
    spec = importlib.util.spec_from_file_location('accepted_independent_asset_oracle', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def col(address):
    n = 0
    for c in address:
        if not c.isalpha(): break
        n = n * 26 + ord(c) - 64
    return n

def workbook(path):
    with zipfile.ZipFile(path) as z:
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            strings = [''.join(si.itertext()) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        relationships = {e.attrib['Id']: e.attrib['Target'].lstrip('/') for e in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        result = {}
        for s in ET.fromstring(z.read('xl/workbook.xml')).find('s:sheets', NS):
            require(s.attrib.get('state', 'visible') == 'visible', f'{path}: hidden sheet')
            target = relationships[s.attrib['{'+NS['r']+'}id']]
            target = target if target.startswith('xl/') else 'xl/' + target
            tree = ET.fromstring(z.read(target))
            rows = []
            for row in tree.findall('s:sheetData/s:row', NS):
                require(row.attrib.get('hidden', '0') == '0', f'{path}: hidden row')
                cells = {}
                for c in row:
                    require(c.find('s:f', NS) is None, f'{path}: formula at {c.attrib.get("r")}')
                    t = c.attrib.get('t', 'n')
                    value = c.find('s:v', NS)
                    value = value.text if value is not None else None
                    if t == 's': value = strings[int(value)]
                    elif t == 'inlineStr': value = ''.join(c.find('s:is', NS).itertext())
                    elif value is not None and t == 'n':
                        decimal = Decimal(value)
                        require(decimal.is_finite() and decimal == decimal.to_integral_value(), f'{path}: nonintegral native number')
                        value = int(decimal)
                    else: require(t in ('n', 'str'), f'{path}: unexpected native type {t}')
                    cells[col(c.attrib['r'])] = value
                rows.append(cells)
            require(s.attrib['name'] not in result, 'Duplicate sheet')
            result[s.attrib['name']] = rows
        return result

def table(book, name):
    require(name in book, f'Missing sheet {name}')
    rows = book[name]
    headers = [rows[0].get(i) for i in range(1, max(rows[0])+1)]
    require(len(headers) == len(set(headers)), f'{name}: duplicate headers')
    return [{h: r.get(i+1) for i, h in enumerate(headers)} for r in rows[1:]]

def member(source, row, hashes):
    # JSON compact separators match physical member format without importing TS.
    return json.dumps([VERSION, source, hashes[source], 0, row], separators=(',', ':'))

def verify(folder, entry, engine):
    for name, expected in entry['artifacts'].items():
        content = (folder / name).read_bytes()
        require(len(content) == expected['bytes'] and sha(content) == expected['sha256'], f'{folder.name}/{name}: artifact hash')
    original = [(folder / f'source-{i}.csv').read_bytes() for i in range(4)]
    hashes = [sha(b) for b in original]
    frozen = ROOT / 'frozen' / entry['truthCase']
    for i, b in enumerate(original):
        baseline = (frozen / f'source-{i}.csv').read_bytes()
        require(b == (baseline + b'\n' if entry['phase'] == 'invalidation-source-hash' and i == 0 else baseline), f'{folder.name}: unbound original {i}')
    independent = engine.compute(folder)
    scope = read_json(folder / 'case.json')['scope']
    # The oracle consumes scope and original CSV only. Expectations are checked now.
    frozen_truth = read_json(frozen / 'case.json')
    expected_scope = dict(frozen_truth['scope'])
    if entry['phase'] == 'invalidation-scope': expected_scope['postingLayer'] = 'other'
    require(scope == expected_scope, 'Scope bound to original case and declared invalidation')
    if not entry['phase'].startswith('invalidation-'):
        require(independent['financial'] == frozen_truth['expectedFinancial'], f'{folder.name}: independent classification')
        for k, v in frozen_truth.get('assertions', {}).items():
            if k == 'totals': require(independent['totals'] == v, f'{folder.name}: frozen totals')
            elif k == 'physicalMembers': require(len(independent['physicalMembers']) == v, f'{folder.name}: frozen members')
    raws = [engine.csv_rows(b) for b in original]
    expected_members = [member(p['source'], p['row'], hashes) for p in independent['physicalMembers']]
    inventory = [{k: v[k] for k in ('source','row','kind')} for v in independent['inventory']]
    expected_cells = [{'source':s,'row':r+1,'column':c+1,'field':raws[s][0][c] if c < len(raws[s][0]) else '', 'text':text} for s in range(4) for r, row in enumerate(raws[s]) for c, text in enumerate(row)]
    session = read_json(folder / 'session.json')
    require(set(session) == {'format','version','files','readings','scope','completeness','events'}, 'Session keys')
    require(session['format'] == 'tarasuf-fixed-assets-session' and session['version'] == VERSION, 'Session format/version')
    require(session['scope'] == scope and len(session['files']) == 4, 'Session scope/count')
    for i, f in enumerate(session['files']):
        require(set(f) == {'name','sha256','data'} and f['sha256'] == hashes[i], 'Session source metadata')
        require(base64.b64decode(f['data'], validate=True) == original[i], 'Session original bytes')
    require([r['family'] for r in session['readings']] == [LONG, VERSION, VERSION, VERSION], 'Mixed reading families')
    require([r['role'] for r in session['readings']] == ['register','mapping','policy-evidence','gl'] and all(r['sheet'] == 0 and r['confirmed'] is True for r in session['readings']), 'Explicit reading roles/confirmation')
    context_readings = [{k:r[k] for k in ('sheet','role','family','confirmed')} for r in session['readings']]
    context_scope = {k:scope[k] for k in engine.SCOPE} | {'confirmed':True}
    context = json.dumps([VERSION,hashes,context_readings,context_scope,session['completeness']],separators=(',',':'),ensure_ascii=False)
    require(entry['context'] == context, 'Independent original-context binding')
    previous = None
    active = None
    for event in session['events']:
        require(event['memberIds'] == expected_members and event['context'] == entry['context'], 'Full event original physical membership/context')
        require(previous is None or previous <= event['at'], 'Event order')
        previous = event['at']
        if event['type'] == 'undo': require(active is not None, 'Undo sequence'); active = None
        else:
            require(active is None, 'Decision sequence')
            if event['type'] == 'accept': require(independent['financial'] == 'ready' and session['completeness']['confirmed'], 'Accept invariant')
            active = event['type']
    review = {'accept':'accepted','reject':'rejected',None:'needs-review'}[active]
    direct = read_json(folder / 'direct-result.json')
    require(direct == read_json(folder / 'restored-result.json'), 'Restored complete result')
    require(direct['financial'] == independent['financial'] and direct['totals'] == independent['totals'], 'Independent financial/totals')
    require(direct['review'] == review and direct['memberIds'] == expected_members, 'Independent review/members')
    require(direct['inventory'] == inventory and direct['cells'] == expected_cells, 'Full raw inventory/cell evidence')
    require(direct['scope'] == scope and direct['readings'] == session['readings'] and direct['events'] == session['events'], 'Session metadata result binding')
    expected_comparisons = [{k:c[k] for k in ('account','dimensions','component','register','gl','difference','glRow')} | {'registerRows':[p['row'] for p in c['physicalMembers']]} for c in independent['comparisons']]
    require(direct['comparisons'] == expected_comparisons, 'Every independent signed difference and actual component row')
    expected_evidence = [v for v in independent['evidence'] if v['source'] == 0 and v['header'] == 'Amount']
    require(len(direct.get('componentEvidence',[])) == len(expected_evidence), 'Amount evidence count')
    for v, expected in zip(direct.get('componentEvidence', []), expected_evidence):
        for k in ('source','row','column','header','present','text','minor','component','asset','dimensions','valuation'):
            require(v[k] == expected[k], f'Amount evidence {v["row"]}/{v["column"]}/{k}')
        require(v['memberId'] == member(0,v['row'],hashes) and v['sourceHash'] == hashes[0] and v['context'] == direct['context'], 'Amount original context/hash/member binding')
        require(v['present'] or (v['text'] is None and v['minor'] is None), 'Absent amount is null')
        require(v['componentColumn'] == raws[0][0].index('Component')+1, 'Actual component column')
    all_asset_members = []
    for asset in direct['records'][0]:
        evidence = asset['componentEvidence']
        require(asset['representation'] == 'long-components' and len(evidence) == 4, 'Aggregate representation/quartet')
        require(asset['memberIds'] == [v['memberId'] for v in evidence] and asset['memberId'] == evidence[0]['memberId'] and asset['row'] == evidence[0]['row'], 'Real first member anchor')
        require(set(v['component'] for v in evidence) == set(COMPONENTS), 'Quartet components')
        for e in evidence:
            require(e in direct['componentEvidence'], 'Member evidence originates in raw result')
            require(asset[e['component']] == e['minor'] and asset['asset'] == e['asset'] and asset['dimensions'] == e['dimensions'] and asset['valuation'] == e['valuation'], 'Aggregate component physical amount/identity')
            all_asset_members.append({'Asset ID':asset['asset'],'Asset dimensions':asset['dimensions'],'Representation':'long-components','Member ID':e['memberId'],'Source':0,'Source row':e['row'],'Component':e['component'],'Amount column':e['column'],'Present':str(e['present']).lower(),'Text':e['text'],'Minor':e['minor']})
        require(asset['cost']-asset['depreciation']-asset['impairment'] == asset['carrying'], 'Carrying equation')
    for xlsx in ('direct.xlsx', 'restored.xlsx'):
        book = workbook(folder / xlsx)
        require(len(book) == 17, 'Long workbook 14 legacy plus three provenance tables')
        summary = {r['Field']:r['Value'] for r in table(book,'Summary')}
        require(summary['Financial'] == independent['financial'] and summary['Review'] == review and summary['Context'] == direct['context'], 'Workbook classification/context')
        for side in ('register','gl'):
            for component in COMPONENTS:
                value = independent['totals'][side][component] if independent['totals'] is not None else None
                require(summary[f'{"GL" if side == "gl" else "Register"} {component} minor'] == value, 'Workbook independent native totals')
        sources = table(book,'Sources')
        for i in range(4):
            parts = sorted((r for r in sources if r['Source'] == i),key=lambda r:r['Part'])
            require([r['Part'] for r in parts] == list(range(1,len(parts)+1)) and all(r['Parts'] == len(parts) and r['SHA256'] == hashes[i] and r['Name'] == session['files'][i]['name'] for r in parts), 'Workbook source chunks')
            require(base64.b64decode(''.join(r['Base64'] for r in parts),validate=True) == original[i], 'Workbook four exact original byte streams')
        require(table(book,'Cell evidence') == [{'Source':v['source'],'Source row':v['row'],'Column':v['column'],'Field':v['field'],'Text':v['text']} for v in expected_cells], 'Workbook all original cells')
        require(table(book,'Inventory') == [{'Source':v['source'],'Source row':v['row'],'Kind':v['kind']} for v in inventory], 'Workbook inventory')
        require(table(book,'Component comparisons') == [{'GL account':v['account'],'GL dimensions':v['dimensions'],'Component':v['component'],'Register minor':v['register'],'GL minor':v['gl'],'Difference minor':v['difference'],'GL source row':v['glRow'],'Register source rows':json.dumps(v['registerRows'],separators=(',',':'))} for v in expected_comparisons], 'Workbook every separate signed native comparison')
        expected_long = [{'Member ID':v['memberId'],'Source':0,'Role':'register','SHA256':hashes[0],'Sheet':0,'Source row':v['row'],'Column':v['column'],'Field':'Amount','Present':str(v['present']).lower(),'Text':v['text'],'Minor':v['minor'],'Component':v['component'],'Component column':v['componentColumn'],'Asset ID':v['asset'],'Asset dimensions':v['dimensions'],'Valuation reference':v['valuation'],'Context':direct['context']} for v in direct.get('componentEvidence',[])]
        require(table(book,'Long component evidence') == expected_long, 'Workbook long physical amount evidence')
        require(table(book,'Asset component members') == all_asset_members, 'Workbook physical quartet mapping')
        require(table(book,'Assets') == [{'First physical member ID':a['memberId'],'Source':0,'First component row':a['row'],'Asset ID':a['asset'],'Asset dimensions':a['dimensions'],'Cost minor':a['cost'],'Accumulated depreciation minor':a['depreciation'],'Impairment minor':a['impairment'],'Carrying amount minor':a['carrying'],'Valuation reference':a['valuation'],'Representation':'long-components'} for a in direct['records'][0]], 'Workbook logical assets use physical anchors and original component amounts')
        for source, name in ((1,'Mapping'), (2,'Policy evidence')):
            expected = []
            for record in direct['records'][source]:
                row = raws[source][record['row']-1]
                require(record['memberId'] == member(source,record['row'],hashes), 'Mapping/policy member identity')
                expected.append({'Record ID':record['memberId'],'Source':source,'Source row':record['row']} | {h:row[i] for i,h in enumerate(raws[source][0]) if h not in engine.SCOPE.values()})
            require(table(book,name) == expected, 'Workbook literal mapping/policy original rows')
        expected_gl = []
        decimals = {'SAR':2,'JPY':0,'KWD':3}[scope['currency']]
        for record in direct['records'][3]:
            row = raws[3][record['row']-1]
            fields = dict(zip(raws[3][0],row))
            debit, credit = engine.minor(fields['Debit'],decimals), engine.minor(fields['Credit'],decimals)
            component = {'fixed-asset-cost':'cost','accumulated-depreciation':'depreciation','accumulated-impairment':'impairment'}[fields['Account class']]
            normal = debit-credit if component == 'cost' else credit-debit
            require(record['debit'] == debit and record['credit'] == credit and record['normal'] == normal and record['component'] == component, 'GL amount and signed normal independently parsed from original')
            expected_gl.append({'Record ID':member(3,record['row'],hashes),'Source':3,'Source row':record['row'],'GL account':fields['GL account'],'GL dimensions':fields['GL dimensions'],'Account class':fields['Account class'],'Debit minor':debit,'Credit minor':credit,'Component':component,'Normal minor':normal})
        require(table(book,'GL balances') == expected_gl, 'Workbook every GL amount native coordinate/value')
        require(len(table(book,'Original register rows')) == len(raws[0])-1, 'All original register rows retained')
        require(table(book,'Events') == [{'Event ID':e['id'],'Type':e['type'],'Context':e['context'],'At':e['at'],'Reference':e['reference'],'Note':e['note'],'Member count':len(e['memberIds'])} for e in session['events']], 'Workbook full event metadata')
        for exported, row in zip(table(book,'Original register rows'), raws[0][1:]):
            require(exported['Cell count'] == len(row) and [exported[f'Cell {i+1}'] for i in range(len(row))] == row, 'Workbook actual raw row width/text')
        require(table(book,'Event members') == [{'Event ID':e['id'],'Member ID':m} for e in session['events'] for m in e['memberIds']], 'Workbook decision physical members')
    return {'folder':folder.name,'financial':independent['financial'],'amountEvidence':len(expected_evidence),'members':len(expected_members),'comparisons':len(expected_comparisons),'workbooks':2}

def main():
    folder = Path(sys.argv[1]).resolve()
    if not (folder / 'REPORT.json').exists():
        pointer = read_json(folder / 'LAST-ATTEMPT.json')
        require(isinstance(pointer.get('attempt'),str) and pointer['attempt'].startswith('attempt-') and Path(pointer['attempt']).name == pointer['attempt'], 'Explicit attempt pointer')
        folder = folder / pointer['attempt']
        require(pointer.get('passed') is True and sha((folder/'REPORT.json').read_bytes()) == pointer.get('reportSha256'), 'Pointer binds exact successful current report')
    report = read_json(folder / 'REPORT.json')
    require(report['passed'] and report['actualNodeWorker'] and not report['browserRun'], 'Producer completion')
    engine = oracle()
    results, failures = [], []
    for entry in report['entries']:
        try: results.append(verify(folder / entry['folder'],entry,engine))
        except Exception as error: failures.append({'folder':entry['folder'],'error':str(error)})
    result = {'checker':'stdlib ZIP/XML and accepted independent Decimal/CSV oracle','productImported':False,'oracleSha256':ORACLE_SHA,'checkerSha256':sha(Path(__file__).read_bytes()),'passed':not failures,'checked':results,'failures':failures}
    (folder / 'INDEPENDENT-CHECK.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'passed':result['passed'],'entries':len(results),'workbooks':len(results)*2,'failures':failures[:4]}))
    return 0 if result['passed'] else 1
if __name__ == '__main__': sys.exit(main())
