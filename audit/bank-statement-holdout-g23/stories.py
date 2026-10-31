"""BNK-PDF-1 G23 holdout: new synthetic bank statements and cashbooks as facts.

An eleventh generator lineage, written for G23. Nothing is imported from the
foundation's stories.mjs, from the G6 to G20 holdouts' stories.py, from any
renderer or from the product; the generator's mechanics (PCG32, the ledger,
the printed pages and the planted faults) are copied from G20's and the
business is new. Each story is the operating account of a coffee roaster
that supplies cafés over one period: cafés pay their invoices by transfer
on about one business day in two, booked from the remittance that day or up
to two business days later; the roastery shop's card sales are settled by
the acquirer each business day, booked that day or the next; two delivery
apps pay the week's sales each Monday; a green-coffee importer is paid on
every other Thursday; packaging is paid on about one Sunday in two; the
delivery vans' fuel cards are topped up each Wednesday; the roaster's lease
goes by standing order on the first business day; electricity is paid by
SADAD in mid-month; salaries go by a WPS batch by the 25th; GOSI
contributions by SADAD from the 10th to the 14th; and the quarter's VAT by
SADAD in the month after it. A PCG32 generator (XSH RR, O'Neill) draws the
amounts and days. The special events of a story and its expected outcome
are written by hand beside it.

The facts follow the foundation's contract (contract.json): one account in
SAR with two decimals, one period per statement, the same column headings,
control lines, account line and page footer. What changes is what the
contract leaves open: the writers (HexaPDF, the Ruby library, and a Node
statement application drawing with pdf-lib), fonts, styles, paper, periods,
banks, accounts, reference styles, narratives, economic relationships and
faults.

Each story lists its statement page by page and line by line as printed.
`recipe` says how the pages were made and styled and which fault was
planted; `intent` is the designer's expected outcome. The independent oracle
reads neither. Amounts are minor units; balances are running balances.

  python3 -B audit/bank-statement-holdout-g23/stories.py > stories.json
"""
import json
import sys
from datetime import date, timedelta

VERSION = 'bank-statement-holdout-g23-1'
WINDOW = 3
WEEKEND = {4, 5}  # Friday and Saturday
SUNDAY, MONDAY, WEDNESDAY, THURSDAY = 6, 0, 2, 3
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




ACQUIRER = {'en': 'Hima Pay', 'ar': 'حمى باي'}
CAFES = {'en': ['Qahwa Corner', 'Bait Al Bunn', 'Rawasi Cafe', 'Mirqab Coffee', 'Nakhla Lounge', 'Sidra Roast Bar'],
         'ar': ['ركن القهوة', 'بيت البن', 'مقهى رواسي', 'قهوة المرقب', 'استراحة النخلة', 'مقهى السدرة']}
APPS = {'en': ['Wasel Eats', 'Sufra Go'], 'ar': ['واصل إيتس', 'سفرة قو']}
APP_CODES = ['WSL', 'SFR']
IMPORTERS = {'en': ['Mocha Coast Imports', 'Harrar Green Traders', 'Andes Bean Supply'],
             'ar': ['ساحل موكا للاستيراد', 'هرر للبن الأخضر', 'الأنديز لتوريد البن']}
PACKERS = {'en': ['Najran Packaging', 'Al Waha Bags and Tins'], 'ar': ['نجران للتغليف', 'الواحة للأكياس والعلب']}
WORDS = {
    'en': {
        'invoice': ('Inward transfer - {cafe}', 'Receipt {cafe} invoice {invoice}'),
        'card': ('POS settlement - {acquirer} batch {batch}', 'Roastery shop card sales {when}'),
        'app': ('Delivery app payout - {app}', 'Delivery app sales {app} week {week}'),
        'green': ('Outward SARIE - {importer}', 'Green coffee - {importer} lot {lot}'),
        'pack': ('Outward transfer - {packer}', 'Packaging - {packer}'),
        'fuel': ('Outward transfer - fleet fuel cards', 'Van fuel cards {when}'),
        'lease': ('Standing order - roaster lease', 'Roaster lease {month}'),
        'power': ('SADAD - electricity', 'Electricity {month}'),
        'payroll': ('WPS salaries {month}', 'Payroll {month}'),
        'gosi': ('SADAD - GOSI', 'Social insurance {month}'),
        'vat': ('SADAD - ZATCA VAT', 'VAT return quarter {quarter}'),
    },
    'ar': {
        'invoice': ('تحويل وارد - {cafe}', 'تحصيل {cafe} فاتورة {invoice}'),
        'card': ('تسوية نقاط البيع - {acquirer} دفعة {batch}', 'مبيعات متجر المحمصة بالبطاقات {when}'),
        'app': ('دفعة تطبيق التوصيل - {app}', 'مبيعات تطبيق التوصيل {app} أسبوع {week}'),
        'green': ('حوالة سريعة صادرة - {importer}', 'بن أخضر - {importer} شحنة {lot}'),
        'pack': ('تحويل صادر - {packer}', 'مواد التغليف - {packer}'),
        'fuel': ('تحويل صادر - بطاقات وقود الأسطول', 'بطاقات وقود سيارات التوصيل {when}'),
        'lease': ('أمر مستديم - إيجار آلة التحميص', 'إيجار آلة التحميص {month}'),
        'power': ('سداد - الكهرباء', 'الكهرباء {month}'),
        'payroll': ('رواتب حماية الأجور {month}', 'الرواتب {month}'),
        'gosi': ('سداد - التأمينات الاجتماعية', 'اشتراكات التأمينات {month}'),
        'vat': ('سداد - هيئة الزكاة والضريبة والجمارك', 'إقرار ضريبة القيمة المضافة الربع {quarter}'),
    },
}
INFLOW = {'invoice', 'card', 'app'}
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

    def invoice(self, d):
        """An invoice number of the month, not drawn before in this story."""
        while True:
            n = f'INV-{d:%y%m}-{self.rng.between(100, 999)}'
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

    def booked_by(self, d, days):
        """A business day from d to `days` calendar days after it."""
        out = [d + timedelta(days=k) for k in range(days + 1)]
        out = [b for b in out if business(b)]
        return out[self.rng.below(len(out))]

    def roaster(self, *, apps=2, cafes=6, importers=3, packers=2, staff=10, invoice_scale=(1800, 14500),
                card_scale=(1500, 7800), app_scale=(4200, 19800), green_scale=(26000, 118000),
                pack_scale=(3200, 15600), salary_scale=(4100, 12400), lease=None, power=True, gosi=True, vat=True):
        """The roaster's own period.

        Invoices: each business day, with one chance in two, a café pays an
        invoice, booked on a business day up to three calendar days later,
        the contract's date window (two business days over a weekend were
        five days in the first drafts).
        Cards: each business day the acquirer settles the roastery shop's
        card sales, booked that day or the next business day.
        Delivery apps: each Monday each app pays the week's sales.
        Green coffee: on every other Thursday one importer is paid for a lot.
        Packaging: each Sunday, with one chance in two, a packer is paid.
        Fuel: each Wednesday the vans' fuel cards are topped up.
        Lease: by standing order on the first business day of the month.
        Electricity: by SADAD on a business day from the 15th to the 18th.
        Payroll: one WPS batch on the last business day by the 25th.
        GOSI: by SADAD on a business day from the 10th to the 14th.
        VAT: in January, April, July and October, by SADAD on a business day
        from the 20th to the 27th, for the quarter before."""
        r, L = self.rng, self.layout
        start, end = day(self.period['start']), day(self.period['end'])
        n = 0
        thursdays = 0
        d = start
        while d <= end:
            if business(d):
                booked = self.booked_within(d, 1)
                if self.inside(booked):
                    n += 1
                    self.pair(f'K{n}', d, 'card', f'POS-HMA-{d:%y%m%d}', r.money(*card_scale), booked=booked,
                              acquirer=ACQUIRER[L], batch=f'{d:%y%m%d}', when=iso(d))
                if r.below(2) == 0:
                    booked = self.booked_by(d, 3)
                    if self.inside(booked):
                        n += 1
                        invoice = self.invoice(d)
                        self.pair(f'I{n}', d, 'invoice', invoice, r.money(*invoice_scale), booked=booked,
                                  cafe=CAFES[L][r.below(cafes)], invoice=invoice)
                if d.weekday() == MONDAY:
                    for a in range(apps):
                        n += 1
                        self.pair(f'A{n}', d, 'app', f'APP-{APP_CODES[a]}-{d:%y%m%d}', r.money(*app_scale),
                                  app=APPS[L][a], week=f'{d:%V}')
                if d.weekday() == THURSDAY:
                    thursdays += 1
                    if thursdays % 2:
                        n += 1
                        lot = f'{d:%y%m}{r.between(10, 99)}'
                        self.pair(f'G{n}', d, 'green', f'LOT-{lot}', r.money(*green_scale),
                                  importer=IMPORTERS[L][r.below(importers)], lot=lot)
                if d.weekday() == SUNDAY and r.below(2) == 0:
                    n += 1
                    self.pair(f'P{n}', d, 'pack', f'PO-{d:%y%m%d}-{n:03d}', r.money(*pack_scale),
                              packer=PACKERS[L][r.below(packers)])
                if d.weekday() == WEDNESDAY:
                    n += 1
                    self.pair(f'F{n}', d, 'fuel', f'FUEL-{d:%y%m%d}', r.money(900, 2600), when=iso(d))
            d += timedelta(days=1)
        month = start.replace(day=1)
        while month <= end:
            label = self.month_label(month)
            if lease:
                paid = next_business(month)
                if self.inside(paid):
                    n += 1
                    self.pair(f'L{n}', paid, 'lease', f'SO-RL-{month:%y%m}', lease, month=label)
            if power:
                paid = next_business(month + timedelta(days=r.between(14, 17)))
                if self.inside(paid):
                    n += 1
                    self.pair(f'E{n}', paid, 'power', f'SEC-{month:%y%m}-{r.between(10000, 99999)}',
                              r.money(2400, 9800), month=label)
            pay = previous_business(month.replace(day=25))
            if self.inside(pay):
                n += 1
                self.pair(f'W{n}', pay, 'payroll', f'WPS-{pay:%y%m}',
                          sum(r.money(*salary_scale) for _ in range(staff)), month=label)
            if gosi:
                paid = next_business(month + timedelta(days=r.between(9, 13)))
                if self.inside(paid):
                    n += 1
                    self.pair(f'S{n}', paid, 'gosi', f'GOSI-{month:%y%m}', r.money(4800, 17500), month=label)
            if vat and month.month in (1, 4, 7, 10):
                paid = next_business(month + timedelta(days=r.between(19, 26)))
                if self.inside(paid):
                    n += 1
                    quarter = f'Q{(month.month - 2) % 12 // 3 + 1}-{month.year - (month.month == 1)}'
                    self.pair(f'T{n}', paid, 'vat', f'SADAD-{r.between(10 ** 4, 10 ** 5 - 1)}{r.below(10 ** 5):05d}',
                              r.money(16000, 64000), quarter=quarter)
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
    sarawat, harrah = 'Sarawat Commercial Bank', 'بنك الحرة التجاري'

    s = Ledger('X01', 2301, 'HexaPDF statement in Work Sans, a Type0 TrueType font, with a full grid and a heading '
               'filled brown in white; a café\'s invoice paid by transfer and booked seven days later; a card '
               'chargeback debited by the acquirer and not yet booked; a cheque to a grinder technician not yet '
               'presented',
               producer='hexapdf', font='Work Sans', paper='A4', period=('2030-01-01', '2030-01-31'),
               opening=16200000, per_page=17, bank=sarawat, document_title='Statement of Account',
               account='SA44 6200 0000 2030 0300 2301', style=styled(rules='grid', heading='filled'))
    s.roaster(staff=9, lease=2240000)
    s.movement('lc', '2030-01-14', 'Inward transfer - Rawasi Cafe', 'INV-3001-777', into=1186450)
    s.entry('lc', '2030-01-21', 'Receipt Rawasi Cafe invoice INV-3001-777', 'INV-3001-777', receipt=1186450)
    s.intent['review'].append({'bank': ['b:lc'], 'cash': ['c:lc'], 'reason': 'date-gap'})
    s.movement('cb', '2030-01-23', 'Chargeback - Hima Pay card sale 300119', 'CBK-300119', out=64500)
    s.intent['bankOnly'].append('b:cb')
    s.entry('oc', '2030-01-29', 'Grinder service - Burr Tech by cheque', 'CHQ-552310', payment=735000)
    s.intent['cashOnly'].append('c:oc')
    stories.append(s)

    s = Ledger('X02', 2302, 'HexaPDF statement in Merriweather with rules under every row and page totals; a '
               'delivery app\'s payout net of its commission against the gross booked; two fuel card top-ups of '
               'the same amount on one day against two equal entries, without references; an importer paid '
               'without the lot on the statement; a cheque to a print house not yet presented',
               producer='hexapdf', font='Merriweather', paper='A4', period=('2030-02-01', '2030-02-28'),
               opening=19800000, per_page=15, page_totals=True, bank=sarawat,
               document_title='Account Statement', account='SA44 6200 0000 2030 0300 2302',
               style=styled(rules='rows', heading='rule'))
    s.roaster(staff=10, lease=2240000)
    s.movement('mc', '2030-02-18', 'Delivery app payout - Sufra Go net of commission', 'APP-SFR-300218N',
               into=1452318)
    s.entry('mc', '2030-02-18', 'Delivery app sales Sufra Go week 08', 'APP-SFR-300218N', receipt=1613687)
    s.intent['review'].append({'bank': ['b:mc'], 'cash': ['c:mc'], 'reason': 'amount-difference'})
    for k in (1, 2):
        s.movement(f'fc{k}', '2030-02-13', 'Outward transfer - fleet fuel cards', out=120000)
        s.entry(f'fc{k}', '2030-02-13', f'Van fuel card top-up van {k}', payment=120000)
    s.intent['review'].append({'bank': ['b:fc1', 'b:fc2'], 'cash': ['c:fc1', 'c:fc2'],
                               'reason': 'ambiguous-amount-date'})
    s.movement('nr', '2030-02-26', 'Outward SARIE - Andes Bean Supply', out=6438210)
    s.entry('nr', '2030-02-27', 'Green coffee - Andes Bean Supply lot 300229', 'LOT-300229', payment=6438210)
    s.intent['review'].append({'bank': ['b:nr'], 'cash': ['c:nr'], 'reason': 'amount-date-suggestion'})
    s.entry('oc', '2030-02-25', 'Label printing - Qassim Print House by cheque', 'CHQ-552377', payment=418000)
    s.intent['cashOnly'].append('c:oc')
    stories.append(s)

    s = Ledger('X03', 2303, 'monospaced HexaPDF statement in Space Mono on US Letter with no rules but a heading '
               'rule and headings left-aligned over right-aligned amounts; overdrawn the whole month, the DR '
               'written after each amount; a refund to a café booked as a receipt; an importer debited twice '
               'under one lot against one entry; cashbook also as typed XLSX from write_xlsx',
               producer='hexapdf', font='Space Mono', paper='Letter', period=('2030-03-01', '2030-03-31'),
               opening=-15000000, per_page=16, bank=sarawat, document_title='Statement of Account',
               account='SA44 6200 0000 2030 0300 2303', cashbook_xlsx='typed',
               style=styled(rules='none', heading='rule', headings='left'))
    s.roaster(staff=8, lease=None, invoice_scale=(900, 5200), card_scale=(800, 3100), app_scale=(1500, 6200),
              green_scale=(6000, 21000), pack_scale=(1200, 4800), salary_scale=(3900, 8600))
    s.movement('rr', '2030-03-12', 'Outward transfer - refund to Mirqab Coffee', 'CRN-300312', out=46800)
    s.entry('rr', '2030-03-12', 'Credit note Mirqab Coffee CRN-300312', 'CRN-300312', receipt=46800)
    s.intent['review'].append({'bank': ['b:rr'], 'cash': ['c:rr'], 'reason': 'direction-conflict'})
    for k, d in enumerate(['2030-03-20', '2030-03-21'], 1):
        s.movement(f'pd{k}', d, 'Outward SARIE - Harrar Green Traders', 'LOT-300320', out=2315400)
    s.entry('pd', '2030-03-20', 'Green coffee - Harrar Green Traders lot 300320', 'LOT-300320', payment=2315400)
    s.intent['review'].append({'bank': ['b:pd1', 'b:pd2'], 'cash': ['c:pd'], 'reason': 'duplicate-reference'})
    stories.append(s)

    s = Ledger('X04', 2304, 'a quarter on many pages from HexaPDF in Fira Sans on A4 landscape, striped rows and '
               'long descriptions wrapped in their cells; a card settlement valued after the period; the '
               'acquirer\'s quarterly terminal fee; an importer payment valued before the period',
               producer='hexapdf', font='Fira Sans', paper='A4-landscape', period=('2030-04-01', '2030-06-30'),
               opening=27400000, per_page=16, bank=sarawat, document_title='Statement of Account',
               account='SA44 6200 0000 2030 0300 2304', style=styled(rules='stripes', heading='filled'))
    s.roaster(apps=1, staff=9, lease=2240000)
    s.pair('va', day('2030-06-27'), 'card', 'POS-HMA-300627Q', 1984370, booked=day('2030-06-27'),
           value='2030-07-01', acquirer='Hima Pay settlement at the end of the quarter for the roastery shop\'s '
           'card sales of late June held for review', batch='300627', when='2030-06-27')
    s.intent['timing'].append('b:va')
    s.pair('vb', day('2030-04-01'), 'green', 'LOT-300401', 5306180, value='2030-03-28',
           importer='Mocha Coast Imports for the spring lot of washed Yemeni beans shipped through Jeddah port',
           lot='300401')
    s.intent['timing'].append('b:vb')
    s.movement('fee', '2030-06-27', 'Quarterly POS terminal rental fee', out=61000)
    s.intent['bankOnly'].append('b:fee')
    stories.append(s)

    s = Ledger('X05', 2305, 'HexaPDF statement in Work Sans with page totals: page 2\'s deposit total printed '
               'without one of its deposits, the movements and balances as the bank\'s ledger',
               producer='hexapdf', font='Work Sans', paper='A4', period=('2030-05-01', '2030-05-31'),
               opening=18100000, per_page=15, page_totals=True, bank=sarawat,
               document_title='Statement of Account', account='SA44 6200 0000 2030 0300 2305',
               style=styled(rules='grid', heading='filled'))
    s.roaster(staff=9, lease=2240000)
    s.recipe['pageTotalShort'] = [2, 3]
    s.held('balance-broken')
    stories.append(s)

    s = Ledger('X06', 2306, 'pdf-lib statement in Lemonada: page 3 of a four-page statement printed as page 3 of 5',
               producer='pdflib', font='Lemonada', paper='A4', period=('2030-07-01', '2030-07-31'),
               opening=22300000, per_page=16, bank='Harrah Trade Bank', document_title='Account Statement',
               account='SA19 1500 0000 7070 3000 2306', style=styled(rules='rows', heading='rule'))
    s.roaster(staff=10, lease=2380000)
    s.recipe['pageOfChanged'] = 3
    s.held('incomplete-pages')
    stories.append(s)

    s = Ledger('X07', 2307, 'Arabic pdf-lib statement in Alexandria with Arabic-Indic digits, shaped by fontkit and '
               'ordered by bidi-js, each run of one embedding level drawn by its own text call; a full grid and a '
               'grey heading, amounts at the left edge of their cells; a café\'s invoice paid by transfer and '
               'booked six days later; two packaging payments of the same amount on one day against two entries '
               'without references; the acquirer\'s monthly gateway fee, not yet booked',
               producer='pdflib', font='Alexandria', paper='A4', layout='ar', digits='arabic',
               period=('2030-08-01', '2030-08-31'), opening=21400000, per_page=15, bank=harrah,
               document_title='كشف حساب', account='SA19 1500 0000 7070 3000 2307',
               style=styled(rules='grid', heading='grey', amounts='end'))
    s.roaster(staff=10, lease=2380000)
    s.movement('lc', '2030-08-06', 'تحويل وارد - بيت البن', 'INV-3008-414', into=1374520)
    s.entry('lc', '2030-08-12', 'تحصيل بيت البن فاتورة INV-3008-414', 'INV-3008-414', receipt=1374520)
    s.intent['review'].append({'bank': ['b:lc'], 'cash': ['c:lc'], 'reason': 'date-gap'})
    for k in (1, 2):
        s.movement(f'sp{k}', '2030-08-18', 'تحويل صادر - نجران للتغليف', out=845000)
        s.entry(f'sp{k}', '2030-08-18', f'مواد التغليف - نجران للتغليف دفعة {k}', payment=845000)
    s.intent['review'].append({'bank': ['b:sp1', 'b:sp2'], 'cash': ['c:sp1', 'c:sp2'],
                               'reason': 'ambiguous-amount-date'})
    s.movement('gf', '2030-08-29', 'رسوم بوابة الدفع الشهرية', out=42000)
    s.intent['bankOnly'].append('b:gf')
    stories.append(s)

    s = Ledger('X08', 2308, 'Arabic pdf-lib statement in Cairo with Arabic-Indic digits, rules under every row and '
               'a heading filled dark red in white; a description continuing at the top of page 2; a delivery '
               'app\'s payout valued after the period; a returned outward transfer with the bank\'s fee, not '
               'yet booked',
               producer='pdflib', font='Cairo', paper='A4', layout='ar', digits='arabic',
               period=('2030-09-01', '2030-09-30'), opening=19600000, per_page=15, bank=harrah,
               document_title='كشف حساب جاري', account='SA19 1500 0000 7070 3000 2308',
               style=styled(rules='rows', heading='filled'))
    s.roaster(staff=10, lease=2380000)
    s.continuation = {'page': 2, 'text': 'تابع: مرتجعات فواتير أغسطس'}
    s.pair('va', day('2030-09-30'), 'app', 'APP-WSL-300930Q', 1638240, value='2030-10-01', app='واصل إيتس',
           week='40')
    s.intent['timing'].append('b:va')
    s.movement('rt', '2030-09-17', 'حوالة مرتجعة - رقم حساب المستفيد غير صحيح', 'PO-300917-R', into=76400)
    s.movement('rx', '2030-09-17', 'رسوم الحوالة المرتجعة', out=2500)
    s.intent['bankOnly'] += ['b:rt', 'b:rx']
    stories.append(s)

    s = Ledger('X09', 2309, 'Arabic pdf-lib statement in Tajawal with Latin digits, rules under every row and a '
               'heading filled dark teal in white; a packaging payment booked twice in the cashbook under its '
               'reference; an importer payment valued before the period',
               producer='pdflib', font='Tajawal', paper='A4', layout='ar', digits='latin',
               period=('2030-10-01', '2030-10-31'), opening=17900000, per_page=14, bank=harrah,
               document_title='كشف حساب', account='SA19 1500 0000 7070 3000 2309',
               style=styled(rules='rows', heading='filled'))
    s.roaster(staff=9, lease=2380000, gosi=False)
    s.movement('dr', '2030-10-15', 'تحويل صادر - نجران للتغليف', 'PO-301015-NJR', out=312600)
    for k, d in enumerate(['2030-10-15', '2030-10-16'], 1):
        s.entry(f'dr{k}', d, 'مواد التغليف - نجران للتغليف', 'PO-301015-NJR', payment=312600)
    s.intent['review'].append({'bank': ['b:dr'], 'cash': ['c:dr1', 'c:dr2'], 'reason': 'duplicate-reference'})
    s.pair('vb', day('2030-10-03'), 'green', 'LOT-301003', 4417760, value='2030-09-30',
           importer='هرر للبن الأخضر', lot='301003')
    s.intent['timing'].append('b:vb')
    stories.append(s)

    s = Ledger('X10', 2310, 'English pdf-lib statement in Readex Pro on A4 landscape with striped rows and a heading '
               'filled slate in white; a card settlement booked gross against the net credited; a packer\'s '
               'credit note refund not yet booked; cashbook also as text XLSX from SheetJS',
               producer='pdflib', font='Readex Pro', paper='A4-landscape', period=('2030-11-01', '2030-11-30'),
               opening=16700000, per_page=14, bank='Harrah Trade Bank', document_title='Statement of Account',
               account='SA19 1500 0000 7070 3000 2310', cashbook_xlsx='text',
               style=styled(rules='stripes', heading='filled'))
    s.roaster(staff=10, lease=2380000)
    s.movement('gn', '2030-11-20', 'POS settlement - Hima Pay batch 3011209 net of MDR', 'POS-HMA-301120X',
               into=553126)
    s.entry('gn', '2030-11-20', 'Roastery shop card sales 2030-11-20 gross', 'POS-HMA-301120X', receipt=564040)
    s.intent['review'].append({'bank': ['b:gn'], 'cash': ['c:gn'], 'reason': 'amount-difference'})
    s.movement('cn', '2030-11-26', 'Inward transfer - Najran Packaging credit note', 'CN-NJP-3011', into=284500)
    s.intent['bankOnly'].append('b:cn')
    stories.append(s)

    s = Ledger('X11', 2311, 'pdf-lib statement in Rubik with a heading rule and no other rules; a café\'s transfer '
               'without its invoice on the statement, booked two days later; a delivery app\'s payout booked as a '
               'payment',
               producer='pdflib', font='Rubik', paper='A4', period=('2030-12-01', '2030-12-31'),
               opening=24800000, per_page=16, bank='Harrah Trade Bank', document_title='Account Statement',
               account='SA19 1500 0000 7070 3000 2311', style=styled(rules='none', heading='rule'))
    s.roaster(staff=10, lease=2380000)
    s.movement('nr', '2030-12-10', 'Inward transfer - Sidra Roast Bar', into=2238815)
    s.entry('nr', '2030-12-12', 'Receipt Sidra Roast Bar invoice INV-3012-588', 'INV-3012-588', receipt=2238815)
    s.intent['review'].append({'bank': ['b:nr'], 'cash': ['c:nr'], 'reason': 'amount-date-suggestion'})
    s.movement('mp', '2030-12-16', 'Delivery app payout - Wasel Eats', 'APP-WSL-301216S', into=986400)
    s.entry('mp', '2030-12-16', 'Delivery app sales Wasel Eats week 51', 'APP-WSL-301216S', payment=986400)
    s.intent['review'].append({'bank': ['b:mp'], 'cash': ['c:mp'], 'reason': 'direction-conflict'})
    stories.append(s)

    s = Ledger('X12', 2312, 'Arabic pdf-lib statement in Rubik: page 3\'s balance brought forward printed with '
               'two digits swapped, the movements\' balances as the bank\'s ledger',
               producer='pdflib', font='Rubik', paper='A4', layout='ar', digits='arabic',
               period=('2030-06-01', '2030-06-30'), opening=20900000, per_page=14, bank=harrah,
               document_title='كشف حساب', account='SA19 1500 0000 7070 3000 2312',
               style=styled(rules='grid', heading='grey', amounts='end'))
    s.roaster(staff=10, lease=2380000)
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
