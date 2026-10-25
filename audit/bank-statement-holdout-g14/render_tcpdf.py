"""TCPDF statements for G14: TCPDF 6.10.0, the PHP library many applications
in the region use to write their own documents, unrelated to the other
holdouts' writers.

This file writes statements.json, one statement per story with its pages in
the order the facts print them, each with its rows in logical column order
and its footer; php/render_tcpdf.php draws them, cell by cell or, for an
'html' statement, as an HTML table through TCPDF's writeHTML. TCPDF shapes
Arabic into presentation forms and orders each line itself in its
right-to-left mode, where the first column stands on the right.

Fonts: Helvetica is the standard font, not embedded; DejaVu Sans, DejaVu
Sans Mono and DejaVu Serif are the font definitions TCPDF ships; IBM Plex
Sans Arabic is built from Fontsource (fonts.py) and converted by TCPDF's
addTTFfont. An English statement's footer is TCPDF's own page number
aliases; an Arabic one is printed as the facts give it.
"""
import json

from common import LABELS, account_line, footer, table_rows

CORE = {'Helvetica': 'helvetica', 'DejaVu Sans': 'dejavusans', 'DejaVu Sans Mono': 'dejavusansmono',
        'DejaVu Serif': 'dejavuserif'}
FILES = {'IBM Plex Sans Arabic': 'ibm-plex-sans-arabic'}
WIDTHS = {
    'A4': [50, 50, 158, 92, 52, 52, 69],
    'Letter': [54, 54, 146, 96, 60, 60, 70],
    'html': [54, 54, 132, 96, 62, 56, 69],
}
SIZES = {'DejaVu Sans Mono': 7.5}
FILLS = {'R01': [22, 44, 92], 'R02': [0, 96, 100], 'R06': [22, 44, 92]}


def statement(story, fonts, out):
    st = story['recipe']['style']
    size = SIZES.get(story['font'], 8)
    if story['font'] in CORE:
        font = {'kind': 'core', 'name': CORE[story['font']]}
    else:
        name = FILES[story['font']]
        font = {'kind': 'file', 'regular': f'{fonts}/{name}-400.ttf', 'bold': f'{fonts}/{name}-700.ttf'}
    pages = []
    for page in story['statement']['pages']:
        printed = footer(story, page)
        aliased = story['layout'] == 'en' and printed == f"Page {page['number']} of {len(story['statement']['pages'])}"
        pages.append({'rows': table_rows(story, page), 'footer': None if aliased else printed})
    return {
        'id': story['id'], 'out': str(out), 'paper': story['paper'], 'layout': story['layout'], 'font': font,
        'size': size, 'lineHeight': round(size * (1.6 if story['layout'] == 'ar' else 1.5), 2),
        'tightHeight': round(size * 1.35, 2),
        'widths': WIDTHS['html' if st['api'] == 'html' else story['paper']], 'style': st, 'headingFill': FILLS.get(story['id'], [40, 40, 40]),
        'headers': LABELS[story['layout']]['headers'], 'bank': story['bank'],
        'documentTitle': story['documentTitle'], 'accountLine': account_line(story), 'pages': pages,
    }


def prepare(stories, work, fonts, out_dir):
    """Writes statements.json for the TCPDF stories; returns them with their
    target files."""
    work.mkdir(parents=True, exist_ok=True)
    jobs = [(s, out_dir / f"{s['id']}-statement.pdf") for s in stories if s['producer'] == 'tcpdf']
    data = {'work': str(work), 'statements': [statement(s, fonts, out) for s, out in jobs]}
    (work / 'statements.json').write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    return jobs
