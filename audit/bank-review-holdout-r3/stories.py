"""WF-1 REVIEW-1 R3 holdout: the review queue of bank statement periods from
April to June 2028, and what the accountant does on it.

A new lineage of stories, written apart from the review foundation's
generator (audit/bank-review-foundation/stories.mjs) and in another
language: its own seed of the W4 random source (SplitMix64), banks, accounts
and calendar. The periods are printed in the bank-statement-native-1 layout
by the two writers the W4 and R4 holdouts used (the HexaPDF statement
service and the pdf-lib statement application), with their renderers, so
that a difference here is the queue's, not the reader's.

Review cases are planted by the matching rules of the bank statement
foundation's contract: an explicit reference on both sides with a date gap
beyond the window (date-gap), another amount (amount-difference) or the
opposite direction (direction-conflict), a reference repeated on one side
(duplicate-reference); and, among the rows left, one amount in one direction
within the window: a pair (amount-date-suggestion) or more
(ambiguous-amount-date).

The facts keep the review foundation's schema, so that its sealed oracle
(audit/bank-review-foundation/oracle.py, which takes the settled period from
the sealed ROLL-1 oracle) reads them unchanged: per period the printed lines
and the cashbook rows; per story the corrected cashbook it replaces its own
with, if any, and the accountant's actions in order: {group: {type, with}}
on the group holding that member, {decide: {type, statement, cashbook}} and
{undo: {statement, cashbook}} on the case holding exactly those members,
{replace: {cashbook: 'corrected'}}. `print` says how a story's statement is
drawn. `recipe` says how the story was made; `intent` is the expected queue
and outcome, written by hand. The oracle reads neither.

R1 asked for two things the foundation's stories do not separate: groups of
two reasons that tie on class, impact and members (R01, R02), and a date
gap whose value dates differ from its dates (R03).

  python3 -B audit/bank-review-holdout-r3/stories.py > stories.json
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

VERSION = 'bank-review-holdout-r3-1'
HERE = Path(__file__).resolve().parent
MONTHS = {
    'APR': ('2028-04-01', '2028-04-30'),
    'MAY': ('2028-05-01', '2028-05-31'),
    'JUN': ('2028-06-01', '2028-06-30'),
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


NARRATIVE = {
    'en': {
        'out': ['Supplier settlement', 'Freight forwarding', 'Card scheme fees', 'Maintenance contract', 'Warehouse rent'],
        'in': ['Customer remittance', 'Card settlement', 'Distributor payment', 'Marketplace payout'],
        'cash_out': 'Payment voucher', 'cash_in': 'Receipt voucher',
    },
    'ar': {
        'out': ['سداد مورد', 'شحن بضائع', 'رسوم بطاقات', 'عقد صيانة', 'إيجار مستودع'],
        'in': ['حوالة عميل', 'تسوية بطاقات', 'دفعة موزع', 'مستحقات متجر إلكتروني'],
        'cash_out': 'سند صرف', 'cash_in': 'سند قبض',
    },
}


def ordinary(rnd, month, count, tag, layout):
    """`count` ordinary movements of one month, each recorded on both sides
    under the same explicit reference, dated within the window: automatic
    matches, with amounts no planted row uses (below 1,000.00 or odd)."""
    words = NARRATIVE[layout]
    bank, cash = [], []
    for i in range(count):
        d = 2 + (25 * i) // max(count - 1, 1)
        out = rnd.int(0, 1) == 1
        amount = rnd.int(1000, 49000) * 100 + rnd.int(1, 99)
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
                 per_page=12, layout='en', drop_page=None):
        tag = f'{story.sid[1:]}{month[:2]}'
        b, c = ordinary(rnd, month, count, tag, layout)
        self.id, self.month, self.currency, self.per_page = f'{story.sid}-{month}', month, currency, per_page
        self.opening = opening if opening is not None else rnd.int(200000, 900000) * 100
        self.bank, self.cash = by_date(b + list(bank)), by_date(c + list(cash))
        self.account, self.drop_page = story.account, drop_page

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
        self.rnd = Random(0x3E71 * 1000 + int(sid[1:]))
        self.periods, self.replace, self.actions, self.recipe, self.intent = [], None, [], '', {}

    def period(self, month, **kw):
        p = Period(self.rnd, self, month, layout=self.layout, **kw)
        self.periods.append(p)
        return p


# Planted rows. A movement and an entry: a withdrawal is paid in the book,
# a deposit received.
def wd(month, d, ref, amount, what='Counter withdrawal', value=None):
    return {'date': day(month, d), 'valueDate': value or day(month, d), 'description': what, 'reference': ref,
            'withdrawal': amount, 'deposit': 0}


def dep(month, d, ref, amount, what='Cash deposit', value=None):
    return {'date': day(month, d), 'valueDate': value or day(month, d), 'description': what, 'reference': ref,
            'withdrawal': 0, 'deposit': amount}


def paid(month, d, ref, amount, voucher, what='Payment voucher'):
    return {'date': day(month, d), 'voucher': voucher, 'description': what, 'reference': ref, 'receipt': 0, 'payment': amount}


def got(month, d, ref, amount, voucher, what='Receipt voucher'):
    return {'date': day(month, d), 'voucher': voucher, 'description': what, 'reference': ref, 'receipt': amount, 'payment': 0}


def pairs(month, direction, tag, amounts, days, shift=None):
    """Unreferenced pairs of one amount each: the movement on `days[i]`, the
    entry `shift[i]` days earlier (0 or 1): amount-date suggestions, as long
    as no other row of the amount and direction is within the window."""
    bank, cash = [], []
    for i, (a, d) in enumerate(zip(amounts, days)):
        back = (shift or [i % 2] * len(amounts))[i] if shift else i % 2
        voucher = f"{'PV' if direction == 'out' else 'RV'}-{tag}-{i + 1:02d}"
        if direction == 'out':
            bank.append(wd(month, d, '', a, 'Counter withdrawal'))
            cash.append(paid(month, max(d - back, 1), '', a, voucher, 'Petty cash payment'))
        else:
            bank.append(dep(month, d, '', a, 'Cash deposit'))
            cash.append(got(month, max(d - back, 1), '', a, voucher, 'Counter receipt'))
    return bank, cash


def gaps(month, direction, tag, amounts, gap, days, values=None):
    """Referenced pairs of one amount: the entry on `days[i]`, the movement
    `gap` days after it, valued on `values[i]` days after the entry if
    given: date-gap cases."""
    bank, cash = [], []
    for i, (a, d) in enumerate(zip(amounts, days)):
        ref = f"{'CHQ' if direction == 'out' else 'DEP'}-{tag}-{i + 1:02d}"
        voucher = f"{'BP' if direction == 'out' else 'BR'}-{tag}-{i + 1:02d}"
        value = day(month, d + values[i]) if values else None
        if direction == 'out':
            bank.append(wd(month, d + gap, ref, a, f'Cheque {ref[4:]} paid', value))
            cash.append(paid(month, d, ref, a, voucher))
        else:
            bank.append(dep(month, d + gap, ref, a, f'Deposit {ref[4:]}', value))
            cash.append(got(month, d, ref, a, voucher))
    return bank, cash


def join(*parts):
    return [r for b, _ in parts for r in b], [r for _, c in parts for r in c]


def group(kind, member):
    return {'group': {'type': kind, 'with': member}}


def decide(kind, statement, cashbook):
    return {'decide': {'type': kind, 'statement': list(statement), 'cashbook': list(cashbook)}}


def undo(statement, cashbook):
    return {'undo': {'statement': list(statement), 'cashbook': list(cashbook)}}


def g(reason, direction, shape, cases, **extra):
    return {'reason': reason, 'direction': direction, 'statement': shape[0], 'cashbook': shape[1], 'cases': cases, **extra}


def intent(queue, after, single, grouped, **more):
    return {'queue': queue, 'after': after, 'actions': {'single': single, 'grouped': grouped}, **more}


def after(accepted=0, rejected=0, open_=0):
    return {'accepted': accepted, 'rejected': rejected, 'open': open_}


JUNIPER = dict(bank='Juniper Coast Bank', title_doc='Business Account Statement')
HARBOR = dict(bank='Harborline Commercial Bank', title_doc='Statement of Account')
NAKHEEL = dict(bank='مصرف النخيل الأهلي', title_doc='كشف حساب جاري', layout='ar')
HX_GRID = dict(producer='hexapdf', font='Work Sans', paper='A4', style={'rules': 'grid', 'heading': 'filled'})
HX_ROWS = dict(producer='hexapdf', font='Merriweather', paper='A4', style={'rules': 'rows', 'heading': 'rule'})
HX_WIDE = dict(producer='hexapdf', font='Fira Sans', paper='A4-landscape', style={'rules': 'stripes', 'heading': 'filled'})
HX_LETTER = dict(producer='hexapdf', font='Space Mono', paper='Letter',
                 style={'rules': 'none', 'heading': 'rule', 'headings': 'left'})
PL_GRID = dict(producer='pdflib', font='Rubik', paper='A4', style={'rules': 'grid', 'heading': 'filled'})
PL_ROWS = dict(producer='pdflib', font='Readex Pro', paper='A4', style={'rules': 'rows', 'heading': 'rule'})
PL_WIDE = dict(producer='pdflib', font='Readex Pro', paper='A4-landscape', style={'rules': 'stripes', 'heading': 'filled'})
PL_LEMON = dict(producer='pdflib', font='Lemonada', paper='A4', style={'rules': 'rows', 'heading': 'rule'})
PL_CAIRO = dict(producer='pdflib', font='Cairo', paper='A4', style={'rules': 'rows', 'heading': 'filled'})
PL_TAJAWAL = dict(producer='pdflib', font='Tajawal', paper='A4', style={'rules': 'rows', 'heading': 'filled'})


def build():
    stories = []

    def add(story, make):
        make(story)
        stories.append(story)

    R = Story

    def r01(s):
        gap_b, gap_c = gaps('APR', 'out', 'R01G', [300000, 100000], 6, [3, 9])
        sug_b, sug_c = pairs('APR', 'out', 'R01', [300000, 100000], [20, 24])
        p = s.period('APR', bank=gap_b + sug_b, cash=gap_c + sug_c)
        s.actions = [group('accept', 'PV-R01-01'), group('reject', 'BP-R01G-02')]
        s.recipe = ('two cheques of 3,000.00 and 1,000.00 paid six days after the book, and two unreferenced '
                    'payments of the same amounts paid the day they were booked or the day after: two groups of '
                    'suggestions with equal impact and members, so the reason order decides: the date gaps first. '
                    'The pairs accepted as a group, the date gaps rejected as a group')
        s.intent = intent([g('date-gap', 'out', [1, 1], 2, gap=6), g('amount-date-suggestion', 'out', [1, 1], 2)],
                          after(accepted=2, rejected=2), 4, 2,
                          order=[['date-gap', 'out'], ['amount-date-suggestion', 'out']])
        del p
    add(R('R01', 'Two suggestion reasons tie: the date gaps come first', **HX_GRID, **JUNIPER,
          account='SA27 4500 0000 6610 2200 0101'), r01)

    def r02(s):
        p = s.period('APR', bank=[wd('APR', 7, 'INV-R02-71', 150000, 'Supplier transfer'),
                                  wd('APR', 16, 'INV-R02-72', 150000, 'Supplier transfer')],
                     cash=[got('APR', 7, 'INV-R02-71', 150000, 'RV-R02-71', 'Refund received'),
                           paid('APR', 16, 'INV-R02-72', 140000, 'PV-R02-72')])
        s.actions = [decide('reject', [p.S(p.bank[[r['reference'] for r in p.bank].index('INV-R02-71')])], ['RV-R02-71'])]
        s.recipe = ('a 1,500.00 transfer the book records as a receipt under its reference, and a 1,500.00 transfer '
                    'the book records as 1,400.00 under its own: two exceptions with equal impact and members, so '
                    'the reason order decides, against the signature\'s alphabetical order: the direction conflict '
                    'first. The conflict rejected on its own')
        s.intent = intent([g('direction-conflict', 'in+out', [1, 1], 1), g('amount-difference', 'out', [1, 1], 1)],
                          after(rejected=1, open_=1), 2, 2,
                          order=[['direction-conflict', 'in+out'], ['amount-difference', 'out']])
    add(R('R02', 'Two exception reasons tie: the direction conflict comes first', **PL_GRID, **HARBOR,
          account='SA61 1000 0000 2290 4400 0202'), r02)

    def r03(s):
        b, c = gaps('MAY', 'out', 'R03', [482150, 271930, 133705], 5, [4, 11, 18], values=[2, 5, 0])
        s.period('MAY', bank=b, cash=c)
        s.actions = [group('accept', 'BP-R03-01')]
        s.recipe = ('three cheques each paid five days after the book; their value dates are two, five and zero days '
                    'after the book: the gap is counted from the movement date, as the matcher counts it, so one '
                    'group; accepted as a group')
        s.intent = intent([g('date-gap', 'out', [1, 1], 3, gap=5)], after(accepted=3), 3, 1)
    add(R('R03', 'A date gap counted from the movement date, whatever its value date', **HX_ROWS, **JUNIPER,
          account='SA27 4500 0000 6610 2200 0103'), r03)

    def r04(s):
        out_amounts = [100000 + 4321 * i + 7 for i in range(30)]
        in_amounts = [250000 + 3917 * i + 3 for i in range(15)]
        ob, oc = pairs('JUN', 'out', 'R04O', out_amounts, [2 + (i % 26) for i in range(30)])
        ib, ic = pairs('JUN', 'in', 'R04I', in_amounts, [3 + (i % 25) for i in range(15)])
        for r in ob:
            r['description'] = 'سحب نقدي'
        for r in ib:
            r['description'] = 'إيداع نقدي'
        for r in oc:
            r['description'] = 'سند صرف'
        for r in ic:
            r['description'] = 'سند قبض'
        s.period('JUN', bank=ob + ib, cash=oc + ic, per_page=18)
        s.actions = [group('accept', 'PV-R04O-01'), group('accept', 'RV-R04I-01')]
        s.recipe = ('thirty unreferenced withdrawals and fifteen unreferenced deposits, each with its entry, over '
                    'three pages of an Arabic statement in Arabic-Indic digits; both groups accepted')
        s.intent = intent([g('amount-date-suggestion', 'in', [1, 1], 15), g('amount-date-suggestion', 'out', [1, 1], 30)],
                          after(accepted=45), 45, 2)
    add(R('R04', 'Arabic: forty-five suggestions over three pages', **PL_CAIRO, **NAKHEEL,
          account='SA05 8000 0000 5512 7300 0404', digits='arabic'), r04)

    def r05(s):
        b, c = pairs('APR', 'out', 'R05', [612345, 523456, 434567], [5, 12, 19])
        s.period('APR', bank=b, cash=c, count=14, per_page=7, drop_page=2)
        s.recipe = 'three suggestions planted, but the statement is pages 1 and 3 of 3'
        s.intent = intent([], after(), 0, 0, held=True)
    add(R('R05', 'A statement missing a page has no queue', **HX_WIDE, **JUNIPER,
          account='SA27 4500 0000 6610 2200 0105'), r05)

    def r06(s):
        amounts = [218800, 339900, 157600, 284400]
        b = [wd('MAY', 4 + 6 * i, f'INV-R06-{61 + i}', a, 'Supplier transfer') for i, a in enumerate(amounts)]
        c = [paid('MAY', 4 + 6 * i, f'INV-R06-{61 + i}', a + 250 * (i + 1), f'PV-R06-{61 + i}') for i, a in enumerate(amounts)]
        p = s.period('MAY', bank=b, cash=c)
        one = lambda i: ([p.S(b[i])], [c[i]['voucher']])  # noqa: E731
        s.actions = [group('reject', 'PV-R06-61'), undo(*one(1)), undo(*one(3)), group('reject', 'PV-R06-64')]
        s.recipe = ('four supplier transfers the book records for more under their references; rejected as a '
                    'group; two undone; the group, now those two, rejected again')
        s.intent = intent([g('amount-difference', 'out', [1, 1], 4)], after(rejected=4), 4, 1)
    add(R('R06', 'Exceptions rejected as a group, two undone, the two rejected again', **PL_ROWS, **HARBOR,
          account='SA61 1000 0000 2290 4400 0206'), r06)

    def r07(s):
        b, c = pairs('JUN', 'in', 'R07', [731250, 466125, 902375, 158840], [4, 10, 17, 24])
        p = s.period('JUN', bank=b, cash=c)
        s.actions = [decide('accept', [p.S(b[2])], [c[2]['voucher']]), group('accept', 'RV-R07-01')]
        s.recipe = 'four unreferenced deposits; the accountant accepts one, then the group, which is the other three'
        s.intent = intent([g('amount-date-suggestion', 'in', [1, 1], 4)], after(accepted=4), 4, 1)
    add(R('R07', 'One suggestion accepted alone, then its group', **HX_LETTER, **JUNIPER,
          account='SA27 4500 0000 6610 2200 0107'), r07)

    def r08(s):
        amounts = [175500, 264400, 393300]
        b = [dep('APR', 6 + 7 * i, f'RCV-R08-{81 + i}', a, 'Customer remittance') for i, a in enumerate(amounts)]
        c = [got('APR', 6 + 7 * i, f'RCV-R08-{81 + i}', a - 500 * (i + 1), f'RV-R08-{81 + i}') for i, a in enumerate(amounts)]
        p = s.period('APR', bank=b, cash=c)
        s.replace = {'cashbook': by_date(p.cash + [got('APR', 28, 'RCV-R08-89', 88800, 'RV-R08-89')])}
        s.actions = [group('reject', 'RV-R08-81'), {'replace': {'cashbook': 'corrected'}}]
        s.recipe = ('three customer remittances the book records for less under their references, rejected as a '
                    'group; then the cashbook is replaced by a corrected copy with one more receipt')
        s.intent = intent([g('amount-difference', 'in', [1, 1], 3)], None, 3, 1, refusal='BANK_STATEMENT_DECISION')
    add(R('R08', 'A corrected cashbook after a group reject refuses the session', **PL_WIDE, **HARBOR,
          account='SA61 1000 0000 2290 4400 0208'), r08)

    def r09(s):
        db = [dep('MAY', 3, 'RCV-R09-91', 80000, 'Customer remittance'),
              wd('MAY', 14, 'CHQ-R09-92', 25000, 'Cheque paid'), wd('MAY', 15, 'CHQ-R09-92', 25000, 'Cheque paid'),
              wd('MAY', 10, '', 33000, 'Counter withdrawal'),
              wd('MAY', 21, 'INV-R09-94', 12000, 'Card settlement')]
        dc = [got('MAY', 3, 'RCV-R09-91', 79000, 'RV-R09-91'),
              paid('MAY', 14, 'CHQ-R09-92', 25000, 'PV-R09-92'),
              paid('MAY', 9, '', 33000, 'PV-R09-93', 'Petty cash payment'), paid('MAY', 11, '', 33000, 'PV-R09-95', 'Petty cash payment'),
              got('MAY', 21, 'INV-R09-94', 12000, 'RV-R09-94', 'Card refund')]
        gb, gc = gaps('MAY', 'in', 'R09', [900000, 50000], 7, [2, 12])
        sb, sc = pairs('MAY', 'out', 'R09', [700000, 640000, 15500], [6, 17, 26])
        s.period('MAY', bank=db + gb + sb, cash=dc + gc + sc)
        s.recipe = ('exceptions of four reasons: 800.00 received as 790.00 (impact 800.00), one 330.00 withdrawal '
                    'for two 330.00 entries (660.00), a 250.00 cheque paid twice (500.00), a 120.00 card settlement '
                    'booked as a refund (120.00); and suggestions: two deposits credited seven days after the '
                    'receipt (9,000.00 and 500.00) and three unreferenced payments (7,000.00 the largest); no decision')
        s.intent = intent([g('amount-difference', 'in', [1, 1], 1), g('ambiguous-amount-date', 'out', [1, 2], 1),
                           g('duplicate-reference', 'out', [2, 1], 1), g('direction-conflict', 'in+out', [1, 1], 1),
                           g('date-gap', 'in', [1, 1], 2, gap=7), g('amount-date-suggestion', 'out', [1, 1], 3)],
                          after(open_=9), 9, 6,
                          order=[['amount-difference', 'in'], ['ambiguous-amount-date', 'out'],
                                 ['duplicate-reference', 'out'], ['direction-conflict', 'in+out'],
                                 ['date-gap', 'in'], ['amount-date-suggestion', 'out']])
    add(R('R09', 'Every reason, exceptions first, each by its impact', **HX_GRID, **JUNIPER,
          account='SA27 4500 0000 6610 2200 0109'), r09)

    def r10(s):
        b = [wd('JUN', 8, 'CHQ-R10-101', 412200, 'Cheque paid'), wd('JUN', 19, 'CHQ-R10-102', 377700, 'Cheque paid')]
        c = [paid('JUN', 7, 'CHQ-R10-101', 412200, 'PV-R10-11'), paid('JUN', 8, 'CHQ-R10-101', 412200, 'PV-R10-12'),
             paid('JUN', 18, 'CHQ-R10-102', 377700, 'PV-R10-13'), paid('JUN', 20, 'CHQ-R10-102', 377700, 'PV-R10-14')]
        s.period('JUN', bank=b, cash=c)
        s.actions = [group('reject', 'PV-R10-13')]
        s.recipe = 'two cheques each recorded twice in the book and paid once by the bank; rejected as a group'
        s.intent = intent([g('duplicate-reference', 'out', [1, 2], 2)], after(rejected=2), 2, 1)
    add(R('R10', 'A cheque booked twice, twice over: one group', **PL_LEMON, **HARBOR,
          account='SA61 1000 0000 2290 4400 0210'), r10)

    def r11(s):
        b = [dep('APR', 5, '', 120120, 'Cash deposit'), dep('APR', 6, '', 120120, 'Cash deposit'),
             dep('APR', 19, '', 98760, 'Cash deposit'), dep('APR', 21, '', 98760, 'Cash deposit')]
        c = [got('APR', 5, '', 120120, 'RV-R11-11', 'Counter receipt'), got('APR', 20, '', 98760, 'RV-R11-12', 'Counter receipt')]
        s.period('APR', bank=b, cash=c)
        s.actions = [group('reject', 'RV-R11-12')]
        s.recipe = ('two pairs of equal unreferenced deposits, each pair within the window of one receipt: two '
                    'ambiguous cases of one shape; rejected as a group')
        s.intent = intent([g('ambiguous-amount-date', 'in', [2, 1], 2)], after(rejected=2), 2, 1)
    add(R('R11', 'Ambiguous deposits rejected as a group', **HX_ROWS, **JUNIPER,
          account='SA27 4500 0000 6610 2200 0111'), r11)

    def r12(s):
        o4 = gaps('MAY', 'out', 'R12A', [345600, 221100], 4, [3, 13])
        i4 = gaps('MAY', 'in', 'R12B', [567800], 4, [8])
        o8 = gaps('MAY', 'out', 'R12C', [654300, 432100], 8, [5, 17])
        b, c = join(o4, i4, o8)
        s.period('MAY', bank=b, cash=c)
        s.actions = [group('accept', 'BP-R12C-02')]
        s.recipe = ('cheques paid four days after the book (two), a deposit credited four days after (one), and '
                    'cheques paid eight days after (two): three groups; the eight-day cheques accepted')
        s.intent = intent([g('date-gap', 'out', [1, 1], 2, gap=4), g('date-gap', 'in', [1, 1], 1, gap=4),
                           g('date-gap', 'out', [1, 1], 2, gap=8)], after(accepted=2, open_=3), 5, 3)
    add(R('R12', 'Date gaps of two lengths and two directions: three groups', **PL_GRID, **HARBOR,
          account='SA61 1000 0000 2290 4400 0212'), r12)

    def r13(s):
        s.period('JUN', count=8)
        s.recipe = 'eight movements recorded on both sides under their references'
        s.intent = intent([], after(), 0, 0)
    add(R('R13', 'Nothing to decide', **HX_GRID, **JUNIPER, account='SA27 4500 0000 6610 2200 0113'), r13)

    def r14(s):
        b, c = pairs('APR', 'out', 'R14', [125075, 98050, 310025], [6, 14, 22])
        s.period('APR', bank=b, cash=c, currency='USD', opening=4500000)
        s.actions = [group('accept', 'PV-R14-02')]
        s.recipe = 'a dollar account: three unreferenced payments, each with its entry; accepted as a group'
        s.intent = intent([g('amount-date-suggestion', 'out', [1, 1], 3)], after(accepted=3), 3, 1)
    add(R('R14', 'Dollars: suggestions accepted as a group', **HX_LETTER, **JUNIPER,
          account='SA27 4500 0000 6610 2200 0114'), r14)

    def r15(s):
        amounts = [188850, 246600]
        db = [wd('MAY', 5 + 9 * i, f'INV-R15-{51 + i}', a, 'سداد مورد') for i, a in enumerate(amounts)]
        dc = [paid('MAY', 5 + 9 * i, f'INV-R15-{51 + i}', a - 150, f'PV-R15-{51 + i}', 'سند صرف') for i, a in enumerate(amounts)]
        sb, sc = pairs('MAY', 'in', 'R15', [512300, 77450, 361800], [8, 16, 25])
        for r in sb:
            r['description'] = 'إيداع نقدي'
        for r in sc:
            r['description'] = 'سند قبض'
        s.period('MAY', bank=db + sb, cash=dc + sc)
        s.actions = [group('reject', 'PV-R15-51'), group('accept', 'RV-R15-01')]
        s.recipe = ('an Arabic statement in Latin digits: two supplier payments the book records 1.50 short under '
                    'their references, rejected as a group; three unreferenced deposits accepted as a group')
        s.intent = intent([g('amount-difference', 'out', [1, 1], 2), g('amount-date-suggestion', 'in', [1, 1], 3)],
                          after(accepted=3, rejected=2), 5, 2)
    add(R('R15', 'Arabic: exceptions rejected and suggestions accepted, by group', **PL_TAJAWAL, **NAKHEEL,
          account='SA05 8000 0000 5512 7300 0415'), r15)

    def r16(s):
        b = [wd('JUN', 4, '', 450000), wd('JUN', 8, '', 120000), wd('JUN', 13, '', 450000), wd('JUN', 23, '', 450000)]
        c = [paid('JUN', 4, '', 450000, 'PV-R16-01', 'Petty cash payment'), paid('JUN', 8, '', 120000, 'PV-R16-02', 'Petty cash payment'),
             paid('JUN', 12, '', 450000, 'PV-R16-03', 'Petty cash payment'), paid('JUN', 23, '', 450000, 'PV-R16-04', 'Petty cash payment')]
        s.period('JUN', bank=b, cash=c)
        s.actions = [group('accept', 'PV-R16-02')]
        s.recipe = ('unreferenced payments of 4,500.00 on the 4th, 13th and 23rd and of 1,200.00 on the 8th, each '
                    'with its entry: the three of 4,500.00 first, in case number order, then the one of 1,200.00 '
                    'numbered between them; accepted as a group')
        s.intent = intent([g('amount-date-suggestion', 'out', [1, 1], 4)], after(accepted=4), 4, 1,
                          caseOrder=['PV-R16-01', 'PV-R16-03', 'PV-R16-04', 'PV-R16-02'])
    add(R('R16', 'Equal impacts inside a group keep case number order', **PL_GRID, **HARBOR,
          account='SA61 1000 0000 2290 4400 0216'), r16)

    def r17(s):
        ib, ic = pairs('APR', 'in', 'R17I', [884400], [9])
        ob, oc = pairs('APR', 'out', 'R17O', [114400, 225500, 336600], [5, 15, 25])
        s.period('APR', bank=ib + ob, cash=ic + oc)
        s.actions = [group('accept', 'PV-R17O-03')]
        s.recipe = ('one unreferenced deposit with its receipt, a group of one with the larger impact, and three '
                    'unreferenced payments; the payments accepted as a group; the deposit offers no group decision')
        s.intent = intent([g('amount-date-suggestion', 'in', [1, 1], 1), g('amount-date-suggestion', 'out', [1, 1], 3)],
                          after(accepted=3, open_=1), 4, 2,
                          order=[['amount-date-suggestion', 'in'], ['amount-date-suggestion', 'out']])
    add(R('R17', 'A group of one offers nothing; its neighbour is accepted', **PL_ROWS, **HARBOR,
          account='SA61 1000 0000 2290 4400 0217'), r17)

    def r18(s):
        amounts = [66600, 155500, 244400]
        b = [wd('MAY', 6 + 8 * i, f'REF-R18-{81 + i}', a, 'Card settlement') for i, a in enumerate(amounts)]
        c = [got('MAY', 6 + 8 * i, f'REF-R18-{81 + i}', a, f'RV-R18-{81 + i}', 'Card refund') for i, a in enumerate(amounts)]
        s.period('MAY', bank=b, cash=c)
        s.actions = [group('reject', 'RV-R18-82')]
        s.recipe = 'three card settlements the book records as refunds received under their references; rejected as a group'
        s.intent = intent([g('direction-conflict', 'in+out', [1, 1], 3)], after(rejected=3), 3, 1)
    add(R('R18', 'Direction conflicts rejected as a group', **HX_WIDE, **JUNIPER,
          account='SA27 4500 0000 6610 2200 0118'), r18)

    def r19(s):
        b, c = pairs('JUN', 'out', 'R19', [287700, 198800, 409900], [5, 13, 21])
        p = s.period('JUN', bank=b, cash=c)
        one = ([p.S(b[1])], [c[1]['voucher']])
        s.actions = [decide('reject', *one), group('accept', 'PV-R19-01'), undo(*one)]
        s.recipe = ('three unreferenced payments; the accountant rejects one, accepts the group, which is the other '
                    'two, then undoes the rejection: that case is back in the queue alone')
        s.intent = intent([g('amount-date-suggestion', 'out', [1, 1], 3)], after(accepted=2, open_=1), 3, 1)
    add(R('R19', 'A rejected case is out of the group; undone, it is back alone', **HX_ROWS, **JUNIPER,
          account='SA27 4500 0000 6610 2200 0119'), r19)

    def r20(s):
        b = [wd('APR', 9, 'INV-R20-201', 5000, 'Bank charge'), wd('APR', 18, '', 100000000, 'Property purchase')]
        c = [paid('APR', 9, 'INV-R20-201', 5001, 'PV-R20-21'), paid('APR', 17, '', 100000000, 'PV-R20-22', 'Property purchase')]
        s.period('APR', bank=b, cash=c, opening=150000000)
        s.recipe = ('a 50.00 charge the book records as 50.01 under its reference, and a 1,000,000.00 unreferenced '
                    'payment with its entry: the halala comes first')
        s.intent = intent([g('amount-difference', 'out', [1, 1], 1), g('amount-date-suggestion', 'out', [1, 1], 1)],
                          after(open_=2), 2, 2,
                          order=[['amount-difference', 'out'], ['amount-date-suggestion', 'out']])
    add(R('R20', 'One halala of difference before a million', **PL_LEMON, **HARBOR,
          account='SA61 1000 0000 2290 4400 0220'), r20)
    return stories


def cash_row(r):
    return {k: r[k] for k in ('date', 'voucher', 'description', 'reference', 'receipt', 'payment')}


def facts(stories=None):
    stories = stories or build()
    return {
        'version': VERSION,
        'stories': [{
            'id': s.sid, 'title': s.title, 'layout': s.layout, 'digits': s.digits, 'print': s.print,
            'periods': [{'id': p.id, 'statement': p.statement(), 'cashbook': [cash_row(r) for r in p.cash]}
                        for p in s.periods],
            'previous': None,
            'replace': s.replace and {'cashbook': [cash_row(r) for r in s.replace['cashbook']]},
            'actions': s.actions, 'recipe': s.recipe, 'intent': s.intent,
        } for s in stories],
    }


def facts_json(stories=None):
    return json.dumps(facts(stories), ensure_ascii=False, indent=1) + '\n'


def print_records(f):
    """Each period's statement as the copied G23 renderers and checker read a
    story: one record per printed statement, and one more cashbook record
    for a corrected cashbook."""
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
