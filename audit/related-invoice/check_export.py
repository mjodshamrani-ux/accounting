"""F03 independent literal source/membership/role oracle; no product imports."""
import argparse
import csv
import hashlib
import json
import re
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'export-design'))
from check_membership import Book, value, minor, require
ROOT=Path(__file__).resolve().parent

def check(filename, expected_engine='0.3.25-experimental'):
    contract=json.loads((ROOT/'contract.json').read_text())
    manifest=json.loads((ROOT/'source-manifest.json').read_text())
    for name,sha in manifest.items():
        require(hashlib.sha256((ROOT/'frozen'/name).read_bytes()).hexdigest()==sha,'frozen source changed: '+name)
    book=Book(filename)
    try:
        rows,_=book.rows('Export Metadata',{'Field','Value'})
        meta={value(r,'Field'):value(r,'Value') for r in rows}
        require(meta['Engine version']==expected_engine,'wrong engine version')
        possibilities=[(c,ext) for c in contract['cases'] for ext in ['xlsx','pdf'] if manifest.get(c['id']+'-supplier.'+ext)==meta['Supplier SHA-256'] and manifest[c['id']+'-ledger.csv']==meta['Ledger SHA-256']]
        require(len(possibilities)==1,'unknown or ambiguous source pair')
        case,ext=possibilities[0]
        with (ROOT/'frozen'/(case['id']+'-ledger.csv')).open(newline='') as f:
            original=list(csv.reader(f))
        kind=original[1][original[0].index('Type')]
        own_label='Credit Note No' if 'Credit Note No' in original[0] else 'Document No' if 'Document No' in original[0] else ''
        expected_own=original[1][original[0].index(own_label)] if own_label else (original[1][original[0].index('Invoice No')] if kind=='Invoice' else '')
        supplier_own='CN-701' if case['id']=='different-credit-notes' else expected_own
        evidence,_=book.rows('Match Evidence',{'Side','Source Row','Primary Reference','Document Reference','Amount','Related Invoice Reference','Related Invoice Header','Related Invoice Column','Document Number Role','Document Number Header','Document Number Column','Document Type'})
        require(len(evidence)==len(original),'source movement lost or duplicated in cases') # supplier one + ledger len-1
        for r in evidence:
            side=value(r,'Side');rn=int(value(r,'Source Row'))
            require(side in ['supplier','ledger'] and rn in range(2,len(original)+1),'invalid physical row provenance')
            own=supplier_own if side=='supplier' else expected_own
            primary=case.get('primary') if case['approved'] else own
            require(value(r,'Primary Reference')==(primary or ''),'related invoice promoted or own identity changed')
            require(value(r,'Document Reference')==own,'own document reference changed')
            require(value(r,'Document Type')==kind,'type changed')
            invoice='INV-402' if side=='ledger' and case['id'] in ['conflicting-related-invoice','payment-bank-identity'] else 'INV-401'
            related=invoice if kind!='Invoice' else ''
            require(value(r,'Related Invoice Reference')==related,'related invoice lost or changed')
            if related:
                related_col=3 if own_label else 2
                if ext=='pdf' and side=='supplier': related_col=3
                require(value(r,'Related Invoice Header')=='Invoice No' and value(r,'Related Invoice Column')==str(related_col),'related role provenance lost')
            if own:
                require(value(r,'Document Number Header')==(own_label or 'Invoice No'),'own number header lost')
                require(value(r,'Document Number Role')==('invoice-number' if kind=='Invoice' else 'document-number'),'wrong own number role')
            expected_amount=-2000 if case['id']=='whole-credit-note-group' and side=='ledger' and rn==2 else -3000 if case['id']=='whole-credit-note-group' and side=='ledger' and rn==3 else 5000 if kind=='Invoice' else -5000
            require(minor(r,'Amount')==expected_amount,'financial amount changed')
        matches,_=book.rows('Matches',{'Supplier Source Rows','Ledger Source Rows','Supplier Amount','Ledger Amount','Rule'})
        require(len(matches)==case['approved'],'wrong approved match count')
        if matches:
            r=matches[0]
            require(minor(r,'Supplier Amount')==minor(r,'Ledger Amount')==case['amountMinor'],'approved total changed')
            for side in ['supplier','ledger']:
                count=int(value(r,side.title()+' Source Rows'))
                require(count==len(case[side+'Rows']),'wrong complete-group membership count')
                wanted={side.title()+' Source '+str(i) for i in range(1,count+1)}
                full,_=book.rows('Matches',wanted)
                traces=[re.fullmatch(side+r' · (?:Statement|CSV|PDF) · row ([0-9]+)(?: · PDF p1)?',value(full[0],k)) for k in sorted(wanted)]
                require(all(t is not None for t in traces),'invalid source trace')
                require([int(t.group(1)) for t in traces]==case[side+'Rows'],'wrong approved source members')
            if case['id']=='short-own-credit-note':require(value(r,'Rule')=='EXPLICIT_SHORT_DOCUMENT_EXACT_DATE_V1','short document lost exact proof')
        # Literal originals are available separately from interpreted accounting roles.
        for side in ['Supplier','Ledger']:
            raw,_=book.rows('Parsed '+side+' Source',{'صف المصدر',*{'عمود '+str(i) for i in range(1,(5 if side=='Supplier' and ext=='pdf' else len(original[0]))+1)}})
            expected_rows = original
            if side=='Supplier':
                if ext=='pdf':
                    expected_rows=[['Date','Credit Note No','Invoice No','Amount','Type'],['2026-07-17',supplier_own,'INV-401','-50.00','Credit Note']]
                else:
                    source=Book(ROOT/'frozen'/(case['id']+'-supplier.xlsx'))
                    try:
                        source_rows,_=source.rows('Statement',set(original[0]))
                        expected_rows=[original[0]]+[[value(r,h) for h in original[0]] for r in source_rows]
                    finally: source.close()
            require([int(value(r,'صف المصدر')) for r in raw]==list(range(1,len(expected_rows)+1)),'raw physical rows lost')
            require([[value(r,'عمود '+str(i)) for i in range(1,len(expected_rows[0])+1)] for r in raw]==expected_rows,'original source cell lost or rewritten')
        settings,_=book.rows('Run Settings',{'الحقل','القيمة'})
        s=json.loads(next(value(r,'القيمة') for r in settings if value(r,'الحقل')=='Scope'))
        require(s['coverageConfirmed'] is False,'full reconciliation inferred from transaction comparison')
        return {'verified':True,'id':case['id'],'sourceFormat':ext,'approved':case['approved'],'engine':expected_engine}
    finally:book.close()

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('workbooks',nargs='+',type=Path);p.add_argument('--expected-engine',default='0.3.25-experimental');a=p.parse_args()
    print(json.dumps([{'workbook':str(f),**check(f,a.expected_engine)} for f in a.workbooks],indent=2))
