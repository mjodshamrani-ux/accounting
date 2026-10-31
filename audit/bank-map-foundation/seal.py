"""Seal the MAP-1 foundation before any product run: every input file by
hash, the sealed statements, twins and facts its stories name, the
expectations and the independent verification, and the tools that made and
judge them, the eligibility tool's cashbook reading and the sealed ROLL-1
and bank statement foundations included. EXPECTED.json is written here by
the oracle; VERIFY.json by verify.py --write before.

  python3 -B audit/bank-map-foundation/verify.py --write
  python3 -B audit/bank-map-foundation/seal.py
"""
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUDIT = HERE.parent
FROZEN = HERE / 'frozen'
JUDGED = ['EXPECTED.json', 'VERIFY.json']
TOOLS = ['contract.json', 'stories.py', 'oracle.py', 'verify.py', 'test_oracle.py', 'mutate_oracle.py']
SEALED = {
    'bank-statement-eligibility': ['cashbook.py'],
    'bank-roll-foundation': ['contract.json', 'oracle.py'],
    'bank-statement-foundation': ['contract.json', 'oracle.py'],
}
NOT_INPUTS = {'INPUT-MANIFEST.json', 'SEAL.json', *JUDGED}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def external():
    """The sealed files the stories name: each period's statement and twin,
    and the facts of its package."""
    facts = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))
    names = set()
    for story in facts['stories']:
        for action in story['actions']:
            if 'period' in action:
                for name in [f"{action['period']}-statement.pdf", f"{action['period']}-cashbook.csv", 'stories.json']:
                    names.add(f"{action['source']}/frozen/{name}")
    return {name: sha(AUDIT / name) for name in sorted(names)}


def manifest():
    files = sorted(p.name for p in FROZEN.iterdir() if p.name not in NOT_INPUTS)
    return {
        'schema': 'tarasuf-wf1-map1-input-manifest/1',
        'synthetic': True,
        'producer': 'stories.py: XLSX written from the Python standard library (shared strings, typed numbers, '
                    'formulas with cached values, stored ZIP entries), CSV by the csv module, map files as JSON; '
                    'every entry copied from a declared cashbook sealed by the ROLL-1 or REVIEW-1 foundation',
        'files': {name: {'sha256': sha(FROZEN / name), 'bytes': (FROZEN / name).stat().st_size} for name in files},
        'external': external(),
    }


def main():
    spec = importlib.util.spec_from_file_location('map_oracle', HERE / 'oracle.py')
    oracle = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(oracle)
    expected = oracle.run(FROZEN, FROZEN / 'stories.json')
    (FROZEN / 'EXPECTED.json').write_text(json.dumps(expected, ensure_ascii=False, indent=1, sort_keys=True) + '\n',
                                          encoding='utf-8')
    (FROZEN / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest(), indent=1) + '\n', encoding='utf-8')
    seal = {
        'schema': 'tarasuf-wf1-map1-seal/1',
        'statement': 'Sealed before any product run on these files. The baseline that follows records the product as it is.',
        'pins': {name: sha(FROZEN / name) for name in ['INPUT-MANIFEST.json', *JUDGED]}
        | {name: sha(HERE / name) for name in TOOLS}
        | {f'../{folder}/{name}': sha(AUDIT / folder / name) for folder, names in SEALED.items() for name in names},
    }
    (FROZEN / 'SEAL.json').write_text(json.dumps(seal, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(seal['pins'], indent=1))


if __name__ == '__main__':
    main()
