"""The sealed A5 holdout is intact: inputs by hash, the folder holds nothing
else, the facts regenerate from stories.py byte for byte, the foundation
oracle reproduces EXPECTED.json and agrees with every story's hand-written
intent, the independent PDF reading passed with every planted fault
rejected, the pre-seal eligibility found no refusal the guarded reader
declares, and the seal pins the tools and expectations as they are now.

  python3 -B audit/ar-statement-holdout-a5/check_seal.py
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

# The eligibility tool's `columns` check is the bank statement reader's
# column model, not this family's; every other check applies to the guarded
# PDF source both readers share.
BANK_ONLY = {'columns'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def disagreement(story, judged):
    """Where the oracle's judgment departs from the story's intent."""
    intent = story['intent']
    out = []
    for key in ('status', 'matched'):
        if judged[key] != intent[key]:
            out.append(f'{key} {judged[key]!r}, intent {intent[key]!r}')
    if judged['review'] != intent.get('review', {}):
        out.append(f'review {judged["review"]}, intent {intent.get("review", {})}')
    if judged['errorCodes'] != intent.get('errors', []):
        out.append(f'errors {judged["errorCodes"]}, intent {intent.get("errors", [])}')
    if 'outOfScopeLines' in intent and judged['outOfScopeLines'] != intent['outOfScopeLines']:
        out.append(f'out of scope {judged["outOfScopeLines"]}, intent {intent["outOfScopeLines"]}')
    return out


def problems(frozen=FROZEN):
    out = []
    manifest = json.loads((frozen / 'INPUT-MANIFEST.json').read_text(encoding='utf-8'))
    present = {p.name for p in frozen.iterdir()} - seal.NOT_INPUTS
    if present != set(manifest['files']):
        out.append(f'inputs differ from the manifest: {sorted(present ^ set(manifest["files"]))}')
    for name, entry in manifest['files'].items():
        path = frozen / name
        if path.exists() and (sha(path) != entry['sha256'] or path.stat().st_size != entry['bytes']):
            out.append(f'{name} differs from the manifest')
    pins = json.loads((frozen / 'SEAL.json').read_text(encoding='utf-8'))['pins']
    for name, digest in pins.items():
        path = frozen / name if (frozen / name).exists() else HERE / name
        if sha(path) != digest:
            out.append(f'{name} differs from the seal')
    facts = subprocess.run([sys.executable, '-B', str(HERE / 'stories.py')], check=True,
                           capture_output=True, text=True).stdout
    compact = json.dumps(json.loads(facts), ensure_ascii=False, separators=(',', ':')) + '\n'
    if compact.encode('utf-8') != (frozen / 'stories.json').read_bytes():
        out.append('stories.py no longer regenerates the sealed facts')
    facts = json.loads((frozen / 'stories.json').read_text(encoding='utf-8'))
    expected = json.loads((frozen / 'EXPECTED.json').read_text(encoding='utf-8'))
    if expected != json.loads(json.dumps(seal.expected(frozen))):
        out.append('the oracle no longer reproduces EXPECTED.json')
    for story in facts['stories']:
        for d in disagreement(story, expected['stories'][story['id']]):
            out.append(f"{story['id']}: the oracle and the intent differ: {d}")
    verify = json.loads((frozen / 'VERIFY.json').read_text(encoding='utf-8'))
    if not verify.get('passed') or not all(p['rejected'] for p in verify['selfTest']) \
            or set(verify['stories']) != {s['id'] for s in facts['stories']}:
        out.append('the independent PDF reading did not pass')
    eligibility = json.loads((frozen / 'ELIGIBILITY.json').read_text(encoding='utf-8'))
    for sid, report in eligibility['statements'].items():
        if report['sha256'] != manifest['files'][f'{sid}-statement.pdf']['sha256']:
            out.append(f'{sid}: the eligibility read another file')
        found = set(report['found']) - BANK_ONLY
        if found:
            out.append(f'{sid}: falls into a refusal the reader declares: {sorted(found)}')
    if set(eligibility['statements']) != {s['id'] for s in facts['stories']}:
        out.append('the eligibility did not read every statement')
    return out


def main():
    found = problems()
    print(json.dumps({'sealIntact': not found, 'problems': found}, indent=1))
    if found:
        sys.exit(1)


if __name__ == '__main__':
    main()
