"""MuPDF statements for G9: MuPDF's own HTML layout (PyMuPDF Story), its
HarfBuzz shaping and its PDF writer, unrelated to the other writers.

Each statement page is laid out by its own Story in the page's content area,
and the footer by another at the bottom, so the pages are the facts' pages;
a page whose table does not fit is an error here. MuPDF orders text inside a
cell by its bidirectional algorithm but lays table columns out from the left
whatever the direction, so the Arabic story's columns are written in
right-to-left order here, as a writer for an Arabic bank would. It reads
`text-align: left` and `right` as the start and end of a right-to-left block,
so the same words put Arabic text at the right and amounts at the left. MuPDF
draws Arabic in reading order. Its fonts are the families without standard
ligatures (fonts.py). A raster logo, where a story asks for one, is a PNG
drawn here with Pillow from shapes alone. Metadata and dates are fixed.
"""
import html
from pathlib import Path

from common import LABELS, account_line, footer, table_rows

FILES = {'Roboto': 'roboto', 'Lato': 'lato', 'Tajawal': 'tajawal', 'IBM Plex Mono': 'ibm-plex-mono'}
PAPER = {'A4': 'a4', 'Letter': 'letter', 'A4-landscape': 'a4-l'}
SIZE = {'IBM Plex Mono': 7.5}


def esc(text):
    return '<br>'.join(html.escape(part) for part in text.split('\n'))


def logo(folder):
    from PIL import Image, ImageDraw
    image = Image.new('RGB', (160, 48), 'white')
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((2, 2, 46, 46), radius=8, fill=(18, 82, 64))
    draw.polygon([(24, 8), (40, 24), (24, 40), (8, 24)], fill=(236, 196, 92))
    draw.rectangle((56, 14, 154, 20), fill=(18, 82, 64))
    draw.rectangle((56, 28, 120, 34), fill=(120, 140, 132))
    image.save(Path(folder) / 'logo.png', optimize=False)


def css(story):
    st, family = story['recipe']['style'], f"{FILES[story['font']]}-nl"
    size = SIZE.get(story['font'], 8.5)
    rules = {'grid': 'td, th { border: 0.4pt solid #555; }',
             'rows': 'td { border-bottom: 0.3pt solid #b8b8b8; }', 'none': ''}[st['rules']]
    heading = {'rule': 'th { border-bottom: 0.75pt solid #222; }', 'filled': 'th { background-color: #e6ebe8; }'}[st['heading']]
    return (f'@font-face {{ font-family: F; src: url({family}-400.ttf); }} '
            f'@font-face {{ font-family: F; font-weight: bold; src: url({family}-700.ttf); }} '
            f'body {{ font-family: F; font-size: {size}pt; }} '
            'table { border-collapse: collapse; width: 100%; } '
            'th { font-weight: normal; padding: 2pt 3pt; } td { padding: 2pt 3pt; } '
            '.bank { font-size: 13pt; } .title { font-size: 10.5pt; } .account { margin-bottom: 7pt; } '
            f'{rules} {heading}')


def page_html(story, page):
    rtl = story['layout'] == 'ar'
    start, end = 'left', 'right'

    def cell(text, align, span=1, tag='td'):
        colspan = f' colspan="{span}"' if span > 1 else ''
        return f'<{tag}{colspan} style="text-align: {align}">{esc(text)}</{tag}>'

    def row(cells):
        return '<tr>' + ''.join(reversed(cells) if rtl else cells) + '</tr>'
    L = LABELS[story['layout']]
    rows = [row([cell(h, end if i >= 4 else start, tag='th') for i, h in enumerate(L['headers'])])]
    for kind, cells in table_rows(story, page):
        if kind == 'label':
            rows.append(row([cell(cells[0], start, 6), cell(cells[1], end)]))
        elif kind == 'totals':
            rows.append(row([cell(cells[0], start, 4), cell(cells[1], end), cell(cells[2], end), cell('', end)]))
        elif kind == 'continuation':
            rows.append(row([cell('', start), cell('', start), cell(cells[0], start)] + [cell('', end)] * 4))
        else:
            rows.append(row([cell(v, end if i >= 4 else start) for i, v in enumerate(cells)]))
    picture = ('<p><img src="logo.png" style="width: 60pt; height: 18pt"></p>'
               if story['recipe']['style'].get('logo') == 'raster' else '')
    direction = ' dir="rtl"' if rtl else ''
    return (f'<body{direction}>{picture}<p class="bank" style="text-align: {start}">{esc(story["bank"])}</p>'
            f'<p class="title" style="text-align: {start}">{esc(story["documentTitle"])}</p>'
            f'<p class="account" style="text-align: {start}">{esc(account_line(story))}</p>'
            f'<table>{"".join(rows)}</table></body>')


def render(stories, out_dir, fonts, work):
    import pymupdf
    written = []
    for s in stories:
        if s['producer'] != 'mupdf':
            continue
        archive = pymupdf.Archive(str(fonts))
        if s['recipe']['style'].get('logo') == 'raster':
            folder = Path(work) / f"mupdf-{s['id']}"
            folder.mkdir(parents=True, exist_ok=True)
            logo(folder)
            archive.add(str(folder))
        draft = Path(work) / f"mupdf-{s['id']}.pdf"
        writer = pymupdf.DocumentWriter(str(draft))
        style = css(s)
        for page in s['statement']['pages']:
            box = pymupdf.paper_rect(PAPER[s['paper']])
            device = writer.begin_page(box)
            story = pymupdf.Story(html=page_html(s, page), user_css=style, archive=archive)
            more, _ = story.place(box + (40, 36, -40, -64))
            if more:
                raise ValueError(f"{s['id']}: page {page['number']} does not fit")
            story.draw(device)
            foot = pymupdf.Story(html=f'<p style="text-align: center; font-size: 8pt">{esc(footer(s, page))}</p>',
                                 user_css=style, archive=archive)
            foot.place(pymupdf.Rect(box.x0 + 40, box.y1 - 46, box.x1 - 40, box.y1 - 24))
            foot.draw(device)
            writer.end_page()
        writer.close()
        doc = pymupdf.open(str(draft))
        doc.set_metadata({'creator': f'MuPDF {pymupdf.VersionFitz} Story', 'producer': f'PyMuPDF {pymupdf.VersionBind}',
                          'title': f"{s['documentTitle']} {s['statement']['account']}",
                          'creationDate': 'D:20261023000000Z', 'modDate': 'D:20261023000000Z'})
        target = Path(out_dir) / f"{s['id']}-statement.pdf"
        doc.save(str(target), garbage=3, deflate=True, no_new_id=True)
        written.append(target)
    return written


def version():
    import pymupdf
    return {'mupdf': pymupdf.VersionFitz, 'pymupdf': pymupdf.VersionBind}
