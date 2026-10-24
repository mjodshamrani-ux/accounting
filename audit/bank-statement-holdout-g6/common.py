"""Printed furniture and number formats shared by the G6 renderers.

The column headings, control-line labels and page footer are the contract's
(audit/bank-statement-foundation/contract.json). The bank name, document
title and account come from each story. Written for G6; nothing is imported
from the foundation's renderer or from the product.
"""
import csv
import io

AR_DIGITS = str.maketrans('0123456789,.', '٠١٢٣٤٥٦٧٨٩٬٫')

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


def money(minor):
    """1,234.56 from minor units; empty for zero."""
    if not minor:
        return ''
    a = abs(minor)
    return ('-' if minor < 0 else '') + f'{a // 100:,}.{a % 100:02d}'


def balance_text(minor):
    return f'{money(-minor)} DR' if minor < 0 else (money(minor) or '0.00')


def number_form(story):
    """How this story prints digits."""
    if story['layout'] == 'ar' and story.get('digits') == 'arabic':
        return lambda t: t.translate(AR_DIGITS)
    return lambda t: t


def account_line(story):
    L, st, num = LABELS[story['layout']], story['statement'], number_form(story)
    p = st['period']
    return (f"{L['account']}: {st['account']} · {L['currency']}: {st['currency']} · "
            f"{L['period']}: {num(p['start'])} — {num(p['end'])}")


def rows(story, page):
    """The printed table body of one page: (kind, cells) with seven cells in
    logical column order, or a label spanning the first columns."""
    L, num = LABELS[story['layout']], number_form(story)
    out = []
    for line in page['lines']:
        k = line['kind']
        if k in ('opening', 'brought-forward', 'carried-forward', 'closing'):
            out.append(('label', [L[k], num(balance_text(line['balance']))]))
        elif k in ('totals', 'page-totals'):
            out.append(('totals', [L[k], num(money(line['withdrawal'])), num(money(line['deposit']))]))
        elif k == 'continuation':
            out.append(('continuation', ['', '', line['text'], '', '', '', '']))
        else:
            out.append(('movement', [num(line['date']), num(line['valueDate']), line['description'],
                                     line['reference'], num(money(line['withdrawal'])), num(money(line['deposit'])),
                                     num(balance_text(line['balance']))]))
    return out


def footer(story, page):
    return number_form(story)(LABELS[story['layout']]['page'].format(page['number'], page['of']))


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
