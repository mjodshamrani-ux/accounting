#!/usr/bin/env python3
"""Write a small synthetic two-level supplier workbook using only OOXML/ZIP.

This writer is independent of ExcelJS and of the product's XLSX reader. The
manually authored contract is a separate file and is not generated here.
"""

from pathlib import Path
import xml.sax.saxutils as sax
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED


ROOT = Path(__file__).resolve().parent
MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships"


def cell(address, value):
    if isinstance(value, (int, float)):
        return f'<c r="{address}"><v>{value}</v></c>'
    return f'<c r="{address}" t="inlineStr"><is><t>{sax.escape(value)}</t></is></c>'


def sheet(rows, merges=()):
    body = []
    for number, values in rows:
        cells = "".join(cell(address, value) for address, value in values)
        body.append(f'<row r="{number}">{cells}</row>')
    merged = (f'<mergeCells count="{len(merges)}">' +
              "".join(f'<mergeCell ref="{ref}"/>' for ref in merges) +
              '</mergeCells>') if merges else ""
    return ('<?xml version="1.0" encoding="UTF-8"?>' +
            f'<worksheet xmlns="{MAIN}"><sheetData>{"".join(body)}</sheetData>' +
            merged + '</worksheet>').encode()


def workbook(statement):
    content_types = ('<?xml version="1.0" encoding="UTF-8"?>' +
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                     '<Default Extension="xml" ContentType="application/xml"/>' +
                     '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                     '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
                     '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
                     '</Types>').encode()
    book = (f'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="{MAIN}" xmlns:r="{REL}">' +
            '<sheets><sheet name="Cover" sheetId="1" r:id="rId1"/>' +
            '<sheet name="Statement" sheetId="2" r:id="rId2"/></sheets></workbook>').encode()
    parts = {
        '[Content_Types].xml': content_types,
        '_rels/.rels': (f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{PACKAGE}">' +
                        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
                        '</Relationships>').encode(),
        'xl/workbook.xml': book,
        'xl/_rels/workbook.xml.rels': (f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{PACKAGE}">' +
                                      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
                                      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
                                      '</Relationships>').encode(),
        'xl/worksheets/sheet1.xml': sheet([
            (1, [('A1', 'Synthetic supplier statement — cover only')]),
            (2, [('A2', 'Account AP-714 · SAR · July 2026')]),
            (3, [('A3', 'This sheet has no transaction rows')]),
        ]),
        'xl/worksheets/sheet2.xml': statement,
    }
    return parts


def statement(conflicting):
    second_ref = 'INV-934' if conflicting else 'INV-932'
    second_po = 'PO-99' if conflicting else 'PO-41'
    rows = [
        (1, [('A1', 'Synthetic supplier · statement of account')]),
        (2, [('A2', 'AP-714 · SAR · 2026-07-01 to 2026-07-31')]),
        (3, [('A3', 'Date'), ('B3', 'Document No'), ('C3', 'Movement'),
             ('E3', 'Running balance'), ('F3', 'Line ID'), ('G3', 'PO / Bank reference')]),
        (4, [('C4', 'Debit'), ('D4', 'Credit')]),
        (5, [('A5', 'Opening balance'), ('E5', 1000)]),
        (6, [('A6', '2026-07-15'), ('B6', 'INV-932'), ('C6', 780),
             ('E6', 1780), ('F6', 'LINE-1'), ('G6', 'PO-41')]),
        (7, [('A7', '2026-07-15'), ('B7', second_ref), ('C7', 220),
             ('E7', 2000), ('F7', 'LINE-2'), ('G7', second_po)]),
        (8, [('A8', '2026-07-16'), ('B8', 'PAY-44'), ('D8', 350),
             ('E8', 1650), ('F8', 'LINE-3'), ('G8', 'BANK-44')]),
        (9, [('A9', '2026-07-17'), ('B9', 'CN-3'), ('D9', 50),
             ('E9', 1600), ('F9', 'LINE-4')]),
        (10, [('A10', 'Closing balance'), ('E10', 1600)]),
    ]
    return sheet(rows, ('A1:G1', 'A2:G2', 'A3:A4', 'B3:B4', 'C3:D3',
                        'E3:E4', 'F3:F4', 'G3:G4'))


def write_xlsx(path, parts):
    with ZipFile(path, 'w') as archive:
        for name, data in parts.items():
            info = ZipInfo(name, date_time=(2026, 7, 15, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, data)


def main():
    output = ROOT / 'frozen'
    output.mkdir(exist_ok=True)
    write_xlsx(output / 'supplier-layered-proven.xlsx', workbook(statement(False)))
    write_xlsx(output / 'supplier-layered-conflict.xlsx', workbook(statement(True)))
    (output / 'ledger-plain.csv').write_bytes(
        b'Date,Document No,Type,Amount,PO / Bank reference\r\n'
        b'2026-07-15,INV-932,Invoice,1000.00,PO-41\r\n'
        b'2026-07-16,PAY-44,Payment,-350.00,BANK-44\r\n'
        b'2026-07-17,CN-3,Credit Note,-50.00,\r\n')


if __name__ == '__main__':
    main()
