"""WF-1 TOL-1 T4 holdout: a declared tolerance on bank statement periods
from January to March 2027, printed by other writers than the foundation's.

A new lineage of stories, written apart from the tolerance foundation's
generator (audit/bank-tolerance-foundation/stories.mjs) and in another
language: its own seed of the W4 random source (SplitMix64), banks, accounts
and calendar. The periods are printed in the bank-statement-native-1 layout
by the two writers the W4, R4 and R3 holdouts used (the HexaPDF statement
service and the pdf-lib statement application), with their renderers,
amounts at the exponent of each statement's currency: SAR 2, KWD 3, JPY 0,
the currencies the sealed foundation oracle knows.

Amount differences are planted by the matching rules of the bank statement
foundation's contract: one movement and one entry under the same explicit
reference, in one direction, with other amounts. What the foundation's
stories do not hold: a receipt difference the book records for less, the
period limit met exactly by differences of both signs and exceeded by one
minor unit, the limits of the dinar at their largest and one past them, the
period limit at one hundred riyals, a yen statement, a reason of non-breaking
spaces, a tolerated pair rejected, undone and rejected again on an Arabic
page carried forward, a difference within the limit whose dates are one day
beyond the window, an overdrawn account, equal limits, a difference across a
million, a rejection that is not of a tolerated pair, and three pages of
differences in Space Mono.

The facts keep the tolerance foundation's schema, so that its sealed oracle
(audit/bank-tolerance-foundation/oracle.py) reads them unchanged: per period
the printed lines and the cashbook rows; per story the declared book balance
and the accountant's actions in order: {policy}, {reject: {statement,
cashbook}} and {undo: {statement, cashbook}} on the case holding exactly
those members. The book balance is the opening balance with the cashbook's
receipts less its payments, and `extra` minor units more where a story says
so: what a book that agreed with the bank at the start would show. `print`
says how a story's statement is drawn. `recipe` says how the story was made;
`intent` is the expected outcome, written by hand. The oracle reads neither.

  python3 -B audit/bank-tolerance-holdout-t4/stories.py > stories.json
  python3 -B audit/bank-tolerance-holdout-t4/stories.py --records > records.json
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

VERSION = 'bank-tolerance-holdout-t4-1'
HERE = Path(__file__).resolve().parent
MONTHS = {
    'JAN': ('2027-01-01', '2027-01-31'),
    'FEB': ('2027-02-01', '2027-02-28'),
    'MAR': ('2027-03-01', '2027-03-31'),
}
EXPONENT = {'SAR': 2, 'KWD': 3, 'JPY': 0}
NOTE = 'Rounding by the payment network'


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


NARRATIVE = {
    'en': {
        'out': ['Supplier settlement', 'Freight forwarding', 'Card scheme fees', 'Maintenance contract', 'Office rent'],
        'in': ['Customer remittance', 'Card settlement', 'Distributor payment', 'Marketplace payout'],
        'cash_out': 'Payment voucher', 'cash_in': 'Receipt voucher',
    },
    'ar': {
        'out': ['سداد مورد', 'شحن بضائع', 'رسوم بطاقات', 'عقد صيانة', 'إيجار مكتب'],
        'in': ['حوالة عميل', 'تسوية بطاقات', 'دفعة موزع', 'مستحقات متجر إلكتروني'],
        'cash_out': 'سند صرف', 'cash_in': 'سند قبض',
    },
}


def ordinary(rnd, month, count, tag, layout, exponent):
    """`count` ordinary movements of one month, each recorded on both sides
    under the same explicit reference, dated within the window: automatic
    matches, with amounts no planted row uses (odd minor units)."""
    words = NARRATIVE[layout]
    bank, cash = [], []
    for i in range(count):
        d = 2 + (25 * i) // max(count - 1, 1)
        out = rnd.int(0, 1) == 1
        if exponent:
            amount = rnd.int(100, 4900) * 10 ** exponent + rnd.int(1, 10 ** exponent - 1)
        else:
            amount = rnd.int(10000, 990000) + 7
        ref = f"{'TRF' if out else 'COL'}{tag}{i + 1:03d}"
        what = words['out' if out else 'in'][rnd.int(0, len(words['out' if out else 'in']) - 1)]
        bank.append({'date': day(month, d), 'valueDate': day(month, d), 'description': what, 'reference': ref,
                     'withdrawal': amount if out else 0, 'deposit': 0 if out else amount})
        cash.append({'date': day(month, max(d - rnd.int(0, 2), 1)), 'voucher': f"{'PV' if out else 'RV'}{tag}{i + 1:02d}",
                     'description': words['cash_out' if out else 'cash_in'], 'reference': ref,
                     'receipt': 0 if out else amount, 'payment': amount if out else 0})
    return bank, cash


def by_date(rows):
    return [r for _, r in sorted(enumerate(rows), key=lambda x: (x[1]['date'], x[0]))]


class Period:
    def __init__(self, rnd, story, month, *, bank=(), cash=(), count=5, opening=None, currency='SAR',
                 per_page=12, layout='en'):
        tag = f'{story.sid[1:]}{month[:2]}'
        exponent = EXPONENT[currency]
        b, c = ordinary(rnd, month, count, tag, layout, exponent)
        self.id, self.month, self.currency, self.per_page = f'{story.sid}-{month}', month, currency, per_page
        # An opening of 200,000 to 900,000 major units; of yen, 20 to 90 million.
        self.opening = opening if opening is not None else (
            rnd.int(20000, 90000) * 10 ** (exponent + 1) if exponent else rnd.int(2000, 9000) * 10 ** 4)
        self.bank, self.cash = by_date(b + list(bank)), by_date(c + list(cash))
        self.account = story.account

    def statement(self):
        """The printed pages, as bank-statement-native-1 prints them."""
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
        start, end = MONTHS[self.month]
        return {'account': self.account, 'currency': self.currency, 'period': {'start': start, 'end': end}, 'pages': pages}

    def book(self, extra=0):
        """The book balance a book that agreed with the bank at the start
        shows: the opening balance, its receipts less its payments, and
        `extra`."""
        return self.opening + sum(r['receipt'] - r['payment'] for r in self.cash) + extra

    def S(self, row):
        """A planted movement as the statement numbers it: S<n> in printed order."""
        return f'S{self.bank.index(row) + 1}'


class Story:
    def __init__(self, sid, title, *, producer, font, paper, style, bank, title_doc, account, layout='en',
                 digits='latin'):
        self.sid, self.title, self.layout, self.digits = sid, title, layout, digits
        self.account = account
        self.print = {'producer': producer, 'font': font, 'paper': paper, 'style': style, 'bank': bank,
                      'documentTitle': title_doc}
        self.rnd = Random(0x7A14 * 1000 + int(sid[1:]))
        self.period_, self.book, self.actions, self.recipe, self.intent = None, None, [], '', {}

    def period(self, month, **kw):
        self.period_ = Period(self.rnd, self, month, layout=self.layout, **kw)
        return self.period_


# Planted rows. A movement and an entry: a withdrawal is paid in the book,
# a deposit received.
def wd(month, d, ref, amount, what='Supplier transfer', value=None):
    return {'date': day(month, d), 'valueDate': value or day(month, d), 'description': what, 'reference': ref,
            'withdrawal': amount, 'deposit': 0}


def dep(month, d, ref, amount, what='Customer remittance', value=None):
    return {'date': day(month, d), 'valueDate': value or day(month, d), 'description': what, 'reference': ref,
            'withdrawal': 0, 'deposit': amount}


def paid(month, d, ref, amount, voucher, what='Payment voucher'):
    return {'date': day(month, d), 'voucher': voucher, 'description': what, 'reference': ref, 'receipt': 0, 'payment': amount}


def got(month, d, ref, amount, voucher, what='Receipt voucher'):
    return {'date': day(month, d), 'voucher': voucher, 'description': what, 'reference': ref, 'receipt': amount, 'payment': 0}


def differences(month, tag, plants, *, gap=0, words=None):
    """One referenced pair per plant (direction, statement amount, book
    amount, day): the movement on the day, the entry `gap` days before it."""
    words = words or {}
    bank, cash = [], []
    for i, (direction, s, c, d) in enumerate(plants):
        ref = f"{'INV' if direction == 'out' else 'RCV'}-{tag}-{i + 1:02d}"
        voucher = f"{'PV' if direction == 'out' else 'RV'}-{tag}-{i + 1:02d}"
        if direction == 'out':
            bank.append(wd(month, d, ref, s, words.get('out', 'Supplier transfer')))
            cash.append(paid(month, d - gap, ref, c, voucher, words.get('cash_out', 'Payment voucher')))
        else:
            bank.append(dep(month, d, ref, s, words.get('in', 'Customer remittance')))
            cash.append(got(month, d - gap, ref, c, voucher, words.get('cash_in', 'Receipt voucher')))
    return bank, cash


def policy(per_item, per_period, note=NOTE):
    return {'policy': {'perItem': per_item, 'perPeriod': per_period, 'note': note}}


def reject(statement, cashbook):
    return {'reject': {'statement': list(statement), 'cashbook': list(cashbook)}}


def undo(statement, cashbook):
    return {'undo': {'statement': list(statement), 'cashbook': list(cashbook)}}


def pair(p, bank, cash, i):
    return [p.S(bank[i])], [cash[i]['voucher']]


def intent(tolerated=(), exceeded=None, open_=0, sheet=None, rejected=0):
    """The expected outcome in the tolerance foundation's intent schema, so
    that its own comparison judges it: each tolerated case as [its
    statement reference, statement minus cashbook], the exceeded sum and
    limit, the cases awaiting a decision, those rejected, and the sheet's
    status, difference, tolerated sum and unexplained rest."""
    status, difference, total, unexplained = sheet
    out = {'tolerated': [list(t) for t in tolerated], 'exceeded': exceeded, 'open': open_,
           'sheet': {'status': status, 'difference': difference, 'tolerated': total, 'unexplained': unexplained}}
    if rejected:
        out['rejected'] = rejected
    return out


def refused(rule):
    return {'refused': rule}


ARABIC_WORDS = {'out': 'سداد فاتورة', 'in': 'تحصيل فاتورة', 'cash_out': 'سند صرف', 'cash_in': 'سند قبض'}
CEDAR = dict(bank='Cedar Gulf Bank', title_doc='Current Account Statement')
DUNE = dict(bank='Dune Harbor Bank', title_doc='Statement of Account')
SADU = dict(bank='بنك السدو التجاري', title_doc='كشف حساب جاري', layout='ar')
HX_GRID = dict(producer='hexapdf', font='Work Sans', paper='A4', style={'rules': 'grid', 'heading': 'filled'})
HX_ROWS = dict(producer='hexapdf', font='Merriweather', paper='A4', style={'rules': 'rows', 'heading': 'rule'})
HX_WIDE = dict(producer='hexapdf', font='Fira Sans', paper='A4-landscape', style={'rules': 'stripes', 'heading': 'filled'})
HX_LETTER = dict(producer='hexapdf', font='Space Mono', paper='Letter',
                 style={'rules': 'none', 'heading': 'rule', 'headings': 'left'})
PL_GRID = dict(producer='pdflib', font='Rubik', paper='A4', style={'rules': 'grid', 'heading': 'filled'})
PL_ROWS = dict(producer='pdflib', font='Readex Pro', paper='A4', style={'rules': 'rows', 'heading': 'rule'})
PL_LEMON = dict(producer='pdflib', font='Lemonada', paper='A4', style={'rules': 'rows', 'heading': 'rule'})
PL_CAIRO = dict(producer='pdflib', font='Cairo', paper='A4', style={'rules': 'rows', 'heading': 'filled'})
PL_TAJAWAL = dict(producer='pdflib', font='Tajawal', paper='A4', style={'rules': 'rows', 'heading': 'filled'})


def build():
    stories = []

    def add(story, make):
        make(story)
        stories.append(story)

    U = Story

    def u01(s):
        b, c = differences('JAN', 'U01', [('in', 240000, 239999, 12)])
        p = s.period('JAN', bank=b, cash=c)
        s.book = p.book()
        s.actions = [policy(1, 5)]
        s.recipe = ('a 2,400.00 remittance the book receives as 2,399.99 under its reference; a policy of 0.01 a pair '
                    'and 0.05 a period; the book balance is the opening with the book\'s receipts and payments')
        s.intent = intent([('RCV-U01-01', 1)], sheet=('reconciled-within-tolerance', 1, 1, 0))
    add(U('U01', 'A receipt the book records one halala short', **HX_GRID, **CEDAR,
          account='SA44 2000 0000 7104 3300 0101'), u01)

    def u02(s):
        b, c = differences('JAN', 'U02', [('out', 310002, 310000, 6), ('in', 87503, 87500, 14),
                                          ('out', 129995, 130000, 23)])
        p = s.period('JAN', bank=b, cash=c)
        s.book = p.book()
        s.actions = [policy(5, 10)]
        s.recipe = ('three differences of 0.02, 0.03 and 0.05, the last where the book pays more than the bank; '
                    'a policy of 0.05 a pair and 0.10 a period: the absolute sum meets the period limit exactly')
        s.intent = intent([('INV-U02-01', 2), ('RCV-U02-02', 3), ('INV-U02-03', -5)],
                          sheet=('reconciled-within-tolerance', 6, 6, 0))
    add(U('U02', 'Differences of both signs meet the period limit exactly', **PL_GRID, **DUNE,
          account='SA71 6000 0000 3381 0900 0202'), u02)

    def u03(s):
        b, c = differences('JAN', 'U03', [('out', 310002, 310000, 6), ('in', 87503, 87500, 14),
                                          ('out', 129995, 130000, 23)])
        p = s.period('JAN', bank=b, cash=c)
        s.book = p.book()
        s.actions = [policy(5, 9)]
        s.recipe = 'U02\'s three differences, summing to 0.10, under a period limit of 0.09: none is tolerated'
        s.intent = intent(exceeded={'sum': 10, 'cap': 9}, open_=3, sheet=('draft', 0, 0, 0))
    add(U('U03', 'The same differences past the period limit by one halala', **HX_ROWS, **CEDAR,
          account='SA44 2000 0000 7104 3300 0103'), u03)

    def u04(s):
        b, c = differences('FEB', 'U04', [('out', 1250001, 1250000, 5), ('in', 460007, 460000, 13),
                                          ('out', 980012, 980000, 21)])
        p = s.period('FEB', bank=b, cash=c, currency='KWD')
        s.book = p.book()
        s.actions = [policy(10, 50), reject(*pair(p, b, c, 2))]
        s.recipe = ('dinar: differences of one, seven and twelve fils under a policy of ten fils a pair and fifty a '
                    'period: two tolerated; the twelve-fils difference stays and the accountant rejects it')
        s.intent = intent([('INV-U04-01', 1), ('RCV-U04-02', 7)], rejected=1, sheet=('reconciled-within-tolerance', 6, 6, 0))
    add(U('U04', 'Dinar: two differences within the limit, a third rejected', **PL_ROWS, **DUNE,
          account='KW81 CBKU 0000 0000 0000 1234 5604 04'), u04)

    def u05(s):
        b, c = differences('FEB', 'U05', [('out', 3400999, 3400000, 9), ('in', 2200500, 2201000, 17)])
        p = s.period('FEB', bank=b, cash=c, currency='KWD')
        s.book = p.book()
        s.actions = [policy(999, 99999)]
        s.recipe = ('dinar: differences of 0.999 and 0.500 under the largest limits the contract admits, 0.999 a pair '
                    'and 99.999 a period')
        s.intent = intent([('INV-U05-01', 999), ('RCV-U05-02', -500)],
                          sheet=('reconciled-within-tolerance', -1499, -1499, 0))
    add(U('U05', 'Dinar at its largest limits', **HX_WIDE, **CEDAR,
          account='KW81 CBKU 0000 0000 0000 1234 5605 05'), u05)

    def u06(s):
        b, c = differences('MAR', 'U06', [('out', 715000, 714999, 8)])
        p = s.period('MAR', bank=b, cash=c, currency='KWD')
        s.book = p.book()
        s.actions = [policy(1000, 5000)]
        s.recipe = 'dinar: a pair limit of 1.000, one dinar, which is not less than one major unit'
        s.intent = refused('TOLERANCE:PER_ITEM')
    add(U('U06', 'Dinar: a pair limit of one dinar is refused', **PL_GRID, **DUNE,
          account='KW81 CBKU 0000 0000 0000 1234 5606 06'), u06)

    def u07(s):
        b, c = differences('MAR', 'U07', [('out', 52050, 52000, 11)])
        p = s.period('MAR', bank=b, cash=c)
        s.book = p.book()
        s.actions = [policy(50, 10000)]
        s.recipe = 'a period limit of 100.00, which is not less than one hundred major units'
        s.intent = refused('TOLERANCE:PER_PERIOD')
    add(U('U07', 'A period limit of one hundred riyals is refused', **HX_LETTER, **CEDAR,
          account='SA44 2000 0000 7104 3300 0107'), u07)

    def u08(s):
        b, c = differences('JAN', 'U08', [('out', 1250001, 1250000, 10)])
        p = s.period('JAN', bank=b, cash=c, currency='JPY')
        s.book = p.book()
        s.actions = [policy(1, 5)]
        s.recipe = 'yen: a one-yen difference and a policy of one a pair and five a period; the yen has no minor unit'
        s.intent = refused('TOLERANCE:CURRENCY')
    add(U('U08', 'Yen: no tolerance for a currency without a minor unit', **PL_ROWS, **DUNE,
          account='JP12 3456 0000 0000 9100 0808'), u08)

    def u09(s):
        b, c = differences('JAN', 'U09', [('out', 1250001, 1250000, 10)])
        p = s.period('JAN', bank=b, cash=c, currency='JPY')
        s.book = p.book()
        s.recipe = 'U08\'s yen period without a policy: the one-yen difference awaits a decision'
        s.intent = intent(open_=1, sheet=('draft', 0, 0, 0))
    add(U('U09', 'Yen without a policy', **PL_GRID, **DUNE,
          account='JP12 3456 0000 0000 9100 0909'), u09)

    def u10(s):
        b, c = differences('FEB', 'U10', [('out', 66601, 66600, 7)])
        p = s.period('FEB', bank=b, cash=c)
        s.book = p.book()
        s.actions = [policy(1, 5, '  ')]
        s.recipe = 'a reason of two no-break spaces, empty once trimmed'
        s.intent = refused('TOLERANCE:NOTE')
    add(U('U10', 'A reason of no-break spaces is refused', **HX_GRID, **CEDAR,
          account='SA44 2000 0000 7104 3300 0110'), u10)

    def u11(s):
        b, c = differences('FEB', 'U11', [('out', 488801, 488800, 24)], words=ARABIC_WORDS)
        p = s.period('FEB', bank=b, cash=c, count=16, per_page=9)
        s.book = p.book()
        one = pair(p, b, c, 0)
        s.actions = [policy(1, 3, 'فروق تقريب شبكة المدفوعات'), reject(*one), undo(*one), reject(*one)]
        s.recipe = ('Arabic, Arabic-Indic digits, two pages: a 4,888.01 supplier payment the book pays as 4,888.00, on '
                    'page 2 after the balance brought forward; tolerated, rejected, undone, rejected again: both '
                    'members outstanding, and nothing tolerated')
        s.intent = intent(rejected=1, sheet=('reconciled', 0, 0, 0))
    add(U('U11', 'Arabic: a tolerated pair rejected, undone and rejected again', **PL_CAIRO, **SADU,
          account='SA09 8000 0000 6123 4500 1111', digits='arabic'), u11)

    def u12(s):
        near, near_c = differences('MAR', 'U12A', [('out', 91001, 91000, 9)], gap=3)
        far, far_c = differences('MAR', 'U12B', [('out', 73301, 73300, 22)], gap=4)
        p = s.period('MAR', bank=near + far, cash=near_c + far_c)
        s.book = p.book()
        s.actions = [policy(1, 5)]
        s.recipe = ('two one-halala differences: one booked three days before the bank, at the edge of the window, '
                    'tolerated; one booked four days before, one day beyond it, still an amount difference')
        s.intent = intent([('INV-U12A-01', 1)], open_=1, sheet=('draft', -1, -1, 0))
    add(U('U12', 'A difference one day beyond the window is not tolerated', **HX_ROWS, **CEDAR,
          account='SA44 2000 0000 7104 3300 0112'), u12)

    def u13(s):
        b, c = differences('JAN', 'U13', [('in', 150001, 150000, 8), ('out', 150001, 150000, 19)])
        p = s.period('JAN', bank=b, cash=c)
        s.book = p.book()
        s.actions = [policy(1, 2)]
        s.recipe = ('a receipt and a payment of 1,500.01 the book records as 1,500.00: both tolerated, their effects '
                    'cancel, and the sheet is reconciled within the tolerance with nothing tolerated in sum')
        s.intent = intent([('RCV-U13-01', 1), ('INV-U13-02', 1)], sheet=('reconciled-within-tolerance', 0, 0, 0))
    add(U('U13', 'Two tolerated differences whose effects cancel', **PL_LEMON, **DUNE,
          account='SA71 6000 0000 3381 0900 0213'), u13)

    def u14(s):
        b, c = differences('FEB', 'U14', [('out', 1830002, 1830000, 15)])
        p = s.period('FEB', bank=b, cash=c, opening=-2500000)
        s.book = p.book(extra=-2500)
        s.actions = [policy(2, 5)]
        s.recipe = ('an overdrawn account (opening 25,000.00 DR): a 18,300.02 payment the book records as '
                    '18,300.00, tolerated; the declared book balance is 25.00 lower than the book: a rest '
                    'without explanation')
        s.intent = intent([('INV-U14-01', 2)], sheet=('difference', 2498, -2, 2500))
    add(U('U14', 'Overdrawn, with a rest the tolerance does not explain', **HX_WIDE, **CEDAR,
          account='SA44 2000 0000 7104 3300 0114'), u14)

    def u15(s):
        b, c = differences('MAR', 'U15', [('in', 615004, 615000, 6), ('out', 277100, 277103, 20)],
                           words=ARABIC_WORDS)
        p = s.period('MAR', bank=b, cash=c, currency='KWD')
        s.book = p.book()
        s.actions = [policy(5, 20, 'فروق تقريب بالفلس')]
        s.recipe = 'Arabic, Latin digits, dinar: a receipt four fils over and a payment three fils under, tolerated'
        s.intent = intent([('RCV-U15-01', 4), ('INV-U15-02', -3)], sheet=('reconciled-within-tolerance', 7, 7, 0))
    add(U('U15', 'Arabic dinar statement with two tolerated differences', **PL_TAJAWAL, **SADU,
          account='KW81 CBKU 0000 0000 0000 1234 5615 15'), u15)

    def u16(s):
        b, c = differences('FEB', 'U16', [('out', 40001, 40000, 4), ('in', 90002, 90000, 25)])
        p = s.period('FEB', bank=b, cash=c)
        s.book = p.book()
        s.actions = [policy(3, 3)]
        s.recipe = 'differences of 0.01 and 0.02 under a policy of 0.03 a pair and 0.03 a period, equal limits'
        s.intent = intent([('INV-U16-01', 1), ('RCV-U16-02', 2)], sheet=('reconciled-within-tolerance', 1, 1, 0))
    add(U('U16', 'Equal pair and period limits', **PL_GRID, **DUNE,
          account='SA71 6000 0000 3381 0900 0216'), u16)

    def u17(s):
        b, c = differences('FEB', 'U17', [('out', 220001, 220000, 5), ('in', 315000, 314500, 12),
                                          ('out', 78000, 77950, 21)])
        p = s.period('FEB', bank=b, cash=c)
        s.book = p.book()
        s.actions = [policy(1, 5), reject(*pair(p, b, c, 1)), reject(*pair(p, b, c, 0)), undo(*pair(p, b, c, 1))]
        s.recipe = ('a one-halala difference tolerated, and two of 5.00 and 0.50 that are not; the accountant rejects '
                    'the 5.00 difference, then the tolerated pair, then undoes the first rejection: the 5.00 and '
                    '0.50 differences await a decision')
        s.intent = intent(open_=2, rejected=1, sheet=('draft', 0, 0, 0))
    add(U('U17', 'Decisions on tolerated and untolerated pairs under one policy', **HX_GRID, **CEDAR,
          account='SA44 2000 0000 7104 3300 0117'), u17)

    def u18(s):
        b, c = differences('MAR', 'U18', [('out', 125000000, 124999999, 6), ('in', 99999999, 100000000, 18)])
        p = s.period('MAR', bank=b, cash=c, opening=300000000)
        s.book = p.book()
        s.actions = [policy(1, 2)]
        s.recipe = ('a 1,250,000.00 transfer the book pays as 1,249,999.99, and a 999,999.99 remittance the book '
                    'receives as 1,000,000.00: one halala each, across a million')
        s.intent = intent([('INV-U18-01', 1), ('RCV-U18-02', -1)], sheet=('reconciled-within-tolerance', -2, -2, 0))
    add(U('U18', 'One halala across a million', **PL_ROWS, **DUNE,
          account='SA71 6000 0000 3381 0900 0218'), u18)

    def u19(s):
        b, c = differences('MAR', 'U19', [('out', 50001, 50000, 3), ('in', 60002, 60000, 7), ('out', 70002, 70000, 12),
                                          ('in', 80001, 80000, 16), ('out', 90002, 90000, 21), ('in', 11002, 11000, 27)])
        p = s.period('MAR', bank=b, cash=c, count=30, per_page=14)
        s.book = p.book()
        s.actions = [policy(2, 12)]
        s.recipe = ('thirty ordinary movements and six differences of one or two halalas over three pages: 0.10 in '
                    'all under a period limit of 0.12')
        s.intent = intent([('INV-U19-01', 1), ('RCV-U19-02', 2), ('INV-U19-03', 2), ('RCV-U19-04', 1), ('INV-U19-05', 2),
                           ('RCV-U19-06', 2)], sheet=('reconciled-within-tolerance', 0, 0, 0))
    add(U('U19', 'Six differences over three pages', **HX_LETTER, **CEDAR,
          account='SA44 2000 0000 7104 3300 0119'), u19)

    def u20(s):
        b, c = differences('JAN', 'U20', [('out', 330005, 330000, 9), ('in', 120004, 120000, 22)],
                           words=ARABIC_WORDS)
        p = s.period('JAN', bank=b, cash=c, currency='KWD')
        s.book = p.book()
        s.actions = [policy(5, 8, 'فروق تقريب بالفلس'), reject(*pair(p, b, c, 0)), reject(*pair(p, b, c, 1))]
        s.recipe = ('Arabic, Arabic-Indic digits, dinar: differences of five and four fils, nine in all, past a period '
                    'limit of eight: none tolerated; both rejected, all four members outstanding')
        s.intent = intent(exceeded={'sum': 9, 'cap': 8}, rejected=2, sheet=('reconciled', 0, 0, 0))
    add(U('U20', 'Arabic dinar: past the period limit, both differences rejected', **PL_CAIRO, **SADU,
          account='KW81 CBKU 0000 0000 0000 1234 5620 20', digits='arabic'), u20)
    return stories


def cash_row(r):
    return {k: r[k] for k in ('date', 'voucher', 'description', 'reference', 'receipt', 'payment')}


BOOK_NOTE = {'en': 'General ledger bank account, closing balance', 'ar': 'رصيد حساب البنك في الأستاذ العام'}


def facts(stories=None):
    stories = stories or build()
    return {
        'version': VERSION,
        'stories': [{
            'id': s.sid, 'title': s.title, 'layout': s.layout, 'digits': s.digits, 'print': s.print,
            'periods': [{'id': s.period_.id, 'statement': s.period_.statement(),
                         'cashbook': [cash_row(r) for r in s.period_.cash]}],
            'book': {'balance': s.book, 'note': BOOK_NOTE[s.layout]},
            'actions': s.actions, 'recipe': s.recipe, 'intent': s.intent,
        } for s in stories],
    }


def facts_json(stories=None):
    return json.dumps(facts(stories), ensure_ascii=False, indent=1) + '\n'


def print_records(f):
    """Each period's statement as the copied renderers and checker read a
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
