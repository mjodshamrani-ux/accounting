"""New F02-E development sources, written independently with literal OOXML.

The original F02 files and contract are untouched. This extension supplies the
missing explicit document types and separate PO/bank roles; it is not a holdout.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / 'layered-statement'))
from generate import sheet, workbook, write_xlsx


def statement(conflict=False):
    return sheet([
        (1, [('A1', 'Synthetic typed supplier statement')]),
        (2, [('A2', 'AP-714 · SAR · 2026-07-01 to 2026-07-31')]),
        (3, [('A3', 'Date'), ('B3', 'Document No'), ('C3', 'Movement'),
             ('E3', 'Running balance'), ('F3', 'Type'), ('G3', 'PO'),
             ('H3', 'Bank Reference'), ('I3', 'Line ID')]),
        (4, [('C4', 'Debit'), ('D4', 'Credit')]),
        (5, [('A5', 'Opening balance'), ('E5', 1000)]),
        (6, [('A6', '2026-07-15'), ('B6', 'INV-932'), ('C6', 780),
             ('E6', 1780), ('F6', 'Invoice'), ('G6', 'PO-41'), ('I6', 'LINE-1')]),
        (7, [('A7', '2026-07-15'), ('B7', 'INV-934' if conflict else 'INV-932'),
             ('C7', 220), ('E7', 2000), ('F7', 'Invoice'),
             ('G7', 'PO-99' if conflict else 'PO-41'), ('I7', 'LINE-2')]),
        (8, [('A8', '2026-07-16'), ('B8', 'PAY-44'), ('D8', 350),
             ('E8', 1650), ('F8', 'Payment'), ('H8', 'BANK-44'), ('I8', 'LINE-3')]),
        (9, [('A9', '2026-07-17'), ('B9', 'CN-3'), ('D9', 50),
             ('E9', 1600), ('F9', 'Credit Note'), ('I9', 'LINE-4')]),
        (10, [('A10', 'Closing balance'), ('E10', 1600)]),
    ], ('A1:I1', 'A2:I2', 'A3:A4', 'B3:B4', 'C3:D3', 'E3:E4',
        'F3:F4', 'G3:G4', 'H3:H4', 'I3:I4'))


def main():
    out = ROOT / 'frozen'
    out.mkdir(exist_ok=True)
    for conflict in (False, True):
        name = 'supplier-typed-conflict.xlsx' if conflict else 'supplier-typed-proven.xlsx'
        write_xlsx(out / name, workbook(statement(conflict)))
    (out / 'ledger-typed.csv').write_bytes(
        b'Date,Document No,Type,Amount,PO,Bank Reference\r\n'
        b'2026-07-15,INV-932,Invoice,1000.00,PO-41,\r\n'
        b'2026-07-16,PAY-44,Payment,-350.00,,BANK-44\r\n'
        b'2026-07-17,CN-3,Credit Note,-50.00,,\r\n')


if __name__ == '__main__':
    main()
