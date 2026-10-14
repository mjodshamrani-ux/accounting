"""Synthetic INV-1A source producer. No product or oracle imports.

This writes inputs only, never expected financial outcomes. Deliberately small
and inspectable: stdlib comma CSV plus deterministic literal-string OOXML.
"""
import argparse
import csv
import io
import json
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZipInfo, ZIP_STORED

SCOPE = [
    ('Entity', 'Synthetic INV1 Owner'), ('Inventory ledger', 'STOCK-BOOK'),
    ('GL ledger', 'GL-BOOK'), ('Currency', 'SAR'), ('Currency basis', 'functional'),
    ('Posting status', 'posted'), ('Posting layer', 'Current'), ('As of', '2026-09-30'),
    ('Chart version', 'CHART-INV1'), ('Map version', 'MAP-INV1'),
    ('Valuation policy version', 'provided-posted-values-1'),
    ('Inventory account set version', 'INV-SET-1'),
]
STOCK = [
    ('0007', 'W1', 'B01', '10', '600.00', 'V-0007-W1-B01', '01'),
    ('0007', 'W1', 'B02', '10', '400.00', 'V-0007-W1-B02', '01'),
    ('0007', 'W2', 'B01', '10', '500.00', 'V-0007-W2-B01', '02'),
    ('0008', 'W1', 'B00', '0', '0.00', 'V-0008-W1-B00', '01'),
]


def canonical_roles():
    scope_headers, scope_values = zip(*SCOPE)
    headers = [
        ['Item ID', 'Item dimensions', 'Quantity', 'Unit', 'Quantity precision', 'Posted value', 'Valuation reference'],
        ['Mapping ID', 'Item ID', 'Item dimensions', 'GL account', 'GL dimensions', 'Evidence ID'],
        ['Evidence ID', 'Item ID', 'Item dimensions', 'Unit', 'Quantity precision', 'Valuation reference', 'GL account', 'GL dimensions', 'Account class', 'Sign', 'Value basis', 'Valid from', 'Valid to', 'Reference'],
        ['GL account', 'GL dimensions', 'Account class', 'Debit', 'Credit'],
    ]
    data = [[], [], [], [
        ['INV-1', 'branch=01', 'inventory', '1000.00', '0.00'],
        ['INV-1', 'branch=02', 'inventory', '500.00', '0.00'],
    ]]
    for number, (item, warehouse, batch, quantity, value, valuation, branch) in enumerate(STOCK, 1):
        dimensions = f'warehouse={warehouse};batch={batch}'
        policy = f'POL-I{number}'
        data[0].append([item, dimensions, quantity, 'EA', '0', value, valuation])
        data[1].append([f'MAP-I{number}', item, dimensions, 'INV-1', f'branch={branch}', policy])
        data[2].append([policy, item, dimensions, 'EA', '0', valuation, 'INV-1', f'branch={branch}', 'inventory', 'debit-positive', 'provided-posted-carrying-value', '2026-01-01', '2026-12-31', f'SYN-POL-I{number}'])
    return [[header + list(scope_headers)] + [row + list(scope_values) for row in records]
            for header, records in zip(headers, data)]


def sections():
    rows = [['Format', 'INV1A-SECTIONS-1']] + [['Scope', key, value] for key, value in SCOPE]
    for item, warehouse, batch, quantity, value, valuation, _ in STOCK:
        rows.extend([
            ['Section'], ['Item ID', item], ['Item dimensions', f'warehouse={warehouse};batch={batch}'],
            ['Unit', 'EA'], ['Quantity precision', '0'], ['Valuation reference', valuation],
            ['Component', 'Value'], ['Quantity', quantity], ['Posted value', value], ['End section'],
        ])
    rows.append(['End report'])
    return rows


def matrix():
    rows = [['Format', 'INV1A-MATRIX-1']] + [['Scope', key, value] for key, value in SCOPE]
    rows.append(['Field', 'K-A', 'K-B', 'K-C', 'K-Z'])
    fields = [
        ('Item ID', [s[0] for s in STOCK]), ('Item dimensions', [f'warehouse={s[1]};batch={s[2]}' for s in STOCK]),
        ('Quantity', [s[3] for s in STOCK]),
        ('Unit', ['EA'] * 4), ('Quantity precision', ['0'] * 4),
        ('Posted value', [s[4] for s in STOCK]), ('Valuation reference', [s[5] for s in STOCK]),
    ]
    rows.extend([[field] + values for field, values in fields])
    rows.append(['End report'])
    return rows


def write_csv(path, rows):
    stream = io.StringIO(newline='')
    csv.writer(stream, lineterminator='\n').writerows(rows)
    path.write_bytes(stream.getvalue().encode('utf-8'))


def column_name(n):
    text = ''
    while n:
        n, remainder = divmod(n - 1, 26)
        text = chr(65 + remainder) + text
    return text


def write_xlsx(path, rows):
    def literal(value):
        return escape(value).replace('\r', '&#13;')
    sheet_rows = []
    for row_number, values in enumerate(rows, 1):
        cells = ''.join(
            f'<c r="{column_name(column)}{row_number}" t="inlineStr"><is><t xml:space="preserve">{literal(value)}</t></is></c>'
            for column, value in enumerate(values, 1)
        )
        sheet_rows.append(f'<row r="{row_number}">{cells}</row>')
    columns = f'<cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="{max(len(row) for row in rows)}" width="45" customWidth="1"/></cols>'
    files = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/report.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="book" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Supplied stock" sheetId="1" r:id="report"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="report" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/report.xml"/></Relationships>',
        'xl/worksheets/report.xml': '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + columns + '<sheetData>' + ''.join(sheet_rows) + '</sheetData></worksheet>',
    }
    with ZipFile(path, 'w') as archive:
        for name, content in files.items():
            info = ZipInfo(name, (2026, 9, 30, 0, 0, 0))
            info.compress_type = ZIP_STORED
            archive.writestr(info, '<?xml version="1.0" encoding="UTF-8"?>' + content)


def variants():
    yield 'INV1A-P01', 'csv', canonical_roles()[0]
    yield 'INV1A-P02', 'csv', sections()
    yield 'INV1A-P03', 'xlsx', sections()
    yield 'INV1A-P04', 'xlsx', matrix()
    rows = sections(); rows.pop(35)
    yield 'INV1A-N01', 'csv', rows
    rows = sections(); component = rows.pop(21); end_section = next(i for i, r in enumerate(rows) if r == ['End section']); rows.insert(end_section + 1, component)
    yield 'INV1A-N02', 'csv', rows
    rows = sections(); rows.pop(51)
    yield 'INV1A-N03', 'csv', rows
    rows = sections(); rows[22:22] = [['Component', 'Value'], ['Posted value', '600.00']]
    yield 'INV1A-N04', 'csv', rows
    rows = sections(); rows[25][1], rows[35][1] = rows[35][1], rows[25][1]
    yield 'INV1A-N05', 'csv', rows
    rows = sections(); rows.insert(49, ['Scope', 'Currency', 'USD'])
    yield 'INV1A-N06', 'xlsx', rows
    rows = sections(); rows.insert(52, ['Section subtotal', '1.00']); rows.insert(-1, ['Report total', '1500.00'])
    yield 'INV1A-N07', 'xlsx', rows
    rows = matrix(); rows.insert(17, ['Quantity', '10', '10', '10', '0'])
    yield 'INV1A-N08', 'xlsx', rows


def produce(root):
    if root.exists() and any(root.iterdir()):
        raise ValueError('Refusing to replace existing source files; use a fresh directory')
    root.mkdir(parents=True, exist_ok=True)
    (root / 'cases').mkdir()
    base = canonical_roles()
    index = []
    changes = {
        'INV1A-N01': {'tag': 'missing-section-dimension', 'originalRows': [36]},
        'INV1A-N02': {'tag': 'component-after-closed-section', 'originalRows': [22, 23]},
        'INV1A-N03': {'tag': 'missing-zero-posted-value', 'originalRows': [52]},
        'INV1A-N04': {'tag': 'duplicate-component-after-header', 'insertBeforeOriginalRow': 23},
        'INV1A-N05': {'tag': 'swapped-literal-dimensions', 'originalRows': [26, 36]},
        'INV1A-N06': {'tag': 'late-section-currency-conflict', 'insertBeforeOriginalRow': 50},
        'INV1A-N07': {'tag': 'incorrect-subtotal-with-unchanged-report-total', 'insertBeforeOriginalRow': 53},
        'INV1A-N08': {'tag': 'duplicate-matrix-role', 'insertBeforeOriginalRow': 18},
    }
    for case_id, extension, register in variants():
        folder = root / 'cases' / case_id
        folder.mkdir()
        (write_csv if extension == 'csv' else write_xlsx)(folder / f'register.{extension}', register)
        for number, rows in enumerate(base[1:], 1):
            write_csv(folder / f'source-{number}.csv', rows)
        layout = {'INV1A-SECTIONS-1': 'section-headers-components', 'INV1A-MATRIX-1': 'transposed-role-matrix'}.get(register[0][1] if register[0][0] == 'Format' else '', 'canonical-flat-csv-control')
        index.append({'id': case_id, 'layout': layout, 'container': extension, 'sourceRole': 'register', 'mutation': changes.get(case_id), 'files': [f'cases/{case_id}/register.{extension}'] + [f'cases/{case_id}/source-{n}.csv' for n in [1, 2, 3]]})
    (root / 'corpus.json').write_text(json.dumps({'schema': 'inv1a-source-corpus/1', 'synthetic': True, 'cases': index}, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path, required=True)
    produce(parser.parse_args().output_dir)
