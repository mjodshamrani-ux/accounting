"""The guarded statement reader's line reading, reproduced before the seal.

bank-statement-native-1 reads each page by its own column headers
(lib/reconciliation/bank-statement-native.ts): a header band of up to three
stacked lines whose cells are the declared headers, exactly and in order;
then each line between it and the page-number footer, every value of which
must lie wholly inside one column. A line is a declared control line (its
label, and its amounts in amount columns), a description alone (the wrap of
the movement above, or a continuation after the brought-forward line), or a
movement (one date, one value date, one withdrawal or deposit and its
balance). A value that lies in no column, or a line that fits no form,
stops the reading. G12 found two statements refused this way that no check
before the seal had read (DEV-58).

The pieces are the reader's: PDF.js text items as items.py builds them from
the content stream (since G19), each with its advance box. An item that
fits no column counts through its word parts, as the reader's do: a
left-to-right item whose text PDF.js spaces into words, each part as wide
as its glyphs; a right-to-left item stays whole.
From G13 to G18 the items were built from MuPDF's characters by PDF.js's
spacing rule alone (mupdf_items, kept for the comparison); MuPDF names two
subsets of one font alike and does not see marked content, so they were not
PDF.js's items wherever a writer changed subset or marked its text (DEV-67).
Amounts are read at the decimals of the one currency the first page's
heading names, as the reader reads them, and a heading that names no single
currency the reader knows stops the reading there (SCOPE); until T4 of
TOL-1 every amount was read at two decimals, so that a dinar or yen
statement the reader reads was refused here at its first amount. The
reader's other SCOPE rule, two dates for the period, is not reproduced.
Nothing is imported from the product; the vocabulary and the constants
below are the reader's, checked against its source text (drift).
"""
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

import items as pdfjs
from cashbook import DECIMALS

ROOT = Path(__file__).resolve().parent.parent.parent
READER = ROOT / 'lib' / 'reconciliation' / 'bank-statement-native.ts'
PRECISION = ROOT / 'lib' / 'reconciliation' / 'currency-precision.ts'

PADDING, SEPARATION, UNDER = 2.5, 1, 0.5        # columnOf
SAME_LINE = 1                                   # linesOf: baselines within 1 point
JOIN = 0.15                                     # textOf: no space below 0.15 of the height
FLOW_MAX, FLOW_MIN, BACK = 0.6, 0.102, -0.2      # PDF.js item spacing, in em
DATE, VALUE_DATE, DESCRIPTION, REFERENCE, WITHDRAWAL, DEPOSIT, BALANCE = range(7)
VOCABULARY = {
    'en': {
        'direction': 'ltr',
        'headers': ['Date', 'Value Date', 'Description', 'Reference', 'Withdrawal', 'Deposit', 'Balance'],
        'labels': {'opening': 'Opening balance', 'brought-forward': 'Balance brought forward',
                   'carried-forward': 'Balance carried forward', 'closing': 'Closing balance',
                   'totals': 'Total withdrawals / deposits', 'page-totals': 'Page total withdrawals / deposits'},
        'page': re.compile(r'^Page (\d+) of (\d+)$'),
    },
    'ar': {
        'direction': 'rtl',
        'headers': ['التاريخ', 'تاريخ القيمة', 'البيان', 'المرجع', 'سحب', 'إيداع', 'الرصيد'],
        'labels': {'opening': 'الرصيد الافتتاحي', 'brought-forward': 'رصيد منقول من الصفحة السابقة',
                   'carried-forward': 'رصيد منقول إلى الصفحة التالية', 'closing': 'الرصيد الختامي',
                   'totals': 'إجمالي السحب / الإيداع', 'page-totals': 'إجمالي الصفحة سحب / إيداع'},
        'page': re.compile(r'^صفحة (\d+) من (\d+)$'),
    },
}


def drift():
    """The reader's words and constants that this module copies and its source
    no longer carries."""
    text = READER.read_text(encoding='utf-8')
    missing = [w for v in VOCABULARY.values() for w in v['headers'] + list(v['labels'].values())
               if f"'{w}'" not in text]
    for const in ('PADDING = 2.5', 'SEPARATION = 1', 'UNDER = 0.5', 'Math.abs(last.y - t.y) <= 1',
                  '0.15 * Math.min(p.height, q.height)', 'currencies.length === 1 ? currencyPrecision(currencies[0])',
                  r'/^[A-Z]{3}$/u.test(p.text)'):
        if const not in text:
            missing.append(const)
    precision = PRECISION.read_text(encoding='utf-8')
    missing += [f'{code}: {n}' for code, n in DECIMALS.items() if f'  {code}: {n},\n' not in precision]
    return missing


def latin_digits(s):
    return (s.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'))
            .replace('٬', ',').replace('٫', '.'))


def normal(s):
    return ' '.join(unicodedata.normalize('NFKC', s).split())


def squeeze(s):
    return ''.join(unicodedata.normalize('NFKC', s).split())


def amount(text, allow_debit, decimals=2):
    fraction = rf'\.\d{{{decimals}}}' if decimals else ''
    m = re.fullmatch(rf'(?:\d{{1,3}}(?:,\d{{3}})*|\d+){fraction}(?P<dr> DR)?', latin_digits(normal(text)))
    return None if not m or (m.group('dr') and not allow_debit) else m


def heading_decimals(lines, layout):
    """The decimals of the one currency the heading above the first page's
    column headers names (a word of three capitals, in its items' word parts
    or in its line read in order), or None where it names none, or more than
    one, or one the reader does not know."""
    header = find_header(lines, VOCABULARY[layout])
    heading = lines[:header[0]] if header else []
    words = [q.text for line in heading for p in line for q in p.parts()]
    words += [w for line in heading for w in text_of([q for p in line for q in p.parts()],
                                                      VOCABULARY[layout]['direction']).split()]
    currencies = {w for w in words if re.fullmatch(r'[A-Z]{3}', w)}
    return DECIMALS.get(currencies.pop()) if len(currencies) == 1 else None


def iso_date(s):
    m = re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})', latin_digits(normal(s)))
    if not m:
        return None
    from datetime import date
    try:
        return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
    except ValueError:
        return None


def statement_date(text, layout):
    forms = [text] + (['-'.join(reversed(text.split('-')))] if layout == 'ar' else [])
    found = {d for d in map(iso_date, forms) if d}
    return found.pop() if len(found) == 1 else None


def arabic(ch):
    o = ord(ch)
    return 0x0600 <= o <= 0x06FF and not (0x0660 <= o <= 0x0669 or o in (0x066B, 0x066C)) or \
        0xFB50 <= o <= 0xFDFF or 0xFE70 <= o <= 0xFEFF


def arabic_script(ch):
    """\\p{Script=Arabic}: Arabic letters and digits."""
    o = ord(ch)
    return 0x0600 <= o <= 0x06FF or 0x0750 <= o <= 0x077F or 0xFB50 <= o <= 0xFDFF or 0xFE70 <= o <= 0xFEFF


def bidi_class(ch):
    """PDF.js's count of right-to-left characters: R, AL and AN."""
    o = ord(ch)
    return 0x0590 <= o <= 0x05F4 or 0x0600 <= o <= 0x06FF or 0x0700 <= o <= 0x08AC or \
        0xFB50 <= o <= 0xFDFF or 0xFE70 <= o <= 0xFEFF


class Piece:
    """A PDF.js item or one of its words: text in reading order, advance box,
    baseline (MuPDF's, downwards), height (the font size)."""

    def __init__(self, words, rtl):
        glyphs = [g for w in words for g in w]
        self.words, self.rtl = words, rtl
        self.x0, self.x1 = min(g['x0'] for g in glyphs), max(g['x1'] for g in glyphs)
        self.y, self.height = glyphs[0]['y'], glyphs[0]['size']
        ordered = sorted(words, key=lambda w: -min(g['x0'] for g in w)) if rtl else \
            sorted(words, key=lambda w: min(g['x0'] for g in w))
        self.text = normal(' '.join(word_text(w) for w in ordered))

    def parts(self):
        """The reader's word parts: a left-to-right item PDF.js spaced into
        words (pdf-glyph-geometry.ts, splitTextItems). A glyph of two letters
        does not stop it (G19, measured with the reader)."""
        if self.rtl or len(self.words) == 1:
            return [self]
        return [Piece([w], False) for w in self.words]


def word_text(glyphs):
    """A word's text in reading order: its glyphs from the left, from the
    right if it holds an Arabic letter, each glyph's letters as mapped."""
    ordered = sorted(glyphs, key=lambda g: g['x0'])
    if any(arabic(ch) for g in ordered for ch in g['c']):
        ordered.reverse()
    return unicodedata.normalize('NFKC', ''.join(g['c'] for g in ordered))


def items(page):
    """PDF.js's text items of a page as items.py builds them, line by line,
    top down: lists of Pieces, in MuPDF's page coordinates (y down)."""
    mb, cb = page.mediabox, page.cropbox
    top = mb.y1 - cb.y0
    found = []
    for item in pdfjs.page_items(page.parent, page.number):
        if not item.text.strip():
            continue
        words = [[{'c': c, 'x0': a - cb.x0, 'x1': b - cb.x0, 'y': top - item.y, 'size': item.height}
                  for c, a, b in w] for w in item.words]
        count = sum(bidi_class(ch) for ch in item.text)
        piece = Piece(words, count > 0 and not (count / len(item.text) < 0.3 and len(item.text) > 4))
        piece.x0, piece.x1 = item.x - cb.x0, item.x + item.width - cb.x0
        found.append(piece)
    lines = []
    for p in sorted(found, key=lambda p: (p.y, p.x0)):
        if lines and abs(lines[-1][0].y - p.y) <= SAME_LINE:
            lines[-1].append(p)
        else:
            lines.append([p])
    return [sorted(line, key=lambda p: p.x0) for line in lines]


def mupdf_items(page):
    """The model of G13 to G18: PDF.js's text items of a page, line by line,
    top down: lists of Pieces. The glyphs are taken in the order the page draws them (MuPDF's text
    trace), as PDF.js meets them, and joined into items by its spacing: the
    gap from the end of the last glyph with an advance, a new item past 0.6
    em, back past 0.2 em, a shift across the line past a quarter of the size,
    or a change of font or size; a word break past 0.102 em. A glyph whose
    text is several letters (a ligature) keeps them together."""
    found, item_words, word, prev, font = [], [], [], None, None

    def flush():
        nonlocal item_words, word
        if word:
            item_words.append(word)
        if item_words:
            found.append(make_item(item_words))
        item_words, word = [], []
    for span in page.get_texttrace():
        for unicode, _, origin, bbox in span['chars']:
            ch = chr(unicode)
            if not ch.strip():
                continue
            g = {'c': ch, 'x0': bbox[0], 'x1': bbox[2], 'y': origin[1], 'size': span['size']}
            advance = bbox[2] - bbox[0]
            if prev is not None and advance == 0 and abs(origin[0] - prev['x']) < 0.01 and word:
                word[-1]['c'] += ch      # a further letter of the same glyph
                continue
            if prev is None or font != (span['font'], span['size']):
                flush()
            else:
                em, gap, shift = span['size'], origin[0] - prev['end'], abs(origin[1] - prev['y'])
                if shift > 0.25 * em or gap < BACK * em or gap > FLOW_MAX * em:
                    flush()
                elif gap >= FLOW_MIN * em and word:
                    item_words.append(word)
                    word = []
            font = (span['font'], span['size'])
            word.append(g)
            if advance:
                prev = {'x': origin[0], 'end': origin[0] + advance, 'y': origin[1]}
            elif prev is None:
                prev = {'x': origin[0], 'end': origin[0], 'y': origin[1]}
    flush()
    lines = []
    for p in sorted(found, key=lambda p: (p.y, p.x0)):
        if lines and abs(lines[-1][0].y - p.y) <= SAME_LINE:
            lines[-1].append(p)
        else:
            lines.append([p])
    return [sorted(line, key=lambda p: p.x0) for line in lines]


def make_item(words):
    text = ' '.join(''.join(g['c'] for g in w) for w in words)
    count = sum(bidi_class(ch) for ch in text)
    rtl = count > 0 and not (count / len(text) < 0.3 and len(text) > 4)
    return Piece(words, rtl)


def reading_order(pieces, direction):
    ordered = sorted(pieces, key=(lambda p: p.x0) if direction == 'ltr' else (lambda p: -p.x1))
    def opposite(p):
        return (p.rtl and any(arabic_script(ch) for ch in p.text)) if direction == 'ltr' else \
            (not p.rtl and any(ch.isalnum() for ch in p.text))
    out, i = [], 0
    while i < len(ordered):
        if not opposite(ordered[i]):
            out.append(ordered[i])
            i += 1
            continue
        j = i
        while j < len(ordered) and opposite(ordered[j]):
            j += 1
        out += reversed(ordered[i:j])
        i = j
    return out


def text_of(pieces, direction):
    ordered, out = reading_order(pieces, direction), ''
    for i, p in enumerate(ordered):
        if i:
            q = ordered[i - 1]
            gap = max(p.x0, q.x0) - min(p.x1, q.x1)
            out += ' ' if gap > JOIN * min(p.height, q.height) else ''
        out += p.text
    return normal(out)


class Columns:
    def __init__(self, start, spans, direction):
        self.start, self.spans, self.direction = start, spans, direction

    def placed(self, p):
        """(column, how): by the start edge rule or by end alignment."""
        for k, s in enumerate(self.start):
            nxt = self.start[k + 1] if k + 1 < len(self.start) else None
            if self.direction == 'ltr':
                if p.x0 >= s - PADDING and (nxt is None or p.x1 <= nxt - SEPARATION):
                    return k, 'start'
            elif p.x1 <= s + PADDING and (nxt is None or p.x0 >= nxt + SEPARATION):
                return k, 'start'
        k = next((k for k, (a, b) in enumerate(self.spans) if p.x0 < b - UNDER and p.x1 > a + UNDER), None)
        if k is None:
            return None, None
        own = self.spans[k]
        ends = abs(p.x1 - own[1]) <= PADDING if self.direction == 'ltr' else abs(p.x0 - own[0]) <= PADDING
        clear = all(s == own or (p.x0 >= s[1] + SEPARATION if s[1] <= own[0] else p.x1 <= s[0] - SEPARATION)
                    for s in self.spans)
        return (k, 'end') if ends and clear else (None, None)

    def of(self, p):
        return self.placed(p)[0]

    def fitted(self, p):
        return [p] if self.of(p) is not None else p.parts()


def find_header(lines, v):
    target = [squeeze(h) for h in v['headers']]
    for first in range(len(lines)):
        for last in range(first, min(first + 3, len(lines))):
            if lines[last][0].y - lines[first][0].y > 3 * lines[first][0].height:
                break
            pieces = [q for line in lines[first:last + 1] for p in line for q in p.parts()]
            cells = []
            for p in pieces:
                overlapping = [cell for cell in cells
                               if any(q.y != p.y and p.x0 < q.x1 - 0.5 and p.x1 > q.x0 + 0.5 for q in cell)]
                for cell in overlapping:
                    cells.remove(cell)
                cells.append([p] + [q for cell in overlapping for q in cell])
            units = []
            for cell in cells:
                rows = sorted({q.y for q in cell})
                unit = Piece([w for q in cell for w in q.words], cell[0].rtl)
                unit.text = squeeze(' '.join(text_of([q for q in cell if q.y == y], v['direction']) for y in rows))
                units.append(unit)
            ordered = reading_order(units, v['direction'])
            start, spans, at, ok = [], [], 0, True
            for label in target:
                text, group = '', []
                while at < len(ordered) and len(text) < len(label):
                    text += ordered[at].text
                    group.append(ordered[at])
                    at += 1
                if text != label:
                    ok = False
                    break
                start.append(min(g.x0 for g in group) if v['direction'] == 'ltr' else max(g.x1 for g in group))
                spans.append((min(g.x0 for g in group), max(g.x1 for g in group)))
            if ok and at == len(ordered):
                return first, last, Columns(start, spans, v['direction'])
    return None


def debit_marked(pieces, columns, used):
    rtl = columns.direction == 'rtl'
    out = list(pieces)
    for mark in pieces:
        if mark.text != 'DR' or columns.of(mark) != BALANCE:
            continue
        found = None
        for q in out:
            gap = q.x0 - mark.x1 if rtl else mark.x0 - q.x1
            if (q is not mark and abs(q.y - mark.y) < 0.01 and re.fullmatch(r'[\d٠-٩][\d٠-٩,.٫٬]*', q.text)
                    and columns.of(q) == BALANCE and -UNDER <= gap <= min(q.height, mark.height)):
                found = q
                break
        if found is None:
            continue
        joined = Piece(found.words + mark.words, found.rtl)
        joined.text = f'{found.text} DR'
        out[out.index(found)] = joined
        out.remove(mark)
        used['drAfterAmount'] += 1
    return out


class Refused(Exception):
    def __init__(self, code, page, line, detail):
        super().__init__(f'BANK_STATEMENT_{code}: page {page} line {line}: {detail}')
        self.code, self.page, self.line, self.detail = code, page, line, detail


def read_page(number, lines, layout, used=None, decimals=2):
    """The reader's lines of one page (kinds only), its amounts at
    `decimals`; raises Refused where the reader would. `used` counts the
    rules its lines needed."""
    used = Counter() if used is None else used
    v = VOCABULARY[layout]
    header = find_header(lines, v)
    if header is None:
        raise Refused('HEADER', number, 0, 'no line carries the declared column headers in order')
    first, last, columns = header
    footer = v['page'].fullmatch(latin_digits(text_of(lines[-1], v['direction'])))
    if not footer or len(lines) - 1 <= last:
        raise Refused('PAGE_NUMBER', number, len(lines), 'the last line is not the declared page number')
    labels = {squeeze(text): kind for kind, text in v['labels'].items()}
    out, wrap = [], None
    for index in range(last + 1, len(lines) - 1):
        at = index + 1

        def fail(code, detail):
            raise Refused(code, number, at, detail)
        fitted = [columns.fitted(p) for p in lines[index]]
        used['wordParts'] += sum(1 for p, f in zip(lines[index], fitted) if f != [p])
        pieces = debit_marked([q for f in fitted for q in f], columns, used)
        used['endAligned'] += sum(1 for p in pieces if columns.placed(p)[1] == 'end')
        amounts, label = {}, []
        for p in pieces:
            col = columns.of(p)
            if col is not None and col >= WITHDRAWAL and amount(p.text, col == BALANCE, decimals):
                amounts.setdefault(col, []).append(p)
            else:
                label.append(p)
        kind = labels.get(squeeze(text_of(label, v['direction'])))
        if kind and label:
            def one(col):
                if len(amounts.get(col, [])) > 1:
                    fail('AMOUNT', 'two amounts in one column')
                return col in amounts
            if kind in ('totals', 'page-totals'):
                if BALANCE in amounts:
                    fail('AMOUNT', f'a balance on a {kind} line')
                one(WITHDRAWAL)
                one(DEPOSIT)
            elif not one(BALANCE) or WITHDRAWAL in amounts or DEPOSIT in amounts:
                fail('AMOUNT', f'{kind} needs one balance and nothing else')
            out.append(kind)
            wrap = None
            continue
        cells = [[] for _ in range(7)]
        for p in pieces:
            col = columns.of(p)
            if col is None:
                fail('COLUMN', f'"{p.text}" is not inside one column')
            cells[col].append(p)
        if all(bool(c) == (k == DESCRIPTION) for k, c in enumerate(cells)):
            if wrap is not None and out and out[-1] is wrap:
                pass
            elif out and out[-1] == 'brought-forward':
                wrap = ['continuation']
                out.append(wrap)
                used['continuation'] += 1
            else:
                fail('LINE', 'description text without its movement')
            continue
        for col, name in ((DATE, 'date'), (VALUE_DATE, 'value date')):
            joined = text_of(cells[col], v['direction'])
            if len(cells[col]) > 1 and not re.search(r'\s', joined):
                if not statement_date(joined, layout):
                    fail('DATE', f'{name} "{joined}" is not one date')
                used['dateRuns'] += 1
                used['reversedDate'] += not iso_date(joined)
                continue
            if len(cells[col]) != 1:
                fail('FIELD', f'{name} needs one value')
            if not statement_date(cells[col][0].text, layout):
                fail('DATE', f'{name} "{cells[col][0].text}" is not one date')
            used['reversedDate'] += not iso_date(cells[col][0].text)
        money = {}
        for col in (WITHDRAWAL, DEPOSIT, BALANCE):
            if cells[col]:
                if len(cells[col]) != 1:
                    fail('FIELD', 'amount needs one value')
                if not amount(cells[col][0].text, col == BALANCE, decimals):
                    fail('AMOUNT', f'"{cells[col][0].text}" is not an amount')
                money[col] = True
        if (WITHDRAWAL in money) == (DEPOSIT in money) or BALANCE not in money:
            fail('AMOUNT', 'a movement needs one withdrawal or deposit and its balance')
        wrap = ['movement']
        out.append(wrap)
    return [k if isinstance(k, str) else k[0] for k in out]


def check_statement(doc, used=None):
    """The first place the reader would stop reading this statement, or None;
    and the layout whose headers it found. `used` counts the rules the
    statement's lines needed, up to where the reader would stop."""
    layout = None
    previous = None
    decimals = None
    for number, page in enumerate(doc, 1):
        try:
            lines = items(page)
        except pdfjs.Unmodelled as reason:
            # Not read: eligibility.py's items check names the page.
            return {'layout': layout or 'en', 'code': 'UNMODELLED', 'page': number, 'line': 0, 'detail': str(reason)}
        if layout is None:
            layout = next((name for name, v in VOCABULARY.items() if find_header(lines, v)), 'en')
        if decimals is None and number == 1 and find_header(lines, VOCABULARY[layout]):
            decimals = heading_decimals(lines, layout)
            if decimals is None:
                return {'layout': layout, 'code': 'SCOPE', 'page': 1, 'line': 1,
                        'detail': 'the heading must state one currency the reader knows'}
        try:
            kinds = read_page(number, lines, layout, used, 2 if decimals is None else decimals)
        except Refused as e:
            return {'layout': layout, 'code': e.code, 'page': e.page, 'line': e.line, 'detail': e.detail}
        if 'continuation' in kinds and (previous is None or 'movement' not in previous):
            return {'layout': layout, 'code': 'LINE', 'page': number, 'line': 0,
                    'detail': 'a continuation without a movement on the previous page'}
        previous = kinds
    return None


def main(args):
    """For measure_columns.mjs: each statement's stop (or null) and the rules
    it needs, read from items.py's items, or with --mupdf from the MuPDF
    model of G13 to G18."""
    import pymupdf
    global items
    if args and args[0] == '--mupdf':
        items, args = mupdf_items, args[1:]
    out = {}
    for path in args:
        used = Counter()
        stop = check_statement(pymupdf.open(path), used)
        out[path] = {'stop': stop, 'exercised': dict(sorted((k, v) for k, v in used.items() if v))}
    print(json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    main(sys.argv[1:])
