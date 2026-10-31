"""ReportLab statements for G6: a programmatic report writer that places
every string itself on a canvas.

`Helvetica` uses the standard Type 1 font, not embedded (WinAnsiEncoding),
as many generated statements do. A story whose font names an embedded
TrueType draws with a subset of that file. ReportLab has no Arabic shaping
or bidirectional layout, so an Arabic story is shaped with arabic-reshaper
and put in visual order with python-bidi before drawing, as systems built
on it do; the text layer then holds presentation forms in visual order.
`invariant=1` fixes ReportLab's dates and identifiers.
"""
from pathlib import Path

from common import LABELS, account_line, footer, rows

FONTS = {
    'Helvetica': ('Helvetica', 'Helvetica-Bold'),
    'Liberation Serif (embedded TrueType)': (
        ('LiberationSerif', '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf'),
        ('LiberationSerif-Bold', '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf')),
    'DejaVu Sans (embedded TrueType)': (
        ('DejaVuSans', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
        ('DejaVuSans-Bold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')),
}
# Column widths in points for the seven logical columns.
WIDTHS = [56, 56, 170, 78, 62, 62, 72]


def render(stories, out_dir):
    from reportlab.lib.pagesizes import A4, letter
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    def font_names(name):
        regular, bold = FONTS[name]
        if isinstance(regular, tuple):
            for alias, path in (regular, bold):
                if alias not in pdfmetrics.getRegisteredFontNames():
                    pdfmetrics.registerFont(TTFont(alias, path))
            return regular[0], bold[0]
        return regular, bold

    written = []
    for s in stories:
        if s['producer'] != 'reportlab':
            continue
        rtl = s['layout'] == 'ar'
        if rtl:
            import arabic_reshaper
            from bidi import get_display

            def visual(t):
                return get_display(arabic_reshaper.reshape(t)) if t else t
        else:
            def visual(t):
                return t
        regular, bold = font_names(s['font'])
        size = A4 if s['paper'] == 'A4' else letter
        width, height = size
        target = Path(out_dir) / f"{s['id']}-statement.pdf"
        c = canvas.Canvas(str(target), pagesize=size, invariant=1)
        c.setTitle(f"{s['documentTitle']} {s['statement']['account']}")
        c.setCreator('ReportLab synthetic statement writer (G6)')
        margin = 36
        table_width = sum(WIDTHS)
        left = (width - table_width) / 2
        # Logical column i spans [a, b]; in a right-to-left table the first
        # logical column is the rightmost, and "start" is the right edge.
        spans, x = [], left
        for w in WIDTHS:
            spans.append((x, x + w))
            x += w
        if rtl:
            spans = [(2 * left + table_width - b, 2 * left + table_width - a) for a, b in spans]

        def put(t, i, j, y, font, align):
            a, b = min(spans[i][0], spans[j][0]), max(spans[i][1], spans[j][1])
            c.setFont(font, 8)
            if (align == 'end') != rtl:
                c.drawRightString(b - 3, y, visual(t))
            else:
                c.drawString(a + 3, y, visual(t))
        L = LABELS[s['layout']]
        for page in s['statement']['pages']:
            y = height - margin - 12
            c.setFont(bold, 12)
            (c.drawRightString(width - margin, y, visual(s['bank'])) if rtl else c.drawString(margin, y, s['bank']))
            y -= 14
            c.setFont(regular, 10)
            (c.drawRightString(width - margin, y, visual(s['documentTitle'])) if rtl
             else c.drawString(margin, y, s['documentTitle']))
            y -= 13
            c.setFont(regular, 8)
            (c.drawRightString(width - margin, y, visual(account_line(s))) if rtl
             else c.drawString(margin, y, account_line(s)))
            y -= 20
            for i, h in enumerate(L['headers']):
                put(h, i, i, y, bold, 'end' if i >= 4 else 'start')
            c.setLineWidth(0.5)
            c.line(left, y - 3, left + table_width, y - 3)
            y -= 14
            for kind, cells in rows(s, page):
                if kind == 'label':
                    put(cells[0], 0, 5, y, bold, 'start')
                    put(cells[1], 6, 6, y, bold, 'end')
                    y -= 11
                elif kind == 'totals':
                    put(cells[0], 0, 3, y, bold, 'start')
                    put(cells[1], 4, 4, y, bold, 'end')
                    put(cells[2], 5, 5, y, bold, 'end')
                    y -= 11
                else:
                    parts = cells[2].split('\n')
                    for i, v in enumerate(cells):
                        if i == 2:
                            for n, part in enumerate(parts):
                                put(part, 2, 2, y - 10 * n, regular, 'start')
                        elif v:
                            put(v, i, i, y, regular, 'end' if i >= 4 else 'start')
                    y -= 11 + 10 * (len(parts) - 1)
            c.setFont(regular, 8)
            c.drawCentredString(width / 2, margin - 8, visual(footer(s, page)))
            c.showPage()
        c.save()
        written.append(target)
    return written


def version():
    import reportlab
    versions = {'reportlab': reportlab.Version}
    from importlib.metadata import PackageNotFoundError
    from importlib.metadata import version as installed
    for name in ('arabic-reshaper', 'python-bidi'):
        try:
            versions[name] = installed(name)
        except PackageNotFoundError:
            pass
    return versions
