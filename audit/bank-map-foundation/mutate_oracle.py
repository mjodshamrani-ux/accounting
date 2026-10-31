"""Plant one fault at a time in a copy of the MAP-1 oracle.py and require
test_oracle.py to fail with an assertion. A crash outside the assertions or
a stale anchor is not a detection.

  python3 -B audit/bank-map-foundation/mutate_oracle.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAULTS = [
    ('fit-by-position-only',
     "        if found != entry['label']:",
     "        if False:"),
    ('labels-without-case',
     "        if found != entry['label']:",
     "        if found.lower() != entry['label'].lower():"),
    ('labels-without-nfc',
     "    return SPACE_RUN.sub(' ', unicodedata.normalize('NFC', s)).strip(' ')",
     "    return SPACE_RUN.sub(' ', s).strip(' ')"),
    ('labels-trimmed-only',
     "    return SPACE_RUN.sub(' ', unicodedata.normalize('NFC', s)).strip(' ')",
     "    return unicodedata.normalize('NFC', s).strip()"),
    ('tatweel-folded',
     "    return SPACE_RUN.sub(' ', unicodedata.normalize('NFC', s)).strip(' ')",
     "    return SPACE_RUN.sub(' ', unicodedata.normalize('NFC', s)).replace('\\u0640', '').strip(' ')"),
    ('elsewhere-on-the-header-row-only',
     "            elsewhere = [a1(r, c) for r in range(1, min(MAX_HEADER, table['rows']) + 1)",
     "            elsewhere = [a1(r, c) for r in [m['header']]"),
    ('sheets-ignored',
     "    if table['sheets'] != 1:\n        return [{'kind': 'sheets', 'count': table['sheets']}]",
     "    if False:\n        return [{'kind': 'sheets', 'count': table['sheets']}]"),
    ('rows-above-read',
     "        for at in range(header + 1, table['rows'] + 1):",
     "        for at in range(1 if not declared else header + 1, table['rows'] + 1):"),
    ('above-not-counted',
     "    out = {'header': header, 'above': header - 1,",
     "    out = {'header': header, 'above': 0,"),
    ('every-column-recorded',
     "            for role, c in mapped.items():\n                issues, reference, _, _ = table['cell'](at, c)",
     "            for role, c in [*mapped.items(), *((None, k) for k in range(1, table['width'] + 1))]:\n"
     "                issues, reference, _, _ = table['cell'](at, c)"),
    ('unlabelled-values-read',
     "                outside = c > len(DECLARED) if declared else not labels.get(c)",
     "                outside = c > len(DECLARED) if declared else False"),
    ('empty-mapped-row-skipped',
     "            if not any(texts.values()):\n                raise Refused('ROW', at)",
     "            if not any(texts.values()):\n                continue"),
    ('typed-amount-looked-up-in-the-declared-column',
     "                kind = table['cell'](at, mapped[role])[3]",
     "                kind = table['cell'](at, 5 if role == 'receipts' else 6)[3]"),
    ('reference-required',
     "REQUIRED = set(CONTRACT['roles']['required'])",
     "REQUIRED = set(CONTRACT['roles']['required']) | {'reference'}"),
    ('one-column-for-two-roles',
     "    if len(set(used)) != len(used):",
     "    if False:"),
    ('extra-keys-carried',
     "    if set(obj) != TOP_KEYS or not isinstance(columns, dict)",
     "    if not TOP_KEYS <= set(obj) or not isinstance(columns, dict)"),
    ('text-not-in-normal-form-accepted',
     "    return isinstance(v, str) and normal(v) == v and 0 < units(v) <= limit and not CONTROL.search(v)",
     "    return isinstance(v, str) and 0 < units(v) <= limit and not CONTROL.search(v)"),
    ('control-characters-accepted',
     "    return isinstance(v, str) and normal(v) == v and 0 < units(v) <= limit and not CONTROL.search(v)",
     "    return isinstance(v, str) and normal(v) == v and 0 < units(v) <= limit"),
    ('length-in-code-points',
     "    return len(s.encode('utf-16-le')) // 2",
     "    return len(s)"),
    ('nan-read-as-json',
     "        obj = json.loads(text, parse_constant=no_constant)",
     "        obj = json.loads(text)"),
    ('no-size-limit',
     "    if len(data) > MAX_BYTES:",
     "    if False:"),
    ('header-31-accepted',
     "    if not integer(obj['header']) or not 1 <= obj['header'] <= MAX_HEADER:",
     "    if not integer(obj['header']) or not 1 <= obj['header'] <= MAX_HEADER + 1:"),
    ('version-true-accepted',
     "not (number(obj.get('version')) and obj['version'] == FORM['version'])",
     "not obj.get('version') == FORM['version']"),
    ('settled-without-references',
     "        w.writerow([e['date'], e['voucher'], e['description'], e['reference'],",
     "        w.writerow([e['date'], e['voucher'], e['description'], '',"),
]


def run(oracle_path):
    env = dict(os.environ, ORACLE=str(oracle_path), MAP_AUDIT=str(HERE.parent),
               MAP_CONTRACT=str(HERE / 'contract.json'))
    return subprocess.run([sys.executable, '-B', '-m', 'unittest', 'test_oracle.py'],
                          cwd=HERE, env=env, capture_output=True, text=True)


def main():
    source = (HERE / 'oracle.py').read_text(encoding='utf-8')
    base = run(HERE / 'oracle.py')
    if base.returncode != 0:
        sys.exit('the unmutated oracle must pass:\n' + base.stderr[-2000:])
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, before, after in FAULTS:
            if source.count(before) != 1:
                sys.exit(f'stale or non-unique anchor: {name}')
            target = Path(tmp) / f'{name}.py'
            target.write_text(source.replace(before, after), encoding='utf-8')
            r = run(target)
            detected = r.returncode != 0 and 'AssertionError' in r.stderr
            results.append({'fault': name, 'detected': detected})
            print(f"{'detected' if detected else 'SURVIVED'}: {name}", file=sys.stderr)
    print(json.dumps({'faults': len(results), 'detected': sum(r['detected'] for r in results),
                      'results': results}, indent=1))
    if not all(r['detected'] for r in results):
        sys.exit(1)


if __name__ == '__main__':
    main()
