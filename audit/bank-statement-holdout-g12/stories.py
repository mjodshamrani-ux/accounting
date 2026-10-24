"""BNK-PDF-1 G12 holdout: new synthetic bank statements and cashbooks as facts.

A sixth generator lineage, written for G12. Nothing is imported from the
foundation's stories.mjs, from the G6, G8, G9 or G10 holdouts' stories.py,
from any renderer or from the product. Each story is the collection account
of a property manager over one period: tenants pay their rent by standing
order on the first business day, by transfer under their Ejar contract in
the first days of the month, or by cheque that the bank credits a day or two
after it is deposited; contractors are paid in maintenance runs on Sunday and
Wednesday; electricity and water are paid by SADAD in mid-month; and the
owners are remitted their share by the 25th. A xoshiro128** generator,
seeded through SplitMix32, draws the amounts and days. The special events of
a story and its expected outcome are written by hand beside it.

The facts follow the foundation's contract (contract.json): one account in
SAR with two decimals, one period per statement, the same column headings,
control lines, account line and page footer. What changes is what the
contract leaves open: the writers (Apache PDFBox and jsPDF), fonts, styles,
paper, periods, banks, accounts, reference styles, narratives, economic
relationships and faults.

Each story lists its statement page by page and line by line as printed.
`recipe` says how the pages were made and styled and which fault was
planted; `intent` is the designer's expected outcome. The independent oracle
reads neither. Amounts are minor units; balances are running balances.

  python3 -B audit/bank-statement-holdout-g12/stories.py > stories.json
"""
import json
import sys
from datetime import date, timedelta

VERSION = 'bank-statement-holdout-g12-1'
WINDOW = 3
WEEKEND = {4, 5}  # Friday and Saturday
SUNDAY, WEDNESDAY = 6, 2
M32 = 0xFFFFFFFF


class Xoshiro128:
    """xoshiro128** 1.1 (Blackman and Vigna), seeded by SplitMix32: the facts
    regenerate byte for byte on any Python."""

    def __init__(self, seed):
        state, self.s = seed & M32, []
        for _ in range(4):
            state = (state + 0x9E3779B9) & M32
            z = state
            z = ((z ^ (z >> 16)) * 0x85EBCA6B) & M32
            z = ((z ^ (z >> 13)) * 0xC2B2AE35) & M32
            self.s.append(z ^ (z >> 16))

    @staticmethod
    def rotl(x, k):
        return ((x << k) | (x >> (32 - k))) & M32

    def next(self):
        s = self.s
        result = (self.rotl((s[1] * 5) & M32, 7) * 9) & M32
        t = (s[1] << 9) & M32
        s[2] ^= s[0]
        s[3] ^= s[1]
        s[1] ^= s[2]
        s[0] ^= s[3]
        s[2] ^= t
        s[3] = self.rotl(s[3], 11)
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


TENANTS = {
    'en': ['Abdullah Al Harbi', 'Sara Al Qahtani', 'Faisal Al Otaibi', 'Noura Al Shehri', 'Khalid Al Dosari',
           'Reem Al Ghamdi', 'Turki Al Mutairi', 'Hala Al Zahrani', 'Majed Al Anazi', 'Lama Al Subaie',
           'Yousef Al Juhani', 'Dana Al Shammari', 'Bandar Al Malki', 'Rawan Al Harthi'],
    'ar': ['عبدالله الحربي', 'سارة القحطاني', 'فيصل العتيبي', 'نورة الشهري', 'خالد الدوسري',
           'ريم الغامدي', 'تركي المطيري', 'هالة الزهراني', 'ماجد العنزي', 'لمى السبيعي',
           'يوسف الجهني', 'دانة الشمري', 'بندر المالكي', 'روان الحارثي'],
}
CONTRACTORS = {
    'en': ['Al Bawani Maintenance', 'Cool Air Services', 'Green Gardens Landscaping', 'Safe Lifts Co.',
           'Bright Paints Est.', 'Pure Water Tanks'],
    'ar': ['البواني للصيانة', 'خدمات الهواء البارد', 'الحدائق الخضراء لتنسيق المواقع', 'شركة المصاعد الآمنة',
           'مؤسسة الدهانات المشرقة', 'خزانات المياه النقية'],
}
WORDS = {
    'en': {
        'so': ('Standing order - rent unit {unit}', 'Rent unit {unit} {tenant}'),
        'ejar': ('Inward SARIE - {tenant} Ejar rent', 'Rent unit {unit} {tenant}'),
        'cheque': ('Cheque deposit clearing', 'Rent cheque unit {unit} {tenant}'),
        'maint': ('Outward SARIE - {party}', 'Maintenance - {party}'),
        'sec': ('SEC electricity SADAD', 'Electricity building {building}'),
        'nwc': ('NWC water SADAD', 'Water building {building}'),
        'owner': ('Outward SARIE - owner remittance', "Owner's share remitted"),
    },
    'ar': {
        'so': ('أمر دائم - إيجار الوحدة {unit}', 'إيجار الوحدة {unit} {tenant}'),
        'ejar': ('حوالة سريعة واردة - {tenant} دفعة إيجار', 'إيجار الوحدة {unit} {tenant}'),
        'cheque': ('مقاصة شيك مودع', 'شيك إيجار الوحدة {unit} {tenant}'),
        'maint': ('حوالة سريعة صادرة - {party}', 'صيانة - {party}'),
        'sec': ('فاتورة الكهرباء - سداد', 'كهرباء المبنى {building}'),
        'nwc': ('فاتورة المياه - سداد', 'مياه المبنى {building}'),
        'owner': ('حوالة سريعة صادرة - حصة المالك', 'تحويل حصة المالك'),
    },
}


class Ledger:
    def __init__(self, sid, seed, title, *, producer, font, paper, period, opening, per_page, bank,
                 document_title, account, layout='en', digits=None, page_totals=False, cashbook_xlsx=None,
                 style=None):
        self.rng = Xoshiro128(seed)
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
        voucher = f"{'RV' if receipt else 'PV'}-{self.id}-{self.vouchers:03d}"
        self.entries.append({'key': f'c:{key}', 'date': when, 'voucher': voucher, 'description': text,
                             'reference': reference, 'receipt': receipt, 'payment': payment})

    def pair(self, key, bank_day, kind, reference, amount, *, booked=None, value=None, **names):
        """One event on both sides under one reference, expected to match."""
        bank_text, cash_text = (w.format(**names) for w in WORDS[self.layout][kind])
        inflow = kind in ('so', 'ejar', 'cheque')
        self.movement(key, iso(bank_day), bank_text, reference, out=0 if inflow else amount,
                      into=amount if inflow else 0, value=value)
        self.entry(key, iso(booked or bank_day), cash_text, reference, receipt=amount if inflow else 0,
                   payment=0 if inflow else amount)
        self.intent['auto'].append([f'b:{key}', f'c:{key}'])

    def estate(self, *, units, buildings, contractors, owner=True, rent_scale=(2200, 14000),
               maint_scale=(250, 9500), ejar, unit_names):
        """The property's own month.

        Rent: each unit pays once a month by standing order on the first
        business day (booked that day), by Ejar transfer on a business day
        from the 1st to the 9th (booked from the bank alert 0..2 days later),
        or by a cheque deposited on a business day from the 1st to the 7th and
        credited the next business day (booked on the deposit day), at most
        three days later across a weekend.
        Maintenance: on each Sunday and Wednesday, one to three contractors
        are paid. Electricity and water: each building's bills by SADAD on a
        business day between the 10th and the 20th. The owner's share: on the
        last business day by the 25th."""
        r, L = self.rng, self.layout
        start, end = day(self.period['start']), day(self.period['end'])
        rents = [r.between(*rent_scale) * 100 // 5000 * 5000 for _ in range(units)]
        month, m, n = start.replace(day=1), 0, 0
        while month <= end:
            m += 1
            for u in range(units):
                unit, tenant = unit_names[u], TENANTS[L][u % len(TENANTS[L])]
                channel = ('so', 'ejar', 'cheque')[u % 3]
                n += 1
                if channel == 'so':
                    paid = next_business(month)
                    if self.inside(paid):
                        self.pair(f'T{n}', paid, 'so', f'SO-{paid:%y%m}-{unit}', rents[u], unit=unit, tenant=tenant)
                elif channel == 'ejar':
                    paid = next_business(month + timedelta(days=r.between(0, 8)))
                    if self.inside(paid):
                        booked = self.clamp(paid + timedelta(days=r.between(0, 2)))
                        self.pair(f'T{n}', paid, 'ejar', ejar(u, m), rents[u], booked=booked, unit=unit,
                                  tenant=tenant)
                else:
                    deposited = next_business(month + timedelta(days=r.between(0, 6)))
                    credited = next_business(deposited + timedelta(days=1))
                    if self.inside(deposited) and self.inside(credited):
                        self.pair(f'T{n}', credited, 'cheque', f'CHQ-{r.between(100000, 999999)}', rents[u],
                                  booked=deposited, unit=unit, tenant=tenant)
            for b in range(1, buildings + 1):
                for kind, scale in (('sec', (900, 7800)), ('nwc', (250, 2400))):
                    paid = next_business(month + timedelta(days=r.between(9, 19)))
                    if self.inside(paid):
                        n += 1
                        bill = f'{r.between(10 ** 5, 10 ** 6 - 1)}{r.between(0, 999999):06d}'
                        self.pair(f'U{n}', paid, kind, f'SADAD-{bill}', r.money(*scale), building=b)
            if owner:
                remit = previous_business(month.replace(day=25))
                if self.inside(remit):
                    self.pair(f'O{m}', remit, 'owner', f'OWN-{remit:%y%m}', r.between(150, 900) * 10000)
            month = (month + timedelta(days=32)).replace(day=1)
        d = start
        while d <= end:
            if d.weekday() in (SUNDAY, WEDNESDAY) and business(d):
                for _ in range(r.between(1, 3)):
                    n += 1
                    party = CONTRACTORS[L][r.below(contractors)]
                    self.pair(f'M{n}', d, 'maint', f'MNT-{d:%y%m%d}-{n:03d}', r.money(*maint_scale), party=party)
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
        if 'dropRow' in self.recipe:
            page, index = self.recipe['dropRow']
            movements = [line for line in pages[page - 1]['lines'] if line['kind'] == 'movement']
            pages[page - 1]['lines'].remove(movements[index])
        if 'noBroughtForward' in self.recipe:
            lines = pages[self.recipe['noBroughtForward'] - 1]['lines']
            assert lines[0]['kind'] == 'brought-forward'
            del lines[0]
        if 'missingPage' in self.recipe:
            del pages[self.recipe['missingPage'] - 1]
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


def units(prefix, n):
    return [f'{prefix}{k + 1:02d}' for k in range(n)]


def build():
    stories = []

    def ejar(code):
        return lambda u, m: f'EJR-{code}{u + 1:02d}-{m:02d}'

    s = Ledger('Q01', 2001, 'PDFBox table in Fira Sans with a full grid and a filled heading, each cell clipped '
               'by a path traced back to its start; a contractor\'s cheque presented six days after it was '
               'written; a tenant\'s cheque returned unpaid, with the bank\'s fee, not yet booked',
               producer='pdfbox', font='Fira Sans', paper='A4', period=('2026-04-01', '2026-04-30'),
               opening=31250000, per_page=13, bank='Najd Real Estate Bank', document_title='Statement of Account',
               account='SA80 1500 0000 3131 0500 2001',
               style=styled(rules='grid', heading='filled', padding=2.5, clip=True))
    s.estate(units=9, buildings=2, contractors=6, ejar=ejar('7101'), unit_names=units('A', 9))
    s.movement('cq', '2026-04-15', 'Cheque 004417 presented', 'CHQ-004417', out=1180000)
    s.entry('cq', '2026-04-09', 'Maintenance - Safe Lifts Co. by cheque', 'CHQ-004417', payment=1180000)
    s.intent['review'].append({'bank': ['b:cq'], 'cash': ['c:cq'], 'reason': 'date-gap'})
    s.pair('rc', day('2026-04-07'), 'cheque', 'CHQ-731184', 450000, booked=day('2026-04-06'), unit='A10',
           tenant='Bandar Al Malki')
    s.movement('rr', '2026-04-20', 'Returned cheque - insufficient funds', 'CHQ-731184-R', out=450000)
    s.movement('rf', '2026-04-20', 'Returned cheque fee', out=5000)
    s.intent['bankOnly'] += ['b:rr', 'b:rf']
    stories.append(s)

    s = Ledger('Q02', 2002, 'Arabic statement from PDFBox in Noto Naskh Arabic, shaped by ICU4J and written run '
               'by run in its bidi order, so that a date in Arabic-Indic digits is five touching texts; the '
               'account falls overdrawn, printed with DR; a tenant pays two months in one transfer under one '
               'Ejar reference against two receipts',
               producer='pdfbox', font='Noto Naskh Arabic', paper='A4', layout='ar', digits='arabic',
               period=('2026-05-01', '2026-05-31'), opening=2500000, per_page=11, bank='مصرف نجد العقاري',
               document_title='كشف حساب', account='SA80 1500 0000 3131 0500 2002',
               style=styled(rules='rows', heading='rule', padding=2.5, runs=True))
    s.estate(units=8, buildings=2, contractors=6, ejar=ejar('7202'), unit_names=units('B', 8),
             maint_scale=(1500, 16000))
    s.movement('tw', '2026-05-06', 'حوالة سريعة واردة - لمى السبيعي إيجار شهرين', 'EJR-7202-77', into=1300000)
    for k, d in enumerate(['2026-05-06', '2026-05-07'], 1):
        s.entry(f'tw{k}', d, f'إيجار الوحدة B09 لمى السبيعي الشهر {k}', 'EJR-7202-77', receipt=650000)
    s.intent['review'].append({'bank': ['b:tw'], 'cash': ['c:tw1', 'c:tw2'], 'reason': 'duplicate-reference'})
    stories.append(s)

    s = Ledger('Q03', 2003, 'monospaced PDFBox statement in JetBrains Mono on US Letter with page totals and no '
               'rules; overdrawn from the start, the DR written in its own slot after each amount; a tenant '
               'paying short of the rent under its reference; cashbook also as typed XLSX from ExcelJS',
               producer='pdfbox', font='JetBrains Mono', paper='Letter', period=('2026-06-01', '2026-06-30'),
               opening=-4120000, per_page=10, page_totals=True, bank='Najd Real Estate Bank',
               document_title='Statement of Account', account='SA80 1500 0000 3131 0500 2003', cashbook_xlsx='typed',
               style=styled(rules='none', heading='rule', padding=2.0, drSlot=True))
    s.estate(units=7, buildings=1, contractors=5, ejar=ejar('7303'), unit_names=units('C', 7), owner=False)
    s.movement('sh', '2026-06-08', 'Inward SARIE - Hala Al Zahrani Ejar rent part', 'EJR-730308-06', into=380000)
    s.entry('sh', '2026-06-08', 'Rent unit C08 Hala Al Zahrani', 'EJR-730308-06', receipt=400000)
    s.intent['review'].append({'bank': ['b:sh'], 'cash': ['c:sh'], 'reason': 'amount-difference'})
    for k, (d, amount) in enumerate([('2026-06-10', 1200000), ('2026-06-17', 85000), ('2026-06-24', 72050)], 1):
        s.pair(f'w{k}', day(d), 'maint', f'MNT-W{k}-{d[5:7]}{d[8:]}', amount, party='Bright Paints Est.')
    stories.append(s)

    s = Ledger('Q04', 2004, 'Arabic statement from PDFBox in Noto Kufi Arabic with Latin digits, a full grid and '
               'a filled heading, and long descriptions wrapped in their cells; a maintenance payment without '
               'its reference on the statement; an electricity bill valued before the period; the bank\'s '
               'monthly fee not yet booked',
               producer='pdfbox', font='Noto Kufi Arabic', paper='A4', layout='ar', digits='latin',
               period=('2026-07-01', '2026-07-31'), opening=18800000, per_page=10, bank='مصرف نجد العقاري',
               document_title='كشف حساب جاري', account='SA80 1500 0000 3131 0500 2004',
               style=styled(rules='grid', heading='filled', padding=2.5))
    s.estate(units=8, buildings=2, contractors=6, ejar=ejar('7404'), unit_names=units('D', 8))
    s.movement('na', '2026-07-12', 'حوالة سريعة صادرة - مؤسسة الدهانات المشرقة دفعة أعمال الدهان للمبنى الثاني '
               'حسب مستخلص شهر يونيو', into=0, out=2318840)
    s.entry('na', '2026-07-13', 'صيانة - مؤسسة الدهانات المشرقة', 'MNT-2607-PAINT', payment=2318840)
    s.intent['review'].append({'bank': ['b:na'], 'cash': ['c:na'], 'reason': 'amount-date-suggestion'})
    s.pair('vb', day('2026-07-01'), 'sec', 'SADAD-480011920043', 391575, value='2026-06-30', building=3)
    s.intent['timing'].append('b:vb')
    s.movement('fee', '2026-07-30', 'رسوم إدارة الحساب الشهرية', out=11500)
    s.intent['bankOnly'].append('b:fee')
    stories.append(s)

    s = Ledger('Q05', 2005, 'a movement row left out of page 2, the printed balances unchanged',
               producer='pdfbox', font='Times-Roman', paper='A4', period=('2026-08-01', '2026-08-31'),
               opening=9000000, per_page=12, bank='Najd Real Estate Bank', document_title='Statement of Account',
               account='SA80 1500 0000 3131 0500 2005', style=styled(rules='rows', heading='rule', padding=2.5))
    s.estate(units=8, buildings=2, contractors=5, ejar=ejar('7505'), unit_names=units('E', 8))
    s.recipe['dropRow'] = [2, 4]
    s.held('balance-broken')
    stories.append(s)

    s = Ledger('Q06', 2006, 'a quarter on many pages from PDFBox in the standard Times-Roman, not embedded; a '
               'description continuing at the top of page 6; two equal cash deposits on one day against two '
               'equal receipts; a rent valued after the period',
               producer='pdfbox', font='Times-Roman', paper='A4', period=('2026-01-01', '2026-03-31'),
               opening=52000000, per_page=15, bank='Najd Real Estate Bank', document_title='Statement of Account',
               account='SA80 1500 0000 3131 0500 2006', style=styled(rules='rows', heading='rule', padding=2.5))
    s.estate(units=12, buildings=3, contractors=6, ejar=ejar('7606'), unit_names=units('F', 12))
    for k in (1, 2):
        s.movement(f'cd{k}', '2026-02-18', 'Cash deposit - CDM Olaya branch', into=275000)
        s.entry(f'cd{k}', '2026-02-18', f'Cash rent received, receipt book {k}', receipt=275000)
    s.intent['review'].append({'bank': ['b:cd1', 'b:cd2'], 'cash': ['c:cd1', 'c:cd2'],
                               'reason': 'ambiguous-amount-date'})
    s.pair('va', day('2026-03-31'), 'ejar', 'EJR-760699-04', 885000, value='2026-04-01', unit='F13',
           tenant='Rawan Al Harthi')
    s.intent['timing'].append('b:va')
    s.continuation = {'page': 6, 'text': '(continued) Ejar contract 7606-14, renewal for twelve months'}
    stories.append(s)

    s = Ledger('Q07', 2007, 'jsPDF with autoTable in Noto Sans on A4 landscape, striped rows and a coloured '
               'heading; a security deposit refunded to a tenant but booked as a receipt under its reference; '
               'a cheque issued to a contractor not yet presented',
               producer='jspdf', font='Noto Sans', paper='A4-landscape', period=('2026-09-01', '2026-09-30'),
               opening=27500000, per_page=12, bank='Tuwaiq Housing Bank', document_title='Account Statement',
               account='SA62 4000 0000 5252 0600 2007', style=styled(theme='striped', padding=3))
    s.estate(units=9, buildings=2, contractors=6, ejar=ejar('7707'), unit_names=units('G', 9))
    s.movement('sd', '2026-09-16', 'Outward SARIE - security deposit refund unit G03', 'DEP-G03-2026', out=600000)
    s.entry('sd', '2026-09-16', 'Security deposit unit G03 Faisal Al Otaibi', 'DEP-G03-2026', receipt=600000)
    s.intent['review'].append({'bank': ['b:sd'], 'cash': ['c:sd'], 'reason': 'direction-conflict'})
    s.entry('oc', '2026-09-29', 'Maintenance - Cool Air Services by cheque', 'CHQ-004520', payment=1365000)
    s.intent['cashOnly'].append('c:oc')
    stories.append(s)

    s = Ledger('Q08', 2008, 'Arabic statement from jsPDF with autoTable in Noto Naskh Arabic, shaped and '
               'ordered by jsPDF itself, Latin digits and a full grid; a contractor\'s cheque presented after '
               'four days beyond the window; a tenant\'s cheque returned with the bank\'s fee, not yet booked',
               producer='jspdf', font='Noto Naskh Arabic', paper='A4', layout='ar', digits='latin',
               period=('2026-10-01', '2026-10-31'), opening=21000000, per_page=11, bank='مصرف طويق للإسكان',
               document_title='كشف حساب', account='SA62 4000 0000 5252 0600 2008',
               style=styled(theme='grid', padding=2.5))
    s.estate(units=8, buildings=2, contractors=6, ejar=ejar('7808'), unit_names=units('H', 8))
    s.movement('cq', '2026-10-21', 'شيك رقم 004610 مقدم للصرف', 'CHQ-004610', out=990000)
    s.entry('cq', '2026-10-14', 'صيانة - خدمات الهواء البارد بشيك', 'CHQ-004610', payment=990000)
    s.intent['review'].append({'bank': ['b:cq'], 'cash': ['c:cq'], 'reason': 'date-gap'})
    s.pair('rc', day('2026-10-06'), 'cheque', 'CHQ-881920', 520000, booked=day('2026-10-05'), unit='H09',
           tenant='يوسف الجهني')
    s.movement('rr', '2026-10-22', 'شيك مرتجع - عدم كفاية الرصيد', 'CHQ-881920-R', out=520000)
    s.movement('rf', '2026-10-22', 'رسوم الشيك المرتجع', out=5000)
    s.intent['bankOnly'] += ['b:rr', 'b:rf']
    stories.append(s)

    s = Ledger('Q09', 2009, 'jsPDF with autoTable in the standard Courier, not embedded, plain theme; the '
               'account overdrawn for most of the month, printed with DR; a security deposit received from a '
               'new tenant; cashbook also as text XLSX from ExcelJS',
               producer='jspdf', font='Courier', paper='A4', period=('2026-11-01', '2026-11-30'),
               opening=-860000, per_page=14, bank='Tuwaiq Housing Bank', document_title='Account Statement',
               account='SA62 4000 0000 5252 0600 2009', cashbook_xlsx='text', style=styled(theme='plain', padding=2))
    s.estate(units=7, buildings=1, contractors=5, ejar=ejar('7909'), unit_names=units('J', 7), owner=False,
             maint_scale=(800, 14000))
    s.pair('nd', day('2026-11-11'), 'ejar', 'DEP-J08-2026', 750000, unit='J08', tenant='Dana Al Shammari')
    stories.append(s)

    s = Ledger('Q10', 2010, 'Arabic statement from jsPDF with autoTable in Noto Kufi Arabic with Arabic-Indic '
               'digits, a full grid and page totals; overdrawn, printed with DR; a water bill paid twice under '
               'one bill number against one entry; a cheque deposited on the last day not yet credited',
               producer='jspdf', font='Noto Kufi Arabic', paper='A4', layout='ar', digits='arabic',
               period=('2026-12-01', '2026-12-31'), opening=1800000, per_page=10, page_totals=True,
               bank='مصرف طويق للإسكان', document_title='كشف حساب جاري', account='SA62 4000 0000 5252 0600 2010',
               style=styled(theme='grid', padding=2.5))
    s.estate(units=7, buildings=2, contractors=6, ejar=ejar('7010'), unit_names=units('K', 7),
             maint_scale=(2000, 16000))
    for k, d in enumerate(['2026-12-15', '2026-12-16'], 1):
        s.movement(f'wb{k}', d, 'فاتورة المياه - سداد', 'SADAD-310557294801', out=184050)
    s.entry('wb', '2026-12-15', 'مياه المبنى 2', 'SADAD-310557294801', payment=184050)
    s.intent['review'].append({'bank': ['b:wb1', 'b:wb2'], 'cash': ['c:wb'], 'reason': 'duplicate-reference'})
    s.entry('dt', '2026-12-31', 'شيك إيجار مودع - الوحدة K08 بندر المالكي', 'CHQ-551208', receipt=710000)
    s.intent['cashOnly'].append('c:dt')
    stories.append(s)

    s = Ledger('Q11', 2011, 'page 2 printed without its brought-forward line',
               producer='jspdf', font='Noto Sans', paper='A4', period=('2026-02-01', '2026-02-28'),
               opening=14500000, per_page=12, bank='Tuwaiq Housing Bank', document_title='Account Statement',
               account='SA62 4000 0000 5252 0600 2011', style=styled(theme='grid', padding=3))
    s.estate(units=8, buildings=2, contractors=5, ejar=ejar('7111'), unit_names=units('L', 8))
    s.recipe['noBroughtForward'] = 2
    s.held('balance-broken')
    stories.append(s)

    s = Ledger('Q12', 2012, 'the middle page of three missing: pages 1 and 3 of 3',
               producer='jspdf', font='Courier', paper='A4', period=('2026-03-01', '2026-03-31'),
               opening=16200000, per_page=12, bank='Tuwaiq Housing Bank', document_title='Account Statement',
               account='SA62 4000 0000 5252 0600 2012', style=styled(theme='plain', padding=2))
    s.estate(units=9, buildings=2, contractors=5, ejar=ejar('7212'), unit_names=units('M', 9))
    s.recipe['missingPage'] = 2
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
