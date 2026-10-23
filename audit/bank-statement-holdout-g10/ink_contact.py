"""Shared ink between neighbouring printed lines, after the first run.

Not part of the seal: written after G10's first run, when the product
refused P09 and P10 for overlapping rows and verify.py, which proves that no
glyph meets a painted rule, had never compared glyphs of two lines. It asks
the question the product's row guard asks, of ink rather than of boxes:
does the ink of one line meet the ink of the line above or below it?

Every text-showing operator is placed on its baseline: the distance of its
origin across the direction of its text, from the text matrix times the CTM
as q, Q, cm, BT, Tm, Td, TD, T*, TL, ' and " set them, so that a page drawn
turned (OpenPDF's landscape, a portrait page with /Rotate 90) is grouped by
its own lines. The
baselines are numbered from the top and split by parity, so neighbouring
lines fall in different sets. Each page is rendered by MuPDF once with each
set's strings emptied and once with every string emptied; a pixel is shared
ink when it is black (gray below 128, at least half covered) in both sets'
renders and not in the bare one, which leaves out rules and fills. Two lines
with a line between them are in the same set and are not compared.

The control plants the fault: each statement's first page is compared with
one set's render moved up and then down by half the page's median distance
between neighbouring baselines, and must show shared ink both ways, or the
measurement failed.

  PYTHONPATH=<pymupdf 2.0> python3 -B ink_contact.py <frozen dir> --out <json> [--zoom 10]
"""
import argparse
import json
import math
import re
from pathlib import Path

import pymupdf

DARK = bytes(1 if v < 128 else 0 for v in range(256))
TOKEN = re.compile(rb'\((?:\\.|[^\\()]|\((?:\\.|[^\\()])*\))*\)|<<|>>|<[0-9A-Fa-f\s]*>|\[|\]'
                   rb'|/[^\s()<>\[\]{}/%]*|%[^\n]*|[^\s()<>\[\]{}/%]+', re.S)
NUM = re.compile(rb'[+-]?(\d+\.?\d*|\.\d+)')
STRING = (b'(', b'<', b'[', b']')


def mul(m, n):
    a, b, c, d, e, f = m
    A, B, C, D, E, F = n
    return (a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F)


def shows(content):
    """[(operand start, operand end, page baseline, operator)] for every
    Tj, TJ, ' and " in a cleaned content stream."""
    ctm, stack = (1, 0, 0, 1, 0, 0), []
    tm = tlm = (1, 0, 0, 1, 0, 0)
    leading, operands, out = 0.0, [], []

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
        elif t == b'cm':
            ctm = mul(tuple(nums[-6:]), ctm)
        elif t == b'BT':
            tm = tlm = (1, 0, 0, 1, 0, 0)
        elif t == b'Tm':
            tm = tlm = tuple(nums[-6:])
        elif t == b'Td':
            td(nums[-2], nums[-1])
        elif t == b'TD':
            leading = -nums[-1]
            td(nums[-2], nums[-1])
        elif t == b'TL':
            leading = nums[-1]
        elif t in (b'T*', b"'", b'"'):
            td(0, -leading)
        if t in (b'Tj', b'TJ', b"'", b'"'):
            strings = [o for o in operands if o.group().startswith(STRING)]
            if strings:
                start = next(o for o in operands if o.group() == b'[').start() if t == b'TJ' else strings[0].start()
                a, b, _, _, e, f = mul(tm, ctm)
                out.append((start, strings[-1].end(), round((a * f - b * e) / math.hypot(a, b), 1), t))
        operands = []
    return out


def emptied(path, pno, drop):
    """The page with the strings on the dropped baselines emptied."""
    doc = pymupdf.open(path)
    page = doc[pno]
    page.clean_contents()
    xref = page.get_contents()[0]
    content = doc.xref_stream(xref)
    pieces, last = [], 0
    for start, end, y, op in shows(content):
        if drop(y):
            pieces += [content[last:start], b'[]' if op == b'TJ' else b'()']
            last = end
    pieces.append(content[last:])
    doc.update_stream(xref, b''.join(pieces))
    return doc


def baselines(path, pno):
    src = pymupdf.open(path)
    page = src[pno]
    page.clean_contents()
    return page.rect, sorted({y for _, _, y, _ in shows(src.xref_stream(page.get_contents()[0]))}, reverse=True)


def shared(path, pno, zoom, shift=0.0, step=50):
    """Shared ink on one page, with the odd set's render moved by shift."""
    rect, ys = baselines(path, pno)
    parity = {y: i % 2 for i, y in enumerate(ys)}
    even = emptied(path, pno, lambda y: parity[y] == 1)[pno]
    odd = emptied(path, pno, lambda y: parity[y] == 0)[pno]
    bare = emptied(path, pno, lambda y: True)[pno]
    m = pymupdf.Matrix(zoom, zoom)

    def ink(doc_page, clip):
        return int.from_bytes(doc_page.get_pixmap(matrix=m, clip=clip, colorspace=pymupdf.csGRAY,
                                                  alpha=False).samples.translate(DARK), 'big')
    total, where = 0, []
    for x in range(int(rect.x0), int(rect.x1), step):
        for y in range(int(rect.y0), int(rect.y1), step):
            clip = pymupdf.Rect(x, y, min(x + step, rect.x1), min(y + step, rect.y1))
            moved = clip + (0, -shift, 0, -shift)
            if moved.y0 < rect.y0 or moved.y1 > rect.y1:
                continue
            n = (ink(even, clip) & ~ink(bare, clip) & ink(odd, moved) & ~ink(bare, moved)).bit_count()
            if n:
                total += n
                where.append([round(v, 1) for v in clip])
    return {'page': pno + 1, 'baselines': len(ys), 'sharedInkPt2': round(total / zoom ** 2, 4), 'tiles': where}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('frozen')
    ap.add_argument('--out', required=True)
    ap.add_argument('--zoom', type=float, default=10)
    a = ap.parse_args()
    report = {'zoom': a.zoom, 'statements': {}}
    for pdf in sorted(Path(a.frozen).glob('*-statement.pdf')):
        with pymupdf.open(pdf) as doc:
            pages = doc.page_count
        story = pdf.name.split('-')[0]
        _, ys = baselines(pdf, 0)
        gaps = sorted(a - b for a, b in zip(ys, ys[1:]))
        half = round(gaps[len(gaps) // 2] / 2, 2)
        control = [shared(pdf, 0, a.zoom, s)['sharedInkPt2'] for s in (half, -half)]
        if not all(control):
            raise SystemExit(f'{story}: a planted shift of {half} points was not found: {control}')
        report['statements'][story] = {
            'pages': [shared(pdf, p, a.zoom) for p in range(pages)],
            'control': {'shiftPt': half, 'sharedInkPt2': control},
        }
        found = [p['page'] for p in report['statements'][story]['pages'] if p['sharedInkPt2']]
        print(story, 'shared ink on pages', found or 'none', 'control', control, flush=True)
    Path(a.out).write_text(json.dumps(report, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
