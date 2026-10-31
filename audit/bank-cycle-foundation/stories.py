"""WF-1 CYCLE foundation: two consecutive months of one bank account, from
the files to the closing sheet, through every layer of the accountant's
workflow on the bank statement path.

Six stories, each over two consecutive months from July 2028 to January
2029, in Saudi riyals. A new lineage of the W4 random source (SplitMix64),
with its own seed, banks, accounts and company ledgers. Each month has:

- a printed statement in the bank-statement-native-1 layout, drawn by the
  HexaPDF statement service or the pdf-lib statement application copied
  from the T4 holdout (render.py);
- a cashbook as the company's ledger exports it, in a layout of its own
  under labels the declared reader does not know (openpyxl 3.1.5 or
  XlsxWriter 3.2.9, write_python.py, copied from the M4 holdout), read by
  columns the accountant chooses by hand in the first month and by the map
  saved then in the second (bank-cashbook-map-1); and the same rows as the
  declared cashbook (`<period>-cashbook.csv`), which the sealed oracles
  read;
- the accountant's steps in order: open the month (its files, how its
  ledger is read, the previous month's saved session in the second month),
  declare a tolerance (bank-tolerance-1), decide groups from the review
  queue (bank-review-queue-1) and single cases, declare the book balance,
  choose the sheet's language, prepare and review the sheet
  (bank-reconciliation-sheet-1), and save the session, which the next
  month takes as its previous session (bank-statement-roll-1).

Decisions name their members: the period's statement movements S<n> and
cashbook vouchers, and carried items as `<MONTH>:<id>`. A group names the
cases it holds, by their members, and the decision the queue offers for
it. `recipe` says how a story was made; `intent` is what each save is
expected to show, written by hand. The oracle reads neither.

  python3 -B audit/bank-cycle-foundation/stories.py > stories.json
  python3 -B audit/bank-cycle-foundation/stories.py --records > records.json
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

VERSION = 'bank-cycle-foundation-1'
HERE = Path(__file__).resolve().parent
MONTHS = {
    'JUL': ('2028-07-01', '2028-07-31'),
    'AUG': ('2028-08-01', '2028-08-31'),
    'SEP': ('2028-09-01', '2028-09-30'),
    'OCT': ('2028-10-01', '2028-10-31'),
    'NOV': ('2028-11-01', '2028-11-30'),
    'DEC': ('2028-12-01', '2028-12-31'),
    'JAN': ('2029-01-01', '2029-01-31'),
}
EXPONENT = {'SAR': 2}
ROLES = ['date', 'voucher', 'description', 'reference', 'receipts', 'payments']


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


def ordinary(rnd, month, count, tag, layout):
    """`count` ordinary movements of one month, each recorded on both sides
    under the same explicit reference, dated within the window: automatic
    matches, with amounts no planted row uses (odd halalas)."""
    words = NARRATIVE[layout]
    bank, cash = [], []
    for i in range(count):
        d = 2 + (25 * i) // max(count - 1, 1)
        out = rnd.int(0, 1) == 1
        amount = rnd.int(100, 4900) * 100 + rnd.int(1, 99)
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
    def __init__(self, rnd, story, month, *, bank=(), cash=(), count=6, opening=None, per_page=12):
        tag = f'{story.sid[1:]}{month[:2]}'
        b, c = ordinary(rnd, month, count, tag, story.layout)
        self.id, self.month, self.currency, self.per_page = f'{story.sid}-{month}', month, 'SAR', per_page
        # An opening of 200,000.00 to 900,000.00.
        self.opening = opening if opening is not None else rnd.int(20000, 90000) * 1000
        self.bank, self.cash = by_date(b + list(bank)), by_date(c + list(cash))
        self.account = story.account

    def rows(self):
        balance, out = self.opening, []
        for r in self.bank:
            balance += r['deposit'] - r['withdrawal']
            out.append(dict(r, balance=balance))
        return out

    def closing(self):
        rows = self.rows()
        return rows[-1]['balance'] if rows else self.opening

    def statement(self):
        """The printed pages, as bank-statement-native-1 prints them."""
        rows = self.rows()
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

    def flows(self):
        """The book's receipts less its payments in this month."""
        return sum(r['receipt'] - r['payment'] for r in self.cash)

    def S(self, row):
        """A planted movement as the statement numbers it: S<n> in printed order."""
        return f'S{self.bank.index(row) + 1}'


# ---- company ledgers --------------------------------------------------------
# Layouts (label, field), from the M4 holdout. A field that is not a role is
# printed and never read.
ERP1 = [('Posting Date', 'date'), ('Doc. No.', 'voucher'), ('Narrative', 'description'),
        ('Cheque / Ref.', 'reference'), ('Money In', 'receipts'), ('Money Out', 'payments'),
        ('Running Balance', 'balance')]
ERP1_COLUMNS = {'date': 1, 'voucher': 2, 'description': 3, 'reference': 4, 'receipts': 5, 'payments': 6}
ERP1_INSERTED = ERP1[:1] + [('Value Date', 'date')] + ERP1[1:]
ERP1_INSERTED_COLUMNS = {'date': 1, 'voucher': 3, 'description': 4, 'reference': 5, 'receipts': 6, 'payments': 7}
ERP2 = [('Line', 'line'), ('Value Date', 'date'), ('Journal', 'journal'), ('Voucher #', 'voucher'),
        ('Memo', 'description'), ('Ext. Reference', 'reference'), ('Dr', 'receipts'), ('Cr', 'payments'),
        ('Cost Centre', 'cost')]
ERP2_COLUMNS = {'date': 2, 'voucher': 4, 'description': 5, 'reference': 6, 'receipts': 7, 'payments': 8}
AR2 = [('تاريخ القيد', 'date'), ('رقم القيد', 'voucher'), ('الوصف', 'description'), ('رقم الشيك', 'reference'),
       ('إيداعات', 'receipts'), ('مسحوبات', 'payments'), ('الرصيد', 'balance')]
AR2_COLUMNS = {'date': 1, 'voucher': 2, 'description': 3, 'reference': 4, 'receipts': 5, 'payments': 6}
NB = [('Posting\u00a0Date', 'date'), ('Doc  No', 'voucher'), ('Narrative ', 'description'),
      ('Cheque\u00a0/ Ref', 'reference'), ('Money\u00a0In', 'receipts'), ('Money Out', 'payments')]
NB_COLUMNS = {'date': 1, 'voucher': 2, 'description': 3, 'reference': 4, 'receipts': 5, 'payments': 6}
LAYOUTS = {
    'ERP1': (ERP1, ERP1_COLUMNS), 'ERP1_INSERTED': (ERP1_INSERTED, ERP1_INSERTED_COLUMNS),
    'ERP2': (ERP2, ERP2_COLUMNS), 'AR2': (AR2, AR2_COLUMNS), 'NB': (NB, NB_COLUMNS),
}


def titles(layout, company, month):
    if layout in ('ERP1', 'ERP1_INSERTED'):
        return [[company], ['Bank ledger 1010 — Current account'], [f'Exported for {month} {MONTHS[month][0][:4]}'], []]
    if layout == 'ERP2':
        return [['GL account 1020 transactions']]
    if layout == 'AR2':
        return [[company], ['كشف حساب البنك — الحساب الجاري'], []]
    return []


def shortest(m):
    sign, m = ('-' if m < 0 else ''), abs(m)
    return sign + f'{m // 100}.{m % 100:02d}'.rstrip('0').rstrip('.')


def ledger_rows(period, layout, company, opening_book):
    """Title rows, the header, one row per cashbook entry in the layout,
    amounts as typed numbers, and a running balance the reader never reads."""
    fields, _ = LAYOUTS[layout]
    rows = [list(t) for t in titles(layout, company, period.month)]
    rows.append([label for label, _ in fields])
    balance = opening_book
    for k, r in enumerate(period.cash):
        balance += r['receipt'] - r['payment']
        row = []
        for _, field in fields:
            if field == 'date':
                value = r['date']
            elif field in ('voucher', 'description', 'reference'):
                value = r[field]
            elif field == 'receipts':
                value = {'n': shortest(r['receipt'])} if r['receipt'] else ''
            elif field == 'payments':
                value = {'n': shortest(r['payment'])} if r['payment'] else ''
            elif field == 'balance':
                value = {'n': shortest(balance)}
            else:
                value = {'line': str(k + 1), 'journal': 'CB', 'cost': 'CC-210'}[field]
            row.append(value)
        rows.append(row)
    return rows


class Story:
    def __init__(self, sid, title, *, producer, font, paper, style, bank, title_doc, account, company, writer,
                 layout='en', digits='latin'):
        self.sid, self.title, self.layout, self.digits = sid, title, layout, digits
        self.account, self.company, self.writer = account, company, writer
        self.print = {'producer': producer, 'font': font, 'paper': paper, 'style': style, 'bank': bank,
                      'documentTitle': title_doc}
        self.rnd = Random(0xC1C1E * 1000 + int(sid[1:]))
        self.periods, self.ledgers, self.steps, self.recipe, self.intent = [], {}, [], '', {}

    def period(self, month, layout, **kw):
        if self.periods and 'opening' not in kw:
            kw['opening'] = self.periods[-1].closing()
        p = Period(self.rnd, self, month, **kw)
        self.periods.append(p)
        self.ledgers[p.id] = layout
        return p

    def book(self, upto, extra=0):
        """The book balance of a book that agreed with the bank when the
        first month opened: that opening, every month's receipts less its
        payments up to `upto`, and `extra`."""
        total = self.periods[0].opening
        for p in self.periods:
            total += p.flows()
            if p is upto:
                break
        return total + extra


# Planted rows: a withdrawal is paid in the book, a deposit received.
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


ARABIC_WORDS = {'out': 'سداد فاتورة', 'in': 'تحصيل فاتورة', 'cash_out': 'سند صرف', 'cash_in': 'سند قبض'}


def pairs(month, tag, plants, words=None):
    """One referenced pair per plant (direction, statement amount, book
    amount, statement day, book day)."""
    words = words or {}
    bank, cash = [], []
    for i, (direction, s, c, d, e) in enumerate(plants):
        ref = f"{'INV' if direction == 'out' else 'RCV'}-{tag}-{i + 1:02d}"
        voucher = f"{'PV' if direction == 'out' else 'RV'}-{tag}-{i + 1:02d}"
        if direction == 'out':
            bank.append(wd(month, d, ref, s, words.get('out', 'Supplier transfer')))
            cash.append(paid(month, e, ref, c, voucher, words.get('cash_out', 'Payment voucher')))
        else:
            bank.append(dep(month, d, ref, s, words.get('in', 'Customer remittance')))
            cash.append(got(month, e, ref, c, voucher, words.get('cash_in', 'Receipt voucher')))
    return bank, cash


# ---- steps --------------------------------------------------------------------

def open_(period, ledger, previous=None):
    step = {'open': period.id, 'ledger': ledger}
    if previous:
        step['previous'] = previous
    return step


def by_hand(header, columns, save=None):
    out = {'by': 'hand', 'header': header, 'columns': {r: columns.get(r) for r in ROLES}}
    if save:
        out['save'] = save
    return out


def by_map(name, then=None):
    """The map saved under `name`; when it does not fit, `then`: the choice
    by hand the accountant makes instead."""
    out = {'by': 'map', 'map': name}
    if then:
        out['then'] = then
    return out


def policy(per_item, per_period, note):
    return {'policy': {'perItem': per_item, 'perPeriod': per_period, 'note': note}}


def members(statement=(), cashbook=(), carried=()):
    return {'statement': list(statement), 'cashbook': list(cashbook), 'carried': list(carried)}


def accept(**m):
    return {'accept': members(**m)}


def reject(**m):
    return {'reject': members(**m)}


def group(kind, cases):
    """A group decision from the queue: `kind` on the group holding exactly
    these cases, each given by its members."""
    return {'group': {'type': kind, 'cases': [members(**c) for c in cases]}}


def book(balance, note):
    return {'book': {'balance': balance, 'note': note}}


def sign(kind, name, when):
    return {kind: {'name': name, 'date': when}}


def save(label):
    return {'save': label}


def intent(*, previous='none', tolerated=0, exceeded=None, groups=(), carried=0, still=0, pending=0,
           sheet=None):
    """What a save shows: the previous session's verdict, the tolerated
    cases standing (a tolerated case the accountant rejected is not one, as
    in the T4 intent), the period limit exceeded, the queue's groups as [reason, cases,
    offers] before any decision, the carried items and those still carried
    at the end, the cases awaiting a decision, and the sheet as its refusal
    or [status, difference, tolerated, unexplained]."""
    return {'previous': previous, 'tolerated': tolerated, 'exceeded': exceeded, 'groups': [list(g) for g in groups],
            'carried': carried, 'still': still, 'pending': pending,
            'sheet': sheet if isinstance(sheet, str) or sheet is None else list(sheet)}


HX_GRID = dict(producer='hexapdf', font='Work Sans', paper='A4', style={'rules': 'grid', 'heading': 'filled'})
HX_ROWS = dict(producer='hexapdf', font='Merriweather', paper='A4', style={'rules': 'rows', 'heading': 'rule'})
PL_GRID = dict(producer='pdflib', font='Rubik', paper='A4', style={'rules': 'grid', 'heading': 'filled'})
PL_ROWS = dict(producer='pdflib', font='Readex Pro', paper='A4', style={'rules': 'rows', 'heading': 'rule'})
PL_CAIRO = dict(producer='pdflib', font='Cairo', paper='A4', style={'rules': 'rows', 'heading': 'filled'})
PL_TAJAWAL = dict(producer='pdflib', font='Tajawal', paper='A4', style={'rules': 'rows', 'heading': 'filled'})
CEDAR = dict(bank='Cedar Gulf Bank', title_doc='Current Account Statement')
DUNE = dict(bank='Dune Harbor Bank', title_doc='Statement of Account')
SADU = dict(bank='بنك السدو التجاري', title_doc='كشف حساب جاري', layout='ar')
NOTE_EN = 'General ledger bank account, closing balance'
NOTE_AR = 'رصيد حساب البنك في الأستاذ العام'
PREPARER, REVIEWER = 'Huda Al-Saleh', 'Omar Bakri'
PREPARER_AR, REVIEWER_AR = 'هدى الصالح', 'عمر بكري'


def build():
    stories = []

    def add(story, make):
        make(story)
        stories.append(story)

    Y = Story

    def y01(s):
        b1, c1 = pairs('JUL', 'Y01', [('in', 240000, 239999, 12, 12), ('out', 85000, 85000, 9, 3),
                                      ('out', 42000, 42000, 20, 14)])
        cheque = paid('JUL', 27, 'CHQ-Y01-04', 125000, 'PV-Y01-04', 'Cheque issued')
        fee = wd('JUL', 28, 'FEE-Y01-05', 3500, 'Account maintenance fee')
        jul = s.period('JUL', 'ERP1', bank=b1 + [fee], cash=c1 + [cheque])
        b2, c2 = pairs('AUG', 'Y01', [('out', 310002, 310000, 15, 15), ('in', 50000, 49600, 22, 22)])
        cleared = wd('AUG', 4, 'CHQ-Y01-04', 125000, 'Cheque presented')
        booked = paid('AUG', 2, 'FEE-Y01-05', 3500, 'PV-Y01-21', 'Bank fee, July')
        aug = s.period('AUG', 'ERP1', bank=b2 + [cleared], cash=c2 + [booked])
        name = 'Northwind bank ledger'
        s.steps = [
            open_(jul, by_hand(5, ERP1_COLUMNS, save=name)),
            policy(1, 5, 'Rounding by the payment network'),
            group('accept', [dict(statement=[jul.S(b1[1])], cashbook=[c1[1]['voucher']]),
                             dict(statement=[jul.S(b1[2])], cashbook=[c1[2]['voucher']])]),
            book(s.book(jul), NOTE_EN), {'language': 'en'},
            sign('prepare', PREPARER, '2028-08-02'), sign('review', REVIEWER, '2028-08-03'),
            save('Y01-JUL'),
            open_(aug, by_map(name), previous='Y01-JUL'),
            policy(2, 5, 'Rounding by the payment network'),
            accept(statement=[aug.S(cleared)], carried=['JUL:PV-Y01-04']),
            accept(cashbook=['PV-Y01-21'], carried=[f'JUL:{jul.S(fee)}']),
            reject(statement=[aug.S(b2[1])], cashbook=[c2[1]['voucher']]),
            book(s.book(aug), NOTE_EN), {'language': 'en'},
            sign('prepare', PREPARER, '2028-09-04'), sign('review', REVIEWER, '2028-09-05'),
            save('Y01-AUG'),
        ]
        s.recipe = ('July: a 2,400.00 remittance the book receives as 2,399.99, tolerated; two payments the book '
                    'dated six days early, a group of two date gaps accepted together; an unpresented cheque of '
                    '1,250.00 and an unbooked fee of 35.00. August: the cheque is presented and the fee booked, '
                    'both cleared by accepting their carried cases; a 0.02 difference tolerated under a new '
                    'declaration; a 4.00 difference rejected. The July halala, tolerated but never booked, is still '
                    'between the bank and the book in August: the August sheet shows it unexplained.')
        s.intent = {
            'Y01-JUL': intent(tolerated=1, groups=[('date-gap', 2, 'accept+reject')], sheet=('reconciled-within-tolerance', 1, 1, 0)),
            'Y01-AUG': intent(previous='accepted', tolerated=1, groups=[('amount-difference', 1, '')], carried=2,
                              sheet=('difference', -1, -2, 1)),
        }
    add(Y('Y01', 'A month closed within tolerance, and its halala a month later', **HX_GRID, **CEDAR,
          account='SA44 2000 0000 7104 3300 9101', company='Northwind Distribution LLC', writer='openpyxl'), y01)

    def y02(s):
        b1, c1 = pairs('AUG', 'Y02', [('in', 100001, 100000, 10, 10)], words=ARABIC_WORDS)
        dup_b = [wd('AUG', 14, 'TRF-Y02-02', 30000, 'سداد فاتورة'), wd('AUG', 15, 'TRF-Y02-02', 30000, 'سداد فاتورة'),
                 wd('AUG', 19, 'TRF-Y02-03', 41000, 'سداد فاتورة'), wd('AUG', 20, 'TRF-Y02-03', 41000, 'سداد فاتورة')]
        dup_c = [paid('AUG', 14, 'TRF-Y02-02', 60000, 'PV-Y02-02', 'سند صرف'),
                 paid('AUG', 19, 'TRF-Y02-03', 82000, 'PV-Y02-03', 'سند صرف')]
        transit = got('AUG', 30, 'RCV-Y02-09', 50000, 'RV-Y02-09', 'إيداع نقدي')
        aug = s.period('AUG', 'AR2', bank=b1 + dup_b, cash=c1 + dup_c + [transit], count=8, per_page=9)
        b2, c2 = pairs('SEP', 'Y02', [('out', 70001, 70000, 15, 15)], words=ARABIC_WORDS)
        late = dep('SEP', 3, 'RCV-Y02-09', 50001, 'إيداع نقدي')
        sep = s.period('SEP', 'AR2', bank=b2 + [late], cash=c2, count=8, per_page=9)
        name = 'دفتر البنك'
        note = 'فروق تقريب شبكة المدفوعات'
        rv = c1[0]['voucher']
        s.steps = [
            open_(aug, by_hand(4, AR2_COLUMNS, save=name)),
            policy(1, 3, note),
            reject(statement=[aug.S(b1[0])], cashbook=[rv]),
            group('reject', [dict(statement=[aug.S(dup_b[0]), aug.S(dup_b[1])], cashbook=['PV-Y02-02']),
                             dict(statement=[aug.S(dup_b[2]), aug.S(dup_b[3])], cashbook=['PV-Y02-03'])]),
            book(s.book(aug), NOTE_AR), {'language': 'ar'},
            sign('prepare', PREPARER_AR, '2028-09-02'), sign('review', REVIEWER_AR, '2028-09-03'),
            save('Y02-AUG'),
            open_(sep, by_map(name), previous='Y02-AUG'),
            policy(1, 3, note),
            reject(statement=[sep.S(late)], carried=['AUG:RV-Y02-09']),
            book(s.book(sep), NOTE_AR), {'language': 'ar'},
            sign('prepare', PREPARER_AR, '2028-10-02'),
            save('Y02-SEP'),
        ]
        s.recipe = ('Arabic, Arabic-Indic digits, two pages a month. August: a 1,000.01 remittance the book receives '
                    'as 1,000.00, tolerated and then rejected by the accountant, both members outstanding; two '
                    'references each paid in two transfers and booked once, a group of two duplicate-reference cases '
                    'rejected together; a deposit in transit of 500.00. September: the deposit arrives as 500.01, a '
                    'carried case with an amount difference within the new declaration, which a tolerance never '
                    'touches: rejected; a 700.01 payment the book pays as 700.00, tolerated. The rejected July '
                    'members and the duplicates stay carried, two months old.')
        s.intent = {
            'Y02-AUG': intent(tolerated=0, groups=[('duplicate-reference', 2, 'reject')], sheet=('reconciled', 0, 0, 0)),
            'Y02-SEP': intent(previous='accepted', tolerated=1, carried=9, still=8,
                              sheet=('reconciled-within-tolerance', -1, -1, 0)),
        }
    add(Y('Y02', 'Arabic: a tolerated pair rejected and carried, a carried difference no tolerance touches',
          **PL_CAIRO, **SADU, account='SA09 8000 0000 6123 4500 9202', company='مؤسسة الفجر للتوريدات',
          writer='xlsxwriter', digits='arabic'), y02)

    def y03(s):
        b1, c1 = pairs('SEP', 'Y03', [('out', 120090, 120000, 6, 6), ('out', 80050, 80000, 13, 13),
                                      ('in', 59925, 60000, 21, 21)])
        sep = s.period('SEP', 'ERP2', bank=b1, cash=c1)
        b2, c2 = pairs('OCT', 'Y03-OCT', [('out', 40001, 40000, 11, 11)])
        oct_ = s.period('OCT', 'ERP2', bank=b2, cash=c2)
        name = 'GL 1020'
        s.steps = [
            open_(sep, by_hand(2, ERP2_COLUMNS, save=name)),
            policy(90, 150, 'Bank charges deducted at source'),
            group('reject', [dict(statement=[sep.S(b1[0])], cashbook=[c1[0]['voucher']]),
                             dict(statement=[sep.S(b1[1])], cashbook=[c1[1]['voucher']])]),
            reject(statement=[sep.S(b1[2])], cashbook=[c1[2]['voucher']]),
            book(s.book(sep), NOTE_EN), {'language': 'en'},
            sign('prepare', PREPARER, '2028-10-03'),
            save('Y03-SEP'),
            open_(oct_, by_map(name), previous='Y03-SEP'),
            policy(90, 150, 'Bank charges deducted at source'),
            book(s.book(oct_, extra=-1000), NOTE_EN), {'language': 'en'},
            sign('prepare', PREPARER, '2028-11-02'), sign('review', REVIEWER, '2028-11-03'),
            save('Y03-OCT'),
        ]
        s.recipe = ('September: two payments the bank takes 0.90 and 0.50 above the book and a receipt it credits 0.75 '
                    'below it: 2.15 in all, past a period limit of 1.50, though they net to 0.65: none tolerated; the two payments rejected together from the queue, the receipt alone; six members '
                    'outstanding. October: they stay carried; a new 0.01 difference tolerated; the declared book '
                    'balance is 10.00 below the book, a rest without explanation.')
        s.intent = {
            'Y03-SEP': intent(exceeded={'sum': 215, 'cap': 150},
                              groups=[('amount-difference', 2, 'reject'), ('amount-difference', 1, '')],
                              sheet=('reconciled', 0, 0, 0)),
            'Y03-OCT': intent(previous='accepted', tolerated=1, carried=6, still=6, sheet=('difference', 999, -1, 1000)),
        }
    add(Y('Y03', 'Past the period limit, rejected in a group, carried', **PL_ROWS, **DUNE,
          account='SA71 6000 0000 3381 0900 9303', company='Tihama Builders Co.', writer='openpyxl'), y03)

    def y04(s):
        b1, c1 = pairs('OCT', 'Y04', [('out', 99000, 99000, 17, 12)])
        transit = got('OCT', 30, 'RCV-Y04-02', 45000, 'RV-Y04-02', 'Cash deposit')
        oct_ = s.period('OCT', 'NB', bank=b1, cash=c1 + [transit])
        arrived = dep('NOV', 2, 'RCV-Y04-02', 45000, 'Cash deposit')
        nov = s.period('NOV', 'NB', bank=[arrived])
        name = 'Treasury export'
        s.steps = [
            open_(oct_, by_hand(1, NB_COLUMNS, save=name)),
            book(s.book(oct_), NOTE_EN), {'language': 'en'},
            save('Y04-OCT-open'),
            accept(statement=[oct_.S(b1[0])], cashbook=[c1[0]['voucher']]),
            sign('prepare', PREPARER, '2028-11-01'),
            save('Y04-OCT'),
            open_(nov, by_map(name), previous='Y04-OCT-open'),
            book(s.book(nov), NOTE_EN), {'language': 'en'},
            save('Y04-NOV-refused'),
            open_(nov, by_map(name), previous='Y04-OCT'),
            accept(statement=[nov.S(arrived)], carried=['OCT:RV-Y04-02']),
            book(s.book(nov), NOTE_EN), {'language': 'en'},
            sign('prepare', PREPARER, '2028-12-01'), sign('review', REVIEWER, '2028-12-02'),
            save('Y04-NOV'),
        ]
        s.recipe = ('October, saved once with a date gap undecided and once after accepting it; a deposit in transit '
                    'of 450.00. November taken first on the undecided session: refused as undecided, nothing '
                    'carried, the sheet refused with it; then on the decided one: the deposit arrives and its '
                    'carried case is accepted.')
        s.intent = {
            'Y04-OCT-open': intent(groups=[('date-gap', 1, '')], pending=1, sheet=('draft', 0, 0, 0)),
            'Y04-OCT': intent(groups=[('date-gap', 1, '')], sheet=('reconciled', 0, 0, 0)),
            'Y04-NOV-refused': intent(previous='ROLL_PREVIOUS_UNDECIDED', sheet='SHEET_PREVIOUS_REFUSED'),
            'Y04-NOV': intent(previous='accepted', carried=1, sheet=('reconciled', 0, 0, 0)),
        }
    add(Y('Y04', 'An undecided month refused as previous, then taken once decided', **HX_ROWS, **CEDAR,
          account='SA44 2000 0000 7104 3300 9404', company='Qasr Logistics', writer='openpyxl'), y04)

    def y05(s):
        b1, c1 = pairs('NOV', 'Y05', [('out', 55001, 55000, 8, 8), ('in', 66602, 66600, 19, 19),
                                      ('out', 44401, 44400, 24, 20)], words=ARABIC_WORDS)
        cheque = paid('NOV', 28, 'CHQ-Y05-03', 230000, 'PV-Y05-09', 'شيك صادر')
        nov = s.period('NOV', 'ERP1', bank=b1, cash=c1 + [cheque])
        b2, c2 = pairs('DEC', 'Y05', [('in', 15001, 15000, 16, 16)], words=ARABIC_WORDS)
        presented = wd('DEC', 5, 'CHQ-Y05-03', 230000, 'صرف شيك')
        dec = s.period('DEC', 'ERP1_INSERTED', bank=b2 + [presented], cash=c2)
        name = 'دفتر البنك الرئيسي'
        s.steps = [
            open_(nov, by_hand(5, ERP1_COLUMNS, save=name)),
            policy(2, 5, 'فروق تقريب'),
            reject(statement=[nov.S(b1[2])], cashbook=[c1[2]['voucher']]),
            book(s.book(nov), NOTE_AR), {'language': 'ar'},
            sign('prepare', PREPARER_AR, '2028-12-02'), sign('review', REVIEWER_AR, '2028-12-03'),
            save('Y05-NOV'),
            open_(dec, by_map(name, then=by_hand(5, ERP1_INSERTED_COLUMNS)), previous='Y05-NOV'),
            accept(statement=[dec.S(presented)], carried=['NOV:PV-Y05-09']),
            reject(statement=[dec.S(b2[0])], cashbook=[c2[0]['voucher']]),
            book(s.book(dec), NOTE_AR), {'language': 'ar'},
            sign('prepare', PREPARER_AR, '2029-01-03'),
            save('Y05-DEC'),
        ]
        s.recipe = ('Arabic, Latin digits. November: two differences of 0.01 and 0.02 tolerated; a third of 0.01 '
                    'whose book date is four days before the bank\'s, beyond the window, which no tolerance reaches: '
                    'rejected and carried; an unpresented cheque of 2,300.00. December: the ledger gains a value-date column, so the saved map does not '
                    'fit and the columns are chosen again; no tolerance is declared, so a 0.01 difference waits and '
                    'is rejected; the cheque is presented and its carried case accepted. November\'s tolerated '
                    'differences, never booked, remain between bank and book.')
        s.intent = {
            'Y05-NOV': intent(tolerated=2, groups=[('amount-difference', 1, '')], sheet=('reconciled-within-tolerance', 1, 1, 0)),
            'Y05-DEC': intent(previous='accepted', groups=[('amount-difference', 1, '')], carried=3, still=2,
                              sheet=('difference', 1, 0, 1)),
        }
    add(Y('Y05', 'Arabic: a ledger column inserted, the saved map no longer fits', **PL_TAJAWAL, **SADU,
          account='SA09 8000 0000 6123 4500 9505', company='مؤسسة الواحة التجارية', writer='xlsxwriter'), y05)

    def y06(s):
        b1, c1 = pairs('DEC', 'Y06', [('out', 51001, 51000, 4, 4), ('in', 62002, 62000, 11, 11),
                                      ('out', 73003, 73000, 18, 18),
                                      ('out', 21500, 21500, 9, 4), ('out', 32500, 32500, 16, 11),
                                      ('out', 43500, 43500, 23, 18)])
        sugg_b = [wd('DEC', 7, 'DD-Y06-07', 33300, 'Direct debit'), wd('DEC', 21, 'DD-Y06-08', 44400, 'Direct debit')]
        sugg_c = [paid('DEC', 6, 'UTIL-DEC', 33300, 'PV-Y06-07', 'Utilities'),
                  paid('DEC', 20, 'TEL-DEC', 44400, 'PV-Y06-08', 'Telecom')]
        transit = got('DEC', 31, 'RCV-Y06-09', 77000, 'RV-Y06-09', 'Cash deposit')
        cheque = paid('DEC', 29, 'CHQ-Y06-10', 64000, 'PV-Y06-10', 'Cheque issued')
        dec = s.period('DEC', 'ERP2', bank=b1 + sugg_b, cash=c1 + sugg_c + [transit, cheque], count=24)
        b2, c2 = pairs('JAN', 'Y06-JAN', [('out', 81001, 81000, 6, 6), ('in', 92001, 92000, 13, 13),
                                      ('out', 18800, 18800, 20, 14), ('out', 27700, 27700, 27, 21)])
        arrived = dep('JAN', 3, '', 77000, 'Cash deposit')
        late_cheque = paid('JAN', 30, 'CHQ-Y06-11', 12000, 'PV-Y06-11', 'Cheque issued')
        jan = s.period('JAN', 'ERP2', bank=b2 + [arrived], cash=c2 + [late_cheque], count=24)
        name = 'GL 1020 export'
        s.steps = [
            open_(dec, by_hand(2, ERP2_COLUMNS, save=name)),
            policy(3, 6, 'Rounding by the payment network'),
            group('accept', [dict(statement=[dec.S(b1[k])], cashbook=[c1[k]['voucher']]) for k in (5, 4, 3)]),
            group('accept', [dict(statement=[dec.S(sugg_b[1])], cashbook=['PV-Y06-08']),
                             dict(statement=[dec.S(sugg_b[0])], cashbook=['PV-Y06-07'])]),
            book(s.book(dec), NOTE_EN), {'language': 'en'},
            sign('prepare', PREPARER, '2029-01-02'), sign('review', REVIEWER, '2029-01-03'),
            save('Y06-DEC'),
            open_(jan, by_map(name), previous='Y06-DEC'),
            policy(3, 6, 'Rounding by the payment network'),
            accept(statement=[jan.S(arrived)], carried=['DEC:RV-Y06-09']),
            group('reject', [dict(statement=[jan.S(b2[3])], cashbook=[c2[3]['voucher']]),
                             dict(statement=[jan.S(b2[2])], cashbook=[c2[2]['voucher']])]),
            book(s.book(jan), NOTE_EN), {'language': 'en'},
            sign('prepare', PREPARER, '2029-02-02'), sign('review', REVIEWER, '2029-02-03'),
            save('Y06-JAN'),
        ]
        s.recipe = ('Across the year end, three pages a month. December: differences of 0.01, 0.02 and 0.03 meet a '
                    'period limit of 0.06 exactly; three payments booked five days early accepted together from '
                    'the queue, and two direct debits booked under other references, suggested by amount and date '
                    'and accepted together; a deposit in transit of 770.00 and an unpresented cheque of 640.00. '
                    'January: the deposit arrives without a reference, a carried suggestion by amount, accepted; '
                    'the December cheque is still unpresented and a January cheque joins it in the same section, '
                    'December first; two date gaps rejected together; two differences of 0.01 tolerated.')
        s.intent = {
            'Y06-DEC': intent(tolerated=3, groups=[('amount-date-suggestion', 2, 'accept+reject'), ('date-gap', 3, 'accept+reject')],
                              sheet=('reconciled-within-tolerance', -2, -2, 0)),
            'Y06-JAN': intent(previous='accepted', tolerated=2, groups=[('date-gap', 2, 'accept+reject')], carried=2,
                              still=1, sheet=('difference', -2, 0, -2)),
        }
    add(Y('Y06', 'Across the year end: queues, tolerance and a cheque still out', **PL_GRID, **DUNE,
          account='SA71 6000 0000 3381 0900 9606', company='Northwind Distribution LLC', writer='xlsxwriter'), y06)
    return stories


def cash_row(r):
    return {k: r[k] for k in ('date', 'voucher', 'description', 'reference', 'receipt', 'payment')}


def ledgers(s):
    """Each period's ledger: its layout, writer, file and rows."""
    out = {}
    balance = s.periods[0].opening
    for p in s.periods:
        layout = s.ledgers[p.id]
        out[p.id] = {'layout': layout, 'writer': s.writer, 'file': f'{p.id}-ledger.xlsx',
                     'rows': ledger_rows(p, layout, s.company, balance)}
        balance += p.flows()
    return out


def facts(stories=None):
    stories = stories or build()
    return {
        'version': VERSION,
        'stories': [{
            'id': s.sid, 'title': s.title, 'layout': s.layout, 'digits': s.digits, 'print': s.print,
            'periods': [{'id': p.id, 'statement': p.statement(), 'cashbook': [cash_row(r) for r in p.cash]}
                        for p in s.periods],
            'ledgers': ledgers(s),
            'steps': s.steps, 'recipe': s.recipe, 'intent': s.intent,
        } for s in stories],
    }


def facts_json(stories=None):
    return json.dumps(facts(stories), ensure_ascii=False, indent=1) + '\n'


def print_records(f):
    """Each period's statement as the copied renderers read a story: one
    record per printed statement."""
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
