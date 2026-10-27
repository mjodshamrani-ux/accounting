"""Seal the WF-1 MAP-1 M4 holdout before any product run: every input file by
hash, the sealed statements, twins and facts its stories name, the
expectation and the independent verification, and the tools that made and
judge them: this package's generator, writers, verification and intent
test, and the sealed MAP-1 foundation oracle with what it loads. EXPECTED.json
is written here by that oracle; VERIFY.json by verify.py --write before.

  python3 -B audit/bank-map-holdout-m4/verify.py --write
  python3 -B audit/bank-map-holdout-m4/seal.py
"""
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUDIT = HERE.parent
FROZEN = HERE / 'frozen'
JUDGED = ['EXPECTED.json', 'VERIFY.json']
TOOLS = ['stories.py', 'write_python.py', 'write_exceljs.mjs', 'write_libreoffice.py', 'verify.py',
         'test_intent.py']
SEALED = {
    'bank-map-foundation': ['contract.json', 'oracle.py', 'test_oracle.py'],
    'bank-statement-eligibility': ['cashbook.py'],
    'bank-roll-foundation': ['contract.json', 'oracle.py'],
    'bank-statement-foundation': ['contract.json', 'oracle.py'],
}
NOT_INPUTS = {'INPUT-MANIFEST.json', 'SEAL.json', *JUDGED}
WRITERS = ('openpyxl 3.1.5 and XlsxWriter 3.2.9 under Python 3.13 (write_python.py), exceljs 4.4.0 under '
           'Node (write_exceljs.mjs), LibreOffice Calc 24.2.7 headless from a flat OpenDocument file '
           '(write_libreoffice.py); CSV by the csv module, with and without a byte order mark; maps as JSON')


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
        'schema': 'tarasuf-wf1-map1-m4-input-manifest/1',
        'synthetic': True,
        'producer': f'stories.py through {WRITERS}; every entry copied from a declared cashbook sealed by the '
                    'ROLL-1 W4, REPORT-1 R4 or REVIEW-1 R3 holdout',
        'files': {name: {'sha256': sha(FROZEN / name), 'bytes': (FROZEN / name).stat().st_size} for name in files},
        'external': external(),
    }


def main():
    spec = importlib.util.spec_from_file_location('map_oracle', AUDIT / 'bank-map-foundation' / 'oracle.py')
    oracle = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(oracle)
    expected = oracle.run(FROZEN, FROZEN / 'stories.json')
    (FROZEN / 'EXPECTED.json').write_text(json.dumps(expected, ensure_ascii=False, indent=1, sort_keys=True) + '\n',
                                          encoding='utf-8')
    (FROZEN / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest(), indent=1) + '\n', encoding='utf-8')
    seal = {
        'schema': 'tarasuf-wf1-map1-m4-seal/1',
        'statement': 'Sealed and pushed before any product run on these files. The first run is recorded as it comes.',
        'pins': {name: sha(FROZEN / name) for name in ['INPUT-MANIFEST.json', *JUDGED]}
        | {name: sha(HERE / name) for name in TOOLS}
        | {f'../{folder}/{name}': sha(AUDIT / folder / name) for folder, names in SEALED.items() for name in names},
    }
    (FROZEN / 'SEAL.json').write_text(json.dumps(seal, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(seal['pins'], indent=1))


if __name__ == '__main__':
    main()
