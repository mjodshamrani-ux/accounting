"""The G17 cairo application: statements drawn with cairo's PDF surface.

A statement program of the kind a GTK or Pango application is: it lays out
its own table and draws each line of text as glyph runs on cairo's PDF
surface, through the system libcairo (1.18) and libfreetype. Each run is
shaped by HarfBuzz (uharfbuzz) and given to cairo_show_text_glyphs with its
text and clusters, so cairo writes each subset font's ToUnicode map, and
marked content where a glyph stands for other text, from the clusters, as it
does for Pango.

- **Order:** a line is put in display order by the Unicode Bidirectional
  Algorithm (python-bidi, which wraps the unicode-bidi crate), right to left
  as its base direction in an Arabic statement.
- **Fonts:** a family's Arabic and Latin files are kept apart; each
  character is drawn with the first file whose cmap covers it, Arabic first
  for an Arabic family, as fontconfig offers fallback fonts per run. A
  date in Arabic-Indic digits takes its digits from the Arabic file and its
  hyphens from the Latin one.
- **Runs:** consecutive characters of one file and one direction make one
  run. A run holding an Arabic letter is shaped right to left from its
  logical text, its glyphs laid out left to right and its clusters marked
  backward; every other run is shaped left to right.
- **Table:** columns from the start edge (the right in Arabic), a heading
  row filled, grey or ruled, rules as a grid, under each row, as stripes or
  none; descriptions wrapped by word to their cell, each wrapped line
  ordered by itself; control lines with their label across the first four
  columns; a continuation in the description column; the footer as the
  facts number the page.

The document dates are set through cairo_pdf_surface_set_metadata, so the
bytes do not depend on the clock.

  PYTHONPATH=<uharfbuzz, python-bidi> python3 -B render_cairo.py <fonts dir> <out dir> [story ids]
"""
import ctypes
import ctypes.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import uharfbuzz as hb  # noqa: E402
from bidi import get_display  # noqa: E402

import fonts as font_files  # noqa: E402
from common import LABELS, account_line, digits_of, footer, table_rows  # noqa: E402

STAMP = '2028-01-31T12:00:00Z'
PAPER = {'A4': (595.28, 841.89), 'Letter': (612.0, 792.0), 'A4-landscape': (841.89, 595.28)}
HEADING = {'filled': None, 'grey': (0.86, 0.86, 0.86), 'rule': None}
FILLS = {'Readex Pro': (0.36, 0.36, 0.36), 'Rubik': (0.11, 0.19, 0.42), 'Alexandria': (0.08, 0.36, 0.22),
         'Public Sans': (0.47, 0.11, 0.16), 'Work Sans': (0.15, 0.3, 0.45), 'Source Code Pro': (0.2, 0.2, 0.2)}
STRIPE = (0.94, 0.95, 0.96)
WIDTHS = (0.1, 0.1, 0.3, 0.17, 0.11, 0.11, 0.11)
BACKWARD = 1
CAIRO_PDF_METADATA = {'title': 0, 'author': 1, 'creator': 4, 'created': 5, 'modified': 6}


class Glyph(ctypes.Structure):
    _fields_ = [('index', ctypes.c_ulong), ('x', ctypes.c_double), ('y', ctypes.c_double)]


class Cluster(ctypes.Structure):
    _fields_ = [('num_bytes', ctypes.c_int), ('num_glyphs', ctypes.c_int)]


def libraries():
    cairo = ctypes.CDLL(ctypes.util.find_library('cairo'))
    ft = ctypes.CDLL(ctypes.util.find_library('freetype'))
    p, d, i, s = ctypes.c_void_p, ctypes.c_double, ctypes.c_int, ctypes.c_char_p
    for name, args, res in [
        ('cairo_pdf_surface_create', [s, d, d], p), ('cairo_pdf_surface_set_size', [p, d, d], None),
        ('cairo_pdf_surface_set_metadata', [p, i, s], None), ('cairo_create', [p], p),
        ('cairo_set_source_rgb', [p, d, d, d], None), ('cairo_rectangle', [p, d, d, d, d], None),
        ('cairo_fill', [p], None), ('cairo_stroke', [p], None), ('cairo_move_to', [p, d, d], None),
        ('cairo_line_to', [p, d, d], None), ('cairo_set_line_width', [p, d], None),
        ('cairo_set_font_face', [p, p], None), ('cairo_set_font_size', [p, d], None),
        ('cairo_show_text_glyphs', [p, s, i, ctypes.POINTER(Glyph), i, ctypes.POINTER(Cluster), i, i], None),
        ('cairo_show_page', [p], None), ('cairo_destroy', [p], None), ('cairo_status', [p], i),
        ('cairo_surface_finish', [p], None), ('cairo_surface_destroy', [p], None),
        ('cairo_surface_status', [p], i), ('cairo_ft_font_face_create_for_ft_face', [p, i], p),
        ('cairo_version_string', [], s),
    ]:
        fn = getattr(cairo, name)
        fn.argtypes, fn.restype = args, res
    ft.FT_Init_FreeType.argtypes = [ctypes.POINTER(p)]
    ft.FT_New_Face.argtypes = [p, s, ctypes.c_long, ctypes.POINTER(p)]
    return cairo, ft


class Face:
    """One font file: HarfBuzz for shaping, cairo through FreeType for
    drawing, the cmap for coverage."""

    def __init__(self, cairo, ft, library, path):
        from fontTools.ttLib import TTFont
        self.path = Path(path)
        self.cmap = set(TTFont(str(path)).getBestCmap())
        hb_face = hb.Face(hb.Blob.from_file_path(str(path)))
        self.upem = hb_face.upem
        self.hb = hb.Font(hb_face)
        face = ctypes.c_void_p()
        if ft.FT_New_Face(library, str(path).encode(), 0, ctypes.byref(face)):
            raise OSError(f'FreeType cannot open {path}')
        self.ft_face = face
        self.cairo = cairo.cairo_ft_font_face_create_for_ft_face(face, 0)

    def covers(self, ch):
        return ord(ch) in self.cmap


def is_arabic_letter(ch):
    o = ord(ch)
    return (0x0621 <= o <= 0x064A) or (0x066E <= o <= 0x06D3) or ch in '،؛؟ـ' or (0x064B <= o <= 0x065F)


class Writer:
    def __init__(self, story, fonts_dir):
        self.story = story
        self.cairo, self.ft = libraries()
        library = ctypes.c_void_p()
        if self.ft.FT_Init_FreeType(ctypes.byref(library)):
            raise OSError('FreeType did not start')
        self.library = library
        self.faces = {w: [Face(self.cairo, self.ft, library, p) for p in font_files.files_of(fonts_dir, story['font'], w)]
                      for w in ('400', '700')}
        self.rtl = story['layout'] == 'ar'
        self.width, self.height = PAPER[story['paper']]
        self.size = 7.6 if story['paper'] == 'A4-landscape' else 7.2
        if story['font'] == 'Source Code Pro':
            self.size = 6.6

    # Text: bidi order, font fallback, runs, shaping.

    def runs(self, text, weight):
        """The line in display order as runs: (face, direction, logical text)."""
        visual = get_display(text, base_dir='R' if self.rtl else 'L')
        faces = self.faces[weight]
        out = []
        for ch in visual:
            face = next((f for f in faces if f.covers(ch)), faces[-1])
            if is_arabic_letter(ch):
                direction = 'rtl'
            elif ch.isspace() and out and out[-1][0] is face:
                direction = out[-1][1]
            else:
                direction = 'ltr'
            if out and out[-1][0] is face and out[-1][1] == direction:
                out[-1][2].append(ch)
            else:
                out.append((face, direction, [ch]))
        runs = []
        for face, direction, chars in out:
            visual_text = ''.join(chars)
            runs.append((face, direction, visual_text[::-1] if direction == 'rtl' else visual_text))
        return runs

    def shaped(self, face, direction, text):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.direction = direction
        if direction == 'rtl':
            buf.script, buf.language = 'Arab', 'ar'
        else:
            buf.guess_segment_properties()
            buf.direction = 'ltr'
        hb.shape(face.hb, buf, {})
        return buf.glyph_infos, buf.glyph_positions

    def measure(self, text, weight='400', size=None):
        size = size or self.size
        total = 0.0
        for face, direction, run in self.runs(text, weight):
            _, positions = self.shaped(face, direction, run)
            total += sum(p.x_advance for p in positions) * size / face.upem
        return total

    def draw_text(self, cr, text, x, baseline, weight='400', size=None, align='start', width=None, rgb=(0, 0, 0)):
        """Draws one line of text: from x at the start edge of a box of
        `width`, aligned to its start or end; in an Arabic statement the
        start edge is the right."""
        size = size or self.size
        if width is not None:
            w = self.measure(text, weight, size)
            if align == 'end':
                x = x + width - w if not self.rtl else x
            else:
                x = x if not self.rtl else x + width - w
        c = self.cairo
        c.cairo_set_source_rgb(cr, *rgb)
        c.cairo_set_font_size(cr, size)
        pen = x
        for face, direction, run in self.runs(text, weight):
            infos, positions = self.shaped(face, direction, run)
            scale = size / face.upem
            glyphs = (Glyph * len(infos))()
            for k, (info, pos) in enumerate(zip(infos, positions)):
                glyphs[k] = Glyph(info.codepoint, pen + pos.x_offset * scale, baseline - pos.y_offset * scale)
                pen += pos.x_advance * scale
            # Clusters in logical order: each cluster's bytes and glyphs.
            starts = sorted({i.cluster for i in infos})
            counts = {s: 0 for s in starts}
            for info in infos:
                counts[info.cluster] += 1
            ends = starts[1:] + [len(run)]
            clusters = (Cluster * len(starts))()
            for k, (a, b) in enumerate(zip(starts, ends)):
                clusters[k] = Cluster(len(run[a:b].encode('utf-8')), counts[a])
            data = run.encode('utf-8')
            c.cairo_set_font_face(cr, face.cairo)
            c.cairo_set_font_size(cr, size)
            c.cairo_show_text_glyphs(cr, data, len(data), glyphs, len(infos), clusters, len(starts),
                                     BACKWARD if direction == 'rtl' else 0)

    def wrap(self, text, width, weight='400'):
        """Words of the logical text, wrapped to the width."""
        lines, line = [], []
        for word in text.split():
            candidate = ' '.join(line + [word])
            if line and self.measure(candidate, weight) > width:
                lines.append(' '.join(line))
                line = [word]
            else:
                line.append(word)
        if line:
            lines.append(' '.join(line))
        return lines or ['']

    # Pages.

    def amounts(self, k):
        """Amounts and balances stand at the right edge of their cells, as do
        their headings; in an Arabic statement every cell starts at its right
        edge."""
        return 'end' if k >= 4 and not self.rtl else 'start'

    def columns(self, left, right):
        """Cell boxes (x, width) in logical column order."""
        total = right - left
        widths = [w * total for w in WIDTHS]
        out, x = [], left
        for w in widths:
            out.append([x, w])
            x += w
        if self.rtl:
            out = [[left + right - (x + w), w] for x, w in out]
        return out

    def line(self, cr, x0, y0, x1, y1, width=0.5, rgb=(0.35, 0.35, 0.35)):
        c = self.cairo
        c.cairo_set_source_rgb(cr, *rgb)
        c.cairo_set_line_width(cr, width)
        c.cairo_move_to(cr, x0, y0)
        c.cairo_line_to(cr, x1, y1)
        c.cairo_stroke(cr)

    def fill(self, cr, x, y, w, h, rgb):
        c = self.cairo
        c.cairo_set_source_rgb(cr, *rgb)
        c.cairo_rectangle(cr, x, y, w, h)
        c.cairo_fill(cr)

    def page(self, cr, page):
        story, style = self.story, self.story['recipe']['style']
        L, d = LABELS[story['layout']], digits_of(story)
        margin = 34.0
        left, right = margin, self.width - margin
        start = right if self.rtl else left
        y = margin + 14
        self.draw_text(cr, story['bank'], left, y, '700', 13.5, width=right - left)
        y += 17
        self.draw_text(cr, story['documentTitle'], left, y, '400', 10.5, width=right - left)
        y += 15
        self.draw_text(cr, account_line(story), left, y, '400', 8.2, width=right - left)
        y += 14
        cols = self.columns(left, right)
        pad = 3.2
        lh = self.size * 1.25
        rules, heading = style.get('rules', 'grid'), style.get('heading', 'rule')
        # Heading row.
        head_h = lh + 2 * pad + 2
        fill = FILLS.get(story['font'], (0.2, 0.3, 0.45)) if heading == 'filled' else HEADING.get(heading)
        if fill:
            self.fill(cr, left, y, right - left, head_h, fill)
        ink = (1, 1, 1) if heading == 'filled' else (0, 0, 0)
        for k, (x, w) in enumerate(cols):
            align = self.amounts(k) if style.get('headings') != 'left' else 'start'
            self.draw_text(cr, L['headers'][k], x + pad, y + pad + self.size, '700', width=w - 2 * pad,
                           align=align, rgb=ink)
        top = y
        y += head_h
        if heading == 'rule' or rules in ('rows', 'none'):
            self.line(cr, left, y, right, y, 0.8, (0, 0, 0))
        # Body.
        bounds = []  # (top, bottom, spanned) of each body row
        for n, (kind, cells) in enumerate(table_rows(story, page)):
            row_top = y
            if kind == 'movement':
                wrapped = self.wrap(cells[2], cols[2][1] - 2 * pad)
                h = max(1, len(wrapped)) * lh + 2 * pad
                if rules == 'stripes' and n % 2:
                    self.fill(cr, left, y, right - left, h, STRIPE)
                base = y + pad + self.size
                for k, (x, w) in enumerate(cols):
                    if k == 2:
                        for i, part in enumerate(wrapped):
                            self.draw_text(cr, part, x + pad, base + i * lh, width=w - 2 * pad)
                    else:
                        self.draw_text(cr, cells[k], x + pad, base, width=w - 2 * pad, align=self.amounts(k))
            elif kind == 'continuation':
                # The text continues the description above it, in its column.
                wrapped = self.wrap(cells[0], cols[2][1] - 2 * pad)
                h = len(wrapped) * lh + 2 * pad
                if rules == 'stripes' and n % 2:
                    self.fill(cr, left, y, right - left, h, STRIPE)
                for i, part in enumerate(wrapped):
                    self.draw_text(cr, part, cols[2][0] + pad, y + pad + self.size + i * lh, width=cols[2][1] - 2 * pad)
            else:
                h = lh + 2 * pad
                if rules == 'stripes' and n % 2:
                    self.fill(cr, left, y, right - left, h, STRIPE)
                base = y + pad + self.size
                span_x = min(cols[0][0], cols[3][0])
                span_w = (cols[3][0] + cols[3][1] - cols[0][0]) if not self.rtl else (cols[0][0] + cols[0][1] - cols[3][0])
                weight = '700' if kind in ('label', 'totals') else '400'
                self.draw_text(cr, cells[0], span_x + pad, base, weight, width=span_w - 2 * pad)
                if kind == 'label':
                    x, w = cols[6]
                    self.draw_text(cr, cells[1], x + pad, base, weight, width=w - 2 * pad, align=self.amounts(6))
                elif kind == 'totals':
                    for k, value in ((4, cells[1]), (5, cells[2])):
                        x, w = cols[k]
                        self.draw_text(cr, value, x + pad, base, weight, width=w - 2 * pad, align=self.amounts(k))
            y += h
            bounds.append((row_top, y, kind in ('label', 'totals')))
            if rules == 'rows':
                self.line(cr, left, y, right, y, 0.4)
        if rules == 'grid':
            # Each row's own column edges: a control line's label spans the
            # first four columns, so no edge is drawn through it.
            for edge in [top, top + head_h] + [b for _, b, _ in bounds]:
                self.line(cr, left, edge, right, edge, 0.5)
            every = sorted({x for x, _ in cols} | {x + w for x, w in cols})
            inside = {cols[k][0] for k in (1, 2, 3)} if not self.rtl else {cols[k][0] + cols[k][1] for k in (1, 2, 3)}
            for x in every:
                self.line(cr, x, top, x, top + head_h, 0.5)
            for row_top, row_bottom, spanned in bounds:
                for x in every:
                    if not (spanned and x in inside):
                        self.line(cr, x, row_top, x, row_bottom, 0.5)
        if y > self.height - margin - 20:
            raise ValueError(f"{story['id']} page {page['number']}: the table runs off the page")
        self.draw_text(cr, footer(story, page), left, self.height - margin + 4, '400', 8, width=right - left,
                       align='end')

    def write(self, path):
        c, story = self.cairo, self.story
        surface = c.cairo_pdf_surface_create(str(path).encode(), self.width, self.height)
        for key, value in (('title', f"{story['documentTitle']} {story['statement']['account']}"),
                           ('author', story['bank']), ('creator', 'G17 statement application (cairo)'),
                           ('created', STAMP), ('modified', STAMP)):
            c.cairo_pdf_surface_set_metadata(surface, CAIRO_PDF_METADATA[key], value.encode('utf-8'))
        cr = c.cairo_create(surface)
        for page in story['statement']['pages']:
            self.page(cr, page)
            c.cairo_show_page(cr)
        status = c.cairo_status(cr)
        c.cairo_destroy(cr)
        c.cairo_surface_finish(surface)
        status = status or c.cairo_surface_status(surface)
        c.cairo_surface_destroy(surface)
        if status:
            raise OSError(f"cairo status {status} for {story['id']}")


def version():
    cairo, _ = libraries()
    return cairo.cairo_version_string().decode()


def draw(stories, fonts_dir, out):
    """Draws every cairo story; returns [(story, path)]."""
    drawn = []
    for story in stories:
        if story['producer'] != 'cairo':
            continue
        path = Path(out) / f"{story['id']}-statement.pdf"
        Writer(story, fonts_dir).write(path)
        drawn.append((story, path))
    return drawn


if __name__ == '__main__':
    from stories import build
    wanted = set(sys.argv[3:])
    print([s['id'] for s, _ in draw([s for s in build() if not wanted or s['id'] in wanted], sys.argv[1], sys.argv[2])])
