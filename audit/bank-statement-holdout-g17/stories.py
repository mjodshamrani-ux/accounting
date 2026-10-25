"""BNK-PDF-1 G17 holdout: new synthetic bank statements and cashbooks as facts.

A ninth generator lineage, written for G17. Nothing is imported from the
foundation's stories.mjs, from the G6, G8, G9, G10, G12, G14 or G15
holdouts' stories.py, from any renderer or from the product. Each story is
the operating account of a food distributor over one period: retail chains
pay their invoices by inward SARIE, each remittance booked from its advice
the same day or up to two business days later; the van-sales routes deposit
their cash at the branch each working day; importers are paid by outward
SARIE each Monday; customs duties are paid by SADAD when a container
clears; the fleet lease goes by standing order on the first business day;
fuel cards are topped up each Sunday; salaries go by a WPS batch by the
27th; and GOSI contributions are paid by SADAD in mid-month. A xoshiro128**
generator, seeded by SplitMix32, draws the amounts and days. The special
events of a story and its expected outcome are written by hand beside it.

The facts follow the foundation's contract (contract.json): one account in
SAR with two decimals, one period per statement, the same column headings,
control lines, account line and page footer. What changes is what the
contract leaves open: the writers (cairo's PDF surface, driven by an
application that shapes with HarfBuzz and orders by the Unicode
Bidirectional Algorithm, and Prawn, the Ruby library), fonts, styles, paper,
periods, banks, accounts, reference styles, narratives, economic
relationships and faults.

Each story lists its statement page by page and line by line as printed.
`recipe` says how the pages were made and styled and which fault was
planted; `intent` is the designer's expected outcome. The independent oracle
reads neither. Amounts are minor units; balances are running balances.

  python3 -B audit/bank-statement-holdout-g17/stories.py > stories.json
"""
import json
import sys
from datetime import date, timedelta

VERSION = 'bank-statement-holdout-g17-1'
WINDOW = 3
WEEKEND = {4, 5}  # Friday and Saturday
MONDAY, SUNDAY = 0, 6
M32 = (1 << 32) - 1


def rotl(x, k):
    return ((x << k) | (x >> (32 - k))) & M32


class Xoshiro128ss:
    """xoshiro128** (Blackman and Vigna), its state filled by SplitMix32:
    the facts regenerate byte for byte on any Python."""

    def __init__(self, seed):
        x, state = seed & M32, []
        for _ in range(4):
            x = (x + 0x9E3779B9) & M32
            z = x
            z = ((z ^ (z >> 16)) * 0x85EBCA6B) & M32
            z = ((z ^ (z >> 13)) * 0xC2B2AE35) & M32
            state.append(z ^ (z >> 16))
        self.s = state

    def next(self):
        s = self.s
        result = (rotl((s[1] * 5) & M32, 7) * 9) & M32
        t = (s[1] << 9) & M32
        s[2] ^= s[0]
        s[3] ^= s[1]
        s[1] ^= s[2]
        s[0] ^= s[3]
        s[2] ^= t
        s[3] = rotl(s[3], 11)
        return result

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


CHAINS = {
    'en': ['Tamimi Markets', 'Danube Hypermarkets', 'Farm Superstores', 'Al Raya Supermarkets', 'Nesto Stores'],
    'ar': ['أسواق التميمي', 'هايبر الدانوب', 'أسواق المزرعة', 'أسواق الراية', 'متاجر نستو'],
}
CODES = ['TAM', 'DAN', 'FRM', 'RAY', 'NES']
IMPORTERS = {
    'en': ['Gulf Rice Importers', 'Al Wafra Dairy Trading', 'Red Sea Canned Foods', 'Najran Dates Co.',
           'Coastal Frozen Foods'],
    'ar': ['مستوردو أرز الخليج', 'الوفرة لتجارة الألبان', 'البحر الأحمر للمعلبات', 'شركة تمور نجران',
           'الساحل للأغذية المجمدة'],
}
WORDS = {
    'en': {
        'retail': ('Inward SARIE - {chain} remittance', 'Collection - {chain} invoices {month}'),
        'cash': ('Cash deposit - van route {route}', 'Van sales cash route {route} {when}'),
        'import': ('Outward SARIE - {importer}', 'Purchases - {importer}'),
        'customs': ('SADAD - Saudi Customs duty', 'Customs duty container {box}'),
        'lease': ('Standing order - fleet lease', 'Delivery fleet lease {month}'),
        'fuel': ('Outward transfer - fuel card top-up', 'Fuel cards week of {when}'),
        'payroll': ('WPS payroll {month}', 'Salaries and allowances {month}'),
        'gosi': ('SADAD - GOSI contributions', 'GOSI contributions {month}'),
    },
    'ar': {
        'retail': ('حوالة سريعة واردة - {chain} سداد', 'تحصيل - فواتير {chain} {month}'),
        'cash': ('إيداع نقدي - خط التوزيع {route}', 'مبيعات نقدية خط {route} {when}'),
        'import': ('حوالة سريعة صادرة - {importer}', 'مشتريات - {importer}'),
        'customs': ('سداد - رسوم الجمارك السعودية', 'رسوم جمركية الحاوية {box}'),
        'lease': ('أمر مستديم - تأجير أسطول التوزيع', 'تأجير أسطول التوزيع {month}'),
        'fuel': ('تحويل صادر - شحن بطاقات الوقود', 'بطاقات الوقود أسبوع {when}'),
        'payroll': ('رواتب حماية الأجور {month}', 'الرواتب والبدلات {month}'),
        'gosi': ('سداد - اشتراكات التأمينات الاجتماعية', 'اشتراكات التأمينات {month}'),
    },
}
INFLOW = {'retail', 'cash'}
MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر',
             'ديسمبر']


class Ledger:
    def __init__(self, sid, seed, title, *, producer, font, paper, period, opening, per_page, bank,
                 document_title, account, layout='en', digits=None, page_totals=False, cashbook_xlsx=None,
                 style=None):
        self.rng = Xoshiro128ss(seed)
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

    def month_label(self, d):
        return f'{d:%Y-%m}' if self.layout == 'en' else f'{MONTHS_AR[d.month - 1]} {d.year}'

    def movement(self, key, when, text, reference='', *, out=0, into=0, value=None):
        assert (out > 0) != (into > 0) and self.period['start'] <= when <= self.period['end']
        self.movements.append({'key': f'b:{key}', 'date': when, 'valueDate': value or when, 'description': text,
                               'reference': reference, 'withdrawal': out, 'deposit': into})

    def entry(self, key, when, text, reference='', *, receipt=0, payment=0):
        assert (receipt > 0) != (payment > 0)
        self.vouchers += 1
        voucher = f"{'CR' if receipt else 'CP'}/{self.id}/{self.vouchers:04d}"
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

    def distributor(self, *, chains, routes, importers, staff, retail_scale=(18000, 96000),
                    cash_scale=(2500, 9800), import_scale=(30000, 180000), salary_scale=(4200, 13500),
                    lease=None, customs=True, fuel=True, gosi=True):
        """The distributor's own period.

        Retail: on each business day, with one chance in two, one chain
        pays; the remittance is booked from its advice on a business day
        from that day to three days later.
        Cash: each business day one van route deposits its takings, booked
        that day.
        Imports: each Monday one or two importers are paid.
        Customs: two containers clear each month, on a business day from the
        3rd to the 9th and from the 17th to the 23rd.
        Lease: by standing order on the first business day of the month.
        Fuel: the cards are topped up each Sunday.
        Payroll: one WPS batch on the last business day by the 27th.
        GOSI: by SADAD on a business day from the 12th to the 15th."""
        r, L = self.rng, self.layout
        start, end = day(self.period['start']), day(self.period['end'])
        n = 0
        d = start
        while d <= end:
            if business(d):
                if r.below(2):
                    i = r.below(chains)
                    days = [b for b in (d + timedelta(days=k) for k in range(WINDOW + 1)) if business(b)]
                    booked = days[r.below(len(days))]
                    if self.inside(booked):
                        n += 1
                        self.pair(f'T{n}', d, 'retail', f'RMT-{CODES[i]}-{d:%y%m%d}', r.money(*retail_scale),
                                  booked=booked, chain=CHAINS[L][i], month=self.month_label(d))
                route = 1 + r.below(routes)
                n += 1
                self.pair(f'V{n}', d, 'cash', f'DEP-{d:%y%m%d}-R{route}', r.money(*cash_scale), route=route,
                          when=iso(d))
            if d.weekday() == MONDAY and business(d):
                for _ in range(r.between(1, 2)):
                    n += 1
                    importer = IMPORTERS[L][r.below(importers)]
                    self.pair(f'P{n}', d, 'import', f'IMP-{d:%y%m%d}-{n:03d}', r.money(*import_scale),
                              importer=importer)
            if fuel and d.weekday() == SUNDAY:
                n += 1
                self.pair(f'F{n}', d, 'fuel', f'FUEL-{d:%y%m%d}', r.money(3800, 9600), when=iso(d))
            d += timedelta(days=1)
        month = start.replace(day=1)
        while month <= end:
            label = self.month_label(month)
            if lease:
                paid = next_business(month)
                if self.inside(paid):
                    n += 1
                    self.pair(f'L{n}', paid, 'lease', f'SO-FLEET-{month:%y%m}', lease, month=label)
            if customs:
                for lo, hi in ((2, 8), (16, 22)):
                    paid = next_business(month + timedelta(days=r.between(lo, hi)))
                    if self.inside(paid):
                        n += 1
                        box = f'MSKU{r.below(10 ** 7):07d}'
                        self.pair(f'C{n}', paid, 'customs', f'SADAD-{r.between(10 ** 4, 10 ** 5 - 1)}{r.below(10 ** 5):05d}',
                                  r.money(4500, 41000), box=box)
            pay = previous_business(month.replace(day=27))
            if self.inside(pay):
                n += 1
                self.pair(f'W{n}', pay, 'payroll', f'WPS-{pay:%y%m}',
                          sum(r.money(*salary_scale) for _ in range(staff)), month=label)
            if gosi:
                paid = next_business(month + timedelta(days=r.between(11, 14)))
                if self.inside(paid):
                    n += 1
                    self.pair(f'G{n}', paid, 'gosi', f'GOSI-{month:%y%m}', r.money(9000, 38000), month=label)
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

    s = Ledger('V01', 7101, 'Prawn statement in Libre Franklin with a full grid and a heading filled green in '
               'white; a chain\'s remittance booked five days after it arrived; an importer\'s refund credited '
               'by the bank and not yet booked; a cheque to a packaging supplier not yet presented',
               producer='prawn', font='Libre Franklin', paper='A4', period=('2028-01-01', '2028-01-31'),
               opening=61200000, per_page=16, bank='Peninsula Trade Bank', document_title='Statement of Account',
               account='SA44 6100 0000 7070 2200 7101', style=styled(rules='grid', heading='filled'))
    s.distributor(chains=4, routes=6, importers=5, staff=30, lease=8400000)
    s.movement('lr', '2028-01-18', 'Inward SARIE - Farm Superstores remittance', 'RMT-FRM-271229', into=7425310)
    s.entry('lr', '2028-01-23', 'Collection - Farm Superstores invoices 2027-12', 'RMT-FRM-271229',
            receipt=7425310)
    s.intent['review'].append({'bank': ['b:lr'], 'cash': ['c:lr'], 'reason': 'date-gap'})
    s.movement('ir', '2028-01-26', 'Inward SARIE - Coastal Frozen Foods short shipment refund', 'CN-CFF-28012',
               into=588200)
    s.intent['bankOnly'].append('b:ir')
    s.entry('oc', '2028-01-30', 'Packaging - Riyadh Carton Factory by cheque', 'CHQ-205514', payment=2310000)
    s.intent['cashOnly'].append('c:oc')
    stories.append(s)

    s = Ledger('V02', 7102, 'Prawn statement in Merriweather with rules under every row and page totals; a '
               'chain\'s remittance short of its invoices by a promotional rebate; two cash deposits of the '
               'same amount on one day against two equal entries; an importer paid without the reference on '
               'the statement; a cheque to a cold-store contractor not yet presented',
               producer='prawn', font='Merriweather', paper='A4', period=('2028-02-01', '2028-02-29'),
               opening=77300000, per_page=14, page_totals=True, bank='Peninsula Trade Bank',
               document_title='Account Statement', account='SA44 6100 0000 7070 2200 7102',
               style=styled(rules='rows', heading='rule'))
    s.distributor(chains=4, routes=5, importers=5, staff=26, lease=8400000)
    s.movement('rb', '2028-02-16', 'Inward SARIE - Danube Hypermarkets remittance net', 'RMT-DAN-280214N',
               into=5208840)
    s.entry('rb', '2028-02-16', 'Collection - Danube Hypermarkets invoices 2028-01', 'RMT-DAN-280214N',
            receipt=5263390)
    s.intent['review'].append({'bank': ['b:rb'], 'cash': ['c:rb'], 'reason': 'amount-difference'})
    for k in (1, 2):
        s.movement(f'cd{k}', '2028-02-10', 'Cash deposit - branch counter', into=315000)
        s.entry(f'cd{k}', '2028-02-10', f'Showroom counter takings, bag {k}', receipt=315000)
    s.intent['review'].append({'bank': ['b:cd1', 'b:cd2'], 'cash': ['c:cd1', 'c:cd2'],
                               'reason': 'ambiguous-amount-date'})
    s.movement('nr', '2028-02-22', 'Outward SARIE - Al Wafra Dairy Trading', out=3104750)
    s.entry('nr', '2028-02-23', 'Purchases - Al Wafra Dairy Trading', 'IMP-280222-AW', payment=3104750)
    s.intent['review'].append({'bank': ['b:nr'], 'cash': ['c:nr'], 'reason': 'amount-date-suggestion'})
    s.entry('oc', '2028-02-27', 'Cold store maintenance - Arctic Air by cheque', 'CHQ-205689', payment=1475000)
    s.intent['cashOnly'].append('c:oc')
    stories.append(s)

    s = Ledger('V03', 7103, 'monospaced Prawn statement in Ubuntu Mono on US Letter with no rules but a heading '
               'rule, headings left-aligned over right-aligned amounts; overdrawn the whole month, the DR written '
               'after each amount; a returned delivery refund booked as a receipt; a customs payment debited '
               'twice under one SADAD number against one entry; cashbook also as typed XLSX from caxlsx',
               producer='prawn', font='Ubuntu Mono', paper='Letter', period=('2028-03-01', '2028-03-31'),
               opening=-38500000, per_page=15, bank='Peninsula Trade Bank', document_title='Statement of Account',
               account='SA44 6100 0000 7070 2200 7103', cashbook_xlsx='typed',
               style=styled(rules='none', heading='rule', headings='left'))
    s.distributor(chains=5, routes=6, importers=5, staff=28, customs=False)
    s.movement('rf', '2028-03-14', 'Outward SARIE - Nesto Stores returned goods refund', 'RTN-NES-2803', out=212000)
    s.entry('rf', '2028-03-14', 'Refund to Nesto Stores for returned goods', 'RTN-NES-2803', receipt=212000)
    s.intent['review'].append({'bank': ['b:rf'], 'cash': ['c:rf'], 'reason': 'direction-conflict'})
    for k, d in enumerate(['2028-03-08', '2028-03-09'], 1):
        s.movement(f'cu{k}', d, 'SADAD - Saudi Customs duty', 'SADAD-4471902385', out=2833460)
    s.entry('cu', '2028-03-08', 'Customs duty container MSKU5520318', 'SADAD-4471902385', payment=2833460)
    s.intent['review'].append({'bank': ['b:cu1', 'b:cu2'], 'cash': ['c:cu'], 'reason': 'duplicate-reference'})
    stories.append(s)

    s = Ledger('V04', 7104, 'a quarter on many pages from Prawn in Nunito Sans on A4 landscape, striped rows and '
               'long descriptions wrapped in their cells; a chain\'s remittance valued after the period; the '
               'bank\'s quarterly account fee; a customs payment valued before the period',
               producer='prawn', font='Nunito Sans', paper='A4-landscape', period=('2028-04-01', '2028-06-30'),
               opening=72500000, per_page=15, bank='Peninsula Trade Bank', document_title='Statement of Account',
               account='SA44 6100 0000 7070 2200 7104', style=styled(rules='stripes', heading='filled'))
    s.distributor(chains=3, routes=3, importers=5, staff=18, lease=7900000, fuel=False)
    s.pair('va', day('2028-06-29'), 'retail', 'RMT-RAY-280629Q', 6618430, booked=day('2028-06-29'),
           value='2028-07-02', chain='Al Raya Supermarkets quarter-end rebate settlement for May and June',
           month='2028-06')
    s.intent['timing'].append('b:va')
    s.pair('vb', day('2028-04-02'), 'customs', 'SADAD-5530119847', 1906520, value='2028-03-30',
           box='MSKU3398210 delayed at Jeddah Islamic Port')
    s.intent['timing'].append('b:vb')
    s.movement('fee', '2028-06-29', 'Quarterly account maintenance fee', out=41500)
    s.intent['bankOnly'].append('b:fee')
    stories.append(s)

    s = Ledger('V05', 7105, 'a van-route deposit printed twice on page 2, one row under the other, the balances '
               'counting it once',
               producer='prawn', font='Libre Franklin', paper='A4', period=('2028-05-01', '2028-05-31'),
               opening=51800000, per_page=13, bank='Peninsula Trade Bank', document_title='Statement of Account',
               account='SA44 6100 0000 7070 2200 7105', style=styled(rules='grid', heading='filled'))
    s.distributor(chains=4, routes=5, importers=5, staff=22, lease=7900000)
    s.recipe['printedTwice'] = [2, 5]
    s.held('balance-broken')
    stories.append(s)

    s = Ledger('V06', 7106, 'cairo statement in Work Sans, page 3 printed under the number of page 2: pages 1, '
               '2 and 2 of 3',
               producer='cairo', font='Work Sans', paper='A4', period=('2028-07-01', '2028-07-31'),
               opening=64100000, per_page=12, bank='Hijaz Commercial Bank', document_title='Account Statement',
               account='SA19 2500 0000 3838 6600 7106', style=styled(rules='rows', heading='rule'))
    s.distributor(chains=3, routes=3, importers=5, staff=20, lease=7900000, fuel=False)
    s.recipe['numberedAsPrevious'] = 3
    s.held('incomplete-pages')
    stories.append(s)

    s = Ledger('V07', 7107, 'Arabic cairo statement in Readex Pro with Arabic-Indic digits, shaped by HarfBuzz '
               'and ordered by the Unicode Bidirectional Algorithm, each run of one font and direction drawn '
               'as one glyph run, so that a date prints as runs of digits and hyphens; a full grid; a chain\'s '
               'remittance booked five days after it arrived; an importer paid twice on one day against two '
               'entries without references; the bank\'s monthly cash-handling fee, not yet booked',
               producer='cairo', font='Readex Pro', paper='A4', layout='ar', digits='arabic',
               period=('2028-08-01', '2028-08-31'), opening=62600000, per_page=13, bank='بنك الحجاز التجاري',
               document_title='كشف حساب', account='SA19 2500 0000 3838 6600 7107',
               style=styled(rules='grid', heading='grey'))
    s.distributor(chains=4, routes=4, importers=5, staff=24, lease=8600000)
    s.movement('lr', '2028-08-09', 'حوالة سريعة واردة - أسواق التميمي سداد متأخر', 'RMT-TAM-280804L',
               into=4418760)
    s.entry('lr', '2028-08-14', 'تحصيل - فواتير أسواق التميمي يوليو 2028', 'RMT-TAM-280804L', receipt=4418760)
    s.intent['review'].append({'bank': ['b:lr'], 'cash': ['c:lr'], 'reason': 'date-gap'})
    for k in (1, 2):
        s.movement(f'ip{k}', '2028-08-21', 'حوالة سريعة صادرة - شركة تمور نجران', out=1247500)
        s.entry(f'ip{k}', '2028-08-21', f'مشتريات - شركة تمور نجران شحنة {k}', payment=1247500)
    s.intent['review'].append({'bank': ['b:ip1', 'b:ip2'], 'cash': ['c:ip1', 'c:ip2'],
                               'reason': 'ambiguous-amount-date'})
    s.movement('hf', '2028-08-31', 'رسوم خدمة إيداع النقد', out=31000)
    s.intent['bankOnly'].append('b:hf')
    stories.append(s)

    s = Ledger('V08', 7108, 'Arabic cairo statement in Rubik with Arabic-Indic digits, rules under every row and '
               'a heading filled navy in white; a description continuing at the top of page 2; a chain\'s '
               'remittance valued after the period; a dishonoured customer cheque with the bank\'s fee, not yet '
               'booked',
               producer='cairo', font='Rubik', paper='A4', layout='ar', digits='arabic',
               period=('2028-09-01', '2028-09-30'), opening=48900000, per_page=13, bank='بنك الحجاز التجاري',
               document_title='كشف حساب جاري', account='SA19 2500 0000 3838 6600 7108',
               style=styled(rules='rows', heading='filled'))
    s.distributor(chains=4, routes=4, importers=5, staff=22, lease=8600000)
    s.continuation = {'page': 2, 'text': 'تابع: خصومات العرض الترويجي لأغسطس'}
    s.pair('va', day('2028-09-28'), 'retail', 'RMT-DAN-280928Q', 3874120, booked=day('2028-09-28'),
           value='2028-10-01', chain='هايبر الدانوب', month='سبتمبر 2028')
    s.intent['timing'].append('b:va')
    s.movement('rc', '2028-09-18', 'شيك مرتجع - رصيد غير كاف', 'CHQ-618203-R', out=438000)
    s.movement('rx', '2028-09-18', 'رسوم الشيك المرتجع', out=5750)
    s.intent['bankOnly'] += ['b:rc', 'b:rx']
    stories.append(s)

    s = Ledger('V09', 7109, 'Arabic cairo statement in Alexandria with Latin digits, rules under every row and a '
               'heading filled dark green in white; a chain\'s refund booked twice in the cashbook under its '
               'reference; a customs payment valued before the period',
               producer='cairo', font='Alexandria', paper='A4', layout='ar', digits='latin',
               period=('2028-10-01', '2028-10-31'), opening=41700000, per_page=13, bank='بنك الحجاز التجاري',
               document_title='كشف حساب', account='SA19 2500 0000 3838 6600 7109',
               style=styled(rules='rows', heading='filled'))
    s.distributor(chains=4, routes=4, importers=5, staff=21, lease=8600000, gosi=False)
    s.movement('ov', '2028-10-17', 'حوالة سريعة صادرة - رد مبلغ أسواق الراية', 'RTN-RAY-2810', out=164500)
    for k, d in enumerate(['2028-10-17', '2028-10-18'], 1):
        s.entry(f'ov{k}', d, 'رد مبلغ لأسواق الراية بضاعة مرتجعة', 'RTN-RAY-2810', payment=164500)
    s.intent['review'].append({'bank': ['b:ov'], 'cash': ['c:ov1', 'c:ov2'], 'reason': 'duplicate-reference'})
    s.pair('vb', day('2028-10-01'), 'customs', 'SADAD-6620841173', 1288340, value='2028-09-28',
           box='MSKU7741206')
    s.intent['timing'].append('b:vb')
    stories.append(s)

    s = Ledger('V10', 7110, 'English cairo statement in Public Sans on A4 landscape with striped rows and a '
               'heading filled maroon in white; a chain\'s remittance net of a listing fee; an importer\'s '
               'credit note refund not yet booked; cashbook also as text XLSX from fastexcel',
               producer='cairo', font='Public Sans', paper='A4-landscape', period=('2028-11-01', '2028-11-30'),
               opening=36400000, per_page=13, bank='Hijaz Commercial Bank', document_title='Statement of Account',
               account='SA19 2500 0000 3838 6600 7110', cashbook_xlsx='text',
               style=styled(rules='stripes', heading='filled'))
    s.distributor(chains=4, routes=5, importers=5, staff=25, lease=9100000)
    s.movement('ln', '2028-11-22', 'Inward SARIE - Tamimi Markets remittance less listing fee', 'RMT-TAM-281121N',
               into=2961900)
    s.entry('ln', '2028-11-22', 'Collection - Tamimi Markets invoices 2028-10', 'RMT-TAM-281121N', receipt=3011900)
    s.intent['review'].append({'bank': ['b:ln'], 'cash': ['c:ln'], 'reason': 'amount-difference'})
    s.movement('cn', '2028-11-27', 'Inward SARIE - Gulf Rice Importers credit note', 'CN-GRI-2811', into=427350)
    s.intent['bankOnly'].append('b:cn')
    stories.append(s)

    s = Ledger('V11', 7111, 'monospaced cairo statement in Source Code Pro with a heading rule and no other '
               'rules; a chain\'s remittance without its reference on the statement, booked two days later; a '
               'van-route deposit booked as a payment; overdraft never reached',
               producer='cairo', font='Source Code Pro', paper='A4', period=('2028-12-01', '2028-12-31'),
               opening=70800000, per_page=15, bank='Hijaz Commercial Bank', document_title='Account Statement',
               account='SA19 2500 0000 3838 6600 7111', style=styled(rules='none', heading='rule'))
    s.distributor(chains=4, routes=5, importers=5, staff=27, lease=9100000)
    s.movement('nr', '2028-12-13', 'Inward SARIE - Al Raya Supermarkets', into=6905415)
    s.entry('nr', '2028-12-15', 'Collection - Al Raya Supermarkets invoices 2028-11', 'RMT-RAY-281213X',
            receipt=6905415)
    s.intent['review'].append({'bank': ['b:nr'], 'cash': ['c:nr'], 'reason': 'amount-date-suggestion'})
    s.movement('dp', '2028-12-19', 'Cash deposit - van route 9', 'DEP-281219-R9', into=528000)
    s.entry('dp', '2028-12-19', 'Van sales cash route 9 2028-12-19', 'DEP-281219-R9', payment=528000)
    s.intent['review'].append({'bank': ['b:dp'], 'cash': ['c:dp'], 'reason': 'direction-conflict'})
    stories.append(s)

    s = Ledger('V12', 7112, 'Arabic cairo statement in Readex Pro: a chain\'s remittance printed in the '
               'withdrawal column on page 2, the balances as the bank\'s ledger credited it',
               producer='cairo', font='Readex Pro', paper='A4', layout='ar', digits='arabic',
               period=('2028-06-01', '2028-06-30'), opening=40300000, per_page=12, bank='بنك الحجاز التجاري',
               document_title='كشف حساب', account='SA19 2500 0000 3838 6600 7112',
               style=styled(rules='grid', heading='grey'))
    s.distributor(chains=4, routes=4, importers=5, staff=21, lease=8600000)
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
