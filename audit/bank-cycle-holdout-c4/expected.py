"""The holdout's expectation: the cycle foundation's composed oracle, with
its first correction, run on these files. Nothing here is a rule of its
own.

The foundation's oracle (../bank-cycle-foundation/oracle.py) composes the
sealed oracles of the five layers and adds only the composition its
contract states (bank-period-cycle-1). Its first correction
(../bank-cycle-foundation/correction-1/oracle.py) cites each ledger entry at
its row in the ledger, the file whose fingerprint the sheet carries. Both
were written before these stories and are pinned by this package's seal as
they are. Standard library only.

  python3 -B audit/bank-cycle-holdout-c4/expected.py [--frozen dir] [--write]
"""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CORRECTED = HERE.parent / 'bank-cycle-foundation' / 'correction-1' / 'oracle.py'


def oracle():
    """The corrected cycle oracle, and through it the sealed one it wraps
    (`.sealed`), whose judge and StoryError the tests use."""
    spec = importlib.util.spec_from_file_location('cycle_oracle_corrected', CORRECTED)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(frozen):
    frozen = Path(frozen)
    return oracle().run(frozen, frozen / 'stories.json')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frozen', default=str(HERE / 'frozen'))
    ap.add_argument('--write', action='store_true')
    a = ap.parse_args()
    text = json.dumps(run(a.frozen), ensure_ascii=False, indent=1, sort_keys=True) + '\n'
    if a.write:
        (Path(a.frozen) / 'EXPECTED.json').write_text(text, encoding='utf-8')
    sys.stdout.write(text)


if __name__ == '__main__':
    main()
