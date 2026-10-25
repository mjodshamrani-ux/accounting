"""Pre-seal eligibility of a BNK-PDF-1 holdout: does any statement fall into a
refusal the guarded PDF reader declares, and can the declared decision story
be decided in the page?

A positive must stay inside the contract and outside every refusal the reader
declares, or its refusal is correct and its eligibility was wrong (DEV-53).
G10 declared P08 (a page turned by /Rotate 90) and P10 (two lines whose ink
touches) positive, and P01 a decision story whose only case the page cannot
accept (DEV-55). Each check here reads the PDF with MuPDF and the raw content
stream, never with the product's reader, and each has a planted fault in
test_eligibility.py that it must find. README.ar.md maps every refusal the
reader declares to the check that covers it, or says why none does.

Checks on every page of every statement:
  rotation      a page with /Rotate
  direction     a text item whose matrix (size and scale, text matrix, CTM)
                is not upright: the reader refuses skewed or mirrored text
  images        an image painted on the page, however small
  widgets       an interactive form field
  layers        optional content (the reader refuses PDF layers)
  encryption    an encrypted file
  size          a file over 8 MB or over 100 pages, the reader's limits
  pageEdge      a glyph's box beyond the page by more than 0.2 points
  hiddenText    text drawn invisible or with opacity below one
  contrast      a run of text not wholly on one background it contrasts
                with by 3, the reader's threshold: its box (the run's width,
                its glyphs' ink height with the 0.01 em margin, as the
                reader proves it since G12) must lie inside the latest
                opaque filled rectangle under it, or on the white page
  ruleClearance a glyph box within 0.01 em of a stroke, or of a fill that is
                not only rectangles: the margin the reader keeps around glyph
                ink (an opaque filled rectangle is a background, as there)
  lineInk       ink of one line within --clearance points of the ink of the
                line above or below it (rendered apart, dilated, intersected),
                lines joined as the reader joins them
  lineControl   on the first page, the odd lines moved three quarters of the
                median line distance across their text, up and down, did not
                meet the others: the line test measured nothing there
  visibleInk    text ink that is not dark where the page is drawn: covered by
                a later fill, or cut away by a clip
and on the statement: columns, the reader's reading of each line by its
page's column headers (columns.py), where it would stop; on a rotated page it
is not read, as the reader refuses the page first;
and on the package: decision, the declared decision story must have a review
case the page accepts and an outstanding item for the checker's self-test.

  PYTHONPATH=<pymupdf 2.0> python3 -B eligibility.py <package> [--decide STORY] [--out file]
"""
import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path

import pymupdf

import columns

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
# What the page lets an accountant accept as it stands, as the bank workspace
# declares it (lib/reconciliation/bank-statement-view.ts, ACCEPTABLE).
ACCEPTABLE = {'amount-date-suggestion', 'date-gap'}
VIEW = ROOT / 'lib' / 'reconciliation' / 'bank-statement-view.ts'
MARGIN_EM = 0.01      # the reader's ink margin per glyph, in em
EDGE = 0.2            # the reader's page-edge tolerance, in points
CONTRAST = 3.0        # the reader's least contrast ratio
ZOOM = 20             # pixels per point for the ink checks: 0.05 points
DARK = bytes(1 if v < 128 else 0 for v in range(256))
TOKEN = re.compile(rb'\((?:\\.|[^\\()]|\((?:\\.|[^\\()])*\))*\)|<<|>>|<[0-9A-Fa-f\s]*>|\[|\]'
                   rb'|/[^\s()<>\[\]{}/%]*|%[^\n]*|[^\s()<>\[\]{}/%]+', re.S)
NUM = re.compile(rb'[+-]?(\d+\.?\d*|\.\d+)')
STRING = (b'(', b'<', b'[', b']')
PAINT = {b'f', b'F', b'f*', b'S', b's', b'B', b'B*', b'b', b'b*', b'sh'}


def acceptable_in_source():
    """ACCEPTABLE as the view declares it, so that a change there fails here."""
    text = VIEW.read_text(encoding='utf-8')
    block = re.search(r'const ACCEPTABLE[^=]*=\s*new Set<[^>]*>\(\[([^\]]*)\]', text)
    return set(re.findall(r"'([a-z-]+)'", block.group(1))) if block else None


def mul(m, n):
    a, b, c, d, e, f = m
    A, B, C, D, E, F = n
    return (a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F)


def shows(content):
    """[(operand start, operand end, matrix, operator)] for every Tj, TJ, '
    and ", the matrix being size and horizontal scale times the text matrix
    times the CTM, as PDF.js gives a text item's transform."""
    ctm, stack = (1, 0, 0, 1, 0, 0), []
    tm = tlm = (1, 0, 0, 1, 0, 0)
    leading, size, scale, rise, operands, out = 0.0, 1.0, 1.0, 0.0, [], []

    def td(tx, ty):
        nonlocal tm, tlm
        tlm = mul((1, 0, 0, 1, tx, ty), tlm)
        tm = tlm

    for m in TOKEN.finditer(content):
        t = m.group()
        if t.startswith(b'%'):
            continue
        if NUM.fullmatch(t) or (t.startswith(STRING + (b'/',)) and t not in (b'<<', b'>>')):
            operands.append(m)
            continue
        nums = [float(o.group()) for o in operands if NUM.fullmatch(o.group())]
        if t == b'q':
            stack.append(ctm)
        elif t == b'Q':
            ctm = stack.pop() if stack else ctm
        elif t == b'cm' and len(nums) >= 6:
            ctm = mul(tuple(nums[-6:]), ctm)
        elif t == b'BT':
            tm = tlm = (1, 0, 0, 1, 0, 0)
        elif t == b'Tm' and len(nums) >= 6:
            tm = tlm = tuple(nums[-6:])
        elif t == b'Td' and len(nums) >= 2:
            td(nums[-2], nums[-1])
        elif t == b'TD' and len(nums) >= 2:
            leading = -nums[-1]
            td(nums[-2], nums[-1])
        elif t == b'TL' and nums:
            leading = nums[-1]
        elif t == b'Tf' and nums:
            size = nums[-1]
        elif t == b'Tz' and nums:
            scale = nums[-1] / 100
        elif t == b'Ts' and nums:
            rise = nums[-1]
        elif t in (b'T*', b"'", b'"'):
            td(0, -leading)
        if t in (b'Tj', b'TJ', b"'", b'"'):
            strings = [o for o in operands if o.group().startswith(STRING)]
            if strings:
                start = next(o for o in operands if o.group() == b'[').start() if t == b'TJ' else strings[0].start()
                matrix = mul(mul((size * scale, 0, 0, size, 0, rise), tm), ctm)
                out.append((start, strings[-1].end(), matrix, t))
        operands = []
    return out


def baseline(matrix):
    """The distance of a text item's origin across the direction of its text."""
    a, b, _, _, e, f = matrix
    return round((a * f - b * e) / (math.hypot(a, b) or 1), 1)


def line_numbers(items):
    """Each baseline's line, numbered from the top, as the reader joins them:
    a baseline within min(1, size / 8) points of the one above it is the same
    line (a stacked Arabic letter a fraction of a point off, for one)."""
    marks = sorted(((baseline(m), math.hypot(m[2], m[3])) for _, _, m, _ in items), reverse=True)
    number, previous, out = -1, None, {}
    for y, size in marks:
        if previous is None or previous - y > min(1, size / 8):
            number += 1
        out.setdefault(y, number)
        previous = y
    return out


def content(doc, pno):
    """The page's content streams as one, as PDF joins them. Never MuPDF's
    clean_contents: it rounds the matrices it merges, and a glyph's edge then
    moves by a fraction of a pixel against the page as it is drawn."""
    xrefs = doc[pno].get_contents()
    return xrefs, b'\n'.join(doc.xref_stream(x) for x in xrefs)


def edited(path, pno, edit):
    """The page with its content changed by edit(content) -> bytes, written
    to its first content stream and the others emptied."""
    doc = pymupdf.open(path)
    xrefs, c = content(doc, pno)
    doc.update_stream(xrefs[0], edit(c))
    for x in xrefs[1:]:
        doc.update_stream(x, b'')
    return doc, doc[pno]


def without_strings(content, drop):
    pieces, last = [], 0
    for start, end, matrix, op in shows(content):
        if drop(matrix):
            pieces += [content[last:start], b'[]' if op == b'TJ' else b'()']
            last = end
    pieces.append(content[last:])
    return b''.join(pieces)


def text_alone(content):
    """Only the text: every path painted and every clip, shading and XObject
    dropped, so that the text is drawn whole and nothing over it."""
    out, last, operands_start = [], 0, None
    for m in TOKEN.finditer(content):
        t = m.group()
        if NUM.fullmatch(t) or t.startswith(STRING + (b'/',)) and t not in (b'<<', b'>>'):
            operands_start = m.start() if operands_start is None else operands_start
            continue
        if t in PAINT or t in (b'W', b'W*', b'Do'):
            start = operands_start if t in (b'Do', b'sh') and operands_start is not None else m.start()
            out += [content[last:start], b'n' if t in PAINT and t != b'sh' else b'']
            last = m.end()
        operands_start = None
    out.append(content[last:])
    return b''.join(out)


def masks(page, clip, zoom=ZOOM):
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, colorspace=pymupdf.csGRAY, alpha=False)
    return pix.width, pix.height, pix.samples


def bits(width, samples, pad):
    """A dark mask as one integer, a byte per pixel, rows padded with `pad`
    empty pixels so that a shift across never wraps into the next row."""
    rows = [samples[i:i + width].translate(DARK) + bytes(pad) for i in range(0, len(samples), width)]
    return int.from_bytes(b''.join(rows), 'big')


def dilate(mask, row_bytes, radius):
    for _ in range(radius):
        mask |= (mask << 8) | (mask >> 8)
    for _ in range(radius):
        mask |= (mask << (8 * row_bytes)) | (mask >> (8 * row_bytes))
    return mask


def tiles(rect, step=50, overlap=0.0, near=None):
    """Tiles of the page, each grown by overlap so that ink on either side of
    a tile's edge meets in one of them; with near, only tiles that meet one
    of those boxes."""
    for x in range(int(rect.x0), int(math.ceil(rect.x1)), step):
        for y in range(int(rect.y0), int(math.ceil(rect.y1)), step):
            tile = pymupdf.Rect(max(rect.x0, x - overlap), max(rect.y0, y - overlap),
                                min(x + step + overlap, rect.x1), min(y + step + overlap, rect.y1))
            if near is None or any(tile.intersects(b) for b in near):
                yield tile


def text_boxes(page, grow):
    """Where the page's text is, every span's box grown by `grow` points."""
    return [pymupdf.Rect(s['bbox']) + (-grow, -grow, grow, grow) for s in page.get_texttrace()]


def line_ink(path, pno, reach, shift=0.0):
    """The least gap, in points (to the pixel), between the ink of
    neighbouring lines on a page when it is within `reach`, else None. With
    shift, the odd lines are drawn that many points across the direction of
    their text (up for positive): the planted control."""
    doc = pymupdf.open(path)
    page = doc[pno]
    items = shows(content(doc, pno)[1])
    parity = {y: n % 2 for y, n in line_numbers(items).items()}
    a, b = (items[0][2][:2] if items else (1, 0))
    norm = math.hypot(a, b) or 1
    move = b'q 1 0 0 1 %.4f %.4f cm ' % (-b / norm * shift, a / norm * shift)

    def variant(drop, moved=False):
        return edited(path, pno, lambda c: (move + without_strings(c, drop) + b' Q') if moved
                      else without_strings(c, drop))
    even = variant(lambda m: parity[baseline(m)] == 1)
    odd = variant(lambda m: parity[baseline(m)] == 0, bool(shift))
    bare = variant(lambda m: True)
    bare_moved = variant(lambda m: True, bool(shift)) if shift else bare
    radius = int(math.ceil(reach * ZOOM))
    least = None
    near = text_boxes(page, reach + abs(shift) + 2)
    for clip in tiles(page.rect, overlap=reach + 1, near=near):
        w, _, ea = masks(even[1], clip)
        _, _, eb = masks(odd[1], clip)
        _, _, ga = masks(bare[1], clip)
        _, _, gb = masks(bare_moved[1], clip)
        a_ink = bits(w, ea, radius) & ~bits(w, ga, radius)
        b_ink = bits(w, eb, radius) & ~bits(w, gb, radius)
        if not a_ink or not b_ink:
            continue
        grown = a_ink
        for r in range(0, radius + 1):
            if r:
                grown = dilate(grown, w + radius, 1)
            if grown & b_ink:
                gap = r / ZOOM
                least = gap if least is None else min(least, gap)
                break
    return least


def visible_ink(path, pno):
    """Text ink, drawn alone and whole, that is not dark where the page is
    drawn, in points squared."""
    doc = pymupdf.open(path)
    page = doc[pno]
    alone_doc, alone = edited(path, pno, text_alone)
    hidden = 0
    for clip in tiles(page.rect, near=text_boxes(page, 2)):
        w, _, full = masks(page, clip)
        _, _, text = masks(alone, clip)
        if len(full) != len(text):
            continue
        drawn = int.from_bytes(full.translate(DARK), 'big')
        hidden += (int.from_bytes(text.translate(DARK), 'big') & ~drawn).bit_count()
    return round(hidden / ZOOM ** 2, 4)


def luminance(rgb):
    def channel(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def rgb(color):
    if color is None:
        return None
    if isinstance(color, int):
        return ((color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255)
    color = tuple(color)
    if len(color) == 1:
        return color * 3
    if len(color) == 4:
        c, m, y, k = color
        return tuple((1 - v) * (1 - k) for v in (c, m, y))
    return color


def origin_key(point):
    return (round(point[0], 2), round(point[1], 2))


def run_box(span, ink):
    """A run's box as the reader judges its visibility: its width, and the
    height of its glyphs' ink with the 0.01 em margin where every glyph's
    ink is known, else the font's box."""
    boxes = [pymupdf.Rect(c[3]) for c in span['chars'] if chr(c[0]).strip()]
    x0, x1 = min(b.x0 for b in boxes), max(b.x1 for b in boxes)
    glyphs = [ink.get(origin_key(c[2])) for c in span['chars'] if chr(c[0]).strip()]
    if all(g is not None and not g.is_empty for g in glyphs):
        margin = MARGIN_EM * span['size']
        return pymupdf.Rect(x0, min(g.y0 for g in glyphs) - margin, x1, max(g.y1 for g in glyphs) + margin)
    return pymupdf.Rect(x0, min(b.y0 for b in boxes), x1, max(b.y1 for b in boxes))


def visible(color, box, fills):
    """The reader's test (visibleOnBackground): from the latest background
    down, one it does not contrast with refuses the run unless it is a thin
    sliver; one it contrasts with must hold the whole box; else the page."""
    slivers = 0
    for _, b, background in sorted(fills, key=lambda f: f[0], reverse=True):
        if not (b.x0 < box.x1 and b.x1 > box.x0 and b.y0 < box.y1 and b.y1 > box.y0):
            continue
        if ratio(color, background) < CONTRAST:
            share = (b & box).get_area() / box.get_area() if box.get_area() else 1
            if min(b.width, b.height) <= 1 and share <= 0.1:
                slivers += share
                if slivers <= 0.2:
                    continue
            return False
        if b.contains(box):
            return True
    return ratio(color, (1, 1, 1)) >= CONTRAST


def check_page(path, doc, pno, clearance, reach):
    page = doc[pno]
    found = {}

    def add(check, what):
        found.setdefault(check, []).append(what)
    if page.rotation:
        add('rotation', page.rotation)
    if page.get_images(full=True) or page.get_image_info():
        add('images', len(page.get_image_info()) or len(page.get_images(full=True)))
    for widget in page.widgets() or []:
        add('widgets', widget.field_name)
    for _, _, m, _ in shows(content(doc, pno)[1]):
        a, b, c, d = m[:4]
        if abs(b) > 0.01 or abs(c) > 0.01 or a <= 0 or d <= 0:
            add('direction', [round(v, 3) for v in m[:4]])
            break
    rect = page.rect
    drawings = page.get_drawings()
    # The reader's backgrounds: opaque rectangles filled and not stroked.
    fills = [(d['seqno'], pymupdf.Rect(d['rect']), rgb(d.get('fill'))) for d in drawings
             if d.get('fill') is not None and d.get('type') == 'f' and (d.get('fill_opacity') or 1) == 1
             and all(item[0] == 're' for item in d['items'])]
    # As the reader sorts them: an opaque filled rectangle is a background,
    # judged by contrast (and, painted over text, by visibleInk); a stroke, or
    # a fill that is not only rectangles, is tested against the glyphs.
    rules = []
    for d in drawings:
        kind = d.get('type') or ''
        stroked = 's' in kind
        rectangles = all(item[0] == 're' for item in d['items'])
        if not stroked and (rectangles and (d.get('fill_opacity') or 1) == 1):
            continue
        half = (d.get('width') or 0) / 2 if stroked else 0
        for item in d['items']:
            if item[0] == 'l':
                p, q = item[1], item[2]
                r = pymupdf.Rect(min(p.x, q.x), min(p.y, q.y), max(p.x, q.x), max(p.y, q.y))
            elif item[0] == 're' and stroked and 'f' not in kind:
                # A stroked rectangle paints its four edges only.
                r = pymupdf.Rect(item[1])
                rules += [pymupdf.Rect(r.x0 - half, r.y0 - half, r.x1 + half, r.y0 + half),
                          pymupdf.Rect(r.x0 - half, r.y1 - half, r.x1 + half, r.y1 + half),
                          pymupdf.Rect(r.x0 - half, r.y0 - half, r.x0 + half, r.y1 + half),
                          pymupdf.Rect(r.x1 - half, r.y0 - half, r.x1 + half, r.y1 + half)]
                continue
            elif item[0] in ('re', 'qu', 'c'):
                r = pymupdf.Rect(item[1]) if item[0] == 're' else (
                    item[1].rect if item[0] == 'qu' else pymupdf.Rect(item[1], item[1]) | item[2] | item[3] | item[4])
            else:
                continue
            rules.append(pymupdf.Rect(r.x0 - half, r.y0 - half, r.x1 + half, r.y1 + half))
    least_rule = None
    ink = {}
    # Rules against MuPDF's glyph outline boxes, as verify.py measures them.
    for block in page.get_text('rawdict', flags=pymupdf.TEXT_ACCURATE_BBOXES)['blocks']:
        for line in block.get('lines', []):
            for span in line['spans']:
                margin = MARGIN_EM * span['size']
                for c in span['chars']:
                    g = pymupdf.Rect(c['bbox'])
                    ink[origin_key(c['origin'])] = g
                    if not c['c'].strip() or g.is_empty:
                        continue
                    for r in rules:
                        if g.x1 > r.x0 and g.x0 < r.x1:
                            gap = max(r.y0 - g.y1, g.y0 - r.y1)
                        elif g.y1 > r.y0 and g.y0 < r.y1:
                            gap = max(r.x0 - g.x1, g.x0 - r.x1)
                        else:
                            continue
                        least_rule = gap if least_rule is None else min(least_rule, gap)
                        if gap <= margin:
                            add('ruleClearance', [c['c'], round(gap, 2)])
    for span in page.get_texttrace():
        chars = [(pymupdf.Rect(c[3]), chr(c[0])) for c in span['chars'] if chr(c[0]).strip()]
        if not chars:
            continue
        if span.get('type') == 3 or span.get('opacity', 1) < 1:
            add('hiddenText', chars[0][1])
        for box, ch in chars:
            if box.y0 < rect.y0 - EDGE or box.y1 > rect.y1 + EDGE or box.x0 < rect.x0 - EDGE or box.x1 > rect.x1 + EDGE:
                add('pageEdge', ch)
                break
        color = rgb(span.get('color')) or (0, 0, 0)
        box = run_box(span, ink)
        if not visible(color, box, [f for f in fills if f[0] < span['seqno']]):
            add('contrast', [chars[0][1], [round(v, 2) for v in box]])
    gap = line_ink(path, pno, reach)
    if gap is not None and gap <= clearance:
        add('lineInk', round(gap, 2))
    hidden = visible_ink(path, pno)
    if hidden > 0:
        add('visibleInk', hidden)
    return found, least_rule, gap


def check_pdf(path, clearance=0.05, reach=0.5):
    doc = pymupdf.open(str(path))
    result = {'sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(), 'pages': doc.page_count, 'found': {}}
    if Path(path).stat().st_size > 8 * 1024 * 1024 or doc.page_count > 100:
        # The reader refuses the whole file; nothing else is read.
        result['found']['size'] = [{'bytes': Path(path).stat().st_size, 'pages': doc.page_count}]
        return result
    if doc.is_encrypted or doc.needs_pass:
        result['found']['encryption'] = [True]
        return result
    if doc.get_ocgs():
        result['found']['layers'] = list(doc.get_ocgs())
    least_rule, least_line = None, None
    for pno in range(doc.page_count):
        found, rule, gap = check_page(str(path), doc, pno, clearance, reach)
        for k, v in found.items():
            result['found'].setdefault(k, []).extend([{'page': pno + 1, 'at': x} for x in v[:3]])
        if rule is not None:
            least_rule = rule if least_rule is None else min(least_rule, rule)
        if gap is not None:
            least_line = gap if least_line is None else min(least_line, gap)
    # The planted control on the first page: three quarters of the median
    # distance between its lines, up and down, must show shared ink, or
    # nothing was measured. (How fine it sees is test_eligibility.py's.)
    numbers = line_numbers(shows(content(doc, 0)[1]))
    lines = [max(y for y, n in numbers.items() if n == k) for k in sorted(set(numbers.values()))]
    if len(lines) >= 2:
        gaps = sorted(a - b for a, b in zip(lines, lines[1:]))
        half = round(gaps[len(gaps) // 2] * 0.75, 2)
        control = [line_ink(str(path), 0, 0.0, shift=s) for s in (half, -half)]
        seen = [c is not None for c in control]
        result['lineControl'] = {'shiftPt': half, 'found': seen}
        # Two lines meet one way only; more must meet both ways.
        if not (all(seen) if len(lines) >= 3 else any(seen)):
            result['found']['lineControl'] = [{'page': 1, 'at': half}]
    if 'rotation' not in result['found']:
        stop = columns.check_statement(doc)
        if stop:
            result['found']['columns'] = [stop]
    result['leastRuleGapPt'] = None if least_rule is None else round(least_rule, 2)
    result['leastLineGapPt'] = least_line   # None: no closer than reach
    return result


def check_decision(package, story):
    """The declared decision story's case and outstanding item."""
    expected = json.loads((Path(package) / 'frozen' / 'EXPECTED.json').read_text(encoding='utf-8'))
    want = next(s for s in expected['stories'] if s['id'] == story)
    reasons = [g['reason'] for g in want.get('review', [])]
    problems = []
    if want.get('statement') != 'verified':
        problems.append(f'{story} is not a verified statement')
    if not any(r in ACCEPTABLE for r in reasons):
        problems.append(f'no case the page accepts: {reasons}')
    if not (want.get('bankOnly') or want.get('cashOnly')):
        problems.append('no outstanding item for the checker self-test')
    return {'story': story, 'reasons': reasons, 'problems': problems}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('package')
    ap.add_argument('--decide')
    ap.add_argument('--clearance', type=float, default=0.05)
    ap.add_argument('--out')
    a = ap.parse_args()
    if acceptable_in_source() != ACCEPTABLE:
        raise SystemExit(f'ACCEPTABLE drifted from {VIEW}: {acceptable_in_source()}')
    if columns.drift():
        raise SystemExit(f'the reader no longer carries what columns.py copies: {columns.drift()}')
    package = Path(a.package)
    report = {'package': package.name, 'clearancePt': a.clearance, 'statements': {}}
    for pdf in sorted((package / 'frozen').glob('*-statement.pdf')):
        story = pdf.name.split('-')[0]
        report['statements'][story] = check_pdf(pdf, a.clearance)
        print(story, json.dumps(report['statements'][story]['found'], ensure_ascii=False)[:300],
              'rule', report['statements'][story]['leastRuleGapPt'],
              'line', report['statements'][story]['leastLineGapPt'], flush=True)
    if a.decide:
        report['decision'] = check_decision(package, a.decide)
        print('decision', report['decision'])
    if a.out:
        Path(a.out).write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    sys.exit(main())
