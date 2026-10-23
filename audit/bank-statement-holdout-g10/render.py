"""Renders the G10 holdout into its frozen assets and writes the seal.

Statements are laid out by Apache FOP from XSL-FO or drawn by OpenPDF as
each story says. Cashbooks are CSV (UTF-8, CRLF); P04's also as a typed XLSX
and P08's as a text XLSX, both from Apache POI. The committed files under
frozen/ are the assets, sealed by INPUT-MANIFEST.json; this file is their
recipe. The facts are not stored: `python3 -B stories.py` regenerates them
byte for byte, and the seal carries their hash, the producers, the font
files and the eligibility declared in holdout.json.

The Java writers (java/*.java) are compiled here against the classpath
Maven resolves from java/pom.xml; fonts.py builds the fonts from Fontsource
packages unpacked under --fontsource. A statement whose pages differ in
number from the facts' is an error here. The writers' clock stamps are
fixed afterwards (settle.py, settle_xlsx).

  mvn -q -f java/pom.xml dependency:build-classpath -Dmdep.outputFile=<classpath file>
  PYTHONPATH=<pymupdf, fonttools> \\
    python3 -B render.py --fontsource <dir> --classpath <file> [--out dir] [--work dir]
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
from xml.sax.saxutils import quoteattr

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fonts  # noqa: E402
import render_fop  # noqa: E402
import render_openpdf  # noqa: E402
from settle import settle  # noqa: E402
from common import CASHBOOK_HEADERS, cashbook_csv  # noqa: E402
from stories import VERSION, build, facts_json  # noqa: E402

STAMP = (2026, 10, 23, 0, 0, 0)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def java(classpath, classes, main, *args):
    subprocess.run(['java', '-cp', f'{classpath}:{classes}', main, *map(str, args)], check=True)


def page_count(path):
    import pymupdf
    with pymupdf.open(str(path)) as doc:
        return doc.page_count


def cashbooks_xml(stories, out):
    books = []
    for s in stories:
        if not s.get('cashbookXlsx'):
            continue
        entries = ''.join(
            '<entry ' + ' '.join(f'{k}={quoteattr(str(e[k]) if e[k] else "")}'
                                 for k in ('date', 'voucher', 'description', 'reference', 'receipt', 'payment'))
            + '/>' for e in s['cashbook'])
        books.append(f'<cashbook out={quoteattr(str(out / (s["id"] + "-cashbook.xlsx")))} '
                     f'kind="{s["cashbookXlsx"]}" headers={quoteattr("|".join(CASHBOOK_HEADERS))}>{entries}</cashbook>')
    return '<?xml version="1.0" encoding="UTF-8"?>\n<cashbooks>' + ''.join(books) + '</cashbooks>\n'


def settle_xlsx(path):
    """POI dates each zip entry and the workbook's modified property by the
    clock; the same entries are rewritten with the fixed date."""
    with zipfile.ZipFile(path) as z:
        entries = [(i, z.read(i.filename)) for i in z.infolist()]
    with zipfile.ZipFile(path, 'w') as z:
        for info, data in entries:
            if info.filename == 'docProps/core.xml':
                data = re.sub(rb'(<dcterms:modified[^>]*>)[^<]*', rb'\g<1>2026-10-23T00:00:00Z', data)
            fixed = zipfile.ZipInfo(info.filename, STAMP)
            fixed.compress_type = zipfile.ZIP_DEFLATED
            fixed.external_attr = info.external_attr
            z.writestr(fixed, data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(HERE / 'frozen'))
    parser.add_argument('--work', default=None)
    parser.add_argument('--fontsource', required=True)
    parser.add_argument('--classpath', required=True)
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    classpath = Path(args.classpath).read_text(encoding='utf-8').strip()
    stories = build()
    facts = facts_json(stories)
    written = []
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(args.work or tmp).resolve()
        work.mkdir(parents=True, exist_ok=True)
        built = fonts.build(args.fontsource, work / 'fonts')
        classes = work / 'classes'
        classes.mkdir(exist_ok=True)
        subprocess.run(['javac', '-encoding', 'UTF-8', '-cp', classpath, '-d', str(classes),
                        *sorted(str(p) for p in (HERE / 'java').glob('*.java'))], check=True)
        for s in stories:
            path = out / f"{s['id']}-cashbook.csv"
            path.write_bytes(cashbook_csv(s).encode('utf-8'))
            written.append(path)
        (work / 'cashbooks.xml').write_text(cashbooks_xml(stories, out), encoding='utf-8')
        java(classpath, classes, 'PoiCashbooks', work / 'cashbooks.xml')
        for s in stories:
            if s.get('cashbookXlsx'):
                path = out / f"{s['id']}-cashbook.xlsx"
                settle_xlsx(path)
                written.append(path)
        jobs = render_fop.prepare(stories, work / 'fo', work / 'fonts')
        java(classpath, classes, 'FopStatements', work / 'fo' / 'fop.xconf',
             *[x for s, fo in jobs for x in (fo, out / f"{s['id']}-statement.pdf")])
        for s, _ in jobs:
            settle(out / f"{s['id']}-statement.pdf")
            written.append(out / f"{s['id']}-statement.pdf")
        drawn = render_openpdf.prepare(stories, work / 'openpdf', work / 'fonts', out)
        java(classpath, classes, 'OpenPdfStatements', work / 'openpdf' / 'statements.xml')
        for _, path in drawn:
            settle(path, prefixes=True)
            written.append(path)
        for s in stories:
            pdf = out / f"{s['id']}-statement.pdf"
            if page_count(pdf) != len(s['statement']['pages']):
                raise ValueError(f"{s['id']}: {page_count(pdf)} pages laid out for {len(s['statement']['pages'])}")
    jars = {Path(j).name for j in classpath.split(':')}

    def jar(prefix):
        return next(j[len(prefix):-4] for j in jars if re.fullmatch(re.escape(prefix) + r'[\d.]+\.jar', j))
    used = set()
    for s in stories:
        if s['font'] in render_fop.FILES and s['producer'] == 'fop':
            used |= {f"{render_fop.FILES[s['font']]}-nl-{w}.ttf" for w in fonts.WEIGHTS}
        elif s['font'] in render_openpdf.FILES and s['producer'] == 'openpdf':
            used.add(render_openpdf.FILES[s['font']])
    font_record = {name: built[name] for name in sorted(used)}
    font_record['DejaVuSans.ttf'] = {'source': render_openpdf.DEJAVU, 'recipe': 'system font, as installed',
                                     'sha256': sha(Path(render_openpdf.DEJAVU).read_bytes())}
    font_record['Helvetica, Courier'] = {'source': 'PDF standard fonts', 'recipe': 'not embedded'}
    runtime = subprocess.run(['java', '-version'], check=True, capture_output=True, text=True).stderr
    from importlib.metadata import version as installed
    holdout = (HERE / 'holdout.json').read_bytes()
    manifest = {
        'version': VERSION,
        'producers': {
            'fop': jar('fop-core-'),
            'openpdf': jar('openpdf-'),
            'poi': jar('poi-ooxml-'),
            'java': next(line for line in runtime.splitlines() if 'version' in line),
            'fonttools': installed('fonttools'),
            'cashbookCsv': 'Python csv, UTF-8, CRLF',
        },
        'fonts': font_record,
        'holdout': {'file': 'holdout.json', 'sha256': sha(holdout)},
        'facts': {'file': 'stories.json', 'stored': False,
                  'recipe': 'python3 -B audit/bank-statement-holdout-g10/stories.py',
                  'sha256': sha(facts.encode('utf-8')), 'bytes': len(facts.encode('utf-8'))},
        'files': [{'file': p.name, 'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
                  for p in sorted(written, key=lambda p: p.name)],
    }
    (out / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(manifest['files']), 'producers': manifest['producers']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
