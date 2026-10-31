"""Independent check of the frozen statement PDFs with pdfminer.six, a PDF
reader unrelated to the product's pdf.js path. Run at freeze time; its
output VERIFY.json is committed beside the assets and bound to their hashes
and to the facts hash.

  node audit/bank-statement-foundation/stories.mjs > stories.json
  PYTHONPATH=<dir with pdfminer.six> python3 verify_assets.py frozen stories.json

For every statement: the number of printed pages, each page's footer and
account line, and on each page every printed line of the facts: a movement's
reference, dates, amount and printed balance; the opening, brought-forward,
carried-forward and closing balances; the totals; and a continuation line's
text. Amounts are formatted here from minor units with Decimal; nothing is
imported from the generator or the product. Arabic glyphs must be present
for the Arabic layout.
"""
import hashlib
import json
import re
import sys
import unicodedata
from decimal import Decimal
from pathlib import Path

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer

AR = str.maketrans('0123456789,.', '٠١٢٣٤٥٦٧٨٩٬٫')


def money(minor):
    if not minor:
        return ''
    q = (Decimal(abs(minor)) / 100).quantize(Decimal('0.01'))
    whole, frac = f'{q:.2f}'.split('.')
    whole = f'{int(whole):,}'
    return ('-' if minor < 0 else '') + whole + '.' + frac


def balance_text(minor):
    return money(-minor) + ' DR' if minor < 0 else (money(minor) or '0.00')


def page_texts(pdf):
    texts = []
    for layout in extract_pages(str(pdf)):
        parts = [el.get_text() for el in layout if isinstance(el, LTTextContainer)]
        texts.append('\n'.join(parts))
    return texts


def line_values(line, conv):
    kind = line['kind']
    if kind == 'movement':
        return [line['reference'], conv(line['date']), conv(line['valueDate']),
                conv(money(line['withdrawal'] or line['deposit'])), conv(balance_text(line['balance']))]
    if kind in ('totals', 'page-totals'):
        return [conv(money(line['withdrawal'])), conv(money(line['deposit']))]
    if kind == 'continuation':
        return [line['text']]
    return [conv(balance_text(line['balance']))]


def check(folder, facts_path):
    folder = Path(folder)
    facts_bytes = Path(facts_path).read_bytes()
    data = json.loads(facts_bytes)
    report = {'reader': 'pdfminer.six (encryption support stubbed: these PDFs are unencrypted)',
              'factsSha256': hashlib.sha256(facts_bytes).hexdigest(), 'statements': []}
    for story in data['stories']:
        pdf = folder / f"{story['id']}-statement.pdf"
        texts = page_texts(pdf)
        statement = story['statement']
        pages = statement['pages']
        arabic = story['layout'] == 'ar'
        conv = (lambda t: t.translate(AR)) if arabic and story.get('digits') != 'latin' else (lambda t: t)

        # Chromium writes right-to-left text to the text layer in visual
        # order with Arabic presentation forms. For the check only: accept
        # each Arabic-layout value in reading or visual order.
        def present(value, text):
            # A long description wraps inside its column, and Latin text may
            # carry ligatures (U+FB01 for "fi"): compare after NFKC with each
            # run of whitespace, line breaks included, collapsed to a space.
            flat = unicodedata.normalize('NFKC', text)
            if value in text or ' '.join(value.split()) in ' '.join(flat.split()):
                return True
            if not arabic:
                return False
            parts = re.split(r'([-\s])', value)
            visual = ''.join(reversed(parts))
            return value in flat or visual in flat or value[::-1] in flat
        problems = []
        if len(texts) != len(pages):
            problems.append(f'pages {len(texts)} != expected {len(pages)}')
        found_values = 0
        for page, text in zip(pages, texts):
            number, total = page['number'], page['of']
            footer = (f'صفحة {number} من {total}' if arabic else f'Page {number} of {total}')
            for v in [conv(footer), statement['account']]:
                if not present(v, text):
                    problems.append(f'page {number}: {v!r} missing')
            for line in page['lines']:
                for v in line_values(line, conv):
                    if v and not present(v, text):
                        problems.append(f"page {number}: {line.get('key', line['kind'])} value {v!r} missing")
                    elif v:
                        found_values += 1
        if arabic and not any('\u0600' <= ch <= '\u06ff' for t in texts for ch in t):
            problems.append('no Arabic glyphs in the text layer')
        report['statements'].append({
            'id': story['id'],
            'file': pdf.name,
            'sha256': hashlib.sha256(pdf.read_bytes()).hexdigest(),
            'pages': len(texts),
            'valuesFound': found_values,
            'ok': not problems,
            'problems': problems[:20],
        })
    report['ok'] = all(s['ok'] for s in report['statements'])
    return report


def self_test(folder, facts_path):
    """The check must fail when one printed fact differs from the page: an
    amount one halala off, a reference changed, a carried-forward balance
    changed, in English and in Arabic."""
    import copy
    import tempfile
    original = json.loads(Path(facts_path).read_text(encoding='utf-8'))

    def movement(story):
        return next(l for p in story['statement']['pages'] for l in p['lines'] if l['kind'] == 'movement' and l['withdrawal'])

    def carried(story):
        return next(l for p in story['statement']['pages'] for l in p['lines'] if l['kind'] == 'carried-forward')
    cases = [
        ('BS01', lambda s: movement(s).update(withdrawal=movement(s)['withdrawal'] + 1)),
        ('BS11', lambda s: movement(s).update(reference=movement(s)['reference'] + 'X')),
        ('BS11', lambda s: movement(s).update(withdrawal=movement(s)['withdrawal'] + 1)),
        ('BS08', lambda s: carried(s).update(balance=carried(s)['balance'] + 100)),
    ]
    for sid, change in cases:
        data = copy.deepcopy(original)
        story = next(s for s in data['stories'] if s['id'] == sid)
        change(story)
        data['stories'] = [story]
        with tempfile.TemporaryDirectory() as tmp:
            facts = Path(tmp) / 'stories.json'
            facts.write_text(json.dumps(data), encoding='utf-8')
            if check(folder, facts)['ok']:
                raise SystemExit(f'self-test: a change to {sid} was not detected')
    return len(cases)


if __name__ == '__main__':
    folder, facts = sys.argv[1], sys.argv[2]
    print('self-test cases detected:', self_test(folder, facts))
    result = check(folder, facts)
    (Path(folder) / 'VERIFY.json').write_text(json.dumps(result, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'ok': result['ok'], 'statements': [(s['id'], s['pages'], s['valuesFound'], s['ok'], s['problems'][:2]) for s in result['statements']]}, ensure_ascii=False))
