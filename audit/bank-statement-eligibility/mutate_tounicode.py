"""Mutants of tounicode.py, each of which a test of class ToUnicode must kill.

Each mutant changes one rule copied from the prepared PDF.js: an odd length
padded as PDF.js pads it unprepared, a surrogate without its pair read as a
pair, a U+FFFD the page shows let through, a range's carry past 255, a form's
text unread, a font selected and not loaded, or a lone surrogate uncounted
(G15). The tool is copied with the mutant into a temporary tree that links
the repository's reader source, the product's own Unicode fixtures and the
sealed packages (mutate_columns.tree). Exit status 1 if a mutant survives.
"""
from mutate_columns import main

MUTANTS = {
    'odd-padded': ("        raise Unreadable('odd length')", "        dst = (0,) + tuple(dst)"),
    'pair-anyway': ("        if n > 0xDBFF or not 0xDC00 <= pair <= 0xDFFF:", "        if pair < 0:"),
    'shown-replacement-passed': ("        if bad:\n", "        if False:\n"),
    'carry-off': ("                    if value[last] + 1 > 255:", "                    if False:"),
    'forms-unread': ("            elif t == b'Do' and depth < 8:", "            elif False:"),
    'selected-unloaded': ("                    selected.add(font)\n", ''),
    'lone-uncounted': ("            lone.add(name)\n", "            pass\n"),
}

if __name__ == '__main__':
    main(MUTANTS, 'tounicode.py', 'test_eligibility.ToUnicode')
