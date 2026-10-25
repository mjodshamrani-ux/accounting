"""Mutants of columns.py, each of which a test of class Columns must kill.

Each mutant changes one rule copied from the reader: the cell padding,
PDF.js's item gap, right-to-left items kept whole, ligature letters kept in
their glyph, end alignment, DR joined to its amount, a continuation only
after the brought-forward line, and date runs joined; or stops counting one
the record of exercised rules carries (G14). The tool is copied
with the mutant into a temporary tree that links the repository's reader
source, its scripts, the product's own Unicode fixtures and the sealed
packages, and the tests run there; mutate_tounicode.py runs its mutants the
same way. Exit status 1 if a mutant survives.
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
    'flow-max': ('FLOW_MAX, FLOW_MIN, BACK = 0.6, 0.102, -0.2', 'FLOW_MAX, FLOW_MIN, BACK = 1.0, 0.102, -0.2'),
    'rtl-split': ('        if self.rtl or len(self.words) == 1:', '        if len(self.words) == 1:'),
    'ligature-apart': ("                word[-1]['c'] += ch      # a further letter of the same glyph\n                continue",
                       '                pass'),
    'end-alignment-off': ("        return (k, 'end') if ends and clear else (None, None)", '        return None, None'),
    'dr-join-off': ("        if mark.text != 'DR' or columns.of(mark) != BALANCE:", '        if True:'),
    'continuation-anywhere': ("            elif out and out[-1] == 'brought-forward':", '            elif out:'),
    'date-runs-apart': ("            if len(cells[col]) > 1 and not re.search(r'\\s', joined):", '            if False:'),
    'dr-uncounted': ("        used['drAfterAmount'] += 1\n", ''),
    'date-runs-uncounted': ("                used['dateRuns'] += 1\n", ''),
    'end-alignment-uncounted': ("        used['endAligned'] += sum(1 for p in pieces if columns.placed(p)[1] == 'end')\n", ''),
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
    for name in ('columns.py', 'tounicode.py', 'eligibility.py', 'test_eligibility.py'):
        shutil.copy(HERE / name, tool / name)
    return tool


def main(mutants=MUTANTS, module='columns.py', tests='test_eligibility.Columns'):
    survived = []
    for name, (old, new) in mutants.items():
        with tempfile.TemporaryDirectory() as temp:
            tool = tree(Path(temp))
            source = (tool / module).read_text(encoding='utf-8')
            if source.count(old) != 1:
                raise SystemExit(f'{name}: the line it mutates is not in {module} once')
            (tool / module).write_text(source.replace(old, new), encoding='utf-8')
            run = subprocess.run([sys.executable, '-B', '-m', 'unittest', tests],
                                 cwd=tool, capture_output=True, text=True)
            killed = run.returncode != 0
            print(name, 'killed' if killed else 'SURVIVED')
            if not killed:
                survived.append(name)
    sys.exit(1 if survived else 0)


if __name__ == '__main__':
    main()
