"""Independent check of the MAP-1 foundation's inputs before the seal.

  python3 -B audit/bank-map-foundation/verify.py [frozen] [--write]

For every cashbook a story reads, it reads the file with its own small
XLSX reader (ZIP and XML, shared strings, cached formula values) or with
Python's csv module, finds the header row by its own dictionary of the
labels the layouts use, and requires the rows with a voucher to hold the
declared twin's entries exactly: dates, vouchers, descriptions, references
and amounts, references empty only where the file has no reference column.
It reports the rows that hold no voucher, so that what a story plants
around the entries is visible. Every statement, twin and set of facts a
story names must be byte for byte the one its own package sealed. Planted
changes to copies (an amount, a voucher, a reference, a dropped entry, a
changed sealed source) must be rejected. It shares no code with the
generator or the oracle.
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
# Every label the layouts use, folded (NFC, white space, case and tatweel),
# and what it holds. A column not here is one the verification ignores.
LABELS = {
    'date': 'date', 'txn date': 'date', 'posting date': 'date', 'التاريخ': 'date',
    'voucher': 'voucher', 'voucher no': 'voucher', 'doc ref': 'voucher', 'رقم السند': 'voucher',
    'description': 'description', 'narration': 'description', 'particulars': 'description', 'الإيضاح': 'description',
    'reference': 'reference', 'cheque/ref': 'reference', 'المرجع': 'reference',
    'receipts': 'receipts', 'debit': 'receipts', 'money in': 'receipts', 'مدين': 'receipts',
    'payments': 'payments', 'credit': 'payments', 'money out': 'payments', 'دائن': 'payments',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fold(s):
    s = unicodedata.normalize('NFC', s).replace('ـ', '')
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
    root = ET.fromstring(z.read('xl/' + target))
    rows = {}
    for c in root.iter(f'{NS}c'):
        m = re.fullmatch(r'([A-Z]+)(\d+)', c.get('r'))
        col = 0
        for ch in m[1]:
            col = col * 26 + ord(ch) - 64
        v = c.find(f'{NS}v')
        text = shared[int(v.text)] if c.get('t') == 's' else (v.text if v is not None else '')
        rows.setdefault(int(m[2]), {})[col] = text
    return {'sheets': len(sheets), 'rows': rows}


def csv_rows(path):
    rows = list(csv.reader(io.StringIO(path.read_bytes().decode('utf-8'), newline='')))
    return {'sheets': 1, 'rows': {r: {c: v for c, v in enumerate(row, 1)} for r, row in enumerate(rows, 1)}}


def twin_entries(source, period):
    rows = list(csv.reader(io.StringIO((AUDIT / source / 'frozen' / f'{period}-cashbook.csv').read_bytes()
                                       .decode('utf-8'), newline='')))
    return [{'date': r[0], 'voucher': r[1], 'description': r[2], 'reference': r[3],
             'receipts': Decimal(r[4] or '0'), 'payments': Decimal(r[5] or '0')} for r in rows[1:]]


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
        return {'sheets': table['sheets'], 'header': None, 'entries': [], 'others': []}
    by_field = {f: c for c, f in fields.items()}
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
                        'receipts': Decimal(get('receipts') or '0'), 'payments': Decimal(get('payments') or '0')})
    return {'sheets': table['sheets'], 'header': header, 'entries': entries, 'others': others,
            'reference': 'reference' in by_field}


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
            if not got['reference']:
                want = [dict(e, reference='') for e in want]
            equal = got['entries'] == want
            files[key] = {'sheets': got['sheets'], 'header': got['header'], 'entries': len(got['entries']),
                          'others': got['others'], 'twin': f"{action['source']}/{action['period']}",
                          'equal': equal}
            if not equal:
                problems.append(f'{key} does not hold the twin entries')
    return {'passed': not problems, 'problems': problems, 'files': files, 'sources': sources,
            'factsSha256': sha((frozen / 'stories.json').read_bytes())}


def self_test(frozen):
    out = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)

        def run(plant_name, file, change, audit=AUDIT):
            copy = tmp / plant_name
            shutil.copytree(frozen, copy)
            path = copy / file
            path.write_bytes(change(path.read_bytes()))
            out.append({'plant': plant_name, 'rejected': not check(copy, audit)['passed']})

        def in_csv(old, new):
            return lambda b: b.replace(old.encode(), new.encode(), 1)

        def in_sheet(old, new):
            def change(data):
                src = zipfile.ZipFile(io.BytesIO(data))
                buf = io.BytesIO()
                with zipfile.ZipFile(buf, 'w') as z:
                    for info in src.infolist():
                        body = src.read(info.filename)
                        if info.filename == 'xl/sharedStrings.xml':
                            body = body.replace(old.encode(), new.encode(), 1)
                        z.writestr(info, body)
                return buf.getvalue()
            return change
        def first_amount(data):
            lines = data.decode('utf-8').split('\r\n')
            cells = lines[2].split(',')
            k = 5 if cells[5] else 6
            cells[k] = str(Decimal(cells[k]) + Decimal('0.01'))
            lines[2] = ','.join(cells)
            return '\r\n'.join(lines).encode('utf-8')
        first = csv_rows(AUDIT / 'bank-review-foundation' / 'frozen' / 'Q01-NOV-cashbook.csv')['rows'][2]
        run('csv-amount', 'M17-cashbook.csv', first_amount)
        run('csv-reference', 'M17-cashbook.csv', in_csv(first[4], first[4] + 'X'))
        run('xlsx-voucher', 'M01-JUL-cashbook.xlsx', in_sheet('PV-17JUL01', 'PV-17JUL0I'))
        run('xlsx-amount', 'M13-cashbook.xlsx', _sheet(lambda body: re.sub(
            rb'(<c r="[GH]\d+"><v>)([^<]+)', lambda m: m[1] + str(Decimal(m[2].decode()) + 1).encode(), body, count=1)))
        run('xlsx-dropped-row', 'M04-B-cashbook.xlsx', _sheet(lambda body: re.sub(
            rb'<row r="\d+">(?:(?!<row ).)*</row></sheetData>', b'</sheetData>', body, flags=re.S)))
        sealed_copy = tmp / 'audit'
        sealed_copy.mkdir()
        for package in ('bank-roll-foundation', 'bank-review-foundation'):
            shutil.copytree(AUDIT / package / 'frozen', sealed_copy / package / 'frozen')
        path = sealed_copy / 'bank-roll-foundation' / 'frozen' / 'R17-AUG-cashbook.csv'
        path.write_bytes(path.read_bytes().replace(b'TRF-17AUG02', b'TRF-17AUG20', 1))
        out.append({'plant': 'sealed-twin-changed', 'rejected': not check(frozen, sealed_copy)['passed']})
    return out


def _sheet(edit):
    """A change to a workbook: edit(bytes) -> bytes on its first sheet."""
    def change(data):
        src = zipfile.ZipFile(io.BytesIO(data))
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as z:
            for info in src.infolist():
                body = src.read(info.filename)
                z.writestr(info, edit(body) if info.filename == 'xl/worksheets/sheet1.xml' else body)
        return buf.getvalue()
    return change


def main():
    frozen = Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else HERE / 'frozen'
    result = check(frozen)
    result['selfTest'] = self_test(frozen)
    text = json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True) + '\n'
    if '--write' in sys.argv:
        (frozen / 'VERIFY.json').write_text(text, encoding='utf-8')
    sys.stdout.write(text)
    if not result['passed'] or not all(p['rejected'] for p in result['selfTest']):
        sys.exit(1)


if __name__ == '__main__':
    main()
