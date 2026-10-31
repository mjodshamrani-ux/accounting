"""AR-1 PDF A5 holdout: customer statements from two writers other than
ReportLab, as facts.

A new lineage, written after the AR-1 reader, engine, lifecycle and
interface (A1 to A4) and before any product run on these files. Every story
stays inside the contract the foundation proposed
(../ar-statement-foundation/contract.json) and varies what the foundation
held fixed:
- the writer: LibreOffice Writer for B01 to B08 and B17, iText Core for B09
  to B16 and B18 (iText lays out no right-to-left text without its
  commercial add-on, so its statements are English);
- the structure: the document header on the first page only, a section that
  continues over pages under its column headings alone or under nothing,
  sections that start on a new page or flow on one, the column order, no
  balance column, no customer name, no section total, no page footer;
- the semantics: Kuwaiti dinars to three places and yen to none, amounts
  without thousands separators, an Arabic statement with Latin digits beside
  one with Arabic-Indic digits and separators, document numbers with slashes;
- the economics: a batch print whose other customers carry the confirmed
  customer's document numbers and amounts, the same number in four
  currencies, a confirmed period that spans two printed periods, a document
  reprinted out of order.

The facts model is the foundation's: `statement.pages` is what each page
prints, line by line, and nothing more:
  {"text": str, "align": "start"|"center"}  a line of text;
  {"headings": [str, ...]}                    the column heading line;
  {"cells": [[heading, value], ...]}          values under printed headings.
render.py prints exactly these lines and verify.py reads them back from the
PDF, values under their headings. `recipe` says how the story was made and
which fault was planted; `intent` is the expected outcome, written by hand.
The sealed foundation oracle reads neither: it derives the outcome from the
printed lines, the ledger file and the contract, and check_seal.py requires
it to agree with `intent`. Nothing here is read by the product.
  python3 -B audit/ar-statement-holdout-a5/stories.py > stories.json
"""
import json
import random

VERSION = 'ar-statement-holdout-a5-1'
SCOPE = {
    'entity': 'Synthetic Gulf Supplies',
    'ledger': 'Receivables 2026',
    'customer': 'K-204',
    'account': '1130',
    'currency': 'SAR',
    'start': '2026-08-01',
    'end': '2026-08-31',
}
PLACES = {'SAR': 2, 'USD': 2, 'EUR': 2, 'KWD': 3, 'JPY': 0}
EN = {
    'title': 'Statement of account', 'issued': 'Issued by', 'ledger': 'Ledger',
    'customer': 'Customer ID', 'name': 'Customer name', 'account': 'Account',
    'currency': 'Currency', 'period': 'Period', 'to': 'to', 'total': 'Section total',
    'page': 'Page {n} of {N}',
    'kinds': {'invoice': 'invoice', 'credit-note': 'credit-note', 'receipt': 'receipt'},
    'h': {'date': 'Date', 'type': 'Type', 'document': 'Document No',
          'related': 'Related invoice', 'description': 'Description',
          'original': 'Original amount', 'open': 'Open amount', 'balance': 'Balance'},
}
AR = {
    'title': 'كشف حساب', 'issued': 'صادر عن', 'ledger': 'الدفتر',
    'customer': 'رقم العميل', 'name': 'اسم العميل', 'account': 'الحساب',
    'currency': 'العملة', 'period': 'الفترة', 'to': 'إلى', 'total': 'إجمالي القسم',
    'page': 'صفحة {n} من {N}',
    'kinds': {'invoice': 'فاتورة', 'credit-note': 'إشعار دائن', 'receipt': 'قبض'},
    'h': {'date': 'التاريخ', 'type': 'النوع', 'document': 'رقم المستند',
          'related': 'الفاتورة المرتبطة', 'description': 'البيان',
          'original': 'المبلغ الأصلي', 'open': 'المبلغ المفتوح', 'balance': 'الرصيد'},
}
INDIC = str.maketrans('0123456789', '٠١٢٣٤٥٦٧٨٩')
LEDGER_COLUMNS = ['Posting ID', 'Document type', 'Own document number', 'Posting date',
                  'Original signed amount', 'Entity', 'Ledger', 'Customer', 'Account',
                  'Currency', 'Related invoice', 'Description']
DEFAULT = ['date', 'type', 'document', 'description', 'original', 'balance']


def money(minor, places, indic=False, separators=True):
    sign = '-' if minor < 0 else ''
    whole, frac = divmod(abs(minor), 10 ** places)
    text = f'{whole:,}' if separators else str(whole)
    if places:
        text += f'.{frac:0{places}d}'
    text = sign + text
    if indic:
        text = text.replace(',', '٬').replace('.', '٫').translate(INDIC)
    return text


def plain(minor, places):
    return money(minor, places, separators=False)


def doc(kind, number, date, minor, description='', related='', open_minor=None, **extra):
    return {'kind': kind, 'document': number, 'date': date, 'amount': minor,
            'description': description, 'related': related, 'open': open_minor, **extra}


def section(customer='K-204', name='Synthetic Retail Four', account='1130', currency='SAR',
            start='2026-08-01', end='2026-08-31', docs=(), columns=DEFAULT, period=None):
    return {'customer': customer, 'name': name, 'account': account, 'currency': currency,
            'start': start, 'end': end, 'docs': list(docs), 'columns': list(columns),
            'period': period}


class Layout:
    """Lays a statement out on pages, as its writer's application would:
    `header` 'every' or 'first' page; a section continued on a new page
    repeats `repeat`: 'section' (its header and column headings), 'headings'
    (the column headings alone) or 'none'; `breaks` 'page' starts each
    section on a new page, 'flow' only when fewer than `room` table lines
    are left; `per_page` table lines (details and totals) to a page."""

    def __init__(self, lang='en', digits='latin', header='every', repeat='headings',
                 breaks='flow', per_page=24, room=6, totals=True, footer=True, names=True,
                 separators=True, entity=SCOPE['entity'], ledger=SCOPE['ledger'], ledgers=None):
        self.L = EN if lang == 'en' else AR
        self.indic = digits == 'arabic'
        self.header, self.repeat, self.breaks = header, repeat, breaks
        self.per_page, self.room = per_page, room
        self.totals, self.footer, self.names, self.separators = totals, footer, names, separators
        self.entity, self.ledger = entity, ledger
        # A different ledger name printed on a later page, by page number.
        self.ledgers = ledgers or {}
        self.pages, self.page, self.used = [], None, 0

    def num(self, text):
        return text.translate(INDIC) if self.indic else text

    def text(self, value, align='start'):
        self.page.append({'text': value, 'align': align})

    def heading(self, column):
        return self.L['h'].get(column, column)

    def start_page(self):
        self.page, self.used = [], 0
        n = len(self.pages) + 1
        if n == 1 or self.header == 'every':
            self.text(self.L['title'])
            self.text(f"{self.L['issued']}: {self.entity}")
            self.text(f"{self.L['ledger']}: {self.ledgers.get(n, self.ledger)}")

    def end_page(self):
        self.pages.append(self.page)
        self.page = None

    def section_header(self, s):
        L = self.L
        self.text(f"{L['customer']}: {s['customer']}")
        if self.names and s['name']:
            self.text(f"{L['name']}: {s['name']}")
        self.text(f"{L['account']}: {self.num(s['account'])}")
        self.text(f"{L['currency']}: {s['currency']}")
        period = s['period'] or f"{self.num(s['start'])} {L['to']} {self.num(s['end'])}"
        self.text(f"{L['period']}: {period}")
        self.headings(s)

    def headings(self, s):
        self.page.append({'headings': [self.heading(c) for c in s['columns']]})

    def row(self, s, d, balance):
        places = PLACES[s['currency']]
        values = {
            'date': self.num(d.get('printedDate', d['date'])),
            'type': d.get('printedType', self.L['kinds'].get(d['kind'], d['kind'])),
            'document': d['document'],
            'related': d['related'],
            'description': d['description'],
            'original': d['printed'] if 'printed' in d else (
                money(d['amount'], places, self.indic, self.separators) if d['amount'] is not None else ''),
            'open': money(d['open'], places, self.indic, self.separators) if d['open'] is not None else '',
            'balance': money(balance, places, self.indic, self.separators),
        }
        values.update(d.get('extra', {}))
        return {'cells': [[self.heading(c), values[c]] for c in s['columns'] if values.get(c, '') != '']}

    def statement(self, sections, orphan=None):
        self.start_page()
        if orphan:
            self.headings(orphan['section'])
            self.page.append(self.row(orphan['section'], orphan['doc'], orphan['doc']['amount']))
            self.used += 1
        for index, s in enumerate(sections):
            if index and (self.breaks == 'page' or self.used > self.per_page - self.room):
                self.end_page()
                self.start_page()
            self.section_header(s)
            balance = 0
            for d in s['docs']:
                if self.used >= self.per_page:
                    self.end_page()
                    self.start_page()
                    if self.repeat == 'section':
                        self.section_header(s)
                    elif self.repeat == 'headings':
                        self.headings(s)
                balance += d['amount'] or 0
                self.page.append(self.row(s, d, balance))
                self.used += 1
            if self.totals:
                total = sum(d['amount'] or 0 for d in s['docs'])
                self.text(f"{self.L['total']}: {money(total, PLACES[s['currency']], self.indic, self.separators)}")
                self.used += 1
        self.end_page()
        if self.footer:
            n = len(self.pages)
            for i, page in enumerate(self.pages):
                page.append({'text': self.num(self.L['page'].format(n=i + 1, N=n)), 'align': 'center'})
        return {'pages': self.pages}


def ledger_rows(docs, scope=SCOPE, prefix='P', order=None):
    places = PLACES[scope['currency']]
    rows = []
    for i, d in enumerate(docs, 1):
        rows.append({
            'Posting ID': f'{prefix}{i:05d}', 'Document type': d['kind'],
            'Own document number': d['document'], 'Posting date': d['date'],
            'Original signed amount': plain(d['amount'], places), 'Entity': scope['entity'],
            'Ledger': scope['ledger'], 'Customer': scope['customer'], 'Account': scope['account'],
            'Currency': scope['currency'], 'Related invoice': d['related'],
            'Description': d['description'],
        })
    if order is not None:
        random.Random(order).shuffle(rows)
    return rows


def generated(seed, count, prefix, lo, hi, places_scale=1, description='Monthly supply'):
    """`count` documents over August: every fifth a receipt for the invoice
    before it, every seventh a credit note against the invoice before it,
    the rest invoices."""
    rnd = random.Random(seed)
    docs, last = [], None
    for i in range(count):
        date = f'2026-08-{1 + i * 30 // max(count - 1, 1):02d}'
        if i % 5 == 4 and last:
            docs.append(doc('receipt', f'{prefix}R-{7000 + i}', date, -last['amount'], 'Bank transfer'))
        elif i % 7 == 3 and last:
            cut = max(1, last['amount'] // 10)
            docs.append(doc('credit-note', f'{prefix}C-{8000 + i}', date, -cut, 'Allowance',
                            related=last['document']))
        else:
            minor = rnd.randint(lo, hi) * places_scale
            last = doc('invoice', f'{prefix}I-{5000 + i}', date, minor, description)
            docs.append(last)
    return docs


def stories():
    out = []

    def add(sid, title, producer, font, style, statement, ledger, recipe, intent, scope=None, lang='en'):
        out.append({'id': sid, 'title': title, 'producer': producer, 'font': font, 'style': style,
                    'layout': lang, 'scope': scope or dict(SCOPE), 'statement': statement,
                    'ledger': ledger, 'recipe': recipe, 'intent': intent})

    # ---- LibreOffice Writer -------------------------------------------------
    k201 = [doc('invoice', 'SI-26-0801', '2026-08-03', 540000, 'Shelving units'),
            doc('invoice', 'SI-26-0802', '2026-08-09', 125050, 'Bolts and anchors'),
            doc('receipt', 'RV-26-0101', '2026-08-20', -540000, 'Bank transfer')]
    k204 = [doc('invoice', 'SI-26-0801', '2026-08-03', 396000, 'Display racks'),
            doc('invoice', 'SI-26-0810', '2026-08-11', 1200000, 'Cold room panels'),
            doc('credit-note', 'CN-26-0011', '2026-08-14', -48000, 'Damaged panel', related='SI-26-0810'),
            doc('receipt', 'RV-26-0105', '2026-08-18', -396000, 'Bank transfer'),
            doc('invoice', 'SI-26-0822', '2026-08-27', 71525, 'Door seals')]
    k207 = [doc('invoice', 'SI-26-0801', '2026-08-03', 396000, 'Display racks'),
            doc('receipt', 'RV-26-0105', '2026-08-18', -396000, 'Bank transfer')]
    batch = ['document', 'date', 'type', 'description', 'original', 'balance']
    add('B01', 'A batch print of three customers, the confirmed one in the middle',
        'libreoffice', 'Liberation Sans', {'grid': True, 'shade': True},
        Layout(header='first', breaks='page').statement([
            section('K-201', 'Synthetic Retail One', docs=k201, columns=batch),
            section(docs=k204, columns=batch),
            section('K-207', 'Synthetic Retail Seven', docs=k207, columns=batch)]),
        ledger_rows(k204),
        'K-201, K-204 and K-207, each on its own page, the document header on page 1 only, the '
        'document number as the first column; K-201 and K-207 print SI-26-0801, and K-207 prints it '
        'and RV-26-0105 with the confirmed customer\'s amounts and dates',
        {'status': 'matched', 'matched': 5, 'review': {}, 'outOfScopeLines': 5})

    kwd = generated(5202, 46, 'K', 1000, 2500000)
    kwd_ledger = [dict(d) for d in kwd]
    late = next(i for i, d in enumerate(kwd) if i > 8 and d['kind'] == 'invoice' and d['date'] < '2026-08-31')
    kwd_ledger[late] = dict(kwd_ledger[late], date=f"2026-08-{int(kwd[late]['date'][-2:]) + 1:02d}")
    gone = next(i for i, d in enumerate(kwd) if i > 30 and d['kind'] == 'receipt')
    del kwd_ledger[gone]
    for d in kwd:
        if d['kind'] == 'invoice':
            d['open'] = d['amount'] if int(d['document'][-2:]) % 3 else 0
    add('B02', 'Kuwaiti dinars over three pages under the column headings alone',
        'libreoffice', 'Carlito', {'grid': True, 'shade': False},
        Layout(header='first', repeat='headings', per_page=20).statement([
            section(currency='KWD', name='Synthetic Retail Four',
                    docs=kwd, columns=['date', 'type', 'document', 'related', 'original', 'open'])]),
        ledger_rows(kwd_ledger, dict(SCOPE, currency='KWD')),
        f'46 documents in KWD to three places, open amounts printed for invoices; pages 2 and 3 repeat '
        f'only the column headings; the ledger dates {kwd[late]["document"]} a day later and has no '
        f'{kwd[gone]["document"]}',
        {'status': 'review', 'matched': 44, 'review': {'date-difference': 1, 'missing-counterpart': 1}},
        scope=dict(SCOPE, currency='KWD'))

    ar_docs = [doc('invoice', 'SI-26-0830', '2026-08-02', 250000, 'أرفف عرض'),
               doc('invoice', 'SI-26-0831', '2026-08-06', 87550, 'مسامير تثبيت'),
               doc('credit-note', 'CN-26-0021', '2026-08-10', -12500, 'مرتجع جزئي', related='SI-26-0831'),
               doc('receipt', 'RV-26-0140', '2026-08-15', -250000, 'تحويل بنكي'),
               doc('invoice', 'SI-26-0838', '2026-08-21', 164000, 'ألواح تبريد'),
               doc('credit-note', 'CN-26-0024', '2026-08-25', -16400, 'خصم كمية', related='SI-26-0838')]
    ar_ledger = [dict(d) for d in ar_docs]
    ar_ledger[5] = dict(ar_ledger[5], related='SI-26-0831')
    add('B03', 'An Arabic statement with Latin digits, credit notes and their invoices',
        'libreoffice', 'FreeSerif', {'grid': False, 'shade': True, 'boldHeadings': False},
        Layout(lang='ar').statement([section(
            name='شركة التجزئة الاصطناعية الرابعة', docs=ar_docs,
            columns=['date', 'type', 'document', 'related', 'description', 'original', 'balance'])]),
        ledger_rows(ar_docs[:5] + ar_ledger[5:]),
        'right-to-left table and labels, Latin digits; CN-26-0024 relates to SI-26-0838 in the '
        'statement and to SI-26-0831 in the ledger',
        {'status': 'review', 'matched': 5, 'review': {'related-conflict': 1}}, lang='ar')

    other = [doc('invoice', 'SI-26-0840', '2026-08-05', 200000, 'خدمة تركيب'),
             doc('invoice', 'SI-26-0841', '2026-08-12', 45000, 'قطع غيار'),
             doc('receipt', 'RV-26-0150', '2026-08-19', -200000, 'تحويل بنكي')]
    mine = [doc('invoice', 'SI-26-0840', '2026-08-05', 200000, 'أرفف تخزين'),
            doc('invoice', 'SI-26-0844', '2026-08-08', 1234567, 'غرفة تبريد'),
            doc('credit-note', 'CN-26-0030', '2026-08-13', -23400, 'تسوية سعر'),
            doc('receipt', 'RV-26-0152', '2026-08-16', -200000, 'تحويل بنكي'),
            doc('invoice', 'SI-26-0849', '2026-08-24', 98000, 'ستائر هوائية'),
            doc('receipt', 'RV-26-0157', '2026-08-30', -500000, 'تحويل بنكي')]
    add('B04', 'Arabic-Indic digits and separators, two accounts of one customer on one page',
        'libreoffice', 'DejaVu Sans', {'grid': True, 'shade': False},
        Layout(lang='ar', digits='arabic', room=2).statement([
            section(account='1135', name='شركة التجزئة الاصطناعية الرابعة', docs=other),
            section(name='شركة التجزئة الاصطناعية الرابعة', docs=mine)]),
        ledger_rows(mine),
        'account 1135 then account 1130 of K-204 on one page; both print SI-26-0840 for 2,000.00 '
        'on the same day; digits, thousands separator and decimal point Arabic-Indic',
        {'status': 'matched', 'matched': 6, 'review': {}, 'outOfScopeLines': 3}, lang='ar')

    two_pages = generated(5205, 30, 'L', 5000, 900000, description='Store fixtures')
    add('B05', 'A later page prints another ledger in the document header',
        'libreoffice', 'Liberation Sans', {'grid': True, 'shade': True},
        Layout(header='every', repeat='headings', per_page=18,
               ledgers={2: 'Receivables Export'}).statement([section(docs=two_pages)]),
        ledger_rows(two_pages),
        'one section over two pages; page 2 repeats the document header with Ledger: Receivables '
        'Export; the ledger file holds every document',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_PDF_DOCUMENT_HEADER']})

    cut = [doc('invoice', 'SI-26-0860', '2026-08-04', 330000, 'Freezer unit', open_minor=330000),
           doc('invoice', 'SI-26-0861', '2026-08-10', None, 'Install labour', open_minor=75000),
           doc('receipt', 'RV-26-0170', '2026-09-01', -330000, 'Bank transfer'),
           doc('invoice', 'SI-26-0866', '2026-08-21', 54000, 'Gaskets', open_minor=54000)]
    add('B06', 'A receipt after the period, and a line with its open amount only',
        'libreoffice', 'Liberation Sans', {'grid': False, 'shade': False},
        Layout().statement([section(
            docs=cut, columns=['date', 'type', 'document', 'description', 'original', 'open', 'balance'])]),
        ledger_rows([cut[0], dict(cut[1], amount=75000), cut[3]]),
        'RV-26-0170 dated 1 September inside the August section; SI-26-0861 prints an open amount '
        'and no original amount',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_ORIGINAL_MISSING', 'AR_PERIOD']})

    july = [doc('invoice', 'SI-26-0701', '2026-07-06', 145000, 'Trolleys'),
            doc('invoice', 'SI-26-0702', '2026-07-19', 62000, 'Price labels'),
            doc('receipt', 'RV-26-0090', '2026-07-28', -145000, 'Bank transfer')]
    august = [doc('invoice', 'SI-26-0811', '2026-08-04', 88000, 'Baskets'),
              doc('receipt', 'RV-26-0110', '2026-08-12', -62000, 'Bank transfer'),
              doc('invoice', 'SI-26-0815', '2026-08-20', 230000, 'Checkout counter'),
              doc('credit-note', 'CN-26-0015', '2026-08-26', -8800, 'Short delivery', related='SI-26-0811')]
    two_months = dict(SCOPE, start='2026-07-01')
    add('B07', 'The confirmed period spans two printed periods',
        'libreoffice', 'Liberation Sans', {'grid': True, 'shade': False},
        Layout(header='first', breaks='page').statement([
            section(start='2026-07-01', end='2026-07-31', docs=july), section(docs=august)]),
        ledger_rows(july + august, two_months),
        'K-204 printed for July on page 1 and for August on page 2; the confirmed scope is 1 July '
        'to 31 August and the ledger holds both months',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_PDF_SCOPE_NOT_FOUND']},
        scope=two_months)

    first = [doc('invoice', 'SI-26-0880', '2026-08-03', 112000, 'مضخة مياه'),
             doc('invoice', 'SI-26-0881', '2026-08-09', 34500, 'صمامات'),
             doc('receipt', 'RV-26-0180', '2026-08-14', -112000, 'تحويل بنكي')]
    between = [doc('invoice', 'SI-26-0883', '2026-08-11', 51000, 'أنابيب'),
               doc('receipt', 'RV-26-0182', '2026-08-23', -51000, 'تحويل بنكي')]
    again = [doc('invoice', 'SI-26-0886', '2026-08-18', 76000, 'خزان'),
             doc('credit-note', 'CN-26-0040', '2026-08-22', -3450, 'خصم', related='SI-26-0881'),
             doc('receipt', 'RV-26-0185', '2026-08-29', -76000, 'تحويل بنكي')]
    add('B08', 'The confirmed customer heads two sections of an Arabic print',
        'libreoffice', 'FreeSerif', {'grid': True, 'shade': True, 'boldHeadings': False},
        Layout(lang='ar', digits='arabic', breaks='page').statement([
            section(name='شركة التجزئة الاصطناعية الرابعة', docs=first),
            section('K-209', 'شركة التجزئة الاصطناعية التاسعة', docs=between),
            section(name='شركة التجزئة الاصطناعية الرابعة', docs=again)]),
        ledger_rows(first + again),
        'K-204, then K-209, then K-204 again with the same account, currency and period, one to a page',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_PDF_SCOPE_REPEATED']}, lang='ar')

    bad_dates = [doc('invoice', 'SI-26-0870', '2026-08-03', 120000, 'Cable trays'),
                 doc('invoice', 'SI-26-0871', '2026-08-31', 45000, 'Junction boxes', printedDate='2026-08-32'),
                 doc('receipt', '', '2026-08-15', -120000, 'Bank transfer'),
                 doc('invoice', 'SI-26-0875', '2026-08-26', 99900, 'Conduit')]
    add('B17', 'An impossible date, and a receipt without its number',
        'libreoffice', 'Liberation Sans', {'grid': True, 'shade': False},
        Layout(totals=False).statement([section(docs=bad_dates)]),
        ledger_rows(bad_dates[:2] + [dict(bad_dates[2], document='RV-26-0190')] + bad_dates[3:]),
        'SI-26-0871 printed on 2026-08-32; the receipt of 15 August prints no document number; the '
        'ledger holds all four, the receipt as RV-26-0190',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_DATE', 'AR_DOCUMENT']})

    # ---- iText Core ---------------------------------------------------------
    yen = [doc('invoice', 'INV/2026/0901', '2026-08-03', 1250000, 'Precision bearings', open_minor=1187500),
           doc('invoice', 'INV/2026/0902', '2026-08-07', 386400, 'Belt drives', open_minor=0),
           doc('receipt', 'RCT/2026/0410', '2026-08-12', -386400, 'Wire transfer'),
           doc('credit-note', 'CRN/2026/0033', '2026-08-15', -62500, 'Rebate', related='INV/2026/0901'),
           doc('invoice', 'INV/2026/0907', '2026-08-22', 4890000, 'Spindle assembly', open_minor=4890000),
           doc('receipt', 'RCT/2026/0415', '2026-08-28', -1187500, 'Wire transfer'),
           doc('invoice', 'INV/2026/0911', '2026-08-31', 72000, 'Couplings', open_minor=72000)]
    jpy = dict(SCOPE, currency='JPY')
    add('B09', 'Yen without decimals, every optional column',
        'itext', 'Liberation Serif', {'encoding': 'simple', 'grid': 'cells', 'shade': 'E8E8E8'},
        Layout().statement([section(currency='JPY', docs=yen, columns=[
            'date', 'type', 'document', 'related', 'description', 'original', 'open', 'balance'])]),
        ledger_rows(yen, jpy),
        'seven documents in JPY with no decimal places; related invoice, open amount and balance printed',
        {'status': 'matched', 'matched': 7, 'review': {}}, scope=jpy)

    by_currency = {
        'SAR': [doc('invoice', 'INV/2026/0815', '2026-08-04', 500000, 'Forklift rental'),
                doc('invoice', 'INV/2026/0816', '2026-08-09', 120000, 'Pallets'),
                doc('receipt', 'RCT/2026/0501', '2026-08-20', -500000, 'Wire transfer')],
        'USD': [doc('invoice', 'INV/2026/0815', '2026-08-04', 500000, 'Forklift rental'),
                doc('invoice', 'INV/2026/0818', '2026-08-13', 75025, 'Spare batteries'),
                doc('receipt', 'RCT/2026/0502', '2026-08-25', -500000, 'Wire transfer')],
        'EUR': [doc('invoice', 'INV/2026/0817', '2026-08-11', 99000, 'Racking audit'),
                doc('invoice', 'INV/2026/0819', '2026-08-17', 15000, 'Safety signs')],
        'KWD': [doc('invoice', 'INV/2026/0815', '2026-08-04', 1500000, 'Forklift rental'),
                doc('receipt', 'RCT/2026/0503', '2026-08-29', -1500000, 'Wire transfer')],
    }
    usd = dict(SCOPE, currency='USD')
    add('B10', 'One customer in four currencies, one number in three of them',
        'itext', 'Inter', {'encoding': 'identity', 'grid': 'rules', 'shade': None},
        Layout(repeat='section', per_page=14, room=5).statement(
            [section(currency=c, docs=d) for c, d in by_currency.items()]),
        ledger_rows(by_currency['USD'] + [doc('invoice', 'INV/2026/0817', '2026-08-11', 99000, 'Racking audit')], usd),
        'SAR, USD, EUR and KWD sections of K-204; INV/2026/0815 in SAR, USD and KWD; the USD ledger '
        'also holds INV/2026/0817 for the digits of the EUR invoice',
        {'status': 'review', 'matched': 3, 'review': {'missing-counterpart': 1}, 'outOfScopeLines': 7},
        scope=usd)

    long = generated(5211, 60, 'T', 2000, 750000, description='Weekly delivery')
    receipt = next(i for i, d in enumerate(long) if i >= 20 and d['kind'] == 'receipt')
    long_ledger = [dict(d) for d in long]
    long_ledger[receipt] = dict(long_ledger[receipt], amount=long[receipt]['amount'] + 4500)
    reprint = dict(long[5])
    printed = long[:50] + [reprint] + long[50:]
    add('B11', 'A document reprinted out of order, and a receipt recorded short',
        'itext', 'Carlito', {'encoding': 'identity', 'grid': 'cells', 'shade': 'DDE6F0'},
        Layout(repeat='section', per_page=24).statement([section(docs=printed)]),
        ledger_rows(long_ledger),
        f'61 printed lines over three pages, each page repeating the document and section headers; '
        f'{long[5]["document"]} printed again after line 50; the ledger records '
        f'{long[receipt]["document"]} 45.00 short',
        {'status': 'review', 'matched': 58, 'review': {'duplicate-document': 1, 'amount-difference': 1}})

    wrong = [doc('invoice', 'INV/2026/1301', '2026-08-05', 410000, 'Air compressor'),
             doc('receipt', 'RCT/2026/0601', '2026-08-09', 100000, 'Wire transfer'),
             doc('debit-note', 'DBN/2026/0007', '2026-08-12', 25000, 'Late fee', printedType='debit-note'),
             doc('invoice', 'INV/2026/1305', '2026-08-20', 66000, 'Hoses')]
    add('B12', 'A receipt printed positive, and a document type outside the contract',
        'itext', 'Liberation Serif', {'encoding': 'simple', 'grid': 'cells', 'shade': None},
        Layout().statement([section(docs=wrong)]),
        ledger_rows([wrong[0], dict(wrong[1], amount=-100000), wrong[3]]),
        'RCT/2026/0601 printed 1,000.00 without a minus sign; DBN/2026/0007 printed as a debit-note',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_DIRECTION', 'AR_KIND']})

    clean = [doc('invoice', 'INV/2026/1401', '2026-08-02', 215000, 'Dock leveller'),
             doc('invoice', 'INV/2026/1402', '2026-08-10', 48000, 'Bumpers'),
             doc('receipt', 'RCT/2026/0650', '2026-08-18', -215000, 'Wire transfer'),
             doc('invoice', 'INV/2026/1407', '2026-08-25', 30500, 'Wheel chocks')]
    due = [doc('invoice', 'INV/2026/1403', '2026-08-12', 77000, 'Door motor', extra={'Due date': '2026-09-11'}),
           doc('invoice', 'INV/2026/1404', '2026-08-19', 12000, 'Remote', extra={'Due date': '2026-09-18'})]
    add('B13', 'Another customer\'s section has a column outside the contract',
        'itext', 'Inter', {'encoding': 'identity', 'grid': 'cells', 'shade': 'E8E8E8'},
        Layout().statement([
            section(docs=clean),
            section('K-212', 'Synthetic Retail Twelve', docs=due,
                    columns=['date', 'type', 'document', 'Due date', 'original', 'balance'])]),
        ledger_rows(clean),
        'K-204 reads cleanly and its ledger holds every document; the K-212 section after it adds a '
        'Due date column',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_PDF_COLUMNS']})

    reversed_period = [doc('invoice', 'INV/2026/1501', '2026-08-14', 64000, 'Shelf labels')]
    add('B14', 'Another customer\'s section header has a period that ends before it starts',
        'itext', 'Carlito', {'encoding': 'identity', 'grid': 'rules', 'shade': None},
        Layout().statement([
            section(docs=clean),
            section('K-215', 'Synthetic Retail Fifteen', docs=reversed_period,
                    period='2026-08-01 to 2026-07-31')]),
        ledger_rows(clean),
        'K-204 as in B13; the K-215 section after it prints Period: 2026-08-01 to 2026-07-31',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_PDF_HEADER']})

    volume = generated(5215, 520, 'V', 500, 4500000, description='Route sale')
    add('B15', 'One section over twenty pages under its column headings alone',
        'itext', 'Liberation Mono', {'encoding': 'simple', 'grid': 'rules', 'shade': None},
        Layout(repeat='headings', per_page=26).statement([section(docs=volume)]),
        ledger_rows(volume, order=5215),
        '520 documents, 26 to a page; every page repeats the document header and the column '
        'headings but not the section header; the ledger rows are shuffled',
        {'status': 'matched', 'matched': 520, 'review': {}})

    bare = [doc('invoice', 'INV/2026/1601', '2026-08-02', 1875000, 'Mezzanine floor'),
            doc('invoice', 'INV/2026/1602', '2026-08-06', 320000, 'Handrails'),
            doc('credit-note', 'CRN/2026/0051', '2026-08-09', -32000, 'Missing bracket', related='INV/2026/1602'),
            doc('receipt', 'RCT/2026/0701', '2026-08-14', -1875000, 'Wire transfer'),
            doc('invoice', 'INV/2026/1606', '2026-08-23', 1050000, 'Stair tower'),
            doc('credit-note', 'CRN/2026/0054', '2026-08-26', -50000, 'Early payment', related='INV/2026/1606'),
            doc('receipt', 'RCT/2026/0705', '2026-08-31', -288000, 'Wire transfer')]
    add('B16', 'No customer name, balance, total, footer or thousands separators',
        'itext', 'Caladea', {'encoding': 'identity', 'grid': 'cells', 'shade': None},
        Layout(header='first', totals=False, footer=False, names=False, separators=False).statement([
            section(docs=bare, columns=['date', 'type', 'document', 'related', 'description', 'original'])]),
        ledger_rows(bare),
        'only the required header fields; amounts such as 18750.00; credit notes cite their invoices',
        {'status': 'matched', 'matched': 7, 'review': {}})

    european = [doc('invoice', 'INV/2026/1801', '2026-08-04', 125000, 'Ladders', printed='1.250,00'),
                doc('invoice', 'INV/2026/1802', '2026-08-13', 39000, 'Tool boxes'),
                doc('receipt', 'RCT/2026/0801', '2026-08-21', -164000, 'Wire transfer')]
    forward = {'section': section(), 'doc': doc('invoice', 'INV/2026/1799', '2026-07-30', 18000, 'Carried forward')}
    add('B18', 'A line before any section header, and an amount in another notation',
        'itext', 'Liberation Serif', {'encoding': 'simple', 'grid': 'cells', 'shade': 'E8E8E8'},
        Layout().statement([section(docs=european)], orphan=forward),
        ledger_rows([dict(d) for d in european]),
        'a table of one line printed under the document header before the first Customer ID; '
        'INV/2026/1801 printed as 1.250,00',
        {'status': 'source-error', 'matched': 0, 'errors': ['AR_AMOUNT', 'AR_PDF_ORPHAN_LINE']})

    out.sort(key=lambda s: s['id'])
    return out


def main():
    print(json.dumps({'version': VERSION, 'stories': stories()}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
