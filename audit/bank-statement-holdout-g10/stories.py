"""BNK-PDF-1 G10 holdout: new synthetic bank statements and cashbooks as facts.

A fifth generator lineage, written for G10. Nothing is imported from the
foundation's stories.mjs, from the G6, G8 or G9 holdouts' stories.py, from
any renderer or from the product. Each story is a trading company's account
over one period, driven by its invoices rather than by a daily draw: each
customer is invoiced on terms and pays around the due date, suppliers are
paid in a weekly payment run on Tuesday, card takings settle every calendar
day, payroll goes out by the 27th and GOSI by SADAD in mid-month. A PCG32
generator draws the amounts, terms and delays. The special events of a
story and its expected outcome are written by hand beside it.

The facts follow the foundation's contract (contract.json): one account in
SAR with two decimals, one period per statement, the same column headings,
control lines, account line and page footer. What changes is what the
contract leaves open: the writers (Apache FOP and OpenPDF), fonts, styles,
paper, periods, banks, accounts, reference styles, narratives, economic
relationships and faults.

Each story lists its statement page by page and line by line as printed.
`recipe` says how the pages were made and styled and which fault was
planted; `intent` is the designer's expected outcome. The independent oracle
reads neither. Amounts are minor units; balances are running balances.

  python3 -B audit/bank-statement-holdout-g10/stories.py > stories.json
"""
import json
import sys
from datetime import date, timedelta

VERSION = 'bank-statement-holdout-g10-1'
WINDOW = 3
MASK = (1 << 64) - 1
WEEKEND = {4, 5}  # Friday and Saturday
TUESDAY = 1


class PCG32:
    """PCG-XSH-RR 64/32 (O'Neill): the facts regenerate byte for byte on any
    Python."""

    def __init__(self, seed, stream=0x5B10):
        self.state, self.inc = 0, ((stream << 1) | 1) & MASK
        self.step()
        self.state = (self.state + seed) & MASK
        self.step()

    def step(self):
        self.state = (self.state * 6364136223846793005 + self.inc) & MASK

    def next(self):
        old = self.state
        self.step()
        xorshifted = (((old >> 18) ^ old) >> 27) & 0xFFFFFFFF
        rot = old >> 59
        return ((xorshifted >> rot) | (xorshifted << ((-rot) & 31))) & 0xFFFFFFFF

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


CUSTOMERS = {
    'en': ['Al Noor Trading Co.', 'Riyadh Medical Supplies', 'Eastern Province Contracting Est.',
           'Najran Agricultural Co.', 'Hijaz Hospitality Group', 'Tabuk Building Materials',
           'Qassim Dates Packing Factory', 'Red Sea Logistics Ltd.'],
    'ar': ['شركة النور التجارية', 'مستلزمات الرياض الطبية', 'مؤسسة المنطقة الشرقية للمقاولات',
           'شركة نجران الزراعية', 'مجموعة الحجاز للضيافة', 'مواد البناء بتبوك',
           'مصنع القصيم لتعبئة التمور', 'البحر الأحمر للخدمات اللوجستية'],
}
SUPPLIERS = {
    'en': ['Gulf Packaging Industries', 'Saudi Paper Mills', 'Jeddah Freight Forwarders',
           'Al Rashid Office Furniture', 'Arabian Fuel Distribution', 'Desert Line Printing'],
    'ar': ['صناعات الخليج للتغليف', 'مصانع الورق السعودية', 'وكلاء الشحن بجدة',
           'الراشد للأثاث المكتبي', 'توزيع الوقود العربي', 'مطابع خط الصحراء'],
}
WORDS = {
    'en': {
        'card': ('Card settlement - mada', 'Card takings'),
        'receipt': ('Inward SARIE - {}', 'Receipt from {}'),
        'payment': ('Outward SARIE - {}', 'Payment to {}'),
        'payroll': ('Payroll WPS transfer', 'Salaries'),
        'gosi': ('GOSI contribution SADAD', 'GOSI contribution'),
        'rent': ('Rent standing order', 'Warehouse rent'),
        'fee': 'Account maintenance fee',
        'vat': 'VAT on bank charges',
    },
    'ar': {
        'card': ('تسوية نقاط البيع - مدى', 'متحصلات البطاقات'),
        'receipt': ('حوالة سريعة واردة - {}', 'تحصيل من {}'),
        'payment': ('حوالة سريعة صادرة - {}', 'سداد إلى {}'),
        'payroll': ('تحويل رواتب حماية الأجور', 'الرواتب'),
        'gosi': ('اشتراكات التأمينات - سداد', 'اشتراكات التأمينات'),
        'rent': ('أمر دائم - إيجار', 'إيجار المستودع'),
        'fee': 'رسوم إدارة الحساب',
        'vat': 'ضريبة القيمة المضافة على الرسوم',
    },
}


class Ledger:
    def __init__(self, sid, seed, title, *, producer, font, paper, period, opening, per_page, bank,
                 document_title, account, layout='en', digits=None, page_totals=False, cashbook_xlsx=None,
                 style=None):
        self.rng = PCG32(seed)
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

    def movement(self, key, when, text, reference='', *, out=0, into=0, value=None):
        assert (out > 0) != (into > 0) and self.period['start'] <= when <= self.period['end']
        self.movements.append({'key': f'b:{key}', 'date': when, 'valueDate': value or when, 'description': text,
                               'reference': reference, 'withdrawal': out, 'deposit': into})

    def entry(self, key, when, text, reference='', *, receipt=0, payment=0):
        assert (receipt > 0) != (payment > 0)
        self.vouchers += 1
        voucher = f"{'CR' if receipt else 'CP'}{self.id[1:]}/{self.vouchers:03d}"
        self.entries.append({'key': f'c:{key}', 'date': when, 'voucher': voucher, 'description': text,
                             'reference': reference, 'receipt': receipt, 'payment': payment})

    def pair(self, key, bank_day, kind, reference, amount, *, booked=None, party=None, value=None):
        """One event on both sides under one reference, expected to match."""
        bank_text, cash_text = WORDS[self.layout][kind]
        if party:
            bank_text, cash_text = bank_text.format(party), cash_text.format(party)
        inflow = kind in ('card', 'receipt')
        self.movement(key, iso(bank_day), bank_text, reference, out=0 if inflow else amount,
                      into=amount if inflow else 0, value=value)
        self.entry(key, iso(booked or bank_day), cash_text, reference, receipt=amount if inflow else 0,
                   payment=0 if inflow else amount)
        self.intent['auto'].append([f'b:{key}', f'c:{key}'])

    def trade(self, *, customers, suppliers, card_rate, invoice_scale=(3000, 60000), supplier_scale=(1500, 24000),
              card_scale=(150, 9000), invoice_ref, run_ref, card_ref):
        """A month of the company's own business.

        Customers: up to three invoices each, issued on 30 or 45 days' terms
        before or during the period; each is paid on the next business day
        after its due date moved by -4..+9 days, if that day is in the
        period, and booked from the remittance advice 0..2 days later.
        Suppliers: a payment run each Tuesday pays one to three of them,
        booked on the run day. Cards: every calendar day with card_rate
        percent, booked the same day. Rent on the first business day, GOSI
        on the first business day from the 15th, payroll on the last
        business day by the 27th."""
        r, L = self.rng, self.layout
        start, end = day(self.period['start']), day(self.period['end'])
        n = 0
        for c in range(customers):
            name = CUSTOMERS[L][c % len(CUSTOMERS[L])]
            terms = 30 if r.below(2) else 45
            for _ in range(r.between(1, 3)):
                issued = start - timedelta(days=r.between(0, 60))
                paid = next_business(issued + timedelta(days=terms + r.between(-4, 9)))
                if not self.inside(paid):
                    continue
                n += 1
                booked = self.clamp(paid + timedelta(days=r.between(0, 2)))
                self.pair(f'I{n}', paid, 'receipt', invoice_ref(issued, n), r.money(*invoice_scale),
                          booked=booked, party=name)
        d = start
        while d <= end:
            if d.weekday() == TUESDAY and business(d):
                for _ in range(r.between(1, 3)):
                    n += 1
                    name = SUPPLIERS[L][r.below(suppliers)]
                    self.pair(f'P{n}', d, 'payment', run_ref(d, n), r.money(*supplier_scale), party=name)
            if r.below(100) < card_rate:
                n += 1
                self.pair(f'C{n}', d, 'card', card_ref(d, n), r.money(*card_scale))
            d += timedelta(days=1)
        month, m = start.replace(day=1), 0
        while month <= end:
            m += 1
            first = next_business(max(month, start))
            if self.inside(first):
                self.pair(f'R{m}', first, 'rent', f'SO-{first:%y%m}-RENT', r.between(9, 30) * 100000)
            gosi = next_business(month.replace(day=15))
            if self.inside(gosi):
                bill = f'{r.between(10 ** 4, 10 ** 5 - 1)}{r.between(0, 99999):05d}'
                self.pair(f'G{m}', gosi, 'gosi', f'SADAD-{bill}', r.money(4000, 22000))
            payday = previous_business(month.replace(day=27))
            if self.inside(payday):
                self.pair(f'W{m}', payday, 'payroll', f'WPS-{payday:%y%m}', r.between(40000, 260000) * 100)
            month = (month + timedelta(days=32)).replace(day=1)

    def fees(self):
        """A maintenance fee and VAT on it, charged by the bank on its last
        business day and not yet booked."""
        last = previous_business(day(self.period['end']))
        fee = self.rng.between(5, 30) * 1000
        self.movement('fee', iso(last), WORDS[self.layout]['fee'], out=fee)
        self.movement('vat', iso(last), WORDS[self.layout]['vat'], out=fee * 15 // 100)
        self.intent['bankOnly'] += ['b:fee', 'b:vat']

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
        if 'closingOff' in self.recipe:
            closing = next(line for line in pages[-1]['lines'] if line['kind'] == 'closing')
            closing['balance'] += self.recipe['closingOff']
        if 'duplicatePage' in self.recipe:
            at = self.recipe['duplicatePage']
            pages.insert(at, json.loads(json.dumps(pages[at - 1])))
        if self.recipe.get('missingFirstPage'):
            pages = pages[1:]
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
    ref_en = {'invoice_ref': lambda d, n: f'INV-{d:%y}-{n:04d}', 'run_ref': lambda d, n: f'PR{d:%m%d}-{n:03d}',
              'card_ref': lambda d, n: f'MD{d:%y%m%d}{n:02d}'}

    s = Ledger('P01', 1001, 'a full grid with tight cell padding and a filled heading; one remittance against three '
               'receipts under its reference, and a maintenance fee with VAT charged by the bank only',
               producer='fop', font='Open Sans', paper='A4', period=('2026-04-01', '2026-04-30'),
               opening=18450000, per_page=13, bank='Wadi Commercial Bank', document_title='Statement of Account',
               account='SA44 2000 0000 1717 0300 1001', style=styled(rules='grid', heading='filled', padding='tight'))
    s.trade(customers=6, suppliers=6, card_rate=45, **ref_en)
    s.movement('rm', '2026-04-21', 'Inward SARIE - Hijaz Hospitality Group', 'RMT-77310', into=4560000)
    for k, d in enumerate(['2026-04-21', '2026-04-21', '2026-04-22'], 1):
        s.entry(f'rm{k}', d, f'Receipt from Hijaz Hospitality Group, invoice {k} of 3', 'RMT-77310', receipt=1520000)
    s.intent['review'].append({'bank': ['b:rm'], 'cash': ['c:rm1', 'c:rm2', 'c:rm3'], 'reason': 'duplicate-reference'})
    s.fees()
    stories.append(s)

    s = Ledger('P02', 1002, 'Arabic statement in Almarai with Latin digits; a customer short-paying an invoice by a '
               'transfer charge under its reference, and a cheque deposited on the last day that the bank '
               'has not yet credited',
               producer='fop', font='Almarai', paper='A4', layout='ar', digits='latin',
               period=('2026-05-01', '2026-05-31'), opening=25000000, per_page=12, bank='مصرف الوادي التجاري',
               document_title='كشف حساب', account='SA44 2000 0000 1717 0300 1002',
               style=styled(rules='rows', heading='rule'))
    s.trade(customers=5, suppliers=5, card_rate=40, **ref_en)
    s.movement('sp', '2026-05-18', 'حوالة سريعة واردة - مجموعة الحجاز للضيافة', 'INV-26-0881', into=996250)
    s.entry('sp', '2026-05-18', 'تحصيل من مجموعة الحجاز للضيافة', 'INV-26-0881', receipt=1000000)
    s.intent['review'].append({'bank': ['b:sp'], 'cash': ['c:sp'], 'reason': 'amount-difference'})
    s.entry('dit', '2026-05-31', 'شيك مودع من شركة النور التجارية', 'CHQ-118204', receipt=2340000)
    s.intent['cashOnly'].append('c:dit')
    stories.append(s)

    s = Ledger('P03', 1003, 'Arabic statement in Markazi Text with Arabic-Indic digits and a full grid; the account '
               'falls overdrawn in the second half of the month; a refund paid to a customer booked as a receipt '
               'under its reference',
               producer='fop', font='Markazi Text', paper='A4', layout='ar', digits='arabic',
               period=('2026-06-01', '2026-06-30'), opening=7000000, per_page=11, bank='مصرف الوادي التجاري',
               document_title='كشف حساب جاري', account='SA44 2000 0000 1717 0300 1003',
               style=styled(rules='grid', heading='filled'))
    s.trade(customers=4, suppliers=6, card_rate=30, invoice_scale=(4000, 45000), **ref_en)
    s.movement('rf', '2026-06-11', 'رد مبلغ إلى عميل', 'RFD-0193', out=345000)
    s.entry('rf', '2026-06-11', 'رد مبلغ إلى شركة نجران الزراعية', 'RFD-0193', receipt=345000)
    s.intent['review'].append({'bank': ['b:rf'], 'cash': ['c:rf'], 'reason': 'direction-conflict'})
    stories.append(s)

    s = Ledger('P04', 1004, 'monospaced statement in Courier Prime on US Letter with page totals and long '
               'descriptions; overdrawn balances printed with DR; a reference written in lower case on the '
               'statement; cashbook also as typed XLSX from Apache POI with whole riyals and one decimal',
               producer='fop', font='Courier Prime', paper='Letter', period=('2026-07-01', '2026-07-31'),
               opening=-1260000, per_page=9, page_totals=True, bank='Wadi Commercial Bank',
               document_title='Statement of Account', account='SA44 2000 0000 1717 0300 1004', cashbook_xlsx='typed',
               style=styled(rules='none', heading='rule'))
    s.trade(customers=5, suppliers=6, card_rate=35, invoice_scale=(2000, 30000), **ref_en)
    s.movement('lc', '2026-07-15', 'Inward SARIE - Riyadh Medical Supplies against invoice inv-26-0517 and '
               'statement of June', 'inv-26-0517', into=2785525)
    s.entry('lc', '2026-07-16', 'Receipt from Riyadh Medical Supplies', 'INV-26-0517', receipt=2785525)
    s.intent['review'].append({'bank': ['b:lc'], 'cash': ['c:lc'], 'reason': 'amount-date-suggestion'})
    for k, (d, amount) in enumerate([('2026-07-08', 1400000), ('2026-07-20', 61250), ('2026-07-23', 90010)], 1):
        s.pair(f'w{k}', day(d), 'payment', f'PR{d[5:7]}{d[8:]}-W{k}', amount, party='Desert Line Printing')
    stories.append(s)

    s = Ledger('P05', 1005, 'page 2 of 3 printed twice', producer='fop', font='Helvetica', paper='A4',
               period=('2026-08-01', '2026-08-31'), opening=5300000, per_page=12, bank='Wadi Commercial Bank',
               document_title='Statement of Account', account='SA44 2000 0000 1717 0300 1005',
               style=styled(rules='rows', heading='rule'))
    s.trade(customers=5, suppliers=5, card_rate=40, **ref_en)
    s.recipe['duplicatePage'] = 2
    s.held('incomplete-pages')
    stories.append(s)

    s = Ledger('P06', 1006, 'a quarter on many pages in the standard Helvetica, not embedded; a description '
               'continuing at the top of page 6; a cheque presented five days after it was written; a value date '
               'after the period',
               producer='fop', font='Helvetica', paper='A4', period=('2026-01-01', '2026-03-31'),
               opening=46000000, per_page=14, bank='Wadi Commercial Bank', document_title='Statement of Account',
               account='SA44 2000 0000 1717 0300 1006', style=styled(rules='rows', heading='rule'))
    s.trade(customers=8, suppliers=6, card_rate=70, **ref_en)
    s.movement('cq', '2026-02-17', 'Cheque 000412 presented', 'CHQ-000412', out=1125000)
    s.entry('cq', '2026-02-12', 'Payment to Al Rashid Office Furniture by cheque', 'CHQ-000412', payment=1125000)
    s.intent['review'].append({'bank': ['b:cq'], 'cash': ['c:cq'], 'reason': 'date-gap'})
    s.pair('vt', day('2026-03-31'), 'receipt', 'INV-26-9001', 3300000, party='Red Sea Logistics Ltd.',
           value='2026-04-01')
    s.intent['timing'].append('b:vt')
    s.continuation = {'page': 6, 'text': '(continued) remittance RMT-55102, quarterly rebate'}
    stories.append(s)

    s = Ledger('P07', 1007, 'OpenPDF table in the standard Helvetica with a full grid; a reference with its leading '
               'zeros dropped in the cashbook; two equal card settlements on consecutive days against one '
               'cashbook entry',
               producer='openpdf', font='Helvetica', paper='A4', period=('2026-09-01', '2026-09-30'),
               opening=20000000, per_page=13, bank='Tihama Savings Bank', document_title='Account Statement',
               account='SA19 3000 0000 2121 0400 1007', style=styled(rules='grid', heading='filled'))
    s.trade(customers=6, suppliers=5, card_rate=40, **ref_en)
    s.movement('lz', '2026-09-15', 'Outward SARIE - Saudi Paper Mills', 'PAY-0042', out=1876040)
    s.entry('lz', '2026-09-15', 'Payment to Saudi Paper Mills', 'PAY-42', payment=1876040)
    s.intent['review'].append({'bank': ['b:lz'], 'cash': ['c:lz'], 'reason': 'amount-date-suggestion'})
    s.movement('eq1', '2026-09-24', 'Card settlement - mada', into=731500)
    s.movement('eq2', '2026-09-25', 'Card settlement - mada', into=731500)
    s.entry('eq', '2026-09-24', 'Card takings', receipt=731500)
    s.intent['review'].append({'bank': ['b:eq1', 'b:eq2'], 'cash': ['c:eq'], 'reason': 'ambiguous-amount-date'})
    stories.append(s)

    s = Ledger('P08', 1008, 'OpenPDF on A4 landscape in the standard Courier; overdrawn balances printed with DR; '
               'a deposit valued before the period; cashbook also as text XLSX from Apache POI',
               producer='openpdf', font='Courier', paper='A4-landscape', period=('2026-10-01', '2026-10-31'),
               opening=830000, per_page=16, bank='Tihama Savings Bank', document_title='Account Statement',
               account='SA19 3000 0000 2121 0400 1008', cashbook_xlsx='text',
               style=styled(rules='none', heading='rule'))
    s.trade(customers=4, suppliers=6, card_rate=35, invoice_scale=(2500, 26000), **ref_en)
    s.pair('v0', day('2026-10-01'), 'receipt', 'INV-26-7120', 1890000, party='Tabuk Building Materials',
           value='2026-09-30')
    s.intent['timing'].append('b:v0')
    stories.append(s)

    s = Ledger('P09', 1009, 'Arabic statement from OpenPDF in Amiri, Arabic shaped by its presentation forms, '
               'Latin digits; GOSI paid twice under one bill number against one entry; a maintenance fee with VAT '
               'charged by the bank only',
               producer='openpdf', font='Amiri', paper='A4', layout='ar', digits='latin',
               period=('2026-11-01', '2026-11-30'), opening=22000000, per_page=12, bank='مصرف تهامة للادخار',
               document_title='كشف حساب', account='SA19 3000 0000 2121 0400 1009',
               style=styled(rules='rows', heading='filled'))
    s.trade(customers=5, suppliers=5, card_rate=40, **ref_en)
    for k, d in enumerate(['2026-11-17', '2026-11-18'], 1):
        s.movement(f'gs{k}', d, 'اشتراكات التأمينات - سداد', 'SADAD-7300418852', out=1462500)
    s.entry('gs', '2026-11-17', 'اشتراكات التأمينات', 'SADAD-7300418852', payment=1462500)
    s.intent['review'].append({'bank': ['b:gs1', 'b:gs2'], 'cash': ['c:gs'], 'reason': 'duplicate-reference'})
    s.fees()
    stories.append(s)

    s = Ledger('P10', 1010, 'Arabic statement from OpenPDF in DejaVu Sans with Arabic-Indic digits and page '
               'totals; the account falls overdrawn, printed with DR; a cheque issued to a supplier not yet presented',
               producer='openpdf', font='DejaVu Sans', paper='A4', layout='ar', digits='arabic',
               period=('2026-12-01', '2026-12-31'), opening=20000000, per_page=10, page_totals=True,
               bank='مصرف تهامة للادخار', document_title='كشف حساب جاري', account='SA19 3000 0000 2121 0400 1010',
               style=styled(rules='grid', heading='rule'))
    s.trade(customers=4, suppliers=6, card_rate=30, invoice_scale=(2500, 30000), **ref_en)
    s.entry('oc', '2026-12-29', 'شيك صادر إلى مطابع خط الصحراء', 'CHQ-552301', payment=884000)
    s.intent['cashOnly'].append('c:oc')
    stories.append(s)

    s = Ledger('P11', 1011, 'the first page missing: the file starts at page 2 of 3',
               producer='openpdf', font='Open Sans', paper='A4', period=('2026-02-01', '2026-02-28'),
               opening=6600000, per_page=12, bank='Tihama Savings Bank', document_title='Account Statement',
               account='SA19 3000 0000 2121 0400 1011', style=styled(rules='rows', heading='rule'))
    s.trade(customers=5, suppliers=5, card_rate=40, **ref_en)
    s.recipe['missingFirstPage'] = True
    s.held('incomplete-pages')
    stories.append(s)

    s = Ledger('P12', 1012, 'the closing balance printed 100.00 below the running balance',
               producer='openpdf', font='Courier Prime', paper='Legal', period=('2026-03-01', '2026-03-31'),
               opening=15000000, per_page=18, bank='Tihama Savings Bank', document_title='Account Statement',
               account='SA19 3000 0000 2121 0400 1012', style=styled(rules='none', heading='rule'))
    s.trade(customers=6, suppliers=5, card_rate=40, **ref_en)
    s.recipe['closingOff'] = -10000
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
