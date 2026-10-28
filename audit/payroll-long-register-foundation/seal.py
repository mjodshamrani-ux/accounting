"""Seal the PAY-1 foundation before any product run: every input file by
hash, the expectations and the independent file check, and the tools that
made and judge them.

  python3 -B audit/payroll-long-register-foundation/seal.py
"""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
JUDGED = ['EXPECTED.json', 'VERIFY.json']
TOOLS = ['contract.json', 'stories.py', 'render.py', 'render.mjs', 'oracle.py', 'verify.py', 'test_oracle.py',
         'mutate_oracle.py']
NOT_INPUTS = {'INPUT-MANIFEST.json', 'SEAL.json', *JUDGED}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest():
    files = sorted(p.name for p in FROZEN.iterdir() if p.name not in NOT_INPUTS)
    return {
        'schema': 'tarasuf-pay1-long-register-input-manifest/1',
        'synthetic': True,
        'producer': 'stories.py facts; CSV written by Python csv (minimal quoting, LF, rows as wide as their cells; '
                    'with a byte-order mark, CRLF and every row padded to the widest; and as Windows Arabic with '
                    'CRLF), by Node (every field quoted, CRLF) and joined by commas with no quoting; each run scope '
                    'as JSON',
        'files': {name: {'sha256': sha(FROZEN / name), 'bytes': (FROZEN / name).stat().st_size} for name in files},
    }


def main():
    (FROZEN / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest(), indent=1) + '\n', encoding='utf-8')
    seal = {
        'schema': 'tarasuf-pay1-long-register-seal/1',
        'statement': 'Sealed before any product run on these files. The baseline that follows records the product as it is.',
        'pins': {name: sha(FROZEN / name) for name in ['INPUT-MANIFEST.json', *JUDGED]}
        | {name: sha(HERE / name) for name in TOOLS},
    }
    (FROZEN / 'SEAL.json').write_text(json.dumps(seal, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(seal['pins'], indent=1))


if __name__ == '__main__':
    main()
