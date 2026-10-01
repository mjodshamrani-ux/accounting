"""Explicit development-only GET downloads; no document data or runtime inference.

Pin every file by revision, byte length and SHA-256. Models stay in ignored work/.
Run from the repository root: python3 audit/local-provider/prepare-assets.py
"""
import hashlib
import json
import pathlib
import time
import urllib.request

root = pathlib.Path(__file__).resolve().parents[2]
manifest = json.loads((root / 'audit/local-provider/model.json').read_text())
assert manifest['developmentOnly'] and not manifest['productEnabled']
assert sum(f['bytes'] for f in manifest['files']) <= manifest['maxTotalBytes']
out = root / 'work/local-provider-assets' / manifest['model']
base = 'https://huggingface.co/' + manifest['model'] + '/resolve/' + manifest['revision'] + '/'
records = []
for spec in manifest['files']:
    relative = pathlib.PurePosixPath(spec['path'])
    assert not relative.is_absolute() and '..' not in relative.parts
    target = out.joinpath(*relative.parts)
    target.parent.mkdir(parents=True, exist_ok=True)
    def valid():
        if not target.exists() or target.stat().st_size != spec['bytes']:
            return False
        h = hashlib.sha256()
        with target.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                h.update(chunk)
        return h.hexdigest() == spec['sha256']
    start = time.monotonic()
    cached = valid()
    if not cached:
        temporary = target.with_suffix(target.suffix + '.partial')
        for attempt in range(3):
            try:
                request = urllib.request.Request(base + relative.as_posix(), headers={'User-Agent': 'Tarasuf-local-feasibility/1.0'})
                total, h = 0, hashlib.sha256()
                with urllib.request.urlopen(request, timeout=45) as response, temporary.open('wb') as stream:
                    assert response.status == 200
                    for chunk in iter(lambda: response.read(1024 * 1024), b''):
                        total += len(chunk)
                        if total > spec['bytes']:
                            raise ValueError('Asset exceeds frozen byte budget')
                        h.update(chunk)
                        stream.write(chunk)
                if total != spec['bytes'] or h.hexdigest() != spec['sha256']:
                    raise ValueError('Asset does not match its frozen SHA-256 or size')
                temporary.replace(target)
                break
            except Exception:
                temporary.unlink(missing_ok=True)
                if attempt == 2:
                    raise
                time.sleep(1)
    records.append({'path': spec['path'], 'bytes': spec['bytes'], 'sha256': spec['sha256'], 'alreadyCached': cached, 'elapsedMs': round((time.monotonic() - start) * 1000)})
    print(json.dumps(records[-1]), flush=True)
(root / 'work/local-provider-assets/download.json').write_text(json.dumps(records, indent=2) + '\n')
