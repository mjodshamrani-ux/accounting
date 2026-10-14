"""Independent matrix workpaper check; ZIP/XML/Decimal, no product imports.

Checks the fixed synthetic story and original sources including exact projected
field/scope/boundary coordinates. This is not an arbitrary-workbook validator.
"""
import argparse
import base64
import hashlib
import json
import posixpath
import re
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile
if not __debug__:
    raise RuntimeError('OPTIMIZED_PYTHON_DISABLED: this checker requires active assertions')
from oracle import FIELDS, SCOPE, check_case, verify_truth

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
DRAW = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
VERSION = 'inventory-posted-register-gl-1'
SECTION_FAMILY = 'inventory-transposed-register-1'
REGISTER_BASIS = 'Only values with proven item/dimension mapping and policy evidence contribute; see Register for all supplied parsed values'
ROLES = ['register', 'mapping', 'policy-evidence', 'gl']
SCOPE_KEYS = ['entity', 'inventoryLedger', 'glLedger', 'currency', 'currencyBasis', 'postingStatus', 'postingLayer', 'asOf', 'chartVersion', 'mapVersion', 'valuationPolicyVersion', 'inventoryAccountSetVersion']


def integer(value):
    number = Decimal(str(value))
    assert number.is_finite() and number == number.to_integral_value(), 'NONINTEGER_NUMBER'
    return int(number)


def read_workbook(path):
    with ZipFile(path) as archive:
        names = archive.namelist()
        assert len(names) == len(set(names)) and len(names) < 1000, 'ZIP_MEMBERS'
        assert sum(e.file_size for e in archive.infolist()) <= 32 * 1024 * 1024, 'ZIP_SIZE'
        def xml(name):
            raw = archive.read(name)
            assert b'<!DOCTYPE' not in raw and b'<!ENTITY' not in raw, 'XML_DTD'
            return ET.fromstring(raw)
        assert not any('/drawings/' in name or '/externalLinks/' in name or 'vbaProject' in name for name in names), 'OUTPUT_DISPLAY_PARTS'
        if 'xl/theme/theme1.xml' in names:
            dark = xml('xl/theme/theme1.xml').find(DRAW + 'themeElements/' + DRAW + 'clrScheme/' + DRAW + 'dk1')
            assert dark is not None and len(dark) == 1 and dark[0].get('lastClr', dark[0].get('val')) == '000000', 'OUTPUT_DISPLAY_THEME'
        styles = xml('xl/styles.xml') if 'xl/styles.xml' in names else None
        xfs = []
        if styles is not None:
            assert not styles.findall(NS + 'numFmts/' + NS + 'numFmt') and not styles.findall(NS + 'dxfs/' + NS + 'dxf'), 'OUTPUT_DISPLAY_FORMAT'
            for font in styles.findall(NS + 'fonts/' + NS + 'font'):
                assert font.find(NS + 'vanish') is None and font.find(NS + 'strike') is None, 'OUTPUT_DISPLAY_FONT'
                color = font.find(NS + 'color')
                assert color is None or dict(color.attrib) in [{'theme':'1'}, {'rgb':'FF000000'}], 'OUTPUT_DISPLAY_FONT'
                size = font.find(NS + 'sz')
                assert size is None or Decimal(size.get('val', '0')) >= 10, 'OUTPUT_DISPLAY_FONT'
            xfs = styles.findall(NS + 'cellXfs/' + NS + 'xf')
            assert all(xf.get('numFmtId', '0') == '0' and xf.get('fillId', '0') == '0' and xf.get('fontId', '0') == '0' and xf.find(NS + 'alignment') is None and not any(key.startswith('apply') for key in xf.attrib) for xf in xfs), 'OUTPUT_DISPLAY_XF'
        strings = [''.join(t.text or '' for t in si.iter(NS + 't')) for si in xml('xl/sharedStrings.xml')] if 'xl/sharedStrings.xml' in names else []
        relationships = list(xml('xl/_rels/workbook.xml.rels'))
        assert len({e.get('Id') for e in relationships}) == len(relationships), 'DUPLICATE_RELATIONSHIP'
        links = {e.get('Id'): e for e in relationships}
        tables, used = {}, set()
        for sheet in xml('xl/workbook.xml').findall(NS + 'sheets/' + NS + 'sheet'):
            name = sheet.get('name'); assert name not in tables and sheet.get('state') in [None, 'visible'], 'SHEET_IDENTITY'
            link = links[sheet.get(REL + 'id')]
            assert link.get('TargetMode') != 'External' and link.get('Type', '').endswith('/worksheet'), 'SHEET_RELATIONSHIP'
            target = posixpath.normpath(posixpath.join('xl', link.get('Target', ''))) if not link.get('Target', '').startswith('/') else link.get('Target')[1:]
            assert target.startswith('xl/') and target in names and target not in used, 'SHEET_TARGET'
            used.add(target); root = xml(target); data = root.findall(NS + 'sheetData')
            assert len(data) == 1 and root.find(NS + 'mergeCells') is None, 'SHEET_STRUCTURE'
            assert not any(root.find(NS + feature) is not None for feature in ['conditionalFormatting','drawing','legacyDrawing','hyperlinks']), 'OUTPUT_DISPLAY_FEATURE'
            assert all(view.get('showZeros') not in ['0','false'] for view in root.findall(NS + 'sheetViews/' + NS + 'sheetView')), 'OUTPUT_DISPLAY_ZERO'
            assert all(column.get('hidden') not in ['1','true'] and ('width' not in column.attrib or Decimal(column.get('width')) > 0) for column in root.findall(NS + 'cols/' + NS + 'col')), 'OUTPUT_DISPLAY_COLUMN'
            rows, occupied = [], set()
            for row in data[0]:
                assert row.tag == NS + 'row' and row.get('hidden') not in ['1', 'true'], 'ROW_VISIBILITY'
                assert row.get('ht') is None or Decimal(row.get('ht')) > 0, 'OUTPUT_DISPLAY_ROW'
                number = integer(row.get('r')); assert number == len(rows) + 1, 'ROW_ORDER'
                values = []
                for cell in row:
                    address = re.fullmatch(r'([A-Z]+)([1-9][0-9]*)', cell.get('r', ''))
                    assert cell.tag == NS + 'c' and address and int(address[2]) == number, 'CELL_ADDRESS'
                    column = 0
                    for char in address[1]: column = column * 26 + ord(char) - 64
                    assert column <= 100 and (number, column) not in occupied and cell.find(NS + 'f') is None, 'CELL_DUPLICATE_OR_FORMULA'
                    occupied.add((number, column)); kind = cell.get('t', 'n'); raw = cell.findtext(NS + 'v')
                    assert 's' not in cell.attrib or cell.get('s').isdigit() and int(cell.get('s')) < len(xfs), 'OUTPUT_DISPLAY_STYLE_INDEX'
                    if kind == 's':
                        assert raw is not None and re.fullmatch(r'0|[1-9][0-9]*', raw), 'STRING_INDEX'
                        index = int(raw); assert index < len(strings), 'STRING_BOUND'; value = strings[index]
                    elif kind == 'inlineStr': value = ''.join(t.text or '' for t in cell.findall(NS + 'is/' + NS + 't'))
                    elif kind == 'n': value = integer(raw) if raw is not None else ''
                    else: raise AssertionError('UNSUPPORTED_CELL_TYPE')
                    while len(values) < column: values.append('')
                    values[column - 1] = value
                rows.append(values)
            tables[name] = rows
    return tables


MATRIX_HEADERS=['Record ID','Source','SHA256','Sheet index','Sheet','Source row','Column','Field','Text','Kind','Band header row','Fact column']


def matrix_citations(source):
    rows=[]
    def add(record,cite,field,kind,band='',column=''):
        rows.append([record,0,source['sha256'],0,source['sheetName'],cite['row'],cite['column'],field,cite['raw'],kind,band,column])
    add('',source['inventory'][0]['cells'][1],'Format','format')
    first=source['records'][0]
    for key,label in zip(SCOPE_KEYS,SCOPE): add('',first['scopeCitations'][label],key,'scope')
    for band in source['matrixBands']:
        row=band['header']['row']; add('',band['header'],'Field','axis-header',row)
        for slot in band['columns']: add('',source['inventory'][row-1]['cells'][slot['column']-1],'Column key','axis-key',row,slot['column'])
        add('',band['boundary']['citation'],band['boundary']['kind'],'boundary',row)
        for record in source['records']:
            if record['bandStart']!=row: continue
            identity=json.dumps([VERSION,0,source['sha256'],0,record['sourceRow'],record['column']],separators=(',',':'))
            add(identity,record['citations']['Item ID'],'Item ID','record-anchor',row,record['column'])
            add(identity,record['axisCitation'],'Column key','record-axis',row,record['column'])
            for field in FIELDS[0]:
                add(identity,record['citations'][field],field,'value',row,record['column'])
                add(identity,record['roleCitations'][field],field,'role',row,record['column'])
    for row in source['inventory']:
        if row['cells'] and row['cells'][0]['raw']=='Report total': add('',row['cells'][1],'Report total','control')
        if row['cells'] and row['cells'][0]['raw']=='End report': add('',row['cells'][0],'End report','report-end')
    return rows


def check(workbook,folder,accepted=False,undone=False,session_path=None):
    assert not (accepted and undone),'EVENT_MODE'
    complete=accepted or undone
    observation=check_case(folder); verify_truth(observation)
    assert not complete or observation['financial']=='ready','ACCEPT_FINANCIAL'
    assert observation['financial'] in ['ready','difference','missing'],'CHECKER_SCOPE'
    sources=observation['sources']; tables=read_workbook(workbook)
    assert set(tables)=={'Summary','Register','Mapping','Policy evidence','GL balances','Account comparisons','Missing','Issues','Cell evidence','Inventory','Reading','Events','Event members','Sources','Matrix citations'},'TABLE_INVENTORY'
    def table(name,headers):
        rows=tables[name]; assert rows and rows[0]==headers,f'{name}:HEADERS'
        assert all(len(row)<=len(headers) for row in rows),f'{name}:WIDTH'
        return [row+['']*(len(headers)-len(row)) for row in rows[1:]]
    summary_rows=table('Summary',['Field','Value']); assert len({row[0] for row in summary_rows})==len(summary_rows),'SUMMARY_DUPLICATE'; summary=dict(summary_rows)
    for key,value in {'Version':VERSION,'Decimals':3,'Financial':observation['financial'],'Review':'accepted' if accepted else 'needs-review','Status':'consistent-with-evidence' if accepted else 'needs-review' if observation['financial']=='ready' else observation['financial'],'Register minor':observation['totals']['registerMinor'],'GL minor':667134,'Register minor basis':REGISTER_BASIS,'Scope confirmed':'true','Completeness confirmed':'true' if complete else 'false','Completeness reference':'INV1C synthetic whole scope' if complete else '', 'Completeness note':'Synthetic matrix attestation only' if complete else ''}.items(): assert summary.get(key)==value,f'SUMMARY:{key}'
    scope=dict(zip(SCOPE_KEYS,[sources[0]['records'][0]['scope'][label] for label in SCOPE]))
    for key,value in scope.items(): assert summary.get(key)==value,f'SCOPE:{key}'
    readings=[{'sheet':0,'role':role,'family':SECTION_FAMILY if i==0 else VERSION,'confirmed':True} for i,role in enumerate(ROLES)]
    completeness={'confirmed':complete,'reference':'INV1C synthetic whole scope' if complete else '', 'note':'Synthetic matrix attestation only' if complete else ''}
    context=[VERSION,[source['sha256'] for source in sources],readings,dict(scope,confirmed=True),completeness]
    assert json.loads(summary['Context'])==context,'CONTEXT_BINDING'
    units={'Quantity':'Quantity scaled integer','Posted value':'Posted value minor','Debit':'Debit minor','Credit':'Credit minor'}
    expected_cells=[]; expected_inventory=[]; logical=[]; physical_members=[]
    for index,source in enumerate(sources):
        headers=[c['raw'] for c in source['inventory'][0]['cells']]
        width=max(len(row['cells']) for row in source['inventory']) if source['name'].endswith('.xlsx') else None
        for row in source['inventory']:
            expected_inventory.append([index,row['row'],row['fate']]); raw=[c['raw'] for c in row['cells']]
            if row['row']>1 and any(value!='' for value in raw): physical_members.append(json.dumps([VERSION,index,source['sha256'],0,row['row']],separators=(',',':')))
            values=raw+['']*(width-len(raw)) if width is not None else raw
            label=raw[1] if raw and raw[0]=='Scope' else raw[0] if raw else ''
            expected_cells += [[index,row['row'],c+1,label if index==0 else headers[c],value] for c,value in enumerate(values)]
        base=['Record ID','Source','Source row']+(['Source column'] if index==0 else [])
        exported=table(['Register','Mapping','Policy evidence','GL balances'][index],base+[units.get(f,f) for f in FIELDS[index]])
        assert len(exported)==len(source['records']),'RECORD_COUNT'
        for actual,record in zip(exported,source['records']):
            identity=[VERSION,index,source['sha256'],0,record['sourceRow']]+([record['column']] if index==0 else [])
            assert json.loads(actual[0])==identity and actual[1:len(base)]==[index,record['sourceRow']]+([record['column']] if index==0 else []),'RECORD_ANCHOR'
            values=[]
            for field in FIELDS[index]:
                raw=record['raw'][field]
                values.append(record['quantityUnits'] if field=='Quantity' else record['postedValueMinor'] if field=='Posted value' else integer(Decimal(raw)*1000) if field in ['Debit','Credit'] else integer(raw) if field=='Quantity precision' else raw)
            assert actual[len(base):]==values,'RECORD_VALUE'
            logical.append(actual[0])
    assert len(logical)==len(set(logical))==16,'LOGICAL_ID_CONSERVATION'
    assert table('Inventory',['Source','Source row','Kind'])==expected_inventory,'PHYSICAL_INVENTORY'
    assert table('Cell evidence',['Source','Source row','Column','Field','Text'])==expected_cells,'LITERAL_CELL_EVIDENCE'
    citations=table('Matrix citations',MATRIX_HEADERS)
    sort=lambda row:json.dumps(row,separators=(',',':'))
    assert sorted(citations,key=sort)==sorted(matrix_citations(sources[0]),key=sort),'MATRIX_CITATIONS'
    comparisons=[[c['account'],c['dimensions'],c['registerMinor'],c['debitMinor'],c['creditMinor'],c['debitMinor']-c['creditMinor'],c['differenceMinor']] for c in observation['comparisons']]
    assert table('Account comparisons',['GL account','GL dimensions','Register minor','Debit minor','Credit minor','GL minor','Difference minor'])==comparisons,'ACCOUNT_COMPARISONS'
    assert table('Issues',['Source','Source row','Source column','Code'])==[],'UNEXPECTED_ISSUES'
    missing=table('Missing',['Missing'])
    if observation['financial']!='missing': assert missing==[],'UNEXPECTED_MISSING'
    else:
        expected={ 'evidence:'+json.dumps(['0014','plant=P1;batch=K1'],separators=(',',':')), 'evidence:'+json.dumps(['0014','plant=P2;batch=K2'],separators=(',',':')), 'account:'+json.dumps(['INV-RM','plant=P1;branch=10'],separators=(',',':')), 'account:'+json.dumps(['INV-RM','plant=P2;branch=20'],separators=(',',':')) }
        assert {row[0] for row in missing}==expected and len(missing)==len(expected),'MISSING_BINDINGS'
    assert table('Reading',['Source','Role','Family','Sheet','Confirmed'])==[[i,role,SECTION_FAMILY if i==0 else VERSION,0,'true'] for i,role in enumerate(ROLES)],'READINGS'
    events=table('Events',['Event ID','Type','Context','At','Reference','Note','Member count'])
    event_members=table('Event members',['Event ID','Member ID'])
    event_id='INV1C-ACCEPT'; event_at='2026-11-01T00:00:00.000Z'
    if session_path is not None:
        assert accepted and not undone,'UI_SESSION_MODE'
        session=json.loads(session_path.read_bytes().decode('utf-8'))
        assert isinstance(session,dict) and set(session)=={'format','version','files','readings','scope','completeness','events'},'UI_SESSION_FIELDS'
        assert session['format']=='tarasuf-inventory-register-session' and session['version']==VERSION,'UI_SESSION_VERSION'
        assert session['readings']==readings and session['scope']==dict(scope,confirmed=True) and session['completeness']==completeness,'UI_SESSION_CONTEXT'
        assert isinstance(session['files'],list) and len(session['files'])==4,'UI_SESSION_SOURCE_COUNT'
        for index,source in enumerate(sources):
            file=session['files'][index]
            assert isinstance(file,dict) and set(file)=={'name','sha256','data'},'UI_SESSION_SOURCE_FIELDS'
            assert file['name']==source['name'] and file['sha256']==source['sha256'] and file['data']==base64.b64encode((folder/source['name']).read_bytes()).decode(),'UI_SESSION_ORIGINAL'
        assert isinstance(session['events'],list) and len(session['events'])==1,'UI_SESSION_EVENT_COUNT'
        event=session['events'][0]
        assert isinstance(event,dict) and set(event)=={'id','type','memberIds','context','at','reference','note'},'UI_SESSION_EVENT_FIELDS'
        assert isinstance(event['id'],str) and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',event['id']),'UI_SESSION_EVENT_ID'
        assert isinstance(event['at'],str) and re.fullmatch(r'[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z',event['at']),'UI_SESSION_EVENT_AT'
        from datetime import datetime
        try: datetime.strptime(event['at'],'%Y-%m-%dT%H:%M:%S.%fZ')
        except ValueError: raise AssertionError('UI_SESSION_EVENT_AT')
        assert event['type']=='accept' and event['memberIds']==physical_members and len(event['memberIds'])==len(set(event['memberIds'])),'UI_SESSION_EVENT_MEMBERS'
        assert json.loads(event['context'])==context and event['reference']=='INV1C synthetic approval' and event['note']=='Synthetic matrix review only','UI_SESSION_EVENT_CONTEXT'
        event_id=event['id'];event_at=event['at']
    if complete:
        assert len(events)==(2 if undone else 1) and events[0][0:2]==[event_id,'accept'] and json.loads(events[0][2])==context and events[0][3:6]==[event_at,'INV1C synthetic approval','Synthetic matrix review only'] and events[0][6]==len(physical_members),'ACCEPT_EVENT'
        assert event_members==[[event_id,member] for member in physical_members]+([['INV1C-UNDO',member] for member in physical_members] if undone else []),'ACCEPT_MEMBERSHIP'
        if undone: assert events[1][0:2]==['INV1C-UNDO','undo'] and json.loads(events[1][2])==context and events[1][3:6]==['2026-11-01T00:00:01.000Z','INV1C synthetic approval','Synthetic matrix review only'] and events[1][6]==len(physical_members),'UNDO_EVENT'
    else: assert events==event_members==[],'EVENT_ABSENCE'

    embedded=table('Sources',['Source','Role','Name','Sheet','SHA256','Part','Parts','Base64'])
    assert {row[0] for row in embedded}=={0,1,2,3},'SOURCE_COUNT'
    for index,source in enumerate(sources):
        chunks=[row for row in embedded if row[0]==index]; count=len(chunks)
        assert [row[5] for row in chunks]==list(range(1,count+1)) and count>0,'SOURCE_PARTS'
        assert all(row[:5]==[index,ROLES[index],source['name'],source['sheetName'],source['sha256']] and row[6]==count for row in chunks),'SOURCE_METADATA'
        encoded=''.join(row[7] for row in chunks); data=base64.b64decode(encoded,validate=True)
        assert data==(folder/source['name']).read_bytes() and base64.b64encode(data).decode()==encoded and hashlib.sha256(data).hexdigest()==source['sha256'],'ORIGINAL_BYTES'
    return {'pass':True,'financial':observation['financial'],'logicalRecords':16,'physicalRows':len(expected_inventory),'literalCells':len(expected_cells),'matrixCitations':len(citations),'sources':4,'accepted':accepted,'undone':undone}


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--workbook',type=Path,required=True); parser.add_argument('--case-dir',type=Path,required=True); parser.add_argument('--accepted',action='store_true'); parser.add_argument('--undone',action='store_true'); parser.add_argument('--session',type=Path); args=parser.parse_args(); print(json.dumps(check(args.workbook,args.case_dir,args.accepted,args.undone,args.session),sort_keys=True))
