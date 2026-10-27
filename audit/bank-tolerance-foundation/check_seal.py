"""The sealed TOL-1 foundation is intact: inputs by hash, the folder holds
nothing else, the facts regenerate from stories.mjs byte for byte, the oracle
reproduces EXPECTED.json, the independent PDF reading passed with its planted
changes rejected, and the seal pins the tools as they are now. The oracle's
agreement with every intent is test_oracle.py's.

  python3 -B audit/bank-tolerance-foundation/check_seal.py
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
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location('tolerance_oracle', HERE / 'oracle.py')
oracle = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oracle)


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
        path = FROZEN / name if (FROZEN / name).exists() else (HERE / name).resolve()
        if sha(path) != digest:
            out.append(f'{name} differs from the seal')
    facts = subprocess.run(['node', str(HERE / 'stories.mjs')], check=True, capture_output=True).stdout
    if facts != (FROZEN / 'stories.json').read_bytes():
        out.append('stories.mjs no longer regenerates the sealed facts')
    expected = json.loads((FROZEN / 'EXPECTED.json').read_text(encoding='utf-8'))
    if expected != json.loads(json.dumps(oracle.run(FROZEN, FROZEN / 'stories.json'))):
        out.append('the oracle no longer reproduces EXPECTED.json')
    verify = json.loads((FROZEN / 'VERIFY.json').read_text(encoding='utf-8'))
    if not verify.get('passed') or not all(p['rejected'] for p in verify['selfTest']) \
            or verify['factsSha256'] != sha(FROZEN / 'stories.json'):
        out.append('the independent PDF reading did not pass on these facts')
    return out


def main():
    found = problems()
    print(json.dumps({'sealIntact': not found, 'problems': found}, indent=1))
    if found:
        sys.exit(1)


if __name__ == '__main__':
    main()
