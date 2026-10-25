"""BNK-PDF-1 G14 holdout: new synthetic bank statements and cashbooks as facts.

A seventh generator lineage, written for G14. Nothing is imported from the
foundation's stories.mjs, from the G6, G8, G9, G10 or G12 holdouts' stories.py,
from any renderer or from the product. Each story is the operating account of
a private school over one period: families pay tuition by SADAD bill, by
transfer under the student's number, or by card at the school office, which
the bank settles the next business day; staff are paid by a WPS payroll batch
before the 27th; GOSI contributions are paid by SADAD in mid-month; suppliers
are paid in a run each Tuesday; and the bus contractor is paid by a cheque
that is presented within days. A PCG32 generator draws the amounts and days.
The special events of a story and its expected outcome are written by hand
beside it.

The facts follow the foundation's contract (contract.json): one account in
SAR with two decimals, one period per statement, the same column headings,
control lines, account line and page footer. What changes is what the
contract leaves open: the writers (TCPDF and mPDF, the PHP libraries), fonts,
styles, paper, periods, banks, accounts, reference styles, narratives,
economic relationships and faults.

Each story lists its statement page by page and line by line as printed.
`recipe` says how the pages were made and styled and which fault was
planted; `intent` is the designer's expected outcome. The independent oracle
reads neither. Amounts are minor units; balances are running balances.

  python3 -B audit/bank-statement-holdout-g14/stories.py > stories.json
"""
import json
import sys
from datetime import date, timedelta

VERSION = 'bank-statement-holdout-g14-1'
WINDOW = 3
WEEKEND = {4, 5}  # Friday and Saturday
TUESDAY = 1
M64 = (1 << 64) - 1


class Pcg32:
    """PCG32 (O'Neill, XSH RR 64/32), seeded with a stream: the facts
    regenerate byte for byte on any Python."""

    def __init__(self, seed, stream=54):
        self.state, self.inc = 0, ((stream << 1) | 1) & M64
        self.next()
        self.state = (self.state + seed) & M64
        self.next()

    def next(self):
        old = self.state
        self.state = (old * 6364136223846793005 + self.inc) & M64
        shifted = (((old >> 18) ^ old) >> 27) & 0xFFFFFFFF
        rot = old >> 59
        return ((shifted >> rot) | (shifted << ((-rot) & 31))) & 0xFFFFFFFF

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


PARENTS = {
    'en': ['Ibrahim Al Rashid', 'Mona Al Sudairi', 'Saad Al Muqbil', 'Hessa Al Tamimi', 'Nawaf Al Buqami',
           'Amal Al Dawood', 'Mishal Al Fayez', 'Jawaher Al Sahli', 'Talal Al Qarni', 'Wafa Al Omari',
           'Ziyad Al Ruwaili', 'Abeer Al Yami', 'Hamad Al Mazroa', 'Shatha Al Khathlan', 'Rakan Al Dossary',
           'Ghada Al Thunayan'],
    'ar': ['إبراهيم الراشد', 'منى السديري', 'سعد المقبل', 'حصة التميمي', 'نواف البقمي',
           'أمل الداود', 'مشعل الفايز', 'جواهر السهلي', 'طلال القرني', 'وفاء العمري',
           'زياد الرويلي', 'عبير اليامي', 'حمد المزروع', 'شذى الخثلان', 'راكان الدوسري',
           'غادة الثنيان'],
}
SUPPLIERS = {
    'en': ['Jarir Bookstore', 'Al Waha Uniforms', 'Fresh Bites Catering', 'Najm Stationery', 'Clean Pro Services',
           'Smart Boards Co.'],
    'ar': ['مكتبة جرير', 'الواحة للزي المدرسي', 'المذاق الطازج للتموين', 'نجم للقرطاسية', 'كلين برو للخدمات',
           'شركة السبورات الذكية'],
}
BUS = {'en': 'Al Masar School Transport', 'ar': 'المسار للنقل المدرسي'}
WORDS = {
    'en': {
        'sadad': ('SADAD tuition - student {student}', 'Tuition {student} {parent}'),
        'transfer': ('Inward SARIE - {parent} school fees', 'Tuition {student} {parent}'),
        'pos': ('POS settlement mada terminal {terminal}', 'Card receipts {when}'),
        'payroll': ('WPS payroll batch {month}', 'Salaries {month}'),
        'gosi': ('GOSI contributions SADAD', 'GOSI contributions {month}'),
        'supplier': ('Outward SARIE - {supplier}', 'Purchases - {supplier}'),
        'bus': ('Cheque {number} presented', 'School transport - {contractor}'),
        'cheque': ('Cheque deposit clearing', 'Tuition {student} {parent} by cheque'),
    },
    'ar': {
        'sadad': ('سداد - رسوم دراسية الطالب {student}', 'قسط دراسي {student} {parent}'),
        'transfer': ('حوالة سريعة واردة - {parent} رسوم دراسية', 'قسط دراسي {student} {parent}'),
        'pos': ('تسوية نقاط البيع مدى جهاز {terminal}', 'مقبوضات بطاقات مدى {when}'),
        'payroll': ('دفعة رواتب حماية الأجور {month}', 'رواتب شهر {month}'),
        'gosi': ('التأمينات الاجتماعية - سداد', 'اشتراكات التأمينات {month}'),
        'supplier': ('حوالة سريعة صادرة - {supplier}', 'مشتريات - {supplier}'),
        'bus': ('شيك رقم {number} مقدم للصرف', 'النقل المدرسي - {contractor}'),
        'cheque': ('مقاصة شيك مودع', 'قسط دراسي {student} {parent} بشيك'),
    },
}
INFLOW = {'sadad', 'transfer', 'pos', 'cheque'}
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
        voucher = f"{'RC' if receipt else 'PY'}/{self.id}/{self.vouchers:04d}"
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

    def school(self, *, families, staff, suppliers, prefix, terminal, fee_scale=(70, 240),
               salary_scale=(5000, 11000), supply_scale=(800, 45000), bus=True, payroll=True):
        """The school's own month.

        Tuition: each family pays one instalment a month on a business day
        from the 1st to the 20th, by SADAD bill (booked from the SADAD report
        that day or the next business day), by transfer under the student's
        number (booked 0..2 days later), or by card at the school office;
        each day's card payments are settled by the bank the next business
        day and booked on the day they were taken, at most three days before
        across a weekend.
        Payroll: one WPS batch on the last business day by the 27th.
        GOSI: by SADAD on a business day from the 10th to the 15th.
        Suppliers: a run of one or two payments each Tuesday.
        Bus: a cheque written on the 3rd business day and presented one to
        three days later."""
        r, L = self.rng, self.layout
        start, end = day(self.period['start']), day(self.period['end'])
        fees = [r.between(*fee_scale) * 5000 for _ in range(families)]
        month, m, n = start.replace(day=1), 0, 0
        while month <= end:
            m += 1
            label = f'{month:%Y-%m}' if L == 'en' else f'{MONTHS_AR[month.month - 1]} {month.year}'
            cards = {}
            for f in range(families):
                student, parent = f'{prefix}{f + 1:03d}', PARENTS[L][f % len(PARENTS[L])]
                channel = ('sadad', 'transfer', 'pos', 'sadad')[f % 4]
                paid = next_business(month + timedelta(days=r.between(0, 19)))
                n += 1
                if channel == 'sadad':
                    booked = next_business(paid + timedelta(days=r.between(0, 1)))
                    if self.inside(paid):
                        self.pair(f'F{n}', paid, 'sadad', f'SADAD-{r.between(10 ** 4, 10 ** 5 - 1)}{r.below(10 ** 5):05d}',
                                  fees[f], booked=self.clamp(booked), student=student, parent=parent)
                elif channel == 'transfer':
                    booked = self.clamp(paid + timedelta(days=r.between(0, 2)))
                    if self.inside(paid):
                        self.pair(f'F{n}', paid, 'transfer', f'STU-{student}-{m:02d}', fees[f], booked=booked,
                                  student=student, parent=parent)
                else:
                    cards.setdefault(paid, []).append(fees[f])
            for taken in sorted(cards):
                settled = next_business(taken + timedelta(days=1))
                if self.inside(taken) and self.inside(settled):
                    n += 1
                    self.pair(f'P{n}', settled, 'pos', f'POS-{terminal}-{taken:%y%m%d}', sum(cards[taken]),
                              booked=taken, terminal=terminal, when=iso(taken))
            gosi = next_business(month + timedelta(days=r.between(9, 14)))
            if self.inside(gosi):
                n += 1
                self.pair(f'G{n}', gosi, 'gosi', f'SADAD-{r.between(10 ** 4, 10 ** 5 - 1)}{r.below(10 ** 5):05d}',
                          r.money(staff * 600, staff * 1100), month=label)
            if payroll:
                pay = previous_business(month.replace(day=27))
                if self.inside(pay):
                    n += 1
                    self.pair(f'W{n}', pay, 'payroll', f'WPS-{pay:%y%m}',
                              sum(r.money(*salary_scale) for _ in range(staff)), month=label)
            if bus:
                written = next_business(month)
                for _ in range(2):
                    written = next_business(written + timedelta(days=1))
                presented = next_business(written + timedelta(days=r.between(1, 3)))
                if self.inside(presented) and (presented - written).days <= WINDOW:
                    n += 1
                    number = f'{r.between(100000, 999999)}'
                    self.movement(f'B{n}', iso(presented), WORDS[L]['bus'][0].format(number=number),
                                  f'CHQ-{number}', out=r.money(18000, 42000))
                    amount = self.movements[-1]['withdrawal']
                    self.entry(f'B{n}', iso(written), WORDS[L]['bus'][1].format(contractor=BUS[L]),
                               f'CHQ-{number}', payment=amount)
                    self.intent['auto'].append([f'b:B{n}', f'c:B{n}'])
            month = (month + timedelta(days=32)).replace(day=1)
        d = start
        while d <= end:
            if d.weekday() == TUESDAY and business(d):
                for _ in range(r.between(1, 2)):
                    n += 1
                    supplier = SUPPLIERS[L][r.below(suppliers)]
                    self.pair(f'S{n}', d, 'supplier', f'PAY-{d:%y%m%d}-{n:03d}', r.money(*supply_scale),
                              supplier=supplier)
            d += timedelta(days=1)

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
        if 'transposed' in self.recipe:
            page, index = self.recipe['transposed']
            line = [l for l in pages[page - 1]['lines'] if l['kind'] == 'movement'][index]
            amount = str(line['withdrawal'])
            assert len(amount) >= 4 and amount[-4] != amount[-3]
            line['withdrawal'] = int(amount[:-4] + amount[-3] + amount[-4] + amount[-2:])
        if 'staleBroughtForward' in self.recipe:
            page, delta = self.recipe['staleBroughtForward']
            lines = pages[page - 1]['lines']
            assert lines[0]['kind'] == 'brought-forward'
            lines[0]['balance'] += delta
        if 'lastFooterOf' in self.recipe:
            pages[-1]['of'] = self.recipe['lastFooterOf']
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

    s = Ledger('R01', 3001, 'TCPDF table drawn cell by cell in the standard Helvetica, not embedded, with a full '
               'grid and a heading filled navy in white; headings left-aligned over right-aligned amounts; the '
               'bus contractor\'s cheque presented six days after it was written; a day\'s card receipts booked '
               'gross against the bank\'s net settlement; the bank\'s monthly fee not yet booked',
               producer='tcpdf', font='Helvetica', paper='A4', period=('2027-01-01', '2027-01-31'),
               opening=48200000, per_page=14, bank='Riyadh Learning Bank', document_title='Statement of Account',
               account='SA14 6500 0000 7070 1400 3001', style=styled(api='cell', rules='grid', heading='filled'))
    s.school(families=14, staff=22, suppliers=6, prefix='A', terminal='4471', bus=False)
    s.movement('cq', '2027-01-17', 'Cheque 640118 presented', 'CHQ-640118', out=2865000)
    s.entry('cq', '2027-01-11', 'School transport - Al Masar School Transport', 'CHQ-640118', payment=2865000)
    s.intent['review'].append({'bank': ['b:cq'], 'cash': ['c:cq'], 'reason': 'date-gap'})
    s.movement('ps', '2027-01-26', 'POS settlement mada terminal 4471', 'POS-4471-270125', into=1188120)
    s.entry('ps', '2027-01-25', 'Card receipts 2027-01-25 gross', 'POS-4471-270125', receipt=1200000)
    s.intent['review'].append({'bank': ['b:ps'], 'cash': ['c:ps'], 'reason': 'amount-difference'})
    s.movement('fee', '2027-01-31', 'Account maintenance fee', out=11500)
    s.intent['bankOnly'].append('b:fee')
    stories.append(s)

    s = Ledger('R02', 3002, 'Arabic TCPDF statement in IBM Plex Sans Arabic with Latin digits, shaped and ordered by '
               'TCPDF itself, a heading filled teal in white in rows as tall as the type, and rules under every '
               'row; two equal cash deposits on one day against two equal receipts; a refund to a withdrawing '
               'student booked as a receipt; GOSI valued before the period',
               producer='tcpdf', font='IBM Plex Sans Arabic', paper='A4', layout='ar', digits='latin',
               period=('2027-02-01', '2027-02-28'), opening=35500000, per_page=12, bank='مصرف الرياض للتعليم',
               document_title='كشف حساب', account='SA14 6500 0000 7070 1400 3002',
               style=styled(api='cell', rules='rows', heading='filled-tight'))
    s.school(families=12, staff=18, suppliers=6, prefix='B', terminal='5582')
    for k in (1, 2):
        s.movement(f'cd{k}', '2027-02-16', 'إيداع نقدي - جهاز الإيداع فرع العليا', into=420000)
        s.entry(f'cd{k}', '2027-02-16', f'رسوم نقدية مستلمة - دفتر الإيصالات {k}', receipt=420000)
    s.intent['review'].append({'bank': ['b:cd1', 'b:cd2'], 'cash': ['c:cd1', 'c:cd2'],
                               'reason': 'ambiguous-amount-date'})
    s.movement('rf', '2027-02-21', 'حوالة سريعة صادرة - استرداد رسوم الطالب B013', 'RFD-B013-27', out=650000)
    s.entry('rf', '2027-02-21', 'استرداد رسوم الطالب B013 لانسحابه', 'RFD-B013-27', receipt=650000)
    s.intent['review'].append({'bank': ['b:rf'], 'cash': ['c:rf'], 'reason': 'direction-conflict'})
    s.pair('vb', day('2027-02-01'), 'gosi', 'SADAD-7716045118', 1764310, value='2027-01-31', month='2027-01')
    s.intent['timing'].append('b:vb')
    stories.append(s)

    s = Ledger('R03', 3003, 'monospaced TCPDF statement in DejaVu Sans Mono on US Letter with no rules; overdrawn '
               'the whole month, the DR written after each amount with one space; a '
               'supplier payment without its reference on the statement, booked a day later; a cheque to a '
               'supplier not yet presented; cashbook also as typed XLSX from PhpSpreadsheet',
               producer='tcpdf', font='DejaVu Sans Mono', paper='Letter', period=('2027-03-01', '2027-03-31'),
               opening=-6250000, per_page=13, bank='Riyadh Learning Bank', document_title='Statement of Account',
               account='SA14 6500 0000 7070 1400 3003', cashbook_xlsx='typed',
               style=styled(api='cell', rules='none', heading='rule'))
    s.school(families=13, staff=20, suppliers=6, prefix='C', terminal='6693', fee_scale=(90, 260))
    s.movement('na', '2027-03-17', 'Outward SARIE - Smart Boards Co. interactive panels second floor', out=3874550)
    s.entry('na', '2027-03-18', 'Purchases - Smart Boards Co.', 'PAY-270317-SB', payment=3874550)
    s.intent['review'].append({'bank': ['b:na'], 'cash': ['c:na'], 'reason': 'amount-date-suggestion'})
    s.entry('oc', '2027-03-30', 'Purchases - Najm Stationery by cheque', 'CHQ-640377', payment=418000)
    s.intent['cashOnly'].append('c:oc')
    stories.append(s)

    s = Ledger('R04', 3004, 'Arabic TCPDF statement in DejaVu Sans, TCPDF\'s own Unicode font, with Arabic-Indic '
               'digits, page totals and rules under every row; a SADAD bill paid twice by a family against one '
               'entry; a card day taken on the last day and not yet settled',
               producer='tcpdf', font='DejaVu Sans', paper='A4', layout='ar', digits='arabic',
               period=('2027-04-01', '2027-04-30'), opening=45000000, per_page=11, page_totals=True,
               bank='مصرف الرياض للتعليم', document_title='كشف حساب جاري', account='SA14 6500 0000 7070 1400 3004',
               style=styled(api='cell', rules='rows', heading='rule'))
    s.school(families=12, staff=17, suppliers=6, prefix='D', terminal='7704')
    for k, d in enumerate(['2027-04-12', '2027-04-13'], 1):
        s.movement(f'db{k}', d, 'سداد - رسوم دراسية الطالب D014', 'SADAD-8840529903', into=780000)
    s.entry('db', '2027-04-13', 'قسط دراسي D014 شذى الخثلان', 'SADAD-8840529903', receipt=780000)
    s.intent['review'].append({'bank': ['b:db1', 'b:db2'], 'cash': ['c:db'], 'reason': 'duplicate-reference'})
    s.entry('dt', '2027-04-30', 'مقبوضات بطاقات مدى 2027-04-30', 'POS-7704-270430', receipt=935000)
    s.intent['cashOnly'].append('c:dt')
    stories.append(s)

    s = Ledger('R05', 3005, 'TCPDF statement written as an HTML table by TCPDF\'s writeHTML in DejaVu Serif, a grey '
               'heading row and long descriptions wrapped in their cells; two families\' fees in one transfer '
               'under one reference against two receipts; a parent\'s cheque returned unpaid with the bank\'s '
               'fee, not yet booked',
               producer='tcpdf', font='DejaVu Serif', paper='A4', period=('2027-05-01', '2027-05-31'),
               opening=30000000, per_page=12, bank='Riyadh Learning Bank', document_title='Account Statement',
               account='SA14 6500 0000 7070 1400 3005', style=styled(api='html', rules='grid', heading='grey'))
    s.school(families=12, staff=19, suppliers=6, prefix='E', terminal='8815')
    s.movement('tw', '2027-05-09', 'Inward SARIE - Amal Al Dawood school fees for two children second term',
               'STU-E006-PAIR', into=1530000)
    for k, (student, amount) in enumerate([('E006', 810000), ('E017', 720000)], 1):
        s.entry(f'tw{k}', '2027-05-09', f'Tuition {student} Amal Al Dawood', 'STU-E006-PAIR', receipt=amount)
    s.intent['review'].append({'bank': ['b:tw'], 'cash': ['c:tw1', 'c:tw2'], 'reason': 'duplicate-reference'})
    s.pair('rc', day('2027-05-04'), 'cheque', 'CHQ-552019', 690000, student='E021', parent='Hamad Al Mazroa')
    s.movement('rr', '2027-05-19', 'Returned cheque - account closed', 'CHQ-552019-R', out=690000)
    s.movement('rx', '2027-05-19', 'Returned cheque fee', out=5750)
    s.intent['bankOnly'] += ['b:rr', 'b:rx']
    stories.append(s)

    s = Ledger('R06', 3006, 'a withdrawal printed on page 2 with two digits transposed, the printed balances '
               'as the bank\'s ledger has them',
               producer='tcpdf', font='Helvetica', paper='A4', period=('2027-06-01', '2027-06-30'),
               opening=31000000, per_page=13, bank='Riyadh Learning Bank', document_title='Statement of Account',
               account='SA14 6500 0000 7070 1400 3006', style=styled(api='cell', rules='grid', heading='filled'))
    s.school(families=12, staff=18, suppliers=6, prefix='F', terminal='9926')
    s.recipe['transposed'] = [2, 3]
    s.held('balance-broken')
    stories.append(s)

    s = Ledger('R07', 3007, 'mPDF statement in DejaVu Sans Mono on A4 landscape with striped rows and a coloured '
               'heading, page numbers by mPDF\'s own footer; the account falls overdrawn in mid-month, printed '
               'with DR after each amount; a supplier paid twice under one reference against one entry; '
               'cashbook also as text XLSX from PhpSpreadsheet',
               producer='mpdf', font='DejaVu Sans Mono', paper='A4-landscape', period=('2027-09-01', '2027-09-30'),
               opening=4800000, per_page=12, bank='Hijaz Academic Bank', document_title='Account Statement',
               account='SA39 7100 0000 4242 0900 3007', cashbook_xlsx='text',
               style=styled(rules='stripes', heading='filled'))
    s.school(families=13, staff=26, suppliers=6, prefix='G', terminal='3317', salary_scale=(9000, 16000))
    for k, d in enumerate(['2027-09-14', '2027-09-15'], 1):
        s.movement(f'sp{k}', d, 'Outward SARIE - Fresh Bites Catering', 'PAY-270914-FB', out=1287040)
    s.entry('sp', '2027-09-14', 'Purchases - Fresh Bites Catering', 'PAY-270914-FB', payment=1287040)
    s.intent['review'].append({'bank': ['b:sp1', 'b:sp2'], 'cash': ['c:sp'], 'reason': 'duplicate-reference'})
    s.movement('od', '2027-09-30', 'Overdraft interest', out=38415)
    s.intent['bankOnly'].append('b:od')
    stories.append(s)

    s = Ledger('R08', 3008, 'Arabic mPDF statement in FreeSerif, a font mPDF ships, shaped by mPDF\'s own OpenType '
               'layout, Latin digits, a heading filled dark green in white in rows as tall as the type; a description '
               'continuing at the top of page 2; a parent\'s transfer valued after the period; a transfer '
               'without its reference on the statement',
               producer='mpdf', font='FreeSerif', paper='A4', layout='ar', digits='latin',
               period=('2027-10-01', '2027-10-31'), opening=30000000, per_page=12, bank='مصرف الحجاز الأكاديمي',
               document_title='كشف حساب', account='SA39 7100 0000 4242 0900 3008',
               style=styled(rules='rows', heading='filled-tight'))
    s.school(families=12, staff=17, suppliers=6, prefix='H', terminal='4428')
    s.continuation = {'page': 2, 'text': 'تابع: رواتب سبتمبر بعد التسوية'}
    s.pair('va', day('2027-10-31'), 'transfer', 'STU-H019-10', 845000, value='2027-11-01', student='H019',
           parent='غادة الثنيان')
    s.intent['timing'].append('b:va')
    s.movement('nr', '2027-10-20', 'حوالة سريعة واردة - زياد الرويلي', into=760000)
    s.entry('nr', '2027-10-21', 'قسط دراسي H011 زياد الرويلي', 'STU-H011-OCT', receipt=760000)
    s.intent['review'].append({'bank': ['b:nr'], 'cash': ['c:nr'], 'reason': 'amount-date-suggestion'})
    stories.append(s)

    s = Ledger('R09', 3009, 'Arabic mPDF statement in DejaVu Sans, mPDF\'s default font, with Arabic-Indic digits '
               'and a full grid; the bus '
               'contractor\'s cheque presented five days after it was written; a cheque deposited by a parent '
               'and returned with the bank\'s fee, not yet booked',
               producer='mpdf', font='DejaVu Sans', paper='A4', layout='ar', digits='arabic',
               period=('2027-11-01', '2027-11-30'), opening=40000000, per_page=11, bank='مصرف الحجاز الأكاديمي',
               document_title='كشف حساب جاري', account='SA39 7100 0000 4242 0900 3009',
               style=styled(rules='grid', heading='grey'))
    s.school(families=12, staff=18, suppliers=6, prefix='J', terminal='5539', bus=False)
    s.movement('cq', '2027-11-14', 'شيك رقم 771402 مقدم للصرف', 'CHQ-771402', out=3418000)
    s.entry('cq', '2027-11-09', 'النقل المدرسي - المسار للنقل المدرسي', 'CHQ-771402', payment=3418000)
    s.intent['review'].append({'bank': ['b:cq'], 'cash': ['c:cq'], 'reason': 'date-gap'})
    s.pair('rc', day('2027-11-08'), 'cheque', 'CHQ-660241', 715000, student='J022', parent='عبير اليامي')
    s.movement('rr', '2027-11-22', 'شيك مرتجع - عدم كفاية الرصيد', 'CHQ-660241-R', out=715000)
    s.movement('rx', '2027-11-22', 'رسوم الشيك المرتجع', out=5750)
    s.intent['bankOnly'] += ['b:rr', 'b:rx']
    stories.append(s)

    s = Ledger('R10', 3010, 'a term on many pages from mPDF in FreeSans with page totals and long descriptions '
               'wrapped in their cells; a refund of overpaid fees booked twice in the cashbook under its '
               'reference; a fee transfer valued after the period',
               producer='mpdf', font='FreeSans', paper='A4', period=('2027-08-01', '2027-10-31'),
               opening=61500000, per_page=16, page_totals=True, bank='Hijaz Academic Bank',
               document_title='Statement of Account', account='SA39 7100 0000 4242 0900 3010',
               style=styled(rules='rows', heading='rule'))
    s.school(families=16, staff=24, suppliers=6, prefix='K', terminal='6640')
    s.movement('ov', '2027-09-21', 'Outward SARIE - refund of overpaid fees student K009 first term instalment',
               'RFD-K009-2709', out=355000)
    for k, d in enumerate(['2027-09-21', '2027-09-22'], 1):
        s.entry(f'ov{k}', d, 'Refund of overpaid fees K009', 'RFD-K009-2709', payment=355000)
    s.intent['review'].append({'bank': ['b:ov'], 'cash': ['c:ov1', 'c:ov2'], 'reason': 'duplicate-reference'})
    s.pair('va', day('2027-10-31'), 'transfer', 'STU-K015-10B', 905000, value='2027-11-01', student='K015',
           parent='Shatha Al Khathlan')
    s.intent['timing'].append('b:va')
    stories.append(s)

    s = Ledger('R11', 3011, 'page 3 brings forward a balance that is not the one page 2 carried forward',
               producer='mpdf', font='DejaVu Sans', paper='A4', period=('2027-12-01', '2027-12-31'),
               opening=24000000, per_page=8, bank='Hijaz Academic Bank', document_title='Account Statement',
               account='SA39 7100 0000 4242 0900 3011', style=styled(rules='rows', heading='filled'))
    s.school(families=12, staff=18, suppliers=6, prefix='L', terminal='7751')
    s.recipe['staleBroughtForward'] = [3, 1250000]
    s.held('balance-broken')
    stories.append(s)

    s = Ledger('R12', 3012, 'the last page\'s footer counts one page more than the others: pages 1, 2 and 3 '
               'of 3, 3 and 4',
               producer='mpdf', font='DejaVu Sans Mono', paper='A4', period=('2027-07-01', '2027-07-31'),
               opening=17800000, per_page=8, bank='Hijaz Academic Bank', document_title='Account Statement',
               account='SA39 7100 0000 4242 0900 3012', style=styled(rules='stripes', heading='filled'))
    s.school(families=12, staff=18, suppliers=6, prefix='M', terminal='8862')
    s.recipe['lastFooterOf'] = 4
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
