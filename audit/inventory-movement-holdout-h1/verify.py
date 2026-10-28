"""Independent check that every frozen H1 movement register and GL summary carries its story's cells
and its writer's form, read with a tokenizer written here (not the reader the
oracle uses): the byte-order mark, the line ends, which fields are quoted,
the padding, and every cell against stories.json; and that each scope file is
the story's period scope. Then a self-test: the check must fail on a copy with
one planted change.

  PYTHONPATH= python3 -B audit/inventory-movement-holdout-h1/verify.py frozen
"""
import hashlib
import json
import shutil
import sys
import tempfile
import unicodedata
from pathlib import Path

OWN = {'stories.json', 'EXPECTED.json', 'VERIFY.json', 'ELIGIBILITY.json', 'INPUT-MANIFEST.json', 'SEAL.json'}


def php_quotes(v):
    return any(ch in v for ch in ',"\n\r\t ')


def go_quotes(v):
    return v != '' and (any(ch in v for ch in ',"\r\n') or unicodedata.category(v[0])[0] == 'Z'
                        or v[0] in '\t\n\v\f\r\x85')


def plain_quotes(v):
    return any(ch in v for ch in ',"\r\n')


FORMS = {
    'php': {'bom': False, 'end': '\n', 'quoted': php_quotes, 'pad': False},
    'java': {'bom': False, 'end': '\r\n', 'quoted': plain_quotes, 'pad': False},
    'go': {'bom': False, 'end': '\r\n', 'quoted': go_quotes, 'pad': False},
    'perl': {'bom': True, 'end': '\r', 'quoted': plain_quotes, 'pad': False},
    'calc': {'bom': False, 'end': '\n', 'quoted': lambda v: v != '', 'pad': True},
}


def tokens(raw):
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


def check_file(path, f):
    form = FORMS[f['writer']]
    raw = path.read_bytes()
    out = []
    if raw.startswith(b'\xef\xbb\xbf') != form['bom']:
        out.append(f'{path.name}: byte-order mark')
    try:
        rows, ends = tokens(raw.decode('utf-8')[1 if form['bom'] else 0:])
    except (UnicodeDecodeError, ValueError) as e:
        return out + [f'{path.name}: {e}']
    if set(ends) != {form['end']}:
        out.append(f'{path.name}: line ends {sorted(set(ends))}')
    cells = f['cells']
    if f['writer'] == 'go':
        # Go's writer with UseCRLF drops a carriage return inside a field and
        # writes every line feed inside one as CRLF.
        cells = [[v.replace('\r', '').replace('\n', '\r\n') for v in r] for r in cells]
    if form['pad']:
        width = max(len(r) for r in cells)
        cells = [r + [''] * (width - len(r)) for r in cells]
    if [[t for t, _ in r] for r in rows] != cells:
        out.append(f'{path.name}: cells differ from the story')
    for r in rows:
        for t, q in r:
            if q != form['quoted'](t):
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
        for f in story['files'].values():
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
    ('one value changed', lambda d: edit(d / 'H01-register.csv', b'3400.00', b'3400.01')),
    ('one line dropped', lambda d: edit(d / 'H03-register.csv', b'PH00002,', b'')),
    ('byte-order mark removed', lambda d: edit(d / 'H03-register.csv', b'\xef\xbb\xbf', b'')),
    ('LF in a CR file', lambda d: edit(d / 'H03-register.csv', b'Origin ID\r', b'Origin ID\n')),
    ('a field quoted that needs none', lambda d: edit(d / 'H02-register.csv', b',Kind,', b',"Kind",')),
    ('a field with a space left unquoted by PHP', lambda d: edit(d / 'H01-register.csv', b'"Movement ID"',
                                                                 b'Movement ID')),
    ('LF in a CRLF file', lambda d: edit(d / 'H05-register.csv', b'Origin ID\r\n', b'Origin ID\n')),
    ('one GL value changed', lambda d: edit(d / 'H23-gl.csv', b'14100,', b'14100,1')),
    ('scope negative balances changed', lambda d: edit(d / 'H14-scope.json', b'"allowed"', b'"not allowed"')),
    ('a file no story names', lambda d: (d / 'H33-register.csv').write_bytes(b'Movement ID\n')),
    ('an Arabic-Indic digit changed', lambda d: edit(d / 'H27-gl.csv', '\u0661'.encode(), '\u0662'.encode())),
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
        'schema': 'tarasuf-inv2-movement-bridge-h1-verify/1',
        'factsSha256': hashlib.sha256((folder / 'stories.json').read_bytes()).hexdigest(),
        'files': 3 * len(stories),
        'cells': sum(len(r) for s in stories for f in s['files'].values() for r in f['cells']),
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
