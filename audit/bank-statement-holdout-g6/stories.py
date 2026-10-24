"""BNK-PDF-1 G6 holdout: new synthetic bank statements and cashbooks as facts.

A second generator lineage, written for G6 in Python. Nothing is imported
from the foundation's stories.mjs, from its renderer or from the product.
The facts follow the foundation's contract (contract.json): one account in
SAR with two decimals, one period per statement, the same column headings
and control lines. What changes is everything the contract leaves open:
the periods (none of them the foundation's alone), the bank and title, the
account, the reference styles, the descriptions, the economic relationships
and faults, the page size and geometry, and the PDF producer (LibreOffice
Writer and ReportLab instead of Chromium).

Each story lists its statement page by page and line by line as printed,
including the lines that are not movements. `recipe` says how the pages were
made and which fault was planted; `intent` is the designer's expected
outcome, written here by hand. The independent oracle reads neither.
Amounts are minor units; balances are running balances.

  python3 -B audit/bank-statement-holdout-g6/stories.py > stories.json
"""
import json
import sys
from datetime import date, timedelta

VERSION = 'bank-statement-holdout-g6-1'
WINDOW = 3
MASK = 0xFFFFFFFF


class Rng:
    """xorshift32, so the facts regenerate byte for byte on any Python."""

    def __init__(self, seed):
        self.x = (seed & MASK) or 1

    def int(self, lo, hi):
        x = self.x
        x ^= (x << 13) & MASK
        x ^= x >> 17
        x ^= (x << 5) & MASK
        self.x = x
        return lo + x % (hi - lo + 1)


def iso(d):
    return d.isoformat()


def shift(day, n):
    return iso(date.fromisoformat(day) + timedelta(days=n))


OUT_BANK = ['Outward transfer', 'Cheque paid', 'Card settlement', 'Supplier payment', 'Utility bill payment']
IN_BANK = ['Incoming transfer', 'Customer deposit', 'Cash deposit', 'Inward remittance', 'Collection credit']
OUT_CASH = ['Payment to supplier', 'Rent payment', 'Payroll transfer', 'Expense reimbursement']
IN_CASH = ['Receipt from customer', 'Sales collection', 'Refund received', 'Capital contribution']
AR_OUT_BANK = ['حوالة صادرة', 'شيك مصروف', 'سداد فاتورة', 'دفعة لمورد']
AR_IN_BANK = ['حوالة واردة', 'إيداع نقدي', 'إيداع عميل', 'تحصيل']
AR_OUT_CASH = ['دفعة لمورد', 'سداد إيجار', 'رواتب']
AR_IN_CASH = ['تحصيل من عميل', 'مبيعات', 'استرداد']


class Story:
    def __init__(self, sid, seed, title, *, producer, font, paper, period, opening, rows_per_page,
                 bank, document_title, account, layout='en', digits=None, page_totals=False, cashbook_xlsx=None):
        self.r = Rng(seed)
        self.id, self.title, self.layout, self.digits = sid, title, layout, digits
        self.producer, self.font, self.paper = producer, font, paper
        self.period = {'start': period[0], 'end': period[1]}
        self.opening, self.rows_per_page, self.page_totals = opening, rows_per_page, page_totals
        self.bank_name, self.document_title, self.account = bank, document_title, account
        self.cashbook_xlsx = cashbook_xlsx
        self.bank, self.cash = [], []
        self.recipe = {}
        self.continuation = None
        self.intent = {'statement': 'verified', 'auto': [], 'review': [], 'bankOnly': [], 'cashOnly': [], 'timing': []}

    def move(self, key, day, description, reference, withdrawal=0, deposit=0, value=None):
        self.bank.append({'key': f'b:{key}', 'date': day, 'valueDate': value or day, 'description': description,
                          'reference': reference, 'withdrawal': withdrawal, 'deposit': deposit})

    def entry(self, key, day, voucher, description, reference, receipt=0, payment=0):
        self.cash.append({'key': f'c:{key}', 'date': day, 'voucher': voucher, 'description': description,
                          'reference': reference, 'receipt': receipt, 'payment': payment})

    def ordinary(self, count, prefix, refs):
        """`count` movements recorded on both sides under one explicit
        reference each; `refs(i, outflow)` writes the reference."""
        r = self.r
        start, end = date.fromisoformat(self.period['start']), date.fromisoformat(self.period['end'])
        span = (end - start).days - 2
        arabic = self.layout == 'ar'
        for i in range(count):
            day = iso(start + timedelta(days=1 + (span * i) // max(count - 1, 1)))
            outflow = r.int(0, 1) == 1
            amount = r.int(150, 95000) * 100 + r.int(0, 99)
            ref = refs(i, outflow)
            k = f'{prefix}{i + 1}'
            bank_words = (AR_OUT_BANK if outflow else AR_IN_BANK) if arabic else (OUT_BANK if outflow else IN_BANK)
            cash_words = (AR_OUT_CASH if outflow else AR_IN_CASH) if arabic else (OUT_CASH if outflow else IN_CASH)
            self.move(k, day, bank_words[r.int(0, len(bank_words) - 1)], ref,
                      withdrawal=amount if outflow else 0, deposit=0 if outflow else amount)
            self.entry(k, max(shift(day, -r.int(0, 2)), self.period['start']),
                       f"{'PV' if outflow else 'RV'}-{prefix}{i + 1:03d}", cash_words[r.int(0, len(cash_words) - 1)],
                       ref, receipt=0 if outflow else amount, payment=amount if outflow else 0)
            self.intent['auto'].append([f'b:{k}', f'c:{k}'])

    def facts(self):
        bank = sorted(self.bank, key=lambda m: m['date'])
        cash = sorted(self.cash, key=lambda e: e['date'])
        balance, rows = self.opening, []
        for m in bank:
            balance += m['deposit'] - m['withdrawal']
            rows.append(dict(m, balance=balance))
        n, size = len(rows), self.rows_per_page
        chunks = [(a, min(a + size, n)) for a in range(0, n, size)]
        total = len(chunks)
        pages = []
        for p, (a, b) in enumerate(chunks):
            number = p + 1
            lines = [{'kind': 'opening', 'balance': self.opening} if number == 1
                     else {'kind': 'brought-forward', 'balance': rows[a - 1]['balance']}]
            if self.continuation and number == 2:
                lines.append({'kind': 'continuation', 'text': self.continuation})
            for m in rows[a:b]:
                lines.append({'kind': 'movement', **m})
            if self.page_totals:
                lines.append({'kind': 'page-totals', 'withdrawal': sum(m['withdrawal'] for m in rows[a:b]),
                              'deposit': sum(m['deposit'] for m in rows[a:b])})
            if number < total:
                lines.append({'kind': 'carried-forward', 'balance': rows[b - 1]['balance']})
            else:
                lines.append({'kind': 'closing', 'balance': rows[-1]['balance']})
                lines.append({'kind': 'totals', 'withdrawal': sum(m['withdrawal'] for m in rows),
                              'deposit': sum(m['deposit'] for m in rows)})
            pages.append({'number': number, 'of': total, 'lines': lines})
        fault = self.recipe.get('broughtForwardOff')
        if fault:
            pages[fault['page'] - 1]['lines'][0]['balance'] += fault['by']
        if self.recipe.get('dropPage'):
            pages = [p for p in pages if p['number'] != self.recipe['dropPage']]
        if self.recipe.get('repeatPage'):
            k = self.recipe['repeatPage']
            pages = pages[:k] + [json.loads(json.dumps(pages[k - 1]))] + pages[k:]
        head = {'id': self.id, 'title': self.title, 'layout': self.layout}
        if self.digits:
            head['digits'] = self.digits
        head.update(producer=self.producer, font=self.font, paper=self.paper, bank=self.bank_name,
                    documentTitle=self.document_title)
        if self.cashbook_xlsx:
            head['cashbookXlsx'] = self.cashbook_xlsx
        recipe = {'opening': self.opening, 'rowsPerPage': self.rows_per_page, **self.recipe}
        if self.page_totals:
            recipe['pageTotals'] = True
        if self.continuation:
            recipe['continuation'] = True
        return {**head, 'recipe': recipe, 'intent': self.intent,
                'statement': {'account': self.account, 'currency': 'SAR', 'period': self.period, 'pages': pages},
                'cashbook': cash}


def ft(tag):
    return lambda i, outflow: f'FT{tag}{i + 1:05d}'


def chq_or_ft(tag, base):
    return lambda i, outflow: f'CHQ{base + i:06d}' if outflow else f'FT{tag}{i + 1:05d}'


def build():
    stories = []

    s = Story('H01', 601, 'clean statement under bank-style references; cashbook as typed XLSX from LibreOffice Calc',
              producer='libreoffice-writer', font='Liberation Sans', paper='A4',
              period=('2026-08-01', '2026-08-31'), opening=41235075, rows_per_page=9,
              bank='Northwind Commercial Bank', document_title='Statement of Account',
              account='SA44 2000 0001 2345 6789 0101', cashbook_xlsx='typed')
    s.ordinary(14, 'A', chq_or_ft('2608A', 45100))
    stories.append(s)

    s = Story('H02', 602, 'equal amounts: a referenced pair beside an unreferenced twin, a group of three equal card '
              'settlements against two payments, a fee and an unpresented cheque',
              producer='libreoffice-writer', font='Liberation Serif', paper='Letter',
              period=('2026-09-01', '2026-09-30'), opening=9800000, rows_per_page=8,
              bank='Northwind Commercial Bank', document_title='Statement of Account',
              account='SA44 2000 0001 2345 6789 0202')
    s.ordinary(12, 'B', chq_or_ft('2609B', 46200))
    s.move('x1', '2026-09-10', 'Incoming transfer', 'FT2609X1', deposit=750000)
    s.entry('x1', '2026-09-09', 'RV-X01', 'Receipt from customer', 'FT2609X1', receipt=750000)
    s.intent['auto'].append(['b:x1', 'c:x1'])
    s.move('x2', '2026-09-10', 'Cash deposit', '', deposit=750000)
    s.entry('x2', '2026-09-10', 'RV-X02', 'Cash sales banked', 'RCPT-4471', receipt=750000)
    s.intent['review'].append({'bank': ['b:x2'], 'cash': ['c:x2'], 'reason': 'amount-date-suggestion'})
    for n, d in enumerate(['2026-09-21', '2026-09-22', '2026-09-23'], 1):
        s.move(f'g{n}', d, 'Card settlement', '', withdrawal=320000)
    for n, d in enumerate(['2026-09-22', '2026-09-23'], 1):
        s.entry(f'g{n}', d, f'PV-G0{n}', 'Card payment', '', payment=320000)
    s.intent['review'].append({'bank': ['b:g1', 'b:g2', 'b:g3'], 'cash': ['c:g1', 'c:g2'],
                               'reason': 'ambiguous-amount-date'})
    s.move('fee', '2026-09-29', 'Account maintenance fee', '', withdrawal=5750)
    s.intent['bankOnly'].append('b:fee')
    s.entry('up', '2026-09-28', 'PV-U01', 'Payment to supplier by cheque', 'CHQ004812', payment=1200000)
    s.intent['cashOnly'].append('c:up')
    stories.append(s)

    s = Story('H03', 603, 'Arabic statement with Arabic-Indic digits: amounts one riyal apart under one reference, '
              'opposite directions under another, a deposit in transit',
              producer='libreoffice-writer', font='FreeSerif', paper='A4', layout='ar', digits='arabic',
              period=('2026-08-01', '2026-08-31'), opening=26000000, rows_per_page=8,
              bank='مصرف الشمال التجاري', document_title='كشف حساب جاري',
              account='SA44 2000 0001 2345 6789 0303')
    s.ordinary(10, 'C', chq_or_ft('2608C', 47300))
    s.move('d1', '2026-08-12', 'شيك مصروف', 'CHQ771204', withdrawal=485000)
    s.entry('d1', '2026-08-11', 'PV-D01', 'دفعة لمورد', 'CHQ771204', payment=485100)
    s.intent['review'].append({'bank': ['b:d1'], 'cash': ['c:d1'], 'reason': 'amount-difference'})
    s.move('d2', '2026-08-19', 'حوالة واردة', 'FT2608R9', deposit=200000)
    s.entry('d2', '2026-08-19', 'PV-D02', 'دفعة مسجلة', 'FT2608R9', payment=200000)
    s.intent['review'].append({'bank': ['b:d2'], 'cash': ['c:d2'], 'reason': 'direction-conflict'})
    s.entry('dt', '2026-08-31', 'RV-T01', 'إيداع في الطريق', 'DEP-0831', receipt=1840000)
    s.intent['cashOnly'].append('c:dt')
    stories.append(s)

    s = Story('H04', 604, 'Arabic statement with Latin digits over a mid-month period: overdraft, a value date '
              'after the period, the same reference and amount seven days apart',
              producer='libreoffice-writer', font='DejaVu Sans', paper='A4', layout='ar', digits='latin',
              period=('2026-07-15', '2026-08-14'), opening=500000, rows_per_page=9,
              bank='مصرف الشمال التجاري', document_title='كشف حساب',
              account='SA44 2000 0001 2345 6789 0404')
    s.ordinary(10, 'D', chq_or_ft('2607D', 48400))
    s.move('od', '2026-07-16', 'حوالة صادرة', 'FT2607OD1', withdrawal=9500000)
    s.entry('od', '2026-07-16', 'PV-O01', 'دفعة لمورد', 'FT2607OD1', payment=9500000)
    s.intent['auto'].append(['b:od', 'c:od'])
    s.move('v1', '2026-08-14', 'حوالة واردة', 'FT2608V1', deposit=1234500, value='2026-08-16')
    s.entry('v1', '2026-08-14', 'RV-V01', 'تحصيل من عميل', 'FT2608V1', receipt=1234500)
    s.intent['auto'].append(['b:v1', 'c:v1'])
    s.intent['timing'].append('b:v1')
    s.move('gap', '2026-07-20', 'شيك مصروف', 'CHQ552910', withdrawal=999999)
    s.entry('gap', '2026-07-27', 'PV-G01', 'دفعة لمورد', 'CHQ552910', payment=999999)
    s.intent['review'].append({'bank': ['b:gap'], 'cash': ['c:gap'], 'reason': 'date-gap'})
    stories.append(s)

    s = Story('H05', 605, 'quarter statement of 30 landscape pages with page totals; wrapped descriptions and a '
              'description continuing at the top of page 2',
              producer='libreoffice-writer', font='Liberation Sans', paper='A4-landscape',
              period=('2026-07-01', '2026-09-30'), opening=120000000, rows_per_page=20, page_totals=True,
              bank='Northwind Commercial Bank', document_title='Statement of Account',
              account='SA44 2000 0001 2345 6789 0505')
    s.ordinary(600, 'E', chq_or_ft('26Q3E', 50000))
    for m in s.bank[49::50]:
        m['description'] = f"{m['description']}\nGulf Horizon Logistics Co."
    s.bank[19]['description'] = f"{s.bank[19]['description']} - Al Noor Trading Est."
    s.continuation = 'Invoice batch 2026-Q3-118 (continued from previous page)'
    stories.append(s)

    s = Story('H06', 606, 'balance brought forward on page 2 printed 100.00 above the carried-forward balance',
              producer='libreoffice-writer', font='Liberation Sans', paper='A4',
              period=('2026-10-01', '2026-10-15'), opening=3300000, rows_per_page=7,
              bank='Northwind Commercial Bank', document_title='Statement of Account',
              account='SA44 2000 0001 2345 6789 0606')
    s.ordinary(12, 'F', ft('2610F'))
    s.recipe['broughtForwardOff'] = {'page': 2, 'by': 10000}
    s.intent = {'statement': 'balance-broken', 'auto': [], 'review': [], 'bankOnly': [], 'cashOnly': [], 'timing': []}
    stories.append(s)

    s = Story('H07', 607, 'wrapped descriptions, one payment booked twice in the cashbook, and an outward transfer '
              'returned by the bank under the same reference; cashbook as text XLSX from LibreOffice Calc',
              producer='reportlab', font='Helvetica', paper='A4',
              period=('2026-08-01', '2026-08-31'), opening=15500000, rows_per_page=7,
              bank='Eastgate Bank', document_title='Account Statement',
              account='SA55 1500 0000 9876 5432 0707', cashbook_xlsx='text')
    s.ordinary(14, 'G', chq_or_ft('2608G', 52700))
    for m in s.bank[2::4]:
        m['description'] = f"{m['description']}\nper instruction of the account holder"
    s.move('dp', '2026-08-18', 'Supplier payment', 'PAY-778120', withdrawal=630000)
    s.entry('dp1', '2026-08-17', 'PV-P01', 'Payment to supplier', 'PAY-778120', payment=630000)
    s.entry('dp2', '2026-08-18', 'PV-P02', 'Payment to supplier', 'PAY-778120', payment=630000)
    s.intent['review'].append({'bank': ['b:dp'], 'cash': ['c:dp1', 'c:dp2'], 'reason': 'duplicate-reference'})
    s.move('rv1', '2026-08-12', 'Outward transfer', 'FT2608RV', withdrawal=1500000)
    s.move('rv2', '2026-08-13', 'Return of outward transfer\nbeneficiary account closed', 'FT2608RV', deposit=1500000)
    s.intent['bankOnly'] += ['b:rv1', 'b:rv2']
    stories.append(s)

    s = Story('H08', 608, 'page 3 of 4 missing', producer='reportlab', font='Helvetica', paper='Letter',
              period=('2026-11-01', '2026-11-30'), opening=7700000, rows_per_page=7,
              bank='Eastgate Bank', document_title='Account Statement',
              account='SA55 1500 0000 9876 5432 0808')
    s.ordinary(24, 'H', chq_or_ft('2611H', 53800))
    s.recipe['dropPage'] = 3
    s.intent = {'statement': 'incomplete-pages', 'auto': [], 'review': [], 'bankOnly': [], 'cashOnly': [], 'timing': []}
    stories.append(s)

    s = Story('H09', 609, 'page 2 of 3 printed twice', producer='reportlab', font='Helvetica', paper='A4',
              period=('2026-09-01', '2026-09-30'), opening=6600000, rows_per_page=7,
              bank='Eastgate Bank', document_title='Account Statement',
              account='SA55 1500 0000 9876 5432 0909')
    s.ordinary(18, 'J', chq_or_ft('2609J', 54900))
    s.recipe['repeatPage'] = 2
    s.intent = {'statement': 'incomplete-pages', 'auto': [], 'review': [], 'bankOnly': [], 'cashOnly': [], 'timing': []}
    stories.append(s)

    s = Story('H10', 610, 'overdrawn throughout, references with an inner space, and one reference that differs '
              'only in letter case between the two sides',
              producer='reportlab', font='Liberation Serif (embedded TrueType)', paper='A4',
              period=('2026-12-01', '2026-12-31'), opening=-250000000, rows_per_page=9,
              bank='Eastgate Bank', document_title='Account Statement',
              account='SA55 1500 0000 9876 5432 1010')
    s.ordinary(10, 'K', lambda i, outflow: f'SADAD {7300100 + i}' if outflow else f'FT2612K{i + 1:05d}')
    s.move('cs', '2026-12-15', 'Customer deposit', 'inv-20931', deposit=333333)
    s.entry('cs', '2026-12-15', 'RV-C01', 'Receipt from customer', 'INV-20931', receipt=333333)
    s.intent['review'].append({'bank': ['b:cs'], 'cash': ['c:cs'], 'reason': 'amount-date-suggestion'})
    stories.append(s)

    s = Story('H11', 611, 'Arabic statement drawn by ReportLab after shaping and visual reordering, Latin digits, '
              'a transfer commission on the statement only',
              producer='reportlab', font='DejaVu Sans (embedded TrueType)', paper='A4', layout='ar', digits='latin',
              period=('2026-08-01', '2026-08-31'), opening=18000000, rows_per_page=8,
              bank='مصرف الشرق', document_title='كشف حساب',
              account='SA55 1500 0000 9876 5432 1111')
    s.ordinary(10, 'L', chq_or_ft('2608L', 56000))
    s.move('cm', '2026-08-20', 'عمولة تحويل', '', withdrawal=2500)
    s.intent['bankOnly'].append('b:cm')
    stories.append(s)

    s = Story('H12', 612, 'single page; a deposit whose value date falls before the period',
              producer='reportlab', font='Helvetica', paper='A4',
              period=('2026-07-01', '2026-07-31'), opening=2100000, rows_per_page=12,
              bank='Eastgate Bank', document_title='Account Statement',
              account='SA55 1500 0000 9876 5432 1212')
    s.ordinary(6, 'M', chq_or_ft('2607M', 57100))
    s.move('v0', '2026-07-01', 'Incoming transfer', 'FT2607V0', deposit=4400000, value='2026-06-30')
    s.entry('v0', '2026-07-01', 'RV-V00', 'Receipt from customer', 'FT2607V0', receipt=4400000)
    s.intent['auto'].append(['b:v0', 'c:v0'])
    s.intent['timing'].append('b:v0')
    stories.append(s)
    return [s.facts() for s in stories]


def facts_json(stories=None):
    stories = build() if stories is None else stories
    line = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':'))  # noqa: E731
    out = []
    for s in stories:
        head = {k: v for k, v in s.items() if k not in ('recipe', 'intent', 'statement', 'cashbook')}
        st = s['statement']
        pages = ',\n'.join(
            '   {"number":%d,"of":%d,"lines":[\n%s\n   ]}' % (p['number'], p['of'], ',\n'.join('    ' + line(l) for l in p['lines']))
            for p in st['pages'])
        cash = ',\n'.join('    ' + line(e) for e in s['cashbook'])
        out.append('  {' + ','.join(f'{line(k)}:{line(v)}' for k, v in head.items()) + ',\n'
                   f'   "recipe":{line(s["recipe"])},\n   "intent":{line(s["intent"])},\n'
                   f'   "statement":{{"account":{line(st["account"])},"currency":"SAR","period":{line(st["period"])},"pages":[\n{pages}\n   ]}},\n'
                   f'   "cashbook":[\n{cash}\n   ]}}')
    return ('{"version":%s,"dateWindowDays":%d,"currency":"SAR","decimals":2,"stories":[\n%s\n]}\n'
            % (line(VERSION), WINDOW, ',\n'.join(out)))


if __name__ == '__main__':
    sys.stdout.write(facts_json())
