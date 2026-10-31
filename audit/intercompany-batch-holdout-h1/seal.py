"""Seal the IC-1 holdout H1 before any product run: every input by hash, the
expectation from the sealed foundation oracle, the independent file check
and the reader eligibility check, and the tools that made and judge them,
the foundation's oracle and contract included.

  python3 -B audit/intercompany-batch-holdout-h1/seal.py
"""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
FOUNDATION = HERE.parent / 'intercompany-batch-foundation'
JUDGED = ['EXPECTED.json', 'VERIFY.json', 'ELIGIBILITY.json']
TOOLS = ['stories.py', 'render.py', 'render.go', 'render.php', 'Render.java', 'verify.py', 'eligibility.py',
         'test_intent.py']
FOUNDATION_TOOLS = ['contract.json', 'oracle.py']
NOT_INPUTS = {'INPUT-MANIFEST.json', 'SEAL.json', *JUDGED}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest():
    files = sorted(p.name for p in FROZEN.iterdir() if p.name not in NOT_INPUTS)
    return {
        'schema': 'tarasuf-ic1-batch-holdout-input-manifest/1',
        'synthetic': True,
        'producer': 'stories.py facts; CSV written by Go 1.24 encoding/csv, PHP 8.3 fputcsv, LibreOffice Calc 24.2 CSV export from flat ODS, and a hand-written Java 21 writer',
        'files': {name: {'sha256': sha(FROZEN / name), 'bytes': (FROZEN / name).stat().st_size} for name in files},
    }


def main():
    (FROZEN / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest(), indent=1) + '\n', encoding='utf-8')
    seal = {
        'schema': 'tarasuf-ic1-batch-holdout-seal/1',
        'statement': 'Sealed before any product run on these files. The first engine and browser runs are recorded as they come.',
        'pins': {name: sha(FROZEN / name) for name in ['INPUT-MANIFEST.json', *JUDGED]}
        | {name: sha(HERE / name) for name in TOOLS}
        | {f'../intercompany-batch-foundation/{name}': sha(FOUNDATION / name) for name in FOUNDATION_TOOLS},
    }
    (FROZEN / 'SEAL.json').write_text(json.dumps(seal, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(seal['pins'], indent=1))


if __name__ == '__main__':
    main()
