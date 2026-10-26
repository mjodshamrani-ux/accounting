"""BNK-PDF-1 G20 holdout: new synthetic bank statements and cashbooks as facts.

A tenth generator lineage, written for G20. Nothing is imported from the
foundation's stories.mjs, from the G6 to G17 holdouts' stories.py, from any
renderer or from the product. Each story is the operating account of an
online home-goods retailer over one period: the card acquirers settle the
day's card sales each business day, each settlement booked from the
acquirer's report that day or the next business day; the couriers remit
the cash they collected on delivery each Tuesday, booked from their
remittance sheet up to two business days later; two marketplaces pay out
twice a month; suppliers are paid by outward SARIE each Wednesday; customers
are refunded for returned orders by transfer; the couriers' prepaid shipping
accounts are topped up each Sunday; the warehouse rent goes by standing
order on the first business day; salaries go by a WPS batch by the 25th;
GOSI contributions are paid by SADAD in mid-month; and the quarter's VAT is
paid by SADAD in the month after it. A PCG32 generator (XSH RR, O'Neill)
draws the amounts and days. The special events of a story and its expected
outcome are written by hand beside it.

The facts follow the foundation's contract (contract.json): one account in
SAR with two decimals, one period per statement, the same column headings,
control lines, account line and page footer. What changes is what the
contract leaves open: the writers (iText Core, the Java library, and a Node
statement application drawing with PDFKit), fonts, styles, paper, periods,
banks, accounts, reference styles, narratives, economic relationships and
faults.

Each story lists its statement page by page and line by line as printed.
`recipe` says how the pages were made and styled and which fault was
planted; `intent` is the designer's expected outcome. The independent oracle
reads neither. Amounts are minor units; balances are running balances.

  python3 -B audit/bank-statement-holdout-g20/stories.py > stories.json
"""
import json
import sys
from datetime import date, timedelta

VERSION = 'bank-statement-holdout-g20-1'
WINDOW = 3
WEEKEND = {4, 5}  # Friday and Saturday
SUNDAY, TUESDAY, WEDNESDAY = 6, 1, 2
M64 = (1 << 64) - 1
M32 = (1 << 32) - 1


class Pcg32:
    """PCG32 (O'Neill), XSH RR output from a 64-bit linear congruential
    state, seeded as pcg32_srandom_r: the facts regenerate byte for byte on
    any Python."""

    MULTIPLIER = 6364136223846793005

    def __init__(self, seed, stream=54):
        self.state, self.inc = 0, ((stream << 1) | 1) & M64
        self.next()
        self.state = (self.state + seed) & M64
        self.next()

    def next(self):
        old = self.state
        self.state = (old * self.MULTIPLIER + self.inc) & M64
        xorshifted = (((old >> 18) ^ old) >> 27) & M32
        rot = old >> 59
        return ((xorshifted >> rot) | (xorshifted << ((-rot) & 31))) & M32

    def below(self, n):
        """Uniform in 0..n-1 without modulo bias (pcg32_boundedrand_r)."""
        assert 0 < n <= 1 << 32
        threshold = ((1 << 32) - n) % n
        while True:
            r = self.next()
            if r >= threshold:
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


ACQUIRERS = {'en': ['Najd Payments', 'Wadi Pay'], 'ar': ['نجد للمدفوعات', 'وادي باي']}
ACQUIRER_CODES = ['NJD', 'WDP']
COURIERS = {'en': ['Rimal Express', 'Sahm Logistics', 'Qafila Couriers'],
            'ar': ['رمال إكسبرس', 'سهم اللوجستية', 'قافلة للتوصيل']}
COURIER_CODES = ['RML', 'SHM', 'QFL']
MARKETS = {'en': ['Souq Al Waha', 'Dukkan Mall'], 'ar': ['سوق الواحة', 'دكان مول']}
MARKET_CODES = ['WAH', 'DKN']
SUPPLIERS = {
    'en': ['Hejaz Home Textiles', 'Al Noor Kitchenware', 'Eastern Packaging Co.', 'Tihama Furniture Works',
           'Gulf Lighting Trading'],
    'ar': ['الحجاز للمنسوجات المنزلية', 'النور لأدوات المطبخ', 'الشرقية للتغليف', 'تهامة لصناعة الأثاث',
           'الخليج لتجارة الإنارة'],
}
WORDS = {
    'en': {
        'card': ('Card settlement - {acquirer} batch {batch}', 'Card sales {when} - {acquirer} net'),
        'cod': ('COD remittance - {courier}', 'Cash on delivery collected by {courier} week {week}'),
        'market': ('Marketplace payout - {market}', 'Marketplace sales payout {market} {when}'),
        'supplier': ('Outward SARIE - {supplier}', 'Purchases - {supplier}'),
        'refund': ('Outward transfer - customer refund order {order}', 'Refund order {order} returned goods'),
        'shipping': ('Outward transfer - {courier} shipping account top-up', 'Prepaid shipping labels {courier} {when}'),
        'rent': ('Standing order - warehouse rent', 'Warehouse rent {month}'),
        'payroll': ('WPS payroll {month}', 'Salaries {month}'),
        'gosi': ('SADAD - GOSI contributions', 'GOSI contributions {month}'),
        'vat': ('SADAD - ZATCA VAT return', 'VAT payable quarter {quarter}'),
    },
    'ar': {
        'card': ('تسوية بطاقات - {acquirer} دفعة {batch}', 'مبيعات البطاقات {when} - {acquirer} صافي'),
        'cod': ('تحويل الدفع عند الاستلام - {courier}', 'تحصيل الدفع عند الاستلام {courier} أسبوع {week}'),
        'market': ('دفعة السوق الإلكتروني - {market}', 'مستحقات السوق الإلكتروني {market} {when}'),
        'supplier': ('حوالة سريعة صادرة - {supplier}', 'مشتريات - {supplier}'),
        'refund': ('تحويل صادر - استرداد طلب {order}', 'استرداد الطلب {order} بضاعة مرتجعة'),
        'shipping': ('تحويل صادر - شحن رصيد {courier}', 'بوالص شحن مسبقة {courier} {when}'),
        'rent': ('أمر مستديم - إيجار المستودع', 'إيجار المستودع {month}'),
        'payroll': ('رواتب حماية الأجور {month}', 'الرواتب {month}'),
        'gosi': ('سداد - اشتراكات التأمينات الاجتماعية', 'اشتراكات التأمينات {month}'),
        'vat': ('سداد - هيئة الزكاة والضريبة والجمارك', 'ضريبة القيمة المضافة الربع {quarter}'),
    },
}
INFLOW = {'card', 'cod', 'market'}
MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر',
             'ديسمبر']


class Ledger:
    def __init__(self, sid, seed, title, *, producer, font, paper, period, opening, per_page, bank,
                 document_title, account, layout='en', digits=None, page_totals=False, cashbook_xlsx=None,
                 style=None):
        self.rng = Pcg32(seed)
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
        self.orders = set()
        self.intent = {'statement': 'verified', 'auto': [], 'review': [], 'bankOnly': [], 'cashOnly': [], 'timing': []}

    def inside(self, d):
        return self.period['start'] <= iso(d) <= self.period['end']

    def month_label(self, d):
        return f'{d:%Y-%m}' if self.layout == 'en' else f'{MONTHS_AR[d.month - 1]} {d.year}'

    def movement(self, key, when, text, reference='', *, out=0, into=0, value=None):
        assert (out > 0) != (into > 0) and self.period['start'] <= when <= self.period['end']
        self.movements.append({'key': f'b:{key}', 'date': when, 'valueDate': value or when, 'description': text,
                               'reference': reference, 'withdrawal': out, 'deposit': into})

    def entry(self, key, when, text, reference='', *, receipt=0, payment=0):
        assert (receipt > 0) != (payment > 0)
        self.vouchers += 1
        voucher = f"{'RV' if receipt else 'PV'}-{self.id}-{self.vouchers:04d}"
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

    def order(self):
        """A customer order number not drawn before in this story."""
        while True:
            n = self.rng.between(410000, 489999)
            if n not in self.orders:
                self.orders.add(n)
                return n

    def booked_within(self, d, days):
        """A business day from d to `days` business days after it."""
        out, b = [d], d
        while len(out) <= days:
            b = next_business(b + timedelta(days=1))
            out.append(b)
        return out[self.rng.below(len(out))]

    def retailer(self, *, acquirers=1, couriers=3, markets=2, suppliers=5, staff=12, card_scale=(6000, 34000),
                 cod_scale=(9000, 41000), market_scale=(14000, 62000), supplier_scale=(12000, 96000),
                 salary_scale=(3900, 11800), refunds=3, rent=None, shipping=True, gosi=True, vat=True):
        """The retailer's own period.

        Cards: each business day each acquirer settles the day's card sales,
        booked from its report that day or on the next business day.
        Cash on delivery: each Tuesday one courier, in turn, remits what it
        collected, booked on a business day up to two business days later.
        Marketplaces: each pays out on the first business day on or after
        the 1st and the 16th.
        Suppliers: each Wednesday one or two are paid.
        Refunds: each business day, with one chance in `refunds`, a customer
        is refunded for a returned order.
        Shipping: each Sunday one courier's prepaid account is topped up.
        Rent: by standing order on the first business day of the month.
        Payroll: one WPS batch on the last business day by the 25th.
        GOSI: by SADAD on a business day from the 10th to the 14th.
        VAT: in January, April, July and October, by SADAD on a business day
        from the 20th to the 27th, for the quarter before."""
        r, L = self.rng, self.layout
        start, end = day(self.period['start']), day(self.period['end'])
        n = 0
        tuesdays = 0
        d = start
        while d <= end:
            if business(d):
                for a in range(acquirers):
                    booked = self.booked_within(d, 1)
                    if self.inside(booked):
                        n += 1
                        self.pair(f'K{n}', d, 'card', f'STL-{ACQUIRER_CODES[a]}-{d:%y%m%d}', r.money(*card_scale),
                                  booked=booked, acquirer=ACQUIRERS[L][a], batch=f'{d:%y%m%d}{a + 1}',
                                  when=iso(d))
                if r.below(refunds) == 0:
                    n += 1
                    o = self.order()
                    self.pair(f'R{n}', d, 'refund', f'RFD-{o}', r.money(90, 2400), order=o)
                if d.weekday() == TUESDAY:
                    c = tuesdays % couriers
                    tuesdays += 1
                    booked = self.booked_within(d, 2)
                    if self.inside(booked):
                        n += 1
                        self.pair(f'D{n}', d, 'cod', f'COD-{COURIER_CODES[c]}-{d:%y%m%d}', r.money(*cod_scale),
                                  booked=booked, courier=COURIERS[L][c], week=f'{d:%V}')
                if d.weekday() == WEDNESDAY:
                    for _ in range(r.between(1, 2)):
                        n += 1
                        self.pair(f'S{n}', d, 'supplier', f'PO-{d:%y%m%d}-{n:03d}', r.money(*supplier_scale),
                                  supplier=SUPPLIERS[L][r.below(suppliers)])
                if shipping and d.weekday() == SUNDAY:
                    c = r.below(couriers)
                    n += 1
                    self.pair(f'H{n}', d, 'shipping', f'SHP-{COURIER_CODES[c]}-{d:%y%m%d}', r.money(1500, 5200),
                              courier=COURIERS[L][c], when=iso(d))
            d += timedelta(days=1)
        month = start.replace(day=1)
        while month <= end:
            label = self.month_label(month)
            for m in range(markets):
                for on in (1, 16):
                    paid = next_business(month.replace(day=on))
                    if self.inside(paid):
                        n += 1
                        self.pair(f'M{n}', paid, 'market', f'MKT-{MARKET_CODES[m]}-{paid:%y%m%d}',
                                  r.money(*market_scale), market=MARKETS[L][m], when=iso(paid))
            if rent:
                paid = next_business(month)
                if self.inside(paid):
                    n += 1
                    self.pair(f'L{n}', paid, 'rent', f'SO-WH-{month:%y%m}', rent, month=label)
            pay = previous_business(month.replace(day=25))
            if self.inside(pay):
                n += 1
                self.pair(f'W{n}', pay, 'payroll', f'WPS-{pay:%y%m}',
                          sum(r.money(*salary_scale) for _ in range(staff)), month=label)
            if gosi:
                paid = next_business(month + timedelta(days=r.between(9, 13)))
                if self.inside(paid):
                    n += 1
                    self.pair(f'G{n}', paid, 'gosi', f'GOSI-{month:%y%m}', r.money(5200, 21000), month=label)
            if vat and month.month in (1, 4, 7, 10):
                paid = next_business(month + timedelta(days=r.between(19, 26)))
                if self.inside(paid):
                    n += 1
                    quarter = f'Q{(month.month - 2) % 12 // 3 + 1}-{month.year - (month.month == 1)}'
                    self.pair(f'T{n}', paid, 'vat', f'SADAD-{r.between(10 ** 4, 10 ** 5 - 1)}{r.below(10 ** 5):05d}',
                              r.money(18000, 76000), quarter=quarter)
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
        if 'pageTotalShort' in self.recipe:
            # A page's deposit total printed without one of its deposits; the
            # movements and balances are the bank's ledger.
            page, index = self.recipe['pageTotalShort']
            lines = pages[page - 1]['lines']
            missed = [l for l in lines if l['kind'] == 'movement' and l['deposit']][index]
            total = next(l for l in lines if l['kind'] == 'page-totals')
            total['deposit'] -= missed['deposit']
        if 'pageOfChanged' in self.recipe:
            # A page printed as one of a statement one page longer.
            pages[self.recipe['pageOfChanged'] - 1]['of'] += 1
        if 'broughtForwardTransposed' in self.recipe:
            # A page's balance brought forward printed with two digits of its
            # riyals swapped; the movements' balances are the bank's ledger.
            line = pages[self.recipe['broughtForwardTransposed'] - 1]['lines'][0]
            assert line['kind'] == 'brought-forward'
            riyals = str(line['balance'] // 100)
            assert len(riyals) >= 4 and riyals[-3] != riyals[-4]
            swapped = riyals[:-4] + riyals[-3] + riyals[-4] + riyals[-2:]
            line['balance'] = int(swapped) * 100 + line['balance'] % 100
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

    s = Ledger('W01', 2001, 'iText statement in Karla, a simple TrueType font, with a full grid and a heading '
               'filled teal in white; a courier\'s cash-on-delivery remittance booked six days after it arrived; '
               'a chargeback debited by the acquirer and not yet booked; a cheque to a shelving contractor not '
               'yet presented',
               producer='itext', font='Karla', paper='A4', period=('2029-01-01', '2029-01-31'),
               opening=18400000, per_page=17, bank='Dunes Merchant Bank', document_title='Statement of Account',
               account='SA27 4800 0000 2029 0100 2001', style=styled(rules='grid', heading='filled'))
    s.retailer(acquirers=1, staff=14, rent=3150000)
    s.movement('lc', '2029-01-15', 'COD remittance - Sahm Logistics', 'COD-SHM-290115L', into=2694530)
    s.entry('lc', '2029-01-21', 'Cash on delivery collected by Sahm Logistics week 02', 'COD-SHM-290115L',
            receipt=2694530)
    s.intent['review'].append({'bank': ['b:lc'], 'cash': ['c:lc'], 'reason': 'date-gap'})
    s.movement('cb', '2029-01-23', 'Chargeback - Najd Payments order 447120', 'CBK-447120', out=128900)
    s.intent['bankOnly'].append('b:cb')
    s.entry('oc', '2029-01-29', 'Warehouse shelving - Al Jazirah Racking by cheque', 'CHQ-310448', payment=1846000)
    s.intent['cashOnly'].append('c:oc')
    stories.append(s)

    s = Ledger('W02', 2002, 'iText statement in Source Sans 3, an OpenType CFF font embedded whole as a simple '
               'Type1C font, with rules under every row and page totals; a marketplace payout net of its '
               'commission against the gross booked; two refunds of the same amount on one day against two '
               'equal entries, without references; a supplier paid without the reference on the statement; a '
               'cheque to a print shop not yet presented',
               producer='itext', font='Source Sans 3', paper='A4', period=('2029-02-01', '2029-02-28'),
               opening=22600000, per_page=15, page_totals=True, bank='Dunes Merchant Bank',
               document_title='Account Statement', account='SA27 4800 0000 2029 0100 2002',
               style=styled(rules='rows', heading='rule'))
    s.retailer(acquirers=1, staff=13, rent=3150000)
    s.movement('mc', '2029-02-20', 'Marketplace payout - Dukkan Mall net of commission', 'MKT-DKN-290220N',
               into=3816420)
    s.entry('mc', '2029-02-20', 'Marketplace sales payout Dukkan Mall 2029-02-20', 'MKT-DKN-290220N',
            receipt=4246880)
    s.intent['review'].append({'bank': ['b:mc'], 'cash': ['c:mc'], 'reason': 'amount-difference'})
    for k in (1, 2):
        s.movement(f'rf{k}', '2029-02-12', 'Outward transfer - customer refund', out=34900)
        s.entry(f'rf{k}', '2029-02-12', f'Refund returned cushion set, parcel {k}', payment=34900)
    s.intent['review'].append({'bank': ['b:rf1', 'b:rf2'], 'cash': ['c:rf1', 'c:rf2'],
                               'reason': 'ambiguous-amount-date'})
    s.movement('nr', '2029-02-26', 'Outward SARIE - Tihama Furniture Works', out=5240175)
    s.entry('nr', '2029-02-27', 'Purchases - Tihama Furniture Works', 'PO-290226-TFW', payment=5240175)
    s.intent['review'].append({'bank': ['b:nr'], 'cash': ['c:nr'], 'reason': 'amount-date-suggestion'})
    s.entry('oc', '2029-02-25', 'Catalogue printing - Riyadh Print House by cheque', 'CHQ-310512', payment=962500)
    s.intent['cashOnly'].append('c:oc')
    stories.append(s)

    s = Ledger('W03', 2003, 'monospaced iText statement in Roboto Mono on US Letter, a Type0 font, with no rules '
               'but a heading rule and headings left-aligned over right-aligned amounts; overdrawn the whole '
               'month, the DR written after each amount; a customer refund booked as a receipt; a supplier '
               'payment debited twice under one order number against one entry; cashbook also as typed XLSX '
               'from OpenSpout',
               producer='itext', font='Roboto Mono', paper='Letter', period=('2029-03-01', '2029-03-31'),
               opening=-16000000, per_page=16, bank='Dunes Merchant Bank', document_title='Statement of Account',
               account='SA27 4800 0000 2029 0100 2003', cashbook_xlsx='typed',
               style=styled(rules='none', heading='rule', headings='left'))
    s.retailer(acquirers=1, staff=12, rent=None, card_scale=(3000, 9000), cod_scale=(4000, 12000),
               market_scale=(5000, 15000), supplier_scale=(4000, 15000))
    s.movement('rr', '2029-03-13', 'Outward transfer - customer refund order 452207', 'RFD-452207', out=58300)
    s.entry('rr', '2029-03-13', 'Refund order 452207 returned goods', 'RFD-452207', receipt=58300)
    s.intent['review'].append({'bank': ['b:rr'], 'cash': ['c:rr'], 'reason': 'direction-conflict'})
    for k, d in enumerate(['2029-03-21', '2029-03-22'], 1):
        s.movement(f'pd{k}', d, 'Outward SARIE - Gulf Lighting Trading', 'PO-290321-GLT', out=1964250)
    s.entry('pd', '2029-03-21', 'Purchases - Gulf Lighting Trading', 'PO-290321-GLT', payment=1964250)
    s.intent['review'].append({'bank': ['b:pd1', 'b:pd2'], 'cash': ['c:pd'], 'reason': 'duplicate-reference'})
    stories.append(s)

    s = Ledger('W04', 2004, 'a quarter on many pages from iText in Lora on A4 landscape, a Type0 font, striped '
               'rows and long descriptions wrapped in their cells; a card settlement valued after the period; '
               'the acquirer\'s quarterly terminal fee; a supplier payment valued before the period',
               producer='itext', font='Lora', paper='A4-landscape', period=('2029-04-01', '2029-06-30'),
               opening=31200000, per_page=16, bank='Dunes Merchant Bank', document_title='Statement of Account',
               account='SA27 4800 0000 2029 0100 2004', style=styled(rules='stripes', heading='filled'))
    s.retailer(acquirers=1, markets=1, staff=11, rent=3150000, refunds=5, shipping=False)
    s.pair('va', day('2029-06-28'), 'card', 'STL-WDP-290628Q', 2318470, booked=day('2029-06-28'),
           value='2029-07-01', acquirer='Wadi Pay settlement at the end of the quarter for the card sales of '
           'late June held for review', batch='2906282', when='2029-06-28')
    s.intent['timing'].append('b:va')
    s.pair('vb', day('2029-04-01'), 'supplier', 'PO-290401-HHT', 4806310, value='2029-03-29',
           supplier='Hejaz Home Textiles for the spring bedding range shipped from the Jeddah warehouse')
    s.intent['timing'].append('b:vb')
    s.movement('fee', '2029-06-28', 'Quarterly POS terminal rental fee', out=57500)
    s.intent['bankOnly'].append('b:fee')
    stories.append(s)

    s = Ledger('W05', 2005, 'iText statement in Karla with page totals: page 2\'s deposit total printed without '
               'one of its deposits, the movements and balances as the bank\'s ledger',
               producer='itext', font='Karla', paper='A4', period=('2029-05-01', '2029-05-31'),
               opening=20500000, per_page=15, page_totals=True, bank='Dunes Merchant Bank',
               document_title='Statement of Account', account='SA27 4800 0000 2029 0100 2005',
               style=styled(rules='grid', heading='filled'))
    s.retailer(acquirers=1, staff=12, rent=3150000)
    s.recipe['pageTotalShort'] = [2, 3]
    s.held('balance-broken')
    stories.append(s)

    s = Ledger('W06', 2006, 'PDFKit statement in DM Sans: page 3 of a four-page statement printed as page 3 of 5',
               producer='pdfkit', font='DM Sans', paper='A4', period=('2029-07-01', '2029-07-31'),
               opening=26100000, per_page=16, bank='Red Sea Commerce Bank', document_title='Account Statement',
               account='SA58 3700 0000 6060 2900 2006', style=styled(rules='rows', heading='rule'))
    s.retailer(acquirers=1, staff=13, rent=3150000)
    s.recipe['pageOfChanged'] = 3
    s.held('incomplete-pages')
    stories.append(s)

    s = Ledger('W07', 2007, 'Arabic PDFKit statement in Changa with Arabic-Indic digits, shaped by fontkit and '
               'ordered by bidi-js, each run of one embedding level drawn by its own text call, so that a date '
               'prints as five runs; a full grid and a grey heading, amounts at the left edge of their cells; '
               'a courier\'s remittance booked six days after it arrived; two supplier payments of the same '
               'amount on one day against two entries without references; the acquirer\'s monthly gateway '
               'fee, not yet booked',
               producer='pdfkit', font='Changa', paper='A4', layout='ar', digits='arabic',
               period=('2029-08-01', '2029-08-31'), opening=24800000, per_page=15,
               bank='بنك البحر الأحمر التجاري', document_title='كشف حساب', account='SA58 3700 0000 6060 2900 2007',
               style=styled(rules='grid', heading='grey', amounts='end'))
    s.retailer(acquirers=1, staff=12, rent=3300000)
    s.movement('lc', '2029-08-07', 'تحويل الدفع عند الاستلام - رمال إكسبرس', 'COD-RML-290807L', into=1972640)
    s.entry('lc', '2029-08-13', 'تحصيل الدفع عند الاستلام رمال إكسبرس أسبوع 32', 'COD-RML-290807L',
            receipt=1972640)
    s.intent['review'].append({'bank': ['b:lc'], 'cash': ['c:lc'], 'reason': 'date-gap'})
    for k in (1, 2):
        s.movement(f'sp{k}', '2029-08-20', 'حوالة سريعة صادرة - النور لأدوات المطبخ', out=1485000)
        s.entry(f'sp{k}', '2029-08-20', f'مشتريات - النور لأدوات المطبخ دفعة {k}', payment=1485000)
    s.intent['review'].append({'bank': ['b:sp1', 'b:sp2'], 'cash': ['c:sp1', 'c:sp2'],
                               'reason': 'ambiguous-amount-date'})
    s.movement('gf', '2029-08-30', 'رسوم بوابة الدفع الشهرية', out=46000)
    s.intent['bankOnly'].append('b:gf')
    stories.append(s)

    s = Ledger('W08', 2008, 'Arabic PDFKit statement in Kufam with Arabic-Indic digits, rules under every row and '
               'a heading filled navy in white; a description continuing at the top of page 2; a marketplace '
               'payout valued after the period; a returned outward transfer with the bank\'s fee, not yet booked',
               producer='pdfkit', font='Kufam', paper='A4', layout='ar', digits='arabic',
               period=('2029-09-01', '2029-09-30'), opening=21300000, per_page=15,
               bank='بنك البحر الأحمر التجاري', document_title='كشف حساب جاري',
               account='SA58 3700 0000 6060 2900 2008', style=styled(rules='rows', heading='filled'))
    s.retailer(acquirers=1, staff=12, rent=3300000)
    s.continuation = {'page': 2, 'text': 'تابع: مرتجعات طلبات أغسطس'}
    s.pair('va', day('2029-09-27'), 'market', 'MKT-WAH-290927Q', 2741960, booked=day('2029-09-27'),
           value='2029-10-01', market='سوق الواحة', when='2029-09-27')
    s.intent['timing'].append('b:va')
    s.movement('rt', '2029-09-18', 'حوالة مرتجعة - رقم حساب المستفيد غير صحيح', 'RFD-463381-R', into=81700)
    s.movement('rx', '2029-09-18', 'رسوم الحوالة المرتجعة', out=2500)
    s.intent['bankOnly'] += ['b:rt', 'b:rx']
    stories.append(s)

    s = Ledger('W09', 2009, 'Arabic PDFKit statement in Baloo Bhaijaan 2 with Latin digits, rules under every row '
               'and a heading filled dark green in white; a customer refund booked twice in the cashbook under '
               'its reference; a supplier payment valued before the period',
               producer='pdfkit', font='Baloo Bhaijaan 2', paper='A4', layout='ar', digits='latin',
               period=('2029-10-01', '2029-10-31'), opening=19700000, per_page=14,
               bank='بنك البحر الأحمر التجاري', document_title='كشف حساب', account='SA58 3700 0000 6060 2900 2009',
               style=styled(rules='rows', heading='filled'))
    s.retailer(acquirers=1, staff=11, rent=3300000, gosi=False)
    s.movement('dr', '2029-10-16', 'تحويل صادر - استرداد طلب 471906', 'RFD-471906', out=127400)
    for k, d in enumerate(['2029-10-16', '2029-10-17'], 1):
        s.entry(f'dr{k}', d, 'استرداد الطلب 471906 بضاعة مرتجعة', 'RFD-471906', payment=127400)
    s.intent['review'].append({'bank': ['b:dr'], 'cash': ['c:dr1', 'c:dr2'], 'reason': 'duplicate-reference'})
    s.pair('vb', day('2029-10-01'), 'supplier', 'PO-291001-ENP', 1677830, value='2029-09-27',
           supplier='الشرقية للتغليف')
    s.intent['timing'].append('b:vb')
    stories.append(s)

    s = Ledger('W10', 2010, 'English PDFKit statement in Source Sans 3, an OpenType CFF font subset by fontkit '
               'as a CIDFontType0C font, on A4 landscape with striped rows and a heading filled plum in white; '
               'a card settlement booked gross against the net credited; a supplier\'s credit note refund not '
               'yet booked; cashbook also as text XLSX from write-excel-file',
               producer='pdfkit', font='Source Sans 3', paper='A4-landscape', period=('2029-11-01', '2029-11-30'),
               opening=17900000, per_page=14, bank='Red Sea Commerce Bank', document_title='Statement of Account',
               account='SA58 3700 0000 6060 2900 2010', cashbook_xlsx='text',
               style=styled(rules='stripes', heading='filled'))
    s.retailer(acquirers=2, staff=13, rent=3300000, refunds=4)
    s.movement('gn', '2029-11-21', 'Card settlement - Najd Payments batch 2911219 net of MDR', 'STL-NJD-291121X',
               into=1853126)
    s.entry('gn', '2029-11-21', 'Card sales 2029-11-21 - Najd Payments gross', 'STL-NJD-291121X', receipt=1888040)
    s.intent['review'].append({'bank': ['b:gn'], 'cash': ['c:gn'], 'reason': 'amount-difference'})
    s.movement('cn', '2029-11-27', 'Inward transfer - Al Noor Kitchenware credit note', 'CN-ANK-2911', into=316250)
    s.intent['bankOnly'].append('b:cn')
    stories.append(s)

    s = Ledger('W11', 2011, 'monospaced PDFKit statement in Inconsolata with a heading rule and no other rules; a '
               'courier\'s remittance without its reference on the statement, booked two days later; a '
               'marketplace payout booked as a payment; overdraft never reached',
               producer='pdfkit', font='Inconsolata', paper='A4', period=('2029-12-01', '2029-12-31'),
               opening=28400000, per_page=16, bank='Red Sea Commerce Bank', document_title='Account Statement',
               account='SA58 3700 0000 6060 2900 2011', style=styled(rules='none', heading='rule'))
    s.retailer(acquirers=1, staff=13, rent=3300000)
    s.movement('nr', '2029-12-11', 'COD remittance - Qafila Couriers', into=3348815)
    s.entry('nr', '2029-12-13', 'Cash on delivery collected by Qafila Couriers week 50', 'COD-QFL-291211X',
            receipt=3348815)
    s.intent['review'].append({'bank': ['b:nr'], 'cash': ['c:nr'], 'reason': 'amount-date-suggestion'})
    s.movement('mp', '2029-12-19', 'Marketplace payout - Souq Al Waha', 'MKT-WAH-291219S', into=1124600)
    s.entry('mp', '2029-12-19', 'Marketplace sales payout Souq Al Waha 2029-12-19', 'MKT-WAH-291219S',
            payment=1124600)
    s.intent['review'].append({'bank': ['b:mp'], 'cash': ['c:mp'], 'reason': 'direction-conflict'})
    stories.append(s)

    s = Ledger('W12', 2012, 'Arabic PDFKit statement in Changa: page 3\'s balance brought forward printed with two '
               'digits swapped, the movements\' balances as the bank\'s ledger',
               producer='pdfkit', font='Changa', paper='A4', layout='ar', digits='arabic',
               period=('2029-06-01', '2029-06-30'), opening=23600000, per_page=14,
               bank='بنك البحر الأحمر التجاري', document_title='كشف حساب', account='SA58 3700 0000 6060 2900 2012',
               style=styled(rules='grid', heading='grey', amounts='end'))
    s.retailer(acquirers=1, staff=12, rent=3300000)
    s.recipe['broughtForwardTransposed'] = 3
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
