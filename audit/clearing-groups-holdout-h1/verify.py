"""Independent check that every frozen CLR-1 H1 extract carries its story's
cells and its writer's form, read here without the csv module the oracle
uses: for CSV, a tokenizer written here with the story's separator, the
byte-order mark, the line ends, which fields are quoted and the padding; for
XLSX, the sheet's cells, hidden rows and formulas read from the XML; and each
input file equal to the story's name, reading and scope. Then a self-test:
the check must fail on a copy with one planted change.

  PYTHONPATH= python3 -B audit/clearing-groups-holdout-h1/verify.py frozen
"""
import hashlib
import io
import json
import re
import shutil
import sys
import tempfile
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

OWN = {'stories.json', 'EXPECTED.json', 'VERIFY.json', 'ELIGIBILITY.json', 'INPUT-MANIFEST.json', 'SEAL.json'}
MAIN = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def php_quotes(v, sep):
    return any(ch in v for ch in sep + '"\n\r\t ')


def go_quotes(v, sep):
    return v != '' and (any(ch in v for ch in sep + '"\r\n') or unicodedata.category(v[0])[0] == 'Z'
                        or v[0] in '\t\n\v\f\r\x85')


def plain_quotes(v, sep):
    return any(ch in v for ch in sep + '"\r\n')


FORMS = {
    'php': {'bom': False, 'end': '\n', 'quoted': php_quotes, 'pad': False},
    'java': {'bom': False, 'end': '\r\n', 'quoted': plain_quotes, 'pad': False},
    'go': {'bom': False, 'end': '\r\n', 'quoted': go_quotes, 'pad': False},
    'perl': {'bom': True, 'end': '\r', 'quoted': plain_quotes, 'pad': False},
    'calc': {'bom': False, 'end': '\n', 'quoted': lambda v, sep: v != '', 'pad': True},
}


def tokens(raw, sep):
    """RFC 4180 records as [(text, quoted)], an empty line as [], and every
    line end seen outside quotes."""
    rows, row, cell, quoted, ends = [], [], [], False, []
    i, inside, n = 0, False, len(raw)
    while i < n:
        c = raw[i]
        if inside:
            if c == '"':
                if i + 1 < n and raw[i + 1] == '"':
                    cell.append('"')
                    i += 1
                else:
                    inside = False
            else:
                cell.append(c)
        elif c == '"':
            if cell or quoted:
                raise ValueError('a quote inside an unquoted field')
            inside = quoted = True
        elif c == sep:
            row.append((''.join(cell), quoted))
            cell, quoted = [], False
        elif c in '\r\n':
            end = '\r\n' if raw[i:i + 2] == '\r\n' else c
            ends.append(end)
            i += len(end) - 1
            if row or cell or quoted:
                row.append((''.join(cell), quoted))
            rows.append(row)
            row, cell, quoted = [], [], False
        else:
            cell.append(c)
        i += 1
    if inside:
        raise ValueError('an unclosed quote')
    if cell or row or quoted:
        raise ValueError('no line end after the last record')
    return rows, ends


def check_csv(path, s):
    form = FORMS[s['writer']]
    raw = path.read_bytes()
    out = []
    if raw.startswith(b'\xef\xbb\xbf') != form['bom']:
        out.append(f'{path.name}: byte-order mark')
    try:
        rows, ends = tokens(raw.decode('utf-8')[1 if form['bom'] else 0:], s['comma'])
    except (UnicodeDecodeError, ValueError) as e:
        return out + [f'{path.name}: {e}']
    if set(ends) - {form['end']}:
        out.append(f'{path.name}: line ends {sorted(set(ends))}')
    cells = [list(r) for r in s['cells']]
    if form['pad']:
        width = max(len(r) for r in cells)
        cells = [r + [''] * (width - len(r)) for r in cells]
    # An empty record: the writers write a line of separators for a row of
    # empty cells, which reads as empty cells.
    if [[t for t, _ in r] for r in rows] != cells:
        out.append(f'{path.name}: cells differ from the story')
    for r in rows:
        for t, q in r:
            if q != form['quoted'](t, s['comma']):
                out.append(f'{path.name}: quoting of {t!r}')
                break
    return out


def check_xlsx(path, s):
    z = zipfile.ZipFile(io.BytesIO(path.read_bytes()))
    strings = ['' .join(t.text or '' for t in si.iter(MAIN + 't'))
               for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(MAIN + 'si')]
    sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    cells, hidden, formulas = {}, [], []
    for row in sheet.iter(MAIN + 'row'):
        r = int(row.get('r'))
        if row.get('hidden') in ('1', 'true'):
            hidden.append(r)
        for c in row.findall(MAIN + 'c'):
            col = 0
            for ch in re.match(r'[A-Z]+', c.get('r')).group(0):
                col = col * 26 + ord(ch) - 64
            v, f = c.find(MAIN + 'v'), c.find(MAIN + 'f')
            if f is not None:
                formulas.append([r, col, '=' + (f.text or '')])
            if v is not None:
                cells[(r, col)] = strings[int(v.text)] if c.get('t') == 's' else (v.text or '')
    want = {(r + 1, c + 1): v for r, row in enumerate(s['cells']) for c, v in enumerate(row) if v}
    out = []
    if cells != want:
        out.append(f'{path.name}: cells differ from the story')
    if hidden != s['hidden']:
        out.append(f'{path.name}: hidden rows')
    if sorted(formulas) != sorted(s['formulas']):
        out.append(f'{path.name}: formulas')
    return out


def problems(folder):
    folder = Path(folder)
    facts = json.loads((folder / 'stories.json').read_text(encoding='utf-8'))
    out, named = [], set(OWN)
    for s in facts['stories']:
        given = folder / f"{s['id']}-input.json"
        named |= {given.name, s['name']}
        want = json.dumps({'name': s['name'], 'reading': s['reading'], 'scope': s['scope']},
                          ensure_ascii=False, indent=1) + '\n'
        if not given.exists() or given.read_text(encoding='utf-8') != want:
            out.append(f'{given.name}: not the story input')
        path = folder / s['name']
        if not path.exists():
            out.append(f"{s['name']}: absent")
        elif s['writer'] == 'lo-xlsx':
            out += check_xlsx(path, s)
        else:
            out += check_csv(path, s)
    extra = sorted({p.name for p in folder.iterdir()} - named)
    if extra:
        out.append(f'files no story names: {extra}')
    return out


def edit(path, before, after):
    raw = path.read_bytes()
    assert raw.count(before) >= 1, (path, before)
    path.write_bytes(raw.replace(before, after, 1))


def edit_zip(path, member, before, after):
    z = zipfile.ZipFile(io.BytesIO(path.read_bytes()))
    assert before in z.read(member), (path, member, before)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as w:
        for item in z.infolist():
            data = z.read(item.filename)
            w.writestr(item, data.replace(before, after, 1) if item.filename == member else data)
    path.write_bytes(buf.getvalue())


PLANTS = [
    ('one amount changed', lambda d: edit(d / 'H01.csv', b'-900.00', b'-900.01')),
    ('one line dropped', lambda d: edit(d / 'H09.csv', b'V902,DEP-901,2027-11-08,-200.00,2430,SAR,Credit note\r\n', b'')),
    ('byte-order mark removed', lambda d: edit(d / 'H06.csv', b'\xef\xbb\xbf', b'')),
    ('LF in a CR file', lambda d: edit(d / 'H06.csv', b'Remarks\r', b'Remarks\n')),
    ('a semicolon read as a comma', lambda d: edit(d / 'H02.csv', b'V201;DEP-201', b'V201,DEP-201')),
    ('a quoted cell unquoted by Calc', lambda d: edit(d / 'H07.csv', b'"Subtotal"', b'Subtotal')),
    ('a trailing space dropped', lambda d: edit(d / 'H17.csv', b'"Room 12 "', b'"Room 12"')),
    ('an Arabic-Indic digit changed', lambda d: edit(d / 'H06.csv', '\u0664'.encode(), '\u0665'.encode())),
    ('an XLSX row no longer hidden', lambda d: edit_zip(d / 'H14.xlsx', 'xl/worksheets/sheet1.xml',
                                                        b'hidden="true"', b'hidden="false"')),
    ('an XLSX formula removed', lambda d: edit_zip(d / 'H15.xlsx', 'xl/worksheets/sheet1.xml',
                                                   b'<f aca="false">&quot;late&quot;&amp;&quot;fee&quot;</f>', b'')),
    ('an input period changed', lambda d: edit(d / 'H19-input.json', b'"2027-11-01"', b'"2027-10-01"')),
    ('a file no story names', lambda d: (d / 'H99.csv').write_bytes(b'Voucher\n')),
]


def main(folder):
    folder = Path(folder)
    found = problems(folder)
    self_test = []
    for name, plant in PLANTS:
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / 'frozen'
            shutil.copytree(folder, copy)
            plant(copy)
            self_test.append({'plant': name, 'rejected': bool(problems(copy))})
    stories = json.loads((folder / 'stories.json').read_text(encoding='utf-8'))['stories']
    result = {
        'schema': 'tarasuf-clr1-groups-h1-verify/1',
        'factsSha256': hashlib.sha256((folder / 'stories.json').read_bytes()).hexdigest(),
        'files': len(stories),
        'cells': sum(len(r) for s in stories for r in s['cells']),
        'passed': not found,
        'problems': found,
        'selfTest': self_test,
    }
    (folder / 'VERIFY.json').write_text(json.dumps(result, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=1))
    if found or not all(p['rejected'] for p in self_test):
        sys.exit(1)


if __name__ == '__main__':
    main(sys.argv[1])
