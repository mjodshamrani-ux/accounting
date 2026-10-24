"""BNK-PDF-1 G8 holdout: new synthetic bank statements and cashbooks as facts.

A third generator lineage, written for G8. Nothing is imported from the
foundation's stories.mjs, from the G6 holdout's stories.py, from either
renderer or from the product. Where G6 laid out ordinary movements and
appended special ones, this generator keeps a ledger of economic events:
each event is a statement movement, a cashbook entry or both, with its own
dates, reference and direction, and its expected outcome is written by hand
beside it. Routine events come from a Lehmer (Park-Miller) generator.

The facts follow the foundation's contract (contract.json): one account in
SAR with two decimals, one period per statement, the same column headings,
control lines, account line and page footer. What changes is what the
contract leaves open: the producers (Typst and fpdf2, neither of them
Chromium, LibreOffice or ReportLab), fonts, table styles, periods, banks,
accounts, reference styles, narratives, economic relationships and faults.

Each story lists its statement page by page and line by line as printed,
including the lines that are not movements. `recipe` says how the pages
were made and styled and which fault was planted; `intent` is the designer's
expected outcome, written by hand. The independent oracle reads neither.
Amounts are minor units; balances are running balances.

  python3 -B audit/bank-statement-holdout-g8/stories.py > stories.json
"""
import json
import sys
from datetime import date, timedelta

VERSION = 'bank-statement-holdout-g8-1'
WINDOW = 3
MODULUS = 2147483647


class Lehmer:
    """Park-Miller minimal standard generator: the facts regenerate byte for
    byte on any Python."""

    def __init__(self, seed):
        self.x = seed % MODULUS or 1

    def int(self, lo, hi):
        self.x = self.x * 48271 % MODULUS
        return lo + self.x % (hi - lo + 1)

    def pick(self, xs):
        return xs[self.int(0, len(xs) - 1)]


def shift(day, n):
    return (date.fromisoformat(day) + timedelta(days=n)).isoformat()


BANK_OUT = ['SADAD bill payment', 'Outgoing SWIFT transfer', 'Local transfer to beneficiary',
            'Cheque presented for payment', 'POS purchase settlement', 'Standing order payment']
BANK_IN = ['Incoming SWIFT credit', 'Local transfer received', 'Cash deposit at branch',
           'Cheque deposit cleared', 'Merchant settlement credit', 'Refund credit from supplier']
CASH_OUT = ['Supplier invoice settlement', 'Office rent', 'Salaries', 'Utilities', 'Insurance premium', 'Vendor advance']
CASH_IN = ['Customer receipt', 'Sales proceeds', 'Deposit from customer', 'Interest received']
LONG = ['for invoice 2026-114 dated 2026-11-30 under purchase order 7781',
        'Gulf Coast Marine Services LLC, contract 4410, second instalment',
        'Al Rawabi Trading Est. settlement of statement 2026-09',
        'reference to remittance advice 1,250.00 short paid on previous transfer']
AR_BANK_OUT = ['سداد فاتورة عبر سداد', 'حوالة محلية صادرة', 'شيك مقدم للصرف', 'تسوية مشتريات نقاط البيع',
               'أمر دفع مستديم']
AR_BANK_IN = ['حوالة سويفت واردة', 'حوالة محلية واردة', 'إيداع نقدي في الفرع', 'تحصيل شيك', 'تسوية مبيعات التاجر']
AR_CASH_OUT = ['سداد فاتورة مورد', 'إيجار المكتب', 'رواتب الموظفين', 'تأمين']
AR_CASH_IN = ['تحصيل من عميل', 'متحصلات مبيعات', 'دفعة مقدمة من عميل']


class Ledger:
    def __init__(self, sid, seed, title, *, producer, font, paper, period, opening, per_page, bank,
                 document_title, account, layout='en', digits=None, page_totals=False, cashbook_xlsx=None,
                 style=None):
        self.rng = Lehmer(seed)
        self.id, self.title, self.layout, self.digits = sid, title, layout, digits
        self.producer, self.font, self.paper = producer, font, paper
        self.period = {'start': period[0], 'end': period[1]}
        self.opening, self.per_page, self.page_totals = opening, per_page, page_totals
        self.bank_name, self.document_title, self.account = bank, document_title, account
        self.cashbook_xlsx = cashbook_xlsx
        self.movements, self.entries = [], []
        self.recipe = {'opening': opening, 'rowsPerPage': per_page, 'style': style or {}}
        self.continuation = None
        self.counters = {'in': 0, 'out': 0}
        self.intent = {'statement': 'verified', 'auto': [], 'review': [], 'bankOnly': [], 'cashOnly': [], 'timing': []}

    def bank(self, key, day, text, reference='', *, out=0, into=0, value=None):
        assert (out > 0) != (into > 0) and self.period['start'] <= day <= self.period['end']
        self.movements.append({'key': f'b:{key}', 'date': day, 'valueDate': value or day, 'description': text,
                               'reference': reference, 'withdrawal': out, 'deposit': into})

    def cash(self, key, day, text, reference='', *, receipt=0, payment=0):
        assert (receipt > 0) != (payment > 0)
        direction = 'in' if receipt else 'out'
        self.counters[direction] += 1
        voucher = f"{'RV' if receipt else 'PV'}{day[2:4]}{day[5:7]}-{self.id[1:]}{self.counters[direction]:03d}"
        self.entries.append({'key': f'c:{key}', 'date': day, 'voucher': voucher, 'description': text,
                             'reference': reference, 'receipt': receipt, 'payment': payment})

    def amount(self, scale):
        r = self.rng
        if scale == 'huge':
            return r.int(1000000, 2500000000) * 100 + r.int(0, 99)
        if scale == 'modest':
            return r.int(10, 9999) * 100 + r.int(0, 99)
        band = r.int(1, 10)
        if band <= 3:
            return r.int(10, 999) * 100 + r.int(0, 99)
        if band <= 8:
            return r.int(1000, 49999) * 100 + r.int(0, 99)
        return r.int(50000, 480000) * 100 + r.int(0, 99)

    def routine(self, count, prefix, reference, *, only=None, scale='mixed', long_every=0, two_lines_every=0,
                second_line=''):
        """`count` events recorded on both sides under one reference each,
        spread over the period; the cashbook date is up to three days before
        or two after the statement's, inside the period."""
        r, arabic = self.rng, self.layout == 'ar'
        start, end = self.period['start'], self.period['end']
        span = (date.fromisoformat(end) - date.fromisoformat(start)).days - 1
        for i in range(count):
            day = shift(start, 1 + (span * i) // max(count, 1))
            outflow = (r.int(0, 1) == 1) if only is None else only == 'out'
            value = self.amount(scale)
            key = f'{prefix}{i + 1}'
            words = (AR_BANK_OUT if outflow else AR_BANK_IN) if arabic else (BANK_OUT if outflow else BANK_IN)
            text = r.pick(words)
            if long_every and i % long_every == long_every - 1:
                text = f'{text} {LONG[(i // long_every) % len(LONG)]}'
            if two_lines_every and i % two_lines_every == two_lines_every - 1:
                text = f'{text}\n{second_line}'
            ref = reference(i, outflow)
            self.bank(key, day, text, ref, out=value if outflow else 0, into=0 if outflow else value)
            booked = min(max(shift(day, r.int(-3, 2)), start), end)
            cash_words = (AR_CASH_OUT if outflow else AR_CASH_IN) if arabic else (CASH_OUT if outflow else CASH_IN)
            self.cash(key, booked, r.pick(cash_words), ref,
                      receipt=0 if outflow else value, payment=value if outflow else 0)
            self.intent['auto'].append([f'b:{key}', f'c:{key}'])

    def held(self, status):
        self.intent = {'statement': status, 'auto': [], 'review': [], 'bankOnly': [], 'cashOnly': [], 'timing': []}

    def facts(self):
        bank = sorted(self.movements, key=lambda m: m['date'])
        cash = sorted(self.entries, key=lambda e: e['date'])
        balance, rows = self.opening, []
        for m in bank:
            balance += m['deposit'] - m['withdrawal']
            rows.append({'kind': 'movement', **m, 'balance': balance})
        size = self.per_page
        chunks = [rows[a:a + size] for a in range(0, len(rows), size)]
        pages = []
        for n, chunk in enumerate(chunks, 1):
            lines = [{'kind': 'opening', 'balance': self.opening} if n == 1
                     else {'kind': 'brought-forward', 'balance': chunks[n - 2][-1]['balance']}]
            if self.continuation and self.continuation['page'] == n:
                lines.append({'kind': 'continuation', 'text': self.continuation['text']})
            lines += chunk
            if self.page_totals:
                lines.append({'kind': 'page-totals', 'withdrawal': sum(m['withdrawal'] for m in chunk),
                              'deposit': sum(m['deposit'] for m in chunk)})
            if n < len(chunks):
                lines.append({'kind': 'carried-forward', 'balance': chunk[-1]['balance']})
            else:
                lines.append({'kind': 'closing', 'balance': rows[-1]['balance']})
                lines.append({'kind': 'totals', 'withdrawal': sum(m['withdrawal'] for m in rows),
                              'deposit': sum(m['deposit'] for m in rows)})
            pages.append({'number': n, 'of': len(chunks), 'lines': lines})
        # Planted faults: the printed pages, as the fault leaves them.
        if 'dropDebitMark' in self.recipe:
            line = next(l for p in pages for l in p['lines'] if l.get('key') == self.recipe['dropDebitMark'])
            assert line['balance'] < 0
            line['balance'] = -line['balance']
        if 'dropPage' in self.recipe:
            pages = [p for p in pages if p['number'] != self.recipe['dropPage']]
        if 'pageOrder' in self.recipe:
            pages = [pages[n - 1] for n in self.recipe['pageOrder']]
        head = {'id': self.id, 'title': self.title, 'layout': self.layout}
        if self.digits:
            head['digits'] = self.digits
        head.update(producer=self.producer, font=self.font, paper=self.paper, bank=self.bank_name,
                    documentTitle=self.document_title)
        if self.cashbook_xlsx:
            head['cashbookXlsx'] = self.cashbook_xlsx
        recipe = dict(self.recipe)
        if self.page_totals:
            recipe['pageTotals'] = True
        if self.continuation:
            recipe['continuation'] = self.continuation['page']
        return {**head, 'recipe': recipe, 'intent': self.intent,
                'statement': {'account': self.account, 'currency': 'SAR', 'period': self.period, 'pages': pages},
                'cashbook': cash}


def styled(**style):
    return style


def build():
    stories = []

    s = Ledger('K01', 801, 'year-end period; a heading band in white on dark blue, centred headings, striped rows and '
               'descriptions that wrap with dates and amounts in their text; references three and four days apart, '
               'a cashbook reference with surrounding spaces, a value date after the period',
               producer='typst', font='DejaVu Serif', paper='Letter', period=('2026-12-15', '2027-01-14'),
               opening=18250000, per_page=8, bank='Harbor Line Bank', document_title='Statement of Account',
               account='SA71 8000 0000 1122 3344 0801',
               style=styled(heading='band', headingAlign='center', stripes=True, rules='none', wrap='auto'))
    s.routine(15, 'A', lambda i, out: f'TRF/26/{40100 + i:06d}' if out else f'INW/26/{70100 + i:06d}', long_every=4)
    s.bank('w3', '2026-12-31', 'Outgoing SWIFT transfer to Gulf Coast Marine Services LLC for invoice dated '
           '2026-12-01 amount 12,500.00', 'TRF/26/049001', out=1250000)
    s.cash('w3', '2026-12-28', 'Supplier invoice settlement', 'TRF/26/049001', payment=1250000)
    s.intent['auto'].append(['b:w3', 'c:w3'])
    s.bank('w4', '2027-01-05', 'Local transfer to beneficiary', 'TRF/27/000017', out=430075)
    s.cash('w4', '2027-01-01', 'Vendor advance', 'TRF/27/000017', payment=430075)
    s.intent['review'].append({'bank': ['b:w4'], 'cash': ['c:w4'], 'reason': 'date-gap'})
    s.bank('sp', '2026-12-22', 'Incoming SWIFT credit', 'INW/26/071777', into=2899000)
    s.cash('sp', '2026-12-22', 'Customer receipt', ' INW/26/071777 ', receipt=2899000)
    s.intent['auto'].append(['b:sp', 'c:sp'])
    s.bank('vt', '2027-01-14', 'Cheque deposit cleared', 'CHQ-DEP-5521', into=1500000, value='2027-01-17')
    s.cash('vt', '2027-01-13', 'Customer receipt', 'CHQ-DEP-5521', receipt=1500000)
    s.intent['auto'].append(['b:vt', 'c:vt'])
    s.intent['timing'].append('b:vt')
    stories.append(s)

    s = Ledger('K02', 802, 'full grid with the Value Date heading on two lines; references with inner spaces; two '
               'transfers whose sum is one cashbook payment, amounts three and four days apart without references, '
               'a reference on the statement only; cashbook also as typed XLSX from XlsxWriter',
               producer='typst', font='Inter', paper='A4', period=('2026-06-01', '2026-06-30'),
               opening=7500000, per_page=9, bank='Harbor Line Bank', document_title='Statement of Account',
               account='SA71 8000 0000 1122 3344 0802', cashbook_xlsx='typed',
               style=styled(heading='plain', headingAlign='start', rules='grid', valueDateHeading='two-lines'))
    s.routine(13, 'B', lambda i, out: f'POS {4532 + i} {918 + 7 * i:04d}' if out else f'SADAD-{55100 + i}')
    s.bank('s1', '2026-06-10', 'Local transfer to beneficiary', out=400000)
    s.bank('s2', '2026-06-11', 'Local transfer to beneficiary', out=600000)
    s.cash('s', '2026-06-10', 'Supplier invoice settlement', payment=1000000)
    s.intent['bankOnly'] += ['b:s1', 'b:s2']
    s.intent['cashOnly'].append('c:s')
    s.bank('a3', '2026-06-20', 'Cash deposit at branch', into=333333)
    s.cash('a3', '2026-06-17', 'Customer receipt', receipt=333333)
    s.intent['review'].append({'bank': ['b:a3'], 'cash': ['c:a3'], 'reason': 'amount-date-suggestion'})
    s.bank('a4', '2026-06-24', 'POS purchase settlement', out=222222)
    s.cash('a4', '2026-06-28', 'Utilities', payment=222222)
    s.intent['bankOnly'].append('b:a4')
    s.intent['cashOnly'].append('c:a4')
    s.bank('r1', '2026-06-15', 'SADAD bill payment', 'SADAD-55017', out=87000)
    s.cash('r1', '2026-06-15', 'Utilities', payment=87000)
    s.intent['review'].append({'bank': ['b:r1'], 'cash': ['c:r1'], 'reason': 'amount-date-suggestion'})
    stories.append(s)

    s = Ledger('K03', 803, 'quarter of 42 landscape pages in a monospaced font with page totals, long wrapping '
               'descriptions and a description continuing at the top of page 13; one transfer booked as two '
               'payments under its reference',
               producer='typst', font='DejaVu Sans Mono', paper='A4-landscape', period=('2026-01-01', '2026-03-31'),
               opening=250000000, per_page=24, page_totals=True, bank='Harbor Line Bank',
               document_title='Statement of Account', account='SA71 8000 0000 1122 3344 0803',
               style=styled(heading='plain', headingAlign='start', rules='heading', wrap='auto'))
    s.routine(1000, 'C', lambda i, out: (f'CHQ{610000 + i:06d}' if i % 3 == 0 else f'FT26Q1{i + 1:05d}') if out
              else f'FT26Q1C{i + 1:05d}', long_every=37)
    s.bank('dr', '2026-02-17', 'Outgoing SWIFT transfer', 'SWF26021700', out=1000000)
    s.cash('dr1', '2026-02-16', 'Supplier invoice settlement', 'SWF26021700', payment=500000)
    s.cash('dr2', '2026-02-17', 'Supplier invoice settlement', 'SWF26021700', payment=500000)
    s.intent['review'].append({'bank': ['b:dr'], 'cash': ['c:dr1', 'c:dr2'], 'reason': 'duplicate-reference'})
    s.continuation = {'page': 13, 'text': '(continued) settlement batch 2026-Q1-0442, terminal 88231'}
    stories.append(s)

    s = Ledger('K04', 804, 'Arabic statement in Amiri with Latin digits: the balance falls to exactly 0.00, runs '
               'overdrawn and recovers; four equal card settlements chained by dates into one review group; a value '
               'date after the period',
               producer='typst', font='Amiri', paper='A4', layout='ar', digits='latin',
               period=('2026-11-16', '2026-12-15'), opening=2000000, per_page=9, bank='مصرف الساحل الأهلي',
               document_title='كشف حساب جاري', account='SA71 8000 0000 1122 3344 0804',
               style=styled(heading='band-light', headingAlign='center', rules='grid'))
    s.bank('z0', '2026-11-16', 'حوالة محلية صادرة', 'FT2611Z001', out=2000000)
    s.cash('z0', '2026-11-16', 'سداد فاتورة مورد', 'FT2611Z001', payment=2000000)
    s.intent['auto'].append(['b:z0', 'c:z0'])
    s.routine(9, 'D', lambda i, out: f'FT2611D{i + 1:04d}' if out else f'IN2611D{i + 1:04d}', scale='modest')
    s.bank('dw', '2026-11-25', 'شيك مقدم للصرف', 'CHQ661204', out=9000000)
    s.cash('dw', '2026-11-24', 'سداد فاتورة مورد', 'CHQ661204', payment=9000000)
    s.intent['auto'].append(['b:dw', 'c:dw'])
    s.bank('cr', '2026-12-10', 'حوالة سويفت واردة', 'SWF2612CR9', into=25000000)
    s.cash('cr', '2026-12-10', 'تحصيل من عميل', 'SWF2612CR9', receipt=25000000)
    s.intent['auto'].append(['b:cr', 'c:cr'])
    s.bank('k1', '2026-11-20', 'تسوية مشتريات نقاط البيع', out=150000)
    s.bank('k2', '2026-11-24', 'تسوية مشتريات نقاط البيع', out=150000)
    s.cash('k1', '2026-11-22', 'سداد فاتورة مورد', payment=150000)
    s.cash('k2', '2026-11-26', 'سداد فاتورة مورد', payment=150000)
    s.intent['review'].append({'bank': ['b:k1', 'b:k2'], 'cash': ['c:k1', 'c:k2'], 'reason': 'ambiguous-amount-date'})
    s.bank('vt', '2026-12-15', 'حوالة محلية واردة', 'IN2612VT1', into=780000, value='2026-12-17')
    s.cash('vt', '2026-12-15', 'تحصيل من عميل', 'IN2612VT1', receipt=780000)
    s.intent['auto'].append(['b:vt', 'c:vt'])
    s.intent['timing'].append('b:vt')
    stories.append(s)

    s = Ledger('K05', 805, 'Arabic statement in DejaVu Sans with Arabic-Indic digits and striped rows: a transfer '
               'returned by the bank under its reference, a service fee, an unpresented cheque',
               producer='typst', font='DejaVu Sans', paper='A4', layout='ar', digits='arabic',
               period=('2026-05-01', '2026-05-31'), opening=4560000, per_page=8, bank='مصرف الساحل الأهلي',
               document_title='كشف حساب', account='SA71 8000 0000 1122 3344 0805',
               style=styled(heading='plain', headingAlign='start', rules='heading', stripes=True))
    s.routine(10, 'E', lambda i, out: f'CHQ{330400 + i}' if out else f'FT2605E{i + 1:04d}', scale='modest')
    s.bank('rt1', '2026-05-10', 'حوالة محلية صادرة', 'FT2605RT', out=1200000)
    s.bank('rt2', '2026-05-12', 'إعادة حوالة: حساب المستفيد مغلق', 'FT2605RT', into=1200000)
    s.cash('rt', '2026-05-10', 'سداد فاتورة مورد', 'FT2605RT', payment=1200000)
    s.intent['review'].append({'bank': ['b:rt1', 'b:rt2'], 'cash': ['c:rt'], 'reason': 'duplicate-reference'})
    s.bank('fee', '2026-05-31', 'رسوم خدمة الحساب', out=5750)
    s.intent['bankOnly'].append('b:fee')
    s.cash('up', '2026-05-29', 'سداد فاتورة مورد بشيك', 'CHQ330499', payment=1880000)
    s.intent['cashOnly'].append('c:up')
    stories.append(s)

    s = Ledger('K06', 806, 'the last page (4 of 4) missing', producer='typst', font='FreeSans', paper='A4',
               period=('2026-10-16', '2026-10-31'), opening=9900000, per_page=7, bank='Harbor Line Bank',
               document_title='Statement of Account', account='SA71 8000 0000 1122 3344 0806',
               style=styled(heading='plain', headingAlign='start', rules='heading'))
    s.routine(26, 'F', lambda i, out: f'FT2610F{i + 1:04d}')
    s.recipe['dropPage'] = 4
    s.held('incomplete-pages')
    stories.append(s)

    s = Ledger('K07', 807, 'grid with a grey heading row in the standard Times font; references crossed between two '
               'transfers of the same day, a deposit and a payment of the same amount and day without references',
               producer='fpdf2', font='Times', paper='A4', period=('2026-04-01', '2026-04-30'),
               opening=12345600, per_page=9, bank='Meridian Savings Bank', document_title='Account Statement',
               account='SA36 6000 0000 5566 7788 0807',
               style=styled(heading='filled', headingAlign='start', rules='grid', periodSeparator='to'))
    s.routine(16, 'G', lambda i, out: f'MT103-2604-{i + 1:05d}' if out else f'MT910-2604-{i + 1:05d}')
    s.bank('x1', '2026-04-14', 'Outgoing SWIFT transfer', 'PAY/0414/A', out=50000)
    s.bank('x2', '2026-04-14', 'Outgoing SWIFT transfer', 'PAY/0414/B', out=70000)
    s.cash('x1', '2026-04-14', 'Supplier invoice settlement', 'PAY/0414/A', payment=70000)
    s.cash('x2', '2026-04-14', 'Supplier invoice settlement', 'PAY/0414/B', payment=50000)
    s.intent['review'] += [{'bank': ['b:x1'], 'cash': ['c:x1'], 'reason': 'amount-difference'},
                           {'bank': ['b:x2'], 'cash': ['c:x2'], 'reason': 'amount-difference'}]
    s.bank('o1', '2026-04-21', 'Cash deposit at branch', into=250000)
    s.cash('o1', '2026-04-21', 'Insurance premium', payment=250000)
    s.intent['bankOnly'].append('b:o1')
    s.intent['cashOnly'].append('c:o1')
    stories.append(s)

    s = Ledger('K08', 808, 'collection account opened at 0.00 with deposits only, some above one billion riyals, so '
               'the total withdrawals print 0.00; headings over the amounts aligned to their end; a deposit in '
               'transit; cashbook also as text XLSX from openpyxl',
               producer='fpdf2', font='Caladea', paper='Letter', period=('2026-02-01', '2026-02-28'),
               opening=0, per_page=10, bank='Meridian Savings Bank', document_title='Account Statement',
               account='SA36 6000 0000 5566 7788 0808', cashbook_xlsx='text',
               style=styled(heading='plain', headingAlign='start', amountHeadingAlign='end', rules='heading'))
    s.routine(14, 'H', lambda i, out: f'COLL-2602-{i + 1:04d}', only='in', scale='huge')
    s.cash('dt', '2026-02-28', 'Deposit from customer', 'COLL-2602-9001', receipt=75000000)
    s.intent['cashOnly'].append('c:dt')
    stories.append(s)

    s = Ledger('K09', 809, 'one overdrawn balance printed without its DR suffix', producer='fpdf2', font='Courier',
               paper='A4', period=('2026-03-01', '2026-03-15'), opening=300000, per_page=8,
               bank='Meridian Savings Bank', document_title='Account Statement',
               account='SA36 6000 0000 5566 7788 0809',
               style=styled(heading='plain', headingAlign='start', rules='heading', periodSeparator='to'))
    s.routine(14, 'J', lambda i, out: f'FT2603J{i + 1:04d}')
    s.bank('od', '2026-03-05', 'Outgoing SWIFT transfer', 'FT2603OD1', out=20000000)
    s.cash('od', '2026-03-05', 'Supplier invoice settlement', 'FT2603OD1', payment=20000000)
    s.recipe['dropDebitMark'] = 'b:od'
    s.held('balance-broken')
    stories.append(s)

    s = Ledger('K10', 810, 'Arabic statement in Amiri with Arabic-Indic digits, drawn cell by cell: SADAD '
               'references with an inner space, a payment booked with two digits transposed, an overdraft that '
               'recovers, a value date before the period',
               producer='fpdf2', font='Amiri', paper='A4', layout='ar', digits='arabic',
               period=('2026-06-15', '2026-07-14'), opening=6000000, per_page=8, bank='مصرف الواحة',
               document_title='كشف حساب', account='SA36 6000 0000 5566 7788 0810',
               style=styled(heading='filled', headingAlign='start', rules='grid'))
    s.routine(10, 'K', lambda i, out: f'SADAD {90010 + i}' if out else f'FT2606K{i + 1:04d}', scale='modest')
    s.bank('tp', '2026-06-29', 'سداد فاتورة عبر سداد', 'SADAD 90071', out=123450)
    s.cash('tp', '2026-06-29', 'سداد فاتورة مورد', 'SADAD 90071', payment=124350)
    s.intent['review'].append({'bank': ['b:tp'], 'cash': ['c:tp'], 'reason': 'amount-difference'})
    s.bank('ov', '2026-07-01', 'شيك مقدم للصرف', 'CHQ770112', out=10000000)
    s.cash('ov', '2026-06-30', 'سداد فاتورة مورد', 'CHQ770112', payment=10000000)
    s.intent['auto'].append(['b:ov', 'c:ov'])
    s.bank('rc', '2026-07-08', 'حوالة سويفت واردة', 'FT2607RC1', into=6000000)
    s.cash('rc', '2026-07-08', 'تحصيل من عميل', 'FT2607RC1', receipt=6000000)
    s.intent['auto'].append(['b:rc', 'c:rc'])
    s.bank('v0', '2026-06-15', 'حوالة سويفت واردة', 'FT2606V00', into=990000, value='2026-06-12')
    s.cash('v0', '2026-06-15', 'تحصيل من عميل', 'FT2606V00', receipt=990000)
    s.intent['auto'].append(['b:v0', 'c:v0'])
    s.intent['timing'].append('b:v0')
    stories.append(s)

    s = Ledger('K11', 811, 'Arabic statement in DejaVu Sans with Latin digits and page totals: descriptions on two '
               'lines and an Arabic description continuing at the top of page 3',
               producer='fpdf2', font='DejaVu Sans', paper='Letter', layout='ar', digits='latin',
               period=('2027-01-01', '2027-01-31'), opening=15000000, per_page=8, page_totals=True,
               bank='مصرف الواحة', document_title='كشف حساب جاري', account='SA36 6000 0000 5566 7788 0811',
               style=styled(heading='plain', headingAlign='start', amountAlign='start', rules='heading'))
    s.routine(22, 'L', lambda i, out: f'FT2701L{i + 1:04d}' if out else f'IN2701L{i + 1:04d}',
              scale='modest', two_lines_every=5, second_line='لصالح شركة الأفق للخدمات اللوجستية')
    s.continuation = {'page': 3, 'text': 'تتمة: دفعة فواتير يناير رقم 118'}
    stories.append(s)

    s = Ledger('K12', 812, 'pages printed out of order (1, 3, 2)', producer='fpdf2', font='Carlito', paper='A4',
               period=('2026-09-16', '2026-10-15'), opening=5400000, per_page=7, bank='Meridian Savings Bank',
               document_title='Account Statement', account='SA36 6000 0000 5566 7788 0812',
               style=styled(heading='plain', headingAlign='start', rules='heading'))
    s.routine(18, 'M', lambda i, out: f'FT2609M{i + 1:04d}')
    s.recipe['pageOrder'] = [1, 3, 2]
    s.held('incomplete-pages')
    stories.append(s)
    return [s.facts() for s in stories]


def facts_json(stories=None):
    stories = build() if stories is None else stories
    dump = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':'))  # noqa: E731
    out = []
    for s in stories:
        head = {k: v for k, v in s.items() if k not in ('recipe', 'intent', 'statement', 'cashbook')}
        st = s['statement']
        pages = ',\n'.join('   {"number":%d,"of":%d,"lines":[\n%s\n   ]}'
                           % (p['number'], p['of'], ',\n'.join('    ' + dump(l) for l in p['lines']))
                           for p in st['pages'])
        cash = ',\n'.join('    ' + dump(e) for e in s['cashbook'])
        out.append('  {' + ','.join(f'{dump(k)}:{dump(v)}' for k, v in head.items()) + ',\n'
                   f'   "recipe":{dump(s["recipe"])},\n   "intent":{dump(s["intent"])},\n'
                   f'   "statement":{{"account":{dump(st["account"])},"currency":"SAR","period":{dump(st["period"])},'
                   f'"pages":[\n{pages}\n   ]}},\n'
                   f'   "cashbook":[\n{cash}\n   ]}}')
    return ('{"version":%s,"dateWindowDays":%d,"currency":"SAR","decimals":2,"stories":[\n%s\n]}\n'
            % (dump(VERSION), WINDOW, ',\n'.join(out)))


if __name__ == '__main__':
    sys.stdout.write(facts_json())
