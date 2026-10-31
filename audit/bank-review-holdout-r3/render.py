"""Renders the R3 holdout into its frozen assets and writes the input manifest.

Each period's statement is drawn by the HexaPDF statement service
(ruby/statements.rb, prepared by render_hexapdf.py) or by the pdf-lib
statement application (js/render_pdflib.mjs, prepared by render_pdflib.py),
as its story's `print` says; both are copied unchanged from the R4 holdout
(itself W4's, itself G23's), with their common.py and fonts.py. Each
period's cashbook is CSV (UTF-8, CRLF, common.cashbook_csv), and so is the
corrected cashbook a story replaces its own with,
<period>-cashbook-corrected.csv. No session file is written: the review
stories decide in the period they open.

HexaPDF sets the modification date and the document identifier on writing
and stamps each subset font's head table from the clock, so a re-render is
not byte-equal: the committed files under frozen/ are the assets, sealed by
INPUT-MANIFEST.json. The facts are not stored: `python3 -B stories.py`
regenerates them byte for byte, and the manifest carries their hash.

  PYTHONPATH=<pymupdf, fontTools> python3 -B render.py --modules <js dir>/node_modules --gems <ruby dir> [--out dir] [--work dir]
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fonts  # noqa: E402
import render_hexapdf  # noqa: E402
import render_pdflib  # noqa: E402
from common import cashbook_csv  # noqa: E402
from stories import VERSION, facts, facts_json, print_records  # noqa: E402

NODE_PACKAGES = ('pdf-lib', '@pdf-lib/fontkit', 'bidi-js')
GEMS = ('hexapdf',)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def page_count(path):
    import pymupdf
    with pymupdf.open(str(path)) as doc:
        return doc.page_count


def node_packages(modules):
    lock = json.loads((HERE / 'js' / 'package-lock.json').read_text(encoding='utf-8'))['packages']
    out = {}
    for name in NODE_PACKAGES:
        installed = json.loads((Path(modules) / name / 'package.json').read_text(encoding='utf-8'))['version']
        locked = lock[f'node_modules/{name}']['version']
        if installed != locked:
            raise ValueError(f'{name} {installed} installed, {locked} locked')
        out[name] = installed
    return out


def ruby(gems, *args):
    env = dict(os.environ, BUNDLE_GEMFILE=str(Path(gems) / 'Gemfile'))
    done = subprocess.run(['bundle', 'exec', 'ruby', *args], env=env, capture_output=True, text=True)
    if done.returncode:
        raise RuntimeError(f'ruby {args[0]} failed:\n{done.stderr}')
    return done.stdout


def gem_versions(gems):
    lock = (HERE / 'ruby' / 'Gemfile.lock').read_text(encoding='utf-8')
    if lock != (Path(gems) / 'Gemfile.lock').read_text(encoding='utf-8'):
        raise ValueError(f'{gems}/Gemfile.lock is not ruby/Gemfile.lock')
    loaded = json.loads(ruby(gems, '-e', 'require "json"; require "hexapdf"; '
                                       'puts JSON.dump(hexapdf: Gem.loaded_specs["hexapdf"].version.to_s, ruby: RUBY_VERSION)'))
    for name in GEMS:
        locked = re.search(rf'^    {re.escape(name)} \(([^)]+)\)$', lock, re.M).group(1)
        if loaded[name] != locked:
            raise ValueError(f'{name} {loaded[name]} loaded, {locked} locked')
    return loaded


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(HERE / 'frozen'))
    parser.add_argument('--work', default=None)
    parser.add_argument('--modules', required=True)
    parser.add_argument('--gems', required=True)
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    modules, gems = Path(args.modules).resolve(), Path(args.gems).resolve()
    node = node_packages(modules)
    loaded = gem_versions(gems)
    text = facts_json()
    f = facts()
    records = print_records(f)
    written = []
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(args.work or tmp).resolve()
        work.mkdir(parents=True, exist_ok=True)
        for r in records:
            path = out / f"{r['id']}-cashbook.csv"
            path.write_bytes(cashbook_csv(r).encode('utf-8'))
            written.append(path)
        drawn = render_hexapdf.prepare(records, work / 'hexapdf', modules, out)
        ruby(gems, str(HERE / 'ruby' / 'statements.rb'), str(work / 'hexapdf' / 'statements.json'))
        drawn += render_pdflib.prepare(records, work / 'pdflib', modules, out)
        subprocess.run(['node', str(HERE / 'js' / 'render_pdflib.mjs'), str(modules),
                        str(work / 'pdflib' / 'statements.json')], check=True)
        for r, path in drawn:
            if page_count(path) != len(r['statement']['pages']):
                raise ValueError(f"{r['id']}: {page_count(path)} pages drawn for {len(r['statement']['pages'])}")
            written.append(path)
        if len(drawn) != len(records):
            raise ValueError('a statement has no writer')
    for s in f['stories']:
        if s['replace']:
            path = out / f"{s['periods'][-1]['id']}-cashbook-corrected.csv"
            path.write_bytes(cashbook_csv({'cashbook': s['replace']['cashbook']}).encode('utf-8'))
            written.append(path)
    node_version = subprocess.run(['node', '--version'], check=True, capture_output=True, text=True).stdout.strip()
    manifest = {
        'version': VERSION,
        'producers': {
            'hexapdf': loaded['hexapdf'], 'ruby': loaded['ruby'],
            'pdf-lib': node['pdf-lib'], '@pdf-lib/fontkit': node['@pdf-lib/fontkit'], 'bidi-js': node['bidi-js'],
            'node': node_version.lstrip('v'),
            'cashbookCsv': 'Python csv, UTF-8, CRLF',
        },
        'fonts': fonts.provenance(modules, {r['font'] for r in records}),
        'facts': {'file': 'stories.json', 'stored': False, 'recipe': 'python3 -B audit/bank-review-holdout-r3/stories.py',
                  'sha256': sha(text.encode('utf-8')), 'bytes': len(text.encode('utf-8'))},
        'files': {p.name: {'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
                  for p in sorted(written, key=lambda p: p.name)},
    }
    (out / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(manifest['files']), 'producers': manifest['producers']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
