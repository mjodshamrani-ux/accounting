"""Independent check of the reconciliation sheet (UX-6) in GL/TB workpapers.

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
  fingerprint or a line to sign on; the sign-off lines are empty.

Usage: check_sheet.py FOLDER            check every case in FOLDER/cases.json
       check_sheet.py --self-test FOLDER  plant faults and require each found
       check_sheet.py --download LANG FILE...  a page download: the sheet and
                                          its figures, without an evidence copy
"""

import base64
import hashlib
import io
import json
import re
import sys
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
    return check_content(evidence, book, lang)


def check_content(evidence, book, lang):
    summary = {r[0]: r[1] for r in evidence.table('Summary')[1:]}
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

    rows = book.rows(book.names[0])
    styles = book.styles
    text = lambda c: c is not None and c[0] == 'text' and c[1] != ''
    number = lambda c: c is not None and c[0] == 'number'
    blank = lambda c: c is None or (c[0] == 'text' and c[1] == '') or c[0] == 'empty'
    line = lambda c: c is not None and c[0] == 'empty' and styles.line(c[2])

    # Title and subtitle; then sections, each opened by a bold first cell
    # with nothing in the second.
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
    need([s['evidence'] for s in sections] ==
         ['Summary', 'Sources', None, 'Balances', None, 'Summary'],
         'SECTIONS', str([s['evidence'] for s in sections]))
    scope, srcs, strip, table, sign, claim = sections

    # The giving rule: every row under a section carries a value beside its
    # label, or is a note row with its words in the second cell, a table
    # head, a sign-off row or the claim.
    for s in sections:
        for i, row in s['rows']:
            carries = any(text(c) or number(c) or line(c) for c in row[1:])
            need(carries or (s is claim and text(row[0])), 'GIVING',
                 f'row {i + 1} carries nothing')

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

    # Sign-off: who and when, left empty for people.
    need(len(sign['rows']) == 2, 'SIGN_OFF', 'two rows')
    for _, row in sign['rows']:
        need(text(row[0]) and line(row[1]) and text(row[2]) and line(row[3]),
             'SIGN_OFF', 'lines left empty')

    # The engine's claim, in English the evidence's own words.
    need(len(claim['rows']) == 1 and text(claim['rows'][0][1][0]), 'CLAIM')
    if lang == 'en':
        need(claim['rows'][0][1][0][1] == summary['Claim'], 'CLAIM', 'words')

    # Every number in the sheet is one of those checked above.
    numbers = sum(1 for row in rows for c in row if number(c))
    expected = (1 + (1 if computed else 0) + (1 if nonzero else 0) +
                (1 if len(nonzero) > 1 else 0) + (1 if computed and not nonzero else 0) +
                sum(1 for b in balances.values() for v in b if v != 'missing'))
    need(numbers == expected, 'STRAY_NUMBER', f'{numbers} != {expected}')
    return {'status': summary['Status'], 'rows': len(rows)}


def verify(folder):
    manifest = json.loads((folder / 'cases.json').read_text())
    need(manifest['syntheticOnly'] is True and manifest['workspace'] == 'gl-tb',
         'MANIFEST')
    report = []
    for case in manifest['cases']:
        for lang in ('ar', 'en'):
            report.append({'case': case['case'], 'lang': lang,
                           **check_case(folder, case, lang)})
    return report


# Planted faults: each changes one thing in a good workpaper and must be
# found with its code. A decision without its reason has no GL/TB form; it
# is planted when decisions enter the sheet (UX-6(b)).
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
    m = re.search(r'<row r="(\d+)"><c r="A\d+"[^>]*><is><t[^>]*>'
                  + re.escape(label) + '</t>', xml)
    assert m, label
    return int(m.group(1))


def _row(xml, n):
    return re.search(rf'<row r="{n}">.*?</row>', xml).group(0)


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
    yield 'sheet not first', 'SHEET_ORDER', _edit(
        data, 'xl/workbook.xml', lambda x: re.sub(
            r'<sheets>(<sheet [^>]*/>)(<sheet [^>]*/>)', r'<sheets>\2\1', x))


def self_test(folder):
    manifest = json.loads((folder / 'cases.json').read_text())
    case = next(c for c in manifest['cases']
                if c['case'] == 'same-net-different-turnover')
    good = (folder / case['ar']).read_bytes()
    target = folder / 'self-test-ar.xlsx'
    one = {**case, 'ar': target.name}
    found = []
    try:
        target.write_bytes(good)
        check_case(folder, one, 'ar')
        for name, code, data in plants(good):
            target.write_bytes(data)
            try:
                check_case(folder, one, 'ar')
            except Fault as fault:
                need(str(fault).startswith(code), 'SELF_TEST',
                     f'{name}: found {fault}, expected {code}')
                found.append({'plant': name, 'code': code})
                continue
            raise Fault(f'SELF_TEST: {name} was not found')
    finally:
        target.unlink(missing_ok=True)
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
