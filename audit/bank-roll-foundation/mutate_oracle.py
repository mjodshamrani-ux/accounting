"""Plant one fault at a time in a copy of oracle.py and require test_oracle.py
to fail with an assertion. A crash or a stale anchor is not a detection.

  python3 -B audit/bank-roll-foundation/mutate_oracle.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAULTS = [
    ('undecided-period-carries',
     "    if any(c['status'] == 'needs-review' for c in result['cases']):\n        raise Refused('ROLL_PREVIOUS_UNDECIDED')\n",
     ''),
    ('held-period-carries',
     "    if result['held']:\n        raise Refused('ROLL_PREVIOUS_HELD')\n",
     ''),
    ('fingerprint-not-checked',
     "        if sha(raw) != f['sha256']:\n            raise Refused('ROLL_PREVIOUS_UNREADABLE')\n",
     ''),
    ('any-currency',
     "    if a['currency'] != b['currency']:\n        return 'ROLL_CURRENCY'\n",
     ''),
    ('any-earlier-period',
     "date.fromisoformat(a['period']['end']) + timedelta(days=1) != date.fromisoformat(b['period']['start'])",
     "date.fromisoformat(a['period']['end']) >= date.fromisoformat(b['period']['start'])"),
    ('opening-not-checked',
     "    if closing != opening:\n        return 'ROLL_OPENING'\n",
     ''),
    ('rejected-items-not-outstanding',
     "            origin.update({('S', s): c['id'] for s in c['statement']})\n            origin.update({('C', v): c['id'] for v in c['cashbook']})\n",
     '            pass\n'),
    ('decision-context-ignored',
     "if d['context'] != context or c is None",
     'if c is None'),
    ('any-case-accepted',
     "if c['status'] != 'needs-review' or c['reason'] not in ACCEPTABLE:",
     "if c['status'] != 'needs-review':"),
    ('no-repetition',
     "        if not same:\n            continue\n",
     '        continue\n'),
    ('restated-as-repeated',
     "        restated = any((x[2], x[3], x[5]) != (c['direction'], c['amount'], c['date']) for x in same)",
     '        restated = False'),
    ('first-of-several-references',
     "            if len(by_ref) > 1:\n                reason = 'carried-ambiguous'\n            else:\n                reason = 'carried-reference' if by_ref[0][3] == c['amount'] else 'carried-amount-difference'\n            links.append(({c['item']}, set(by_ref), reason))",
     "            reason = 'carried-reference' if by_ref[0][3] == c['amount'] else 'carried-amount-difference'\n            links.append(({c['item']}, {by_ref[0]}, reason))"),
    ('amount-difference-as-reference',
     "reason = 'carried-reference' if by_ref[0][3] == c['amount'] else 'carried-amount-difference'",
     "reason = 'carried-reference'"),
    ('amount-pairs-two-references',
     "x[3] == c['amount'] and (not c['reference'] or not x[4])",
     "x[3] == c['amount']"),
    ('age-not-counted',
     "stillCarried=[{'item': c['item'], 'age': c['age'] + 1} for c in cleared['still']]",
     "stillCarried=[{'item': c['item'], 'age': c['age']} for c in cleared['still']]"),
    ('carried-against-matched-items',
     "    unmatched = [x for x in cur if (x[0] == 'S' and x[1] in own['bankOnly']) or (x[0] == 'C' and x[1] in own['cashOnly'])]",
     '    unmatched = cur'),
]


def run(oracle_path):
    env = dict(os.environ, ORACLE=str(oracle_path), BANK_FOUNDATION=str(HERE.parent / 'bank-statement-foundation'))
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
