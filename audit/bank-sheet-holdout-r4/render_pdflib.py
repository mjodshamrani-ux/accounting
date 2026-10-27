"""Prepares the G23 pdf-lib statements for js/render_pdflib.mjs.

pdf-lib is the JavaScript library many web and serverless services write
their PDF statements and invoices with. The Node application lays out its
own table and draws each line through bidi-js and pdf-lib
(js/render_pdflib.mjs says how). This file writes what the application
reads: per story the printed rows (common.table_rows), the heading texts,
the style and the font files.
"""
import json
from pathlib import Path

import fonts as font_files
from common import LABELS, account_line, footer, table_rows

COLOURS = {'Lemonada': '2B4C7E', 'Tajawal': '1F5C5C', 'Cairo': '7A1F1F', 'Alexandria': '5C5C5C',
           'Readex Pro': '3F4E5E', 'Rubik': '333333'}
# The type is smaller where the widest cell would not fit at 7.2 points:
# Lemonada's dates and its Value Date heading.
SIZES = {'Lemonada': 6.6}


def prepare(stories, work, modules, out):
    """Writes <work>/statements.json; returns [(story, path)] to be drawn."""
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    jobs, drawn = [], []
    for story in stories:
        if story['producer'] != 'pdflib':
            continue
        L = LABELS[story['layout']]
        path = Path(out) / f"{story['id']}-statement.pdf"
        jobs.append({
            'id': story['id'], 'out': str(path), 'paper': story['paper'], 'layout': story['layout'],
            'regular': str(font_files.files_of(modules, story['font'], '400')),
            'bold': str(font_files.files_of(modules, story['font'], '700')),
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
