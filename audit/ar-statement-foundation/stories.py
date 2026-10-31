"""AR-1 PDF foundation: synthetic customer statements and AR ledgers as facts.

Each story is a customer statement the company prints, with its sections, and
the company AR ledger for one confirmed scope in the existing ar-limited-1
CSV family. Amounts are written as printed.

`statement.pages` is what each page prints, line by line, and nothing more:
  {"text": str, "align": "start"|"center"}  a line of text;
  {"headings": [str, ...]}                    the column heading line;
  {"cells": [[heading, value], ...]}          values under printed headings.
No line says what it is. render.py prints exactly these lines and
verify_assets.py reads them back from the PDF. `recipe` is how the story was
made and which fault was planted; `intent` is the expected outcome, written by
hand. oracle.py reads neither: it derives the outcome from the printed lines,
the ledger file and the contract, and must agree with `intent`. Nothing here
is read by the product.
  python3 -B audit/ar-statement-foundation/stories.py > stories.json
"""
import json
import random

VERSION = 'ar-statement-foundation-1'
SCOPE = {
    'entity': 'Synthetic Seller Co',
    'ledger': 'AR Book',
    'customer': 'C0001',
    'account': '1200',
    'currency': 'SAR',
    'start': '2026-09-01',
    'end': '2026-09-30',
}
EN = {
    'title': 'Statement of account',
    'issued': 'Issued by',
    'ledger': 'Ledger',
    'customer': 'Customer ID',
    'name': 'Customer name',
    'account': 'Account',
    'currency': 'Currency',
    'period': 'Period',
    'to': 'to',
    'total': 'Section total',
    'page': 'Page {n} of {N}',
    'kinds': {'invoice': 'invoice', 'credit-note': 'credit-note', 'receipt': 'receipt'},
    'h': {
        'date': 'Date', 'type': 'Type', 'document': 'Document No',
        'related': 'Related invoice', 'description': 'Description',
        'original': 'Original amount', 'open': 'Open amount', 'balance': 'Balance',
    },
}
AR = {
    'title': 'كشف حساب',
    'issued': 'صادر عن',
    'ledger': 'الدفتر',
    'customer': 'رقم العميل',
    'name': 'اسم العميل',
    'account': 'الحساب',
    'currency': 'العملة',
    'period': 'الفترة',
    'to': 'إلى',
    'total': 'إجمالي القسم',
    'page': 'صفحة {n} من {N}',
    'kinds': {'invoice': 'فاتورة', 'credit-note': 'إشعار دائن', 'receipt': 'قبض'},
    'h': {
        'date': 'التاريخ', 'type': 'النوع', 'document': 'رقم المستند',
        'related': 'الفاتورة المرتبطة', 'description': 'البيان',
        'original': 'المبلغ الأصلي', 'open': 'المبلغ المفتوح', 'balance': 'الرصيد',
    },
}
ARABIC_DIGITS = str.maketrans('0123456789', '٠١٢٣٤٥٦٧٨٩')
LEDGER_COLUMNS = ['Posting ID', 'Document type', 'Own document number', 'Posting date',
                  'Original signed amount', 'Entity', 'Ledger', 'Customer', 'Account',
                  'Currency', 'Related invoice', 'Description']
DEFAULT_COLUMNS = ['date', 'type', 'document', 'description', 'original', 'balance']


def money(minor, arabic=False):
    sign = '-' if minor < 0 else ''
    whole, cents = divmod(abs(minor), 100)
    text = f'{sign}{whole:,}.{cents:02d}'
    if arabic:
        text = text.replace(',', '٬').replace('.', '٫').translate(ARABIC_DIGITS)
    return text


def plain(minor):
    sign = '-' if minor < 0 else ''
    whole, cents = divmod(abs(minor), 100)
    return f'{sign}{whole}.{cents:02d}'


def doc(kind, number, date, minor, description='', related='', open_minor=None):
    return {'kind': kind, 'document': number, 'date': date, 'amount': minor,
            'description': description, 'related': related, 'open': open_minor}


def section(customer='C0001', account='1200', currency='SAR', start='2026-09-01',
            end='2026-09-30', name='Synthetic Buyer One', docs=(), columns=None,
            drop=None, override=None):
    return {'customer': customer, 'account': account, 'currency': currency,
            'start': start, 'end': end, 'name': name, 'docs': list(docs),
            'columns': columns or DEFAULT_COLUMNS, 'drop': drop, 'override': override or {}}


class Printer:
    """Lays a statement out on pages of at most `per_page` table lines."""

    def __init__(self, lang='en', entity=SCOPE['entity'], ledger=SCOPE['ledger'], per_page=24):
        self.L = EN if lang == 'en' else AR
        self.arabic = lang == 'ar'
        self.entity, self.ledger, self.per_page = entity, ledger, per_page
        self.pages, self.page, self.used = [], [], 0

    def num(self, text):
        return text.translate(ARABIC_DIGITS) if self.arabic else text

    def text(self, value, align='start'):
        self.page.append({'text': value, 'align': align})

    def new_page(self):
        if self.page:
            self.pages.append(self.page)
        self.page, self.used = [], 0
        self.text(self.L['title'])
        self.text(f"{self.L['issued']}: {self.entity}")
        self.text(f"{self.L['ledger']}: {self.ledger}")

    def header(self, s):
        L, drop, o = self.L, s['drop'], s['override']
        fields = [
            ('customer', f"{L['customer']}: {o.get('customer', s['customer'])}"),
            ('name', f"{L['name']}: {s['name']}"),
            ('account', f"{L['account']}: {self.num(o.get('account', s['account']))}"),
            ('currency', f"{L['currency']}: {o.get('currency', s['currency'])}"),
            ('period', f"{L['period']}: {self.num(s['start'])} {L['to']} {self.num(s['end'])}"),
        ]
        for key, line in fields:
            if key != drop:
                self.text(line)
        self.page.append({'headings': [self.heading(c) for c in s['columns']]})

    def heading(self, column):
        return self.L['h'].get(column, column)

    def row(self, s, d, balance):
        values = {
            'date': self.num(d['date']),
            'type': self.L['kinds'][d['kind']],
            'document': d['document'],
            'related': d['related'],
            'description': d['description'],
            'original': d['printed'] if 'printed' in d else (money(d['amount'], self.arabic) if d['amount'] is not None else ''),
            'open': money(d['open'], self.arabic) if d['open'] is not None else '',
            'balance': money(balance, self.arabic),
        }
        values.update(d.get('extra', {}))
        return {'cells': [[self.heading(c), values[c]] for c in s['columns'] if values.get(c, '') != '']}

    def statement(self, sections, orphan=None):
        self.new_page()
        if orphan:
            self.page.append({'headings': [self.heading(c) for c in DEFAULT_COLUMNS]})
            self.page.append(self.row({'columns': DEFAULT_COLUMNS}, orphan, orphan['amount']))
            self.used += 1
        for index, s in enumerate(sections):
            if index and self.used > self.per_page - 6:
                self.close_page()
                self.new_page()
            self.header(s)
            balance = 0
            for d in s['docs']:
                if self.used >= self.per_page:
                    self.close_page()
                    self.new_page()
                    self.header(s)
                balance += d['amount'] or 0
                self.page.append(self.row(s, d, balance))
                self.used += 1
            total = sum(d['amount'] or 0 for d in s['docs'])
            self.text(f"{self.L['total']}: {money(total, self.arabic)}")
            self.used += 1
        self.close_page()
        n = len(self.pages)
        for i, page in enumerate(self.pages):
            page.append({'text': self.num(self.L['page'].format(n=i + 1, N=n)), 'align': 'center'})
        return {'pages': self.pages}

    def close_page(self):
        if self.page:
            self.pages.append(self.page)
        self.page, self.used = [], 0


def ledger_rows(docs, scope=SCOPE, prefix='L'):
    rows = []
    for i, d in enumerate(docs, 1):
        rows.append({
            'Posting ID': f'{prefix}{i:04d}', 'Document type': d['kind'],
            'Own document number': d['document'], 'Posting date': d['date'],
            'Original signed amount': plain(d['amount']), 'Entity': scope['entity'],
            'Ledger': scope['ledger'], 'Customer': scope['customer'], 'Account': scope['account'],
            'Currency': scope['currency'], 'Related invoice': d['related'],
            'Description': d['description'],
        })
    return rows


def base_docs():
    return [
        doc('invoice', 'INV-1001', '2026-09-02', 125000, 'Valve spares'),
        doc('invoice', 'INV-1002', '2026-09-04', 48010, 'Pallet wrap'),
        doc('receipt', 'RC-501', '2026-09-08', -125000, 'Transfer received'),
        doc('invoice', 'INV-1003', '2026-09-11', 230000, 'Steel fittings'),
        doc('credit-note', 'CN-71', '2026-09-14', -12000, 'Price adjustment', related='INV-1003'),
        doc('invoice', 'INV-1004', '2026-09-18', 91575, 'Packing crates'),
        doc('receipt', 'RC-502', '2026-09-22', -48010, 'Transfer received'),
        doc('invoice', 'INV-1005', '2026-09-27', 15550, 'Safety gloves'),
    ]


def stories():
    out = []

    def add(sid, title, statement, ledger, recipe, intent, scope=None, lang='en'):
        out.append({'id': sid, 'title': title, 'layout': lang, 'scope': scope or dict(SCOPE),
                    'statement': statement, 'ledger': ledger, 'recipe': recipe, 'intent': intent})

    docs = base_docs()
    add('A01', 'One section, all documents in the ledger',
        Printer().statement([section(docs=docs)]), ledger_rows(docs),
        'one section, eight documents of three types; the ledger holds the same eight',
        {'status': 'matched', 'matched': 8, 'review': {}})

    same = [
        doc('invoice', '1001', '2026-09-03', 50000, 'Fasteners'),
        doc('credit-note', '1001', '2026-09-05', -5000, 'Short delivery', related='1001'),
        doc('receipt', '1001', '2026-09-09', -45000, 'Transfer received'),
        doc('invoice', '1002', '2026-09-12', 70000, 'Cable reels'),
    ]
    ledger_same = same[:3] + [doc('receipt', '1002', '2026-09-12', -70000, 'Transfer received')]
    add('A02', 'One number for three document types, and one number on another type',
        Printer().statement([section(docs=same)]), ledger_rows(ledger_same),
        'invoice, credit note and receipt all numbered 1001; the statement has invoice 1002 and the ledger receipt 1002 for the same money',
        {'status': 'review', 'matched': 3, 'review': {'missing-counterpart': 2}})

    a_docs = [doc('invoice', '2001', '2026-09-06', 75000, 'Office chairs'),
              doc('invoice', '2002', '2026-09-15', 20000, 'Paper')]
    b_docs = [doc('invoice', '2001', '2026-09-06', 75000, 'Office chairs'),
              doc('invoice', '2003', '2026-09-16', 31000, 'Toner')]
    two = Printer().statement([section(docs=a_docs),
                               section(customer='C0002', name='Synthetic Buyer Two', docs=b_docs)])
    add('A03', 'Two customers in one print, the same invoice number and amount',
        two, ledger_rows(a_docs),
        'customer C0001 then C0002, each with invoice 2001 for 750.00 on the same day; confirmed scope C0001',
        {'status': 'matched', 'matched': 2, 'review': {}, 'outOfScopeLines': 2})
    scope_b = dict(SCOPE, customer='C0002')
    add('A04', 'The same print, confirmed for the second customer',
        json.loads(json.dumps(two)), ledger_rows(b_docs, scope_b),
        'the statement of A03 printed again; confirmed scope C0002 and its own ledger',
        {'status': 'matched', 'matched': 2, 'review': {}, 'outOfScopeLines': 2}, scope=scope_b)

    rnd = random.Random(405)
    cont = []
    for i in range(40):
        kind = 'invoice' if i % 4 else 'receipt'
        minor = rnd.randint(1000, 900000) * (1 if kind == 'invoice' else -1)
        cont.append(doc(kind, f"{'INV' if kind == 'invoice' else 'RC'}-{3000 + i}",
                        f'2026-09-{1 + i * 29 // 39:02d}', minor, 'Monthly supply'))
    add('A05', 'One section over three pages, its header repeated identically',
        Printer(per_page=16).statement([section(docs=cont)]), ledger_rows(cont),
        'forty documents; each page repeats the section header and the column headings',
        {'status': 'matched', 'matched': 40, 'review': {}})

    sar = [doc('invoice', '3001', '2026-09-03', 100000, 'Pumps'),
           doc('receipt', 'RC-61', '2026-09-10', -100000, 'Transfer received')]
    usd = [doc('invoice', '3005', '2026-09-12', 100000, 'Spare parts'),
           doc('invoice', '3006', '2026-09-19', 45000, 'Freight')]
    p = Printer(per_page=4).statement([section(docs=sar), section(currency='USD', docs=usd)])
    add('A06', 'The currency changes after a page break',
        p, ledger_rows(sar + [doc('invoice', '3005', '2026-09-12', 100000, 'Spare parts')]),
        'page 1 holds the SAR section, page 2 a USD section of the same customer; the SAR ledger also holds an invoice 3005 for the same digits as the USD one',
        {'status': 'review', 'matched': 2, 'review': {'missing-counterpart': 1}, 'outOfScopeLines': 2})

    open_docs = [doc('invoice', '4001', '2026-09-02', 100000, 'Generator', open_minor=20000),
                 doc('invoice', '4002', '2026-09-09', 50000, 'Cables', open_minor=0),
                 doc('invoice', '4003', '2026-09-16', 80000, 'Lamps', open_minor=20000)]
    open_ledger = open_docs[:2] + [doc('invoice', '4003', '2026-09-16', 20000, 'Lamps')]
    cols = ['date', 'type', 'document', 'description', 'original', 'open', 'balance']
    add('A07', 'Original 1000, open 200',
        Printer().statement([section(docs=open_docs, columns=cols)]), ledger_rows(open_ledger),
        'original and open amounts printed; the ledger holds the original amounts, except invoice 4003 recorded at its open amount',
        {'status': 'review', 'matched': 2, 'review': {'amount-difference': 1}})

    cn = [doc('invoice', 'INV-1005', '2026-09-03', 60000, 'Valves'),
          doc('credit-note', 'CN-77', '2026-09-08', -6000, 'Return', related='INV-1005'),
          doc('invoice', 'INV-1006', '2026-09-10', 30000, 'Seals'),
          doc('credit-note', 'CN-78', '2026-09-14', -3000, 'Return', related='INV-1006')]
    cn_ledger = cn[:3] + [doc('credit-note', 'CN-78', '2026-09-14', -3000, 'Return', related='INV-1007')]
    cols = ['date', 'type', 'document', 'related', 'description', 'original', 'balance']
    add('A08', 'A credit note carries its own number and the invoice it relates to',
        Printer().statement([section(docs=cn, columns=cols)]), ledger_rows(cn_ledger),
        'CN-77 relates to INV-1005 on both sides; CN-78 relates to INV-1006 in the statement and INV-1007 in the ledger',
        {'status': 'review', 'matched': 3, 'review': {'related-conflict': 1}})

    bad = base_docs()
    bad[3] = dict(bad[3], printed='2,3O0.00')
    add('A09', 'A line whose amount cannot be read is kept, and blocks the pair',
        Printer().statement([section(docs=bad)]), ledger_rows(base_docs()),
        'invoice INV-1003 printed with the letter O for a zero',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_AMOUNT']})

    orphan = doc('invoice', 'INV-0999', '2026-09-01', 10000, 'Earlier order')
    add('A10', 'A detail line before any section header',
        Printer().statement([section(docs=base_docs())], orphan=orphan), ledger_rows(base_docs()),
        'column headings and one line printed after the document header, before the first Customer ID',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_PDF_ORPHAN_LINE']})

    add('A11', 'A section header without its currency',
        Printer().statement([section(docs=base_docs(), drop='currency')]), ledger_rows(base_docs()),
        'the Currency line of the only section is not printed',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_PDF_HEADER']})

    ar_docs = [dict(d, description=text) for d, text in zip(base_docs()[:6], [
        'قطع غيار صمامات', 'غلاف منصات', 'تحويل مستلم', 'تجهيزات حديد', 'تسوية سعر', 'صناديق تعبئة'])]
    add('A12', 'An Arabic statement with Arabic-Indic digits',
        Printer(lang='ar').statement([section(docs=ar_docs, name='المشتري الاصطناعي الأول')]),
        ledger_rows(ar_docs),
        'Arabic labels, types and headings; dates and amounts in Arabic-Indic digits',
        {'status': 'matched', 'matched': 6, 'review': {}}, lang='ar')

    diff = base_docs()
    diff_ledger = [dict(d) for d in diff]
    diff_ledger[1] = dict(diff_ledger[1], amount=48110)
    diff_ledger[2] = dict(diff_ledger[2], date='2026-09-09')
    add('A13', 'An amount one riyal apart and a receipt dated a day later',
        Printer().statement([section(docs=diff)]), ledger_rows(diff_ledger),
        'ledger INV-1002 at 481.10 against 480.10; ledger RC-501 on 9 September against 8 September',
        {'status': 'review', 'matched': 6, 'review': {'amount-difference': 1, 'date-difference': 1}})

    dup = base_docs()[:5] + [doc('invoice', 'INV-1002', '2026-09-19', 48010, 'Pallet wrap')]
    dup_ledger = base_docs()[:4] + [doc('receipt', 'RC-509', '2026-09-25', -10000, 'Transfer received')]
    add('A14', 'A document printed twice, and documents on one side only',
        Printer().statement([section(docs=dup)]), ledger_rows(dup_ledger),
        'INV-1002 printed twice; CN-71 only in the statement; RC-509 only in the ledger',
        {'status': 'review', 'matched': 3, 'review': {'duplicate-document': 1, 'missing-counterpart': 2}})

    rep = Printer().statement([section(docs=base_docs()[:3]),
                               section(customer='C0002', name='Synthetic Buyer Two', docs=b_docs),
                               section(docs=base_docs()[3:6])])
    add('A15', 'The confirmed customer heads two separate sections',
        rep, ledger_rows(base_docs()[:6]),
        'C0001, then C0002, then C0001 again with the remaining documents',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_PDF_SCOPE_REPEATED']})

    add('A16', 'The confirmed customer is not in the print',
        Printer().statement([section(customer='C0002', name='Synthetic Buyer Two', docs=b_docs)]),
        ledger_rows(a_docs),
        'only customer C0002 is printed; confirmed scope C0001',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_PDF_SCOPE_NOT_FOUND']})

    rnd = random.Random(1717)
    long_docs = []
    for i in range(750):
        kind = ('invoice', 'invoice', 'receipt', 'credit-note')[i % 4]
        minor = rnd.randint(500, 5000000)
        if kind != 'invoice':
            minor = -minor
        long_docs.append(doc(kind, f"{ {'invoice': 'INV', 'receipt': 'RC', 'credit-note': 'CN'}[kind]}-{10000 + i}",
                             f'2026-09-{1 + i * 29 // 749:02d}', minor, 'Recurring supply'))
    add('A17', 'One section over thirty-two pages',
        Printer().statement([section(docs=long_docs)]), ledger_rows(long_docs),
        'seven hundred and fifty documents, twenty-four to a page',
        {'status': 'matched', 'matched': 750, 'review': {}})

    mixed_cols = ['date', 'type', 'document', 'Customer', 'Currency', 'original', 'balance']
    mixed = [dict(d, extra={'Customer': 'C0001', 'Currency': 'SAR'}) for d in base_docs()[:5]]
    add('A18', 'A section that also prints the scope on every line',
        Printer().statement([section(docs=mixed, columns=mixed_cols)]), ledger_rows(base_docs()[:5]),
        'the table adds Customer and Currency columns, as the per-row family does',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_PDF_COLUMNS']})

    add('A19', 'The statement is issued by another entity',
        Printer(entity='Other Seller LLC').statement([section(docs=base_docs())]), ledger_rows(base_docs()),
        'Issued by names another company; the sections and ledger are as A01',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_PDF_SCOPE_NOT_FOUND']})

    return out


def main():
    print(json.dumps({'version': VERSION, 'stories': stories()}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
