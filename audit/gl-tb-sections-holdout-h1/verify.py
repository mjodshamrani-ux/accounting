"""Independent check that every H1 file carries its story's cells, read with
a tokenizer written here (not Python's csv module, not the foundation's
check): every cell against stories.json, each writer's observed form (line
ends, quoting, padding) against what that writer is known to do, and each
scope file against the story's run scope. Then a self-test: the check must
fail on a copy with one planted change.

  python3 -B audit/gl-tb-sections-holdout-h1/verify.py frozen
"""
import copy
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

# Line ends each writer produces, which fields it must quote, and whether it
# pads every row to the file's widest (LibreOffice Calc does).
FORMS = {
    'go': {'end': '\n', 'pad': False, 'quote': lambda v: any(c in v for c in ',"\r\n') or v[:1] in (' ', '\t')},
    'php': {'end': '\n', 'pad': False, 'quote': lambda v: any(c in v for c in ',"\r\n\t \\')},
    'libreoffice': {'end': '\n', 'pad': True, 'quote': lambda v: v != ''},
    'java': {'end': '\r\n', 'pad': False,
             'quote': lambda v: any(c in v for c in ',"\r\n') or v[:1] == ' ' or v[-1:] == ' '},
}


def records(raw):
    """RFC 4180 records as [(text, quoted)], an empty line as [], and the
    line ends seen."""
    out, row, cell, quoted, inside, ends, i = [], [], '', False, False, set(), 0
    while i < len(raw):
        c = raw[i]
        if inside:
            if c == '"' and raw[i + 1:i + 2] == '"':
                cell += '"'
                i += 1
            elif c == '"':
                inside = False
            else:
                cell += c
        elif c == '"':
            if cell or quoted:
                raise ValueError('quote inside a field')
            inside = quoted = True
        elif c == ',':
            row.append((cell, quoted))
            cell, quoted = '', False
        elif c in '\r\n':
            end = '\r\n' if raw[i:i + 2] == '\r\n' else c
            ends.add(end)
            i += len(end) - 1
            if row or cell or quoted:
                row.append((cell, quoted))
            out.append(row)
            row, cell, quoted = [], '', False
        else:
            cell += c
        i += 1
    if inside or cell or row or quoted:
        raise ValueError('the file does not end with a line end')
    return out, ends


def check_file(path, f):
    data = path.read_bytes()
    problems = []
    if data.startswith(b'\xef\xbb\xbf'):
        problems.append('byte-order mark')
    try:
        rows, ends = records(data.decode('utf-8'))
    except (ValueError, UnicodeDecodeError) as e:
        return [f'unreadable: {e}'], {}
    form = FORMS[f['writer']]
    if ends != {form['end']}:
        problems.append(f'line ends {sorted(ends)!r}')
    cells = f['cells']
    if form['pad']:
        width = max(len(r) for r in cells)
        cells = [r + [''] * (width - len(r)) for r in cells]
    if [[v for v, _ in r] for r in rows] != cells:
        problems.append('cells differ from the facts')
    wrong = [v for r in rows for v, q in r if q != form['quote'](v)]
    if wrong:
        problems.append(f'quoting of {wrong[0]!r}')
    return problems, {'rows': len(rows), 'quoted': sum(q for r in rows for _, q in r)}


def check(folder, facts):
    folder = Path(folder)
    files = {f['name']: f for s in facts['stories'] for f in s['files']}
    scopes = {f"{s['id']}-scope.json": s['runScope'] for s in facts['stories']}
    present = {p.name for p in folder.iterdir()} - {'stories.json', 'EXPECTED.json', 'VERIFY.json',
                                                    'ELIGIBILITY.json', 'INPUT-MANIFEST.json', 'SEAL.json'}
    report = {'ok': present == set(files) | set(scopes), 'files': []}
    for name, f in sorted(files.items()):
        problems, seen = check_file(folder / name, f) if (folder / name).exists() else (['absent'], {})
        report['files'].append({'name': name, 'writer': f['writer'], 'ok': not problems, 'problems': problems, **seen})
    for name, scope in sorted(scopes.items()):
        path = folder / name
        good = path.exists() and path.read_text(encoding='utf-8') == json.dumps(scope, ensure_ascii=False,
                                                                                  indent=1) + '\n'
        report['files'].append({'name': name, 'writer': 'json', 'ok': good,
                                'problems': [] if good else ['not the run scope']})
    report['ok'] = report['ok'] and all(x['ok'] for x in report['files'])
    report['cells'] = sum(len(r) for f in files.values() for r in f['cells'])
    return report


def swap(before, after):
    def change(b):
        assert before in b, before
        return b.replace(before, after, 1)
    return change


PLANTS = [
    ('H06-gl.csv', 'a Persian digit made Latin', swap('۱۲۳۴'.encode(), '1۲۳۴'.encode())),
    ('H04-gl.csv', 'the space after the comma in the dimensions dropped',
     swap(b'cc=1, region=""N""', b'cc=1,region=""N""')),
    ('H03-tb.csv', 'the spaces around a page label removed', swap(b'" Statutory GL  "', b'Statutory GL')),
    ('H09-tb.csv', 'the case of the dimensions restored', swap(b'dept=sales', b'Dept=Sales')),
    ('H08-tb.csv', 'LF where Java writes CRLF', lambda b: b.replace(b'\r\n', b'\n')),
    ('H07-tb.csv', 'the padding of LibreOffice removed from one row',
     swap(b'"Page","TB-1",,,,,,,,\n', b'"Page","TB-1"\n')),
    ('H15-tb.csv', 'a TB row dropped',
     lambda b: b'\r\n'.join(line for i, line in enumerate(b.split(b'\r\n')) if i != 20)),
    ('H13-scope.json', 'the scope period moved', swap(b'2027-03-31', b'2027-03-30')),
]


def self_test(folder, facts):
    out = []
    for name, what, change in PLANTS:
        with tempfile.TemporaryDirectory() as tmp:
            for p in Path(folder).iterdir():
                shutil.copy(p, Path(tmp) / p.name)
            before = (Path(folder) / name).read_bytes()
            after = change(before)
            assert after != before, name
            (Path(tmp) / name).write_bytes(after)
            out.append({'file': name, 'plant': what, 'rejected': not check(tmp, copy.deepcopy(facts))['ok']})
    return out


def main(folder):
    facts_bytes = (Path(folder) / 'stories.json').read_bytes()
    facts = json.loads(facts_bytes)
    report = check(folder, facts)
    report['factsSha256'] = hashlib.sha256(facts_bytes).hexdigest()
    report['selfTest'] = self_test(folder, facts)
    report['passed'] = report['ok'] and all(p['rejected'] for p in report['selfTest'])
    (Path(folder) / 'VERIFY.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'passed': report['passed'], 'files': len(report['files']), 'cells': report['cells'],
                      'problems': [(f['name'], f['problems']) for f in report['files'] if not f['ok']][:8],
                      'selfTest': [(p['plant'], p['rejected']) for p in report['selfTest']]}, ensure_ascii=False))
    if not report['passed']:
        sys.exit(1)


if __name__ == '__main__':
    main(sys.argv[1])
