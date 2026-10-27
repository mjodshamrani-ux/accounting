"""The sealed M4 holdout is intact: inputs by hash, the folder holds nothing
else, the sealed statements, twins and facts the stories name are
unchanged, stories.py --facts-only regenerates the facts, the maps and the
CSV files byte for byte, the foundation oracle reproduces EXPECTED.json,
the independent verification passed with its planted changes rejected, and
the seal pins the tools as they are now. The oracle's agreement with every
intent is test_intent.py's. No writer runs here.

  python3 -B audit/bank-map-holdout-m4/check_seal.py
"""
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUDIT = HERE.parent
FROZEN = HERE / 'frozen'
sys.path.insert(0, str(HERE))
import seal  # noqa: E402

_spec = importlib.util.spec_from_file_location('map_oracle', AUDIT / 'bank-map-foundation' / 'oracle.py')
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
    for name, digest in manifest['external'].items():
        if sha(AUDIT / name) != digest:
            out.append(f'{name} differs from the manifest')
    pins = json.loads((FROZEN / 'SEAL.json').read_text(encoding='utf-8'))['pins']
    for name, digest in pins.items():
        path = FROZEN / name if (FROZEN / name).exists() else (HERE / name).resolve()
        if sha(path) != digest:
            out.append(f'{name} differs from the seal')
    if out:
        return out
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run([sys.executable, '-B', str(HERE / 'stories.py'), '--out', tmp, '--facts-only'],
                       check=True, capture_output=True)
        made = {p.name for p in Path(tmp).iterdir()}
        if made != set(manifest['files']):
            out.append(f'stories.py makes other files: {sorted(made ^ set(manifest["files"]))}')
        for name in sorted(made & set(manifest['files'])):
            if name.endswith('.xlsx'):
                continue
            if (Path(tmp) / name).read_bytes() != (FROZEN / name).read_bytes():
                out.append(f'stories.py no longer regenerates {name}')
    expected = json.loads((FROZEN / 'EXPECTED.json').read_text(encoding='utf-8'))
    if expected != json.loads(json.dumps(oracle.run(FROZEN, FROZEN / 'stories.json'))):
        out.append('the oracle no longer reproduces EXPECTED.json')
    verify = json.loads((FROZEN / 'VERIFY.json').read_text(encoding='utf-8'))
    if not verify.get('passed') or not all(p['rejected'] for p in verify['selfTest']) \
            or verify['factsSha256'] != sha(FROZEN / 'stories.json'):
        out.append('the independent verification did not pass on these facts')
    return out


def main():
    found = problems()
    print(json.dumps({'sealIntact': not found, 'problems': found}, indent=1))
    if found:
        sys.exit(1)


if __name__ == '__main__':
    main()
