"""Write the INV-3 H1 registers, mappings, policy evidence and GL summaries
into frozen/, each file with its own writer: PHP's fputcsv (render.php), a
Java writer with CRLF (Render.java), Go's encoding/csv with UseCRLF
(render.go), a Perl writer with a byte-order mark and carriage returns alone
(render.pl), and LibreOffice Calc's CSV export of a flat ODS spreadsheet
holding every cell as text, every text cell quoted. Each story's confirmed
scope goes to <story>-scope.json.

  python3 -B audit/inventory-links-holdout-h1/stories.py > frozen/stories.json
  python3 -B audit/inventory-links-holdout-h1/render.py frozen
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
# Field separator, text delimiter, UTF-8, first line, column formats,
# language, quote every text cell, then the export defaults.
LO_FILTER = 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,true,true'


def fods(cells):
    """A flat ODS spreadsheet holding every cell as text; a line break in a
    cell is a second paragraph, as Calc stores it."""
    rows = []
    for row in cells:
        out = []
        for v in row:
            paras = ''.join(f'<text:p>{escape(p)}</text:p>' for p in v.split('\n'))
            out.append(f'<table:table-cell office:value-type="string">{paras}</table:table-cell>'
                       if v else '<table:table-cell/>')
        rows.append('<table:table-row>' + ''.join(out) + '</table:table-row>')
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
            'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
            'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
            'office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">'
            '<office:body><office:spreadsheet><table:table table:name="Sheet1">'
            + ''.join(rows) + '</table:table></office:spreadsheet></office:body></office:document>\n')


def libreoffice(jobs):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for i, j in enumerate(jobs):
            (tmp / f'f{i:03d}.fods').write_text(fods(j['cells']), encoding='utf-8')
        subprocess.run(['soffice', f'-env:UserInstallation=file://{tmp}/profile', '--headless',
                        '--convert-to', LO_FILTER, '--outdir', str(tmp / 'out'),
                        *sorted(str(p) for p in tmp.glob('*.fods'))],
                       check=True, capture_output=True)
        for i, j in enumerate(jobs):
            shutil.copy(tmp / 'out' / f'f{i:03d}.csv', j['path'])


def framed(jobs):
    """Tab-separated, backslash-escaped lines for the Java and Perl writers."""
    def esc(v):
        return v.replace('\\', '\\\\').replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
    out = []
    for j in jobs:
        out.append('FILE\t' + esc(j['path']))
        out += ['ROW\t' + '\t'.join(esc(v) for v in row) if row else 'ROW' for row in j['cells']]
    return ('\n'.join(out) + '\n').encode('utf-8')


def main(folder):
    folder = Path(folder).resolve()
    facts = json.loads((folder / 'stories.json').read_text(encoding='utf-8'))
    jobs = {w: [] for w in ('php', 'java', 'go', 'perl', 'calc')}
    for story in facts['stories']:
        (folder / f"{story['id']}-scope.json").write_text(
            json.dumps(story['scope'], ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        for f in story['files'].values():
            jobs[f['writer']].append({'path': str(folder / f['name']), 'cells': f['cells']})
    subprocess.run(['php', str(HERE / 'render.php')], input=json.dumps(jobs['php']).encode(), check=True)
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['javac', '-d', tmp, str(HERE / 'Render.java')], check=True)
        subprocess.run(['java', '-cp', tmp, 'Render'], input=framed(jobs['java']), check=True)
    subprocess.run(['go', 'run', str(HERE / 'render.go')], input=json.dumps(jobs['go']).encode(), check=True)
    subprocess.run(['perl', str(HERE / 'render.pl')], input=framed(jobs['perl']), check=True)
    libreoffice(jobs['calc'])


if __name__ == '__main__':
    main(sys.argv[1])
