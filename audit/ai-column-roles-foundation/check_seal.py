"""The AI-1a seal, checked with the Python standard library only.

  python3 -B audit/ai-column-roles-foundation/check_seal.py [frozen]

- every frozen file has the bytes INPUT-MANIFEST.json records, and nothing
  else is in the folder;
- stories.py regenerates the facts with the sealed hash, and expected.py the
  oracle (expected.json) byte for byte;
- the oracle requires every pair a positive story's facts prove, and names
  for every story the heading over each role its columns hold, which only
  K5 leaves undecidable;
- VERIFY.json, written by the independent pdfminer and MuPDF check at freeze
  time, is bound to these PDF hashes and the facts hash, found no glyph drawn
  as .notdef, and passed with its self-test whole;
- ELIGIBILITY.json, written before the seal by
  audit/bank-statement-eligibility/eligibility.py, is bound to these PDF
  hashes and found nothing the reader declares a reason to refuse. Its
  column check models the bank statement reader's columns, not the supplier
  path's; its findings are the only ones set aside, and are recorded;
- SEAL.json pins the judge, the measure and its runner by hash: none may
  change after the seal; and it is bound to these VERIFY.json and
  ELIGIBILITY.json.
Nothing here imports the product.
"""
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from render import facts_json, oracle_json  # noqa: E402
from roles import DECIDABLE, roles  # noqa: E402
from stories import STORIES  # noqa: E402

SEALED = {'INPUT-MANIFEST.json', 'VERIFY.json', 'ELIGIBILITY.json', 'SEAL.json'}
PINNED = ('judge.mjs', 'score.mjs', 'measure.mjs')
NOT_APPLICABLE = {'columns'}
SELF_TEST = 38


def sha(b):
    return hashlib.sha256(b).hexdigest()


def check(frozen=HERE / 'frozen'):
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
    if oracle_json().encode('utf-8') != (frozen / 'expected.json').read_bytes():
        raise AssertionError('expected.json is not what the oracle gives')
    oracle = json.loads((frozen / 'expected.json').read_text(encoding='utf-8'))['stories']
    if [e['id'] for e in oracle] != [s['id'] for s in STORIES]:
        raise AssertionError('the oracle does not cover every story in order')
    for story, expected in zip(STORIES, oracle):
        if expected['kind'] != 'positive' or not expected['approve']:
            raise AssertionError(f"{story['id']}: every story here is positive and requires its pairs")
        if expected['roles'] != roles(story) or not expected['roles'].get('date') or not expected['roles'].get('reference'):
            raise AssertionError(f"{story['id']}: the oracle's roles are not the story's")
        if expected['decidable'] != (story['class'] in DECIDABLE):
            raise AssertionError(f"{story['id']}: decidable is not the class's")
    verify = json.loads((frozen / 'VERIFY.json').read_text(encoding='utf-8'))
    if verify.get('ok') is not True or verify['factsSha256'] != sha(facts):
        raise AssertionError('VERIFY.json did not pass on these facts')
    if [s['id'] for s in verify['statements']] != [s['id'] for s in STORIES]:
        raise AssertionError('VERIFY.json does not cover every statement')
    for s in verify['statements']:
        if not s['ok'] or s['sha256'] != files[s['file']]['sha256'] or s.get('notdefGlyphs') != 0:
            raise AssertionError(f"VERIFY.json is not bound to {s['file']}")
    if len(verify.get('selfTest', [])) < SELF_TEST:
        raise AssertionError('VERIFY.json lacks its self-test')
    eligibility = json.loads((frozen / 'ELIGIBILITY.json').read_text(encoding='utf-8'))
    if sorted(eligibility['statements']) != sorted(s['id'] for s in STORIES) or eligibility['clearancePt'] != 0.05:
        raise AssertionError("ELIGIBILITY.json does not cover every statement at the reader's clearance")
    for sid, e in eligibility['statements'].items():
        if e['sha256'] != files[f'{sid}-statement.pdf']['sha256']:
            raise AssertionError(f'ELIGIBILITY.json is not bound to {sid}-statement.pdf')
        if set(e['found']) - NOT_APPLICABLE:
            raise AssertionError(f"ELIGIBILITY.json found {sorted(set(e['found']) - NOT_APPLICABLE)} in {sid}")
    seal = json.loads((frozen / 'SEAL.json').read_text(encoding='utf-8'))
    for name in PINNED:
        if sha((HERE / name).read_bytes()) != seal['pinned'][name]:
            raise AssertionError(f'{name} changed after the seal')
    if seal['manifestSha256'] != sha((frozen / 'INPUT-MANIFEST.json').read_bytes()):
        raise AssertionError('SEAL.json is not bound to this manifest')
    if seal['verifySha256'] != sha((frozen / 'VERIFY.json').read_bytes()) or \
            seal['eligibilitySha256'] != sha((frozen / 'ELIGIBILITY.json').read_bytes()):
        raise AssertionError('SEAL.json is not bound to this verification and eligibility')
    return {'files': len(files), 'statements': len(STORIES),
            'positives': sum(1 for s in STORIES if s['kind'] == 'positive'),
            'classes': {c: sum(1 for s in STORIES if s['class'] == c) for c in ('K0', 'K1', 'K2', 'K3', 'K4', 'K5')},
            'pdfPages': sum(s['pages'] for s in verify['statements'])}


if __name__ == '__main__':
    print(json.dumps(check(*(sys.argv[1:2] or []))))
