"""Printed furniture and number formats shared by the G23 renderers.

The column headings, control-line labels, the account line and the page
footer are the contract's (audit/bank-statement-foundation/contract.json),
in English and Arabic. The bank name, document title and account come from
each story. Copied from R3's common.py (R4's, W4's, G23's, G20's, G17's,
G15's, G14's, G12's, G10's and G9's) with T4's one change: every amount is
printed at the ISO 4217 exponent of its statement's currency (SAR 2, KWD 3,
JPY 0) instead of always two decimals. Nothing is imported from the
foundation, from another holdout or from the product.
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


EXPONENT = {'SAR': 2, 'KWD': 3, 'JPY': 0}


def exponent_of(story):
    return EXPONENT[story['statement']['currency']]


def grouped(minor, exponent=2):
    """1,234.56 (1,234.567 of a dinar, 1,234 of yen) from non-negative minor
    units."""
    unit = 10 ** exponent
    whole = f'{minor // unit:,}'
    return f'{whole}.{minor % unit:0{exponent}d}' if exponent else whole


def movement_amount(minor, exponent=2):
    """A movement's withdrawal or deposit cell: empty when the movement is
    the other kind."""
    return grouped(minor, exponent) if minor else ''


def total_amount(minor, exponent=2):
    """A totals cell: printed even when nothing moved that way (0.00)."""
    return grouped(minor, exponent)


def balance_text(minor, exponent=2):
    """A running balance; an overdrawn balance carries the suffix DR."""
    return f'{grouped(-minor, exponent)} DR' if minor < 0 else grouped(minor, exponent)


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
    L, d, e = LABELS[story['layout']], digits_of(story), exponent_of(story)
    out = []
    for line in page['lines']:
        k = line['kind']
        if k in ('opening', 'brought-forward', 'carried-forward', 'closing'):
            out.append(('label', [L[k], d(balance_text(line['balance'], e))]))
        elif k in ('totals', 'page-totals'):
            out.append(('totals', [L[k], d(total_amount(line['withdrawal'], e)), d(total_amount(line['deposit'], e))]))
        elif k == 'continuation':
            out.append(('continuation', [line['text']]))
        else:
            out.append(('movement', [d(line['date']), d(line['valueDate']), line['description'], line['reference'],
                                     d(movement_amount(line['withdrawal'], e)), d(movement_amount(line['deposit'], e)),
                                     d(balance_text(line['balance'], e))]))
    return out


def footer(story, page):
    return digits_of(story)(LABELS[story['layout']]['page'].format(page['number'], page['of']))


CASHBOOK_HEADERS = ['Date', 'Voucher', 'Description', 'Reference', 'Receipts', 'Payments']


def plain(minor, exponent=2):
    if not minor:
        return ''
    unit = 10 ** exponent
    return f'{minor // unit}.{minor % unit:0{exponent}d}' if exponent else str(minor)


def cashbook_rows(story):
    e = exponent_of(story)
    return [CASHBOOK_HEADERS] + [[r['date'], r['voucher'], r['description'], r['reference'],
                                  plain(r['receipt'], e), plain(r['payment'], e)] for r in story['cashbook']]


def cashbook_csv(story):
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator='\r\n', quoting=csv.QUOTE_MINIMAL).writerows(cashbook_rows(story))
    return buffer.getvalue()
