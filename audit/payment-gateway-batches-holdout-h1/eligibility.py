"""What the product adds beyond the contract, checked on each PG-1 H1 file
without running the product. The reader of payment-gateway-batches-1 reads
a CSV by the comma alone and strictly, refuses a NUL, a stray or unclosed
quote or text after a closing quote (SOURCE) and a record of more than 100
cells (ROWS), where Python's csv module reads them; and a file over 8 MiB.
For XLSX it reads with the product reader, which refuses more than 40
sheets, 20,030 rows, 100 columns or a million cells, a cell over 32,767
characters or with a character XML 1.0 forbids, and marks as a row error
(CELL) or a header refusal (COLUMNS) what the oracle reads: a merged cell, a
hidden column, a hidden sheet, a row of zero height, a conditional format,
and a cell that is not text (a number, a date or a boolean shown through a
format). The 20,030-row ceiling is the contract's (ROWS) and is not counted
here. A CSV is decoded as the product decodes it, one byte-order mark
dropped, and split by verify.py's tokenizer; an XLSX is read from its XML.

  PYTHONPATH= python3 -B audit/payment-gateway-batches-holdout-h1/eligibility.py frozen
"""
import io
import json
import re
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import verify

REFUSED = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]')
MAIN = verify.MAIN


def check_csv(raw):
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        return ['not UTF-8: the contract refuses it too']
    if text.startswith('\ufeff'):
        text = text[1:]
    if '\x00' in text:
        return ['a NUL']
    try:
        rows, _ = verify.tokens(text if text.endswith(('\n', '\r')) else text + '\n')
    except ValueError:
        return ['a quote the strict comma grammar refuses']
    return ['cells in a record'] if any(len(r) > 100 for r in rows) else []


def check_xlsx(raw):
    z = zipfile.ZipFile(io.BytesIO(raw))
    book = ET.fromstring(z.read('xl/workbook.xml'))
    out = []
    sheets = book.findall(f'.//{MAIN}sheet')
    if len(sheets) > 40:
        out.append('sheets')
    if any(s.get('state') not in (None, 'visible') for s in sheets):
        out.append('a hidden sheet')
    strings = [''.join(t.text or '' for t in si.iter(MAIN + 't'))
               for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(MAIN + 'si')]
    sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    rows, width, count, texts = 0, 0, 0, []
    for row in sheet.iter(MAIN + 'row'):
        rows = max(rows, int(row.get('r')))
        if row.get('ht') is not None and float(row.get('ht')) == 0:
            out.append('a row of zero height')
        for c in row.findall(MAIN + 'c'):
            col = 0
            for ch in re.match(r'[A-Z]+', c.get('r')).group(0):
                col = col * 26 + ord(ch) - 64
            width = max(width, col)
            v = c.find(MAIN + 'v')
            if v is None and c.find(MAIN + 'is') is None:
                continue
            count += 1
            if c.get('t') not in ('s', 'inlineStr', 'str'):
                out.append('a cell that is not text')
            texts.append(strings[int(v.text)] if c.get('t') == 's' else
                         ''.join(t.text or '' for t in c.iter(MAIN + 't')) or (v.text if v is not None else ''))
    if rows > 20030 or width > 100 or rows * width > 1_000_000:
        out.append('rows, columns or cells')
    if sheet.find(f'{MAIN}mergeCells') is not None:
        out.append('merged cells')
    if any(c.get('hidden') in ('1', 'true') for c in sheet.iter(MAIN + 'col')):
        out.append('a hidden column')
    if sheet.find(f'{MAIN}conditionalFormatting') is not None:
        out.append('a conditional format')
    if any(REFUSED.search(t) for t in texts):
        out.append('a character the reader refuses')
    if any(len(t) > 32767 for t in texts):
        out.append('cell length')
    return sorted(set(out))


def check(path):
    raw = path.read_bytes()
    out = []
    if len(path.name) > 255 or not re.search(r'\.(csv|xlsx)$', path.name, re.I):
        out.append('name')
    if len(raw) > 8 * 1024 * 1024:
        out.append('size')
    if path.name.lower().endswith('.xlsx'):
        return out + check_xlsx(raw)
    return out + check_csv(raw)


def planted(folder, name, change):
    """What the check finds on one file after one planted change."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / name
        path.write_bytes(change((folder / name).read_bytes()))
        return check(path)


def in_sheet(raw, before, after):
    z = zipfile.ZipFile(io.BytesIO(raw))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as w:
        for item in z.infolist():
            data = z.read(item.filename)
            if item.filename == 'xl/worksheets/sheet1.xml':
                assert before in data, before
                data = data.replace(before, after, 1)
            w.writestr(item, data)
    return buf.getvalue()


PLANTS = [
    ('a stray quote in a CSV', 'H01-transactions.csv', lambda raw: raw.replace(b'ORD-28030101', b'ORD"28030101', 1)),
    ('a NUL in a CSV', 'H02-fees.csv', lambda raw: raw.replace(b'CHG', b'C\x00G', 1)),
    ('a record of 101 cells', 'H03-payout-lines.csv', lambda raw: raw.rstrip(b'\r\n') + b',' * 100 + b'\r\n'),
    ('a merged cell', 'H19-fees.xlsx', lambda raw: in_sheet(raw, b'</sheetData>',
                                                            b'</sheetData><mergeCells count="1">'
                                                            b'<mergeCell ref="A2:B2"/></mergeCells>')),
    ('a number cell', 'H19-settlements.xlsx', lambda raw: in_sheet(raw, b't="s"', b't="n"')),
    ('a row of zero height', 'H19-transactions.xlsx', lambda raw: in_sheet(raw, b' ht="12.8"', b' ht="0"')),
]


def main(folder):
    folder = Path(folder)
    facts = json.loads((folder / 'stories.json').read_text(encoding='utf-8'))
    found = {name: check(folder / name) for s in facts['stories'] for name in s['names']}
    self_test = [{'plant': what, 'found': bool(planted(folder, name, change))} for what, name, change in PLANTS]
    result = {
        'schema': 'tarasuf-pg1-batches-h1-eligibility/1',
        'checks': ['name', 'size', 'a NUL', 'a quote the strict comma grammar refuses', 'cells in a record',
                   'sheets', 'a hidden sheet', 'a row of zero height', 'a cell that is not text',
                   'rows, columns or cells', 'merged cells', 'a hidden column', 'a conditional format',
                   'a character the reader refuses', 'cell length'],
        'beyondContract': {k: v for k, v in found.items() if v},
        'selfTest': self_test,
    }
    (folder / 'ELIGIBILITY.json').write_text(json.dumps(result, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=1))


if __name__ == '__main__':
    main(sys.argv[1])
