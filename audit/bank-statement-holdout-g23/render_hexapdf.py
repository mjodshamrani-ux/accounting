"""Prepares the G23 HexaPDF statements for ruby/statements.rb.

HexaPDF is the pure Ruby PDF library behind Ruby back offices' statements
and invoices. The Ruby service lays out its own table and draws each piece
of text at its baseline (ruby/statements.rb says how). This file writes what
the service reads: per story the printed rows (common.table_rows), the
heading texts, the style, the font files, and the regular font's ascent and
line height from its hhea table, which HexaPDF does not hand a caller.
"""
import json
from pathlib import Path

import fonts as font_files
from common import LABELS, account_line, footer, table_rows

COLOURS = {'Work Sans': '6B4226', 'Merriweather': '2F2F2F', 'Space Mono': '333333', 'Fira Sans': '3E3A5C'}
# The type is smaller where the widest cell would not fit at 7.2 points: Space
# Mono's balances with DR, Merriweather's dates.
SIZES = {'Space Mono': 6.4, 'Merriweather': 7.0}


def prepare(stories, work, modules, out):
    """Writes <work>/statements.json; returns [(story, path)] to be drawn."""
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    jobs, drawn = [], []
    for story in stories:
        if story['producer'] != 'hexapdf':
            continue
        assert story['layout'] == 'en', 'HexaPDF draws without shaping: English statements only'
        L = LABELS[story['layout']]
        path = Path(out) / f"{story['id']}-statement.pdf"
        regular = font_files.files_of(modules, story['font'], '400')
        ascent, line_height = font_files.metrics(regular)
        jobs.append({
            'id': story['id'], 'out': str(path), 'paper': story['paper'], 'layout': story['layout'],
            'regular': str(regular), 'bold': str(font_files.files_of(modules, story['font'], '700')),
            'ascent': round(ascent, 6), 'lineHeight': round(line_height, 6),
            'size': SIZES.get(story['font'], 7.6 if story['paper'] == 'A4-landscape' else 7.2),
            'style': story['recipe']['style'], 'fill': COLOURS[story['font']], 'bank': story['bank'],
            'title': story['documentTitle'], 'account': account_line(story), 'number': story['statement']['account'],
            'headers': L['headers'],
            'pages': [{'footer': footer(story, page), 'rows': [{'kind': k, 'cells': c} for k, c in table_rows(story, page)]}
                      for page in story['statement']['pages']],
        })
        font_files.check_covers(jobs[-1])
        drawn.append((story, path))
    (work / 'statements.json').write_text(json.dumps({'statements': jobs}, ensure_ascii=False, indent=1),
                                          encoding='utf-8')
    return drawn
