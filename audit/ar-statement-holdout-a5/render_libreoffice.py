"""The A5 LibreOffice statements: one flat OpenDocument text per story, which
LibreOffice Writer itself exports to PDF, as an office that keeps its
statement template in Writer would print it.

Each printed page of the facts starts on a new page: its text lines are
paragraphs, and each run of heading and value lines is a table whose columns
have the width of their role. A table that continues a section on a new page
without its headings is still a table of the same columns. The page footer,
when the story prints one, is the page style's footer with LibreOffice's own
page number and page count fields. Arabic statements are right-to-left
paragraphs and tables, shaped and ordered by LibreOffice; their footer fields
count in Arabic-Indic digits when the story's digits are.

Alignment is explicit (left or right, never start or end), as G6 found that
LibreOffice reads start as left even in a right-to-left paragraph.
"""
import shutil
import subprocess
from pathlib import Path
from xml.sax.saxutils import escape

ROLES = {
    'Date': 'date', 'التاريخ': 'date', 'Type': 'type', 'النوع': 'type',
    'Document No': 'document', 'رقم المستند': 'document',
    'Related invoice': 'related', 'الفاتورة المرتبطة': 'related',
    'Description': 'description', 'البيان': 'description',
    'Original amount': 'original', 'المبلغ الأصلي': 'original',
    'Open amount': 'open', 'المبلغ المفتوح': 'open', 'Balance': 'balance', 'الرصيد': 'balance',
}
WIDTH_PT = {'date': 54, 'type': 56, 'document': 68, 'related': 80, 'description': 96,
            'original': 74, 'open': 66, 'balance': 74}
AMOUNTS = {'original', 'open', 'balance'}
TITLES = {'Statement of account', 'كشف حساب'}

NS = ('xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
      'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
      'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
      'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
      'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" '
      'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"')


def role(heading):
    return ROLES.get(heading, 'custom')


def blocks(page):
    """A page as paragraphs and tables: consecutive heading and value lines
    form one table."""
    out = []
    for line in page:
        if 'text' in line:
            if line['align'] == 'center':
                continue   # the footer is the page style's
            out.append(('p', line['text']))
        else:
            if not out or out[-1][0] != 't':
                out.append(('t', []))
            out[-1][1].append(line)
    return out


def font(name, size, bold=False):
    weight = 'bold' if bold else 'normal'
    return (f'style:font-name="{name}" fo:font-size="{size}pt" fo:font-weight="{weight}" '
            f'style:font-name-complex="{name}" style:font-size-complex="{size}pt" '
            f'style:font-weight-complex="{weight}" fo:language="en" fo:country="US" '
            f'style:language-complex="ar" style:country-complex="SA"')


def document(story):
    rtl = story['layout'] == 'ar'
    style = story['style']
    face = story['font']
    mode = 'rl-tb' if rtl else 'lr-tb'
    start, end = ('right', 'left') if rtl else ('left', 'right')
    pages = [blocks(p) for p in story['statement']['pages']]
    footer = any(l.get('align') == 'center' for l in story['statement']['pages'][0])
    indic = rtl and any('٠' <= ch <= '٩' for l in story['statement']['pages'][0]
                        if l.get('align') == 'center' for ch in l['text'])

    # Every column of every table, by role, with its width.
    columns, auto = [], []
    for page in pages:
        for kind, content in page:
            if kind == 't':
                heads = next((l['headings'] for l in content if 'headings' in l), None)
                columns.append(heads)
    widths = {}
    for heads in columns:
        for h in heads or []:
            widths.setdefault(role(h), WIDTH_PT.get(role(h), 70))
    for r, w in widths.items():
        auto.append(f'<style:style style:name="C{r}" style:family="table-column">'
                    f'<style:table-column-properties style:column-width="{w}pt"/></style:style>')
    border = '0.5pt solid #000000'
    auto.append(f'<style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties '
                f'fo:padding-top="1.2pt" fo:padding-bottom="1.2pt" fo:padding-left="2.5pt" fo:padding-right="2.5pt" '
                f'fo:border="{border if style["grid"] else "none"}"/></style:style>')
    shade = ' fo:background-color="#E0E0E0"' if style['shade'] else ''
    # Without a grid, the heading row keeps a rule under it.
    edges = f'fo:border="{border}"' if style['grid'] else f'fo:border="none" fo:border-bottom="{border}"'
    auto.append(f'<style:style style:name="Head" style:family="table-cell"><style:table-cell-properties '
                f'fo:padding-top="1.2pt" fo:padding-bottom="1.2pt" fo:padding-left="2.5pt" fo:padding-right="2.5pt" '
                f'{edges}{shade}/></style:style>')
    page_break = ' fo:break-before="page"'
    # FreeSerif Bold writes medial yeh as a base and a zero-width mark that
    # its ToUnicode map does not name, so its Arabic headings would not read
    # as printed: those stories set their headings in the regular weight.
    bold = style.get('boldHeadings', True)
    for name, size, bold, align, brk in (
            ('Title', 12, True, start, False), ('TitleBreak', 12, True, start, True),
            ('Line', 9, False, start, False), ('LineBreak', 9, False, start, True),
            ('Start', 8, False, start, False), ('End', 8, False, end, False),
            ('HeadStart', 8, bold, start, False), ('HeadEnd', 8, bold, end, False),
            ('Foot', 8, False, 'center', False)):
        auto.append(f'<style:style style:name="{name}" style:family="paragraph"><style:paragraph-properties '
                    f'fo:margin-top="0pt" fo:margin-bottom="{4 if name.startswith("Title") else 0}pt" '
                    f'fo:text-align="{align}" style:writing-mode="{mode}"{page_break if brk else ""}/>'
                    f'<style:text-properties {font("F", size, bold)}/></style:style>')
    for brk in (False, True):
        auto.append(f'<style:style style:name="Table{"Break" if brk else ""}" style:family="table">'
                    f'<style:table-properties table:align="{start}" style:writing-mode="{mode}" '
                    f'fo:margin-top="4pt" fo:margin-bottom="3pt"{page_break if brk else ""}/></style:style>')

    body = []
    heads = None
    for p, page in enumerate(pages):
        for b, (kind, content) in enumerate(page):
            brk = p > 0 and b == 0
            if kind == 'p':
                name = 'Title' if content in TITLES else 'Line'
                body.append(f'<text:p text:style-name="{name}{"Break" if brk else ""}">{escape(content)}</text:p>')
                continue
            heads = next((l['headings'] for l in content if 'headings' in l), heads)
            body.append(f'<table:table table:style-name="Table{"Break" if brk else ""}">')
            body.extend(f'<table:table-column table:style-name="C{role(h)}"/>' for h in heads)
            for line in content:
                body.append('<table:table-row>')
                if 'headings' in line:
                    for h in line['headings']:
                        para = 'HeadEnd' if role(h) in AMOUNTS else 'HeadStart'
                        body.append(f'<table:table-cell table:style-name="Head" office:value-type="string">'
                                    f'<text:p text:style-name="{para}">{escape(h)}</text:p></table:table-cell>')
                else:
                    values = dict(line['cells'])
                    for h in heads:
                        para = 'End' if role(h) in AMOUNTS else 'Start'
                        text = escape(values.get(h, ''))
                        body.append(f'<table:table-cell table:style-name="Cell" office:value-type="string">'
                                    f'<text:p text:style-name="{para}">{text}</text:p></table:table-cell>')
                body.append('</table:table-row>')
            body.append('</table:table>')

    # LibreOffice's own name for Arabic-Indic numbering; "١" alone counts in Latin digits.
    numbering = 'style:num-format="١, ٢, ٣, ..."' if indic else 'style:num-format="1"'
    if footer:
        label, between = ('صفحة', 'من') if rtl else ('Page', 'of')
        foot = (f'<style:footer><text:p text:style-name="Foot">{label} '
                f'<text:page-number {numbering} text:select-page="current">1</text:page-number> {between} '
                f'<text:page-count {numbering}>1</text:page-count></text:p></style:footer>')
        foot_style = ('<style:footer-style><style:header-footer-properties fo:min-height="0pt" '
                      'fo:margin-top="6pt"/></style:footer-style>')
    else:
        foot, foot_style = '', ''
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<office:document {NS} office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
<office:meta/>
<office:font-face-decls><style:font-face style:name="F" svg:font-family="&apos;{face}&apos;"/></office:font-face-decls>
<office:styles><style:default-style style:family="paragraph"><style:text-properties {font("F", 9)}/></style:default-style></office:styles>
<office:automatic-styles>
<style:page-layout style:name="Page"><style:page-layout-properties fo:page-width="595.28pt" fo:page-height="841.89pt" fo:margin-top="40pt" fo:margin-bottom="30pt" fo:margin-left="42pt" fo:margin-right="42pt" style:writing-mode="{mode}"/>{foot_style}</style:page-layout>
{''.join(auto)}
</office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="Page">{foot}</style:master-page></office:master-styles>
<office:body><office:text>
{chr(10).join(body)}
</office:text></office:body>
</office:document>
'''


def render(stories, work, out):
    """Writes each story's .fodt under <work>, has LibreOffice export them,
    and returns [(story, pdf)]."""
    work, out = Path(work), Path(out)
    work.mkdir(parents=True, exist_ok=True)
    mine = [s for s in stories if s['producer'] == 'libreoffice']
    sources = []
    for story in mine:
        path = work / f"{story['id']}.fodt"
        path.write_text(document(story), encoding='utf-8')
        sources.append(str(path))
    soffice = shutil.which('soffice') or shutil.which('libreoffice')
    profile = (work / 'profile').resolve().as_uri()
    subprocess.run([soffice, f'-env:UserInstallation={profile}', '--headless', '--convert-to',
                    'pdf:writer_pdf_Export', '--outdir', str(work), *sources],
                   check=True, capture_output=True, text=True, timeout=600)
    drawn = []
    for story in mine:
        target = out / f"{story['id']}-statement.pdf"
        shutil.copyfile(work / f"{story['id']}.pdf", target)
        drawn.append((story, target))
    return drawn


def version():
    soffice = shutil.which('soffice') or shutil.which('libreoffice')
    return subprocess.run([soffice, '--version'], capture_output=True, text=True).stdout.strip()
