"""Mutants of items.py, each of which a test of class Items must kill.

Each mutant changes one rule copied from PDF.js or the reader: the reader's
0.2 points, a font known by its name without its subset tag (as MuPDF names
it), the 0.2 em back that ends an item, marked content joined, a drawn space
not ending the item, a text object ending one, TJ numbers ignored, the line
join, PDF.js's white space anywhere in a glyph's text, or the margin under
the guard uncounted; and, since G19, the 0.6 em gap past which PDF.js ends
an item and a ligature glyph's letters kept together, mutated in
mutate_columns.py's MuPDF model until then. The tool is copied with the mutant into a temporary
tree (mutate_columns.tree), after its tests pass there unmutated. Exit
status 1 if a mutant survives.
"""
from mutate_columns import main

MUTANTS = {
    'guard-0.3': ('OVERLAP = 0.2 ', 'OVERLAP = 0.3 '),
    'name-untagged': ("        self.name = (name if name != 'null' else doc.xref_get_key(xref, 'BaseFont')[1]).lstrip('/')",
                      "        self.name = (name if name != 'null' else doc.xref_get_key(xref, 'BaseFont')[1]).split('+')[-1]"),
    'back-2em': ('TRACKING, NOT_A_SPACE, NEGATIVE, SPACE_MIN, SPACE_MAX, ACROSS = 0.102, 0.03, -0.2, 0.102, 0.6, 0.25',
                 'TRACKING, NOT_A_SPACE, NEGATIVE, SPACE_MIN, SPACE_MAX, ACROSS = 0.102, 0.03, -2.0, 0.102, 0.6, 0.25'),
    'marked-content-joined': ("        elif t in (b'BMC', b'BDC', b'EMC', b'Do'):", "        elif t == b'Do':"),
    'space-kept-in-item': ('            if self.space_last():', '            if False:'),
    'text-object-ends-item': ("            st.tm = st.tlm = IDENTITY\n", "            st.tm = st.tlm = IDENTITY\n            b.flush()\n"),
    'tj-numbers-ignored': ("                elif tounicode.NUMBER.fullmatch(o) and float(o) != 0:", '                elif False:'),
    'line-join-1pt': ('if out and abs(out[-1][0].y - t.y) <= min(1, t.height / 8):', 'if out and abs(out[-1][0].y - t.y) <= 1:'),
    'white-anywhere': ("        if i == 0 and ch in WHITE:", '        if ch in WHITE:'),
    'margin-uncounted': ('                most = under if most is None else max(most, under)', '                pass'),
    # Moved from mutate_columns.py with the items (G19).
    'space-max-1em': ('TRACKING, NOT_A_SPACE, NEGATIVE, SPACE_MIN, SPACE_MAX, ACROSS = 0.102, 0.03, -0.2, 0.102, 0.6, 0.25',
                      'TRACKING, NOT_A_SPACE, NEGATIVE, SPACE_MIN, SPACE_MAX, ACROSS = 0.102, 0.03, -0.2, 0.102, 1.0, 0.25'),
    'ligature-letters-apart': ("            return ''.join(chr(c) for c in self.map[code][0])",
                               '            return chr(self.map[code][0][0])'),
}

if __name__ == '__main__':
    main(MUTANTS, 'items.py', 'test_eligibility.Items')
