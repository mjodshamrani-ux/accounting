"""Independent reading of the AR-1 foundation PDFs with pdfminer.six.

Each page is read as visual rows, top to bottom; a row is the glyphs on one
baseline, left to right. Every printed line of the facts must be one row of
its page, in order, holding each of its values, and the page must have no
other rows. Right-to-left rows are compared word by word in reading or in
visual order, after NFKC folds presentation forms. The self-test changes one
fact at a time and requires the check to fail.

  PYTHONPATH=<pdfminer.six> python3 -B audit/ar-statement-foundation/verify_assets.py [frozen]
"""
import copy
import json
import re
import sys
import unicodedata
from pathlib import Path

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTChar, LTContainer

HERE = Path(__file__).resolve().parent
EDGE = r'0-9A-Za-z؀-ۿ,.'


def glyphs(item):
    if isinstance(item, LTChar):
        yield item
    elif isinstance(item, LTContainer):
        for child in item:
            yield from glyphs(child)


def visual_rows(pdf):
    pages = []
    for layout in extract_pages(str(pdf)):
        by_line = {}
        for g in glyphs(layout):
            by_line.setdefault(round(g.y0), []).append(g)
        rows = []
        for y in sorted(by_line, reverse=True):
            text, last = '', None
            for g in sorted(by_line[y], key=lambda g: g.x0):
                if last is not None and g.x0 - last.x1 > (g.height or 8) * 0.25 and not text.endswith(' '):
                    text += ' '
                text += g.get_text()
                last = g
            text = ' '.join(unicodedata.normalize('NFKC', text).split())
            if text:
                rows.append(text)
        pages.append(rows)
    return pages


def values(line):
    if 'text' in line:
        return [line['text']]
    if 'headings' in line:
        return list(line['headings'])
    return [v for _, v in line['cells']]


def lam_alef(text):
    """NFKC unfolds a lam-alef ligature in logical order even inside a row
    read in visual order, so a reversed word holds the pair either way round.
    Fold both orders to one for the comparison."""
    return re.sub(r'([اأإآ])ل', r'ل\1', text)


def found(value, row, rtl):
    value = ' '.join(unicodedata.normalize('NFKC', value).split())

    def present(v):
        return re.search(f'(?<![{EDGE}]){re.escape(v)}(?![{EDGE}])', row)
    if not rtl:
        return bool(present(value))
    row = lam_alef(row)
    for word in value.split():
        forms = {lam_alef(f) for f in (word, word[::-1], ''.join(reversed(re.split(r'([-])', word))))}
        if not any(present(f) for f in forms):
            return False
    return True


def check_story(story, pdf):
    rtl = story['layout'] == 'ar'
    pages = visual_rows(pdf)
    problems = []
    if len(pages) != len(story['statement']['pages']):
        return [f'{len(pages)} pages, {len(story["statement"]["pages"])} printed']
    checked = 0
    for p, (printed, rows) in enumerate(zip(story['statement']['pages'], pages), 1):
        if len(rows) != len(printed):
            problems.append(f'page {p}: {len(rows)} rows, {len(printed)} printed lines')
            continue
        for n, (line, row) in enumerate(zip(printed, rows), 1):
            for v in values(line):
                checked += 1
                if not found(v, row, rtl):
                    problems.append(f'page {p} line {n}: {v!r} not in {row!r}')
    return problems or checked


def check(folder, facts):
    report = {}
    for story in facts['stories']:
        result = check_story(story, Path(folder) / f"{story['id']}-statement.pdf")
        report[story['id']] = {'values': result} if isinstance(result, int) else {'problems': result}
    return report


def self_test(folder, facts):
    def amount(s):
        line = next(l for p in s['statement']['pages'] for l in p if 'cells' in l)
        h, v = line['cells'][-2]
        line['cells'][-2] = [h, v[:-1] + ('1' if v[-1] != '1' else '2')]

    def arabic_document(s):
        line = next(l for p in s['statement']['pages'] for l in p if 'cells' in l)
        line['cells'] = [[h, 'INV-1009' if v == 'INV-1001' else v] for h, v in line['cells']]

    def currency(s):
        for l in s['statement']['pages'][1]:
            if l.get('text') == 'Currency: USD':
                l['text'] = 'Currency: EUR'

    def dropped(s):
        s['statement']['pages'][0] = [l for l in s['statement']['pages'][0] if 'cells' not in l][:-1] + \
            [l for l in s['statement']['pages'][0] if 'cells' in l][1:] + s['statement']['pages'][0][-1:]

    def header_customer(s):
        for l in s['statement']['pages'][0]:
            if l.get('text') == 'Customer ID: C0002':
                l['text'] = 'Customer ID: C0003'

    def arabic_digit(s):
        line = next(l for p in s['statement']['pages'] for l in p if 'cells' in l)
        line['cells'] = [[h, v.replace('٢', '٣', 1) if h == 'المبلغ الأصلي' else v] for h, v in line['cells']]

    def arabic_word(s):
        line = next(l for p in s['statement']['pages'] for l in p if 'cells' in l)
        line['cells'] = [[h, 'قطع غيار مضخات' if h == 'البيان' else v] for h, v in line['cells']]

    plants = [('A01', 'an amount one halala off', amount),
              ('A12', 'an Arabic-Indic digit in an amount', arabic_digit),
              ('A12', 'an Arabic word in a description', arabic_word),
              ('A12', 'an Arabic statement document number', arabic_document),
              ('A06', 'the currency of the second section', currency),
              ('A01', 'a printed line dropped', dropped),
              ('A03', 'the second customer', header_customer)]
    out = []
    for sid, name, plant in plants:
        story = copy.deepcopy(next(s for s in facts['stories'] if s['id'] == sid))
        plant(story)
        result = check_story(story, Path(folder) / f'{sid}-statement.pdf')
        out.append({'story': sid, 'plant': name, 'rejected': not isinstance(result, int)})
    return out


def main(folder):
    folder = Path(folder)
    facts = json.loads((folder / 'stories.json').read_text(encoding='utf-8'))
    report = check(folder, facts)
    plants = self_test(folder, facts)
    ok = all('values' in r for r in report.values()) and all(p['rejected'] for p in plants)
    print(json.dumps({'version': 'ar-statement-foundation-verify-1', 'passed': ok,
                      'values': sum(r.get('values', 0) for r in report.values()),
                      'stories': report, 'selfTest': plants}, ensure_ascii=False, indent=1))
    if not ok:
        sys.exit(1)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else HERE / 'frozen')
