"""Independent F02-E source/membership oracle using literal OOXML only."""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'export-design'))
from check_membership import Book, value, minor, require
ROOT = Path(__file__).resolve().parent


def check(filename, expected_engine='0.3.25-experimental'):
    contract = json.loads((ROOT / 'contract.json').read_text())
    for name, sha in contract['files'].items():
        require(hashlib.sha256((ROOT / 'frozen' / name).read_bytes()).hexdigest() == sha, 'frozen source changed')
    book = Book(filename)
    try:
        rows, _ = book.rows('Export Metadata', {'Field','Value'})
        metadata = {value(r,'Field'):value(r,'Value') for r in rows}
        require(metadata['Engine version'] == expected_engine, 'wrong engine version')
        name = next((n for n,s in contract['files'].items() if s == metadata['Supplier SHA-256']),None)
        require(name in ['supplier-typed-proven.xlsx','supplier-typed-conflict.xlsx'], 'unknown supplier source')
        require(metadata['Ledger SHA-256'] == contract['files']['ledger-typed.csv'], 'wrong ledger source')
        conflict = 'conflict' in name
        tx,_ = book.rows('Supplier transactions', {'صف المصدر','المرجع الأصلي','المبلغ الموحد'})
        refs = ['INV-932','INV-934' if conflict else 'INV-932','BANK-44','CN-3']
        require([(int(value(r,'صف المصدر')),value(r,'المرجع الأصلي'),minor(r,'المبلغ الموحد')) for r in tx] == list(zip([6,7,8,9],refs,[78000,22000,-35000,-5000])), 'supplier row/identity/amount changed')
        raw,_ = book.rows('Parsed Supplier Source', {'صف المصدر','عمود 2','عمود 3','عمود 4','عمود 5','عمود 6','عمود 7','عمود 8'})
        require([int(value(r,'صف المصدر')) for r in raw] == list(range(1,11)), 'raw physical rows lost')
        require(value(raw[4],'عمود 5')=='1000' and value(raw[9],'عمود 5')=='1600','source balances changed')
        for index,(doc,typ,debit,credit,po,bank) in enumerate([
            ('INV-932','Invoice','780','','PO-41',''),
            ('INV-934' if conflict else 'INV-932','Invoice','220','','PO-99' if conflict else 'PO-41',''),
            ('PAY-44','Payment','','350','','BANK-44'),
            ('CN-3','Credit Note','','50','','')]):
            r=raw[index+5]
            require([value(r,'عمود '+str(c)) for c in [2,6,3,4,7,8]]==[doc,typ,debit,credit,po,bank],'original document/type/role/financial cell rewritten')
        excluded,_=book.rows('Excluded Rows',{'الطرف','صف المصدر'})
        require(sorted([int(value(r,'صف المصدر')) for r in tx]+[int(value(r,'صف المصدر')) for r in excluded if value(r,'الطرف')=='المورد'])==list(range(1,11)),'row fate lost or repeated')
        fields={'Supplier Source Rows','Ledger Source Rows','Supplier Source 1','Ledger Source 1','Supplier Amount','Ledger Amount','Rule','Match Decision','Date Gap'}
        if not conflict: fields.add('Supplier Source 2')
        matches,_=book.rows('Matches',fields)
        expected=[((8,),(3,),-35000),((9,),(4,),-5000)]
        if not conflict: expected.append(((6,7),(2,),100000))
        actual=[]
        for r in matches:
            left_count=int(value(r,'Supplier Source Rows'))
            right_count=int(value(r,'Ledger Source Rows'))
            require(left_count in [1,2] and right_count==1,'unexpected member count')
            def source_row(label, side, sheet):
                match=re.fullmatch(side+r' · '+sheet+r' · row ([0-9]+)',label)
                require(match is not None,'bad source trace')
                return int(match.group(1))
            a=tuple(source_row(value(r,'Supplier Source '+str(i)),'supplier','Statement') for i in range(1,left_count+1))
            b=(source_row(value(r,'Ledger Source 1'),'ledger','CSV'),)
            amount=minor(r,'Supplier Amount')
            require(amount==minor(r,'Ledger Amount'),'unequal approved amounts')
            require(value(r,'Match Decision')=='Auto','unexpected manual authority')
            if a==(9,):
                require(value(r,'Rule')=='EXPLICIT_SHORT_DOCUMENT_EXACT_DATE_V1' and value(r,'Date Gap')=='0','short-document proof absent')
            actual.append((a,b,amount))
        require(sorted(actual)==sorted(expected),'wrong, missing or duplicate approved member set')
        evidence,_=book.rows('Match Evidence',{'Rule','Source Row ID','Document Number Role','Document Number Header','Document Number Column','Document Type'})
        short=[r for r in evidence if value(r,'Rule')=='EXPLICIT_SHORT_DOCUMENT_EXACT_DATE_V1']
        require({value(r,'Source Row ID') for r in short}=={'supplier:1:9','ledger:0:4'},'short-proof evidence membership changed')
        require(len(short)==2,'short-proof evidence duplicated')
        for r in short:
            require([value(r,k) for k in ['Document Number Role','Document Number Header','Document Number Column','Document Type']]==['document-number','Document No','2','Credit Note'],'short-proof source role/type evidence lost')
        settings,_=book.rows('Run Settings',{'الحقل','القيمة'})
        scope=json.loads(next(value(r,'القيمة') for r in settings if value(r,'الحقل')=='Scope'))
        require(scope['coverageConfirmed'] is False,'full balance reconciliation claimed')
        return {'verified':True,'source':name,'engine':expected_engine,'supplierMovements':4,'supplierRowFates':10,'approvedMemberSets':[{'supplierRows':list(a),'ledgerRows':list(b),'amountMinor':v} for a,b,v in actual],'fullReconciliation':False}
    finally:
        book.close()


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workbooks',nargs='+',type=Path)
    parser.add_argument('--expected-engine',default='0.3.25-experimental')
    args=parser.parse_args()
    print(json.dumps([{'workbook':str(p),**check(p,args.expected_engine)} for p in args.workbooks],indent=2))
