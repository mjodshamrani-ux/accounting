"""Independent serialized-source and financial oracle, without producer/product imports."""
import argparse
import csv
import hashlib
import json
import posixpath
import re
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
SCOPE = ['Entity', 'Inventory ledger', 'GL ledger', 'Currency', 'Currency basis', 'Posting status', 'Posting layer', 'As of', 'Chart version', 'Map version', 'Valuation policy version', 'Inventory account set version']
ROLES = ['Item ID', 'Quantity', 'Unit', 'Quantity precision', 'Posted value', 'Valuation reference']
TRUTH = {
    ('0007', 'warehouse=NORTH;batch=LOT-A'): [1250, 'KG', 3, 310125, 'VAL-A', 'INV-RAW', 'branch=10'],
    ('07', 'warehouse=NORTH;batch=LOT-B'): [275, 'KG', 2, 189875, 'VAL-B', 'INV-RAW', 'branch=20'],
    ('0007', 'warehouse=SOUTH;batch=LOT-A'): [1250, 'G', 0, 500000, 'VAL-C', 'INV-RAW', 'branch=30'],
    ('7', 'warehouse=SOUTH;batch=LOT-C'): [3, 'EA', 0, 62500, 'VAL-D', 'INV-PACK', 'branch=40'],
    ('00', 'warehouse=NORTH;batch=Z0'): [0, 'EA', 0, 0, 'VAL-Z', 'INV-PACK', 'branch=60'],
    ('007', 'warehouse=EAST;batch=LOT-A'): [50, 'KG', 2, 62500, 'VAL-F', 'INV-PACK', 'branch=50'],
}


def number(text, precision):
    assert isinstance(text, str) and re.fullmatch(r'[+-]?\d+(?:\.\d+)?', text), 'NUMBER'
    value = Decimal(text) * 10 ** precision
    assert value == int(value), 'PRECISION'
    return int(value)


def coordinate(text):
    match = re.fullmatch(r'([A-Z]+)([1-9]\d*)', text)
    assert match, 'COORDINATE'
    column = 0
    for letter in match[1]:
        column = column * 26 + ord(letter) - 64
    return int(match[2]), column


def read(file):
    if file.suffix == '.csv':
        with file.open(newline='') as stream:
            return list(csv.reader(stream)), [], {}, 'CSV'
    with ZipFile(file) as archive:
        rel = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        targets = [r.attrib['Target'] for r in rel if r.attrib['Type'].endswith('/worksheet')]
        assert len(targets) == 1, 'SHEETS'
        part = posixpath.normpath(posixpath.join('xl', targets[0]))
        assert part.startswith('xl/worksheets/'), 'PART'
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = [''.join(x.text or '' for x in s.findall('.//s:t', NS)) for s in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        tree = ET.fromstring(archive.read(part))
        rows, stored = [], {}
        for row in tree.findall('s:sheetData/s:row', NS):
            n = int(row.attrib['r'])
            while len(rows) < n:
                rows.append([])
            for cell in row.findall('s:c', NS):
                r, c = coordinate(cell.attrib['r'])
                assert r == n and (r, c) not in stored, 'CELL_COORDINATE'
                assert cell.find('s:f', NS) is None, 'FORMULA'
                kind = cell.attrib.get('t', 'n')
                value = cell.findtext('s:v', '', NS)
                if kind == 'inlineStr':
                    value = ''.join(x.text or '' for x in cell.findall('.//s:t', NS))
                elif kind == 's':
                    value = shared[int(value)]
                while len(rows[r - 1]) < c:
                    rows[r - 1].append('')
                rows[r - 1][c - 1] = value
                stored[(r, c)] = (value, kind)
        merges = [r.attrib['ref'] for r in tree.findall('s:mergeCells/s:mergeCell', NS)]
        return rows, merges, stored, part


def interpret(rows, merges, stored):
    scope, facts, intervals = {}, [], {}
    occupied = set()
    for merge in merges:
        first, last = merge.split(':')
        top, left = coordinate(first)
        bottom, right = coordinate(last)
        assert top == bottom and 2 <= left < right, 'MERGE_GEOMETRY'
        assert rows[top - 1][0] in ['Warehouse', 'Plant'], 'MERGE_ROLE'
        for column in range(left, right + 1):
            key = (top, column)
            assert key not in occupied, 'MERGE_OVERLAP'
            occupied.add(key)
            if column > left:
                assert stored.get(key, ('', ''))[0] == '', 'MERGE_PAYLOAD'
            intervals[key] = (left, right, merge)
    def cell(row, column):
        return rows[row - 1][column - 1] if column <= len(rows[row - 1]) else ''
    def literal(row, column, dimension=False):
        value = cell(row, column)
        assert value and value == value.strip() and not re.search(r'[\x00-\x1f]', value), 'IDENTITY'
        assert stored.get((row, column), ('', 's'))[1] in ['s', 'inlineStr'], 'NUMERIC_IDENTITY'
        if dimension:
            assert not re.search('[;=]', value), 'DIMENSION_TOKEN'
        return value
    panel = None
    parent_kind = None
    ended, control = False, None
    seen = set()
    for n, row in enumerate(rows, 1):
        if not any(row):
            continue
        assert not ended, 'TRAILING'
        label = row[0]
        width = len(row)
        while width and row[width - 1] == '':
            width -= 1
        if n == 1:
            assert row[:width] == ['Inventory carrying-value register'], 'TITLE'
        elif label in SCOPE:
            assert panel is None and parent_kind is None and width == 2 and label not in scope, 'SCOPE'
            scope[label] = literal(n, 2)
        elif label in ['Warehouse', 'Plant']:
            assert panel is None and control is None and len(scope) == 12, 'PANEL_START'
            assert parent_kind in [None, label], 'PARENT_KIND'
            parent_kind = label
            panel = {'parent': n, 'batch': None, 'axis': None, 'roles': {}}
        elif label == 'Batch':
            assert panel and not panel['batch'] and not panel['axis'], 'BATCH_ROW'
            panel['batch'] = n
        elif label == 'Field':
            assert panel and panel['batch'] and not panel['axis'], 'AXIS_ROW'
            panel['axis'] = n
        elif label in ROLES + ['Item dimensions']:
            assert panel and panel['axis'] and label not in panel['roles'], 'ROLE_ROW'
            panel['roles'][label] = n
        elif label == 'End panel':
            assert panel and width == 1 and all(r in panel['roles'] for r in ROLES), 'PANEL_END'
            assert panel['batch'] and panel['axis'], 'PANEL_HEADERS'
            axis = panel['axis']
            active = [c for c in range(2, len(rows[axis - 1]) + 1) if cell(axis, c)]
            assert active and len({cell(axis, c) for c in active}) == len(active), 'AXIS_IDENTITY'
            involved = [panel['parent'], panel['batch'], axis] + list(panel['roles'].values())
            max_column = max(len(rows[r - 1]) for r in involved)
            for c in range(2, max_column + 1):
                if c not in active:
                    assert all(cell(r, c) == '' for r in involved), 'ORPHAN_COLUMN'
            for c in active:
                literal(axis, c)
                owner = intervals.get((panel['parent'], c))
                anchor = owner[0] if owner else c
                if owner:
                    assert all(x in active for x in range(owner[0], owner[1] + 1)), 'MERGE_INACTIVE_COLUMN'
                parent = literal(panel['parent'], anchor, True)
                batch = literal(panel['batch'], c, True)
                raw = {role: cell(r, c) for role, r in panel['roles'].items()}
                assert all(raw.values()), 'MISSING_VALUE'
                dims = parent_kind.lower() + '=' + parent + ';batch=' + batch
                assert raw.get('Item dimensions', dims) == dims, 'DIMENSION_CONFLICT'
                for role in ['Item ID', 'Unit', 'Valuation reference']:
                    literal(panel['roles'][role], c)
                assert re.fullmatch('[0-6]', raw['Quantity precision']), 'QUANTITY_PRECISION'
                precision = int(raw['Quantity precision'])
                value = [raw['Item ID'], dims, number(raw['Quantity'], precision), raw['Unit'], precision, number(raw['Posted value'], 3), raw['Valuation reference']]
                key = tuple(value[:2])
                assert key not in seen, 'DUPLICATE_FACT'
                seen.add(key)
                facts.append({'values': value, 'column': c, 'axis': [axis, c, cell(axis, c)], 'parent': [panel['parent'], anchor, parent], 'merge': owner[2] if owner else None, 'batch': [panel['batch'], c, batch], 'panelEnd': n, 'fields': {role: {'value': [r, c, raw[role]], 'role': [r, 1, role]} for role, r in panel['roles'].items()}})
            panel = None
        elif label == 'Report total':
            assert panel is None and control is None and width == 2, 'CONTROL'
            control = number(row[1], 3)
            assert control == sum(f['values'][5] for f in facts), 'REPORT_TOTAL'
        elif label == 'End report':
            assert panel is None and width == 1, 'REPORT_END'
            ended = True
        else:
            raise AssertionError('UNKNOWN_ROW')
    assert ended and len(scope) == 12 and facts and panel is None, 'INCOMPLETE'
    return scope, facts


def inspect(folder):
    source = next(folder.glob('register.*'))
    try:
        rows, merges, stored, part = read(source)
        scope, facts = interpret(rows, merges, stored)
    except (AssertionError, ValueError, KeyError, IndexError) as error:
        return {'id': folder.name, 'financial': 'source-error', 'reason': str(error), 'facts': []}
    companions = []
    for i in range(1, 4):
        with (folder / f'source-{i}.csv').open(newline='') as stream:
            companions.append(list(csv.DictReader(stream)))
    for rows in companions:
        for row in rows:
            assert all(row[k] == v for k, v in scope.items()), 'COMPANION_SCOPE'
    missing, supported, links = False, {}, []
    for fact in facts:
        v = fact['values']
        maps = [m for m in companions[0] if [m['Item ID'], m['Item dimensions']] == v[:2]]
        if len(maps) != 1:
            missing = True
            continue
        mapping = maps[0]
        policies = [p for p in companions[1] if p['Evidence ID'] == mapping['Evidence ID']]
        if len(policies) != 1:
            missing = True
            continue
        policy = policies[0]
        actual = [policy[k] for k in ['Item ID', 'Item dimensions', 'Unit', 'Quantity precision', 'Valuation reference', 'GL account', 'GL dimensions', 'Account class', 'Sign', 'Value basis']]
        expected = [v[0], v[1], v[3], str(v[4]), v[6], mapping['GL account'], mapping['GL dimensions'], 'inventory', 'debit-positive', 'provided-posted-carrying-value']
        if actual != expected or not policy['Valid from'] <= scope['As of'] <= policy['Valid to']:
            missing = True
            continue
        key = (mapping['GL account'], mapping['GL dimensions'])
        supported[key] = supported.get(key, 0) + v[5]
        links.append({'key': v[:2], 'mapping': mapping['Mapping ID'], 'policy': policy['Evidence ID'], 'account': list(key), 'minor': v[5], 'mappingRow': companions[0].index(mapping) + 2, 'policyRow': companions[1].index(policy) + 2})
    comparisons = []
    for gl in companions[2]:
        key = (gl['GL account'], gl['GL dimensions'])
        debit, credit = number(gl['Debit'], 3), number(gl['Credit'], 3)
        if key not in supported:
            missing = True
        comparisons.append([*key, supported.get(key, 0), debit, credit, debit - credit, supported.get(key, 0) - debit + credit])
    financial = 'missing' if missing else 'difference' if any(c[-1] for c in comparisons) else 'ready'
    gl_headers = ['GL account', 'GL dimensions', 'Account class', 'Debit', 'Credit']
    gl_evidence = [{k: [n, c, gl[k]] for c, k in enumerate(gl_headers, 1)} for n, gl in enumerate(companions[2], 2)]
    return {'id': folder.name, 'financial': financial, 'facts': facts, 'links': links, 'comparisons': comparisons, 'glEvidence': gl_evidence, 'scope': scope, 'sourcePart': part, 'sourceHash': hashlib.sha256(source.read_bytes()).hexdigest(), 'providedMinor': sum(f['values'][5] for f in facts), 'totals': {'registerMinor': sum(supported.values()), 'glMinor': sum(c[5] for c in comparisons)}}


def verify(result):
    code = result['id'].split('-')[-1]
    if code.startswith('D'):
        code = 'N' + code[1:]
    expected = 'ready' if code.startswith(('P', 'C')) else 'difference' if code == 'N01' else 'missing' if code in ['N02', 'N14', 'N15'] else 'source-error'
    assert result['financial'] == expected, (code, result)
    if expected == 'source-error':
        return
    assert len(result['facts']) == 6 and result['providedMinor'] == 1125000
    if expected == 'ready':
        assert result['totals'] == {'registerMinor': 1125000, 'glMinor': 1125000}
        assert len(result['links']) == 6
        assert {tuple(f['values'][:2]) for f in result['facts']} == set(TRUTH)
        for fact in result['facts']:
            v = fact['values']
            t = TRUTH[tuple(v[:2])]
            assert v[2:] == t[:5], (v, t)
            link = next(x for x in result['links'] if x['key'] == v[:2])
            assert link['account'] == t[5:] and link['minor'] == t[3]
            index = list(TRUTH).index(tuple(v[:2]))
            assert [link['mapping'], link['policy']] == [f'MAP-E-{index}', f'POL-E-{index}']
        assert all(c[-1] == 0 for c in result['comparisons'])
    elif code == 'N01':
        assert sorted(c[-1] for c in result['comparisons']) == [-120250, 0, 0, 0, 0, 120250]
    else:
        assert result['totals']['registerMinor'] == {'N02': 62500, 'N14': 1000000, 'N15': 625000}[code]


def verify_citations(result, folder):
    """Check each receipt against physical source cells, not just monetary truth."""
    source = next(folder.glob('register.*'))
    rows, merges, stored, part = read(source)
    assert result['sourceHash'] == hashlib.sha256(source.read_bytes()).hexdigest(), 'SOURCE_HASH'
    assert result['sourcePart'] == part, 'SOURCE_PART'
    def raw(citation):
        r, c, value = citation
        assert r > 0 and c > 0 and r <= len(rows) and c <= len(rows[r - 1]), 'CITATION_RANGE'
        assert rows[r - 1][c - 1] == value, 'CITATION_VALUE'
        return value
    for f in result['facts']:
        col = f['column']
        pr, pc, parent = f['parent']
        br, bc, batch = f['batch']
        ar, ac, axis = f['axis']
        assert pr < br < ar < f['panelEnd'] and bc == ac == col, 'CITATION_OWNERSHIP'
        assert rows[pr - 1][0] in ['Plant', 'Warehouse'] and rows[br - 1][0] == 'Batch' and rows[ar - 1][0] == 'Field', 'HEADER_ROLE'
        assert rows[f['panelEnd'] - 1] == ['End panel'], 'PANEL_BOUNDARY'
        assert not any(r and r[0] in ['End panel', 'Warehouse', 'Plant'] for r in rows[pr:f['panelEnd'] - 1]), 'FOREIGN_PANEL'
        raw(f['parent']); raw(f['batch']); raw(f['axis'])
        if f['merge']:
            assert f['merge'] in merges, 'MERGE_CITATION'
            first, last = f['merge'].split(':')
            top, left = coordinate(first)
            bottom, right = coordinate(last)
            assert top == bottom == pr and pc == left <= col <= right, 'MERGE_OWNERSHIP'
        else:
            assert pc == col, 'DIRECT_OWNERSHIP'
        derived = rows[pr - 1][0].lower() + '=' + parent + ';batch=' + batch
        assert f['values'][1] == derived, 'DERIVED_DIMENSIONS'
        values = {}
        for role, citations in f['fields'].items():
            value, label = citations['value'], citations['role']
            assert value[0] == label[0] and value[1] == col and label[1:] == [1, role], 'FIELD_OWNERSHIP'
            assert ar < value[0] < f['panelEnd'], 'FIELD_BOUNDARY'
            values[role] = raw(value)
            raw(label)
        precision = int(values['Quantity precision'])
        assert f['values'] == [values['Item ID'], derived, number(values['Quantity'], precision), values['Unit'], precision, number(values['Posted value'], 3), values['Valuation reference']], 'FIELD_FACT'
    companion_rows = []
    for n in [1, 2, 3]:
        with (folder / f'source-{n}.csv').open(newline='') as stream:
            companion_rows.append(list(csv.reader(stream)))
    def record(n, row):
        assert 2 <= row <= len(companion_rows[n]), 'LINK_ROW'
        return dict(zip(companion_rows[n][0], companion_rows[n][row - 1]))
    for link in result['links']:
        mapping = record(0, link['mappingRow'])
        policy = record(1, link['policyRow'])
        assert [mapping['Item ID'], mapping['Item dimensions']] == link['key'], 'MAP_SOURCE_KEY'
        assert mapping['Mapping ID'] == link['mapping'] and mapping['Evidence ID'] == link['policy'] == policy['Evidence ID'], 'MAP_POLICY_SOURCE'
        assert [policy['Item ID'], policy['Item dimensions']] == link['key'], 'POLICY_SOURCE_KEY'
        assert [mapping['GL account'], mapping['GL dimensions']] == link['account'] == [policy['GL account'], policy['GL dimensions']], 'LINK_SOURCE_ACCOUNT'
    assert len(result['comparisons']) == len(companion_rows[2]) - 1, 'GL_COVERAGE'
    for row, comparison in enumerate(result['comparisons'], 2):
        gl = record(2, row)
        assert comparison[:2] == [gl['GL account'], gl['GL dimensions']], 'GL_SOURCE_ACCOUNT'
        assert comparison[3:6] == [number(gl['Debit'], 3), number(gl['Credit'], 3), number(gl['Debit'], 3) - number(gl['Credit'], 3)], 'GL_SOURCE_AMOUNT'
        for field, citation in result['glEvidence'][row - 2].items():
            r, c, value = citation
            assert r == row and companion_rows[2][0][c - 1] == field and companion_rows[2][r - 1][c - 1] == value, 'GL_CITATION'


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    root = Path(parser.parse_args().root)
    results = [inspect(p) for p in sorted(root.glob('INV1E-*'))]
    assert len(results) in [20, 24, 40]
    for result in results:
        verify(result)
        if result['facts']:
            verify_citations(result, root / result['id'])
    print(json.dumps({'cases': results}))
