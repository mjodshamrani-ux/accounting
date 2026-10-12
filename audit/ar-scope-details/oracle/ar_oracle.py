#!/usr/bin/env python3
"""Independent, preparation-only AR source oracle. Python standard library only.

Reads raw CSV / bounded raw OOXML; never imports product or fixture truth.
This is a finite acceptance oracle, not a product reader or native-acceptance claim.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import posixpath
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

VERSION = 'oracle-output-1'
MAX_BYTES = 8 * 1024 * 1024
MAX_ROWS = 20030
MAX_DETAILS = 20000
MAX_MINOR = 10 ** 14
MAX_ZIP_ENTRIES = 1000
MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024
MAX_SHEETS = 40
MAX_COLUMNS = 100
MAX_WORKBOOK_AREA = 1000000
PRECISION = {**{c: 2 for c in ('SAR', 'USD', 'EUR', 'GBP', 'AED', 'QAR', 'EGP')},
             **{c: 3 for c in ('KWD', 'BHD', 'OMR')}, 'JPY': 0}
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
REQUIRED_SCOPE = ['Scope ID', 'Source role', 'Perspective', 'Amount basis', 'Entity',
                  'Ledger', 'Customer', 'Account', 'Currency', 'Period start', 'Period end', 'Scope reference']
REQUIRED_COLUMNS = ['Parent scope ID', 'Posting ID', 'Document type', 'Own document number',
                    'Posting date', 'Original signed amount']
OPTIONAL_COLUMNS = ['Related invoice', 'Open balance', 'Description']
TYPES = {'invoice', 'credit-note', 'receipt'}
TYPE_ALIASES = {'invoice': 'invoice', 'credit-note': 'credit-note', 'receipt': 'receipt',
                'فاتورة': 'invoice', 'إشعار دائن': 'credit-note', 'قبض': 'receipt'}
OLD_ALIASES = {
    'Posting ID': ['Posting ID', 'Unique posting ID', 'معرف الحركة الفريد'],
    'Document type': ['Document type', 'نوع المستند'],
    'Own document number': ['Own document number', 'رقم المستند الأصلي'],
    'Posting date': ['Posting date', 'تاريخ الترحيل'],
    'Original signed amount': ['Original signed amount', 'مبلغ الحركة الأصلي الموقع'],
    'Entity': ['Entity', 'الكيان'], 'Ledger': ['Ledger', 'الدفتر'],
    'Customer': ['Customer', 'Customer ID', 'معرف العميل'],
    'Account': ['Account', 'الحساب'], 'Currency': ['Currency', 'العملة'],
    'Related invoice': ['Related invoice', 'الفاتورة المرتبطة'],
    'Description': ['Description'], 'Open balance': ['Open balance']}
EXCEL_ERRORS = {'#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#GETTING_DATA', '#SPILL!', '#CALC!'}
TRANSLATION = str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫−', '01234567890123456789.-')


def utf16len(value):
    return len(value.encode('utf-16-le', errors='surrogatepass')) // 2


def issue(code, row=None, column=None, detail=''):
    return {'code': code, 'row': row, 'column': column, 'detail': detail}


def identity(raw):
    value = raw.strip()
    if not value:
        raise ValueError('missing-identity')
    if utf16len(value) > 200 or any(unicodedata.category(c) in ('Cc', 'Cf') for c in value):
        raise ValueError('invalid-identity')
    if value[0] in '=+@-' or value in EXCEL_ERRORS:
        raise ValueError('invalid-identity')
    return value


def iso_date(raw):
    value = raw.strip()
    if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        raise ValueError('invalid-date')
    try:
        dt.date.fromisoformat(value)
    except ValueError:
        raise ValueError('invalid-date') from None
    return value


def money(raw, currency):
    if currency not in PRECISION:
        raise ValueError('unsupported-oracle-currency')
    value = raw.strip().translate(TRANSLATION)
    for mark in ('\u200e', '\u200f', '\u061c'):
        value = value.replace(mark, '')
    if not re.fullmatch(r'[+-]?[0-9]+(?:\.[0-9]+)?', value):
        raise ValueError('invalid-amount')
    sign = -1 if value.startswith('-') else 1
    value = value.lstrip('+-')
    whole, _, fraction = value.partition('.')
    precision = PRECISION[currency]
    if len(fraction) > precision:
        raise ValueError('amount-precision')
    result = sign * (int(whole) * (10 ** precision) + int((fraction + '0' * precision)[:precision] or '0'))
    if abs(result) > MAX_MINOR:
        raise ValueError('amount-bound')
    if result == 0:
        raise ValueError('zero-amount')
    return result


def nonempty(cells):
    return any(c != '' for c in cells)


def col_number(ref):
    match = re.fullmatch(r'([A-Z]+)([1-9][0-9]*)', ref or '')
    if not match:
        raise ValueError('invalid-cell-reference')
    number = 0
    for c in match[1]:
        number = number * 26 + ord(c) - 64
    return number, int(match[2])


def col_letters(number):
    result = ''
    while number:
        number, rem = divmod(number - 1, 26)
        result = chr(65 + rem) + result
    return result


def xml_bytes(data):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('unsupported-xml-declaration')
    return ET.fromstring(data)


def concealed_extent(raw, error_code):
    """Exact geometry parsing only; never a financial amount or minor-unit value."""
    if raw is None:
        return False
    try:
        value = Decimal(raw)
        if not value.is_finite():
            raise InvalidOperation()
        return value <= 0
    except InvalidOperation:
        raise ValueError(error_code) from None


def read_csv(data):
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        raise ValueError('invalid-utf8') from None
    reader = csv.reader(io.StringIO(text, newline=''), strict=True)
    rows = []
    previous = 0
    try:
        for ordinal, cells in enumerate(reader, 1):
            if len(cells) > MAX_COLUMNS:
                raise ValueError('reader-column-bound')
            start = previous + 1
            previous = reader.line_num
            errors = [issue('cell-length', ordinal, n + 1) for n, cell in enumerate(cells) if utf16len(cell) > 4096]
            rows.append({'physicalRow': ordinal, 'lineSpan': [start, previous], 'rawCells': cells,
                         'cellMeta': {}, 'errors': errors, 'classification': 'unclassified'})
            if len(rows) > MAX_ROWS:
                raise ValueError('reader-row-bound')
    except csv.Error:
        raise ValueError('invalid-csv') from None
    return 'CSV', rows, []


def read_xlsx(data, selected):
    if selected is None:
        raise ValueError('sheet-selection-required')
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError('invalid-xlsx') from None
    infos = archive.infolist()
    names = [i.filename for i in infos]
    if len(set(names)) != len(names) or len(names) > MAX_ZIP_ENTRIES or sum(i.file_size for i in infos) > MAX_UNCOMPRESSED_BYTES:
        raise ValueError('xlsx-package-bound')
    def get(name):
        if name not in names:
            raise ValueError('missing-xlsx-part')
        return xml_bytes(archive.read(name))
    book = get('xl/workbook.xml')
    relations = get('xl/_rels/workbook.xml.rels')
    relation_map = {r.get('Id'): r for r in relations}
    sheets = book.findall('m:sheets/m:sheet', NS)
    if len(sheets) > MAX_SHEETS:
        raise ValueError('worksheet-count-bound')
    chosen = [s for index, s in enumerate(sheets) if (isinstance(selected, str) and s.get('name') == selected)
              or (isinstance(selected, int) and not isinstance(selected, bool) and index == selected)]
    if len(chosen) != 1:
        raise ValueError('invalid-sheet-selection')
    sheet = chosen[0]
    def sheet_tree(entry):
        rel = relation_map.get(entry.get('{%s}id' % NS['r']))
        if rel is None or rel.get('TargetMode') == 'External':
            raise ValueError('invalid-sheet-relationship')
        target = rel.get('Target', '')
        part = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
        if not part.startswith('xl/') or '..' in part.split('/'):
            raise ValueError('invalid-sheet-relationship')
        return get(part)
    trees, workbook_area = {}, 0
    for entry in sheets:
        entry_tree = sheet_tree(entry)
        row_max, col_max = 0, 0
        for row in entry_tree.findall('m:sheetData/m:row', NS):
            try:
                rownum = int(row.get('r'))
                if rownum < 1:
                    raise ValueError()
            except (TypeError, ValueError):
                raise ValueError('invalid-row-reference') from None
            row_max = max(row_max, rownum)
            for cell in row.findall('m:c', NS):
                col, cellrow = col_number(cell.get('r'))
                row_max, col_max = max(row_max, cellrow), max(col_max, col)
        if col_max > MAX_COLUMNS:
            raise ValueError('reader-column-bound')
        if entry is sheet and row_max > MAX_ROWS:
            raise ValueError('reader-row-bound')
        workbook_area += row_max * col_max
        if workbook_area > MAX_WORKBOOK_AREA:
            raise ValueError('workbook-cell-area-bound')
        trees[id(entry)] = entry_tree
    tree = trees[id(sheet)]
    common = []
    if sheet.get('state', 'visible') != 'visible':
        common.append(issue('hidden-sheet'))
    if tree.find('m:mergeCells', NS) is not None:
        common.append(issue('merged-cells'))
    hidden_ranges = []
    for col in tree.findall('m:cols/m:col', NS):
        if col.get('hidden') in ('1', 'true') or concealed_extent(col.get('width'), 'invalid-column-width'):
            try:
                hidden_ranges.append((int(col.get('min')), int(col.get('max'))))
            except (TypeError, ValueError):
                raise ValueError('invalid-column-range') from None
            common.append(issue('hidden-column', column=col.get('min')))
    strings = []
    if 'xl/sharedStrings.xml' in names:
        for si in get('xl/sharedStrings.xml').findall('m:si', NS):
            strings.append(''.join(t.text or '' for t in si.findall('.//m:t', NS)))
    styles = [0]
    formats = {0: 'General', 2: '0.00'}
    if 'xl/styles.xml' in names:
        style = get('xl/styles.xml')
        for fmt in style.findall('m:numFmts/m:numFmt', NS):
            formats[int(fmt.get('numFmtId'))] = fmt.get('formatCode', '')
        styles = [int(x.get('numFmtId', '0')) for x in style.findall('m:cellXfs/m:xf', NS)] or [0]
    rows, seen_rows = [], set()
    for element in tree.findall('m:sheetData/m:row', NS):
        try:
            number = int(element.get('r'))
        except (TypeError, ValueError):
            raise ValueError('invalid-row-reference') from None
        if number < 1 or number > MAX_ROWS or number in seen_rows:
            raise ValueError('invalid-row-reference')
        seen_rows.add(number)
        errors, cells, metadata, seen_cols = [], [], {}, set()
        if element.get('hidden') in ('1', 'true') or concealed_extent(element.get('ht'), 'invalid-row-height'):
            errors.append(issue('hidden-row', number))
        for c in element.findall('m:c', NS):
            col, cellrow = col_number(c.get('r'))
            if cellrow != number or col in seen_cols or col > MAX_COLUMNS:
                raise ValueError('invalid-cell-reference')
            seen_cols.add(col)
            while len(cells) < col:
                cells.append('')
            kind = c.get('t', 'n')
            v = c.find('m:v', NS)
            raw = '' if v is None else (v.text or '')
            if kind == 'inlineStr':
                raw = ''.join(t.text or '' for t in c.findall('m:is//m:t', NS))
            elif kind == 's':
                try:
                    index = int(raw)
                    if index < 0:
                        raise ValueError()
                    raw = strings[index]
                except (ValueError, IndexError):
                    errors.append(issue('invalid-shared-string', number, col))
            elif kind not in ('n', 'str', 'e'):
                errors.append(issue('unsupported-cell-type', number, col, kind))
            if c.find('m:f', NS) is not None:
                errors.append(issue('formula-cell', number, col, c.find('m:f', NS).text or ''))
            if kind == 'e':
                errors.append(issue('error-cell', number, col, raw))
            if any(lo <= col <= hi for lo, hi in hidden_ranges):
                errors.append(issue('hidden-cell', number, col))
            if utf16len(raw) > 4096:
                errors.append(issue('cell-length', number, col))
            try:
                styleid = int(c.get('s', '0'))
                if styleid < 0:
                    raise ValueError()
                fmt = formats.get(styles[styleid], 'unsupported')
            except (ValueError, IndexError):
                errors.append(issue('invalid-cell-style', number, col))
                fmt = 'unsupported'
            if kind == 'n' and raw:
                if not re.fullmatch(r'[+-]?[0-9]+(?:\.[0-9]+)?', raw):
                    errors.append(issue('unsupported-numeric-lexeme', number, col, raw))
            if raw and fmt not in ('General', '0.00'):
                errors.append(issue('unsupported-number-format', number, col, fmt))
            cells[col - 1] = raw
            metadata[str(col)] = {'reference': c.get('r'), 'type': kind, 'numberFormat': fmt,
                                  'formula': None if c.find('m:f', NS) is None else (c.find('m:f', NS).text or '')}
        rows.append({'physicalRow': number, 'physicalEndRow': number, 'rawCells': cells,
                     'cellMeta': metadata, 'errors': errors, 'classification': 'unclassified'})
    if [r['physicalRow'] for r in rows] != sorted(seen_rows):
        raise ValueError('unordered-xlsx-rows')
    # Absent rows are genuine physical blanks and remain visible in the inventory.
    byrow = {r['physicalRow']: r for r in rows}
    rows = [byrow.get(n, {'physicalRow': n, 'physicalEndRow': n, 'rawCells': [], 'cellMeta': {},
                         'errors': [], 'classification': 'unclassified'}) for n in range(1, max(seen_rows, default=0) + 1)]
    return sheet.get('name'), rows, common


def parse_source(path, family, side, scope, selected=None, reading_confirmed=False):
    source = {'side': side, 'file': path.name, 'family': family, 'sha256': None, 'sheet': None,
              'status': 'source-error', 'errors': [], 'inventory': [], 'records': [], 'scopeHeader': None,
              'totalMinor': None, 'structuralError': False, 'errorInventoryRefs': []}
    def structural(code, row=None, column=None, detail=''):
        source['structuralError'] = True
        source['errors'].append(issue(code, row, column, detail))
    try:
        data = path.read_bytes()
        source['sha256'] = hashlib.sha256(data).hexdigest()
        if len(data) > MAX_BYTES:
            raise ValueError('source-byte-bound')
        if path.suffix.lower() == '.csv':
            sheet, rows, errors = read_csv(data)
        elif path.suffix.lower() == '.xlsx':
            sheet, rows, errors = read_xlsx(data, selected)
        else:
            raise ValueError('unsupported-source-format')
    except (ValueError, ET.ParseError, OSError, RuntimeError) as error:
        structural(str(error) if isinstance(error, ValueError) else 'source-read-error', detail=type(error).__name__)
        return source
    source['sheet'], source['inventory'] = sheet, rows
    for row in rows:
        row['inventoryId'] = '%s:%s:%s:%s' % (side, source['sha256'], sheet, row['physicalRow'])
    for error in errors:
        structural(error['code'], error['row'], error['column'], error['detail'])
    if reading_confirmed is not True:
        structural('reading-unconfirmed')
    scope_fields = ('entity', 'ledger', 'customer', 'account', 'currency', 'start', 'end')
    if not isinstance(scope, dict):
        structural('invalid-scope-shape', detail='scope must be an object')
        scope = {}
    malformed_fields = [key for key in scope_fields if not isinstance(scope.get(key), str)]
    if malformed_fields:
        structural('invalid-scope-shape', detail='non-string or missing fields: ' + ','.join(malformed_fields))
        # Keep raw-source parsing/provenance bounded while prohibiting financial
        # authority from malformed external scope. No input value is coerced.
        scope = {**scope, **{key: '' for key in malformed_fields}}
    if scope.get('confirmed') is not True:
        structural('scope-unconfirmed')
    try:
        start, end = iso_date(scope.get('start', '')), iso_date(scope.get('end', ''))
        if start > end:
            raise ValueError('invalid-period')
        for key in ('entity', 'ledger', 'customer', 'account', 'currency'):
            identity(scope.get(key, ''))
        if scope.get('currency') not in PRECISION:
            raise ValueError('unsupported-oracle-currency')
    except ValueError as error:
        structural(str(error))
        start, end = '', ''
    if family == 'ar-scope-details-1':
        parse_scope_details(source, scope, start, end, structural)
    elif family == 'ar-limited-1':
        parse_canonical(source, scope, start, end, structural)
    else:
        structural('unsupported-family')
    if source['structuralError']:
        source['records'] = []
        source['totalMinor'] = None
    else:
        source['totalMinor'] = sum(record['amountMinor'] for record in source['records'])
        if abs(source['totalMinor']) > MAX_MINOR:
            structural('total-bound')
            source['totalMinor'] = None
        if not source['errors']:
            source['status'] = 'valid'
    error_rows = {error['row'] for error in source['errors'] if error['row'] is not None}
    source['errorInventoryRefs'] = [row['inventoryId'] for row in rows
                                    if row['errors'] or row['physicalRow'] in error_rows
                                    or row['classification'] in ('invalid-movement', 'structural-error')]
    return source


def parse_scope_details(source, scope, start, end, structural):
    rows = source['inventory']
    state, header, columns, headerrow, detail_count = 'first', {}, {}, None, 0
    scope_id = None
    for row in rows:
        cells, number = row['rawCells'], row['physicalRow']
        real_blank = not nonempty(cells) and not row['errors']
        if real_blank:
            row['classification'] = 'blank'
            if state == 'first':
                structural('first-record-required', number)
            continue
        token = cells[0] if cells else ''
        if state == 'first':
            row['classification'] = 'scope-marker'
            if cells[:2] != ['AR_SCOPE', '1'] or nonempty(cells[2:]):
                structural('invalid-scope-marker', number)
            state = 'header'
        elif state == 'header':
            if token == 'DETAILS':
                row['classification'] = 'details-marker'
                if nonempty(cells[1:]):
                    structural('invalid-details-marker', number)
                state = 'columns'
            else:
                row['classification'] = 'scope-header'
                if token not in REQUIRED_SCOPE:
                    structural('unknown-scope-key', number, 1, token)
                elif token in header:
                    structural('duplicate-scope-key', number, 1, token)
                else:
                    header[token] = {'raw': cells[1] if len(cells) > 1 else '', 'row': number, 'column': 2}
                if nonempty(cells[2:]):
                    structural('extra-scope-value', number)
        elif state == 'columns':
            row['classification'] = 'detail-columns'
            headerrow = number
            for index, name in enumerate(cells):
                if name not in REQUIRED_COLUMNS + OPTIONAL_COLUMNS:
                    structural('unknown-detail-column', number, index + 1, name)
                elif name in columns:
                    structural('duplicate-detail-column', number, index + 1, name)
                else:
                    columns[name] = index
            for required in REQUIRED_COLUMNS:
                if required not in columns:
                    structural('missing-detail-column', number, detail=required)
            state = 'details'
        elif state == 'details':
            if token == 'END_DETAILS':
                row['classification'] = 'end-marker'
                if nonempty(cells[1:]):
                    structural('invalid-end-marker', number)
                state = 'ended'
            elif token in ('DETAILS', 'AR_SCOPE') or (token in REQUIRED_SCOPE and len(cells) <= 2):
                row['classification'] = 'structural-error'
                structural('repeated-or-late-header', number)
            else:
                row['classification'] = 'movement'
                detail_count += 1
                if detail_count > MAX_DETAILS:
                    structural('detail-row-bound', number)
        else:
            row['classification'] = 'structural-error'
            structural('data-after-end', number)
    if state != 'ended':
        structural('missing-end-details')
    for key in REQUIRED_SCOPE:
        if key not in header:
            structural('missing-scope-key', detail=key)
    for key, cell in header.items():
        try:
            if key in ('Period start', 'Period end'):
                iso_date(cell['raw'])
            else:
                identity(cell['raw'])
        except ValueError as error:
            structural(str(error), cell['row'], 2, key)
    if 'Scope ID' in header:
        scope_id = header['Scope ID']['raw'].strip()
    expected = {'Source role': 'company-ar-ledger' if source['side'] == 'left' else 'company-issued-customer-statement',
                'Perspective': 'seller-receivable', 'Amount basis': 'original-movement',
                'Entity': scope.get('entity'), 'Ledger': scope.get('ledger'), 'Customer': scope.get('customer'),
                'Account': scope.get('account'), 'Currency': scope.get('currency'), 'Period start': start, 'Period end': end}
    for key, value in expected.items():
        if key in header and header[key]['raw'].strip() != value:
            structural('scope-header-mismatch', header[key]['row'], 2, key)
    source['scopeHeader'] = {'scopeId': scope_id, 'fields': header, 'detailHeaderRow': headerrow}
    for row in rows:
        if row['classification'] == 'movement':
            record = parse_movement(source, row, columns, scope, start, end, scope_id, header)
            if record:
                source['records'].append(record)
        else:
            for error in row['errors']:
                structural(error['code'], error['row'], error['column'], error['detail'])
    validate_posting_uniqueness(source)


def parse_movement(source, row, columns, scope, start, end, scope_id=None, header=None, allow_extra=False):
    cells, number, errors = row['rawCells'], row['physicalRow'], list(row['errors'])
    def get(name):
        index = columns.get(name)
        return cells[index] if index is not None and index < len(cells) else ''
    def check(name, func):
        try:
            return func(get(name))
        except ValueError as error:
            errors.append(issue(str(error), number, columns.get(name, -1) + 1, name))
            return None
    if not allow_extra and len(cells) > len(columns) and nonempty(cells[len(columns):]):
        errors.append(issue('extra-detail-value', number))
    posting = check('Posting ID', identity)
    own = check('Own document number', identity)
    dtype = TYPE_ALIASES.get(get('Document type').strip().lower(), get('Document type').strip())
    if dtype not in TYPES:
        errors.append(issue('invalid-document-type', number, columns.get('Document type', -1) + 1, dtype))
    date = check('Posting date', iso_date)
    amount = check('Original signed amount', lambda raw: money(raw, scope.get('currency')))
    if date and not start <= date <= end:
        errors.append(issue('date-outside-period', number, columns.get('Posting date', -1) + 1))
    if amount is not None and dtype in TYPES and (amount > 0) != (dtype == 'invoice'):
        errors.append(issue('amount-sign', number, columns.get('Original signed amount', -1) + 1))
    related = check('Related invoice', identity) if get('Related invoice').strip() else ''
    parent, parent_cell, inherited = None, None, []
    if header is not None:
        parent = check('Parent scope ID', identity)
        parent_cell = {'row': number, 'column': columns.get('Parent scope ID', -1) + 1, 'raw': get('Parent scope ID')}
        if parent is not None and parent != scope_id:
            errors.append(issue('parent-scope-mismatch', number, parent_cell['column']))
        for name in ('Entity', 'Ledger', 'Customer', 'Account', 'Currency'):
            if name in header:
                cell = header[name]
                inherited.append({'field': name, 'sourceSha256': source['sha256'], 'sheet': source['sheet'],
                                  'scopeId': scope_id, 'headerRow': cell['row'], 'headerValueColumn': cell['column'],
                                  'raw': cell['raw'], 'detailRow': number, 'parentCell': parent_cell})
    else:
        for name in ('Entity', 'Ledger', 'Customer', 'Account', 'Currency'):
            val = check(name, identity)
            if val is not None and val != scope.get(name.lower()):
                errors.append(issue('scope-row-mismatch', number, columns.get(name, -1) + 1, name))
    # Raw text in these columns is descriptive; no arithmetic or identity normalization.
    for name in ('Description', 'Open balance'):
        if utf16len(get(name)) > 4096 and not any(e['code'] == 'cell-length' and e['column'] == columns.get(name, -1) + 1 for e in errors):
            errors.append(issue('cell-length', number, columns.get(name, -1) + 1, name))
    row['errors'] = errors
    if errors:
        row['classification'] = 'invalid-movement'
        source['errors'].extend(errors)
        return None
    return {'memberId': '%s:%s:%s:%s' % (source['side'], source['sha256'], source['sheet'], number),
            'physicalRow': number, 'postingId': posting, 'documentType': dtype, 'ownDocumentNumber': own,
            'postingDate': date, 'originalRaw': get('Original signed amount'), 'amountMinor': amount,
            'relatedInvoiceRaw': get('Related invoice'), 'relatedInvoice': related,
            'openBalanceRaw': get('Open balance') if 'Open balance' in columns else None,
            'openBalanceRole': 'descriptive-unverified', 'descriptionRaw': get('Description'),
            'parentScopeId': parent, 'parentCell': parent_cell, 'inheritedSourceCells': inherited}


def validate_posting_uniqueness(source):
    # Include invalid rows too: malformed late competitors cannot be silently dropped.
    postings = defaultdict(list)
    columns = None
    for row in source['inventory']:
        if row['classification'] == 'detail-columns':
            columns = {v: i for i, v in enumerate(row['rawCells'])}
            if source['family'] == 'ar-limited-1':
                for index, value in enumerate(row['rawCells']):
                    if value.strip().lower() in [a.lower() for a in OLD_ALIASES['Posting ID']]:
                        columns['Posting ID'] = index
        elif row['classification'] in ('movement', 'invalid-movement') and columns and 'Posting ID' in columns:
            index = columns['Posting ID']
            raw = row['rawCells'][index] if index < len(row['rawCells']) else ''
            try:
                postings[identity(raw)].append(row)
            except ValueError:
                pass
    bad_rows = set()
    for posting, members in postings.items():
        if len(members) > 1:
            for row in members:
                error = issue('duplicate-posting-id', row['physicalRow'], columns['Posting ID'] + 1, posting)
                row['errors'].append(error)
                row['classification'] = 'invalid-movement'
                source['errors'].append(error)
                bad_rows.add(row['physicalRow'])
    source['records'] = [record for record in source['records'] if record['physicalRow'] not in bad_rows]


def parse_canonical(source, scope, start, end, structural):
    """Explicit old canonical shape only; alias/inferred-reading support is out of scope."""
    columns, detail_count = None, 0
    required = ['Posting ID', 'Document type', 'Own document number', 'Posting date', 'Original signed amount',
                'Entity', 'Ledger', 'Customer', 'Account', 'Currency']
    for row in source['inventory']:
        if not nonempty(row['rawCells']) and not row['errors']:
            row['classification'] = 'blank'
            continue
        if columns is None:
            row['classification'] = 'detail-columns'
            columns = {}
            for index, rawname in enumerate(row['rawCells']):
                matches = [name for name, aliases in OLD_ALIASES.items()
                           if rawname.strip().lower() in [a.lower() for a in aliases]]
                if rawname.strip().lower() in ('document number', 'رقم المستند'):
                    structural('own-document-role-unconfirmed', row['physicalRow'], index + 1, rawname)
                elif matches:
                    name = matches[0]
                    if name in columns:
                        structural('duplicate-detail-column', row['physicalRow'], index + 1, name)
                    else:
                        columns[name] = index
            for name in required:
                if name not in columns:
                    structural('missing-detail-column', row['physicalRow'], detail=name)
            for error in row['errors']:
                structural(error['code'], error['row'], error['column'], error['detail'])
        else:
            row['classification'] = 'movement'
            detail_count += 1
            if detail_count > MAX_DETAILS:
                structural('detail-row-bound', row['physicalRow'])
            # Old sources permit unrelated extra columns; keep full raw inventory.
            record = parse_movement(source, row, columns, scope, start, end, allow_extra=True)
            if record:
                source['records'].append(record)
    if columns is None:
        structural('missing-detail-columns')
    validate_posting_uniqueness(source)


def reconcile(bundle, base):
    files = bundle.get('files', [])
    families = bundle.get('families', [])
    if len(files) != 2 or len(families) != 2:
        raise ValueError('bundle-requires-two-sources')
    scope = bundle.get('scope', {})
    selections = bundle.get('sheets', [None, None])
    readings = bundle.get('readingConfirmed', [False, False])
    selected_amounts = bundle.get('selectedAmountHeaders', ['Original signed amount', 'Original signed amount'])
    if len(selections) != 2 or len(readings) != 2 or len(selected_amounts) != 2:
        raise ValueError('bundle-options-require-two-sources')
    sources = [parse_source(base / files[i], families[i], ('left', 'right')[i], scope, selections[i], readings[i] is True)
               for i in range(2)]
    for source, selected in zip(sources, selected_amounts):
        if selected != 'Original signed amount':
            source['errors'].append(issue('original-amount-role-required', detail=str(selected)))
            source['status'] = 'source-error'
    if sources[0]['sha256'] is not None and sources[0]['sha256'] == sources[1]['sha256']:
        for source in sources:
            source['errors'].append(issue('identical-source-hashes'))
            source['status'] = 'source-error'
    result = {'schemaVersion': VERSION, 'status': 'review', 'matchedPairCount': 0,
              'totalsMinor': [s['totalMinor'] for s in sources], 'totalBasis': 'original-movement',
              'validRowCounts': [len(s['records']) for s in sources], 'requiredIssueCategories': [],
              'sources': sources, 'pairs': [], 'cases': [], 'receiptAllocations': [],
              'financialCompletenessAsserted': False}
    def case(reason, left=(), right=()):
        result['cases'].append({'reason': reason, 'leftMembers': [r['memberId'] for r in left],
                                'rightMembers': [r['memberId'] for r in right]})
    if any(s['errors'] for s in sources):
        result['status'] = 'source-error'
        result['totalBasis'] = 'diagnostic-valid-records'
        case('source-errors', sources[0]['records'], sources[1]['records'])
    else:
        indexes = []
        for source in sources:
            index = defaultdict(list)
            for record in source['records']:
                index[(record['documentType'], record['ownDocumentNumber'])].append(record)
            indexes.append(index)
        for key in sorted(set(indexes[0]) | set(indexes[1])):
            left, right = indexes[0].get(key, []), indexes[1].get(key, [])
            if len(left) > 1 or len(right) > 1:
                case('duplicate-document', left, right)
            elif not left or not right:
                case('missing-counterpart', left, right)
            elif left[0]['amountMinor'] != right[0]['amountMinor']:
                case('amount-difference', left, right)
            elif left[0]['postingDate'] != right[0]['postingDate']:
                case('date-difference', left, right)
            elif left[0]['relatedInvoice'] and right[0]['relatedInvoice'] and left[0]['relatedInvoice'] != right[0]['relatedInvoice']:
                case('related-conflict', left, right)
            else:
                l, r = left[0], right[0]
                result['pairs'].append({'leftMember': l['memberId'], 'rightMember': r['memberId'],
                                        'type': key[0], 'ownDocumentNumber': key[1], 'date': l['postingDate'],
                                        'amountMinor': l['amountMinor'], 'reason': 'exact-own-document'})
        if not sources[0]['records'] or not sources[1]['records']:
            case('empty-source')
        result['matchedPairCount'] = len(result['pairs'])
        if not result['cases'] and result['pairs']:
            result['status'] = 'matched'
    result['requiredIssueCategories'] = sorted({e['code'] for source in sources for e in source['errors']}
                                               | {c['reason'] for c in result['cases']})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        result = reconcile(json.loads(args.bundle.read_text(encoding='utf-8')), args.bundle.parent)
    except (ValueError, OSError, TypeError) as error:
        parser.exit(2, 'bundle error: %s\n' % error)
    rendered = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + '\n'
    if args.output:
        args.output.write_text(rendered, encoding='utf-8')
    else:
        print(rendered, end='')


if __name__ == '__main__':
    main()
