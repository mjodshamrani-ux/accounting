"""G21: the guarded reader's test of adjacent rows, before the seal, in the
three forms its history gave it.

layoutPdfPage (pdf.ts) joins the PDF.js items with text into lines, as
items.py's lines() does, and refuses a line one of whose boxes overlaps a
box of a line above or below it by more than 0.2 points both ways ('تتداخل
نصوص من صفوف متجاورة'). Which box stands for an item changed twice:

  - metric: the item's box by its font's ascent and descent, as PDF.js
    gives them in the text content's styles (glyphBounds). The reader judged
    so before G8, and still does for an item whose glyph outlines it cannot
    prove;
  - ink: since G8, the item's width over its glyphs' ink, from the lowest to
    the highest outline it draws, 0.01 em around (inkClipBoxes), wherever
    every glyph's outline is proved and no text on the page is raised or
    lowered (Ts);
  - glyph: since G10, each glyph's own ink box, 0.01 em around
    (glyphInkBoxes), wherever every glyph's outline and placement is proved.

The reader today uses glyph, else ink, else metric. A statement whose lines
the reader keeps but the metric form refuses needs rows by ink (G8); one the
ink form refuses, rows by glyph boxes (G10). The ablation script switches
each rule off in a private copy of the product; measure_rows.mjs compares the
lines each form refuses here with the lines the product refuses with the
same rule off, statement by statement.

The fonts' ascent and descent are PDF.js's: a TrueType or OpenType program's
hhea ascent and descent over its units per em (PDF.js reads them when it
repairs the program), else the font descriptor's Ascent and Descent in
thousandths, else, for a standard font without either, PDF.js's standard
metrics. A glyph's outline box is read from the embedded program with
fontTools, by the glyph PDF.js draws for the code: a Type0 font's CID through
its CIDToGIDMap (TrueType) or its CFF charset (CID-keyed CFF); a simple
TrueType font's code through its cmap, (3,0) for a symbolic font, else (3,1)
by the encoding's glyph name, else (1,0); a simple CFF font's code by the
encoding's glyph name in its charset, never by the text layer. A font
without an embedded program, or one modelled no further (Type1), or a table
fontTools cannot read, proves no outline.

  PYTHONPATH=<pymupdf 2.0, fontTools> python3 -B rows.py <statement.pdf> ...
"""
import io
import json
import logging
import math
import sys
from pathlib import Path

import pymupdf

import items as pdfjs

# A subset's tables a little longer than declared are read as PDF.js reads
# them; fontTools's warnings about them are not findings.
logging.getLogger('fontTools').setLevel(logging.ERROR)

ROOT = Path(__file__).resolve().parent.parent.parent
PDF = ROOT / 'lib' / 'reconciliation' / 'pdf.ts'
GEOMETRY = ROOT / 'lib' / 'reconciliation' / 'pdf-glyph-geometry.ts'
MARGIN = 0.01   # GLYPH_INK_MARGIN, in em
PLACED = 0.5    # how far glyphInkBoxes lets a placement leave the item
GAP = 0.2       # the overlap both ways that refuses the rows
REASON = 'تتداخل نصوص من صفوف متجاورة، لذلك لا يمكن التحقق من صحة القراءة.'
SOURCE = ('const ascent = token.ascent ?? 0.8;',
          'const descent = token.descent ?? -0.2;',
          'const GLYPH_INK_MARGIN = 0.01;',
          '.flatMap((t) => glyphs?.get(t) ?? [ink?.get(t) ?? glyphBounds(t)])',
          'a[0] < b[2] - 0.2 &&',
          'lines[j].y - lines[i].y <= reach * 2',
          'Math.abs(at.y - run.baseline) > 0.5',
          'Math.abs(left - padded[0]) <= 0.5 &&',
          'const widthScale = size * 0.001;',
          'return inkBoxes.map((box, i) => (box === textBoxes[i] ? undefined : box));',
          "fn.some((op, i) => op === ops.setTextRise && Number(args[i]?.[0]) !== 0)",
          REASON)
# PDF.js's metrics for the standard fonts it substitutes (fallbackToSystemFont).
STANDARD = {'Courier': (629, -157), 'Helvetica': (718, -207), 'Times': (683, -217)}
FORMS = ('metric', 'ink', 'glyph')


def drift():
    text = PDF.read_text(encoding='utf-8') + GEOMETRY.read_text(encoding='utf-8')
    return [s for s in SOURCE if s not in text]


def stream(doc, holder, key):
    kind, value = doc.xref_get_key(holder, key)
    return int(value.split()[0]) if kind == 'xref' else None


class Face:
    """A Font's metrics and outlines as PDF.js has them."""

    def __init__(self, doc, font):
        self.font, self.program, self.kind, self.cff, self.ttf = font, None, None, None, None
        self.ascent = self.descent = math.nan
        desc = font.desc
        self.flags = 0
        if desc is not None:
            kind, value = doc.xref_get_key(desc, 'Flags')
            self.flags = int(float(value)) if kind in ('int', 'float') else 0
            for key, attr in (('Ascent', 'ascent'), ('Descent', 'descent')):
                kind, value = doc.xref_get_key(desc, key)
                if kind in ('int', 'float'):
                    setattr(self, attr, float(value) / 1000)
            for key in ('FontFile2', 'FontFile3', 'FontFile'):
                x = stream(doc, desc, key)
                if x is not None:
                    self.program, self.kind = doc.xref_stream(x), key
                    if key == 'FontFile3':
                        self.kind = doc.xref_get_key(x, 'Subtype')[1].lstrip('/')
                    break
        from fontTools.ttLib import TTFont
        if self.kind in ('FontFile2', 'OpenType'):
            self.ttf = TTFont(io.BytesIO(self.program), lazy=True)
            # Glyphs by index, as PDF.js draws them: names from a subset's
            # cmap or post table play no part (and some cmaps do not parse).
            self.ttf.setGlyphOrder([f'g{i}' for i in range(self.ttf['maxp'].numGlyphs)])
            upem = self.ttf['head'].unitsPerEm
            self.ascent, self.descent = self.ttf['hhea'].ascent / upem, self.ttf['hhea'].descent / upem
            if 'CFF ' in self.ttf:
                self.cff = self.ttf['CFF '].cff
        elif self.kind in ('Type1C', 'CIDFontType0C'):
            from fontTools.cffLib import CFFFontSet
            self.cff = CFFFontSet()
            self.cff.decompile(io.BytesIO(self.program), None)
        elif self.program is None and math.isnan(self.ascent):
            base = font.name.split('+')[-1]
            family = next((f for f in STANDARD if base.startswith(f)), None)
            if family:
                self.ascent, self.descent = (v / 1000 for v in STANDARD[family])
        # Whether the font dictionary names an encoding (a simple font).
        self.declared = doc.xref_get_key(font.xref, 'Encoding')[0] != 'null'
        self.cid_gid = None
        if font.composite and self.ttf is not None:
            x = stream(doc, font.holder, 'CIDToGIDMap')
            if x is not None:
                table = doc.xref_stream(x)
                self.cid_gid = [int.from_bytes(table[i:i + 2], 'big') for i in range(0, len(table) - 1, 2)]
        # PDF.js scales a CFF font's widths by its FontMatrix (adjustWidths)
        # and keeps the matrix; the reader's glyph placement takes them as
        # thousandths of an em, so its advances run this many times too far.
        self.advance_scale = 1.0
        if self.cff is not None:
            top = self.cff[self.cff.fontNames[0]]
            m = getattr(top, 'FontMatrix', None)
            if m and m[0] and abs(m[0] - 0.001) > 1e-9:
                self.advance_scale = 0.001 / m[0]
        self.cache = {}

    def outline(self, code):
        """The glyph's outline box in em, or None where PDF.js proves none."""
        if code not in self.cache:
            try:
                self.cache[code] = self._outline(code)
            except (KeyError, IndexError, AttributeError, ValueError):
                # A table fontTools cannot read proves nothing here.
                self.cache[code] = None
        return self.cache[code]

    def _outline(self, code):
        font = self.font
        if self.cff is not None:
            from fontTools.pens.boundsPen import ControlBoundsPen
            top = self.cff[self.cff.fontNames[0]]
            strings = top.CharStrings
            # PDF.js reads a code of a CID-keyed program as a CID, through
            # its charset, whether the font is composite or simple.
            if hasattr(top, 'ROS'):
                name = f'cid{code:05d}'
            elif font.composite:
                name = top.charset[code]
            else:
                name = self.glyph_name(code)
            if name not in strings:
                return None
            # The reader bounds the path PDF.js sends, control points and all.
            pen = ControlBoundsPen(strings)
            strings[name].draw(pen)
            box = pen.bounds
            matrix = getattr(top, 'FontMatrix', [0.001, 0, 0, 0.001, 0, 0])
            if box is None:
                return None
            return (box[0] * matrix[0], box[1] * matrix[3], box[2] * matrix[0], box[3] * matrix[3])
        if self.ttf is None:
            return None
        order = self.ttf.getGlyphOrder()
        if font.composite:
            gid = self.cid_gid[code] if self.cid_gid is not None else code
        else:
            gid = self.simple_gid(code)
        if gid is None or gid >= len(order):
            return None
        glyph = self.ttf['glyf'][order[gid]]
        if not hasattr(glyph, 'xMin') or glyph.numberOfContours == 0:
            return None
        upem = self.ttf['head'].unitsPerEm
        return (glyph.xMin / upem, glyph.yMin / upem, glyph.xMax / upem, glyph.yMax / upem)

    def glyph_name(self, code):
        """The name PDF.js draws a simple font's code by: its Differences,
        else its declared encoding's name for the code, else the program's
        own encoding. The text layer (ToUnicode) plays no part."""
        from fontTools.agl import UV2AGL
        from fontTools.encodings.StandardEncoding import StandardEncoding
        font = self.font
        if code in font.differences:
            return font.differences[code]
        encoding = font.encoding if self.declared else None
        if encoding is None and self.cff is not None:
            own = self.cff[self.cff.fontNames[0]].Encoding
            if isinstance(own, list):
                return own[code]
            encoding = 'StandardEncoding'
        if encoding == 'StandardEncoding':
            return StandardEncoding[code]
        try:
            ch = bytes([code]).decode(pdfjs.ENCODINGS.get(encoding, 'cp1252'))
        except UnicodeDecodeError:
            return None
        return UV2AGL.get(ord(ch))

    def simple_gid(self, code):
        cmaps = {(t.platformID, t.platEncID): t.cmap for t in self.ttf['cmap'].tables}
        order = self.ttf.getGlyphOrder()
        index = {name: i for i, name in enumerate(order)}
        if self.flags & 4 and (3, 0) in cmaps:   # a symbolic font
            table = cmaps[(3, 0)]
            name = table.get(0xF000 | code) or table.get(code)
            return index.get(name)
        if (3, 1) in cmaps:
            ch = self.font.text(code)
            name = cmaps[(3, 1)].get(ord(ch)) if ch else None
            if name is not None:
                return index.get(name)
        if (1, 0) in cmaps:
            return index.get(cmaps[(1, 0)].get(code))
        return None

def faces(doc, page_items):
    """{id(Font): Face} for every font the items name."""
    out = {}
    for item in page_items:
        for font in [item.face] + [mark[0] for mark in item.marks]:
            if font is not None and id(font) not in out:
                out[id(font)] = Face(doc, font)
    return out


def metric_box(item, face):
    """glyphBounds: the item's box by its style's ascent and descent."""
    ascent = 0.8 if face is None else face.ascent
    descent = -0.2 if face is None else face.descent
    if not (math.isfinite(ascent) and math.isfinite(descent) and ascent > descent):
        return None
    return [item.x, item.y + item.height * descent, item.x + item.width, item.y + item.height * ascent]


def glyph_boxes(item, found):
    """glyphInkBoxes: each glyph's ink box, 0.01 em around its outline,
    carried by its own matrix; None where a glyph has no proved outline, or
    its placement leaves the item's baseline (text rise included), or the
    placements do not reproduce the item's extent, each by more than 0.5."""
    out = []
    if not item.marks:
        return None
    for font, code, m, *_ in item.marks:
        o = found[id(font)].outline(code)
        if o is None or abs(m[5] - item.y) > PLACED:
            return None
        corners = [(o[0] - MARGIN, o[1] - MARGIN), (o[0] - MARGIN, o[3] + MARGIN),
                   (o[2] + MARGIN, o[1] - MARGIN), (o[2] + MARGIN, o[3] + MARGIN)]
        pts = [(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]) for x, y in corners]
        out.append([min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)])
    left, right = min(mark[3] for mark in item.marks), max(mark[4] for mark in item.marks)
    # Where the reader's advances run long (a CFF FontMatrix), its last
    # placement ends that much further on.
    right += sum(mark[6] * (found[id(mark[0])].advance_scale - 1) for mark in item.marks)
    if abs(left - item.x) > PLACED or abs(right - (item.x + item.width)) > PLACED:
        return None
    return out


def ink_box(item, found):
    """inkClipBoxes: the item's width over its glyphs' lowest and highest ink,
    0.01 em around, in units of the item's size."""
    low, high = math.inf, -math.inf
    for font, code, *_ in item.marks:
        o = found[id(font)].outline(code)
        if o is None:
            return None
        low, high = min(low, o[1]), max(high, o[3])
    if not item.marks or not math.isfinite(low):
        return None
    return [item.x, item.y + item.height * (low - MARGIN), item.x + item.width, item.y + item.height * (high + MARGIN)]


def bounds(item, found, form, raised):
    """The boxes the reader tests the item by in the form: its glyphs' boxes
    (glyph), else its ink box unless the page raises text (glyph, ink), else
    its metric box."""
    if form == 'glyph':
        boxes = glyph_boxes(item, found)
        if boxes:
            return boxes
    if form != 'metric' and not raised:
        box = ink_box(item, found)
        if box is not None:
            return [box]
    return [metric_box(item, found.get(id(item.face)))]


def refused(lines, boxes):
    """The reader's search (layoutPdfPage): the line indices whose boxes
    overlap a box of a line within reach by more than 0.2 points both
    ways. A line's y is its first item's, the highest."""
    ys = [max(t.y for t in line) for line in lines]
    widest = [max((b[2] - b[0] for b in line), default=0) for line in boxes]
    reach = 0.0
    for y, line_boxes in zip(ys, boxes):
        for b in line_boxes:
            reach = max(reach, abs(b[1] - y), abs(b[3] - y))
    out = set()
    for i in range(1, len(lines)):
        j = i - 1
        while j >= 0 and ys[j] - ys[i] <= reach * 2:
            start = 0
            hit = False
            for a in boxes[i]:
                while start < len(boxes[j]) and boxes[j][start][0] < a[0] - widest[j]:
                    start += 1
                for b in boxes[j][start:]:
                    if b[0] >= a[2]:
                        break
                    if a[0] < b[2] - GAP and a[2] > b[0] + GAP and a[1] < b[3] - GAP and a[3] > b[1] + GAP:
                        out.update((i, j))
                        hit = True
                        break
                if hit:
                    break
            j -= 1
    return out


def raised_text(doc, pno):
    """Whether the page sets a text rise other than zero (Ts)."""
    data = b'\n'.join(doc.xref_stream(x) for x in doc[pno].get_contents())
    operands = []
    for m in pdfjs.tounicode.TOKEN.finditer(data):
        t = m.group()
        if pdfjs.tounicode.NUMBER.fullmatch(t):
            operands.append(float(t))
            continue
        if t == b'Ts' and operands and operands[-1] != 0:
            return True
        operands = []
    return False


def check_page(doc, pno):
    """{form: [1-based line numbers refused]} for the page, the lines as the
    reader numbers them; or {form: 'unprovable'} where an item's style has no
    ascent and descent the reader can use, for the reader stops there before
    it lays the page out."""
    page_items = pdfjs.page_items(doc, pno)
    lines = pdfjs.lines(page_items)
    found = faces(doc, page_items)
    if any(metric_box(t, found.get(id(t.face))) is None for line in lines for t in line):
        return {form: 'unprovable' for form in FORMS}
    raised = raised_text(doc, pno)
    out = {}
    for form in FORMS:
        boxes = [sorted((b for t in line for b in bounds(t, found, form, raised)), key=lambda b: b[0])
                 for line in lines]
        out[form] = sorted(i + 1 for i in refused(lines, boxes))
    return out


def check_pdf(path):
    with pymupdf.open(str(path)) as doc:
        pages = []
        for pno in range(doc.page_count):
            try:
                pages.append(check_page(doc, pno))
            except pdfjs.Unmodelled as e:
                pages.append({'unmodelled': str(e)})
        return pages


def main(paths):
    json.dump({p: check_pdf(p) for p in paths}, sys.stdout)


if __name__ == '__main__':
    main(sys.argv[1:])
