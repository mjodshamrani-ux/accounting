"""Renders the G6 holdout into its frozen assets and writes the seal.

Statements are printed by LibreOffice Writer or ReportLab as each story
says; cashbooks are CSV (UTF-8, CRLF), and XLSX from LibreOffice Calc where
a story asks. PDF and XLSX bytes carry their producer's dates, so a re-render
is not byte-equal: the committed files under frozen/ are the assets, sealed by
INPUT-MANIFEST.json, and this file is their recipe. The facts are not stored:
`python3 -B stories.py` regenerates them byte for byte, and the seal carries
their hash, the producers and the eligibility declared in holdout.json.

  PYTHONPATH=<reportlab, arabic-reshaper, python-bidi> python3 -B render.py [--out dir] [--work dir]
"""
import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import render_libreoffice  # noqa: E402
import render_reportlab  # noqa: E402
from common import cashbook_csv  # noqa: E402
from stories import VERSION, build, facts_json  # noqa: E402


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(HERE / 'frozen'))
    parser.add_argument('--work', default=None)
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stories = build()
    facts = facts_json(stories)
    written = []
    for s in stories:
        path = out / f"{s['id']}-cashbook.csv"
        path.write_bytes(cashbook_csv(s).encode('utf-8'))
        written.append(path)
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(args.work or tmp)
        written += render_libreoffice.render(stories, out, work)
    written += render_reportlab.render(stories, out)
    holdout = (HERE / 'holdout.json').read_bytes()
    manifest = {
        'version': VERSION,
        'producers': {
            'libreoffice': render_libreoffice.version(),
            **render_reportlab.version(),
            'cashbookCsv': 'Python csv, UTF-8, CRLF',
        },
        'holdout': {'file': 'holdout.json', 'sha256': sha(holdout)},
        'facts': {'file': 'stories.json', 'stored': False,
                  'recipe': 'python3 -B audit/bank-statement-holdout-g6/stories.py',
                  'sha256': sha(facts.encode('utf-8')), 'bytes': len(facts.encode('utf-8'))},
        'files': [{'file': p.name, 'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
                  for p in sorted(written, key=lambda p: p.name)],
    }
    (out / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(manifest['files']), 'producers': manifest['producers']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
