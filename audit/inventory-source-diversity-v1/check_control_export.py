"""Private independent OOXML check for INV1A-P01; no product imports or execution on import."""
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
from oracle import FIELDS, SCOPE, check_case

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
VERSION = 'inventory-posted-register-gl-1'
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
            rows, occupied = [], set()
            for row in data[0]:
                assert row.tag == NS + 'row' and row.get('hidden') not in ['1', 'true'], 'ROW_VISIBILITY'
                number = integer(row.get('r')); assert number == len(rows) + 1, 'ROW_ORDER'
                values = []
                for cell in row:
                    address = re.fullmatch(r'([A-Z]+)([1-9][0-9]*)', cell.get('r', ''))
                    assert cell.tag == NS + 'c' and address and int(address[2]) == number, 'CELL_ADDRESS'
                    column = 0
                    for char in address[1]: column = column * 26 + ord(char) - 64
                    assert column <= 100 and (number, column) not in occupied and cell.find(NS + 'f') is None, 'CELL_DUPLICATE_OR_FORMULA'
                    occupied.add((number, column)); kind = cell.get('t', 'n'); raw = cell.findtext(NS + 'v')
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


def check(workbook, folder):
    oracle = check_case(folder)
    assert oracle['layout'] == 'flat' and oracle['financial'] == 'ready' and oracle['review'] == 'needs-review', 'CONTROL_ORACLE'
    assert oracle['issues'] == oracle['missing'] == [] and oracle['totals'] == {'registerMinor': 150000, 'glMinor': 150000}, 'CONTROL_TRUTH'
    sources = oracle['sources']; assert [len(s['records']) for s in sources] == [4, 4, 4, 2], 'CONTROL_MEMBERS'
    assert sum(len(s['inventory']) for s in sources) == 18, 'CONTROL_ROWS'
    tables = read_workbook(workbook)
    assert set(tables) == {'Summary', 'Register', 'Mapping', 'Policy evidence', 'GL balances', 'Account comparisons', 'Missing', 'Issues', 'Cell evidence', 'Inventory', 'Reading', 'Events', 'Event members', 'Sources'}, 'TABLE_INVENTORY'
    def table(name, headers):
        rows = tables[name]; assert rows and rows[0] == headers, f'{name}:HEADERS'
        assert all(len(r) <= len(headers) for r in rows), f'{name}:EXTRA_COLUMNS'
        return [r + [''] * (len(headers) - len(r)) for r in rows[1:]]
    summary_rows = table('Summary', ['Field', 'Value']); assert len({r[0] for r in summary_rows}) == len(summary_rows), 'SUMMARY_DUPLICATE'
    summary = dict(summary_rows)
    for key, expected in {'Financial':'ready', 'Review':'needs-review', 'Status':'needs-review', 'Version':VERSION, 'Decimals':2, 'Register minor':150000, 'GL minor':150000, 'Scope confirmed':'true', 'Completeness confirmed':'false', 'Completeness reference':'', 'Completeness note':''}.items(): assert summary.get(key) == expected, f'SUMMARY:{key}'
    visible_scope = sources[0]['records'][0]['scope']; assert set(visible_scope) == set(SCOPE), 'ORACLE_SCOPE_FIELDS'
    scope = {key: visible_scope[label] for key, label in zip(SCOPE_KEYS, SCOPE)}
    for key, value in scope.items(): assert summary.get(key) == value, f'SUMMARY_SCOPE:{key}'
    readings = [{'sheet':0, 'role':role, 'family':VERSION, 'confirmed':True} for role in ROLES]
    context = [VERSION, [s['sha256'] for s in sources], readings, dict(scope, confirmed=True), {'confirmed':False, 'reference':'', 'note':''}]
    assert json.dumps(json.loads(summary['Context']), sort_keys=True) == json.dumps(context, sort_keys=True), 'CONTEXT_BINDING'
    expected_inventory, expected_cells, members = [], [], []
    units = {'Quantity':'Quantity scaled integer', 'Posted value':'Posted value minor', 'Debit':'Debit minor', 'Credit':'Credit minor'}
    for index, source in enumerate(sources):
        assert source['role'] == index, 'SOURCE_ROLE'
        headers = [c['raw'] for c in source['inventory'][0]['cells']]
        for row in source['inventory']:
            expected_inventory.append([index, row['row'], row['fate']])
            expected_cells.extend([index, c['row'], c['column'], headers[c['column'] - 1], c['raw']] for c in row['cells'])
        exported = table(['Register','Mapping','Policy evidence','GL balances'][index], ['Record ID','Source','Source row'] + [units.get(f, f) for f in FIELDS[index]])
        assert len(exported) == len(source['records']), 'RECORD_COUNT'
        for actual, record in zip(exported, source['records']):
            rows = {c['row'] for c in record['citations'].values()}; assert len(rows) == 1, 'FLAT_CITATION'; row = rows.pop()
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
    assert table('Inventory', ['Source','Source row','Kind']) == expected_inventory, 'PHYSICAL_INVENTORY'
    assert table('Cell evidence', ['Source','Source row','Column','Field','Text']) == expected_cells, 'LITERAL_CELL_EVIDENCE'
    comparisons = [[c['account'],c['dimensions'],c['registerMinor'],c['debitMinor'],c['creditMinor'],c['debitMinor']-c['creditMinor'],c['differenceMinor']] for c in oracle['comparisons']]
    assert comparisons == [['INV-1','branch=01',100000,100000,0,100000,0], ['INV-1','branch=02',50000,50000,0,50000,0]], 'BRANCH_TRUTH'
    assert table('Account comparisons', ['GL account','GL dimensions','Register minor','Debit minor','Credit minor','GL minor','Difference minor']) == comparisons, 'ACCOUNT_COMPARISONS'
    for name, headers in [('Missing',['Missing']),('Issues',['Source','Source row','Code']),('Events',['Event ID','Type','Context','At','Reference','Note','Member count']),('Event members',['Event ID','Member ID'])]: assert table(name, headers) == [], f'{name}:NOT_EMPTY'
    assert table('Reading', ['Source','Role','Family','Sheet','Confirmed']) == [[i,role,VERSION,0,'true'] for i,role in enumerate(ROLES)], 'READINGS'
    embedded = table('Sources', ['Source','Role','Name','Sheet','SHA256','Part','Parts','Base64'])
    assert {r[0] for r in embedded} == set(range(4)), 'EMBEDDED_SOURCE_COUNT'
    for index, source in enumerate(sources):
        chunks = [r for r in embedded if r[0] == index]; count = len(chunks)
        assert [r[5] for r in chunks] == list(range(1, count + 1)) and count > 0, 'SOURCE_PARTS'
        for chunk in chunks: assert chunk[:5] == [index,ROLES[index],source['name'],'CSV',source['sha256']] and chunk[6] == count, 'SOURCE_METADATA'
        encoded = ''.join(r[7] for r in chunks); original = base64.b64decode(encoded, validate=True)
        assert base64.b64encode(original).decode() == encoded, 'SOURCE_BASE64'
        assert original == (folder / source['name']).read_bytes() and hashlib.sha256(original).hexdigest() == source['sha256'], 'ORIGINAL_BYTES'
    return {'pass':True, 'logicalMembers':14, 'physicalRows':18, 'literalCells':len(expected_cells), 'sources':4, 'registerMinor':150000, 'glMinor':150000}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--workbook', type=Path, required=True); parser.add_argument('--case-dir', type=Path, required=True)
    args = parser.parse_args(); print(json.dumps(check(args.workbook, args.case_dir), sort_keys=True))
