"""Prepare a bounded local source snapshot; never push, deploy or run a model.

Historical evidence stays in its original checkout. Required frozen lint sources
are retained byte-for-byte. The snapshot must pass its own checks before release.
"""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--out', required=True)
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
out = pathlib.Path(args.out).resolve()
if out.exists():
    raise SystemExit('Choose a fresh output directory; prior attempts are immutable.')
if out == root or root in out.parents:
    raise SystemExit('Keep the release snapshot outside the original checkout.')
out.mkdir(parents=True)
source = out / 'source'
source.mkdir()
tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
new = ['components/reconciliation-directory.tsx', 'lib/i18n/reconciliation-directory.ts',
       'scripts/reconciliation-entry-browser.mjs', 'scripts/prepare-release-snapshot.py']
required = json.loads((root / 'scripts/lint-frozen-originals.json').read_text())['files']
required_paths = {item['path'] for item in required}
required_paths.add('experiments/p5-official-proposal-v1/adapter.ts')
history = {'reviews', 'validation', 'first-inference', 'validation-first'}
manifest = {'sourceHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root).decode().strip(),
            'sourceMayIncludeUncommittedChanges': True,
            'remoteBase': 'b7e3ecda5831495134f81e13b5d839fd76996f62',
            'scope': 'Curated source and frozen regression inputs, not field validation or CI success.',
            'selected': [], 'excluded': [], 'requiredFrozenSources': required}
for name in sorted(set(tracked + new) - {''}):
    original = root / name
    if not original.is_file():
        raise SystemExit(f'Missing source: {name}')
    omit = name.startswith(('experiments/', 'handoff/', 'audit/reconciliation-entry-v1/',
                            'audit/p4-qualified-currency-validation-v1/'))
    omit |= name.startswith('audit/') and any(part in history for part in pathlib.PurePosixPath(name).parts)
    if omit and name not in required_paths:
        manifest['excluded'].append({'path': name, 'bytes': original.stat().st_size})
        continue
    data = original.read_bytes()
    target = source / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    shutil.copymode(original, target)
    manifest['selected'].append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
for item in required:
    data = (source / item['path']).read_bytes()
    if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
        raise SystemExit(f'Frozen source changed: {item["path"]}')
for group in ['selected', 'excluded']:
    manifest[group + 'Count'] = len(manifest[group])
    manifest[group + 'Bytes'] = sum(item['bytes'] for item in manifest[group])
(out / 'SOURCE-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
with zipfile.ZipFile(out / 'release-source.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for item in manifest['selected']:
        archive.write(source / item['path'], item['path'])
    archive.write(out / 'SOURCE-MANIFEST.json', 'SOURCE-MANIFEST.json')
print(json.dumps({key: manifest[key] for key in ['selectedCount', 'selectedBytes', 'excludedCount', 'excludedBytes']}))
