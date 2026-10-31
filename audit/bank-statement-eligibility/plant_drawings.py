"""Planted pages for drawings.py: text and one drawing set so that the
reader's drawing, clip and background tests refuse the page with some of its
rules and not without them. They are read by the product, as it is and with
each rule off (measure_drawings.mjs), as well as by drawings.py, so that each
verdict here is the reader's.

  PYTHONPATH=<pymupdf 2.0, fontTools> python3 -B plant_drawings.py <dir>

The font is plant_items.py's /F1, MuPDF's Helvetica face embedded: at 10
points its "1250.00" draws from the baseline to 7.23 points, its "p" 2.18
points below, and its box by ascent and descent runs from 2.99 below to
10.75 above; the reader pads the box to 3 points below. The text stands at
40, 150.
"""
import sys
from pathlib import Path

import plant_items

TEXT = b'BT /F1 10 Tf 40 150 Td (1250.00) Tj ET '
SPACED = b'BT /F1 10 Tf 1 Tc 40 150 Td (1250.00) Tj ET '
DESCENDER = b'BT /F1 10 Tf 40 150 Td (p1250) Tj ET '
NONE = {'today': None, 'noInkDrawing': None, 'noGlyphDrawings': None, 'noRectangleReturn': None}


def every(kind):
    return {c: kind for c in NONE}


# (name, content, {config: the kind refused, or None}, why)
PAGES = [
    ('rule-apart', TEXT + b'0.5 w 30 144 m 120 144 l S',
     NONE, 'a rule 6 points under the baseline'),
    ('rule-through', TEXT + b'0.5 w 30 153 m 120 153 l S',
     every('drawing'), 'a rule through the digits'),
    ('rule-in-the-padding', SPACED + b'0.5 w 30 147.5 m 120 147.5 l S',
     dict(NONE, noInkDrawing='drawing'),
     'spaced so that the item has no glyph boxes: a rule 2.5 points under the baseline meets its padded box, not its ink'),
    ('rule-beside-the-glyphs', DESCENDER + b'0.5 w 47 148.5 m 120 148.5 l S',
     dict(NONE, noGlyphDrawings='drawing'),
     'a rule 1.5 points under the digits: inside the ink box the "p" stretches down, beside every glyph box'),
    ('rectangle-traced-back', b'0.9 g 36 145 m 90 145 l 90 160 l 36 160 l 36 145 l f 0 g ' + TEXT,
     dict(NONE, noRectangleReturn='drawing'),
     'a cell filled under the text by a path of five points back to its first, without a close'),
    ('rectangle-closed', b'0.9 g 36 145 m 90 145 l 90 160 l 36 160 l h f 0 g ' + TEXT,
     NONE, 'the same cell closed by h: a rectangle with the rule or without'),
    ('closed-twice', b'0.9 g 36 145 54 15 re h f 0 g ' + TEXT,
     every('drawing'), 're then h, as MuPDF writes a fill: a path closed twice, which the reader reads as no rectangle'),
    ('clip-traced-back', b'q 36 140 m 90 140 l 90 165 l 36 165 l 36 140 l W n ' + TEXT + b'Q',
     dict(NONE, noRectangleReturn='clip'),
     'text under a clip drawn by five points back to its first'),
    ('clip-cuts', b'q 36 140 54 12 re W n ' + TEXT + b'Q',
     every('clip'), 'a rectangle clip that cuts the top of the digits'),
    ('background-over-text', TEXT + b'0.9 g 100 145 50 15 re f 0 g 36 148 40 4 re f',
     every('covers'), 'an opaque rectangle painted over text already drawn'),
    ('curve-near', TEXT + b'0.5 w 30 140 m 60 140 90 165 120 140 c S',
     every('drawing'), 'a curve: judged by its bounds, which reach the digits'),
    ('hairline-near', TEXT + b'0 w 30 149.5 m 120 149.5 l S',
     every('drawing'), 'a hairline 0.4 points under the ink: a stroke is padded by half a point at least'),
    ('rule-ends-short', TEXT + b'0.5 w 10 153 m 40.32 153 l S',
     every('drawing'), 'a rule ending 0.6 points before the first glyph box: its square cap reaches it'),
    ('miter-tip', TEXT + b'1 w 10 M 55 140 m 60 148.8 l 65 140 l S',
     every('drawing'), 'a sharp corner 0.87 points under the overshoot of a round digit: only its miter tip reaches it'),
    ('scaled-rule', TEXT + b'q 3 0 0 3 0 0 cm 1 w 10 49.5 m 40 49.5 l S Q',
     every('drawing'), 'a rule of width 1 drawn at three times its size: padded by 1.5 points, it meets the ink'),
    ('white-on-traced-fill', b'q 0.2 0.3 0.4 rg 1 0 0 1 36 140 cm 0 0 m 0 20 l 114 20 l 114 0 l h f Q 1 g ' + TEXT,
     NONE, 'white text on a dark fill traced by lines under a translation, as pdf-lib draws a rectangle (G23): '
     'a background'),
    ('white-on-skewed-fill', b'q 0.2 0.3 0.4 rg 1 0 0 1 36 140 cm 0 0 m 0 20 l 114 20 l 114 0.5 l h f Q 1 g ' + TEXT,
     every('drawing'), 'the same fill with one corner half a point off: no rectangle, a drawing under the text'),
]


def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for name, content, _, _ in PAGES:
        plant_items.build(out / f'{name}.pdf', content)


if __name__ == '__main__':
    main(sys.argv[1])
