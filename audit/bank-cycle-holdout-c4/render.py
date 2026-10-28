"""Renders the cycle holdout C4 into its frozen assets and writes the input
manifest.

Each month's statement is drawn by the Prawn statement job
(ruby/render_prawn.rb, prepared by render_prawn.py) or by the PDFKit
statement application (js/render_pdfkit.mjs, prepared by render_pdfkit.py),
as its story's `print` says; both are copied unchanged from the G17 and G20
holdouts, with common.py from the cycle foundation. Each month's ledger is
the company's export in its own layout, written by caxlsx
(ruby/ledgers.rb) or OpenSpout (php/ledgers.php), and its declared twin is
CSV (UTF-8, CRLF, common.cashbook_csv), the file the sealed oracles read. No
session file is written: the product saves the first month's session and
the second month takes it.

OpenSpout stamps docProps/core.xml with the clock, and every writer dates
its zip entries, so the entries are dated afterwards (settle_xlsx) and a
re-render differs from the sealed files in the OpenSpout ledgers' core.xml
alone: the committed files under frozen/ are the assets, sealed by
INPUT-MANIFEST.json. The facts are stored too (frozen/stories.json), and
`python3 -B stories.py` regenerates them byte for byte.

  cp js/package.json js/package-lock.json <js dir> && npm ci --prefix <js dir> --ignore-scripts
  cp php/composer.json php/composer.lock <php dir> && composer install --no-plugins --no-scripts --working-dir <php dir>
  BUNDLE_GEMFILE=$PWD/ruby/Gemfile BUNDLE_PATH=<gem dir> bundle install
  BUNDLE_PATH=<gem dir> PYTHONPATH=<pymupdf, fontTools> python3 -B render.py --modules <js dir>/node_modules \\
    --vendor <php dir>/vendor [--out dir] [--work dir]
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
import render_pdfkit  # noqa: E402
import render_prawn  # noqa: E402
from common import cashbook_csv  # noqa: E402
from stories import VERSION, facts, facts_json, print_records  # noqa: E402

STAMP = (2029, 8, 1, 12, 0, 0)
NODE_PACKAGES = ('pdfkit', 'fontkit', 'bidi-js')
GEMS = ('prawn', 'prawn-table', 'caxlsx')
RUBY = dict(os.environ, BUNDLE_GEMFILE=str(HERE / 'ruby' / 'Gemfile'))


def sha(b):
    return hashlib.sha256(b).hexdigest()


def page_count(path):
    import pymupdf
    with pymupdf.open(str(path)) as doc:
        return doc.page_count


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
    lock = json.loads((HERE / 'js' / 'package-lock.json').read_text(encoding='utf-8'))['packages']
    out = {}
    for name in NODE_PACKAGES:
        installed = json.loads((Path(modules) / name / 'package.json').read_text(encoding='utf-8'))['version']
        locked = lock[f'node_modules/{name}']['version']
        if installed != locked:
            raise ValueError(f'{name} {installed} installed, {locked} locked')
        out[name] = installed
    return out


def php_packages(vendor):
    lock = {p['name']: p['version'] for p in
            json.loads((HERE / 'php' / 'composer.lock').read_text(encoding='utf-8'))['packages']}
    installed = {p['name']: p['version'] for p in
                 json.loads((Path(vendor) / 'composer' / 'installed.json').read_text(encoding='utf-8'))['packages']}
    if installed.get('openspout/openspout') != lock['openspout/openspout']:
        raise ValueError(f"openspout {installed.get('openspout/openspout')} installed, "
                         f"{lock['openspout/openspout']} locked")
    return {'openspout': lock['openspout/openspout'].lstrip('v')}


def gems():
    """The gems Bundler resolved, checked against ruby/Gemfile.lock."""
    listed = subprocess.run(['bundle', 'list'], env=RUBY, check=True, capture_output=True, text=True).stdout
    resolved = dict(re.findall(r'^\s+\*\s+(\S+) \(([^)\s]+)', listed, re.M))
    locked = dict(re.findall(r'^    (\S+) \((\d[^)-]*)', (HERE / 'ruby' / 'Gemfile.lock').read_text(encoding='utf-8'),
                             re.M))
    out = {}
    for name in GEMS:
        if resolved.get(name) != locked.get(name):
            raise ValueError(f'{name} {resolved.get(name)} resolved, {locked.get(name)} locked')
        out[name] = locked[name]
    return out


def ruby(*args):
    subprocess.run(['bundle', 'exec', 'ruby', *args], env=RUBY, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(HERE / 'frozen'))
    parser.add_argument('--work', default=None)
    parser.add_argument('--modules', required=True)
    parser.add_argument('--vendor', required=True)
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    modules, vendor = Path(args.modules).resolve(), Path(args.vendor).resolve()
    node = node_packages(modules)
    php = php_packages(vendor)
    resolved = gems()
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
        ledgers = [{'out': str(out / ledger['file']), 'writer': ledger['writer'], 'sheet': ledger['sheet'],
                    'rows': ledger['rows']} for s in f['stories'] for ledger in s['ledgers'].values()]
        (work / 'ledgers.json').write_text(json.dumps({'ledgers': ledgers}, ensure_ascii=False), encoding='utf-8')
        ruby(str(HERE / 'ruby' / 'ledgers.rb'), str(work / 'ledgers.json'))
        subprocess.run(['php', str(HERE / 'php' / 'ledgers.php'), str(vendor), str(work / 'ledgers.json')], check=True)
        for ledger in ledgers:
            path = Path(ledger['out'])
            settle_xlsx(path)
            written.append(path)
        drawn = render_prawn.prepare(records, work / 'prawn', modules, out)
        ruby(str(HERE / 'ruby' / 'render_prawn.rb'), str(work / 'prawn' / 'statements.json'))
        drawn += render_pdfkit.prepare(records, work / 'pdfkit', modules, out)
        subprocess.run(['node', str(HERE / 'js' / 'render_pdfkit.mjs'), str(modules),
                        str(work / 'pdfkit' / 'statements.json')], check=True)
        for r, path in drawn:
            if page_count(path) != len(r['statement']['pages']):
                raise ValueError(f"{r['id']}: {page_count(path)} pages drawn for {len(r['statement']['pages'])}")
            written.append(path)
        if len(drawn) != len(records):
            raise ValueError('a statement has no writer')
    facts_path = out / 'stories.json'
    facts_path.write_bytes(text.encode('utf-8'))
    written.append(facts_path)
    versions = lambda *cmd: subprocess.run(cmd, check=True, capture_output=True, text=True).stdout.strip()  # noqa: E731
    manifest = {
        'version': VERSION,
        'producers': {
            **resolved, 'ruby': versions('ruby', '-e', 'print RUBY_VERSION'),
            **node, 'node': versions('node', '--version').lstrip('v'),
            **php, 'php': versions('php', '-r', 'echo PHP_VERSION;'),
            'cashbookCsv': 'Python csv, UTF-8, CRLF',
        },
        'fonts': fonts.provenance(modules, {r['font'] for r in records}),
        'facts': {'file': 'stories.json', 'stored': True, 'recipe': 'python3 -B audit/bank-cycle-holdout-c4/stories.py',
                  'sha256': sha(text.encode('utf-8')), 'bytes': len(text.encode('utf-8'))},
        'files': {p.name: {'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
                  for p in sorted(written, key=lambda p: p.name)},
    }
    (out / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(manifest['files']), 'producers': manifest['producers']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
