"""Independent frozen split-image Excel oracle. Standard-library OOXML; no product imports."""
import hashlib
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'export-design'))
from check_membership import Book, value, minor, require
from check_record import check as check_record, png

def check(filename, source=None):
    book=Book(filename)
    try:
        # Validate every XML and worksheet, including unselected text and images.
        for name in book.names:
            if name.endswith(('.xml','.rels')):ET.fromstring(book.archive.read(name))
        allowed_formulas={
            'Summary':{'B28':'COUNTIF(\'Matches\'!Q2:Q4,"Auto")','B29':"SUM('Matches'!O2:P4)",'B30':'COUNTIF(\'Needs Review\'!M2:M2,"Needs Review")','B31':'SUMIF(\'Needs Review\'!M2:M2,"Needs Review",\'Needs Review\'!N2:N2)+SUMIF(\'Needs Review\'!M2:M2,"Needs Review",\'Needs Review\'!O2:O2)','B32':"COUNTA('Unmatched'!A2:A4)",'B33':"SUM('Unmatched'!K2:K4)",'B34':'COUNTIF(\'Matches\'!Q2:Q4,"Manual")','B35':'COUNTIF(\'Needs Review\'!M2:M2,"Rejected")','B36':"'Reconciliation Bridge'!E6"},
            'Reconciliation Bridge':{'E6':'SUM(E2:E4)'}}
        from check_membership import XML
        for name,part in book.sheets.items():
            formulas={c.get('r'):c.find(XML+'f').text for c in ET.fromstring(book.archive.read(part)).findall('.//'+XML+'c') if c.find(XML+'f') is not None}
            require(formulas==allowed_formulas.get(name,{}),'unexpected workbook formulas')
            if name not in allowed_formulas:book.rows(name,set())
        chunks,_=book.rows('Visual Source Record',{'Side','Part','Original JSON text'})
        require(all(value(r,'Side')=='supplier' and int(value(r,'Part'))==i+1 for i,r in enumerate(chunks)),'source record parts missing/reordered')
        text=''.join(value(r,'Original JSON text') for r in chunks)
        if source is not None:require(text.encode()==Path(source).read_bytes(),'original JSON rewritten')
        record=json.loads(text)
        original=png.png_bytes(record['table']['image']['source']['originalPng'])
        check_record(record,original)
        images=[book.archive.read(n) for n in book.names if n.startswith('xl/media/') and not n.endswith('/')]
        require(images==[original],'original PNG omitted or changed')
        # The exact original must be attached to its dedicated visible source
        # worksheet, not merely hidden somewhere in the ZIP archive.
        import posixpath
        REL='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
        D='{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}'
        A='{http://schemas.openxmlformats.org/drawingml/2006/main}'
        attached=[]
        for name,part in book.sheets.items():
            drawings=ET.fromstring(book.archive.read(part)).findall(XML+'drawing')
            if not drawings:continue
            require(name=='Visual supplier PNG' and len(drawings)==1,'image attached to wrong worksheet')
            attached.append(name)
            relations=ET.fromstring(book.archive.read(posixpath.dirname(part)+'/_rels/'+posixpath.basename(part)+'.rels'))
            rel=next(r for r in relations if r.get('Id')==drawings[0].get(REL+'id'))
            require(rel.get('TargetMode')!='External','external drawing')
            drawing=posixpath.normpath(posixpath.dirname(part)+'/'+rel.get('Target'))
            root=ET.fromstring(book.archive.read(drawing));anchors=list(root)
            require(len(anchors)==1,'extra image anchors')
            anchor=anchors[0]
            require(anchor.find(D+'from/'+D+'col').text=='0' and anchor.find(D+'from/'+D+'row').text=='3','source image placement changed')
            blip=anchor.find('.//'+A+'blip')
            rels=ET.fromstring(book.archive.read(posixpath.dirname(drawing)+'/_rels/'+posixpath.basename(drawing)+'.rels'))
            imgrel=next(r for r in rels if r.get('Id')==blip.get(REL+'embed'))
            require(imgrel.get('TargetMode')!='External','external image')
            media=posixpath.normpath(posixpath.dirname(drawing)+'/'+imgrel.get('Target'))
            require(book.archive.read(media)==original,'displayed image differs from original')
        require(attached==['Visual supplier PNG'],'source image is not displayed')
        proof,_=book.rows('Visual Source Proof',{'Side','Record SHA-256','PNG SHA-256','Pixel SHA-256','Basis','Context','Interpretation receipt','Table coverage'})
        require(len(proof)==1 and value(proof[0],'Side')=='supplier','visual source provenance missing')
        p=proof[0]
        require(value(p,'Record SHA-256')==hashlib.sha256(text.encode()).hexdigest(),'record hash mismatch')
        require(value(p,'PNG SHA-256')==png.sha(original) and value(p,'Pixel SHA-256')==record['table']['image']['pixelSha256'],'PNG/pixel hash mismatch')
        require(value(p,'Basis')=='human-reviewed-transactions' and json.loads(value(p,'Context'))==record['context'],'interpretation changed')
        require(json.loads(value(p,'Interpretation receipt'))==record['review'] and json.loads(value(p,'Table coverage'))==record['table']['coverage'],'receipt lost')
        from check_record import literal
        from datetime import date
        truth=check_record(record,original);lang=truth['language'];contract=json.loads((Path(__file__).parent/'contract.json').read_text())
        matches,_=book.rows('Matches',{'Supplier References','Ledger References','Supplier Amount','Ledger Amount','Supplier Source Rows','Ledger Source Rows','Rule','Status','Match Decision','Supplier Date','Ledger Date'})
        require(len(matches)==3,'unexpected approved match count')
        members=[]
        for i,m in enumerate(matches):
            ref=literal(contract['required']['references'][i],lang);amount=contract['required']['amountMinor'][i]
            serial=str((date(2026,7,i+1)-date(1899,12,30)).days)
            require(value(m,'Supplier References')==value(m,'Ledger References')==ref and minor(m,'Supplier Amount')==minor(m,'Ledger Amount')==amount,'wrong sign/reference or debit/credit swapped')
            require(value(m,'Supplier Date')==value(m,'Ledger Date')==serial,'wrong transaction date')
            require(value(m,'Supplier Source Rows')==value(m,'Ledger Source Rows')=='1' and value(m,'Status')=='Matched' and value(m,'Match Decision')=='Auto' and value(m,'Rule')=='EXACT_REFERENCE_SIGNED_AMOUNT_UNIQUE_V2','wrong rule/status/membership')
            members.extend((side,f'{side}:0:{i+2}',ref,amount) for side in ['supplier','ledger'])
        evidence,_=book.rows('Match Evidence',{'Side','Source Row ID','Source Row','Primary Reference','Amount','Status','PDF Page'})
        matched=[r for r in evidence if value(r,'Status')=='Matched']
        require(len(matched)==6 and [(value(r,'Side'),value(r,'Source Row ID'),value(r,'Primary Reference'),minor(r,'Amount')) for r in matched]==members,'wrong exact match members')
        require(all(value(r,'PDF Page')=='' for r in evidence),'invented PDF provenance')
        unmatched=[r for r in evidence if value(r,'Status')=='Unmatched']
        require([(value(r,'Source Row ID'),minor(r,'Amount')) for r in unmatched]==[('ledger:0:5',8000),('ledger:0:6',-9000),('ledger:0:7',-5000)],'damaged movements silently matched/lost')
        issues,_=book.rows('Reading Issues',{'Side','Source Row','Original Values','Reason'})
        require(len(issues)==3 and [value(r,'Source Row') for r in issues]==['5','6','7'] and all(value(r,'Side')=='supplier' and value(r,'Reason') for r in issues),'unresolved source errors missing')
        expected=[[literal(v,lang) or '' for v in row] for row in contract['rows']]
        require([json.loads(value(r,'Original Values')) for r in issues]==expected[3:6],'original damaged cells changed or blank turned to zero')
        raw,_=book.rows('Parsed Supplier Source',{'صف المصدر',*[f'عمود {i}' for i in range(1,6)]})
        require([value(r,'صف المصدر') for r in raw]==list(map(str,range(1,9))),'source rows omitted/reordered')
        require([[value(r,f'عمود {i}') for i in range(1,6)] for r in raw]==[contract['headers'][lang],*expected],'literal source values rewritten')
        settings,_=book.rows('Run Settings',{'الحقل','القيمة'}); settings={value(r,'الحقل'):value(r,'القيمة') for r in settings}
        require(json.loads(settings['Scope'])['coverageConfirmed'] is False,'full balance inferred')
        mapping=json.loads(settings['Supplier mapping'])
        require([mapping[k] for k in ['mode','amount','debit','credit','multiplier','opening','closing','excluded']]==['split',-1,2,3,1,'','',{}],'bound split interpretation changed')
        metadata,_=book.rows('Export Metadata',{'Field','Value'});meta={value(r,'Field'):value(r,'Value') for r in metadata}
        require(meta['Engine version']=='0.3.26-experimental' and meta['Supplier SHA-256']==png.sha(text.encode()),'source/version lost')
        return {**truth,'matches':3,'matchedMembers':6,'damagedRows':3,'originalPng':True,'fullRecord':True,'fullBalanceReconciliation':False}
    finally:book.close()
if __name__=='__main__':print(json.dumps([{'workbook':f,**check(f)} for f in sys.argv[1:]],indent=2))
