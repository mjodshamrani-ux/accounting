"""Renders the G12 holdout into its frozen assets and writes the seal.

Statements are drawn by Apache PDFBox or by jsPDF with autoTable as each
story says. Cashbooks are CSV (UTF-8, CRLF); Q03's also as a typed XLSX and
Q09's as a text XLSX, both from ExcelJS. The committed files under frozen/
are the assets, sealed by INPUT-MANIFEST.json; this file is their recipe.
The facts are not stored: `python3 -B stories.py` regenerates them byte for
byte, and the seal carries their hash, the producers, the font files and
the eligibility declared in holdout.json.

The Java writer (java/PdfBoxStatements.java) is compiled here against the
classpath Maven resolves from java/pom.xml. The JavaScript writers
(js/render_jspdf.mjs, js/cashbooks.mjs) and the Fontsource fonts come from
js/package.json, installed outside the repository by `npm ci`; fonts.py
builds the fonts from that installation. A statement whose pages differ in
number from the facts' is an error here. Both PDF writers are given fixed
dates and file identifiers, so their bytes need no fixing; ExcelJS dates
each zip entry by the clock, fixed afterwards (settle_xlsx).

  mvn -q -f java/pom.xml dependency:build-classpath -Dmdep.outputFile=<classpath file>
  cp js/package.json js/package-lock.json <dir> && npm ci --prefix <dir> --ignore-scripts
  PYTHONPATH=<pymupdf, fonttools> \\
    python3 -B render.py --modules <dir>/node_modules --classpath <file> [--out dir] [--work dir]
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fonts  # noqa: E402
import render_jspdf  # noqa: E402
import render_pdfbox  # noqa: E402
from common import CASHBOOK_HEADERS, cashbook_csv  # noqa: E402
from stories import VERSION, build, facts_json  # noqa: E402

STAMP = (2026, 10, 23, 0, 0, 0)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def java(classpath, classes, main, *args):
    subprocess.run(['java', '-cp', f'{classpath}:{classes}', main, *map(str, args)], check=True)


def node(script, modules, *args):
    subprocess.run(['node', str(HERE / 'js' / script), str(modules), *map(str, args)], check=True)


def page_count(path):
    import pymupdf
    with pymupdf.open(str(path)) as doc:
        return doc.page_count


def cashbooks_json(stories, out):
    books = [{'out': str(out / f"{s['id']}-cashbook.xlsx"), 'kind': s['cashbookXlsx'], 'headers': CASHBOOK_HEADERS,
              'entries': [{k: e[k] for k in ('date', 'voucher', 'description', 'reference', 'receipt', 'payment')}
                          for e in s['cashbook']]}
             for s in stories if s.get('cashbookXlsx')]
    return json.dumps({'cashbooks': books}, ensure_ascii=False, indent=1)


def settle_xlsx(path):
    """ExcelJS dates each zip entry by the clock; the same entries are
    rewritten with the fixed date."""
    with zipfile.ZipFile(path) as z:
        entries = [(i, z.read(i.filename)) for i in z.infolist()]
    with zipfile.ZipFile(path, 'w') as z:
        for info, data in entries:
            fixed = zipfile.ZipInfo(info.filename, STAMP)
            fixed.compress_type = zipfile.ZIP_DEFLATED
            fixed.external_attr = info.external_attr
            z.writestr(fixed, data)


def installed(modules, package):
    return json.loads((Path(modules) / package / 'package.json').read_text(encoding='utf-8'))['version']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(HERE / 'frozen'))
    parser.add_argument('--work', default=None)
    parser.add_argument('--modules', required=True)
    parser.add_argument('--classpath', required=True)
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    modules = Path(args.modules).resolve()
    classpath = Path(args.classpath).read_text(encoding='utf-8').strip()
    lock = json.loads((HERE / 'js' / 'package.json').read_text(encoding='utf-8'))['dependencies']
    for package, version in lock.items():
        if installed(modules, package) != version:
            raise ValueError(f'{package} {installed(modules, package)} installed, {version} expected')
    stories = build()
    facts = facts_json(stories)
    written = []
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(args.work or tmp).resolve()
        work.mkdir(parents=True, exist_ok=True)
        built = fonts.build(modules, work / 'fonts')
        classes = work / 'classes'
        classes.mkdir(exist_ok=True)
        subprocess.run(['javac', '-encoding', 'UTF-8', '-cp', classpath, '-d', str(classes),
                        *sorted(str(p) for p in (HERE / 'java').glob('*.java'))], check=True)
        for s in stories:
            path = out / f"{s['id']}-cashbook.csv"
            path.write_bytes(cashbook_csv(s).encode('utf-8'))
            written.append(path)
        (work / 'cashbooks.json').write_text(cashbooks_json(stories, out), encoding='utf-8')
        node('cashbooks.mjs', modules, work / 'cashbooks.json')
        for s in stories:
            if s.get('cashbookXlsx'):
                path = out / f"{s['id']}-cashbook.xlsx"
                settle_xlsx(path)
                written.append(path)
        drawn = render_pdfbox.prepare(stories, work / 'pdfbox', work / 'fonts', out)
        java(classpath, classes, 'PdfBoxStatements', work / 'pdfbox' / 'statements.xml')
        drawn += render_jspdf.prepare(stories, work / 'jspdf', work / 'fonts', out)
        node('render_jspdf.mjs', modules, work / 'jspdf' / 'statements.json')
        for s, path in drawn:
            if page_count(path) != len(s['statement']['pages']):
                raise ValueError(f"{s['id']}: {page_count(path)} pages drawn for {len(s['statement']['pages'])}")
            written.append(path)
        if len(drawn) != len(stories):
            raise ValueError('a story has no writer')
    jars = {Path(j).name for j in classpath.split(':')}

    def jar(prefix):
        return next(j[len(prefix):-4] for j in jars if re.fullmatch(re.escape(prefix) + r'[\d.]+\.jar', j))
    used = set()
    for s in stories:
        files = render_pdfbox.FILES if s['producer'] == 'pdfbox' else render_jspdf.FILES
        if s['font'] in files:
            used |= {f"{files[s['font']]}-{w}.ttf" for w in fonts.WEIGHTS}
    font_record = {name: built[name] for name in sorted(used)}
    font_record['Times-Roman, Times-Bold, Courier, Courier-Bold'] = {'source': 'PDF standard fonts',
                                                                     'recipe': 'not embedded'}
    runtime = subprocess.run(['java', '-version'], check=True, capture_output=True, text=True).stderr
    node_version = subprocess.run(['node', '--version'], check=True, capture_output=True, text=True).stdout.strip()
    from importlib.metadata import version as python_package
    holdout = (HERE / 'holdout.json').read_bytes()
    manifest = {
        'version': VERSION,
        'producers': {
            'pdfbox': jar('pdfbox-'),
            'icu4j': jar('icu4j-'),
            'jspdf': installed(modules, 'jspdf'),
            'jspdf-autotable': installed(modules, 'jspdf-autotable'),
            'exceljs': installed(modules, 'exceljs'),
            'java': next(line for line in runtime.splitlines() if 'version' in line),
            'node': node_version,
            'fonttools': python_package('fonttools'),
            'cashbookCsv': 'Python csv, UTF-8, CRLF',
        },
        'fonts': font_record,
        'holdout': {'file': 'holdout.json', 'sha256': sha(holdout)},
        'facts': {'file': 'stories.json', 'stored': False,
                  'recipe': 'python3 -B audit/bank-statement-holdout-g12/stories.py',
                  'sha256': sha(facts.encode('utf-8')), 'bytes': len(facts.encode('utf-8'))},
        'files': [{'file': p.name, 'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
                  for p in sorted(written, key=lambda p: p.name)],
    }
    (out / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(manifest['files']), 'producers': manifest['producers']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
