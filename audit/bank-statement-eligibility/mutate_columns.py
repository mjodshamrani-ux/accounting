"""Mutants of columns.py, each of which a test of class Columns must kill.

Each mutant changes one rule copied from the reader: the cell padding,
right-to-left items kept whole, end alignment, DR joined to its amount, a
continuation only after the brought-forward line, and date runs joined;
reads by the MuPDF model of G13 to G18 (G19); or stops counting one the
record of exercised rules carries (G14). PDF.js's item gap and ligature letters kept in their glyph
were mutated here until G18, in the MuPDF model; since G19 the items are
items.py's, and mutate_items.py mutates those two rules there. The tool is copied
with the mutant into a temporary tree that links the repository's reader
source, its scripts, the product's own Unicode fixtures and the sealed
packages, and the tests run there, after they pass there unmutated;
mutate_tounicode.py and mutate_items.py run their mutants the same way. Exit
status 1 if a mutant survives.
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

MUTANTS = {
    'padding': ('PADDING, SEPARATION, UNDER = 2.5, 1, 0.5', 'PADDING, SEPARATION, UNDER = 3.0, 1, 0.5'),
    'rtl-split': ('        if self.rtl or len(self.words) == 1:', '        if len(self.words) == 1:'),
    'end-alignment-off': ("        return (k, 'end') if ends and clear else (None, None)", '        return None, None'),
    'dr-join-off': ("        if mark.text != 'DR' or columns.of(mark) != BALANCE:", '        if True:'),
    'continuation-anywhere': ("            elif out and out[-1] == 'brought-forward':", '            elif out:'),
    'date-runs-apart': ("            if len(cells[col]) > 1 and not re.search(r'\\s', joined):", '            if False:'),
    'dr-uncounted': ("        used['drAfterAmount'] += 1\n", ''),
    'date-runs-uncounted': ("                used['dateRuns'] += 1\n", ''),
    'end-alignment-uncounted': ("        used['endAligned'] += sum(1 for p in pieces if columns.placed(p)[1] == 'end')\n", ''),
    'mupdf-model': ('            lines = items(page)\n', '            lines = mupdf_items(page)\n'),
}


def tree(at):
    """A repository root at `at` with this tool copied and the rest linked."""
    (at / 'lib').symlink_to(ROOT / 'lib')
    (at / 'scripts').symlink_to(ROOT / 'scripts')
    audit = at / 'audit'
    audit.mkdir()
    for package in sorted((ROOT / 'audit').glob('bank-statement-holdout-*')) + [ROOT / 'audit' / 'native-unicode']:
        (audit / package.name).symlink_to(package)
    tool = audit / HERE.name
    tool.mkdir()
    for name in ('columns.py', 'tounicode.py', 'cashbook.py', 'items.py', 'plant_items.py', 'rows.py', 'plant_rows.py',
                 'eligibility.py', 'test_eligibility.py', 'test_cashbook.py'):
        shutil.copy(HERE / name, tool / name)
    return tool


def main(mutants=MUTANTS, module='columns.py', tests='test_eligibility.Columns'):
    # The unmutated tree must pass, or every mutant would be killed by what
    # the tree lacks rather than by an assertion (DEV-22).
    with tempfile.TemporaryDirectory() as temp:
        run = subprocess.run([sys.executable, '-B', '-m', 'unittest', tests],
                             cwd=tree(Path(temp)), capture_output=True, text=True)
        if run.returncode != 0:
            raise SystemExit(f'the unmutated tree fails {tests}:\n{run.stderr[-2000:]}')
    survived = []
    for name, change in mutants.items():
        # A mutant of another module than the one named names its own.
        target, (old, new) = (change[0], change[1:]) if len(change) == 3 else (module, change)
        with tempfile.TemporaryDirectory() as temp:
            tool = tree(Path(temp))
            source = (tool / target).read_text(encoding='utf-8')
            if source.count(old) != 1:
                raise SystemExit(f'{name}: the line it mutates is not in {target} once')
            (tool / target).write_text(source.replace(old, new), encoding='utf-8')
            run = subprocess.run([sys.executable, '-B', '-m', 'unittest', tests],
                                 cwd=tool, capture_output=True, text=True)
            # A kill is a test's assertion failing, not an error (DEV-22).
            killed = run.returncode != 0 and '\nFAIL: ' in run.stderr
            print(name, 'killed' if killed else 'SURVIVED' if run.returncode == 0 else 'ERRORED, not killed')
            if not killed:
                survived.append(name)
    sys.exit(1 if survived else 0)


if __name__ == '__main__':
    main()
