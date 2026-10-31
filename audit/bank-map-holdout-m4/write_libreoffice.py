"""Write one M4 cashbook with LibreOffice Calc 24.2, headless.

  python3 -B write_libreoffice.py spec.json out.xlsx

The spec's sheets become a flat OpenDocument spreadsheet (strings, typed
numbers, merged cells, hidden columns), which LibreOffice converts to XLSX
with its own writer; the XLSX it writes is the cashbook, not this file.
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

HEAD = '''<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
 xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
 office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
<office:automatic-styles>
<style:style style:name="shown" style:family="table-column"><style:table-column-properties style:column-width="1in"/></style:style>
</office:automatic-styles>
<office:body><office:spreadsheet>
'''
TAIL = '</office:spreadsheet></office:body></office:document>\n'


def address(a1):
    letters = ''.join(ch for ch in a1 if ch.isalpha())
    col = 0
    for ch in letters:
        col = col * 26 + ord(ch) - 64
    return int(a1[len(letters):]), col


def sheet_xml(s):
    width = max((len(r) for r in s['rows']), default=0)
    spans, covered = {}, set()
    for m in s.get('merges', []):
        (r1, c1), (r2, c2) = (address(x) for x in m.split(':'))
        spans[(r1, c1)] = (r2 - r1 + 1, c2 - c1 + 1)
        covered |= {(r, c) for r in range(r1, r2 + 1) for c in range(c1, c2 + 1)} - {(r1, c1)}
    out = [f'<table:table table:name={quoteattr(s["name"])}>']
    hidden = set(s.get('hidden', []))
    for c in range(1, width + 1):
        vis = ' table:visibility="collapse"' if c in hidden else ''
        out.append(f'<table:table-column table:style-name="shown"{vis}/>')
    for r, row in enumerate(s['rows'], start=1):
        out.append('<table:table-row>')
        for c in range(1, width + 1):
            cell = row[c - 1] if c <= len(row) else ''
            if (r, c) in covered:
                out.append('<table:covered-table-cell/>')
                continue
            span = ''
            if (r, c) in spans:
                rows, cols = spans[(r, c)]
                span = f' table:number-rows-spanned="{rows}" table:number-columns-spanned="{cols}"'
            if isinstance(cell, dict):
                out.append(f'<table:table-cell office:value-type="float" office:value="{cell["n"]}"{span}>'
                           f'<text:p>{escape(cell["n"])}</text:p></table:table-cell>')
            elif cell != '':
                out.append(f'<table:table-cell office:value-type="string"{span}>'
                           f'<text:p>{escape(cell)}</text:p></table:table-cell>')
            else:
                out.append(f'<table:table-cell{span}/>')
        out.append('</table:table-row>')
    out.append('</table:table>')
    return '\n'.join(out)


def main():
    spec = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    out = Path(sys.argv[2])
    with tempfile.TemporaryDirectory() as work:
        work = Path(work)
        source = work / (out.stem + '.fods')
        source.write_text(HEAD + '\n'.join(sheet_xml(s) for s in spec['sheets']) + TAIL, encoding='utf-8')
        profile = work / 'profile'
        subprocess.run(['soffice', f'-env:UserInstallation=file://{profile}', '--headless', '--norestore',
                        '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', str(work), str(source)],
                       check=True, capture_output=True, timeout=180)
        shutil.copyfile(work / (out.stem + '.xlsx'), out)


if __name__ == '__main__':
    main()
