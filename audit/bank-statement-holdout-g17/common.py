"""Printed furniture and number formats shared by the G17 renderers.

The column headings, control-line labels, the account line and the page
footer are the contract's (audit/bank-statement-foundation/contract.json),
in English and Arabic. The bank name, document title and account come from
each story. Copied from G15's common.py, itself G14's, G12's, G10's and G9's;
nothing is imported from the foundation, from another holdout or from the
product.
"""
import csv
import io

ARABIC_INDIC = str.maketrans('0123456789,.', '٠١٢٣٤٥٦٧٨٩٬٫')

LABELS = {
    'en': {
        'account': 'Account', 'currency': 'Currency', 'period': 'Period',
        'headers': ['Date', 'Value Date', 'Description', 'Reference', 'Withdrawal', 'Deposit', 'Balance'],
        'opening': 'Opening balance', 'brought-forward': 'Balance brought forward',
        'carried-forward': 'Balance carried forward', 'closing': 'Closing balance',
        'totals': 'Total withdrawals / deposits', 'page-totals': 'Page total withdrawals / deposits',
        'page': 'Page {} of {}',
    },
    'ar': {
        'account': 'رقم الحساب', 'currency': 'العملة', 'period': 'الفترة',
        'headers': ['التاريخ', 'تاريخ القيمة', 'البيان', 'المرجع', 'سحب', 'إيداع', 'الرصيد'],
        'opening': 'الرصيد الافتتاحي', 'brought-forward': 'رصيد منقول من الصفحة السابقة',
        'carried-forward': 'رصيد منقول إلى الصفحة التالية', 'closing': 'الرصيد الختامي',
        'totals': 'إجمالي السحب / الإيداع', 'page-totals': 'إجمالي الصفحة سحب / إيداع',
        'page': 'صفحة {} من {}',
    },
}


def grouped(minor):
    """1,234.56 from non-negative minor units."""
    return f'{minor // 100:,}.{minor % 100:02d}'


def movement_amount(minor):
    """A movement's withdrawal or deposit cell: empty when the movement is
    the other kind."""
    return grouped(minor) if minor else ''


def total_amount(minor):
    """A totals cell: printed even when nothing moved that way (0.00)."""
    return grouped(minor)


def balance_text(minor):
    """A running balance; an overdrawn balance carries the suffix DR."""
    return f'{grouped(-minor)} DR' if minor < 0 else grouped(minor)


def digits_of(story):
    if story['layout'] == 'ar' and story.get('digits') == 'arabic':
        return lambda t: t.translate(ARABIC_INDIC)
    return lambda t: t


def account_line(story):
    L, st, d = LABELS[story['layout']], story['statement'], digits_of(story)
    p = st['period']
    return (f"{L['account']}: {st['account']} · {L['currency']}: {st['currency']} · "
            f"{L['period']}: {d(p['start'])} — {d(p['end'])}")


def table_rows(story, page):
    """One page's table body in logical column order: (kind, cells).

    - 'label': [label, balance] for opening, brought/carried forward, closing;
    - 'totals': [label, withdrawals, deposits];
    - 'continuation': [text];
    - 'movement': the seven cells; a description may hold explicit line
      breaks.
    """
    L, d = LABELS[story['layout']], digits_of(story)
    out = []
    for line in page['lines']:
        k = line['kind']
        if k in ('opening', 'brought-forward', 'carried-forward', 'closing'):
            out.append(('label', [L[k], d(balance_text(line['balance']))]))
        elif k in ('totals', 'page-totals'):
            out.append(('totals', [L[k], d(total_amount(line['withdrawal'])), d(total_amount(line['deposit']))]))
        elif k == 'continuation':
            out.append(('continuation', [line['text']]))
        else:
            out.append(('movement', [d(line['date']), d(line['valueDate']), line['description'], line['reference'],
                                     d(movement_amount(line['withdrawal'])), d(movement_amount(line['deposit'])),
                                     d(balance_text(line['balance']))]))
    return out


def footer(story, page):
    return digits_of(story)(LABELS[story['layout']]['page'].format(page['number'], page['of']))


CASHBOOK_HEADERS = ['Date', 'Voucher', 'Description', 'Reference', 'Receipts', 'Payments']


def plain(minor):
    return f'{minor // 100}.{minor % 100:02d}' if minor else ''


def cashbook_rows(story):
    return [CASHBOOK_HEADERS] + [[e['date'], e['voucher'], e['description'], e['reference'],
                                  plain(e['receipt']), plain(e['payment'])] for e in story['cashbook']]


def cashbook_csv(story):
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator='\r\n', quoting=csv.QUOTE_MINIMAL).writerows(cashbook_rows(story))
    return buffer.getvalue()
