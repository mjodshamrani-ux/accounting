"""LibreOffice Writer statements and LibreOffice Calc cashbooks for G6.

Each statement is written as a flat OpenDocument text (one table per printed
page, an explicit page break before every page but the first) and exported
to PDF by LibreOffice itself (`soffice --headless --convert-to pdf`, the
default writer_pdf_Export filter: embedded font subsets, LibreOffice's own
text layout and shaping). An Arabic story sets the table and paragraphs
right to left, so LibreOffice orders the columns and shapes the text.
A cashbook marked `cashbookXlsx` is written as flat OpenDocument
spreadsheet, typed (real dates and numbers) or as text, and saved as XLSX by
LibreOffice Calc.
"""
import subprocess
from pathlib import Path
from xml.sax.saxutils import escape

from common import CASHBOOK_HEADERS, LABELS, account_line, footer, rows

NS = ('xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
      'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
      'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
      'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
      'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" '
      'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" '
      'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"')

PAPER = {'A4': ('21cm', '29.7cm', 'portrait'), 'Letter': ('21.59cm', '27.94cm', 'portrait'),
         'A4-landscape': ('29.7cm', '21cm', 'landscape')}
# Column widths in cm for the seven logical columns, per paper.
WIDTHS = {'A4': [1.9, 1.9, 6.2, 2.6, 2.2, 2.2, 2.6], 'Letter': [1.9, 1.9, 6.4, 2.6, 2.2, 2.2, 2.6],
          'A4-landscape': [2.2, 2.2, 10.0, 3.4, 2.9, 2.9, 3.4]}


def text(value):
    """Escaped paragraph content; a newline is a forced line break."""
    return '<text:line-break/>'.join(escape(part) for part in value.split('\n'))


def para(style, value=''):
    return f'<text:p text:style-name="{style}">{text(value)}</text:p>'


def cell(style, value='', span=1, para_style='Cell'):
    attrs = f' table:number-columns-spanned="{span}"' if span > 1 else ''
    covered = '<table:covered-table-cell/>' * (span - 1)
    return f'<table:table-cell table:style-name="{style}" office:value-type="string"{attrs}>{para(para_style, value)}</table:table-cell>{covered}'


def statement_fodt(story):
    rtl = story['layout'] == 'ar'
    width, height, orientation = PAPER[story['paper']]
    widths = WIDTHS[story['paper']]
    font = story['font']
    lang = ('style:language-complex="ar" style:country-complex="SA"' if rtl else 'fo:language="en" fo:country="US"')
    mode = 'style:writing-mode="rl-tb"' if rtl else 'style:writing-mode="lr-tb"'
    # Writer reads fo:text-align="start" as left even in a right-to-left
    # paragraph, so the sides are named explicitly.
    start, end = ('right', 'left') if rtl else ('left', 'right')
    L = LABELS[story['layout']]
    columns = ''.join(f'<style:style style:name="C{i}" style:family="table-column"><style:table-column-properties '
                      f'style:column-width="{w}cm"/></style:style>' for i, w in enumerate(widths))
    styles = f'''<office:font-face-decls><style:font-face style:name="Main" svg:font-family="'{font}'"/></office:font-face-decls>
<office:styles><style:default-style style:family="paragraph"><style:paragraph-properties {mode}/>
<style:text-properties style:font-name="Main" fo:font-size="8pt" style:font-name-complex="Main" style:font-size-complex="8pt" {lang}/></style:default-style></office:styles>
<office:automatic-styles>
<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="{width}" fo:page-height="{height}" style:print-orientation="{orientation}" fo:margin-top="1.3cm" fo:margin-bottom="1.3cm" fo:margin-left="1.2cm" fo:margin-right="1.2cm" {mode}/></style:page-layout>
<style:style style:name="Bank" style:family="paragraph"><style:paragraph-properties fo:text-align="{start}" {mode}/><style:text-properties fo:font-size="12pt" fo:font-weight="bold" style:font-size-complex="12pt" style:font-weight-complex="bold"/></style:style>
<style:style style:name="BankBreak" style:family="paragraph"><style:paragraph-properties fo:break-before="page" fo:text-align="{start}" {mode}/><style:text-properties fo:font-size="12pt" fo:font-weight="bold" style:font-size-complex="12pt" style:font-weight-complex="bold"/></style:style>
<style:style style:name="Title" style:family="paragraph"><style:paragraph-properties fo:margin-top="0.05cm" fo:text-align="{start}" {mode}/><style:text-properties fo:font-size="10pt" style:font-size-complex="10pt"/></style:style>
<style:style style:name="Line" style:family="paragraph"><style:paragraph-properties fo:margin-top="0.05cm" fo:margin-bottom="0.25cm" fo:text-align="{start}" {mode}/></style:style>
<style:style style:name="Foot" style:family="paragraph"><style:paragraph-properties fo:margin-top="0.3cm" fo:text-align="center"/></style:style>
<style:style style:name="Cell" style:family="paragraph"><style:paragraph-properties fo:text-align="{start}" {mode}/></style:style>
<style:style style:name="Amount" style:family="paragraph"><style:paragraph-properties fo:text-align="{end}" {mode}/></style:style>
<style:style style:name="Strong" style:family="paragraph"><style:paragraph-properties fo:text-align="{start}" {mode}/><style:text-properties fo:font-weight="bold" style:font-weight-complex="bold"/></style:style>
<style:style style:name="StrongAmount" style:family="paragraph"><style:paragraph-properties fo:text-align="{end}" {mode}/><style:text-properties fo:font-weight="bold" style:font-weight-complex="bold"/></style:style>
<style:style style:name="Tbl" style:family="table"><style:table-properties style:width="{sum(widths):.1f}cm" table:align="margins" {mode}/></style:style>
{columns}
<style:style style:name="Head" style:family="table-cell"><style:table-cell-properties fo:padding="0.06cm" fo:border-bottom="0.5pt solid #000000" fo:border-top="none" fo:border-left="none" fo:border-right="none"/></style:style>
<style:style style:name="Td" style:family="table-cell"><style:table-cell-properties fo:padding="0.05cm" fo:border="none" style:vertical-align="top"/></style:style>
</office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>'''
    body = []
    st = story['statement']
    for n, page in enumerate(st['pages']):
        body.append(para('BankBreak' if n else 'Bank', story['bank']))
        body.append(para('Title', story['documentTitle']))
        body.append(para('Line', account_line(story)))
        cols = ''.join(f'<table:table-column table:style-name="C{i}"/>' for i in range(7))
        head = ''.join(cell('Head', h, para_style='Strong') for h in L['headers'])
        trs = [f'<table:table-header-rows><table:table-row>{head}</table:table-row></table:table-header-rows>']
        for kind, cells in rows(story, page):
            if kind == 'label':
                tr = cell('Td', cells[0], 6, 'Strong') + cell('Td', cells[1], para_style='StrongAmount')
            elif kind == 'totals':
                tr = (cell('Td', cells[0], 4, 'Strong') + cell('Td', cells[1], para_style='StrongAmount')
                      + cell('Td', cells[2], para_style='StrongAmount') + cell('Td'))
            else:
                tr = ''.join(cell('Td', v, para_style='Amount' if i >= 4 else 'Cell') for i, v in enumerate(cells))
            trs.append(f'<table:table-row>{tr}</table:table-row>')
        body.append(f'<table:table table:name="Page{page["number"]}x{n + 1}" table:style-name="Tbl">{cols}{"".join(trs)}</table:table>')
        body.append(para('Foot', footer(story, page)))
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n<office:document {NS} office:version="1.3" '
            f'office:mimetype="application/vnd.oasis.opendocument.text">{styles}'
            f'<office:body><office:text>{"".join(body)}</office:text></office:body></office:document>\n')


def cashbook_fods(story, typed):
    def string(v):
        return f'<table:table-cell office:value-type="string"><text:p>{escape(v)}</text:p></table:table-cell>'

    def money(minor):
        if not minor:
            return '<table:table-cell/>'
        v = f'{minor // 100}.{minor % 100:02d}'
        return f'<table:table-cell table:style-name="ce2" office:value-type="float" office:value="{v}"><text:p>{v}</text:p></table:table-cell>'

    out = ['<table:table-row>' + ''.join(string(h) for h in CASHBOOK_HEADERS) + '</table:table-row>']
    for e in story['cashbook']:
        if typed:
            cells = (f'<table:table-cell table:style-name="ce1" office:value-type="date" office:date-value="{e["date"]}">'
                     f'<text:p>{e["date"]}</text:p></table:table-cell>' + string(e['voucher']) + string(e['description'])
                     + string(e['reference']) + money(e['receipt']) + money(e['payment']))
        else:
            plain = lambda m: f'{m // 100}.{m % 100:02d}' if m else ''  # noqa: E731
            cells = ''.join(string(v) if v else '<table:table-cell/>' for v in
                            [e['date'], e['voucher'], e['description'], e['reference'], plain(e['receipt']), plain(e['payment'])])
        out.append(f'<table:table-row>{cells}</table:table-row>')
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n<office:document {NS} office:version="1.3" '
            'office:mimetype="application/vnd.oasis.opendocument.spreadsheet"><office:automatic-styles>'
            '<number:date-style style:name="N1"><number:year number:style="long"/><number:text>-</number:text>'
            '<number:month number:style="long"/><number:text>-</number:text><number:day number:style="long"/></number:date-style>'
            '<number:number-style style:name="N2"><number:number number:decimal-places="2" number:min-decimal-places="2" '
            'number:min-integer-digits="1"/></number:number-style>'
            '<style:style style:name="ce1" style:family="table-cell" style:data-style-name="N1"/>'
            '<style:style style:name="ce2" style:family="table-cell" style:data-style-name="N2"/>'
            '</office:automatic-styles><office:body><office:spreadsheet><table:table table:name="Cashbook">'
            + ''.join(out) + '</table:table></office:spreadsheet></office:body></office:document>\n')


def convert(source, out_dir, target, profile):
    result = subprocess.run(['soffice', f'-env:UserInstallation=file://{profile}', '--headless', '--norestore',
                             '--convert-to', target, '--outdir', str(out_dir), str(source)],
                            capture_output=True, text=True, timeout=600)
    if result.returncode:
        raise SystemExit(f'soffice failed for {source}: {result.stderr}')


def render(stories, out_dir, work_dir):
    out_dir, work_dir = Path(out_dir), Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    profile = work_dir / 'lo-profile'
    written = []
    for s in stories:
        if s['producer'] == 'libreoffice-writer':
            src = work_dir / f"{s['id']}-statement.fodt"
            src.write_text(statement_fodt(s), encoding='utf-8')
            convert(src, out_dir, 'pdf:writer_pdf_Export', profile)
            written.append(out_dir / f"{s['id']}-statement.pdf")
        if s.get('cashbookXlsx'):
            src = work_dir / f"{s['id']}-cashbook.fods"
            src.write_text(cashbook_fods(s, s['cashbookXlsx'] == 'typed'), encoding='utf-8')
            convert(src, out_dir, 'xlsx:Calc MS Excel 2007 XML', profile)
            written.append(out_dir / f"{s['id']}-cashbook.xlsx")
    return written


def version():
    return subprocess.run(['soffice', '--version'], capture_output=True, text=True).stdout.strip()
