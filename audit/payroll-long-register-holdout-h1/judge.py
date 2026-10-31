"""EXPECTED.json for PAY-1 H1 from the sealed foundation oracle as it is
(audit/payroll-long-register-foundation/oracle.py, pinned by that
foundation's seal), run on these files and their confirmed scopes. Nothing
in the oracle is changed or wrapped.

  python3 -B audit/payroll-long-register-holdout-h1/judge.py frozen > frozen/EXPECTED.json
"""
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ORACLE = HERE.parent / 'payroll-long-register-foundation' / 'oracle.py'


def oracle():
    spec = importlib.util.spec_from_file_location('pay1_foundation_oracle', ORACLE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(folder):
    result = oracle().run(Path(folder))
    result['schema'] = 'tarasuf-pay1-long-register-h1-expected/1'
    result['oracle'] = 'audit/payroll-long-register-foundation/oracle.py'
    return result


def main(folder):
    sys.stdout.write(json.dumps(run(folder), ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main(sys.argv[1])
