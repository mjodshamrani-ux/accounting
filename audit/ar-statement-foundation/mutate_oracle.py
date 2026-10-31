"""Plant one fault at a time in a copy of oracle.py and require test_oracle.py
to fail with an assertion. A crash or a stale anchor is not a detection.

  python3 -B audit/ar-statement-foundation/mutate_oracle.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAULTS = [
    ('every-header-continues-the-section',
     "if section is not None and sections[section]['key'] == key and scope is not None:",
     'if section is not None:'),
    ('compare-every-section',
     "statement = sections[chosen[0]]['lines'] if len(chosen) == 1 else []",
     "statement = [l for s in sections for l in s['lines']] if len(chosen) == 1 else []"),
    ('open-amount-for-original',
     "minor = printed_money(values['original'], PRECISION[s['scope']['currency']])",
     "minor = printed_money(values.get('open') or values['original'], PRECISION[s['scope']['currency']])"),
    ('no-period-check',
     "if not s['scope']['start'] <= when <= s['scope']['end']:",
     'if False:'),
    ('scope-by-customer-only',
     "chosen = [i for i, s in enumerate(sections) if same_document and s['scope'] == wanted]",
     "chosen = [i for i, s in enumerate(sections) if same_document and s['scope'] and s['scope']['customer'] == wanted['customer']]"),
    ('continuation-by-customer-only',
     "key = json.dumps([fields.get(k) for k in ('customer', 'name', 'account', 'currency', 'period')])",
     "key = json.dumps([fields.get('customer')])"),
    ('identity-by-number-only',
     "buckets.setdefault((r['kind'], r['document']),",
     "buckets.setdefault(('any', r['document']),"),
    ('repeated-scope-allowed',
     'if len(chosen) > 1:',
     'if False:'),
    ('zero-is-an-amount',
     "    if minor == 0:\n        raise LineError('AR_AMOUNT')\n    return minor\n\n\ndef ledger_money",
     '    return minor\n\n\ndef ledger_money'),
    ('no-direction-check',
     '                    direction(kind, minor)\n',
     '                    pass\n'),
    ('related-conflict-ignored',
     'elif len(related) > 1:',
     'elif False:'),
    ('errors-do-not-block',
     'blocked = bool(errors)',
     'blocked = False'),
    ('date-difference-ignored',
     "elif s[0]['date'] != l[0]['date']:",
     'elif False:'),
    ('ledger-scope-unchecked',
     'if r[column].strip() != scope[key]:',
     'if False:'),
    ('orphan-line-ignored',
     "                    error('AR_PDF_ORPHAN_LINE', where)\n",
     '                    pass\n'),
    ('separators-anywhere',
     r"(?:\d{{1,3}}(?:,\d{{3}})+|\d+)",
     r"[\d,]+"),
    ('scope-not-found-unreported',
     'elif not chosen and headers_known',
     'elif False and headers_known'),
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
