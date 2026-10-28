"""Plant one fault at a time in a copy of oracle.py and require test_oracle.py
to fail with an assertion. A crash or a stale anchor is not a detection.

  python3 -B audit/gl-tb-sections-foundation/mutate_oracle.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAULTS = [
    # Reading.
    ('every-space-trimmed', "    return v.strip(' ')\n", '    return v.strip()\n'),
    ('byte-order-mark-kept', "    if t.startswith('\\ufeff'):\n        t = t[1:]\n", ''),
    ('text-length-501', 'len(s) > 500', 'len(s) > 501'),
    ('minus-prefix-allowed', "s[0] in '=+@-'", "s[0] in '=+@'"),
    ('excel-errors-case-sensitive', 's.upper().startswith(ERRORS)', 's.startswith(ERRORS)'),
    ('format-characters-allowed', "kind in ('Cc', 'Cf')", "kind == 'Cc'"),
    ('other-spaces-allowed', "(kind[0] == 'Z' and ch != ' ')", 'False'),
    ('impossible-dates-allowed', '        Date.fromisoformat(s)\n', '        pass\n'),
    ('arabic-digits-not-read', "strip(v).translate(DIGITS).replace", 'strip(v).replace'),
    ('arabic-decimal-not-read', ".replace('٫', '.')", ''),
    ('extra-decimals-allowed', "len(m.group(2) or '') > decimals", "len(m.group(2) or '') > decimals + 1"),
    ('blank-amount-is-zero', "    s = strip(v).translate", "    s = (strip(v) or '0').translate"),
    ('no-amount-ceiling', '    return n if n <= MAX_MINOR else None\n', '    return n\n'),
    # Sections and pages.
    ('stray-rows-ignored', '            strays.append(n)\n', '            pass\n'),
    ('blank-rows-inside-kept', "            if not width(r):\n                i += 1\n                continue\n", ''),
    ('closure-ignores-the-id', " and strip(r[1]) == strip(b['opening'][1])", ''),
    ('unknown-labels-allowed', ' and set(counts) <= set(names)', ''),
    ('repeated-labels-allowed', 'counts[lab] == 1', 'counts[lab] >= 1'),
    ('columns-in-contract-order', 'return cols if set(cols) == set(names) else None',
     'return cols if list(cols) == list(names) else None'),
    ('unclosed-section-allowed', "    if not b['closed']:\n        s['codes'].add('SECTION_UNCLOSED')\n", ''),
    ('unclosed-section-excludable', "    if s['codes']:\n        return s\n    if any(",
     "    if s['codes'] - {'SECTION_UNCLOSED'}:\n        return s\n    if any("),
    ('section-period-not-compared', "for lab in SCOPE_FIELDS):\n        s['excluded'] = True",
     "for lab in SCOPE_FIELDS[:-2]):\n        s['excluded'] = True"),
    ('page-scope-not-compared', "for lab in SCOPE_FIELDS):\n        p['excluded'] = True",
     "for lab in SCOPE_FIELDS[:0]):\n        p['excluded'] = True"),
    ('wide-records-allowed', " or any(width(r) > len(GL_COLUMNS) for _, r in b['body'])", ''),
    ('record-identity-unchecked', "        if rid is None:\n            s['codes'].add('IDENTITY')\n        else:\n",
     "        if False:\n            pass\n        else:\n"),
    ('opening-date-unchecked', "(kind == 'opening' and d != start) or ", ''),
    ('movement-end-unchecked', 'not start <= d <= end', 'not start <= d'),
    ('repeated-record-ids-allowed', '    if any(c > 1 for c in ids.values()):\n', '    if False:\n'),
    ('repeated-roles-allowed', "    if len(roles['opening']) > 1 or len(roles['closing']) > 1:\n", '    if False:\n'),
    ('first-movement-only', "sum(c for _, c in roles['movement'])", "sum(c for _, c in roles['movement'][:1])"),
    ('opening-sides-swapped', "(od, oc), (cd, cc) = roles['opening'][0]", "(oc, od), (cd, cc) = roles['opening'][0]"),
    ('unreadable-page-unclosed-allowed', " or cols is None or not b['closed']:", ' or cols is None:'),
    ('row-type-folded', "kind = strip(get('Row type'))", "kind = strip(get('Row type')).lower()"),
    ('parent-not-read', "row['parent'] = text(written) if written else ''", "row['parent'] = written"),
    ('wide-tb-rows-allowed', ' and width(r) <= len(TB_COLUMNS)', ''),
    ('tb-period-columns-swapped', "TB_AMOUNTS = ['Opening debit', 'Opening credit', 'Period debit', 'Period credit',",
     "TB_AMOUNTS = ['Opening debit', 'Opening credit', 'Period credit', 'Period debit',"),
    # Judgement.
    ('scope-basis-unchecked', " or run['Currency basis'] != 'functional'", ''),
    ('section-unreadable-not-held', "            run_codes.add('SECTION_UNREADABLE')\n", ''),
    ('dimensions-inherited-silently', "        if key[0] in by_code:\n", '        if False:\n'),
    ('duplicate-key-allowed', "        if len(found) > 1 or any(ids[s['id']] > 1", "        if any(ids[s['id']] > 1"),
    ('duplicate-id-allowed', " or any(ids[s['id']] > 1 for s in found if s['id'] is not None)", ''),
    ('page-unreadable-not-held', "            run_codes.add('PAGE_UNREADABLE')\n", ''),
    ('row-unreadable-not-held', "            run_codes.add('ROW_UNREADABLE')\n", ''),
    ('leading-zero-dropped', "        key = (r['account'], r['dims'])\n        tb.setdefault",
     "        key = (r['account'].lstrip('0'), r['dims'])\n        tb.setdefault"),
    ('tb-conflict-allowed', "        if len(found) > 1:\n            hold(key, 'TB_CONFLICT')\n",
     "        if False:\n            hold(key, 'TB_CONFLICT')\n"),
    ('totals-across-dimensions', " and r['dims'] == t['dims']]", ']'),
    ('child-amount-counted-as-zero',
     "        if not t['fieldOk'] or None in t['six'] or any(None in r['six'] for r in children):\n"
     "            code = 'TOTAL_FIELD'\n"
     "        elif any(t['six'][i] != sum(r['six'][i] for r in children) for i in range(6)):\n",
     "        if not t['fieldOk'] or None in t['six']:\n"
     "            code = 'TOTAL_FIELD'\n"
     "        elif any(t['six'][i] != sum(r['six'][i] or 0 for r in children) for i in range(6)):\n"),
    ('total-mismatch-ignored', "        elif any(t['six'][i] != sum(", "        elif False and any(t['six'][i] != sum("),
    ('stray-holds-nothing', '        for code in run_codes:\n            hold(key, code)\n',
     "        for code in run_codes - {'STRAY_ROW'}:\n            hold(key, code)\n"),
    ('zero-tb-row-passes',
     "        missing = (['GL_SECTION_ABSENT'] if s is None else s['missing']) + ([] if r else ['TB_ROW_ABSENT'])\n"
     "        g, t = (s or {}).get('six'), (r or {}).get('six')\n",
     "        zero = s is None and r is not None and not any(r['six'])\n"
     "        missing = ([] if zero else ['GL_SECTION_ABSENT'] if s is None else s['missing']) + ([] if r else ['TB_ROW_ABSENT'])\n"
     "        g, t = [0] * 6 if zero else (s or {}).get('six'), (r or {}).get('six')\n"),
    ('bridges-after-components', "        elif bridge(g) or bridge(t):\n", "        elif g == t and (bridge(g) or bridge(t)):\n"),
    ('net-instead-of-components', "        elif g != t:\n", "        elif g[4] - g[5] != t[4] - t[5]:\n"),
]


def run(oracle_path):
    env = dict(os.environ, ORACLE=str(oracle_path))
    return subprocess.run([sys.executable, '-B', '-m', 'unittest', 'test_oracle.py'],
                          cwd=HERE, env=env, capture_output=True, text=True)


def main():
    source = (HERE / 'oracle.py').read_text(encoding='utf-8')
    base = run(HERE / 'oracle.py')
    if base.returncode != 0:
        sys.exit('the unmutated oracle must pass:\n' + base.stderr[-2000:])
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copy(HERE / 'contract.json', Path(tmp) / 'contract.json')
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
