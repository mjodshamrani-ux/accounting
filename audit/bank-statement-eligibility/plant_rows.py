"""Planted pages for rows.py: two or three lines set so that the reader's
test of adjacent rows refuses them in some of its three forms and not in the
others (rows.py's metric, ink and glyph). They are read by the product as
well as by rows.py, in the plain reader and with each of the two rules off
(measure_rows.mjs), so that each verdict here is the reader's.

  PYTHONPATH=<pymupdf 2.0> python3 -B plant_rows.py <dir>

The fonts are plant_items.py's: /F1 is MuPDF's Helvetica face embedded, its
descriptor's Ascent 1075 and Descent -299, so that its box is 13.74 points
at 10 points; its "1250.00" draws from the baseline to 7.23 points, and its
"p" 2.18 points below. /F4 is the standard Helvetica, not embedded, so that
no outline is proved and the reader keeps its metric box (PDF.js's 718 and
-207). /F5 is a TrueType font without a program whose descriptor's Ascent
and Descent are 0.
"""
import sys
from pathlib import Path

import pymupdf

import plant_items

TOP = b'BT /F1 10 Tf 40 150 Td (1250.00) Tj ET '
# (name, content, {form: lines refused}, why)
PAGES = [
    ('metric-only', TOP + b'BT /F1 10 Tf 40 141 Td (1250.00) Tj ET',
     {'metric': [1, 2], 'ink': [], 'glyph': []},
     '9 points apart: the boxes by ascent and descent overlap, the ink does not (G8)'),
    ('ink-not-glyph', b'BT /F1 10 Tf 40 150 Td (p1250) Tj ET BT /F1 10 Tf 45.56 141 Td (1250) Tj ET',
     {'metric': [1, 2], 'ink': [1, 2], 'glyph': []},
     'the "p" descends under the item, the line below sits beside it: one ink box overlaps, no glyph does (G10)'),
    ('glyphs-overlap', TOP + b'BT /F1 10 Tf 40 144 Td (1250.00) Tj ET',
     {'metric': [1, 2], 'ink': [1, 2], 'glyph': [1, 2]},
     '6 points apart: the glyphs themselves overlap'),
    ('apart', TOP + b'BT /F1 10 Tf 40 136 Td (1250.00) Tj ET',
     {'metric': [], 'ink': [], 'glyph': []},
     '14 points apart: not even the boxes by ascent and descent overlap'),
    ('raised-page', b'BT /F1 10 Tf 200 250 Td 2 Ts (Z) Tj 0 Ts ET ' + TOP + b'BT /F1 10 Tf 40 141 Td (1250.00) Tj ET',
     {'metric': [2, 3], 'ink': [2, 3], 'glyph': []},
     'a raised letter elsewhere on the page: no item there is judged by its ink box, each glyph still is'),
    ('not-embedded', b'BT /F4 10 Tf 40 150 Td (1250.00) Tj ET BT /F4 10 Tf 40 141.5 Td (1250.00) Tj ET',
     {'metric': [1, 2], 'ink': [1, 2], 'glyph': [1, 2]},
     'a font without a program: no outline is proved, every form keeps the box by ascent and descent'),
    ('raised-run', b'BT /F1 10 Tf 40 150 Td (1250) Tj 3 Ts (.00) Tj 0 Ts ET BT /F1 10 Tf 40 141 Td (1250.00) Tj ET',
     {'metric': [1, 2, 3], 'ink': [1, 2, 3], 'glyph': []},
     'glyphs raised 3 points inside one text object: a line of their own, each glyph on its baseline; the page is raised'),
    ('spaced-ink', b'BT /F1 10 Tf 1 Tc 40 150 Td (p1250) Tj ET BT /F1 10 Tf 0 Tc 46.56 141 Td (1250) Tj ET',
     {'metric': [1, 2], 'ink': [1, 2], 'glyph': [1, 2]},
     'one point of character spacing after each glyph: the last placement ends a point past the item, which keeps its ink box'),
    ('spaced-apart', b'BT /F1 10 Tf 1 Tc 40 150 Td (1250.00) Tj ET BT /F1 10 Tf 1 Tc 40 141 Td (1250.00) Tj ET',
     {'metric': [1, 2], 'ink': [], 'glyph': []},
     'both lines spaced so: no glyph boxes, and their ink boxes apart'),
    ('raised-within-item', b'BT /F1 10 Tf 40 150 Td (1250) Tj 0.8 Ts (.00) Tj 0 Ts ET ' + b'BT /F1 10 Tf 40 141 Td (1250.00) Tj ET',
     {'metric': [1, 2], 'ink': [1, 2], 'glyph': [1, 2]},
     'three glyphs raised 0.8 points inside one item leave its baseline: the item keeps one box, by its metrics on a raised page'),
    ('no-metrics', b'BT /F5 10 Tf 40 150 Td (1250.00) Tj ET',
     {'metric': 'unprovable', 'ink': 'unprovable', 'glyph': 'unprovable'},
     'a font without a program whose descriptor gives an ascent and descent of 0: the reader stops before the rows'),
]


def build(path, content):
    plant_items.build(path, content)
    doc = pymupdf.open(path)
    page = doc[0]
    helvetica = doc.get_new_xref()
    doc.update_object(helvetica, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    bare, bare_desc = doc.get_new_xref(), doc.get_new_xref()
    doc.update_object(bare_desc, '<< /Type /FontDescriptor /FontName /PlantedSans /Flags 32 '
                                 '/FontBBox [0 0 0 0] /ItalicAngle 0 /Ascent 0 /Descent 0 /StemV 80 >>')
    doc.update_object(bare, f'<< /Type /Font /Subtype /TrueType /BaseFont /PlantedSans /FirstChar 32 /LastChar 126 '
                            f'/Widths [{" ".join(["556"] * 95)}] /Encoding /WinAnsiEncoding /FontDescriptor {bare_desc} 0 R >>')
    fonts = doc.xref_get_key(page.xref, 'Resources/Font')[1]
    doc.xref_set_key(page.xref, 'Resources/Font', fonts[:-2] + f' /F4 {helvetica} 0 R /F5 {bare} 0 R >>')
    data = doc.tobytes()
    doc.close()
    Path(path).write_bytes(data)


def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for name, content, _, _ in PAGES:
        build(str(out / f'{name}.pdf'), content)


if __name__ == '__main__':
    main(sys.argv[1])
