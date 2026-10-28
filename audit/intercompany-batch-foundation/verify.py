"""Independent check that every frozen CSV carries its story's cells and its
writer's form, read with a tokenizer written here (not the csv module the
oracle uses): the byte-order mark, the line ends, which fields are quoted,
and every cell against stories.json. Then a self-test: the check must fail on
a copy with one planted change.

  PYTHONPATH= python3 -B audit/intercompany-batch-foundation/verify.py frozen
"""
import copy
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

FORMS = {
    'py': {'bom': False, 'end': '\n', 'quoted': 'minimal'},
    'py-crlf-bom': {'bom': True, 'end': '\r\n', 'quoted': 'minimal'},
    'node': {'bom': False, 'end': '\r\n', 'quoted': 'all'},
    'ruby': {'bom': False, 'end': '\n', 'quoted': 'minimal'},
}


def tokens(raw):
    """RFC 4180 records as [(text, quoted)], and every line end seen."""
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


def needs_quotes(v):
    return any(ch in v for ch in ',"\r\n')


def check_file(path, f):
    problems = []
    data = path.read_bytes()
    form = FORMS[f['writer']]
    if data.startswith(b'\xef\xbb\xbf') != form['bom']:
        problems.append('byte-order mark')
    try:
        rows, ends = tokens(data.decode('utf-8')[1 if form['bom'] else 0:])
    except (ValueError, UnicodeDecodeError) as e:
        return [f'unreadable: {e}']
    if set(ends) != {form['end']}:
        problems.append(f'line ends {sorted(set(ends))!r}')
    if [[t for t, _ in r] for r in rows] != f['cells']:
        problems.append('cells differ from the facts')
    for r in rows:
        for t, q in r:
            if q != (True if form['quoted'] == 'all' else needs_quotes(t)):
                problems.append(f'quoting of {t!r}')
                break
    return problems


def check(folder, facts):
    folder = Path(folder)
    files = {f['name']: f for s in facts['stories'] for f in s['files']}
    present = {p.name for p in folder.glob('*.csv')}
    report = {'files': [], 'ok': present == set(files)}
    if present != set(files):
        report['extra'] = sorted(present ^ set(files))
    for name, f in sorted(files.items()):
        problems = check_file(folder / name, f) if (folder / name).exists() else ['absent']
        report['files'].append({'name': name, 'writer': f['writer'], 'ok': not problems, 'problems': problems})
    report['ok'] = report['ok'] and all(x['ok'] for x in report['files'])
    report['cells'] = sum(len(r) for f in files.values() for r in f['cells'])
    return report


def self_test(folder, facts):
    def bytes_of(name):
        return (Path(folder) / name).read_bytes()

    plants = [
        ('I10-ledger-2.csv', 'one amount changed in the file', lambda b: b.replace(b'11500.00', b'11500.01')),
        ('I08-ledger-2.csv', 'a row dropped', lambda b: b'\n'.join(b.split(b'\n')[:-2]) + b'\n'),
        ('I04-batches.csv', 'the byte-order mark removed', lambda b: b[3:]),
        ('I02-relations.csv', 'one field left unquoted', lambda b: b.replace(b'"R-1002"', b'R-1002', 1)),
        ('I03-ledger-1.csv', 'CRLF where the writer writes LF', lambda b: b.replace(b'\n', b'\r\n')),
        ('I16-ledger-1.csv', 'an Arabic-Indic digit replaced by a Latin one',
         lambda b: b.replace('٢٤٥٠٠'.encode(), '٢٤5٠٠'.encode(), 1)),
        ('I07-ledger-1.csv', 'the unclear counterparty made clear',
         lambda b: b.replace(b'Synthetic Beta Trading / Synthetic Gamma Services', b'Synthetic Beta Trading')),
    ]
    out = []
    for name, plant, change in plants:
        with tempfile.TemporaryDirectory() as tmp:
            for p in Path(folder).glob('*.csv'):
                shutil.copy(p, Path(tmp) / p.name)
            before = bytes_of(name)
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
                      'problems': [(f['name'], f['problems']) for f in report['files'] if not f['ok']],
                      'selfTest': [(p['plant'], p['rejected']) for p in report['selfTest']]}, ensure_ascii=False))
    if not report['passed']:
        sys.exit(1)


if __name__ == '__main__':
    main(sys.argv[1])
