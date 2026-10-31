"""Mutants of rows.py, and of what it takes from items.py and gives to
eligibility.py, each of which a test of class Rows must kill.

Each mutant changes one rule copied from the reader: the 0.2 points both
ways, the 0.01 em around the ink, a raised page judged by ink all the same,
a glyph off the item's baseline or placements past its extent given their
own boxes, the spacing after a glyph left out of its placement, the ink form
judged by metrics, the glyph form without its fallback to ink, a TrueType
outline in thousandths of an em whatever the font's units, a style without
ascent and descent laid out all the same; or stops the eligibility check
counting a rule or finding today's refusal. The tool is copied with the
mutant into a temporary tree (mutate_columns.tree), after its tests pass
there unmutated. Exit status 1 if a mutant survives.
"""
from mutate_columns import main

MUTANTS = {
    'gap-0.1': ('GAP = 0.2 ', 'GAP = 0.1 '),
    'margin-0': ('MARGIN = 0.01 ', 'MARGIN = 0.0 '),
    'raised-ignored': ("        if t == b'Ts' and operands and operands[-1] != 0:", '        if False:'),
    'baseline-ignored': ('        if o is None or abs(m[5] - item.y) > PLACED:', '        if o is None:'),
    'extent-ignored': ('    if abs(left - item.x) > PLACED or abs(right - (item.x + item.width)) > PLACED:',
                       '    if False:'),
    'spacing-not-placed': ('items.py', "            em = width * 0.001 + ((spacing + (st.word_spacing if code == 32 else 0)) / st.size if st.size else 0)",
                           '            em = width * 0.001'),
    'ink-form-by-metrics': ("    if form != 'metric' and not raised:", "    if form == 'glyph' and not raised:"),
    'glyph-form-without-ink': ("    if form != 'metric' and not raised:", "    if form == 'ink' and not raised:"),
    'ttf-thousandths': ('        upem = self.ttf[\'head\'].unitsPerEm\n        return', '        upem = 1000\n        return'),
    'metrics-unchecked': ("    if any(metric_box(t, found.get(id(t.face))) is None for line in lines for t in line):",
                          '    if False:'),
    'rows-by-ink-uncounted': ('eligibility.py', "    used['rowsByInk'] += len(set(forms['metric']) - today)\n", ''),
    'rows-by-glyphs-uncounted': ('eligibility.py', "    used['rowsByGlyphs'] += len(set(forms['ink']) - today)\n", ''),
    'rows-not-found': ('eligibility.py', "    return {'rows': sorted(today)} if today else {}", '    return {}'),
}

if __name__ == '__main__':
    main(MUTANTS, 'rows.py', 'test_eligibility.Rows')
