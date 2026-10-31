"""Mutants of cashbook.py, each of which a test of class Cashbook must kill
by a failed assertion, not an error (DEV-22).

Each mutant removes or weakens one rule copied from the product's cashbook
path (G16): typed amounts, the precision note kept to the amount columns,
reference notes, a hidden sheet, the contrast threshold, hidden columns,
formulas, merges, numbers that lose digits, hidden zeros, rich-text runs,
number and text formats, Excel errors, core properties left out or
refused, dates read as numbers, the table's width, the header row's own
issues and the empty row. The tool is copied with the mutant into a
temporary tree that links the repository's sources and the sealed packages
(mutate_columns.tree). Exit status 1 if a mutant survives.
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from mutate_columns import tree

MUTANTS = {
    'typed-as-text': ("(typed if numeric and typed_amounts else money)", "money"),
    'precision-everywhere': ("not (name in ('Receipts', 'Payments') and i == PRECISION_NOTE)", "not i == PRECISION_NOTE"),
    'precision-refused': ("not (name in ('Receipts', 'Payments') and i == PRECISION_NOTE)", "True"),
    'reference-notes-ignored': ("(reference if name in ('Voucher', 'Reference') else [])", "[]"),
    'hidden-sheet-ignored': ("            if book['sheet']['hidden']:", "            if False:"),
    'contrast-threshold-off': ("(min(fore, back) + 0.05) >= 3", "(min(fore, back) + 0.05) >= 1"),
    'hidden-column-ignored': ("        if c in sheet['zeroColumns'] or c in sheet['hiddenColumns'] or (",
                              "        if False and ("),
    'formula-allowed': ("        issues.append('formula')", "        pass"),
    'merge-ignored': ("            issues.append('merged')", "            pass"),
    'large-number-allowed': ("or abs(value) >= 1e15:", "or abs(value) >= 1e30:"),
    'core-never-left-out': ("            if known and renamed:\n                return 'left out'\n", ""),
    'core-unknown-allowed': ("    if unknown:\n", "    if False:\n"),
    'dates-read-as-numbers': ("    if date_format(numfmt):", "    if False:"),
    'width-unchecked': ("book['columns'] != len(HEADERS)", "book['columns'] < len(HEADERS)"),
    'header-issues-skipped': ("        recorded(1)\n", ""),
    'empty-row-allowed': ("            if not any(texts):", "            if False:"),
    'lexeme-unchecked': ("        if cell['v'] and decimal_identity(cell['v']) != decimal_identity(js_number(float(cell['v']))):\n            issues.append(PRECISION_NOTE)\n        text = parsed",
                         "        text = parsed"),
    'hidden-zero-ignored': ("        if sheet['hideZeros'] and kind == 'number' and value == 0:", "        if False:"),
    'rich-run-ignored': ("        if kind == 'rich' and any(", "        if False and any("),
    'number-format-ignored': ("        if not transparent_numeric(fmt, value):", "        if False:"),
    'text-format-ignored': ("    if plain and not transparent_text(fmt):", "    if False:"),
    'error-allowed': ("        issues.append('Excel error')", "        pass"),
}


def main():
    survived = []
    for name, (old, new) in MUTANTS.items():
        with tempfile.TemporaryDirectory() as temp:
            tool = tree(Path(temp))
            source = (tool / 'cashbook.py').read_text(encoding='utf-8')
            if source.count(old) != 1:
                raise SystemExit(f'{name}: the line it mutates is not in cashbook.py once')
            (tool / 'cashbook.py').write_text(source.replace(old, new), encoding='utf-8')
            run = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'test_cashbook.Cashbook'],
                                 cwd=tool, capture_output=True, text=True)
            summary = re.search(r'FAILED \(([^)]*)\)', run.stderr)
            killed = bool(summary and 'failures=' in summary.group(1))
            print(name, 'killed' if killed else f'SURVIVED {summary.group(0) if summary else "passed"}')
            if not killed:
                survived.append(name)
    sys.exit(1 if survived else 0)


if __name__ == '__main__':
    main()
