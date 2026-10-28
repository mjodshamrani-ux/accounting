"""Independent check that every H1 file carries its story's cells, read with
a tokenizer written here (not Python's csv module, not the foundation's
check): every cell against stories.json, and each writer's observed form
(byte-order mark, line ends, quoting) against what that writer is known to
do. Then a self-test: the check must fail on a copy with one planted change.

  python3 -B audit/intercompany-batch-holdout-h1/verify.py frozen
"""
import copy
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

# Line ends each writer produces, and which fields it must quote.
FORMS = {
    'go': {'end': '\n', 'quote': lambda v: any(c in v for c in ',"\r\n') or v[:1] in (' ', '\t')},
    'php': {'end': '\n', 'quote': lambda v: any(c in v for c in ',"\r\n\t \\')},
    'libreoffice': {'end': '\n', 'quote': lambda v: v != ''},
    'java': {'end': '\r\n', 'quote': lambda v: any(c in v for c in ',"\r\n') or v[:1] == ' ' or v[-1:] == ' '},
}


def records(raw):
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
            if cell:
                raise ValueError('quote inside a field')
            inside = quoted = True
        elif c == ',':
            row.append((cell, quoted))
            cell, quoted = '', False
        elif c in '\r\n':
            end = '\r\n' if raw[i:i + 2] == '\r\n' else c
            ends.add(end)
            i += len(end) - 1
            row.append((cell, quoted))
            out.append(row)
            row, cell, quoted = [], '', False
        else:
            cell += c
        i += 1
    if inside or cell or row:
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
    if [[v for v, _ in r] for r in rows] != f['cells']:
        problems.append('cells differ from the facts')
    wrong = [v for r in rows for v, q in r if q != form['quote'](v)]
    if wrong:
        problems.append(f'quoting of {wrong[0]!r}')
    return problems, {'rows': len(rows), 'quoted': sum(q for r in rows for _, q in r)}


def check(folder, facts):
    folder = Path(folder)
    files = {f['name']: f for s in facts['stories'] for f in s['files']}
    present = {p.name for p in folder.glob('*.csv')}
    report = {'ok': present == set(files), 'files': []}
    for name, f in sorted(files.items()):
        problems, seen = check_file(folder / name, f) if (folder / name).exists() else (['absent'], {})
        report['files'].append({'name': name, 'writer': f['writer'], 'ok': not problems, 'problems': problems, **seen})
    report['ok'] = report['ok'] and all(x['ok'] for x in report['files'])
    report['cells'] = sum(len(r) for f in files.values() for r in f['cells'])
    return report


def self_test(folder, facts):
    plants = [
        ('H12-ledger-2.csv', 'one amount one halala off', lambda b: b.replace(b'51000.00', b'51000.01', 1)),
        ('H06-ledger-1.csv', 'a Persian digit made Latin', lambda b: b.replace('۱۲۳۴'.encode(), '1۲۳۴'.encode(), 1)),
        ('H03-relations.csv', 'the line break in a reference removed',
         lambda b: b.replace(b'Storage fee\nsecond', b'Storage fee second', 1)),
        ('H10-relations.csv', 'the leading space of a relation ID removed',
         lambda b: b.replace(b'" L-1002"', b'L-1002', 1)),
        ('H07-ledger-1.csv', 'LF where Java writes CRLF', lambda b: b.replace(b'\r\n', b'\n')),
        ('H09-ledger-1.csv', 'the counterparty case restored',
         lambda b: b.replace(b'orbit logistics llc', b'Orbit Logistics LLC', 1)),
        ('H15-relations.csv', 'a relation row dropped', lambda b: b'\r\n'.join(b.split(b'\r\n')[:-2]) + b'\r\n'),
    ]
    out = []
    for name, plant, change in plants:
        with tempfile.TemporaryDirectory() as tmp:
            for p in Path(folder).glob('*.csv'):
                shutil.copy(p, Path(tmp) / p.name)
            before = (Path(folder) / name).read_bytes()
            after = change(before)
            assert after != before, name
            (Path(tmp) / name).write_bytes(after)
            out.append({'file': name, 'plant': plant, 'rejected': not check(tmp, copy.deepcopy(facts))['ok']})
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
