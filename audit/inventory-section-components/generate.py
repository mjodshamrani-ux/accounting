"""Synthetic section-source variants; no engine or oracle imports.

One fixed financial story. Source order, hierarchy, repeated headers, blanks,
controls and spreadsheet producer vary; changing numbers is not the diversity.
"""
import argparse
import base64
import csv
import hashlib
import io
import json
from datetime import datetime
from pathlib import Path
from zipfile import ZipFile, ZipInfo

SCOPE = [
    ('Entity', 'Synthetic INV1 Owner'), ('Inventory ledger', 'STOCK-BOOK'),
    ('GL ledger', 'GL-BOOK'), ('Currency', 'SAR'), ('Currency basis', 'functional'),
    ('Posting status', 'posted'), ('Posting layer', 'Current'), ('As of', '2026-09-30'),
    ('Chart version', 'CHART-INV1'), ('Map version', 'MAP-INV1'),
    ('Valuation policy version', 'provided-posted-values-1'),
    ('Inventory account set version', 'INV-SET-1'),
]
ITEMS = [
    ['0007', 'warehouse=W1;batch=B01', '10', 'EA', '0', '600.00', 'V-0007-W1-B01', '01'],
    ['0007', 'warehouse=W1;batch=B02', '10', 'EA', '0', '400.00', 'V-0007-W1-B02', '01'],
    ['0007', 'warehouse=W2;batch=B01', '10', 'EA', '0', '500.00', 'V-0007-W2-B01', '02'],
    ['0008', 'warehouse=W1;batch=B00', '0', 'EA', '0', '0.00', 'V-0008-W1-B00', '01'],
]
FIELDS = ['Item ID', 'Item dimensions', 'Quantity', 'Unit', 'Quantity precision', 'Posted value', 'Valuation reference']


def companions():
    headers = [
        ['Mapping ID', 'Item ID', 'Item dimensions', 'GL account', 'GL dimensions', 'Evidence ID'],
        ['Evidence ID', 'Item ID', 'Item dimensions', 'Unit', 'Quantity precision', 'Valuation reference', 'GL account', 'GL dimensions', 'Account class', 'Sign', 'Value basis', 'Valid from', 'Valid to', 'Reference'],
        ['GL account', 'GL dimensions', 'Account class', 'Debit', 'Credit'],
    ]
    records = [[], [], [['INV-1', 'branch=01', 'inventory', '1000.00', '0.00'], ['INV-1', 'branch=02', 'inventory', '500.00', '0.00']]]
    for number, item in enumerate(ITEMS, 1):
        identity, dimensions, _, unit, precision, _, valuation, branch = item
        records[0].append([f'MAP-I{number}', identity, dimensions, 'INV-1', f'branch={branch}', f'POL-I{number}'])
        records[1].append([f'POL-I{number}', identity, dimensions, unit, precision, valuation, 'INV-1', f'branch={branch}', 'inventory', 'debit-positive', 'provided-posted-carrying-value', '2026-01-01', '2026-12-31', f'SYN-POL-I{number}'])
    return [[header + [k for k, _ in SCOPE]] + [row + [v for _, v in SCOPE] for row in data] for header, data in zip(headers, records)]


def sections(order=(0, 1, 2, 3), field_order=(0, 1, 3, 4, 6), component_order=(2, 5), repeated=False, sparse=False, controls=False):
    rows = [['Format', 'INV1A-SECTIONS-1']] + [['Scope', k, v] for k, v in SCOPE]
    if sparse: rows += [[], ['', '', '']]
    for index in order:
        item = ITEMS[index]
        rows += [['Section']] + [[FIELDS[n], item[n]] for n in field_order]
        rows += [['Component', 'Value']]
        for count, n in enumerate(component_order):
            if count and repeated: rows += [['Component', 'Value']]
            if sparse: rows += [[], ['', '', '']]
            rows += [[FIELDS[n], item[n]]]
        if controls: rows += [['Section subtotal', item[5]]]
        rows += [['End section']]
        if sparse: rows += [[]]
    if controls: rows += [['Report total', '1500.00']]
    return rows + [['End report']]


def csv_bytes(rows):
    stream = io.StringIO(newline='')
    csv.writer(stream, lineterminator='\n').writerows(rows)
    return stream.getvalue().encode('utf-8')


def workbook(path, rows, producer):
    if producer == 'openpyxl':
        import openpyxl
        from openpyxl.styles import Font
        book = openpyxl.Workbook()
        sheet = book.active
        sheet.title = 'Stock sections'
        sheet.column_dimensions['A'].width = 30
        sheet.column_dimensions['B'].width = 45
        sheet.column_dimensions['C'].width = 45
        for row in rows: sheet.append(row)
        for row in sheet:
            for cell in row:
                if cell.value is not None:
                    cell.font = Font(name='Arial', size=12, color='FF0A1B2E')
        book.properties.created = book.properties.modified = datetime(2026, 9, 30)
        book.save(path)
    else:
        import xlsxwriter
        book = xlsxwriter.Workbook(path)
        book.set_properties({'created': datetime(2026, 9, 30)})
        sheet = book.add_worksheet('Stock sections')
        sheet.set_column('A:A', 30)
        sheet.set_column('B:C', 45)
        for r, row in enumerate(rows):
            for c, value in enumerate(row):
                if value:
                    if c == 1 and row[0] in ['Quantity', 'Quantity precision', 'Posted value', 'Section subtotal', 'Report total']:
                        sheet.write_number(r, c, float(value))
                    else: sheet.write_string(r, c, value)
        book.close()
    # Producer ZIP timestamps and openpyxl modified timestamps otherwise vary.
    # The producer's actual cell/style/string XML remains untouched.
    with ZipFile(path) as archive:
        parts = [(name, archive.read(name)) for name in archive.namelist()]
    with ZipFile(path, 'w') as archive:
        for name, data in parts:
            if name == 'docProps/core.xml':
                import re
                data = re.sub(rb'(<dcterms:modified[^>]*>)[^<]*(</dcterms:modified>)', rb'\g<1>2026-09-30T00:00:00Z\2', data)
            info = ZipInfo(name, (2026, 9, 30, 0, 0, 0))
            archive.writestr(info, data)


def cases():
    yield 'INV1B-P01', 'csv', 'stdlib-csv', 'reordered-section-and-role', sections(order=(3, 2, 0, 1), field_order=(6, 4, 3, 1, 0), component_order=(5, 2)), None
    yield 'INV1B-P02', 'csv', 'stdlib-csv', 'repeated-component-header', sections(repeated=True), None
    yield 'INV1B-P03', 'xlsx', 'openpyxl', 'sparse-blank-explicit-zero', sections(sparse=True), None
    yield 'INV1B-P04', 'xlsx', 'xlsxwriter', 'section-and-report-controls', sections(controls=True), None
    yield 'INV1B-P05', 'csv', 'stdlib-csv', 'inclusive-policy-validity', sections(), 'boundary-policy'
    yield 'INV1B-P06', 'xlsx', 'xlsxwriter', 'reordered-section-and-role', sections(order=(2, 1, 3, 0), field_order=(1, 0, 6, 3, 4), component_order=(5, 2), repeated=True), None
    rows = sections(); rows.insert(22, ['Quantity', '10'])
    yield 'INV1B-N01', 'csv', 'stdlib-csv', 'duplicate-component', rows, None
    rows = sections(); rows.insert(49, ['Scope', 'Currency', 'USD'])
    yield 'INV1B-N02', 'xlsx', 'openpyxl', 'late-scope', rows, None
    yield 'INV1B-N03', 'csv', 'stdlib-csv', 'expired-policy', sections(), 'expired-policy'
    yield 'INV1B-N04', 'csv', 'stdlib-csv', 'foreign-mapping', sections(), 'foreign-mapping'
    rows = sections(); rows[25][1], rows[35][1] = rows[35][1], rows[25][1]
    yield 'INV1B-N05', 'xlsx', 'xlsxwriter', 'balanced-dimension-swap', rows, None
    rows = sections(controls=True)
    next(row for row in rows if row and row[0] == 'Section subtotal')[1] = '1.00'
    yield 'INV1B-N06', 'xlsx', 'xlsxwriter', 'incorrect-section-control', rows, None


def produce(root, regenerate_xlsx=False):
    if root.exists() and any(root.iterdir()): raise ValueError('REFUSE_REPLACE')
    root.mkdir(parents=True, exist_ok=True)
    frozen = json.loads((Path(__file__).parent / 'xlsx-originals.json').read_text())
    originals = {entry['case']:entry for entry in frozen['files']}
    index = []
    for identity, extension, producer, variant, rows, mutation in cases():
        folder = root / 'cases' / identity
        folder.mkdir(parents=True)
        path = folder / ('register.' + extension)
        if extension == 'csv': path.write_bytes(csv_bytes(rows))
        else:
            original = originals[identity]
            if regenerate_xlsx:
                import importlib
                library = importlib.import_module(producer)
                if library.__version__ != original['version']: raise ValueError('PINNED_PRODUCER_VERSION')
                workbook(path, rows, producer)
            else: path.write_bytes(base64.b64decode(original['base64'], validate=True))
            data = path.read_bytes()
            if len(data) != original['bytes'] or hashlib.sha256(data).hexdigest() != original['sha256']: raise ValueError('FROZEN_PRODUCER_BYTES')
        sources = companions()
        if mutation == 'boundary-policy':
            sources[1][1][11] = '2026-09-30'
            sources[1][4][12] = '2026-09-30'
        if mutation == 'expired-policy': sources[1][4][12] = '2026-09-29'
        if mutation == 'foreign-mapping': sources[0][3][1] = 'FOREIGN-0007'
        for number, source in enumerate(sources, 1):
            (folder / f'source-{number}.csv').write_bytes(csv_bytes(source))
        index.append({'id': identity, 'container': extension, 'producer': producer, 'variant': variant, 'files': [f'cases/{identity}/register.{extension}'] + [f'cases/{identity}/source-{n}.csv' for n in [1, 2, 3]]})
    (root / 'corpus.json').write_text(json.dumps({'schema': 'inv1b-section-corpus/1', 'synthetic': True, 'financialStories': 1, 'cases': index}, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--regenerate-xlsx', action='store_true', help='Requires the pinned independent producer versions; default recovers their frozen original bytes.')
    args = parser.parse_args()
    produce(args.output_dir, args.regenerate_xlsx)
