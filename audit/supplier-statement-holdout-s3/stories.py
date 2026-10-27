"""The S3 supplier statements: twelve stories, nine positive and three reserved.

Each story is a supplier's statement of account to one customer for one
month, and the customer's accounts-payable ledger for that supplier. The
facts are written here and nowhere else: the movements and their order, the
pages, and what the ledger holds. expected.py derives what a reader can
prove from these facts alone; the renderers only print them.

Seeds and amounts are fixed, so `python3 -B stories.py` prints the same
JSON every time. Nothing is read from the product.
"""
import json
import random
from datetime import date, timedelta

SUPPLIERS = {
    'S01': 'Northwind Fasteners Ltd', 'S02': 'Harbour Paper & Print Co', 'S03': 'Alpine Valve Works GmbH',
    'S04': 'Copperline Electrical Supply', 'S05': 'Bluegate Office Furniture', 'S06': 'Meridian Packaging LLC',
    'S07': 'مؤسسة الواحة للتوريدات', 'S08': 'شركة الرمال للمواد الإنشائية', 'S09': 'مصنع النخيل للبلاستيك',
    'R10': 'Westfield Industrial Coatings', 'R11': 'Kestrel Lab Instruments', 'R12': 'Orbit Freight Services',
}
CUSTOMER = {'en': 'Synthetic Buyer Trading Co', 'ar': 'شركة المشتري الاصطناعية'}
TITLE = {'en': 'Statement of Account', 'ar': 'كشف حساب'}
DESCRIPTIONS = {
    'en': {'Invoice': ['Steel fittings', 'Packing crates', 'Valve spares', 'Cable reels', 'Office chairs',
                       'Printing paper', 'Pallet wrap', 'Control panels', 'Fasteners lot', 'Safety gloves'],
           'Payment': ['Bank transfer', 'Payment received', 'Transfer received'],
           'Credit Note': ['Returned goods', 'Price adjustment', 'Damaged items credit']},
    'ar': {'Invoice': ['توريد مواد', 'أكياس تعبئة', 'قطع غيار', 'أنابيب بلاستيك', 'مواد بناء', 'أدوات كهربائية'],
           'Payment': ['تحويل بنكي', 'دفعة مستلمة'],
           'Credit Note': ['مرتجع بضاعة', 'خصم سعر']},
}


def iso(d):
    return d.isoformat()


def movements(rng, start, days, invoices, payments, credits, prefix):
    """Movements in date order: invoices INV-, payments PMT-, credit notes
    CN-, each with its own number. Amounts in minor units, signed as the
    supplier's statement signs them (an invoice raises the balance)."""
    kinds = ['Invoice'] * invoices + ['Payment'] * payments + ['Credit Note'] * credits
    rng.shuffle(kinds)
    kinds.sort(key=lambda k: k != 'Invoice')
    tail = kinds[2:]  # the month opens with two invoices
    rng.shuffle(tail)
    kinds[2:] = tail
    out, numbers = [], {'Invoice': rng.randint(1000, 8000), 'Payment': rng.randint(100, 900),
                        'Credit Note': rng.randint(10, 90)}
    stamp = sorted(rng.choices(range(days), k=len(kinds)))
    for k, offset in zip(kinds, stamp):
        numbers[k] += rng.randint(1, 7)
        code = {'Invoice': 'INV', 'Payment': 'PMT', 'Credit Note': 'CN'}[k]
        if k == 'Invoice':
            minor = rng.randint(50_000, 4_800_000)
        elif k == 'Payment':
            minor = -rng.randint(100_000, 3_500_000)
        else:
            minor = -rng.randint(5_000, 250_000)
        out.append({'date': iso(start + timedelta(days=offset)), 'ref': f'{prefix}{code}-{numbers[k]}', 'type': k,
                    'minor': minor})
    return out


def describe(rng, lines, language):
    for line in lines:
        line['desc'] = rng.choice(DESCRIPTIONS[language][line['type']])


def ledger_of(rng, lines, lag=True):
    """The buyer's postings of the same documents, a day later at most."""
    out = []
    for line in lines:
        d = date.fromisoformat(line['date']) + timedelta(days=rng.choice([0, 0, 1]) if lag else 0)
        out.append({'date': iso(d), 'ref': line['ref'], 'type': line['type'], 'minor': line['minor'],
                    'desc': 'Posted'})
    return out


def paginate(lines, per_page):
    return [lines[i:i + per_page] for i in range(0, len(lines), per_page)]


def story(sid, *, producer, language, columns, font, paper='A4', style, period, dates='iso', numbers='dot',
          negative='minus', digits='latin', seed, counts, per_page, prefix='', total=False, kind='positive',
          contract='solve', intent='', tweak=None):
    rng = random.Random(seed)
    start = date.fromisoformat(period[0])
    days = (date.fromisoformat(period[1]) - start).days - 1  # the last day stays clear of the cut-off
    lines = movements(rng, start, days, *counts, prefix)
    describe(rng, lines, language)
    ledger = ledger_of(rng, lines)
    st = {'id': sid, 'producer': producer, 'language': language, 'columns': columns, 'font': font,
          'paper': paper, 'style': style, 'supplier': SUPPLIERS[sid], 'title': TITLE[language],
          'customer': CUSTOMER[language], 'account': f'C-{rng.randint(10000, 99999)}', 'currency': 'SAR',
          'period': {'start': period[0], 'end': period[1]}, 'dates': dates, 'numbers': numbers,
          'negative': negative, 'digits': digits, 'opening': rng.randint(1_000_000, 9_000_000),
          'kind': kind, 'contract': contract, 'intent': intent, 'total': total}
    if tweak:
        tweak(st, rng, lines, ledger)
    if columns == 'due-date-en':
        for line in lines:
            line['due'] = iso(date.fromisoformat(line['date']) + timedelta(days=30))
    balance = st['opening']
    for line in lines:
        if line.get('currency', 'SAR') == 'SAR':
            balance += line['minor']
        line['balance'] = balance
    st['closing'] = balance
    st['pages'] = paginate(lines, per_page)
    st['ledger'] = sorted(ledger, key=lambda e: (e['date'], e['ref']))
    return st


# --- story-specific facts -------------------------------------------------

def timing(st, rng, lines, ledger):
    """The last invoice is on the statement only; one payment the buyer made
    on the last days is in the ledger only."""
    last = max(i for i, line in enumerate(lines) if line['type'] == 'Invoice')
    ledger[:] = [e for e in ledger if e['ref'] != lines[last]['ref']]
    end = date.fromisoformat(st['period']['end'])
    ledger.append({'date': iso(end - timedelta(days=1)), 'ref': f"PMT-{rng.randint(5000, 5999)}", 'type': 'Payment',
                   'minor': -rng.randint(100_000, 900_000), 'desc': 'Posted'})


def variance(st, rng, lines, ledger):
    """One invoice is in the ledger at another amount: two digits swapped."""
    i = next(i for i, e in enumerate(ledger) if e['type'] == 'Invoice' and e['minor'] >= 100_000)
    text = str(ledger[i]['minor'])
    swapped = text[:-4] + text[-3] + text[-4] + text[-2:]
    if swapped == text:
        swapped = text[:-3] + str((int(text[-3]) + 1) % 10) + text[-2:]
    ledger[i]['minor'] = int(swapped)


def duplicate_posting(st, rng, lines, ledger):
    """One invoice is posted twice in the ledger: same number, same amount."""
    i = next(i for i, e in enumerate(ledger) if e['type'] == 'Invoice')
    ledger.append(dict(ledger[i]))


def near_miss(st, rng, lines, ledger):
    """The ledger holds one invoice under a number with two digits swapped,
    same amount and date: a different document number."""
    i = next(i for i, e in enumerate(ledger) if e['type'] == 'Invoice' and e['ref'][-2] != e['ref'][-1])
    ref = ledger[i]['ref']
    ledger[i]['ref'] = ref[:-2] + ref[-1] + ref[-2]


def equal_amounts(st, rng, lines, ledger):
    """Two invoices of the same amount under different numbers, plus timing."""
    invoices = [line for line in lines if line['type'] == 'Invoice']
    invoices[3]['minor'] = invoices[1]['minor']
    for e in ledger:
        if e['ref'] == invoices[3]['ref']:
            e['minor'] = invoices[1]['minor']
    timing(st, rng, lines, ledger)


def wrapped(st, rng, lines, ledger):
    """Descriptions long enough to wrap onto a second line in their cell."""
    long = {'Invoice': ['Supply of galvanised steel fittings for the north warehouse extension, phase two',
                        'Industrial coating materials delivered to site under the annual maintenance agreement'],
            'Payment': ['Transfer received with thanks against the open invoices listed in remittance advice'],
            'Credit Note': ['Credit for coating drums returned damaged from the June delivery to the north site']}
    for k, line in enumerate(lines):
        if k % 2 == 0:
            line['desc'] = long[line['type']][k % len(long[line['type']])]


def two_currencies(st, rng, lines, ledger):
    """Two invoices are billed in US dollars; the ledger holds them at their
    riyal value under the same numbers."""
    picked = [i for i, line in enumerate(lines) if line['type'] == 'Invoice'][1:3]
    for i in picked:
        lines[i]['currency'] = 'USD'
        usd = lines[i]['minor']
        for e in ledger:
            if e['ref'] == lines[i]['ref']:
                e['minor'] = usd * 375 // 100
    for line in lines:
        line.setdefault('currency', 'SAR')


STORIES = [
    story('S01', producer='hexapdf', language='en', columns='split-balance-en', font='Work Sans',
          style={'heading': 'filled', 'rules': 'grid'}, period=('2026-07-01', '2026-07-31'), seed=301,
          counts=(5, 2, 1), per_page=30, intent='One page, every document in both books.'),
    story('S02', producer='hexapdf', language='en', columns='signed-type-en', font='Fira Sans',
          style={'heading': 'rule', 'rules': 'rows'}, period=('2026-08-01', '2026-08-31'), dates='dmy', seed=302,
          counts=(14, 5, 2), per_page=13, intent='Two pages, day-first dates, a timing difference on each side.',
          tweak=timing),
    story('S03', producer='hexapdf', language='en', columns='ref-first-en', font='Merriweather',
          style={'heading': 'grey', 'rules': 'stripes'}, period=('2026-09-01', '2026-09-30'), numbers='comma',
          seed=303, counts=(7, 3, 1), per_page=30,
          intent='Reference first, decimal comma, one invoice at another amount in the ledger.', tweak=variance),
    story('S04', producer='hexapdf', language='en', columns='due-date-en', font='Space Mono',
          style={'heading': 'rule', 'rules': 'grid'}, period=('2026-07-01', '2026-07-31'), negative='parens',
          seed=304, counts=(12, 4, 2), per_page=11,
          intent='Two dates per line, negatives in parentheses, one invoice posted twice in the ledger.',
          tweak=duplicate_posting),
    story('S05', producer='pdflib', language='en', columns='signed-type-en', font='Alexandria',
          style={'heading': 'grey', 'rules': 'grid'}, period=('2026-10-01', '2026-10-31'), seed=305,
          counts=(6, 2, 3), per_page=30,
          intent='Credit notes; the ledger holds one invoice under a number with two digits swapped.',
          tweak=near_miss),
    story('S06', producer='pdflib', language='en', columns='split-balance-en', font='Readex Pro',
          style={'heading': 'filled', 'rules': 'rows'}, period=('2026-08-01', '2026-08-31'), dates='dmy',
          seed=306, counts=(22, 8, 3), per_page=12, total=True,
          intent='Three pages, a total line, two invoices of one amount, a timing difference on each side.',
          tweak=equal_amounts),
    story('S07', producer='pdflib', language='ar', columns='split-balance-ar', font='Tajawal',
          style={'heading': 'filled', 'rules': 'grid', 'amounts': 'end'}, period=('2026-07-01', '2026-07-31'),
          seed=307, counts=(6, 2, 1), per_page=30, intent='Arabic, one page, every document in both books.'),
    story('S08', producer='pdflib', language='ar', columns='signed-type-ar', font='Alexandria',
          style={'heading': 'grey', 'rules': 'rows'}, period=('2026-09-01', '2026-09-30'), digits='arabic',
          negative='parens', seed=308, counts=(12, 4, 2), per_page=10,
          intent='Arabic with Arabic-Indic digits, two pages, a timing difference on each side.', tweak=timing),
    story('S09', producer='pdflib', language='ar', columns='split-balance-ar', font='Rubik',
          style={'heading': 'rule', 'rules': 'stripes'}, period=('2026-10-01', '2026-10-31'), seed=309,
          counts=(20, 7, 3), per_page=11, total=True,
          intent='Arabic, three pages, forward balances, a total line, one invoice at another amount.',
          tweak=variance),
    story('R10', producer='hexapdf', language='en', columns='signed-type-en', font='Work Sans',
          style={'heading': 'rule', 'rules': 'grid'}, period=('2026-07-01', '2026-07-31'), seed=310,
          counts=(5, 2, 1), per_page=30, kind='reserved', contract='flag-or-solve',
          intent='Descriptions wrapped onto a second line.', tweak=wrapped),
    story('R11', producer='pdflib', language='en', columns='net-value-en', font='Readex Pro',
          style={'heading': 'grey', 'rules': 'grid'}, period=('2026-08-01', '2026-08-31'), seed=311,
          counts=(6, 2, 1), per_page=30, kind='reserved', contract='flag-or-solve',
          intent='The amount column is headed Net Value, a heading the contract does not name.'),
    story('R12', producer='pdflib', language='en', columns='currency-en', font='Work Sans',
          style={'heading': 'filled', 'rules': 'rows'}, period=('2026-09-01', '2026-09-30'), seed=312,
          counts=(7, 2, 1), per_page=30, kind='reserved', contract='flag-or-solve',
          intent='A currency on every line; two invoices in US dollars.', tweak=two_currencies),
]

if __name__ == '__main__':
    print(json.dumps(STORIES, ensure_ascii=False, indent=1))
