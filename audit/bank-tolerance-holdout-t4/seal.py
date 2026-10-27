"""Seal the T4 holdout before any product run: every input file by hash, the
expectations, the independent reading, the check before the seal, and the
tools that made and judge them, the sealed foundation's included.

Run after render.py, verify.py and the eligibility check have written into
frozen/. This file writes the facts (stories.json, and records.json, the
same statements as one record each for the copied renderers and checker),
EXPECTED.json from the tolerance foundation's oracle, unchanged, the input
manifest over every input, and SEAL.json. The independent workbook checker
the runs are judged by, audit/bank-tolerance-foundation/check_export.py, is
pinned as it is now.

  python3 -B audit/bank-tolerance-holdout-t4/seal.py
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
TOLERANCE = HERE.parent / 'bank-tolerance-foundation'
BANK = HERE.parent / 'bank-statement-foundation'
sys.path.insert(0, str(HERE))
from stories import facts, facts_json, print_records  # noqa: E402

JUDGED = ['EXPECTED.json', 'VERIFY.json', 'ELIGIBILITY.json']
TOOLS = ['stories.py', 'render.py', 'verify.py', 'common.py', 'fonts.py', 'render_hexapdf.py', 'render_pdflib.py',
         'ruby/statements.rb', 'ruby/Gemfile', 'ruby/Gemfile.lock', 'js/render_pdflib.mjs', 'js/package.json',
         'js/package-lock.json', 'seal.py']
TOLERANCE_TOOLS = ['contract.json', 'oracle.py', 'test_oracle.py', 'check_export.py']
BANK_TOOLS = ['contract.json', 'oracle.py']
ELIGIBILITY_TOOLS = ['eligibility.py', 'items.py', 'columns.py', 'tounicode.py', 'rows.py', 'drawings.py', 'cashbook.py']
NOT_INPUTS = {'INPUT-MANIFEST.json', 'SEAL.json', *JUDGED}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tolerance_oracle():
    spec = importlib.util.spec_from_file_location('tolerance_oracle', TOLERANCE / 'oracle.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def records_json():
    return json.dumps({'stories': print_records(facts())}, ensure_ascii=False, indent=1) + '\n'


def main():
    (FROZEN / 'stories.json').write_text(facts_json(), encoding='utf-8')
    (FROZEN / 'records.json').write_text(records_json(), encoding='utf-8')
    expected = tolerance_oracle().run(FROZEN, FROZEN / 'stories.json')
    (FROZEN / 'EXPECTED.json').write_text(json.dumps(expected, ensure_ascii=False, indent=1, sort_keys=True) + '\n',
                                          encoding='utf-8')
    rendered = json.loads((FROZEN / 'INPUT-MANIFEST.json').read_text(encoding='utf-8'))
    names = sorted(p.name for p in FROZEN.iterdir() if p.name not in NOT_INPUTS)
    manifest = {
        'schema': 'tarasuf-wf1-tol1-t4-input-manifest/1',
        'synthetic': True,
        'holdout': True,
        'version': rendered['version'],
        'producers': rendered['producers'],
        'fonts': rendered['fonts'],
        'facts': rendered['facts'],
        'files': {name: {'sha256': sha(FROZEN / name), 'bytes': (FROZEN / name).stat().st_size} for name in names},
    }
    (FROZEN / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n',
                                                encoding='utf-8')
    seal = {
        'schema': 'tarasuf-wf1-tol1-t4-seal/1',
        'statement': 'Sealed and committed before any product run on these files.',
        'pins': {name: sha(FROZEN / name) for name in ['INPUT-MANIFEST.json', *JUDGED]}
        | {name: sha(HERE / name) for name in TOOLS}
        | {f'../bank-tolerance-foundation/{name}': sha(TOLERANCE / name) for name in TOLERANCE_TOOLS}
        | {f'../bank-statement-foundation/{name}': sha(BANK / name) for name in BANK_TOOLS},
        'eligibilityTool': {name: sha(HERE.parent / 'bank-statement-eligibility' / name) for name in ELIGIBILITY_TOOLS},
    }
    (FROZEN / 'SEAL.json').write_text(json.dumps(seal, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'inputs': len(names), 'pins': len(seal['pins'])}))


if __name__ == '__main__':
    main()
