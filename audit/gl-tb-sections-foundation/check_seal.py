"""The sealed GLT-1 foundation is intact: inputs by hash, the folder holds
nothing else, the facts regenerate from stories.py byte for byte, the oracle
reproduces EXPECTED.json, the independent file check passed on these facts
with its planted changes rejected, and the seal pins the tools as they are
now. The oracle's agreement with every intent is test_oracle.py's.

  python3 -B audit/gl-tb-sections-foundation/check_seal.py
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
import oracle  # noqa: E402


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
    if set(pins) != {'INPUT-MANIFEST.json', *seal.JUDGED, *seal.TOOLS}:
        out.append('the seal pins another set of files')
    for name, digest in pins.items():
        path = FROZEN / name if (FROZEN / name).exists() else HERE / name
        if sha(path) != digest:
            out.append(f'{name} differs from the seal')
    facts = subprocess.run([sys.executable, '-B', str(HERE / 'stories.py')], check=True, capture_output=True).stdout
    if facts != (FROZEN / 'stories.json').read_bytes():
        out.append('stories.py no longer regenerates the sealed facts')
    expected = (FROZEN / 'EXPECTED.json').read_text(encoding='utf-8')
    if expected != json.dumps(oracle.run(FROZEN), ensure_ascii=False, indent=1) + '\n':
        out.append('the oracle no longer reproduces EXPECTED.json')
    verify = json.loads((FROZEN / 'VERIFY.json').read_text(encoding='utf-8'))
    if not verify.get('passed') or not verify['selfTest'] or not all(p['rejected'] for p in verify['selfTest']) \
            or verify['factsSha256'] != sha(FROZEN / 'stories.json'):
        out.append('the independent file check did not pass on these facts')
    return out


def main():
    found = problems()
    print(json.dumps({'sealIntact': not found, 'problems': found}, indent=1))
    if found:
        sys.exit(1)


if __name__ == '__main__':
    main()
