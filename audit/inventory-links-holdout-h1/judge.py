"""EXPECTED.json for INV-3 H1 from the sealed foundation oracle as it is
(audit/inventory-links-foundation/oracle.py, pinned by that foundation's
seal), run on these files and their confirmed scopes. Nothing in the oracle
is changed or wrapped.

  python3 -B audit/inventory-links-holdout-h1/judge.py frozen > frozen/EXPECTED.json
"""
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ORACLE = HERE.parent / 'inventory-links-foundation' / 'oracle.py'


def oracle():
    spec = importlib.util.spec_from_file_location('inv3_foundation_oracle', ORACLE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(folder):
    folder = Path(folder)
    judge = oracle().judge
    ids = sorted(p.name[: -len('-scope.json')] for p in folder.glob('*-scope.json'))
    return {'schema': 'tarasuf-inv3-links-h1-expected/1', 'oracle': 'audit/inventory-links-foundation/oracle.py',
            'reference': 'audit/inventory-register/reference.py', 'stories': {sid: judge(folder, sid) for sid in ids}}


def main(folder):
    sys.stdout.write(json.dumps(run(folder), ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main(sys.argv[1])
