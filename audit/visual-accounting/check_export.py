"""Independent known-image Excel oracle. Standard-library OOXML; no product imports."""
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
            'Summary':{'B28':'COUNTIF(\'Matches\'!Q2:Q2,"Auto")','B29':"SUM('Matches'!O2:P2)",'B30':'COUNTIF(\'Needs Review\'!M2:M2,"Needs Review")','B31':'SUMIF(\'Needs Review\'!M2:M2,"Needs Review",\'Needs Review\'!N2:N2)+SUMIF(\'Needs Review\'!M2:M2,"Needs Review",\'Needs Review\'!O2:O2)','B32':"COUNTA('Unmatched'!A2:A2)",'B33':"SUM('Unmatched'!K2:K2)",'B34':'COUNTIF(\'Matches\'!Q2:Q2,"Manual")','B35':'COUNTIF(\'Needs Review\'!M2:M2,"Rejected")','B36':"'Reconciliation Bridge'!E4"},
            'Reconciliation Bridge':{'E4':'SUM(E2:E2)'}}
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
        matches,_=book.rows('Matches',{'Supplier References','Ledger References','Supplier Amount','Ledger Amount','Supplier Source Rows','Ledger Source Rows','Rule','Status','Match Decision','Supplier Date','Ledger Date'})
        require(len(matches)==1,'unexpected approved matches')
        m=matches[0]
        require(value(m,'Supplier Date')==value(m,'Ledger Date')=='46204','movement date changed')
        require(value(m,'Supplier References')==value(m,'Ledger References')=='INV-001' and minor(m,'Supplier Amount')==minor(m,'Ledger Amount')==-25000,'wrong signed movement')
        require(value(m,'Supplier Source Rows')==value(m,'Ledger Source Rows')=='1' and value(m,'Status')=='Matched' and value(m,'Match Decision')=='Auto','membership/status changed')
        evidence,_=book.rows('Match Evidence',{'Side','Source Row ID','Source Row','Primary Reference','Amount','Status','PDF Page'})
        matched=[r for r in evidence if value(r,'Status')=='Matched']
        require({value(r,'Source Row ID') for r in matched}=={'supplier:0:2','ledger:0:2'} and len(matched)==2,'incorrect membership')
        require(all(minor(r,'Amount')==-25000 and value(r,'Primary Reference')=='INV-001' and value(r,'PDF Page')=='' for r in matched),'amount/reference or fake PDF provenance')
        unmatched=[r for r in evidence if value(r,'Source Row ID')=='ledger:0:3']
        require(len(unmatched)==1 and value(unmatched[0],'Status')=='Unmatched' and minor(unmatched[0],'Amount')==8000,'unresolved ledger movement lost')
        issues,_=book.rows('Reading Issues',{'Side','Source Row','Original Values','Reason'})
        require(len(issues)==1 and value(issues[0],'Side')=='supplier' and value(issues[0],'Source Row')=='3','damaged row omitted')
        require(json.loads(value(issues[0],'Original Values'))==['INV-002','2026-07-02','',''] and value(issues[0],'Reason'),'damaged identity erased or amount invented')
        raw,_=book.rows('Parsed Supplier Source',{'صف المصدر',*[f'عمود {i}' for i in range(1,5)]})
        expected=[['Reference','Date','Movement','Balance'],['INV-001','2026-07-01','-٢٥٠٫٠٠','٩٬٩٩٩٫٠٠'],['INV-002','2026-07-02','',''],['Closing total','','','']]
        require([[value(r,f'عمود {i}') for i in range(1,5)] for r in raw]==expected,'literal source cells lost/rewritten')
        settings,_=book.rows('Run Settings',{'الحقل','القيمة'})
        values={value(r,'الحقل'):value(r,'القيمة') for r in settings}
        require(json.loads(values['Scope'])['coverageConfirmed'] is False,'full balance inferred')
        mapping=json.loads(values['Supplier mapping'])
        require(mapping['amount']==2 and mapping['multiplier']==1 and mapping['excluded']=={} and mapping['opening']==mapping['closing']=='','bound reading changed')
        metadata,_=book.rows('Export Metadata',{'Field','Value'})
        meta={value(r,'Field'):value(r,'Value') for r in metadata}
        require(meta['Engine version']=='0.3.26-experimental' and meta['Supplier SHA-256']==png.sha(text.encode()),'source/version lost')
        return {'verified':True,'matches':1,'damagedRows':1,'originalPng':True,'fullRecord':True,'fullBalanceReconciliation':False}
    finally:book.close()
if __name__=='__main__':
    print(json.dumps([{'workbook':f,**check(f)} for f in sys.argv[1:]],indent=2))
