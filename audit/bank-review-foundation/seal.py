"""Seal the REVIEW-1 foundation before any product run: every input file by
hash, the expectations and the independent reading, and the tools that made
and judge them, the sealed ROLL-1, REPORT-1 and bank statement foundations'
included. EXPECTED.json is written here by the oracle.

  python3 -B audit/bank-review-foundation/seal.py
"""
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
JUDGED = ['EXPECTED.json', 'VERIFY.json']
TOOLS = ['contract.json', 'stories.mjs', 'render.mjs', 'oracle.py', 'verify.py', 'test_oracle.py', 'mutate_oracle.py']
SEALED = {
    'bank-roll-foundation': ['contract.json', 'stories.mjs', 'oracle.py', 'verify.py'],
    'bank-sheet-foundation': ['verify.py', 'render.mjs'],
    'bank-statement-foundation': ['contract.json', 'oracle.py', 'verify_assets.py'],
}
NOT_INPUTS = {'INPUT-MANIFEST.json', 'SEAL.json', *JUDGED}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest():
    files = sorted(p.name for p in FROZEN.iterdir() if p.name not in NOT_INPUTS)
    return {
        'schema': 'tarasuf-wf1-review1-input-manifest/1',
        'synthetic': True,
        'producer': 'Chromium page.pdf with DejaVu Sans (statements), printed by the ROLL-1 foundation printedStatement in the bank statement foundation layout; CSV cashbooks, one of them a corrected copy',
        'files': {name: {'sha256': sha(FROZEN / name), 'bytes': (FROZEN / name).stat().st_size} for name in files},
    }


def main():
    spec = importlib.util.spec_from_file_location('review_oracle', HERE / 'oracle.py')
    oracle = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(oracle)
    expected = oracle.run(FROZEN, FROZEN / 'stories.json')
    (FROZEN / 'EXPECTED.json').write_text(json.dumps(expected, ensure_ascii=False, indent=1, sort_keys=True) + '\n',
                                          encoding='utf-8')
    (FROZEN / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest(), indent=1) + '\n', encoding='utf-8')
    seal = {
        'schema': 'tarasuf-wf1-review1-seal/1',
        'statement': 'Sealed before any product run on these files. The baseline that follows records the product as it is.',
        'pins': {name: sha(FROZEN / name) for name in ['INPUT-MANIFEST.json', *JUDGED]}
        | {name: sha(HERE / name) for name in TOOLS}
        | {f'../{folder}/{name}': sha(HERE.parent / folder / name) for folder, names in SEALED.items() for name in names},
    }
    (FROZEN / 'SEAL.json').write_text(json.dumps(seal, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(seal['pins'], indent=1))


if __name__ == '__main__':
    main()
