"""PRIVATE matrix byte inspector/Decimal oracle; no producer/product imports.

This inspector checks the bounded synthetic CSV/OOXML corpus. It is not a
generic spreadsheet visual-security validator or an independent holdout.
"""
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
if not __debug__:
    raise RuntimeError('OPTIMIZED_PYTHON_DISABLED')

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
DRAW = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
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
        if sum(e.file_size for e in z.infolist()) > 32 * 1024 * 1024:
            raise ValueError('ZIP_SIZE')
        def xml(name):
            body = z.read(name)
            if b'<!DOCTYPE' in body or b'<!ENTITY' in body:
                raise ValueError('XML_DTD')
            return ET.fromstring(body)
        strings = [''.join(t.text or '' for t in si.iter(NS + 't')) for si in xml('xl/sharedStrings.xml')] if 'xl/sharedStrings.xml' in z.namelist() else []
        if 'xl/theme/theme1.xml' in z.namelist():
            dark = xml('xl/theme/theme1.xml').find(DRAW + 'themeElements/' + DRAW + 'clrScheme/' + DRAW + 'dk1')
            if dark is None or len(dark) != 1 or dark[0].get('lastClr', dark[0].get('val')) != '000000': raise ValueError('FIXTURE_THEME_TEXT')
        if 'xl/styles.xml' in z.namelist():
            style = xml('xl/styles.xml')
            if style.find(NS + 'numFmts') is not None and len(style.find(NS + 'numFmts')): raise ValueError('FIXTURE_CUSTOM_FORMAT')
            if style.find(NS + 'dxfs') is not None and len(style.find(NS + 'dxfs')): raise ValueError('FIXTURE_CONDITIONAL_DISPLAY')
            for font in style.findall(NS + 'fonts/' + NS + 'font'):
                if font.find(NS + 'vanish') is not None or font.find(NS + 'strike') is not None: raise ValueError('FIXTURE_FONT_VISIBILITY')
                size = font.find(NS + 'sz')
                if size is not None and Decimal(size.get('val', '0')) < 10: raise ValueError('FIXTURE_FONT_SIZE')
                color = font.find(NS + 'color')
                if color is not None and dict(color.attrib) not in [{'rgb':'FF0A1B2E'}, {'theme':'1'}]: raise ValueError('FIXTURE_FONT_COLOR')
            xfs = style.findall(NS + 'cellXfs/' + NS + 'xf')
            if any(xf.get('numFmtId', '0') != '0' or xf.get('fillId', '0') != '0' for xf in xfs): raise ValueError('FIXTURE_XF')
            for xf in xfs:
                if any(name not in ['numFmtId','fontId','fillId','borderId','xfId','pivotButton','quotePrefix'] for name in xf.attrib) or len(list(xf)): raise ValueError('FIXTURE_XF_DELEGATION')
            for xf in style.findall(NS + 'cellStyleXfs/' + NS + 'xf'):
                if dict(xf.attrib) != {'numFmtId':'0','fontId':'0','fillId':'0','borderId':'0'} or len(list(xf)): raise ValueError('FIXTURE_STYLE_BASE')
        else: xfs = []
        book = xml('xl/workbook.xml')
        sheets = book.findall(NS + 'sheets/' + NS + 'sheet')
        if len(sheets) != 1:
            raise ValueError('SHEET_COUNT')
        if sheets[0].get('state') not in [None, 'visible']: raise ValueError('FIXTURE_SHEET_VISIBILITY')
        links = list(xml('xl/_rels/workbook.xml.rels'))
        if len({e.get('Id') for e in links}) != len(links):
            raise ValueError('RELATIONSHIP_DUPLICATE')
        matches = [e for e in links if e.get('Id') == sheets[0].get(REL + 'id')]
        if len(matches) != 1 or matches[0].get('TargetMode') == 'External' or not matches[0].get('Type', '').endswith('/worksheet'):
            raise ValueError('WORKSHEET_RELATIONSHIP')
        link_target = matches[0].get('Target', '')
        target = posixpath.normpath(link_target.lstrip('/') if link_target.startswith('/') else posixpath.join('xl', link_target))
        if not target.startswith('xl/') or target not in z.namelist():
            raise ValueError('WORKSHEET_PATH')
        sheet = xml(target)
        if sheet.tag != NS + 'worksheet' or len(sheet.findall(NS + 'sheetData')) != 1:
            raise ValueError('WORKSHEET_STRUCTURE')
        if sheet.find(NS + 'mergeCells') is not None: raise ValueError('FIXTURE_MERGE')
        if sheet.find(NS + 'conditionalFormatting') is not None: raise ValueError('FIXTURE_CONDITIONAL_DISPLAY')
        if sheet.find(NS + 'drawing') is not None: raise ValueError('FIXTURE_DRAWING')
        for view in sheet.findall(NS + 'sheetViews/' + NS + 'sheetView'):
            if view.get('showZeros') in ['0','false']: raise ValueError('FIXTURE_HIDDEN_ZERO')
        defaults = sheet.find(NS + 'sheetFormatPr')
        if defaults is not None and (defaults.get('zeroHeight') in ['1','true'] or defaults.get('defaultRowHeight') == '0' or defaults.get('defaultColWidth') == '0'): raise ValueError('FIXTURE_DEFAULT_DISPLAY')
        for col in sheet.findall(NS + 'cols/' + NS + 'col'):
            if col.get('hidden') in ['1', 'true']: raise ValueError('FIXTURE_COLUMN_DISPLAY')
            if col.get('style') is not None: raise ValueError('FIXTURE_COLUMN_STYLE')
            if not re.fullmatch('[0-9]+(?:\\.[0-9]+)?', col.get('width', '')) or not 0 < Decimal(col.get('width')) <= 100: raise ValueError('FIXTURE_COLUMN_DISPLAY')
            if not col.get('min', '').isdigit() or not col.get('max', '').isdigit() or not 1 <= int(col.get('min')) <= int(col.get('max')) <= 100: raise ValueError('FIXTURE_COLUMN_DISPLAY')
        rows, seen_rows, seen_cells = [], set(), set()
        for row in sheet.find(NS + 'sheetData'):
            raw_number = row.get('r', '')
            if row.tag != NS + 'row' or not re.fullmatch('[1-9][0-9]*', raw_number):
                raise ValueError('ROW_ADDRESS')
            if row.get('hidden') in ['1', 'true'] or row.get('ht') == '0': raise ValueError('FIXTURE_ROW_DISPLAY')
            if row.get('s') is not None or row.get('customFormat') is not None: raise ValueError('FIXTURE_ROW_STYLE')
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
                if cell.find(NS + 'f') is not None: raise ValueError('FIXTURE_FORMULA')
                if 's' in cell.attrib and (not cell.get('s').isdigit() or int(cell.get('s')) >= len(xfs)): raise ValueError('FIXTURE_STYLE_INDEX')
                if cell.get('t') == 'inlineStr':
                    inline = cell.find(NS + 'is')
                    if inline is None and len(list(cell)) == 0:
                        text = ''
                        while len(rows[number - 1]) < column: rows[number - 1].append('')
                        rows[number - 1][column - 1] = text
                        continue
                    if inline is None or len(list(cell)) != 1 or len(list(inline)) != 1 or inline[0].tag != NS + 't' or len(list(inline[0])):
                        raise ValueError('CELL_PAYLOAD')
                    text = ''.join(e.text or '' for e in inline.iter(NS + 't'))
                elif cell.get('t') == 's':
                    index = cell.findtext(NS + 'v', '')
                    if not re.fullmatch('0|[1-9][0-9]*', index) or int(index) >= len(strings): raise ValueError('FIXTURE_SHARED_STRING')
                    text = strings[int(index)]
                elif cell.get('t') in [None, 'n']:
                    text = cell.findtext(NS + 'v', '')
                    if not re.fullmatch('[0-9]+(?:\\.[0-9]+)?', text): raise ValueError('FIXTURE_NUMERIC_LEXEME')
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
        self.sheet_name = 'CSV'
        self.native_types = {}
        if path.suffix == '.xlsx':
            with ZipFile(io.BytesIO(data)) as archive:
                self.sheet_name = ET.fromstring(archive.read('xl/workbook.xml')).find(NS + 'sheets/' + NS + 'sheet').get('name')
                for name in archive.namelist():
                    if re.fullmatch(r'xl/worksheets/[^/]+\.xml', name):
                        root = ET.fromstring(archive.read(name))
                        for cell in root.findall(NS + 'sheetData/' + NS + 'row/' + NS + 'c'):
                            match = re.fullmatch(r'([A-Z]+)([1-9][0-9]*)',cell.get('r',''))
                            column=0
                            for ch in match[1]: column=column*26+ord(ch)-64
                            self.native_types[(int(match[2]),column)] = cell.get('t','n')
        self.fates = ['unclassified'] * len(self.rows)
        self.matrix_bands = []
        self.issues, self.records, self.scope, self.scope_citations = [], [], {}, {}
    def issue(self, code, row, field=None):
        self.issues.append(dict(source=self.role, row=row, code=code, field=field))
    def cite(self, row, column):
        return dict(source=self.role, row=row, column=column, raw=self.rows[row - 1][column - 1])
    def record(self, raw, citations):
        self.records.append(dict(raw=dict(raw), citations=dict(citations), scope=dict(self.scope), scopeCitations=dict(self.scope_citations)))
    def report(self):
        assert 'unclassified' not in self.fates
        return dict(name=self.name, role=self.role, sha256=self.sha256, sheetName=self.sheet_name,
                    inventory=[dict(row=i + 1, fate=fate, cells=[self.cite(i + 1, c + 1) for c in range(len(self.rows[i]))]) for i, fate in enumerate(self.fates)],
                    records=self.records, issues=self.issues, matrixBands=self.matrix_bands)


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
        doc.records[-1]['sourceRow'] = row_number


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
        doc.records[-1].update(sourceRow=start, endRow=row, boundaries={'Section': doc.cite(start, 1), 'End section': doc.cite(row, 1)})
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
    band, ended, seen_axis, controls = None, False, False, []
    def finish(boundary_row, boundary_kind):
        nonlocal band
        if band is None: return
        for field in FIELDS[0]:
            if field not in band['values']: doc.issue('MISSING_MATRIX_ROLE',boundary_row,field)
        doc.matrix_bands.append({'header':doc.cite(band['header'],1),'columns':[{'column':column,'key':key} for column,key in band['columns']], 'boundary':{'kind':boundary_kind,'citation':doc.cite(boundary_row,1)}})
        for column,key in band['columns']:
            raw={field:cells[column-1] if column<=len(cells) else '' for field,cells in band['values'].items()}
            citations={field:doc.cite(row,column) for field,row in band['rows'].items() if column<=len(doc.rows[row-1])}
            for field,value in raw.items():
                if not value: doc.issue('MISSING_MATRIX_VALUE',band['rows'][field],field)
                if field not in ['Quantity','Quantity precision','Posted value'] and doc.native_types.get((band['rows'][field],column))=='n': doc.issue('NUMERIC_IDENTITY',band['rows'][field],field)
            if set(raw)!=set(FIELDS[0]) or not all(raw.values()): continue
            doc.record(raw,citations)
            doc.records[-1].update(sourceRow=band['rows'].get('Item ID',band['header']),column=column,bandStart=band['header'],bandEnd=boundary_row,axisKey=key,
                axisCitation=doc.cite(band['header'],column),fieldHeader=doc.cite(band['header'],1),
                boundary=doc.cite(boundary_row,1),boundaryKind=boundary_kind,
                roleCitations={field:doc.cite(row,1) for field,row in band['rows'].items()})
        band=None
    for row,cells in enumerate(doc.rows,1):
        raw=list(cells)
        while raw and raw[-1]=='': raw.pop()
        label=raw[0] if raw else ''
        doc.fates[row-1]='blank' if not any(cells) else 'error'
        if not any(cells): continue
        if row==1: doc.fates[0]='format'; continue
        if ended: doc.issue('AFTER_REPORT_END',row); continue
        if label=='Scope': metadata(doc,row,raw,seen_axis); continue
        if label=='Field':
            doc.fates[row-1]='matrix-axis'
            if controls: doc.issue('AXIS_AFTER_TOTAL',row)
            finish(row,'field')
            if set(doc.scope)!=set(SCOPE) or not all(doc.scope.values()): doc.issue('INCOMPLETE_SCOPE_AT_MATRIX',row)
            columns=[(c+1,v) for c,v in enumerate(cells) if c>0 and v!='']
            if not columns: doc.issue('EMPTY_AXIS',row)
            if len({key for _,key in columns})!=len(columns): doc.issue('DUPLICATE_AXIS',row)
            for column,_ in columns:
                if doc.native_types.get((row,column))=='n': doc.issue('NUMERIC_AXIS',row)
            band={'header':row,'columns':columns,'values':{},'rows':{}}; seen_axis=True; continue
        if label=='Report total':
            doc.fates[row-1]='control'; finish(row,'report-total')
            if len(raw)!=2 or not seen_axis or controls: doc.issue('REPORT_TOTAL_BOUNDARY',row)
            else: controls.append((row,raw[1]))
            continue
        if raw==['End report']:
            doc.fates[row-1]='report-end'; finish(row,'report-end'); ended=True
            continue
        if band is None or label not in FIELDS[0] or controls:
            doc.issue('ORPHAN_OR_UNKNOWN_ROW',row); continue
        doc.fates[row-1]='matrix-field'
        named={column for column,_ in band['columns']}
        for column,value in enumerate(cells[1:],2):
            if value!='' and column not in named: doc.issue('UNNAMED_POPULATED_COLUMN',row,str(column))
        if label in band['values']: doc.issue('DUPLICATE_MATRIX_ROLE',row,label); continue
        band['values'][label],band['rows'][label]=cells,row
    if band is not None:
        doc.issue('MISSING_REPORT_END',len(doc.rows))
        # No fabricated boundary citation: unfinished band is source evidence only.
    if not ended: doc.issue('MISSING_REPORT_END',len(doc.rows))
    for row,raw in controls:
        try:
            if money(raw)!=sum(money(r['raw'].get('Posted value')) for r in doc.records): doc.issue('CONTROL_MISMATCH',row)
        except ValueError: doc.issue('CONTROL_UNPROVEN',row)


def money(raw, precision=3):
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
    if scope.get('Currency') != 'KWD' or scope.get('Posting status') != 'posted' or scope.get('Currency basis') != 'functional': register.issue('SCOPE_POLICY', 1)
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
    mapped_keys = {(a['account'], a['dimensions']) for a in allocations}
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
    return dict(id=folder.name, layout=layout, financial=financial, review='needs-review', totals=totals, comparisons=comparisons, missing=missing, issues=issues, sources=[d.report() for d in docs])


# Hand-fixed second story; no generator/product imports.
TRUTH = {
 ('0014','plant=P1;batch=K1'):(125,123456,'KG','2','VAL-0014-P1-K1','MAP-MX-A','POL-MX-A','INV-RM','plant=P1;branch=10'),
 ('0014','plant=P2;batch=K2'):(250,210111,'KG','2','VAL-0014-P2-K2','MAP-MX-B','POL-MX-B','INV-RM','plant=P2;branch=20'),
 ('014','plant=P1;batch=E1'):(3,333567,'EA','0','VAL-014-P1-E1','MAP-MX-C','POL-MX-C','INV-PACK','plant=P1;branch=10'),
 ('14','plant=P2;batch=Z0'):(0,0,'EA','0','VAL-14-P2-Z0','MAP-MX-D','POL-MX-D','INV-PACK','plant=P2;branch=20'),
}
EXPECTED_STATES={**{f'INV1C-P{n:02}':'ready' for n in range(1,7)},'INV1C-N01':'difference','INV1C-N02':'missing',**{f'INV1C-N{n:02}':'source-error' for n in range(3,9)}}


def verify_citations(observation):
    for source in observation['sources']:
        rows=source['inventory']
        for record in source['records']:
            assert set(record['raw'])==set(record['citations'])==set(FIELDS[source['role']]),'CITATION_FIELD_SET'
            assert set(record['scope'])==set(record['scopeCitations'])==set(SCOPE),'CITATION_SCOPE_SET'
            if source['role']==0:
                assert set(record.get('roleCitations',{}))==set(FIELDS[0]),'CITATION_ROLE_SET'
                assert all(key in record for key in ['column','bandStart','bandEnd','axisKey','axisCitation','fieldHeader','boundary','sourceRow']),'MATRIX_OWNERSHIP_SET'
            for field,cite in record['citations'].items():
                assert cite['source']==source['role'] and 1<=cite['row']<=len(rows),'CITATION_SOURCE_ROW'
                cells=rows[cite['row']-1]['cells']
                assert 1<=cite['column']<=len(cells) and cells[cite['column']-1]['raw']==cite['raw']==record['raw'][field],'CITATION_VALUE_LITERAL'
                if source['role']==0:
                    assert cite['column']==record['column'] and record['bandStart']<cite['row']<record['bandEnd'],'CITATION_COLUMN_BAND'
                    role=record['roleCitations'][field]
                    assert role==cells[0] and role['raw']==field and role['column']==1,'CITATION_ROLE_LABEL'
                else: assert rows[0]['cells'][cite['column']-1]['raw']==field,'CITATION_FLAT_HEADER'
            if source['role']==0:
                assert set(record['roleCitations'])==set(FIELDS[0]),'CITATION_ROLE_SET'
                assert record['sourceRow']==record['citations']['Item ID']['row'],'ANCHOR_ITEM_ROW'
                axis=record['axisCitation']; header=record['fieldHeader']; boundary=record['boundary']
                assert axis==rows[record['bandStart']-1]['cells'][record['column']-1] and axis['raw']==record['axisKey'],'AXIS_OWNERSHIP'
                assert header==rows[record['bandStart']-1]['cells'][0] and header['raw']=='Field','FIELD_HEADER_OWNERSHIP'
                assert boundary==rows[record['bandEnd']-1]['cells'][0] and boundary['raw'] in ['Field','Report total','End report'],'BOUNDARY_OWNERSHIP'
            for label,cite in record['scopeCitations'].items():
                assert cite['source']==source['role'] and rows[cite['row']-1]['cells'][cite['column']-1]['raw']==cite['raw']==record['scope'][label],'SCOPE_CITATION'
                if source['role']==0: assert cite['column']==3 and cite['row']<record['bandStart'] and rows[cite['row']-1]['cells'][1]['raw']==label,'SCOPE_PREFIX_OWNERSHIP'


def verify_truth(observation):
    identity=observation['id']; assert observation['financial']==EXPECTED_STATES[identity],'EXPECTED_FINANCIAL'
    verify_citations(observation)
    if identity.startswith('INV1C-P') or identity=='INV1C-N01':
        assert observation['totals']=={'registerMinor':667134,'glMinor':667134},'TOTAL_TRUTH'
        sources=observation['sources']; assert [len(s['records']) for s in sources]==[4,4,4,4],'LOGICAL_RECORDS'
        register=sources[0]['records']; assert {(r['raw']['Item ID'],r['raw']['Item dimensions']) for r in register}==set(TRUTH),'ITEM_KEYS'
        for record in register:
            raw=record['raw']; key=(raw['Item ID'],raw['Item dimensions']); truth=TRUTH[key]
            amount=truth[1]
            if identity=='INV1C-N01' and key==('0014','plant=P1;batch=K1'): amount=210111
            if identity=='INV1C-N01' and key==('0014','plant=P2;batch=K2'): amount=123456
            assert (record['quantityUnits'],record['postedValueMinor'],raw['Unit'],raw['Quantity precision'],raw['Valuation reference'])==(truth[0],amount,truth[2],truth[3],truth[4]),'ITEM_QUANTITY_VALUE_TRUTH'
            mapping=[r['raw'] for r in sources[1]['records'] if (r['raw']['Item ID'],r['raw']['Item dimensions'])==key]
            assert len(mapping)==1 and [mapping[0][f] for f in ['Mapping ID','Evidence ID','GL account','GL dimensions']]==list(truth[5:9]),'MAPPING_TRUTH'
            policy=[r['raw'] for r in sources[2]['records'] if r['raw']['Evidence ID']==truth[6]]
            assert len(policy)==1 and [policy[0][f] for f in ['Item ID','Item dimensions','Unit','Quantity precision','Valuation reference','GL account','GL dimensions']]==[key[0],key[1],truth[2],truth[3],truth[4],truth[7],truth[8]],'POLICY_TRUTH'
        differences=[c['differenceMinor'] for c in observation['comparisons']]
        assert differences==([86655,-86655,0,0] if identity=='INV1C-N01' else [0,0,0,0]),'DIMENSION_DIFFERENCES'
        for comparison in observation['comparisons']:
            expected={key for key,truth in TRUTH.items() if (truth[7],truth[8])==(comparison['account'],comparison['dimensions'])}
            assert set(map(tuple,comparison['members']))==expected,'EXACT_GL_MEMBERSHIP'
    elif identity=='INV1C-N02':
        assert observation['totals']=={'registerMinor':333567,'glMinor':667134},'MISSING_SUPPORTED_TOTAL'
        assert sum(r['postedValueMinor'] for r in observation['sources'][0]['records'])==667134,'ALL_PROVIDED_VALUES_RETAINED'
        assert observation['missing'].count('POLICY_BINDING')==2,'POLICY_CONTRADICTION'
    else:
        assert observation['totals'] is None and observation['issues'],'SOURCE_ERROR_MONEY'
        assert all(c[field] is None for c in observation['comparisons'] for field in ['registerMinor','debitMinor','creditMinor','differenceMinor']),'SOURCE_ERROR_COMPARISON'


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--root',type=Path,required=True); root=parser.parse_args().root
    cases=[check_case(p) for p in sorted((root/'cases').iterdir()) if p.is_dir()]
    for case in cases: verify_truth(case)
    print(json.dumps({'schema':'inv1c-independent-observations/1','cases':cases},indent=2)+'\n')
