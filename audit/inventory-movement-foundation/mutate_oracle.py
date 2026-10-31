"""Plant one fault at a time in a copy of oracle.py and require test_oracle.py
to fail with an assertion. A crash or a stale anchor is not a detection.

  python3 -B audit/inventory-movement-foundation/mutate_oracle.py
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
    ('encoding-errors-replaced', "t = path.read_bytes().decode('utf-8')", "t = path.read_bytes().decode('utf-8', 'replace')"),
    ('text-length-501', 'len(s) > 500', 'len(s) > 501'),
    ('minus-prefix-allowed', "s[0] in '=+@-'", "s[0] in '=+@'"),
    ('excel-errors-case-sensitive', 's.upper().startswith(ERRORS)', 's.startswith(ERRORS)'),
    ('format-characters-allowed', "kind in ('Cc', 'Cf')", "kind == 'Cc'"),
    ('other-spaces-allowed', "(kind[0] == 'Z' and ch != ' ')", 'False'),
    ('impossible-dates-allowed', '        Date.fromisoformat(s)\n', '        pass\n'),
    ('arabic-digits-not-read', 'strip(v).translate(DIGITS).replace', 'strip(v).replace'),
    ('arabic-decimal-not-read', ".replace('\\u066b', '.')", ''),
    ('extra-decimals-allowed', "len(m.group(3) or '') > places", "len(m.group(3) or '') > places + 1"),
    ('blank-number-is-zero', '    s = strip(v).translate', "    s = (strip(v) or '0').translate"),
    ('no-ceiling', '    if n > LIMIT:\n        return None\n', ''),
    ('minus-everywhere', '(m.group(1) and not signed)', 'False'),
    ('minus-nowhere', "m = re.fullmatch(r'(-?)([0-9]+)", "m = re.fullmatch(r'()([0-9]+)"),
    ('minus-dropped', '    return -n if m.group(1) else n\n', '    return n\n'),
    ('stray-quote-tolerated', "        if t[i] not in '\\r\\n':\n            raise Refused('CSV')\n",
     "        if t[i] not in '\\r\\n':\n            i += 1\n            continue\n"),
    ('lone-cr-refused', "        if t[i] not in '\\r\\n':\n", "        if t[i] != '\\n' and not t.startswith('\\r\\n', i):\n"),
    ('doubled-quotes-kept', ".replace('\"\"', '\"')", ''),
    # Headers.
    ('header-count-unchecked', 'if len(head) != len(columns) or set(head)', 'if set(head)'),
    ('header-in-contract-order', 'or set(head) != set(columns):', 'or head != list(columns):'),
    ('repeated-header-read-as-line', '        if [strip(c) for c in r[:width(r)]] == head:\n', '        if False:\n'),
    ('repeated-header-in-any-order', '        if [strip(c) for c in r[:width(r)]] == head:\n',
     '        if sorted(strip(c) for c in r[:width(r)]) == sorted(head):\n'),
    ('first-row-is-the-header', '    numbered = [(i + 1, r) for i, r in enumerate(rows) if width(r)]',
     '    numbered = [(i + 1, r) for i, r in enumerate(rows) if width(r) or not i]'),
    # Lines.
    ('kind-folded', "kind = strip(get('Kind'))", "kind = strip(get('Kind')).lower()"),
    ('quantity-in-hundredths', "number(get('Quantity'), 3, balance)", "number(get('Quantity'), 2, balance)"),
    ('sign-on-every-line', "    balance = kind in ('opening', 'closing')\n", '    balance = True\n'),
    ('sign-on-no-line', "    balance = kind in ('opening', 'closing')\n", '    balance = False\n'),
    ('unit-unchecked', "if None in (x['mid'], x['unit'], x['account']):", "if None in (x['mid'], x['account']):"),
    ('account-unchecked', "if None in (x['mid'], x['unit'], x['account']):", "if None in (x['mid'], x['unit']):"),
    ('kind-holds-nothing', "        codes.add('KIND')\n", '        pass\n'),
    ('movement-date-unchecked', "if x['md'] is None or x['pd'] is None:", "if x['pd'] is None:"),
    ('transfer-origin-allowed', "link = x['tid'] is None or not oid_blank", "link = x['tid'] is None"),
    ('return-transfer-allowed', "link = x['oid'] is None or not tid_blank", "link = x['oid'] is None"),
    ('links-unchecked-elsewhere', '        link = not tid_blank or not oid_blank\n', '        link = False\n'),
    ('only-origins-checked-elsewhere', '        link = not tid_blank or not oid_blank\n', '        link = not oid_blank\n'),
    ('width-unchecked', '    if width(r) > len(COLUMNS):\n', '    if False:\n'),
    ('width-counts-blank-cells', '    if width(r) > len(COLUMNS):\n', '    if len(r) > len(COLUMNS):\n'),
    ('faulty-lines-excludable', "x['whole'] = not codes and", "x['whole'] ="),
    ('unreadable-line-holds-nothing', "            run_codes.add('LINE_UNREADABLE')\n", '            pass\n'),
    # The period.
    ('excluded-by-movement-date', "x['kind'] in MOVES and not inside(x['pd'])]", "x['kind'] in MOVES and not inside(x['md'])]"),
    ('balances-excludable', "excluded = [x for x in lines if x['whole'] and x['kind'] in MOVES",
     "excluded = [x for x in lines if x['whole'] and x['kind'] is not None"),
    ('dated-by-posting-date', "inside(x['pd']) and not inside(x['md'])]", "inside(x['md']) and not inside(x['pd'])]"),
    ('excluded-lines-are-positions', '    skip = {id(x) for x in excluded}\n', '    skip = set()\n'),
    # Positions.
    ('duplicates-allowed', "            if x['mid'] is not None and ids[x['mid']] > 1:\n", '            if False:\n'),
    ('duplicates-ignore-excluded', "    ids = Counter(x['mid'] for x in lines if x['mid'] is not None)",
     "    ids = Counter(x['mid'] for x in lines if x['mid'] is not None and id(x) not in skip)"),
    ('opening-dates-unchecked',
     "            if x['kind'] == 'opening' and (x['md'] not in (None, start) or x['pd'] not in (None, start)):\n",
     '            if False:\n'),
    ('closing-movement-date-unchecked', "x['kind'] == 'closing' and (x['md'] not in (None, end) or x['pd']",
     "x['kind'] == 'closing' and (False or x['pd']"),
    ('negative-always-allowed', "run['Negative balances'] == 'not allowed'", "run['Negative balances'] == 'never'"),
    ('negative-value-only', "and ((x['q'] or 0) < 0 or (x['v'] or 0) < 0)", "and (x['v'] or 0) < 0"),
    ('unit-conflict-allowed', "        if len({x['unit'] for x in own if x['unit'] is not None}) > 1:\n", '        if False:\n'),
    ('account-conflict-allowed', "        if len({x['account'] for x in own if x['account'] is not None}) > 1:\n",
     '        if False:\n'),
    ('two-closings-allowed', " or sum(x['kind'] == 'closing' for x in own) > 1:", ':'),
    ('two-openings-allowed', "        if sum(x['kind'] == 'opening' for x in own) > 1 or", '        if False or'),
    # Transfers.
    ('transfers-of-any-period', "        if x['kind'] in TRANSFERS and inside(x['pd']) and x['tid'] is not None:",
     "        if x['kind'] in TRANSFERS and x['tid'] is not None:"),
    ('repeated-transfers-allowed', '        if len(outs) > 1 or len(ins) > 1:\n', '        if False:\n'),
    ('repeated-outs-only', '        if len(outs) > 1 or len(ins) > 1:\n', '        if len(outs) > 1:\n'),
    ('unpaired-allowed', "            hold(group[0], 'TRANSFER_UNPAIRED')\n", '            pass\n'),
    ('transfer-item-unchecked', "for f in ('item', 'unit', 'q', 'v'))", "for f in ('unit', 'q', 'v'))"),
    ('transfer-unit-unchecked', "for f in ('item', 'unit', 'q', 'v'))", "for f in ('item', 'q', 'v'))"),
    ('transfer-quantity-unchecked', "for f in ('item', 'unit', 'q', 'v'))", "for f in ('item', 'unit', 'v'))"),
    ('transfer-value-unchecked', "for f in ('item', 'unit', 'q', 'v'))", "for f in ('item', 'unit', 'q'))"),
    ('unread-sides-equal', "a[f] is not None and a[f] == b[f]", 'a[f] == b[f]'),
    ('mismatch-holds-the-out-side-only', "                hold(b, 'TRANSFER_MISMATCH')\n", ''),
    # Returns.
    ('returns-of-any-period', "        if x['kind'] not in RETURNS or not inside(x['pd']) or x['oid'] is None:",
     "        if x['kind'] not in RETURNS or x['oid'] is None:"),
    ('unseen-origin-holds', "            unseen.append([x['row'], x['mid'], x['oid']])\n            continue\n",
     "            hold(x, 'RETURN_ORIGIN')\n            continue\n"),
    ('two-origins-allowed', "        if len(named) > 1 or not o['whole']", "        if not o['whole']"),
    ('origin-need-not-read-whole', " or not o['whole'] or", ' or'),
    ('origin-kind-unchecked', " or o['kind'] != RETURNS[x['kind']]", ''),
    ('return-in-needs-a-receipt', "RETURNS = {'return-out': 'receipt', 'return-in': 'issue'}",
     "RETURNS = {'return-out': 'receipt', 'return-in': 'receipt'}"),
    ('origin-item-unchecked', "or o['item'] != x['item'] ", ''),
    ('origin-unit-unchecked', "or o['unit'] != x['unit']:", 'or False:'),
    ('capacity-by-quantity-only', " \\\n                or sum(x['v'] for x in rets) > o['v']:", ':'),
    ('capacity-by-value-only', "or sum(x['q'] for x in rets) > o['q']", 'or False'),
    ('capacity-ignores-unread-returns',
     "if any(x['q'] is None or x['v'] is None for x in rets) or sum(x['q'] for x in rets) > o['q']",
     "if sum(x['q'] or 0 for x in rets) > o['q']"),
    ('capacity-holds-the-first-only', "            for x in rets:\n                hold(x, 'RETURN_CAPACITY')\n",
     "            hold(rets[0], 'RETURN_CAPACITY')\n"),
    # Status and bridge.
    ('run-codes-not-spread', 'codes = sorted((held.get(key, set()) | run_codes) & POSITION_HOLDS)',
     'codes = sorted(held.get(key, set()) & POSITION_HOLDS)'),
    ('return-in-not-an-inflow', "INFLOWS = CONTRACT['register']['inflows']",
     "INFLOWS = [k for k in CONTRACT['register']['inflows'] if k != 'return-in']"),
    ('adjustment-out-not-an-outflow', "OUTFLOWS = CONTRACT['register']['outflows']",
     "OUTFLOWS = [k for k in CONTRACT['register']['outflows'] if k != 'adjustment-out']"),
    ('quantity-bridge-unchecked', "(['QUANTITY_BRIDGE'] if computed['quantity'] != closing['q'] else [])", '[]'),
    ('value-bridge-unchecked', "(['VALUE_BRIDGE'] if computed['value'] != closing['v'] else [])", '[]'),
    ('missing-opening-is-zero', '        if opening is not None:\n            computed = {',
     "        if True:\n            opening = opening or {'q': 0, 'v': 0}\n            computed = {"),
    ('missing-codes-unsorted', "            codes = sorted((['OPENING_ABSENT'] if opening is None else [])",
     "            codes = ((['OPENING_ABSENT'] if opening is None else [])"),
    ('lines-unsorted', "'lines': sorted([x['mid'], x['kind'], x['q'], x['v']] for x in own)",
     "'lines': [[x['mid'], x['kind'], x['q'], x['v']] for x in own]"),
    # Accounts.
    ('gl-file-holds-nothing', "        gl_codes.add('GL_FILE')\n", ''),
    ('gl-unreadable-holds-nothing', "            gl_codes.add('GL_UNREADABLE')\n", ''),
    ('gl-duplicate-allowed', '        if len(rows_) > 1:\n', '        if False:\n'),
    ('gl-amounts-unchecked', "            if None in (g['opening'], g['debit'], g['credit'], g['closing']):\n",
     '            if False:\n'),
    ('gl-closing-unchecked', "(g['opening'], g['debit'], g['credit'], g['closing'])",
     "(g['opening'], g['debit'], g['credit'])"),
    ('gl-debit-signed', "'debit': number(get('Debit'), decimals, False)", "'debit': number(get('Debit'), decimals, True)"),
    ('gl-opening-unsigned', "'opening': number(get('Opening'), decimals, True)",
     "'opening': number(get('Opening'), decimals, False)"),
    ('gl-width-unchecked', "'wide': width(r) > len(GL_COLUMNS)", "'wide': False"),
    ('position-holds-no-account', "            codes.add('POSITION')\n", '            pass\n'),
    ('inconsistent-position-compared', "        if any(status_of[key] != 'consistent' for key in named.get(acct, ())):",
     "        if any(status_of[key] in ('held', 'missing') for key in named.get(acct, ())):"),
    ('internal-transfers-counted',
     "                            if a['account'] == acct and b['account'] == acct:\n                                continue\n", ''),
    ('every-transfer-internal', "                            if a['account'] == acct and b['account'] == acct:",
     "                            if a['account'] == acct or b['account'] == acct:"),
    ('absences-swapped', "'codes': ['REGISTER_ABSENT']", "'codes': ['GL_ABSENT']"),
    ('difference-sign-flipped', 'diff = {k: reg[k] - gl_side[k] for k in reg}', 'diff = {k: gl_side[k] - reg[k] for k in reg}'),
    ('closing-difference-ignored', "codes = sorted(f'{k.upper()}_DIFF' for k in diff if diff[k])",
     "codes = sorted(f'{k.upper()}_DIFF' for k in diff if diff[k] and k != 'closing')"),
    # Totals and output.
    ('transfers-as-receipts', "                elif x['kind'] != 'transfer-in':\n                    totals[x['kind']] += x['v']\n",
     "                else:\n                    totals['receipt' if x['kind'] == 'transfer-in' else x['kind']] += x['v']\n"),
    ('totals-despite-missing', "all(p['status'] in ('consistent', 'inconsistent')", "all(p['status'] != 'held'"),
    ('totals-despite-unreadable-lines', "    if 'LINE_UNREADABLE' not in run_codes and all(", '    if all('),
    ('unplaced-unsorted', "        'unplaced': sorted(unplaced),", "        'unplaced': unplaced,"),
    # Scope.
    ('negative-scope-unchecked', "and run['Negative balances'] in ('allowed', 'not allowed')", 'and True'),
    ('period-may-run-backwards', "and run['Period start'] <= run['Period end']", 'and True'),
    ('scope-text-unchecked', 'and all(isinstance(v, str) and text(v) == v for v in run.values())',
     'and all(isinstance(v, str) for v in run.values())'),
    ('scope-extra-fields', 'sorted(run) == sorted(SCOPE_FIELDS)', 'set(SCOPE_FIELDS) <= set(run)'),
]


def run(oracle_path):
    env = dict(os.environ, ORACLE=str(oracle_path))
    return subprocess.run([sys.executable, '-B', '-m', 'unittest', 'test_oracle.py'],
                          cwd=HERE, env=env, capture_output=True, text=True)


def main():
    source = (HERE / 'oracle.py').read_text(encoding='utf-8')
    stale = [name for name, before, _ in FAULTS if source.count(before) != 1]
    if stale:
        sys.exit(f'stale or non-unique anchors: {stale}')
    base = run(HERE / 'oracle.py')
    if base.returncode != 0:
        sys.exit('the unmutated oracle must pass:\n' + base.stderr[-2000:])
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copy(HERE / 'contract.json', Path(tmp) / 'contract.json')
        for name, before, after in FAULTS:
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
