"""Plant one fault at a time in a copy of oracle.py and require test_oracle.py
to fail with an assertion. A crash or a stale anchor is not a detection.

  python3 -B audit/bank-sheet-foundation/mutate_oracle.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAULTS = [
    ('opposite-items-netted',
     '    return out\n\n\ndef position(item):',
     "    amounts = {}\n"
     "    for i in out:\n"
     "        amounts.setdefault((i['side'], i['amount']), set()).add(i['direction'])\n"
     "    return [i for i in out if amounts[(i['side'], i['amount'])] != {'in', 'out'}]\n\n\ndef position(item):"),
    ('section-by-side-only',
     "if i['side'] == side and i['direction'] == direction",
     "if i['side'] == side"),
    ('difference-reversed',
     'difference = adjusted_bank - adjusted_book',
     'difference = adjusted_book - adjusted_bank'),
    ('book-side-reversed',
     "adjusted_book = book['balance'] + sections['statementDepositsNotInBook']['total'] - sections['statementWithdrawalsNotInBook']['total']",
     "adjusted_book = book['balance'] - sections['statementDepositsNotInBook']['total'] + sections['statementWithdrawalsNotInBook']['total']"),
    ('bank-from-opening',
     "for l in p['lines'] if l['kind'] == 'closing')",
     "for l in p['lines'] if l['kind'] == 'opening')"),
    ('pending-counted-cleared',
     "{'accepted': None, 'rejected': 'rejected', None: 'pending'}",
     "{'accepted': None, 'rejected': 'rejected', None: None}"),
    ('rejected-counted-cleared',
     "{'accepted': None, 'rejected': 'rejected', None: 'pending'}",
     "{'accepted': None, 'rejected': None, None: 'pending'}"),
    ('accepted-carried-case-leaves-its-member',
     '            if state is None:\n                origin.pop(key, None)\n',
     '            if state is None:\n                pass\n'),
    ('still-carried-dropped',
     "    for c in cleared['still']:\n        origin[c['item']] = ('carried', None)\n",
     ''),
    ('age-not-counted',
     "'amount': c['amount'], 'reference': c['reference'], 'age': c['age'] + 1,",
     "'amount': c['amount'], 'reference': c['reference'], 'age': c['age'],"),
    ('draft-ignored',
     "    if any(i['origin'] == 'pending' for i in items):\n        status = 'draft'\n    elif",
     "    if False:\n        status = 'draft'\n    elif"),
    ('one-unit-tolerated',
     '    elif difference == 0:\n',
     '    elif abs(difference) <= 1:\n'),
    ('difference-explained-by-an-item',
     '    elif difference == 0:\n',
     "    elif difference == 0 or any(i['amount'] == abs(difference) for i in items):\n"),
    ('signoff-always-valid',
     "'valid': signed[kind][1] == final",
     "'valid': True"),
    ('signoff-on-the-figures-only',
     "'valid': signed[kind][1] == final",
     "'valid': (signed[kind][1]['status'], signed[kind][1]['difference']) == (final['status'], final['difference'])"),
    ('book-before-held',
     "    if settled['base']['held']:\n        return {'refusal': 'SHEET_STATEMENT_HELD'}\n",
     "    if book is None:\n        return {'refusal': 'SHEET_NO_BOOK_BALANCE'}\n"
     "    if settled['base']['held']:\n        return {'refusal': 'SHEET_STATEMENT_HELD'}\n"),
    ('refused-previous-ignored',
     "    if settled['previous'] not in ('none', 'accepted'):\n        return {'refusal': 'SHEET_PREVIOUS_REFUSED'}\n",
     ''),
    ('any-case-accepted',
     "        if case['reason'] not in allowed:\n",
     '        if False:\n'),
]


def run(oracle_path):
    env = dict(os.environ, ORACLE=str(oracle_path), ROLL_FOUNDATION=str(HERE.parent / 'bank-roll-foundation'))
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
            # The copy reads contract.json beside it.
            (Path(tmp) / 'contract.json').write_text((HERE / 'contract.json').read_text(encoding='utf-8'), encoding='utf-8')
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
