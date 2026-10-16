"""Read-only one-command gate; does not regenerate or reseal frozen sources."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def verify_frozen():
    manifest = json.loads((ROOT / 'INPUT-MANIFEST.json').read_text(encoding='utf-8'))
    paths = {'contract.json'} | {str(p.relative_to(ROOT)) for p in (ROOT / 'frozen').rglob('*') if p.is_file()}
    if paths != set(manifest['sha256']):
        raise AssertionError('FIN1A_MANIFEST_PATHS')
    for name, expected in manifest['sha256'].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
            raise AssertionError('FIN1A_INPUT_CHANGED:' + name)
    return manifest

if __name__ == '__main__':
    frozen = verify_frozen()
    completed = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'discover', '-s', str(ROOT), '-p', 'test_oracle.py', '-v'], check=False)
    if completed.returncode:
        raise SystemExit(completed.returncode)
    index = json.loads((ROOT / 'frozen/cases.json').read_text(encoding='utf-8'))
    print(json.dumps({'gate': 'FIN-1A foundation', 'cases': len(index['cases']), 'eligible': sum(c['expected'] == 'eligible' for c in index['cases']), 'blocked': sum(c['expected'] == 'blocked' for c in index['cases']), 'frozenInputs': len(frozen['sha256']), 'productEvaluated': False, 'synthetic': True}, sort_keys=True))
