"""Independent F02-R1 export oracle. Uses literal OOXML and frozen facts;
never imports the engine, ExcelJS, or a product-generated expected result."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'export-design'))
from check_membership import Book, value, minor, require

ROOT = Path(__file__).resolve().parent

def check(path):
    contract = json.loads((ROOT / 'reading-contract.json').read_text())
    book = Book(path)
    try:
        fields = {'Source SHA-256', 'Sheet', 'Header start row', 'Header end row', 'Output column',
                  'Origin row', 'Origin column', 'Original label', 'Vertical merge range', 'Parent label',
                  'Parent merge range', 'Derived label', 'Mapped fields', 'Rule', 'Reading basis'}
        proofs, _ = book.rows('XLSX Header Provenance', fields)
        require(len(proofs) == 7, 'seven distinct header origins required')
        source_hashes = {value(row, 'Source SHA-256') for row in proofs}
        require(len(source_hashes) == 1, 'mixed source hashes')
        sha = next(iter(source_hashes))
        source = next((f for f in contract['files'] if f['role'] == 'supplier' and f['sha256'] == sha), None)
        require(source is not None, 'unexpected original source hash')
        require(hashlib.sha256((ROOT / 'frozen' / source['name']).read_bytes()).hexdigest() == sha, 'frozen source changed')
        columns = {}
        for row in proofs:
            column = int(value(row, 'Output column'))
            require(column not in columns, 'duplicate header output column')
            columns[column] = row
            require(value(row,'Sheet') == 'Statement', 'wrong original sheet')
            require([int(value(row,f)) for f in ['Header start row','Header end row']] == [3,4], 'wrong header band')
            require(value(row,'Rule') == 'NATIVE_XLSX_TWO_ROW_MOVEMENT_V1', 'unsupported proof rule')
            require(value(row,'Reading basis') == 'Automatic source rule', 'frozen source was not automatically read')
            require(int(value(row,'Origin column')) == column, 'origin moved across columns')
        require(set(columns) == set(range(1,8)), 'missing header column')
        for col, row, label, merge, role in [(1,3,'Date','A3:A4','date'),(2,3,'Document No','B3:B4','reference'),
                                           (3,4,'Debit','','debit'),(4,4,'Credit','','credit'),
                                           (5,3,'Running balance','E3:E4','')]:
            proof = columns[col]
            require(int(value(proof,'Origin row')) == row and value(proof,'Original label') == label, 'wrong original anchor')
            require(value(proof,'Vertical merge range') == merge and value(proof,'Mapped fields') == role, 'wrong merge/role')
            require(value(proof,'Derived label') == label, 'label silently rewritten')
            if col in (3,4):
                require(value(proof,'Parent label') == 'Movement' and value(proof,'Parent merge range') == 'C3:D3', 'wrong monetary parent')
        tx, _ = book.rows('Supplier transactions', {'صف المصدر','المرجع الأصلي','المبلغ الموحد'})
        expected_refs = ['INV-932', 'INV-934' if 'conflict' in source['name'] else 'INV-932', 'PAY-44','CN-3']
        require([(int(value(row,'صف المصدر')), value(row,'المرجع الأصلي'), minor(row,'المبلغ الموحد')) for row in tx]
                == list(zip([6,7,8,9], expected_refs, [78000,22000,-35000,-5000])), 'transaction identity/amount/row changed')
        excluded, _ = book.rows('Excluded Rows', {'الطرف','صف المصدر'})
        fates = [int(value(row,'صف المصدر')) for row in excluded if value(row,'الطرف') == 'المورد'] + [int(value(row,'صف المصدر')) for row in tx]
        require(sorted(fates) == list(range(1,11)), 'lost or duplicate physical row fate')
        parsed, _ = book.rows('Parsed Supplier Source', {'صف المصدر','عمود 1','عمود 2','عمود 3','عمود 4','عمود 5'})
        require([int(value(row,'صف المصدر')) for row in parsed] == list(range(1,11)), 'source row renumbered')
        require(value(parsed[2],'عمود 3') == 'Movement' and value(parsed[3],'عمود 3') == 'Debit', 'source header replaced by derived view')
        require(value(parsed[4],'عمود 5') == '1000' and value(parsed[9],'عمود 5') == '1600', 'source balances changed')
        for row, ref, debit, credit in zip(parsed[5:9],expected_refs,['780','220','',''],['','','350','50']):
            require([value(row,f) for f in ['عمود 2','عمود 3','عمود 4']] == [ref,debit,credit], 'raw source movement changed')
        matches, _ = book.rows('Matches', {'Supplier References','Supplier Amount','Ledger References','Ledger Amount','Supplier Source 1','Ledger Source 1','Match Decision'})
        require(len(matches) == 1, 'unproved invoice/short reference approved')
        approved = matches[0]
        require(value(approved,'Supplier References') == value(approved,'Ledger References') == 'PAY-44', 'wrong approved identity')
        require(minor(approved,'Supplier Amount') == minor(approved,'Ledger Amount') == -35000, 'wrong approved signed amount')
        require(value(approved,'Supplier Source 1') == 'supplier · Statement · row 8' and value(approved,'Ledger Source 1') == 'ledger · CSV · row 3', 'wrong approved members')
        settings, _ = book.rows('Run Settings', {'الحقل','القيمة'})
        actual_scope = json.loads(next(value(row,'القيمة') for row in settings if value(row,'الحقل') == 'Scope'))
        require(actual_scope['coverageConfirmed'] is False, 'full reconciliation claimed without coverage proof')
        return {'verified': True, 'source': source['name'], 'sourceHash': sha, 'movements': 4, 'rowFates': 10,
                'approvedSupplierRows': [8], 'headerBand': [3,4], 'fullReconciliation': False}
    finally:
        book.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('workbooks', nargs='+', type=Path)
    args = parser.parse_args()
    print(json.dumps([{'workbook': str(path), **check(path)} for path in args.workbooks], indent=2))
