"""OpenPDF statements for G10: each page a table placed by OpenPDF 2.0.3, the
LGPL fork of iText 4 whose lineage writes many bank statements, unrelated to
the other holdouts' writers.

This file writes statements.xml, one <statement> per story with its pages
in the order the facts print them, each with its letterhead lines, table
rows (cells in logical order, with their alignment and span) and footer;
java/OpenPdfStatements.java draws them. A right-to-left statement takes the
RTL run direction and OpenPDF shapes its Arabic into presentation forms, so
its fonts must map them: Amiri and DejaVu Sans do. The Latin fonts are the
families without standard ligatures (fonts.py). Helvetica and Courier are
the standard fonts, not embedded.

OpenPDF's clock stamps and random subset prefixes are fixed afterwards
(settle.py).
"""
from xml.sax.saxutils import escape, quoteattr

from common import LABELS, account_line, footer, table_rows

DEJAVU = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FILES = {'Amiri': 'amiri-400.ttf', 'Open Sans': 'open-sans-nl-400.ttf',
         'Courier Prime': 'courier-prime-nl-400.ttf'}
MONO = {'Courier', 'Courier Prime'}
WIDTHS = '20,20,44,33,25,25,28'
MONO_WIDTHS = '22,22,40,37,28,28,32'
ARABIC_WIDTHS = '20,20,33,37,27,27,30'


def font_path(story, fonts):
    name = story['font']
    if name in ('Helvetica', 'Courier'):
        return name
    if name == 'DejaVu Sans':
        return DEJAVU
    return f'{fonts}/{FILES[name]}'


def statement(story, fonts, out):
    st = story['recipe']['style']
    L = LABELS[story['layout']]
    mono, rtl = story['font'] in MONO, story['layout'] == 'ar'
    size = 8 if mono or rtl else 8.5

    def cell(text, end=False, span=1):
        return f'<cell align="{"end" if end else "start"}" span="{span}">{escape(text)}</cell>'
    pages = []
    for page in story['statement']['pages']:
        rows = ['<row kind="head">' + ''.join(cell(h, i >= 4) for i, h in enumerate(L['headers'])) + '</row>']
        for kind, cells in table_rows(story, page):
            if kind == 'label':
                body = cell(cells[0], span=6) + cell(cells[1], True)
            elif kind == 'totals':
                body = cell(cells[0], span=4) + cell(cells[1], True) + cell(cells[2], True) + cell('')
            elif kind == 'continuation':
                body = cell('') + cell('') + cell(cells[0]) + cell('') * 4
            else:
                body = ''.join(cell(v, i >= 4) for i, v in enumerate(cells))
            rows.append(f'<row kind="{kind}">{body}</row>')
        pages.append('<page>'
                     f'<line size="13" after="1">{escape(story["bank"])}</line>'
                     f'<line size="10.5" after="4">{escape(story["documentTitle"])}</line>'
                     f'<line size="{size}" after="0">{escape(account_line(story))}</line>'
                     + ''.join(rows) + f'<footer>{escape(footer(story, page))}</footer></page>')
    attrs = {
        'id': story['id'], 'out': str(out), 'font': font_path(story, fonts), 'paper': story['paper'],
        'rtl': '1' if rtl else '0', 'size': str(size), 'rules': st['rules'], 'heading': st['heading'],
        # OpenPDF gives a right-to-left table's widths from the left.
        'widths': MONO_WIDTHS if mono else ','.join(reversed(ARABIC_WIDTHS.split(','))) if rtl else WIDTHS,
        'title': f"{story['documentTitle']} {story['statement']['account']}",
    }
    return '<statement ' + ' '.join(f'{k}={quoteattr(v)}' for k, v in attrs.items()) + '>' + ''.join(pages) + \
        '</statement>'


def prepare(stories, work, fonts, out_dir):
    """Writes statements.xml for the OpenPDF stories; returns them with their
    target files."""
    work.mkdir(parents=True, exist_ok=True)
    jobs = [(s, out_dir / f"{s['id']}-statement.pdf") for s in stories if s['producer'] == 'openpdf']
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<statements>'
           + ''.join(statement(s, fonts, out) for s, out in jobs) + '</statements>\n')
    (work / 'statements.xml').write_text(xml, encoding='utf-8')
    return jobs

