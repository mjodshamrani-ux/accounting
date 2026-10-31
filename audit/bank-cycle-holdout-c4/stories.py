"""WF-1 CYCLE holdout C4: two consecutive months of one bank account, from
the files to the closing sheet, through every layer of the accountant's
workflow on the bank statement path, written after the cycle foundation and
its first runs, and sealed before any product run on these files.

Six stories, each over two consecutive months from January to July 2029,
in Saudi riyals. A twelfth story lineage: a PCG32 random source (O'Neill's
XSH-RR output), its own seeds, banks, accounts, companies, narratives and
ledger layouts. Nothing is imported from the foundation, from another
package or from the product; the facts keep the foundation's schema
(bank-period-cycle-1), so its composed oracle and its runs read them as they
are. Each month has:

- a printed statement in the bank-statement-native-1 layout, drawn by the
  Prawn statement job copied from the G17 holdout (Ruby, English only) or
  by the PDFKit statement application copied from the G20 holdout (Node,
  English and Arabic), render.py;
- the company's ledger export in a layout of its own, written by caxlsx
  (Ruby, ruby/ledgers.rb) or OpenSpout (PHP, php/ledgers.php), with typed
  dates under three date formats, typed or text dates, typed amounts and,
  in one story, typed voucher numbers; read by columns the accountant
  chooses by hand in the first month and by the map saved then in the
  second (bank-cashbook-map-1); and the same rows as the declared cashbook
  (`<period>-cashbook.csv`), which the sealed oracles read;
- the accountant's steps in order, in the foundation's vocabulary: open
  the month, declare a tolerance or not, decide groups from the review
  queue and single cases, declare the book balance, choose the sheet's
  language, prepare and review the sheet, and save the session, which the
  next month takes as its previous session.

What the foundation's stories did not hold, these do: a saved map that
still fits a ledger with a column added at its end; a map that no longer
fits because the header moved down a row, and because a column was
renamed; sign-offs made void by a decision taken after them; a policy
declared after a save of the same month and before any decision; a month
saved in draft while a carried case and an own case wait; two carried
items claiming the same deposits together (carried-ambiguous); a carried
cheque presented within the new month's per-item limit, which no tolerance
reaches; an ambiguous suggestion by amount and date; a book balance
declared wrongly in the first month only.

Decisions name their members: the period's statement movements S<n> and
cashbook vouchers, and carried items as `<MONTH>:<id>`. A group names the
cases it holds, by their members, and the decision the queue offers for it.
`recipe` says how a story was made; `intent` is what each save is expected
to show, written by hand before the oracle was run on the story. `width`,
when present, is the browser width the story is played at. The oracle reads
none of these.

  python3 -B audit/bank-cycle-holdout-c4/stories.py > stories.json
  python3 -B audit/bank-cycle-holdout-c4/stories.py --records > records.json
"""
import json
import sys
from datetime import date, timedelta

VERSION = 'bank-cycle-holdout-c4-1'
MONTHS = {
    'JAN': ('2029-01-01', '2029-01-31'),
    'FEB': ('2029-02-01', '2029-02-28'),
    'MAR': ('2029-03-01', '2029-03-31'),
    'APR': ('2029-04-01', '2029-04-30'),
    'MAY': ('2029-05-01', '2029-05-31'),
    'JUN': ('2029-06-01', '2029-06-30'),
    'JUL': ('2029-07-01', '2029-07-31'),
}
ROLES = ['date', 'voucher', 'description', 'reference', 'receipts', 'payments']
M64 = (1 << 64) - 1


class Pcg32:
    """PCG32 (XSH-RR): a small generator whose sequence does not depend on
    the Python version."""

    def __init__(self, seed, stream):
        self.inc = ((stream << 1) | 1) & M64
        self.state = 0
        self.next()
        self.state = (self.state + seed) & M64
        self.next()

    def next(self):
        old = self.state
        self.state = (old * 6364136223846793005 + self.inc) & M64
        xorshifted = (((old >> 18) ^ old) >> 27) & 0xFFFFFFFF
        rot = old >> 59
        return ((xorshifted >> rot) | (xorshifted << ((-rot) & 31))) & 0xFFFFFFFF

    def between(self, lo, hi):
        return lo + self.next() % (hi - lo + 1)


def on(month, d):
    """The d-th day of the month as ISO text."""
    first = date.fromisoformat(MONTHS[month][0])
    return (first + timedelta(days=d - 1)).isoformat()


def last_day(month):
    return int(MONTHS[month][1][8:])


WORDS = {
    'en': {'out': ['Supplier payment', 'Freight and clearance', 'Insurance premium', 'Utilities', 'Lab consumables'],
           'in': ['Hospital remittance', 'Pharmacy settlement', 'Tender payment', 'Card acquirer settlement']},
    'ar': {'out': ['دفعة مورد', 'شحن وتخليص', 'قسط تأمين', 'كهرباء ومياه', 'مستلزمات مختبر'],
           'in': ['حوالة مستشفى', 'تسوية صيدليات', 'دفعة مناقصة', 'تسوية نقاط البيع']},
}


class Month:
    """One month of one story: the statement's movements and the book's
    entries, ordinary ones first, then the planted ones, each side in date
    order (stable)."""

    def __init__(self, story, month, *, count, per_page, opening, bank, book):
        self.story, self.month, self.per_page, self.opening = story, month, per_page, opening
        self.id = f'{story.sid}-{month}'
        rnd, words, ledger = story.rnd, WORDS[story.layout], story.ledger_of(month)
        mm = MONTHS[month][0][5:7]
        own_bank, own_book = [], []
        span = last_day(month) - 4
        for i in range(count):
            d = 2 + (span * i) // max(count - 1, 1)
            out = rnd.between(0, 2) > 0
            amount = rnd.between(150, 6800) * 100 + 2 * rnd.between(0, 49) + 1
            kind = 'out' if out else 'in'
            ref = f"{'FT' if out else 'IC'}29{mm}{d:02d}{story.sid[1:]}{i:02d}"
            what = words[kind][rnd.between(0, len(words[kind]) - 1)]
            own_bank.append(movement(month, d, ref, amount, kind, what))
            back = rnd.between(0, 2)
            own_book.append(entry(month, max(d - back, 1), ref, amount, kind, ledger.voucher(kind), ledger.words[kind]))
        self.bank = in_date_order(own_bank + bank)
        self.book = in_date_order(own_book + book)

    def rows(self):
        balance, out = self.opening, []
        for m in self.bank:
            balance += m['deposit'] - m['withdrawal']
            out.append(dict(m, balance=balance))
        return out

    def closing(self):
        rows = self.rows()
        return rows[-1]['balance'] if rows else self.opening

    def S(self, m):
        """A planted movement as the statement numbers it: S<n> in printed order."""
        return f'S{self.bank.index(m) + 1}'

    def statement(self):
        rows = self.rows()
        cuts = [(lo, min(lo + self.per_page, len(rows))) for lo in range(0, len(rows), self.per_page)]
        pages = []
        for k, (lo, hi) in enumerate(cuts):
            lines = [{'kind': 'opening', 'balance': self.opening} if k == 0
                     else {'kind': 'brought-forward', 'balance': rows[lo - 1]['balance']}]
            for j, r in enumerate(rows[lo:hi]):
                lines.append({'kind': 'movement', 'key': f'S{lo + j + 1}', 'date': r['date'],
                              'valueDate': r['valueDate'], 'description': r['description'],
                              'reference': r['reference'], 'withdrawal': r['withdrawal'], 'deposit': r['deposit'],
                              'balance': r['balance']})
            if k + 1 < len(cuts):
                lines.append({'kind': 'carried-forward', 'balance': rows[hi - 1]['balance']})
            else:
                lines.append({'kind': 'closing', 'balance': self.closing()})
                lines.append({'kind': 'totals', 'withdrawal': sum(r['withdrawal'] for r in rows),
                              'deposit': sum(r['deposit'] for r in rows)})
            pages.append({'number': k + 1, 'of': len(cuts), 'lines': lines})
        start, end = MONTHS[self.month]
        return {'account': self.story.account, 'currency': 'SAR', 'period': {'start': start, 'end': end},
                'pages': pages}

    def flows(self):
        return sum(e['receipt'] - e['payment'] for e in self.book)


def in_date_order(items):
    return [x for _, x in sorted(enumerate(items), key=lambda p: (p[1]['date'], p[0]))]


def movement(month, d, ref, amount, kind, what):
    return {'date': on(month, d), 'valueDate': on(month, d), 'description': what, 'reference': ref,
            'withdrawal': amount if kind == 'out' else 0, 'deposit': amount if kind == 'in' else 0}


def entry(month, d, ref, amount, kind, voucher, what):
    return {'date': on(month, d), 'voucher': voucher, 'description': what, 'reference': ref,
            'receipt': amount if kind == 'in' else 0, 'payment': amount if kind == 'out' else 0}


# ---- company ledgers --------------------------------------------------------
# A layout is its title rows, its header labels and the role of each column
# (None: printed, never read). Amount, date and voucher cells are typed as
# the layout says; every other cell is text.

class Layout:
    def __init__(self, name, labels, roles, *, sheet, titles=(), date_format=None, money_format=None,
                 typed_voucher=False, extra=None):
        self.name, self.labels, self.roles, self.titles = name, labels, roles, [list(t) for t in titles]
        self.sheet = sheet
        self.date_format, self.money_format, self.typed_voucher = date_format, money_format, typed_voucher
        self.extra = extra or {}

    def columns(self):
        return {r: (self.roles.index(r) + 1 if r in self.roles else None) for r in ROLES}

    def header(self):
        return len(self.titles) + 1

    def changed(self, name, *, labels=None, roles=None, titles=None, extra=None):
        return Layout(name, labels or self.labels, roles or self.roles, sheet=self.sheet,
                      titles=self.titles if titles is None else titles, date_format=self.date_format,
                      money_format=self.money_format, typed_voucher=self.typed_voucher,
                      extra={**self.extra, **(extra or {})})


SAGE = Layout('SAGE', ['Tran No', 'Type', 'Date', 'Ref', 'Details', 'Payments', 'Receipts', 'Balance'],
              ['voucher', 'type', 'date', 'reference', 'description', 'payments', 'receipts', 'balance'],
              sheet='Bank Transactions', date_format='dd/mm/yyyy', money_format='#,##0.00', typed_voucher=True, extra={'type': ['BP', 'BR']})
SAGE_RECONCILED = SAGE.changed('SAGE_RECONCILED', labels=SAGE.labels + ['Reconciled'],
                               roles=SAGE.roles + ['reconciled'])
DAFTAR = Layout('DAFTAR', ['التاريخ', 'رقم القيد', 'الطرف', 'البيان', 'المرجع', 'مدين', 'دائن', 'الرصيد'],
                ['date', 'voucher', 'party', 'description', 'reference', 'receipts', 'payments', 'balance'],
                sheet='حركة البنك', titles=[['{company}'], ['حركة حساب البنك الجاري'], []], date_format='yyyy-mm-dd',
                money_format='#,##0.00')
ODOO = Layout('ODOO', ['Number', 'Date', 'Partner', 'Reference', 'Label', 'Debit', 'Credit', 'Balance'],
              ['voucher', 'date', 'party', 'reference', 'description', 'receipts', 'payments', 'balance'],
              sheet='Journal Items', titles=[['{company}'], ['Bank journal (BNK1) — General ledger'], ['Period: {period}']],
              money_format='#,##0.00')
ODOO_PRINTED = ODOO.changed('ODOO_PRINTED', titles=ODOO.titles + [['Printed by finance.ops on {printed}']])
QB = Layout('QB', ['Date', 'Transaction Type', 'Num', 'Ref No.', 'Name', 'Memo', 'Payment', 'Deposit', 'Balance'],
            ['date', 'type', 'voucher', 'reference', 'party', 'description', 'payments', 'receipts', 'balance'],
            sheet='QuickReport', titles=[['{company}'], ['Account QuickReport'], ['All transactions, {period}'], []],
            date_format='mm/dd/yyyy', money_format='#,##0.00', extra={'type': ['Check', 'Deposit']})
HARAKA = Layout('HARAKA', ['م', 'رقم السند', 'التاريخ', 'البيان', 'المرجع', 'دائن', 'مدين', 'الرصيد', 'ملاحظات'],
                ['line', 'voucher', 'date', 'description', 'reference', 'payments', 'receipts', 'balance', 'note'],
                sheet='الحركة')
HARAKA_RENAMED = HARAKA.changed('HARAKA_RENAMED', labels=HARAKA.labels[:4] + ['رقم المرجع'] + HARAKA.labels[5:])
XERO = Layout('XERO', ['Date', 'Description', 'Reference', 'Transaction No.', 'Spent', 'Received', 'Balance', 'Source'],
              ['date', 'description', 'reference', 'voucher', 'payments', 'receipts', 'balance', 'source'],
              sheet='Account Transactions', titles=[['Account Transactions'], ['{company}'], ['Business Bank Account'], ['{period}']],
              date_format='yyyy-mm-dd', money_format='0.00', extra={'source': ['Spend Money', 'Receive Money']})


class Ledger:
    """A company's ledger: its layout each month, its words and its voucher
    numbering, which runs on from one month to the next."""

    def __init__(self, writer, words, numbering):
        self.writer, self.words, self.numbering, self.count = writer, words, numbering, 0
        self.layouts = {}

    def voucher(self, kind):
        self.count += 1
        return self.numbering(kind, self.count)


def shortest(minor):
    sign, minor = ('-' if minor < 0 else ''), abs(minor)
    return sign + f'{minor // 100}.{minor % 100:02d}'.rstrip('0').rstrip('.')


MONTH_NAMES = {'JAN': 'January', 'FEB': 'February', 'MAR': 'March', 'APR': 'April', 'MAY': 'May', 'JUN': 'June',
               'JUL': 'July'}


def ledger_rows(month, layout, company, opening_book):
    """Title rows, the header, then one row per book entry in the layout:
    text cells, {'n': text} typed numbers and {'d': iso} typed dates, each
    with the layout's format; a running balance the reader never reads."""
    start = MONTHS[month.month][0]
    fill = {'company': company, 'period': f'{MONTH_NAMES[month.month]} {start[:4]}',
            'printed': f'{start[:4]}-{int(start[5:7]) + 1:02d}-02'}
    rows = [[t.format(**fill) for t in title] for title in layout.titles]
    rows.append(list(layout.labels))
    balance = opening_book
    money = {'fmt': layout.money_format} if layout.money_format else {}
    for k, e in enumerate(month.book):
        balance += e['receipt'] - e['payment']
        row = []
        for role in layout.roles:
            if role == 'date':
                cell = {'d': e['date'], 'fmt': layout.date_format} if layout.date_format else e['date']
            elif role == 'voucher':
                cell = {'n': e['voucher']} if layout.typed_voucher else e['voucher']
            elif role in ('description', 'reference'):
                cell = e[role]
            elif role == 'receipts':
                cell = dict(n=shortest(e['receipt']), **money) if e['receipt'] else ''
            elif role == 'payments':
                cell = dict(n=shortest(e['payment']), **money) if e['payment'] else ''
            elif role == 'balance':
                cell = dict(n=shortest(balance), **money)
            elif role == 'line':
                cell = {'n': str(k + 1)}
            elif role == 'type':
                cell = layout.extra['type'][0 if e['payment'] else 1]
            elif role == 'party':
                cell = ''
            elif role == 'reconciled':
                cell = 'N'
            elif role == 'source':
                cell = layout.extra['source'][0 if e['payment'] else 1]
            else:  # a notes column left empty
                cell = ''
            row.append(cell)
        rows.append(row)
    return rows


# ---- the story ----------------------------------------------------------------

class Story:
    def __init__(self, sid, title, *, producer, font, paper, style, bank, document, account, company, ledger,
                 layout='en', digits='latin', width=None):
        self.sid, self.title, self.layout, self.digits, self.width = sid, title, layout, digits, width
        self.account, self.company, self.ledger = account, company, ledger
        self.print = {'producer': producer, 'font': font, 'paper': paper, 'style': style, 'bank': bank,
                      'documentTitle': document}
        self.rnd = Pcg32(0xC4C4C4 + 7919 * int(sid[1:]), 0x2029 + int(sid[1:]))
        self.months, self.steps, self.recipe, self.intent = [], [], '', {}
        self.current = None

    def ledger_of(self, month):
        return self.ledger

    def month(self, month, layout, *, count=7, per_page=14, bank=(), book=()):
        opening = self.months[-1].closing() if self.months else self.rnd.between(1500, 6000) * 10000
        m = Month(self, month, count=count, per_page=per_page, opening=opening, bank=list(bank), book=list(book))
        self.ledger.layouts[m.id] = layout
        self.months.append(m)
        return m

    def book_balance(self, upto, extra=0):
        """The balance of a book that agreed with the bank when the first
        month opened, after every month's receipts and payments up to
        `upto`, and `extra`."""
        total = self.months[0].opening
        for m in self.months:
            total += m.flows()
            if m is upto:
                break
        return total + extra


# ---- steps (the foundation's vocabulary) ----------------------------------------

def open_(m, ledger, previous=None):
    step = {'open': m.id, 'ledger': ledger}
    if previous:
        step['previous'] = previous
    return step


def by_hand(layout, save=None):
    out = {'by': 'hand', 'header': layout.header(), 'columns': layout.columns()}
    if save:
        out['save'] = save
    return out


def by_map(name, then=None):
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
    return {'group': {'type': kind, 'cases': [members(**c) for c in cases]}}


def book(balance, note):
    return {'book': {'balance': balance, 'note': note}}


def sign(kind, name, when):
    return {kind: {'name': name, 'date': when}}


def save(label):
    return {'save': label}


def intent(*, previous='none', tolerated=0, exceeded=None, groups=(), carried=0, still=0, pending=0, sheet=None):
    """What a save shows, in the foundation's terms: the previous session's
    verdict, the tolerated cases standing, the period limit exceeded, the
    queue's groups as [reason, cases, offers] before any decision, the
    carried items and those still carried at the end, the cases awaiting a
    decision, and the sheet as its refusal or [status, difference,
    tolerated, unexplained]."""
    return {'previous': previous, 'tolerated': tolerated, 'exceeded': exceeded, 'groups': [list(g) for g in groups],
            'carried': carried, 'still': still, 'pending': pending,
            'sheet': sheet if isinstance(sheet, str) or sheet is None else list(sheet)}


PRAWN_LORA = dict(producer='prawn', font='Lora', paper='A4', style={'rules': 'grid', 'heading': 'filled'})
PRAWN_KARLA = dict(producer='prawn', font='Karla', paper='Letter',
                   style={'rules': 'none', 'heading': 'rule', 'headings': 'left'})
PRAWN_INCONSOLATA = dict(producer='prawn', font='Inconsolata', paper='A4', style={'rules': 'rows', 'heading': 'rule'})
PDFKIT_BALOO = dict(producer='pdfkit', font='Baloo Bhaijaan 2', paper='A4', style={'rules': 'rows', 'heading': 'filled'})
PDFKIT_DM = dict(producer='pdfkit', font='DM Sans', paper='A4-landscape', style={'rules': 'stripes', 'heading': 'grey'})
PDFKIT_KUFAM = dict(producer='pdfkit', font='Kufam', paper='A4', style={'rules': 'grid', 'heading': 'filled'})
NAJD = dict(bank='Najd Commerce Bank', document='Current Account Statement')
RED_SEA = dict(bank='Red Sea Merchant Bank', document='Statement of Account')
PEARL = dict(bank='Gulf Pearl Bank', document='Business Account Statement')
WAHA = dict(bank='مصرف الواحة الوطني', document='كشف حساب جار', layout='ar')
MARJAN = dict(bank='بنك المرجان', document='كشف حساب', layout='ar')
NOTE_EN = 'Bank account balance per general ledger'
NOTE_AR = 'رصيد حساب البنك في دفتر الأستاذ'
PREPARER, REVIEWER = 'Lina Haddad', 'Faisal Qureshi'
PREPARER_AR, REVIEWER_AR = 'لينا حداد', 'فيصل قريشي'
EN_BOOK = {'out': 'Bank payment', 'in': 'Bank receipt'}
AR_BOOK = {'out': 'سند صرف', 'in': 'سند قبض'}


def build():
    stories = []

    def z01():
        ledger = Ledger('caxlsx', {'out': 'Purchase payment', 'in': 'Sales receipt'},
                        lambda kind, n: str(4100 + n))
        s = Story('Z01', 'Sign-offs made void by a later decision; a column added to the ledger, the map still fits',
                  **PRAWN_LORA, **NAJD, account='SA03 1500 0000 2210 4471 0101',
                  company='Salam Medical Supplies Co.', ledger=ledger)
        a_bank = movement('FEB', 6, 'INV-4471', 182003, 'out', 'Supplier payment')
        a_book = entry('FEB', 6, 'INV-4471', 182000, 'out', '4201', 'Purchase payment')
        b_bank = movement('FEB', 13, 'RCV-8812', 246500, 'in', 'Hospital remittance')
        b_book = entry('FEB', 13, 'RCV-8812', 246502, 'in', '4202', 'Sales receipt')
        c_bank = movement('FEB', 15, 'INV-4475', 93500, 'out', 'Supplier payment')
        c_book = entry('FEB', 9, 'INV-4475', 93500, 'out', '4203', 'Purchase payment')
        lodged = entry('FEB', 27, 'LDG-2902', 150000, 'in', '4204', 'Cash lodgement')
        fee = movement('FEB', 28, 'CHG-2902', 4500, 'out', 'Account service charge')
        feb = s.month('FEB', SAGE, bank=[a_bank, b_bank, c_bank, fee], book=[a_book, b_book, c_book, lodged])
        arrived = movement('MAR', 1, 'LDG-2902', 150000, 'in', 'Cash lodgement')
        charged = entry('MAR', 3, 'CHG-2902', 4500, 'out', '4301', 'Bank charges, February')
        f1_bank = movement('MAR', 15, 'INV-4490', 61000, 'out', 'Supplier payment')
        f1_book = entry('MAR', 10, 'INV-4490', 61000, 'out', '4302', 'Purchase payment')
        f2_bank = movement('MAR', 22, 'INV-4493', 38800, 'out', 'Freight and clearance')
        f2_book = entry('MAR', 17, 'INV-4493', 38800, 'out', '4303', 'Purchase payment')
        g_bank = movement('MAR', 24, 'RCV-8840', 77701, 'in', 'Pharmacy settlement')
        g_book = entry('MAR', 24, 'RCV-8840', 77700, 'in', '4304', 'Sales receipt')
        mar = s.month('MAR', SAGE_RECONCILED, bank=[arrived, f1_bank, f2_bank, g_bank],
                      book=[charged, f1_book, f2_book, g_book])
        name = 'Sage bank export'
        s.steps = [
            open_(feb, by_hand(SAGE, save=name)),
            policy(5, 10, 'Card network rounding'),
            accept(statement=[feb.S(c_bank)], cashbook=['4203']),
            book(s.book_balance(feb), NOTE_EN), {'language': 'en'},
            sign('prepare', PREPARER, '2029-03-02'), sign('review', REVIEWER, '2029-03-03'),
            reject(statement=[feb.S(a_bank)], cashbook=['4201']),
            save('Z01-FEB'),
            open_(mar, by_map(name), previous='Z01-FEB'),
            accept(statement=[mar.S(arrived)], carried=['FEB:4204']),
            accept(cashbook=['4301'], carried=[f'FEB:{feb.S(fee)}']),
            group('accept', [dict(statement=[mar.S(f1_bank)], cashbook=['4302']),
                             dict(statement=[mar.S(f2_bank)], cashbook=['4303'])]),
            reject(statement=[mar.S(g_bank)], cashbook=['4304']),
            book(s.book_balance(mar), NOTE_EN), {'language': 'en'},
            sign('prepare', PREPARER, '2029-04-02'), sign('review', REVIEWER, '2029-04-03'),
            save('Z01-MAR'),
        ]
        s.recipe = ('Sage-style ledger by caxlsx, typed voucher numbers and dates shown dd/mm/yyyy. February: a '
                    'payment the bank takes 0.03 above the book and a receipt it credits 0.02 below, both tolerated '
                    'under 0.05 an item and 0.10 a period; a payment booked six days early, accepted; a lodgement '
                    'in transit and a service charge not booked. The sheet is prepared and reviewed, then the '
                    'reviewer has the 0.03 payment rejected: both sign-offs no longer stand, and both members are '
                    'carried. March: the export gains a Reconciled column at its end, so the saved map still fits; '
                    'no tolerance is declared; the lodgement arrives and the charge is booked, both carried cases '
                    'accepted; two payments booked five days early accepted together; a 0.01 receipt difference '
                    'rejected. February\'s tolerated 0.02, never booked, is still between bank and book.')
        s.intent = {
            'Z01-FEB': intent(tolerated=1, groups=[('date-gap', 1, '')], sheet=('reconciled-within-tolerance', -2, -2, 0)),
            'Z01-MAR': intent(previous='accepted', groups=[('amount-difference', 1, ''), ('date-gap', 2, 'accept+reject')],
                              carried=4, still=2, sheet=('difference', -2, 0, -2)),
        }
        return s

    def z02():
        ledger = Ledger('openspout', AR_BOOK, lambda kind, n: f'JV-29-{300 + n:04d}')
        s = Story('Z02', 'Arabic: differences rejected as a group and carried; a cheque presented within the new '
                  'per-item limit, which no tolerance reaches', **PDFKIT_BALOO, **WAHA,
                  account='SA61 4500 0000 1180 2290 0202', company='شركة دار الشفاء للأدوية', ledger=ledger)
        o1_bank = movement('MAR', 5, 'PO-7731', 64005, 'out', 'دفعة مورد')
        o1_book = entry('MAR', 5, 'PO-7731', 64000, 'out', 'JV-29-0391', 'سند صرف')
        o2_bank = movement('MAR', 11, 'PO-7736', 31502, 'out', 'شحن وتخليص')
        o2_book = entry('MAR', 11, 'PO-7736', 31500, 'out', 'JV-29-0392', 'سند صرف')
        i_bank = movement('MAR', 19, 'SO-2207', 98000, 'in', 'حوالة مستشفى')
        i_book = entry('MAR', 19, 'SO-2207', 98004, 'in', 'JV-29-0393', 'سند قبض')
        cheque = entry('MAR', 26, 'CHQ-004512', 235000, 'out', 'JV-29-0394', 'شيك صادر')
        mar = s.month('MAR', DAFTAR, per_page=12, bank=[o1_bank, o2_bank, i_bank], book=[o1_book, o2_book, i_book, cheque])
        presented = movement('APR', 4, 'CHQ-004512', 235002, 'out', 'صرف شيك')
        t1_bank = movement('APR', 9, 'SO-2231', 111100, 'in', 'تسوية صيدليات')
        t1_book = entry('APR', 9, 'SO-2231', 111099, 'in', 'JV-29-0491', 'سند قبض')
        t2_bank = movement('APR', 16, 'PO-7790', 22222, 'out', 'كهرباء ومياه')
        t2_book = entry('APR', 16, 'PO-7790', 22220, 'out', 'JV-29-0492', 'سند صرف')
        d1 = movement('APR', 14, 'SADAD-77120', 15000, 'out', 'سداد فاتورة')
        d2 = movement('APR', 15, 'SADAD-77120', 15000, 'out', 'سداد فاتورة')
        d_book = entry('APR', 14, 'SADAD-77120', 30000, 'out', 'JV-29-0493', 'سند صرف')
        apr = s.month('APR', DAFTAR, per_page=12, bank=[presented, t1_bank, t2_bank, d1, d2],
                      book=[t1_book, t2_book, d_book])
        name = 'حساب البنك الجاري'
        note = 'فروق تقريب التحصيل'
        s.steps = [
            open_(mar, by_hand(DAFTAR, save=name)),
            group('reject', [dict(statement=[mar.S(o1_bank)], cashbook=['JV-29-0391']),
                             dict(statement=[mar.S(o2_bank)], cashbook=['JV-29-0392'])]),
            reject(statement=[mar.S(i_bank)], cashbook=['JV-29-0393']),
            book(s.book_balance(mar), NOTE_AR), {'language': 'ar'},
            sign('prepare', PREPARER_AR, '2029-04-02'),
            save('Z02-MAR'),
            open_(apr, by_map(name), previous='Z02-MAR'),
            policy(2, 5, note),
            reject(statement=[apr.S(presented)], carried=['MAR:JV-29-0394']),
            reject(statement=[apr.S(d1), apr.S(d2)], cashbook=['JV-29-0493']),
            book(s.book_balance(apr), NOTE_AR), {'language': 'ar'},
            sign('prepare', PREPARER_AR, '2029-05-02'),
            save('Z02-APR'),
        ]
        s.recipe = ('Arabic, Latin digits; ledger by OpenSpout with typed dates and #,##0.00 amounts, its strings '
                    'inline. March, no tolerance: two payments the bank takes 0.05 and 0.02 above the book, '
                    'rejected together from the queue, and a receipt it credits 0.04 below, rejected alone; a '
                    'cheque of 2,350.00 issued. April, 0.02 an item and 0.05 a period: the cheque is presented for '
                    '2,350.02, a carried case whose difference the new limit would cover were it the month\'s own: '
                    'rejected; a receipt 0.01 above and a payment 0.02 above the book, tolerated; a bill paid in two '
                    'transfers and booked once, a duplicate reference rejected. The March members stay carried.')
        s.intent = {
            'Z02-MAR': intent(groups=[('amount-difference', 1, ''), ('amount-difference', 2, 'reject')],
                              sheet=('reconciled', 0, 0, 0)),
            'Z02-APR': intent(previous='accepted', tolerated=2, groups=[('duplicate-reference', 1, '')], carried=7,
                              still=6, sheet=('reconciled-within-tolerance', -1, -1, 0)),
        }
        return s

    def z03():
        ledger = Ledger('caxlsx', EN_BOOK, lambda kind, n: f'BNK1/2029/{n:04d}')
        s = Story('Z03', 'The header moves down a row; two deposits in transit claim the same deposits together',
                  **PRAWN_KARLA, **RED_SEA, account='SA26 2000 0000 6630 1185 0303',
                  company='Hijaz Lab Equipment LLC', ledger=ledger)
        dd1 = movement('APR', 8, 'DD-88120', 41250, 'out', 'Direct debit')
        dd1_book = entry('APR', 7, 'ELEC-APR', 41250, 'out', 'BNK1/2029/0101', 'Electricity, April')
        dd2 = movement('APR', 18, 'DD-88121', 26840, 'out', 'Direct debit')
        dd2_book = entry('APR', 18, 'TEL-APR', 26840, 'out', 'BNK1/2029/0102', 'Telecom, April')
        gap_bank = movement('APR', 20, 'TND-5502', 315000, 'in', 'Tender payment')
        gap_book = entry('APR', 16, 'TND-5502', 315000, 'in', 'BNK1/2029/0103', 'Bank receipt')
        rv1 = entry('APR', 29, 'LDG-0429', 80000, 'in', 'BNK1/2029/0104', 'Cash deposit')
        rv2 = entry('APR', 30, 'LDG-0430', 80000, 'in', 'BNK1/2029/0105', 'Cash deposit')
        apr = s.month('APR', ODOO, count=8, bank=[dd1, dd2, gap_bank], book=[dd1_book, dd2_book, gap_book, rv1, rv2])
        s1 = movement('MAY', 2, '', 80000, 'in', 'Cash deposit')
        s2 = movement('MAY', 3, '', 80000, 'in', 'Cash deposit')
        e_bank = movement('MAY', 12, 'INV-3391', 45501, 'out', 'Lab consumables')
        e_book = entry('MAY', 12, 'INV-3391', 45500, 'out', 'BNK1/2029/0201', 'Bank payment')
        f_bank = movement('MAY', 21, 'INV-3398', 61002, 'out', 'Supplier payment')
        f_book = entry('MAY', 21, 'INV-3398', 61000, 'out', 'BNK1/2029/0202', 'Bank payment')
        may = s.month('MAY', ODOO_PRINTED, count=8, bank=[s1, s2, e_bank, f_bank], book=[e_book, f_book])
        name = 'Odoo BNK1'
        s.steps = [
            open_(apr, by_hand(ODOO, save=name)),
            group('accept', [dict(statement=[apr.S(dd1)], cashbook=['BNK1/2029/0101']),
                             dict(statement=[apr.S(dd2)], cashbook=['BNK1/2029/0102'])]),
            accept(statement=[apr.S(gap_bank)], cashbook=['BNK1/2029/0103']),
            book(s.book_balance(apr), NOTE_EN), {'language': 'en'},
            sign('prepare', PREPARER, '2029-05-02'), sign('review', REVIEWER, '2029-05-03'),
            save('Z03-APR'),
            open_(may, by_map(name, then=by_hand(ODOO_PRINTED)), previous='Z03-APR'),
            policy(1, 1, 'Supplier bank rounding'),
            reject(statement=[may.S(s1), may.S(s2)], carried=['APR:BNK1/2029/0104', 'APR:BNK1/2029/0105']),
            reject(statement=[may.S(f_bank)], cashbook=['BNK1/2029/0202']),
            book(s.book_balance(may), NOTE_EN), {'language': 'en'},
            sign('prepare', PREPARER, '2029-06-03'), sign('review', REVIEWER, '2029-06-04'),
            save('Z03-MAY'),
        ]
        s.recipe = ('Odoo-style journal by caxlsx under three title rows, dates as text. April: two direct debits '
                    'booked under other references, suggested by amount and date and accepted together; a tender '
                    'payment booked four days early, accepted; two cash deposits of 800.00 booked on the last two '
                    'days, not yet on the statement. May: the export prints one more title row, so the saved map '
                    'does not fit and the columns are chosen again under the new header; the bank credits two '
                    'deposits of 800.00 without a reference, which both carried deposits claim together: a carried '
                    'ambiguity, rejected; 0.01 an item and a period: a 0.01 difference tolerated, a 0.02 one past '
                    'the item limit rejected.')
        s.intent = {
            'Z03-APR': intent(groups=[('date-gap', 1, ''), ('amount-date-suggestion', 2, 'accept+reject')],
                              sheet=('reconciled', 0, 0, 0)),
            'Z03-MAY': intent(previous='accepted', tolerated=1, groups=[('amount-difference', 1, '')], carried=2,
                              sheet=('reconciled-within-tolerance', -1, -1, 0)),
        }
        return s

    def z04():
        def numbering(kind, n):
            return f"{'CHK' if kind == 'out' else 'DEP'} {2200 + n}"
        ledger = Ledger('openspout', EN_BOOK, numbering)
        s = Story('Z04', 'A case settled by a policy declared after a save; a month refused as previous, then a '
                  'second month in draft', **PDFKIT_DM, **PEARL, account='SA88 6000 0000 5507 7340 0404',
                  company='Taif Clinics Group', ledger=ledger)
        a_bank = movement('MAY', 10, 'INV-30017', 125000, 'in', 'Hospital remittance')
        a_book = entry('MAY', 10, 'INV-30017', 124998, 'in', 'DEP 2301', 'Bank receipt')
        interest = movement('MAY', 31, 'INT-0529', 1234, 'in', 'Credit interest')
        may = s.month('MAY', QB, count=9, per_page=12, bank=[a_bank, interest], book=[a_book])
        c_bank = movement('JUN', 13, 'INV-30102', 9876, 'out', 'Utilities')
        c_book = entry('JUN', 13, 'INV-30102', 9875, 'out', 'CHK 2401', 'Bank payment')
        booked = entry('JUN', 2, 'INT-0529', 1234, 'in', 'DEP 2402', 'Interest, May')
        jun = s.month('JUN', QB, count=9, per_page=12, bank=[c_bank], book=[c_book, booked])
        name = 'QB register'
        s.steps = [
            open_(may, by_hand(QB, save=name)),
            book(s.book_balance(may), NOTE_EN), {'language': 'en'},
            save('Z04-MAY-open'),
            policy(2, 2, 'Collection agent rounding'),
            sign('prepare', PREPARER, '2029-06-01'), sign('review', REVIEWER, '2029-06-02'),
            save('Z04-MAY'),
            open_(jun, by_map(name), previous='Z04-MAY-open'),
            book(s.book_balance(jun), NOTE_EN), {'language': 'en'},
            save('Z04-JUN-refused'),
            open_(jun, by_map(name), previous='Z04-MAY'),
            book(s.book_balance(jun), NOTE_EN), {'language': 'en'},
            save('Z04-JUN-draft'),
            accept(cashbook=['DEP 2402'], carried=[f'MAY:{may.S(interest)}']),
            reject(statement=[jun.S(c_bank)], cashbook=['CHK 2401']),
            sign('prepare', PREPARER, '2029-07-02'), sign('review', REVIEWER, '2029-07-03'),
            save('Z04-JUN'),
        ]
        s.recipe = ('QuickBooks-style report by OpenSpout under four title rows, typed dates shown mm/dd/yyyy. May: a '
                    'remittance the bank credits 0.02 above the book; saved with it undecided and no policy, a '
                    'draft; then 0.02 an item and a period is declared, before any decision, and the case is '
                    'tolerated; credit interest of 12.34 not yet booked. June, taken first on the undecided May '
                    'session: refused as undecided, the sheet with it; then on the decided one: saved in draft while '
                    'the booked interest and a 0.01 payment difference wait (no policy in June), then the interest\'s '
                    'carried case accepted and the difference rejected. May\'s tolerated 0.02 is still between bank '
                    'and book.')
        s.intent = {
            'Z04-MAY-open': intent(groups=[('amount-difference', 1, '')], pending=1, sheet=('draft', 0, 0, 0)),
            'Z04-MAY': intent(tolerated=1, sheet=('reconciled-within-tolerance', 2, 2, 0)),
            'Z04-JUN-refused': intent(previous='ROLL_PREVIOUS_UNDECIDED', groups=[('amount-difference', 1, '')],
                                      pending=1, sheet='SHEET_PREVIOUS_REFUSED'),
            'Z04-JUN-draft': intent(previous='accepted', groups=[('amount-difference', 1, '')], carried=1, pending=2,
                                    sheet=('draft', 2, 0, 2)),
            'Z04-JUN': intent(previous='accepted', groups=[('amount-difference', 1, '')], carried=1,
                              sheet=('difference', 2, 0, 2)),
        }
        return s

    def z05():
        ledger = Ledger('caxlsx', AR_BOOK, lambda kind, n: f"{'ص' if kind == 'out' else 'ق'}-{6000 + n}")
        s = Story('Z05', 'Arabic, Arabic-Indic digits, three pages: the period limit met exactly, then exceeded; a '
                  'column renamed', **PDFKIT_KUFAM, **MARJAN, account='SA14 8000 0000 9024 6612 0505',
                  company='مؤسسة البلسم الطبية', ledger=ledger, digits='arabic', width=390)
        p1 = movement('JUN', 4, 'PO-9101', 10101, 'out', 'دفعة مورد')
        p1_book = entry('JUN', 4, 'PO-9101', 10100, 'out', 'ص-6101', 'سند صرف')
        p2 = movement('JUN', 8, 'PO-9102', 20201, 'out', 'مستلزمات مختبر')
        p2_book = entry('JUN', 8, 'PO-9102', 20200, 'out', 'ص-6102', 'سند صرف')
        r1 = movement('JUN', 12, 'SO-4401', 30300, 'in', 'تسوية صيدليات')
        r1_book = entry('JUN', 12, 'SO-4401', 30301, 'in', 'ق-6103', 'سند قبض')
        r2 = movement('JUN', 17, 'SO-4402', 40400, 'in', 'حوالة مستشفى')
        r2_book = entry('JUN', 17, 'SO-4402', 40401, 'in', 'ق-6104', 'سند قبض')
        g1 = movement('JUN', 10, 'PO-9110', 175000, 'out', 'شحن وتخليص')
        g1_book = entry('JUN', 3, 'PO-9110', 175000, 'out', 'ص-6105', 'سند صرف')
        g2 = movement('JUN', 19, 'PO-9111', 264000, 'out', 'دفعة مورد')
        g2_book = entry('JUN', 12, 'PO-9111', 264000, 'out', 'ص-6106', 'سند صرف')
        cheque = entry('JUN', 28, 'CHQ-001187', 420000, 'out', 'ص-6107', 'شيك صادر')
        jun = s.month('JUN', HARAKA, count=22, per_page=10, bank=[p1, p2, r1, r2, g1, g2],
                      book=[p1_book, p2_book, r1_book, r2_book, g1_book, g2_book, cheque])
        presented = movement('JUL', 6, 'CHQ-001187', 420000, 'out', 'صرف شيك')
        q1 = movement('JUL', 9, 'PO-9150', 5501, 'out', 'كهرباء ومياه')
        q1_book = entry('JUL', 9, 'PO-9150', 5500, 'out', 'ص-6201', 'سند صرف')
        q2 = movement('JUL', 14, 'SO-4460', 6600, 'in', 'دفعة مناقصة')
        q2_book = entry('JUL', 14, 'SO-4460', 6601, 'in', 'ق-6202', 'سند قبض')
        q3 = movement('JUL', 23, 'PO-9158', 7701, 'out', 'قسط تأمين')
        q3_book = entry('JUL', 23, 'PO-9158', 7700, 'out', 'ص-6203', 'سند صرف')
        jul = s.month('JUL', HARAKA_RENAMED, count=22, per_page=10, bank=[presented, q1, q2, q3],
                      book=[q1_book, q2_book, q3_book])
        name = 'كشف حركة البنك'
        note = 'فروق تقريب'
        s.steps = [
            open_(jun, by_hand(HARAKA, save=name)),
            policy(1, 4, note),
            group('reject', [dict(statement=[jun.S(g1)], cashbook=['ص-6105']),
                             dict(statement=[jun.S(g2)], cashbook=['ص-6106'])]),
            book(s.book_balance(jun), NOTE_AR), {'language': 'ar'},
            sign('prepare', PREPARER_AR, '2029-07-02'), sign('review', REVIEWER_AR, '2029-07-03'),
            save('Z05-JUN'),
            open_(jul, by_map(name, then=by_hand(HARAKA_RENAMED)), previous='Z05-JUN'),
            policy(1, 2, note),
            accept(statement=[jul.S(presented)], carried=['JUN:ص-6107']),
            group('reject', [dict(statement=[jul.S(q3)], cashbook=['ص-6203']),
                             dict(statement=[jul.S(q1)], cashbook=['ص-6201'])]),
            reject(statement=[jul.S(q2)], cashbook=['ق-6202']),
            book(s.book_balance(jul), NOTE_EN), {'language': 'en'},
            sign('prepare', PREPARER, '2029-08-02'),
            save('Z05-JUL'),
        ]
        s.recipe = ('Arabic, Arabic-Indic digits, three pages a month; ledger by caxlsx with Arabic voucher letters, '
                    'dates as text and payments before receipts. June, 0.01 an item and 0.04 a period: four '
                    'differences of 0.01 meet the period limit exactly and are tolerated; two payments booked seven '
                    'days early, rejected together; a cheque of 4,200.00 issued. July: the reference column is '
                    'renamed, so the saved map does not fit and the columns are chosen again; 0.01 an item and '
                    '0.02 a period: three differences of 0.01 pass the period limit, none is tolerated, two '
                    'payments rejected together and a receipt alone; the cheque is presented and its carried case '
                    'accepted; the sheet in English, prepared only. June\'s tolerated differences, never booked, '
                    'remain between bank and book.')
        s.intent = {
            'Z05-JUN': intent(tolerated=4, groups=[('date-gap', 2, 'accept+reject')],
                              sheet=('reconciled-within-tolerance', -4, -4, 0)),
            'Z05-JUL': intent(previous='accepted', exceeded={'sum': 3, 'cap': 2},
                              groups=[('amount-difference', 2, 'reject'), ('amount-difference', 1, '')], carried=5,
                              still=4, sheet=('difference', -4, 0, -4)),
        }
        return s

    def z06():
        ledger = Ledger('openspout', EN_BOOK, lambda kind, n: f'TRX-{700 + n:06d}')
        s = Story('Z06', 'A book balance declared wrongly in the first month only; carried items cleared by amount',
                  **PRAWN_INCONSOLATA, **NAJD, account='SA03 1500 0000 2210 4471 0606',
                  company='Najran Diagnostics Ltd', ledger=ledger)
        charge = movement('JAN', 31, 'SVC-2901', 5750, 'out', 'Service charge')
        cheque_in = entry('JAN', 30, '', 300000, 'in', 'TRX-000801', 'Cheque deposited')
        m1 = movement('JAN', 11, 'MPAY-5521', 64000, 'in', 'Card acquirer settlement')
        m2 = movement('JAN', 12, 'MPAY-5522', 64000, 'in', 'Card acquirer settlement')
        m_book = entry('JAN', 11, 'RCPT-118', 64000, 'in', 'TRX-000802', 'Bank receipt')
        gap_bank = movement('JAN', 24, 'INV-6620', 132000, 'out', 'Supplier payment')
        gap_book = entry('JAN', 20, 'INV-6620', 132000, 'out', 'TRX-000803', 'Bank payment')
        jan = s.month('JAN', XERO, count=20, bank=[charge, m1, m2, gap_bank], book=[cheque_in, m_book, gap_book])
        booked = entry('FEB', 2, '', 5750, 'out', 'TRX-000901', 'Bank charges')
        cleared = movement('FEB', 1, 'CHQDEP-7781', 300000, 'in', 'Cheque deposit')
        g_bank = movement('FEB', 15, 'SO-9930', 200003, 'in', 'Hospital remittance')
        g_book = entry('FEB', 15, 'SO-9930', 200000, 'in', 'TRX-000902', 'Bank receipt')
        feb = s.month('FEB', XERO, count=20, bank=[cleared, g_bank], book=[booked, g_book])
        name = 'Xero account transactions'
        s.steps = [
            open_(jan, by_hand(XERO, save=name)),
            reject(statement=[jan.S(m1), jan.S(m2)], cashbook=['TRX-000802']),
            accept(statement=[jan.S(gap_bank)], cashbook=['TRX-000803']),
            book(s.book_balance(jan, extra=-10000), NOTE_EN), {'language': 'en'},
            sign('prepare', PREPARER, '2029-02-02'),
            save('Z06-JAN'),
            open_(feb, by_map(name), previous='Z06-JAN'),
            policy(3, 3, 'Acquirer rounding'),
            accept(cashbook=['TRX-000901'], carried=[f'JAN:{jan.S(charge)}']),
            accept(statement=[feb.S(cleared)], carried=['JAN:TRX-000801']),
            book(s.book_balance(feb), NOTE_EN), {'language': 'en'},
            sign('prepare', PREPARER, '2029-03-02'), sign('review', REVIEWER, '2029-03-03'),
            save('Z06-FEB'),
        ]
        s.recipe = ('Xero-style account transactions by OpenSpout under four title rows, typed dates; two pages a '
                    'month. January: two card settlements of 640.00 a day apart against one receipt of 640.00, an '
                    'ambiguity by amount and date, rejected; a payment booked four days early, accepted; a service '
                    'charge not booked and a cheque deposited without a reference, not yet credited; the book '
                    'balance declared 100.00 below the book, an unexplained difference. February, the same export '
                    'and the saved map: the charge booked without a reference and the cheque credited under one, '
                    'each a carried suggestion by amount, accepted; 0.03 an item and a period: a 0.03 difference '
                    'tolerated at the limit; the book balance declared right.')
        s.intent = {
            'Z06-JAN': intent(groups=[('ambiguous-amount-date', 1, ''), ('date-gap', 1, '')],
                              sheet=('difference', 10000, 0, 10000)),
            'Z06-FEB': intent(previous='accepted', tolerated=1, carried=5, still=3,
                              sheet=('reconciled-within-tolerance', 3, 3, 0)),
        }
        return s

    for make in (z01, z02, z03, z04, z05, z06):
        stories.append(make())
    return stories


def cash_row(e):
    return {k: e[k] for k in ('date', 'voucher', 'description', 'reference', 'receipt', 'payment')}


def ledgers(s):
    """Each month's ledger: its layout, writer, file and rows."""
    out, balance = {}, s.months[0].opening
    for m in s.months:
        layout = s.ledger.layouts[m.id]
        out[m.id] = {'layout': layout.name, 'writer': s.ledger.writer, 'file': f'{m.id}-ledger.xlsx',
                     'sheet': layout.sheet, 'rows': ledger_rows(m, layout, s.company, balance)}
        balance += m.flows()
    return out


def facts(stories=None):
    stories = stories or build()
    out = []
    for s in stories:
        story = {'id': s.sid, 'title': s.title, 'layout': s.layout, 'digits': s.digits, 'print': s.print,
                 'periods': [{'id': m.id, 'statement': m.statement(), 'cashbook': [cash_row(e) for e in m.book]}
                             for m in s.months],
                 'ledgers': ledgers(s), 'steps': s.steps, 'recipe': s.recipe, 'intent': s.intent}
        if s.width:
            story['width'] = s.width
        out.append(story)
    return {'version': VERSION, 'stories': out}


def facts_json(stories=None):
    return json.dumps(facts(stories), ensure_ascii=False, indent=1) + '\n'


def print_records(f):
    """Each month's statement as the copied renderers read a story: one
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
