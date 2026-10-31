"""Typst statements for G8: a typesetting system with its own layout engine,
shaping and PDF writer, unrelated to Chromium, LibreOffice and ReportLab.

statement.typ lays out each story from a data.json this module writes from
the facts, so no story text passes through Typst markup. Typst decides the
column widths page by page, wraps long descriptions itself, shapes Arabic
and lays a right-to-left table out from the right. `date: none` keeps the
document date out of the PDF.
"""
import json
import shutil
from pathlib import Path

from common import LABELS, account_line, footer, table_rows

HERE = Path(__file__).resolve().parent
PAPER = {'A4': ('a4', False), 'Letter': ('us-letter', False), 'A4-landscape': ('a4', True)}
SIZE = {'DejaVu Sans Mono': 7.5, 'Amiri': 9.5}


def data(story):
    paper, landscape = PAPER[story['paper']]
    rtl = story['layout'] == 'ar'
    return {
        'title': f"{story['documentTitle']} {story['statement']['account']}",
        'bank': story['bank'], 'documentTitle': story['documentTitle'], 'accountLine': account_line(story),
        'fonts': [story['font']], 'size': SIZE.get(story['font'], 8.5), 'lang': 'ar' if rtl else 'en',
        'dir': 'rtl' if rtl else 'ltr', 'paper': paper, 'landscape': landscape,
        'style': story['recipe']['style'], 'headings': LABELS[story['layout']]['headers'],
        'pages': [{'footer': footer(story, p), 'rows': [{'kind': k, 'cells': c} for k, c in table_rows(story, p)]}
                  for p in story['statement']['pages']],
    }


def render(stories, out_dir, work, font_paths):
    import typst
    written = []
    for s in stories:
        if s['producer'] != 'typst':
            continue
        folder = Path(work) / f"typst-{s['id']}"
        folder.mkdir(parents=True, exist_ok=True)
        shutil.copy(HERE / 'statement.typ', folder / 'statement.typ')
        (folder / 'data.json').write_text(json.dumps(data(s), ensure_ascii=False), encoding='utf-8')
        target = Path(out_dir) / f"{s['id']}-statement.pdf"
        target.write_bytes(typst.compile(str(folder / 'statement.typ'), root=str(folder),
                                         font_paths=[str(p) for p in font_paths]))
        written.append(target)
    return written


def version():
    from importlib.metadata import version as installed
    return {'typst': installed('typst')}
