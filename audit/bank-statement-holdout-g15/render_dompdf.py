"""Dompdf statements for G15: Dompdf 3.1.6, the PHP library behind many PHP
and Laravel applications' PDF exports, which lays out HTML and CSS and writes
the PDF with its own Cpdf class, unrelated to the other holdouts' writers.

This file writes statements.json, one statement per story with its pages in
the order the facts print them, each with its rows in logical column order
and its footer; php/render_dompdf.php writes each page as one HTML table
styled by CSS, breaks the page after it, and has Dompdf lay it out. Dompdf
embeds each font it is given by @font-face, subset, with an identity
ToUnicode map over the whole plane, the surrogate block included. Dompdf does
not lay out right-to-left text, so its statements are English.

Fonts: Source Sans 3, PT Serif, Space Mono and IBM Plex Sans, built from
Fontsource (fonts.py).
"""
import json

from common import LABELS, account_line, footer, table_rows

FILES = {'Source Sans 3': 'source-sans-3', 'PT Serif': 'pt-serif', 'Space Mono': 'space-mono',
         'IBM Plex Sans': 'ibm-plex-sans'}
WIDTHS = {'A4': [9.5, 9.5, 30, 18, 10.5, 10.5, 12], 'Letter': [9.5, 9.5, 28, 18, 11, 11, 13],
          'A4-landscape': [8, 8, 36, 16, 10, 10, 12]}
SIZES = {'Space Mono': 7}
FILLS = {'T01': '#1f4f8f', 'T04': '#2d5f4c', 'T05': '#1f4f8f'}


def statement(story, fonts, out):
    name = FILES[story['font']]
    return {
        'id': story['id'], 'out': str(out), 'paper': story['paper'], 'family': story['font'],
        'regular': f'{fonts}/{name}-400.ttf', 'bold': f'{fonts}/{name}-700.ttf',
        'size': SIZES.get(story['font'], 8), 'style': story['recipe']['style'], 'widths': WIDTHS[story['paper']],
        'headingFill': FILLS.get(story['id'], '#333333'), 'headers': LABELS[story['layout']]['headers'],
        'bank': story['bank'], 'documentTitle': story['documentTitle'], 'accountLine': account_line(story),
        'pages': [{'rows': table_rows(story, page), 'footer': footer(story, page)}
                  for page in story['statement']['pages']],
    }


def prepare(stories, work, fonts, out_dir):
    """Writes statements.json for the Dompdf stories; returns them with their
    target files."""
    work.mkdir(parents=True, exist_ok=True)
    (work / 'fonts').mkdir(exist_ok=True)
    jobs = [(s, out_dir / f"{s['id']}-statement.pdf") for s in stories if s['producer'] == 'dompdf']
    data = {'work': str(work), 'fonts': str(fonts), 'statements': [statement(s, fonts, out) for s, out in jobs]}
    (work / 'statements.json').write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    return jobs
