"""PDFBox statements for G12: each page drawn by java/PdfBoxStatements.java
with Apache PDFBox 3.0.5, the Apache library many Java applications use to
write their own statements and invoices, unrelated to the other holdouts'
writers.

This file writes statements.xml, one <statement> per story with its pages
in the order the facts print them, each with its letterhead lines, table
rows (cells in logical order, with their alignment and span) and footer.
PDFBox neither shapes nor orders text: the writer shapes Arabic with ICU4J
and orders each line by its bidi algorithm, writing the line whole or, where
the style says `runs`, run by run, and is given each font's PDFBox copy
(fonts.py). Times-Roman is the standard font, not embedded.

PDFBox's random subset prefixes are fixed afterwards (settle.py).
"""
from xml.sax.saxutils import escape, quoteattr

from common import LABELS, account_line, footer, table_rows

FILES = {'Fira Sans': 'fira-sans-pdfbox', 'JetBrains Mono': 'jetbrains-mono-pdfbox',
         'Noto Naskh Arabic': 'noto-naskh-arabic-pdfbox', 'Noto Kufi Arabic': 'noto-kufi-arabic-pdfbox'}
STANDARD = {'Times-Roman': 'Times-Bold'}
MONO = {'JetBrains Mono'}
WIDTHS = {
    'Fira Sans': '21,21,44,36,26,26,30',
    'Times-Roman': '20,20,46,34,25,25,28',
    'JetBrains Mono': '22,22,38,40,28,28,34',
    'Noto Naskh Arabic': '21,21,40,37,27,27,31',
    'Noto Kufi Arabic': '23,23,42,38,28,28,32',
}


def font_files(story, fonts):
    name = story['font']
    if name in STANDARD:
        return name, STANDARD[name]
    return f'{fonts}/{FILES[name]}-400.ttf', f'{fonts}/{FILES[name]}-700.ttf'


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
                body = cell('') + cell('') + cell(cells[0], span=5)
            else:
                body = ''.join(cell(v, i >= 4) for i, v in enumerate(cells))
            rows.append(f'<row kind="{kind}">{body}</row>')
        pages.append('<page>'
                     f'<line size="13" after="1">{escape(story["bank"])}</line>'
                     f'<line size="10.5" after="4">{escape(story["documentTitle"])}</line>'
                     f'<line size="{size}" after="0">{escape(account_line(story))}</line>'
                     + ''.join(rows) + f'<footer>{escape(footer(story, page))}</footer></page>')
    regular, bold = font_files(story, fonts)
    attrs = {
        'id': story['id'], 'out': str(out), 'font': regular, 'bold': bold, 'paper': story['paper'],
        'rtl': '1' if rtl else '0', 'size': str(size), 'padding': str(st['padding']), 'leading': '1.25',
        'rules': st['rules'], 'heading': st['heading'], 'drSlot': '1' if st.get('drSlot') else '0',
        'clip': '1' if st.get('clip') else '0', 'runs': '1' if st.get('runs') else '0',
        'widths': WIDTHS[story['font']],
        'title': f"{story['documentTitle']} {story['statement']['account']}",
    }
    return '<statement ' + ' '.join(f'{k}={quoteattr(v)}' for k, v in attrs.items()) + '>' + ''.join(pages) + \
        '</statement>'


def prepare(stories, work, fonts, out_dir):
    """Writes statements.xml for the PDFBox stories; returns them with their
    target files."""
    work.mkdir(parents=True, exist_ok=True)
    jobs = [(s, out_dir / f"{s['id']}-statement.pdf") for s in stories if s['producer'] == 'pdfbox']
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<statements>'
           + ''.join(statement(s, fonts, out) for s, out in jobs) + '</statements>\n')
    (work / 'statements.xml').write_text(xml, encoding='utf-8')
    return jobs
