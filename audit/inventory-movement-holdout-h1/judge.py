"""EXPECTED.json for INV-2 H1 from the sealed foundation oracle as it is
(audit/inventory-movement-foundation/oracle.py, pinned by that foundation's
seal), run on these files and their confirmed scopes. Nothing in the oracle
is changed or wrapped.

  python3 -B audit/inventory-movement-holdout-h1/judge.py frozen > frozen/EXPECTED.json
"""
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ORACLE = HERE.parent / 'inventory-movement-foundation' / 'oracle.py'


def oracle():
    spec = importlib.util.spec_from_file_location('inv2_foundation_oracle', ORACLE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(folder):
    result = oracle().run(Path(folder))
    result['schema'] = 'tarasuf-inv2-movement-bridge-h1-expected/1'
    result['oracle'] = 'audit/inventory-movement-foundation/oracle.py'
    return result


def main(folder):
    sys.stdout.write(json.dumps(run(folder), ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main(sys.argv[1])
