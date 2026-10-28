"""Prepares the C4 PDFKit statements for js/render_pdfkit.mjs, the G20
PDFKit statement application copied unchanged.

PDFKit is the Node library behind many web services' PDF statements and
invoices, and pdfmake's writer. The Node application lays out its own table
and draws each line through bidi-js and PDFKit (js/render_pdfkit.mjs says
how). This file writes what the application reads: per story the printed
rows (common.table_rows), the heading texts, the style and the font files.
Adapted from G20's render_pdfkit.py to the C4 fonts.
"""
import json
from pathlib import Path

import fonts as font_files
from common import LABELS, account_line, footer, table_rows

COLOURS = {'DM Sans': '24476B', 'Kufam': '1C3166', 'Baloo Bhaijaan 2': '14593A'}


def prepare(stories, work, modules, out):
    """Writes <work>/statements.json; returns [(story, path)] to be drawn."""
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    jobs, drawn = [], []
    for story in stories:
        if story['producer'] != 'pdfkit':
            continue
        L = LABELS[story['layout']]
        path = Path(out) / f"{story['id']}-statement.pdf"
        jobs.append({
            'id': story['id'], 'out': str(path), 'paper': story['paper'], 'layout': story['layout'],
            'regular': str(font_files.files_of(modules, story['font'], '400')),
            'bold': str(font_files.files_of(modules, story['font'], '700')),
            'size': 7.6 if story['paper'] == 'A4-landscape' else 7.2,
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
