"""What the product's reader adds beyond the contract, checked on each CLR-1
H1 extract without running the product: a name of at most 255 characters
ending in .csv or .xlsx, a non-empty file of at most 8 MiB, no character
that the reader refuses in a cell (XML 1.0's forbidden control characters,
U+FFFE, U+FFFF), at most 100 cells in a record and at most 4,096 UTF-16
units in a cell; for XLSX, at most 40 sheets and a sheet of at most 20,030
rows and 100 columns. A CSV is decoded as the product decodes it, strictly,
the byte-order mark dropped, and split by verify.py's tokenizer with the
story's separator; an XLSX is read from its XML as in verify.py. The
20,030-row ceiling for a CSV is the contract's (ROWS), and the oracle
refuses a story over it.

  PYTHONPATH= python3 -B audit/clearing-groups-holdout-h1/eligibility.py frozen
"""
import io
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import verify

REFUSED = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]')


def units(text):
    return len(text.encode('utf-16-le')) // 2


def cells_of(rows):
    return [t for r in rows for t in r]


def check_csv(raw, sep):
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        return ['not UTF-8: the contract refuses it before any bound']
    if text.startswith('\ufeff'):
        text = text[1:]
    if REFUSED.search(text):
        return ['a character the reader refuses']
    rows, _ = verify.tokens(text if text.endswith(('\n', '\r')) else text + '\n', sep)
    out = []
    if any(len(r) > 100 for r in rows):
        out.append('cells in a record')
    if any(units(t) > 4096 for t in cells_of([[t for t, _ in r] for r in rows])):
        out.append('cell length')
    return out


def check_xlsx(raw):
    z = zipfile.ZipFile(io.BytesIO(raw))
    book = ET.fromstring(z.read('xl/workbook.xml'))
    out = []
    if len(book.findall(f'.//{verify.MAIN}sheet')) > 40:
        out.append('sheets')
    strings = [''.join(t.text or '' for t in si.iter(verify.MAIN + 't'))
               for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(verify.MAIN + 'si')]
    sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    rows, width, texts = 0, 0, []
    for row in sheet.iter(verify.MAIN + 'row'):
        rows = max(rows, int(row.get('r')))
        for c in row.findall(verify.MAIN + 'c'):
            col = 0
            for ch in re.match(r'[A-Z]+', c.get('r')).group(0):
                col = col * 26 + ord(ch) - 64
            width = max(width, col)
            v = c.find(verify.MAIN + 'v')
            if v is not None:
                texts.append(strings[int(v.text)] if c.get('t') == 's' else (v.text or ''))
    if rows > 20030 or width > 100:
        out.append('rows or columns')
    if any(REFUSED.search(t) for t in texts):
        out.append('a character the reader refuses')
    if any(units(t) > 4096 for t in texts):
        out.append('cell length')
    return out


def check(path, story):
    raw = path.read_bytes()
    out = []
    if len(path.name) > 255 or not re.search(r'\.(csv|xlsx)$', path.name, re.I):
        out.append('name')
    if not raw or len(raw) > 8 * 1024 * 1024:
        out.append('size')
    if path.name.lower().endswith('.xlsx'):
        return out + check_xlsx(raw)
    return out + check_csv(raw, story['comma'])


def main(folder):
    folder = Path(folder)
    facts = json.loads((folder / 'stories.json').read_text(encoding='utf-8'))
    found = {s['name']: check(folder / s['name'], s) for s in facts['stories']}
    result = {
        'schema': 'tarasuf-clr1-groups-h1-eligibility/1',
        'checks': ['name', 'size', 'a character the reader refuses', 'cells in a record', 'cell length',
                   'sheets', 'rows or columns'],
        'beyondContract': {k: v for k, v in found.items() if v},
    }
    (folder / 'ELIGIBILITY.json').write_text(json.dumps(result, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=1))


if __name__ == '__main__':
    main(sys.argv[1])
