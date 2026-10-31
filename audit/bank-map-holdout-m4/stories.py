"""WF-1 MAP-1 M4 holdout: cashbooks of other writers and layouts never seen.

  python3 -B audit/bank-map-holdout-m4/stories.py [--out DIR] [--facts-only]

Twenty stories over periods of three sealed holdouts (ROLL-1 W4,
REPORT-1 R4 and REVIEW-1 R3), whose statements and declared cashbooks are
read here, never changed. Each story's cashbooks are its periods' declared
twins laid out again under labels and in places the foundation never used,
and written by other programs: openpyxl 3.1.5 and XlsxWriter 3.2.9
(write_python.py, under python3.13), exceljs 4.4.0 (write_exceljs.mjs), and
LibreOffice Calc 24.2 converting a flat OpenDocument file
(write_libreoffice.py); and CSV with and without a byte order mark. Maps
come from the stories' own saves, from another tool's file, and from new
corrupt files. The expectation is the sealed foundation oracle's
(audit/bank-map-foundation/oracle.py --frozen this package); each action
also carries an intent written here by hand, which test_intent.py holds
the oracle to. Nothing here imports the product.

The writers stamp times into their files, so a workbook is not made twice
alike: the seal holds each by its hash and VERIFY.json by its content. With
--facts-only no writer runs and every workbook is left empty; the facts,
the maps and the CSV files then regenerate byte for byte.
"""
import argparse
import csv
import io
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUDIT = HERE.parent
ROOT = AUDIT.parent
STORIES_VERSION = 'bank-map-holdout-m4-1'
SOURCES = {'H': 'bank-roll-holdout-w4', 'K': 'bank-sheet-holdout-r4', 'R': 'bank-review-holdout-r3'}
OPENING = 18000000  # the running balance the layouts print; never read
ROLES = ['date', 'voucher', 'description', 'reference', 'receipts', 'payments']
DECLARED = [('Date', 'date'), ('Voucher', 'voucher'), ('Description', 'description'),
            ('Reference', 'reference'), ('Receipts', 'receipts'), ('Payments', 'payments')]

# Layouts: (label, field). A field that is not a role is printed and never read.
ERP1 = [('Posting Date', 'date'), ('Doc. No.', 'voucher'), ('Narrative', 'description'),
        ('Cheque / Ref.', 'reference'), ('Money In', 'receipts'), ('Money Out', 'payments'),
        ('Running Balance', 'balance')]
ERP1_COLUMNS = {'date': 1, 'voucher': 2, 'description': 3, 'reference': 4, 'receipts': 5, 'payments': 6}
ERP1_INSERTED = ERP1[:1] + [('Value Date', 'date')] + ERP1[1:]
ERP1_INSERTED_COLUMNS = {'date': 1, 'voucher': 3, 'description': 4, 'reference': 5, 'receipts': 6, 'payments': 7}
ERP1_UPPER = [(label.upper() if field in ('receipts', 'payments') else label, field) for label, field in ERP1]
ERP1_NOREF = [x for x in ERP1 if x[1] != 'reference']
ERP1_NOREF_COLUMNS = {'date': 1, 'voucher': 2, 'description': 3, 'reference': None, 'receipts': 4, 'payments': 5}
ERP2 = [('Line', 'line'), ('Value Date', 'date'), ('Journal', 'journal'), ('Voucher #', 'voucher'),
        ('Memo', 'description'), ('Ext. Reference', 'reference'), ('Dr', 'receipts'), ('Cr', 'payments'),
        ('Cost Centre', 'cost')]
ERP2_COLUMNS = {'date': 2, 'voucher': 4, 'description': 5, 'reference': 6, 'receipts': 7, 'payments': 8}
AR2 = [('تاريخ القيد', 'date'), ('رقم القيد', 'voucher'), ('الوصف', 'description'), ('رقم الشيك', 'reference'),
       ('إيداعات', 'receipts'), ('مسحوبات', 'payments'), ('الرصيد', 'balance')]
AR2_COLUMNS = {'date': 1, 'voucher': 2, 'description': 3, 'reference': 4, 'receipts': 5, 'payments': 6}
# Labels written with no-break spaces, a doubled space and a trailing space,
# and the same labels written plainly: one normal form.
NB = [('Posting\u00a0Date', 'date'), ('Doc  No', 'voucher'), ('Narrative ', 'description'),
      ('Cheque\u00a0/ Ref', 'reference'), ('Money\u00a0In', 'receipts'), ('Money Out', 'payments')]
NB_PLAIN = [('Posting Date', 'date'), ('Doc No', 'voucher'), ('Narrative', 'description'),
            ('Cheque / Ref', 'reference'), ('Money In', 'receipts'), ('Money Out', 'payments')]
NB_COLUMNS = {'date': 1, 'voucher': 2, 'description': 3, 'reference': 4, 'receipts': 5, 'payments': 6}
CSV2 = [('Date posted', 'date'), ('Ref No', 'voucher'), ('Details', 'description'), ('Cheque', 'reference'),
        ('In', 'receipts'), ('Out', 'payments')]
CSV2_COLUMNS = NB_COLUMNS
MIN = [('Txn Date', 'date'), ('Voucher Ref', 'voucher'), ('Closing', 'balance'), ('Deposits', 'receipts'),
       ('Withdrawals', 'payments')]
MIN_COLUMNS = {'date': 1, 'voucher': 2, 'description': None, 'reference': None, 'receipts': 4, 'payments': 5}


def titles_erp1(period):
    return [['Northwind Distribution LLC'], ['Bank ledger 1010 — Current account'], [f'Exported for {period}'], []]


def titles_erp2():
    return [['GL account 1020 transactions']]


def titles_ar2():
    return [['مؤسسة الفجر للتوريدات'], ['كشف حساب البنك — الحساب الجاري ٢'], []]


def twin(period):
    """The declared cashbook a sealed holdout keeps for a period."""
    path = AUDIT / SOURCES[period[0]] / 'frozen' / f'{period}-cashbook.csv'
    rows = list(csv.reader(io.StringIO(path.read_bytes().decode('utf-8'), newline='')))
    assert rows[0] == [h for h, _ in DECLARED], path
    return [dict(zip(ROLES, r)) for r in rows[1:]]


def minor(text):
    whole, _, cents = text.partition('.')
    return int(whole) * 100 + int(cents.ljust(2, '0')) if text else 0


def shortest(m):
    sign, m = ('-' if m < 0 else ''), abs(m)
    return sign + f'{m // 100}.{m % 100:02d}'.rstrip('0').rstrip('.')


def table(period, layout, titles=(), typed=True, fmt=None, extra=None):
    """Title rows, the header, one row per entry of the twin. Amounts and
    balances are typed numbers when typed, with a number format when fmt."""
    rows = [list(t) for t in titles]
    rows.append([label for label, _ in layout])
    balance = OPENING
    code = period.replace('-', '')
    for k, entry in enumerate(twin(period)):
        balance += minor(entry['receipts']) - minor(entry['payments'])
        row = []
        for _, field in layout:
            if field in ROLES:
                value = entry[field]
                if typed and value and field in ('receipts', 'payments'):
                    value = {'n': shortest(minor(value)), **({'fmt': fmt} if fmt else {})}
            elif field == 'balance':
                value = {'n': shortest(balance)} if typed else shortest(balance)
            else:
                value = {'line': str(k + 1), 'journal': 'CB', 'cost': 'CC-210'}[field]
            row.append(value)
        rows.append(row)
    if extra:
        extra(rows)
    return rows


def sheet(rows, name='Ledger', merges=(), hidden=()):
    return {'name': name, 'rows': rows, 'merges': list(merges), 'hidden': list(hidden)}


WRITERS = {
    'openpyxl': ['python3.13', '-B', str(HERE / 'write_python.py')],
    'xlsxwriter': ['python3.13', '-B', str(HERE / 'write_python.py')],
    'exceljs': ['node', str(HERE / 'write_exceljs.mjs')],
    'libreoffice': [sys.executable, '-B', str(HERE / 'write_libreoffice.py')],
}


FACTS_ONLY = False


def workbook(writer, sheets):
    """The bytes the writer makes of these sheets."""
    if FACTS_ONLY:
        return b''
    with tempfile.TemporaryDirectory() as work:
        spec, out = Path(work) / 'spec.json', Path(work) / 'out.xlsx'
        spec.write_text(json.dumps({'writer': writer, 'sheets': sheets}, ensure_ascii=False), encoding='utf-8')
        subprocess.run([*WRITERS[writer], str(spec), str(out)], check=True, cwd=ROOT, timeout=240)
        return out.read_bytes()


def text_csv(rows, bom=False):
    out = io.StringIO()
    w = csv.writer(out, lineterminator='\r\n')
    for row in rows:
        w.writerow([v['n'] if isinstance(v, dict) else v for v in row])
    return (b'\xef\xbb\xbf' if bom else b'') + out.getvalue().encode('utf-8')


# ---- maps -----------------------------------------------------------------

def label_map(name, header, layout, columns):
    labels = {field: ' '.join(label.replace('\u00a0', ' ').split()) for label, field in layout}
    return {'format': 'tarasuf-column-map', 'version': 1, 'role': 'bank-cashbook', 'name': name, 'header': header,
            'columns': {r: ({'column': columns[r], 'label': labels[r]} if columns.get(r) else None) for r in ROLES}}


def map_text(m):
    return (json.dumps(m, ensure_ascii=False, indent=1) + '\n').encode('utf-8')


def other_tool(m):
    """The same map as another program writes it: keys in another order,
    two-space indent, CRLF, no final line break."""
    reordered = {'columns': {r: m['columns'][r] for r in reversed(ROLES)}, 'header': m['header'],
                 'name': m['name'], 'role': m['role'], 'version': m['version'], 'format': m['format']}
    return json.dumps(reordered, ensure_ascii=False, indent=2).replace('\n', '\r\n').encode('utf-8')


def corrupt_maps(valid):
    """(suffix, bytes, why) for the corrupt and odd maps of P17."""
    def edit(f):
        m = json.loads(json.dumps(valid))
        f(m)
        return map_text(m)
    text = map_text(valid).decode('utf-8')
    return [
        ('bom-name81', b'\xef\xbb\xbf' + edit(lambda m: m.update(name='N' * 81)), 'a BOM is dropped; the name is too long'),
        ('header-string', edit(lambda m: m.update(header='5')), 'a header row written as text'),
        ('column0', edit(lambda m: m['columns']['voucher'].update(column=0)), 'column 0'),
        ('extra-note', edit(lambda m: m.update(note='exported by the old system')), 'a key a map does not have'),
        ('no-format', edit(lambda m: m.pop('format')), 'the format key missing'),
        ('tab-label', edit(lambda m: m['columns']['receipts'].update(label='Money\tIn')), 'a tab inside a label'),
        ('payments-null', edit(lambda m: m['columns'].update(payments=None)), 'a required role without a column'),
        ('name-nfd', edit(lambda m: m.update(name='دفتر\u0627\u0653لحساب')), 'a name not in NFC'),
        ('label121', edit(lambda m: m['columns']['description'].update(label='N' * 121)), 'a label too long'),
        ('number-name', edit(lambda m: m.update(name=1010)), 'a name that is a number'),
        ('dup-header', text.replace('"header": 5', '"header": 5, "header": 40', 1).encode('utf-8'),
         'the last of two header keys is beyond 30'),
        ('header-float', text.replace('"header": 5', '"header": 5.0', 1).encode('utf-8'),
         '5.0 is the integer 5 to JSON.parse'),
        ('description-null', edit(lambda m: m['columns'].update(description=None)), 'an optional role left unread'),
    ]


# ---- stories --------------------------------------------------------------

def period(pid):
    return {'period': pid, 'source': SOURCES[pid[0]]}


def hand(pid, file, header, columns, save=None, as_name=None):
    a = {'do': 'read', **period(pid), 'file': file, 'by': 'hand', 'header': header,
         'columns': {r: columns.get(r) for r in ROLES}}
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


def declared(pid, file, twin_file=False):
    a = {'do': 'read', **period(pid), 'file': file, 'by': 'declared'}
    if twin_file:
        a['twin'] = True
    return a


def ok(store, cases='twin', **more):
    return {'fits': True, 'refused': None, 'cases': cases, 'store': store, **more}


def misfit(store, problems):
    return {'fits': False, 'problems': problems, 'store': store}


def build(out):
    out.mkdir(parents=True, exist_ok=True)
    files, stories, recipes = {}, [], {}

    def put(name, data, recipe):
        assert name not in files, name
        files[name] = data
        recipes[name] = recipe

    def story(sid, title, actions, intent):
        stories.append({'id': sid, 'title': title, 'actions': actions, 'intent': intent,
                        'recipe': {a['file']: recipes[a['file']] for a in actions
                                   if a.get('file') in recipes}})

    def erp1(pid, writer, layout=ERP1, **kw):
        return workbook(writer, [sheet(table(pid, layout, titles_erp1(pid), **kw), merges=['A1:G1'])])

    NW = 'Northwind current'
    GL = 'GL 1020'
    AR = 'الحساب الجاري ٢'

    # P01: openpyxl, a layout with a blank row above its header; next month fits.
    put('P01-DEC-cashbook.xlsx', erp1('H01-DEC', 'openpyxl'), {'writer': 'openpyxl', 'layout': 'ERP1', 'header': 5})
    put('P01-JAN-cashbook.xlsx', erp1('H01-JAN', 'openpyxl'), {'writer': 'openpyxl', 'layout': 'ERP1', 'header': 5})
    story('P01', 'openpyxl: the map saved in December reads January',
          [hand('H01-DEC', 'P01-DEC-cashbook.xlsx', 5, ERP1_COLUMNS, save=NW),
           by_map('H01-JAN', 'P01-JAN-cashbook.xlsx', NW)],
          [ok([NW], above=4, unread=['Running Balance']), ok([NW])])

    # P02: XlsxWriter in January, LibreOffice in February, one layout.
    for pid, writer in (('H02-JAN', 'xlsxwriter'), ('H02-FEB', 'libreoffice')):
        put(f'P02-{pid[4:]}-cashbook.xlsx', workbook(writer, [sheet(table(pid, ERP2, titles_erp2()))]),
            {'writer': writer, 'layout': 'ERP2', 'header': 2})
    story('P02', 'A map saved on an XlsxWriter file reads a LibreOffice file of the same layout',
          [hand('H02-JAN', 'P02-JAN-cashbook.xlsx', 2, ERP2_COLUMNS, save=GL),
           by_map('H02-FEB', 'P02-FEB-cashbook.xlsx', GL)],
          [ok([GL], above=1, unread=['Line', 'Journal', 'Cost Centre']), ok([GL])])

    # P03: exceljs, Arabic labels, an Arabic name with an Arabic-Indic digit.
    for pid in ('H03-FEB', 'H03-MAR'):
        put(f'P03-{pid[4:]}-cashbook.xlsx',
            workbook('exceljs', [sheet(table(pid, AR2, titles_ar2()), name='الدفتر', merges=['A1:G1', 'A2:G2'])]),
            {'writer': 'exceljs', 'layout': 'AR2', 'header': 4})
    story('P03', 'exceljs: Arabic labels and an Arabic map name',
          [hand('H03-FEB', 'P03-FEB-cashbook.xlsx', 4, AR2_COLUMNS, save=AR),
           by_map('H03-MAR', 'P03-MAR-cashbook.xlsx', AR)],
          [ok([AR], above=3, unread=['الرصيد']), ok([AR])])

    # P04: LibreOffice over three months; in January the export inserts a column.
    put('P04-NOV-cashbook.xlsx', erp1('H04-NOV', 'libreoffice'), {'writer': 'libreoffice', 'layout': 'ERP1', 'header': 5})
    put('P04-DEC-cashbook.xlsx', erp1('H04-DEC', 'libreoffice'), {'writer': 'libreoffice', 'layout': 'ERP1', 'header': 5})
    put('P04-JAN-cashbook.xlsx',
        workbook('libreoffice', [sheet(table('H04-JAN', ERP1_INSERTED, titles_erp1('H04-JAN')), merges=['A1:H1'])]),
        {'writer': 'libreoffice', 'layout': 'ERP1_INSERTED', 'header': 5})
    story('P04', 'A value-date column inserted in the third month: the map no longer fits',
          [hand('H04-NOV', 'P04-NOV-cashbook.xlsx', 5, ERP1_COLUMNS, save=NW),
           by_map('H04-DEC', 'P04-DEC-cashbook.xlsx', NW),
           by_map('H04-JAN', 'P04-JAN-cashbook.xlsx', NW),
           hand('H04-JAN', 'P04-JAN-cashbook.xlsx', 5, ERP1_INSERTED_COLUMNS)],
          [ok([NW]), ok([NW]),
           misfit([NW], [('voucher', 'Value Date', ['C5']), ('description', 'Doc. No.', ['D5']),
                         ('reference', 'Narrative', ['E5']), ('receipts', 'Cheque / Ref.', ['F5']),
                         ('payments', 'Money In', ['G5'])]),
           ok([NW], unread=['Value Date', 'Running Balance'])])

    # P05: XlsxWriter; next month a second title line moves the header down.
    put('P05-DEC-cashbook.xlsx', workbook('xlsxwriter', [sheet(table('H05-DEC', ERP2, titles_erp2()))]),
        {'writer': 'xlsxwriter', 'layout': 'ERP2', 'header': 2})
    put('P05-JAN-cashbook.xlsx',
        workbook('xlsxwriter', [sheet(table('H05-JAN', ERP2, titles_erp2() + [['Period: January 2027']]))]),
        {'writer': 'xlsxwriter', 'layout': 'ERP2', 'header': 3})
    story('P05', 'A second title line moves the header row down a row',
          [hand('H05-DEC', 'P05-DEC-cashbook.xlsx', 2, ERP2_COLUMNS, save=GL),
           by_map('H05-JAN', 'P05-JAN-cashbook.xlsx', GL),
           hand('H05-JAN', 'P05-JAN-cashbook.xlsx', 3, ERP2_COLUMNS)],
          [ok([GL]),
           misfit([GL], [(role, '', [cell]) for role, cell in (('date', 'B3'), ('voucher', 'D3'),
                                                                ('description', 'E3'), ('reference', 'F3'),
                                                                ('receipts', 'G3'), ('payments', 'H3'))]),
           ok([GL], above=2)])

    # P06: openpyxl labels with no-break spaces; exceljs labels written plainly.
    put('P06-DEC-cashbook.xlsx', workbook('openpyxl', [sheet(table('H06-DEC', NB))]),
        {'writer': 'openpyxl', 'layout': 'NB', 'header': 1})
    put('P06-JAN-cashbook.xlsx', workbook('exceljs', [sheet(table('H06-JAN', NB_PLAIN))]),
        {'writer': 'exceljs', 'layout': 'NB_PLAIN', 'header': 1})
    story('P06', 'Labels with no-break and doubled spaces fit the same labels written plainly',
          [hand('H06-DEC', 'P06-DEC-cashbook.xlsx', 1, NB_COLUMNS, save='Northwind NB'),
           by_map('H06-JAN', 'P06-JAN-cashbook.xlsx', 'Northwind NB')],
          [ok(['Northwind NB'], above=0, unread=[]), ok(['Northwind NB'])])

    # P07: CSV with a byte order mark before its header.
    for pid in ('H07-JAN', 'H07-FEB'):
        put(f'P07-{pid[4:]}-cashbook.csv', text_csv(table(pid, CSV2, typed=False), bom=True),
            {'writer': 'csv', 'bom': True, 'layout': 'CSV2', 'header': 1})
    story('P07', 'CSV with a byte order mark before the header',
          [hand('H07-JAN', 'P07-JAN-cashbook.csv', 1, CSV2_COLUMNS, save='Bank CSV'),
           by_map('H07-FEB', 'P07-FEB-cashbook.csv', 'Bank CSV')],
          [ok(['Bank CSV']), ok(['Bank CSV'])])

    # P08: exceljs; next month the amount labels are written in capitals.
    put('P08-DEC-cashbook.xlsx', erp1('H08-DEC', 'exceljs'), {'writer': 'exceljs', 'layout': 'ERP1', 'header': 5})
    put('P08-JAN-cashbook.xlsx', erp1('H08-JAN', 'exceljs', ERP1_UPPER),
        {'writer': 'exceljs', 'layout': 'ERP1_UPPER', 'header': 5})
    story('P08', 'Amount labels in capitals are other labels',
          [hand('H08-DEC', 'P08-DEC-cashbook.xlsx', 5, ERP1_COLUMNS, save=NW),
           by_map('H08-JAN', 'P08-JAN-cashbook.xlsx', NW),
           hand('H08-JAN', 'P08-JAN-cashbook.xlsx', 5, ERP1_COLUMNS, save=NW)],
          [ok([NW]), misfit([NW], [('receipts', 'MONEY IN', []), ('payments', 'MONEY OUT', [])]), ok([NW])])

    # P09: LibreOffice; next month's export adds a sheet of notes.
    put('P09-DEC-cashbook.xlsx', workbook('libreoffice', [sheet(table('H09-DEC', ERP2, titles_erp2()))]),
        {'writer': 'libreoffice', 'layout': 'ERP2', 'header': 2})
    put('P09-JAN-cashbook.xlsx',
        workbook('libreoffice', [sheet(table('H09-JAN', ERP2, titles_erp2())),
                                 sheet([['Exported by the ledger system'], ['No adjustments']], name='Notes')]),
        {'writer': 'libreoffice', 'layout': 'ERP2', 'header': 2, 'sheets': 2})
    story('P09', 'A second sheet: neither the map nor a choice by hand reads the file',
          [hand('H09-DEC', 'P09-DEC-cashbook.xlsx', 2, ERP2_COLUMNS, save=GL),
           by_map('H09-JAN', 'P09-JAN-cashbook.xlsx', GL),
           hand('H09-JAN', 'P09-JAN-cashbook.xlsx', 2, ERP2_COLUMNS)],
          [ok([GL]), misfit([GL], ['sheets']), misfit([GL], ['sheets'])])

    # P10: XlsxWriter; no description and no reference column.
    for pid in ('H10-FEB', 'H10-MAR'):
        put(f'P10-{pid[4:]}-cashbook.xlsx', workbook('xlsxwriter', [sheet(table(pid, MIN))]),
            {'writer': 'xlsxwriter', 'layout': 'MIN', 'header': 1})
    story('P10', 'Only the required roles have columns',
          [hand('H10-FEB', 'P10-FEB-cashbook.xlsx', 1, MIN_COLUMNS, save='Deposits ledger'),
           by_map('H10-MAR', 'P10-MAR-cashbook.xlsx', 'Deposits ledger')],
          # Without references the matcher has less to go on: the cases are
          # the oracle's, not the twin's, and the intent claims only a reading.
          [ok(['Deposits ledger'], cases=None, unread=['Closing']), ok(['Deposits ledger'], cases=None)])

    # P11: LibreOffice, Arabic, the balance column hidden; it is not read.
    for pid in ('K10-DEC', 'K10-JAN'):
        put(f'P11-{pid[4:]}-cashbook.xlsx',
            workbook('libreoffice', [sheet(table(pid, AR2, titles_ar2()), hidden=[7])]),
            {'writer': 'libreoffice', 'layout': 'AR2', 'header': 4, 'hidden': [7]})
    story('P11', 'A hidden column that no role reads',
          [hand('K10-DEC', 'P11-DEC-cashbook.xlsx', 4, AR2_COLUMNS, save='حساب التحصيل ٣'),
           by_map('K10-JAN', 'P11-JAN-cashbook.xlsx', 'حساب التحصيل ٣')],
          [ok(['حساب التحصيل ٣']), ok(['حساب التحصيل ٣'])])

    # P12: openpyxl; the reference column, which a role reads, is hidden.
    put('P12-FEB-cashbook.xlsx',
        workbook('openpyxl', [sheet(table('K11-FEB', ERP1, titles_erp1('K11-FEB')), merges=['A1:G1'], hidden=[4])]),
        {'writer': 'openpyxl', 'layout': 'ERP1', 'header': 5, 'hidden': [4]})
    # The intent first said row 6, the first entry. The oracle says row 5: the
    # header cell of a chosen column is a chosen cell, as the declared reading
    # refuses a hidden header column at its own header row. Corrected before
    # the seal, and recorded in README.ar.md.
    story('P12', 'A hidden column that a role reads refuses the cashbook at its header row',
          [hand('K11-FEB', 'P12-FEB-cashbook.xlsx', 5, ERP1_COLUMNS)],
          [{'fits': True, 'refused': ['CELL', 5], 'store': []}])

    # P13: exceljs; amounts typed with a thousands format.
    put('P13-DEC-cashbook.xlsx',
        workbook('exceljs', [sheet(table('K12-DEC', ERP2, titles_erp2(), fmt='#,##0.00'))]),
        {'writer': 'exceljs', 'layout': 'ERP2', 'header': 2, 'amounts': '#,##0.00'})
    story('P13', 'Amounts typed with a thousands format are read as typed',
          [hand('K12-DEC', 'P13-DEC-cashbook.xlsx', 2, ERP2_COLUMNS)],
          [ok([])])

    # P14: XlsxWriter; a totals row under the entries.
    def totals(rows):
        body = rows[5:]
        rows.append(['', '', 'Total', '', {'n': shortest(sum(minor(r[4]['n']) for r in body if r[4]))},
                     {'n': shortest(sum(minor(r[5]['n']) for r in body if r[5]))}, ''])
    put('P14-JAN-cashbook.xlsx',
        workbook('xlsxwriter', [sheet(table('K13-JAN', ERP1, titles_erp1('K13-JAN'), extra=totals),
                                      merges=['A1:G1'])]),
        {'writer': 'xlsxwriter', 'layout': 'ERP1', 'header': 5, 'totals': True})
    entries14 = len(twin('K13-JAN'))
    story('P14', 'A totals row under the entries refuses the cashbook at that row',
          [hand('K13-JAN', 'P14-JAN-cashbook.xlsx', 5, ERP1_COLUMNS)],
          [{'fits': True, 'refused': ['AMOUNT', 6 + entries14], 'store': []}])

    # P15: openpyxl; an opening balance line above the entries.
    def opening(rows):
        first = rows[5][0]
        rows.insert(5, [first, '', 'Opening balance', '', '', '', {'n': shortest(OPENING)}])
    put('P15-DEC-cashbook.xlsx',
        workbook('openpyxl', [sheet(table('K14-DEC', ERP1, titles_erp1('K14-DEC'), extra=opening),
                                    merges=['A1:G1'])]),
        {'writer': 'openpyxl', 'layout': 'ERP1', 'header': 5, 'opening': True})
    story('P15', 'An opening balance line refuses the cashbook at that line',
          [hand('K14-DEC', 'P15-DEC-cashbook.xlsx', 5, ERP1_COLUMNS)],
          [{'fits': True, 'refused': ['AMOUNT', 6], 'store': []}])

    # P16: a map written by another program, read on a LibreOffice file.
    valid16 = label_map(GL, 2, ERP2, ERP2_COLUMNS)
    put('P16-map.json', other_tool(valid16), {'map': 'another program: key order, indent, CRLF, no final newline'})
    put('P16-JAN-cashbook.xlsx', workbook('libreoffice', [sheet(table('K15-JAN', ERP2, titles_erp2()))]),
        {'writer': 'libreoffice', 'layout': 'ERP2', 'header': 2})
    story('P16', "Another program's file of the same map is the same map",
          [{'do': 'import', 'file': 'P16-map.json'}, by_map('K15-JAN', 'P16-JAN-cashbook.xlsx', GL)],
          [{'accepted': True, 'store': [GL]}, ok([GL])])

    # P17: corrupt and odd maps, then a valid one read on an XlsxWriter file.
    valid17 = label_map(NW, 5, ERP1, ERP1_COLUMNS)
    actions, intent = [], []
    codes = {'bom-name81': 'MAP_NAME', 'header-string': 'MAP_HEADER', 'column0': 'MAP_COLUMN',
             'extra-note': 'MAP_KEYS', 'no-format': 'MAP_FORMAT', 'tab-label': 'MAP_LABEL',
             'payments-null': 'MAP_COLUMN', 'name-nfd': 'MAP_NAME', 'label121': 'MAP_LABEL',
             'number-name': 'MAP_NAME', 'dup-header': 'MAP_HEADER', 'header-float': None,
             'description-null': None}
    store = []
    for suffix, data, why in corrupt_maps(valid17):
        put(f'P17-map-{suffix}.json', data, {'map': why})
        actions.append({'do': 'import', 'file': f'P17-map-{suffix}.json'})
        if codes[suffix] is None:
            store = [NW]
            intent.append({'accepted': True, 'store': store})
        else:
            intent.append({'accepted': False, 'code': codes[suffix], 'store': store})
    put('P17-map.json', map_text(valid17), {'map': 'the valid map'})
    put('P17-APR-cashbook.xlsx', erp1('R08-APR', 'xlsxwriter'), {'writer': 'xlsxwriter', 'layout': 'ERP1', 'header': 5})
    actions += [{'do': 'import', 'file': 'P17-map.json'}, by_map('R08-APR', 'P17-APR-cashbook.xlsx', NW),
                {'do': 'export', 'map': NW}]
    intent += [{'accepted': True, 'store': [NW]}, ok([NW]), {'equals': 'P17-map.json', 'store': [NW]}]
    story('P17', 'Corrupt and odd maps; the valid one replaces the odd one of the same name', actions, intent)

    # P18: the declared reading first: a declared CSV and a declared XLSX.
    put('P18-MAY-cashbook.xlsx', workbook('openpyxl', [sheet(table('R03-MAY', DECLARED, typed=False))]),
        {'writer': 'openpyxl', 'layout': 'DECLARED', 'header': 1})
    story('P18', 'Declared headers are read as declared, in CSV and in XLSX',
          [declared('R02-APR', 'R02-APR-cashbook.csv', twin_file=True),
           declared('R03-MAY', 'P18-MAY-cashbook.xlsx')],
          [{'refused': None, 'cases': 'twin', 'store': []}, {'refused': None, 'cases': 'twin', 'store': []}])

    # P19: LibreOffice; next month the export drops the reference column.
    put('P19-APR-cashbook.xlsx', erp1('R05-APR', 'libreoffice'), {'writer': 'libreoffice', 'layout': 'ERP1', 'header': 5})
    put('P19-MAY-cashbook.xlsx',
        workbook('libreoffice', [sheet(table('R06-MAY', ERP1_NOREF, titles_erp1('R06-MAY')), merges=['A1:F1'])]),
        {'writer': 'libreoffice', 'layout': 'ERP1_NOREF', 'header': 5})
    story('P19', 'A reference column dropped: the map does not fit; by hand the reference is left unread',
          [hand('R05-APR', 'P19-APR-cashbook.xlsx', 5, ERP1_COLUMNS, save=NW),
           by_map('R06-MAY', 'P19-MAY-cashbook.xlsx', NW),
           hand('R06-MAY', 'P19-MAY-cashbook.xlsx', 5, ERP1_NOREF_COLUMNS)],
          [ok([NW]),
           misfit([NW], [('reference', 'Money In', []), ('receipts', 'Money Out', ['D5']),
                         ('payments', 'Running Balance', ['E5'])]),
           ok([NW], cases=None)])

    # P20: XlsxWriter and exceljs, Arabic, a long month of forty-five suggestions.
    put('P20-JUN-cashbook.xlsx', workbook('xlsxwriter', [sheet(table('R04-JUN', AR2, titles_ar2()))]),
        {'writer': 'xlsxwriter', 'layout': 'AR2', 'header': 4})
    put('P20-JUN2-cashbook.xlsx', workbook('exceljs', [sheet(table('R07-JUN', AR2, titles_ar2()))]),
        {'writer': 'exceljs', 'layout': 'AR2', 'header': 4})
    story('P20', 'Arabic, a long month by hand, then another statement by the same map',
          [hand('R04-JUN', 'P20-JUN-cashbook.xlsx', 4, AR2_COLUMNS, save=AR),
           by_map('R07-JUN', 'P20-JUN2-cashbook.xlsx', AR)],
          [ok([AR]), ok([AR])])

    for name, data in files.items():
        (out / name).write_bytes(data)
    facts = {'version': STORIES_VERSION, 'sources': SOURCES, 'stories': stories}
    (out / 'stories.json').write_text(json.dumps(facts, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    return facts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(HERE / 'frozen'))
    ap.add_argument('--facts-only', action='store_true')
    a = ap.parse_args()
    global FACTS_ONLY
    FACTS_ONLY = a.facts_only
    out = Path(a.out)
    if out.exists():
        shutil.rmtree(out)
    facts = build(out)
    print(json.dumps({'stories': len(facts['stories']),
                      'actions': sum(len(s['actions']) for s in facts['stories']),
                      'files': len(list(out.iterdir()))}))


if __name__ == '__main__':
    main()
