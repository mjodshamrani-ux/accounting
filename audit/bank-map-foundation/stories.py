"""WF-1 MAP-1 foundation: cashbooks whose columns are not the declared ones,
and the maps an accountant saves to read them again.

  python3 -B audit/bank-map-foundation/stories.py [--out DIR]

Each story uses statements and cashbooks already sealed by the ROLL-1 and
REVIEW-1 foundations, unchanged and read from where they are sealed: the
statement PDF and its printed facts, and the declared cashbook (the twin).
This script writes, into DIR (frozen/ by default), the same cashbook entries
in other layouts, CSV or XLSX, the map files an accountant imports, and
stories.json. `actions` is what the accountant does, in order: read a
cashbook with the declared columns, by hand (a header row and a column for
each role, then optionally save the choice under a name), or by a saved map
named; import a map file; export a saved map. `recipe` says how each file was
made; `intent` is the expected outcome, written by hand. The oracle reads
neither.

The XLSX files are written here from the standard library, entries stored
without compression so that the bytes do not depend on a zlib version.
"""
import argparse
import csv
import io
import json
import unicodedata
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
AUDIT = HERE.parent
STORIES_VERSION = 'bank-map-foundation-1'
SOURCES = {'R': 'bank-roll-foundation', 'Q': 'bank-review-foundation'}
OPENING = 25000000  # the running balance the layouts print; never read

# Layouts: (label, field). A field is a role, or a column no role reads.
EN_A = [('Voucher No', 'voucher'), ('Date', 'date'), ('Document No', 'doc'), ('Reference', 'reference'),
        ('Narration', 'description'), ('Debit', 'receipts'), ('Credit', 'payments'), ('Balance', 'balance')]
EN_A_COLUMNS = {'date': 2, 'voucher': 1, 'description': 5, 'reference': 4, 'receipts': 6, 'payments': 7}
EN_B = [('Txn Date', 'date'), ('Doc Ref', 'voucher'), ('Particulars', 'description'), ('Cheque/Ref', 'reference'),
        ('Money In', 'receipts'), ('Money Out', 'payments')]
EN_B_COLUMNS = {'date': 1, 'voucher': 2, 'description': 3, 'reference': 4, 'receipts': 5, 'payments': 6}
AR = [('رقم السند', 'voucher'), ('التاريخ', 'date'), ('رقم المستند', 'doc'), ('المرجع', 'reference'),
      ('الإيضاح', 'description'), ('مدين', 'receipts'), ('دائن', 'payments'), ('الرصيد', 'balance')]
EN_C = [('Batch', 'batch'), ('Date', 'date'), ('Voucher No', 'voucher'), ('Document No', 'doc'),
        ('Reference', 'reference'), ('Description', 'description'), ('Receipts', 'receipts'),
        ('Payments', 'payments'), ('Balance', 'balance')]
EN_C_COLUMNS = {'date': 2, 'voucher': 3, 'description': 6, 'reference': 5, 'receipts': 7, 'payments': 8}
EN_D = [('Date', 'date'), ('Voucher', 'voucher'), ('Internal ID', 'internal'), ('Description', 'description'),
        ('Reference', 'reference'), ('Receipts', 'receipts'), ('Payments', 'payments'), ('Balance', 'balance')]
EN_D_COLUMNS = {'date': 1, 'voucher': 2, 'description': 4, 'reference': 5, 'receipts': 6, 'payments': 7}
EN_F = [('Date', 'date'), ('Voucher', 'voucher'), ('Description', 'description'), ('', 'blank'),
        ('Reference', 'reference'), ('Receipts', 'receipts'), ('Payments', 'payments'), ('Balance', 'balance')]
EN_F_COLUMNS = {'date': 1, 'voucher': 2, 'description': 3, 'reference': 5, 'receipts': 6, 'payments': 7}
CSV_G = [('Posting date', 'date'), ('Voucher No', 'voucher'), ('Batch', 'batch'), ('Reference', 'reference'),
         ('Description', 'description'), ('Money in', 'receipts'), ('Money out', 'payments')]
CSV_G_COLUMNS = {'date': 1, 'voucher': 2, 'description': 5, 'reference': 4, 'receipts': 6, 'payments': 7}
DECLARED = [('Date', 'date'), ('Voucher', 'voucher'), ('Description', 'description'), ('Reference', 'reference'),
            ('Receipts', 'receipts'), ('Payments', 'payments')]


def titles_en(period, account='Main current account'):
    return [['Al Noor Trading Co.'], [f'Cash book — {account}'], [f'Period: {period}']]


def titles_ar():
    return [['شركة النور للتجارة'], ['دفتر النقدية — الحساب الجاري']]


def twin(period):
    """The declared cashbook sealed with a period, as rows of text."""
    path = AUDIT / SOURCES[period[0]] / 'frozen' / f'{period}-cashbook.csv'
    rows = list(csv.reader(io.StringIO(path.read_bytes().decode('utf-8'), newline='')))
    assert rows[0] == [h for h, _ in DECLARED], path
    return [dict(zip(['date', 'voucher', 'description', 'reference', 'receipts', 'payments'], r)) for r in rows[1:]]


def minor(text):
    whole, _, cents = text.partition('.')
    return int(whole) * 100 + int(cents.ljust(2, '0')) if text else 0


def shortest(m):
    """A number as Excel stores it typed: its shortest decimal text."""
    sign, m = ('-' if m < 0 else ''), abs(m)
    text = f'{m // 100}.{m % 100:02d}'.rstrip('0').rstrip('.')
    return sign + text


def field_value(field, entry, k, period, balance):
    code = period.replace('-', '')
    if field in ('date', 'voucher', 'description', 'reference'):
        return entry[field]
    if field in ('receipts', 'payments'):
        return entry[field]
    return {'doc': f'DOC-{code}-{k + 1:03d}', 'batch': f'B{(k // 5) + 1:02d}', 'cost': 'CC-100',
            'branch': 'Riyadh', 'internal': str(400100 + k), 'blank': '',
            'balance': shortest(balance)}[field]


def table(period, layout, titles=(), typed=True, extra=None):
    """Title rows, the header, then one row per entry of the period's twin.
    Amounts, balances and internal identifiers are typed numbers when typed."""
    rows = [list(t) for t in titles]
    rows.append([label for label, _ in layout])
    balance = OPENING
    for k, entry in enumerate(twin(period)):
        balance += minor(entry['receipts']) - minor(entry['payments'])
        row = []
        for _, field in layout:
            value = field_value(field, entry, k, period, balance)
            if typed and value and field in ('receipts', 'payments'):
                value = ('n', shortest(minor(value)))
            elif typed and field in ('balance', 'internal'):
                value = ('n', value)
            row.append(value)
        rows.append(row)
    if extra:
        extra(rows)
    return rows


# ---- XLSX -----------------------------------------------------------------

def letters(n):
    s = ''
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def xml_text(s):
    space = ' xml:space="preserve"' if s != s.strip(' \t\n') or '  ' in s or '\t' in s else ''
    return f'<t{space}>{escape(s)}</t>'


def xlsx(sheets):
    """sheets: [{'name', 'rows', 'merges': [...], 'hidden': [columns]}]. A cell
    is None or '' (absent), text, ('n', number text) or ('f', formula, cached)."""
    shared, index = [], {}

    def sid(s):
        if s not in index:
            index[s] = len(shared)
            shared.append(s)
        return index[s]
    parts = {}
    for i, sheet in enumerate(sheets, 1):
        width = max(len(r) for r in sheet['rows'])
        out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
               '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
               'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
               f'<dimension ref="A1:{letters(width)}{len(sheet["rows"])}"/>'
               '<sheetFormatPr defaultRowHeight="15"/>']
        if sheet.get('hidden'):
            out.append('<cols>' + ''.join(f'<col min="{c}" max="{c}" width="0" hidden="1" customWidth="1"/>'
                                          for c in sheet['hidden']) + '</cols>')
        out.append('<sheetData>')
        for r, row in enumerate(sheet['rows'], 1):
            cells = []
            for c, v in enumerate(row, 1):
                ref = f'{letters(c)}{r}'
                if v is None or v == '':
                    continue
                if isinstance(v, str):
                    cells.append(f'<c r="{ref}" t="s"><v>{sid(v)}</v></c>')
                elif v[0] == 'n':
                    cells.append(f'<c r="{ref}"><v>{v[1]}</v></c>')
                else:
                    cells.append(f'<c r="{ref}"><f>{escape(v[1])}</f><v>{v[2]}</v></c>')
            out.append(f'<row r="{r}">{"".join(cells)}</row>')
        out.append('</sheetData>')
        if sheet.get('merges'):
            out.append(f'<mergeCells count="{len(sheet["merges"])}">'
                       + ''.join(f'<mergeCell ref="{m}"/>' for m in sheet['merges']) + '</mergeCells>')
        out.append('</worksheet>')
        parts[f'xl/worksheets/sheet{i}.xml'] = ''.join(out)
    n = len(sheets)
    parts['xl/sharedStrings.xml'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(shared)}" '
        f'uniqueCount="{len(shared)}">' + ''.join(f'<si>{xml_text(s)}</si>' for s in shared) + '</sst>')
    parts['xl/workbook.xml'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        + ''.join(f'<sheet name="{escape(s["name"])}" sheetId="{i}" r:id="rId{i}"/>' for i, s in enumerate(sheets, 1))
        + '</sheets></workbook>')
    parts['xl/_rels/workbook.xml.rels'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + ''.join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
                  f'relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, n + 1))
        + f'<Relationship Id="rId{n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
          'relationships/styles" Target="styles.xml"/>'
        + f'<Relationship Id="rId{n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
          'relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>')
    parts['xl/styles.xml'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        '</styleSheet>')
    parts['docProps/core.xml'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        '<dc:creator>Tarasuf MAP-1 foundation</dc:creator>'
        '<dcterms:created xsi:type="dcterms:W3CDTF">2026-10-27T00:00:00Z</dcterms:created>'
        '</cp:coreProperties>')
    parts['_rels/.rels'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
        'officeDocument" Target="xl/workbook.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/'
        'core-properties" Target="docProps/core.xml"/></Relationships>')
    parts['[Content_Types].xml'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.'
        'spreadsheetml.sheet.main+xml"/>'
        + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.'
                  'openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, n + 1))
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.'
          'spreadsheetml.styles+xml"/>'
          '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-'
          'officedocument.spreadsheetml.sharedStrings+xml"/>'
          '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.'
          'core-properties+xml"/></Types>')
    order = ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'xl/workbook.xml',
             'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml',
             *[f'xl/worksheets/sheet{i}.xml' for i in range(1, n + 1)]]
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as z:
        for name in order:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            info.create_system = 3
            info.external_attr = 0o600 << 16
            z.writestr(info, parts[name].encode('utf-8'))
    return buffer.getvalue()


def sheet(rows, name='Cashbook', merges=(), hidden=()):
    return {'name': name, 'rows': rows, 'merges': list(merges), 'hidden': list(hidden)}


def text_csv(rows):
    out = io.StringIO()
    w = csv.writer(out, lineterminator='\r\n')
    for row in rows:
        w.writerow([v if isinstance(v, str) else v[1] for v in row])
    return out.getvalue().encode('utf-8')


# ---- maps -----------------------------------------------------------------

def label_map(name, header, layout, columns):
    labels = {field: label for label, field in layout}
    return {
        'format': 'tarasuf-column-map', 'version': 1, 'role': 'bank-cashbook', 'name': name, 'header': header,
        'columns': {role: ({'column': columns[role], 'label': labels[role]} if columns.get(role) else None)
                    for role in ['date', 'voucher', 'description', 'reference', 'receipts', 'payments']},
    }


def map_text(m):
    return (json.dumps(m, ensure_ascii=False, indent=1) + '\n').encode('utf-8')


def corrupt_maps(valid):
    """(file suffix, bytes, why) for each corrupt map of M18."""
    def edit(f):
        m = json.loads(json.dumps(valid))
        f(m)
        return map_text(m)
    text = map_text(valid)
    padded = text[:-2] + b' ' * (16385 - len(text)) + text[-2:]
    return [
        ('truncated', text[:60], 'not JSON'),
        ('array', b'[1, 2]\n', 'JSON, not an object'),
        ('latin1', text.replace(b'Payroll', b'Payr\xf6ll'), 'not UTF-8'),
        ('nan', text.replace(b'"header": 1', b'"header": NaN'), 'NaN is not JSON'),
        ('oversize', padded, 'over 16384 bytes'),
        ('template', edit(lambda m: m.update(format='tarasuf-column-template')), 'another format'),
        ('version2', edit(lambda m: m.update(version=2)), 'another version'),
        ('supplier', edit(lambda m: m.update(role='supplier-ledger')), 'another role'),
        ('currency', edit(lambda m: m.update(currency='SAR')), 'a map never carries a currency'),
        ('sign', edit(lambda m: m['columns']['receipts'].update(sign=1)), 'a map never carries a sign'),
        ('name-space', edit(lambda m: m.update(name=' Payroll account')), 'a name not in its normal form'),
        ('header0', edit(lambda m: m.update(header=0)), 'header row 0'),
        ('header31', edit(lambda m: m.update(header=31)), 'header row beyond 30'),
        ('header-fraction', edit(lambda m: m.update(header=1.5)), 'header row not an integer'),
        ('no-date', edit(lambda m: m['columns'].update(date=None)), 'a required role without a column'),
        ('same-column', edit(lambda m: m['columns']['payments'].update(column=5)), 'receipts and payments in one column'),
        ('column101', edit(lambda m: m['columns']['payments'].update(column=101)), 'column beyond 100'),
        ('empty-label', edit(lambda m: m['columns']['reference'].update(label='')), 'an empty label'),
        ('control-label', edit(lambda m: m['columns']['reference'].update(label='Cheque\u0007Ref')),
         'a control character in a label'),
    ]


# ---- stories --------------------------------------------------------------

def period(pid):
    return {'period': pid, 'source': SOURCES[pid[0]]}


def hand(pid, file, header, columns, save=None, as_name=None):
    a = {'do': 'read', **period(pid), 'file': file, 'by': 'hand', 'header': header,
         'columns': {r: columns.get(r) for r in ['date', 'voucher', 'description', 'reference', 'receipts', 'payments']}}
    if save:
        a['save'] = save
    if as_name:
        a['as'] = as_name
    return a


def by_map(pid, file, name, as_name=None):
    a = {'do': 'read', **period(pid), 'file': file, 'by': 'map', 'map': name}
    if as_name:
        a['as'] = as_name
    return a


def declared(pid, file):
    return {'do': 'read', **period(pid), 'file': file, 'by': 'declared'}


TWIN = 'twin'


def read_ok(store, cases=TWIN):
    return {'fits': True, 'refused': None, 'cases': cases, 'store': store}


def build(out):
    out.mkdir(parents=True, exist_ok=True)
    files, stories = {}, []

    def put(name, data, recipe):
        files[name] = data
        recipes[name] = recipe
    MAIN = 'Main current account'

    # M01: next month's file fits the map saved this month.
    recipes = {}
    put('M01-JUL-cashbook.xlsx', xlsx([sheet(table('R17-JUL', EN_A, titles_en('July 2026')), merges=['A1:H1'])]),
        {'twin': 'R17-JUL', 'layout': 'EN_A', 'header': 4, 'titles': 3, 'merged': 'A1:H1'})
    put('M01-AUG-cashbook.xlsx', xlsx([sheet(table('R17-AUG', EN_A, titles_en('August 2026')), merges=['A1:H1'])]),
        {'twin': 'R17-AUG', 'layout': 'EN_A', 'header': 4, 'titles': 3, 'merged': 'A1:H1'})
    stories.append({
        'id': 'M01', 'title': "The map saved on this month's cashbook reads next month's",
        'actions': [hand('R17-JUL', 'M01-JUL-cashbook.xlsx', 4, EN_A_COLUMNS, save=MAIN),
                    by_map('R17-AUG', 'M01-AUG-cashbook.xlsx', MAIN)],
        'recipe': dict(recipes),
        'intent': [read_ok([MAIN]), read_ok([MAIN])],
    })

    # M02: next month's columns are reordered.
    recipes = {}
    swapped = [EN_A[0], EN_A[1], EN_A[3], EN_A[2], *EN_A[4:]]
    put('M02-JUL-cashbook.xlsx', xlsx([sheet(table('R01-JUL', EN_A, titles_en('July 2026')), merges=['A1:H1'])]),
        {'twin': 'R01-JUL', 'layout': 'EN_A', 'header': 4})
    put('M02-AUG-cashbook.xlsx', xlsx([sheet(table('R01-AUG', swapped, titles_en('August 2026')), merges=['A1:H1'])]),
        {'twin': 'R01-AUG', 'layout': 'EN_A with Reference and Document No swapped', 'header': 4})
    stories.append({
        'id': 'M02', 'title': "Next month's Reference and Document No columns change places",
        'actions': [hand('R01-JUL', 'M02-JUL-cashbook.xlsx', 4, EN_A_COLUMNS, save=MAIN),
                    by_map('R01-AUG', 'M02-AUG-cashbook.xlsx', MAIN),
                    hand('R01-AUG', 'M02-AUG-cashbook.xlsx', 4, {**EN_A_COLUMNS, 'reference': 3}, save=MAIN),
                    by_map('R01-AUG', 'M02-AUG-cashbook.xlsx', MAIN)],
        'recipe': dict(recipes),
        'intent': [read_ok([MAIN]),
                   {'fits': False, 'problems': [('reference', 'Document No', ['C4'])], 'store': [MAIN]},
                   read_ok([MAIN]), read_ok([MAIN])],
    })

    # M03: next month's file has no Reference column.
    recipes = {}
    dropped = [c for c in EN_A if c[1] != 'reference']
    put('M03-JUL-cashbook.xlsx', xlsx([sheet(table('R02-JUL', EN_A, titles_en('July 2026')), merges=['A1:H1'])]),
        {'twin': 'R02-JUL', 'layout': 'EN_A', 'header': 4})
    put('M03-AUG-cashbook.xlsx', xlsx([sheet(table('R02-AUG', dropped, titles_en('August 2026')), merges=['A1:G1'])]),
        {'twin': 'R02-AUG', 'layout': 'EN_A without Reference', 'header': 4, 'blankReferences': True})
    stories.append({
        'id': 'M03', 'title': "Next month's file has lost its Reference column",
        'actions': [hand('R02-JUL', 'M03-JUL-cashbook.xlsx', 4, EN_A_COLUMNS, save=MAIN),
                    by_map('R02-AUG', 'M03-AUG-cashbook.xlsx', MAIN),
                    hand('R02-AUG', 'M03-AUG-cashbook.xlsx', 4,
                         {'date': 2, 'voucher': 1, 'description': 4, 'receipts': 5, 'payments': 6})],
        'recipe': dict(recipes),
        'intent': [read_ok([MAIN]),
                   {'fits': False, 'problems': [('description', 'Debit', ['D4']), ('reference', 'Narration', []),
                                                ('receipts', 'Credit', ['E4']), ('payments', 'Balance', ['F4'])],
                    'store': [MAIN]},
                   read_ok([MAIN], {'automatic': 0, 'review': {'amount-date-suggestion': 4}})],
    })

    # M04: a file of another party under the same file name, in its own layout.
    recipes = {}
    put('M04-A-cashbook.xlsx', xlsx([sheet(table('R19-JUL', EN_A, titles_en('July 2026')), merges=['A1:H1'])]),
        {'twin': 'R19-JUL', 'layout': 'EN_A', 'header': 4})
    put('M04-B-cashbook.xlsx', xlsx([sheet(table('Q13-NOV', EN_B))]),
        {'twin': 'Q13-NOV', 'layout': 'EN_B', 'header': 1})
    stories.append({
        'id': 'M04', 'title': "Another party's cashbook under the same file name does not fit the map",
        'actions': [hand('R19-JUL', 'M04-A-cashbook.xlsx', 4, EN_A_COLUMNS, save=MAIN, as_name='cashbook.xlsx'),
                    by_map('Q13-NOV', 'M04-B-cashbook.xlsx', MAIN, as_name='cashbook.xlsx'),
                    hand('Q13-NOV', 'M04-B-cashbook.xlsx', 1, EN_B_COLUMNS, as_name='cashbook.xlsx')],
        'recipe': dict(recipes),
        'intent': [read_ok([MAIN]),
                   {'fits': False, 'problems': ['date', 'voucher', 'description', 'reference', 'receipts', 'payments'],
                    'store': [MAIN]},
                   read_ok([MAIN])],
    })

    # M05: a file of another party under the same file name, in the same layout.
    recipes = {}
    put('M05-A-cashbook.xlsx', xlsx([sheet(table('R19-JUL', EN_A, titles_en('July 2026')), merges=['A1:H1'])]),
        {'twin': 'R19-JUL', 'layout': 'EN_A', 'header': 4})
    put('M05-C-cashbook.xlsx', xlsx([sheet(table('Q16-NOV', EN_A, titles_en('November 2026', 'Operations account')),
                                           merges=['A1:H1'])]),
        {'twin': 'Q16-NOV', 'layout': 'EN_A', 'header': 4})
    stories.append({
        'id': 'M05', 'title': "Another party's cashbook in the same layout fits: a map proves columns, not the party",
        'actions': [hand('R19-JUL', 'M05-A-cashbook.xlsx', 4, EN_A_COLUMNS, save=MAIN, as_name='cashbook.xlsx'),
                    by_map('Q16-NOV', 'M05-C-cashbook.xlsx', MAIN, as_name='cashbook.xlsx')],
        'recipe': dict(recipes),
        'intent': [read_ok([MAIN]), read_ok([MAIN])],
    })

    # M06: one more title row moves the header down.
    recipes = {}
    put('M06-JUL-cashbook.xlsx', xlsx([sheet(table('R03-JUL', EN_A, titles_en('July 2026')), merges=['A1:H1'])]),
        {'twin': 'R03-JUL', 'layout': 'EN_A', 'header': 4})
    put('M06-AUG-cashbook.xlsx', xlsx([sheet(table('R03-AUG', EN_A, titles_en('August 2026') + [['Printed on 2026-09-01']]),
                                             merges=['A1:H1'])]),
        {'twin': 'R03-AUG', 'layout': 'EN_A', 'header': 5, 'titles': 4})
    stories.append({
        'id': 'M06', 'title': "A fourth title row moves next month's header to row 5",
        'actions': [hand('R03-JUL', 'M06-JUL-cashbook.xlsx', 4, EN_A_COLUMNS, save=MAIN),
                    by_map('R03-AUG', 'M06-AUG-cashbook.xlsx', MAIN),
                    hand('R03-AUG', 'M06-AUG-cashbook.xlsx', 5, EN_A_COLUMNS, save=MAIN)],
        'recipe': dict(recipes),
        'intent': [read_ok([MAIN]),
                   {'fits': False,
                    'problems': [('date', '', ['B5']), ('voucher', 'Printed on 2026-09-01', ['A5']),
                                 ('description', '', ['E5']), ('reference', '', ['D5']),
                                 ('receipts', '', ['F5']), ('payments', '', ['G5'])],
                    'store': [MAIN]},
                   read_ok([MAIN])],
    })

    # M07: a column appended after the mapped ones.
    recipes = {}
    appended = EN_A + [('Cost centre', 'cost')]
    put('M07-JUL-cashbook.xlsx', xlsx([sheet(table('R04-JUL', EN_A, titles_en('July 2026')), merges=['A1:H1'])]),
        {'twin': 'R04-JUL', 'layout': 'EN_A', 'header': 4})
    put('M07-AUG-cashbook.xlsx', xlsx([sheet(table('R04-AUG', appended, titles_en('August 2026')), merges=['A1:I1'])]),
        {'twin': 'R04-AUG', 'layout': 'EN_A with Cost centre appended', 'header': 4})
    stories.append({
        'id': 'M07', 'title': 'A column appended after the mapped ones keeps the map fitting',
        'actions': [hand('R04-JUL', 'M07-JUL-cashbook.xlsx', 4, EN_A_COLUMNS, save=MAIN),
                    by_map('R04-AUG', 'M07-AUG-cashbook.xlsx', MAIN)],
        'recipe': dict(recipes),
        'intent': [read_ok([MAIN]), {**read_ok([MAIN]), 'unread': ['Document No', 'Balance', 'Cost centre']}],
    })

    # M08: a column inserted among the mapped ones.
    recipes = {}
    inserted = [EN_A[0], EN_A[1], ('Branch', 'branch'), *EN_A[2:]]
    put('M08-JUL-cashbook.xlsx', xlsx([sheet(table('R05-JUL', EN_A, titles_en('July 2026')), merges=['A1:H1'])]),
        {'twin': 'R05-JUL', 'layout': 'EN_A', 'header': 4})
    put('M08-AUG-cashbook.xlsx', xlsx([sheet(table('R05-AUG', inserted, titles_en('August 2026')), merges=['A1:I1'])]),
        {'twin': 'R05-AUG', 'layout': 'EN_A with Branch inserted third', 'header': 4})
    stories.append({
        'id': 'M08', 'title': 'A column inserted among the mapped ones shifts four of them',
        'actions': [hand('R05-JUL', 'M08-JUL-cashbook.xlsx', 4, EN_A_COLUMNS, save=MAIN),
                    by_map('R05-AUG', 'M08-AUG-cashbook.xlsx', MAIN),
                    hand('R05-AUG', 'M08-AUG-cashbook.xlsx', 4,
                         {'date': 2, 'voucher': 1, 'description': 6, 'reference': 5, 'receipts': 7, 'payments': 8})],
        'recipe': dict(recipes),
        'intent': [read_ok([MAIN]),
                   {'fits': False, 'problems': [('description', 'Reference', ['F4']), ('reference', 'Document No', ['E4']),
                                                ('receipts', 'Narration', ['G4']), ('payments', 'Debit', ['H4'])],
                    'store': [MAIN]},
                   read_ok([MAIN])],
    })

    # M09: the same labels with other white space.
    recipes = {}
    spaced = [('Voucher  No', 'voucher'), (' Date', 'date'), ('Document No', 'doc'), ('Reference ', 'reference'),
              ('Narration\t', 'description'), ('Debit', 'receipts'), ('Credit', 'payments'), ('Balance', 'balance')]
    put('M09-JUL-cashbook.xlsx', xlsx([sheet(table('R06-JUL', EN_A, titles_en('July 2026')), merges=['A1:H1'])]),
        {'twin': 'R06-JUL', 'layout': 'EN_A', 'header': 4})
    put('M09-AUG-cashbook.xlsx', xlsx([sheet(table('R06-AUG', spaced, titles_en('August 2026')), merges=['A1:H1'])]),
        {'twin': 'R06-AUG', 'layout': 'EN_A with extra white space in four labels', 'header': 4})
    stories.append({
        'id': 'M09', 'title': 'Labels written with other white space still fit',
        'actions': [hand('R06-JUL', 'M09-JUL-cashbook.xlsx', 4, EN_A_COLUMNS, save=MAIN),
                    by_map('R06-AUG', 'M09-AUG-cashbook.xlsx', MAIN)],
        'recipe': dict(recipes),
        'intent': [read_ok([MAIN]), read_ok([MAIN])],
    })

    # M10: a label in other letter case.
    recipes = {}
    upper = [*EN_A[:6], ('CREDIT', 'payments'), EN_A[7]]
    put('M10-JUL-cashbook.xlsx', xlsx([sheet(table('R07-JUL', EN_A, titles_en('July 2026')), merges=['A1:H1'])]),
        {'twin': 'R07-JUL', 'layout': 'EN_A', 'header': 4})
    put('M10-AUG-cashbook.xlsx', xlsx([sheet(table('R07-AUG', upper, titles_en('August 2026')), merges=['A1:H1'])]),
        {'twin': 'R07-AUG', 'layout': 'EN_A with CREDIT in capitals', 'header': 4})
    stories.append({
        'id': 'M10', 'title': 'A label in capitals does not fit',
        'actions': [hand('R07-JUL', 'M10-JUL-cashbook.xlsx', 4, EN_A_COLUMNS, save=MAIN),
                    by_map('R07-AUG', 'M10-AUG-cashbook.xlsx', MAIN),
                    hand('R07-AUG', 'M10-AUG-cashbook.xlsx', 4, EN_A_COLUMNS)],
        'recipe': dict(recipes),
        'intent': [read_ok([MAIN]),
                   {'fits': False, 'problems': [('payments', 'CREDIT', [])], 'store': [MAIN]},
                   read_ok([MAIN])],
    })

    # M11: Arabic labels, next month written decomposed.
    recipes = {}
    AR_COLUMNS = {'date': 2, 'voucher': 1, 'description': 5, 'reference': 4, 'receipts': 6, 'payments': 7}
    decomposed = [(unicodedata.normalize('NFD', label) if field == 'description' else label, field) for label, field in AR]
    assert decomposed[4][0] != AR[4][0]
    AR_NAME = 'الحساب الجاري الرئيسي'
    put('M11-JUL-cashbook.xlsx', xlsx([sheet(table('R20-JUL', AR, titles_ar()), merges=['A1:H1'])]),
        {'twin': 'R20-JUL', 'layout': 'AR', 'header': 3})
    put('M11-AUG-cashbook.xlsx', xlsx([sheet(table('R20-AUG', decomposed, titles_ar()), merges=['A1:H1'])]),
        {'twin': 'R20-AUG', 'layout': 'AR with the description label in NFD', 'header': 3})
    stories.append({
        'id': 'M11', 'title': 'Arabic labels: a decomposed hamza below still fits',
        'actions': [hand('R20-JUL', 'M11-JUL-cashbook.xlsx', 3, AR_COLUMNS, save=AR_NAME),
                    by_map('R20-AUG', 'M11-AUG-cashbook.xlsx', AR_NAME)],
        'recipe': dict(recipes),
        'intent': [read_ok([AR_NAME]), read_ok([AR_NAME])],
    })

    # M12: an imported Arabic map, and a label drawn with a tatweel.
    recipes = {}
    tatweel = [('المرجـع' if field == 'reference' else label, field) for label, field in AR]
    COLLECT = 'حساب التحصيل'
    put('M12-map.json', map_text(label_map(COLLECT, 3, AR, AR_COLUMNS)), {'map': COLLECT, 'layout': 'AR', 'header': 3})
    put('M12-cashbook.xlsx', xlsx([sheet(table('Q10-NOV', tatweel, titles_ar()), merges=['A1:H1'])]),
        {'twin': 'Q10-NOV', 'layout': 'AR with a tatweel in the reference label', 'header': 3})
    stories.append({
        'id': 'M12', 'title': 'An imported Arabic map does not fit a label drawn with a tatweel',
        'actions': [{'do': 'import', 'file': 'M12-map.json'},
                    by_map('Q10-NOV', 'M12-cashbook.xlsx', COLLECT),
                    hand('Q10-NOV', 'M12-cashbook.xlsx', 3, AR_COLUMNS)],
        'recipe': dict(recipes),
        'intent': [{'accepted': True, 'store': [COLLECT]},
                   {'fits': False, 'problems': [('reference', 'المرجـع', [])], 'store': [COLLECT]},
                   read_ok([COLLECT])],
    })

    # M13: typed amounts in the seventh and eighth columns, some with one decimal.
    recipes = {}
    put('M13-cashbook.xlsx', xlsx([sheet(table('Q11-NOV', EN_C, [['Cash book export']]))]),
        {'twin': 'Q11-NOV', 'layout': 'EN_C', 'header': 2, 'typed': 'amounts shortest, 8 with one decimal'})
    stories.append({
        'id': 'M13', 'title': 'Sixty-four entries with typed amounts in the seventh and eighth columns',
        'actions': [hand('Q11-NOV', 'M13-cashbook.xlsx', 2, EN_C_COLUMNS, save='Collections account')],
        'recipe': dict(recipes),
        'intent': [read_ok(['Collections account'])],
    })

    # M14: formulas and a hidden column outside the map, then a formula inside it.
    recipes = {}

    def balance_formulas(rows):
        for r in range(1, len(rows)):
            n = r + 1
            prev = 'Balance' if r == 1 else f'H{n - 1}'
            rows[r][7] = ('f', f'{OPENING / 100:.2f}+F{n}-G{n}' if r == 1 else f'{prev}+F{n}-G{n}', rows[r][7][1])

    def formula_payment(rows):
        balance_formulas(rows)
        k = next(i for i in range(1, len(rows)) if rows[i][6])
        assert k == 2, k
        rows[k][6] = ('f', f'ROUND({rows[k][6][1]},2)', rows[k][6][1])
    put('M14-cashbook.xlsx', xlsx([sheet(table('Q02-NOV', EN_D, extra=balance_formulas), hidden=[3])]),
        {'twin': 'Q02-NOV', 'layout': 'EN_D', 'header': 1, 'hidden': 'C', 'formulas': 'Balance'})
    put('M14-formula-cashbook.xlsx', xlsx([sheet(table('Q02-NOV', EN_D, extra=formula_payment), hidden=[3])]),
        {'twin': 'Q02-NOV', 'layout': 'EN_D', 'header': 1, 'hidden': 'C', 'formulas': 'Balance and G3'})
    stories.append({
        'id': 'M14', 'title': 'Formulas and a hidden column outside the map are not read; a formula inside it refuses',
        'actions': [hand('Q02-NOV', 'M14-cashbook.xlsx', 1, EN_D_COLUMNS, save='Operations account'),
                    by_map('Q02-NOV', 'M14-formula-cashbook.xlsx', 'Operations account')],
        'recipe': dict(recipes),
        'intent': [{**read_ok(['Operations account']), 'unread': ['Internal ID', 'Balance']},
                   {'fits': True, 'refused': ('CELL', 3), 'store': ['Operations account']}],
    })

    # M15: an opening balance above the header, then a totals row below the entries.
    recipes = {}
    above = [['Cash book — Settlement account'], ['', '', '', '', 'Opening balance', '', '', ('n', shortest(OPENING))]]

    def totals(rows):
        body = rows[3:]
        rows.append(['', '', '', '', 'Total', ('n', shortest(sum(minor(r[5][1]) for r in body if r[5]))),
                     ('n', shortest(sum(minor(r[6][1]) for r in body if r[6]))), body[-1][7]])
    put('M15-cashbook.xlsx', xlsx([sheet(table('Q05-NOV', EN_A, above))]),
        {'twin': 'Q05-NOV', 'layout': 'EN_A', 'header': 3, 'above': 'a title and an opening balance row'})
    put('M15-totals-cashbook.xlsx', xlsx([sheet(table('Q05-NOV', EN_A, above, extra=totals))]),
        {'twin': 'Q05-NOV', 'layout': 'EN_A', 'header': 3, 'below': 'a totals row at row 11'})
    stories.append({
        'id': 'M15', 'title': 'An opening balance above the header is not read; a totals row below refuses',
        'actions': [hand('Q05-NOV', 'M15-cashbook.xlsx', 3, EN_A_COLUMNS, save='Settlement account'),
                    by_map('Q05-NOV', 'M15-totals-cashbook.xlsx', 'Settlement account')],
        'recipe': dict(recipes),
        'intent': [{**read_ok(['Settlement account']), 'above': 2},
                   {'fits': True, 'refused': ('AMOUNT', 11), 'store': ['Settlement account']}],
    })

    # M16: a second sheet.
    recipes = {}
    put('M16-cashbook.xlsx', xlsx([sheet(table('Q03-NOV', EN_A, titles_en('November 2026')), merges=['A1:H1'])]),
        {'twin': 'Q03-NOV', 'layout': 'EN_A', 'header': 4})
    put('M16-two-sheets-cashbook.xlsx',
        xlsx([sheet(table('Q03-NOV', EN_A, titles_en('November 2026')), merges=['A1:H1']),
              sheet([['Prepared by the accounts team']], name='Notes')]),
        {'twin': 'Q03-NOV', 'layout': 'EN_A', 'header': 4, 'sheets': ['Cashbook', 'Notes']})
    stories.append({
        'id': 'M16', 'title': 'A workbook with a second sheet does not fit, by map or by hand',
        'actions': [hand('Q03-NOV', 'M16-cashbook.xlsx', 4, EN_A_COLUMNS, save=MAIN),
                    by_map('Q03-NOV', 'M16-two-sheets-cashbook.xlsx', MAIN),
                    hand('Q03-NOV', 'M16-two-sheets-cashbook.xlsx', 4, EN_A_COLUMNS)],
        'recipe': dict(recipes),
        'intent': [read_ok([MAIN]),
                   {'fits': False, 'problems': ['sheets'], 'store': [MAIN]},
                   {'fits': False, 'problems': ['sheets'], 'store': [MAIN]}],
    })

    # M17: a CSV export with a title row.
    recipes = {}
    put('M17-cashbook.csv', text_csv(table('Q01-NOV', CSV_G, [['Cash book export']], typed=False)),
        {'twin': 'Q01-NOV', 'layout': 'CSV_G', 'header': 2})
    stories.append({
        'id': 'M17', 'title': 'A CSV export with a title row, read by hand without saving',
        'actions': [hand('Q01-NOV', 'M17-cashbook.csv', 2, CSV_G_COLUMNS)],
        'recipe': dict(recipes),
        'intent': [read_ok([])],
    })

    # M18: a map file imported, exported, and corrupt ones refused.
    recipes = {}
    PAYROLL = 'Payroll account'
    valid = label_map(PAYROLL, 1, EN_B, EN_B_COLUMNS)
    put('M18-map.json', map_text(valid), {'map': PAYROLL, 'layout': 'EN_B', 'header': 1})
    bad = corrupt_maps(valid)
    for suffix, data, why in bad:
        put(f'M18-map-{suffix}.json', data, {'corrupt': why})
    put('M18-cashbook.xlsx', xlsx([sheet(table('Q04-NOV', EN_B))]), {'twin': 'Q04-NOV', 'layout': 'EN_B', 'header': 1})
    codes = {'truncated': 'MAP_JSON', 'array': 'MAP_JSON', 'latin1': 'MAP_JSON', 'nan': 'MAP_JSON',
             'oversize': 'MAP_JSON', 'template': 'MAP_FORMAT', 'version2': 'MAP_FORMAT', 'supplier': 'MAP_FORMAT',
             'currency': 'MAP_KEYS', 'sign': 'MAP_KEYS', 'name-space': 'MAP_NAME', 'header0': 'MAP_HEADER',
             'header31': 'MAP_HEADER', 'header-fraction': 'MAP_HEADER', 'no-date': 'MAP_COLUMN',
             'same-column': 'MAP_COLUMN', 'column101': 'MAP_COLUMN', 'empty-label': 'MAP_LABEL',
             'control-label': 'MAP_LABEL'}
    assert set(codes) == {s for s, _, _ in bad}
    stories.append({
        'id': 'M18', 'title': 'A map file is imported and exported; nineteen corrupt ones are refused',
        'actions': [*({'do': 'import', 'file': f'M18-map-{s}.json'} for s, _, _ in bad),
                    {'do': 'import', 'file': 'M18-map.json'},
                    by_map('Q04-NOV', 'M18-cashbook.xlsx', PAYROLL),
                    {'do': 'export', 'map': PAYROLL},
                    {'do': 'import', 'file': 'M18-map.json'}],
        'recipe': dict(recipes),
        'intent': [*({'accepted': False, 'code': codes[s], 'store': []} for s, _, _ in bad),
                   {'accepted': True, 'store': [PAYROLL]},
                   read_ok([PAYROLL]),
                   {'equals': 'M18-map.json'},
                   {'accepted': True, 'store': [PAYROLL]}],
    })

    # M19: an unlabelled column, and a row with nothing in the mapped columns.
    recipes = {}

    def note_in_blank(rows):
        rows[4][3] = 'see note'

    def carried_row(rows):
        rows.insert(3, ['', '', '', '', '', '', '', ('n', shortest(OPENING))])
    put('M19-note-cashbook.xlsx', xlsx([sheet(table('Q14-NOV', EN_F, extra=note_in_blank))]),
        {'twin': 'Q14-NOV', 'layout': 'EN_F', 'header': 1, 'value': 'D5 under an empty header'})
    put('M19-carried-cashbook.xlsx', xlsx([sheet(table('Q14-NOV', EN_F, extra=carried_row))]),
        {'twin': 'Q14-NOV', 'layout': 'EN_F', 'header': 1, 'row': 'row 4 holds only a balance'})
    stories.append({
        'id': 'M19', 'title': 'A value under an empty header, a column chosen without a label, and a row the map cannot read',
        'actions': [hand('Q14-NOV', 'M19-note-cashbook.xlsx', 1, EN_F_COLUMNS),
                    hand('Q14-NOV', 'M19-note-cashbook.xlsx', 1, {**EN_F_COLUMNS, 'description': 4}),
                    hand('Q14-NOV', 'M19-note-cashbook.xlsx', 1, {**EN_F_COLUMNS, 'payments': 6}),
                    hand('Q14-NOV', 'M19-carried-cashbook.xlsx', 1, EN_F_COLUMNS)],
        'recipe': dict(recipes),
        'intent': [{'fits': True, 'refused': ('COLUMN', 5), 'store': []},
                   {'invalid': 'MAP_LABEL', 'store': []},
                   {'invalid': 'MAP_COLUMN', 'store': []},
                   {'fits': True, 'refused': ('ROW', 4), 'store': []}],
    })

    # M20: the declared reading is unchanged and comes first.
    recipes = {}
    SPARE = 'Spare account'
    put('M20-map.json', map_text(label_map(SPARE, 4, EN_A, EN_A_COLUMNS)), {'map': SPARE, 'layout': 'EN_A', 'header': 4})
    put('M20-balance-cashbook.csv', text_csv(table('Q15-NOV', DECLARED + [('Balance', 'balance')], typed=False)),
        {'twin': 'Q15-NOV', 'layout': 'declared with Balance appended', 'header': 1})
    stories.append({
        'id': 'M20', 'title': 'The declared cashbook reads as today; one more column needs columns by hand',
        'actions': [{'do': 'import', 'file': 'M20-map.json'},
                    {**declared('Q15-NOV', 'Q15-NOV-cashbook.csv'), 'twin': True},
                    declared('Q15-NOV', 'M20-balance-cashbook.csv'),
                    hand('Q15-NOV', 'M20-balance-cashbook.csv', 1,
                         {'date': 1, 'voucher': 2, 'description': 3, 'reference': 4, 'receipts': 5, 'payments': 6})],
        'recipe': dict(recipes),
        'intent': [{'accepted': True, 'store': [SPARE]},
                   {'refused': None, 'cases': TWIN, 'store': [SPARE]},
                   {'refused': ('HEADER', 1), 'store': [SPARE]},
                   {**read_ok([SPARE]), 'unread': ['Balance']}],
    })

    # M21: a map whose header row a short file does not reach.
    recipes = {}
    TALL = 'Statement export account'
    put('M21-map.json', map_text(label_map(TALL, 12, EN_B, EN_B_COLUMNS)), {'map': TALL, 'layout': 'EN_B', 'header': 12})
    put('M21-cashbook.xlsx', xlsx([sheet(table('Q13-NOV', EN_B))]), {'twin': 'Q13-NOV', 'layout': 'EN_B', 'header': 1,
                                                                    'rows': 7})
    stories.append({
        'id': 'M21', 'title': 'A map whose header row is below the end of a short file',
        'actions': [{'do': 'import', 'file': 'M21-map.json'},
                    by_map('Q13-NOV', 'M21-cashbook.xlsx', TALL)],
        'recipe': dict(recipes),
        'intent': [{'accepted': True, 'store': [TALL]},
                   {'fits': False, 'problems': ['header-row'], 'store': [TALL]}],
    })

    for name, data in files.items():
        (out / name).write_bytes(data)
    facts = {'version': STORIES_VERSION, 'stories': stories}
    (out / 'stories.json').write_text(json.dumps(facts, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    return sorted([*files, 'stories.json'])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(HERE / 'frozen'))
    args = parser.parse_args()
    print('\n'.join(build(Path(args.out))))


if __name__ == '__main__':
    main()
