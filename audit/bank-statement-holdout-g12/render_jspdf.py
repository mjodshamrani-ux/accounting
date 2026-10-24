"""jsPDF statements for G12: each page a table drawn by jspdf-autotable 5.0.8
on jsPDF 4.2.1, the JavaScript library web applications use to write their
statements in the browser or in Node, unrelated to the other holdouts'
writers.

This file writes statements.json, one statement per story with its pages in
the order the facts print them, each with its letterhead lines, table head
and body (cells with their alignment and span, in the order they stand on
the page from the left) and footer; js/render_jspdf.mjs draws them. jsPDF
shapes Arabic into presentation forms and orders each line itself, writing
each run of one direction as its own text; a right-to-left statement's
columns stand from the right. Courier is the standard font, not embedded.

jsPDF's creation date and file identifier are given by the writer
(js/render_jspdf.mjs), so the same facts give the same bytes.
"""
import json

from common import LABELS, account_line, footer, table_rows

FILES = {'Noto Sans': 'noto-sans', 'Noto Naskh Arabic': 'noto-naskh-arabic', 'Noto Kufi Arabic': 'noto-kufi-arabic'}
WIDTHS = {
    'Noto Sans': [21, 21, 42, 40, 26, 26, 30],
    'Courier': [22, 22, 40, 40, 28, 28, 34],
    'Noto Naskh Arabic': [21, 21, 40, 37, 27, 27, 31],
    'Noto Kufi Arabic': [23, 23, 42, 38, 28, 28, 32],
}
PAPER = {'A4': ('a4', 'portrait'), 'A4-landscape': ('a4', 'landscape'), 'Letter': ('letter', 'portrait')}


def statement(story, fonts, out):
    st = story['recipe']['style']
    L = LABELS[story['layout']]
    rtl = story['layout'] == 'ar'
    size = 8 if story['font'] == 'Courier' or rtl else 8.5

    def cell(text, end=False, span=1):
        side = ('left', 'right')[end != rtl]
        return {'content': text, 'colSpan': span, 'halign': side}

    def placed(cells):
        """Cells in the order they stand from the left."""
        return list(reversed(cells)) if rtl else cells
    pages = []
    for page in story['statement']['pages']:
        body = []
        for kind, cells in table_rows(story, page):
            if kind == 'label':
                row = [cell(cells[0], span=6), cell(cells[1], True)]
            elif kind == 'totals':
                row = [cell(cells[0], span=4), cell(cells[1], True), cell(cells[2], True), cell('')]
            elif kind == 'continuation':
                row = [cell(''), cell(''), cell(cells[0], span=5)]
            else:
                row = [cell(v, i >= 4) for i, v in enumerate(cells)]
            body.append(placed(row))
        pages.append({
            'lines': [{'size': 13, 'bold': True, 'text': story['bank']},
                      {'size': 10.5, 'bold': True, 'text': story['documentTitle']},
                      {'size': size, 'bold': False, 'text': account_line(story)}],
            'head': placed([cell(h, i >= 4) for i, h in enumerate(L['headers'])]),
            'body': body,
            'footer': footer(story, page),
        })
    paper, orientation = PAPER[story['paper']]
    if story['font'] == 'Courier':
        font = {'name': 'courier'}
    else:
        name = FILES[story['font']]
        font = {'name': story['font'].replace(' ', ''), 'regular': f'{fonts}/{name}-400.ttf',
                'bold': f'{fonts}/{name}-700.ttf'}
    widths = WIDTHS[story['font']]
    return {
        'id': story['id'], 'out': str(out), 'font': font, 'paper': paper, 'orientation': orientation,
        'rtl': rtl, 'size': size, 'padding': st['padding'], 'theme': st['theme'],
        'widths': list(reversed(widths)) if rtl else widths,
        'title': f"{story['documentTitle']} {story['statement']['account']}",
        'pages': pages,
    }


def prepare(stories, work, fonts, out_dir):
    """Writes statements.json for the jsPDF stories; returns them with their
    target files."""
    work.mkdir(parents=True, exist_ok=True)
    jobs = [(s, out_dir / f"{s['id']}-statement.pdf") for s in stories if s['producer'] == 'jspdf']
    data = {'statements': [statement(s, fonts, out) for s, out in jobs]}
    (work / 'statements.json').write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    return jobs
