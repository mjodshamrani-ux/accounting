"""Plant one fault at a time in a copy of oracle.py and require test_oracle.py
to fail with an assertion. A crash or a stale anchor is not a detection.

  python3 -B audit/payroll-long-register-foundation/mutate_oracle.py
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
    ('arabic-digits-not-read', 'strip(v).translate(DIGITS).replace', 'strip(v).replace'),
    ('arabic-decimal-not-read', ".replace('٫', '.')", ''),
    ('extra-decimals-allowed', "len(m.group(2) or '') > decimals", "len(m.group(2) or '') > decimals + 1"),
    ('blank-amount-is-zero', '    s = strip(v).translate', "    s = (strip(v) or '0').translate"),
    ('no-amount-ceiling', '    return n if n <= MAX_MINOR else None\n', '    return n\n'),
    ('stray-quote-tolerated', "        if t[i] not in '\\r\\n':\n            raise Refused('CSV')\n",
     "        if t[i] not in '\\r\\n':\n            i += 1\n            continue\n"),
    ('lone-cr-refused', "        if t[i] not in '\\r\\n':\n", "        if t[i] != '\\n' and not t.startswith('\\r\\n', i):\n"),
    ('doubled-quotes-kept', ".replace('\"\"', '\"')", ''),
    # Blocks and headers.
    ('stray-rows-ignored', '            strays.append(n)\n', '            pass\n'),
    ('blank-rows-inside-kept', '            if not width(r):\n                i += 1\n                continue\n', ''),
    ('closure-ignores-the-id', " and strip(r[1]) == strip(b['opening'][1])", ''),
    ('closure-ignores-the-kind', "b['closed'] = mark == own and ", "b['closed'] = "),
    ('closure-ignores-the-width', "mark == own and width(r) == 2 and", 'mark == own and'),
    ('run-totals-row-not-a-boundary', "            if mark in ('Section', 'Run totals'):\n",
     "            if mark == 'Section':\n"),
    ('unknown-labels-allowed', ' and set(counts) <= set(LABELS)', ''),
    ('repeated-labels-allowed', 'counts[lab] == 1', 'counts[lab] >= 1'),
    ('dates-read-as-text', 'real_date(cell(r, 1)) if lab in DATE_LABELS else text(cell(r, 1))', 'text(cell(r, 1))'),
    ('opening-width-unchecked', 'whole = width(opening) == 2 and text(opening[1])', 'whole = text(opening[1])'),
    ('columns-in-contract-order', 'return cols if set(cols) == set(COLUMNS) else None',
     'return cols if list(cols) == COLUMNS else None'),
    ('column-count-unchecked', 'if row is None or width(row) != len(COLUMNS):', 'if row is None:'),
    ('broken-header-judged', "    if not whole:\n        return s\n", ''),
    ('unclosed-section-excludable', "    if other and b['closed']:", '    if other:'),
    ('payment-date-not-compared', "other = any(values[lab] != run[lab] for lab in LABELS)",
     "other = any(values[lab] != run[lab] for lab in LABELS[:-1])"),
    ('unclosed-other-scope-read', "    if other:\n        return s\n    s['read'] = True", "    s['read'] = True"),
    ('net-total-read-as-a-line', 'if strip(r[0]) in TOTALS:', 'if strip(r[0]) in TOTALS[:3]:'),
    ('line-after-totals-allowed', '        after = after or bool(totals)\n', ''),
    ('kind-folded', "kind = strip(get('Kind'))", "kind = strip(get('Kind')).lower()"),
    ('wide-lines-allowed', "'wide': width(r) > len(COLUMNS)", "'wide': False"),
    ('section-mismatch-ignored', '    elif any(printed[FOOT[k]] != sum(', '    elif False and any(printed[FOOT[k]] != sum('),
    ('wide-totals-allowed', ' or any(width(r) != 2 for r in rows)', ''),
    ('blank-total-compared', '    return None if None in printed.values() else printed\n', '    return printed\n'),
    ('totals-labels-swapped', 'FOOT = dict(zip(KINDS, TOTALS))', 'FOOT = dict(zip(KINDS, TOTALS[::-1]))'),
    # Scope.
    ('payment-before-posting-allowed', " and run['Payroll posting date'] <= run['Payment date']", ''),
    ('scope-dates-unchecked', 'and all(real_date(run[k]) is not None for k in DATE_LABELS)', 'and True'),
    # Judgement.
    ('stray-holds-nothing', "        run_codes.add('STRAY_ROW')\n", ''),
    ('section-header-holds-nothing', "            run_codes.add('SECTION_HEADER')\n", ''),
    ('section-columns-hold-nothing', "            run_codes.add('SECTION_COLUMNS')\n", ''),
    ('unclosed-holds-nothing', "            run_codes.add('SECTION_UNCLOSED')\n", '            pass\n'),
    ('duplicate-sections-allowed', "    if any(c > 1 for c in ids.values()):\n        run_codes.add('SECTION_DUPLICATE')\n",
     ''),
    ('excluded-sections-duplicate', "for s in sections if not s['excluded'] and s['id'] is not None",
     "for s in sections if s['id'] is not None"),
    ('unreadable-line-holds-nothing', "            run_codes.add('LINE_UNREADABLE')\n", ''),
    ('kind-blind-run-check', "    checkable = all(x['kind'] is not None and x['amount'] is not None for x in lines)",
     "    checkable = all(x['amount'] is not None for x in lines)"),
    ('run-totals-of-another-run', " and text(b['opening'][1]) == run['Payroll run']", ''),
    ('unclosed-run-totals-allowed', "        if b['closed'] and width", '        if width'),
    ('run-totals-twice-allowed', '    if len(footers) == 1:\n', '    if footers:\n'),
    ('run-mismatch-ignored', '    elif any(printed[FOOT[k]] != sums[SUMS[k]] for k in KINDS):',
     '    elif False:'),
    ('run-earnings-only', '    elif any(printed[FOOT[k]] != sums[SUMS[k]] for k in KINDS):',
     '    elif any(printed[FOOT[k]] != sums[SUMS[k]] for k in KINDS[:1]):'),
    ('payee-and-component-unchecked', "            if None in (x['id'], x['payee'], x['component']):",
     "            if x['id'] is None:"),
    ('kind-holds-nothing', "                hold(key, 'KIND')\n", '                pass\n'),
    ('amount-holds-nothing', "                hold(key, 'AMOUNT')\n", '                pass\n'),
    ('width-holds-nothing', "                hold(key, 'LINE_WIDTH')\n", '                pass\n'),
    ('duplicate-lines-allowed', "            if x['id'] is not None and line_ids[x['id']] > 1:", '            if False:'),
    ('section-totals-hold-nothing', "            if s['totals']:\n                hold(key, s['totals'])\n", ''),
    ('payee-conflict-allowed', "        if len({x['payee'] for x in own if x['payee'] is not None}) > 1:",
     '        if False:'),
    ('two-nets-allowed', '        if len(nets) > 1:', '        if False:'),
    ('run-codes-not-spread', '        for code in run_codes:\n            hold(key, code)\n', ''),
    ('employer-taken-from-net', "        elif part['earnings'] - part['deductions'] != net:",
     "        elif part['earnings'] - part['deductions'] - part['employer'] != net:"),
    ('net-equation-unchecked', "        elif part['earnings'] - part['deductions'] != net:", '        elif False:'),
    ('leading-zero-dropped', "            key = (x['employee'], x['dims'])", "            key = (x['employee'].lstrip('0'), x['dims'])"),
    ('payee-is-the-employee', "            key = (x['employee'], x['dims'])", "            key = (x['payee'] or x['employee'], x['dims'])"),
    ('every-payee-listed', "for p, e in sorted(payees.items()) if len(e) > 1]", 'for p, e in sorted(payees.items())]'),
    ('unplaced-in-found-order', "'unplaced': sorted(unplaced),", "'unplaced': unplaced,"),
    ('zero-lines-dropped', "for x in own)", "for x in own if x['amount'])"),
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
