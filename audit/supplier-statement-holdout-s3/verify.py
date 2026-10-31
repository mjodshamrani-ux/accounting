"""Independent check of the S3 holdout files, before any product run.

  python3 -B audit/supplier-statement-holdout-s3/stories.py > stories.json
  PYTHONPATH=<pdfminer.six, pymupdf, fonttools> python3 -B verify.py frozen stories.json

The glyph reading, the forms a value takes on a right-to-left row, the
writer and font checks and the .notdef plants are copied from G23's
verify.py; the lines checked and the planted faults are S3's.

1. Every statement PDF is read with pdfminer.six, a reader unrelated to the
   product's pdf.js, glyph by glyph. Glyphs sharing a baseline make one
   visual row, ordered left to right. Every printed line of the facts must be
   found on its own row, in the facts' order down the page, with all of its
   values: a movement's date (and due date), document number, type, amount
   or debit and credit, and running balance; a control line's balance, or
   both totals; the page footer. Right-to-left rows are matched in visual
   order or in reading order, after NFKC, as G23 does. A value must stand
   alone: 1,000.00 is not found inside 11,000.00.
2. A description is checked by its words in order, from its row to the next
   printed line: the writers wrap a long one themselves. Arabic words are
   read in reading order.
3. Each ledger CSV, read back with Python's csv module, holds the story's
   ledger postings row for row.
4. Each PDF names its writer as Producer (HexaPDF, or pdf-lib) and carries
   its story's fonts; no glyph is drawn as .notdef.
5. The check must fail on planted changes to the facts, for each writer and
   language, and must find a letter planted as .notdef in each writer's fonts.
Whether the product's reader would refuse a page for a reason of its own is
not decided here. The result, VERIFY.json, is bound to the PDF hashes and the
facts hash.
"""
import copy
import csv
import hashlib
import io
import json
import re
import sys
import tempfile
import unicodedata
from pathlib import Path

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTChar, LTContainer
from pdfminer.pdfdocument import PDFDocument
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfparser import PDFParser
from pdfminer.pdftypes import resolve1

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import LEDGER_HEADERS, columns, control_cells, digits, footer, movement_cells, plain  # noqa: E402

EDGE = r'0-9A-Za-z٠-٩٫٬,.'
DIGITS = r'0-9٠-٩٫٬,.'
WRITERS = {'hexapdf': 'HexaPDF version ', 'pdflib': 'pdf-lib ('}
ARABIC = re.compile('[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufeff]')


def glyphs(item):
    if isinstance(item, LTChar):
        yield item
    elif isinstance(item, LTContainer):
        for child in item:
            yield from glyphs(child)


def page_rows(pdf):
    """Each page as rows, top to bottom, each row twice: visual and reading.
    A row is the glyphs on one baseline, left to right, with a space where
    the gap is wider than 0.12 of the font size: a space is wider in every
    font here, and a glyph meets the next in a word.
    Its reading text
    takes the words from right to left, and a word holding an Arabic letter
    glyph by glyph from right to left."""
    pages = []
    for layout in extract_pages(str(pdf)):
        by_line = {}
        for g in glyphs(layout):
            by_line.setdefault(round(g.y0 * 2) / 2, []).append(g)
        lines = []
        for y in sorted(by_line, reverse=True):
            words, last = [[]], None
            for g in sorted(by_line[y], key=lambda g: g.x0):
                if last is not None and g.x0 - last.x1 > (g.size or 8) * 0.12 and words[-1]:
                    words.append([])
                if g.get_text().isspace():
                    if words[-1]:
                        words.append([])
                else:
                    words[-1].append(g.get_text())
                last = g
            words = [w for w in words if w]
            visual = ' '.join(''.join(w) for w in words)
            reading = ' '.join(''.join(reversed(w) if ARABIC.search(''.join(w)) else w) for w in reversed(words))
            lines.append((y, ' '.join(unicodedata.normalize('NFKC', visual).split()),
                          ' '.join(unicodedata.normalize('NFKC', reading).split())))
        merged = []
        for y, visual, reading in lines:
            if merged and abs(merged[-1][0] - y) < 1.0:
                merged[-1] = (merged[-1][0], merged[-1][1] + ' ' + visual, merged[-1][2] + ' ' + reading)
            else:
                merged.append((y, visual, reading))
        pages.append([(visual, reading) for _, visual, reading in merged])
    return pages


def forms(value, rtl):
    """The ways a value can appear on a row."""
    value = ' '.join(unicodedata.normalize('NFKC', value).split())
    out = {value}
    if rtl:
        parts = re.split(r'([-\s])', value)
        out.add(''.join(reversed(parts)))
        out.add(value[::-1])
        # Visual order with each run of digits still left to right.
        out.add(re.sub(f'[{DIGITS}]+', lambda m: m.group(0)[::-1], value[::-1]))
    return out


def found(value, row, rtl):
    return any(re.search(f'(?<![{EDGE}]){re.escape(v)}(?![{EDGE}])', row) for v in forms(value, rtl))


def in_order(words, text):
    """Every word of `words` among the tokens of `text`, in order."""
    tokens, at = text.split(), 0
    for w in words:
        while at < len(tokens) and tokens[at] != w:
            at += 1
        if at == len(tokens):
            return False
        at += 1
    return True


def pdf_info(path):
    """Writer and font names, from the document information and the page
    resources, read while the file is open: a writer may write the
    information's strings as objects of their own."""
    with open(path, 'rb') as f:
        doc = PDFDocument(PDFParser(f))
        info = doc.info[0] if doc.info else {}

        def text(key):
            raw = resolve1(info.get(key, b''))
            if not raw:
                return None
            return raw.decode('utf-16') if raw[:2] in (b'\xfe\xff', b'\xff\xfe') else raw.decode('latin-1')
        fonts = set()
        for page in PDFPage.create_pages(doc):
            for font in (resolve1(page.resources.get('Font')) or {}).values():
                name = resolve1(font).get('BaseFont')
                fonts.add(getattr(name, 'name', str(name)))
        return {'creator': text('Creator'), 'producer': text('Producer'), 'fonts': sorted(fonts)}


def font_matches(story, fonts):
    def bare(name):
        return re.sub('[^0-9a-z]', '', name.split('+')[-1].lower())
    return all(any(bare(declared) in bare(f) for f in fonts) for declared in story['font'].split(' and '))


def cid_keyed(doc, font):
    """The CIDs a Type0 font's CID-keyed CFF program holds, or None for any
    other font. MuPDF gives such a font's CID where it gives other fonts'
    glyph ids, and a CID the charset lacks is drawn as .notdef."""
    import io
    from fontTools.cffLib import CFFFontSet
    xref, _, kind = font[:3]
    if kind != 'Type0':
        return None
    desc = int(doc.xref_get_key(xref, 'DescendantFonts')[1].strip('[]').split()[0])
    descriptor = int(doc.xref_get_key(desc, 'FontDescriptor')[1].split()[0])
    if doc.xref_get_key(descriptor, 'FontFile3')[0] == 'null':
        return None
    cff = CFFFontSet()
    cff.decompile(io.BytesIO(doc.xref_stream(int(doc.xref_get_key(descriptor, 'FontFile3')[1].split()[0]))), None)
    top = cff[cff.fontNames[0]]
    if not hasattr(top, 'ROS'):
        return None
    return {int(name[3:]) for name in top.charset if name.startswith('cid')}


def missing_glyphs(path):
    """Glyphs drawn as .notdef: (page, character) for each, by MuPDF: glyph id
    0, or in a CID-keyed CFF font a CID its charset lacks."""
    import pymupdf
    out = []
    with pymupdf.open(str(path)) as doc:
        for number, page in enumerate(doc, 1):
            held = {f[3].split('+')[-1]: cid_keyed(doc, f) for f in page.get_fonts()}
            for span in page.get_texttrace():
                cids = held.get(span['font'])
                out += [(number, chr(c[0])) for c in span['chars']
                        if (c[1] == 0 or (cids is not None and c[1] not in cids)) and chr(c[0]).strip()]
    return out


def cff_renamed(data, gid):
    """A CFF font program with glyph `gid` renamed in its charset, so that
    neither its code's glyph name nor its CID finds it any more."""
    import io
    from types import SimpleNamespace
    from fontTools.cffLib import CFFFontSet
    cff = CFFFontSet()
    cff.decompile(io.BytesIO(data), None)
    top = cff[cff.fontNames[0]]
    name = top.charset[gid]
    new = 'cid65000' if hasattr(top, 'ROS') else f'{name}.s3'
    strings = top.CharStrings.charStrings
    strings[new] = strings.pop(name)
    top.charset[gid] = new
    out = io.BytesIO()
    cff.compile(out, SimpleNamespace(recalcBBoxes=False))
    return out.getvalue()


def notdef_planted(pdf, out):
    """The statement with the first letter its first page draws drawn as
    glyph 0, .notdef, while the text layer still holds the letter. The writers
    here reach a glyph through a Type0 font over TrueType outlines with an
    Identity CIDToGIDMap (HexaPDF, pdf-lib): a CIDToGIDMap stream sends the
    letter's CID to glyph 0. The other branches, kept from G20 through G23, plant the
    same fault in a Type0 CFF, simple TrueType or simple Type1C font:
    The ToUnicode map, or the encoding's names where there is none, still
    gives the letter."""
    import io
    import pymupdf
    from fontTools.ttLib import TTFont

    def ref(xref, key):
        return int(doc.xref_get_key(xref, key)[1].strip('[]').split()[0])

    def program(descriptor):
        for key in ('FontFile2', 'FontFile3'):
            if doc.xref_get_key(descriptor, key)[0] != 'null':
                return key, ref(descriptor, key)
        raise ValueError('no embedded font program')

    def replace(source, data):
        doc.update_stream(source, data)
        if doc.xref_get_key(source, 'Length1')[0] != 'null':
            doc.xref_set_key(source, 'Length1', str(len(data)))

    with pymupdf.open(str(pdf)) as doc:
        page = doc[0]
        span = next(sp for sp in page.get_texttrace() if any(chr(c[0]).isalpha() for c in sp['chars']))
        letter, gid = next((c[0], c[1]) for c in span['chars'] if chr(c[0]).isalpha())
        font = next(f for f in page.get_fonts() if f[3].split('+')[-1] == span['font'])
        xref, kind = font[0], font[2]
        if kind == 'Type0':
            desc = ref(xref, 'DescendantFonts')
            key, source = program(ref(desc, 'FontDescriptor'))
            if key == 'FontFile2':
                glyphs = TTFont(io.BytesIO(doc.xref_stream(source)))['maxp'].numGlyphs
                table = b''.join((0 if cid == gid else cid).to_bytes(2, 'big') for cid in range(glyphs))
                new = doc.get_new_xref()
                doc.update_object(new, '<<>>')
                doc.update_stream(new, table)
                doc.xref_set_key(desc, 'CIDToGIDMap', f'{new} 0 R')
            else:
                replace(source, cff_renamed(doc.xref_stream(source), gid))
        else:
            key, source = program(ref(xref, 'FontDescriptor'))
            if key == 'FontFile2':
                ttf = TTFont(io.BytesIO(doc.xref_stream(source)))
                for table in ttf['cmap'].tables:
                    for code in list(table.cmap):
                        if table.cmap[code] == ttf.getGlyphName(gid):
                            table.cmap[code] = '.notdef'
                data = io.BytesIO()
                ttf.save(data)
                replace(source, data.getvalue())
            else:
                replace(source, cff_renamed(doc.xref_stream(source), gid))
        doc.save(str(out))
    return chr(letter)


def printed(story):
    """Each page's printed lines: (what, values, description or None)."""
    keys = [k for k, _, _ in columns(story)]
    rtl = story['language'] == 'ar'
    out = []
    before = story['opening']
    pages = story['pages']
    for n, lines in enumerate(pages):
        rows = []

        def control(line):
            label, values = control_cells(story, line)
            words = [] if rtl else label.split()[:1]
            rows.append((line['kind'], words + list(values.values()), None))
        control({'kind': 'opening' if n == 0 else 'brought-forward', 'balance': before})
        for line in lines:
            cells = movement_cells(story, line)
            values = [c for k, c in zip(keys, cells) if c and k != 'desc']
            if not rtl:
                values.append(line['desc'].split()[0])
            rows.append((line['ref'], values, line['desc']))
        if n < len(pages) - 1:
            control({'kind': 'carried-forward', 'balance': lines[-1]['balance']})
        else:
            if story['total']:
                sar = [m for p in pages for m in p if m.get('currency', 'SAR') == 'SAR']
                control({'kind': 'total', 'debit': sum(m['minor'] for m in sar if m['minor'] > 0),
                         'credit': -sum(m['minor'] for m in sar if m['minor'] < 0)})
            control({'kind': 'closing', 'balance': story['closing']})
        before = lines[-1]['balance']
        out.append(rows)
    return out


def check(folder, facts_path):
    folder = Path(folder)
    facts_bytes = Path(facts_path).read_bytes()
    stories = json.loads(facts_bytes)
    report = {'reader': 'pdfminer.six, glyph by glyph, rows by baseline, Arabic descriptions in reading order',
              'factsSha256': hashlib.sha256(facts_bytes).hexdigest(), 'statements': []}
    for story in stories:
        pdf = folder / f"{story['id']}-statement.pdf"
        both = page_rows(pdf)
        rows = [[visual for visual, _ in page] for page in both]
        rtl = story['language'] == 'ar'
        expected_pages = printed(story)
        problems, values = [], 0
        if len(rows) != len(expected_pages):
            problems.append(f'pages {len(rows)} != expected {len(expected_pages)}')
        for n, (want_rows, visual, readings) in enumerate(zip(expected_pages, rows, both), 1):
            foot = footer(story, n, len(expected_pages))
            if not any(found(foot, r, rtl) for r in visual):
                problems.append(f'page {n}: footer {foot!r} missing')
            if not any(found(digits(story, story['account']), r, rtl) for r in visual):
                problems.append(f'page {n}: account missing')
            at, hits = 0, []
            for what, want, _ in want_rows:
                hit = next((i for i in range(at, len(visual)) if all(found(v, visual[i], rtl) for v in want)), None)
                if hit is None:
                    problems.append(f'page {n}: {what} {want} not on one row in order')
                else:
                    values += len(want)
                    at = hit + 1
                hits.append(hit)
            for i, (what, _, text) in enumerate(want_rows):
                if text is None or hits[i] is None:
                    continue
                stop = next((h for h in hits[i + 1:] if h is not None), len(visual))
                if rtl:
                    span = ' '.join(reading for _, reading in readings[hits[i]:stop])
                    ok = in_order(unicodedata.normalize('NFKC', text).split(), span)
                else:
                    ok = in_order(text.split(), ' '.join(visual[hits[i]:stop]))
                if not ok:
                    problems.append(f'page {n}: {what} description not printed in order')
        if rtl and not any('\u0600' <= ch <= '\u06ff' for p in rows for r in p for ch in r):
            problems.append('no Arabic letters in the text layer')
        ledger = list(csv.reader(io.StringIO((folder / f"{story['id']}-ledger.csv").read_text(encoding='utf-8'))))
        want_ledger = [LEDGER_HEADERS] + [[e['date'], e['ref'], e['type'], e['desc'], plain(e['minor'])]
                                          for e in story['ledger']]
        if ledger != want_ledger:
            problems.append('ledger CSV differs from the facts')
        report['statements'].append({'id': story['id'], 'file': pdf.name,
                                     'sha256': hashlib.sha256(pdf.read_bytes()).hexdigest(),
                                     'pages': len(rows), 'valuesFound': values, 'ok': not problems,
                                     'problems': problems[:20]})
    report['ok'] = all(s['ok'] for s in report['statements'])
    return report


def movements_of(story):
    return [line for page in story['pages'] for line in page]


def bump(story, kind=None, by=1):
    line = next(m for m in movements_of(story) if kind is None or m['type'] == kind)
    line['minor'] += by if line['minor'] > 0 else -by


def swap_balances(story):
    a, b = movements_of(story)[:2]
    a['balance'], b['balance'] = b['balance'], a['balance']


def last_word(story):
    line = movements_of(story)[0]
    words = line['desc'].split()
    words[-1] = words[-1] + ('ة' if story['language'] == 'ar' else 'x')
    line['desc'] = ' '.join(words)


def ref(story, kind, new):
    next(m for m in movements_of(story) if m['type'] == kind)['ref'] = new


def day(story, new):
    movements_of(story)[1]['date'] = new


def ledger_amount(story):
    story['ledger'][0]['minor'] += 1


CASES = [
    ('S01', 'HexaPDF Work Sans, debit and credit: an invoice one halala off', lambda s: bump(s, 'Invoice')),
    ('S01', 'HexaPDF Work Sans, debit and credit: two balances swapped between rows', swap_balances),
    ('S01', 'HexaPDF Work Sans, debit and credit: a payment number changed', lambda s: ref(s, 'Payment', 'PMT-999')),
    ('S01', 'HexaPDF Work Sans, debit and credit: the closing balance changed',
     lambda s: s.update(closing=s['closing'] + 100)),
    ('S01', 'HexaPDF Work Sans, debit and credit: a ledger posting one halala off', ledger_amount),
    ('S02', 'HexaPDF Fira Sans, day first: a date changed', lambda s: day(s, '2026-08-13')),
    ('S02', 'HexaPDF Fira Sans, day first: a credit note one halala off', lambda s: bump(s, 'Credit Note')),
    ('S02', 'HexaPDF Fira Sans, day first: a type changed',
     lambda s: next(m for m in movements_of(s) if m['type'] == 'Payment').update(type='Credit Note')),
    ('S03', 'HexaPDF Merriweather, decimal comma: a payment one halala off', lambda s: bump(s, 'Payment')),
    ('S03', 'HexaPDF Merriweather, decimal comma: a description word changed', last_word),
    ('S04', 'HexaPDF Space Mono, due dates: a due date changed',
     lambda s: movements_of(s)[0].update(due='2026-09-30')),
    ('S04', 'HexaPDF Space Mono, due dates: a payment in parentheses one halala off', lambda s: bump(s, 'Payment')),
    ('S04', 'HexaPDF Space Mono, due dates: the second page forward balance changed',
     lambda s: s['pages'][0][-1].update(balance=s['pages'][0][-1]['balance'] + 100)),
    ('S05', 'pdf-lib Alexandria, types: a credit note number changed', lambda s: ref(s, 'Credit Note', 'CN-99')),
    ('S05', 'pdf-lib Alexandria, types: an invoice one halala off', lambda s: bump(s, 'Invoice')),
    ('S06', 'pdf-lib Readex Pro, total line: the opening balance changed',
     lambda s: s.update(opening=s['opening'] + 100)),
    ('S06', 'pdf-lib Readex Pro, total line: a payment one halala off', lambda s: bump(s, 'Payment')),
    ('S07', 'pdf-lib Arabic, Tajawal, Latin digits: a description word changed', last_word),
    ('S07', 'pdf-lib Arabic, Tajawal, Latin digits: an invoice number changed', lambda s: ref(s, 'Invoice', 'INV-9999')),
    ('S07', 'pdf-lib Arabic, Tajawal, Latin digits: a date changed', lambda s: day(s, '2026-07-19')),
    ('S08', 'pdf-lib Arabic, Alexandria, Arabic-Indic digits: a date changed', lambda s: day(s, '2026-09-19')),
    ('S08', 'pdf-lib Arabic, Alexandria, Arabic-Indic digits: a payment in parentheses one halala off',
     lambda s: bump(s, 'Payment')),
    ('S08', 'pdf-lib Arabic, Alexandria, Arabic-Indic digits: a type changed',
     lambda s: next(m for m in movements_of(s) if m['type'] == 'Invoice').update(type='Payment')),
    ('S09', 'pdf-lib Arabic, Rubik, forward balances: two balances swapped between rows', swap_balances),
    ('S09', 'pdf-lib Arabic, Rubik, forward balances: a credit note one halala off', lambda s: bump(s, 'Credit Note')),
    ('R10', 'HexaPDF Work Sans, wrapped: a word inside a wrapped description',
     lambda s: movements_of(s)[0].update(desc=movements_of(s)[0]['desc'].replace('north', 'south'))),
    ('R11', 'pdf-lib Readex Pro, Net Value: an invoice one halala off', lambda s: bump(s, 'Invoice')),
    ('R12', 'pdf-lib Work Sans, currencies: a dollar invoice printed as riyal',
     lambda s: next(m for m in movements_of(s) if m.get('currency') == 'USD').update(currency='SAR')),
]


def self_test(folder, facts_path):
    """The check must reject planted changes to the facts."""
    original = json.loads(Path(facts_path).read_text(encoding='utf-8'))
    detected = []
    for sid, label, change in CASES:
        story = copy.deepcopy(next(s for s in original if s['id'] == sid))
        change(story)
        with tempfile.TemporaryDirectory() as tmp:
            facts = Path(tmp) / 'stories.json'
            facts.write_text(json.dumps([story], ensure_ascii=False), encoding='utf-8')
            if check(folder, facts)['ok']:
                raise SystemExit(f'self-test: not detected: {sid} {label}')
        detected.append(f'{sid}: {label}')
    # The glyph check must find a letter drawn as .notdef, in each writer.
    for sid in ('S01', 'S05', 'S08'):
        with tempfile.TemporaryDirectory() as tmp:
            planted = Path(tmp) / f'{sid}-statement.pdf'
            letter = notdef_planted(Path(folder) / planted.name, planted)
            if not missing_glyphs(planted):
                raise SystemExit(f'self-test: a .notdef glyph not detected for {sid}')
        detected.append(f'{sid}: the letter {letter} drawn as .notdef')
    return detected


def main(folder, facts_path):
    folder = Path(folder)
    detected = self_test(folder, facts_path)
    report = check(folder, facts_path)
    stories = json.loads(Path(facts_path).read_text(encoding='utf-8'))
    for entry, story in zip(report['statements'], stories):
        info = pdf_info(folder / entry['file'])
        entry.update(creator=info['creator'], producer=info['producer'], fonts=info['fonts'],
                     fontDeclared=story['font'], fontPresent=font_matches(story, info['fonts']))
        if not (info['producer'] or '').startswith(WRITERS[story['producer']]) or not entry['fontPresent']:
            entry['ok'] = False
            entry['problems'].append(f"writer {info['producer']!r} or fonts {info['fonts']} differ from the story")
        notdef = missing_glyphs(folder / entry['file'])
        entry['notdefGlyphs'] = len(notdef)
        if notdef:
            entry['ok'] = False
            entry['problems'].append(f'glyphs drawn as .notdef: {notdef[:5]}')
    report['selfTest'] = detected
    report['ok'] = all(s['ok'] for s in report['statements'])
    (folder / 'VERIFY.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'ok': report['ok'], 'selfTest': len(detected),
                      'statements': [(s['id'], s['pages'], s['valuesFound'], s['ok'], s['problems'][:2])
                                     for s in report['statements']]}, ensure_ascii=False))
    raise SystemExit(0 if report['ok'] else 1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
