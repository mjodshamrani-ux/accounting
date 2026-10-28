"""Prepares the C4 Prawn statements for ruby/render_prawn.rb, the G17 Prawn
statement job copied unchanged.

Prawn is the Ruby library behind many Rails applications' PDF statements
and invoices. The Ruby program draws each page of the facts as one
prawn-table table under the bank's heading, with the footer as the facts
number the page; it registers the story's font family from its TrueType
files and Prawn subsets and embeds them. Prawn lays out no right-to-left
text, so its statements are English. This file writes what the program
reads: per story the printed rows (common.table_rows), the heading texts,
the style and the font files. Adapted from G17's render_prawn.py to the
C4 fonts, one TrueType file per weight.
"""
import json
from pathlib import Path

import fonts as font_files
from common import LABELS, account_line, footer, table_rows

COLOURS = {'Lora': '5B2333', 'Karla': '1F4E5F', 'Inconsolata': '333333'}


def prepare(stories, work, modules, out):
    """Writes <work>/statements.json; returns [(story, path)] to be drawn."""
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    jobs, drawn = [], []
    for story in stories:
        if story['producer'] != 'prawn':
            continue
        assert story['layout'] == 'en', 'Prawn draws without shaping: English statements only'
        L = LABELS[story['layout']]
        path = Path(out) / f"{story['id']}-statement.pdf"
        jobs.append({
            'id': story['id'], 'out': str(path), 'paper': story['paper'], 'family': story['font'],
            'regular': str(font_files.files_of(modules, story['font'], '400')),
            'bold': str(font_files.files_of(modules, story['font'], '700')), 'style': story['recipe']['style'],
            'fill': COLOURS[story['font']], 'bank': story['bank'], 'title': story['documentTitle'],
            'account': account_line(story), 'number': story['statement']['account'], 'headers': L['headers'],
            'pages': [{'footer': footer(story, page), 'rows': [{'kind': k, 'cells': c} for k, c in table_rows(story, page)]}
                      for page in story['statement']['pages']],
        })
        font_files.check_covers(jobs[-1])
        drawn.append((story, path))
    (work / 'statements.json').write_text(json.dumps({'statements': jobs}, ensure_ascii=False, indent=1),
                                          encoding='utf-8')
    return drawn
