"""BNK-PDF-1 G9 holdout: new synthetic bank statements and cashbooks as facts.

A fourth generator lineage, written for G9. Nothing is imported from the
foundation's stories.mjs, from the G6 or G8 holdouts' stories.py, from any
renderer or from the product. Each story is a company's account over one
period, simulated on a business calendar: Sunday to Thursday, no movement on
Friday or Saturday, with rent on the first business day, payroll by the
25th, a utility bill in mid-month, card settlements and customer and
supplier transfers drawn by a SplitMix64 generator. The special events of a
story and its expected outcome are written by hand beside it.

The facts follow the foundation's contract (contract.json): one account in
SAR with two decimals, one period per statement, the same column headings,
control lines, account line and page footer. What changes is what the
contract leaves open: the writers (WeasyPrint and MuPDF), fonts, styles,
paper, periods, banks, accounts, reference styles, narratives, economic
relationships and faults.

Each story lists its statement page by page and line by line as printed.
`recipe` says how the pages were made and styled and which fault was
planted; `intent` is the designer's expected outcome. The independent oracle
reads neither. Amounts are minor units; balances are running balances.

  python3 -B audit/bank-statement-holdout-g9/stories.py > stories.json
"""
import json
import sys
from datetime import date, timedelta

VERSION = 'bank-statement-holdout-g9-1'
WINDOW = 3
MASK = (1 << 64) - 1
WEEKEND = {4, 5}  # Friday and Saturday


class SplitMix64:
    """SplitMix64: the facts regenerate byte for byte on any Python."""

    def __init__(self, seed):
        self.state = seed & MASK

    def next(self):
        self.state = (self.state + 0x9E3779B97F4A7C15) & MASK
        z = self.state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK
        return z ^ (z >> 31)

    def int(self, lo, hi):
        return lo + self.next() % (hi - lo + 1)

    def chance(self, percent):
        return self.int(1, 100) <= percent

    def pick(self, xs):
        return xs[self.int(0, len(xs) - 1)]


def day(s):
    return date.fromisoformat(s)


def iso(d):
    return d.isoformat()


def business_days(start, end):
    d, out = day(start), []
    while d <= day(end):
        if d.weekday() not in WEEKEND:
            out.append(d)
        d += timedelta(days=1)
    return out


WORDS = {
    'en': {
        'card': ('POS merchant settlement', 'Card sales banked'),
        'receipt': ('Incoming transfer from customer', 'Customer collection'),
        'payment': ('Outgoing SARIE transfer', 'Supplier invoice paid'),
        'rent': ('Standing order - office rent', 'Office rent'),
        'payroll': ('WPS payroll transfer', 'Salaries for the month'),
        'utility': ('SADAD utility payment', 'Electricity bill'),
    },
    'ar': {
        'card': ('تسوية مدفوعات مدى', 'إيداع مبيعات البطاقات'),
        'receipt': ('حوالة واردة من عميل', 'تحصيل من عميل'),
        'payment': ('تحويل سريع صادر', 'سداد فاتورة مورد'),
        'rent': ('أمر مستديم - إيجار المكتب', 'إيجار المكتب'),
        'payroll': ('رواتب عبر نظام حماية الأجور', 'رواتب الشهر'),
        'utility': ('سداد فاتورة كهرباء', 'فاتورة الكهرباء'),
    },
}
KEY = {'card': 'C', 'receipt': 'I', 'payment': 'P', 'rent': 'L', 'payroll': 'W', 'utility': 'U'}
LONG = [
    'to Gulf Logistics Services Co. against invoices 4410 and 4411',
    'Al Waha Contracting Est. retention release, contract 2026-118',
    'quarterly maintenance of the Riyadh branch, purchase order 7731',
]


class Business:
    def __init__(self, sid, seed, title, *, producer, font, paper, period, opening, per_page, bank,
                 document_title, account, layout='en', digits=None, page_totals=False, cashbook_xlsx=None,
                 style=None, trailing_page=False):
        self.rng = SplitMix64(seed)
        self.id, self.title, self.layout, self.digits = sid, title, layout, digits
        self.producer, self.font, self.paper = producer, font, paper
        self.period = {'start': period[0], 'end': period[1]}
        self.opening, self.per_page, self.page_totals = opening, per_page, page_totals
        self.trailing_page = trailing_page
        self.bank_name, self.document_title, self.account = bank, document_title, account
        self.cashbook_xlsx = cashbook_xlsx
        self.movements, self.entries = [], []
        self.recipe = {'opening': opening, 'rowsPerPage': per_page, 'style': style or {}}
        self.continuation = None
        self.sequence = 0
        self.intent = {'statement': 'verified', 'auto': [], 'review': [], 'bankOnly': [], 'cashOnly': [], 'timing': []}

    def movement(self, key, when, text, reference='', *, out=0, into=0, value=None):
        assert (out > 0) != (into > 0) and self.period['start'] <= when <= self.period['end']
        self.movements.append({'key': f'b:{key}', 'date': when, 'valueDate': value or when, 'description': text,
                               'reference': reference, 'withdrawal': out, 'deposit': into})

    def entry(self, key, when, text, reference='', *, receipt=0, payment=0):
        assert (receipt > 0) != (payment > 0)
        self.sequence += 1
        voucher = f"{'RCV' if receipt else 'PAY'}-{self.id}-{self.sequence:04d}"
        self.entries.append({'key': f'c:{key}', 'date': when, 'voucher': voucher, 'description': text,
                             'reference': reference, 'receipt': receipt, 'payment': payment})

    def both(self, key, when, kind, reference, amount, *, booked=None, text=None, value=None):
        """One event on both sides under one reference, expected to match."""
        bank_text, cash_text = WORDS[self.layout][kind]
        inflow = kind in ('card', 'receipt')
        self.movement(key, when, text or bank_text, reference, out=0 if inflow else amount,
                      into=amount if inflow else 0, value=value)
        self.entry(key, booked or when, cash_text, reference, receipt=amount if inflow else 0,
                   payment=0 if inflow else amount)
        self.intent['auto'].append([f'b:{key}', f'c:{key}'])

    def month(self, *, cards=0, receipts=0, payments=0, scale=(50, 40000), refs, long_every=0, repeat=1):
        """The recurring flows of the period, day by day, each kind drawn
        `repeat` times a day; `refs(kind, d, n)` writes each reference."""
        r, days = self.rng, business_days(self.period['start'], self.period['end'])
        lo, hi = scale
        n = 0
        first, mid = days[0], next((d for d in days if d.day >= 10), days[len(days) // 2])
        payday = max((d for d in days if d.day <= 25), default=days[-1])
        for d in days:
            todo = []
            if d == first:
                todo.append(('rent', r.int(8000, 25000) * 100))
            if d == mid:
                todo.append(('utility', r.int(300, 4000) * 100 + r.int(0, 99)))
            if d == payday:
                todo.append(('payroll', r.int(60000, 240000) * 100))
            for _ in range(repeat):
                if r.chance(cards):
                    todo.append(('card', r.int(lo, hi) * 100 + r.int(0, 99)))
                if r.chance(receipts):
                    todo.append(('receipt', r.int(lo, hi) * 100 + r.int(0, 99)))
                if r.chance(payments):
                    todo.append(('payment', r.int(lo, hi) * 100 + r.int(0, 99)))
            for kind, amount in todo:
                n += 1
                key = f"{KEY[kind]}{n}"
                # Card sales are booked the same day; transfers up to three
                # calendar days before the bank, never outside the period.
                lag = 0 if kind in ('card', 'rent', 'payroll') else r.int(0, 3)
                booked = max(d - timedelta(days=lag), day(self.period['start']))
                text = None
                if long_every and kind == 'payment' and n % long_every == 0:
                    text = f"{WORDS[self.layout]['payment'][0]} {LONG[n % len(LONG)]}"
                self.both(key, iso(d), kind, refs(kind, d, n), amount, booked=iso(booked), text=text)

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
        if self.trailing_page:
            # The closing balance and totals on a page of their own.
            chunks.append([])
        pages, running = [], self.opening
        for n, chunk in enumerate(chunks, 1):
            lines = [{'kind': 'opening', 'balance': self.opening} if n == 1
                     else {'kind': 'brought-forward', 'balance': running}]
            if self.continuation and self.continuation['page'] == n:
                lines.append({'kind': 'continuation', 'text': self.continuation['text']})
            lines += chunk
            if chunk:
                running = chunk[-1]['balance']
            if self.page_totals and chunk:
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
        if 'totalsOff' in self.recipe:
            pages[-1]['lines'][-1]['withdrawal'] += self.recipe['totalsOff']
        if 'carriedForwardOff' in self.recipe:
            fault = self.recipe['carriedForwardOff']
            pages[fault['page'] - 1]['lines'][-1]['balance'] += fault['by']
        if 'declaredPages' in self.recipe:
            fault = self.recipe['declaredPages']
            pages[fault['page'] - 1]['of'] = fault['of']
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
        if self.trailing_page:
            recipe['trailingPage'] = True
        if self.continuation:
            recipe['continuation'] = self.continuation['page']
        return {**head, 'recipe': recipe, 'intent': self.intent,
                'statement': {'account': self.account, 'currency': 'SAR', 'period': self.period, 'pages': pages},
                'cashbook': cash}


def styled(**style):
    return style


def build():
    stories = []

    s = Business('N01', 901, 'withdrawals in dark red, bold control lines and a drawn logo; cashbook entries dated '
                 'before the period that clear in it, a cheque written weeks before the period, interest credited '
                 'by the bank only',
                 producer='weasyprint', font='Roboto', paper='A4', period=('2026-05-01', '2026-05-31'),
                 opening=31275000, per_page=10, bank='Qasr Commercial Bank', document_title='Statement of Account',
                 account='SA03 8000 0000 6080 1016 0901',
                 style=styled(heading='rule', rules='rows', debitColor='#9b1c1c', labelWeight='bold', logo='vector'))
    s.month(cards=35, receipts=25, payments=30, refs=lambda k, d, n: f'QCB{d:%y%m%d}{n:03d}')
    s.both('pp', '2026-05-03', 'payment', 'QCB2604300PP', 1875000, booked='2026-04-30')
    s.movement('oc', '2026-05-05', 'Cheque presented for payment', 'CHQ004417', out=642000)
    s.entry('oc', '2026-04-08', 'Supplier paid by cheque', 'CHQ004417', payment=642000)
    s.intent['review'].append({'bank': ['b:oc'], 'cash': ['c:oc'], 'reason': 'date-gap'})
    s.movement('int', '2026-05-31', 'Profit credited on deposit', into=48217)
    s.intent['bankOnly'].append('b:int')
    stories.append(s)

    s = Business('N02', 902, 'a light heading fill over a full grid; a reference written with inner spaces on the '
                 'statement only, two equal transfers against three equal payments in the same days; cashbook also '
                 'as typed XLSX from SheetJS',
                 producer='weasyprint', font='Source Serif 4', paper='Letter', period=('2026-07-01', '2026-07-31'),
                 opening=8840000, per_page=12, bank='Qasr Commercial Bank', document_title='Statement of Account',
                 account='SA03 8000 0000 6080 1016 0902', cashbook_xlsx='typed',
                 style=styled(heading='filled', rules='grid'))
    s.month(cards=20, receipts=30, payments=30, refs=lambda k, d, n: f'FT{d:%y%m%d}{n:04d}')
    s.movement('sp', '2026-07-14', 'Outgoing SARIE transfer', 'FT 2607 1400', out=560000)
    s.entry('sp', '2026-07-14', 'Supplier invoice paid', 'FT26071400', payment=560000)
    s.intent['review'].append({'bank': ['b:sp'], 'cash': ['c:sp'], 'reason': 'amount-date-suggestion'})
    for n, d in enumerate(['2026-07-21', '2026-07-22'], 1):
        s.movement(f'g{n}', d, 'Outgoing SARIE transfer', out=1000000)
    for n, d in enumerate(['2026-07-20', '2026-07-21', '2026-07-23'], 1):
        s.entry(f'g{n}', d, 'Supplier invoice paid', payment=1000000)
    s.intent['review'].append({'bank': ['b:g1', 'b:g2'], 'cash': ['c:g1', 'c:g2', 'c:g3'],
                               'reason': 'ambiguous-amount-date'})
    stories.append(s)

    s = Business('N03', 903, 'Arabic statement in IBM Plex Sans Arabic, rich in ligatures, with Latin digits, striped '
                 'rows and page totals; payroll, rent and a bill, and a bank charge on the statement only',
                 producer='weasyprint', font='IBM Plex Sans Arabic', paper='A4', layout='ar', digits='latin',
                 period=('2026-09-01', '2026-09-30'), opening=12600000, per_page=10, page_totals=True,
                 bank='مصرف القصر التجاري', document_title='كشف حساب جاري', account='SA03 8000 0000 6080 1016 0903',
                 style=styled(heading='rule', rules='none', stripes=True))
    s.month(cards=30, receipts=20, payments=25, refs=lambda k, d, n: f'SR{d:%m%d}{n:04d}')
    s.movement('fee', '2026-09-29', 'رسوم خدمات مصرفية', out=11500)
    s.intent['bankOnly'].append('b:fee')
    stories.append(s)

    s = Business('N04', 904, 'Arabic statement in Cairo with Arabic-Indic digits: opened overdrawn and recovering, '
                 'the closing balance and totals on a last page without movements, one reference twice on each side',
                 producer='weasyprint', font='Cairo', paper='A4', layout='ar', digits='arabic',
                 period=('2026-02-01', '2026-02-28'), opening=-4250000, per_page=9, trailing_page=True,
                 bank='مصرف القصر التجاري', document_title='كشف حساب', account='SA03 8000 0000 6080 1016 0904',
                 style=styled(heading='filled', rules='rows'))
    s.month(cards=30, receipts=30, payments=15, scale=(50, 20000), refs=lambda k, d, n: f'TT{d:%m%d}{n:03d}')
    for n, d in enumerate(['2026-02-16', '2026-02-17'], 1):
        s.movement(f'dr{n}', d, 'تحويل سريع صادر', 'BATCH-0216', out=275000 * n)
        s.entry(f'dr{n}', d, 'سداد فاتورة مورد', 'BATCH-0216', payment=275000 * n)
    s.intent['review'].append({'bank': ['b:dr1', 'b:dr2'], 'cash': ['c:dr1', 'c:dr2'], 'reason': 'duplicate-reference'})
    stories.append(s)

    s = Business('N05', 905, 'quarter on 29 small A5 pages in a monospaced font with page totals, long descriptions '
                 'that wrap, and a description continuing at the top of page 9',
                 producer='weasyprint', font='IBM Plex Mono', paper='A5', period=('2026-01-01', '2026-03-31'),
                 opening=96000000, per_page=8, page_totals=True, bank='Qasr Commercial Bank',
                 document_title='Statement of Account', account='SA03 8000 0000 6080 1016 0905',
                 style=styled(heading='rule', rules='none'))
    s.month(cards=60, receipts=55, payments=60, refs=lambda k, d, n: f'Q1-{n:05d}', long_every=7, repeat=2)
    s.continuation = {'page': 9, 'text': '(continued) batch Q1-0442 settlement'}
    stories.append(s)

    s = Business('N06', 906, 'the statement total of withdrawals printed 0.01 above the sum of the withdrawals',
                 producer='weasyprint', font='Lato', paper='A4', period=('2026-08-01', '2026-08-15'),
                 opening=5500000, per_page=9, bank='Qasr Commercial Bank', document_title='Statement of Account',
                 account='SA03 8000 0000 6080 1016 0906', style=styled(heading='rule', rules='rows'))
    s.month(cards=40, receipts=30, payments=40, refs=lambda k, d, n: f'FT{d:%m%d}{n:03d}')
    s.recipe['totalsOff'] = 1
    s.held('balance-broken')
    stories.append(s)

    s = Business('N07', 907, 'MuPDF layout with vertical rules; cashbook entries before the period clearing in it, '
                 'equal amounts three days apart without references, one payment split in two under its reference',
                 producer='mupdf', font='Lato', paper='A4', period=('2026-06-01', '2026-06-30'),
                 opening=22000000, per_page=11, bank='Najd Investment Bank', document_title='Account Statement',
                 account='SA61 1000 0000 4040 2020 0907', style=styled(heading='rule', rules='grid'))
    s.month(cards=25, receipts=30, payments=30, refs=lambda k, d, n: f'NIB/{d:%m%d}/{n:03d}')
    s.both('pp', '2026-06-01', 'receipt', 'NIB/0529/PP1', 3310000, booked='2026-05-29')
    s.movement('a3', '2026-06-18', 'Cash deposit at branch', into=777700)
    s.entry('a3', '2026-06-15', 'Customer collection', receipt=777700)
    s.intent['review'].append({'bank': ['b:a3'], 'cash': ['c:a3'], 'reason': 'amount-date-suggestion'})
    s.movement('sp', '2026-06-24', 'Outgoing SARIE transfer', 'NIB/0624/SPL', out=900000)
    s.entry('sp1', '2026-06-23', 'Supplier invoice paid', 'NIB/0624/SPL', payment=450000)
    s.entry('sp2', '2026-06-24', 'Supplier invoice paid', 'NIB/0624/SPL', payment=450000)
    s.intent['review'].append({'bank': ['b:sp'], 'cash': ['c:sp1', 'c:sp2'], 'reason': 'duplicate-reference'})
    stories.append(s)

    s = Business('N08', 908, 'MuPDF layout with the bank logo as a small raster image in the letterhead, outside '
                 'the table; a value date after the period',
                 producer='mupdf', font='Roboto', paper='Letter', period=('2026-10-01', '2026-10-31'),
                 opening=6400000, per_page=12, bank='Najd Investment Bank', document_title='Account Statement',
                 account='SA61 1000 0000 4040 2020 0908', style=styled(heading='rule', rules='rows', logo='raster'))
    s.month(cards=25, receipts=25, payments=25, refs=lambda k, d, n: f'NIB/{d:%m%d}/{n:03d}')
    s.both('vt', '2026-10-29', 'receipt', 'NIB/1029/VT', 1499900, value='2026-11-01')
    s.intent['timing'].append('b:vt')
    stories.append(s)

    s = Business('N09', 909, 'Arabic statement in Tajawal with Latin digits, laid out right to left column by column '
                 'by the writer, which draws Arabic in reading order; a deposit dated before the period by value',
                 producer='mupdf', font='Tajawal', paper='A4', layout='ar', digits='latin',
                 period=('2026-03-01', '2026-03-31'), opening=17500000, per_page=10, bank='مصرف نجد للاستثمار',
                 document_title='كشف حساب', account='SA61 1000 0000 4040 2020 0909',
                 style=styled(heading='filled', rules='rows'))
    s.month(cards=30, receipts=25, payments=25, scale=(50, 25000), refs=lambda k, d, n: f'NJ{d:%m%d}{n:03d}')
    s.both('v0', '2026-03-01', 'receipt', 'NJ0301V00', 2100000, value='2026-02-26')
    s.intent['timing'].append('b:v0')
    stories.append(s)

    s = Business('N10', 910, 'MuPDF layout on A4 landscape in a monospaced font; cashbook also as typed XLSX from '
                 'openpyxl, with whole riyals and amounts of one decimal',
                 producer='mupdf', font='IBM Plex Mono', paper='A4-landscape', period=('2026-11-01', '2026-11-30'),
                 opening=14000000, per_page=14, bank='Najd Investment Bank', document_title='Account Statement',
                 account='SA61 1000 0000 4040 2020 0910', cashbook_xlsx='typed',
                 style=styled(heading='rule', rules='none'))
    s.month(cards=30, receipts=30, payments=30, refs=lambda k, d, n: f'NIB/{d:%m%d}/{n:03d}')
    # Amounts a typed cell stores without its printed decimals.
    s.both('w1', '2026-11-11', 'payment', 'NIB/1111/W1', 1250000)
    s.both('w2', '2026-11-12', 'receipt', 'NIB/1112/W2', 33450)
    s.both('w3', '2026-11-16', 'payment', 'NIB/1116/W3', 70010)
    stories.append(s)

    s = Business('N11', 911, 'page 2 declares four pages where the statement has three',
                 producer='mupdf', font='Lato', paper='A4', period=('2026-04-01', '2026-04-30'),
                 opening=9100000, per_page=9, bank='Najd Investment Bank', document_title='Account Statement',
                 account='SA61 1000 0000 4040 2020 0911', style=styled(heading='rule', rules='rows'))
    s.month(cards=30, receipts=25, payments=25, refs=lambda k, d, n: f'NIB/{d:%m%d}/{n:03d}')
    s.recipe['declaredPages'] = {'page': 2, 'of': 4}
    s.held('incomplete-pages')
    stories.append(s)

    s = Business('N12', 912, 'the balance carried forward from page 1 printed 10.00 above the running balance',
                 producer='mupdf', font='Roboto', paper='A4', period=('2026-12-01', '2026-12-31'),
                 opening=11800000, per_page=10, bank='Najd Investment Bank', document_title='Account Statement',
                 account='SA61 1000 0000 4040 2020 0912', style=styled(heading='rule', rules='rows'))
    s.month(cards=30, receipts=25, payments=25, refs=lambda k, d, n: f'NIB/{d:%m%d}/{n:03d}')
    s.recipe['carriedForwardOff'] = {'page': 1, 'by': 1000}
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
