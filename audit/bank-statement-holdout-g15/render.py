"""Renders the G15 holdout into its frozen assets and writes the seal.

Statements are written by Dompdf or by go-pdf/fpdf as each story says.
Cashbooks are CSV (UTF-8, CRLF); T03's also as a typed XLSX and T10's as a
text XLSX, both from excelize. The committed files under frozen/ are the
assets, sealed by INPUT-MANIFEST.json; this file is their recipe. The facts
are not stored: `python3 -B stories.py` regenerates them byte for byte, and
the seal carries their hash, the writers, the font files and the eligibility
declared in holdout.json.

The PHP writer (php/render_dompdf.php) runs against the packages Composer
installs from php/composer.lock; the Go writer (go/) against the modules Go
fetches by go/go.sum, with the local toolchain; the fonts are built
(fonts.py) from the Fontsource packages npm installs from
js/package-lock.json; all outside the repository. A statement whose pages
differ in number from the facts' is an error here. Dompdf's dates are fixed
by the writer and go-pdf/fpdf's by the application, so their bytes need no
fixing; each XLSX's zip entries are dated afterwards (settle_xlsx).

  cp php/composer.json php/composer.lock <php dir>
  composer install --no-plugins --no-scripts --working-dir <php dir>
  cp js/package.json js/package-lock.json <js dir> && npm ci --prefix <js dir> --ignore-scripts
  PYTHONPATH=<pymupdf, fonttools> python3 -B render.py --vendor <php dir>/vendor \\
    --modules <js dir>/node_modules [--out dir] [--work dir]
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
import render_dompdf  # noqa: E402
import render_gofpdf  # noqa: E402
from common import CASHBOOK_HEADERS, cashbook_csv  # noqa: E402
from stories import VERSION, build, facts_json  # noqa: E402

STAMP = (2027, 1, 31, 12, 0, 0)
GO = dict(os.environ, GOTOOLCHAIN='local', GOFLAGS='-mod=readonly')


def sha(b):
    return hashlib.sha256(b).hexdigest()


def go(*args):
    subprocess.run(['go', 'run', '.', *map(str, args)], cwd=HERE / 'go', env=GO, check=True)


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
    """Each zip entry rewritten with the fixed date."""
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


def go_modules():
    """The Go modules the writer requires, by path, with their versions."""
    text = (HERE / 'go' / 'go.mod').read_text(encoding='utf-8')
    return dict(re.findall(r'^\s+(\S+) (v\S+)$', text, re.M))


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
        go('cashbooks', work / 'cashbooks.json')
        for s in stories:
            if s.get('cashbookXlsx'):
                path = out / f"{s['id']}-cashbook.xlsx"
                settle_xlsx(path)
                written.append(path)
        drawn = render_dompdf.prepare(stories, work / 'dompdf', work / 'fonts', out)
        subprocess.run(['php', str(HERE / 'php' / 'render_dompdf.php'), str(vendor),
                        str(work / 'dompdf' / 'statements.json')], check=True)
        drawn += render_gofpdf.prepare(stories, work / 'gofpdf', work / 'fonts', out)
        go('statements', work / 'gofpdf' / 'statements.json')
        for s, path in drawn:
            if page_count(path) != len(s['statement']['pages']):
                raise ValueError(f"{s['id']}: {page_count(path)} pages drawn for {len(s['statement']['pages'])}")
            written.append(path)
        if len(drawn) != len(stories):
            raise ValueError('a story has no writer')
    php_version = subprocess.run(['php', '-r', 'echo PHP_VERSION;'], check=True, capture_output=True,
                                 text=True).stdout.strip()
    go_version = subprocess.run(['go', 'env', 'GOVERSION'], env=GO, check=True, capture_output=True,
                                text=True).stdout.strip()
    from importlib.metadata import version as python_package
    holdout = (HERE / 'holdout.json').read_bytes()
    packages, modules_used = installed_php(vendor), go_modules()
    manifest = {
        'version': VERSION,
        'producers': {
            'dompdf': packages['dompdf/dompdf'],
            'php-font-lib': packages['dompdf/php-font-lib'],
            'go-pdf/fpdf': modules_used['github.com/go-pdf/fpdf'],
            'golang.org/x/text': modules_used['golang.org/x/text'],
            'excelize': modules_used['github.com/xuri/excelize/v2'],
            'php': php_version,
            'go': go_version,
            'fonttools': python_package('fonttools'),
            'cashbookCsv': 'Python csv, UTF-8, CRLF',
        },
        'fonts': {name: built[name] for name in sorted(built)},
        'holdout': {'file': 'holdout.json', 'sha256': sha(holdout)},
        'facts': {'file': 'stories.json', 'stored': False,
                  'recipe': 'python3 -B audit/bank-statement-holdout-g15/stories.py',
                  'sha256': sha(facts.encode('utf-8')), 'bytes': len(facts.encode('utf-8'))},
        'files': [{'file': p.name, 'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
                  for p in sorted(written, key=lambda p: p.name)],
    }
    (out / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(manifest['files']), 'producers': manifest['producers']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
