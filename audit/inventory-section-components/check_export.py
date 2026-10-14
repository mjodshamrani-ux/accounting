"""Independent section workpaper check; ZIP/XML/Decimal, no product imports.

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
SECTION_FAMILY = 'inventory-section-components-1'
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


def check(workbook, folder, accepted=False, undone=False, session_path=None):
    assert not (accepted and undone), 'EVENT_MODE'
    complete = accepted or undone
    oracle = check_case(folder)
    verify_truth(oracle)
    assert oracle['layout'] == 'sections' and oracle['financial'] == 'ready' and oracle['review'] == 'needs-review', 'CONTROL_ORACLE'
    assert oracle['issues'] == oracle['missing'] == [] and oracle['totals'] == {'registerMinor': 150000, 'glMinor': 150000}, 'CONTROL_TRUTH'
    sources = oracle['sources']; assert [len(s['records']) for s in sources] == [4, 4, 4, 2], 'CONTROL_MEMBERS'
    tables = read_workbook(workbook)
    assert set(tables) == {'Summary', 'Register', 'Mapping', 'Policy evidence', 'GL balances', 'Account comparisons', 'Missing', 'Issues', 'Cell evidence', 'Inventory', 'Reading', 'Events', 'Event members', 'Sources', 'Section citations'}, 'TABLE_INVENTORY'
    def table(name, headers):
        rows = tables[name]; assert rows and rows[0] == headers, f'{name}:HEADERS'
        assert all(len(r) <= len(headers) for r in rows), f'{name}:EXTRA_COLUMNS'
        return [r + [''] * (len(headers) - len(r)) for r in rows[1:]]
    summary_rows = table('Summary', ['Field', 'Value']); assert len({r[0] for r in summary_rows}) == len(summary_rows), 'SUMMARY_DUPLICATE'
    summary = dict(summary_rows)
    assert summary.get('Register minor basis') == REGISTER_BASIS, 'REGISTER_MINOR_BASIS'
    for key, expected in {'Financial':'ready', 'Review':'accepted' if accepted else 'needs-review', 'Status':'consistent-with-evidence' if accepted else 'needs-review', 'Version':VERSION, 'Decimals':2, 'Register minor':150000, 'GL minor':150000, 'Scope confirmed':'true', 'Completeness confirmed':'true' if complete else 'false', 'Completeness reference':'INV1B synthetic whole scope' if complete else '', 'Completeness note':'Synthetic test attestation only' if complete else ''}.items(): assert summary.get(key) == expected, f'SUMMARY:{key}'
    visible_scope = sources[0]['records'][0]['scope']; assert set(visible_scope) == set(SCOPE), 'ORACLE_SCOPE_FIELDS'
    scope = {key: visible_scope[label] for key, label in zip(SCOPE_KEYS, SCOPE)}
    for key, value in scope.items(): assert summary.get(key) == value, f'SUMMARY_SCOPE:{key}'
    readings = [{'sheet':0, 'role':role, 'family':SECTION_FAMILY if index == 0 else VERSION, 'confirmed':True} for index, role in enumerate(ROLES)]
    completeness = {'confirmed':complete, 'reference':'INV1B synthetic whole scope' if complete else '', 'note':'Synthetic test attestation only' if complete else ''}
    context = [VERSION, [s['sha256'] for s in sources], readings, dict(scope, confirmed=True), completeness]
    assert json.dumps(json.loads(summary['Context']), sort_keys=True) == json.dumps(context, sort_keys=True), 'CONTEXT_BINDING'
    expected_inventory, expected_cells, members, physical_members = [], [], [], []
    units = {'Quantity':'Quantity scaled integer', 'Posted value':'Posted value minor', 'Debit':'Debit minor', 'Credit':'Credit minor'}
    for index, source in enumerate(sources):
        assert source['role'] == index, 'SOURCE_ROLE'
        headers = [c['raw'] for c in source['inventory'][0]['cells']]
        width = max(len(row['cells']) for row in source['inventory']) if source['name'].endswith('.xlsx') else None
        for row in source['inventory']:
            expected_inventory.append([index, row['row'], row['fate']])
            cells = list(row['cells'])
            if width is not None:
                cells += [{'row':row['row'], 'column':c + 1, 'raw':''} for c in range(len(cells), width)]
            field = (row['cells'][1]['raw'] if row['cells'] and row['cells'][0]['raw'] == 'Scope' and len(row['cells']) > 1 else row['cells'][0]['raw'] if row['cells'] else '') if index == 0 else None
            expected_cells.extend([index, c['row'], c['column'], field if index == 0 else headers[c['column'] - 1], c['raw']] for c in cells)
            if row['row'] > 1 and any(c['raw'] for c in row['cells']):
                physical_members.append(json.dumps([VERSION,index,source['sha256'],0,row['row']], separators=(',', ':')))
        exported = table(['Register','Mapping','Policy evidence','GL balances'][index], ['Record ID','Source','Source row'] + [units.get(f, f) for f in FIELDS[index]])
        assert len(exported) == len(source['records']), 'RECORD_COUNT'
        for actual, record in zip(exported, source['records']):
            row = record['sourceRow']
            identity = [VERSION, index, source['sha256'], 0, row]
            assert json.loads(actual[0]) == identity and actual[1:3] == [index, row], 'RECORD_CITATION'
            members.append(actual[0]); expected = []
            for field in FIELDS[index]:
                raw = record['raw'][field]
                if field == 'Quantity': value = record['quantityUnits']
                elif field == 'Posted value': value = record['postedValueMinor']
                elif field in ['Debit','Credit']: value = integer(Decimal(raw) * 100)
                elif field == 'Quantity precision': value = integer(raw)
                else: value = raw
                expected.append(value)
            assert actual[3:] == expected, 'RECORD_VALUE'
    assert len(members) == len(set(members)) == 14, 'MEMBER_CONSERVATION'
    actual_inventory = table('Inventory', ['Source','Source row','Kind'])
    assert actual_inventory == expected_inventory, 'PHYSICAL_INVENTORY'
    for actual in actual_inventory:
        source = sources[actual[0]]; original_row = source['inventory'][actual[1] - 1]
        assert (actual[2] == 'blank') == (not any(c['raw'] for c in original_row['cells'])), 'BLANK_CLASSIFICATION'
    cells = table('Cell evidence', ['Source','Source row','Column','Field','Text'])
    assert cells == expected_cells, 'LITERAL_CELL_EVIDENCE'
    def cite_row(record_id, citation, field, kind, end=''):
        return [record_id, 0, sources[0]['sha256'], 0, sources[0]['sheetName'], citation['row'], citation['column'], field, citation['raw'], kind, end]
    expected_citations = [cite_row('', sources[0]['inventory'][0]['cells'][1], 'Format', 'format')]
    first_record = sources[0]['records'][0]
    expected_citations += [cite_row('', first_record['scopeCitations'][label], key, 'scope') for key, label in zip(SCOPE_KEYS, SCOPE)]
    for record in sources[0]['records']:
        record_id = json.dumps([VERSION, 0, sources[0]['sha256'], 0, record['sourceRow']], separators=(',', ':'))
        expected_citations += [cite_row(record_id, record['citations'][field], field, 'value', record['endRow']) for field in FIELDS[0]]
        expected_citations += [cite_row(record_id, record['boundaries'][field], field, 'boundary', record['endRow']) for field in ['Section','End section']]
        for row in sources[0]['inventory'][record['sourceRow']:record['endRow'] - 1]:
            if row['cells'] and row['cells'][0]['raw'] == 'Section subtotal':
                expected_citations.append(cite_row(record_id, row['cells'][1], 'Section subtotal', 'control', record['endRow']))
    for row in sources[0]['inventory']:
        if row['cells'] and row['cells'][0]['raw'] == 'Report total':
            expected_citations.append(cite_row('', row['cells'][1], 'Report total', 'control', 0))
    actual_citations = table('Section citations', ['Record ID','Source','SHA256','Sheet index','Sheet','Source row','Column','Field','Text','Kind','Section end row'])
    # Citation order is presentation only; exact ownership and every cell count.
    sort_key = lambda row: json.dumps(row, separators=(',', ':'))
    assert sorted(actual_citations, key=sort_key) == sorted(expected_citations, key=sort_key), 'SECTION_CITATIONS'
    comparisons = [[c['account'],c['dimensions'],c['registerMinor'],c['debitMinor'],c['creditMinor'],c['debitMinor']-c['creditMinor'],c['differenceMinor']] for c in oracle['comparisons']]
    assert comparisons == [['INV-1','branch=01',100000,100000,0,100000,0], ['INV-1','branch=02',50000,50000,0,50000,0]], 'BRANCH_TRUTH'
    assert table('Account comparisons', ['GL account','GL dimensions','Register minor','Debit minor','Credit minor','GL minor','Difference minor']) == comparisons, 'ACCOUNT_COMPARISONS'
    for name, headers in [('Missing',['Missing']),('Issues',['Source','Source row','Code'])]: assert table(name, headers) == [], f'{name}:NOT_EMPTY'
    events = table('Events', ['Event ID','Type','Context','At','Reference','Note','Member count'])
    event_members = table('Event members', ['Event ID','Member ID'])
    ui_event = None
    if session_path is not None:
        assert accepted and not undone, 'UI_SESSION_MODE'
        session = json.loads(session_path.read_bytes().decode('utf-8'))
        assert isinstance(session, dict) and set(session) == {'format','version','files','readings','scope','completeness','events'}, 'UI_SESSION_FIELDS'
        assert session['format'] == 'tarasuf-inventory-register-session' and session['version'] == VERSION, 'UI_SESSION_VERSION'
        assert session['readings'] == readings and session['scope'] == dict(scope, confirmed=True) and session['completeness'] == completeness, 'UI_SESSION_CONTEXT'
        assert isinstance(session['files'], list) and len(session['files']) == 4, 'UI_SESSION_SOURCE_COUNT'
        for index, source in enumerate(sources):
            original = (folder/source['name']).read_bytes(); file = session['files'][index]
            assert isinstance(file, dict) and set(file) == {'name','sha256','data'}, 'UI_SESSION_SOURCE_FIELDS'
            assert file['name'] == source['name'] and file['sha256'] == source['sha256'] and file['data'] == base64.b64encode(original).decode(), 'UI_SESSION_ORIGINAL'
        assert isinstance(session['events'], list) and len(session['events']) == 1, 'UI_SESSION_EVENT_COUNT'
        ui_event = session['events'][0]
        assert isinstance(ui_event, dict) and set(ui_event) == {'id','type','memberIds','context','at','reference','note'}, 'UI_SESSION_EVENT_FIELDS'
        assert isinstance(ui_event['id'], str) and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', ui_event['id']), 'UI_SESSION_EVENT_ID'
        assert isinstance(ui_event['at'], str) and re.fullmatch(r'[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z', ui_event['at']), 'UI_SESSION_EVENT_AT'
        from datetime import datetime
        try: datetime.strptime(ui_event['at'], '%Y-%m-%dT%H:%M:%S.%fZ')
        except ValueError: raise AssertionError('UI_SESSION_EVENT_AT')
        assert ui_event['type'] == 'accept' and ui_event['memberIds'] == physical_members and len(ui_event['memberIds']) == len(set(ui_event['memberIds'])), 'UI_SESSION_EVENT_MEMBERS'
        assert json.loads(ui_event['context']) == context and ui_event['reference'] == 'INV1B synthetic approval' and ui_event['note'] == 'Synthetic reviewed proof only', 'UI_SESSION_EVENT_CONTEXT'
    if complete:
        event_id = ui_event['id'] if ui_event else 'INV1B-ACCEPT'
        event_at = ui_event['at'] if ui_event else '2026-10-14T00:00:00.000Z'
        assert len(events) == (2 if undone else 1) and events[0][0:2] == [event_id,'accept'] and json.loads(events[0][2]) == context and events[0][3:6] == [event_at,'INV1B synthetic approval','Synthetic reviewed proof only'] and events[0][6] == len(physical_members), 'ACCEPT_EVENT'
        assert event_members == [[event_id, member] for member in physical_members] + ([['INV1B-UNDO', member] for member in physical_members] if undone else []), 'ACCEPT_MEMBERSHIP'
        if undone:
            assert events[1][0:2] == ['INV1B-UNDO','undo'] and json.loads(events[1][2]) == context and events[1][3:6] == ['2026-10-14T00:00:01.000Z','INV1B synthetic approval','Synthetic reviewed proof only'] and events[1][6] == len(physical_members), 'UNDO_EVENT'
    else: assert events == event_members == [], 'EVENT_ABSENCE'
    assert table('Reading', ['Source','Role','Family','Sheet','Confirmed']) == [[i,role,SECTION_FAMILY if i == 0 else VERSION,0,'true'] for i,role in enumerate(ROLES)], 'READINGS'
    embedded = table('Sources', ['Source','Role','Name','Sheet','SHA256','Part','Parts','Base64'])
    assert {r[0] for r in embedded} == set(range(4)), 'EMBEDDED_SOURCE_COUNT'
    for index, source in enumerate(sources):
        chunks = [r for r in embedded if r[0] == index]; count = len(chunks)
        assert [r[5] for r in chunks] == list(range(1, count + 1)) and count > 0, 'SOURCE_PARTS'
        for chunk in chunks: assert chunk[:5] == [index,ROLES[index],source['name'],source['sheetName'],source['sha256']] and chunk[6] == count, 'SOURCE_METADATA'
        encoded = ''.join(r[7] for r in chunks); original = base64.b64decode(encoded, validate=True)
        assert base64.b64encode(original).decode() == encoded, 'SOURCE_BASE64'
        assert original == (folder / source['name']).read_bytes() and hashlib.sha256(original).hexdigest() == source['sha256'], 'ORIGINAL_BYTES'
    return {'pass':True, 'logicalMembers':14, 'physicalMembers':len(physical_members), 'physicalRows':len(expected_inventory), 'literalCells':len(expected_cells), 'fieldCitations':len(expected_citations), 'sources':4, 'registerMinor':150000, 'glMinor':150000, 'accepted':accepted, 'undone':undone}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--workbook', type=Path, required=True); parser.add_argument('--case-dir', type=Path, required=True); parser.add_argument('--accepted', action='store_true'); parser.add_argument('--undone', action='store_true'); parser.add_argument('--session', type=Path)
    args = parser.parse_args(); print(json.dumps(check(args.workbook, args.case_dir, args.accepted, args.undone, args.session), sort_keys=True))
