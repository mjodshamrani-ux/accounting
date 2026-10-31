"""Independent check of the M4 holdout's inputs before the seal.

  python3 -B audit/bank-map-holdout-m4/verify.py [frozen] [--write]

For every cashbook a story reads, it reads the file with its own small
XLSX reader (ZIP and XML: shared and inline strings, sheet paths written
absolute or relative) or with Python's csv module (a byte order mark
dropped), finds the header row by its own dictionary of the labels the M4
layouts use, and requires the rows with a voucher to hold the declared
twin's entries exactly: dates, vouchers, descriptions, references and
amounts (as the doubles they denote), the ones a layout has no column for
empty. It reports the rows
that hold no voucher, so that what a story plants around the entries is
visible, and each workbook's sheets. Every statement, twin and set of facts
a story names must be byte for byte the one its own package sealed. Planted
changes to copies (an amount, a voucher, a reference, a dropped entry, a
changed sealed source) must be rejected. It shares no code with the
generator, the oracle or the product.
"""
import csv
import hashlib
import io
import json
import re
import shutil
import sys
import tempfile
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from decimal import Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUDIT = HERE.parent
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
# Every label the M4 layouts use, folded (NFC, white space and case), and
# what it holds. A column not here is one the verification ignores.
LABELS = {
    'date': 'date', 'posting date': 'date', 'value date': 'date', 'تاريخ القيد': 'date', 'date posted': 'date',
    'txn date': 'date',
    'voucher': 'voucher', 'doc. no.': 'voucher', 'doc no': 'voucher', 'voucher #': 'voucher', 'رقم القيد': 'voucher',
    'ref no': 'voucher', 'voucher ref': 'voucher',
    'description': 'description', 'narrative': 'description', 'memo': 'description', 'الوصف': 'description',
    'details': 'description',
    'reference': 'reference', 'cheque / ref.': 'reference', 'cheque / ref': 'reference',
    'ext. reference': 'reference', 'رقم الشيك': 'reference', 'cheque': 'reference',
    'receipts': 'receipts', 'money in': 'receipts', 'dr': 'receipts', 'إيداعات': 'receipts', 'in': 'receipts',
    'deposits': 'receipts',
    'payments': 'payments', 'money out': 'payments', 'cr': 'payments', 'مسحوبات': 'payments', 'out': 'payments',
    'withdrawals': 'payments',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fold(s):
    s = unicodedata.normalize('NFC', s).replace('\ufeff', '')
    return ' '.join(s.replace('\u00a0', ' ').split()).lower()


def xlsx_rows(path):
    """{'sheets': n, 'rows': {r: {c: text}}} of the first sheet."""
    z = zipfile.ZipFile(path)
    book = ET.fromstring(z.read('xl/workbook.xml'))
    sheets = book.findall(f'{NS}sheets/{NS}sheet')
    rels = {e.get('Id'): e.get('Target') for e in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(f'{NS}si'):
            shared.append(''.join(t.text or '' for t in si.iter(f'{NS}t')))
    target = rels[sheets[0].get(REL)]
    target = target[1:] if target.startswith('/') else 'xl/' + target
    root = ET.fromstring(z.read(target))
    rows = {}
    for c in root.iter(f'{NS}c'):
        m = re.fullmatch(r'([A-Z]+)(\d+)', c.get('r'))
        col = 0
        for ch in m[1]:
            col = col * 26 + ord(ch) - 64
        v = c.find(f'{NS}v')
        if c.get('t') == 's':
            text = shared[int(v.text)]
        elif c.get('t') == 'inlineStr':
            text = ''.join(t.text or '' for t in c.iter(f'{NS}t'))
        else:
            text = v.text if v is not None else ''
        rows.setdefault(int(m[2]), {})[col] = text
    return {'sheets': len(sheets), 'rows': rows}


def csv_rows(path):
    text = path.read_bytes().decode('utf-8')
    text = text[1:] if text.startswith('\ufeff') else text
    rows = list(csv.reader(io.StringIO(text, newline='')))
    return {'sheets': 1, 'rows': {r: {c: v for c, v in enumerate(row, 1)} for r, row in enumerate(rows, 1)}}


def amount(text):
    """An amount as the double it denotes: XlsxWriter stores a typed 9252.22
    as 9252.219999999999, sixteen significant digits of the same double."""
    return Decimal(repr(float(text))) if text else Decimal('0')


def twin_entries(source, period):
    rows = list(csv.reader(io.StringIO((AUDIT / source / 'frozen' / f'{period}-cashbook.csv').read_bytes()
                                       .decode('utf-8'), newline='')))
    return [{'date': r[0], 'voucher': r[1], 'description': r[2], 'reference': r[3],
             'receipts': amount(r[4]), 'payments': amount(r[5])} for r in rows[1:]]


def entries_of(path):
    table = xlsx_rows(path) if path.suffix == '.xlsx' else csv_rows(path)
    rows = table['rows']
    header, fields = None, {}
    for r in sorted(rows):
        found = {c: LABELS[fold(t)] for c, t in rows[r].items() if fold(t) in LABELS}
        if len(found) >= 4:
            header, fields = r, found
            break
    if header is None:
        return {'sheets': table['sheets'], 'header': None, 'entries': [], 'others': [], 'fields': []}
    # The first column of each field: a second date column repeats the first.
    by_field = {}
    for c in sorted(fields):
        by_field.setdefault(fields[c], c)
    entries, others = [], []
    for r in sorted(rows):
        if r <= header:
            continue
        cells = rows[r]
        voucher = cells.get(by_field.get('voucher'), '').strip()
        if not voucher:
            others.append(r)
            continue

        def get(field):
            return cells.get(by_field[field], '').strip() if field in by_field else ''
        entries.append({'date': get('date'), 'voucher': voucher, 'description': get('description'),
                        'reference': get('reference'),
                        'receipts': amount(get('receipts')), 'payments': amount(get('payments'))})
    return {'sheets': table['sheets'], 'header': header, 'entries': entries, 'others': others,
            'fields': sorted(by_field)}


def sealed(path):
    """Whether a file of a sealed package is byte for byte the one sealed."""
    manifest = json.loads((path.parent / 'INPUT-MANIFEST.json').read_text(encoding='utf-8'))
    entry = manifest['files'].get(path.name)
    return entry is not None and entry['sha256'] == sha(path.read_bytes())


def check(frozen, audit=AUDIT):
    facts = json.loads((frozen / 'stories.json').read_text(encoding='utf-8'))
    files, sources, problems = {}, {}, []
    for story in facts['stories']:
        for action in story['actions']:
            if 'period' not in action:
                continue
            folder = audit / action['source'] / 'frozen'
            for name in [f"{action['period']}-statement.pdf", f"{action['period']}-cashbook.csv", 'stories.json']:
                key = f"{action['source']}/{name}"
                if key not in sources:
                    sources[key] = sealed(folder / name)
                    if not sources[key]:
                        problems.append(f'{key} is not the sealed file')
            if action.get('twin'):
                continue
            key = action['file']
            if key in files:
                continue
            got = entries_of(frozen / key)
            want = twin_entries(action['source'], action['period'])
            for field in ('description', 'reference'):
                if field not in got['fields']:
                    want = [dict(e, **{field: ''}) for e in want]
            equal = got['entries'] == want
            files[key] = {'sheets': got['sheets'], 'header': got['header'], 'entries': len(got['entries']),
                          'others': got['others'], 'fields': got['fields'],
                          'twin': f"{action['source']}/{action['period']}", 'equal': equal}
            if not equal:
                problems.append(f'{key} does not hold the twin entries')
    return {'passed': not problems, 'problems': problems, 'files': files, 'sources': sources,
            'factsSha256': sha((frozen / 'stories.json').read_bytes())}


def _member(name, edit):
    """A change to one member of a workbook: edit(bytes) -> bytes."""
    def change(data):
        src = zipfile.ZipFile(io.BytesIO(data))
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as z:
            for info in src.infolist():
                body = src.read(info.filename)
                z.writestr(info, edit(body) if info.filename == name else body)
        return buf.getvalue()
    return change


def self_test(frozen):
    out = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)

        def run(plant_name, file, change, audit=AUDIT):
            copy = tmp / plant_name
            shutil.copytree(frozen, copy)
            path = copy / file
            before = path.read_bytes()
            after = change(before)
            # A plant that changes nothing would pass for a rejection by a
            # verifier that rejects for another reason; it must change.
            assert after != before, plant_name
            path.write_bytes(after)
            out.append({'plant': plant_name, 'rejected': not check(copy, audit)['passed']})

        def csv_amount(data):
            lines = data.decode('utf-8').split('\r\n')
            for i in range(1, len(lines)):
                cells = lines[i].split(',')
                if len(cells) > 5 and (cells[4] or cells[5]):
                    k = 4 if cells[4] else 5
                    cells[k] = str(Decimal(cells[k]) + Decimal('0.01'))
                    lines[i] = ','.join(cells)
                    break
            return '\r\n'.join(lines).encode('utf-8')

        def shared(old, new):
            return _member('xl/sharedStrings.xml', lambda b: b.replace(old.encode(), new.encode(), 1))
        first_jan = twin_entries('bank-roll-holdout-w4', 'H07-JAN')[0]
        run('csv-amount', 'P07-JAN-cashbook.csv', csv_amount)
        run('csv-reference', 'P07-JAN-cashbook.csv',
            lambda b: b.replace(first_jan['reference'].encode(), first_jan['reference'].encode() + b'X', 1))
        first_dec = twin_entries('bank-roll-holdout-w4', 'H01-DEC')[0]
        # openpyxl writes its strings inline, in the sheet itself.
        run('openpyxl-voucher', 'P01-DEC-cashbook.xlsx', _member(
            'xl/worksheets/sheet1.xml',
            lambda b: b.replace(first_dec['voucher'].encode(), first_dec['voucher'][:-1].encode() + b'I', 1)))
        run('exceljs-amount', 'P13-DEC-cashbook.xlsx', _member('xl/worksheets/sheet1.xml', lambda body: re.sub(
            rb'(<c r="[GH]\d+"[^>]*><v>)([^<]+)', lambda m: m[1] + str(Decimal(m[2].decode()) + 1).encode(),
            body, count=1)))
        run('xlsxwriter-dropped-row', 'P02-JAN-cashbook.xlsx', _member('xl/worksheets/sheet1.xml', lambda body: re.sub(
            rb'<row r="\d+"[^>]*>(?:(?!<row ).)*</row></sheetData>', b'</sheetData>', body, flags=re.S)))
        first_nov = twin_entries('bank-roll-holdout-w4', 'H04-NOV')[0]
        run('libreoffice-reference', 'P04-NOV-cashbook.xlsx',
            shared(first_nov['reference'], first_nov['reference'] + '0'))
        sealed_copy = tmp / 'audit'
        sealed_copy.mkdir()
        for package in ('bank-roll-holdout-w4', 'bank-sheet-holdout-r4', 'bank-review-holdout-r3'):
            shutil.copytree(AUDIT / package / 'frozen', sealed_copy / package / 'frozen')
        path = sealed_copy / 'bank-sheet-holdout-r4' / 'frozen' / 'K10-JAN-cashbook.csv'
        data = path.read_bytes()
        path.write_bytes(data[:-3] + bytes([data[-3] ^ 1]) + data[-2:])
        out.append({'plant': 'sealed-twin-changed', 'rejected': not check(frozen, sealed_copy)['passed']})
    return out


def main():
    frozen = Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else HERE / 'frozen'
    result = check(frozen)
    result['selfTest'] = self_test(frozen)
    text = json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True) + '\n'
    if '--write' in sys.argv:
        (frozen / 'VERIFY.json').write_text(text, encoding='utf-8')
    sys.stdout.write(text)
    # The plants mean something only on inputs that pass as they are.
    if not result['passed'] or not all(p['rejected'] for p in result['selfTest']):
        sys.exit(1)


if __name__ == '__main__':
    main()
