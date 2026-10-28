"""Seal the FIN-1 holdout H1 before any FIN-1 product run: every input by
hash, the expectation from the FIN-1A oracle as it is, the independent file
check and the eligibility check, and the tools that made and judge them,
FIN-1A's oracle and contract included.

  python3 -B audit/fin-hierarchy-holdout-h1/seal.py
"""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
FIN1A = HERE.parent / 'tb-financial-hierarchy'
JUDGED = ['EXPECTED.json', 'VERIFY.json', 'ELIGIBILITY.json']
TOOLS = ['stories.py', 'render.py', 'render.go', 'render.rb', 'render.pl', 'render.rs', 'verify.py',
         'eligibility.py', 'judge.py', 'test_intent.py']
FIN1A_TOOLS = ['contract.json', 'oracle.py']
NOT_INPUTS = {'INPUT-MANIFEST.json', 'SEAL.json', *JUDGED}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inputs():
    return sorted(str(p.relative_to(FROZEN)) for p in FROZEN.rglob('*')
                  if p.is_file() and str(p.relative_to(FROZEN)) not in NOT_INPUTS)


def manifest():
    return {
        'schema': 'tarasuf-fin1-hierarchy-holdout-input-manifest/1',
        'synthetic': True,
        'producer': 'stories.py facts; CSV written by Go 1.24 encoding/csv, Ruby 3.3 csv, a hand-written Perl 5.38 writer with CR line ends, a hand-written Rust 1.97 writer quoting every field, and LibreOffice Calc 24.2 CSV export from flat ODS; each run scope as JSON',
        'files': {name: {'sha256': sha(FROZEN / name), 'bytes': (FROZEN / name).stat().st_size}
                  for name in inputs()},
    }


def main():
    (FROZEN / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest(), indent=1) + '\n', encoding='utf-8')
    seal = {
        'schema': 'tarasuf-fin1-hierarchy-holdout-seal/1',
        'statement': 'Sealed before any FIN-1 product run on these files. The first engine and browser runs are recorded as they come.',
        'pins': {name: sha(FROZEN / name) for name in ['INPUT-MANIFEST.json', *JUDGED]}
        | {name: sha(HERE / name) for name in TOOLS}
        | {f'../tb-financial-hierarchy/{name}': sha(FIN1A / name) for name in FIN1A_TOOLS},
    }
    (FROZEN / 'SEAL.json').write_text(json.dumps(seal, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(seal['pins'], indent=1))


if __name__ == '__main__':
    main()
