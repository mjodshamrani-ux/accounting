"""WF-1 REPORT-1 R4 holdout: the closing reconciliation sheet on bank
statements and cashbooks from December 2027 to March 2028, with the
previous-period session each story brings and what the accountant does on
the sheet.

A new lineage of stories, written apart from the sheet foundation's
generator (audit/bank-sheet-foundation/stories.mjs) and in another language:
its own seed of the W4 random source (SplitMix64), banks, accounts and
calendar. The calendar crosses a year end and a 29-day February (2028 is a
leap year), and a sign-off is dated on its 29th. The periods are printed in
the bank-statement-native-1 layout by the two writers the W4 holdout copied
from G23 (the HexaPDF statement service and the pdf-lib statement
application), with their renderers, so that a difference here is the
sheet's, not the reader's.

The facts keep the sheet foundation's schema, so that its sealed oracle
(audit/bank-sheet-foundation/oracle.py, which takes the settled period from
the sealed ROLL-1 oracle) reads them unchanged: per period the printed
lines and the cashbook rows; per story the previous session, the language
of the sheet's labels and the accountant's actions on the sheet in order:
{book: {balance, note}}, {decide: {type, statement, cashbook, carried}},
{prepare: {name, date}}, {review: {name, date}}. A book balance is the one
the story's accountant declares, computed here from the printed closing
balance and the items the story leaves outstanding, or deliberately off.
`print` says how a story's statements are drawn. `recipe` says how the
story was made; `intent` is the expected outcome, written by hand. The
oracle reads neither.

  python3 -B audit/bank-sheet-holdout-r4/stories.py > stories.json
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

VERSION = 'bank-sheet-holdout-r4-1'
HERE = Path(__file__).resolve().parent
MONTHS = {
    'DEC': ('2027-12-01', '2027-12-31'),
    'JAN': ('2028-01-01', '2028-01-31'),
    'FEB': ('2028-02-01', '2028-02-29'),
    'MAR': ('2028-03-01', '2028-03-31'),
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
    def __init__(self, rnd, story, month, *, bank=(), cash=(), late=(), count=5, opening=None, currency='SAR',
                 per_page=8, style='chk', layout='en', drop_page=None):
        tag = f'{story.sid[1:]}{month[:1]}{month[2:]}'
        b, c = ordinary(rnd, month, count, tag, style, layout)
        self.id, self.month, self.currency, self.per_page = f'{story.sid}-{month}', month, currency, per_page
        self.opening = opening if opening is not None else rnd.int(15000, 750000) * 100
        # `late` rows are recorded after the others, as given: out of date order.
        self.bank, self.cash = by_date(b + list(bank)), by_date(c + list(cash)) + list(late)
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


class Story:
    def __init__(self, sid, title, *, producer, font, paper, style, bank, title_doc, account, layout='en',
                 digits='latin', refs='chk', language='en'):
        self.sid, self.title, self.layout, self.digits, self.refs = sid, title, layout, digits, refs
        self.account = account
        self.print = {'producer': producer, 'font': font, 'paper': paper, 'style': style, 'bank': bank,
                      'documentTitle': title_doc}
        self.rnd = Random(0x5EE7 * 1000 + int(sid[1:]))
        self.periods, self.previous, self.recipe, self.intent = [], None, '', {}
        self.language, self.sheet = language, []

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


def book(balance, note):
    return {'book': {'balance': balance, 'note': note}}


def prepare(name, on):
    return {'prepare': {'name': name, 'date': on}}


def review(name, on):
    return {'review': {'name': name, 'date': on}}


def decide(kind, statement=(), cashbook=(), carried=()):
    return {'decide': {'type': kind, 'statement': list(statement), 'cashbook': list(cashbook), 'carried': list(carried)}}


def adjusted(p, receipts=0, payments=0, deposits=0, withdrawals=0):
    """The book balance that reconciles with the printed closing balance when
    these amounts are the items left outstanding: book receipts and payments
    not on the statement, statement deposits and withdrawals not in the book."""
    return p.closing() + receipts - payments - deposits + withdrawals


def item(name, section, origin, **more):
    return {'item': name, 'section': section, 'origin': origin, **more}


def outcome(status, difference=0, items=(), prepared=None, reviewed=None):
    return {'status': status, 'difference': difference, 'items': list(items),
            'signoffs': {'prepared': prepared, 'reviewed': reviewed}}


def refused(code):
    return {'refusal': code}


PREPARER = 'Preparer K. Accountant'
REVIEWER = 'Reviewer L. Senior'
RECEIPTS, PAYMENTS = 'bookReceiptsNotOnStatement', 'bookPaymentsNotOnStatement'
DEPOSITS, WITHDRAWALS = 'statementDepositsNotInBook', 'statementWithdrawalsNotInBook'
CEDAR = dict(bank='Cedar Plains Bank', title_doc='Business Current Account Statement')
SILVER = dict(bank='Silverline Mercantile Bank', title_doc='Statement of Account')
OASIS = dict(bank='مصرف الواحة التجاري', title_doc='كشف حساب جاري', layout='ar')
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

    K = Story

    def k01(s):
        jan = s.period('JAN', count=6)
        s.sheet = [book(jan.closing(), 'Cash at bank ledger, January close'),
                   prepare(PREPARER, '2028-02-03'), review(REVIEWER, '2028-02-04')]
        s.recipe = 'every movement matched; the declared book balance is the printed closing balance'
        s.intent = outcome('reconciled', prepared='valid', reviewed='valid')
    add(K('K01', 'Everything matched, prepared and reviewed', **HX_GRID, **CEDAR,
          account='SA14 6000 0000 3381 2500 4001', refs='chk'), k01)

    def k02(s):
        feb = s.period('FEB', per_page=4, cash=[cheque('FEB', 27, 'CHK-K02-2702', 184550, 'PV-K02-91'),
                                                receipt('FEB', 29, 'DEP-K02-2902', 1230000, 'RV-K02-92', 'Cash deposited after cut-off')])
        s.sheet = [book(adjusted(feb, receipts=1230000, payments=184550), 'Cash at bank ledger, February close'),
                   prepare(PREPARER, '2028-02-29'), review(REVIEWER, '2028-03-01')]
        s.recipe = ('a cheque written on 27 February and cash deposited on the 29th, the leap day, are not on the '
                    'February statement of two pages; prepared on 29 February')
        s.intent = outcome('reconciled', items=[item('FEB:RV-K02-92', RECEIPTS, 'unmatched'),
                                                item('FEB:PV-K02-91', PAYMENTS, 'unmatched')],
                           prepared='valid', reviewed='valid')
    add(K('K02', 'An outstanding cheque and a leap-day deposit in transit', **PL_GRID, **SILVER,
          account='SA39 1500 0000 7720 9100 5102', refs='slash'), k02)

    def k03(s):
        fee = debit('MAR', 31, 'FEE-K03-0331', 8625, 'رسوم إدارة الحساب')
        interest = credit('MAR', 31, 'INT-K03-0331', 41240, 'عائد الحساب')
        mar = s.period('MAR', bank=[fee, interest])
        s.sheet = [book(adjusted(mar, deposits=41240, withdrawals=8625), 'دفتر الأستاذ، النقد لدى البنك، إقفال مارس'),
                   prepare('المحاسب ع. الزهراني', '2028-04-02'), review('المراجع ف. القرني', '2028-04-03')]
        s.recipe = 'an Arabic statement in Arabic-Indic digits: a fee and interest on 31 March not yet in the book; an Arabic sheet'
        s.intent = outcome('reconciled', items=[item(K.S(mar, interest), DEPOSITS, 'unmatched'),
                                                item(K.S(mar, fee), WITHDRAWALS, 'unmatched')],
                           prepared='valid', reviewed='valid')
    add(K('K03', 'Arabic: a fee and interest the book does not have yet', **PL_CAIRO, **OASIS,
          account='SA83 2800 0000 4413 6600 6203', digits='arabic', refs='chk', language='ar'), k03)

    def k04(s):
        dec = s.period('DEC', cash=[cheque('DEC', 28, 'CHK-K04-1228', 40000, 'PV-K04-41'),
                                    cheque('DEC', 30, 'CHK-K04-1230', 50000, 'PV-K04-42')])
        s.sheet = [book(dec.closing(), 'Ledger before the two year-end cheques were posted')]
        s.recipe = ('two cheques of 400.00 and 500.00 are outstanding at the year end; the declared book balance '
                    'leaves them out, so the difference equals their sum and stays a difference')
        s.intent = outcome('difference', -90000, items=[item('DEC:PV-K04-41', PAYMENTS, 'unmatched'),
                                                        item('DEC:PV-K04-42', PAYMENTS, 'unmatched')])
    add(K('K04', 'A difference equal to the sum of two listed cheques', **HX_ROWS, **CEDAR,
          account='SA14 6000 0000 3381 2500 4004', refs='dotted'), k04)

    def k05(s):
        jan = s.period('JAN', opening=-125000000, cash=[cheque('JAN', 30, 'CHK-K05-0130', 725000, 'PV-K05-51')])
        s.sheet = [book(adjusted(jan, payments=725000), 'Overdraft facility ledger, credit balance')]
        s.recipe = 'an overdrawn account printed DR throughout; a cheque outstanding; the book balance is a credit balance'
        s.intent = outcome('reconciled', items=[item('JAN:PV-K05-51', PAYMENTS, 'unmatched')])
    add(K('K05', 'An overdraft with an outstanding cheque', **PL_WIDE, **SILVER,
          account='SA39 1500 0000 7720 9100 5105', refs='long'), k05)

    def k06(s):
        feb = s.period('FEB', count=12, per_page=5, drop_page=2)
        s.sheet = [book(feb.closing(), 'Cash at bank ledger, February close')]
        s.recipe = 'the February statement is pages 1 and 3 of 3; a book balance is declared'
        s.intent = refused('SHEET_STATEMENT_HELD')
    add(K('K06', 'A statement missing a page, with a book balance', **HX_WIDE, **CEDAR,
          account='SA14 6000 0000 3381 2500 4006', refs='chk'), k06)

    def k07(s):
        s.period('MAR', count=12, per_page=5, drop_page=2)
        s.recipe = 'the March statement is pages 1 and 3 of 3, and no book balance is declared: the statement decides'
        s.intent = refused('SHEET_STATEMENT_HELD')
    add(K('K07', 'A statement missing a page, without a book balance', **PL_LEMON, **SILVER,
          account='SA39 1500 0000 7720 9100 5107', refs='dotted'), k07)

    def k08(s):
        deposit = credit('DEC', 10, '', 214000, 'Cash deposit')
        withdrawal = debit('DEC', 18, '', 65500, 'Counter withdrawal')
        dec = s.period('DEC', bank=[deposit, withdrawal],
                       cash=[receipt('DEC', 11, '', 214000, 'RV-K08-81', 'Counter receipt'),
                             cheque('DEC', 17, '', 65500, 'PV-K08-82', 'Petty cash top-up')])
        s.sheet = [book(dec.closing(), 'Cash at bank ledger, December close'), prepare(PREPARER, '2028-01-04'),
                   decide('reject', [dec.sid(withdrawal)], ['PV-K08-82'])]
        s.recipe = ('two unreferenced amount suggestions await a decision; prepared; then one is rejected: the sheet '
                    'stays a draft with the same totals and difference, and only the rejected items change origin')
        s.intent = outcome('draft', items=[item('DEC:RV-K08-81', RECEIPTS, 'pending'), item('DEC:PV-K08-82', PAYMENTS, 'rejected'),
                                           item(K.S(dec, deposit), DEPOSITS, 'pending'),
                                           item(K.S(dec, withdrawal), WITHDRAWALS, 'rejected')],
                           prepared='void')
    add(K('K08', 'A preparation voided by the items alone', **HX_LETTER, **CEDAR,
          account='SA14 6000 0000 3381 2500 4008', refs='long'), k08)

    def k09(s):
        jan = s.period('JAN', late=[cheque('JAN', 9, 'CHK-K09-0109', 150000, 'PV-K09-91'),
                                    cheque('JAN', 5, 'CHK-K09-0105', 275000, 'PV-K09-92')])
        s.sheet = [book(adjusted(jan, payments=425000), 'Cash at bank ledger, January close')]
        s.recipe = ('two cheques are recorded at the end of the cashbook, the 9 January one before the 5 January '
                    'one; both are outstanding and are listed in the order of the cashbook rows')
        s.intent = outcome('reconciled', items=[item('JAN:PV-K09-91', PAYMENTS, 'unmatched'),
                                                item('JAN:PV-K09-92', PAYMENTS, 'unmatched')])
    add(K('K09', 'Outstanding cheques recorded out of date order', **PL_ROWS, **SILVER,
          account='SA39 1500 0000 7720 9100 5109', refs='chk'), k09)

    def k10(s):
        dec = s.period('DEC', cash=[cheque('DEC', 29, 'CHK-K10-1229', 332000, 'PV-K10-31')])
        presented = debit('JAN', 6, 'CHK-K10-1229', 332000, 'Cheque presented')
        jan = s.period('JAN', opening=dec.closing(), bank=[presented])
        s.previous = {'holds': ['DEC'], 'decisions': []}
        s.sheet = [book(jan.closing(), 'Cash at bank ledger, January close'),
                   decide('accept', [jan.sid(presented)], [], ['DEC:PV-K10-31']),
                   prepare(PREPARER, '2028-02-05'), review(REVIEWER, '2028-02-06')]
        s.recipe = 'a December cheque is presented in January; the accountant accepts the carried case'
        s.intent = outcome('reconciled', prepared='valid', reviewed='valid')
    add(K('K10', 'A carried cheque cleared by an accepted case', **HX_GRID, **CEDAR,
          account='SA14 6000 0000 3381 2500 4010', refs='slash'), k10)

    def k11(s):
        feb = s.period('FEB', cash=[cheque('FEB', 28, 'CHK-K11-0228', 910000, 'PV-K11-28')])
        mar = s.period('MAR', opening=feb.closing())
        s.previous = {'holds': ['FEB'], 'decisions': []}
        s.sheet = [book(adjusted(mar, payments=910000), 'Cash at bank ledger, March close')]
        s.recipe = 'a February cheque is not presented in March; the sheet is in Arabic for an English statement'
        s.intent = outcome('reconciled', items=[item('FEB:PV-K11-28', PAYMENTS, 'carried', age=2)])
    add(K('K11', 'A carried cheque still outstanding, an Arabic sheet', **PL_GRID, **SILVER,
          account='SA39 1500 0000 7720 9100 5111', refs='dotted', language='ar'), k11)

    def k12(s):
        dec = s.period('DEC', cash=[cheque('DEC', 20, 'CHK-K12-1220', 1288500, 'PV-K12-20')])
        jan = s.period('JAN', opening=dec.closing())
        feb = s.period('FEB', opening=jan.closing(), per_page=4)
        s.previous = {'holds': ['DEC', 'JAN'], 'decisions': []}
        s.sheet = [book(adjusted(feb, payments=1288500), 'Cash at bank ledger, February close'),
                   prepare(PREPARER, '2028-03-02'), review(REVIEWER, '2028-03-03')]
        s.recipe = ('a December cheque is still outstanding at the end of February; the January session is in the '
                    'roll format and holds the December one')
        s.intent = outcome('reconciled', items=[item('DEC:PV-K12-20', PAYMENTS, 'carried', age=3)],
                           prepared='valid', reviewed='valid')
    add(K('K12', 'A chain: a cheque three period ends old', **HX_WIDE, **CEDAR,
          account='SA14 6000 0000 3381 2500 4012', refs='long'), k12)

    def k13(s):
        jan = s.period('JAN', cash=[cheque('JAN', 29, 'CHK-K13-0129', 205000, 'PV-K13-29')])
        feb = s.period('FEB', opening=jan.closing() - 100,
                       bank=[debit('FEB', 3, 'CHK-K13-0129', 205000, 'Cheque presented')])
        s.previous = {'holds': ['JAN'], 'decisions': []}
        s.sheet = [book(feb.closing(), 'Cash at bank ledger, February close')]
        s.recipe = "February's printed opening balance is one riyal below January's printed closing balance"
        s.intent = refused('SHEET_PREVIOUS_REFUSED')
    add(K('K13', 'A previous session refused for its opening', **PL_LEMON, **SILVER,
          account='SA39 1500 0000 7720 9100 5113', refs='chk'), k13)

    def k14(s):
        dec = s.period('DEC', bank=[credit('DEC', 14, '', 62500, 'Cash deposit')],
                       cash=[receipt('DEC', 15, '', 62500, 'RV-K14-15', 'Counter receipt')])
        jan = s.period('JAN', opening=dec.closing())
        s.previous = {'holds': ['DEC'], 'decisions': []}
        s.sheet = [book(jan.closing(), 'Cash at bank ledger, January close')]
        s.recipe = 'December leaves an amount suggestion undecided, so its session cannot close the period'
        s.intent = refused('SHEET_PREVIOUS_REFUSED')
    add(K('K14', 'A previous session with an undecided suggestion', **HX_ROWS, **CEDAR,
          account='SA14 6000 0000 3381 2500 4014', refs='dotted'), k14)

    def k15(s):
        jan = s.period('JAN', cash=[receipt('JAN', 31, 'DEP-K15-0131', 455000, 'RV-K15-31', 'Cash deposited after cut-off')])
        s.period('FEB', opening=jan.closing(), bank=[credit('FEB', 1, 'DEP-K15-0131', 455000, 'Branch cash deposit')])
        s.previous = {'holds': ['JAN'], 'decisions': []}
        s.recipe = 'a January deposit reaches the bank on 1 February; no book balance is declared'
        s.intent = refused('SHEET_NO_BOOK_BALANCE')
    add(K('K15', 'A previous period accepted, no book balance', **PL_WIDE, **SILVER,
          account='SA39 1500 0000 7720 9100 5115', refs='slash'), k15)

    def k16(s):
        feb = s.period('FEB', currency='USD', cash=[cheque('FEB', 28, 'CHK-K16-0228', 61000, 'PV-K16-28')])
        s.period('MAR', opening=feb.closing(), bank=[debit('MAR', 6, 'CHK-K16-0228', 61000, 'Cheque presented')])
        s.previous = {'holds': ['FEB'], 'decisions': []}
        s.recipe = 'the February session is the dollar account and no book balance is declared: the previous period decides'
        s.intent = refused('SHEET_PREVIOUS_REFUSED')
    add(K('K16', 'A previous period refused and no book balance', **HX_LETTER, **CEDAR,
          account='SA14 6000 0000 3381 2500 4016', refs='chk'), k16)

    def k17(s):
        mar = s.period('MAR', cash=[receipt('MAR', 31, 'DEP-K17-0331', 640000, 'RV-K17-31', 'Cash deposited after cut-off')])
        balance = adjusted(mar, receipts=640000)
        s.sheet = [book(balance, 'Cash at bank ledger, March close'), prepare(PREPARER, '2028-04-04'),
                   review(REVIEWER, '2028-04-05'), book(balance, 'Cash at bank ledger, March close, after the audit query')]
        s.recipe = 'prepared and reviewed; then the source of the same book balance is restated'
        s.intent = outcome('reconciled', items=[item('MAR:RV-K17-31', RECEIPTS, 'unmatched')],
                           prepared='void', reviewed='void')
    add(K('K17', 'Sign-offs voided by a restated source of the same balance', **HX_GRID, **SILVER,
          account='SA39 1500 0000 7720 9100 5117', refs='long'), k17)

    def k18(s):
        deposit = credit('JAN', 12, '', 318000, 'Cash deposit')
        jan = s.period('JAN', bank=[deposit], cash=[receipt('JAN', 13, '', 318000, 'RV-K18-13', 'Counter receipt')])
        s.sheet = [book(jan.closing(), 'Cash at bank ledger, January close'), review(REVIEWER, '2028-02-02'),
                   decide('accept', [jan.sid(deposit)], ['RV-K18-13']), prepare(PREPARER, '2028-02-03')]
        s.recipe = 'reviewed while a suggestion awaited a decision; then accepted; then prepared'
        s.intent = outcome('reconciled', prepared='valid', reviewed='void')
    add(K('K18', 'Reviewed on a draft, prepared after the decision', **PL_GRID, **CEDAR,
          account='SA14 6000 0000 3381 2500 4018', refs='chk'), k18)

    def k19(s):
        fee = debit('DEC', 31, 'FEE-K19-1231', 3500, 'Incoming wire fee')
        dec = s.period('DEC', currency='USD', bank=[fee],
                       cash=[receipt('DEC', 31, 'DEP-K19-1231', 1250000, 'RV-K19-31', 'Cheques deposited after cut-off')])
        s.sheet = [book(adjusted(dec, receipts=1250000, withdrawals=3500), 'Dollar account ledger, December close')]
        s.recipe = 'a dollar account: a deposit in transit and a wire fee at the year end'
        s.intent = outcome('reconciled', items=[item('DEC:RV-K19-31', RECEIPTS, 'unmatched'),
                                                item(K.S(dec, fee), WITHDRAWALS, 'unmatched')])
    add(K('K19', 'A dollar account at the year end', **HX_ROWS, **SILVER,
          account='SA39 1500 0000 7720 9100 5119', refs='dotted'), k19)

    def k20(s):
        paid = debit('JAN', 14, 'PAY/K20/77', 441000, 'سداد مورد')
        jan = s.period('JAN', bank=[paid], cash=[cheque('JAN', 13, 'PAY/K20/77', 414000, 'PV-K20-77', 'سند صرف')])
        s.sheet = [book(adjusted(jan, payments=414000, withdrawals=441000), 'دفتر الأستاذ، النقد لدى البنك'),
                   decide('reject', [jan.sid(paid)], ['PV-K20-77']), prepare('المحاسب ع. الزهراني', '2028-02-07')]
        s.recipe = ('an Arabic statement in Arabic-Indic digits: the bank paid 4,410.00 under the reference the '
                    'book records for 4,140.00; the accountant rejects the case and both stay on the sheet')
        s.intent = outcome('reconciled', items=[item('JAN:PV-K20-77', PAYMENTS, 'rejected'),
                                                item(K.S(jan, paid), WITHDRAWALS, 'rejected')], prepared='valid')
    add(K('K20', 'Arabic: a rejected amount difference, both sides listed', **PL_CAIRO, **OASIS,
          account='SA83 2800 0000 4413 6600 6220', digits='arabic', refs='slash', language='ar'), k20)

    def k21(s):
        dec = s.period('DEC', cash=[cheque('DEC', 30, '', 198000, 'PV-K21-30', 'Courier advance')])
        paid = debit('JAN', 4, '', 198000, 'Counter cheque paid')
        jan = s.period('JAN', opening=dec.closing(), bank=[paid])
        s.previous = {'holds': ['DEC'], 'decisions': []}
        s.sheet = [book(jan.closing(), 'Cash at bank ledger, January close')]
        s.recipe = 'an unreferenced December payment and an unreferenced January withdrawal of its amount, undecided'
        s.intent = outcome('draft', items=[item('DEC:PV-K21-30', PAYMENTS, 'pending'),
                                           item(K.S(jan, paid), WITHDRAWALS, 'pending')])
    add(K('K21', 'A carried amount suggestion awaiting a decision', **HX_WIDE, **CEDAR,
          account='SA14 6000 0000 3381 2500 4021', refs='chk'), k21)

    def k22(s):
        mar = s.period('MAR', cash=[cheque('MAR', 29, 'CHK-K22-0329', 275500, 'PV-K22-29', 'سند صرف شيك')])
        s.sheet = [book(adjusted(mar, payments=275500), 'دفتر الأستاذ، النقد لدى البنك، إقفال مارس')]
        s.recipe = 'an Arabic statement in Latin digits, an outstanding cheque, an English sheet with an Arabic source'
        s.intent = outcome('reconciled', items=[item('MAR:PV-K22-29', PAYMENTS, 'unmatched')])
    add(K('K22', 'Arabic statement, English sheet', **PL_TAJAWAL, **OASIS,
          account='SA83 2800 0000 4413 6600 6222', digits='latin', refs='long'), k22)
    return stories


def facts(stories=None):
    stories = stories or build()
    return {
        'version': VERSION,
        'stories': [{
            'id': s.sid, 'title': s.title, 'layout': s.layout, 'language': s.language, 'digits': s.digits,
            'print': s.print,
            'periods': [{'id': p.id, 'statement': p.statement(),
                         'cashbook': [{k: r[k] for k in ('date', 'voucher', 'description', 'reference', 'receipt', 'payment')}
                                      for r in p.cash]} for p in s.periods],
            'previous': s.previous, 'sheet': s.sheet, 'recipe': s.recipe, 'intent': s.intent,
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
