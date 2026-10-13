"""Independent INV-1A byte inspector and Decimal oracle; no producer/product imports."""
import argparse
import csv
import hashlib
import io
import json
import posixpath
import re
from collections import Counter
from datetime import date
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
SCOPE = ['Entity', 'Inventory ledger', 'GL ledger', 'Currency', 'Currency basis', 'Posting status', 'Posting layer', 'As of', 'Chart version', 'Map version', 'Valuation policy version', 'Inventory account set version']
FIELDS = [
    ['Item ID', 'Item dimensions', 'Quantity', 'Unit', 'Quantity precision', 'Posted value', 'Valuation reference'],
    ['Mapping ID', 'Item ID', 'Item dimensions', 'GL account', 'GL dimensions', 'Evidence ID'],
    ['Evidence ID', 'Item ID', 'Item dimensions', 'Unit', 'Quantity precision', 'Valuation reference', 'GL account', 'GL dimensions', 'Account class', 'Sign', 'Value basis', 'Valid from', 'Valid to', 'Reference'],
    ['GL account', 'GL dimensions', 'Account class', 'Debit', 'Credit'],
]
IDENTITY = ['Item ID', 'Item dimensions', 'Unit', 'Quantity precision', 'Valuation reference']


def read_rows(path):
    data = path.read_bytes()
    if not data or len(data) > 8 * 1024 * 1024:
        raise ValueError('SOURCE_SIZE')
    if path.suffix == '.csv':
        return data, list(csv.reader(io.StringIO(data.decode('utf-8-sig'), newline=''), strict=True))
    if path.suffix != '.xlsx':
        raise ValueError('SOURCE_FORMAT')
    with ZipFile(io.BytesIO(data)) as z:
        if len(z.namelist()) != len(set(z.namelist())):
            raise ValueError('ZIP_DUPLICATE')
        if 'xl/styles.xml' in z.namelist(): raise ValueError('FIXTURE_STYLES')
        if set(z.namelist()) != {'[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/report.xml'}: raise ValueError('FIXTURE_ZIP_PARTS')
        if sum(e.file_size for e in z.infolist()) > 32 * 1024 * 1024:
            raise ValueError('ZIP_SIZE')
        def xml(name):
            body = z.read(name)
            if b'<!DOCTYPE' in body or b'<!ENTITY' in body:
                raise ValueError('XML_DTD')
            return ET.fromstring(body)
        book = xml('xl/workbook.xml')
        sheets = book.findall(NS + 'sheets/' + NS + 'sheet')
        if len(sheets) != 1:
            raise ValueError('SHEET_COUNT')
        if sheets[0].get('state') not in [None, 'visible']: raise ValueError('FIXTURE_SHEET_VISIBILITY')
        links = list(xml('xl/_rels/workbook.xml.rels'))
        if len(links) != 1: raise ValueError('FIXTURE_RELATIONSHIPS')
        if len({e.get('Id') for e in links}) != len(links):
            raise ValueError('RELATIONSHIP_DUPLICATE')
        matches = [e for e in links if e.get('Id') == sheets[0].get(REL + 'id')]
        if len(matches) != 1 or matches[0].get('TargetMode') == 'External' or not matches[0].get('Type', '').endswith('/worksheet'):
            raise ValueError('WORKSHEET_RELATIONSHIP')
        target = posixpath.normpath(posixpath.join('xl', matches[0].get('Target', '')))
        if not target.startswith('xl/') or target not in z.namelist():
            raise ValueError('WORKSHEET_PATH')
        sheet = xml(target)
        if sheet.tag != NS + 'worksheet' or len(sheet.findall(NS + 'sheetData')) != 1:
            raise ValueError('WORKSHEET_STRUCTURE')
        if sheet.find(NS + 'mergeCells') is not None: raise ValueError('FIXTURE_MERGE')
        if sheet.find(NS + 'sheetFormatPr') is not None: raise ValueError('FIXTURE_SHEET_FORMAT')
        if any(child.tag not in [NS + 'cols', NS + 'sheetData'] for child in sheet): raise ValueError('FIXTURE_SHEET_FEATURE')
        for col in sheet.findall(NS + 'cols/' + NS + 'col'):
            if set(col.attrib) != {'min', 'max', 'width', 'customWidth'} or col.get('customWidth') != '1': raise ValueError('FIXTURE_COLUMN_DISPLAY')
            if not re.fullmatch('[0-9]+(?:\\.[0-9]+)?', col.get('width', '')) or not 0 < Decimal(col.get('width')) <= 100: raise ValueError('FIXTURE_COLUMN_DISPLAY')
            if not col.get('min', '').isdigit() or not col.get('max', '').isdigit() or not 1 <= int(col.get('min')) <= int(col.get('max')) <= 100: raise ValueError('FIXTURE_COLUMN_DISPLAY')
        rows, seen_rows, seen_cells = [], set(), set()
        for row in sheet.find(NS + 'sheetData'):
            raw_number = row.get('r', '')
            if row.tag != NS + 'row' or not re.fullmatch('[1-9][0-9]*', raw_number):
                raise ValueError('ROW_ADDRESS')
            if set(row.attrib) != {'r'}: raise ValueError('FIXTURE_ROW_DISPLAY')
            number = int(raw_number)
            if number in seen_rows or number > 20001:
                raise ValueError('ROW_DUPLICATE_OR_BOUND')
            seen_rows.add(number)
            while len(rows) < number:
                rows.append([])
            for cell in row:
                match = re.fullmatch('([A-Z]+)([1-9][0-9]*)', cell.get('r', ''))
                if cell.tag != NS + 'c' or not match or int(match[2]) != number:
                    raise ValueError('CELL_ADDRESS')
                column = 0
                for ch in match[1]:
                    column = column * 26 + ord(ch) - 64
                key = (number, column)
                if column > 100 or key in seen_cells:
                    raise ValueError('CELL_DUPLICATE_OR_BOUND')
                seen_cells.add(key)
                if cell.find(NS + 'f') is not None or 's' in cell.attrib:
                    raise ValueError('FIXTURE_FORMULA_OR_STYLE')
                if cell.get('t') == 'inlineStr':
                    inline = cell.find(NS + 'is')
                    if inline is None or len(list(cell)) != 1 or len(list(inline)) != 1 or inline[0].tag != NS + 't' or len(list(inline[0])):
                        raise ValueError('CELL_PAYLOAD')
                    text = ''.join(e.text or '' for e in inline.iter(NS + 't'))
                else:
                    raise ValueError('FIXTURE_CELL_TYPE')
                while len(rows[number - 1]) < column:
                    rows[number - 1].append('')
                rows[number - 1][column - 1] = text
    return data, rows


class Document:
    def __init__(self, path, role):
        data, self.rows = read_rows(path)
        self.role, self.name = role, path.name
        self.sha256 = hashlib.sha256(data).hexdigest()
        self.fates = ['unclassified'] * len(self.rows)
        self.issues, self.records, self.scope, self.scope_citations = [], [], {}, {}
    def issue(self, code, row, field=None):
        self.issues.append(dict(source=self.role, row=row, code=code, field=field))
    def cite(self, row, column):
        return dict(source=self.role, row=row, column=column, raw=self.rows[row - 1][column - 1])
    def record(self, raw, citations):
        self.records.append(dict(raw=dict(raw), citations=dict(citations), scope=dict(self.scope), scopeCitations=dict(self.scope_citations)))
    def report(self):
        assert 'unclassified' not in self.fates
        return dict(name=self.name, role=self.role, sha256=self.sha256,
                    inventory=[dict(row=i + 1, fate=fate, cells=[self.cite(i + 1, c + 1) for c in range(len(self.rows[i]))]) for i, fate in enumerate(self.fates)],
                    records=self.records, issues=self.issues)


def flat(doc, role):
    if not doc.rows:
        doc.issue('COLUMNS', 1); return
    header = doc.rows[0]
    valid = len(header) == len(FIELDS[role] + SCOPE) and set(header) == set(FIELDS[role] + SCOPE)
    for row_number, row in enumerate(doc.rows, 1):
        doc.fates[row_number - 1] = 'header' if row_number == 1 else 'blank' if not any(row) else 'data'
        if not valid or (row_number > 1 and any(row) and len(row) != len(header)):
            doc.issue('COLUMNS', row_number); continue
        if row_number == 1 or not any(row): continue
        values = dict(zip(header, row)); citations = {key: doc.cite(row_number, header.index(key) + 1) for key in header}
        scope = {key: values[key] for key in SCOPE}
        if doc.scope and doc.scope != scope: doc.issue('SCOPE_CONFLICT', row_number)
        doc.scope = scope
        doc.scope_citations = {key: citations[key] for key in SCOPE}
        doc.record({key: values[key] for key in FIELDS[role]}, {key: citations[key] for key in FIELDS[role]})


def metadata(doc, row, values, active):
    doc.fates[row - 1] = 'scope'
    if len(values) != 3 or values[1] not in SCOPE:
        doc.issue('SCOPE_FIELDS', row); return
    key, value = values[1:]
    if active: doc.issue('SCOPE_PLACEMENT', row)
    if key in doc.scope:
        doc.issue('SCOPE_CONFLICT' if value != doc.scope[key] else 'SCOPE_DUPLICATE', row, key)
        return
    doc.scope[key], doc.scope_citations[key] = value, doc.cite(row, 3)


def sections(doc):
    current, citations, start, ended, components, header_seen = None, {}, 0, False, False, False
    controls = []
    def finish(row):
        if current is None: return
        for field in FIELDS[0]:
            if field not in current: doc.issue('MISSING_COMPONENT' if field in ['Quantity', 'Posted value'] else 'MISSING_SECTION_FIELD', start, field)
        doc.record(current, citations)
    for row, values in enumerate(doc.rows, 1):
        label = values[0] if values else ''
        doc.fates[row - 1] = 'blank' if not any(values) else 'error'
        if not any(values): continue
        if row == 1:
            doc.fates[0] = 'format'; continue
        if ended:
            doc.issue('AFTER_REPORT_END', row); continue
        if label == 'Scope': metadata(doc, row, values, current is not None); continue
        if values == ['Section']:
            if current is not None: doc.issue('UNCLOSED_SECTION', row); finish(row)
            if set(doc.scope) != set(SCOPE) or not all(doc.scope.values()): doc.issue('INCOMPLETE_SCOPE_AT_SECTION', row)
            current, citations, start, components, header_seen = {}, {}, row, False, False
            doc.fates[row - 1] = 'section-start'; continue
        if values == ['End section']:
            doc.fates[row - 1] = 'section-end'
            if current is None: doc.issue('ORPHAN_END', row)
            finish(row); current = None; continue
        if values == ['End report']:
            doc.fates[row - 1] = 'report-end'; ended = True
            if current is not None: doc.issue('UNCLOSED_SECTION', row); finish(row); current = None
            continue
        if label in ['Section subtotal', 'Report total'] and len(values) == 2:
            doc.fates[row - 1] = 'control'
            controls.append((label, values[1], row, dict(current) if current is not None else None)); continue
        if values == ['Component', 'Value']:
            doc.fates[row - 1] = 'detail-header'
            if current is None: doc.issue('ORPHAN_HEADER', row)
            elif not all(current.get(field) for field in IDENTITY): doc.issue('INCOMPLETE_IDENTITY_AT_COMPONENT', row)
            components, header_seen = True, True
            continue
        if label in FIELDS[0] and len(values) == 2:
            if current is None: doc.issue('ORPHAN_COMPONENT', row, label); continue
            doc.fates[row - 1] = 'section-field' if label in IDENTITY else 'component'
            if label in IDENTITY and components: doc.issue('IDENTITY_AFTER_COMPONENT', row, label); continue
            if label not in IDENTITY:
                components = True
                if not header_seen: doc.issue('MISSING_DETAIL_HEADER', row)
                if not all(current.get(field) for field in IDENTITY): doc.issue('INCOMPLETE_IDENTITY_AT_COMPONENT', row, label)
            if label in current: doc.issue('DUPLICATE_COMPONENT', row, label); continue
            current[label], citations[label] = values[1], doc.cite(row, 2)
        else: doc.issue('UNKNOWN_SECTION_ROW', row)
    if current is not None: doc.issue('UNCLOSED_SECTION', len(doc.rows)); finish(len(doc.rows))
    if not ended: doc.issue('MISSING_REPORT_END', len(doc.rows))
    for label, value, row, snapshot in controls:
        try:
            expected = money(snapshot['Posted value']) if label == 'Section subtotal' and snapshot is not None else sum(money(r['raw']['Posted value']) for r in doc.records) if label == 'Report total' and snapshot is None else None
            if expected is None or money(value) != expected: doc.issue('CONTROL_MISMATCH', row)
        except (KeyError, ValueError): doc.issue('CONTROL_UNPROVEN', row)


def matrix(doc):
    columns, values, citations, ended = None, {}, {}, False
    for row, cells in enumerate(doc.rows, 1):
        doc.fates[row - 1] = 'blank' if not any(cells) else 'error'
        if not any(cells): continue
        if row == 1: doc.fates[0] = 'format'; continue
        if ended: doc.issue('AFTER_REPORT_END', row); continue
        if cells[0] == 'Scope': metadata(doc, row, cells, columns is not None); continue
        if cells[0] == 'Field':
            doc.fates[row - 1] = 'matrix-header'
            if set(doc.scope) != set(SCOPE) or not all(doc.scope.values()): doc.issue('INCOMPLETE_SCOPE_AT_MATRIX', row)
            if columns is not None or len(cells[1:]) != len(set(cells[1:])) or not all(cells[1:]): doc.issue('DUPLICATE_MATRIX_KEY', row)
            else: columns = cells[1:]
            continue
        if cells == ['End report']: doc.fates[row - 1] = 'report-end'; ended = True; continue
        label = cells[0]
        if columns is None or label not in FIELDS[0] or len(cells) != len(columns) + 1:
            doc.issue('MATRIX_FIELDS', row); continue
        doc.fates[row - 1] = 'matrix-field'
        if label in values: doc.issue('DUPLICATE_FIELD', row, label); continue
        values[label], citations[label] = cells[1:], [doc.cite(row, col) for col in range(2, len(cells) + 1)]
    if not ended: doc.issue('MISSING_REPORT_END', len(doc.rows))
    for field in FIELDS[0]:
        if field not in values: doc.issue('MATRIX_MISSING_FIELD', 1, field)
    for index in range(len(columns or [])):
        doc.record({key: row[index] for key, row in values.items()}, {key: row[index] for key, row in citations.items()})


def money(raw, precision=2):
    if not isinstance(raw, str) or not re.fullmatch('[0-9]+(?:\\.[0-9]+)?', raw): raise ValueError('NUMBER')
    if len(raw.partition('.')[2]) > precision: raise ValueError('PRECISION')
    return int(Decimal(raw) * (10 ** precision))


def check_case(folder):
    registers = list(folder.glob('register.*'))
    if len(registers) != 1: raise ValueError('REGISTER_COUNT')
    docs = [Document(registers[0], 0)] + [Document(folder / f'source-{n}.csv', n) for n in [1, 2, 3]]
    register = docs[0]
    first = register.rows[0] if register.rows else []
    flat_header = len(first) == len(FIELDS[0] + SCOPE) and set(first) == set(FIELDS[0] + SCOPE)
    layout = 'sections' if first == ['Format', 'INV1A-SECTIONS-1'] else 'matrix' if first == ['Format', 'INV1A-MATRIX-1'] else 'flat' if flat_header else 'unsupported'
    if layout == 'unsupported':
        register.fates = ['error' if any(row) else 'blank' for row in register.rows]
        register.issue('UNKNOWN_FORMAT', 1)
    else: (sections if layout == 'sections' else matrix if layout == 'matrix' else lambda d: flat(d, 0))(register)
    for n in [1, 2, 3]: flat(docs[n], n)
    scopes = [d.scope for d in docs]
    for d in docs:
        if set(d.scope) != set(SCOPE) or d.scope != scopes[0]: d.issue('SCOPE_CONFLICT', 1)
    scope = scopes[0]
    if scope.get('Currency') != 'SAR' or scope.get('Posting status') != 'posted' or scope.get('Currency basis') != 'functional': register.issue('SCOPE_POLICY', 1)
    def key(raw): return raw.get('Item ID'), raw.get('Item dimensions')
    for d in docs:
        identities = [key(r['raw']) if d.role == 0 else (r['raw'].get('Mapping ID'),) if d.role == 1 else (r['raw'].get('Evidence ID'),) if d.role == 2 else (r['raw'].get('GL account'), r['raw'].get('GL dimensions')) for r in d.records]
        for identity, count in Counter(identities).items():
            if count > 1: d.issue('DUPLICATE_IDENTITY', 0, str(identity))
    for identity, count in Counter(key(r['raw']) for r in docs[1].records).items():
        if count > 1: docs[1].issue('DUPLICATE_MAPPING', 0, str(identity))
    missing, allocations, used_maps, used_policies = [], [], set(), set()
    for record in register.records:
        raw = record['raw']; matches = [r['raw'] for r in docs[1].records if key(r['raw']) == key(raw)]
        try:
            amount = money(raw.get('Posted value')); precision = int(raw.get('Quantity precision', ''))
            if precision not in range(7): raise ValueError('QUANTITY_PRECISION')
            record['quantityUnits'], record['postedValueMinor'] = money(raw.get('Quantity'), precision), amount
        except ValueError as error: register.issue(str(error), 0); continue
        if len(matches) != 1: missing.append('MAPPING_BINDING'); continue
        mapping = matches[0]; policies = [r['raw'] for r in docs[2].records if r['raw']['Evidence ID'] == mapping['Evidence ID']]
        used_maps.add(mapping['Mapping ID'])
        if len(policies) != 1: missing.append('POLICY_BINDING'); continue
        policy = policies[0]
        used_policies.add(policy['Evidence ID'])
        fields = ['Item ID', 'Item dimensions', 'Unit', 'Quantity precision', 'Valuation reference']
        if any(policy[f] != raw.get(f) for f in fields) or any(policy[f] != mapping[f] for f in ['GL account', 'GL dimensions']): missing.append('POLICY_BINDING'); continue
        if not (date.fromisoformat(policy['Valid from']) <= date.fromisoformat(scope['As of']) <= date.fromisoformat(policy['Valid to'])): docs[2].issue('VALIDITY', 0)
        if [policy['Account class'], policy['Sign'], policy['Value basis']] != ['inventory', 'debit-positive', 'provided-posted-carrying-value']: docs[2].issue('POLICY', 0)
        allocations.append(dict(key=list(key(raw)), account=mapping['GL account'], dimensions=mapping['GL dimensions'], minor=amount))
    comparisons = []
    gl_keys = {(r['raw']['GL account'], r['raw']['GL dimensions']) for r in docs[3].records}
    mapped_keys = {(r['raw']['GL account'], r['raw']['GL dimensions']) for r in docs[1].records}
    for account_key in {(a['account'], a['dimensions']) for a in allocations} - gl_keys: missing.append('GL_BINDING')
    for record in docs[1].records:
        if record['raw']['Mapping ID'] not in used_maps: missing.append('ORPHAN_MAPPING')
    for record in docs[2].records:
        if record['raw']['Evidence ID'] not in used_policies: missing.append('ORPHAN_POLICY')
    for record in docs[3].records:
        raw = record['raw']; account, dimensions = raw['GL account'], raw['GL dimensions']
        members = [a for a in allocations if (a['account'], a['dimensions']) == (account, dimensions)]
        if (account, dimensions) not in mapped_keys: missing.append('GL_ACCOUNT_BINDING')
        debit, credit = money(raw['Debit']), money(raw['Credit'])
        comparisons.append(dict(account=account, dimensions=dimensions, members=[a['key'] for a in members], registerMinor=sum(a['minor'] for a in members), debitMinor=debit, creditMinor=credit, differenceMinor=sum(a['minor'] for a in members) - debit + credit))
    issues = [issue for d in docs for issue in d.issues]
    totals = None if issues else dict(registerMinor=sum(a['minor'] for a in allocations), glMinor=sum(c['debitMinor'] - c['creditMinor'] for c in comparisons))
    financial = 'source-error' if issues else 'missing' if missing else 'difference' if any(c['differenceMinor'] for c in comparisons) else 'ready'
    if issues:
        for c in comparisons:
            for field in ['registerMinor', 'debitMinor', 'creditMinor', 'differenceMinor']: c[field] = None
    return dict(id=folder.name, layout=layout, runtimeCommitment={'matrix': 'exploratory-unsupported', 'flat': 'existing', 'sections': 'target-not-implemented', 'unsupported': 'unsupported'}[layout], financial=financial, review='needs-review', totals=totals, comparisons=comparisons, missing=missing, issues=issues, sources=[d.report() for d in docs])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--root', type=Path, required=True)
    root = parser.parse_args().root
    print(json.dumps(dict(schema='inv1a-independent-observations/1', cases=[check_case(p) for p in sorted((root / 'cases').iterdir()) if p.is_dir()]), ensure_ascii=False, indent=2))
