"""Independent check of the reconciliation sheet (UX-6) in GL/TB, clearing,
customer AR, bank movement, payment allocation and supplier workpapers.

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
  one word an action, the reopen said as the group it left in review;
- in a payment allocation workpaper (UX-6(b)), read from its Value ledger,
  Active links, Events and Sources sheets: the ledger held to the active
  links; the scope and the three sources; the links decided and the state
  in words; each side's ledger under its source's name, every item with what
  is available, allocated and remaining; each active allocation with its
  basis, reference and reason, then its payment and invoice with the
  amount; each dated decision with its number, time, the decision an undo
  undoes and the reason the reviewer gave;
- in a supplier workpaper (UX-6(b)), read from its Summary, Run Settings,
  Export Metadata, Match Evidence, transaction sheets, Needs Review,
  Unmatched, Reconciliation Bridge, Diagnostics and Review History, its
  counts and bridge held to its case sheets and balances first: the scope
  fields its Summary writes; each source's file and fingerprint as Export
  Metadata writes it (it holds no original bytes to hash); the cases
  aligned, waiting and alone, and the closing difference; both closings,
  the balance check in words as the engine's comparability gives it, and
  the bridge's four figures; each case the review tab lists with its state
  in words and every member with its side, signed amount and reference;
  each unmatched case with its date, side, amount and reference; each
  decision with its members and the reason the reviewer gave, one word an
  action and one a state across the run, the undone match said as the case
  it leaves.

Which checks apply is read from the evidence's own Summary (Domain); the
supplier workbook names none, and is known by its own evidence sheets.

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
# The supplier's tables: the cases the review tab lists, those the unmatched
# tab lists, and its decisions.
SUPPLIER_TABLES = ('Needs Review', 'Unmatched', 'Review History')
# Every table whose heading goes with its head and first row (with no head,
# its first item), the rest running on: those above, in allocation the value
# ledger of each side and the active allocations, and the supplier's.
TABLES = (REVIEW_TABLES + DECISION_TABLES + ('Value ledger', 'Active links') +
          SUPPLIER_TABLES)
# Tables a page may be broken above a later item of, an item that is not the
# first under its head: a case or document with its members, an active
# allocation with its two sides, a decision, an unmatched case.
ITEM_TABLES = REVIEW_TABLES + ('Active links', 'Events') + SUPPLIER_TABLES


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

    def rows(self, name, formulas=False):
        """Rows of four or more cells: (kind, value, style) or None. A cell
        with a formula is refused unless formulas are allowed, as in an
        evidence sheet, where the value its writer stored is read."""
        root = ET.fromstring(self.parts[self.part(name)])
        grid = {}
        for row in root.findall('s:sheetData/s:row', NS):
            r = int(row.attrib['r']) - 1
            for c in row.findall('s:c', NS):
                need(formulas or c.find('s:f', NS) is None, 'FORMULA',
                     c.attrib['r'])
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
        for row in self.rows(name, formulas=True):
            out.append(['' if c is None or c[0] == 'empty' else
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
    domain = domain_of(evidence)
    need(WORKSPACES[case['workspace']] == domain, 'MANIFEST', str(domain))
    return check_content(evidence, book, lang)


def check_content(evidence, book, lang):
    """The sheet's figures against the evidence, by the workspace the
    evidence names in its own Summary."""
    summary = {r[0]: r[1] for r in evidence.table('Summary')[1:]}
    domain = domain_of(evidence)
    profile = PROFILES.get(domain)
    need(profile is not None, 'EVIDENCE_READ', f'domain {domain}')
    return profile(evidence, book, lang, summary)


# The supplier workbook names no domain in its Summary; it is known by its
# own evidence sheets and its Summary's Workbook Mode.
SUPPLIER_SHEETS = {'Summary', 'Matches', 'Needs Review', 'Unmatched',
                   'Reconciliation Bridge', 'Review Sign-off', 'Match Evidence',
                   'Review History', 'Run Settings', 'Export Metadata',
                   'Supplier transactions', 'Ledger transactions', 'Diagnostics'}


def domain_of(evidence):
    summary = {r[0]: r[1] for r in evidence.table('Summary')[1:]}
    if 'Domain' in summary:
        return summary['Domain']
    if SUPPLIER_SHEETS <= set(evidence.names) and 'Workbook Mode' in summary:
        return 'supplier-statement-comparison'
    return None


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
    later item of a table of items (ITEM_TABLES) that is not under its head,
    never inside what a heading names or inside an item; a sheet short enough for one page is
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
        if s['evidence'] not in ITEM_TABLES:
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
        if s['evidence'] in TABLES and len(members) > 1:
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


ALLOCATION_SCOPE = ['entity', 'ledger', 'party', 'account', 'currency',
                    'cutoff', 'basis']
ALLOCATION_CODES = {'ready', 'source-error', 'allocate', 'undo', 'remittance',
                    'external-confirmation', 'accountant-review'}
# The screen's English words for these are the engine's codes themselves
# («allocate», «undo», «remittance»), so in English they are words.
ALLOCATION_ENGLISH = {'allocate', 'undo', 'remittance'}


def check_allocation(evidence, book, lang, summary):
    """The payment allocation sheet against its evidence: Value ledger,
    Active links, Events and Sources. The ledger is checked against the
    active links as well: what each item has allocated is the sum of the
    active links on it, and what remains is what is available less that."""
    decimals = int(summary['Decimals'])
    unit = Decimal(10) ** decimals
    rows_of = lambda name: [dict(zip(evidence.table(name)[0], r))
                            for r in evidence.table(name)[1:]]
    ledger = rows_of('Value ledger')
    items = {i['ID']: i for i in ledger}
    links = rows_of('Active links')
    events = rows_of('Events')
    need(all(l['Payment ID'] in items and items[l['Payment ID']]['Side'] == '0'
             and l['Invoice ID'] in items and items[l['Invoice ID']]['Side'] == '1'
             for l in links), 'EVIDENCE_READ', 'links join a payment and an invoice')
    for i in ledger:
        taken = sum(int(l['Amount minor units']) for l in links
                    if i['ID'] in (l['Payment ID'], l['Invoice ID']))
        need(int(i['Allocated minor units']) == taken and
             int(i['Remaining minor units']) ==
             int(i['Available minor units']) - taken, 'EVIDENCE_READ',
             f'{i["ID"]} allocated and remaining')
    active = {e['ID'] for e in events if e['Active'] == 'true'}
    need({l['Decision'] for l in links} <= active, 'EVIDENCE_READ',
         'active links of active decisions')
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
    need(sorted(sources) == [0, 1, 2], 'EVIDENCE_READ', 'three sources')
    codes = ALLOCATION_CODES - (ALLOCATION_ENGLISH if lang == 'en' else set())
    by_side = {side: [i for i in ledger if i['Side'] == str(side)]
               for side in (0, 1)}

    expected = (['Summary', 'Sources', None] +
                ['Value ledger' for side in (0, 1) if by_side[side]] +
                (['Active links'] if links else []) +
                (['Events'] if events else []) + [None, 'Summary'])
    rows, styles, line, sections = layout(book, evidence, lang, expected)
    scope, srcs, strip = sections[:3]
    rest = sections[3:-2]
    tables = {side: rest.pop(0) for side in (0, 1) if by_side[side]}
    active_table = rest.pop(0) if links else None
    taken = rest.pop(0) if events else None
    sign, claim = sections[-2:]

    # Scope: the seven fields in the evidence's order.
    need(len(scope['rows']) == len(ALLOCATION_SCOPE), 'SCOPE', 'seven fields')
    for key, (_, row) in zip(ALLOCATION_SCOPE, scope['rows']):
        need(text(row[0]) and text(row[1]) and row[1][1] == summary[key],
             'SCOPE', key)

    # Sources: the payments, the invoices and the remittance by their roles,
    # each file and its whole fingerprint, the SHA-256 of the original bytes.
    need(len(srcs['rows']) == 6, 'SOURCES', 'three sources')
    side_word = {}
    for side in (0, 1, 2):
        (_, named), (_, printed) = srcs['rows'][2 * side:2 * side + 2]
        need(text(named[0]) and text(named[1]) and
             named[1][1] == sources[side]['name'], 'SOURCES', f'side {side}')
        side_word[side] = named[0][1]
        need(text(printed[1]) and HEX64.match(printed[1][1]) and
             printed[1][1] == sources[side]['hash'], 'FINGERPRINT',
             f'side {side}')
    need(len(set(side_word.values())) == 3, 'SOURCES', 'two records one name')

    # Alignment: the links decided, the result's state in words, the gap not
    # computed; no total at either end.
    lines = [row for _, row in strip['rows']]
    agreed = lines.pop(0)
    need(number(agreed[1]) and agreed[1][1] == len(links), 'AGREED_COUNT',
         f'{agreed[1]} != {len(links)}')
    unit_note = lines.pop(0)
    need(blank(unit_note[0]) and text(unit_note[1]), 'STRIP', 'unit note')
    state = lines.pop(0)
    need(text(state[0]) and text(state[1]) and not number(state[1]),
         'REVIEW_COUNT', 'the state in words')
    words_of([(summary['Status'], state[1][1])], 'state', codes)
    gap = lines.pop(0)
    need(text(gap[1]), 'GAP', 'not computed, said in words')
    note = lines.pop(0)
    need(text(note[1]), 'GAP', 'note')
    need(not lines, 'STRIP', f'{len(lines)} rows more')

    # The value ledger of each side, under its side's name: every item by its
    # own reference, what is available, allocated and remaining.
    for side, table in tables.items():
        need(rows[table['at']][0][1] == side_word[side], 'LEDGER',
             f'side {side} named {rows[table["at"]][0][1]}')
        head, *body = table['rows']
        need(all(text(c) and styles.bold(c[2]) for c in head[1][:4]),
             'LEDGER', 'head')
        need(len(body) == len(by_side[side]), 'LEDGER',
             f'side {side}: {len(body)} != {len(by_side[side])}')
        for i, (_, row) in zip(by_side[side], body):
            need(text(row[0]) and row[0][1] == i['Own reference'], 'LEDGER',
                 f'{i["ID"]} reference')
            for c, key in zip((1, 2, 3), ('Available minor units',
                                          'Allocated minor units',
                                          'Remaining minor units')):
                need(number(row[c]) and
                     row[c][1] == Decimal(i[key]) / unit, 'LEDGER',
                     f'{i["ID"]} {key}: {row[c]}')

    # Each active allocation: its basis, the basis's reference and reason,
    # then the payment and the invoice it joins, each with the amount.
    if links:
        it = iter(active_table['rows'])
        bases = []
        for l in links:
            _, head = next(it, (None, [None] * 4))
            need(text(head[0]), 'LINK', f'{l["Decision"]}:{l["Index"]} basis')
            bases.append((l['Basis'], head[0][1]))
            need(text(head[1]) and head[1][1] == l['Basis reference'],
                 'LINK_REFERENCE', f'{l["Decision"]}:{l["Index"]}')
            need(text(head[2]) and head[2][1] == l['Reason'], 'LINK_REASON',
                 f'allocation {l["Decision"]}:{l["Index"]} without its reason')
            for side, key in ((0, 'Payment ID'), (1, 'Invoice ID')):
                _, row = next(it, (None, [None] * 4))
                need(blank(row[0]) and text(row[1]) and
                     row[1][1] == side_word[side], 'LINK_MEMBERS',
                     f'{l[key]} side')
                need(number(row[2]) and
                     row[2][1] == Decimal(l['Amount minor units']) / unit,
                     'LINK_AMOUNT', f'{l[key]}: {row[2]}')
                need(text(row[3]) and
                     row[3][1] == items[l[key]]['Own reference'],
                     'LINK_MEMBERS', f'{l[key]} reference')
        need(next(it, None) is None, 'LINK', 'rows more than the allocations')
        words_of(bases, 'basis', codes)

    # Each dated decision: what it did, its number and time, then the reason
    # given, an undo pointing to the decision it undoes.
    if events:
        it = iter(taken['rows'])
        actions = []
        for e in events:
            _, head = next(it, (None, [None] * 4))
            need(text(head[0]), 'DECISION_ACTION', e['ID'])
            actions.append((e['Type'], head[0][1]))
            need(text(head[1]) and head[1][1] == e['ID'], 'DECISION_NUMBER',
                 e['ID'])
            need(text(head[2]) and head[2][1] == e['UTC device time'],
                 'DECISION_TIME', e['ID'])
            _, said = next(it, (None, [None] * 4))
            need(blank(said[0]), 'DECISION_TARGET', e['ID'])
            need(text(said[1]) and said[1][1] == f'→ {e["Undo target"]}'
                 if e['Type'] == 'undo' else blank(said[1]),
                 'DECISION_TARGET', e['ID'])
            need(text(said[2]) and said[2][1] == e['Note'], 'DECISION_REASON',
                 f'decision {e["ID"]} without its reason')
        need(next(it, None) is None, 'DECISIONS', 'rows more than the decisions')
        words_of(actions, 'decision_action', codes)

    check_sign_and_claim(sign, claim, line, lang, summary['Claim'])

    numbers = sum(1 for row in rows for c in row if number(c))
    expected = 1 + 3 * len(ledger) + 2 * len(links)
    need(numbers == expected, 'STRAY_NUMBER', f'{numbers} != {expected}')
    status = ('source-errors' if summary['Status'] == 'source-error' else
              'allocated' if links else 'unallocated')
    return {'status': status, 'rows': len(rows)}


SUPPLIER_SCOPE = ['Supplier', 'Entity', 'AP Control Account', 'Currency',
                  'Cut-off Date']
SUPPLIER_CODES = {'Matched', 'Needs Review', 'Unmatched', 'Rejected',
                  'EXACT_1_TO_1', 'EXACT_1_TO_MANY', 'EXACT_MANY_TO_1',
                  'EXACT_MANY_TO_MANY', 'AMOUNT_VARIANCE', 'PAYMENT_CANDIDATE',
                  'SUPPLIER_ONLY', 'LEDGER_ONLY', 'REJECTED_CANDIDATE',
                  'AMBIGUOUS_CANDIDATE', 'supplier', 'ledger', 'link',
                  'unlink', 'review', 'compare', 'PERIOD_COVERAGE_CONFIRMED',
                  'PERIOD_COVERAGE_UNCONFIRMED'}
# The screen's English word for a case that needs review is the engine's
# status itself («Needs Review»), so in English it is a word.
SUPPLIER_ENGLISH = {'Needs Review'}
NO_ORIGINAL = 'No original file'
# Words a run has seen, by language and kind: each code said one way, and two
# codes never said the same way, across every workpaper the run reads.
WORDS_SEEN = {}


def seen_words(lang, kind, pairs):
    word = WORDS_SEEN.setdefault((lang, kind), {})
    for code, said in pairs:
        need(word.setdefault(code, said) == said, kind.upper(),
             f'{code} said two ways in the run')
    need(len(set(word.values())) == len(word), kind.upper(),
         'two codes said one way in the run')


def excel_date(serial):
    """A date cell's stored serial (1900 system) as the result writes it."""
    import datetime
    day = datetime.date(1899, 12, 30) + datetime.timedelta(
        days=int(Decimal(serial)))
    return day.isoformat()


def check_supplier(evidence, book, lang, summary):
    """The supplier sheet against its evidence: Summary, Export Metadata and
    Run Settings for the scope and sources, Match Evidence and the two
    transaction sheets for each case's members, Needs Review and Unmatched for
    the cases each tab lists, Reconciliation Bridge and Diagnostics for the
    balances, Review History for the decisions. The evidence is held to
    itself first: its counts to its case sheets, its bridge to its balances.
    The fingerprints are the evidence's own (Export Metadata); this workbook
    holds no original bytes to hash."""
    rows_of = lambda name: [dict(zip(evidence.table(name)[0], r))
                            for r in evidence.table(name)[1:]]
    pairs_of = lambda name: {r[0]: r[1] for r in evidence.table(name)[1:]}
    settings = pairs_of('Run Settings')
    metadata = pairs_of('Export Metadata')
    scope_json = json.loads(settings['Scope'])
    unit = Decimal(10) ** int(scope_json['decimals'])
    tx = {}
    for name, side in (('Supplier transactions', 'supplier'),
                       ('Ledger transactions', 'ledger')):
        for r in rows_of(name):
            tx[r['المعرف']] = {'side': side, 'reference': r['المرجع الأصلي'],
                               'amount': Decimal(r['المبلغ الموحد'])}
    members = {}
    for r in rows_of('Match Evidence'):
        members.setdefault(r['Case ID'], []).append(r)
    for case_id, ms in members.items():
        for m in ms:
            need(m['Source Row ID'] in tx and
                 tx[m['Source Row ID']]['side'] == m['Side'] and
                 Decimal(m['Amount']) == tx[m['Source Row ID']]['amount'],
                 'EVIDENCE_READ', f'{case_id} member {m["Source Row ID"]}')
    waiting = rows_of('Needs Review')
    unmatched = rows_of('Unmatched')
    matched = rows_of('Matches')
    count = lambda key: int(Decimal(summary[key]))
    need(count('Auto Matched Cases') + count('Manual Matches') == len(matched),
         'EVIDENCE_READ', 'matched cases')
    need(count('Needs Review Cases') ==
         sum(1 for c in waiting if c['Status'] == 'Needs Review'),
         'EVIDENCE_READ', 'cases that need review')
    need(count('Unmatched Cases') == len(unmatched), 'EVIDENCE_READ',
         'unmatched cases')
    need(all(c['Case ID'] in members for c in waiting + unmatched),
         'EVIDENCE_READ', 'every listed case has its members')
    bridged = summary['Bridge Status'].startswith('Arithmetic bridge available')
    confirmed = (summary['Coverage Confirmation Status'] ==
                 'PERIOD_COVERAGE_CONFIRMED')
    money = lambda key: None if summary[key] == '' else Decimal(summary[key])
    closing = (money('Supplier Closing Balance'),
               money('Ledger Closing Balance'))
    opening = next((Decimal(r[4]) for r in evidence.table(
        'Reconciliation Bridge')[1:] if r[0] == 'OPENING_DIFFERENCE'),
        Decimal(0))
    if bridged:
        delta = money('Closing Difference')
        need(delta == closing[0] - closing[1], 'EVIDENCE_READ',
             'closing difference')
        item = money('Net Bridge Adjustments') - opening
        adjusted, residual = money('Adjusted Supplier Balance'), money('Residual')
        need(adjusted == closing[0] + opening + item and
             residual == adjusted - closing[1], 'EVIDENCE_READ', 'bridge')
    # Comparable as the engine defines it: a bridge, coverage confirmed, and
    # no exclusion the engine names as unproven for the balances.
    unproven = any(r[0] == 'EXCLUDED_MOVEMENT_MEMBERSHIP' and
                   'لم يُثبت اكتمال تسوية الأرصدة' in r[1]
                   for r in evidence.table('Diagnostics')[1:])
    balance_code = ('not-proven' if not bridged else
                    'confirmed' if confirmed and not unproven else
                    'unconfirmed')
    shown = confirmed or bridged
    decisions = [r for r in rows_of('Review History') if r['Action'] != 'compare']
    codes = SUPPLIER_CODES - (SUPPLIER_ENGLISH if lang == 'en' else set())

    expected = (['Summary', 'Export Metadata', None] +
                (['Reconciliation Bridge'] if shown else []) +
                (['Needs Review'] if waiting else []) +
                (['Unmatched'] if unmatched else []) +
                (['Review History'] if decisions else []) + [None, 'Summary'])
    rows, styles, line, sections = layout(book, evidence, lang, expected)
    scope, srcs, strip = sections[:3]
    rest = sections[3:-2]
    balances = rest.pop(0) if shown else None
    review_table = rest.pop(0) if waiting else None
    alone_table = rest.pop(0) if unmatched else None
    taken = rest.pop(0) if decisions else None
    sign, claim = sections[-2:]

    # Scope: each field the evidence's Summary writes, in its order; an empty
    # one is not written.
    fields = [(key, excel_date(summary[key]) if key == 'Cut-off Date'
               else summary[key]) for key in SUPPLIER_SCOPE if summary[key]]
    need(len(scope['rows']) == len(fields), 'SCOPE',
         f'{len(scope["rows"])} != {len(fields)} fields')
    for (key, value), (_, row) in zip(fields, scope['rows']):
        need(text(row[0]) and text(row[1]) and row[1][1] == value, 'SCOPE', key)
    need(len({row[0][1] for _, row in scope['rows']}) == len(fields), 'SCOPE',
         'two fields one name')

    # Sources: the statement and the ledger by their roles, each file and its
    # whole fingerprint as the evidence writes it, or the word for none.
    need(len(srcs['rows']) == 4, 'SOURCES', 'two sources')
    side_role = {}
    for side, label in enumerate(('Supplier', 'Ledger')):
        (_, named), (_, printed) = srcs['rows'][2 * side:2 * side + 2]
        need(text(named[0]) and text(named[1]) and
             named[1][1] == settings[f'{label} filename'], 'SOURCES', label)
        side_role[side] = named[0][1]
        fingerprint = metadata[f'{label} SHA-256']
        if fingerprint == NO_ORIGINAL:
            need(text(printed[1]) and not HEX64.match(printed[1][1]) and
                 (lang == 'ar' or printed[1][1] == NO_ORIGINAL),
                 'FINGERPRINT', f'{label}: no original file')
        else:
            need(text(printed[1]) and HEX64.match(printed[1][1]) and
                 printed[1][1] == fingerprint, 'FINGERPRINT', label)
    need(side_role[0] != side_role[1], 'SOURCES', 'two records one name')

    # Alignment: the cases aligned, those waiting with those alone beside
    # them, and the closing difference where the engine computed it.
    lines = [row for _, row in strip['rows']]
    agreed = lines.pop(0)
    need(number(agreed[1]) and agreed[1][1] ==
         count('Auto Matched Cases') + count('Manual Matches'), 'AGREED_COUNT',
         f'{agreed[1]}')
    unit_note = lines.pop(0)
    need(blank(unit_note[0]) and text(unit_note[1]), 'STRIP', 'unit note')
    waits = lines.pop(0)
    need(number(waits[1]) and waits[1][1] == count('Needs Review Cases'),
         'REVIEW_COUNT', f'{waits[1]}')
    alone = lines.pop(0)
    need(blank(alone[0]) and text(alone[1]) and number(alone[2]) and
         alone[2][1] == count('Unmatched Cases'), 'ALONE_COUNT', f'{alone[2]}')
    gap = lines.pop(0)
    note = lines.pop(0)
    numbers_expected = 3
    if bridged and delta != 0:
        need(number(gap[1]) and gap[1][1] == delta / 1, 'GAP', f'{gap[1]}')
        need(text(note[1]) and text(note[2]), 'GAP', 'what and between')
        numbers_expected += 1
    elif bridged:
        need(text(gap[1]) and number(note[2]) and note[2][1] == 1, 'GAP',
             'no difference, one compared')
        numbers_expected += 1
    else:
        need(text(gap[1]) and text(note[1]) and not number(note[2]), 'GAP',
             'not computed')
    need(not lines, 'STRIP', f'{len(lines)} rows more')

    # The balances as the workpaper step writes them: both closings, the
    # balance check in words, then the bridge's four figures.
    if shown:
        lines = [row for _, row in balances['rows']]
        for side in (0, 1):
            row = lines.pop(0)
            if closing[side] is None:
                need(text(row[1]) and not number(row[1]), 'BALANCE',
                     f'closing {side} not available')
            else:
                need(number(row[1]) and row[1][1] == closing[side], 'BALANCE',
                     f'closing {side}: {row[1]}')
                numbers_expected += 1
        said = lines.pop(0)
        need(text(said[0]) and text(said[1]) and not number(said[1]),
             'BALANCE_CHECK', 'in words')
        need(said[1][1] not in codes, 'RAW_CODE', said[1][1])
        seen_words(lang, 'balance_check', [(balance_code, said[1][1])])
        if bridged:
            for figure in (opening, item, adjusted, residual):
                row = lines.pop(0)
                need(number(row[1]) and row[1][1] == figure, 'BALANCE',
                     f'{row[0]}: {row[1]} != {figure}')
            numbers_expected += 4
        need(not lines, 'BALANCE', f'{len(lines)} rows more')

    reference_word = []

    def reference(row_id, cell, code):
        known = tx.get(row_id)
        if known is None:
            need(text(cell) and cell[1] == row_id, code, row_id)
        elif known['reference']:
            need(text(cell) and cell[1] == known['reference'], code, row_id)
        else:
            need(text(cell), code, f'{row_id} without its reference word')
            reference_word.append(('none', cell[1]))

    sides = []
    states = []
    # Each case the review tab lists: its state on its first member, then
    # every member with its side, signed amount and reference.
    if waiting:
        it = iter(review_table['rows'])
        for c in waiting:
            state = ('amountVariance' if c['Classification'] == 'AMOUNT_VARIANCE'
                     else 'paymentCandidate'
                     if c['Classification'] == 'PAYMENT_CANDIDATE'
                     else 'rejected' if c['Status'] == 'Rejected'
                     else 'needsReview')
            for k, m in enumerate(members[c['Case ID']]):
                _, row = next(it, (None, [None] * 4))
                if k == 0:
                    need(text(row[0]), 'CASE_STATE', c['Case ID'])
                    states.append((state, row[0][1]))
                else:
                    need(blank(row[0]), 'CASE_STATE', f'{c["Case ID"]} member')
                need(text(row[1]), 'MEMBER_SIDE', m['Source Row ID'])
                sides.append((m['Side'], row[1][1]))
                need(number(row[2]) and row[2][1] == Decimal(m['Amount']),
                     'MEMBER_AMOUNT', f'{m["Source Row ID"]}: {row[2]}')
                reference(m['Source Row ID'], row[3], 'MEMBER_REFERENCE')
                numbers_expected += 1
        need(next(it, None) is None, 'CASE_STATE', 'rows more than the members')

    # Each case the unmatched tab lists, one row: its first member's date,
    # side and reference, with the case's amount.
    if unmatched:
        it = iter(alone_table['rows'])
        for c in unmatched:
            first = members[c['Case ID']][0]
            need(first['Side'] == c['Side'], 'EVIDENCE_READ', c['Case ID'])
            _, row = next(it, (None, [None] * 4))
            need(text(row[0]) and row[0][1] == excel_date(c['Date']),
                 'UNMATCHED_DATE', c['Case ID'])
            need(text(row[1]), 'MEMBER_SIDE', c['Case ID'])
            sides.append((c['Side'], row[1][1]))
            need(number(row[2]) and row[2][1] == Decimal(c['Amount']),
                 'UNMATCHED_AMOUNT', f'{c["Case ID"]}: {row[2]}')
            reference(first['Source Row ID'], row[3], 'UNMATCHED_REFERENCE')
            numbers_expected += 1
        need(next(it, None) is None, 'UNMATCHED', 'rows more than the cases')

    # Each decision in its order: what it left in words, its members by
    # their references, the reason as the reviewer wrote it.
    actions = []
    if decisions:
        head, *body = taken['rows']
        need(all(text(c) and styles.bold(c[2]) for c in head[1][:3]),
             'DECISIONS', 'head')
        need(len(body) == len(decisions), 'DECISIONS',
             f'{len(body)} != {len(decisions)}')
        for e, (_, row) in zip(decisions, body):
            need(text(row[0]), 'DECISION_ACTION', e['Action'])
            actions.append((e['Action'], row[0][1]))
            ids = e['Source Row IDs'].split(' | ') if e['Source Row IDs'] else []
            named = [tx[i]['reference'] if i in tx and tx[i]['reference']
                     else None if i in tx else i for i in ids]
            if None in named:
                need(text(row[1]), 'DECISION_MEMBERS', e['Source Row IDs'])
            else:
                need(text(row[1]) and row[1][1] == ' · '.join(named),
                     'DECISION_MEMBERS', e['Source Row IDs'])
            need(text(row[2]) and row[2][1] == e['User Reason']
                 if e['User Reason'] else blank(row[2]), 'DECISION_REASON',
                 f'decision {e["Action"]} without its reason')

    words = {
        'member_side': words_of(sides, 'member_side', codes) if sides else {},
        'case_state': words_of(states, 'case_state', codes) if states else {},
        'decision_action': (words_of(actions, 'decision_action', codes)
                            if actions else {}),
        'no_reference': words_of(reference_word, 'member_reference', codes)
        if reference_word else {},
    }
    if sides:
        need(set(words['member_side'].values()).isdisjoint(
            side_role.values()), 'MEMBER_SIDE', 'a source role for a side')
    for kind, word in words.items():
        seen_words(lang, kind, word.items())
    if 'unlink' in words['decision_action'] and 'rejected' in words['case_state']:
        need(words['decision_action']['unlink'] == words['case_state']['rejected'],
             'DECISION_ACTION', 'an undone match said unlike the case it leaves')

    check_sign_and_claim(sign, claim, line, lang, summary['Workbook Mode'])

    numbers = sum(1 for row in rows for c in row if number(c))
    need(numbers == numbers_expected, 'STRAY_NUMBER',
         f'{numbers} != {numbers_expected}')
    partial = summary['Workbook Mode'].startswith('Partial')
    status = ('partial' if partial else
              'bridged' if bridged else 'transactions-only')
    return {'status': status, 'rows': len(rows)}


PROFILES = {'gl-trial-balance-consistency': check_gl_tb,
            'single-account-clearing': check_clearing,
            'customer-ar-document-comparison': check_ar,
            'bank-cash-movements': check_bank,
            'payment-allocation': check_allocation,
            'supplier-statement-comparison': check_supplier}
WORKSPACES = {'gl-tb': 'gl-trial-balance-consistency',
              'clearing': 'single-account-clearing',
              'ar': 'customer-ar-document-comparison',
              'bank': 'bank-cash-movements',
              'allocation': 'payment-allocation',
              'supplier': 'supplier-statement-comparison'}


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


def allocation_plants(data):
    """Faults a payment allocation workpaper can carry: in its value ledger,
    its active allocations with their basis, and its dated decisions."""
    sheet = _first_sheet(data)

    def row_edit(label, offset, change):
        def go(x):
            n = _cell(x, label) + offset
            old = _row(x, n)
            return x.replace(old, change(old), 1)
        return _edit(data, sheet, go)

    plus = lambda col: lambda r: re.sub(
        rf'(<c r="{col}\d+"[^>]*><v>)(-?\d+)',
        lambda m: f'{m.group(1)}{int(m.group(2)) + 1}', r, count=1)
    drop = lambda col: lambda r: re.sub(rf'<c r="{col}\d+"[^>]*>.*?</c>', '', r)
    basis, allocate, undo = 'إشعار تخصيص', 'تخصيص', 'إلغاء'
    yield 'decision without its reason', 'DECISION_REASON', row_edit(
        undo, 1, drop('C'))
    yield 'undo said as the allocation', 'DECISION_ACTION', row_edit(
        undo, 0, lambda r: r.replace(f'>{undo}<', f'>{allocate}<', 1))
    yield 'undo of another decision', 'DECISION_TARGET', row_edit(
        undo, 1, lambda r: r.replace('→ D1', '→ D2', 1))
    yield 'decision time changed', 'DECISION_TIME', row_edit(
        undo, 0, lambda r: r.replace('T18:00', 'T19:00', 1))
    yield 'allocation without its reason', 'LINK_REASON', row_edit(
        basis, 0, drop('C'))
    yield 'allocation reference changed', 'LINK_REFERENCE', row_edit(
        basis, 0, lambda r: r.replace('>R1<', '>R2<', 1))
    yield 'allocation amount changed', 'LINK_AMOUNT', row_edit(
        basis, 1, plus('C'))
    yield 'invoice said as a payment', 'LINK_MEMBERS', row_edit(
        basis, 2, lambda r: r.replace('الفواتير المفتوحة', 'الدفعات المتاحة', 1))
    yield 'remaining changed', 'LEDGER', row_edit('P1', 0, plus('D'))
    yield 'basis as its code', 'RAW_CODE', row_edit(
        basis, 0, lambda r: r.replace(f'>{basis}<', '>remittance<', 1))


def supplier_plants(data):
    """Faults a supplier workpaper can carry: in its scope and sources, its
    strip and balances, each case under review with its members, each
    unmatched case, and its decisions with their reasons."""
    sheet = _first_sheet(data)

    def row_edit(label, offset, change):
        def go(x):
            n = _cell(x, label) + offset
            old = _row(x, n)
            return x.replace(old, change(old), 1)
        return _edit(data, sheet, go)

    def row_with(said, change):
        def go(x):
            old = next(r for r in re.findall(r'<row r="\d+"[^>]*>.*?</row>', x)
                       if said in r)
            return x.replace(old, change(old), 1)
        return _edit(data, sheet, go)

    plus = lambda col: lambda r: re.sub(
        rf'(<c r="{col}\d+"[^>]*><v>)(-?\d+)',
        lambda m: f'{m.group(1)}{int(m.group(2)) + 1}', r, count=1)
    drop = lambda col: lambda r: re.sub(rf'<c r="{col}\d+"[^>]*>.*?</c>', '', r)
    swap = lambda a, b: lambda r: r.replace(f'>{a}<', f'>{b}<', 1)
    link = 'تأكيد يدوي'
    variance, waiting = 'فرق مبلغ', 'يحتاج مراجعة'
    yield 'decision without its reason', 'DECISION_REASON', row_edit(
        link, 0, drop('C'))
    yield 'a link said as the undo', 'DECISION_ACTION', row_edit(
        link, 0, swap(link, 'اقتراح مرفوض'))
    yield 'an undone match said unlike its case', 'DECISION_ACTION', row_with(
        'PAY-101 · PAY-101', swap('اقتراح مرفوض', 'فك الربط'))
    yield 'decision members changed', 'DECISION_MEMBERS', row_edit(
        link, 0, lambda r: r.replace('INV-001 · INV001', 'INV-001 · INV-002', 1))
    yield 'member amount changed', 'MEMBER_AMOUNT', row_edit(
        variance, 1, plus('C'))
    yield 'member on the other side', 'MEMBER_SIDE', row_edit(
        variance, 0, swap('المورد', 'الدفتر'))
    yield 'member reference changed', 'MEMBER_REFERENCE', row_edit(
        variance, 1, swap('INV-003', 'INV-004'))
    yield 'case state as its code', 'RAW_CODE', row_edit(
        variance, 0, swap(variance, 'AMOUNT_VARIANCE'))
    yield 'case state said as another', 'CASE_STATE', row_edit(
        variance, 0, swap(variance, waiting))
    yield 'unmatched amount changed', 'UNMATCHED_AMOUNT', row_edit(
        '2026-08-22', 0, plus('C'))
    yield 'unmatched date changed', 'UNMATCHED_DATE', row_edit(
        '2026-08-22', 0, swap('2026-08-22', '2026-08-23'))
    yield 'unmatched reference changed', 'UNMATCHED_REFERENCE', row_edit(
        '2026-08-22', 0, swap('INV-004', 'INV-044'))
    yield 'residual changed', 'BALANCE', row_edit(
        'الفرق المتبقي حسابيًا', 0, plus('B'))
    yield 'balance check said as not proven', 'BALANCE_CHECK', row_edit(
        'التحقق من الأرصدة', 0, swap(
            'الأرصدة متسقة حسابيًا وتغطية الفترة تحتاج تأكيدك',
            'لم نتمكن من إثبات اتساق الأرصدة'))
    yield 'unmatched count changed', 'ALONE_COUNT', row_with(
        'بلا مقابل', plus('C'))
    yield 'fingerprint cut', 'FINGERPRINT', row_edit(
        'كشف المورد', 1, lambda r: re.sub(r'([0-9a-f]{63})[0-9a-f]<', r'\1<', r))
    yield 'scope value changed', 'SCOPE', row_edit(
        'الجهة القانونية', 0, swap('شركة التدريب (اصطناعية)',
                                    'شركة أخرى (اصطناعية)'))


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
    found += _self_test_one(folder, pick('allocation-undo'), allocation_plants)
    found += _self_test_one(folder, pick('supplier-decided'), supplier_plants)
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
