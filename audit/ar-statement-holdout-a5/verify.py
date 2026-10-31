"""Independent reading of the A5 holdout PDFs with pdfminer.six: every printed
line of the facts is on its page, in order, and every value lies under its
own heading.

Each page is read as visual rows, top to bottom: a row is the glyphs on one
baseline (the text matrix's y), in x order. A space is read where the writer
draws a space glyph, or where the gap between two glyphs is over a quarter of
the type size. In a right-to-left
row a glyph that carries several characters (a ligature such as lam-alef or
FreeSerif's teh-reh) keeps them in reading order, so the row reversed reads
the word as written; nothing else is folded but NFKC.

For each printed line, in order, one row of its page:
- a text line: every word of it is found in the row (a right-to-left word
  also in visual order, or a date by its reversed parts), and the row holds
  no other glyph;
- a heading line: each heading is found whole, and its glyphs' extent is the
  heading's span; a table continued without headings keeps the spans before;
- a value line: each value is found where its glyphs overlap its own
  heading's span and no other heading's span, and the row holds no other
  glyph.
The page holds no other row. The self-test changes one fact at a time and
requires the check to fail.

  PYTHONPATH=<pdfminer.six> python3 -B audit/ar-statement-holdout-a5/verify.py [frozen]
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
EDGE = r'0-9A-Za-z؀-ۿ٠-٩,.٫٬/'
ARABIC = re.compile(r'[؀-ۿ]')


def glyphs(item):
    if isinstance(item, LTChar):
        yield item
    elif isinstance(item, LTContainer):
        for child in item:
            yield from glyphs(child)


class Row:
    """One visual row: its text and, for each character, the glyph it came
    from (None for a read space)."""

    def __init__(self, items, rtl):
        items = sorted(items, key=lambda g: (g.x0, g.matrix[4]))
        self.boxes, self.text, self.owner = [], '', []
        last, space = None, False
        for g in items:
            t = unicodedata.normalize('NFKC', g.get_text())
            if not t.strip():
                space = True
                continue
            if last is not None and (space or g.x0 - last.x1 > (g.size or 8) * 0.25):
                self.text += ' '
                self.owner.append(None)
            space = False
            if rtl and len(t) > 1 and ARABIC.search(t):
                t = t[::-1]
            self.boxes.append((g.x0, g.x1))
            self.text += t
            self.owner.extend([len(self.boxes) - 1] * len(t))
            last = g

    def find(self, form):
        """Each occurrence of `form` as glyph indices."""
        out = []
        for m in re.finditer(f'(?<![{EDGE}]){re.escape(form)}(?![{EDGE}])', self.text):
            out.append({self.owner[i] for i in range(m.start(), m.end()) if self.owner[i] is not None})
        return out

    def span(self, indices):
        return min(self.boxes[i][0] for i in indices), max(self.boxes[i][1] for i in indices)


def visual_rows(pdf, rtl):
    pages = []
    for layout in extract_pages(str(pdf)):
        by_line = {}
        for g in glyphs(layout):
            by_line.setdefault(round(g.matrix[5], 1), []).append(g)
        rows = [Row(by_line[y], rtl) for y in sorted(by_line, reverse=True)]
        pages.append([r for r in rows if r.boxes])
    return pages


def forms(word, rtl):
    out = [word]
    if rtl:
        out += [word[::-1], ''.join(reversed(re.split(r'(-)', word)))]
    return list(dict.fromkeys(out))


def locate(value, row, rtl):
    """Occurrences of a whole value, each as glyph indices: the value as
    written or, right to left, reversed; else word by word, every
    combination of one occurrence per word."""
    value = ' '.join(unicodedata.normalize('NFKC', value).split())
    whole = [hit for f in forms(value, rtl) for hit in row.find(f)]
    if whole or ' ' not in value:
        return whole
    combos = [set()]
    for word in value.split():
        hits = [hit for f in forms(word, rtl) for hit in row.find(f)]
        if not hits:
            return []
        combos = [c | h for c in combos for h in hits][:64]
    return combos


def overlaps(a, b):
    return min(a[1], b[1]) - max(a[0], b[0]) > 0


def check_story(story, pdf):
    rtl = story['layout'] == 'ar'
    pages = visual_rows(pdf, rtl)
    printed_pages = story['statement']['pages']
    if len(pages) != len(printed_pages):
        return [f'{len(pages)} pages, {len(printed_pages)} printed']
    problems, checked, spans = [], 0, None
    for p, (printed, rows) in enumerate(zip(printed_pages, pages), 1):
        if len(rows) != len(printed):
            problems.append(f'page {p}: {len(rows)} rows, {len(printed)} printed lines')
            continue
        for n, (line, row) in enumerate(zip(printed, rows), 1):
            used = set()
            if 'text' in line:
                for word in line['text'].split():
                    hits = [hit for hit in locate(word, row, rtl) if not hit & used]
                    checked += 1
                    if not hits:
                        problems.append(f'page {p} line {n}: {word!r} not in {row.text!r}')
                    else:
                        used |= hits[0]
            elif 'headings' in line:
                spans = {}
                for h in line['headings']:
                    hits = locate(h, row, rtl)
                    checked += 1
                    if len(hits) != 1:
                        problems.append(f'page {p} line {n}: heading {h!r} found {len(hits)} times in {row.text!r}')
                        continue
                    spans[h] = row.span(hits[0])
                    used |= hits[0]
            else:
                for h, v in line['cells']:
                    checked += 1
                    if spans is None or h not in spans:
                        problems.append(f'page {p} line {n}: no heading {h!r} above {v!r}')
                        continue
                    under = [hit for hit in locate(v, row, rtl)
                             if overlaps(row.span(hit), spans[h])
                             and not any(overlaps(row.span(hit), s) for k, s in spans.items() if k != h)]
                    if not under:
                        problems.append(f'page {p} line {n}: {v!r} not under {h!r} alone in {row.text!r}')
                    else:
                        used |= under[0]
            stray = set(range(len(row.boxes))) - used
            if stray:
                problems.append(f'page {p} line {n}: {len(stray)} glyphs not in the printed line: {row.text!r}')
    return problems or checked


def check(folder, facts):
    report = {}
    for story in facts['stories']:
        result = check_story(story, Path(folder) / f"{story['id']}-statement.pdf")
        report[story['id']] = {'values': result} if isinstance(result, int) else {'problems': result}
    return report


def first_cells(story, page=0):
    return next(l for l in story['statement']['pages'][page] if 'cells' in l)


def self_test(folder, facts):
    def amount(s):
        line = first_cells(s)
        h, v = next((h, v) for h, v in line['cells'] if h == 'Original amount')
        line['cells'] = [[k, (x[:-1] + ('1' if x[-1] != '1' else '2')) if k == h else x] for k, x in line['cells']]

    def swapped(s):
        line = first_cells(s)
        values = dict(line['cells'])
        line['cells'] = [[k, values['Open amount'] if k == 'Original amount' else
                          values['Original amount'] if k == 'Open amount' else x] for k, x in line['cells']
                         if k != 'Open amount'] + [['Open amount', values['Original amount']]]

    def dropped(s):
        page = s['statement']['pages'][1]
        page.remove(next(l for l in page if 'cells' in l))

    def moved(s):
        line = first_cells(s, 1)
        s['statement']['pages'][1].remove(line)
        page = s['statement']['pages'][0]
        page.insert(len(page) - 1, line)

    def indic(s):
        line = first_cells(s)
        line['cells'] = [[h, v.replace('٢', '٣', 1) if h == 'المبلغ الأصلي' else v] for h, v in line['cells']]

    def arabic_word(s):
        line = first_cells(s)
        line['cells'] = [[h, 'أرفف تخزين' if h == 'البيان' else v] for h, v in line['cells']]

    def currency(s):
        for l in s['statement']['pages'][0]:
            if l.get('text') == 'Currency: USD':
                l['text'] = 'Currency: EUR'

    def footer(s):
        last = s['statement']['pages'][0][-1]
        last['text'] = last['text'].replace('of 20', 'of 21')

    def ledger(s):
        for l in s['statement']['pages'][1]:
            if l.get('text') == 'Ledger: Receivables Export':
                l['text'] = 'Ledger: Receivables 2026'

    def missing_document(s):
        line = next(l for l in s['statement']['pages'][0]
                    if 'cells' in l and not any(h == 'Document No' for h, _ in l['cells']))
        line['cells'].insert(2, ['Document No', 'RV-26-0190'])

    def heading_moved(s):
        line = first_cells(s)
        line['cells'] = [['Description' if h == 'Type' else 'Type' if h == 'Description' else h, v]
                         for h, v in line['cells']]

    plants = [('B01', 'an amount one halala off', amount),
              ('B02', 'the original and open amounts under each other\'s heading', swapped),
              ('B11', 'a printed line dropped', dropped),
              ('B02', 'a page break moved', moved),
              ('B04', 'an Arabic-Indic digit in an amount', indic),
              ('B03', 'an Arabic word in a description', arabic_word),
              ('B10', 'the currency of the compared section', currency),
              ('B15', 'the page count in a footer', footer),
              ('B05', 'the ledger printed on page 2', ledger),
              ('B17', 'a document number where none is printed', missing_document),
              ('B09', 'a type and a description under each other\'s heading', heading_moved)]
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
    print(json.dumps({'version': 'ar-statement-holdout-a5-verify-1', 'passed': ok,
                      'values': sum(r.get('values', 0) for r in report.values()),
                      'stories': report, 'selfTest': plants}, ensure_ascii=False, indent=1))
    if not ok:
        sys.exit(1)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else HERE / 'frozen')
