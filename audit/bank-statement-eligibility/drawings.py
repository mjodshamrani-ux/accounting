"""G22: the guarded reader's test of drawings over text, before the seal, as
it is and with each of the three rules about it that the ablation script
switches off.

checkPdfOperators (pdf.ts) replays the page's operators. A path filled with
one opaque solid colour, not inside a clip it cannot prove, whose subpaths
are rectangles, is a background: refused only if it is painted over text
already drawn (padded boxes). Any other path is a drawing: refused if it
meets a target of any text on the page, before or after it. A stroke is
tested segment by segment, padded by half its width (half a point at least,
by the transform's largest scale), with its square caps and its miter joins;
a fill by the box of each subpath; a curved path, or a fill and stroke, by
its bounds. A path with no bounds, or a shading, is refused, and so is an
unsupported join or miter. A clip that is one rectangle bounds the text
drawn under it, by each text box's ink where proved (0.01 points of slack);
any other clip refuses every text drawn under it.

The targets are, for each text item: its glyphs' ink boxes where each
glyph's outline and placement are proved (rows.py's glyph form), else its ink
box where proved and no text on the page is raised (rows.py's ink form), else
its padded box, from its font's ascent and descent and 0.3 and 1 em around
its baseline. The rules the ablation script switches off:

  noInkDrawing       'drawing by ink' (G8): an item without glyph boxes keeps
                     its padded box;
  noGlyphDrawings    'drawings by glyph boxes' (G10): every item is its ink
                     box, else its padded box;
  noRectangleReturn  'rectangle traced back to its start' (G10): a subpath of
                     five points whose last is its first is no rectangle, as
                     a background or as a clip.

PDF.js packs each path as it builds it (buildPath): m and l as points, c, v
and y as curves, re as four corners and a close (or a line where it has no
area), h as a close; its numbers and bounds in 32-bit floats, in the space
the path was built in, carried by the transform at its painting. A closing
stroke (s, b, b*) closes the path first.

  PYTHONPATH=<pymupdf 2.0, fontTools> python3 -B drawings.py <statement.pdf> ...
"""
import json
import math
import struct
import sys
from pathlib import Path

import pymupdf
from fontTools.misc.bezierTools import calcCubicBounds

import items as pdfjs
import rows

ROOT = Path(__file__).resolve().parent.parent.parent
PDF = ROOT / 'lib' / 'reconciliation' / 'pdf.ts'
SLACK = 0.01        # the clip test's slack, in points
MESSAGES = {
    'clip': 'يحتوي PDF نصًا مقصوصًا أو طريقة قص غير مدعومة',
    'covers': 'يغطي أحد رسوم PDF نصًا تحته',
    'drawing': 'يتداخل أحد رسوم PDF مع النص وقد يغطي رقمًا',
    'bounds': 'قد يغطي أحد رسوم PDF النص، وتعذر التحقق من حدود الرسم',
    'stroke': 'إعدادات حدود أحد رسوم PDF غير صالحة',
}
SOURCE = ('const inkBoxes = textBoxes.map(clipBoxOf);',
          'const inkTargets = inkBoxes.flatMap((box, i) => glyphBoxes.get(i) ?? [box]);',
          'path.points.length === 5 &&',
          ': Math.max(0.5, (Math.abs(state.lineWidth) * scale) / 2);',
          'a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];',
          'const cap = halfWidth * Math.SQRT2;',
          'Math.min(miterLimit, sineHalf ? 1 / sineHalf : miterLimit);',
          'box[0] < state.clipBox![0] - 0.01 ||',
          'Math.min(glyph[1], t.y - t.height * 0.3),',
          'Math.max(glyph[3], t.y + t.height),',
          'if (points.length < 3) return false;',
          *MESSAGES.values())
CONFIGS = ('today', 'noInkDrawing', 'noGlyphDrawings', 'noRectangleReturn')
MOVE, LINE, CURVE, CLOSE = 0, 1, 2, 4      # PDF.js DrawOPS
PAINTS = {b'S': 'stroke', b's': 'closeStroke', b'f': 'fill', b'F': 'fill', b'f*': 'eoFill',
          b'B': 'fillStroke', b'B*': 'eoFillStroke', b'b': 'closeFillStroke', b'b*': 'closeEOFillStroke',
          b'n': 'endPath'}
SHOWS = (b'Tj', b'TJ', b"'", b'"')
BUILDS = (b'm', b'l', b'c', b'v', b'y', b'h', b're', b'W', b'W*')   # buffered, not emitted


def drift():
    text = PDF.read_text(encoding='utf-8')
    return [s for s in SOURCE if s not in text]


def f32(v):
    return struct.unpack('f', struct.pack('f', v))[0]


def overlaps(a, b):
    """boxOverlaps."""
    return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]


def operators(doc, pno):
    """The page's content as (operator, operands), in order."""
    data = b'\n'.join(doc.xref_stream(x) for x in doc[pno].get_contents())
    out, operands = [], []
    for m in pdfjs.tounicode.TOKEN.finditer(data):
        t = m.group()
        if t.startswith(b'%'):
            continue
        if t.startswith((b'(', b'<', b'/', b'[', b']')) and t not in (b'<<', b'>>') or t in (b'<<', b'>>') \
                or pdfjs.tounicode.NUMBER.fullmatch(t):
            operands.append(t)
            continue
        out.append((t, operands))
        operands = []
    return out


def ext_gstate(doc, page, name):
    """The entries of a graphics state the reader reads (setGState)."""
    out = {}
    for key in ('ca', 'CA', 'LW', 'LJ', 'ML', 'SMask', 'BM', 'TR', 'TR2'):
        kind, value = doc.xref_get_key(page.xref, f'Resources/ExtGState/{name}/{key}')
        if kind != 'null':
            out[key] = (kind, value)
    return out


class State:
    def __init__(self):
        self.ctm = pdfjs.IDENTITY
        self.line_width, self.join, self.miter = 1.0, 0, 10.0
        self.fill_solid, self.fill_alpha = True, 1.0
        self.masked = self.blended = self.transferred = False
        self.clipped, self.clip_box = False, None

    def clone(self):
        c = State()
        c.__dict__.update(self.__dict__)
        return c


def path_bounds(buffer):
    """PDF.js's pathMinMax for the buffer, in the space it was built in."""
    box = [math.inf, math.inf, -math.inf, -math.inf]

    def add(x, y):
        box[0], box[1], box[2], box[3] = min(box[0], x), min(box[1], y), max(box[2], x), max(box[3], y)
    current = (0.0, 0.0)
    for op, *v in buffer:
        if op in (MOVE, LINE):
            add(*v)
            current = tuple(v)
        elif op == CURVE:
            x0, y0, x1, y1 = calcCubicBounds(current, v[0:2], v[2:4], v[4:6])
            add(x0, y0)
            add(x1, y1)
            current = tuple(v[4:6])
    return [f32(b) for b in box]


def straight(buffer, matrix, close_last):
    """decodeStraightPaths: [(points, local points, closed)], or None for a
    curve or a shape it does not read."""
    paths, path = [], None
    for op, *v in buffer:
        if op in (MOVE, LINE):
            x, y = v
            p = (matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5])
            if op == MOVE:
                path = [[p], [(x, y)], False]
                paths.append(path)
            else:
                if path is None or path[2]:
                    return None
                path[0].append(p)
                path[1].append((x, y))
        elif op == CLOSE:
            if path is None or path[2]:
                return None
            path[2] = True
        else:
            return None
    if close_last and path is not None:
        path[2] = True
    for points, local, closed in paths:
        if closed and len(points) > 1 and points[0] == points[-1]:
            points.pop()
            local.pop()
    return paths


def rectangles(buffer, matrix, traced_back=True):
    """filledRectangles: the boxes of the path's subpaths if every one is an
    axis-aligned rectangle apart from the others, else None. With
    traced_back, a subpath of five points whose last is its first is its
    four corners."""
    paths = straight(buffer, matrix, False)
    if paths is None:
        return None
    boxes = []
    for points, _, _ in paths:
        if traced_back and len(points) == 5 and points[-1] == points[0]:
            points = points[:4]
        if len(points) != 4 or len(set(points)) != 4:
            return None
        if any(p[0] != q[0] and p[1] != q[1] for p, q in zip(points, points[1:] + points[:1])):
            return None
        box = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points),
               max(p[1] for p in points)]
        if box[0] == box[2] or box[1] == box[3] or any(overlaps(b, box) for b in boxes):
            return None
        boxes.append(box)
    return boxes


def stroke_hits(paths, half, join, miter, targets):
    """straightPathOverlaps for a stroke."""
    cap = half * math.sqrt(2)

    def hits(p, q, t):
        if any(overlaps([e[0] - cap, e[1] - cap, e[0] + cap, e[1] + cap], t) for e in (p, q)):
            return True
        box = [t[0] - half, t[1] - half, t[2] + half, t[3] + half]
        lo, hi = 0.0, 1.0
        for axis in (0, 1):
            delta = q[axis] - p[axis]
            if delta == 0:
                if p[axis] < box[axis] or p[axis] > box[axis + 2]:
                    return False
            else:
                a = (box[axis] - p[axis]) / delta
                b = (box[axis + 2] - p[axis]) / delta
                lo, hi = max(lo, min(a, b)), min(hi, max(a, b))
                if lo > hi:
                    return False
        return True
    for points, local, closed in paths:
        for i in range(1, len(points)):
            if any(hits(points[i - 1], points[i], t) for t in targets):
                return True
        if closed and len(points) > 1 and any(hits(points[-1], points[0], t) for t in targets):
            return True
        if join == 0 and len(points) > 2:
            n = len(points)
            for i in range(0 if closed else 1, n if closed else n - 1):
                p, here = points[i], local[i]
                before, after = local[(i + n - 1) % n], local[(i + 1) % n]
                u = (before[0] - here[0], before[1] - here[1])
                v = (after[0] - here[0], after[1] - here[1])
                product = math.hypot(*u) * math.hypot(*v)
                if not product:
                    continue
                cosine = max(-1.0, min(1.0, (u[0] * v[0] + u[1] * v[1]) / product))
                sine_half = math.sqrt((1 - cosine) / 2)
                pad = half * min(miter, 1 / sine_half if sine_half else miter)
                if any(overlaps([p[0] - pad, p[1] - pad, p[0] + pad, p[1] + pad], t) for t in targets):
                    return True
    return False


def fill_hits(paths, targets):
    """straightPathOverlaps for a fill: the box of each subpath of three
    points or more."""
    for points, _, _ in paths:
        if len(points) < 3:
            continue
        box = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points),
               max(p[1] for p in points)]
        if any(overlaps(box, t) for t in targets):
            return True
    return False


def padded(item, face):
    """The reader's padded text box: its box by ascent and descent, and at
    least 0.3 below and 1 above its baseline, in its size."""
    m = rows.metric_box(item, face)
    return [item.x, min(m[1], item.y - item.height * 0.3), item.x + item.width, max(m[3], item.y + item.height)]


def check_page(doc, pno):
    """{config: the first refusal of the drawing, clip or background tests on
    the page, {'kind', 'op'}, or None}; or {config: 'unprovable'} where the
    reader stops on a font's ascent and descent first."""
    page = doc[pno]
    page_items = pdfjs.page_items(doc, pno)
    texts = [t for t in page_items if t.text.strip()]
    found = rows.faces(doc, page_items)
    if any(rows.metric_box(t, found.get(id(t.face))) is None for t in texts):
        return {c: 'unprovable' for c in CONFIGS}
    raised = rows.raised_text(doc, pno)
    pads = {id(t): padded(t, found.get(id(t.face))) for t in texts}
    ink = {id(t): None if raised else rows.ink_box(t, found) for t in texts}
    glyphs = {id(t): rows.glyph_boxes(t, found) for t in texts}
    clip_of = {k: ink[k] or pads[k] for k in pads}
    painted_by = {}
    for t in texts:
        for op in sorted({mark[5] for mark in t.marks}):
            painted_by.setdefault(op, []).append(id(t))
    ops = operators(doc, pno)

    def targets(config):
        out = []
        for t in texts:
            k = id(t)
            if config != 'noGlyphDrawings' and glyphs[k]:
                out += glyphs[k]
            else:
                out.append(pads[k] if config == 'noInkDrawing' else clip_of[k])
        return out
    return {c: replay(doc, page, ops, painted_by, pads, clip_of, targets(c), c != 'noRectangleReturn', bool(texts))
            for c in CONFIGS}


def replay(doc, page, ops, painted_by, pads, clip_of, targets, traced_back, any_text):
    st, stack, buffer, pending, shown, painted = State(), [], [], None, 0, []
    current = (0.0, 0.0)
    for op, operands in ops:
        nums = [float(o) for o in operands if pdfjs.tounicode.NUMBER.fullmatch(o)]
        # PDF.js emits the clip just before the path it is drawn by; any
        # operator it emits between them leaves the text clipped, unproved.
        if pending is not None and op not in BUILDS and op not in PAINTS:
            pending = None
        if op == b'q':
            stack.append(st.clone())
        elif op == b'Q':
            if stack:
                st = stack.pop()
        elif op == b'cm' and len(nums) >= 6:
            st.ctm = pdfjs.transform(st.ctm, tuple(nums[-6:]))
        elif op == b'w' and nums:
            st.line_width = nums[-1]
        elif op == b'j' and nums:
            st.join = nums[-1]
        elif op == b'M' and nums:
            st.miter = nums[-1]
        elif op == b'gs':
            name = next((o[1:].decode('latin-1') for o in reversed(operands) if o.startswith(b'/')), '')
            for key, (kind, value) in ext_gstate(doc, page, name).items():
                if key == 'ca':
                    st.fill_alpha = float(value)
                elif key == 'LW':
                    st.line_width = float(value)
                elif key == 'LJ':
                    st.join = float(value)
                elif key == 'ML':
                    st.miter = float(value)
                elif key == 'SMask':
                    st.masked = value != '/None'
                elif key == 'BM':
                    st.blended = value not in ('/Normal', '/Compatible')
                elif key in ('TR', 'TR2'):
                    st.transferred = value not in ('/Identity', '/Default')
        elif op in (b'g', b'rg', b'k'):
            st.fill_solid = True
        elif op in (b'sc', b'scn'):
            st.fill_solid = not any(o.startswith(b'/') for o in operands)
        elif op in (b'm', b'l') and len(nums) >= 2:
            x, y = f32(nums[-2]), f32(nums[-1])
            buffer.append((MOVE if op == b'm' else LINE, x, y))
            current = (x, y)
        elif op in (b'c', b'v', b'y') and len(nums) >= (6 if op == b'c' else 4):
            v = [f32(n) for n in nums[-6 if op == b'c' else -4:]]
            if op == b'v':
                v = [*current, *v]
            elif op == b'y':
                v = [*v, *v[2:4]]
            buffer.append((CURVE, *v))
            current = tuple(v[4:6])
        elif op == b'h':
            buffer.append((CLOSE,))
        elif op == b're' and len(nums) >= 4:
            x, y, w, h = (f32(n) for n in nums[-4:])
            x1, y1 = f32(x + w), f32(y + h)
            if w == 0 or h == 0:
                buffer += [(MOVE, x, y), (LINE, x1, y1), (CLOSE,)]
            else:
                buffer += [(MOVE, x, y), (LINE, x1, y), (LINE, x1, y1), (LINE, x, y1), (CLOSE,)]
            current = (x, y)
        elif op in (b'W', b'W*'):
            pending = (st.clipped, st.clip_box)
            st.clipped = True
        elif op in SHOWS:
            shown += 1
            boxes = painted_by.get(shown, [])
            if st.clipped or (st.clip_box and any(
                    clip_of[k][0] < st.clip_box[0] - SLACK or clip_of[k][1] < st.clip_box[1] - SLACK
                    or clip_of[k][2] > st.clip_box[2] + SLACK or clip_of[k][3] > st.clip_box[3] + SLACK
                    for k in boxes)):
                return {'kind': 'clip', 'op': shown}
            painted += [pads[k] for k in boxes]
        elif op == b'sh':
            return {'kind': 'bounds', 'op': shown}
        elif op in PAINTS:
            kind = PAINTS[op]
            if kind in ('closeStroke', 'closeFillStroke', 'closeEOFillStroke'):
                buffer.append((CLOSE,))
            path, buffer = buffer, []
            m = st.ctm
            if pending is not None:
                clip = rectangles(path, m, traced_back) if path else None
                if kind == 'endPath' and clip is not None and len(clip) == 1:
                    box, prior = clip[0], pending[1]
                    st.clip_box = box if prior is None else [max(prior[0], box[0]), max(prior[1], box[1]),
                                                             min(prior[2], box[2]), min(prior[3], box[3])]
                    st.clipped = pending[0]
                pending = None
            if kind == 'endPath':
                continue
            if not path:
                return {'kind': 'bounds', 'op': shown}
            fill_only = kind in ('fill', 'eoFill')
            square = m[0] ** 2 + m[1] ** 2 + m[2] ** 2 + m[3] ** 2
            det = m[0] * m[3] - m[1] * m[2]
            scale = math.sqrt((square + math.sqrt(max(0.0, square * square - 4 * det * det))) / 2)
            pad = 0 if fill_only else max(0.5, abs(st.line_width) * scale / 2)
            if st.join not in (0, 1, 2) or st.miter < 1:
                return {'kind': 'stroke', 'op': shown}
            if fill_only and st.fill_solid and st.fill_alpha == 1 and not (
                    st.masked or st.blended or st.transferred or st.clipped):
                boxes = rectangles(path, m, traced_back)
                if boxes is not None:
                    if any(overlaps(b, t) for b in boxes for t in painted):
                        return {'kind': 'covers', 'op': shown}
                    continue
            if kind in ('stroke', 'closeStroke') or fill_only:
                paths = straight(path, m, kind == 'closeStroke')
                if paths is not None and any_text:
                    if fill_only:
                        hit = fill_hits(paths, targets)
                    else:
                        hit = stroke_hits(paths, pad, st.join, st.miter, targets)
                    if hit:
                        return {'kind': 'drawing', 'op': shown}
                    continue
            b = path_bounds(path)
            corners = [(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
                       for x, y in ((b[0], b[1]), (b[0], b[3]), (b[2], b[1]), (b[2], b[3]))]
            box = [min(c[0] for c in corners) - pad, min(c[1] for c in corners) - pad,
                   max(c[0] for c in corners) + pad, max(c[1] for c in corners) + pad]
            if not any_text or any(overlaps(box, t) for t in targets):
                return {'kind': 'drawing', 'op': shown}
    return None


def check_pdf(path):
    with pymupdf.open(str(path)) as doc:
        pages = []
        for pno in range(doc.page_count):
            if doc[pno].rotation:
                pages.append({'rotated': True})
                continue
            try:
                pages.append(check_page(doc, pno))
            except pdfjs.Unmodelled as e:
                pages.append({'unmodelled': str(e)})
        return pages


def main(paths):
    json.dump({p: check_pdf(p) for p in paths}, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main(sys.argv[1:])
