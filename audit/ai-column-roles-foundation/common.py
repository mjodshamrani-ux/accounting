"""Printed furniture, columns and number formats for the AI-1a statements.

A supplier statement is the supplier's account of what the buyer owes it:
invoices raise the balance, payments and credit notes lower it. Copied from
the S3 holdout; the columns are each story's own. Nothing here is imported
from the product.
"""
import csv
import io

ARABIC_INDIC = str.maketrans('0123456789,.', '٠١٢٣٤٥٦٧٨٩٬٫')

# A story prints its own columns: [key, heading]. The key is what the
# column holds, which nothing in the product reads; the heading is what the
# supplier's system prints over it. Keys beyond S3's: qty (units invoiced),
# order (the buyer's purchase order number), vat (the tax inside an invoice).
WIDTHS = {'date': 0.12, 'ref': 0.15, 'type': 0.12, 'due': 0.12, 'currency': 0.08, 'qty': 0.07, 'order': 0.12,
          'debit': 0.13, 'credit': 0.13, 'amount': 0.14, 'balance': 0.14, 'vat': 0.11}
AMOUNT_KEYS = ('debit', 'credit', 'amount', 'balance', 'vat', 'qty')
TYPES = {
    'en': {'Invoice': 'Invoice', 'Payment': 'Payment', 'Credit Note': 'Credit Note'},
    'ar': {'Invoice': 'فاتورة', 'Payment': 'دفعة', 'Credit Note': 'إشعار دائن'},
}
LABELS = {
    'en': {'customer': 'Customer', 'account': 'Account', 'currency': 'Currency', 'period': 'Period',
           'opening': 'Opening balance', 'brought-forward': 'Balance brought forward',
           'carried-forward': 'Balance carried forward', 'total': 'Total', 'closing': 'Closing balance',
           'page': 'Page {} of {}'},
    'ar': {'customer': 'العميل', 'account': 'رقم الحساب', 'currency': 'العملة', 'period': 'الفترة',
           'opening': 'الرصيد الافتتاحي', 'brought-forward': 'المرحل', 'carried-forward': 'رصيد مرحل',
           'total': 'الإجمالي', 'closing': 'الرصيد الختامي', 'page': 'صفحة {} من {}'},
}


def columns(story):
    """[(key, heading, width share)], shares summing to one; the
    description takes what the others leave. A story may widen a column
    whose heading would not fit (story['widths'])."""
    keys = [tuple(c) for c in story['columns']]
    widths = {**WIDTHS, **story.get('widths', {})}
    fixed = sum(widths[k] for k, _ in keys if k != 'desc')
    return [(k, h, widths[k] if k != 'desc' else round(1 - fixed, 6)) for k, h in keys]


def money(story, minor, signed=True):
    """An amount as the story prints it: grouping and decimal separators,
    a minus or parentheses for a negative, Latin or Arabic-Indic digits."""
    whole, cents = divmod(abs(minor), 100)
    text = f'{whole:,}.{cents:02d}'
    if story['numbers'] == 'comma':
        text = text.replace(',', ' ').replace('.', ',').replace(' ', '.')
    if minor < 0 and signed:
        text = f'({text})' if story['negative'] == 'parens' else f'-{text}'
    return digits(story, text)


def date_text(story, iso):
    y, m, d = iso.split('-')
    text = f'{d}/{m}/{y}' if story['dates'] == 'dmy' else iso
    return digits(story, text)


def digits(story, text):
    return text.translate(ARABIC_INDIC) if story.get('digits') == 'arabic' else text


def movement_cells(story, line):
    """A movement's printed cells, in column order."""
    L = story['language']
    out = []
    for key, _, _ in columns(story):
        if key == 'date':
            out.append(date_text(story, line['date']))
        elif key == 'due':
            out.append(date_text(story, line['due']))
        elif key == 'ref':
            out.append(line['ref'])
        elif key == 'type':
            out.append(TYPES[L][line['type']])
        elif key == 'desc':
            out.append(line['desc'])
        elif key == 'currency':
            out.append(line.get('currency', story['currency']))
        elif key == 'debit':
            out.append(money(story, line['minor']) if line['minor'] > 0 else '')
        elif key == 'credit':
            out.append(money(story, -line['minor']) if line['minor'] < 0 else '')
        elif key == 'amount':
            out.append(money(story, line['minor']))
        elif key == 'balance':
            out.append(money(story, line['balance']))
        elif key == 'qty':
            out.append(digits(story, str(line['qty'])) if 'qty' in line else '')
        elif key == 'order':
            out.append(line.get('order', ''))
        elif key == 'vat':
            out.append(money(story, line['vat']) if 'vat' in line else '')
        else:
            raise ValueError(f'no cell for column {key}')
    return out


def control_cells(story, line):
    """A control line: its label and, per amount column, its value.
    Opening, forward and closing balances stand in the balance column, or the
    amount column where there is none; a total stands under debit and credit."""
    keys = [k for k, _, _ in columns(story)]
    label = LABELS[story['language']][line['kind']]
    values = {}
    if line['kind'] == 'total':
        values['debit'] = money(story, line['debit'])
        values['credit'] = money(story, line['credit'])
    else:
        values['balance' if 'balance' in keys else 'amount'] = money(story, line['balance'])
    return label, values


def preamble(story):
    """The lines above the table on every page."""
    L, st = LABELS[story['language']], story
    p = st['period']
    period = f"{date_text(story, p['start'])} — {date_text(story, p['end'])}"
    return [st['supplier'], st['title'],
            f"{L['customer']}: {st['customer']} · {L['account']}: {digits(story, st['account'])} · "
            f"{L['currency']}: {st['currency']} · {L['period']}: {period}"]


def footer(story, page_number, pages):
    return digits(story, LABELS[story['language']]['page'].format(page_number, pages))


LEDGER_HEADERS = ['Date', 'Reference', 'Type', 'Description', 'Amount']


def plain(minor):
    sign = '-' if minor < 0 else ''
    whole, cents = divmod(abs(minor), 100)
    return f'{sign}{whole}.{cents:02d}'


def ledger_csv(story):
    """The buyer's accounts-payable ledger for the supplier, as its system
    exports it: ISO dates, the supplier's document number, plain amounts in
    the statement's sign (an invoice raises what is owed)."""
    rows = [LEDGER_HEADERS] + [[e['date'], e['ref'], e['type'], e['desc'], plain(e['minor'])]
                               for e in story['ledger']]
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator='\r\n', quoting=csv.QUOTE_MINIMAL).writerows(rows)
    return buffer.getvalue()
