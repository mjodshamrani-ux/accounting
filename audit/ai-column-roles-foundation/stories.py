"""The AI-1a statements: 24 supplier statements whose column headings vary.

Each story is a supplier's statement of account to one customer for one
month, and the customer's accounts-payable ledger for that supplier, as in
the S3 holdout whose writers print them. What varies here is the heading a
supplier's system prints over each column, in six classes:

  K0  every heading is one the supplier contract names (a control);
  K1  an English heading a supplier's system commonly prints for the column;
  K2  the same in Arabic;
  K3  a heading that describes the column in a phrase of its own;
  K4  beside the column, another that is easy to take for it: a due date, a
      running balance, units, the tax inside an invoice, a purchase order;
  K5  headings that say nothing of what a column holds ("Col 3", "B"), with
      two date columns, two reference columns and two amount columns, so
      that no heading and no value shape can tell which one is which.

An Arabic story with one signed amount column prints a negative in
parentheses: written with a leading minus, its right-to-left line carries
"1,402.10-" in the text layer, a format the reader refuses on its own
account (found on a scratch statement before the seal, not in this set).
A column's key says what it holds; the heading is only printed. roles.py
says which keys a reconciliation reads, and test_intent.py says, from the
headings alone and written apart from these keys, what a reader may conclude.
The facts are written here and nowhere else. Seeds and amounts are fixed, so
`python3 -B stories.py` prints the same JSON every time. Nothing is read from
the product.
"""
import json
import random
from datetime import date, timedelta

CUSTOMER = {'en': 'Synthetic Buyer Trading Co', 'ar': 'شركة المشتري الاصطناعية'}
TITLE = {'en': 'Statement of Account', 'ar': 'كشف حساب'}
DESCRIPTIONS = {
    'en': {'Invoice': ['Steel fittings', 'Packing crates', 'Valve spares', 'Cable reels', 'Office chairs',
                       'Printing paper', 'Pallet wrap', 'Control panels', 'Fasteners lot', 'Safety gloves'],
           'Payment': ['Bank transfer', 'Payment received', 'Transfer received'],
           'Credit Note': ['Returned goods', 'Price adjustment', 'Damaged items credit']},
    'ar': {'Invoice': ['توريد مواد', 'أكياس تعبئة', 'قطع غيار', 'أنابيب بلاستيك', 'مواد بناء', 'أدوات كهربائية'],
           'Payment': ['تحويل بنكي', 'دفعة مستلمة'],
           'Credit Note': ['مرتجع بضاعة', 'خصم سعر']},
}


def iso(d):
    return d.isoformat()


def movements(rng, start, days, invoices, payments, credits):
    """Movements in date order: invoices INV-, payments PMT-, credit notes
    CN-, each with its own number. Amounts in minor units, signed as the
    supplier's statement signs them (an invoice raises the balance)."""
    kinds = ['Invoice'] * invoices + ['Payment'] * payments + ['Credit Note'] * credits
    rng.shuffle(kinds)
    kinds.sort(key=lambda k: k != 'Invoice')
    tail = kinds[2:]  # the month opens with two invoices
    rng.shuffle(tail)
    kinds[2:] = tail
    out, numbers = [], {'Invoice': rng.randint(1000, 8000), 'Payment': rng.randint(100, 900),
                        'Credit Note': rng.randint(10, 90)}
    stamp = sorted(rng.choices(range(days), k=len(kinds)))
    for k, offset in zip(kinds, stamp):
        numbers[k] += rng.randint(1, 7)
        code = {'Invoice': 'INV', 'Payment': 'PMT', 'Credit Note': 'CN'}[k]
        if k == 'Invoice':
            minor = rng.randint(50_000, 4_800_000)
        elif k == 'Payment':
            minor = -rng.randint(100_000, 3_500_000)
        else:
            minor = -rng.randint(5_000, 250_000)
        out.append({'date': iso(start + timedelta(days=offset)), 'ref': f'{code}-{numbers[k]}', 'type': k,
                    'minor': minor})
    return out


def describe(rng, lines, language):
    for line in lines:
        line['desc'] = rng.choice(DESCRIPTIONS[language][line['type']])


def invoice_details(rng, lines, keys):
    """What an invoice line carries beside its amount, where the story prints
    it: units, the buyer's purchase order, the 15% tax inside the amount, a
    due date thirty days on. Payments and credit notes leave them blank."""
    order = rng.randint(40_000, 60_000)
    for line in lines:
        if 'due' in keys:
            line['due'] = iso(date.fromisoformat(line['date']) + timedelta(days=30))
        if line['type'] != 'Invoice':
            continue
        if 'qty' in keys:
            line['qty'] = rng.randint(101, 999)
        if 'order' in keys:
            order += rng.randint(3, 40)
            line['order'] = f'PO-{order}'
        if 'vat' in keys:
            line['vat'] = (line['minor'] * 15 + 57) // 115


def ledger_of(rng, lines):
    """The buyer's postings of the same documents, a day later at most."""
    out = []
    for line in lines:
        d = date.fromisoformat(line['date']) + timedelta(days=rng.choice([0, 0, 1]))
        out.append({'date': iso(d), 'ref': line['ref'], 'type': line['type'], 'minor': line['minor'],
                    'desc': 'Posted'})
    return out


def paginate(lines, per_page):
    return [lines[i:i + per_page] for i in range(0, len(lines), per_page)]


def story(sid, cls, *, supplier, producer, language, columns, font, style, period, dates='iso', numbers='dot',
          negative='minus', digits='latin', seed, counts, per_page, total=False, widths=None, intent=''):
    rng = random.Random(seed)
    start = date.fromisoformat(period[0])
    days = (date.fromisoformat(period[1]) - start).days - 1  # the last day stays clear of the cut-off
    keys = [k for k, _ in columns]
    lines = movements(rng, start, days, *counts)
    describe(rng, lines, language)
    invoice_details(rng, lines, keys)
    ledger = ledger_of(rng, lines)
    st = {'id': sid, 'class': cls, 'producer': producer, 'language': language,
          'columns': [list(c) for c in columns], 'font': font, 'paper': 'A4', 'style': style,
          'supplier': supplier, 'title': TITLE[language], 'customer': CUSTOMER[language],
          'account': f'C-{rng.randint(10000, 99999)}', 'currency': 'SAR',
          'period': {'start': period[0], 'end': period[1]}, 'dates': dates, 'numbers': numbers,
          'negative': negative, 'digits': digits, 'opening': rng.randint(1_000_000, 9_000_000),
          'kind': 'positive', 'contract': 'solve', 'intent': intent, 'total': total}
    if widths:
        st['widths'] = widths
    balance = st['opening']
    for line in lines:
        balance += line['minor']
        line['balance'] = balance
    st['closing'] = balance
    st['pages'] = paginate(lines, per_page)
    st['ledger'] = sorted(ledger, key=lambda e: (e['date'], e['ref']))
    return st


GRID = {'heading': 'filled', 'rules': 'grid'}
ROWS = {'heading': 'rule', 'rules': 'rows'}
GREY = {'heading': 'grey', 'rules': 'grid'}
STRIPES = {'heading': 'rule', 'rules': 'stripes'}
AR_GRID = {'heading': 'filled', 'rules': 'grid', 'amounts': 'end'}
AR_ROWS = {'heading': 'grey', 'rules': 'rows', 'amounts': 'end'}

STORIES = [
    # K0: headings the supplier contract names.
    story('C01', 'K0', supplier='Northwind Fasteners Ltd', producer='hexapdf', language='en', font='Work Sans',
          columns=[('date', 'Date'), ('ref', 'Invoice No'), ('desc', 'Description'), ('amount', 'Amount')],
          style=GRID, period=('2027-01-01', '2027-01-31'), seed=1101, counts=(6, 2, 1), per_page=30,
          intent='Control: every heading named by the contract.'),
    story('C02', 'K0', supplier='مؤسسة الواحة للتوريدات', producer='pdflib', language='ar', font='Tajawal',
          columns=[('date', 'التاريخ'), ('ref', 'رقم الفاتورة'), ('desc', 'البيان'), ('debit', 'مدين'),
                   ('credit', 'دائن'), ('balance', 'الرصيد')],
          style=AR_GRID, period=('2027-01-01', '2027-01-31'), seed=1102, counts=(6, 2, 1), per_page=30,
          intent='Control, Arabic: debit, credit and balance named by the contract.'),
    # K1: English headings a supplier system commonly prints.
    story('N01', 'K1', supplier='Harbour Paper & Print Co', producer='hexapdf', language='en', font='Fira Sans',
          columns=[('date', 'Txn Date'), ('ref', 'Doc #'), ('desc', 'Narrative'), ('amount', 'Total SAR')],
          style=ROWS, period=('2027-02-01', '2027-02-28'), seed=1103, counts=(7, 3, 1), per_page=30,
          intent='No heading the contract names: the table has no recognised heading row.'),
    story('N02', 'K1', supplier='Bluegate Office Furniture', producer='pdflib', language='en', font='Alexandria',
          columns=[('date', 'Trans. Date'), ('ref', 'Inv. No'), ('type', 'Type'), ('desc', 'Details'),
                   ('amount', 'Amt')],
          style=GREY, period=('2027-02-01', '2027-02-28'), seed=1104, counts=(8, 3, 2), per_page=30,
          intent='Abbreviated date, number and amount headings; Details is named.'),
    story('N03', 'K1', supplier='Alpine Valve Works GmbH', producer='hexapdf', language='en', font='Merriweather',
          columns=[('ref', 'Ref #'), ('date', 'Entry Date'), ('desc', 'Particulars'), ('debit', 'Charges'),
                   ('credit', 'Payments'), ('balance', 'Balance')],
          style=STRIPES, period=('2027-03-01', '2027-03-31'), numbers='comma', seed=1105, counts=(7, 3, 1),
          per_page=30, intent='Reference first, debit and credit as Charges and Payments, decimal comma.'),
    story('N04', 'K1', supplier='Meridian Packaging LLC', producer='pdflib', language='en', font='Readex Pro',
          columns=[('date', 'Bill Date'), ('ref', 'Bill No'), ('desc', 'Memo'), ('debit', 'Dr Amount'),
                   ('credit', 'Cr Amount'), ('balance', 'Running Bal.')],
          style=ROWS, period=('2027-03-01', '2027-03-31'), dates='dmy', seed=1106, counts=(16, 6, 2),
          per_page=13, total=True, intent='Two pages, day-first dates, Dr and Cr spelled out, a total line.'),
    story('N05', 'K1', supplier='Copperline Electrical Supply', producer='hexapdf', language='en',
          font='Work Sans',
          columns=[('date', 'Booked'), ('ref', 'Document'), ('desc', 'Item'), ('currency', 'Curr.'),
                   ('amount', 'Net Amt')],
          style=GREY, period=('2027-04-01', '2027-04-30'), seed=1107, counts=(6, 2, 1), per_page=30,
          intent='A currency column; no heading the contract names.'),
    # K2: Arabic headings a supplier system commonly prints.
    story('A01', 'K2', supplier='شركة الرمال للمواد الإنشائية', producer='pdflib', language='ar',
          font='Alexandria',
          columns=[('date', 'تاريخ الفاتورة'), ('ref', 'رقم المرجع'), ('desc', 'البيان'), ('amount', 'قيمة الحركة')],
          style=AR_ROWS, period=('2027-01-01', '2027-01-31'), seed=1108, counts=(7, 2, 1), per_page=30,
          negative='parens', intent='Arabic invoice date, reference number and movement value.'),
    story('A02', 'K2', supplier='مصنع النخيل للبلاستيك', producer='pdflib', language='ar', font='Rubik',
          columns=[('date', 'تاريخ العملية'), ('ref', 'المستند'), ('desc', 'التفاصيل'), ('debit', 'المدين'),
                   ('credit', 'الدائن'), ('balance', 'الرصيد')],
          style=AR_GRID, period=('2027-02-01', '2027-02-28'), seed=1109, counts=(8, 3, 1), per_page=30,
          intent='Debit and credit with the definite article.'),
    story('A03', 'K2', supplier='مؤسسة الأفق للتجهيزات', producer='pdflib', language='ar', font='Readex Pro',
          columns=[('date', 'التاريخ'), ('ref', 'رقم الوثيقة'), ('desc', 'الشرح'), ('debit', 'عليه'),
                   ('credit', 'له'), ('balance', 'الرصيد')],
          style=AR_ROWS, period=('2027-03-01', '2027-03-31'), digits='arabic', negative='parens', seed=1110,
          counts=(14, 5, 2), per_page=11, intent='Arabic-Indic digits, two pages, debit and credit as عليه and له.'),
    story('A04', 'K2', supplier='شركة المدار للتغليف', producer='pdflib', language='ar', font='Alexandria',
          columns=[('date', 'يوم الحركة'), ('ref', 'رقم المستند'), ('type', 'النوع'), ('desc', 'الوصف'),
                   ('amount', 'صافي المبلغ')],
          style=AR_GRID, period=('2027-04-01', '2027-04-30'), seed=1111, counts=(7, 3, 2), per_page=30,
          negative='parens', intent='Arabic movement day and net amount; the number and the description are named.'),
    # K3: headings that describe the column in a phrase of their own.
    story('D01', 'K3', supplier='Westfield Industrial Coatings', producer='hexapdf', language='en',
          font='Fira Sans',
          columns=[('date', 'Day posted'), ('ref', 'Our invoice'), ('desc', 'What for'), ('amount', 'Sum (SAR)')],
          style=GRID, period=('2027-01-01', '2027-01-31'), seed=1112, counts=(6, 2, 1), per_page=30,
          intent='Every heading a phrase; none named.'),
    story('D02', 'K3', supplier='Kestrel Lab Instruments', producer='pdflib', language='en', font='Readex Pro',
          columns=[('date', 'When'), ('ref', 'Document number'), ('desc', 'Description'),
                   ('debit', 'Billed to you'), ('credit', 'Received from you'), ('balance', 'You owe')],
          style=GREY, period=('2027-02-01', '2027-02-28'), seed=1113, counts=(7, 3, 1), per_page=30,
          widths={'credit': 0.15}, intent='Debit and credit said from the customer\'s side; the balance as what is owed.'),
    story('D03', 'K3', supplier='مؤسسة السنبلة التجارية', producer='pdflib', language='ar', font='Rubik',
          columns=[('date', 'تاريخ التسجيل'), ('ref', 'رقم فاتورتنا'), ('desc', 'تفاصيل العملية'),
                   ('amount', 'المبلغ المستحق')],
          style=AR_GRID, period=('2027-03-01', '2027-03-31'), seed=1114, counts=(7, 2, 1), per_page=30,
          negative='parens', intent='Arabic phrases for every heading.'),
    story('D04', 'K3', supplier='مصنع الريان للأدوات', producer='pdflib', language='ar', font='Tajawal',
          columns=[('date', 'يوم القيد'), ('ref', 'معرف المستند'), ('desc', 'البيان'), ('debit', 'ما عليكم'),
                   ('credit', 'ما لكم'), ('balance', 'الرصيد بعد القيد')],
          style=AR_ROWS, period=('2027-04-01', '2027-04-30'), seed=1115, counts=(15, 5, 2), per_page=11,
          total=True, intent='Arabic phrases from the customer\'s side, two pages, a total line.'),
    story('D05', 'K3', supplier='Orbit Freight Services', producer='hexapdf', language='en', font='Merriweather',
          columns=[('ref', 'Reference'), ('date', 'Recorded on'), ('desc', 'Line text'),
                   ('amount', 'Movement value')],
          style=ROWS, period=('2027-04-01', '2027-04-30'), dates='dmy', seed=1116, counts=(6, 3, 1),
          per_page=30, intent='Reference named first; the date and amount as phrases; day-first dates.'),
    # K4: a column easy to take for the one the reconciliation reads.
    story('X01', 'K4', supplier='Granite Tools Trading', producer='hexapdf', language='en', font='Work Sans',
          columns=[('date', 'Inv. Date'), ('due', 'Due Date'), ('ref', 'Inv. Ref'), ('desc', 'Description'),
                   ('amount', 'Gross'), ('balance', 'Balance')],
          style=GRID, period=('2027-01-01', '2027-01-31'), seed=1117, counts=(7, 2, 1), per_page=30,
          intent='A due date beside the invoice date, a running balance beside the amount.'),
    story('X02', 'K4', supplier='Silverline Catering Supplies', producer='pdflib', language='en',
          font='Alexandria',
          columns=[('date', 'Posted'), ('ref', 'Supplier Doc'), ('order', 'PO No'), ('desc', 'Details'),
                   ('qty', 'Qty'), ('amount', 'Line Total')],
          style=ROWS, period=('2027-02-01', '2027-02-28'), seed=1118, counts=(8, 3, 1), per_page=30,
          intent='The buyer\'s order number beside the document number, units beside the amount.'),
    story('X03', 'K4', supplier='شركة الجسر للمعدات', producer='pdflib', language='ar', font='Rubik',
          columns=[('date', 'تاريخ الفاتورة'), ('due', 'تاريخ الاستحقاق'), ('ref', 'رقم المرجع'),
                   ('desc', 'البيان'), ('vat', 'الضريبة'), ('amount', 'الإجمالي')],
          style=AR_GRID, period=('2027-03-01', '2027-03-31'), seed=1119, counts=(7, 2, 1), per_page=30,
          negative='parens', intent='Arabic: a due date beside the invoice date, the tax beside the total.'),
    story('X04', 'K4', supplier='Pinecrest Building Materials', producer='hexapdf', language='en',
          font='Fira Sans',
          columns=[('date', 'Value Dt'), ('ref', 'Txn Ref'), ('desc', 'Narration'), ('vat', 'VAT'),
                   ('amount', 'Incl. VAT'), ('balance', 'Bal.')],
          style=STRIPES, period=('2027-03-01', '2027-03-31'), seed=1120, counts=(8, 3, 1), per_page=30,
          intent='The tax and a running balance on either side of the amount.'),
    story('X05', 'K4', supplier='Riverside Hygiene Products', producer='pdflib', language='en',
          font='Readex Pro',
          columns=[('date', 'Date'), ('order', 'Order Ref'), ('ref', 'Bill Ref'), ('desc', 'Description'),
                   ('debit', 'Charged'), ('credit', 'Settled'), ('balance', 'Outstanding')],
          style=GREY, period=('2027-04-01', '2027-04-30'), seed=1121, counts=(7, 3, 1), per_page=30,
          intent='The running balance headed Outstanding; the order reference beside the bill reference.'),
    # K5: headings that say nothing of what a column holds.
    story('U01', 'K5', supplier='Summit Office Supplies', producer='hexapdf', language='en', font='Merriweather',
          columns=[('date', 'Col 1'), ('due', 'Col 2'), ('ref', 'Col 3'), ('order', 'Col 4'), ('desc', 'Col 5'),
                   ('amount', 'Col 6'), ('balance', 'Col 7')],
          style=GRID, period=('2027-01-01', '2027-01-31'), seed=1122, counts=(6, 2, 1), per_page=30,
          intent='Numbered headings; two dates, two references, two amounts.'),
    story('U02', 'K5', supplier='Lakeside Print Media', producer='pdflib', language='en', font='Alexandria',
          columns=[('due', 'A'), ('date', 'B'), ('order', 'C'), ('ref', 'D'), ('desc', 'E'), ('balance', 'F'),
                   ('amount', 'G')],
          style=ROWS, period=('2027-02-01', '2027-02-28'), seed=1123, counts=(7, 2, 1), per_page=30,
          intent='Lettered headings, the due date and the balance first of their pairs.'),
    story('U03', 'K5', supplier='مؤسسة النجمة للتوريد', producer='pdflib', language='ar', font='Tajawal',
          columns=[('date', 'حقل 1'), ('due', 'حقل 2'), ('ref', 'حقل 3'), ('order', 'حقل 4'), ('desc', 'حقل 5'),
                   ('amount', 'حقل 6'), ('balance', 'حقل 7')],
          style=AR_GRID, period=('2027-03-01', '2027-03-31'), seed=1124, counts=(6, 2, 1), per_page=30,
          negative='parens', intent='Arabic numbered headings; two dates, two references, two amounts.'),
]

if __name__ == '__main__':
    print(json.dumps(STORIES, ensure_ascii=False, indent=1))
