"""Mutants of drawings.py, and of what it takes from rows.py and gives to
eligibility.py, each of which a test of class Drawings must kill.

Each mutant changes one rule copied from the reader: the half point a stroke
is padded by at least, its width carried by the transform, its square caps,
its miter joins; a background painted over text, a clip the reader cannot
prove, a rectangle clip's bounds; the rectangle traced back to its start, on
always or never; today's targets without glyph boxes, or the padded boxes
taken for ink with the drawing-by-ink rule off; the reader's long advances
for a CFF FontMatrix; or stops the eligibility check counting a rule or
finding today's refusal. The tool is copied with the mutant into a temporary
tree (mutate_columns.tree), after its tests pass there unmutated. Exit
status 1 if a mutant survives.
"""
from mutate_columns import main

MUTANTS = {
    'pad-0': ('            pad = 0 if fill_only else max(0.5, abs(st.line_width) * scale / 2)',
              '            pad = 0 if fill_only else max(0.0, abs(st.line_width) * scale / 2)'),
    'scale-ignored': ('            scale = math.sqrt((square + math.sqrt(max(0.0, square * square - 4 * det * det))) / 2)',
                      '            scale = 1.0'),
    'caps-ignored': ('    cap = half * math.sqrt(2)', '    cap = 0.0'),
    'miter-ignored': ('        if join == 0 and len(points) > 2:', '        if False:'),
    'covers-ignored': ("                        return {'kind': 'covers', 'op': shown}", '                        pass'),
    'unproved-clip-ignored': ('            if st.clipped or (st.clip_box and any(', '            if (st.clip_box and any('),
    'clip-box-ignored': ('            if st.clipped or (st.clip_box and any(', '            if st.clipped or (False and any('),
    'traced-back-always': ('        if traced_back and len(points) == 5 and points[-1] == points[0]:',
                           '        if len(points) == 5 and points[-1] == points[0]:'),
    'traced-back-never': ('        if traced_back and len(points) == 5 and points[-1] == points[0]:',
                          '        if False:'),
    'today-without-glyph-boxes': ("            if config != 'noGlyphDrawings' and glyphs[k]:", '            if False:'),
    'padded-as-ink': ("                out.append(pads[k] if config == 'noInkDrawing' else clip_of[k])",
                      '                out.append(clip_of[k])'),
    'advance-scale-ignored': ('rows.py', "    right += sum(mark[6] * (found[id(mark[0])].advance_scale - 1) for mark in item.marks)\n",
                              ''),
    'drawing-by-ink-uncounted': ('eligibility.py', "    for config, rule in (('noInkDrawing', 'drawingByInk'), ('noGlyphDrawings', 'drawingsByGlyphs'),",
                                 "    for config, rule in (('noGlyphDrawings', 'drawingsByGlyphs'),"),
    'drawings-by-glyphs-uncounted': ('eligibility.py', "    for config, rule in (('noInkDrawing', 'drawingByInk'), ('noGlyphDrawings', 'drawingsByGlyphs'),",
                                     "    for config, rule in (('noInkDrawing', 'drawingByInk'),"),
    'rectangle-uncounted': ('eligibility.py', "                         ('noRectangleReturn', 'rectangleTraced')):",
                            '                         ):'),
    'drawings-not-found': ('eligibility.py', "    return {'drawings': [today]} if today else {}", '    return {}'),
}

if __name__ == '__main__':
    main(MUTANTS, 'drawings.py', 'test_eligibility.Drawings')
