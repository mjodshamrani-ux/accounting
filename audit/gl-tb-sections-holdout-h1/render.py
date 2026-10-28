"""Write the GLT-1 H1 story files into frozen/ with each story's writer: Go
(render.go), PHP (render.php), LibreOffice Calc's CSV export (a flat ODS
spreadsheet with every cell as text, converted by soffice; Calc pads every row
to the sheet's widest) and Java (Render.java). Each story's confirmed run
scope goes to <story>-scope.json.

  python3 -B audit/gl-tb-sections-holdout-h1/stories.py > frozen/stories.json
  python3 -B audit/gl-tb-sections-holdout-h1/render.py frozen
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


def libreoffice(files):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for f in files:
            (tmp / (Path(f['path']).stem + '.fods')).write_text(fods(f['cells']), encoding='utf-8')
        subprocess.run(['soffice', f'-env:UserInstallation=file://{tmp}/profile', '--headless',
                        '--convert-to', LO_FILTER, '--outdir', str(tmp / 'out'),
                        *sorted(str(p) for p in tmp.glob('*.fods'))],
                       check=True, capture_output=True)
        for f in files:
            shutil.copy(tmp / 'out' / (Path(f['path']).stem + '.csv'), f['path'])


def main(folder):
    folder = Path(folder)
    facts = json.loads((folder / 'stories.json').read_text(encoding='utf-8'))
    by = {}
    for story in facts['stories']:
        (folder / f"{story['id']}-scope.json").write_text(
            json.dumps(story['runScope'], ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        for f in story['files']:
            by.setdefault(f['writer'], []).append({'path': str(folder / f['name']), 'cells': f['cells']})
    run = lambda cmd, items, cwd=None: subprocess.run(  # noqa: E731
        cmd, input=json.dumps(items).encode(), check=True, cwd=cwd)
    run(['go', 'run', str(HERE / 'render.go')], by.get('go', []))
    run(['php', str(HERE / 'render.php')], by.get('php', []))
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['javac', '-d', tmp, str(HERE / 'Render.java')], check=True)
        run(['java', '-cp', tmp, 'Render'], by.get('java', []))
    libreoffice(by.get('libreoffice', []))


if __name__ == '__main__':
    main(sys.argv[1])
