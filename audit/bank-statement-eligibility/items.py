"""PDF.js's text items of a page, reproduced before the seal, and the guarded
reader's refusal of text that overlaps in a line.

The reader lays each page out without column cuts (projectNativePdfSource
calls layoutPdfPage with none, pdf.ts): its PDF.js text items with text are
joined into lines by baseline, an item within min(1, height / 8) of the
line's first; each line is sorted by x, and an item that starts more than
0.2 points before the end of the item before it refuses the line ('توجد
نصوص متداخلة'). G17's V09 was refused so and G6's H03 before it, and no
check before the seal saw either: the overlap is between PDF.js's items,
and MuPDF's characters cannot say where PDF.js ends one. Two subsets of one
font are one name to MuPDF and two fonts to PDF.js, which starts an item
where the page changes between them (DEV-66).

So the items are built here from the content stream as PDF.js's
getTextContent builds them, with the options the reader passes
(disableNormalization, no marked content, white space not kept):

  - the text state is PDF.js's: q and Q save and restore all of it, the
    text matrix included; Tm, Td, TD, T*, Tc, Tw, Tz, TL, Ts, Tf; Tj, TJ, '
    and ";
  - a TJ number ends the string before it, which takes it as extra spacing
    after its last glyph; a number with no string before it moves by itself
    and the character spacing;
  - each glyph's advance is its font's width for its code (Widths, W,
    MissingWidth, DW; a standard font without Widths by its standard
    metrics, here MuPDF's built-in faces), times the size and Tz;
  - white space (a glyph whose text starts with one) is not an item's: it
    moves by its advance and the word spacing and is remembered as the last
    character; a format mark (Cf at the end) is skipped without moving;
  - before each other glyph, the gap from the end of the item's last glyph,
    in em of the item's size: back more than 0.2 ends the item; across the
    line more than the size ends the line; up to 0.03 forgets a space; up
    to 0.102 is part of the item, unless a space was the last character, when
    the item ends there; past 0.6 ends the item; and a shift across the line
    of more than a quarter of the size ends it after the glyph;
  - a change of size, or of font where the resource name and the font's own
    name (with its subset tag) both change, ends the item; so do BMC, BDC,
    EMC and Do;
  - a glyph whose origin lies outside the page's view is not shown.

An item's place is its first glyph's origin, its width the sum of its
advances and the gaps inside it. Nothing is imported from the product or
from PDF.js; the reader's refusal is checked against its source text
(drift), and the item model against the product's own items in
measure_items.mjs. What this model does not know (a Type3 or vertical font,
a composite font not Identity-H, a form or inline image, a font set by a
graphics state) it names as unmodelled rather than guess.
"""
import json
import math
import re
import sys
import unicodedata
from pathlib import Path

import pymupdf

import tounicode

ROOT = Path(__file__).resolve().parent.parent.parent
PDF = ROOT / 'lib' / 'reconciliation' / 'pdf.ts'
# The PDF.js the reader runs, as scripts/prepare-native-pdf.mjs writes it
# from the locked unpdf package (generated, not committed).
PDFJS = ROOT / 'lib' / 'reconciliation' / 'pdfjs-native.generated.mjs'
OVERLAP = 0.2       # layoutPdfPage: an item more than 0.2 points under the last
# The reader's line join and overlap test, as pdf.ts writes them.
SOURCE = ('Math.abs(previous.y - t.y) <= Math.min(1, t.height / 8)',
          'if (cell[i].x < cell[i - 1].x + cell[i - 1].width - 0.2)',
          "'توجد نصوص متداخلة، لذلك لا يمكن التحقق من صحة القراءة.'",
          'layoutPdfPage(\n      page.tokens,\n      [],',
          'page.getTextContent({ disableNormalization: true })')
# PDF.js's spacing, in em of the item's size, and the share of the size a
# shift across the line may take before the item ends; and the bundle's text
# for them and for the other rules copied here.
PDFJS_SOURCE = ('v.trackingSpaceMin=a*.102,v.notASpace=a*.03,v.negativeSpaceMax=a*-.2,v.spaceInFlowMin=a*.102,'
                'v.spaceInFlowMax=a*.6',
                '/^(\\s)|(\\p{Mn})|(\\p{Cf})$/u',
                'beginMarkedContent:flushTextContentItem()',
                'Math.abs(l)>v.height*x&&flushTextContentItem()',
                'ee.fontSize!==j.fontSize||ee.fontName!==j.fontName&&(ee.font.name!==j.font.name',
                'if(c.isInvisibleFormatMark)continue;')
TRACKING, NOT_A_SPACE, NEGATIVE, SPACE_MIN, SPACE_MAX, ACROSS = 0.102, 0.03, -0.2, 0.102, 0.6, 0.25
WHITE = set('\t\n\v\f\r       　﻿') | {chr(c) for c in range(0x2000, 0x200b)}
BASE14 = {'Helvetica': 'helv', 'Helvetica-Bold': 'hebo', 'Helvetica-Oblique': 'heit', 'Helvetica-BoldOblique': 'hebi',
          'Times-Roman': 'tiro', 'Times-Bold': 'tibo', 'Times-Italic': 'tiit', 'Times-BoldItalic': 'tibi',
          'Courier': 'cour', 'Courier-Bold': 'cobo', 'Courier-Oblique': 'coit', 'Courier-BoldOblique': 'cobi',
          'Symbol': 'symb', 'ZapfDingbats': 'zadb'}
ENCODINGS = {'WinAnsiEncoding': 'cp1252', 'MacRomanEncoding': 'mac_roman', 'StandardEncoding': 'latin-1'}


class Unmodelled(Exception):
    """Something on the page this model does not reproduce."""


def drift():
    """What this module copies from the reader and from its PDF.js, and
    their source no longer carries."""
    text = PDF.read_text(encoding='utf-8')
    missing = [s for s in SOURCE if s not in text]
    if not PDFJS.exists():
        return missing + [f'{PDFJS.name} (run pnpm install)']
    bundle = PDFJS.read_text(encoding='utf-8')
    return missing + [s for s in PDFJS_SOURCE if s not in bundle]


def category(text):
    """PDF.js's getCharUnicodeCategory: /^(\\s)|(\\p{Mn})|(\\p{Cf})$/u, the
    first place any alternative matches, the first alternative there."""
    for i, ch in enumerate(text):
        if i == 0 and ch in WHITE:
            return 'white'
        if unicodedata.category(ch) == 'Mn':
            return 'diacritic'
        if i == len(text) - 1 and unicodedata.category(ch) == 'Cf':
            return 'format'
    return None


def numbers(value):
    """The numbers and brackets of a PDF array's text, in order."""
    return [t if t in '[]' else float(t) for t in re.findall(r'\[|\]|[+-]?(?:\d+\.?\d*|\.\d+)', value)]


def resolved(doc, xref, key):
    kind, value = doc.xref_get_key(xref, key)
    if kind == 'xref':
        n = int(value.split()[0])
        return ('array', doc.xref_object(n)) if doc.xref_object(n).lstrip().startswith('[') else ('xref', n)
    return kind, value


class Font:
    """A font as PDF.js draws text with it: its name, bytes per code, and
    each code's width (in thousandths of the size) and text."""

    def __init__(self, doc, xref):
        subtype = doc.xref_get_key(xref, 'Subtype')[1]
        if subtype == '/Type3':
            raise Unmodelled('Type3 font')
        self.composite = subtype == '/Type0'
        self.bytes = 2 if self.composite else 1
        holder = xref
        if self.composite:
            if doc.xref_get_key(xref, 'Encoding')[1] != '/Identity-H':
                raise Unmodelled(f'composite font encoding {doc.xref_get_key(xref, "Encoding")[1]}')
            kind, value = resolved(doc, xref, 'DescendantFonts')
            holder = int(re.search(r'(\d+) 0 R', value).group(1)) if kind == 'array' else int(value.split()[0])
        kind, desc = doc.xref_get_key(holder, 'FontDescriptor')
        desc = int(desc.split()[0]) if kind == 'xref' else None
        # Where rows.py finds the font's descriptor and program.
        self.xref, self.holder, self.desc = xref, holder, desc
        name = doc.xref_get_key(desc, 'FontName')[1] if desc else 'null'
        self.name = (name if name != 'null' else doc.xref_get_key(xref, 'BaseFont')[1]).lstrip('/')
        try:
            self.map = tounicode.font_map(doc, xref)
        except tounicode.Unreadable:
            self.map = None       # the page is refused for it (toUnicode)
        self.widths, self.default, self.base = {}, 0.0, None
        if self.composite:
            dw = doc.xref_get_key(holder, 'DW')
            self.default = float(dw[1]) if dw[0] in ('int', 'float') else 1000.0
            kind, value = resolved(doc, holder, 'W')
            items, i = numbers(value) if kind == 'array' else [], 0
            items = items[1:-1] if items and items[0] == '[' else items
            while i < len(items):
                first = int(items[i])
                if items[i + 1] == '[':
                    j = i + 2
                    while items[j] != ']':
                        self.widths[first + j - i - 2] = items[j]
                        j += 1
                    i = j + 1
                else:
                    for code in range(first, int(items[i + 1]) + 1):
                        self.widths[code] = items[i + 2]
                    i += 3
        else:
            first = doc.xref_get_key(xref, 'FirstChar')
            first = int(float(first[1])) if first[0] in ('int', 'float') else 0
            kind, value = resolved(doc, xref, 'Widths')
            embedded = desc is not None and any(doc.xref_get_key(desc, k)[0] != 'null'
                                                for k in ('FontFile', 'FontFile2', 'FontFile3'))
            if kind == 'array':
                for k, w in enumerate(v for v in numbers(value) if not isinstance(v, str)):
                    self.widths[first + k] = w
            elif embedded:
                raise Unmodelled(f'embedded font {self.name} without widths')
            else:
                base = self.name.split('+')[-1]
                if base not in BASE14:
                    raise Unmodelled(f'font {base} without widths')
                self.base = pymupdf.Font(BASE14[base])
            if desc:
                missing = doc.xref_get_key(desc, 'MissingWidth')
                self.default = float(missing[1]) if missing[0] in ('int', 'float') else 0.0
            self.encoding, self.differences = 'WinAnsiEncoding', {}
            kind, value = doc.xref_get_key(xref, 'Encoding')
            if kind == 'name':
                self.encoding = value.lstrip('/')
            elif kind in ('dict', 'xref'):
                enc = int(value.split()[0]) if kind == 'xref' else None
                base_enc = doc.xref_get_key(enc, 'BaseEncoding')[1] if enc else 'null'
                self.encoding = base_enc.lstrip('/') if base_enc != 'null' else 'StandardEncoding'
                diff = doc.xref_get_key(enc, 'Differences')[1] if enc else ''
                code = 0
                for t in re.findall(r'/[^\s/\[\]]+|\d+', diff):
                    if t.startswith('/'):
                        self.differences[code] = t[1:]
                        code += 1
                    else:
                        code = int(t)

    def text(self, code):
        if self.map is not None and code in self.map:
            return ''.join(chr(c) for c in self.map[code][0])
        if self.composite:
            return ''
        if code in self.differences:
            u = pymupdf.glyph_name_to_unicode(self.differences[code])
            return chr(u) if u and u > 0 else ''
        try:
            return bytes([code]).decode(ENCODINGS.get(self.encoding, 'cp1252'))
        except UnicodeDecodeError:
            return ''

    def width(self, code):
        if self.base is not None:
            t = self.text(code)
            return round(self.base.glyph_advance(ord(t[0])) * 1000) if t else self.default
        return self.widths.get(code, self.default)

    def glyphs(self, data):
        return [(c, self.width(c), self.text(c)) for c in
                (int.from_bytes(data[i:i + self.bytes], 'big') for i in range(0, len(data) - self.bytes + 1, self.bytes))]


def unrotated(x, y, m):
    """PDF.js's applyInverseRotation."""
    s = math.hypot(m[0], m[1])
    return (m[0] * x + m[1] * y) / s, (m[2] * x + m[3] * y) / s


def transform(m, n):
    """PDF.js's Util.transform(m, n): n applied first, then m."""
    return (m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
            m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5])


IDENTITY = (1, 0, 0, 1, 0, 0)


class State:
    def __init__(self):
        self.ctm, self.tm, self.tlm = IDENTITY, IDENTITY, IDENTITY
        self.font, self.font_name, self.size = None, None, 0
        self.char_spacing = self.word_spacing = self.leading = self.rise = 0.0
        self.hscale = 1.0

    def clone(self):
        c = State()
        c.__dict__.update(self.__dict__)
        return c

    def translate(self, x, y):
        m = self.tm
        self.tm = (m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])

    def translate_line(self, x, y):
        m = self.tlm
        self.tlm = (m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
        self.tm = self.tlm

    def current(self):
        return transform(self.ctm, transform(self.tm, (self.size * self.hscale, 0, 0, self.size, 0, self.rise)))


class Item:
    """A PDF.js text item: its text, place, width, height and font; and its
    glyphs as words, split where PDF.js puts a space in the text, each glyph
    (text, start, end) along the line (columns.py's word parts)."""

    def __init__(self, text, x, y, width, height, font, words=(), face=None, marks=()):
        self.text, self.x, self.y, self.width, self.height, self.font = text, x, y, width, height, font
        self.words = [w for w in words if w]
        # The Font PDF.js names the item's style after (its font when the item
        # began), and each glyph shown in it: (Font, code, matrix, left,
        # right), for rows.py.
        self.face, self.marks = face, list(marks)

    def __repr__(self):
        return f'Item({self.text!r}, x={self.x:.3f}, y={self.y:.3f}, w={self.width:.3f})'


class Builder:
    """PDF.js's textContentItem and the state around it (evaluator.js,
    getTextContent)."""

    def __init__(self, view):
        self.view, self.items = view, []
        self.initialized, self.str, self.width, self.total_width, self.height = False, [], 0.0, 0.0, 0.0
        self.words = [[]]
        self.face, self.marks = None, []
        self.prev, self.prev_rise, self.scale, self.transform, self.font_name = None, 0.0, 0.0, None, None
        self.tracking = self.not_a_space = self.negative = self.space_min = self.space_max = 0.0
        self.last, self.slot = [' ', ' '], 0
        self.st, self.seen = State(), None

    # The last two characters, as saveLastChar and its neighbours keep them.
    def save_last(self, ch):
        other = (self.slot + 1) % 2
        space = self.last[self.slot] != ' ' and self.last[other] == ' '
        self.last[self.slot], self.slot = ch, other
        return space

    def space_last(self):
        return self.last[self.slot] != ' ' and self.last[(self.slot + 1) % 2] == ' '

    def reset_last(self):
        self.last, self.slot = [' ', ' '], 0

    def flush(self):
        if not self.initialized:
            return
        self.total_width += self.width * self.scale
        t = self.transform
        self.items.append(Item(''.join(self.str), t[4], t[5], abs(self.total_width), abs(self.height), self.font_name,
                               self.words, self.face, self.marks))
        self.initialized, self.str, self.words, self.marks = False, [], [[]], []

    def eol(self):
        self.reset_last()
        self.flush()

    def ensure(self):
        if self.initialized:
            return
        st, t = self.st, self.st.current()
        self.font_name, self.transform, self.face = st.font_name, t, st.font
        self.width = self.total_width = 0.0
        self.height = math.hypot(t[2], t[3])
        self.scale = math.hypot(st.ctm[0], st.ctm[1]) * math.hypot(st.tlm[0], st.tlm[1])
        size = st.size
        self.tracking, self.not_a_space, self.negative = size * TRACKING, size * NOT_A_SPACE, size * NEGATIVE
        self.space_min, self.space_max = size * SPACE_MIN, size * SPACE_MAX
        self.initialized = True

    def update_scale(self):
        if not self.initialized:
            return
        st = self.st
        scale = math.hypot(st.tlm[0], st.tlm[1]) * math.hypot(st.ctm[0], st.ctm[1])
        if scale != self.scale:
            self.total_width += self.width * self.scale
            self.width, self.scale = 0.0, scale

    def fake_spaces(self, gap, sign):
        if sign * self.space_min <= gap <= sign * self.space_max:
            if self.initialized:
                self.reset_last()
                self.str.append(' ')
                self.words.append([])
            return False
        self.flush()
        self.reset_last()
        return True

    def compare(self, advance):
        """compareWithLastPosition: False if the glyph is outside the view."""
        st, t = self.st, self.st.current()
        n, r = t[4], t[5]
        v = self.view
        if n + advance < v[0] or n > v[2] or r < v[1] or r > v[3]:
            return False
        if st.font is None or self.prev is None:
            return True
        i, a = self.prev[4], self.prev[5]
        if i == n and a == r:
            return True
        p = self.prev
        if t[0] and t[1] == 0 and t[2] == 0:
            if t[0] < 0:
                n, r, i, a = -n, -r, -i, -a
        elif t[1] and t[0] == 0 and t[3] == 0:
            n, r, i, a = (r, n, a, i) if t[1] > 0 else (-r, -n, -a, -i)
        else:
            n, r = unrotated(n, r, t)
            i, a = unrotated(i, a, p)
        gap, across = (n - i) / self.scale, r - a
        width = self.width or self.total_width
        sign = (width > 0) - (width < 0)
        if gap < sign * self.negative:
            if abs(across) > 0.5 * self.height:
                self.eol()
            else:
                self.reset_last()
                self.flush()
            return True
        rise = st.rise - self.prev_rise
        shift = across if rise == 0 else across - t[3] / st.size * rise
        if abs(shift) > self.height:
            self.eol()
            return True
        if gap <= sign * self.not_a_space:
            self.reset_last()
        if gap <= sign * self.tracking:
            if self.space_last():
                self.reset_last()
                self.flush()
            else:
                self.width += gap
        elif not self.fake_spaces(gap, sign):
            if not self.str:
                self.reset_last()
            else:
                self.width += gap
        if abs(across) > self.height * ACROSS:
            self.flush()
        return True

    def show(self, data, extra):
        """buildTextContentItem."""
        st, seen = self.st, self.seen
        if st.size != seen.size or (st.font_name != seen.font_name and (
                seen.font is None or st.font is None or st.font.name != seen.font.name)):
            self.flush()
            self.seen = st.clone()
        font, spacing = st.font, st.char_spacing
        if font is None:
            return
        if not data:
            e = spacing + extra
            if e:
                st.translate(e * st.hscale, 0)
            return
        glyphs = font.glyphs(data)
        scale = 0.001 * st.size
        for k, (code, width, text) in enumerate(glyphs):
            kind = category(text)
            if kind == 'format':
                continue
            after = spacing + (extra if k == len(glyphs) - 1 else 0)
            advance = width * scale
            if code == 32:
                after += st.word_spacing
            if kind == 'white':
                after += advance
                st.translate(after * st.hscale, 0)
                self.save_last(' ')
                continue
            if kind != 'diacritic' and not self.compare(advance):
                st.translate(advance * st.hscale, 0)
                continue
            self.ensure()
            if kind == 'diacritic':
                advance = 0
            advance *= st.hscale
            matrix = st.current()
            start = matrix[4]
            st.translate(advance, 0)
            self.width += advance
            if advance:
                self.prev, self.prev_rise = st.current(), st.rise
            if self.save_last(text):
                self.str.append(' ')
                self.words.append([])
            self.str.append(text)
            end = st.current()[4]
            self.words[-1].append((text, min(start, end), max(start, end)))
            # The reader's placement of the glyph (pdf-glyph-geometry.ts): its
            # width and the spacing after it, a diacritic's too.
            em = width * 0.001 + ((spacing + (st.word_spacing if code == 32 else 0)) / st.size if st.size else 0)
            reach = matrix[0] * em + matrix[4]
            self.marks.append((font, code, matrix, min(start, reach), max(start, reach)))
            if after:
                st.translate(after * st.hscale, 0)


def fonts(doc, page):
    """{resource name: Font} of the page."""
    out = {}
    for xref, _, _, _, name, _, *referencer in page.get_fonts(full=True):
        if not referencer or referencer[0] == 0:
            out[name] = xref
    return out


def page_items(doc, pno):
    """PDF.js's text items of the page, with text and without, in order."""
    page = doc[pno]
    if page.get_xobjects():
        raise Unmodelled('form XObject')
    names, loaded = fonts(doc, page), {}
    # PDF.js's view: the crop box within the media box, in PDF coordinates
    # (MuPDF gives the crop box from the media box's top).
    mb, cb = page.mediabox, page.cropbox
    crop = (cb.x0, mb.y1 - cb.y1, cb.x1, mb.y1 - cb.y0)
    b = Builder((max(crop[0], mb.x0), max(crop[1], mb.y0), min(crop[2], mb.x1), min(crop[3], mb.y1)))
    stack, operands = [], []
    data = b'\n'.join(doc.xref_stream(x) for x in page.get_contents())
    first = True
    for m in tounicode.TOKEN.finditer(data):
        t = m.group()
        if t.startswith(b'%'):
            continue
        if t.startswith((b'(', b'<', b'/', b'[', b']')) and t not in (b'<<', b'>>') or tounicode.NUMBER.fullmatch(t):
            operands.append(t)
            continue
        if t in (b'<<', b'>>'):
            operands.append(t)
            continue
        st = b.st
        if first:
            b.seen, first = st.clone(), False
        nums = [float(o) for o in operands if tounicode.NUMBER.fullmatch(o)]
        if t == b'q':
            stack.append(st.clone())
        elif t == b'Q':
            if stack:
                b.st = stack.pop()
        elif t == b'cm' and len(nums) >= 6:
            st.ctm = transform(st.ctm, tuple(nums[-6:]))
        elif t == b'BT':
            st.tm = st.tlm = IDENTITY
        elif t == b'Tm' and len(nums) >= 6:
            st.tm = st.tlm = tuple(nums[-6:])
            b.update_scale()
        elif t == b'Td' and len(nums) >= 2:
            st.translate_line(nums[-2], nums[-1])
        elif t == b'TD' and len(nums) >= 2:
            st.leading = -nums[-1]
            st.translate_line(nums[-2], nums[-1])
        elif t == b'T*':
            st.translate_line(0, -st.leading)
        elif t == b'TL' and nums:
            st.leading = nums[-1]
        elif t == b'Tc' and nums:
            st.char_spacing = nums[-1]
        elif t == b'Tw' and nums:
            st.word_spacing = nums[-1]
        elif t == b'Tz' and nums:
            st.hscale = nums[-1] / 100
        elif t == b'Ts' and nums:
            st.rise = nums[-1]
        elif t == b'Tf' and nums:
            name = next((o[1:].decode('latin-1') for o in reversed(operands) if o.startswith(b'/')), None)
            if not (st.font and name == st.font_name and nums[-1] == st.size):
                st.font_name, st.size = name, nums[-1]
                if name not in loaded:
                    if name not in names:
                        raise Unmodelled(f'font {name} not in the page resources')
                    loaded[name] = Font(doc, names[name])
                st.font = loaded[name]
        elif t == b'Tj':
            strings = [o for o in operands if o.startswith((b'(', b'<')) and o != b'<<']
            if strings:
                b.show(tounicode.string_bytes(strings[-1]), 0)
        elif t in (b"'", b'"'):
            strings = [o for o in operands if o.startswith((b'(', b'<')) and o != b'<<']
            if t == b'"' and len(nums) >= 2:
                st.word_spacing, st.char_spacing = nums[-2], nums[-1]
            st.translate_line(0, -st.leading)
            if strings:
                b.show(tounicode.string_bytes(strings[-1]), 0)
        elif t == b'TJ':
            k = -st.size / 1000
            pending = []
            for o in operands:
                if o.startswith((b'(', b'<')) and o != b'<<':
                    pending.append(tounicode.string_bytes(o))
                elif tounicode.NUMBER.fullmatch(o) and float(o) != 0:
                    b.show(b''.join(pending), float(o) * k)
                    pending = []
            if pending:
                b.show(b''.join(pending), 0)
        elif t in (b'BMC', b'BDC', b'EMC', b'Do'):
            b.flush()
        elif t == b'gs':
            name = next((o[1:].decode('latin-1') for o in reversed(operands) if o.startswith(b'/')), '')
            if doc.xref_get_key(page.xref, f'Resources/ExtGState/{name}/Font')[0] != 'null':
                raise Unmodelled('a font set by a graphics state')
        elif t == b'BI':
            raise Unmodelled('inline image')
        operands = []
    b.flush()
    return b.items


def lines(items):
    """The reader's lines: items with text, top down, an item within
    min(1, height / 8) of the first item of the line above joining it."""
    out = []
    for t in sorted((t for t in items if t.text.strip()), key=lambda t: (-t.y, t.x)):
        if out and abs(out[-1][0].y - t.y) <= min(1, t.height / 8):
            out[-1].append(t)
        else:
            out.append([t])
    return [sorted(line, key=lambda t: t.x) for line in out]


def overlaps(line):
    """(earlier, later, points) for each item more than 0.2 points under
    the end of the item before it."""
    return [(p, q, round(p.x + p.width - q.x, 3)) for p, q in zip(line, line[1:]) if q.x < p.x + p.width - OVERLAP]


def check_page(doc, pno):
    """[{line, items, overlapPt}] for each line the reader refuses for
    overlapping text, and the largest overlap under the guard elsewhere."""
    return check_items(page_items(doc, pno))


def check_items(page):
    found, most = [], None
    for number, line in enumerate(lines(page), 1):
        bad = overlaps(line)
        if bad:
            p, q, pt = bad[0]
            found.append({'line': number, 'items': [p.text, q.text], 'overlapPt': pt})
        for p, q in zip(line, line[1:]):
            under = p.x + p.width - q.x
            # Under a thousandth of a point is arithmetic, not overlap.
            if under > 0.001 and not q.x < p.x + p.width - OVERLAP:
                most = under if most is None else max(most, under)
    return found, most


def columns_equal(doc, pno, page):
    """How many of the page's items with text columns.py's MuPDF model
    (columns.mupdf_items) gives a piece of, by start, end and baseline within
    0.01 points: the item model the reading by columns has used since G13."""
    import columns
    height = doc[pno].mediabox.y1
    pieces = [(p.x0, p.x1, height - p.y) for line in columns.mupdf_items(doc[pno]) for p in line]
    return sum(1 for i in page if i.text.strip() and any(
        abs(a - i.x) < 0.01 and abs(b - i.x - i.width) < 0.01 and abs(y - i.y) < 0.01 for a, b, y in pieces))


def main(paths):
    """For measure_items.mjs: each file's pages, their items with text
    ([text, x, y, width, height]), the lines refused and how many of the
    items columns.py's model has, or what is not modelled."""
    out = {}
    for path in paths:
        doc, pages = pymupdf.open(path), []
        for pno in range(doc.page_count):
            try:
                page = page_items(doc, pno)
            except Unmodelled as reason:
                pages.append({'unmodelled': str(reason)})
                continue
            found, most = check_items(page)
            pages.append({'items': [[i.text, i.x, i.y, i.width, i.height] for i in page if i.text.strip()],
                          'overlap': found, 'mostItemOverlapPt': most, 'columnsEqual': columns_equal(doc, pno, page)})
        out[path] = pages
    print(json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    main(sys.argv[1:])
