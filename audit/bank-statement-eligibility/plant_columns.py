"""The planted statements of test_eligibility.py's class Columns, written to
a folder so that the reader can read them too (measure_columns.mjs).

  PYTHONPATH=<pymupdf 2.0> python3 -B plant_columns.py <dir>

Each is built by the test's own helpers, so what is measured is what the
tests assert.
"""
import sys
from pathlib import Path

import test_eligibility as t

CASES = {
    'columns-clean': lambda: t.whole('columns-clean', [t.ONE]),
    'columns-pad-in': lambda: t.whole('columns-pad-in', [t.ONE], start_shift=-2.4),
    'columns-pad-out': lambda: t.whole('columns-pad-out', [t.ONE], start_shift=-2.6),
    'columns-slot': lambda: t.whole('columns-slot', [t.ONE], end_shift=14.4),
    'columns-slot-small': lambda: t.whole('columns-slot-small', [t.ONE], end_shift=2.4),
    'columns-continued': lambda: t.whole('columns-continued', t.two('(continued) at the till')),
    'columns-across': lambda: t.whole('columns-across', t.two('(continued) at the till of the branch for the whole of April')),
    'columns-header': lambda: t.whole('columns-header', [t.ONE], headers=t.HEADERS[:3] + ['Ref.'] + t.HEADERS[4:]),
    'columns-stray': lambda: t.whole('columns-stray', [[t.ONE[0], ['', '', 'Card settlement', '', '', '', '']] + t.ONE[1:]]),
    'columns-end': lambda: t.whole('columns-end', [t.ONE], end_shift=2.4),
    'columns-runs': lambda: t.runs('columns-runs'),
    'columns-subsets': lambda: t.subsets('columns-subsets'),
    'columns-ligature': lambda: t.ligature('columns-ligature'),
}


def main(out):
    t.TMP = Path(out)
    t.TMP.mkdir(parents=True, exist_ok=True)
    kept = {Path(build().name).name for build in CASES.values()}
    # A helper that edits a built statement leaves the unedited one behind.
    for path in t.TMP.glob('*.pdf'):
        if path.name not in kept:
            path.unlink()


if __name__ == '__main__':
    main(sys.argv[1])
