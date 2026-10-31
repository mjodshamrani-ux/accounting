"""The G8 holdout seal, checked with the Python standard library only.

  python3 -B audit/bank-statement-holdout-g8/check_seal.py [frozen]

- every frozen file has the bytes INPUT-MANIFEST.json records, and nothing
  else is in the folder;
- stories.py regenerates the facts with the sealed hash;
- holdout.json, with the eligibility decided before the product ran, has the
  sealed hash;
- the foundation's oracle, run story by story (expected.py), reproduces
  EXPECTED.json byte for byte, and agrees with every story's intent;
- VERIFY.json, written by the independent pdfminer check at freeze time, is
  bound to these PDF and XLSX hashes and to the facts hash, and passed.
Nothing here imports the product.
"""
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / 'bank-statement-foundation'))
import expected as expected_module  # noqa: E402
import oracle  # noqa: E402
from stories import facts_json  # noqa: E402

SEALED = {'INPUT-MANIFEST.json', 'EXPECTED.json', 'VERIFY.json'}


def sha(b):
    return hashlib.sha256(b).hexdigest()


def check(frozen=HERE / 'frozen', holdout=HERE / 'holdout.json'):
    import tempfile
    frozen = Path(frozen)
    manifest = json.loads((frozen / 'INPUT-MANIFEST.json').read_text(encoding='utf-8'))
    files = {e['file']: e for e in manifest['files']}
    present = {p.name for p in frozen.iterdir() if p.is_file()}
    if present != set(files) | SEALED:
        raise AssertionError(f'frozen folder differs from the seal: {sorted(present ^ (set(files) | SEALED))}')
    for name, e in files.items():
        b = (frozen / name).read_bytes()
        if sha(b) != e['sha256'] or len(b) != e['bytes']:
            raise AssertionError(f'{name} differs from the seal')
    facts = facts_json().encode('utf-8')
    if sha(facts) != manifest['facts']['sha256'] or len(facts) != manifest['facts']['bytes']:
        raise AssertionError('facts differ from the seal')
    if sha(Path(holdout).read_bytes()) != manifest['holdout']['sha256']:
        raise AssertionError('holdout.json differs from the seal')
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / 'stories.json'
        path.write_bytes(facts)
        result, disagreements = expected_module.run(frozen, path)
    if disagreements:
        raise AssertionError(f'oracle disagrees with intent: {disagreements}')
    if oracle.dumps(result) != (frozen / 'EXPECTED.json').read_text(encoding='utf-8'):
        raise AssertionError('EXPECTED.json is not what the oracle gives')
    verify = json.loads((frozen / 'VERIFY.json').read_text(encoding='utf-8'))
    if verify.get('ok') is not True or verify['factsSha256'] != sha(facts):
        raise AssertionError('VERIFY.json did not pass on these facts')
    stories = json.loads(facts)['stories']
    if [s['id'] for s in verify['statements']] != [s['id'] for s in stories]:
        raise AssertionError('VERIFY.json does not cover every statement')
    for s in verify['statements']:
        if not s['ok'] or s['sha256'] != files[s['file']]['sha256']:
            raise AssertionError(f"VERIFY.json is not bound to {s['file']}")
    xlsx = {s['id'] for s in stories if s.get('cashbookXlsx')}
    if {x['file'] for x in verify['cashbookXlsx']} != {f'{i}-cashbook.xlsx' for i in xlsx}:
        raise AssertionError('VERIFY.json does not cover every XLSX cashbook')
    for x in verify['cashbookXlsx']:
        if not x['sameAsCsv'] or x['sha256'] != files[x['file']]['sha256']:
            raise AssertionError(f"VERIFY.json is not bound to {x['file']}")
    if len(verify.get('selfTest', [])) < 22:
        raise AssertionError('VERIFY.json lacks its self-test')
    return {'files': len(files), 'statements': len(stories),
            'positives': len(json.loads(Path(holdout).read_text(encoding='utf-8'))['eligibility']['positives']),
            'pdfPages': sum(s['pages'] for s in verify['statements'])}


if __name__ == '__main__':
    print(json.dumps(check(*(sys.argv[1:2] or []))))
