"""F03 development sources: literal OOXML/CSV, independent of product readers.
No historical F01/F02/F02-E source or expected answer is changed.
"""
import csv
import io
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / 'layered-statement'))
from generate import sheet, workbook, write_xlsx

def main():
    specs = [
        ('different-credit-notes', 'Credit Note No', 'Credit Note', 'CN-701', 'CN-799', 'INV-401', 'INV-401', '-50.00', 0),
        ('own-credit-note', 'Credit Note No', 'Credit Note', 'CN-701', 'CN-701', 'INV-401', 'INV-401', '-50.00', 1),
        ('generic-own-and-invoice', 'Document No', 'Credit Note', 'CN-701', 'CN-701', 'INV-401', 'INV-401', '-50.00', 1),
        ('short-own-credit-note', 'Credit Note No', 'Credit Note', 'CN-3', 'CN-3', 'INV-401', 'INV-401', '-50.00', 1),
        ('conflicting-related-invoice', 'Credit Note No', 'Credit Note', 'CN-701', 'CN-701', 'INV-401', 'INV-402', '-50.00', 0),
        ('credit-note-invoice-only', None, 'Credit Note', '', '', 'INV-401', 'INV-401', '-50.00', 0),
        ('payment-invoice-only', None, 'Payment', '', '', 'INV-401', 'INV-401', '-50.00', 0),
        ('journal-invoice-only', None, 'Journal', '', '', 'INV-401', 'INV-401', '-50.00', 0),
        ('ordinary-invoice', None, 'Invoice', '', '', 'INV-401', 'INV-401', '50.00', 1),
        ('payment-bank-identity', None, 'Payment', '', '', 'INV-401', 'INV-402', '-50.00', 1),
        ('whole-credit-note-group', 'Credit Note No', 'Credit Note', 'CN-701', 'CN-701', 'INV-401', 'INV-401', '-50.00', 1),
    ]
    for name, own_header, kind, left, right, inv_left, inv_right, amount, matches in specs:
        header = ['Date'] + ([own_header] if own_header else []) + ['Invoice No', 'Type', 'Amount', 'PO', 'Bank Reference']
        def row(own, inv, money):
            return ['2026-07-17'] + ([own] if own_header else []) + [inv, kind, money, 'PO-714' if name == 'whole-credit-note-group' else '', 'BANK-714' if name == 'payment-bank-identity' else '']
        a = [header, row(left, inv_left, amount)]
        b = [header, row(right, inv_right, amount)]
        if name == 'whole-credit-note-group':
            b = [header, row(right, inv_right, '-20.00'), row(right, inv_right, '-30.00')]
        write_xlsx(ROOT / 'frozen' / (name + '-supplier.xlsx'), workbook(sheet([
            (i, [(chr(65+j)+str(i), val) for j, val in enumerate(values)])
            for i, values in enumerate(a, 1)
        ])))
        buf = io.StringIO(newline='')
        csv.writer(buf, lineterminator='\r\n').writerows(b)
        (ROOT / 'frozen' / (name + '-ledger.csv')).write_bytes(buf.getvalue().encode())

if __name__ == '__main__':
    main()
