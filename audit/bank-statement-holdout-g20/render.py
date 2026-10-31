"""Renders the G20 holdout into its frozen assets and writes the seal.

Statements are written by the iText statement service (java/, prepared by
render_itext.py) or by the PDFKit statement application
(js/render_pdfkit.mjs, prepared by render_pdfkit.py) as each story says.
Cashbooks are CSV (UTF-8, CRLF); W03's also as a typed XLSX from OpenSpout
(php/cashbook.php) and W10's as a text XLSX from write-excel-file
(js/cashbook.mjs). The committed files under frozen/ are the assets, sealed
by INPUT-MANIFEST.json; this file is their recipe. The facts are not stored:
`python3 -B stories.py` regenerates them byte for byte, and the seal carries
their hash, the writers, the font files and the eligibility declared in
holdout.json.

The Java program is built by Maven from java/pom.xml in the work folder,
outside the repository; the Node programs run against the packages npm
installs from js/package-lock.json, which also carries the fonts; the PHP
program runs against the packages Composer installs from php/composer.lock.
A statement whose pages differ in number from the facts' is an error here.
The statements' dates are fixed by their programs. iText draws its subset
prefixes and its document identifier itself, and OpenSpout stamps
docProps/core.xml with the clock, so a new render differs from the sealed
files in those bytes; each XLSX's zip entries are dated afterwards
(settle_xlsx).

  cp js/package.json js/package-lock.json <js dir> && npm ci --prefix <js dir> --ignore-scripts
  cp php/composer.json php/composer.lock <php dir> && composer install --no-plugins --no-scripts --working-dir <php dir>
  PYTHONPATH=<pymupdf> python3 -B render.py --modules <js dir>/node_modules --vendor <php dir>/vendor \\
    [--out dir] [--work dir]
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fonts  # noqa: E402
import render_itext  # noqa: E402
import render_pdfkit  # noqa: E402
from common import CASHBOOK_HEADERS, cashbook_csv  # noqa: E402
from stories import VERSION, build, facts_json  # noqa: E402

STAMP = (2029, 1, 31, 12, 0, 0)
NODE_PACKAGES = ('pdfkit', 'fontkit', 'bidi-js', 'write-excel-file')


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


def php_packages(vendor):
    lock = {p['name']: p['version'] for p in json.loads((HERE / 'php' / 'composer.lock').read_text(encoding='utf-8'))['packages']}
    installed = {p['name']: p['version'] for p in
                 json.loads((Path(vendor) / 'composer' / 'installed.json').read_text(encoding='utf-8'))['packages']}
    if installed.get('openspout/openspout') != lock['openspout/openspout']:
        raise ValueError(f"openspout {installed.get('openspout/openspout')} installed, {lock['openspout/openspout']} locked")
    return {'openspout': lock['openspout/openspout'].lstrip('v')}


def java_build(work):
    """The Java program built in the work folder; returns its class path and
    its libraries' versions."""
    java = work / 'java'
    shutil.copytree(HERE / 'java', java, ignore=shutil.ignore_patterns('target'))
    subprocess.run(['mvn', '-q', '-B', 'package', 'dependency:copy-dependencies',
                    '-DoutputDirectory=target/lib'], cwd=java, check=True)
    jars = sorted((java / 'target' / 'lib').glob('*.jar'))
    versions = dict(re.match(r'(.+)-(\d[\w.]*)\.jar$', j.name).groups() for j in jars)
    classpath = os.pathsep.join([str(java / 'target' / 'classes')] + [str(j) for j in jars])
    return classpath, versions


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
        subprocess.run(['php', str(HERE / 'php' / 'cashbook.php'), str(vendor), str(work / 'cashbooks.json')], check=True)
        subprocess.run(['node', str(HERE / 'js' / 'cashbook.mjs'), str(modules), str(work / 'cashbooks.json')], check=True)
        for s in stories:
            if s.get('cashbookXlsx'):
                path = out / f"{s['id']}-cashbook.xlsx"
                settle_xlsx(path)
                written.append(path)
        classpath, jars = java_build(work)
        drawn = render_itext.prepare(stories, work / 'itext', modules, out)
        subprocess.run(['java', '-cp', classpath, 'tarasuf.holdout.Statements', str(work / 'itext' / 'statements.json')],
                       check=True)
        drawn += render_pdfkit.prepare(stories, work / 'pdfkit', modules, out)
        subprocess.run(['node', str(HERE / 'js' / 'render_pdfkit.mjs'), str(modules),
                        str(work / 'pdfkit' / 'statements.json')], check=True)
        for s, path in drawn:
            if page_count(path) != len(s['statement']['pages']):
                raise ValueError(f"{s['id']}: {page_count(path)} pages drawn for {len(s['statement']['pages'])}")
            written.append(path)
        if len(drawn) != len(stories):
            raise ValueError('a story has no writer')
    java_version = subprocess.run(['java', '-XshowSettings:properties', '-version'], check=True, capture_output=True,
                                  text=True).stderr
    java_version = re.search(r'java\.runtime\.version = (\S+)', java_version).group(1)
    php_version = subprocess.run(['php', '-r', 'echo PHP_VERSION;'], check=True, capture_output=True, text=True).stdout
    node_version = subprocess.run(['node', '--version'], check=True, capture_output=True, text=True).stdout.strip()
    holdout = (HERE / 'holdout.json').read_bytes()
    manifest = {
        'version': VERSION,
        'producers': {
            'itext-kernel': jars['kernel'], 'itext-layout': jars['layout'], 'itext-io': jars['io'],
            'jackson-databind': jars['jackson-databind'], 'java': java_version,
            'pdfkit': node['pdfkit'], 'fontkit': node['fontkit'], 'bidi-js': node['bidi-js'],
            'write-excel-file': node['write-excel-file'], 'node': node_version.lstrip('v'),
            'openspout': php['openspout'], 'php': php_version,
            'cashbookCsv': 'Python csv, UTF-8, CRLF',
        },
        'fonts': fonts.provenance(modules, {s['font'] for s in stories}),
        'holdout': {'file': 'holdout.json', 'sha256': sha(holdout)},
        'facts': {'file': 'stories.json', 'stored': False,
                  'recipe': 'python3 -B audit/bank-statement-holdout-g20/stories.py',
                  'sha256': sha(facts.encode('utf-8')), 'bytes': len(facts.encode('utf-8'))},
        'files': [{'file': p.name, 'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
                  for p in sorted(written, key=lambda p: p.name)],
    }
    (out / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(manifest['files']), 'producers': manifest['producers']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
