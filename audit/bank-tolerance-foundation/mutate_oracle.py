"""Plant one fault at a time in a copy of the TOL-1 oracle.py and require
test_oracle.py to fail with an assertion. A crash or a stale anchor is not a
detection.

  python3 -B audit/bank-tolerance-foundation/mutate_oracle.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAULTS = [
    ('differences-netted',
     "    total = sum(abs(a - b) for _, a, b, _ in eligible)",
     "    total = abs(sum(a - b for _, a, b, _ in eligible))"),
    ('limit-exclusive',
     "abs(amount - e['amount']) <= policy['perItem']:",
     "abs(amount - e['amount']) < policy['perItem']:"),
    ('date-window-ignored',
     "        if days(s['date'], e['date']) <= WINDOW and abs(amount - e['amount']) <= policy['perItem']:",
     "        if abs(amount - e['amount']) <= policy['perItem']:"),
    ('period-total-filled-in-order',
     "    if total > policy['perPeriod']:\n        return {'sum': total, 'cap': policy['perPeriod']}",
     "    while eligible and sum(abs(a - b) for _, a, b, _ in eligible) > policy['perPeriod']:\n        eligible.pop()"),
    ('direction-conflicts-tolerated',
     "        if c['kind'] != 'review' or c['reason'] != 'amount-difference':",
     "        if c['kind'] != 'review' or c['reason'] not in ('amount-difference', 'direction-conflict'):"),
    ('pairs-made-by-near-amounts',
     "            if x['direction'] == y['direction'] and x['amount'] == y['amount'] and days(x['date'], y['date']) <= WINDOW:",
     "            if x['direction'] == y['direction'] and abs(x['amount'] - y['amount']) <= 1 and days(x['date'], y['date']) <= WINDOW:"),
    ('effect-sign-of-a-payment',
     "            effect = a['statement'] - a['cashbook'] if a['direction'] == 'in' else a['cashbook'] - a['statement']",
     "            effect = a['statement'] - a['cashbook']"),
    ('tolerated-not-cleared',
     "        if c['status'] in ('matched', 'accepted', 'matched-tolerated'):",
     "        if c['status'] in ('matched', 'accepted'):"),
    ('tolerance-reads-as-reconciled',
     "        status = 'reconciled-within-tolerance' if unexplained == 0 else 'difference'",
     "        status = 'reconciled' if unexplained == 0 else 'difference'"),
    ('tolerance-hides-the-book-difference',
     "    unexplained = difference - tolerated_sum",
     "    unexplained = 0 if tolerated else difference - tolerated_sum"),
    ('policy-outside-the-context',
     "        if d['policy'] != policy:\n            return dict(out, refused='DECISION')",
     "        if False:\n            return dict(out, refused='DECISION')"),
    ('undo-to-review',
     "            c.update(status={'automatic': 'matched', 'tolerated': 'matched-tolerated'}.get(c['kind'], 'needs-review'),",
     "            c.update(status={'automatic': 'matched'}.get(c['kind'], 'needs-review'),"),
    ('one-major-unit-allowed',
     "    if not whole(policy.get('perItem')) or not 1 <= policy['perItem'] < 10 ** exponent:",
     "    if not whole(policy.get('perItem')) or not 1 <= policy['perItem'] <= 10 ** exponent:"),
    ('period-below-the-pair-allowed',
     "    if not whole(policy.get('perPeriod')) or not policy['perItem'] <= policy['perPeriod'] < 100 * 10 ** exponent:",
     "    if not whole(policy.get('perPeriod')) or not policy['perPeriod'] < 100 * 10 ** exponent:"),
    ('blank-note-accepted',
     "    if not isinstance(note, str) or not note.strip() or '\\n' in note or '\\r' in note:",
     "    if not isinstance(note, str) or not note or '\\n' in note or '\\r' in note:"),
    ('kuwaiti-fils-read-as-halalas',
     "EXPONENT = {'SAR': 2, 'KWD': 3, 'JPY': 0}",
     "EXPONENT = {'SAR': 2, 'KWD': 2, 'JPY': 0}"),
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
        # The copy reads contract.json beside it and the bank statement
        # foundation's contract beside its parent.
        root = Path(tmp) / 'audit'
        (root / 'bank-tolerance-foundation').mkdir(parents=True)
        (root / 'bank-statement-foundation').mkdir()
        (root / 'bank-tolerance-foundation' / 'contract.json').write_text(
            (HERE / 'contract.json').read_text(encoding='utf-8'), encoding='utf-8')
        (root / 'bank-statement-foundation' / 'contract.json').write_text(
            (HERE.parent / 'bank-statement-foundation' / 'contract.json').read_text(encoding='utf-8'), encoding='utf-8')
        for name, before, after in FAULTS:
            if source.count(before) != 1:
                sys.exit(f'stale or non-unique anchor: {name}')
            target = root / 'bank-tolerance-foundation' / f'{name}.py'
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
