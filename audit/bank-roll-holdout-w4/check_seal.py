"""The sealed W4 holdout is intact: inputs by hash, the folder holds nothing
else, the facts regenerate from stories.py byte for byte, the foundation's
oracle reproduces EXPECTED.json and agrees with every story's intent, the
independent PDF reading passed with its planted changes found, the check
before the seal found no refusal the reader declares, and the seal pins the
tools as they are now. The eligibility tool may change after the seal; its
hashes at the seal are recorded, not compared.

  python3 -B audit/bank-roll-holdout-w4/check_seal.py
"""
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
sys.path.insert(0, str(HERE))
import seal  # noqa: E402
from stories import facts_json  # noqa: E402


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def intent_differences(expected, facts):
    out = []
    for s in facts['stories']:
        got = expected['stories'][s['id']]
        want = s['intent']
        same = (got['previous'] == want['previous']
                and [c['item'] for c in got['carried']] == want['carried']
                and [{k: c[k] for k in ('reason', 'carried', 'current')} for c in got['cases']] == want['cases']
                and got['stillCarried'] == want['stillCarried'])
        if not same:
            out.append(s['id'])
    return out


def problems():
    out = []
    manifest = json.loads((FROZEN / 'INPUT-MANIFEST.json').read_text(encoding='utf-8'))
    present = {p.name for p in FROZEN.iterdir()} - seal.NOT_INPUTS
    if present != set(manifest['files']):
        out.append(f'inputs differ from the manifest: {sorted(present ^ set(manifest["files"]))}')
    for name, entry in manifest['files'].items():
        path = FROZEN / name
        if path.exists() and (sha(path) != entry['sha256'] or path.stat().st_size != entry['bytes']):
            out.append(f'{name} differs from the manifest')
    pins = json.loads((FROZEN / 'SEAL.json').read_text(encoding='utf-8'))['pins']
    for name, digest in pins.items():
        path = FROZEN / name if (FROZEN / name).exists() else HERE / name
        if sha(path) != digest:
            out.append(f'{name} differs from the seal')
    if facts_json().encode('utf-8') != (FROZEN / 'stories.json').read_bytes():
        out.append('stories.py no longer regenerates the sealed facts')
    if seal.records_json().encode('utf-8') != (FROZEN / 'records.json').read_bytes():
        out.append('stories.py no longer regenerates the sealed statement records')
    if manifest['facts']['sha256'] != sha(FROZEN / 'stories.json'):
        out.append('the rendered facts are not the sealed facts')
    expected = json.loads((FROZEN / 'EXPECTED.json').read_text(encoding='utf-8'))
    if expected != json.loads(json.dumps(seal.roll_oracle().run(FROZEN, FROZEN / 'stories.json'))):
        out.append("the foundation's oracle no longer reproduces EXPECTED.json")
    facts = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))
    differ = intent_differences(expected, facts)
    if differ:
        out.append(f'EXPECTED.json differs from the intent of {differ}')
    verify = json.loads((FROZEN / 'VERIFY.json').read_text(encoding='utf-8'))
    statements = {p['id'] for s in facts['stories'] for p in s['periods']}
    if not verify.get('ok') or len(verify.get('selfTest', [])) < 20 \
            or {s['id'] for s in verify['statements']} != statements:
        out.append('the independent PDF reading did not pass on every statement')
    eligibility = json.loads((FROZEN / 'ELIGIBILITY.json').read_text(encoding='utf-8'))
    named = {k.replace('-', '') for k in statements}
    if set(eligibility['statements']) != named:
        out.append('the check before the seal did not read every statement')
    found = {k: v['found'] for k, v in eligibility['statements'].items() if v['found']}
    if found:
        out.append(f'the check before the seal found what the reader refuses: {found}')
    return out


def main():
    found = problems()
    print(json.dumps({'sealIntact': not found, 'problems': found}, indent=1))
    if found:
        sys.exit(1)


if __name__ == '__main__':
    main()
