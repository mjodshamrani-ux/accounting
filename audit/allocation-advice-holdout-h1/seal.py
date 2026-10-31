"""Seal the ALL-1 holdout H1 before any product run on it: every input by
hash, the expectation from the sealed foundation oracle as it is, the
independent file check and the eligibility check, and the tools that made
and judge them, the foundation's oracle and contract included.

  python3 -B audit/allocation-advice-holdout-h1/seal.py
"""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
FOUNDATION = HERE.parent / 'allocation-advice-foundation'
JUDGED = ['EXPECTED.json', 'VERIFY.json', 'ELIGIBILITY.json']
TOOLS = ['stories.py', 'render.py', 'render.php', 'Render.java', 'render.go', 'render.pl', 'verify.py',
         'eligibility.py', 'judge.py', 'test_intent.py']
FOUNDATION_TOOLS = ['contract.json', 'oracle.py']
NOT_INPUTS = {'INPUT-MANIFEST.json', 'SEAL.json', *JUDGED}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inputs():
    return sorted(p.name for p in FROZEN.iterdir() if p.is_file() and p.name not in NOT_INPUTS)


def manifest():
    return {
        'schema': 'tarasuf-all1-advice-holdout-input-manifest/1',
        'synthetic': True,
        'producer': 'stories.py facts; each transfers, invoices or advice file written as CSV by PHP 8.3 '
                    'fputcsv, a hand-written Java 21 writer with CRLF, Go 1.24 encoding/csv with UseCRLF, a '
                    'hand-written Perl 5.38 writer with a byte-order mark and CR line ends, or LibreOffice Calc '
                    '24.2 CSV export from flat ODS, or as XLSX by LibreOffice Calc 24.2 from flat ODS with hidden '
                    'rows; each story\'s file names, readings, confirmed scope and decisions as '
                    'allocation-snapshot-1 events in JSON',
        'files': {name: {'sha256': sha(FROZEN / name), 'bytes': (FROZEN / name).stat().st_size}
                  for name in inputs()},
    }


def main():
    (FROZEN / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest(), indent=1) + '\n', encoding='utf-8')
    seal = {
        'schema': 'tarasuf-all1-advice-holdout-seal/1',
        'statement': 'Sealed before any product run on these files. The first engine and browser runs are '
                     'recorded as they come.',
        'pins': {name: sha(FROZEN / name) for name in ['INPUT-MANIFEST.json', *JUDGED]}
        | {name: sha(HERE / name) for name in TOOLS}
        | {f'../allocation-advice-foundation/{name}': sha(FOUNDATION / name) for name in FOUNDATION_TOOLS},
    }
    (FROZEN / 'SEAL.json').write_text(json.dumps(seal, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(seal['pins'], indent=1))


if __name__ == '__main__':
    main()
