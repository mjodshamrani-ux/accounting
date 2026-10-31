"""Planted pages for items.py: each sets two pieces of text one way PDF.js
may or may not make one item of, and so decides whether the reader refuses
the line for overlapping text. They are read by the product as well as by
items.py (measure_items.mjs), so that each verdict here is the reader's.

  PYTHONPATH=<pymupdf 2.0> python3 -B plant_items.py <dir>

The font is MuPDF's own Helvetica face, embedded so that the reader can
prove its glyphs, under two subset names: /F1 AAAAAA+NimbusSans-Regular and
/F2 BBBBBB+NimbusSans-Regular are two subsets of one font, one name to MuPDF
and two to PDF.js; /F3 is a second resource name for the font /F1 names.
"Transfer" is 37.23 points wide at 10 points; a TJ number of 30 moves 0.3
points back.
"""
import sys
from pathlib import Path

import pymupdf

LINE = b'BT /F1 10 Tf 40 120 Td (Transfer) Tj '
# (name, content, the reader refuses a line for overlapping text, why)
PAGES = [
    ('subsets-0.3', LINE + b'/F2 10 Tf [30 (1,250.00)] TJ ET', True,
     'two subsets of one font: a new item, 0.3 points under the end of the first'),
    ('subsets-0.1', LINE + b'/F2 10 Tf [10 (1,250.00)] TJ ET', False,
     'two items, 0.1 points under: inside the reader\'s 0.2'),
    ('one-font-0.3', LINE + b'[30 (1,250.00)] TJ ET', False,
     'one font: one item, whatever its glyphs overlap'),
    ('two-names-0.3', LINE + b'/F3 10 Tf [30 (1,250.00)] TJ ET', False,
     'a second resource name for the same font: one item'),
    ('marked-content-0.3', LINE + b'/Span <</ActualText (x)>> BDC [30 (1,250.00)] TJ EMC ET', True,
     'marked content ends the item: the next starts 0.3 points back'),
    ('back-0.25em', b'BT /F1 10 Tf 40 120 Td [(Transfer) 250 (1,250.00)] TJ ET', True,
     'back 0.25 em inside one TJ: PDF.js ends the item, the next starts 2.5 points back'),
    ('back-0.15em', b'BT /F1 10 Tf 40 120 Td [(Transfer) 150 (1,250.00)] TJ ET', False,
     'back 0.15 em: one item'),
    ('two-text-objects', LINE + b'ET BT /F1 10 Tf 76.13 120 Td (1,250.00) Tj ET', False,
     'a new text object 1.1 points back: PDF.js keeps one item across BT'),
    ('space-then-tight', b'BT /F1 10 Tf 40 120 Td [(Transfer ) 200 (1,250.00)] TJ ET', False,
     'a drawn space, then 0.078 em: two items side by side (G17 V10)'),
    ('gap-0.8em', b'BT /F1 10 Tf 40 120 Td [(Transfer) -800 (1,250.00)] TJ ET', False,
     'a gap of 0.8 em, past PDF.js\'s 0.6: two items (G19)'),
]


def build(path, content):
    doc = pymupdf.open()
    page = doc.new_page(width=420, height=300)
    first = page.insert_font(fontname='F1', fontbuffer=pymupdf.Font('helv').buffer, set_simple=True)
    desc = int(doc.xref_get_key(first, 'FontDescriptor')[1].split()[0])
    second, second_desc = doc.get_new_xref(), doc.get_new_xref()
    doc.update_object(second_desc, doc.xref_object(desc))
    doc.update_object(second, doc.xref_object(first))
    doc.xref_set_key(second, 'FontDescriptor', f'{second_desc} 0 R')
    for xref, d, tag in ((first, desc, 'AAAAAA'), (second, second_desc, 'BBBBBB')):
        doc.xref_set_key(xref, 'BaseFont', f'/{tag}+NimbusSans-Regular')
        doc.xref_set_key(d, 'FontName', f'/{tag}+NimbusSans-Regular')
    doc.xref_set_key(page.xref, 'Resources', f'<< /Font << /F1 {first} 0 R /F2 {second} 0 R /F3 {first} 0 R >> >>')
    stream = doc.get_new_xref()
    doc.update_object(stream, '<< >>')
    doc.update_stream(stream, content)
    doc.xref_set_key(page.xref, 'Contents', f'{stream} 0 R')
    doc.save(path)


def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for name, content, _, _ in PAGES:
        build(out / f'{name}.pdf', content)


if __name__ == '__main__':
    main(sys.argv[1])
