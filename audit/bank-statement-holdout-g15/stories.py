"""BNK-PDF-1 G15 holdout: new synthetic bank statements and cashbooks as facts.

An eighth generator lineage, written for G15. Nothing is imported from the
foundation's stories.mjs, from the G6, G8, G9, G10, G12 or G14 holdouts'
stories.py, from any renderer or from the product. Each story is the
operating account of a polyclinic over one period: the reception closes its
mada card batch on Sunday and Wednesday evenings and the bank settles it the
next business day, booked from the settlement report that day; each insurer
pays the month's approved claims in one remittance, booked from its advice
one to three days later; the week's cash takings are deposited on Thursday;
the premises' rent goes by standing order on the first business day;
salaries go by a WPS batch by the 25th; the electricity bill is paid by SADAD
in mid-month; the outsourced laboratory is paid each month; and medical
suppliers are paid in a run each Wednesday. A JSF32 generator (Bob
Jenkins's small fast generator) draws the amounts and days. The special
events of a story and its expected outcome are written by hand beside it.

The facts follow the foundation's contract (contract.json): one account in
SAR with two decimals, one period per statement, the same column headings,
control lines, account line and page footer. What changes is what the
contract leaves open: the writers (Dompdf, the PHP library, and go-pdf/fpdf,
the Go library), fonts, styles, paper, periods, banks, accounts, reference
styles, narratives, economic relationships and faults.

Each story lists its statement page by page and line by line as printed.
`recipe` says how the pages were made and styled and which fault was
planted; `intent` is the designer's expected outcome. The independent oracle
reads neither. Amounts are minor units; balances are running balances.

  python3 -B audit/bank-statement-holdout-g15/stories.py > stories.json
"""
import json
import sys
from datetime import date, timedelta

VERSION = 'bank-statement-holdout-g15-1'
WINDOW = 3
WEEKEND = {4, 5}  # Friday and Saturday
SUNDAY, WEDNESDAY, THURSDAY = 6, 2, 3
M32 = (1 << 32) - 1


def rot(x, k):
    return ((x << k) | (x >> (32 - k))) & M32


class Jsf32:
    """Bob Jenkins's small fast generator, 32 bits, warmed by 20 rounds: the
    facts regenerate byte for byte on any Python."""

    def __init__(self, seed):
        self.a, self.b, self.c, self.d = 0xF1EA5EED, seed & M32, seed & M32, seed & M32
        for _ in range(20):
            self.next()

    def next(self):
        e = (self.a - rot(self.b, 27)) & M32
        self.a = self.b ^ rot(self.c, 17)
        self.b = (self.c + self.d) & M32
        self.c = (self.d + e) & M32
        self.d = (e + self.a) & M32
        return self.d

    def below(self, n):
        """Uniform in 0..n-1, without modulo bias; n fits in 32 bits."""
        assert 0 < n <= 1 << 32
        floor = (1 << 32) % n
        while True:
            r = self.next()
            if r >= floor:
                return r % n

    def between(self, lo, hi):
        return lo + self.below(hi - lo + 1)

    def money(self, lo, hi):
        """An amount in minor units between lo and hi riyals, with halalas."""
        return self.between(lo, hi) * 100 + self.below(100)


def day(s):
    return date.fromisoformat(s)


def iso(d):
    return d.isoformat()


def business(d):
    return d.weekday() not in WEEKEND


def next_business(d):
    while not business(d):
        d += timedelta(days=1)
    return d


def previous_business(d):
    while not business(d):
        d -= timedelta(days=1)
    return d


INSURERS = {
    'en': ['Najd Health Takaful', 'Gulf Shield Insurance', 'Sahara Care Cooperative', 'Red Sea Medical Cover'],
    'ar': ['نجد للتكافل الصحي', 'درع الخليج للتأمين', 'الصحراء للرعاية التعاونية', 'البحر الأحمر للتغطية الطبية'],
}
CODES = ['NHT', 'GSI', 'SCC', 'RSM']
SUPPLIERS = {
    'en': ['Medline Arabia', 'Al Dawaa Medical Supply', 'Sterile Path Co.', 'Riyadh Dental Depot', 'Lens & Optics Trading'],
    'ar': ['ميدلاين العربية', 'الدواء للمستلزمات الطبية', 'شركة المسار المعقم', 'مستودع الرياض لطب الأسنان',
           'العدسة والبصريات التجارية'],
}
WORDS = {
    'en': {
        'cards': ('mada POS settlement terminal {terminal}', 'Card takings {when} terminal {terminal}'),
        'claims': ('Inward SARIE - {insurer} claims {month}', 'Insurance claims {month} - {insurer}'),
        'cash': ('Cash deposit - branch counter', 'Cash takings week to {when}'),
        'rent': ('Standing order - premises rent', 'Premises rent {month}'),
        'payroll': ('WPS payroll {month}', 'Salaries and allowances {month}'),
        'power': ('SADAD - Saudi Electricity bill', 'Electricity {month}'),
        'lab': ('Outward SARIE - Central Reference Laboratory', 'Laboratory tests {month}'),
        'supplies': ('Outward SARIE - {supplier}', 'Medical supplies - {supplier}'),
    },
    'ar': {
        'cards': ('تسوية نقاط البيع مدى جهاز {terminal}', 'مقبوضات الشبكة {when} جهاز {terminal}'),
        'claims': ('حوالة سريعة واردة - {insurer} مطالبات {month}', 'مطالبات التأمين {month} - {insurer}'),
        'cash': ('إيداع نقدي - صراف الفرع', 'مقبوضات نقدية أسبوع {when}'),
        'rent': ('أمر مستديم - إيجار المبنى', 'إيجار المبنى {month}'),
        'payroll': ('رواتب حماية الأجور {month}', 'الرواتب والبدلات {month}'),
        'power': ('سداد - فاتورة الكهرباء', 'الكهرباء {month}'),
        'lab': ('حوالة سريعة صادرة - المختبر المرجعي المركزي', 'تحاليل المختبر {month}'),
        'supplies': ('حوالة سريعة صادرة - {supplier}', 'مستلزمات طبية - {supplier}'),
    },
}
INFLOW = {'cards', 'claims', 'cash'}
MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر',
             'ديسمبر']


class Ledger:
    def __init__(self, sid, seed, title, *, producer, font, paper, period, opening, per_page, bank,
                 document_title, account, layout='en', digits=None, page_totals=False, cashbook_xlsx=None,
                 style=None):
        self.rng = Jsf32(seed)
        self.id, self.title, self.layout, self.digits = sid, title, layout, digits
        self.producer, self.font, self.paper = producer, font, paper
        self.period = {'start': period[0], 'end': period[1]}
        self.opening, self.per_page, self.page_totals = opening, per_page, page_totals
        self.bank_name, self.document_title, self.account = bank, document_title, account
        self.cashbook_xlsx = cashbook_xlsx
        self.movements, self.entries = [], []
        self.recipe = {'opening': opening, 'rowsPerPage': per_page, 'style': style or {}}
        self.continuation = None
        self.vouchers = 0
        self.intent = {'statement': 'verified', 'auto': [], 'review': [], 'bankOnly': [], 'cashOnly': [], 'timing': []}

    def inside(self, d):
        return self.period['start'] <= iso(d) <= self.period['end']

    def clamp(self, d):
        return min(max(d, day(self.period['start'])), day(self.period['end']))

    def month_label(self, d):
        return f'{d:%Y-%m}' if self.layout == 'en' else f'{MONTHS_AR[d.month - 1]} {d.year}'

    def movement(self, key, when, text, reference='', *, out=0, into=0, value=None):
        assert (out > 0) != (into > 0) and self.period['start'] <= when <= self.period['end']
        self.movements.append({'key': f'b:{key}', 'date': when, 'valueDate': value or when, 'description': text,
                               'reference': reference, 'withdrawal': out, 'deposit': into})

    def entry(self, key, when, text, reference='', *, receipt=0, payment=0):
        assert (receipt > 0) != (payment > 0)
        self.vouchers += 1
        voucher = f"{'RV' if receipt else 'PV'}-{self.id}-{self.vouchers:03d}"
        self.entries.append({'key': f'c:{key}', 'date': when, 'voucher': voucher, 'description': text,
                             'reference': reference, 'receipt': receipt, 'payment': payment})

    def pair(self, key, bank_day, kind, reference, amount, *, booked=None, value=None, **names):
        """One event on both sides under one reference, expected to match."""
        bank_text, cash_text = (w.format(**names) for w in WORDS[self.layout][kind])
        inflow = kind in INFLOW
        self.movement(key, iso(bank_day), bank_text, reference, out=0 if inflow else amount,
                      into=amount if inflow else 0, value=value)
        self.entry(key, iso(booked or bank_day), cash_text, reference, receipt=amount if inflow else 0,
                   payment=0 if inflow else amount)
        self.intent['auto'].append([f'b:{key}', f'c:{key}'])

    def clinic(self, *, insurers, staff, suppliers, terminal, card_scale=(9000, 26000),
               claim_scale=(40000, 160000), cash_scale=(3000, 11000), salary_scale=(7000, 19000),
               supply_scale=(1200, 38000), rent=None, lab=True, power=True):
        """The polyclinic's own period.

        Cards: the batch closed on Sunday and Wednesday evenings is settled
        the next business day under the batch date, booked that day.
        Claims: each insurer pays a month's claims once, on a business day
        from the 6th to the 22nd, booked from its remittance advice one to
        three days later.
        Cash: the week's takings deposited on Thursday, booked that day.
        Rent: by standing order on the first business day of the month.
        Payroll: one WPS batch on the last business day by the 25th.
        Power: SADAD on a business day from the 12th to the 16th.
        Laboratory: paid on the 10th or the next business day.
        Supplies: a run of one or two payments each Wednesday."""
        r, L = self.rng, self.layout
        start, end = day(self.period['start']), day(self.period['end'])
        n = 0
        d = start
        while d <= end:
            if d.weekday() in (SUNDAY, WEDNESDAY):
                settled = next_business(d + timedelta(days=1))
                if self.inside(settled):
                    n += 1
                    self.pair(f'K{n}', settled, 'cards', f'MADA-{terminal}-{d:%y%m%d}', r.money(*card_scale),
                              terminal=terminal, when=iso(d))
            if d.weekday() == THURSDAY:
                n += 1
                self.pair(f'C{n}', d, 'cash', f'DS-{d:%y%m%d}-{r.between(10, 99)}', r.money(*cash_scale),
                          when=iso(d))
            if d.weekday() == WEDNESDAY:
                for _ in range(r.between(1, 2)):
                    n += 1
                    supplier = SUPPLIERS[L][r.below(suppliers)]
                    self.pair(f'S{n}', d, 'supplies', f'PO-{d:%y%m%d}-{n:03d}', r.money(*supply_scale),
                              supplier=supplier)
            d += timedelta(days=1)
        month = start.replace(day=1)
        while month <= end:
            label = self.month_label(month)
            if rent:
                paid = next_business(month)
                if self.inside(paid):
                    n += 1
                    self.pair(f'R{n}', paid, 'rent', f'SO-RENT-{month:%y%m}', rent, month=label)
            for i in range(insurers):
                paid = next_business(month + timedelta(days=r.between(5, 21)))
                booked = paid + timedelta(days=r.between(1, 3))
                if self.inside(paid) and self.inside(booked):
                    n += 1
                    self.pair(f'I{n}', paid, 'claims', f'CLM-{CODES[i]}-{month:%y%m}', r.money(*claim_scale),
                              booked=booked, insurer=INSURERS[L][i], month=label)
            pay = previous_business(month.replace(day=25))
            if self.inside(pay):
                n += 1
                self.pair(f'W{n}', pay, 'payroll', f'WPS-{pay:%y%m}',
                          sum(r.money(*salary_scale) for _ in range(staff)), month=label)
            if power:
                paid = next_business(month + timedelta(days=r.between(11, 15)))
                if self.inside(paid):
                    n += 1
                    self.pair(f'E{n}', paid, 'power', f'SADAD-{r.between(10 ** 4, 10 ** 5 - 1)}{r.below(10 ** 5):05d}',
                              r.money(2400, 9800), month=label)
            if lab:
                paid = next_business(month + timedelta(days=9))
                if self.inside(paid):
                    n += 1
                    self.pair(f'L{n}', paid, 'lab', f'LAB-{month:%y%m}', r.money(14000, 52000), month=label)
            month = (month + timedelta(days=32)).replace(day=1)

    def held(self, status):
        self.intent = {'statement': status, 'auto': [], 'review': [], 'bankOnly': [], 'cashOnly': [], 'timing': []}

    def facts(self):
        bank = sorted(self.movements, key=lambda m: m['date'])
        cash = sorted(self.entries, key=lambda e: e['date'])
        balance, rows = self.opening, []
        for m in bank:
            balance += m['deposit'] - m['withdrawal']
            rows.append({'kind': 'movement', **m, 'balance': balance})
        chunks = [rows[a:a + self.per_page] for a in range(0, len(rows), self.per_page)]
        pages, running = [], self.opening
        for n, chunk in enumerate(chunks, 1):
            lines = [{'kind': 'opening', 'balance': self.opening} if n == 1
                     else {'kind': 'brought-forward', 'balance': running}]
            if self.continuation and self.continuation['page'] == n:
                lines.append({'kind': 'continuation', 'text': self.continuation['text']})
            lines += chunk
            running = chunk[-1]['balance']
            if self.page_totals:
                lines.append({'kind': 'page-totals', 'withdrawal': sum(m['withdrawal'] for m in chunk),
                              'deposit': sum(m['deposit'] for m in chunk)})
            if n < len(chunks):
                lines.append({'kind': 'carried-forward', 'balance': running})
            else:
                lines.append({'kind': 'closing', 'balance': running})
                lines.append({'kind': 'totals', 'withdrawal': sum(m['withdrawal'] for m in rows),
                              'deposit': sum(m['deposit'] for m in rows)})
            pages.append({'number': n, 'of': len(chunks), 'lines': lines})
        # Planted faults: the printed pages, as the fault leaves them.
        if 'printedTwice' in self.recipe:
            # A movement row printed again under itself; the balances that
            # follow are the bank's ledger, counting it once.
            page, index = self.recipe['printedTwice']
            lines = pages[page - 1]['lines']
            at = [i for i, l in enumerate(lines) if l['kind'] == 'movement'][index]
            twin = dict(lines[at], key=lines[at]['key'] + ':again')
            lines.insert(at + 1, twin)
        if 'depositAsWithdrawal' in self.recipe:
            # A deposit printed in the withdrawal column; the balances are
            # the bank's ledger, which credited it.
            page, index = self.recipe['depositAsWithdrawal']
            line = [l for l in pages[page - 1]['lines'] if l['kind'] == 'movement' and l['deposit']][index]
            line['withdrawal'], line['deposit'] = line['deposit'], 0
        if 'numberedAsPrevious' in self.recipe:
            # A page printed under the number of the page before it.
            pages[self.recipe['numberedAsPrevious'] - 1]['number'] -= 1
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

    s = Ledger('T01', 4001, 'Dompdf statement from an HTML table in Source Sans 3, embedded with its identity '
               'ToUnicode map, a full grid and a heading filled blue in white; an insurer\'s remittance booked '
               'five days after it arrived; a supplier refund credited by the bank and not yet booked; a '
               'cheque to a supplier not yet presented',
               producer='dompdf', font='Source Sans 3', paper='A4', period=('2027-01-01', '2027-01-31'),
               opening=52400000, per_page=15, bank='Arabian Care Bank', document_title='Statement of Account',
               account='SA62 8800 0000 1515 0100 4001', style=styled(rules='grid', heading='filled'))
    s.clinic(insurers=3, staff=24, suppliers=5, terminal='2207', rent=11500000)
    s.movement('ig', '2027-01-20', 'Inward SARIE - Red Sea Medical Cover claims 2026-12', 'CLM-RSM-2612',
               into=9840550)
    s.entry('ig', '2027-01-25', 'Insurance claims 2026-12 - Red Sea Medical Cover', 'CLM-RSM-2612',
            receipt=9840550)
    s.intent['review'].append({'bank': ['b:ig'], 'cash': ['c:ig'], 'reason': 'date-gap'})
    s.movement('sr', '2027-01-27', 'Inward SARIE - Sterile Path Co. credit note refund', 'CN-SP-27011',
               into=412500)
    s.intent['bankOnly'].append('b:sr')
    s.entry('oc', '2027-01-29', 'Medical supplies - Riyadh Dental Depot by cheque', 'CHQ-118204', payment=1876000)
    s.intent['cashOnly'].append('c:oc')
    stories.append(s)

    s = Ledger('T02', 4002, 'Dompdf statement in PT Serif with rules under every row and page totals; an '
               'insurer\'s remittance short of the advice by a bank charge; two cash deposits of the same '
               'amount on one Thursday against two equal entries; a supplier payment without its reference on '
               'the statement; a supplier cheque not yet presented',
               producer='dompdf', font='PT Serif', paper='A4', period=('2027-02-01', '2027-02-28'),
               opening=38750000, per_page=13, page_totals=True, bank='Arabian Care Bank',
               document_title='Account Statement', account='SA62 8800 0000 1515 0100 4002',
               style=styled(rules='rows', heading='rule'))
    s.clinic(insurers=3, staff=20, suppliers=5, terminal='3318', rent=9800000)
    s.movement('sh', '2027-02-17', 'Inward SARIE - Gulf Shield Insurance claims 2027-01 net', 'CLM-GSI-2701N',
               into=6342150)
    s.entry('sh', '2027-02-18', 'Insurance claims 2027-01 - Gulf Shield Insurance', 'CLM-GSI-2701N',
            receipt=6347900)
    s.intent['review'].append({'bank': ['b:sh'], 'cash': ['c:sh'], 'reason': 'amount-difference'})
    for k in (1, 2):
        s.movement(f'cd{k}', '2027-02-11', 'Cash deposit - night safe', into=250000)
        s.entry(f'cd{k}', '2027-02-11', f'Pharmacy counter takings, bag {k}', receipt=250000)
    s.intent['review'].append({'bank': ['b:cd1', 'b:cd2'], 'cash': ['c:cd1', 'c:cd2'],
                               'reason': 'ambiguous-amount-date'})
    s.movement('nr', '2027-02-23', 'Outward SARIE - Lens & Optics Trading', out=2715400)
    s.entry('nr', '2027-02-24', 'Medical supplies - Lens & Optics Trading', 'PO-270223-LO', payment=2715400)
    s.intent['review'].append({'bank': ['b:nr'], 'cash': ['c:nr'], 'reason': 'amount-date-suggestion'})
    s.entry('oc', '2027-02-26', 'Medical supplies - Al Dawaa Medical Supply by cheque', 'CHQ-118377', payment=1140000)
    s.intent['cashOnly'].append('c:oc')
    stories.append(s)

    s = Ledger('T03', 4003, 'monospaced Dompdf statement in Space Mono on US Letter with no rules and a heading '
               'rule, headings left-aligned over right-aligned amounts; overdrawn the whole month, the DR written after each amount; a patient\'s refund booked as '
               'a receipt; the laboratory paid twice under one reference against one entry; cashbook also as '
               'typed XLSX from excelize',
               producer='dompdf', font='Space Mono', paper='Letter', period=('2027-03-01', '2027-03-31'),
               opening=-42000000, per_page=14, bank='Arabian Care Bank', document_title='Statement of Account',
               account='SA62 8800 0000 1515 0100 4003', cashbook_xlsx='typed',
               style=styled(rules='none', heading='rule', headings='left'))
    s.clinic(insurers=4, staff=22, suppliers=5, terminal='4429', lab=False)
    s.movement('pr', '2027-03-15', 'Outward SARIE - patient refund file 77310', 'RFD-77310', out=184000)
    s.entry('pr', '2027-03-15', 'Refund to patient file 77310', 'RFD-77310', receipt=184000)
    s.intent['review'].append({'bank': ['b:pr'], 'cash': ['c:pr'], 'reason': 'direction-conflict'})
    for k, d in enumerate(['2027-03-10', '2027-03-11'], 1):
        s.movement(f'lb{k}', d, 'Outward SARIE - Central Reference Laboratory', 'LAB-2703', out=3366720)
    s.entry('lb', '2027-03-10', 'Laboratory tests 2027-03', 'LAB-2703', payment=3366720)
    s.intent['review'].append({'bank': ['b:lb1', 'b:lb2'], 'cash': ['c:lb'], 'reason': 'duplicate-reference'})
    stories.append(s)

    s = Ledger('T04', 4004, 'a quarter on many pages from Dompdf in IBM Plex Sans on A4 landscape, striped rows '
               'and long descriptions wrapped in their cells; an insurer\'s remittance valued after the period; '
               'the bank\'s quarterly account fee; electricity valued before the period',
               producer='dompdf', font='IBM Plex Sans', paper='A4-landscape', period=('2027-04-01', '2027-06-30'),
               opening=64000000, per_page=14, bank='Arabian Care Bank', document_title='Statement of Account',
               account='SA62 8800 0000 1515 0100 4004', style=styled(rules='stripes', heading='filled'))
    s.clinic(insurers=2, staff=16, suppliers=5, terminal='5530', rent=8700000, lab=False)
    s.pair('va', day('2027-06-30'), 'claims', 'CLM-SCC-2705B', 7211040, booked=day('2027-06-30'),
           value='2027-07-01', insurer='Sahara Care Cooperative', month='2027-05 resubmitted batch')
    s.intent['timing'].append('b:va')
    s.pair('vb', day('2027-04-01'), 'power', 'SADAD-6604217739', 512870, value='2027-03-31', month='2027-03')
    s.intent['timing'].append('b:vb')
    s.movement('fee', '2027-06-30', 'Quarterly account maintenance fee', out=34500)
    s.intent['bankOnly'].append('b:fee')
    stories.append(s)

    s = Ledger('T05', 4005, 'a card settlement printed twice on page 2, one row under the other, the balances '
               'counting it once',
               producer='dompdf', font='Source Sans 3', paper='A4', period=('2027-05-01', '2027-05-31'),
               opening=29500000, per_page=12, bank='Arabian Care Bank', document_title='Statement of Account',
               account='SA62 8800 0000 1515 0100 4005', style=styled(rules='grid', heading='filled'))
    s.clinic(insurers=3, staff=18, suppliers=5, terminal='6641', rent=7600000)
    s.recipe['printedTwice'] = [2, 4]
    s.held('balance-broken')
    stories.append(s)

    s = Ledger('T06', 4006, 'page 3 printed under the number of page 2: pages 1, 2 and 2 of 3',
               producer='dompdf', font='PT Serif', paper='A4', period=('2027-07-01', '2027-07-31'),
               opening=33300000, per_page=10, bank='Arabian Care Bank', document_title='Account Statement',
               account='SA62 8800 0000 1515 0100 4006', style=styled(rules='rows', heading='rule'))
    s.clinic(insurers=3, staff=19, suppliers=5, terminal='7752', rent=7600000)
    s.recipe['numberedAsPrevious'] = 3
    s.held('incomplete-pages')
    stories.append(s)

    s = Ledger('T07', 4007, 'Arabic go-pdf/fpdf statement in Noto Sans Arabic with Arabic-Indic digits, shaped '
               'into presentation forms by the application and ordered by golang.org/x/text/unicode/bidi, each '
               'run of one direction drawn on its own from the right edge of its cell, so that a date prints as '
               'five runs; a full grid; the pharmacy terminal\'s card batch settled four days after it closed '
               'across a weekend; a supplier paid twice on one day against two entries without references; the '
               'bank\'s monthly terminal fee, not yet booked',
               producer='gofpdf', font='Noto Sans Arabic', paper='A4', layout='ar', digits='arabic',
               period=('2027-08-01', '2027-08-31'), opening=41000000, per_page=12, bank='مصرف الرعاية العربي',
               document_title='كشف حساب', account='SA62 8800 0000 1515 0100 4007',
               style=styled(rules='grid', heading='grey', bidi='runs'))
    s.clinic(insurers=3, staff=20, suppliers=5, terminal='8863', rent=8200000)
    s.movement('kg', '2027-08-12', 'تسوية نقاط البيع مدى جهاز الصيدلية 8864', 'MADA-8864-270808', into=1873420)
    s.entry('kg', '2027-08-08', 'مقبوضات الشبكة 2027-08-08 جهاز الصيدلية 8864', 'MADA-8864-270808', receipt=1873420)
    s.intent['review'].append({'bank': ['b:kg'], 'cash': ['c:kg'], 'reason': 'date-gap'})
    for k in (1, 2):
        s.movement(f'sp{k}', '2027-08-24', 'حوالة سريعة صادرة - ميدلاين العربية', out=962300)
        s.entry(f'sp{k}', '2027-08-24', f'مستلزمات طبية - ميدلاين العربية فاتورة {k}', payment=962300)
    s.intent['review'].append({'bank': ['b:sp1', 'b:sp2'], 'cash': ['c:sp1', 'c:sp2'],
                               'reason': 'ambiguous-amount-date'})
    s.movement('pf', '2027-08-31', 'رسوم خدمة أجهزة نقاط البيع', out=23000)
    s.intent['bankOnly'].append('b:pf')
    stories.append(s)

    s = Ledger('T08', 4008, 'Arabic go-pdf/fpdf statement in Vazirmatn with Arabic-Indic digits, each run of '
               'one direction drawn on its own from the right; rules under every row; a description continuing '
               'at the top of page 2; an insurer\'s remittance valued after the period; a returned patient '
               'cheque with the bank\'s fee, not yet booked',
               producer='gofpdf', font='Vazirmatn', paper='A4', layout='ar', digits='arabic',
               period=('2027-09-01', '2027-09-30'), opening=36600000, per_page=12, bank='مصرف الرعاية العربي',
               document_title='كشف حساب جاري', account='SA62 8800 0000 1515 0100 4008',
               style=styled(rules='rows', heading='filled', bidi='runs'))
    s.clinic(insurers=3, staff=18, suppliers=5, terminal='9974', rent=8200000)
    s.continuation = {'page': 2, 'text': 'تابع: مطالبات أغسطس بعد المراجعة الطبية'}
    s.pair('va', day('2027-09-30'), 'claims', 'CLM-NHT-2708B', 5530210, booked=day('2027-09-30'),
           value='2027-10-01', insurer='نجد للتكافل الصحي', month='أغسطس 2027')
    s.intent['timing'].append('b:va')
    s.movement('rr', '2027-09-19', 'شيك مرتجع - توقيع غير مطابق', 'CHQ-440917-R', out=265000)
    s.movement('rx', '2027-09-19', 'رسوم الشيك المرتجع', out=5750)
    s.intent['bankOnly'] += ['b:rr', 'b:rx']
    stories.append(s)

    s = Ledger('T09', 4009, 'Arabic go-pdf/fpdf statement in El Messiri with Latin digits, each line ordered by '
               'golang.org/x/text/unicode/bidi and drawn whole, right-aligned in its cell; a heading filled '
               'dark teal in white; a patient\'s refund booked twice in the cashbook under its reference; '
               'electricity valued before the period',
               producer='gofpdf', font='El Messiri', paper='A4', layout='ar', digits='latin',
               period=('2027-10-01', '2027-10-31'), opening=31200000, per_page=13, bank='مصرف الرعاية العربي',
               document_title='كشف حساب', account='SA62 8800 0000 1515 0100 4009',
               style=styled(rules='rows', heading='filled', bidi='whole'))
    s.clinic(insurers=3, staff=17, suppliers=5, terminal='1085', rent=8200000, power=False)
    s.movement('ov', '2027-10-18', 'حوالة سريعة صادرة - استرداد مريض ملف 80412', 'RFD-80412', out=226000)
    for k, d in enumerate(['2027-10-18', '2027-10-19'], 1):
        s.entry(f'ov{k}', d, 'رد مبلغ للمريض ملف 80412', 'RFD-80412', payment=226000)
    s.intent['review'].append({'bank': ['b:ov'], 'cash': ['c:ov1', 'c:ov2'], 'reason': 'duplicate-reference'})
    s.pair('vb', day('2027-10-03'), 'power', 'SADAD-7718302264', 688410, value='2027-09-30', month='سبتمبر 2027')
    s.intent['timing'].append('b:vb')
    stories.append(s)

    s = Ledger('T10', 4010, 'English go-pdf/fpdf statement in Barlow on A4 landscape with striped rows and a '
               'heading filled maroon in white, cells drawn by CellFormat; a card batch credited net of a '
               'chargeback; a supplier credit note refund not yet booked; cashbook also as text XLSX from '
               'excelize',
               producer='gofpdf', font='Barlow', paper='A4-landscape', period=('2027-11-01', '2027-11-30'),
               opening=27900000, per_page=12, bank='Najd Commercial Bank', document_title='Statement of Account',
               account='SA05 3300 0000 9191 4400 4010', cashbook_xlsx='text',
               style=styled(rules='stripes', heading='filled'))
    s.clinic(insurers=3, staff=21, suppliers=5, terminal='2196', rent=9300000)
    s.movement('cb', '2027-11-23', 'mada POS settlement terminal 2196 less chargeback', 'MADA-2196-271122',
               into=1514800)
    s.entry('cb', '2027-11-23', 'Card takings 2027-11-22 terminal 2196', 'MADA-2196-271122', receipt=1559800)
    s.intent['review'].append({'bank': ['b:cb'], 'cash': ['c:cb'], 'reason': 'amount-difference'})
    s.movement('cn', '2027-11-28', 'Inward SARIE - Medline Arabia credit note', 'CN-ML-2711', into=318250)
    s.intent['bankOnly'].append('b:cn')
    stories.append(s)

    s = Ledger('T11', 4011, 'monospaced go-pdf/fpdf statement in Red Hat Mono with a heading rule and no other '
               'rules; an insurer\'s remittance without its reference on the statement, booked two days later; '
               'a cash deposit booked as a payment; overdraft never reached',
               producer='gofpdf', font='Red Hat Mono', paper='A4', period=('2027-12-01', '2027-12-31'),
               opening=45500000, per_page=14, bank='Najd Commercial Bank', document_title='Account Statement',
               account='SA05 3300 0000 9191 4400 4011', style=styled(rules='none', heading='rule'))
    s.clinic(insurers=3, staff=23, suppliers=5, terminal='3207', rent=9300000)
    s.movement('nr', '2027-12-14', 'Inward SARIE - Najd Health Takaful', into=8840275)
    s.entry('nr', '2027-12-16', 'Insurance claims 2027-11 - Najd Health Takaful', 'CLM-NHT-2711X', receipt=8840275)
    s.intent['review'].append({'bank': ['b:nr'], 'cash': ['c:nr'], 'reason': 'amount-date-suggestion'})
    s.movement('dp', '2027-12-20', 'Cash deposit - branch counter', 'DS-271220-77', into=436000)
    s.entry('dp', '2027-12-20', 'Cash takings week to 2027-12-20', 'DS-271220-77', payment=436000)
    s.intent['review'].append({'bank': ['b:dp'], 'cash': ['c:dp'], 'reason': 'direction-conflict'})
    stories.append(s)

    s = Ledger('T12', 4012, 'an insurer\'s remittance printed in the withdrawal column on page 2, the balances as '
               'the bank\'s ledger credited it',
               producer='gofpdf', font='Noto Sans Arabic', paper='A4', layout='ar', digits='arabic',
               period=('2027-06-01', '2027-06-30'), opening=30800000, per_page=11, bank='مصرف الرعاية العربي',
               document_title='كشف حساب', account='SA62 8800 0000 1515 0100 4012',
               style=styled(rules='grid', heading='grey', bidi='runs'))
    s.clinic(insurers=3, staff=18, suppliers=5, terminal='4318', rent=8200000)
    s.recipe['depositAsWithdrawal'] = [2, 1]
    s.held('balance-broken')
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
