"""Renders the G23 holdout into its frozen assets and writes the seal.

Statements are written by the HexaPDF statement service (ruby/statements.rb,
prepared by render_hexapdf.py) or by the pdf-lib statement application
(js/render_pdflib.mjs, prepared by render_pdflib.py) as each story says.
Cashbooks are CSV (UTF-8, CRLF); X03's also as a typed XLSX from write_xlsx
(ruby/cashbook.rb) and X10's as a text XLSX from SheetJS (js/cashbook.mjs).
The committed files under frozen/ are the assets, sealed by
INPUT-MANIFEST.json; this file is their recipe. The facts are not stored:
`python3 -B stories.py` regenerates them byte for byte, and the seal carries
their hash, the writers, the font files and the eligibility declared in
holdout.json.

The Ruby programs run against the gems Bundler installs from
ruby/Gemfile.lock; the Node programs against the packages npm installs from
js/package-lock.json, which also carries the fonts. A statement whose pages
differ in number from the facts' is an error here. The documents' creation
dates are fixed by their programs. HexaPDF sets the modification date and
the document identifier itself on writing, and its subsetter stamps each
font's head table, from the clock: its statements differ between renders in
those bytes alone. Each XLSX's zip entries are dated afterwards
(settle_xlsx).

  cp ruby/Gemfile ruby/Gemfile.lock <ruby dir> && (cd <ruby dir> && bundle config set --local path vendor/bundle && bundle install)
  cp js/package.json js/package-lock.json <js dir> && npm ci --prefix <js dir> --ignore-scripts
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
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fonts  # noqa: E402
import render_hexapdf  # noqa: E402
import render_pdflib  # noqa: E402
from common import CASHBOOK_HEADERS, cashbook_csv  # noqa: E402
from stories import VERSION, build, facts_json  # noqa: E402

STAMP = (2030, 1, 31, 12, 0, 0)
NODE_PACKAGES = ('pdf-lib', '@pdf-lib/fontkit', 'bidi-js', 'xlsx')
GEMS = ('hexapdf', 'write_xlsx')


def sha(b):
    return hashlib.sha256(b).hexdigest()


def page_count(path):
    import pymupdf
    with pymupdf.open(str(path)) as doc:
        return doc.page_count


def cashbooks_json(stories, out):
    books = [{'out': str(out / f"{s['id']}-cashbook.xlsx"), 'kind': s['cashbookXlsx'], 'headers': CASHBOOK_HEADERS,
              'entries': [{k: e[k] for k in ('date', 'voucher', 'description', 'reference', 'receipt', 'payment')}
                          for e in s['cashbook']]}
             for s in stories if s.get('cashbookXlsx')]
    return json.dumps({'cashbooks': books}, ensure_ascii=False)


def settle_xlsx(path):
    """Each zip entry rewritten with the fixed date."""
    with zipfile.ZipFile(path) as z:
        entries = [(i, z.read(i.filename)) for i in z.infolist()]
    with zipfile.ZipFile(path, 'w') as z:
        for info, data in entries:
            fixed = zipfile.ZipInfo(info.filename, STAMP)
            fixed.compress_type = zipfile.ZIP_DEFLATED
            fixed.external_attr = info.external_attr
            z.writestr(fixed, data)


def node_packages(modules):
    """The installed and the locked versions of the Node packages."""
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
    """The locked and the loaded versions of the gems."""
    lock = (HERE / 'ruby' / 'Gemfile.lock').read_text(encoding='utf-8')
    if lock != (Path(gems) / 'Gemfile.lock').read_text(encoding='utf-8'):
        raise ValueError(f'{gems}/Gemfile.lock is not ruby/Gemfile.lock')
    # write_xlsx defines no version constant of its own; the gem's loaded
    # specification gives both.
    loaded = json.loads(ruby(gems, '-e', 'require "json"; require "hexapdf"; require "write_xlsx"; '
                                       'puts JSON.dump(hexapdf: Gem.loaded_specs["hexapdf"].version.to_s, '
                                       'write_xlsx: Gem.loaded_specs["write_xlsx"].version.to_s, ruby: RUBY_VERSION)'))
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
    stories = build()
    facts = facts_json(stories)
    written = []
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(args.work or tmp).resolve()
        work.mkdir(parents=True, exist_ok=True)
        for s in stories:
            path = out / f"{s['id']}-cashbook.csv"
            path.write_bytes(cashbook_csv(s).encode('utf-8'))
            written.append(path)
        (work / 'cashbooks.json').write_text(cashbooks_json(stories, out), encoding='utf-8')
        ruby(gems, str(HERE / 'ruby' / 'cashbook.rb'), str(work / 'cashbooks.json'))
        subprocess.run(['node', str(HERE / 'js' / 'cashbook.mjs'), str(modules), str(work / 'cashbooks.json')], check=True)
        for s in stories:
            if s.get('cashbookXlsx'):
                path = out / f"{s['id']}-cashbook.xlsx"
                settle_xlsx(path)
                written.append(path)
        drawn = render_hexapdf.prepare(stories, work / 'hexapdf', modules, out)
        ruby(gems, str(HERE / 'ruby' / 'statements.rb'), str(work / 'hexapdf' / 'statements.json'))
        drawn += render_pdflib.prepare(stories, work / 'pdflib', modules, out)
        subprocess.run(['node', str(HERE / 'js' / 'render_pdflib.mjs'), str(modules),
                        str(work / 'pdflib' / 'statements.json')], check=True)
        for s, path in drawn:
            if page_count(path) != len(s['statement']['pages']):
                raise ValueError(f"{s['id']}: {page_count(path)} pages drawn for {len(s['statement']['pages'])}")
            written.append(path)
        if len(drawn) != len(stories):
            raise ValueError('a story has no writer')
    node_version = subprocess.run(['node', '--version'], check=True, capture_output=True, text=True).stdout.strip()
    holdout = (HERE / 'holdout.json').read_bytes()
    manifest = {
        'version': VERSION,
        'producers': {
            'hexapdf': loaded['hexapdf'], 'write_xlsx': loaded['write_xlsx'], 'ruby': loaded['ruby'],
            'pdf-lib': node['pdf-lib'], '@pdf-lib/fontkit': node['@pdf-lib/fontkit'], 'bidi-js': node['bidi-js'],
            'xlsx': node['xlsx'], 'node': node_version.lstrip('v'),
            'cashbookCsv': 'Python csv, UTF-8, CRLF',
        },
        'fonts': fonts.provenance(modules, {s['font'] for s in stories}),
        'holdout': {'file': 'holdout.json', 'sha256': sha(holdout)},
        'facts': {'file': 'stories.json', 'stored': False,
                  'recipe': 'python3 -B audit/bank-statement-holdout-g23/stories.py',
                  'sha256': sha(facts.encode('utf-8')), 'bytes': len(facts.encode('utf-8'))},
        'files': [{'file': p.name, 'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
                  for p in sorted(written, key=lambda p: p.name)],
    }
    (out / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(manifest['files']), 'producers': manifest['producers']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
