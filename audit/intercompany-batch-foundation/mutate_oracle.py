"""Plant one fault at a time in a copy of oracle.py and require test_oracle.py
to fail with an assertion. A crash or a stale anchor is not a detection.

  python3 -B audit/intercompany-batch-foundation/mutate_oracle.py
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
    ('header-order-required',
     "if not rows or len(rows[0]) != len(head) or set(rows[0]) != set(head):",
     "if not rows or rows[0] != list(head):"),
    ('byte-order-mark-kept',
     "    if raw.startswith('\\ufeff'):\n        raw = raw[1:]\n",
     ''),
    ('arabic-digits-not-read',
     "    v = raw.translate(DIGITS).replace('٫', '.')\n",
     '    v = raw\n'),
    ('two-decimals-everywhere',
     "        decimals = DECIMALS.get(d['Currency'])\n",
     "        decimals = 2 if d['Currency'] in DECIMALS else None\n"),
    ('both-sides-allowed',
     "        if dr > 0 and cr > 0:\n",
     '        if False:\n'),
    # Declarations.
    ('declaration-not-checked',
     "        if not declaration_ok(r):\n",
     '        if False:\n'),
    ('duplicate-batch-allowed',
     "        if len(rows) > 1:\n            for n, _ in rows:\n",
     '        if False:\n            for n, _ in rows:\n'),
    ('overlap-unchecked',
     "            if same and sides(r1) == sides(r2) and \\\n",
     '            if False and \\\n'),
    ('overlap-one-orientation-only',
     "            sides = lambda r: {tuple(r[f'{h} {s}'] for h in ('Entity', 'Ledger', 'Account', 'Dimensions'))\n                               for s in 'AB'}",
     "            sides = lambda r: [tuple(r[f'{h} {s}'] for h in ('Entity', 'Ledger', 'Account', 'Dimensions'))\n                               for s in 'AB']"),
    ('unreadable-declaration-ignored',
     "            run.append('BATCH_FIELD')\n            continue\n",
     '            continue\n'),
    # Assignment.
    ('counterparty-not-part-of-identity',
     "ROW_KEY = ['Entity', 'Counterparty', 'Ledger',",
     "ROW_KEY = ['Entity', 'Entity', 'Ledger',"),
    ('first-candidate-taken',
     "            if len(found) == 1:\n",
     '            if len(found) >= 1:\n'),
    ('unassigned-blocks-nothing',
     "        for bid in hit:\n            flag(bid, code, (name, n))\n",
     '        pass\n'),
    ('unassigned-blocks-only-its-file',
     "            hit = {bid for bid, _, r in decls if entity in (r['Entity A'], r['Entity B'])} | feeds.get(name, set())",
     '            hit = feeds.get(name, set())'),
    ('ambiguous-blocks-the-entity',
     "        if code == 'UNASSIGNED_AMBIGUOUS':\n",
     '        if False:\n'),
    ('posting-period-unchecked',
     "                not d['Period start'] <= posted <= d['Period end']:",
     '                False:'),
    ('duplicate-transaction-allowed',
     "        if r['Transaction ID'] and len(same) > 1:",
     '        if False:'),
    # Relations.
    ('unattributed-relation-ignored',
     "            run.append('RELATION_UNATTRIBUTED')\n",
     ''),
    ('relation-side-unchecked',
     "            if r['Side'] not in ('A', 'B'):\n                raise Bad('RELATION_FIELD')\n",
     ''),
    ('relation-dates-unchecked',
     "            iso(r['Valid from'])\n            iso(r['Valid to'])\n",
     ''),
    ('relations-cross-batches',
     "        if len({m[0] for m in ms}) > 1:\n",
     '        if False:\n'),
    ('relation-fields-may-differ',
     "        if len({m[4:7] for m in ms}) > 1:\n",
     '        if False:\n'),
    ('validity-unchecked',
     "(m[5] > d['Period start'] or m[6] < d['Period end'] or m[5] > m[6])",
     'False'),
    ('duplicate-member-allowed',
     "        if sum(1 for x in members if (x[0], x[2], x[3]) == (m[0], m[2], m[3])) > 1:",
     '        if False:'),
    ('counterparty-conflict-unchecked',
     "                    if (bid, other, e['cp']) in entries and e['cp'] not in sides[other]:",
     '                    if False:'),
    # Decisions.
    ('one-sided-relation-ready',
     "            if not sides['A'] or not sides['B']:\n                missing.add('RELATION_ONE_SIDED')\n",
     ''),
    ('missing-member-ignored',
     "            if any(f is None for s in 'AB' for f in found[s]):\n                missing.add('RELATION_MEMBER_MISSING')\n",
     ''),
    ('unrelated-rows-ignored',
     "                missing.add('UNRELATED')\n",
     '                pass\n'),
    ('empty-side-ignored',
     "        if not rows['A'] or not rows['B']:\n            missing.add('SIDE_EMPTY')\n",
     ''),
    ('netting-inside-a-batch',
     "            'difference' if any(r['status'] == 'difference' for r in relations.values()) else 'ready')",
     "            'difference' if sum(r['residual'] or 0 for r in relations.values()) else 'ready')"),
    ('netting-across-batches',
     "    return {'batches': out, 'unassigned': sorted(unassigned), 'run': sorted(set(run))}",
     "    if not sum(r['residual'] or 0 for b in out.values() for r in b['relations'].values()):\n"
     "        for b in out.values():\n"
     "            if b['status'] == 'difference':\n"
     "                b['status'] = 'ready'\n"
     "    return {'batches': out, 'unassigned': sorted(unassigned), 'run': sorted(set(run))}"),
    ('residual-from-batch-totals',
     "            residual = net['A'] + net['B']\n",
     "            residual = sum(e[0]['net'] for (b, s, t), e in entries.items() if b == bid)\n"),
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
