"""Seal the A5 holdout before any product run: every input file by hash, the
expectations written by the sealed foundation oracle, the independent PDF
reading, the pre-seal eligibility, and the tools that made and judge them.

  python3 -B audit/ar-statement-holdout-a5/seal.py
"""
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
FOUNDATION = HERE.parent / 'ar-statement-foundation'
sys.path.insert(0, str(FOUNDATION))
import oracle  # noqa: E402  the foundation's sealed oracle, unchanged

JUDGED = ['EXPECTED.json', 'VERIFY.json', 'ELIGIBILITY.json']
TOOLS = ['holdout.json', 'stories.py', 'render.py', 'render_libreoffice.py', 'render_itext.py',
         'java/pom.xml', 'java/src/main/java/tarasuf/holdout/ArStatements.java', 'verify.py']
FOUNDATION_TOOLS = ['contract.json', 'oracle.py']
NOT_INPUTS = {'INPUT-MANIFEST.json', 'SEAL.json', *JUDGED}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest():
    files = sorted(p.name for p in FROZEN.iterdir() if p.name not in NOT_INPUTS)
    return {
        'schema': 'tarasuf-ar-pdf1-holdout-input-manifest/1',
        'synthetic': True,
        'producers': 'LibreOffice Writer 24.2.7.2; iText Core 9.8.0',
        'files': {name: {'sha256': sha(FROZEN / name), 'bytes': (FROZEN / name).stat().st_size} for name in files},
    }


def expected(frozen=FROZEN):
    facts = json.loads((frozen / 'stories.json').read_text(encoding='utf-8'))
    return oracle.run(facts, frozen)


def main():
    (FROZEN / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest(), indent=1) + '\n', encoding='utf-8')
    (FROZEN / 'EXPECTED.json').write_text(
        json.dumps(expected(), ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    seal = {
        'schema': 'tarasuf-ar-pdf1-holdout-seal/1',
        'statement': 'Sealed before any product run on these files. The first run is recorded as it comes.',
        'pins': {name: sha(FROZEN / name) for name in ['INPUT-MANIFEST.json', *JUDGED]}
        | {name: sha(HERE / name) for name in TOOLS}
        | {f'../ar-statement-foundation/{name}': sha(FOUNDATION / name) for name in FOUNDATION_TOOLS},
    }
    (FROZEN / 'SEAL.json').write_text(json.dumps(seal, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(seal['pins'], indent=1))


if __name__ == '__main__':
    main()
