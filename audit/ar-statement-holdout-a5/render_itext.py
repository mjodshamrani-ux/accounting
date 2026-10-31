"""Prepares the A5 iText statements for java/ (tarasuf.holdout.ArStatements)
and runs it.

iText Core is the Java library behind many statement services. It lays out
no right-to-left text without its commercial add-on, so its statements are
English. This file writes what the program reads: per story the font files
and their encoding (WinAnsi or Identity-H), the table's type size, the grid
style and heading shade, and per page its blocks (text lines, and tables with
their column widths, alignments and rows) and its footer.
"""
import json
import subprocess
from pathlib import Path

VERSION = 'iText Core 9.8.0'
FONTS = {
    'Liberation Serif': ('/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf',
                         '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf'),
    'Liberation Mono': ('/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
                        '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'),
    'Carlito': ('/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf',
                '/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf'),
    'Caladea': ('/usr/share/fonts/truetype/crosextra/Caladea-Regular.ttf',
                '/usr/share/fonts/truetype/crosextra/Caladea-Bold.ttf'),
    'Inter': ('/usr/share/fonts/opentype/inter/Inter-Regular.otf',
              '/usr/share/fonts/opentype/inter/Inter-Bold.otf'),
}
ROLES = {'Date': 'date', 'Type': 'type', 'Document No': 'document', 'Related invoice': 'related',
         'Description': 'description', 'Original amount': 'original', 'Open amount': 'open',
         'Balance': 'balance'}
WIDTH_PT = {'date': 50, 'type': 54, 'document': 70, 'related': 70, 'description': 84,
            'original': 64, 'open': 62, 'balance': 66}
AMOUNTS = {'original', 'open', 'balance'}
USABLE = 523   # A4 less 36 points each side
TITLES = {'Statement of account'}


def role(heading):
    return ROLES.get(heading, 'custom')


def widths(headings):
    """Each column's width by its role, the table widened to the page by at
    most a third when it has few columns."""
    w = [WIDTH_PT.get(role(h), 60) for h in headings]
    scale = min(4 / 3, USABLE / sum(w))
    return [round(x * scale, 2) for x in w]


def page_blocks(page, heads):
    """A page's blocks and footer. A table that continues on a page without
    its headings keeps the columns of the headings before it."""
    blocks, footer = [], None
    for line in page:
        if 'text' in line:
            if line['align'] == 'center':
                footer = line['text']
            else:
                blocks.append({'kind': 'text', 'text': line['text'], 'title': line['text'] in TITLES})
            continue
        if not blocks or blocks[-1]['kind'] != 'table':
            blocks.append({'kind': 'table', 'rows': []})
        table = blocks[-1]
        if 'headings' in line:
            heads = line['headings']
            table['rows'].append({'heading': True, 'cells': heads})
        else:
            values = dict(line['cells'])
            table['rows'].append({'heading': False, 'cells': [values.get(h, '') for h in heads]})
        table['widths'] = widths(heads)
        table['end'] = [role(h) in AMOUNTS for h in heads]
    return blocks, footer, heads


def render(stories, work, out, java):
    """Writes <work>/statements.json, runs the Java program, and returns
    [(story, pdf)]."""
    work, out = Path(work), Path(out)
    work.mkdir(parents=True, exist_ok=True)
    jobs, drawn = [], []
    for story in stories:
        if story['producer'] != 'itext':
            continue
        regular, bold = FONTS[story['font']]
        path = out / f"{story['id']}-statement.pdf"
        pages, heads = [], None
        for page in story['statement']['pages']:
            blocks, footer, heads = page_blocks(page, heads)
            pages.append({'blocks': blocks, 'footer': footer})
        jobs.append({
            'id': story['id'], 'out': str(path), 'regular': regular, 'bold': bold,
            'encoding': story['style']['encoding'], 'grid': story['style']['grid'],
            'shade': story['style']['shade'], 'size': 6.5 if story['font'] == 'Liberation Mono' else 7.5,
            'pages': pages,
        })
        drawn.append((story, path))
    (work / 'statements.json').write_text(json.dumps({'statements': jobs}, ensure_ascii=False, indent=1),
                                          encoding='utf-8')
    java = Path(java)
    classpath = f"{java / 'target' / 'classes'}:{java / 'target' / 'lib'}/*"
    subprocess.run(['java', '-cp', classpath, 'tarasuf.holdout.ArStatements', str(work / 'statements.json')],
                   check=True, capture_output=True, text=True, timeout=600)
    return drawn
