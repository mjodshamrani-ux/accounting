"""Deterministic synthetic originals. No product or oracle imports."""
import argparse
import copy
import csv
import io
import json
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_STORED, ZipFile, ZipInfo

SCOPE = [
    ('Entity', 'Synthetic INV1E Owner'), ('Inventory ledger', 'STOCK-COLUMN'),
    ('GL ledger', 'GL-COLUMN'), ('Currency', 'BHD'),
    ('Currency basis', 'functional'), ('Posting status', 'posted'),
    ('Posting layer', 'Current'), ('As of', '2026-10-31'),
    ('Chart version', 'CHART-E'), ('Map version', 'MAP-E'),
    ('Valuation policy version', 'SUPPLIED-E'),
    ('Inventory account set version', 'SET-E'),
]
FIELDS = ['Item ID', 'Quantity', 'Unit', 'Quantity precision', 'Posted value', 'Valuation reference']
# item, parent, batch, quantity, unit, precision, value, reference, account, GL dimensions
FACTS = [
    ['0007', 'NORTH', 'LOT-A', '1.250', 'KG', '3', '310.125', 'VAL-A', 'INV-RAW', 'branch=10'],
    ['07', 'NORTH', 'LOT-B', '2.75', 'KG', '2', '189.875', 'VAL-B', 'INV-RAW', 'branch=20'],
    ['0007', 'SOUTH', 'LOT-A', '1250', 'G', '0', '500.000', 'VAL-C', 'INV-RAW', 'branch=30'],
    ['7', 'SOUTH', 'LOT-C', '3', 'EA', '0', '62.500', 'VAL-D', 'INV-PACK', 'branch=40'],
    ['00', 'NORTH', 'Z0', '0', 'EA', '0', '0.000', 'VAL-Z', 'INV-PACK', 'branch=60'],
    ['007', 'EAST', 'LOT-A', '0.50', 'KG', '2', '62.500', 'VAL-F', 'INV-PACK', 'branch=50'],
]


def column(n):
    value = ''
    while n:
        n, r = divmod(n - 1, 26)
        value = chr(65 + r) + value
    return value


def companions():
    headers = [
        ['Mapping ID', 'Item ID', 'Item dimensions', 'GL account', 'GL dimensions', 'Evidence ID'],
        ['Evidence ID', 'Item ID', 'Item dimensions', 'Unit', 'Quantity precision', 'Valuation reference', 'GL account', 'GL dimensions', 'Account class', 'Sign', 'Value basis', 'Valid from', 'Valid to', 'Reference'],
        ['GL account', 'GL dimensions', 'Account class', 'Debit', 'Credit'],
    ]
    data = [[], [], []]
    for i, f in enumerate(FACTS):
        item, parent, batch, qty, unit, precision, money, ref, account, gl = f
        dims = f'warehouse={parent};batch={batch}'
        data[0].append([f'MAP-E-{i}', item, dims, account, gl, f'POL-E-{i}'])
        data[1].append([f'POL-E-{i}', item, dims, unit, precision, ref, account, gl, 'inventory', 'debit-positive', 'provided-posted-carrying-value', '2026-01-01', '2026-12-31', f'SYN-E-{i}'])
        data[2].append([account, gl, 'inventory', money, '0.000'])
    return [[h + [k for k, v in SCOPE]] + [r + [v for k, v in SCOPE] for r in rows] for h, rows in zip(headers, data)]


def register(panels, merged=False, gaps=False, reverse=False, explicit=False):
    rows = [['Inventory carrying-value register']] + [[k, v] for k, v in SCOPE]
    merges = []
    for indices in panels:
        columns = []
        for i in indices:
            if gaps and columns and FACTS[columns[-1]][1] != FACTS[i][1]:
                columns.append(None)
            columns.append(i)
        parent = ['Warehouse'] + [FACTS[i][1] if i is not None else '' for i in columns]
        if merged:
            start = 0
            while start < len(columns):
                end = start
                while end + 1 < len(columns) and columns[start] is not None and columns[end + 1] is not None and FACTS[columns[start]][1] == FACTS[columns[end + 1]][1]:
                    end += 1
                if end > start:
                    n = len(rows) + 1
                    merges.append(f'{column(start + 2)}{n}:{column(end + 2)}{n}')
                    for j in range(start + 1, end + 1):
                        parent[j + 1] = ''
                start = end + 1
        rows += [parent, ['Batch'] + [FACTS[i][2] if i is not None else '' for i in columns], ['Field'] + [f'COL-{i}' if i is not None else '' for i in columns]]
        roles = FIELDS + (['Item dimensions'] if explicit else [])
        if reverse:
            roles = list(reversed(roles))
        for role in roles:
            row = [role]
            for i in columns:
                if i is None:
                    row.append('')
                    continue
                f = FACTS[i]
                values = dict(zip(FIELDS, [f[0], f[3], f[4], f[5], f[6], f[7]]))
                values['Item dimensions'] = f'warehouse={f[1]};batch={f[2]}'
                row.append(values[role])
            rows.append(row)
        rows += [['End panel'], []]
    return rows + [['Report total', '1125.000'], ['End report']], merges


def cases():
    one = [[0, 1, 4, 2, 3, 5]]
    multi = [[2, 3], [1, 0, 4, 5]]
    r, m = register(one)
    yield 'P01', 'csv', r, m, False
    r, m = register(one, merged=True)
    yield 'P02', 'xlsx', r, m, False
    r, m = register(multi, reverse=True, explicit=True)
    yield 'P03', 'csv', r, m, False
    r, m = register(multi, merged=True, gaps=True, reverse=True)
    yield 'P04', 'xlsx', r, m, True
    r, m = register(one)
    money = next(x for x in r if x and x[0] == 'Posted value')
    money[1], money[2] = money[2], money[1]
    yield 'N01', 'csv', r, m, False
    r, m = register(one, merged=True)
    for row in r:
        if row and row[0] == 'Warehouse':
            row[:] = [{'NORTH': 'SOUTH', 'SOUTH': 'NORTH'}.get(v, v) for v in row]
    yield 'N02', 'xlsx', r, m, False
    r, m = register(one)
    next(x for x in r if x and x[0] == 'Batch')[1] = ''
    yield 'N03', 'csv', r, m, False
    r, m = register(multi, merged=True, gaps=True)
    gap_row = next(x for x in r if x and x[0] == 'Posted value' and '' in x[1:])
    gap_row[gap_row.index('')] = '0.000'
    yield 'N04', 'xlsx', r, m, True
    r, m = register(one)
    next(x for x in r if x and x[0] == 'Posted value')[3] = ''
    yield 'N05', 'csv', r, m, False
    r, m = register(one, merged=True)
    axis = next(x for x in r if x and x[0] == 'Field')
    axis[2] = axis[1]
    yield 'N06', 'xlsx', r, m, False
    r, m = register(one, explicit=True)
    next(x for x in r if x and x[0] == 'Item dimensions')[1] = 'warehouse=SOUTH;batch=LOT-A'
    yield 'N07', 'csv', r, m, False
    r, m = register(one, merged=True)
    m[0] = m[0].replace('D14', 'D15')
    yield 'N08', 'xlsx', r, m, False
    r, m = register(one, merged=True)
    next(x for x in r if x and x[0] == 'Warehouse')[2] = '0'
    yield 'N09', 'xlsx', r, m, False
    r, m = register(one, merged=True)
    n = next(i for i, x in enumerate(r, 1) if x and x[0] == 'Posted value')
    m.append(f'B{n}:C{n}')
    yield 'N10', 'xlsx', r, m, False
    r, m = register(multi)
    r.pop(next(i for i, x in enumerate(r) if x and x[0] == 'End panel'))
    yield 'N11', 'csv', r, m, False
    r, m = register(multi)
    n = [i for i, x in enumerate(r) if x and x[0] == 'Warehouse'][1]
    r[n][1:] = [''] * (len(r[n]) - 1)
    yield 'N12', 'csv', r, m, False
    r, m = register([one[0] + [4]], merged=True)
    next(x for x in r if x and x[0] == 'Field')[-1] = 'COL-duplicate-zero'
    yield 'N13', 'xlsx', r, m, False
    r, m = register(one)
    refs = next(x for x in r if x and x[0] == 'Valuation reference')
    refs[5], refs[6] = refs[6], refs[5]
    yield 'N14', 'csv', r, m, False
    r, m = register(one, merged=True)
    next(x for x in r if x and x[0] == 'Unit')[4] = 'KG'
    yield 'N15', 'xlsx', r, m, False
    r, m = register(one)
    next(x for x in r if x and x[0] == 'Report total')[1] = '1125.001'
    yield 'N16', 'csv', r, m, False


def csv_bytes(rows):
    stream = io.StringIO(newline='')
    csv.writer(stream, lineterminator='\n').writerows(rows)
    return stream.getvalue().encode()


def xlsx_bytes(rows, merges, shared):
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    strings = list(dict.fromkeys(v for row in rows for v in row if v != ''))
    parts = {}
    xml_rows = []
    for n, row in enumerate(rows, 1):
        cells = []
        for c, value in enumerate(row, 1):
            if value == '':
                continue
            content = f'<v>{strings.index(value)}</v>' if shared else '<is><t>' + escape(value) + '</t></is>'
            cells.append(f'<c r="{column(c)}{n}" t="' + ('s' if shared else 'inlineStr') + '">' + content + '</c>')
        xml_rows.append(f'<row r="{n}">' + ''.join(cells) + '</row>')
    part_name = 'ledger.xml' if shared else 'sheet1.xml'
    parts['[Content_Types].xml'] = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/' + part_name + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' + ('<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' if shared else '') + '</Types>'
    parts['_rels/.rels'] = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    parts['xl/workbook.xml'] = f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Column dimensions" sheetId="1" r:id="inventory"/></sheets></workbook>'
    parts['xl/_rels/workbook.xml.rels'] = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="inventory" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/' + part_name + '"/>' + ('<Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' if shared else '') + '</Relationships>'
    parts['xl/worksheets/' + part_name] = f'<worksheet xmlns="{ns}"><sheetFormatPr defaultRowHeight="15" defaultColWidth="30"/><sheetData>' + ''.join(xml_rows) + '</sheetData><mergeCells count="' + str(len(merges)) + '">' + ''.join(f'<mergeCell ref="{ref}"/>' for ref in merges) + '</mergeCells></worksheet>'
    if shared:
        parts['xl/sharedStrings.xml'] = f'<sst xmlns="{ns}" count="{sum(v != "" for r in rows for v in r)}" uniqueCount="{len(strings)}">' + ''.join('<si><t>' + escape(value) + '</t></si>' for value in strings) + '</sst>'
    stream = io.BytesIO()
    with ZipFile(stream, 'w', compression=ZIP_STORED) as archive:
        for name, value in parts.items():
            archive.writestr(ZipInfo(name, (2026, 10, 15, 0, 0, 0)), value.encode())
    return stream.getvalue()


def generate(root, include_layout_controls=False, negative_layout_controls=False):
    root.mkdir(parents=True, exist_ok=True)
    entries = []
    variants = list(cases())
    if include_layout_controls:
        for code, ext, original_rows, merges, shared in list(variants)[:4]:
            rows = copy.deepcopy(original_rows)
            next(x for x in rows if x and x[0] == 'Currency')[1] = 'KWD'
            variants.append(('C' + code[1:], ext, rows, merges[:], shared))
    if negative_layout_controls:
        for code, ext, original_rows, merges, shared in list(cases())[4:]:
            rows = copy.deepcopy(original_rows)
            next(x for x in rows if x and x[0] == 'Currency')[1] = 'KWD'
            variants.append(('D' + code[1:], ext, rows, merges[:], shared))
    for code, ext, rows, merges, shared in variants:
        folder = root / ('INV1E-' + code)
        folder.mkdir(exist_ok=True)
        register_file = folder / ('register.' + ext)
        register_file.write_bytes(csv_bytes(rows) if ext == 'csv' else xlsx_bytes(rows, merges, shared))
        files = [register_file]
        for n, data in enumerate(companions(), 1):
            if code.startswith(('C', 'D')):
                index = data[0].index('Currency')
                for row in data[1:]:
                    row[index] = 'KWD'
            file = folder / f'source-{n}.csv'
            file.write_bytes(csv_bytes(data))
            files.append(file)
        entries.append({'id': folder.name, 'container': ext, 'files': [str(p.relative_to(root)) for p in files]})
    (root / 'corpus.json').write_text(json.dumps({'synthetic': True, 'stories': 1, 'cases': entries}, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--include-layout-controls', action='store_true')
    parser.add_argument('--negative-layout-controls', action='store_true')
    args = parser.parse_args()
    generate(Path(args.output_dir), args.include_layout_controls, args.negative_layout_controls)
