"""Renders the G17 holdout into its frozen assets and writes the seal.

Statements are written by Prawn (ruby/render_prawn.rb) or by the cairo
application (render_cairo.py) as each story says. Cashbooks are CSV (UTF-8,
CRLF); V03's also as a typed XLSX from caxlsx (ruby/cashbooks.rb) and V10's
as a text XLSX from fastexcel (java/). The committed files under frozen/
are the assets, sealed by INPUT-MANIFEST.json; this file is their recipe. The
facts are not stored: `python3 -B stories.py` regenerates them byte for byte,
and the seal carries their hash, the writers, the font files and the
eligibility declared in holdout.json.

The Ruby programs run against the gems Bundler installs from
ruby/Gemfile.lock; the Java program is built by Maven from java/pom.xml in
the work folder, outside the repository; the cairo application runs on the
system libcairo and libfreetype, with uharfbuzz and python-bidi at the
versions py/requirements.txt pins; the fonts are built (fonts.py) from the
Fontsource packages npm installs from js/package-lock.json. A statement
whose pages differ in number from the facts' is an error here. Every writer's
dates are fixed by its program, so their bytes need no fixing; each XLSX's
zip entries are dated afterwards (settle_xlsx).

  cp js/package.json js/package-lock.json <js dir> && npm ci --prefix <js dir> --ignore-scripts
  BUNDLE_GEMFILE=$PWD/ruby/Gemfile BUNDLE_PATH=<gem dir> bundle install
  python3 -m pip install --target <py dir> -r py/requirements.txt
  BUNDLE_PATH=<gem dir> PYTHONPATH=<py dir>:<pymupdf, fonttools> python3 -B render.py \\
    --modules <js dir>/node_modules [--out dir] [--work dir]
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
import render_cairo  # noqa: E402
import render_prawn  # noqa: E402
from common import CASHBOOK_HEADERS, cashbook_csv  # noqa: E402
from stories import VERSION, build, facts_json  # noqa: E402

STAMP = (2028, 1, 31, 12, 0, 0)
RUBY = dict(os.environ, BUNDLE_GEMFILE=str(HERE / 'ruby' / 'Gemfile'))


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


def gems():
    """The gems Bundler resolved, by name, with their versions."""
    out = subprocess.run(['bundle', 'list'], env=RUBY, check=True, capture_output=True, text=True).stdout
    return dict(re.findall(r'^\s+\*\s+(\S+) \(([^)\s]+)', out, re.M))


def locked_gems():
    text = (HERE / 'ruby' / 'Gemfile.lock').read_text(encoding='utf-8')
    return dict(re.findall(r'^    (\S+) \((\d[^)-]*)', text, re.M))


def python_pins():
    text = (HERE / 'py' / 'requirements.txt').read_text(encoding='utf-8')
    return dict(re.findall(r'^([\w.-]+)==(\S+)', text, re.M))


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
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    modules = Path(args.modules).resolve()
    installed, locked = gems(), locked_gems()
    for name in ('prawn', 'prawn-table', 'pdf-core', 'ttfunk', 'caxlsx'):
        if installed.get(name) != locked.get(name):
            raise ValueError(f'{name} {installed.get(name)} installed, {locked.get(name)} locked')
    from importlib.metadata import version as python_package
    for name, pinned in python_pins().items():
        if python_package(name) != pinned:
            raise ValueError(f'{name} {python_package(name)} installed, {pinned} pinned')
    stories = build()
    facts = facts_json(stories)
    written = []
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(args.work or tmp).resolve()
        work.mkdir(parents=True, exist_ok=True)
        built = fonts.build(modules, work / 'fonts')
        for s in stories:
            path = out / f"{s['id']}-cashbook.csv"
            path.write_bytes(cashbook_csv(s).encode('utf-8'))
            written.append(path)
        (work / 'cashbooks.json').write_text(cashbooks_json(stories, out), encoding='utf-8')
        subprocess.run(['bundle', 'exec', 'ruby', str(HERE / 'ruby' / 'cashbooks.rb'), str(work / 'cashbooks.json')],
                       env=RUBY, check=True)
        classpath, jars = java_build(work)
        subprocess.run(['java', '-cp', classpath, 'tarasuf.holdout.Cashbooks', str(work / 'cashbooks.json')],
                       check=True)
        for s in stories:
            if s.get('cashbookXlsx'):
                path = out / f"{s['id']}-cashbook.xlsx"
                settle_xlsx(path)
                written.append(path)
        drawn = render_prawn.prepare(stories, work / 'prawn', work / 'fonts', out)
        subprocess.run(['bundle', 'exec', 'ruby', str(HERE / 'ruby' / 'render_prawn.rb'),
                        str(work / 'prawn' / 'statements.json')], env=RUBY, check=True)
        drawn += render_cairo.draw(stories, work / 'fonts', out)
        for s, path in drawn:
            if page_count(path) != len(s['statement']['pages']):
                raise ValueError(f"{s['id']}: {page_count(path)} pages drawn for {len(s['statement']['pages'])}")
            written.append(path)
        if len(drawn) != len(stories):
            raise ValueError('a story has no writer')
    ruby_version = subprocess.run(['ruby', '-e', 'print RUBY_VERSION'], check=True, capture_output=True,
                                  text=True).stdout.strip()
    java_version = subprocess.run(['java', '-XshowSettings:properties', '-version'], check=True, capture_output=True,
                                  text=True).stderr
    java_version = re.search(r'java\.runtime\.version = (\S+)', java_version).group(1)
    import uharfbuzz
    holdout = (HERE / 'holdout.json').read_bytes()
    manifest = {
        'version': VERSION,
        'producers': {
            'prawn': installed['prawn'], 'prawn-table': installed['prawn-table'], 'pdf-core': installed['pdf-core'],
            'ttfunk': installed['ttfunk'], 'caxlsx': installed['caxlsx'], 'ruby': ruby_version,
            'fastexcel': jars['fastexcel'], 'opczip': jars['opczip'], 'java': java_version,
            'cairo': render_cairo.version(), 'harfbuzz': uharfbuzz.version_string(),
            'uharfbuzz': python_package('uharfbuzz'), 'python-bidi': python_package('python-bidi'),
            'fonttools': python_package('fonttools'),
            'cashbookCsv': 'Python csv, UTF-8, CRLF',
        },
        'fonts': {name: built[name] for name in sorted(built)},
        'holdout': {'file': 'holdout.json', 'sha256': sha(holdout)},
        'facts': {'file': 'stories.json', 'stored': False,
                  'recipe': 'python3 -B audit/bank-statement-holdout-g17/stories.py',
                  'sha256': sha(facts.encode('utf-8')), 'bytes': len(facts.encode('utf-8'))},
        'files': [{'file': p.name, 'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
                  for p in sorted(written, key=lambda p: p.name)],
    }
    (out / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(manifest['files']), 'producers': manifest['producers']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
