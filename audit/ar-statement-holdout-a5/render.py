"""Print the A5 holdout: the statements with LibreOffice Writer and iText
Core, the ledgers as CSV in the ar-limited-1 family, and the facts, into one
folder. Neither writer is ReportLab, the foundation's only writer.

  python3 -B audit/ar-statement-holdout-a5/render.py <out dir> --java <built java dir>

The Java program is built outside the repository from java/pom.xml (see
README.ar.md). The PDFs carry their writers' dates and identifiers, so a
second render is not byte for byte the first: the sealed files are the
evidence, and verify.py reads them back.
"""
import argparse
import csv
import io
import json
import subprocess
import sys
from pathlib import Path

import render_itext
import render_libreoffice

HERE = Path(__file__).resolve().parent
LEDGER = ['Posting ID', 'Document type', 'Own document number', 'Posting date',
          'Original signed amount', 'Entity', 'Ledger', 'Customer', 'Account', 'Currency',
          'Related invoice', 'Description']


def facts():
    out = subprocess.run([sys.executable, '-B', str(HERE / 'stories.py')], check=True,
                         capture_output=True, text=True).stdout
    return json.loads(out)


def ledger_csv(rows):
    buffer = io.StringIO()
    w = csv.writer(buffer, lineterminator='\r\n')
    w.writerow(LEDGER)
    for r in rows:
        w.writerow([r[k] for k in LEDGER])
    return buffer.getvalue().encode('utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--java', required=True, help='the built java/ folder (target/classes and target/lib)')
    ap.add_argument('--work', help='where the writers\' inputs go (default <out>/../a5-work)')
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    work = Path(a.work) if a.work else out.parent / 'a5-work'
    data = facts()
    (out / 'stories.json').write_text(
        json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    for story in data['stories']:
        (out / f"{story['id']}-ledger.csv").write_bytes(ledger_csv(story['ledger']))
    drawn = render_libreoffice.render(data['stories'], work / 'libreoffice', out)
    drawn += render_itext.render(data['stories'], work / 'itext', out, Path(a.java))
    print(json.dumps({'stories': len(data['stories']), 'drawn': len(drawn),
                      'libreoffice': render_libreoffice.version(), 'itext': render_itext.VERSION}))


if __name__ == '__main__':
    main()
