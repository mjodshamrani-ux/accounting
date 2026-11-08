"""Independent check of the reconciliation sheet (UX-6) in GL/TB and
clearing workpapers.

Reads each workpaper with zipfile and ElementTree only, with no product code,
and checks, against the evidence sheets as this checker reads them:

- the evidence is unchanged: every part of the evidence-only workpaper is in
  the delivered one byte for byte, but the four workbook-level parts and the
  time stamps of the document properties; one sheet part is added;
- the sheet is first, named in its language, the evidence sheets after it in
  their order; it holds its own strings, no shared string and no formula;
- the style sheet is whole: each list's count is its number of entries, each
  index a cell format uses stands in its list, the evidence's lists are a
  prefix of the new ones;
- each figure in the sheet equals what the evidence says: the scope, each
  source with its whole fingerprint (itself the SHA-256 of the original bytes
  the evidence holds), the count of components with no difference, the first
  difference with its sign and how many more, every balance at the
  currency's precision, and what is missing;
- every row carries something (the giving rule): a heading, a value, a
  fingerprint or a line to sign on; the sign-off lines are empty;
- in a clearing workpaper (UX-6(b)), read from its Movements, Cases,
  Membership, Source inventory and Decisions sheets: the scope and the
  source's fingerprint as its Summary gives them; the strip's counts of
  cleared and waiting groups, its main reason in the words the review table
  gives that reason, the account net; the valid, cleared and error counts;
  each group left for review with its members as postings, its reference,
  its net and its reason in words, one word a reason; and each recorded
  decision in order with its members and the reason the reviewer gave,
  one word an action, the reopen said as the group it left in review.

Which checks apply is read from the evidence's own Summary (Domain).

Usage: check_sheet.py FOLDER            check every case in FOLDER/cases.json
       check_sheet.py --self-test FOLDER  plant faults and require each found
       check_sheet.py --download LANG FILE...  a page download: the sheet and
                                          its figures, without an evidence copy
"""

import base64
import hashlib
import io
import json
import math
import re
import sys
import unicodedata
import zipfile
from decimal import Decimal
from pathlib import Path
import xml.etree.ElementTree as ET

M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
NS = {'s': M}
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
WORKBOOK_PARTS = {
    '[Content_Types].xml',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
}
NAMES = {'ar': 'ورقة التسوية', 'en': 'Reconciliation sheet'}
SCOPE = ['entity', 'ledger', 'account', 'dimensions', 'currency',
         'currencyBasis', 'postingStatus', 'postingLayer', 'start', 'end']
FIELDS = ['openingDebit', 'openingCredit', 'periodDebit', 'periodCredit',
          'closingDebit', 'closingCredit']
CODES = {'functional', 'posted', 'consistent', 'difference', 'inconsistent',
         'missing', 'source-error'}
HEX64 = re.compile(r'^[0-9a-f]{64}$')
# The evidence sheets the tables waiting for review and of recorded decisions
# stand in, as each workspace names them.
REVIEW_TABLES = ('Cases', 'Groups')
DECISION_TABLES = ('Decisions', 'Events')


class Fault(AssertionError):
    """A finding, named by its code."""


def need(condition, code, detail=''):
    if not condition:
        raise Fault(f'{code}: {detail}' if detail else code)


def column(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


class Book:
    """A workpaper as its parts say, read without the product."""

    def __init__(self, data):
        self.zip = zipfile.ZipFile(io.BytesIO(data))
        self.parts = {n: self.zip.read(n) for n in self.zip.namelist()
                      if not n.endswith('/')}
        self.strings = []
        if 'xl/sharedStrings.xml' in self.parts:
            root = ET.fromstring(self.parts['xl/sharedStrings.xml'])
            self.strings = [''.join(si.itertext())
                            for si in root.findall('s:si', NS)]
        rels = ET.fromstring(self.parts['xl/_rels/workbook.xml.rels'])
        target = {r.attrib['Id']: r.attrib['Target'] for r in rels}
        workbook = ET.fromstring(self.parts['xl/workbook.xml'])
        self.sheets = []
        for s in workbook.findall('s:sheets/s:sheet', NS):
            path = target[s.attrib[RID]].lstrip('/')
            if not path.startswith('xl/'):
                path = 'xl/' + path
            self.sheets.append((s.attrib['name'], path))
        self.styles = Styles(self.parts['xl/styles.xml'])

    @property
    def names(self):
        return [n for n, _ in self.sheets]

    def part(self, name):
        return dict(self.sheets)[name]

    def rows(self, name):
        """Rows of four or more cells: (kind, value, style) or None."""
        root = ET.fromstring(self.parts[self.part(name)])
        grid = {}
        for row in root.findall('s:sheetData/s:row', NS):
            r = int(row.attrib['r']) - 1
            for c in row.findall('s:c', NS):
                need(c.find('s:f', NS) is None, 'FORMULA', c.attrib['r'])
                t = c.get('t')
                style = int(c.get('s', '0'))
                v = c.find('s:v', NS)
                if t == 'inlineStr':
                    cell = ('text', ''.join(c.find('s:is', NS).itertext()))
                elif t == 's':
                    cell = ('shared', self.strings[int(v.text)])
                elif t in (None, 'n') and v is not None:
                    cell = ('number', Decimal(v.text))
                elif v is None and t is None:
                    cell = ('empty', None)
                else:
                    cell = (t, v.text if v is not None else None)
                grid.setdefault(r, {})[column(c.attrib['r'])] = (*cell, style)
        last = max(grid, default=-1)
        width = max([4] + [max(cols) + 1 for cols in grid.values()])
        return [[grid.get(r, {}).get(i) for i in range(width)]
                for r in range(last + 1)]

    def geometry(self, name):
        """Column widths, and each row's written height (0 if none)."""
        root = ET.fromstring(self.parts[self.part(name)])
        widths = {}
        for col in root.findall('s:cols/s:col', NS):
            for i in range(int(col.get('min')), int(col.get('max')) + 1):
                widths[i - 1] = float(col.get('width'))
        heights = {}
        for row in root.findall('s:sheetData/s:row', NS):
            if row.get('customHeight') in ('1', 'true'):
                heights[int(row.attrib['r']) - 1] = float(row.get('ht', '0'))
        return widths, heights

    def table(self, name):
        """An evidence sheet as text by header, as its own reader sees it."""
        out = []
        for row in self.rows(name):
            out.append(['' if c is None else
                        str(c[1]) if c[0] != 'number' else _plain(c[1])
                        for c in row])
        return out


def _plain(d):
    return str(int(d)) if d == d.to_integral_value() else str(d)


class Styles:
    LISTS = [('numFmts', 'numFmt'), ('fonts', 'font'), ('fills', 'fill'),
             ('borders', 'border'), ('cellXfs', 'xf')]

    def __init__(self, data):
        self.raw = data.decode()
        root = ET.fromstring(data)
        self.lists = {}
        for tag, child in self.LISTS:
            node = root.find(f's:{tag}', NS)
            if node is None:
                continue
            entries = node.findall(f's:{child}', NS)
            need(int(node.get('count', '-1')) == len(entries),
                 'STYLE_COUNT', tag)
            self.lists[tag] = entries
        formats = {int(f.get('numFmtId')) for f in self.lists.get('numFmts', [])}
        for i, xf in enumerate(self.lists['cellXfs']):
            for key, tag in [('fontId', 'fonts'), ('fillId', 'fills'),
                             ('borderId', 'borders')]:
                need(int(xf.get(key, '0')) < len(self.lists[tag]),
                     'STYLE_INDEX', f'xf {i} {key}')
            fmt = int(xf.get('numFmtId', '0'))
            need(fmt <= 49 or fmt in formats, 'STYLE_INDEX', f'xf {i} numFmt')

    def bold(self, style):
        font = self.lists['fonts'][int(self.lists['cellXfs'][style].get('fontId', '0'))]
        return font.find('s:b', NS) is not None

    def font(self, style):
        font = self.lists['fonts'][int(self.lists['cellXfs'][style].get('fontId', '0'))]
        size = font.find('s:sz', NS)
        name = font.find('s:name', NS)
        return (float(size.get('val')) if size is not None else 11.0,
                name.get('val') if name is not None else 'Calibri')

    def wraps(self, style):
        align = self.lists['cellXfs'][style].find('s:alignment', NS)
        return align is not None and align.get('wrapText') in ('1', 'true')

    def line(self, style):
        xf = self.lists['cellXfs'][style]
        border = self.lists['borders'][int(xf.get('borderId', '0'))]
        bottom = border.find('s:bottom', NS)
        return bottom is not None and bottom.get('style') is not None

    def body(self, tag):
        m = re.search(rf'<{tag}(?=[\s>])[^>]*>(.*?)</{tag}>', self.raw, re.S)
        return m.group(1) if m else ''


def stamp(data):
    return re.sub(rb'<dcterms:(created|modified)[^>]*>[^<]*<', b'<', data)


def check_evidence(evidence, book):
    added = sorted(set(book.parts) - set(evidence.parts))
    need(len(added) == 1 and re.match(r'xl/worksheets/sheet\d+\.xml$', added[0]),
         'PARTS', str(added))
    need(not set(evidence.parts) - set(book.parts), 'PARTS', 'a part removed')
    for name, data in evidence.parts.items():
        if name in WORKBOOK_PARTS:
            continue
        if name == 'docProps/core.xml':
            need(stamp(book.parts[name]) == stamp(data), 'EVIDENCE_CHANGED', name)
        else:
            need(book.parts[name] == data, 'EVIDENCE_CHANGED', name)
    for tag, _ in Styles.LISTS:
        need(book.styles.body(tag).startswith(evidence.styles.body(tag)),
             'STYLE_PREFIX', tag)
    return added[0]


def check_case(folder, case, lang):
    evidence = Book((folder / case['evidence']).read_bytes())
    book = Book((folder / case[lang]).read_bytes())
    part = check_evidence(evidence, book)
    need(book.names == [NAMES[lang]] + evidence.names, 'SHEET_ORDER',
         str(book.names))
    need(book.sheets[0][1] == part, 'SHEET_ORDER', 'the new part is first')
    workbook = book.parts['xl/workbook.xml'].decode()
    active = re.search(r'activeTab="(\d+)"', workbook)
    need(active is None or active.group(1) == '0', 'ACTIVE_TAB')
    for _, path in book.sheets:
        need(b'tabSelected="1"' not in book.parts[path], 'TAB_SELECTED', path)
    sheet_xml = book.parts[part].decode()
    need(' t="s"' not in sheet_xml, 'SHARED_STRING')
    need(('rightToLeft="1"' in sheet_xml) == (lang == 'ar'), 'DIRECTION')
    domain = {r[0]: r[1] for r in evidence.table('Summary')[1:]}.get('Domain')
    need(WORKSPACES[case['workspace']] == domain, 'MANIFEST', str(domain))
    return check_content(evidence, book, lang)


def check_content(evidence, book, lang):
    """The sheet's figures against the evidence, by the workspace the
    evidence names in its own Summary."""
    summary = {r[0]: r[1] for r in evidence.table('Summary')[1:]}
    profile = PROFILES.get(summary.get('Domain'))
    need(profile is not None, 'EVIDENCE_READ', f'domain {summary.get("Domain")}')
    return profile(evidence, book, lang, summary)


text = lambda c: c is not None and c[0] == 'text' and c[1] != ''
number = lambda c: c is not None and c[0] == 'number'
blank = lambda c: c is None or (c[0] == 'text' and c[1] == '') or c[0] == 'empty'


def shown(raw):
    """A stored text as a spreadsheet shows it (OOXML ST_Xstring)."""
    return re.sub(r'_x([0-9a-fA-F]{4})_', lambda m: chr(int(m.group(1), 16)), raw)


def text_units(text):
    """Characters counted by width: a wide one (CJK, an emoji, beyond the
    basic plane) two, a combining mark none, any other one."""
    n = 0
    for ch in text:
        if unicodedata.category(ch).startswith('M'):
            continue
        cp = ord(ch)
        n += 2 if (cp > 0xffff or 0x1100 <= cp <= 0x115f or
                   0x2e80 <= cp <= 0xa4cf or 0xac00 <= cp <= 0xd7a3 or
                   0xf900 <= cp <= 0xfaff or 0xff00 <= cp <= 0xff60) else 1
    return n


def lines_needed(text, capacity):
    count = 0
    for paragraph in text.split('\n'):
        count += 1
        line = 0
        for word in paragraph.split(' '):
            w = text_units(word)
            if line and line + 1 + w <= capacity:
                line += 1 + w
                continue
            if line:
                count += 1
            extra = max(0, math.ceil(w / capacity) - 1)
            count += extra
            line = w - extra * capacity
    return count


def check_nothing_cut(book, rows, styles):
    """No text is cut: one that cannot run on whole into the empty cells
    after it wraps in its own cell, on a row written tall enough for its
    lines. Estimated more leniently than the sheet writes it (a character
    nine tenths of a digit, a line 1.25 of the font's size), so only a text
    that cannot fit is a finding."""
    widths, heights = book.geometry(book.names[0])
    for r, row in enumerate(rows):
        for c, cell in enumerate(row):
            if not text(cell):
                continue
            room = widths.get(c, 0)
            k = c + 1
            while k < len(widths) and (k >= len(row) or blank(row[k])):
                room += widths.get(k, 0)
                k += 1
            size, family = styles.font(cell[2])
            scale = size / 11 * (6.4 / 7 * 11 / 8 if 'Courier' in family else 1) * 0.9
            said = shown(cell[1])
            if '\n' not in said and text_units(said) * scale <= room - 1:
                continue
            ref = f'row {r + 1} column {c + 1}'
            need(styles.wraps(cell[2]), 'CUT', f'{ref} runs past its room')
            capacity = max(1, math.floor(widths.get(c, 1) / scale) - 1)
            tall = lines_needed(said, capacity) * size * 1.25
            need(heights.get(r, 0) >= tall, 'CUT',
                 f'{ref} needs {tall:.0f} points, has {heights.get(r, 0)}')


def check_breaks(book, rows, sections):
    """A page broken by hand is broken above a section's heading, or above a
    later row of the table waiting for review that is not under its head,
    never inside what a heading names; a sheet short enough for one page is
    not broken at all (its own estimate: a row as tall as written, else 15
    points and the title 19.6, against 700 points, well inside a page); and
    no heading is left at a page's foot (check_pages)."""
    part = book.parts[book.sheets[0][1]].decode()
    _, heights = book.geometry(book.names[0])
    m = re.search(r'<rowBreaks count="(\d+)" manualBreakCount="(\d+)">'
                  r'(.*?)</rowBreaks>', part, re.S)
    ids = []
    if m:
        ids = [int(x) for x in re.findall(
            r'<brk id="(\d+)" max="16383" man="1"/>', m.group(3))]
        need(len(ids) == int(m.group(1)) == int(m.group(2)) ==
             m.group(3).count('<brk '), 'BREAK', 'count')
        need(ids == sorted(set(ids)), 'BREAK', 'order')
        tall = sum(heights.get(r) or (19.6 if r == 0 else 15)
                   for r in range(len(rows)))
        need(tall > 700, 'BREAK', f'a sheet of {tall:.0f} points is broken')
    else:
        need('<brk ' not in part and '<rowBreaks' not in part, 'BREAK',
             'a break outside its list')
    allowed = {s['at'] for s in sections}
    for s in sections:
        if s['evidence'] not in REVIEW_TABLES:
            continue
        for k, (i, row) in enumerate(s['rows']):
            above = s['rows'][k - 1][1] if k else None
            if k and text(row[0]) and not (
                    text(above[0]) and book.styles.bold(above[0][2])):
                allowed.add(i)
    for i in ids:
        need(i in allowed, 'BREAK', f'a page broken above row {i + 1}')
    check_pages(rows, sections, heights, set(ids))


def check_pages(rows, sections, heights, breaks):
    """No heading is left at a page's foot with what it names on the next:
    a section, or a table's heading with its head and first row (in the
    receivables, the first document with its movements), that clearly does
    not fit what is left of its page is broken above. Paged by the checker's
    own estimate (A4 at the sheet's margins as LibreOffice prints it: 748.5
    points of rows, a row as tall as written, else 15, the title 19.6). A
    finding is a heading that ends no more than 5 points past its page, so
    may still be printed on it, while its group runs more than 5 points past
    the page; a heading that ends further past goes to the next page with
    its group, and is not one. The 5 points stand for the estimate's error
    (LibreOffice draws a row set to a height about half a point shorter)."""
    page, margin = 748.5, 5
    tall = [heights.get(r) or (19.6 if r == 0 else 15) for r in range(len(rows))]
    groups = {}
    for s in sections:
        members = [i for i, _ in s['rows']]
        last = members[-1] if members else s['at']
        if s['evidence'] in REVIEW_TABLES + DECISION_TABLES and len(members) > 1:
            # Under a head, its first row; in a list of documents with no
            # head, the first document with its movements.
            if blank(rows[members[1]][0]):
                k = 1
                while k < len(members) and blank(rows[members[k]][0]):
                    k += 1
                last = members[k - 1]
            else:
                last = members[1]
        groups[s['at']] = last
    used = 0
    for r, h in enumerate(tall):
        if r in breaks:
            used = 0
        last = groups.get(r)
        if last is not None and used > 0:
            group = sum(tall[r:last + 1])
            need(not (used + tall[r] <= page + margin and
                      used + group > page + margin and group <= page),
                 'BREAK', f'the heading in row {r + 1} is left at the foot of a page')
        used = used + h if used + h <= page else h


def layout(book, evidence, lang, expected):
    """Title, then sections, each opened by a bold first cell with nothing in
    the second, naming the evidence sheet behind it; every row under a
    section carries something (the giving rule)."""
    rows = book.rows(book.names[0])
    styles = book.styles
    line = lambda c: c is not None and c[0] == 'empty' and styles.line(c[2])
    need(text(rows[0][0]) and rows[0][0][1] == NAMES[lang], 'TITLE')
    need(text(rows[1][0]), 'TITLE')
    sections, current = [], None
    for i, row in enumerate(rows[2:], 2):
        if all(blank(c) for c in row):
            continue
        if text(row[0]) and styles.bold(row[0][2]) and blank(row[1]):
            evidence_note = row[3][1] if text(row[3]) else None
            if evidence_note is not None:
                need(evidence_note in evidence.names, 'EVIDENCE_NOTE', evidence_note)
            current = {'at': i, 'evidence': evidence_note, 'rows': []}
            sections.append(current)
        else:
            need(current is not None, 'GIVING', f'row {i + 1} before a section')
            current['rows'].append((i, row))
    need([s['evidence'] for s in sections] == expected,
         'SECTIONS', str([s['evidence'] for s in sections]))
    check_nothing_cut(book, rows, styles)
    check_breaks(book, rows, sections)
    claim = sections[-1]
    for s in sections:
        for i, row in s['rows']:
            carries = any(text(c) or number(c) or line(c) for c in row[1:])
            need(carries or (s is claim and text(row[0])), 'GIVING',
                 f'row {i + 1} carries nothing')
    return rows, styles, line, sections


def check_sign_and_claim(sign, claim, line, lang, words):
    # Sign-off: who and when, left empty for people.
    need(len(sign['rows']) == 2, 'SIGN_OFF', 'two rows')
    for _, row in sign['rows']:
        need(text(row[0]) and line(row[1]) and text(row[2]) and line(row[3]),
             'SIGN_OFF', 'lines left empty')
    # The engine's claim, in English the evidence's own words.
    need(len(claim['rows']) == 1 and text(claim['rows'][0][1][0]), 'CLAIM')
    if lang == 'en':
        need(claim['rows'][0][1][0][1] == words, 'CLAIM', 'words')


def check_gl_tb(evidence, book, lang, summary):
    decimals = int(summary['Decimals'])
    unit = Decimal(10) ** decimals
    balances = {r[0]: r[1:4] for r in evidence.table('Balances')[1:]}
    need(list(balances) == FIELDS, 'EVIDENCE_READ', 'Balances')
    sources = {}
    for r in evidence.table('Sources')[1:]:
        s = sources.setdefault(r[0], {'name': r[2], 'hash': r[3], 'chunks': []})
        s['chunks'].append((int(r[5]), r[6]))
    for side, s in sources.items():
        data = base64.b64decode(''.join(c for _, c in sorted(s['chunks'])),
                                validate=True)
        need(hashlib.sha256(data).hexdigest() == s['hash'], 'EVIDENCE_READ',
             f'source {side} fingerprint')
    missing = json.loads(summary['Missing'])

    rows, styles, line, sections = layout(
        book, evidence, lang,
        ['Summary', 'Sources', None, 'Balances', None, 'Summary'])
    scope, srcs, strip, table, sign, claim = sections

    # Scope: the ten fields in the evidence's order, the fixed two in words.
    need(len(scope['rows']) == len(SCOPE), 'SCOPE', 'ten fields')
    for key, (i, row) in zip(SCOPE, scope['rows']):
        need(text(row[0]) and text(row[1]), 'SCOPE', key)
        if summary[key] in ('functional', 'posted'):
            need(row[1][1] not in CODES, 'RAW_CODE', key)
        else:
            need(row[1][1] == summary[key], 'SCOPE', key)

    # Sources: a role with its file, then the whole fingerprint.
    need(len(srcs['rows']) == 2 * len(sources), 'SOURCES', 'two rows a source')
    for n, side in enumerate(sorted(sources)):
        (_, named), (_, printed) = srcs['rows'][2 * n:2 * n + 2]
        need(text(named[1]) and named[1][1] == sources[side]['name'],
             'SOURCES', f'source {side} name')
        need(text(printed[1]) and HEX64.match(printed[1][1]) and
             printed[1][1] == sources[side]['hash'], 'FINGERPRINT',
             f'source {side}')

    # Alignment: what the screen's strip says, from the evidence.
    diffs = balances and [b[2] for b in balances.values()]
    computed = all(d != 'missing' for d in diffs)
    nonzero = [Decimal(d) for d in diffs if computed and d != '0']
    lines = strip['rows']
    agreed = lines[0][1]
    zeros = sum(1 for d in diffs if computed and d == '0')
    need(number(agreed[1]) and agreed[1][1] == zeros, 'AGREED_COUNT',
         f'{agreed[1]} != {zeros}')
    if computed:
        need(text(agreed[2]) and number(agreed[3]) and agreed[3][1] == len(FIELDS),
             'AGREED_COUNT', 'of six')
    else:
        need(blank(agreed[2]) and blank(agreed[3]), 'AGREED_COUNT', 'no of')
    unit_note = lines[1][1]
    need(blank(unit_note[0]) and text(unit_note[1]), 'STRIP', 'unit note')
    state = lines[2][1]
    need(text(state[0]) and text(state[1]) and state[1][1] not in CODES,
         'RAW_CODE', 'status')
    gap = lines[3][1]
    rest = lines[4:]
    if nonzero:
        need(number(gap[1]) and gap[1][1] == nonzero[0] / unit, 'GAP',
             f'{gap[1]} != {nonzero[0] / unit}')
        name_row = rest.pop(0)[1]
        need(text(name_row[1]) and text(name_row[2]), 'GAP', 'name and direction')
        if len(nonzero) > 1:
            more = rest.pop(0)[1]
            need(number(more[2]) and more[2][1] == len(nonzero) - 1, 'GAP',
                 'how many more')
    else:
        need(text(gap[1]), 'GAP', 'no figure without a difference')
        note = rest.pop(0)[1]
        need(text(note[1]), 'GAP', 'note')
        if computed:
            need(number(note[2]) and note[2][1] == len(FIELDS), 'GAP', 'compared')
    need(len(rest) == len(missing), 'MISSING', f'{len(rest)} != {len(missing)}')
    for _, row in rest:
        need(text(row[1]), 'MISSING', 'named')

    # Balances: a head, then each component as the evidence holds it.
    head = table['rows'][0][1]
    need(all(text(c) and styles.bold(c[2]) for c in head[:4]), 'BALANCES', 'head')
    need(len(table['rows']) == 1 + len(FIELDS), 'BALANCES', 'six components')
    for field, (_, row) in zip(FIELDS, table['rows'][1:]):
        need(text(row[0]), 'BALANCES', field)
        for c, value in zip(row[1:4], balances[field]):
            if value == 'missing':
                need(text(c), 'BALANCES', f'{field} missing')
            else:
                need(number(c) and c[1] == Decimal(value) / unit, 'BALANCE_VALUE',
                     f'{field}: {c} != {Decimal(value) / unit}')

    check_sign_and_claim(sign, claim, line, lang, summary['Claim'])

    # Every number in the sheet is one of those checked above.
    numbers = sum(1 for row in rows for c in row if number(c))
    expected = (1 + (1 if computed else 0) + (1 if nonzero else 0) +
                (1 if len(nonzero) > 1 else 0) + (1 if computed and not nonzero else 0) +
                sum(1 for b in balances.values() for v in b if v != 'missing'))
    need(numbers == expected, 'STRAY_NUMBER', f'{numbers} != {expected}')
    return {'status': summary['Status'], 'rows': len(rows)}


CLEARING_SCOPE = ['Entity (user declared)', 'Ledger (user declared)',
                  'Account', 'Currency', 'Start', 'End']
CLEARING_CODES = {'reference-zero', 'residual', 'unverified-reference-role',
                  'missing-reference', 'source-errors', 'group-limit',
                  'human-decision', 'reopened', 'clear', 'reopen', 'cleared',
                  'review', 'explicit-reference', 'none'}


def most_frequent(codes):
    """The code given most often, ties to the first in order."""
    counts = {}
    for c in codes:
        counts[c] = counts.get(c, 0) + 1
    best, most = None, 0
    for c, n in counts.items():
        if n > most:
            best, most = c, n
    return best


def words_of(pairs, code_name, codes=None):
    """One word for each code, a different word for each code, and no word
    that is an engine code."""
    codes = CLEARING_CODES if codes is None else codes
    word = {}
    for code, said in pairs:
        need(said not in codes, 'RAW_CODE', f'{code_name} {said}')
        need(word.setdefault(code, said) == said, code_name.upper(),
             f'{code} said two ways')
    need(len(set(word.values())) == len(word), code_name.upper(),
         'two codes said one way')
    return word


def check_clearing(evidence, book, lang, summary):
    decimals = int(summary['Decimals'])
    unit = Decimal(10) ** decimals
    head = lambda t: {name: i for i, name in enumerate(t[0])}
    movements = evidence.table('Movements')
    m = head(movements)
    posting = {r[m['ID']]: r[m['Posting ID']] for r in movements[1:]}
    total = sum(int(r[m['Amount minor units']]) for r in movements[1:])
    need(str(total) == summary['Total minor units'], 'EVIDENCE_READ', 'total')
    need(len(movements) - 1 == int(summary['Valid movement count']),
         'EVIDENCE_READ', 'valid count')
    cases = evidence.table('Cases')
    cases = [dict(zip(cases[0], r)) for r in cases[1:]]
    members = {}
    membership = evidence.table('Membership')
    for r in membership[1:]:
        members.setdefault(r[0], []).append(r[1])
    for c in cases:
        need(len(members.get(c['Case ID'], [])) == int(c['Member count']),
             'EVIDENCE_READ', f'members of {c["Case ID"]}')
    inventory = evidence.table('Source inventory')
    errors = sum(1 for r in inventory[1:] if r[1] == 'error')
    need(errors == int(summary['Error count']), 'EVIDENCE_READ', 'errors')
    cleared = [c for c in cases if c['Status'] == 'cleared']
    review = [c for c in cases if c['Status'] == 'review']
    need(len(cleared) + len(review) == len(cases), 'EVIDENCE_READ', 'statuses')
    need(sum(int(c['Member count']) for c in cleared) ==
         int(summary['Cleared movement count']), 'EVIDENCE_READ', 'cleared')
    decisions = evidence.table('Decisions')
    decisions = [dict(zip(decisions[0], r)) for r in decisions[1:]]
    said = lambda ids: ', '.join(posting[i] for i in ids)

    expected = (['Summary', 'Summary', None, 'Summary'] +
                (['Cases'] if review else []) +
                (['Decisions'] if decisions else []) + [None, 'Summary'])
    rows, styles, line, sections = layout(book, evidence, lang, expected)
    scope, srcs, strip, results = sections[:4]
    table = sections[4] if review else None
    taken = sections[4 + (1 if review else 0)] if decisions else None
    sign, claim = sections[-2:]

    # Scope: the six fields in the evidence's order.
    need(len(scope['rows']) == len(CLEARING_SCOPE), 'SCOPE', 'six fields')
    for key, (_, row) in zip(CLEARING_SCOPE, scope['rows']):
        need(text(row[0]) and text(row[1]) and row[1][1] == summary[key],
             'SCOPE', key)

    # The source: its file, then the whole fingerprint the evidence gives.
    need(len(srcs['rows']) == 2, 'SOURCES', 'one source')
    (_, named), (_, printed) = srcs['rows']
    need(text(named[1]) and named[1][1] == summary['Source name'],
         'SOURCES', 'name')
    need(text(printed[1]) and HEX64.match(printed[1][1]) and
         printed[1][1] == summary['Source SHA-256'], 'FINGERPRINT', 'source')

    # The review table first, so the strip's main reason can be read in
    # the words the table gives each reason.
    reason_word = {}
    if review:
        rows_ = table['rows']
        need(all(text(c) and styles.bold(c[2]) for c in rows_[0][1][:4]),
             'REVIEW', 'head')
        need(len(rows_) == 1 + len(review), 'REVIEW',
             f'{len(rows_) - 1} != {len(review)}')
        missing = set()
        pairs = []
        for c, (_, row) in zip(review, rows_[1:]):
            need(text(row[0]) and row[0][1] == said(members[c['Case ID']]),
                 'REVIEW_MEMBERS', c['Case ID'])
            if c['Clearing reference']:
                need(text(row[1]) and row[1][1] == c['Clearing reference'],
                     'REVIEW', f'{c["Case ID"]} reference')
            else:
                need(text(row[1]), 'REVIEW', f'{c["Case ID"]} no reference')
                missing.add(row[1][1])
            need(number(row[2]) and row[2][1] == Decimal(c['Net minor units']) / unit,
                 'REVIEW_NET', f'{c["Case ID"]}: {row[2]}')
            need(text(row[3]), 'REVIEW', f'{c["Case ID"]} reason')
            pairs.append((c['Reason'], row[3][1]))
        need(len(missing) <= 1, 'REVIEW', 'no reference said two ways')
        need(not missing & {c['Clearing reference'] for c in cases},
             'REVIEW', 'no reference said as a reference')
        reason_word = words_of(pairs, 'reason')

    # Alignment: what the screen's strip says, from the evidence.
    lines = [row for _, row in strip['rows']]
    agreed = lines.pop(0)
    need(number(agreed[1]) and agreed[1][1] == len(cleared), 'AGREED_COUNT',
         f'{agreed[1]} != {len(cleared)}')
    need(blank(agreed[2]) and blank(agreed[3]), 'AGREED_COUNT', 'no of')
    unit_note = lines.pop(0)
    need(blank(unit_note[0]) and text(unit_note[1]), 'STRIP', 'unit note')
    waiting = lines.pop(0)
    need(text(waiting[0]) and number(waiting[1]) and
         waiting[1][1] == len(review), 'REVIEW_COUNT',
         f'{waiting[1]} != {len(review)}')
    if review:
        main = lines.pop(0)
        top = most_frequent([c['Reason'] for c in review])
        need(blank(main[0]) and text(main[1]) and text(main[2]) and
             main[2][1] == reason_word[top], 'MAIN_REASON',
             f'{main[2]} is not the word for {top}')
    gap = lines.pop(0)
    if total:
        need(number(gap[1]) and gap[1][1] == Decimal(total) / unit, 'GAP',
             f'{gap[1]} != {Decimal(total) / unit}')
        name_row = lines.pop(0)
        need(text(name_row[1]) and text(name_row[2]), 'GAP', 'name and direction')
    else:
        need(text(gap[1]), 'GAP', 'no figure without a difference')
        note = lines.pop(0)
        need(text(note[1]) and number(note[2]) and note[2][1] == 1, 'GAP',
             'compared')
    need(not lines, 'STRIP', f'{len(lines)} rows more')

    # The figures beside the strip: valid, cleared, errors.
    need(len(results['rows']) == 3, 'RESULTS', 'three figures')
    for (_, row), value in zip(results['rows'],
                               [len(movements) - 1,
                                sum(int(c['Member count']) for c in cleared),
                                errors]):
        need(text(row[0]) and number(row[1]) and row[1][1] == value,
             'RESULTS', f'{row[0]}: {row[1]} != {value}')

    # Each recorded decision: what it did, its members, the reason given.
    if decisions:
        rows_ = taken['rows']
        need(all(text(c) and styles.bold(c[2]) for c in rows_[0][1][:3]),
             'DECISIONS', 'head')
        need(len(rows_) == 1 + len(decisions), 'DECISIONS',
             f'{len(rows_) - 1} != {len(decisions)}')
        pairs = []
        for e, (_, row) in zip(decisions, rows_[1:]):
            need(text(row[0]), 'DECISION_ACTION', e['Sequence'])
            pairs.append((e['Action'], row[0][1]))
            need(text(row[1]) and row[1][1] == said(e['Members'].split('\n')),
                 'DECISION_MEMBERS', e['Sequence'])
            need(text(row[2]) and row[2][1] == e['Note'], 'DECISION_REASON',
                 f'decision {e["Sequence"]} without its reason')
        action_word = words_of(pairs, 'decision_action')
        # A reopened group in review is said in the reopen's own words.
        if 'reopen' in action_word and 'reopened' in reason_word:
            need(action_word['reopen'] == reason_word['reopened'],
                 'DECISION_ACTION', 'reopen said apart from the group it left')

    check_sign_and_claim(sign, claim, line, lang, summary['Economic coverage'])

    # Every number in the sheet is one of those checked above.
    numbers = sum(1 for row in rows for c in row if number(c))
    expected = 3 + 3 + len(review)
    need(numbers == expected, 'STRAY_NUMBER', f'{numbers} != {expected}')
    status = ('source-errors' if errors else
              'review' if review else 'cleared')
    return {'status': status, 'rows': len(rows)}


AR_SCOPE = ['entity', 'ledger', 'customer', 'account', 'currency', 'start',
            'end']
AR_CODES = {'exact-own-document', 'source-errors', 'empty-source',
            'duplicate-document', 'missing-counterpart', 'amount-difference',
            'date-difference', 'related-conflict', 'unverified-document-role',
            'reopened', 'human-confirmation', 'accept', 'reopen', 'matched',
            'review', 'invoice', 'credit-note', 'receipt', 'scope',
            'own-document', 'none'}


def check_ar(evidence, book, lang, summary):
    """The customer AR sheet against its evidence: Movements, Cases,
    Membership, both inventories, Decisions and Sources."""
    decimals = int(summary['Decimals'])
    unit = Decimal(10) ** decimals
    rows_of = lambda name: [dict(zip(evidence.table(name)[0], r))
                            for r in evidence.table(name)[1:]]
    movements = {m['Movement ID']: m for m in rows_of('Movements')}
    need(len(movements) == int(summary['Valid movements']), 'EVIDENCE_READ',
         'valid')
    cases = rows_of('Cases')
    members = {}
    for m in rows_of('Membership'):
        members.setdefault(m['Case ID'], []).append(m['Movement ID'])
    for c in cases:
        need(len(members.get(c['Case ID'], [])) == int(c['Member count']),
             'EVIDENCE_READ', f'members of {c["Case ID"]}')
    errors = sum(1 for name in ('Ledger inventory', 'Statement inventory')
                 for r in rows_of(name) if r['Kind'] == 'error')
    need(errors == int(summary['Reading errors']), 'EVIDENCE_READ', 'errors')
    matched = [c for c in cases if c['Status'] == 'matched']
    review = [c for c in cases if c['Status'] == 'review']
    need(len(matched) + len(review) == len(cases), 'EVIDENCE_READ', 'statuses')
    need(len(matched) == int(summary['Matched document pairs']),
         'EVIDENCE_READ', 'matched')
    decisions = rows_of('Decisions')
    sources = {}
    for r in rows_of('Sources'):
        src = sources.setdefault(int(r['Side']), {
            'name': r['Source name'], 'hash': r['Source SHA-256'], 'chunks': []})
        src['chunks'].append((int(r['Chunk']), r['Original bytes base64']))
    for side, src in sources.items():
        data = base64.b64decode(''.join(c for _, c in sorted(src['chunks'])),
                                validate=True)
        need(hashlib.sha256(data).hexdigest() == src['hash'], 'EVIDENCE_READ',
             f'source {side} fingerprint')
    totals = [summary['Ledger total minor units'],
              summary['Statement total minor units']]
    owner = {mid: c for c in cases for mid in members.get(c['Case ID'], [])}

    expected = (['Summary', 'Sources', None, 'Summary'] +
                (['Cases'] if review else []) +
                (['Decisions'] if decisions else []) + [None, 'Summary'])
    rows, styles, line, sections = layout(book, evidence, lang, expected)
    scope, srcs, strip, results = sections[:4]
    table = sections[4] if review else None
    taken = sections[4 + (1 if review else 0)] if decisions else None
    sign, claim = sections[-2:]

    # Scope: the seven fields in the evidence's order.
    need(len(scope['rows']) == len(AR_SCOPE), 'SCOPE', 'seven fields')
    for key, (_, row) in zip(AR_SCOPE, scope['rows']):
        need(text(row[0]) and text(row[1]) and row[1][1] == summary[key],
             'SCOPE', key)

    # Sources: each record by its role, its file and its whole fingerprint,
    # itself the SHA-256 of the original bytes the evidence holds.
    need(len(srcs['rows']) == 4, 'SOURCES', 'two sources')
    side_word = {}
    for side in (0, 1):
        (_, named), (_, printed) = srcs['rows'][2 * side:2 * side + 2]
        need(text(named[0]) and text(named[1]) and
             named[1][1] == sources[side]['name'], 'SOURCES', f'side {side}')
        side_word[side] = named[0][1]
        need(text(printed[1]) and HEX64.match(printed[1][1]) and
             printed[1][1] == sources[side]['hash'], 'FINGERPRINT',
             f'side {side}')
    need(side_word[0] != side_word[1], 'SOURCES', 'two records one name')

    # The documents left for review, read first so the strip's main reason
    # can be read in the words they give.
    reason_word, kind_word = {}, {}
    if review:
        it = iter(table['rows'])
        reasons, kinds = [], []
        for c in review:
            _, head = next(it, (None, [None] * 4))
            need(text(head[0]) and text(head[2]),
                 'REVIEW', f'{c["Case ID"]} heading')
            # Its number as the evidence gives it; an item for the whole
            # scope has none, and the sheet writes none.
            need(text(head[1]) and head[1][1] == c['Own document number']
                 if c['Own document number'] else blank(head[1]), 'REVIEW',
                 f'{c["Case ID"]} document')
            kinds.append((c['Document type'], head[0][1]))
            reasons.append((c['Reason'], head[2][1]))
            for mid in members.get(c['Case ID'], []):
                m = movements[mid]
                _, row = next(it, (None, [None] * 4))
                need(blank(row[0]) and text(row[1]) and
                     row[1][1] == side_word[int(m['Side'])], 'REVIEW_MEMBERS',
                     f'{mid} record')
                need(number(row[2]) and
                     row[2][1] == Decimal(m['Amount minor units']) / unit,
                     'REVIEW_NET', f'{mid}: {row[2]}')
                need(text(row[3]) and row[3][1] == m['Posting date'],
                     'REVIEW_MEMBERS', f'{mid} date')
        need(next(it, None) is None, 'REVIEW', 'rows more than the documents')
        reason_word = words_of(reasons, 'reason', AR_CODES)
        kind_word = words_of(kinds, 'kind', AR_CODES)

    # Alignment: each record's own total, then the strip's three cells.
    lines = [row for _, row in strip['rows']]
    for side in (0, 1):
        total = lines.pop(0)
        need(text(total[0]) and total[0][1] == side_word[side], 'TOTAL',
             f'side {side} name')
        if totals[side] == '':
            need(text(total[1]), 'TOTAL', f'side {side}: no total, a reason')
        else:
            need(number(total[1]) and
                 total[1][1] == Decimal(totals[side]) / unit, 'TOTAL',
                 f'side {side}: {total[1]}')
    agreed = lines.pop(0)
    need(number(agreed[1]) and agreed[1][1] == len(matched), 'AGREED_COUNT',
         f'{agreed[1]} != {len(matched)}')
    unit_note = lines.pop(0)
    need(blank(unit_note[0]) and text(unit_note[1]), 'STRIP', 'unit note')
    waiting = lines.pop(0)
    need(text(waiting[0]) and number(waiting[1]) and
         waiting[1][1] == len(review), 'REVIEW_COUNT',
         f'{waiting[1]} != {len(review)}')
    if review:
        main = lines.pop(0)
        top = most_frequent([c['Reason'] for c in review])
        need(text(main[1]) and text(main[2]) and
             main[2][1] == reason_word[top], 'MAIN_REASON',
             f'{main[2]} is not the word for {top}')
    gap = lines.pop(0)
    need(text(gap[1]), 'GAP', 'not computed, said in words')
    note = lines.pop(0)
    need(text(note[1]), 'GAP', 'note')
    need(not lines, 'STRIP', f'{len(lines)} rows more')

    # The figures beside the strip: valid movements and reading errors.
    need(len(results['rows']) == 2, 'RESULTS', 'two figures')
    for (_, row), value in zip(results['rows'], [len(movements), errors]):
        need(text(row[0]) and number(row[1]) and row[1][1] == value,
             'RESULTS', f'{row[0]}: {row[1]} != {value}')

    # Each recorded decision: what it did, its document, the reason given.
    if decisions:
        rows_ = taken['rows']
        need(all(text(c) and styles.bold(c[2]) for c in rows_[0][1][:4]),
             'DECISIONS', 'head')
        need(len(rows_) == 1 + len(decisions), 'DECISIONS',
             f'{len(rows_) - 1} != {len(decisions)}')
        pairs, kinds = [], []
        for e, (_, row) in zip(decisions, rows_[1:]):
            target = owner[json.loads(e['Members JSON'])[0]]
            need(text(row[0]), 'DECISION_ACTION', e['Sequence'])
            pairs.append((e['Action'], row[0][1]))
            need(text(row[1]) and text(row[2]) and
                 row[2][1] == target['Own document number'],
                 'DECISION_MEMBERS', e['Sequence'])
            kinds.append((target['Document type'], row[1][1]))
            need(text(row[3]) and row[3][1] == e['Note'], 'DECISION_REASON',
                 f'decision {e["Sequence"]} without its reason')
        action_word = words_of(pairs, 'decision_action', AR_CODES)
        for code, said in kinds:
            need(kind_word.setdefault(code, said) == said, 'KIND',
                 f'{code} said two ways')
        if 'reopen' in action_word and 'reopened' in reason_word:
            need(action_word['reopen'] == reason_word['reopened'],
                 'DECISION_ACTION', 'reopen said apart from the document it left')

    check_sign_and_claim(sign, claim, line, lang, summary['Economic coverage'])

    numbers = sum(1 for row in rows for c in row if number(c))
    expected = (sum(1 for t in totals if t != '') + 2 + 2 +
                sum(len(members.get(c['Case ID'], [])) for c in review))
    need(numbers == expected, 'STRAY_NUMBER', f'{numbers} != {expected}')
    status = 'source-errors' if errors else 'review' if review else 'matched'
    return {'status': status, 'rows': len(rows)}


BANK_SCOPE = ['entity', 'ledger', 'account', 'currency', 'start', 'end']
BANK_CODES = {'explicit-identity', 'human-review', 'undone', 'source-error',
              'missing-identity', 'missing-counterpart', 'member-limit',
              'policy-members', 'reversal-origin-conflict',
              'incomplete-reversal', 'amount-difference', 'timing-review',
              'reference', 'missing', 'human', 'accept', 'undo',
              'matched-evidence', 'matched-manual', 'needs-review'}


def check_bank(evidence, book, lang, summary):
    """The bank movements sheet against its evidence: Movements, Groups,
    Group members, Events, Event members and Sources."""
    decimals = int(summary['Decimals'])
    unit = Decimal(10) ** decimals
    rows_of = lambda name: [dict(zip(evidence.table(name)[0], r))
                            for r in evidence.table(name)[1:]]
    movements = {m['ID']: m for m in rows_of('Movements')}
    signed = next(k for k in evidence.table('Movements')[0]
                  if k in ('Signed minor units', 'Calculated signed minor units'))
    groups = rows_of('Groups')
    members = {}
    for m in rows_of('Group members'):
        members.setdefault(m['Case ID'], []).append((int(m['Side']), m['Member ID']))
    events = rows_of('Events')
    taken_by = {}
    for m in rows_of('Event members'):
        taken_by.setdefault(m['Decision'], []).append((int(m['Side']), m['Member ID']))
    need(all(mid in movements for c in members.values() for _, mid in c) and
         all(mid in movements for e in taken_by.values() for _, mid in e),
         'EVIDENCE_READ', 'members are movements')
    sources = {}
    for r in rows_of('Sources'):
        src = sources.setdefault(int(r['Side']), {
            'name': r['Name'], 'hash': r['SHA256'], 'chunks': []})
        src['chunks'].append((int(r['Chunk index']), r['Base64']))
    for side, src in sources.items():
        data = base64.b64decode(''.join(c for _, c in sorted(src['chunks'])),
                                validate=True)
        need(hashlib.sha256(data).hexdigest() == src['hash'], 'EVIDENCE_READ',
             f'source {side} fingerprint')
    need(sorted(sources) == [0, 1], 'EVIDENCE_READ', 'two sources')
    matched = [g for g in groups
               if g['Status'] in ('matched-evidence', 'matched-manual')]
    waiting = [g for g in groups
               if g['Status'] in ('needs-review', 'source-error')]
    need(len(matched) + len(waiting) == len(groups), 'EVIDENCE_READ', 'statuses')
    reference = lambda mid: movements[mid]['Own reference']

    expected = (['Summary', 'Sources', None] +
                (['Groups'] if waiting else []) +
                (['Events'] if events else []) + [None, 'Summary'])
    rows, styles, line, sections = layout(book, evidence, lang, expected)
    scope, srcs, strip = sections[:3]
    table = sections[3] if waiting else None
    taken = sections[3 + (1 if waiting else 0)] if events else None
    sign, claim = sections[-2:]

    # Scope: the six fields in the evidence's order.
    need(len(scope['rows']) == len(BANK_SCOPE), 'SCOPE', 'six fields')
    for key, (_, row) in zip(BANK_SCOPE, scope['rows']):
        need(text(row[0]) and text(row[1]) and row[1][1] == summary[key],
             'SCOPE', key)

    # Sources: the statement and the cashbook by their roles, each file and
    # its whole fingerprint, itself the SHA-256 of the original bytes.
    need(len(srcs['rows']) == 4, 'SOURCES', 'two sources')
    side_word = {}
    for side in (0, 1):
        (_, named), (_, printed) = srcs['rows'][2 * side:2 * side + 2]
        need(text(named[0]) and text(named[1]) and
             named[1][1] == sources[side]['name'], 'SOURCES', f'side {side}')
        side_word[side] = named[0][1]
        need(text(printed[1]) and HEX64.match(printed[1][1]) and
             printed[1][1] == sources[side]['hash'], 'FINGERPRINT',
             f'side {side}')
    need(side_word[0] != side_word[1], 'SOURCES', 'two records one name')

    # The cases left for review, read first so the strip's main reason can
    # be read in the words they give: each one's kind, its identity where it
    # has one, its reason, the difference the engine computed, then each
    # complete member with its side, signed amount and own reference.
    reason_word, labels = {}, set()
    if waiting:
        it = iter(table['rows'])
        reasons, kinds = [], []
        for g in waiting:
            _, head = next(it, (None, [None] * 4))
            need(text(head[0]) and text(head[2]), 'REVIEW',
                 f'{g["Case ID"]} heading')
            need(text(head[1]) and head[1][1] == g['Source identity']
                 if g['Kind'] == 'reference' else blank(head[1]), 'REVIEW',
                 f'{g["Case ID"]} identity')
            kinds.append((g['Kind'], head[0][1]))
            reasons.append((g['Reason'], head[2][1]))
            _, gap = next(it, (None, [None] * 4))
            need(blank(gap[0]) and text(gap[1]) and number(gap[2]) and
                 gap[2][1] == Decimal(g['Difference minor units']) / unit,
                 'REVIEW_NET', f'{g["Case ID"]}: {gap[2]}')
            labels.add(gap[1][1])
            for side, mid in members.get(g['Case ID'], []):
                m = movements[mid]
                _, row = next(it, (None, [None] * 4))
                need(blank(row[0]) and text(row[1]) and
                     row[1][1] == side_word[side] and int(m['Side']) == side,
                     'REVIEW_MEMBERS', f'{mid} side')
                need(number(row[2]) and
                     row[2][1] == Decimal(m[signed]) / unit,
                     'REVIEW_NET', f'{mid}: {row[2]}')
                need(text(row[3]) and row[3][1] == m['Own reference'],
                     'REVIEW_MEMBERS', f'{mid} reference')
        need(next(it, None) is None, 'REVIEW', 'rows more than the cases')
        need(len(labels) == 1, 'REVIEW', 'the difference said two ways')
        reason_word = words_of(reasons, 'reason', BANK_CODES)
        words_of(kinds, 'kind', BANK_CODES)

    # Alignment: the strip's three cells; no total at either end.
    lines = [row for _, row in strip['rows']]
    agreed = lines.pop(0)
    need(number(agreed[1]) and agreed[1][1] == len(matched), 'AGREED_COUNT',
         f'{agreed[1]} != {len(matched)}')
    unit_note = lines.pop(0)
    need(blank(unit_note[0]) and text(unit_note[1]), 'STRIP', 'unit note')
    review = lines.pop(0)
    need(text(review[0]) and number(review[1]) and
         review[1][1] == len(waiting), 'REVIEW_COUNT',
         f'{review[1]} != {len(waiting)}')
    if waiting:
        main = lines.pop(0)
        top = most_frequent([g['Reason'] for g in waiting])
        need(text(main[1]) and text(main[2]) and
             main[2][1] == reason_word[top], 'MAIN_REASON',
             f'{main[2]} is not the word for {top}')
    gap = lines.pop(0)
    need(text(gap[1]), 'GAP', 'not computed, said in words')
    note = lines.pop(0)
    need(text(note[1]), 'GAP', 'note')
    need(not lines, 'STRIP', f'{len(lines)} rows more')

    # Each recorded decision: what it did, its members by their own
    # references, the evidence reference and the reason given.
    if events:
        rows_ = taken['rows']
        need(all(text(c) and styles.bold(c[2]) for c in rows_[0][1][:4]),
             'DECISIONS', 'head')
        need(len(rows_) == 1 + len(events), 'DECISIONS',
             f'{len(rows_) - 1} != {len(events)}')
        pairs = []
        for e, (_, row) in zip(events, rows_[1:]):
            need(text(row[0]), 'DECISION_ACTION', e['Index'])
            pairs.append((e['Type'], row[0][1]))
            taken_ids = taken_by.get(e['Decision'], [])
            said = ' · '.join(reference(mid) for side, mid in taken_ids
                              if side == 0) + ' · ' + ' · '.join(
                reference(mid) for side, mid in taken_ids if side == 1)
            need(text(row[1]) and row[1][1] == said, 'DECISION_MEMBERS',
                 e['Index'])
            need(text(row[2]) and row[2][1] == e['Evidence reference'],
                 'DECISION_REFERENCE', e['Index'])
            need(text(row[3]) and row[3][1] == e['Reason'], 'DECISION_REASON',
                 f'decision {e["Index"]} without its reason')
        action_word = words_of(pairs, 'decision_action', BANK_CODES)
        if 'undo' in action_word and 'undone' in reason_word:
            need(action_word['undo'] == reason_word['undone'],
                 'DECISION_ACTION', 'an undo said apart from the case it left')

    check_sign_and_claim(sign, claim, line, lang, summary['Claim'])

    numbers = sum(1 for row in rows for c in row if number(c))
    expected = 2 + sum(1 + len(members.get(g['Case ID'], [])) for g in waiting)
    need(numbers == expected, 'STRAY_NUMBER', f'{numbers} != {expected}')
    status = ('source-errors' if summary['Status'] == 'source-error' else
              'review' if waiting else 'matched')
    return {'status': status, 'rows': len(rows)}


PROFILES = {'gl-trial-balance-consistency': check_gl_tb,
            'single-account-clearing': check_clearing,
            'customer-ar-document-comparison': check_ar,
            'bank-cash-movements': check_bank}
WORKSPACES = {'gl-tb': 'gl-trial-balance-consistency',
              'clearing': 'single-account-clearing',
              'ar': 'customer-ar-document-comparison',
              'bank': 'bank-cash-movements'}


def verify(folder):
    manifest = json.loads((folder / 'cases.json').read_text())
    need(manifest['syntheticOnly'] is True, 'MANIFEST')
    report = []
    for case in manifest['cases']:
        need(case['workspace'] in WORKSPACES, 'MANIFEST', case['workspace'])
        for lang in ('ar', 'en'):
            report.append({'workspace': case['workspace'], 'case': case['case'],
                           'lang': lang, **check_case(folder, case, lang)})
    return report


# Planted faults: each changes one thing in a good workpaper and must be
# found with its code. GL/TB has no decisions; a decision without its reason
# is planted in a clearing workpaper.
def _first_sheet(data):
    book = Book(data)
    return book.sheets[0][1]


def _edit(data, part, change):
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as zin, \
            zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            body = zin.read(info.filename)
            if info.filename == part:
                changed = change(body.decode())
                assert changed != body.decode(), f'plant did not apply to {part}'
                body = changed.encode()
            zout.writestr(info, body)
    return out.getvalue()


def _cell(xml, label):
    """The row number of the row whose first cell says label."""
    m = re.search(r'<row r="(\d+)"[^>]*><c r="A\d+"[^>]*><is><t[^>]*>'
                  + re.escape(label) + '</t>', xml)
    assert m, label
    return int(m.group(1))


def _row(xml, n):
    return re.search(rf'<row r="{n}"[^>]*>.*?</row>', xml).group(0)


def _dangle(styles):
    """The last cell format points at a font the list does not hold."""
    start, end = styles.index('<cellXfs'), styles.index('</cellXfs>')
    block = styles[start:end]
    at = block.rindex('fontId="') + len('fontId="')
    block = block[:at] + '99' + block[block.index('"', at):]
    return styles[:start] + block + styles[end:]


def plants(data):
    sheet = _first_sheet(data)

    def in_sheet(change):
        return _edit(data, sheet, change)

    def row_edit(label, offset, change):
        def go(x):
            n = _cell(x, label) + offset
            old = _row(x, n)
            return x.replace(old, change(old), 1)
        return in_sheet(go)

    yield 'flipped sign', 'GAP', row_edit(
        'الفجوة', 0, lambda r: re.sub(r'<v>-', '<v>', r, count=1))
    yield 'count reduced', 'AGREED_COUNT', row_edit(
        'تراصف', 0, lambda r: re.sub(r'<v>(\d+)</v>',
                                     lambda m: f'<v>{int(m.group(1)) - 1}</v>',
                                     r, count=1))
    yield 'fingerprint cut', 'FINGERPRINT', in_sheet(
        lambda x: re.sub(r'>([0-9a-f]{63})[0-9a-f]<', r'>\1<', x, count=1))
    yield 'row carries nothing', 'GIVING', row_edit(
        'الكيان', 0, lambda r: re.sub(r'<c r="B\d+"[^>]*>.*?</c>', '', r))
    yield 'balance changed', 'BALANCE_VALUE', row_edit(
        'مدين الفترة', 0, lambda r: re.sub(
            r'(<c r="C\d+"[^>]*><v>)(\d+)', lambda m: f'{m.group(1)}{int(m.group(2)) + 1}', r, count=1))
    yield 'shared string', 'SHARED_STRING', in_sheet(
        lambda x: x.replace('t="inlineStr"', 't="s"', 1).replace(
            '<is><t xml:space="preserve">ورقة التسوية</t></is>', '<v>0</v>', 1))
    yield 'formula', 'FORMULA', row_edit(
        'الافتتاح المدين', 0, lambda r: r.replace('<v>', '<f>1+1</f><v>', 1))
    yield 'sign-off filled', 'SIGN_OFF', row_edit(
        'أعدّه', 0, lambda r: re.sub(
            r'<c r="(B\d+)" s="(\d+)"/>',
            r'<c r="\1" s="\2" t="inlineStr"><is><t>Someone</t></is></c>', r, count=1))
    yield 'stray number', 'STRAY_NUMBER', row_edit(
        'الكيان', 0, lambda r: r.replace('</row>', '<c r="D{}"><v>7</v></c></row>'.format(
            re.search(r'<row r="(\d+)"', r).group(1))))
    yield 'dangling font', 'STYLE_INDEX', _edit(data, 'xl/styles.xml', _dangle)
    yield 'evidence changed', 'EVIDENCE_CHANGED', _edit(
        data, 'xl/worksheets/sheet1.xml', lambda x: x.replace('</sheetData>', '<row r="999"/></sheetData>'))
    yield 'break in a sheet that fits', 'BREAK', in_sheet(
        lambda x: x.replace('</worksheet>', '<rowBreaks count="1" manualBreakCount="1">'
                            '<brk id="12" max="16383" man="1"/></rowBreaks></worksheet>'))
    yield 'sheet not first', 'SHEET_ORDER', _edit(
        data, 'xl/workbook.xml', lambda x: re.sub(
            r'<sheets>(<sheet [^>]*/>)(<sheet [^>]*/>)', r'<sheets>\2\1', x))


def clearing_plants(data):
    """Faults a clearing workpaper can carry: in its review table, its
    recorded decisions, the strip's main reason and the figures beside it."""
    sheet = _first_sheet(data)

    def row_edit(label, offset, change):
        def go(x):
            n = _cell(x, label) + offset
            old = _row(x, n)
            return x.replace(old, change(old), 1)
        return _edit(data, sheet, go)

    clear = 'أعضاء متعادلة بقرار بشري مسجل'
    reopen = 'أُلغي الاعتماد وبقيت المجموعة للمراجعة'
    residual = 'حزمة المرجع غير متعادلة؛ لا اختيار لجزء منها'
    yield 'break under a table head', 'BREAK', _edit(data, sheet, lambda x: x.replace(
        '</worksheet>', '<rowBreaks count="1" manualBreakCount="1"><brk id="{}" max="16383"'
        ' man="1"/></rowBreaks></worksheet>'.format(_cell(x, 'القرار'))))
    yield 'decision without its reason', 'DECISION_REASON', row_edit(
        clear, 0, lambda r: re.sub(r'<c r="C\d+"[^>]*>.*?</c>', '', r))
    yield 'decision said as the other', 'DECISION_ACTION', row_edit(
        clear, 0, lambda r: r.replace(clear, reopen, 1))
    yield 'decision members changed', 'DECISION_MEMBERS', row_edit(
        clear, 0, lambda r: r.replace('P006, P007', 'P006, P008', 1))
    yield 'review net changed', 'REVIEW_NET', row_edit(
        'P008, P009', 0, lambda r: re.sub(
            r'(<c r="C\d+"[^>]*><v>)(\d+)',
            lambda m: f'{m.group(1)}{int(m.group(2)) + 1}', r, count=1))
    yield 'review members changed', 'REVIEW_MEMBERS', row_edit(
        'P008, P009', 0, lambda r: r.replace('P008, P009', 'P009, P008', 1))
    yield 'reason as its code', 'RAW_CODE', row_edit(
        'P008, P009', 0, lambda r: r.replace(residual, 'residual', 1))
    yield 'review case dropped', 'REVIEW', _edit(data, sheet, lambda x: x.replace(
        _row(x, _cell(x, 'P008, P009')), '', 1))
    yield 'main reason another', 'MAIN_REASON', row_edit(
        'ينتظر قرارك', 1, lambda r: r.replace(residual, reopen, 1))
    yield 'cleared count changed', 'RESULTS', row_edit(
        'حركات مسوّاة', 0, lambda r: re.sub(
            r'<v>(\d+)</v>', lambda m: f'<v>{int(m.group(1)) + 1}</v>', r, count=1))
    yield 'waiting count changed', 'REVIEW_COUNT', row_edit(
        'ينتظر قرارك', 0, lambda r: re.sub(
            r'<v>(\d+)</v>', lambda m: f'<v>{int(m.group(1)) + 1}</v>', r, count=1))
    yield 'reason cut short', 'CUT', row_edit(
        'P008, P009', 0, lambda r: re.sub(r' ht="[^"]*" customHeight="1"', '', r))
    yield 'reason unwrapped', 'CUT', row_edit(
        'P008, P009', 0, lambda r: re.sub(
            r'(<c r="D\d+" t="inlineStr" s=")\d+(")',
            lambda m: m.group(1) + re.search(
                r'<c r="B\d+" t="inlineStr" s="(\d+)"', r).group(1) + m.group(2),
            r, count=1))
    yield 'gap sign flipped', 'GAP', row_edit(
        'الفجوة', 0, lambda r: re.sub(r'<v>(\d)', r'<v>-\1', r, count=1))


def ar_plants(data):
    """Faults a customer AR workpaper can carry: in the documents left for
    review and their movements, each record's total and its decisions."""
    sheet = _first_sheet(data)

    def row_edit(label, offset, change):
        def go(x):
            n = _cell(x, label) + offset
            old = _row(x, n)
            return x.replace(old, change(old), 1)
        return _edit(data, sheet, go)

    reopened = 'أُلغي الاعتماد وبقي زوج المستندات للمراجعة'
    ledger, statement = 'سجل ذمم العملاء', 'كشف العميل الصادر عن الشركة'
    yield 'decision without its reason', 'DECISION_REASON', row_edit(
        reopened, 0, lambda r: re.sub(r'<c r="D\d+"[^>]*>.*?</c>', '', r))
    yield 'decision on another document', 'DECISION_MEMBERS', row_edit(
        reopened, 0, lambda r: r.replace('>I001<', '>I002<', 1))
    yield 'movement amount changed', 'REVIEW_NET', row_edit(
        'فاتورة', 1, lambda r: re.sub(
            r'(<c r="C\d+"[^>]*><v>)(\d+)',
            lambda m: f'{m.group(1)}{int(m.group(2)) + 1}', r, count=1))
    yield 'movement from the other record', 'REVIEW_MEMBERS', row_edit(
        'فاتورة', 2, lambda r: r.replace(statement, ledger, 1))
    yield 'record total changed', 'TOTAL', row_edit(
        'التراصف', 1, lambda r: re.sub(
            r'<v>(\d+)</v>', lambda m: f'<v>{int(m.group(1)) + 1}</v>', r, count=1))
    yield 'break inside a section', 'BREAK', _edit(data, sheet, lambda x: re.sub(
        r'<brk id="(\d+)"', lambda m: f'<brk id="{int(m.group(1)) + 1}"', x, count=1))
    yield 'type as its code', 'RAW_CODE', row_edit(
        'فاتورة', 0, lambda r: r.replace('فاتورة', 'invoice', 1))


def bank_plants(data):
    """Faults a bank movements workpaper can carry: in the case left for
    review, its difference and members, and in its decisions."""
    sheet = _first_sheet(data)

    def row_edit(label, offset, change):
        def go(x):
            n = _cell(x, label) + offset
            old = _row(x, n)
            return x.replace(old, change(old), 1)
        return _edit(data, sheet, go)

    plus = lambda r: re.sub(r'(<c r="C\d+"[^>]*><v>)(-?\d+)',
                            lambda m: f'{m.group(1)}{int(m.group(2)) + 1}',
                            r, count=1)
    case, accept, undone = 'هوية تسوية صريحة', 'مراجعة بشرية موثقة', 'ألغيت؛ تحتاج مراجعة'
    yield 'decision without its reason', 'DECISION_REASON', row_edit(
        accept, 0, lambda r: re.sub(r'<c r="D\d+"[^>]*>.*?</c>', '', r))
    yield 'undo said as the approval', 'DECISION_ACTION', row_edit(
        undone, 0, lambda r: r.replace(undone, accept, 1))
    yield 'decision members changed', 'DECISION_MEMBERS', row_edit(
        accept, 0, lambda r: r.replace('B1 · L1', 'L1 · B1', 1))
    yield 'evidence reference changed', 'DECISION_REFERENCE', row_edit(
        accept, 0, lambda r: r.replace('Synthetic reviewed evidence',
                                       'Synthetic other evidence', 1))
    yield 'difference changed', 'REVIEW_NET', row_edit(case, 1, plus)
    yield 'member amount changed', 'REVIEW_NET', row_edit(case, 3, plus)
    yield 'member from the other side', 'REVIEW_MEMBERS', row_edit(
        case, 2, lambda r: r.replace('كشف البنك', 'دفتر النقدية', 1))
    yield 'settlement identity changed', 'REVIEW', row_edit(
        case, 0, lambda r: r.replace('>S1<', '>S9<', 1))
    yield 'reason as its code', 'RAW_CODE', row_edit(
        case, 0, lambda r: r.replace(undone, 'undone', 1))


def page_plants(data):
    """A sheet that needs its break, printed without it: its heading would
    end about a point past its page by the checker's estimate, which only
    the 5 points it allows for the estimate's error still count as on it."""
    yield 'break dropped', 'BREAK', _edit(data, _first_sheet(data), lambda x: re.sub(
        r'<rowBreaks .*?</rowBreaks>', '', x, flags=re.S))


def _self_test_one(folder, case, generic):
    good = (folder / case['ar']).read_bytes()
    target = folder / 'self-test-ar.xlsx'
    one = {**case, 'ar': target.name}
    found = []
    try:
        target.write_bytes(good)
        check_case(folder, one, 'ar')
        for name, code, data in generic(good):
            target.write_bytes(data)
            try:
                check_case(folder, one, 'ar')
            except Fault as fault:
                need(str(fault).startswith(code), 'SELF_TEST',
                     f'{name}: found {fault}, expected {code}')
                found.append({'workspace': case['workspace'], 'plant': name,
                              'code': str(fault).split(':')[0]})
                continue
            raise Fault(f'SELF_TEST: {case["workspace"]} {name} was not found')
    finally:
        target.unlink(missing_ok=True)
    return found


def self_test(folder):
    manifest = json.loads((folder / 'cases.json').read_text())
    pick = lambda name: next(c for c in manifest['cases'] if c['case'] == name)
    found = _self_test_one(folder, pick('same-net-different-turnover'), plants)
    found += _self_test_one(folder, pick('clearing-reopened'), clearing_plants)
    found += _self_test_one(folder, pick('ar-reopened'), ar_plants)
    found += _self_test_one(folder, pick('ar-unreadable'), page_plants)
    found += _self_test_one(folder, pick('bank-timing-after-cutoff'), bank_plants)
    return found


def check_download(path, lang):
    """A workpaper downloaded from the page, with no evidence-only copy
    beside it: the sheet's place, its parts and every figure against the
    evidence sheets in the same workbook."""
    book = Book(Path(path).read_bytes())
    need(book.names[0] == NAMES[lang], 'SHEET_ORDER', str(book.names[:2]))
    need(book.names[1] == 'Summary', 'SHEET_ORDER', 'evidence after the sheet')
    part = book.parts[book.sheets[0][1]].decode()
    need(' t="s"' not in part, 'SHARED_STRING')
    need(('rightToLeft="1"' in part) == (lang == 'ar'), 'DIRECTION')
    return check_content(book, book, lang)


if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] == '--download':
        lang, files = args[1], args[2:]
        need(lang in NAMES and files, 'USAGE')
        report = [check_download(f, lang) for f in files]
        print(json.dumps({'passed': True, 'downloads': len(report),
                          'statuses': sorted({r['status'] for r in report})}))
    elif args and args[0] == '--self-test':
        found = self_test(Path(args[1]))
        print(json.dumps({'passed': True, 'plants': found}, ensure_ascii=False,
                         indent=1))
    else:
        report = verify(Path(args[0]))
        print(json.dumps({'passed': True, 'workpapers': len(report),
                          'statuses': sorted({r['status'] for r in report})},
                         indent=1))
