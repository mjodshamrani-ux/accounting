"""Renders the G9 holdout into its frozen assets and writes the seal.

Statements are laid out by WeasyPrint or by MuPDF as each story says.
Cashbooks are CSV (UTF-8, CRLF); N02's also as a typed XLSX from SheetJS and
N10's as a typed XLSX from openpyxl, dates and amounts as numbers in both.
The committed files under frozen/ are the assets, sealed by
INPUT-MANIFEST.json; this file is their recipe. The facts are not stored:
`python3 -B stories.py` regenerates them byte for byte, and the seal carries
their hash, the producers, the font files and the eligibility declared in
holdout.json.

No font is a system font. fonts.py builds them from Fontsource npm packages
unpacked under --fontsource; SheetJS is the npm package xlsx 0.18.5 unpacked
at --sheetjs and run by Node. The tarballs' hashes are in README.ar.md, the
built fonts' in the seal.

  PYTHONPATH=<weasyprint, pymupdf, pillow, fonttools, openpyxl> \\
    python3 -B render.py --fontsource <dir> --sheetjs <xlsx package dir> [--out dir] [--work dir]
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
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fonts  # noqa: E402
import render_mupdf  # noqa: E402
import render_weasy  # noqa: E402
from common import CASHBOOK_HEADERS, cashbook_csv  # noqa: E402
from stories import VERSION, build, facts_json  # noqa: E402

STAMP = (2026, 10, 23, 0, 0, 0)
EPOCH = 1792713600  # 2026-10-23T00:00:00Z


def sha(b):
    return hashlib.sha256(b).hexdigest()


def sheetjs_xlsx(story, path, sheetjs, work):
    data = work / f"{story['id']}-cashbook.json"
    data.write_text(json.dumps({'headers': CASHBOOK_HEADERS, 'entries': story['cashbook']}, ensure_ascii=False),
                    encoding='utf-8')
    subprocess.run(['node', str(HERE / 'render_sheetjs.mjs'), str(sheetjs), str(data), str(path)], check=True)


def openpyxl_xlsx(story, path):
    """Dates as dates and amounts as numbers: a whole riyal as an integer,
    any other amount as the float that prints it."""
    from openpyxl import Workbook
    book = Workbook()
    sheet = book.active
    sheet.title = 'Cashbook'
    sheet.append(CASHBOOK_HEADERS)
    for e in story['cashbook']:
        amounts = [None if not m else m // 100 if m % 100 == 0 else m / 100 for m in (e['receipt'], e['payment'])]
        sheet.append([date.fromisoformat(e['date']), e['voucher'], e['description'], e['reference'] or None, *amounts])
    for row in sheet.iter_rows(min_row=2):
        row[0].number_format = 'yyyy-mm-dd'
        for cell in row[4:6]:
            cell.number_format = '#,##0.00'
    book.properties.created = datetime(*STAMP)
    book.save(str(path))
    # openpyxl dates each zip entry, and the workbook's modified property, by
    # the clock when it saves; the same entries are rewritten with the fixed
    # date so that the same facts give the same bytes.
    with zipfile.ZipFile(path) as z:
        entries = [(i, z.read(i.filename)) for i in z.infolist()]
    with zipfile.ZipFile(path, 'w') as z:
        for info, data in entries:
            if info.filename == 'docProps/core.xml':
                data = re.sub(rb'(<dcterms:modified[^>]*>)[^<]*', rb'\g<1>2026-10-23T00:00:00Z', data)
            fixed = zipfile.ZipInfo(info.filename, STAMP)
            fixed.compress_type = info.compress_type
            fixed.external_attr = info.external_attr
            z.writestr(fixed, data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(HERE / 'frozen'))
    parser.add_argument('--work', default=None)
    parser.add_argument('--fontsource', required=True)
    parser.add_argument('--sheetjs', required=True)
    args = parser.parse_args()
    # fontTools, which WeasyPrint's font subsets pass through, stamps each
    # font with this date instead of the clock.
    os.environ['SOURCE_DATE_EPOCH'] = str(EPOCH)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stories = build()
    facts = facts_json(stories)
    written = []
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(args.work or tmp)
        work.mkdir(parents=True, exist_ok=True)
        built = fonts.build(args.fontsource, work / 'fonts')
        for s in stories:
            path = out / f"{s['id']}-cashbook.csv"
            path.write_bytes(cashbook_csv(s).encode('utf-8'))
            written.append(path)
            if s.get('cashbookXlsx'):
                path = out / f"{s['id']}-cashbook.xlsx"
                if s['producer'] == 'weasyprint':
                    sheetjs_xlsx(s, path, args.sheetjs, work)
                else:
                    openpyxl_xlsx(s, path)
                written.append(path)
        written += render_weasy.render(stories, out, work / 'fonts')
        written += render_mupdf.render(stories, out, work / 'fonts', work)
    from importlib.metadata import version as installed
    sheetjs = json.loads((Path(args.sheetjs) / 'package.json').read_text(encoding='utf-8'))
    node = subprocess.run(['node', '--version'], check=True, capture_output=True, text=True).stdout.strip()
    used = {f"{render_weasy.FILES[s['font']]}-{w}.ttf" if s['producer'] == 'weasyprint'
            else f"{render_mupdf.FILES[s['font']]}-nl-{w}.ttf" for s in stories for w in fonts.WEIGHTS}
    holdout = (HERE / 'holdout.json').read_bytes()
    manifest = {
        'version': VERSION,
        'producers': {
            **render_weasy.version(),
            **render_mupdf.version(),
            'sheetjs': f"{sheetjs['name']} {sheetjs['version']}, Node {node}",
            'openpyxl': installed('openpyxl'),
            'fonttools': installed('fonttools'),
            'cashbookCsv': 'Python csv, UTF-8, CRLF',
        },
        'fonts': {name: built[name] for name in sorted(used)},
        'holdout': {'file': 'holdout.json', 'sha256': sha(holdout)},
        'facts': {'file': 'stories.json', 'stored': False,
                  'recipe': 'python3 -B audit/bank-statement-holdout-g9/stories.py',
                  'sha256': sha(facts.encode('utf-8')), 'bytes': len(facts.encode('utf-8'))},
        'files': [{'file': p.name, 'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
                  for p in sorted(written, key=lambda p: p.name)],
    }
    (out / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(manifest['files']), 'producers': manifest['producers']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
