"""Renders the G14 holdout into its frozen assets and writes the seal.

Statements are written by TCPDF or by mPDF as each story says. Cashbooks are
CSV (UTF-8, CRLF); R03's also as a typed XLSX and R07's as a text XLSX, both
from PhpSpreadsheet. The committed files under frozen/ are the assets, sealed
by INPUT-MANIFEST.json; this file is their recipe. The facts are not stored:
`python3 -B stories.py` regenerates them byte for byte, and the seal carries
their hash, the writers, the font files and the eligibility declared in
holdout.json.

The PHP writers (php/render_tcpdf.php, php/render_mpdf.php,
php/cashbooks.php) run against the packages Composer installs from
php/composer.lock, and IBM Plex Sans Arabic is built (fonts.py) from the
Fontsource package npm installs from js/package-lock.json, both outside the
repository. A statement whose pages differ in number from the facts' is an
error here. TCPDF's file identifier and dates are fixed by the writer, and
mPDF's by the time its writer is given, so their bytes need no fixing;
PhpSpreadsheet dates each zip entry by the clock, fixed afterwards
(settle_xlsx).

  cp php/composer.json php/composer.lock <php dir>
  composer install --no-plugins --no-scripts --working-dir <php dir>
  cp js/package.json js/package-lock.json <js dir> && npm ci --prefix <js dir> --ignore-scripts
  PYTHONPATH=<pymupdf, fonttools> python3 -B render.py --vendor <php dir>/vendor \\
    --modules <js dir>/node_modules [--out dir] [--work dir]
"""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fonts  # noqa: E402
import render_mpdf  # noqa: E402
import render_tcpdf  # noqa: E402
from common import CASHBOOK_HEADERS, cashbook_csv  # noqa: E402
from stories import VERSION, build, facts_json  # noqa: E402

STAMP = (2027, 1, 31, 12, 0, 0)
# The writers' own fonts the statements use, in the packages Composer installs.
SHIPPED = {
    'tcpdf': ['tecnickcom/tcpdf/fonts/' + f for f in (
        'dejavusans.php', 'dejavusans.z', 'dejavusans.ctg.z', 'dejavusansb.php', 'dejavusansb.z', 'dejavusansb.ctg.z',
        'dejavusansmono.php', 'dejavusansmono.z', 'dejavusansmono.ctg.z', 'dejavusansmonob.php', 'dejavusansmonob.z',
        'dejavusansmonob.ctg.z', 'dejavuserif.php', 'dejavuserif.z', 'dejavuserif.ctg.z', 'dejavuserifb.php',
        'dejavuserifb.z', 'dejavuserifb.ctg.z')],
    'mpdf': ['mpdf/mpdf/ttfonts/' + f for f in (
        'DejaVuSans.ttf', 'DejaVuSans-Bold.ttf', 'DejaVuSansMono.ttf', 'DejaVuSansMono-Bold.ttf', 'FreeSans.ttf',
        'FreeSansBold.ttf', 'FreeSerif.ttf', 'FreeSerifBold.ttf')],
}


def sha(b):
    return hashlib.sha256(b).hexdigest()


def php(script, vendor, *args):
    subprocess.run(['php', str(HERE / 'php' / script), str(vendor), *map(str, args)], check=True)


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
    """PhpSpreadsheet dates each zip entry by the clock; the same entries are
    rewritten with the fixed date."""
    with zipfile.ZipFile(path) as z:
        entries = [(i, z.read(i.filename)) for i in z.infolist()]
    with zipfile.ZipFile(path, 'w') as z:
        for info, data in entries:
            fixed = zipfile.ZipInfo(info.filename, STAMP)
            fixed.compress_type = zipfile.ZIP_DEFLATED
            fixed.external_attr = info.external_attr
            z.writestr(fixed, data)


def installed_php(vendor):
    """Every package Composer installed, by name, with its version."""
    data = json.loads((Path(vendor) / 'composer' / 'installed.json').read_text(encoding='utf-8'))
    return {p['name']: p['version'] for p in data.get('packages', data)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(HERE / 'frozen'))
    parser.add_argument('--work', default=None)
    parser.add_argument('--vendor', required=True)
    parser.add_argument('--modules', required=True)
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    vendor, modules = Path(args.vendor).resolve(), Path(args.modules).resolve()
    lock = {p['name']: p['version'] for p in json.loads((HERE / 'php' / 'composer.lock').read_text(encoding='utf-8'))['packages']}
    if installed_php(vendor) != lock:
        raise ValueError(f'Composer packages {installed_php(vendor)} installed, {lock} locked')
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
        php('cashbooks.php', vendor, work / 'cashbooks.json')
        for s in stories:
            if s.get('cashbookXlsx'):
                path = out / f"{s['id']}-cashbook.xlsx"
                settle_xlsx(path)
                written.append(path)
        drawn = render_tcpdf.prepare(stories, work / 'tcpdf', work / 'fonts', out)
        php('render_tcpdf.php', vendor, work / 'tcpdf' / 'statements.json')
        drawn += render_mpdf.prepare(stories, work / 'mpdf', work / 'fonts', out)
        php('render_mpdf.php', vendor, work / 'mpdf' / 'statements.json')
        for s, path in drawn:
            if page_count(path) != len(s['statement']['pages']):
                raise ValueError(f"{s['id']}: {page_count(path)} pages drawn for {len(s['statement']['pages'])}")
            written.append(path)
        if len(drawn) != len(stories):
            raise ValueError('a story has no writer')
    font_record = {name: built[name] for name in sorted(built)}
    for writer, files in SHIPPED.items():
        for f in files:
            font_record[Path(f).name] = {'source': f'{f} in the Composer package', 'recipe': 'as shipped',
                                         'sha256': sha((vendor / f).read_bytes())}
    font_record['Helvetica, Helvetica-Bold'] = {'source': 'PDF standard fonts', 'recipe': 'not embedded'}
    php_version = subprocess.run(['php', '-r', 'echo PHP_VERSION;'], check=True, capture_output=True,
                                 text=True).stdout.strip()
    from importlib.metadata import version as python_package
    holdout = (HERE / 'holdout.json').read_bytes()
    packages = installed_php(vendor)
    manifest = {
        'version': VERSION,
        'producers': {
            'tcpdf': packages['tecnickcom/tcpdf'],
            'mpdf': packages['mpdf/mpdf'],
            'phpspreadsheet': packages['phpoffice/phpspreadsheet'],
            'php': php_version,
            'fonttools': python_package('fonttools'),
            'cashbookCsv': 'Python csv, UTF-8, CRLF',
        },
        'fonts': font_record,
        'holdout': {'file': 'holdout.json', 'sha256': sha(holdout)},
        'facts': {'file': 'stories.json', 'stored': False,
                  'recipe': 'python3 -B audit/bank-statement-holdout-g14/stories.py',
                  'sha256': sha(facts.encode('utf-8')), 'bytes': len(facts.encode('utf-8'))},
        'files': [{'file': p.name, 'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
                  for p in sorted(written, key=lambda p: p.name)],
    }
    (out / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(manifest['files']), 'producers': manifest['producers']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
