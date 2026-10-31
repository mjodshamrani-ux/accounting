"""Seal the ROLL-1 foundation before any product run: every input file by
hash, the expectations and the independent reading, and the tools that made
and judge them, the sealed bank statement foundation's included.

  python3 -B audit/bank-roll-foundation/seal.py
"""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
BANK = HERE.parent / 'bank-statement-foundation'
JUDGED = ['EXPECTED.json', 'VERIFY.json']
TOOLS = ['contract.json', 'stories.mjs', 'render.mjs', 'oracle.py', 'verify.py', 'test_oracle.py', 'mutate_oracle.py']
BANK_TOOLS = ['contract.json', 'oracle.py', 'verify_assets.py']
NOT_INPUTS = {'INPUT-MANIFEST.json', 'SEAL.json', *JUDGED}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest():
    files = sorted(p.name for p in FROZEN.iterdir() if p.name not in NOT_INPUTS)
    return {
        'schema': 'tarasuf-wf1-roll1-input-manifest/1',
        'synthetic': True,
        'producer': 'Chromium page.pdf with DejaVu Sans (statements), as the bank statement foundation; CSV cashbooks; session files written by render.mjs from the documented format',
        'files': {name: {'sha256': sha(FROZEN / name), 'bytes': (FROZEN / name).stat().st_size} for name in files},
    }


def main():
    (FROZEN / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest(), indent=1) + '\n', encoding='utf-8')
    seal = {
        'schema': 'tarasuf-wf1-roll1-seal/1',
        'statement': 'Sealed before any product run on these files. The baseline that follows records the product as it is.',
        'pins': {name: sha(FROZEN / name) for name in ['INPUT-MANIFEST.json', *JUDGED]}
        | {name: sha(HERE / name) for name in TOOLS}
        | {f'../bank-statement-foundation/{name}': sha(BANK / name) for name in BANK_TOOLS},
    }
    (FROZEN / 'SEAL.json').write_text(json.dumps(seal, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(seal['pins'], indent=1))


if __name__ == '__main__':
    main()
