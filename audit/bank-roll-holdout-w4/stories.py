"""WF-1 ROLL-1 W4 holdout: bank statements and cashbooks over consecutive
periods from November 2026 to April 2027, and the previous-period session
each story brings.

A new lineage, written apart from the foundation's generator
(audit/bank-roll-foundation/stories.mjs) and in another language: its own
random source (SplitMix64), banks, accounts, reference styles, narratives
and calendar. The calendar crosses a year end and a 28-day February, so that
"the day after the previous period ends" is tested where months and years
turn. Each period is one account, one currency and one month, printed in the
bank-statement-native-1 layout by one of two writers the bank statement
reader has met in a sealed holdout (G23): the HexaPDF statement service and
the pdf-lib statement application, copied here with their renderers.

The facts keep the foundation's schema, so that the foundation's oracle
reads them unchanged: per period the printed lines of every page and the
cashbook rows, and per story the previous session (which periods it holds,
the decisions recorded in it by the product's case numbering derived here
from the documented order, and any fault planted in it). `print` says how a
story's statements are drawn. `recipe` says how the story was made; `intent`
is the expected outcome, written by hand. The oracle reads neither.

  python3 -B audit/bank-roll-holdout-w4/stories.py > stories.json
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

VERSION = 'bank-roll-holdout-w4-1'
HERE = Path(__file__).resolve().parent
WINDOW = json.loads((HERE.parent / 'bank-statement-foundation' / 'contract.json').read_text())['matching']['dateWindowDays']
MONTHS = {
    'NOV': ('2026-11-01', '2026-11-30'),
    'DEC': ('2026-12-01', '2026-12-31'),
    'JAN': ('2027-01-01', '2027-01-31'),
    'FEB': ('2027-02-01', '2027-02-28'),
    'MAR': ('2027-03-01', '2027-03-31'),
    'APR': ('2027-04-01', '2027-04-30'),
}


class Random:
    """SplitMix64: a small generator whose sequence does not depend on the
    Python version."""

    def __init__(self, seed):
        self.x = seed & 0xFFFFFFFFFFFFFFFF

    def next(self):
        self.x = (self.x + 0x9E3779B97F4A7C15) & 0xFFFFFFFFFFFFFFFF
        z = self.x
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & 0xFFFFFFFFFFFFFFFF
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & 0xFFFFFFFFFFFFFFFF
        return z ^ (z >> 31)

    def int(self, lo, hi):
        return lo + self.next() % (hi - lo + 1)


def day(month, d):
    start = date.fromisoformat(MONTHS[month][0])
    return (start + timedelta(days=d - 1)).isoformat()


# Reference styles, one per story: (statement-and-cashbook reference of the
# n-th ordinary movement, out or in).
STYLES = {
    'chk': lambda tag, n, out: (f'CHK{tag}{n:03d}' if out else f'FT{tag}{n:03d}'),
    'slash': lambda tag, n, out: (f'PAY/{tag}/{n:02d}' if out else f'RCV/{tag}/{n:02d}'),
    'dotted': lambda tag, n, out: (f'DD.{tag}.{n:02d}' if out else f'CR.{tag}.{n:02d}'),
    'long': lambda tag, n, out: (f'SUP{tag}000{n:02d}' if out else f'CUS{tag}000{n:02d}'),
}
NARRATIVE = {
    'en': {
        'out': ['Supplier settlement', 'Utility bill', 'Card scheme fees', 'Courier services', 'Office lease'],
        'in': ['Customer remittance', 'Card settlement', 'Distributor payment', 'Marketplace payout'],
        'cash_out': 'Payment voucher', 'cash_in': 'Receipt voucher',
    },
    'ar': {
        'out': ['سداد مورد', 'فاتورة كهرباء', 'رسوم بطاقات', 'خدمات شحن', 'إيجار مكتب'],
        'in': ['حوالة عميل', 'تسوية بطاقات', 'دفعة موزع', 'مستحقات متجر إلكتروني'],
        'cash_out': 'سند صرف', 'cash_in': 'سند قبض',
    },
}


def ordinary(rnd, month, count, tag, style, layout):
    """`count` ordinary movements of one month, each recorded on both sides
    under the same explicit reference, dated within the window."""
    words = NARRATIVE[layout]
    bank, cash = [], []
    for i in range(count):
        d = 4 + (20 * i) // max(count - 1, 1)
        out = rnd.int(0, 1) == 1
        amount = rnd.int(90, 48000) * 100 + rnd.int(0, 99)
        ref = STYLES[style](tag, i + 1, out)
        what = words['out' if out else 'in'][rnd.int(0, len(words['out' if out else 'in']) - 1)]
        bank.append({'date': day(month, d), 'valueDate': day(month, d), 'description': what, 'reference': ref,
                     'withdrawal': amount if out else 0, 'deposit': 0 if out else amount})
        cash.append({'date': day(month, max(d - rnd.int(0, 2), 1)), 'voucher': f"{'PV' if out else 'RV'}-{tag}{i + 1:02d}",
                     'description': words['cash_out' if out else 'cash_in'], 'reference': ref,
                     'receipt': 0 if out else amount, 'payment': amount if out else 0})
    return bank, cash


def by_date(rows):
    return [r for _, r in sorted(enumerate(rows), key=lambda x: (x[1]['date'], x[0]))]


class Period:
    def __init__(self, rnd, story, month, *, bank=(), cash=(), count=5, opening=None, currency='SAR',
                 per_page=8, style='chk', layout='en', drop_page=None):
        tag = f'{story.sid[1:]}{month[:1]}{month[2:]}'
        b, c = ordinary(rnd, month, count, tag, style, layout)
        self.id, self.month, self.currency, self.per_page = f'{story.sid}-{month}', month, currency, per_page
        self.opening = opening if opening is not None else rnd.int(15000, 750000) * 100
        self.bank, self.cash = by_date(b + list(bank)), by_date(c + list(cash))
        self.account, self.drop_page = story.account, drop_page

    def closing(self):
        return self.opening + sum(r['deposit'] - r['withdrawal'] for r in self.bank)

    def statement(self):
        """The printed pages, as bank-statement-native-1 prints them; a
        dropped page is left out with the others' numbering unchanged."""
        balance, rows = self.opening, []
        for r in self.bank:
            balance += r['deposit'] - r['withdrawal']
            rows.append(dict(r, balance=balance))
        chunks = [(i, min(i + self.per_page, len(rows))) for i in range(0, len(rows), self.per_page)]
        pages = []
        for k, (lo, hi) in enumerate(chunks):
            number = k + 1
            lines = [{'kind': 'opening', 'balance': self.opening} if number == 1
                     else {'kind': 'brought-forward', 'balance': rows[lo - 1]['balance']}]
            for j, r in enumerate(rows[lo:hi]):
                lines.append({'kind': 'movement', 'key': f'S{lo + j + 1}', 'date': r['date'], 'valueDate': r['valueDate'],
                              'description': r['description'], 'reference': r['reference'],
                              'withdrawal': r['withdrawal'], 'deposit': r['deposit'], 'balance': r['balance']})
            if number < len(chunks):
                lines.append({'kind': 'carried-forward', 'balance': rows[hi - 1]['balance']})
            else:
                lines.append({'kind': 'closing', 'balance': rows[-1]['balance'] if rows else self.opening})
                lines.append({'kind': 'totals', 'withdrawal': sum(r['withdrawal'] for r in rows),
                              'deposit': sum(r['deposit'] for r in rows)})
            pages.append({'number': number, 'of': len(chunks), 'lines': lines})
        if self.drop_page:
            pages = [p for p in pages if p['number'] != self.drop_page]
        start, end = MONTHS[self.month]
        return {'account': self.account, 'currency': self.currency, 'period': {'start': start, 'end': end}, 'pages': pages}

    def sid(self, row):
        return f'S{self.bank.index(row) + 1}'


def case_of(p, members):
    """The product's case numbering in a session (bank-statement-lifecycle-1):
    automatic pairs and reference review groups in ascending reference order,
    then amount components by their first member key, cashbook keys before
    statement keys. Used only to name the case a recorded decision takes."""
    S = {id(r): f'S{i + 1}' for i, r in enumerate(p.bank)}
    refs = sorted({r['reference'] for r in p.bank + p.cash if r['reference']})
    auto, review, used = [], [], set()
    days = lambda a, b: abs((date.fromisoformat(a) - date.fromisoformat(b)).days)  # noqa: E731
    for ref in refs:
        b = [r for r in p.bank if r['reference'] == ref]
        c = [r for r in p.cash if r['reference'] == ref]
        if not b or not c:
            continue
        key = {'statement': [S[id(r)] for r in b], 'cashbook': [r['voucher'] for r in c]}
        one = len(b) == 1 and len(c) == 1
        same = one and (b[0]['withdrawal'] or b[0]['deposit']) == (c[0]['payment'] or c[0]['receipt']) \
            and bool(b[0]['withdrawal']) == bool(c[0]['payment']) and days(b[0]['date'], c[0]['date']) <= WINDOW
        (auto if same else review).append(key)
        used.update(id(r) for r in b + c)
    rest = []
    for r in p.bank:
        if id(r) in used:
            continue
        for c in p.cash:
            if id(c) in used:
                continue
            if bool(r['withdrawal']) == bool(c['payment']) and (r['withdrawal'] or r['deposit']) == (c['payment'] or c['receipt']) \
                    and days(r['date'], c['date']) <= WINDOW:
                rest.append({'statement': [S[id(r)]], 'cashbook': [c['voucher']], 'first': f"C:{c['voucher']}"})
    rest.sort(key=lambda x: x['first'])
    cases = auto + review + [{'statement': x['statement'], 'cashbook': x['cashbook']} for x in rest]
    k = cases.index(members)
    return {'case': f'C{k + 1}', **members}


class Story:
    def __init__(self, sid, title, *, producer, font, paper, style, bank, title_doc, account, layout='en',
                 digits='latin', refs='chk'):
        self.sid, self.title, self.layout, self.digits, self.refs = sid, title, layout, digits, refs
        self.account = account
        self.print = {'producer': producer, 'font': font, 'paper': paper, 'style': style, 'bank': bank,
                      'documentTitle': title_doc}
        self.rnd = Random(0x57A11 * 1000 + int(sid[1:]))
        self.periods, self.previous, self.recipe, self.intent = [], None, '', {}

    def period(self, month, **kw):
        p = Period(self.rnd, self, month, style=self.refs, layout=self.layout, **kw)
        self.periods.append(p)
        return p

    # Items as the intent names them: the month, then S<n> or the voucher.
    @staticmethod
    def S(p, row):
        return f'{p.month}:{p.sid(row)}'

    @staticmethod
    def C(p, voucher):
        return f'{p.month}:{voucher}'


def cheque(month, d, ref, amount, voucher, what='Payment voucher'):
    return {'date': day(month, d), 'voucher': voucher, 'description': what, 'reference': ref, 'receipt': 0, 'payment': amount}


def receipt(month, d, ref, amount, voucher, what='Receipt voucher'):
    return {'date': day(month, d), 'voucher': voucher, 'description': what, 'reference': ref, 'receipt': amount, 'payment': 0}


def debit(month, d, ref, amount, what):
    return {'date': day(month, d), 'valueDate': day(month, d), 'description': what, 'reference': ref,
            'withdrawal': amount, 'deposit': 0}


def credit(month, d, ref, amount, what):
    return {'date': day(month, d), 'valueDate': day(month, d), 'description': what, 'reference': ref,
            'withdrawal': 0, 'deposit': amount}


def carried(c, *items, still=None, cases=(), previous='accepted'):
    return {'previous': previous, 'carried': list(items), 'cases': list(cases), 'stillCarried': still or []}


def build():
    stories = []

    def add(story, make):
        make(story)
        stories.append(story)

    H = Story

    def h01(s):
        dec = s.period('DEC', cash=[cheque('DEC', 30, 'CHK-H01-77310', 731250, 'PV-H01-90')])
        jan = s.period('JAN', opening=dec.closing(), bank=[debit('JAN', 5, 'CHK-H01-77310', 731250, 'Cheque presented')])
        s.previous = {'holds': ['DEC'], 'decisions': []}
        s.recipe = 'a cheque written on 30 December is presented on 5 January, across the year end'
        s.intent = carried(s, H.C(dec, 'PV-H01-90'), cases=[{'reason': 'carried-reference', 'carried': [H.C(dec, 'PV-H01-90')],
                                                              'current': [H.S(jan, jan.bank[i]) for i, r in enumerate(jan.bank) if r['reference'] == 'CHK-H01-77310']}])
    add(H('H01', 'A cheque outstanding at the year end clears in January', producer='pdflib', font='Rubik', paper='A4',
          style={'rules': 'grid', 'heading': 'filled'}, bank='Harbour Gate Bank', title_doc='Current Account Statement',
          account='SA61 8000 0000 6127 0400 9901', refs='chk'), h01)

    def h02(s):
        jan = s.period('JAN', cash=[receipt('JAN', 31, 'DEP-H02-0131', 1846000, 'RV-H02-41', 'Cash deposited after cut-off')], per_page=4)
        feb = s.period('FEB', opening=jan.closing(), bank=[credit('FEB', 1, 'DEP-H02-0131', 1846000, 'Branch cash deposit')], per_page=4)
        s.previous = {'holds': ['JAN'], 'decisions': []}
        s.recipe = 'a receipt recorded on 31 January reaches the bank on 1 February; both statements run to two pages'
        s.intent = carried(s, H.C(jan, 'RV-H02-41'), cases=[{'reason': 'carried-reference', 'carried': [H.C(jan, 'RV-H02-41')],
                                                              'current': [H.S(feb, r) for r in feb.bank if r['reference'] == 'DEP-H02-0131']}])
    add(H('H02', 'A deposit in transit across the end of January', producer='hexapdf', font='Work Sans', paper='A4',
          style={'rules': 'grid', 'heading': 'filled'}, bank='Northwind Commerce Bank', title_doc='Account Statement',
          account='SA02 4500 0000 1984 2200 7702', refs='slash'), h02)

    def h03(s):
        feb = s.period('FEB', bank=[credit('FEB', 28, 'INT-H03-2802', 41875, 'Credit interest February')])
        mar = s.period('MAR', opening=feb.closing(), cash=[receipt('MAR', 2, 'INT-H03-2802', 41875, 'RV-H03-12', 'Bank interest February')])
        s.previous = {'holds': ['FEB'], 'decisions': []}
        s.recipe = 'the bank credits interest on 28 February, the last day of a 28-day month; the company books it on 2 March'
        item = [H.S(feb, r) for r in feb.bank if r['reference'] == 'INT-H03-2802']
        s.intent = carried(s, *item, cases=[{'reason': 'carried-reference', 'carried': item, 'current': [H.C(mar, 'RV-H03-12')]}])
    add(H('H03', 'Interest credited on the last day of February, booked in March', producer='hexapdf', font='Merriweather',
          paper='A4', style={'rules': 'rows', 'heading': 'rule'}, bank='Northwind Commerce Bank', title_doc='Account Statement',
          account='SA02 4500 0000 1984 2200 7703', refs='dotted'), h03)

    def h04(s):
        nov = s.period('NOV', cash=[cheque('NOV', 27, 'CHQ-H04-5521', 2290000, 'PV-H04-55')])
        dec = s.period('DEC', opening=nov.closing())
        jan = s.period('JAN', opening=dec.closing(), bank=[debit('JAN', 12, 'CHQ-H04-5521', 2290000, 'Cheque presented')])
        s.previous = {'holds': ['NOV', 'DEC'], 'decisions': []}
        s.recipe = ('a cheque written on 27 November is not presented in December and is presented on 12 January; '
                    'the December session is in the roll format and holds the November session')
        s.intent = carried(s, H.C(nov, 'PV-H04-55'), cases=[{'reason': 'carried-reference', 'carried': [H.C(nov, 'PV-H04-55')],
                                                              'current': [H.S(jan, r) for r in jan.bank if r['reference'] == 'CHQ-H04-5521']}])
        s.intent['ageOfCarried'] = 2
    add(H('H04', 'A chain over the year end: a November cheque presented in January', producer='hexapdf', font='Fira Sans',
          paper='A4-landscape', style={'rules': 'stripes', 'heading': 'filled'}, bank='Harbour Gate Bank',
          title_doc='Current Account Statement', account='SA61 8000 0000 6127 0400 9904', refs='long'), h04)

    def h05(s):
        dec = s.period('DEC', cash=[cheque('DEC', 29, 'CHK-H05-60221', 405500, 'PV-H05-61'),
                                    cheque('DEC', 30, '', 128940, 'PV-H05-62', 'Petty cash top-up')])
        jan = s.period('JAN', opening=dec.closing(), bank=[debit('JAN', 6, 'CHK-H05-60221', 405500, 'Cheque presented'),
                                                            debit('JAN', 7, '', 128940, 'Counter withdrawal')])
        s.previous = {'holds': ['DEC'], 'decisions': []}
        s.recipe = 'a referenced cheque and an unreferenced payment are outstanding in December; January shows both'
        ref = [H.S(jan, r) for r in jan.bank if r['reference'] == 'CHK-H05-60221']
        bare = [H.S(jan, r) for r in jan.bank if r['reference'] == '' and r['withdrawal'] == 128940]
        s.intent = carried(s, H.C(dec, 'PV-H05-61'), H.C(dec, 'PV-H05-62'), cases=[
            {'reason': 'carried-reference', 'carried': [H.C(dec, 'PV-H05-61')], 'current': ref},
            {'reason': 'carried-amount-suggestion', 'carried': [H.C(dec, 'PV-H05-62')], 'current': bare}])
    add(H('H05', 'Two carried payments: one by reference, one by amount', producer='pdflib', font='Readex Pro',
          paper='A4-landscape', style={'rules': 'stripes', 'heading': 'filled'}, bank='Harbour Gate Bank',
          title_doc='Current Account Statement', account='SA61 8000 0000 6127 0400 9905', refs='chk'), h05)

    def h06(s):
        dec = s.period('DEC', cash=[cheque('DEC', 28, 'CHK-H06-31840', 348100, 'PV-H06-31')])
        jan = s.period('JAN', opening=dec.closing(), bank=[debit('JAN', 4, 'CHK-H06-31840', 341800, 'Cheque presented')])
        s.previous = {'holds': ['DEC'], 'decisions': []}
        s.recipe = 'the cheque was written for 3,481.00 and the bank paid 3,418.00, two digits transposed'
        s.intent = carried(s, H.C(dec, 'PV-H06-31'), cases=[{'reason': 'carried-amount-difference', 'carried': [H.C(dec, 'PV-H06-31')],
                                                              'current': [H.S(jan, r) for r in jan.bank if r['reference'] == 'CHK-H06-31840']}])
    add(H('H06', 'A carried cheque paid for another amount', producer='hexapdf', font='Space Mono', paper='Letter',
          style={'rules': 'none', 'heading': 'rule', 'headings': 'left'}, bank='Northwind Commerce Bank',
          title_doc='Account Statement', account='SA02 4500 0000 1984 2200 7706', refs='chk'), h06)

    def h07(s):
        jan = s.period('JAN', cash=[cheque('JAN', 29, 'PAY/H07/X1', 912000, 'PV-H07-71')])
        feb = s.period('FEB', opening=jan.closing(), cash=[cheque('JAN', 29, 'PAY/H07/X1', 912000, 'PV-H07-88', 'Payment voucher (re-entered)')],
                       bank=[debit('FEB', 3, 'PAY/H07/X1', 912000, 'Supplier transfer')])
        s.previous = {'holds': ['JAN'], 'decisions': []}
        s.recipe = ('the February cashbook carries the January payment again under a new voucher, same reference, '
                    'date and amount; the February statement pays it')
        s.intent = carried(s, H.C(jan, 'PV-H07-71'), cases=[{'reason': 'carried-repeated', 'carried': [H.C(jan, 'PV-H07-71')],
                                                              'current': [H.S(feb, r) for r in feb.bank if r['reference'] == 'PAY/H07/X1'] + [H.C(feb, 'PV-H07-88')]}])
    add(H('H07', 'A carried payment re-entered under a new voucher', producer='pdflib', font='Lemonada', paper='A4',
          style={'rules': 'rows', 'heading': 'rule'}, bank='Harbour Gate Bank', title_doc='Current Account Statement',
          account='SA61 8000 0000 6127 0400 9907', refs='slash'), h07)

    def h08(s):
        dec = s.period('DEC', bank=[debit('DEC', 31, 'FEE.H08.Q4', 57500, 'Quarterly service charge')])
        jan = s.period('JAN', opening=dec.closing(), bank=[debit('JAN', 3, 'FEE.H08.Q4', 57500, 'Quarterly service charge')],
                       cash=[cheque('JAN', 3, 'FEE.H08.Q4', 57500, 'PV-H08-04', 'Bank charges Q4')])
        s.previous = {'holds': ['DEC'], 'decisions': []}
        s.recipe = ('the bank charges the quarterly fee on 31 December and again on 3 January under the same reference; '
                    'the company books it once, on 3 January')
        item = [H.S(dec, r) for r in dec.bank if r['reference'] == 'FEE.H08.Q4']
        s.intent = carried(s, *item, cases=[{'reason': 'carried-restated', 'carried': item,
                                             'current': [H.S(jan, r) for r in jan.bank if r['reference'] == 'FEE.H08.Q4'] + [H.C(jan, 'PV-H08-04')]}])
    add(H('H08', 'A carried bank charge charged again in January', producer='hexapdf', font='Work Sans', paper='A4',
          style={'rules': 'grid', 'heading': 'filled'}, bank='Northwind Commerce Bank', title_doc='Account Statement',
          account='SA02 4500 0000 1984 2200 7708', refs='dotted'), h08)

    def h09(s):
        dec = s.period('DEC', cash=[cheque('DEC', 30, 'CHK-H09-88412', 266000, 'PV-H09-84')])
        jan = s.period('JAN', opening=dec.closing(), per_page=4,
                       bank=[debit('JAN', 5, 'CHK-H09-88412', 266000, 'Cheque presented'),
                             debit('JAN', 9, 'CHK-H09-88412', 266000, 'Cheque presented')])
        s.previous = {'holds': ['DEC'], 'decisions': []}
        s.recipe = 'the bank pays the carried cheque twice, on 5 and 9 January'
        s.intent = carried(s, H.C(dec, 'PV-H09-84'), cases=[{'reason': 'carried-ambiguous', 'carried': [H.C(dec, 'PV-H09-84')],
                                                              'current': [H.S(jan, r) for r in jan.bank if r['reference'] == 'CHK-H09-88412']}])
    add(H('H09', 'A carried cheque paid twice', producer='pdflib', font='Rubik', paper='A4',
          style={'rules': 'grid', 'heading': 'filled'}, bank='Harbour Gate Bank', title_doc='Current Account Statement',
          account='SA61 8000 0000 6127 0400 9909', refs='chk'), h09)

    def h10(s):
        feb = s.period('FEB', cash=[cheque('FEB', 26, '', 74250, 'PV-H10-26', 'Courier advance')])
        mar = s.period('MAR', opening=feb.closing(), bank=[debit('MAR', 2, '', 74250, 'Counter withdrawal'),
                                                            debit('MAR', 16, '', 74250, 'Counter withdrawal')])
        s.previous = {'holds': ['FEB'], 'decisions': []}
        s.recipe = 'an unreferenced February payment; March shows two unreferenced withdrawals of the same amount'
        s.intent = carried(s, H.C(feb, 'PV-H10-26'), cases=[{'reason': 'carried-ambiguous', 'carried': [H.C(feb, 'PV-H10-26')],
                                                              'current': [H.S(mar, r) for r in mar.bank if r['reference'] == '' and r['withdrawal'] == 74250]}])
    add(H('H10', 'An unreferenced carried payment with two candidates', producer='hexapdf', font='Merriweather', paper='A4',
          style={'rules': 'rows', 'heading': 'rule'}, bank='Northwind Commerce Bank', title_doc='Account Statement',
          account='SA02 4500 0000 1984 2200 7710', refs='long'), h10)

    def h11(s):
        jan = s.period('JAN', cash=[cheque('JAN', 30, 'CHK-H11-10311', 155000, 'PV-H11-03')])
        s.period('MAR', opening=jan.closing() + 3810000, bank=[debit('MAR', 4, 'CHK-H11-10311', 155000, 'Cheque presented')])
        s.previous = {'holds': ['JAN'], 'decisions': []}
        s.recipe = 'the January session is brought to the March statement; February is missing'
        s.intent = carried(s, previous='ROLL_NOT_CONSECUTIVE')
    add(H('H11', 'A previous session that skips February', producer='pdflib', font='Readex Pro', paper='A4',
          style={'rules': 'rows', 'heading': 'rule'}, bank='Harbour Gate Bank', title_doc='Current Account Statement',
          account='SA61 8000 0000 6127 0400 9911', refs='slash'), h11)

    def h12(s):
        dec = s.period('DEC', currency='USD', cash=[cheque('DEC', 29, 'CHK-H12-22031', 88000, 'PV-H12-20')])
        s.period('JAN', opening=dec.closing(), bank=[debit('JAN', 6, 'CHK-H12-22031', 88000, 'Cheque presented')])
        s.previous = {'holds': ['DEC'], 'decisions': []}
        s.recipe = 'the December session is the dollar account; January is the riyal account'
        s.intent = carried(s, previous='ROLL_CURRENCY')
    add(H('H12', 'A previous session of another currency', producer='hexapdf', font='Space Mono', paper='Letter',
          style={'rules': 'none', 'heading': 'rule', 'headings': 'left'}, bank='Northwind Commerce Bank',
          title_doc='Account Statement', account='SA02 4500 0000 1984 2200 7712', refs='chk'), h12)

    def h13(s):
        dec = s.period('DEC', cash=[cheque('DEC', 29, 'CHK-H13-23310', 190500, 'PV-H13-23')])
        s.period('JAN', opening=dec.closing() - 100, bank=[debit('JAN', 5, 'CHK-H13-23310', 190500, 'Cheque presented')])
        s.previous = {'holds': ['DEC'], 'decisions': []}
        s.recipe = "January's printed opening balance is one riyal below December's printed closing balance"
        s.intent = carried(s, previous='ROLL_OPENING')
    add(H('H13', 'An opening balance one riyal off the previous closing', producer='pdflib', font='Lemonada', paper='A4',
          style={'rules': 'rows', 'heading': 'rule'}, bank='Harbour Gate Bank', title_doc='Current Account Statement',
          account='SA61 8000 0000 6127 0400 9913', refs='dotted'), h13)

    def h14(s):
        dec = s.period('DEC', bank=[credit('DEC', 14, '', 62500, 'Cash deposit')],
                       cash=[receipt('DEC', 15, '', 62500, 'RV-H14-15', 'Counter receipt'),
                             cheque('DEC', 30, 'CHK-H14-41441', 301000, 'PV-H14-41')])
        s.period('JAN', opening=dec.closing(), bank=[debit('JAN', 6, 'CHK-H14-41441', 301000, 'Cheque presented')])
        s.previous = {'holds': ['DEC'], 'decisions': []}
        s.recipe = 'December leaves an amount and date suggestion undecided'
        s.intent = carried(s, previous='ROLL_PREVIOUS_UNDECIDED')
    add(H('H14', 'The previous period has an undecided suggestion', producer='hexapdf', font='Fira Sans', paper='A4-landscape',
          style={'rules': 'stripes', 'heading': 'filled'}, bank='Northwind Commerce Bank', title_doc='Account Statement',
          account='SA02 4500 0000 1984 2200 7714', refs='long'), h14)

    def h15(s):
        dec = s.period('DEC', count=12, per_page=5, drop_page=2, cash=[cheque('DEC', 30, 'CHK-H15-55150', 117500, 'PV-H15-55')])
        s.period('JAN', opening=dec.closing(), bank=[debit('JAN', 5, 'CHK-H15-55150', 117500, 'Cheque presented')])
        s.previous = {'holds': ['DEC'], 'decisions': []}
        s.recipe = 'the December statement in the session is pages 1 and 3 of 3; page 2 was never printed'
        s.intent = carried(s, previous='ROLL_PREVIOUS_HELD')
    add(H('H15', 'The previous statement misses a page', producer='pdflib', font='Rubik', paper='A4',
          style={'rules': 'grid', 'heading': 'filled'}, bank='Harbour Gate Bank', title_doc='Current Account Statement',
          account='SA61 8000 0000 6127 0400 9915', refs='chk'), h15)

    def h16(s):
        dec = s.period('DEC', cash=[cheque('DEC', 29, 'CHK-H16-66160', 98500, 'PV-H16-66')])
        s.period('JAN', opening=dec.closing(), bank=[debit('JAN', 5, 'CHK-H16-66160', 98500, 'Cheque presented')])
        s.previous = {'holds': ['DEC'], 'decisions': [], 'tamper': 'version'}
        s.recipe = 'the session file declares version bank-statement-lifecycle-2, which the product does not read'
        s.intent = carried(s, previous='ROLL_PREVIOUS_UNREADABLE')
    add(H('H16', 'A session of a version the product does not know', producer='hexapdf', font='Work Sans', paper='A4',
          style={'rules': 'grid', 'heading': 'filled'}, bank='Northwind Commerce Bank', title_doc='Account Statement',
          account='SA02 4500 0000 1984 2200 7716', refs='slash'), h16)

    def h17(s):
        bank_row = debit('DEC', 18, '', 210000, 'Standing order')
        cash_row = cheque('DEC', 19, '', 210000, 'PV-H17-19', 'Contractor advance')
        dec = s.period('DEC', bank=[bank_row], cash=[cash_row])
        jan = s.period('JAN', opening=dec.closing(), bank=[debit('JAN', 8, '', 210000, 'Counter cheque paid')])
        decision = case_of(dec, {'statement': [dec.sid(bank_row)], 'cashbook': ['PV-H17-19']})
        s.previous = {'holds': ['DEC'], 'decisions': [{'type': 'reject', **decision,
                                                       'note': 'Standing order to the landlord, not the contractor advance'}]}
        s.recipe = ('December: an unreferenced debit and an unreferenced payment of the same amount a day apart, rejected '
                    'by the accountant; January pays the advance as an unreferenced counter cheque')
        s.intent = carried(s, H.S(dec, bank_row), H.C(dec, 'PV-H17-19'), cases=[
            {'reason': 'carried-amount-suggestion', 'carried': [H.C(dec, 'PV-H17-19')],
             'current': [H.S(jan, r) for r in jan.bank if r['reference'] == '' and r['withdrawal'] == 210000]}],
            still=[{'item': H.S(dec, bank_row), 'age': 2}])
        s.intent['origin'] = decision['case']
    add(H('H17', 'A rejected suggestion carries both members; one clears', producer='pdflib', font='Readex Pro', paper='A4',
          style={'rules': 'rows', 'heading': 'rule'}, bank='Harbour Gate Bank', title_doc='Current Account Statement',
          account='SA61 8000 0000 6127 0400 9917', refs='long'), h17)

    def h18(s):
        dec = s.period('DEC', cash=[cheque('DEC', 30, 'CHK-H18-18800', 562500, 'PV-H18-18', 'سند صرف شيك')])
        jan = s.period('JAN', opening=dec.closing(), per_page=4, bank=[debit('JAN', 6, 'CHK-H18-18800', 562500, 'شيك مقدم للصرف')])
        s.previous = {'holds': ['DEC'], 'decisions': []}
        s.recipe = 'an Arabic statement with Arabic-Indic digits: a December cheque presented in January'
        s.intent = carried(s, H.C(dec, 'PV-H18-18'), cases=[{'reason': 'carried-reference', 'carried': [H.C(dec, 'PV-H18-18')],
                                                              'current': [H.S(jan, r) for r in jan.bank if r['reference'] == 'CHK-H18-18800']}])
    add(H('H18', 'Arabic, Arabic-Indic digits: a carried cheque presented', producer='pdflib', font='Cairo', paper='A4',
          style={'rules': 'rows', 'heading': 'filled'}, bank='مصرف وادي النور', title_doc='كشف حساب جاري',
          account='SA77 3100 0000 5541 0800 1818', layout='ar', digits='arabic', refs='chk'), h18)

    def h19(s):
        dec = s.period('DEC', cash=[cheque('DEC', 29, 'CHK-H19-19911', 440000, 'PV-H19-19', 'سند صرف شيك')])
        s.period('JAN', opening=dec.closing(), bank=[debit('JAN', 7, 'CHK-H19-19922', 440000, 'شيك مقدم للصرف')])
        s.previous = {'holds': ['DEC'], 'decisions': []}
        s.recipe = 'an Arabic statement with Latin digits: January pays another cheque of the same amount; the carried one waits'
        s.intent = carried(s, H.C(dec, 'PV-H19-19'), still=[{'item': H.C(dec, 'PV-H19-19'), 'age': 2}])
    add(H('H19', 'Arabic, Latin digits: an equal amount under another reference', producer='pdflib', font='Tajawal', paper='A4',
          style={'rules': 'rows', 'heading': 'filled'}, bank='مصرف وادي النور', title_doc='كشف حساب جاري',
          account='SA77 3100 0000 5541 0800 1819', layout='ar', digits='latin', refs='slash'), h19)

    def h20(s):
        dec = s.period('DEC', cash=[cheque('DEC', 30, 'CHK-H20-20020', 66600, 'PV-H20-20')])
        s.period('JAN', opening=dec.closing(), bank=[debit('JAN', 5, 'CHK-H20-20020', 66600, 'Cheque presented')])
        s.previous = None
        s.recipe = 'January alone; the cheque written in December has no counterpart there'
        s.intent = carried(s, previous='none')
    add(H('H20', 'No previous session', producer='hexapdf', font='Merriweather', paper='A4',
          style={'rules': 'rows', 'heading': 'rule'}, bank='Northwind Commerce Bank', title_doc='Account Statement',
          account='SA02 4500 0000 1984 2200 7720', refs='dotted'), h20)

    def h21(s):
        bank_row = credit('DEC', 10, '', 133300, 'Cash deposit')
        cash_row = receipt('DEC', 11, '', 133300, 'RV-H21-11', 'Counter receipt')
        dec = s.period('DEC', bank=[bank_row], cash=[cash_row, cheque('DEC', 30, 'CHK-H21-21210', 257000, 'PV-H21-21')])
        jan = s.period('JAN', opening=dec.closing(), bank=[debit('JAN', 4, 'CHK-H21-21210', 257000, 'Cheque presented')])
        decision = case_of(dec, {'statement': [dec.sid(bank_row)], 'cashbook': ['RV-H21-11']})
        s.previous = {'holds': ['DEC'], 'decisions': [{'type': 'accept', **decision,
                                                       'note': 'Counter receipt deposited the day before'}]}
        s.recipe = 'December: an accepted amount and date suggestion and an outstanding cheque; January presents the cheque'
        s.intent = carried(s, H.C(dec, 'PV-H21-21'), cases=[{'reason': 'carried-reference', 'carried': [H.C(dec, 'PV-H21-21')],
                                                              'current': [H.S(jan, r) for r in jan.bank if r['reference'] == 'CHK-H21-21210']}])
    add(H('H21', 'An accepted suggestion is not carried; a cheque is', producer='hexapdf', font='Space Mono', paper='Letter',
          style={'rules': 'none', 'heading': 'rule', 'headings': 'left'}, bank='Northwind Commerce Bank',
          title_doc='Account Statement', account='SA02 4500 0000 1984 2200 7721', refs='chk'), h21)

    def h22(s):
        nov = s.period('NOV', currency='USD', cash=[cheque('NOV', 27, 'CHK-H22-22722', 54000, 'PV-H22-27')])
        dec = s.period('DEC', opening=nov.closing())
        s.period('JAN', opening=dec.closing(), bank=[debit('JAN', 8, 'CHK-H22-22722', 54000, 'Cheque presented')])
        s.previous = {'holds': ['NOV', 'DEC'], 'decisions': []}
        s.recipe = ('the December session is in the roll format and holds a November session of the dollar account: '
                    'December could not carry November, so January cannot read December as closed')
        s.intent = carried(s, previous='ROLL_PREVIOUS_UNREADABLE')
    add(H('H22', 'A chain whose own previous period was refused', producer='pdflib', font='Lemonada', paper='A4',
          style={'rules': 'rows', 'heading': 'rule'}, bank='Harbour Gate Bank', title_doc='Current Account Statement',
          account='SA61 8000 0000 6127 0400 9922', refs='long'), h22)
    return stories


def facts(stories=None):
    stories = stories or build()
    return {
        'version': VERSION,
        'stories': [{
            'id': s.sid, 'title': s.title, 'layout': s.layout, 'digits': s.digits, 'print': s.print,
            'periods': [{'id': p.id, 'statement': p.statement(),
                         'cashbook': [{k: r[k] for k in ('date', 'voucher', 'description', 'reference', 'receipt', 'payment')}
                                      for r in p.cash]} for p in s.periods],
            'previous': s.previous, 'recipe': s.recipe, 'intent': s.intent,
        } for s in stories],
    }


def facts_json(stories=None):
    return json.dumps(facts(stories), ensure_ascii=False, indent=1) + '\n'


def print_records(f):
    """Each period's statement as the copied G23 renderers and checker read a
    story: one record per printed statement."""
    out = []
    for s in f['stories']:
        for p in s['periods']:
            out.append({'id': p['id'], 'layout': s['layout'], 'digits': s['digits'], 'producer': s['print']['producer'],
                        'font': s['print']['font'], 'paper': s['print']['paper'], 'bank': s['print']['bank'],
                        'documentTitle': s['print']['documentTitle'], 'recipe': {'style': s['print']['style']},
                        'statement': p['statement'], 'cashbook': p['cashbook']})
    return out


if __name__ == '__main__':
    if sys.argv[1:] == ['--records']:
        sys.stdout.write(json.dumps({'stories': print_records(facts())}, ensure_ascii=False, indent=1) + '\n')
    else:
        sys.stdout.write(facts_json())
