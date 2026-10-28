"""The sealed cycle holdout C4 is intact: inputs by hash, the folder holds
nothing else, the facts and statement records regenerate from stories.py
byte for byte, expected.py (the foundation's composed oracle with its first
correction) reproduces EXPECTED.json, its tests pass (every save agrees
with the intent written by hand, the composed oracle agrees with the sealed
oracles on every month they judge alone, the stories hold what they were
written to hold, and a story changed in one decisive step no longer agrees),
the independent reading of every statement and ledger passed with its
planted changes found, the check before the seal found no refusal the
reader declares, and the seal pins the tools and the composed oracles as
they are now. The eligibility tool may change after the seal; its hashes at
the seal are recorded, not compared.

  python3 -B audit/bank-cycle-holdout-c4/check_seal.py
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
sys.path.insert(0, str(HERE))
import seal  # noqa: E402
from stories import facts_json  # noqa: E402


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
    if out:
        # An input that differs is named above; the oracle would only fail on it.
        return out
    expected = json.loads((FROZEN / 'EXPECTED.json').read_text(encoding='utf-8'))
    if expected != json.loads(json.dumps(seal.expectation().run(FROZEN))):
        out.append('expected.py no longer reproduces EXPECTED.json')
    tests = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'test_intent.py'], cwd=HERE,
                           capture_output=True, text=True)
    if tests.returncode != 0:
        out.append(f'the expectation tests fail: {tests.stderr[-1500:]}')
    facts = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))
    verify = json.loads((FROZEN / 'VERIFY.json').read_text(encoding='utf-8'))
    statements = {p['id'] for s in facts['stories'] for p in s['periods']}
    if not verify.get('ok') or len(verify.get('selfTest', [])) < 31 \
            or {s['id'] for s in verify['statements']} != statements \
            or {x['id'] for x in verify['ledgers']} != statements:
        out.append('the independent reading did not pass on every statement and ledger')
    hashes = {**{s['file']: s['sha256'] for s in verify['statements']},
              **{x['file']: x['sha256'] for x in verify['ledgers']}}
    if any(manifest['files'][name]['sha256'] != digest for name, digest in hashes.items()):
        out.append('the independent reading read other files than the sealed ones')
    eligibility = json.loads((FROZEN / 'ELIGIBILITY.json').read_text(encoding='utf-8'))
    if set(eligibility['statements']) != {k.replace('-', '') for k in statements}:
        out.append('the check before the seal did not read every statement')
    digests = {k.replace('-', ''): manifest['files'][f'{k}-statement.pdf']['sha256'] for k in statements}
    if {k: v.get('sha256') for k, v in eligibility['statements'].items()} != digests:
        out.append('the check before the seal read other files than the sealed statements')
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
