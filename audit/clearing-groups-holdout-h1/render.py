"""Write the CLR-1 H1 extracts into frozen/, each with its own writer: PHP's
fputcsv (render.php), a Java writer with CRLF (Render.java), Go's
encoding/csv with UseCRLF and the story's separator (render.go), a Perl
writer with a byte-order mark and carriage returns alone (render.pl),
LibreOffice Calc's CSV export of a flat ODS spreadsheet holding every cell as
text, every text cell quoted (calc), and LibreOffice Calc's XLSX export of a
flat ODS spreadsheet with the story's hidden rows and formulas (lo-xlsx).
Each story's file name, reading and scope go to <story>-input.json.

  python3 -B audit/clearing-groups-holdout-h1/stories.py > frozen/stories.json
  python3 -B audit/clearing-groups-holdout-h1/render.py frozen
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

HERE = Path(__file__).resolve().parent
# Field separator, text delimiter, UTF-8, first line, column formats,
# language, quote every text cell, then the export defaults.
CSV_FILTER = 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,true,true'
XLSX_FILTER = 'xlsx:Calc MS Excel 2007 XML'


def fods(cells, hidden=(), formulas=()):
    """A flat ODS spreadsheet holding every cell as text; a hidden row is
    collapsed and a formula cell keeps its text as the cached value."""
    formula = {(r, c): f for r, c, f in formulas}
    rows = []
    for r, row in enumerate(cells, start=1):
        out = []
        for c, v in enumerate(row, start=1):
            paras = ''.join(f'<text:p>{escape(p)}</text:p>' for p in v.split('\n'))
            if (r, c) in formula:
                out.append(f'<table:table-cell table:formula={quoteattr("of:" + formula[(r, c)])} '
                           f'office:value-type="string" office:string-value={quoteattr(v)}>{paras}'
                           '</table:table-cell>')
            else:
                out.append(f'<table:table-cell office:value-type="string">{paras}</table:table-cell>'
                           if v else '<table:table-cell/>')
        visibility = ' table:visibility="collapse"' if r in hidden else ''
        rows.append(f'<table:table-row{visibility}>' + ''.join(out) + '</table:table-row>')
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
            'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
            'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
            'xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" '
            'office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">'
            '<office:body><office:spreadsheet><table:table table:name="Sheet1">'
            + ''.join(rows) + '</table:table></office:spreadsheet></office:body></office:document>\n')


def libreoffice(jobs, flt, suffix):
    if not jobs:
        return
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for i, j in enumerate(jobs):
            (tmp / f'f{i:03d}.fods').write_text(fods(j['cells'], j.get('hidden', ()), j.get('formulas', ())),
                                                encoding='utf-8')
        subprocess.run(['soffice', f'-env:UserInstallation=file://{tmp}/profile', '--headless',
                        '--convert-to', flt, '--outdir', str(tmp / 'out'),
                        *sorted(str(p) for p in tmp.glob('*.fods'))],
                       check=True, capture_output=True)
        for i, j in enumerate(jobs):
            shutil.copy(tmp / 'out' / f'f{i:03d}.{suffix}', j['path'])


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
    jobs = {w: [] for w in ('php', 'java', 'go', 'perl', 'calc', 'lo-xlsx')}
    for s in facts['stories']:
        (folder / f"{s['id']}-input.json").write_text(json.dumps(
            {'name': s['name'], 'reading': s['reading'], 'scope': s['scope']}, ensure_ascii=False, indent=1) + '\n',
            encoding='utf-8')
        jobs[s['writer']].append({'path': str(folder / s['name']), 'cells': s['cells'], 'comma': s['comma'],
                                  'hidden': s['hidden'], 'formulas': s['formulas']})
    subprocess.run(['php', str(HERE / 'render.php')], input=json.dumps(jobs['php']).encode(), check=True)
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['javac', '-d', tmp, str(HERE / 'Render.java')], check=True)
        subprocess.run(['java', '-cp', tmp, 'Render'], input=framed(jobs['java']), check=True)
    subprocess.run(['go', 'run', str(HERE / 'render.go')], input=json.dumps(jobs['go']).encode(), check=True)
    subprocess.run(['perl', str(HERE / 'render.pl')], input=framed(jobs['perl']), check=True)
    libreoffice(jobs['calc'], CSV_FILTER, 'csv')
    libreoffice(jobs['lo-xlsx'], XLSX_FILTER, 'xlsx')


if __name__ == '__main__':
    main(sys.argv[1])
