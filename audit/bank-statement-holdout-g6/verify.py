"""Independent check of the G6 holdout files, before any product run.

  python3 -B audit/bank-statement-holdout-g6/stories.py > stories.json
  PYTHONPATH=<pdfminer.six> python3 -B verify.py frozen stories.json

1. Every statement PDF is read with pdfminer.six, a reader unrelated to the
   product's pdf.js, glyph by glyph. Glyphs sharing a baseline make one
   visual row, ordered left to right. Every printed line of the facts must be
   found on its own row, in the facts' order down the page, with all of its
   values: a movement's dates, reference, amount and balance (and, in
   English, the first line of its description); a control line's balance or
   totals; a continuation's text. The account line and the `Page n of N`
   footer must be on every page, and the page count must match.
   Right-to-left rows are matched in reading order or in visual order (the
   segments of a date or a `DR` balance in reverse), after NFKC, which folds
   Arabic presentation forms. A value must stand alone: `1,000.00` is not
   found inside `11,000.00`.
   The foundation's verify_assets.py checks values page by page; it cannot
   follow LibreOffice's split text runs, so G6 checks rows instead, which is
   stricter: a value printed on the wrong row is a failure here.
2. The check must fail on planted changes to the facts, for each producer
   and layout, including two balances swapped between rows.
3. Each XLSX cashbook holds the CSV cashbook row for row: a text XLSX read
   cell by cell; a typed XLSX with dates as day serials from 1899-12-30 and
   amounts as numbers, converted here with Decimal.
4. Each PDF names its producer and carries the font its story declares, read
   from the document information and the page resources.
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
from common import AR_DIGITS, CASHBOOK_HEADERS, LABELS, balance_text, money  # noqa: E402

M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
EDGE = r'0-9A-Za-z\u0660-\u0669\u066b\u066c,.'


def glyphs(item):
    if isinstance(item, LTChar):
        yield item
    elif isinstance(item, LTContainer):
        for child in item:
            yield from glyphs(child)


def visual_rows(pdf):
    """Each page as rows of text, top to bottom; a row is the glyphs on one
    baseline, left to right, with a space where the gap is wider than a
    quarter of the glyph height."""
    pages = []
    for layout in extract_pages(str(pdf)):
        by_line = {}
        for g in glyphs(layout):
            by_line.setdefault(round(g.y0 * 2) / 2, []).append(g)
        lines = []
        for y in sorted(by_line, reverse=True):
            row = sorted(by_line[y], key=lambda g: g.x0)
            text, last = '', None
            for g in row:
                if last is not None and g.x0 - last.x1 > (g.height or 8) * 0.25 and not text.endswith(' '):
                    text += ' '
                text += g.get_text()
                last = g
            lines.append(' '.join(unicodedata.normalize('NFKC', text).split()))
        # Merge baselines a fraction of a point apart into one row.
        merged, ys = [], sorted(by_line, reverse=True)
        for y, line in zip(ys, lines):
            if merged and abs(merged[-1][0] - y) < 1.0:
                merged[-1] = (merged[-1][0], merged[-1][1] + ' ' + line)
            else:
                merged.append((y, line))
        pages.append([line for _, line in merged])
    return pages


def forms(value, rtl):
    """The ways a value can appear on a row."""
    value = ' '.join(unicodedata.normalize('NFKC', value).split())
    out = {value}
    if rtl:
        parts = re.split(r'([-\s])', value)
        out.add(''.join(reversed(parts)))
        out.add(value[::-1])
    return out


def found(value, row, rtl):
    return any(re.search(f'(?<![{EDGE}]){re.escape(v)}(?![{EDGE}])', row) for v in forms(value, rtl))


def line_values(story, line):
    rtl = story['layout'] == 'ar'
    num = (lambda t: t.translate(AR_DIGITS)) if rtl and story.get('digits') == 'arabic' else (lambda t: t)
    k = line['kind']
    if k == 'movement':
        values = [num(line['date']), num(line['valueDate']), num(money(line['withdrawal'] or line['deposit'])),
                  num(balance_text(line['balance']))]
        if line['reference']:
            values.append(line['reference'])
        if not rtl:
            values.append(line['description'].split('\n')[0])
        return values
    if k in ('totals', 'page-totals'):
        return [v for v in (num(money(line['withdrawal'])), num(money(line['deposit']))) if v]
    if k == 'continuation':
        return [line['text']]
    return [num(balance_text(line['balance']))]


def check(folder, facts_path):
    folder = Path(folder)
    facts_bytes = Path(facts_path).read_bytes()
    data = json.loads(facts_bytes)
    report = {'reader': 'pdfminer.six, glyph by glyph, rows by baseline',
              'factsSha256': hashlib.sha256(facts_bytes).hexdigest(), 'statements': []}
    for story in data['stories']:
        pdf = folder / f"{story['id']}-statement.pdf"
        rows = visual_rows(pdf)
        rtl = story['layout'] == 'ar'
        num = (lambda t: t.translate(AR_DIGITS)) if rtl and story.get('digits') == 'arabic' else (lambda t: t)
        pages = story['statement']['pages']
        problems, values = [], 0
        if len(rows) != len(pages):
            problems.append(f'pages {len(rows)} != expected {len(pages)}')
        for page, page_rows in zip(pages, rows):
            n = page['number']
            footer = num(LABELS[story['layout']]['page'].format(n, page['of']))
            if not any(all(found(w, r, rtl) for w in footer.split()) and found(num(str(n)), r, rtl) for r in page_rows):
                problems.append(f'page {n}: footer {footer!r} missing')
            if not any(found(story['statement']['account'], r, rtl) for r in page_rows):
                problems.append(f'page {n}: account missing')
            at = 0
            for line in page['lines']:
                want = line_values(story, line)
                hit = next((i for i in range(at, len(page_rows)) if all(found(v, page_rows[i], rtl) for v in want)), None)
                if hit is None:
                    problems.append(f"page {n}: {line.get('key', line['kind'])} {want} not on one row in order")
                else:
                    values += len(want)
                    at = hit + 1
        if rtl and not any('\u0600' <= ch <= '\u06ff' for p in rows for r in p for ch in r):
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
        got = typed_as_csv(rows)
        return {'file': path.name, 'kind': 'typed', 'cellTypes': sorted(types), 'sameAsCsv': got == want,
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    # A spreadsheet writer may leave trailing empty cells out; the oracle's
    # cashbook reader pads them, and so does this comparison.
    got = [r + [''] * (len(CASHBOOK_HEADERS) - len(r)) for r in xlsx_rows(path)]
    return {'file': path.name, 'kind': 'text', 'sameAsCsv': got == want,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def pdf_info(path):
    """Producer and font names, from the document information and the page
    resources."""
    with open(path, 'rb') as f:
        doc = PDFDocument(PDFParser(f))
        info = doc.info[0] if doc.info else {}
        raw = resolve1(info.get('Producer', b''))
        producer = (raw.decode('utf-16') if raw[:2] in (b'\xfe\xff', b'\xff\xfe') else raw.decode('latin-1')) if raw else None
        fonts = set()
        for page in PDFPage.create_pages(doc):
            for font in (resolve1(page.resources.get('Font')) or {}).values():
                name = resolve1(font).get('BaseFont')
                fonts.add(getattr(name, 'name', str(name)))
    return {'producer': producer, 'fonts': sorted(fonts)}


def font_matches(story, fonts):
    declared = story['font'].split(' (')[0].replace(' ', '')
    return any(declared in f.replace(' ', '') for f in fonts)


def self_test(folder, facts_path):
    """The PDF check must reject planted changes to the facts."""
    original = json.loads(Path(facts_path).read_text(encoding='utf-8'))

    def swap_balances(story):
        a, b = [l for p in story['statement']['pages'] for l in p['lines'] if l['kind'] == 'movement'][:2]
        a['balance'], b['balance'] = b['balance'], a['balance']

    def first(story, kind, pred=lambda l: True):
        return next(l for p in story['statement']['pages'] for l in p['lines'] if l['kind'] == kind and pred(l))
    cases = [
        ('H01', 'LibreOffice, English: an amount one halala off',
         lambda s: first(s, 'movement', lambda l: l['withdrawal']).update(withdrawal=first(s, 'movement', lambda l: l['withdrawal'])['withdrawal'] + 1)),
        ('H03', 'LibreOffice, Arabic-Indic digits: a reference changed',
         lambda s: first(s, 'movement').update(reference=first(s, 'movement')['reference'] + 'X')),
        ('H03', 'LibreOffice, Arabic-Indic digits: a date changed',
         lambda s: first(s, 'movement').update(date='2026-08-29')),
        ('H04', 'LibreOffice, Arabic with Latin digits: a balance changed',
         lambda s: first(s, 'movement').update(balance=first(s, 'movement')['balance'] + 100)),
        ('H07', 'ReportLab Helvetica: a brought-forward balance changed',
         lambda s: first(s, 'brought-forward').update(balance=first(s, 'brought-forward')['balance'] + 100)),
        ('H10', 'ReportLab embedded TrueType: a deposit one halala off',
         lambda s: first(s, 'movement', lambda l: l['deposit']).update(deposit=first(s, 'movement', lambda l: l['deposit'])['deposit'] + 1)),
        ('H11', 'ReportLab Arabic, visual order: a reference changed',
         lambda s: first(s, 'movement').update(reference=first(s, 'movement')['reference'][:-1] + '9')),
        ('H11', 'ReportLab Arabic, visual order: a withdrawal one halala off',
         lambda s: first(s, 'movement', lambda l: l['withdrawal']).update(withdrawal=first(s, 'movement', lambda l: l['withdrawal'])['withdrawal'] + 1)),
        ('H08', 'ReportLab: the printed page numbers changed',
         lambda s: s['statement']['pages'][-1].update(number=3)),
        ('H01', 'LibreOffice: two balances swapped between rows', swap_balances),
        ('H07', 'ReportLab: two balances swapped between rows', swap_balances),
        ('H05', 'LibreOffice landscape: the continuation text changed',
         lambda s: first(s, 'continuation').update(text=first(s, 'continuation')['text'].replace('118', '119'))),
        ('H12', 'ReportLab: a value date changed', lambda s: first(s, 'movement').update(valueDate='2026-07-03')),
    ]
    detected = []
    for sid, label, change in cases:
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
    for sid in ('H01', 'H07'):
        story = next(s for s in original['stories'] if s['id'] == sid)
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / f'{sid}-cashbook.xlsx').write_bytes((Path(folder) / f'{sid}-cashbook.xlsx').read_bytes())
            text = (Path(folder) / f'{sid}-cashbook.csv').read_bytes().decode('utf-8')
            first_amount = re.search(r',(\d+\.\d\d)\r\n', text).group(1)
            changed = text.replace(f',{first_amount}\r\n', f',{Decimal(first_amount) + Decimal("0.01")}\r\n', 1)
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
        entry.update(producer=info['producer'], fonts=info['fonts'], fontDeclared=story['font'],
                     fontPresent=font_matches(story, info['fonts']))
        want = 'LibreOffice' if story['producer'] == 'libreoffice-writer' else 'ReportLab'
        if not (info['producer'] or '').startswith(want) or not entry['fontPresent']:
            entry['ok'] = False
            entry['problems'].append(f"producer {info['producer']!r} or fonts {info['fonts']} differ from the story")
    report['cashbookXlsx'] = [xlsx_report(folder, s) for s in facts['stories'] if s.get('cashbookXlsx')]
    report['selfTest'] = detected
    report['ok'] = all(s['ok'] for s in report['statements']) and all(x['sameAsCsv'] for x in report['cashbookXlsx'])
    (folder / 'VERIFY.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'ok': report['ok'], 'selfTest': len(detected),
                      'statements': [(s['id'], s['pages'], s['valuesFound'], s['ok'], s['problems'][:2]) for s in report['statements']],
                      'cashbookXlsx': [(x['file'], x['kind'], x['sameAsCsv']) for x in report['cashbookXlsx']]},
                     ensure_ascii=False))
    raise SystemExit(0 if report['ok'] else 1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
