"""Plant one fault at a time in a copy of the REVIEW-1 oracle.py and require
test_oracle.py to fail with an assertion. A crash or a stale anchor is not a
detection.

  python3 -B audit/bank-review-foundation/mutate_oracle.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAULTS = [
    ('exceptions-not-first',
     "    out.sort(key=lambda g: (0 if g['class'] == 'exception' else 1, -g['impact'], -g['members'],",
     "    out.sort(key=lambda g: (0, -g['impact'], -g['members'],"),
    ('impact-summed',
     "        'impact': max(total_s, total_c),",
     "        'impact': total_s + total_c,"),
    ('impact-from-the-statement-only',
     "        'impact': max(total_s, total_c),",
     "        'impact': total_s,"),
    ('members-tie-ignored',
     "    out.sort(key=lambda g: (0 if g['class'] == 'exception' else 1, -g['impact'], -g['members'],",
     "    out.sort(key=lambda g: (0 if g['class'] == 'exception' else 1, -g['impact'], 0,"),
    ('cases-by-number-only',
     "        g['cases'].sort(key=lambda c: (-c['impact'], int(c['case'][1:])))",
     "        g['cases'].sort(key=lambda c: int(c['case'][1:]))"),
    ('grouped-by-reason-only',
     "    return '|'.join([ev['reason'], ev['direction'], f\"{ev['statement']}:{ev['cashbook']}\", str(ev.get('gap', ''))])",
     "    return ev['reason']"),
    ('direction-ignored',
     "    return '|'.join([ev['reason'], ev['direction'], f\"{ev['statement']}:{ev['cashbook']}\", str(ev.get('gap', ''))])",
     "    return '|'.join([ev['reason'], f\"{ev['statement']}:{ev['cashbook']}\", str(ev.get('gap', ''))])"),
    ('shape-ignored',
     "    return '|'.join([ev['reason'], ev['direction'], f\"{ev['statement']}:{ev['cashbook']}\", str(ev.get('gap', ''))])",
     "    return '|'.join([ev['reason'], ev['direction'], str(ev.get('gap', ''))])"),
    ('gap-ignored',
     "    return '|'.join([ev['reason'], ev['direction'], f\"{ev['statement']}:{ev['cashbook']}\", str(ev.get('gap', ''))])",
     "    return '|'.join([ev['reason'], ev['direction'], f\"{ev['statement']}:{ev['cashbook']}\"])"),
    ('decided-cases-queued',
     "        if case['kind'] != 'review' or case['status'] != 'needs-review':",
     "        if case['kind'] != 'review':"),
    ('accept-offered-for-exceptions',
     "        g['offers'] = {'accept': len(g['cases']) >= 2 and g['class'] == 'suggestion',",
     "        g['offers'] = {'accept': len(g['cases']) >= 2,"),
    ('group-of-one-offered',
     "                       'reject': len(g['cases']) >= 2}",
     "                       'reject': len(g['cases']) >= 1}"),
    ('group-records-one-decision',
     "            for c in g['cases']:\n                record(decisions, settled, by_id[c['case']], a['type'])",
     "            for c in g['cases'][:1]:\n                record(decisions, settled, by_id[c['case']], a['type'])"),
    ('changed-source-kept',
     "            if any(d['context'] != fresh['context'] for d in decisions):",
     "            if False:"),
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
