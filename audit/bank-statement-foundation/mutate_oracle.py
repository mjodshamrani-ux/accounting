"""Tests the oracle tests: each planted defect in a copy of oracle.py must
make test_oracle.py fail. A surviving defect means a rule nobody checks.

  python3 -B audit/bank-statement-foundation/mutate_oracle.py
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
MUTANTS = {
    'duplicate reference approved': ("        if len(b) == 1 and len(c) == 1:", "        if len(b) >= 1 and len(c) >= 1:"),
    'no date window on reference': ("            elif days(x['date'], y['date']) > window:", "            elif False:"),
    'no direction check on reference': ("            if x['direction'] != y['direction']:\n                reason = 'direction-conflict'",
                                        "            if False:\n                reason = 'direction-conflict'"),
    'printed balance unchecked': ("                if minor(line['balance']) != running:", "                if False:"),
    'page sequence unchecked': ("    if len(declared) != 1 or numbers != list(range(1, next(iter(declared)) + 1)):", "    if False:"),
    'ambiguous group suggested': ("        reason = 'amount-date-suggestion' if len(component) == 2 else 'ambiguous-amount-date'",
                                  "        reason = 'amount-date-suggestion'"),
    'held statement still matched': ("        if status['statement'] != 'verified':", "        if False:"),
    'page totals unchecked': ("                if (minor(line['withdrawal']), minor(line['deposit'])) != (page_wd, page_dep):", "                if False:"),
    'reference case-folded': ("    references = sorted({r['reference'] for r in bank + cash if r['reference']})",
                              "    for r in bank + cash:\n        r['reference'] = r['reference'].upper()\n"
                              "    references = sorted({r['reference'] for r in bank + cash if r['reference']})"),
    'continuation counted as movement': ("            if line['kind'] == 'movement':\n                movements.append",
                                         "            if line['kind'] in ('movement', 'continuation'):\n                movements.append"),
    'brought-forward unchecked': ("                if running is None or minor(line['balance']) != running:", "                if running is None:"),
    'cashbook row with both or neither column accepted': ("        if (receipt > 0) == (payment > 0) or voucher in vouchers:", "        if voucher in vouchers:"),
}

survivors = []
for name, (old, new) in MUTANTS.items():
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / 'suite'
        shutil.copytree(HERE, copy, ignore=shutil.ignore_patterns('__pycache__'))
        code = (copy / 'oracle.py').read_text(encoding='utf-8')
        if code.count(old) != 1:
            raise SystemExit(f'mutant anchor not found once: {name}')
        (copy / 'oracle.py').write_text(code.replace(old, new), encoding='utf-8')
        r = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'discover', '-s', str(copy), '-p', 'test_oracle.py'],
                           capture_output=True, text=True)
        verdict = 'killed' if r.returncode else 'SURVIVED'
        print(f'{verdict:8} {name}')
        if not r.returncode:
            survivors.append(name)
print(f'{len(MUTANTS) - len(survivors)}/{len(MUTANTS)} planted defects detected')
raise SystemExit(1 if survivors else 0)
