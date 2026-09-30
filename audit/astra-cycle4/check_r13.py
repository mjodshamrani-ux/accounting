"""Replay oracle for the exact retained R13 failure package, using literal OOXML.
No engine or ExcelJS imports; no expectations generated from the candidate result.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'export-design'))
from check_membership import Book, value, minor, require

ROOT = Path(__file__).resolve().parent.parent
ORIGINAL_SHA = 'a085499d9e6ae2d165cd6716034f0945ecbb7151ad561bca70a4926a94250958'

def check(filename, expected_engine='0.3.22-experimental'):
    original = ROOT / 'sol-cycle4/r13-excluded-competitor.xlsx'
    require(hashlib.sha256(original.read_bytes()).hexdigest() == ORIGINAL_SHA, 'Original R13 source changed')
    book = Book(filename)
    try:
        metadata, _ = book.rows('Export Metadata', {'Field', 'Value'})
        metadata = {value(row, 'Field'): value(row, 'Value') for row in metadata}
        require(metadata['Supplier SHA-256'] == ORIGINAL_SHA, 'A lookalike source replaced the retained failure')
        require(metadata['Engine version'] == expected_engine, 'Wrong candidate engine')
        matches, _ = book.rows('Matches', {'Supplier References', 'Match Decision'})
        require(len(matches) == 0, 'Excluded competitor manufactured an approved match')
        tx, _ = book.rows('Supplier transactions', {'صف المصدر', 'المرجع الأصلي', 'المبلغ الموحد'})
        require([(int(value(row, 'صف المصدر')), value(row, 'المرجع الأصلي'), minor(row, 'المبلغ الموحد')) for row in tx]
                == [(6, 'INV-932', 78000), (7, 'INV-932', 22000), (8, 'PAY-44', -35000), (9, 'CN-3', -5000)], 'Readable movements changed')
        excluded, _ = book.rows('Excluded Rows', {'الطرف', 'صف المصدر', 'المحتوى'})
        supplier_excluded = [row for row in excluded if value(row, 'الطرف') == 'المورد']
        require(sorted(int(value(row, 'صف المصدر')) for row in supplier_excluded) == [1,2,3,4,5,10,11], 'Physical row fate changed')
        competitor = next(row for row in supplier_excluded if value(row, 'صف المصدر') == '11')
        require(json.loads(value(competitor, 'المحتوى')) == ['2026-07-16','PAY-44','','350','1300','LINE-5','BANK-44'], 'Competitor disappeared or was rewritten')
        parsed, _ = book.rows('Parsed Supplier Source', {'صف المصدر','عمود 2','عمود 4'})
        require([int(value(row,'صف المصدر')) for row in parsed] == list(range(1,12)), 'Raw source rows lost')
        require(value(parsed[10], 'عمود 2') == 'PAY-44' and value(parsed[10], 'عمود 4') == '350', 'Excluded source value absent')
        diagnostics, _ = book.rows('Diagnostics', {'الرمز','التفسير'})
        require(any(value(row,'الرمز') == 'EXCLUDED_MOVEMENT_MEMBERSHIP' for row in diagnostics), 'Missing explanation')
        return {'verified': True, 'originalFailureSourceHash': ORIGINAL_SHA, 'approvedCases': 0,
                'readableSupplierRows': [6,7,8,9], 'excludedCompetitor': 11, 'sourceRowFates': 11,
                'basis': 'Frozen literal OOXML facts, not a product-generated expectation'}
    finally:
        book.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workbook', type=Path)
    parser.add_argument('--expected-engine', default='0.3.22-experimental')
    args = parser.parse_args()
    print(json.dumps(check(args.workbook, args.expected_engine), indent=2))
