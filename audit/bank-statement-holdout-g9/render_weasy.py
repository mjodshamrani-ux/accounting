"""WeasyPrint statements for G9: an HTML and CSS paged-media engine that lays
text out with Pango (HarfBuzz shaping, FriBidi ordering) and writes the PDF
itself with pydyf, unrelated to Chromium, LibreOffice, ReportLab, Typst and
fpdf2.

Each statement page is one HTML section of the page's height, so the pages
are the facts' pages; the footer sits at the bottom of its section. A
right-to-left statement sets `dir="rtl"` and WeasyPrint lays the table out
from the right. Every story string is escaped into the markup.
"""
import html
from pathlib import Path

from common import LABELS, account_line, footer, table_rows

FILES = {
    'Roboto': 'roboto', 'Source Serif 4': 'source-serif-4', 'IBM Plex Sans Arabic': 'ibm-plex-sans-arabic',
    'Cairo': 'cairo', 'IBM Plex Mono': 'ibm-plex-mono', 'Lato': 'lato', 'Tajawal': 'tajawal',
}
# Paper size and the height left for one statement page inside the margins.
PAPER = {'A4': ('A4', 265), 'Letter': ('letter', 247.4), 'A5': ('A5', 178)}
SIZE = {'IBM Plex Mono': 6.2}
LOGO = ('<svg width="34" height="34" viewBox="0 0 34 34"><circle cx="17" cy="17" r="15" fill="#1d4e89"/>'
        '<rect x="9" y="15" width="16" height="10" fill="#ffffff"/><polygon points="7,15 17,7 27,15" fill="#e0b84d"/>'
        '</svg>')


def esc(text):
    return '<br>'.join(html.escape(part) for part in text.split('\n'))


def css(story, fonts):
    st, family = story['recipe']['style'], FILES[story['font']]
    paper, height = PAPER[story['paper']]
    size = SIZE.get(story['font'], 8.5)
    rules = {
        'grid': 'th, td { border: 0.4pt solid #555; }',
        'rows': 'td { border-bottom: 0.3pt solid #b8b8b8; }',
        'none': '',
    }[st['rules']]
    heading = {
        'rule': 'th { border-bottom: 0.75pt solid #222; }',
        'filled': 'th { background: #e3e8ef; }',
    }[st['heading']]
    return f"""
@font-face {{ font-family: "{story['font']}"; src: url(file://{fonts}/{family}-400.ttf); font-weight: 400; }}
@font-face {{ font-family: "{story['font']}"; src: url(file://{fonts}/{family}-700.ttf); font-weight: 700; }}
@page {{ size: {paper}; margin: 14mm 14mm 18mm 14mm; }}
body {{ font-family: "{story['font']}"; font-size: {size}pt; margin: 0; }}
section {{ position: relative; height: {height}mm; break-after: page; }}
section:last-child {{ break-after: auto; }}
.letterhead {{ display: flex; gap: 8pt; align-items: center; }}
.bank {{ font-size: 13pt; }}
.title {{ font-size: 10.5pt; }}
.account {{ margin: 3pt 0 7pt 0; white-space: nowrap; }}
table {{ width: 100%; border-collapse: collapse; }}
th {{ font-weight: 400; text-align: start; padding: 2pt 3pt; }}
td {{ padding: 2pt 3pt; vertical-align: top; }}
.n {{ text-align: end; white-space: nowrap; }}
.k {{ white-space: nowrap; }}
.footer {{ position: absolute; bottom: 0; left: 0; right: 0; text-align: center; font-size: 8pt; }}
{rules}
{heading}
{'tr.m:nth-child(even) td { background: #f1f4f8; }' if st.get('stripes') else ''}
{f"td.w {{ color: {st['debitColor']}; }}" if st.get('debitColor') else ''}
{f"tr.label td, tr.totals td {{ font-weight: 700; }}" if st.get('labelWeight') == 'bold' else ''}
"""


def page_html(story, page):
    L = LABELS[story['layout']]
    head = ''.join(f'<th class="{"n" if i >= 4 else ""}">{html.escape(h)}</th>' for i, h in enumerate(L['headers']))
    rows = []
    for kind, cells in table_rows(story, page):
        if kind == 'label':
            rows.append(f'<tr class="label"><td colspan="6">{esc(cells[0])}</td><td class="n">{esc(cells[1])}</td></tr>')
        elif kind == 'totals':
            rows.append(f'<tr class="totals"><td colspan="4">{esc(cells[0])}</td><td class="n w">{esc(cells[1])}</td>'
                        f'<td class="n">{esc(cells[2])}</td><td></td></tr>')
        elif kind == 'continuation':
            rows.append(f'<tr><td></td><td></td><td>{esc(cells[0])}</td><td></td><td></td><td></td><td></td></tr>')
        else:
            date, value, text, ref, w, d, bal = cells
            rows.append(f'<tr class="m"><td class="k">{esc(date)}</td><td class="k">{esc(value)}</td><td>{esc(text)}</td>'
                        f'<td class="k">{esc(ref)}</td><td class="n w">{esc(w)}</td><td class="n">{esc(d)}</td>'
                        f'<td class="n">{esc(bal)}</td></tr>')
    logo = LOGO if story['recipe']['style'].get('logo') == 'vector' else ''
    return (f'<section><div class="letterhead">{logo}<div><div class="bank">{esc(story["bank"])}</div>'
            f'<div class="title">{esc(story["documentTitle"])}</div></div></div>'
            f'<div class="account">{esc(account_line(story))}</div>'
            f'<table><thead><tr>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table>'
            f'<div class="footer">{esc(footer(story, page))}</div></section>')


def document(story, fonts):
    rtl = story['layout'] == 'ar'
    return (f'<!doctype html><html lang="{"ar" if rtl else "en"}" dir="{"rtl" if rtl else "ltr"}"><head>'
            f'<meta charset="utf-8"><title>{esc(story["documentTitle"])} {esc(story["statement"]["account"])}</title>'
            f'<style>{css(story, fonts)}</style></head><body>'
            + ''.join(page_html(story, p) for p in story['statement']['pages']) + '</body></html>')


def render(stories, out_dir, fonts):
    import weasyprint
    written = []
    for s in stories:
        if s['producer'] != 'weasyprint':
            continue
        target = Path(out_dir) / f"{s['id']}-statement.pdf"
        doc = weasyprint.HTML(string=document(s, fonts)).render()
        if len(doc.pages) != len(s['statement']['pages']):
            raise ValueError(f"{s['id']}: {len(doc.pages)} pages laid out for {len(s['statement']['pages'])}")
        doc.write_pdf(target)
        written.append(target)
    return written


def version():
    from importlib.metadata import version as installed
    return {'weasyprint': installed('weasyprint'), 'pydyf': installed('pydyf')}
