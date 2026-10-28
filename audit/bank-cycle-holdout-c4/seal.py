"""Seal the cycle holdout C4 before any product run: every input file by
hash, the expectation, the independent reading, the check before the seal,
and the tools that made and judge them, the foundation's composed oracle,
its correction and the sealed oracles and contracts it composes included.

Run after render.py, verify.py and the eligibility check have written into
frozen/. This file writes the facts (stories.json, and records.json, the
statements as one record each for the copied renderers and checker),
EXPECTED.json from expected.py, the input manifest over every input, and
SEAL.json.

  python3 -B audit/bank-cycle-holdout-c4/seal.py
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
AUDIT = HERE.parent
sys.path.insert(0, str(HERE))
from stories import facts, facts_json, print_records  # noqa: E402

JUDGED = ['EXPECTED.json', 'VERIFY.json', 'ELIGIBILITY.json']
TOOLS = ['stories.py', 'render.py', 'render_prawn.py', 'render_pdfkit.py', 'common.py', 'fonts.py', 'verify.py',
         'expected.py', 'test_intent.py', 'seal.py', 'ruby/render_prawn.rb', 'ruby/ledgers.rb', 'ruby/Gemfile',
         'ruby/Gemfile.lock', 'js/render_pdfkit.mjs', 'js/package.json', 'js/package-lock.json', 'php/ledgers.php',
         'php/composer.json', 'php/composer.lock']
# The composed oracle and its correction, the sealed oracles and contracts
# it composes, and the workbook reader the MAP-1 oracle reads ledgers with.
COMPOSED = ['bank-cycle-foundation/contract.json', 'bank-cycle-foundation/oracle.py',
            'bank-cycle-foundation/correction-1/oracle.py'] + \
    [f'{package}/{name}' for package in ('bank-statement-foundation', 'bank-roll-foundation', 'bank-sheet-foundation',
                                         'bank-review-foundation', 'bank-map-foundation', 'bank-tolerance-foundation')
     for name in ('contract.json', 'oracle.py')] + ['bank-statement-eligibility/cashbook.py']
ELIGIBILITY_TOOLS = ['eligibility.py', 'items.py', 'columns.py', 'tounicode.py', 'rows.py', 'drawings.py', 'cashbook.py']
NOT_INPUTS = {'INPUT-MANIFEST.json', 'SEAL.json', *JUDGED}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def expectation():
    spec = importlib.util.spec_from_file_location('c4_expected', HERE / 'expected.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def records_json():
    return json.dumps({'stories': print_records(facts())}, ensure_ascii=False, indent=1) + '\n'


def main():
    (FROZEN / 'stories.json').write_text(facts_json(), encoding='utf-8')
    (FROZEN / 'records.json').write_text(records_json(), encoding='utf-8')
    expected = expectation().run(FROZEN)
    (FROZEN / 'EXPECTED.json').write_text(json.dumps(expected, ensure_ascii=False, indent=1, sort_keys=True) + '\n',
                                          encoding='utf-8')
    rendered = json.loads((FROZEN / 'INPUT-MANIFEST.json').read_text(encoding='utf-8'))
    names = sorted(p.name for p in FROZEN.iterdir() if p.name not in NOT_INPUTS)
    manifest = {
        'schema': 'tarasuf-wf1-cycle-input-manifest/1',
        'synthetic': True,
        'version': rendered['version'],
        'producers': rendered['producers'],
        'fonts': rendered['fonts'],
        'facts': rendered['facts'],
        'files': {name: {'sha256': sha(FROZEN / name), 'bytes': (FROZEN / name).stat().st_size} for name in names},
    }
    (FROZEN / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n',
                                                encoding='utf-8')
    seal = {
        'schema': 'tarasuf-wf1-cycle-seal/1',
        'statement': 'Sealed and committed before any product run on these files.',
        'pins': {name: sha(FROZEN / name) for name in ['INPUT-MANIFEST.json', *JUDGED]}
        | {name: sha(HERE / name) for name in TOOLS}
        | {f'../{name}': sha(AUDIT / name) for name in COMPOSED},
        'eligibilityTool': {name: sha(AUDIT / 'bank-statement-eligibility' / name) for name in ELIGIBILITY_TOOLS},
    }
    (FROZEN / 'SEAL.json').write_text(json.dumps(seal, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'inputs': len(names), 'pins': len(seal['pins'])}))


if __name__ == '__main__':
    main()
