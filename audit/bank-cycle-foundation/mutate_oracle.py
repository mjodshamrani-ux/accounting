"""Plant one fault at a time in a copy of the cycle oracle.py, in the rules
it adds where the sealed contracts meet, and require test_oracle.py to fail
with an assertion. A crash or a stale anchor is not a detection.

  python3 -B audit/bank-cycle-foundation/mutate_oracle.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAULTS = [
    # Tolerance across the months.
    ('tolerated-members-left-pending',
     "        decision = 'accepted' if c['kind'] == 'tolerated' and c['decision'] is None else c['decision']",
     "        decision = c['decision']"),
    ('no-tolerance-in-a-carrying-month',
     "    exceeded = tolerate(cases, base, month_state['policy'])",
     "    exceeded = tolerate(cases, base, month_state['policy'] if previous is None else None)"),
    ('rejected-tolerated-not-carried',
     "        if i['origin'] == 'pending':\n            continue",
     "        if i['origin'] == 'pending' or i['reason'] == 'within-tolerance':\n            continue"),
    ('carried-case-tolerated',
     "    total = sum(abs(a - b) for _, a, b, _ in eligible)",
     "    eligible += [(c, 0, 0, 'in') for c in cases if c['reason'] == 'carried-amount-difference']\n"
     "    total = sum(abs(a - b) for _, a, b, _ in eligible)"),
    ('period-total-netted',
     "    total = sum(abs(a - b) for _, a, b, _ in eligible)",
     "    total = abs(sum(a - b for _, a, b, _ in eligible))"),
    ('period-total-filled-in-order',
     "    if total > policy['perPeriod']:\n        return {'sum': total, 'cap': policy['perPeriod']}",
     "    while eligible and sum(abs(a - b) for _, a, b, _ in eligible) > policy['perPeriod']:\n        eligible.pop()"),
    ('pair-limit-exclusive',
     "abs(amount - book) <= policy['perItem']:",
     "abs(amount - book) < policy['perItem']:"),
    ('date-window-ignored',
     "        if days(s['date'], e['date']) <= WINDOW and abs(amount - book) <= policy['perItem']:",
     "        if abs(amount - book) <= policy['perItem']:"),
    ('tolerated-case-accepted',
     "allowed = roll.ACCEPTABLE if case['kind'] == 'review' else ACCEPT_CARRIED if case['kind'] == 'carried' else set()",
     "allowed = roll.ACCEPTABLE if case['kind'] == 'review' else ACCEPT_CARRIED if case['kind'] == 'carried' "
     "else {'within-tolerance'}"),
    ('policy-after-a-decision-allowed',
     "            if state['decisions']:\n                raise StoryError",
     "            if False:\n                raise StoryError"),
    # The queue.
    ('queue-before-the-policy',
     "    exceeded = tolerate(cases, base, month_state['policy'])\n    groups = queue(cases, base)",
     "    groups = queue(cases, base)\n    exceeded = tolerate(cases, base, month_state['policy'])"),
    ('group-offers-ignored',
     "        if not found[0]['offers'][g['type']]:",
     "        if False:"),
    # The previous month.
    ('undecided-previous-taken',
     "    if previous['pending']:\n        return 'ROLL_PREVIOUS_UNDECIDED', []",
     "    if False:\n        return 'ROLL_PREVIOUS_UNDECIDED', []"),
    ('continuity-ignored',
     "    problem = roll.continuity(previous['period'], current)",
     "    problem = None"),
    ('carried-age-not-advanced',
     "            c = dict(by_item[i['item']], age=by_item[i['item']]['age'] + 1)",
     "            c = dict(by_item[i['item']])"),
    ('carried-cases-numbered-first',
     "    for c in cleared['cases']:\n        current = [k.split(':', 1)[1] for k in c['current']]\n        cases.append(",
     "    for c in cleared['cases']:\n        current = [k.split(':', 1)[1] for k in c['current']]\n        cases.insert(0, "),
    # The ledger.
    ('ledger-not-held-to-its-twin',
     "    if entries != declared_entries(period):",
     "    if False:"),
    # The sheet.
    ('sheet-ignores-the-tolerance',
     "    unexplained = difference - total",
     "    unexplained = difference"),
    ('effect-sign-of-a-payment',
     "            effect = a['statement'] - a['cashbook'] if a['direction'] == 'in' else a['cashbook'] - a['statement']",
     "            effect = a['statement'] - a['cashbook']"),
    ('sections-by-month-name',
     "    earlier = item['period'] != month",
     "    earlier = sheets.MONTHS.index(item['period']) < sheets.MONTHS.index(month)"),
]


def run(oracle_path, frozen):
    env = dict(os.environ, CYCLE_ORACLE=str(oracle_path), CYCLE_AUDIT=str(HERE.parent), CYCLE_HOME=str(HERE),
               CYCLE_FROZEN=str(frozen))
    return subprocess.run([sys.executable, '-B', '-m', 'unittest', 'test_oracle.py'],
                          cwd=HERE, env=env, capture_output=True, text=True)


def main():
    frozen = Path(os.environ.get('CYCLE_FROZEN', HERE / 'frozen'))
    source = (HERE / 'oracle.py').read_text(encoding='utf-8')
    base = run(HERE / 'oracle.py', frozen)
    if base.returncode != 0:
        sys.exit('the unmutated oracle must pass:\n' + base.stderr[-2000:])
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, before, after in FAULTS:
            if source.count(before) != 1:
                sys.exit(f'stale or non-unique anchor: {name}')
            target = Path(tmp) / f'{name}.py'
            target.write_text(source.replace(before, after), encoding='utf-8')
            r = run(target, frozen)
            detected = r.returncode != 0 and 'AssertionError' in r.stderr
            results.append({'fault': name, 'detected': detected})
            print(f"{'detected' if detected else 'SURVIVED'}: {name}", file=sys.stderr)
    print(json.dumps({'faults': len(results), 'detected': sum(r['detected'] for r in results),
                      'results': results}, indent=1))
    if not all(r['detected'] for r in results):
        sys.exit(1)


if __name__ == '__main__':
    main()
