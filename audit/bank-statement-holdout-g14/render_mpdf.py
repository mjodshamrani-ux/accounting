"""mPDF statements for G14: mPDF 8.3.1, the PHP library many applications in
the region use to turn their HTML into PDF, unrelated to the other holdouts'
writers.

This file writes statements.json, one statement per story with its pages in
the order the facts print them, each with its rows in logical column order
and its footer; php/render_mpdf.php writes each page as one HTML table and
styles it by CSS. mPDF shapes Arabic by its own OpenType layout and orders
it by its own bidi code.

Fonts: DejaVu Sans, DejaVu Sans Mono, FreeSans and FreeSerif, all fonts
mPDF ships. R07's footer is
mPDF's own {PAGENO} and {nbpg}; every other footer is printed as the facts
give it.
"""
import json

from common import LABELS, account_line, footer, table_rows

BODY = {'DejaVu Sans Mono': 'dejavusansmono', 'FreeSerif': 'freeserif', 'FreeSans': 'freesans',
        'DejaVu Sans': 'dejavusans'}
WIDTHS = [10, 10, 29, 18, 10.5, 10.5, 12]
FILLS = {'R07': '#1d4e7a', 'R08': '#0b5a3c', 'R11': '#3a3a3a', 'R12': '#1d4e7a'}
ALIASED = {'R07'}


def statement(story, out):
    st = story['recipe']['style']
    pages = [{'rows': table_rows(story, page), 'footer': None if story['id'] in ALIASED else footer(story, page)}
             for page in story['statement']['pages']]
    return {
        'id': story['id'], 'out': str(out), 'paper': story['paper'], 'layout': story['layout'],
        'bodyFont': BODY[story['font']], 'size': 7.5 if story['font'] == 'DejaVu Sans Mono' else 8, 'style': st,
        'widths': WIDTHS, 'headingFill': FILLS.get(story['id'], '#333333'),
        'headers': LABELS[story['layout']]['headers'], 'bank': story['bank'],
        'documentTitle': story['documentTitle'], 'accountLine': account_line(story), 'pages': pages,
    }


def prepare(stories, work, fonts, out_dir):
    """Writes statements.json for the mPDF stories; returns them with their
    target files."""
    work.mkdir(parents=True, exist_ok=True)
    (work / 'mpdf').mkdir(exist_ok=True)
    jobs = [(s, out_dir / f"{s['id']}-statement.pdf") for s in stories if s['producer'] == 'mpdf']
    data = {'work': str(work), 'statements': [statement(s, out) for s, out in jobs]}
    (work / 'statements.json').write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    return jobs
