"""fpdf2 statements for G8: a Python PDF library in the FPDF lineage that
places every cell itself, unrelated to Chromium, LibreOffice, ReportLab and
Typst.

`Times` and `Courier` are the standard Type 1 fonts, not embedded. A story
naming a TrueType font embeds a subset of it. Arabic is shaped by HarfBuzz
(uharfbuzz) and ordered by fpdf2's own bidirectional algorithm, cell by
cell, in a table whose first column is the rightmost. Descriptions break
only where the facts break them, and a line wider than its cell is an
error here rather than a clipped PDF. The creation date is fixed.
"""
from datetime import datetime, timezone
from pathlib import Path

from common import LABELS, account_line, footer, table_rows

TRUETYPE = {
    'Caladea': '/usr/share/fonts/truetype/crosextra/Caladea-Regular.ttf',
    'Carlito': '/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf',
    'DejaVu Sans': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
}
CORE = {'Times', 'Courier'}
# Column widths in points for the seven logical columns, per paper.
WIDTHS = {'A4': [58, 58, 175, 82, 64, 64, 74], 'Letter': [60, 60, 182, 84, 66, 66, 76]}
SIZE = {'Courier': 7.2, 'Amiri': 9.5}
LINE = 11.5


def render(stories, out_dir, amiri):
    from fpdf import FPDF, FPDF_VERSION

    written = []
    for s in stories:
        if s['producer'] != 'fpdf2':
            continue
        rtl = s['layout'] == 'ar'
        style = s['recipe']['style']
        pdf = FPDF(orientation='P', unit='pt', format='A4' if s['paper'] == 'A4' else 'Letter')
        pdf.set_auto_page_break(False)
        pdf.set_creation_date(datetime(2026, 10, 23, tzinfo=timezone.utc))
        pdf.set_creator(f'fpdf2 {FPDF_VERSION}')
        pdf.set_title(f"{s['documentTitle']} {s['statement']['account']}")
        if s['font'] in CORE:
            family = s['font']
        else:
            family = 'G8Font'
            pdf.add_font(family, fname=str(amiri) if s['font'] == 'Amiri' else TRUETYPE[s['font']])
        if rtl:
            pdf.set_text_shaping(use_shaping_engine=True, direction='rtl', script='arab', language='ara')
        size = SIZE.get(s['font'], 8.5)
        widths = WIDTHS[s['paper']]
        page_w = pdf.w
        table_w = sum(widths)
        left = (page_w - table_w) / 2
        spans, x = [], left
        for w in widths:
            spans.append((x, w))
            x += w
        if rtl:
            # The first logical column is the rightmost.
            spans = [(2 * left + table_w - a - w, w) for a, w in spans]

        def span(i, j):
            a = min(spans[i][0], spans[j][0])
            b = max(spans[i][0] + spans[i][1], spans[j][0] + spans[j][1])
            return a, b - a

        def put(text, i, j, y, align, height=LINE):
            a, w = span(i, j)
            if text and pdf.get_string_width(text) > w - 6:
                raise ValueError(f"{s['id']}: {text!r} wider than its cell")
            pdf.set_xy(a + 3, y)
            pdf.cell(w - 6, height, text, align=align)

        start, end = ('R', 'L') if rtl else ('L', 'R')
        amount_align = end if style.get('amountAlign', 'end') == 'end' else start
        heading_align = {'start': start, 'center': 'C'}[style['headingAlign']]
        headings = LABELS[s['layout']]['headers']
        for page in s['statement']['pages']:
            pdf.add_page()
            margin = 40
            top = margin
            pdf.set_font(family, size=13)
            pdf.set_xy(margin, top)
            pdf.cell(page_w - 2 * margin, 16, s['bank'], align=start)
            pdf.set_font(family, size=10.5)
            pdf.set_xy(margin, top + 17)
            pdf.cell(page_w - 2 * margin, 14, s['documentTitle'], align=start)
            pdf.set_font(family, size=size)
            pdf.set_xy(margin, top + 33)
            pdf.cell(page_w - 2 * margin, 12, account_line(s), align=start)
            y = top + 56
            pdf.set_draw_color(85)
            pdf.set_line_width(0.4)
            if style['heading'] == 'filled':
                pdf.set_fill_color(222)
                pdf.rect(left, y, table_w, LINE + 4, style='F')
            for i, h in enumerate(headings):
                put(h, i, i, y + 2, end if i >= 4 and style.get('amountHeadingAlign') == 'end' else heading_align)
            if style['rules'] == 'grid':
                for a, w in spans:
                    pdf.rect(a, y, w, LINE + 4)
            else:
                pdf.line(left, y + LINE + 4, left + table_w, y + LINE + 4)
            y += LINE + 4
            for kind, cells in table_rows(s, page):
                parts = cells[2].split('\n') if kind == 'movement' else [cells[0]] if kind == 'continuation' else ['']
                height = LINE * len(parts) + 3
                if kind == 'label':
                    put(cells[0], 0, 5, y + 1.5, start)
                    put(cells[1], 6, 6, y + 1.5, amount_align)
                    boxes = [span(0, 5), spans[6]]
                elif kind == 'totals':
                    put(cells[0], 0, 3, y + 1.5, start)
                    put(cells[1], 4, 4, y + 1.5, amount_align)
                    put(cells[2], 5, 5, y + 1.5, amount_align)
                    boxes = [span(0, 3), spans[4], spans[5], spans[6]]
                else:
                    for n, part in enumerate(parts):
                        put(part, 2, 2, y + 1.5 + LINE * n, start)
                    if kind == 'movement':
                        for i, v in enumerate(cells):
                            if i != 2 and v:
                                put(v, i, i, y + 1.5, amount_align if i >= 4 else start)
                    boxes = spans
                if style['rules'] == 'grid':
                    for a, w in boxes:
                        pdf.rect(a, y, w, height)
                y += height
            pdf.set_font(family, size=8)
            pdf.set_xy(margin, pdf.h - 34)
            pdf.cell(page_w - 2 * margin, 10, footer(s, page), align='C')
            pdf.set_font(family, size=size)
        target = Path(out_dir) / f"{s['id']}-statement.pdf"
        pdf.output(str(target))
        written.append(target)
    return written


def version():
    from importlib.metadata import version as installed
    return {'fpdf2': installed('fpdf2'), 'uharfbuzz': installed('uharfbuzz')}
