"""go-pdf/fpdf statements for G15: go-pdf/fpdf 0.9.0, a maintained fork of
the gofpdf library many Go services use to write their own documents,
unrelated to the other holdouts' writers.

This file writes statements.json, one statement per story with its pages in
the order the facts print them, each with its rows in logical column order
and its footer; go/main.go draws them. go-pdf/fpdf embeds each font with an
identity ToUnicode map over the whole plane, the surrogate block included,
and draws code points as the font maps them: the application shapes Arabic
into presentation forms and orders each line by
golang.org/x/text/unicode/bidi (go/arabic.go).

Fonts: Noto Sans Arabic, Vazirmatn, El Messiri, Barlow and Red Hat Mono,
built from Fontsource (fonts.py).
"""
import json

from common import LABELS, account_line, footer, table_rows

FILES = {'Noto Sans Arabic': 'noto-sans-arabic', 'Vazirmatn': 'vazirmatn', 'El Messiri': 'el-messiri',
         'Barlow': 'barlow', 'Red Hat Mono': 'red-hat-mono'}
WIDTHS = {'A4': [50, 50, 150, 92, 58, 58, 64], 'A4-landscape': [62, 62, 260, 120, 84, 84, 92]}
SIZES = {'Red Hat Mono': 7.5}
FILLS = {'T08': [26, 74, 110], 'T09': [16, 82, 84], 'T10': [110, 28, 40]}


def unmapped(*files):
    """The Arabic presentation forms (U+FE70..U+FEFC) that a weight of the
    font does not map, read from its cmap: the application draws such a form
    as its base letter."""
    from fontTools.ttLib import TTFont
    maps = [set(TTFont(f).getBestCmap()) for f in files]
    return [c for c in range(0xFE70, 0xFEFD) if any(c not in m for m in maps)]


def statement(story, fonts, out):
    size = SIZES.get(story['font'], 8)
    name = FILES[story['font']]
    regular, bold = f'{fonts}/{name}-400.ttf', f'{fonts}/{name}-700.ttf'
    return {
        'id': story['id'], 'out': str(out), 'paper': story['paper'], 'layout': story['layout'],
        'family': story['font'].replace(' ', ''), 'regular': regular, 'bold': bold, 'size': size,
        'row': round(size * (2.0 if story['layout'] == 'ar' else 1.75), 2), 'style': story['recipe']['style'],
        'widths': WIDTHS[story['paper']], 'headingFill': FILLS.get(story['id'], [40, 40, 40]),
        'headers': LABELS[story['layout']]['headers'], 'bank': story['bank'],
        'documentTitle': story['documentTitle'], 'accountLine': account_line(story),
        'pages': [{'rows': [{'kind': k, 'cells': c} for k, c in table_rows(story, page)],
                   'footer': footer(story, page)} for page in story['statement']['pages']],
        'unmapped': unmapped(regular, bold) if story['layout'] == 'ar' else [],
    }


def prepare(stories, work, fonts, out_dir):
    """Writes statements.json for the go-pdf/fpdf stories; returns them with
    their target files."""
    work.mkdir(parents=True, exist_ok=True)
    jobs = [(s, out_dir / f"{s['id']}-statement.pdf") for s in stories if s['producer'] == 'gofpdf']
    data = {'statements': [statement(s, fonts, out) for s, out in jobs]}
    (work / 'statements.json').write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    return jobs
