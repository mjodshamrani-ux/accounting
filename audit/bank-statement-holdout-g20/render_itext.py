"""Prepares the G20 iText statements for java/ (tarasuf.holdout.Statements).

iText Core is the Java library behind many banks' statement services. The
Java program draws each page of the facts as one iText table under the
bank's heading, with the footer as the facts number the page; it creates the
story's fonts from their files in iText's default simple encoding (WinAnsi)
or in Identity-H, as the story says, and iText subsets and embeds them.
iText Core lays out no right-to-left text without its commercial add-on, so
its statements are English. This file writes what the program reads: per
story the printed rows (common.table_rows), the heading texts, the style, the
font files and their encoding.
"""
import json
from pathlib import Path

import fonts as font_files
from common import LABELS, account_line, footer, table_rows

COLOURS = {'Karla': '0F6E6E', 'Source Sans 3': '23395B', 'Roboto Mono': '333333', 'Lora': '6B2D4F'}
ENCODING = {'Karla': 'simple', 'Source Sans 3': 'simple', 'Roboto Mono': 'identity', 'Lora': 'identity'}


def size(story):
    """The table's type size: a monospaced face at 6.4, as its wider figures
    would otherwise wrap an overdrawn balance's DR in its cell."""
    if story['font'] == 'Roboto Mono':
        return 6.4
    return 7.6 if story['paper'] == 'A4-landscape' else 7.2


def prepare(stories, work, modules, out):
    """Writes <work>/statements.json; returns [(story, path)] to be drawn."""
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    jobs, drawn = [], []
    for story in stories:
        if story['producer'] != 'itext':
            continue
        L = LABELS[story['layout']]
        path = Path(out) / f"{story['id']}-statement.pdf"
        jobs.append({
            'id': story['id'], 'out': str(path), 'paper': story['paper'],
            'regular': str(font_files.files_of(modules, story['font'], '400')),
            'bold': str(font_files.files_of(modules, story['font'], '700')),
            'encoding': ENCODING[story['font']], 'size': size(story),
            'style': story['recipe']['style'], 'fill': COLOURS[story['font']], 'bank': story['bank'],
            'title': story['documentTitle'], 'account': account_line(story), 'number': story['statement']['account'],
            'headers': L['headers'],
            'pages': [{'footer': footer(story, page), 'rows': [{'kind': k, 'cells': c} for k, c in table_rows(story, page)]}
                      for page in story['statement']['pages']],
        })
        drawn.append((story, path))
    (work / 'statements.json').write_text(json.dumps({'statements': jobs}, ensure_ascii=False, indent=1),
                                          encoding='utf-8')
    return drawn
