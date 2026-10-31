"""Independent check that every frozen register carries its story's cells
and its writer's form, read with a tokenizer written here (not the reader
the oracle uses): the byte-order mark, the encoding, the line ends, which
fields are quoted, the padding, and every cell against stories.json; and
that each scope file is the story's run scope. Then a self-test: the check
must fail on a copy with one planted change.

  PYTHONPATH= python3 -B audit/payroll-long-register-foundation/verify.py frozen
"""
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

FORMS = {
    'py': {'bom': False, 'encoding': 'utf-8', 'end': '\n', 'quoted': 'minimal', 'pad': False},
    'py-pad': {'bom': True, 'encoding': 'utf-8', 'end': '\r\n', 'quoted': 'minimal', 'pad': True},
    'node': {'bom': False, 'encoding': 'utf-8', 'end': '\r\n', 'quoted': 'all', 'pad': False},
    'raw': {'bom': False, 'encoding': 'utf-8', 'end': '\n', 'quoted': 'none', 'pad': False},
    'cp1256': {'bom': False, 'encoding': 'cp1256', 'end': '\r\n', 'quoted': 'minimal', 'pad': False},
}
OWN = {'stories.json', 'EXPECTED.json', 'VERIFY.json', 'INPUT-MANIFEST.json', 'SEAL.json'}


def tokens(raw):
    """RFC 4180 records as [(text, quoted)], an empty line as [], and every
    line end seen."""
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
        elif c == ',':
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


def split(raw):
    """A file written with no quoting: lines and commas only."""
    if not raw.endswith('\n') or '\r' in raw:
        raise ValueError('not LF lines')
    lines = raw[:-1].split('\n')
    return [[(c, False) for c in ln.split(',')] if ln else [] for ln in lines], ['\n'] * len(lines)


def needs_quotes(v):
    return any(ch in v for ch in ',"\r\n')


def check_file(path, f):
    form = FORMS[f['writer']]
    raw = path.read_bytes()
    out = []
    if raw.startswith(b'\xef\xbb\xbf') != form['bom']:
        out.append(f'{path.name}: byte-order mark')
    try:
        text = raw.decode(form['encoding'])[1 if form['bom'] else 0:]
        if form['encoding'] != 'utf-8':
            try:
                raw.decode('utf-8')
                out.append(f'{path.name}: also valid UTF-8')
            except UnicodeDecodeError:
                pass
        rows, ends = split(text) if form['quoted'] == 'none' else tokens(text)
    except (UnicodeDecodeError, ValueError) as e:
        return out + [f'{path.name}: {e}']
    if set(ends) != {form['end']}:
        out.append(f'{path.name}: line ends {sorted(set(ends))}')
    cells = f['cells']
    if form['pad']:
        width = max(len(r) for r in cells)
        cells = [r + [''] * (width - len(r)) for r in cells]
    if [[t for t, _ in r] for r in rows] != cells:
        out.append(f'{path.name}: cells differ from the story')
    if form['quoted'] != 'none':
        for r in rows:
            for t, q in r:
                if q != (form['quoted'] == 'all' or needs_quotes(t)):
                    out.append(f'{path.name}: quoting of {t!r}')
                    break
    return out


def problems(folder):
    folder = Path(folder)
    facts = json.loads((folder / 'stories.json').read_text(encoding='utf-8'))
    out, named = [], set(OWN)
    for story in facts['stories']:
        scope = folder / f"{story['id']}-scope.json"
        named.add(scope.name)
        want = json.dumps(story['runScope'], ensure_ascii=False, indent=1) + '\n'
        if not scope.exists() or scope.read_text(encoding='utf-8') != want:
            out.append(f'{scope.name}: not the run scope')
        f = story['file']
        named.add(f['name'])
        path = folder / f['name']
        out += check_file(path, f) if path.exists() else [f"{f['name']}: absent"]
    extra = sorted({p.name for p in folder.iterdir()} - named)
    if extra:
        out.append(f'files no story names: {extra}')
    return out


def edit(path, before, after):
    raw = path.read_bytes()
    assert raw.count(before) >= 1, (path, before)
    path.write_bytes(raw.replace(before, after, 1))


PLANTS = [
    ('one amount changed', lambda d: edit(d / 'P01-register.csv', b'12000.00', b'12000.01')),
    ('one line dropped', lambda d: edit(d / 'P13-register.csv', b'L-0010,E-1302,', b'')),
    ('byte-order mark removed', lambda d: edit(d / 'P02-register.csv', b'\xef\xbb\xbf', b'')),
    ('LF in a CRLF file', lambda d: edit(d / 'P03-register.csv', b'"Section","PG-1"\r\n', b'"Section","PG-1"\n')),
    ('a field quoted that needs none', lambda d: edit(d / 'P01-register.csv', b'Section,PG-1\n', b'"Section",PG-1\n')),
    ('padding removed', lambda d: edit(d / 'P02-register.csv', b'Section,PG-1,,,,,\r\n', b'Section,PG-1\r\n')),
    ('scope payment date moved', lambda d: edit(d / 'P06-scope.json', b'2026-09-28', b'2026-09-29')),
    ('a file no story names', lambda d: (d / 'P39-register.csv').write_bytes(b'Section,PG-1\n')),
    ('Windows Arabic saved as UTF-8', lambda d: (d / 'P34-register.csv').write_bytes(
        (d / 'P34-register.csv').read_bytes().decode('cp1256').encode('utf-8'))),
    ('the raw file quoted', lambda d: edit(d / 'P35-register.csv', b'Allowance "A"', b'"Allowance ""A"""')),
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
    result = {
        'schema': 'tarasuf-pay1-long-register-verify/1',
        'factsSha256': hashlib.sha256((folder / 'stories.json').read_bytes()).hexdigest(),
        'files': 2 * len(json.loads((folder / 'stories.json').read_text(encoding='utf-8'))['stories']),
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
