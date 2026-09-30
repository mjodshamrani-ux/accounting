"""Independent source-role, row-fate and money checks; no product reader imports."""
import argparse
import csv
import hashlib
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'export-design'))
from check_membership import Book, value, minor, require
ROOT=Path(__file__).resolve().parent

def check(filename,expected_engine='0.3.25-experimental'):
    contract=json.loads((ROOT/'contract.json').read_text())
    manifest=json.loads((ROOT/'source-manifest.json').read_text())
    for name,sha in manifest.items():require(hashlib.sha256((ROOT/'frozen'/name).read_bytes()).hexdigest()==sha,'frozen source changed: '+name)
    book=Book(filename)
    try:
        rows,_=book.rows('Export Metadata',{'Field','Value'});meta={value(r,'Field'):value(r,'Value') for r in rows}
        require(meta['Engine version']==expected_engine,'wrong engine')
        choices=[(c,ext) for c in contract['cases'] for ext in ['xlsx','csv'] if manifest[c['id']+'-supplier.'+ext]==meta['Supplier SHA-256'] and manifest[c['id']+'-ledger.csv']==meta['Ledger SHA-256']]
        require(len(choices)==1,'unknown or ambiguous sources');c,ext=choices[0]
        evidence,_=book.rows('Match Evidence',{'Side','Source Row','Amount','Document Type','Retained Evidence','Status','Document Number Role','Evidence'})
        require(len(evidence)==2,'movement lost or duplicated')
        require({value(r,'Side') for r in evidence}=={'supplier','ledger'},'wrong source sides')
        for r in evidence:
            side=value(r,'Side');credit=c[side+'Credit']
            require(value(r,'Source Row')=='2','wrong physical movement row')
            require(minor(r,'Amount')==c['amountMinor'],'money changed')
            require(value(r,'Document Type')=='Unknown','unproved type invented')
            if credit:
                label='رقم الإشعار الدائن' if c['id'].startswith('arabic') else 'Credit Note No'
                require('unverifiedCreditNoteNumber ('+label+'): '+credit in value(r,'Retained Evidence'),'native credit cue lost or changed')
                require(value(r,'Document Number Role')=='','unknown role promoted to proven identity')
                require(value(r,'Status')=='Needs Review','unproved row silently accepted')
                require('لم يتضح نوع المستند' in value(r,'Evidence'),'reason lost')
        matches,_=book.rows('Matches',{'Supplier Amount','Ledger Amount','Supplier Source Rows','Ledger Source Rows'})
        require(len(matches)==c['approved'],'wrong approved count')
        if matches:
            require(minor(matches[0],'Supplier Amount')==minor(matches[0],'Ledger Amount')==c['amountMinor'],'matched totals changed')
            require(value(matches[0],'Supplier Source Rows')==value(matches[0],'Ledger Source Rows')=='1','matched membership changed')
        for side in ['Supplier','Ledger']:
            with (ROOT/'frozen'/(c['id']+'-'+side.lower()+'.csv')).open(newline='') as f:original=list(csv.reader(f))
            raw,_=book.rows('Parsed '+side+' Source',{'صف المصدر',*{'عمود '+str(i) for i in range(1,len(original[0])+1)}})
            require([value(r,'صف المصدر') for r in raw]==['1','2'],'raw row fate changed')
            require([[value(r,'عمود '+str(i)) for i in range(1,len(original[0])+1)] for r in raw]==original,'source cells changed')
        settings,_=book.rows('Run Settings',{'الحقل','القيمة'});scope=json.loads(next(value(r,'القيمة') for r in settings if value(r,'الحقل')=='Scope'))
        require(scope['coverageConfirmed'] is False,'full coverage invented')
        return {'verified':True,'id':c['id'],'format':ext,'approved':c['approved'],'engine':expected_engine}
    finally:book.close()

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('workbooks',nargs='+',type=Path);a=p.parse_args()
    print(json.dumps([{'workbook':str(f),**check(f)} for f in a.workbooks],indent=2))
