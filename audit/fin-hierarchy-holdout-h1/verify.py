"""Independent check that every FIN-1 H1 file carries its story's cells,
read with a tokenizer written here (not Python's csv module, not FIN-1A's
oracle): every cell against stories.json, each writer's observed form (line
ends, quoting, byte-order mark) against what that writer is known to do, and
each scope file against the story's run scope. Then a self-test: the check
must fail on a copy with one planted change.

  python3 -B audit/fin-hierarchy-holdout-h1/verify.py frozen
"""
import copy
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

# Line ends each writer produces and which fields it quotes.
FORMS = {
    'go': {'end': '\n', 'quote': lambda v: any(c in v for c in ',"\r\n') or v[:1] in (' ', '\t')},
    'ruby': {'end': '\n', 'quote': lambda v: v == '' or any(c in v for c in ',"\r\n')},
    'perl': {'end': '\r', 'quote': lambda v: any(c in v for c in ',"\r\n')},
    'rust': {'end': '\r\n', 'quote': lambda v: True},
    'libreoffice': {'end': '\n', 'quote': lambda v: v != ''},
}
NOT_INPUTS = {'stories.json', 'EXPECTED.json', 'VERIFY.json', 'ELIGIBILITY.json', 'INPUT-MANIFEST.json',
              'SEAL.json'}


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
    bom = data.startswith(b'\xef\xbb\xbf')
    if bom != f['bom']:
        problems.append('byte-order mark' if bom else 'no byte-order mark')
    try:
        rows, ends = records(data[3:].decode('utf-8') if bom else data.decode('utf-8'))
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
    scopes = {f"{s['id']}/scope.json": s['runScope'] for s in facts['stories']}
    present = {str(p.relative_to(folder)) for p in folder.rglob('*') if p.is_file()} - NOT_INPUTS
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
    ('H01/trial-balance.csv', 'one cent moved between two TB rows',
     lambda b: b.replace(b'120350.75', b'120350.76', 1).replace(b'30000.25', b'30000.24', 1)),
    ('H02/financial-position.csv', 'the line break in a label dropped',
     swap(b'installation\n(machinery)', b'installation (machinery)')),
    ('H03/trial-balance.csv', 'an Arabic-Indic digit made Latin', swap('ن-١٠١'.encode(), 'ن-1٠١'.encode())),
    ('H07/financial-position.csv', 'the cycle broken by restoring one parent',
     swap(b'"CA","REC"', b'"CA",')),
    ('H10/presentation-evidence.csv', 'CR where Perl writes CR alone', lambda b: b.replace(b'\r', b'\r\n')),
    ('H21/financial-position.csv', 'the byte-order mark removed', lambda b: b[3:]),
    ('H17/trial-balance.csv', 'a TB row dropped',
     lambda b: b'\n'.join(line for i, line in enumerate(b.split(b'\n')) if i != 40)),
    ('H29/scope.json', 'the map version of the scope moved', swap(b'BSMAP-7', b'BSMAP-6')),
]


def self_test(folder, facts):
    out = []
    for name, what, change in PLANTS:
        with tempfile.TemporaryDirectory() as tmp:
            shutil.copytree(folder, tmp, dirs_exist_ok=True)
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
