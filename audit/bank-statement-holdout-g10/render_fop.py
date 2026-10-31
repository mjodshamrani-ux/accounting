"""Apache FOP statements for G10: XSL-FO laid out by FOP 2.10, which shapes
text and orders it by its own bidirectional algorithm, and written by FOP's
own PDF writer, unrelated to the other holdouts' writers.

Each statement page is one page sequence holding the letterhead, the account
line and the table, with the printed footer in the page's after region; the
footer text comes from the facts, so a fault in the printed page numbers is
the facts' own. A page whose table overflows makes FOP add a page, and the
page count is checked here. A right-to-left statement sets
`writing-mode="rl-tb"` on its pages, and FOP lays the table out from the
right. The fonts are the families without standard ligatures (fonts.py):
FOP writes a ligature glyph as a private-use character. Helvetica is the
standard font, not embedded. Every story string is escaped into the markup.
"""
from xml.sax.saxutils import escape

from common import LABELS, account_line, footer, table_rows

FILES = {'Open Sans': 'open-sans', 'Almarai': 'almarai', 'Markazi Text': 'markazi-text',
         'Courier Prime': 'courier-prime'}
PAPER = {'A4': ('210mm', '297mm'), 'Letter': ('215.9mm', '279.4mm'), 'Legal': ('215.9mm', '355.6mm'),
         'A4-landscape': ('297mm', '210mm')}
SIZE = {'Courier Prime': '8pt'}
WIDTHS = [17, 17, None, 33, 23, 23, 27]  # mm; the description takes the rest
MONO_WIDTHS = [21, 21, None, 37, 27, 27, 31]
PADDING = {'tight': '0.6pt 2pt', None: '1.6pt 3pt'}


def config(fonts):
    """FOP's font configuration: each family's two weights, embedded."""
    out = []
    for family, stem in FILES.items():
        for weight, name in (('normal', 400), ('bold', 700)):
            out.append(f'<font kerning="yes" embed-url="file://{fonts}/{stem}-nl-{name}.ttf">'
                       f'<font-triplet name="{family}" style="normal" weight="{weight}"/></font>')
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<fop version="1.0"><renderers><renderer mime="application/pdf">'
            f'<fonts>{"".join(out)}</fonts></renderer></renderers></fop>\n')


def document(story):
    st, rtl = story['recipe']['style'], story['layout'] == 'ar'
    L = LABELS[story['layout']]
    width, height = PAPER[story['paper']]
    pad = PADDING[st.get('padding')]
    rule = {'grid': 'border="0.4pt solid #444"', 'rows': 'border-after-style="solid" border-after-width="0.3pt" '
            'border-after-color="#9a9a9a"', 'none': ''}[st['rules']]
    heading = {'filled': 'background-color="#dde3ea"', 'rule': 'border-after-style="solid" '
               'border-after-width="0.8pt" border-after-color="#222"'}[st['heading']]
    size = SIZE.get(story['font'], '8.5pt')
    mode = ' writing-mode="rl-tb"' if rtl else ''

    def cell(text, end=False, span=1, head=False):
        # A heading cell takes the heading's style, and the grid's borders.
        lines = (f'{rule if st["rules"] == "grid" else ""} {heading}') if head else rule
        attrs = f'padding="{pad}" {lines}'
        span = f' number-columns-spanned="{span}"' if span > 1 else ''
        block = 'text-align="end" wrap-option="no-wrap"' if end else 'text-align="start"'
        return f'<fo:table-cell{span} {attrs}><fo:block {block}>{escape(text)}</fo:block></fo:table-cell>'

    widths = MONO_WIDTHS if story['font'] == 'Courier Prime' else WIDTHS
    columns = ''.join(f'<fo:table-column column-width="{w}mm"/>' if w else
                      '<fo:table-column column-width="proportional-column-width(1)"/>' for w in widths)
    sequences = []
    for page in story['statement']['pages']:
        rows = []
        for kind, cells in table_rows(story, page):
            if kind == 'label':
                rows.append(cell(cells[0], span=6) + cell(cells[1], end=True))
            elif kind == 'totals':
                rows.append(cell(cells[0], span=4) + cell(cells[1], True) + cell(cells[2], True) + cell(''))
            elif kind == 'continuation':
                rows.append(cell('') + cell('') + cell(cells[0]) + cell('') * 4)
            else:
                rows.append(''.join(cell(v, end=i >= 4) for i, v in enumerate(cells)))
        head = ''.join(cell(h, end=i >= 4, head=True) for i, h in enumerate(L['headers']))
        body = ''.join(f'<fo:table-row>{r}</fo:table-row>' for r in rows)
        sequences.append(
            f'<fo:page-sequence master-reference="page"{mode}>'
            f'<fo:static-content flow-name="xsl-region-after"><fo:block text-align="center" font-size="8pt">'
            f'{escape(footer(story, page))}</fo:block></fo:static-content>'
            f'<fo:flow flow-name="xsl-region-body">'
            f'<fo:block font-size="13pt" line-height="1.05">{escape(story["bank"])}</fo:block>'
            f'<fo:block font-size="10.5pt" line-height="1.05">{escape(story["documentTitle"])}</fo:block>'
            f'<fo:block space-before="3pt" space-after="7pt">{escape(account_line(story))}</fo:block>'
            f'<fo:table table-layout="fixed" width="100%" border-collapse="collapse">{columns}'
            f'<fo:table-header><fo:table-row>{head}</fo:table-row></fo:table-header>'
            f'<fo:table-body>{body}</fo:table-body></fo:table></fo:flow></fo:page-sequence>')
    family = story['font'] if story['font'] in FILES else 'Helvetica'
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" '
            f'font-family="{family}" font-size="{size}" line-height="1.25"'
            f' language="{"ar" if rtl else "en"}">'
            '<fo:layout-master-set>'
            f'<fo:simple-page-master master-name="page" page-width="{width}" page-height="{height}" '
            'margin="12mm 13mm 8mm 13mm"><fo:region-body margin-bottom="12mm"/>'
            '<fo:region-after extent="8mm"/></fo:simple-page-master></fo:layout-master-set>'
            '<fo:declarations><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
            'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/">'
            f'<dc:title>{escape(story["documentTitle"])} {escape(story["statement"]["account"])}</dc:title>'
            '</rdf:Description></rdf:RDF></x:xmpmeta></fo:declarations>'
            + ''.join(sequences) + '</fo:root>\n')


def prepare(stories, work, fonts):
    """Writes fop.xconf and each FOP story's .fo; returns the pairs of FO and
    PDF names for FopStatements."""
    work.mkdir(parents=True, exist_ok=True)
    (work / 'fop.xconf').write_text(config(fonts), encoding='utf-8')
    jobs = []
    for s in stories:
        if s['producer'] != 'fop':
            continue
        fo = work / f"{s['id']}.fo"
        fo.write_text(document(s), encoding='utf-8')
        jobs.append((s, fo))
    return jobs
