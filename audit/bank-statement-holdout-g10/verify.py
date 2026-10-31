"""Independent check of the G10 holdout files, before any product run.

  python3 -B audit/bank-statement-holdout-g10/stories.py > stories.json
  PYTHONPATH=<pdfminer.six, pymupdf> python3 -B verify.py frozen stories.json

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
   which folds Arabic presentation forms. A value must stand alone:
   `1,000.00` is not found inside `11,000.00`; and a balance that is not
   overdrawn must not stand beside DR on its row.
2. FOP and OpenPDF wrap a long description or continuation themselves,
   so the facts do not say where its lines break. Its first word must be on
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
5. Each PDF names its writer as Producer (Apache FOP or OpenPDF) and carries
   the font its story declares, read from the document information and the
   page resources.
6. No glyph meets a painted rule: each glyph's outline box, from MuPDF's
   exact glyph boxes, keeps a gap from every stroked line or rectangle edge
   (half its width included) and every fill thinner than 3 points. A glyph
   that touches a rule is a reason to refuse a statement, so a story whose
   glyph does is not eligible as a positive. The least gap is recorded.
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
WRITERS = {'fop': ('producer', 'Apache FOP '), 'openpdf': ('producer', 'OpenPDF ')}
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
    the gap is wider than a quarter of the glyph height. Its reading text
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
                if last is not None and g.x0 - last.x1 > (g.height or 8) * 0.25 and words[-1]:
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
                hit = next((i for i in range(at, len(visual))
                            if all(found(v, visual[i], rtl) for v in want)
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
    resources."""
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


def ink_clearance(pdf):
    """The least gap in points between a glyph's outline box and a painted
    rule, over every page, with where it is; negative means they meet."""
    import pymupdf
    least = (float('inf'), None)
    with pymupdf.open(str(pdf)) as doc:
        for number, page in enumerate(doc, 1):
            glyphs = [(pymupdf.Rect(c['bbox']), c['c'])
                      for b in page.get_text('rawdict', flags=pymupdf.TEXT_ACCURATE_BBOXES)['blocks']
                      for line in b.get('lines', []) for span in line['spans'] for c in span['chars']
                      if c['c'].strip() and not pymupdf.Rect(c['bbox']).is_empty]
            for d in page.get_drawings():
                rules = []
                for item in d['items']:
                    if item[0] == 'l':
                        a, b = item[1], item[2]
                        rules.append(pymupdf.Rect(min(a.x, b.x), min(a.y, b.y), max(a.x, b.x), max(a.y, b.y)))
                    elif item[0] == 're':
                        r = pymupdf.Rect(item[1])
                        if 's' in d['type']:
                            rules += [pymupdf.Rect(r.x0, r.y0, r.x1, r.y0), pymupdf.Rect(r.x0, r.y1, r.x1, r.y1),
                                      pymupdf.Rect(r.x0, r.y0, r.x0, r.y1), pymupdf.Rect(r.x1, r.y0, r.x1, r.y1)]
                        if 'f' in d['type'] and (r.width <= 3 or r.height <= 3):
                            rules.append(r)
                half = (d.get('width') or 0) / 2 if 's' in d['type'] else 0
                for r in rules:
                    r = pymupdf.Rect(r.x0 - half, r.y0 - half, r.x1 + half, r.y1 + half)
                    for g, ch in glyphs:
                        if g.x1 > r.x0 and g.x0 < r.x1:
                            gap = max(r.y0 - g.y1, g.y0 - r.y1)
                        elif g.y1 > r.y0 and g.y0 < r.y1:
                            gap = max(r.x0 - g.x1, g.x0 - r.x1)
                        else:
                            continue
                        if gap < least[0]:
                            least = (gap, f'page {number}: {ch!r} at {tuple(round(v, 1) for v in g)}')
    return least


def font_matches(story, fonts):
    def bare(name):
        return re.sub('[^0-9A-Za-z]', '', name.split('+')[-1])
    return any(bare(story['font']) in bare(f) for f in fonts)


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


CASES = [
    ('P01', 'FOP Open Sans, tight grid: a withdrawal one halala off', lambda s: bump(s, 'withdrawal')),
    ('P01', 'FOP Open Sans, tight grid: two balances swapped between rows', swap_balances),
    ('P01', 'FOP Open Sans, tight grid: the remittance reference changed',
     lambda s: keyed(s, 'b:rm').update(reference='RMT-77301')),
    ('P02', 'FOP Arabic, Almarai: a description word changed', last_word),
    ('P02', 'FOP Arabic, Almarai: the short payment one riyal off', lambda s: keyed(s, 'b:sp').update(deposit=996150)),
    ('P02', 'FOP Arabic, Almarai: a value date changed', lambda s: first(s, 'movement').update(valueDate='2026-05-04')),
    ('P03', 'FOP Arabic, Markazi, Arabic-Indic: an overdrawn balance without DR',
     lambda s: first(s, 'movement', lambda l: l['balance'] < 0).update(
         balance=-first(s, 'movement', lambda l: l['balance'] < 0)['balance'])),
    ('P03', 'FOP Arabic, Markazi, Arabic-Indic: a description word changed',
     lambda s: last_word(s, lambda l: l['key'] == 'b:rf')),
    ('P03', 'FOP Arabic, Markazi, Arabic-Indic: the refund reference changed',
     lambda s: keyed(s, 'b:rf').update(reference='RFD-0139')),
    ('P04', 'FOP Courier Prime: a page total changed',
     lambda s: first(s, 'page-totals').update(deposit=first(s, 'page-totals')['deposit'] + 1)),
    ('P04', 'FOP Courier Prime: a word inside a wrapped description', long_word),
    ('P04', 'FOP Courier Prime: the lower-case reference read in upper case',
     lambda s: keyed(s, 'b:lc').update(reference='INV-26-0517')),
    ('P04', 'FOP Courier Prime: an overdrawn balance without DR',
     lambda s: first(s, 'movement', lambda l: l['balance'] < 0).update(
         balance=-first(s, 'movement', lambda l: l['balance'] < 0)['balance'])),
    ('P05', 'FOP Helvetica: the repeated page read back as page 3',
     lambda s: s['statement']['pages'][2].update(number=3)),
    ('P06', 'FOP Helvetica: the continuation text changed',
     lambda s: first(s, 'continuation').update(text=first(s, 'continuation')['text'].replace('55102', '55120'))),
    ('P06', 'FOP Helvetica: the value date after the period changed',
     lambda s: keyed(s, 'b:vt').update(valueDate='2026-04-02')),
    ('P06', 'FOP Helvetica: the printed page numbers changed', lambda s: s['statement']['pages'][-1].update(number=9)),
    ('P07', 'OpenPDF Helvetica, grid: the reference read without its leading zeros',
     lambda s: keyed(s, 'b:lz').update(reference='PAY-42')),
    ('P07', 'OpenPDF Helvetica, grid: two balances swapped between rows', swap_balances),
    ('P07', 'OpenPDF Helvetica, grid: a card settlement one halala off', lambda s: bump(s, 'deposit')),
    ('P08', 'OpenPDF Courier: an overdrawn balance without DR',
     lambda s: first(s, 'movement', lambda l: l['balance'] < 0).update(
         balance=-first(s, 'movement', lambda l: l['balance'] < 0)['balance'])),
    ('P08', 'OpenPDF Courier: the value date before the period changed',
     lambda s: keyed(s, 'b:v0').update(valueDate='2026-09-29')),
    ('P08', 'OpenPDF Courier: a description word changed', last_word),
    ('P09', 'OpenPDF Arabic, Amiri: a description word changed', last_word),
    ('P09', 'OpenPDF Arabic, Amiri: the second GOSI reference changed',
     lambda s: keyed(s, 'b:gs2').update(reference='SADAD-7300418825')),
    ('P09', 'OpenPDF Arabic, Amiri: the fee changed', lambda s: keyed(s, 'b:fee').update(
        withdrawal=keyed(s, 'b:fee')['withdrawal'] + 100)),
    ('P10', 'OpenPDF Arabic, DejaVu, Arabic-Indic: a page total changed',
     lambda s: first(s, 'page-totals').update(withdrawal=first(s, 'page-totals')['withdrawal'] + 100)),
    ('P10', 'OpenPDF Arabic, DejaVu, Arabic-Indic: an overdrawn balance without DR',
     lambda s: first(s, 'movement', lambda l: l['balance'] < 0).update(
         balance=-first(s, 'movement', lambda l: l['balance'] < 0)['balance'])),
    ('P10', 'OpenPDF Arabic, DejaVu, Arabic-Indic: a date changed',
     lambda s: first(s, 'movement').update(date='2026-12-04')),
    ('P11', 'OpenPDF Open Sans: the first printed page read back as page 1',
     lambda s: s['statement']['pages'][0].update(number=1)),
    ('P12', 'OpenPDF Courier Prime: the closing balance read back as the running balance',
     lambda s: first(s, 'closing').update(balance=first(s, 'closing')['balance'] + 10000)),
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
    # The XLSX comparison must also reject a changed cashbook row.
    for sid in ('P04', 'P08'):
        story = next(s for s in original['stories'] if s['id'] == sid)
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / f'{sid}-cashbook.xlsx').write_bytes((Path(folder) / f'{sid}-cashbook.xlsx').read_bytes())
            text = (Path(folder) / f'{sid}-cashbook.csv').read_bytes().decode('utf-8')
            m = re.search(r',(\d+\.\d\d)(,|\r\n)', text)
            changed = text.replace(m.group(0), f',{Decimal(m.group(1)) + Decimal("0.01")}{m.group(2)}', 1)
            (tmp / f'{sid}-cashbook.csv').write_bytes(changed.encode('utf-8'))
            if xlsx_report(tmp, story)['sameAsCsv']:
                raise SystemExit(f'self-test: XLSX change not detected for {sid}')
        detected.append(f'{sid}: XLSX cashbook one halala off its CSV')
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
        gap, where = ink_clearance(folder / entry['file'])
        entry['inkClearance'] = {'least': round(gap, 2), 'at': where}
        if gap <= 0:
            entry['ok'] = False
            entry['problems'].append(f'a glyph meets a painted rule, {where}')
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
