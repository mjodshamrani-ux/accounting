"""Independent check of the R4 holdout statements, before any product run.

  python3 -B audit/bank-sheet-holdout-r4/stories.py --records > records.json
  PYTHONPATH=<pdfminer.six, pymupdf, fonttools> python3 -B verify.py frozen records.json

Copied from W4's verify.py (G23's, itself G20's), with R4's plants: one record
per printed statement, each period of each story; R4 has no XLSX cashbook.

1. Every statement PDF is read with pdfminer.six, a reader unrelated to the
   product's pdf.js, glyph by glyph. Glyphs sharing a baseline make one
   visual row, ordered left to right. Every printed line of the facts must be
   found on its own row, in the facts' order down the page, with all of its
   values: a movement's dates, reference, amount and balance; a control
   line's balance; both totals, 0.00 included; a continuation's text. The
   account and the whole `Page n of N` footer must be on every page, and the
   page count must match. Right-to-left rows are matched in reading order or in
   visual order (the segments of a date or a `DR` balance in reverse, or the
   whole text reversed with its runs of digits left to right), after NFKC,
   which folds Arabic presentation forms; an Arabic continuation also in
   reading order, as a ligature glyph keeps its letters in reading order. A
   value must stand alone:
   `1,000.00` is not found inside `11,000.00`; and a balance that is not
   overdrawn must not stand beside DR on its row.
2. The HexaPDF service and the pdf-lib application wrap a long description
   themselves, so
   the facts do not say where its lines break. Its first word must be on
   the line's row, and all its words, in order, on the rows from there to
   the next printed line of the facts. In Arabic the words are read in
   reading order: each row's words from right to left, and the glyphs of a
   word holding an Arabic letter from right to left, each glyph keeping its
   own letters, so that a ligature's letters stay in the order the font's
   map gives them.
3. The check must fail on planted changes to the facts, for each producer
   and layout: values, references, dates, page numbers, a description word,
   two balances swapped between rows, an overdrawn balance without its DR.
4. Each XLSX cashbook holds the CSV cashbook row for row: a text XLSX read
   cell by cell; a typed XLSX with dates as day serials from 1899-12-30 and
   amounts as numbers, converted here with Decimal.
5. Each PDF names its writer as Producer (HexaPDF, or pdf-lib for the
   pdf-lib application) and carries the fonts its story declares, read from
   the document information and the page resources.
6. Every glyph drawn is a glyph of its font: MuPDF's glyph id for it is not
   0, the .notdef box, and in a CID-keyed CFF font, where MuPDF gives the
   CID, the CID is one the font's charset holds. A letter the font cannot draw would still be in the
   text layer through the font's ToUnicode map and pass every check above
   (G15's first drafts in El Messiri did; G23's first drafts drew Tajawal's
   missing Arabic separators as .notdef). The check must find a letter
   planted as .notdef in each kind of font the writers embed here: HexaPDF's
   and pdf-lib's Type0 TrueType fonts, each with an Identity CIDToGIDMap.
Whether a glyph meets a painted rule, and every other reason the product
may give to refuse a statement, is checked before the seal by
audit/bank-statement-eligibility/eligibility.py (ELIGIBILITY.json), not here;
so is each XLSX cashbook as the product reads it (cashbook.py, since G16).
The result, VERIFY.json, is bound to the PDF hashes and the facts hash.
"""
import copy
import hashlib
import json
import re
import sys
import tempfile
import unicodedata
import zipfile
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTChar, LTContainer
from pdfminer.pdfdocument import PDFDocument
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfparser import PDFParser
from pdfminer.pdftypes import resolve1

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'bank-statement-foundation'))
from oracle import csv_rows, xlsx_rows  # noqa: E402

sys.path.insert(0, str(HERE))
from common import CASHBOOK_HEADERS, LABELS, balance_text, digits_of, movement_amount, total_amount  # noqa: E402

M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
EDGE = r'0-9A-Za-z٠-٩٫٬,.'
DIGITS = r'0-9٠-٩٫٬,.'
WRITERS = {'hexapdf': ('producer', 'HexaPDF version '), 'pdflib': ('producer', 'pdf-lib (')}
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


def visual_rows(pdf):
    return [[visual for visual, _ in page] for page in page_rows(pdf)]


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


def line_values(story, line):
    d = digits_of(story)
    k = line['kind']
    if k == 'movement':
        values = [d(line['date']), d(line['valueDate']), d(movement_amount(line['withdrawal'] or line['deposit'])),
                  d(balance_text(line['balance']))]
        if line['reference']:
            values.append(line['reference'])
        if story['layout'] == 'en':
            values.append(line['description'].split()[0])
        return values
    if k in ('totals', 'page-totals'):
        return [d(total_amount(line['withdrawal'])), d(total_amount(line['deposit']))]
    if k == 'continuation':
        return [line['text']] if story['layout'] == 'ar' else [line['text'].split()[0]]
    return [d(balance_text(line['balance']))]


def line_absent(story, line):
    """Forms that must not be on the line's row: a balance that is not
    overdrawn must not be printed with DR."""
    if 'balance' in line and line['balance'] >= 0:
        return [digits_of(story)(balance_text(-line['balance']))] if line['balance'] else []
    return []


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


def check(folder, facts_path):
    folder = Path(folder)
    facts_bytes = Path(facts_path).read_bytes()
    data = json.loads(facts_bytes)
    report = {'reader': 'pdfminer.six, glyph by glyph, rows by baseline, Arabic descriptions in reading order',
              'factsSha256': hashlib.sha256(facts_bytes).hexdigest(), 'statements': []}
    for story in data['stories']:
        pdf = folder / f"{story['id']}-statement.pdf"
        both = page_rows(pdf)
        rows = [[visual for visual, _ in page] for page in both]
        rtl = story['layout'] == 'ar'
        d = digits_of(story)
        pages = story['statement']['pages']
        problems, values = [], 0
        if len(rows) != len(pages):
            problems.append(f'pages {len(rows)} != expected {len(pages)}')
        for page, visual, readings in zip(pages, rows, both):
            n = page['number']
            footer = d(LABELS[story['layout']]['page'].format(n, page['of']))
            if not any(found(footer, r, rtl) for r in visual):
                problems.append(f'page {n}: footer {footer!r} missing')
            if not any(found(story['statement']['account'], r, rtl) for r in visual):
                problems.append(f'page {n}: account missing')
            at, hits = 0, []
            for line in page['lines']:
                want, absent = line_values(story, line), line_absent(story, line)

                def rows_at(i, line=line):
                    # An Arabic continuation is whole text: a ligature glyph
                    # keeps its letters in reading order, so its row is also
                    # read in reading order.
                    if rtl and line['kind'] == 'continuation':
                        return (visual[i], readings[i][1])
                    return (visual[i],)
                hit = next((i for i in range(at, len(visual))
                            if any(all(found(v, r, rtl) for v in want) for r in rows_at(i))
                            and not any(found(v, visual[i], rtl) for v in absent)), None)
                if hit is None:
                    problems.append(f"page {n}: {line.get('key', line['kind'])} {want} not on one row in order")
                else:
                    values += len(want)
                    at = hit + 1
                hits.append(hit)
            for i, line in enumerate(page['lines']):
                if line['kind'] not in ('movement', 'continuation') or hits[i] is None:
                    continue
                text = line.get('description', line.get('text'))
                stop = next((h for h in hits[i + 1:] if h is not None), len(visual))
                if rtl:
                    span = ' '.join(reading for _, reading in readings[hits[i]:stop])
                    if line['kind'] == 'movement' and not in_order(unicodedata.normalize('NFKC', text).split(), span):
                        problems.append(f"page {n}: {line['key']} description not in reading order")
                    continue
                span = ' '.join(visual[hits[i]:stop])
                if not in_order(text.split(), span):
                    problems.append(f"page {n}: {line.get('key', line['kind'])} text not printed in order")
        if rtl and not any('؀' <= ch <= 'ۿ' for p in rows for r in p for ch in r):
            problems.append('no Arabic letters in the text layer')
        report['statements'].append({'id': story['id'], 'file': pdf.name,
                                     'sha256': hashlib.sha256(pdf.read_bytes()).hexdigest(),
                                     'pages': len(rows), 'valuesFound': values, 'ok': not problems,
                                     'problems': problems[:20]})
    report['ok'] = all(s['ok'] for s in report['statements'])
    return report


def typed_rows(path):
    """First worksheet with each cell's raw value and type."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        shared = []
        if 'xl/sharedStrings.xml' in names:
            for si in ElementTree.fromstring(z.read('xl/sharedStrings.xml')).iter(f'{M}si'):
                shared.append(''.join(t.text or '' for t in si.iter(f'{M}t')))
        sheet = sorted(n for n in names if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', n))[0]
        root = ElementTree.fromstring(z.read(sheet))
    out = []
    for row in root.iter(f'{M}row'):
        cells = {}
        for c in row.iter(f'{M}c'):
            col = re.match(r'[A-Z]+', c.get('r')).group(0)
            v = c.find(f'{M}v')
            t = c.get('t')
            if t == 's':
                cells[col] = ('s', shared[int(v.text)])
            elif t == 'inlineStr':
                cells[col] = ('s', ''.join(x.text or '' for x in c.iter(f'{M}t')))
            elif t == 'str':
                cells[col] = ('s', v.text or '')
            elif v is not None:
                cells[col] = ('n', v.text)
        out.append([cells.get(k) for k in 'ABCDEF'])
    return out


def typed_as_csv(rows):
    """A typed cashbook in the CSV's text: day serial to yyyy-mm-dd, number to
    two decimals."""
    out = []
    for i, r in enumerate(rows):
        if i == 0:
            out.append([c[1] if c else '' for c in r])
            continue
        kind, value = r[0]
        if kind != 'n':
            raise ValueError(f'row {i + 1}: date is not a day serial')
        day = (date(1899, 12, 30) + timedelta(days=int(Decimal(value)))).isoformat()
        cells = [day] + [r[k][1] if r[k] else '' for k in (1, 2, 3)]
        for k in (4, 5):
            if r[k] is None:
                cells.append('')
            elif r[k][0] != 'n':
                raise ValueError(f'row {i + 1}: amount is not a number')
            else:
                cells.append(str(Decimal(r[k][1]).quantize(Decimal('0.01'))))
        out.append(cells)
    return out


def xlsx_report(folder, story):
    path = folder / f"{story['id']}-cashbook.xlsx"
    want = csv_rows(folder / f"{story['id']}-cashbook.csv")
    if story['cashbookXlsx'] == 'typed':
        rows = typed_rows(path)
        types = {c[0] for r in rows[1:] for c in (r[0], r[4], r[5]) if c}
        return {'file': path.name, 'kind': 'typed', 'cellTypes': sorted(types), 'sameAsCsv': typed_as_csv(rows) == want,
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    got = [r + [''] * (len(CASHBOOK_HEADERS) - len(r)) for r in xlsx_rows(path)]
    return {'file': path.name, 'kind': 'text', 'sameAsCsv': got == want,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


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
    new = 'cid65000' if hasattr(top, 'ROS') else f'{name}.g23'
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
    letter's CID to glyph 0. The other branches, kept from G20, plant the
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


def first(story, kind, pred=lambda l: True):
    return next(l for p in story['statement']['pages'] for l in p['lines'] if l['kind'] == kind and pred(l))


def swap_balances(story):
    a, b = [l for p in story['statement']['pages'] for l in p['lines'] if l['kind'] == 'movement'][:2]
    a['balance'], b['balance'] = b['balance'], a['balance']


def bump(story, field, pred=lambda l: True, by=1):
    line = first(story, 'movement', lambda l: l[field] and pred(l))
    line[field] += by


def long_word(story):
    line = first(story, 'movement', lambda l: len(l['description'].split()) > 8)
    words = line['description'].split()
    words[6] = words[6] + 'x'
    line['description'] = ' '.join(words)


def last_word(story, pred=lambda l: True):
    line = first(story, 'movement', pred)
    words = line['description'].split()
    words[-1] = words[-1] + ('ة' if story['layout'] == 'ar' else 'x')
    line['description'] = ' '.join(words)


def keyed(story, key):
    return first(story, 'movement', lambda l: l['key'] == key)


def overdrawn_without_dr(story):
    line = first(story, 'movement', lambda l: l['balance'] < 0)
    line['balance'] = -line['balance']


def ref_line(story, reference):
    return first(story, 'movement', lambda l: l['reference'] == reference)


CASES = [
    ('K01-JAN', 'HexaPDF Work Sans: a withdrawal one halala off', lambda s: bump(s, 'withdrawal')),
    ('K12-FEB', "HexaPDF Fira Sans, landscape, two pages: page 2's balance brought forward changed",
     lambda s: s['statement']['pages'][1]['lines'][0].update(balance=s['statement']['pages'][1]['lines'][0]['balance'] + 100)),
    ('K19-DEC', 'HexaPDF Merriweather, dollars: the wire fee changed',
     lambda s: ref_line(s, 'FEE-K19-1231').update(withdrawal=ref_line(s, 'FEE-K19-1231')['withdrawal'] + 1)),
    ('K04-DEC', 'HexaPDF Merriweather: a date changed', lambda s: first(s, 'movement').update(date='2027-12-02')),
    ('K08-DEC', 'HexaPDF Space Mono, Letter: the unreferenced deposit one halala off',
     lambda s: ref_line(s, '').update(deposit=ref_line(s, '')['deposit'] + 1)),
    ('K17-MAR', "HexaPDF Work Sans: a movement's reference changed",
     lambda s: first(s, 'movement').update(reference=first(s, 'movement')['reference'] + 'X')),
    ('K14-DEC', 'HexaPDF Merriweather: two balances swapped between rows', swap_balances),
    ('K16-FEB', 'HexaPDF Space Mono, dollars: the closing balance changed',
     lambda s: first(s, 'closing').update(balance=first(s, 'closing')['balance'] + 10000)),
    ('K02-FEB', 'pdf-lib Rubik, two pages: the printed page count changed',
     lambda s: [p.update(of=3) for p in s['statement']['pages']]),
    ('K05-JAN', 'pdf-lib Readex Pro, landscape, overdrawn: a balance read without its DR', overdrawn_without_dr),
    ('K09-JAN', 'pdf-lib Readex Pro: a withdrawal one halala off', lambda s: bump(s, 'withdrawal')),
    ('K13-JAN', 'pdf-lib Lemonada: a description word changed', last_word),
    ('K07-MAR', 'pdf-lib Lemonada, a page missing: page 3 read back as page 2',
     lambda s: s['statement']['pages'][1].update(number=2)),
    ('K18-JAN', 'pdf-lib Rubik: the unreferenced deposit one halala off',
     lambda s: ref_line(s, '').update(deposit=ref_line(s, '')['deposit'] + 1)),
    ('K15-JAN', 'pdf-lib Readex Pro, landscape: the opening balance changed',
     lambda s: first(s, 'opening').update(balance=first(s, 'opening')['balance'] - 100)),
    ('K03-MAR', 'pdf-lib Arabic, Cairo, Arabic-Indic digits: a date changed',
     lambda s: first(s, 'movement').update(date='2028-03-02')),
    ('K03-MAR', 'pdf-lib Arabic, Cairo, Arabic-Indic digits: the fee one halala off',
     lambda s: ref_line(s, 'FEE-K03-0331').update(withdrawal=ref_line(s, 'FEE-K03-0331')['withdrawal'] + 1)),
    ('K20-JAN', 'pdf-lib Arabic, Cairo, Arabic-Indic digits: a description word changed', last_word),
    ('K22-MAR', "pdf-lib Arabic, Tajawal, Latin digits: a movement's reference changed",
     lambda s: first(s, 'movement').update(reference=first(s, 'movement')['reference'] + 'X')),
    ('K22-MAR', 'pdf-lib Arabic, Tajawal, Latin digits: a withdrawal one halala off', lambda s: bump(s, 'withdrawal')),
]


def self_test(folder, facts_path):
    """The PDF check must reject planted changes to the facts."""
    original = json.loads(Path(facts_path).read_text(encoding='utf-8'))
    detected = []
    for sid, label, change in CASES:
        data = copy.deepcopy(original)
        story = next(s for s in data['stories'] if s['id'] == sid)
        change(story)
        data['stories'] = [story]
        with tempfile.TemporaryDirectory() as tmp:
            facts = Path(tmp) / 'stories.json'
            facts.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
            if check(folder, facts)['ok']:
                raise SystemExit(f'self-test: not detected: {sid} {label}')
        detected.append(f'{sid}: {label}')
    # The glyph check must find a letter drawn as .notdef, in each writer.
    for sid in ('K01-JAN', 'K08-DEC', 'K02-FEB', 'K03-MAR', 'K22-MAR'):
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
    facts = json.loads(Path(facts_path).read_text(encoding='utf-8'))
    for entry, story in zip(report['statements'], facts['stories']):
        info = pdf_info(folder / entry['file'])
        entry.update(creator=info['creator'], producer=info['producer'], fonts=info['fonts'],
                     fontDeclared=story['font'], fontPresent=font_matches(story, info['fonts']))
        field, prefix = WRITERS[story['producer']]
        if not (info[field] or '').startswith(prefix) or not entry['fontPresent']:
            entry['ok'] = False
            entry['problems'].append(f"writer {info[field]!r} or fonts {info['fonts']} differ from the story")
        notdef = missing_glyphs(folder / entry['file'])
        entry['notdefGlyphs'] = len(notdef)
        if notdef:
            entry['ok'] = False
            entry['problems'].append(f'glyphs drawn as .notdef: {notdef[:5]}')
    report['cashbookXlsx'] = [xlsx_report(folder, s) for s in facts['stories'] if s.get('cashbookXlsx')]
    report['selfTest'] = detected
    report['ok'] = all(s['ok'] for s in report['statements']) and all(x['sameAsCsv'] for x in report['cashbookXlsx'])
    (folder / 'VERIFY.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'ok': report['ok'], 'selfTest': len(detected),
                      'statements': [(s['id'], s['pages'], s['valuesFound'], s['ok'], s['problems'][:2])
                                     for s in report['statements']],
                      'cashbookXlsx': [(x['file'], x['kind'], x['sameAsCsv']) for x in report['cashbookXlsx']]},
                     ensure_ascii=False))
    raise SystemExit(0 if report['ok'] else 1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
