"""Write the FIN-1 H1 story files into frozen/<story>/ with each file's
writer: Go encoding/csv (render.go), Ruby's csv library (render.rb), a Perl
writer with carriage-return line ends (render.pl), a Rust writer that quotes
every field and can begin with a byte-order mark (render.rs), and LibreOffice
Calc's CSV export of a flat ODS spreadsheet holding every cell as text. Each
story's confirmed run scope goes to <story>/scope.json.

  python3 -B audit/fin-hierarchy-holdout-h1/stories.py > frozen/stories.json
  python3 -B audit/fin-hierarchy-holdout-h1/render.py frozen
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
        for i, f in enumerate(files):
            (tmp / f'f{i:03d}.fods').write_text(fods(f['cells']), encoding='utf-8')
        subprocess.run(['soffice', f'-env:UserInstallation=file://{tmp}/profile', '--headless',
                        '--convert-to', LO_FILTER, '--outdir', str(tmp / 'out'),
                        *sorted(str(p) for p in tmp.glob('*.fods'))],
                       check=True, capture_output=True)
        for i, f in enumerate(files):
            shutil.copy(tmp / 'out' / f'f{i:03d}.csv', f['path'])


def framed(files):
    out = bytearray()
    for f in files:
        out += f"F{f['path']}\nB{int(f['bom'])}\n{len(f['cells'])}\n".encode()
        for row in f['cells']:
            out += f'{len(row)}\n'.encode()
            for v in row:
                b = v.encode('utf-8')
                out += f'{len(b)}\n'.encode() + b
    return bytes(out)


def main(folder):
    folder = Path(folder)
    facts = json.loads((folder / 'stories.json').read_text(encoding='utf-8'))
    by = {}
    for story in facts['stories']:
        (folder / story['id']).mkdir(exist_ok=True)
        (folder / story['id'] / 'scope.json').write_text(
            json.dumps(story['runScope'], ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        for f in story['files']:
            if f['bom']:
                assert f['writer'] == 'rust', f['name']
            if any(not row for row in f['cells']):
                assert f['writer'] == 'perl', f['name']
            by.setdefault(f['writer'], []).append({'path': str(folder / f['name']), 'cells': f['cells'],
                                                   'bom': f['bom']})
    plain = lambda items: json.dumps([{k: f[k] for k in ('path', 'cells')} for f in items]).encode()  # noqa: E731
    subprocess.run(['go', 'run', str(HERE / 'render.go')], input=plain(by.get('go', [])), check=True)
    subprocess.run(['ruby', str(HERE / 'render.rb')], input=plain(by.get('ruby', [])), check=True)
    subprocess.run(['perl', str(HERE / 'render.pl')], input=plain(by.get('perl', [])), check=True)
    with tempfile.TemporaryDirectory() as tmp:
        binary = Path(tmp) / 'render'
        subprocess.run(['rustc', '-O', '-o', str(binary), str(HERE / 'render.rs')], check=True)
        subprocess.run([str(binary)], input=framed(by.get('rust', [])), check=True)
    libreoffice(by.get('libreoffice', []))


if __name__ == '__main__':
    main(sys.argv[1])
