"""Correction 1 to the sealed cycle oracle: the cashbook rows.

The sealed oracle (../oracle.py, pinned in ../frozen/SEAL.json and not
changed) settles each month on its declared cashbook, <period>-cashbook.csv,
and cites the ledger's fingerprint, as C1 says. But it takes each entry's row
from the declared file, row k + 2, since the sealed ROLL-1 oracle numbers the
rows of the file it is given. The ledger the accountant opens has its header
lower, so an entry cited as row 11 of the ledger is on row 11 of the CSV, and
row 11 of the ledger holds another entry. A row cited with a file's
fingerprint is a row of that file.

Found by the product's first run (../results/run-1.json), checked on every
cited row with a reader of its own (check.py). The sealed EXPECTED.json and
the first run are kept as they are.

The correction: each month's entries are cited at the rows the sealed MAP-1
oracle reads them at in the ledger, under the header and columns of that
month's reading. Nothing else changes, and check.py holds that: EXPECTED.json
here differs from the sealed one in cashbook rows and in nothing else.
Standard library only.

  python3 -B audit/bank-cycle-foundation/correction-1/oracle.py [--write]
"""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKAGE = HERE.parent
VERSION = 'bank-cycle-foundation-oracle-1-correction-1'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sealed = load('cycle_oracle_sealed', PACKAGE / 'oracle.py')
maps = sealed.maps
# The ledger rows of each month's entries, by voucher, from its last reading.
ROWS = {}
read_ledger = sealed.read_ledger


def ledger_rows(step, period, ledger_path, saved_maps):
    out = read_ledger(step, period, ledger_path, saved_maps)
    reading = maps.read(maps.read_table(ledger_path), out['header'], out['columns'], sealed.DECIMALS)
    ROWS[period['id']] = {e['voucher']: e['row'] for e in reading['entries']}
    return out


class Rolls:
    """The sealed ROLL-1 oracle as the cycle oracle calls it, with a month's
    entries at their ledger rows."""

    def __init__(self, roll):
        self._roll = roll

    def __getattr__(self, name):
        return getattr(self._roll, name)

    def period_result(self, period, *rest):
        out = self._roll.period_result(period, *rest)
        rows = ROWS[period['id']]
        if set(rows) != set(out['rows']):
            raise sealed.StoryError(f"{period['id']}: the ledger's vouchers are not the declared ones")
        out['rows'] = dict(rows)
        return out


sealed.read_ledger = ledger_rows
sealed.roll = Rolls(sealed.roll)


def run(frozen, facts_path):
    ROWS.clear()
    return dict(sealed.run(frozen, facts_path), version=VERSION)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    a = ap.parse_args()
    frozen = PACKAGE / 'frozen'
    result = run(frozen, frozen / 'stories.json')
    text = json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True) + '\n'
    if a.write:
        (HERE / 'EXPECTED.json').write_text(text, encoding='utf-8')
    sys.stdout.write(text)


if __name__ == '__main__':
    main()
