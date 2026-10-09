"""Independent RAW two-row signed-header PDF/CSV truths before engine work.

No product imports, joining, reader outputs or financial approval. Every row
and physical cell belongs to a literal manually authored original PDF.
"""
from pathlib import Path
from decimal import Decimal
import csv
import hashlib
import io
import json

ROOT = Path(__file__).parent / 'frozen'
if (ROOT / 'freeze.json').exists():
    raise SystemExit('Existing freeze is immutable; use a new version.')
ROOT.mkdir(parents=True, exist_ok=True)
S = ['Date', 'Reference', 'Description', 'Signed']
L = ['', '', '', 'amount']
G = ['Date', 'Reference', 'Description', 'Movement']
J = ['', '', '', 'Signed amount']
P = lambda ref='INV-271': ['Invoice No', ref, '', '']
C = lambda ref='INV-271': ['Continued invoice', ref, '', '']
M = lambda desc='first line', ref='', amount='-12.50', date='2026-10-01': [date, ref, desc, amount]
# Accepted tuple: movement, parent, continuation rows, full band start rows.
CASES = [
    ('split-signed', [[S,L,P(),M('line, "one"'),M('second',amount='+2.50')]], [(4,3,[],[1]),(5,3,[],[1])], 'derived'),
    ('movement-signed', [[G,J,P(),M()]], [(4,3,[],[1])], 'derived'),
    ('split-cross-page', [[S,L,P(),M()],[S,L,C(),M('second',amount='+2.50')]], [(4,3,[],[1]),(8,3,[7],[1,5])], 'derived'),
    ('movement-cross-page', [[G,J,P(),M()],[G,J,C(),M('second',amount='+2.50')]], [(4,3,[],[1]),(8,3,[7],[1,5])], 'derived'),
    ('own-reference', [[S,L,P(),M(ref='INV-271'),M('second',amount='+2.50')]], [(5,3,[],[1])], 'derived'),
    ('leading-zero-reference', [[S,L,P('000271'),M()]], [(4,3,[],[1])], 'derived'),
    ('single-cell-parent', [[S,L,['','','Invoice: INV-271',''],M()]], [(4,3,[],[1])], 'derived'),
    ('new-section', [[G,J,P(),M(),P('INV-272'),M('second',amount='+2.50')]], [(4,3,[],[1]),(6,5,[],[1])], 'derived'),
    ('missing-lower-header', [[S,P(),M()]], [], 'blocked'),
    ('changed-lower-header', [[S,['','','','balance'],P(),M()]], [], 'blocked'),
    ('lower-extra-context', [[S,['','USD','','amount'],P(),M()]], [], 'blocked'),
    ('upper-currency-context', [[['Date','Reference','Description','Signed USD'],L,P(),M()]], [], 'blocked'),
    ('split-debit-credit', [[['Date','Reference','Description','Movement'],['','','Debit','Credit'],P(),M()]], [], 'blocked'),
    ('unknown-upper-label', [[['Date','Reference','Description','Settlement'],J,P(),M()]], [], 'blocked'),
    ('mixed-band-labels', [[S,J,P(),M()]], [], 'blocked'),
    ('intervening-header-row', [[S,['','','unknown',''],L,P(),M()]], [], 'blocked'),
    ('reversed-band', [[L,S,P(),M()]], [], 'blocked'),
    ('split-initial-page', [[S],[L,P(),M()]], [], 'blocked'),
    ('missing-page-lower', [[S,L,P(),M()],[S,C(),M()]], [], 'blocked'),
    ('changed-page-lower', [[S,L,P(),M()],[S,['','','','Amount'],C(),M()]], [], 'blocked'),
    ('changed-page-upper', [[S,L,P(),M()],[G,L,C(),M()]], [], 'blocked'),
    ('split-repeated-pages', [[S,L,P(),M()],[S],[L,C(),M()]], [], 'blocked'),
    ('same-page-repeat', [[S,L,P(),M(),S,L,C(),M()]], [], 'blocked'),
    ('missing-date', [[S,L,P(),M(),M('second',date='')]], [], 'blocked'),
    ('late-corrupt-amount', [[S,L,P(),M(),M('second',amount='BROKEN')]], [], 'blocked'),
    ('five-columns', [[S+['Currency'],L+['USD'],P()+[''],M()+['']]], [], 'blocked'),
]

def pdf(pages, step=20):
    objects=['<< /Type /Catalog /Pages 2 0 R >>','','<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>']
    children=[]
    for page in pages:
        number=len(objects)+1
        children.append(number)
        commands=[]
        for index,row in enumerate(page):
            for column,text in enumerate(row):
                escaped=text.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
                commands.append(f'BT /F1 5 Tf 1 0 0 1 {[40,170,300,420,530][column]} {750-index*step} Tm ({escaped}) Tj ET')
        stream='\n'.join(commands)+'\n'
        objects.extend([f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents {number+1} 0 R >>',f'<< /Length {len(stream)} >>\nstream\n{stream}endstream'])
    objects[1]=f'<< /Type /Pages /Kids [{" ".join(str(n)+" 0 R" for n in children)}] /Count {len(children)} >>'
    result='%PDF-1.7\n'; offsets=[]
    for index,obj in enumerate(objects):
        offsets.append(len(result)); result+=f'{index+1} 0 obj\n{obj}\nendobj\n'
    start=len(result)
    result+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'+''.join(f'{offset:010} 00000 n \n' for offset in offsets)+f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'
    return result.encode('ascii')

def write(name,value):
    (ROOT/name).write_text(json.dumps(value,ensure_ascii=True,indent=2)+'\n')

def inventory(pages):
    result=[]
    for page,rows in enumerate(pages,1):
        for values in rows: result.append({'row':len(result)+1,'page':page,'values':values})
    return result

def cells(rows,row,all_cells=False):
    item=rows[row-1]
    return [{'row':row,'page':item['page'],'column':i+1,'literal':literal} for i,literal in enumerate(item['values']) if all_cells or literal]

manifest=[]
for name,pages,accepted,outcome in CASES:
    original=pdf(pages); rows=inventory(pages)
    (ROOT/(name+'.pdf')).write_bytes(original)
    write(name+'.input.json',{'pages':pages,'synthetic':True,'rawHeaderRowsPreserved':True})
    expected={'outcome':outcome,'originalSha256':hashlib.sha256(original).hexdigest(),'originalByteLength':len(original),'inventory':rows,'proposals':[],'links':[]}
    if outcome=='derived':
        for target,parent,continuations,bands in accepted:
            expected['proposals'].append({'targetRow':target,'reference':rows[parent-1]['values'][1] or 'INV-271','parentCells':cells(rows,parent),'continuationCells':[cells(rows,r) for r in continuations],'headerBands':[[*cells(rows,r,True),*cells(rows,r+1,True)] for r in bands]})
        selected={target:(parent,cont,bands) for target,parent,cont,bands in accepted}
        derived=[['Date','Reference','Description','Amount']]
        for row in rows:
            if not row['values'][0].startswith('2026-'): continue
            index=row['row']; values=row['values']; own=bool(values[1]); parent=selected[index][0] if not own else None
            ref=values[1] if own else rows[parent-1]['values'][1] or 'INV-271'
            derived.append([values[0],ref,values[2],values[3]])
            expected['links'].append({'originalRow':index,'page':row['page'],'derivedRow':len(derived),'reference':ref,'referenceOrigin':'explicit-original-cell' if own else 'accepted-section-proposal'})
        buffer=io.StringIO(newline=''); csv.writer(buffer,lineterminator='\r\n').writerows(derived)
        blob=buffer.getvalue().encode('utf-8'); (ROOT/(name+'.csv')).write_bytes(blob)
        expected.update({'csvSha256':hashlib.sha256(blob).hexdigest(),'csvRows':derived,'signedAmounts':[row[3] for row in derived[1:]],'amountMinor':[int(Decimal(row[3])*100) for row in derived[1:]]})
    write(name+'.expected.json',expected)
    manifest.append({'id':name,'original':name+'.pdf','expected':name+'.expected.json','outcome':outcome,'cuts':[25,45,69,85] if name=='five-columns' else [25,45,69]})

resource_pages=[[S,L,P() if p==0 else C()]+[M('resource',amount='+2.50') for _ in range(30)] for p in range(9)]
resource=pdf(resource_pages,step=15)
(ROOT/'resource-cancellation.pdf').write_bytes(resource)
write('resource-cancellation.input.json',{'pages':resource_pages,'synthetic':True})
write('resource-cancellation.expected.json',{'originalSha256':hashlib.sha256(resource).hexdigest(),'inventory':inventory(resource_pages),'pages':9,'rows':297,'movementRows':270,'totalMinor':67500})
actions=[{'id':name,'source':source,'expected':expected} for name,source,expected in [
    ('pre-abort','split-signed.pdf','cancelled-before-clone'),('page-one-abort','split-cross-page.pdf','cancelled-no-partial-publication'),('row-256-abort','resource-cancellation.pdf','cancelled-no-partial-publication'),
    ('pending-source-change','split-cross-page.pdf','stale-no-partial-publication'),('pending-reviewer-clear','split-cross-page.pdf','stale-no-partial-publication'),
    ('upper-cell-tamper','split-signed.pdf','original-replay-blocked'),('lower-cell-tamper','split-signed.pdf','original-replay-blocked'),('lower-page-tamper','split-cross-page.pdf','original-replay-blocked'),
    ('original-byte-tamper','split-signed.pdf','original-replay-blocked'),('signed-amount-tamper','split-signed.pdf','original-replay-blocked'),
    ('stale-mapping','split-signed.pdf','stale-receipt-blocked'),('stale-revision','split-signed.pdf','stale-receipt-blocked'),('stale-decimals','split-signed.pdf','stale-receipt-blocked'),
    ('band-span-tamper','split-cross-page.pdf','fresh-review-comparison-blocked'),('receipt-clone','split-signed.pdf','counterfeit-receipt-blocked'),
    ('cuts-before-clone','split-signed.pdf','resource-blocked-before-clone'),('reviewer-before-clone','split-signed.pdf','resource-blocked-before-clone')]]
actions.extend([{'id':'budget-'+name,'source':'split-cross-page.pdf','budget':{name:1},'expected':'resource-blocked-no-partial-publication'} for name in ['maxOriginalBytes','maxPages','maxRows','maxProposals','maxEvidenceCells']])
actions.append({'id':'unselected-movement','source':'split-signed.pdf','selectedMovementRows':[4],'expected':'unresolved-movement-blocked'})
write('actions.json',{'actions':actions,'failureAuthority':'No partial publication or usable derivation/financial authority. Legacy explicit interpretation receipt on a blocked structural review may exist; refused Apply consumes it with no CSV.'})
write('contract.json',{'version':'P4_RAW_SIGNED_HEADER_V2','synthetic':True,'nativeHeaderBandChange':False,'glyphGeometryClaim':False,'rawHeaderRowsPreserved':True,'allowedBands':[[S,L],[G,J]],'exactLiteralBands':True,'samePageContiguousRequired':True,'newColumnCount':4,'canonicalDerivedCsvHeader':['Date','Reference','Description','Amount'],'mapping':{'sheet':0,'header':0,'date':0,'reference':1,'description':2,'amount':3,'mode':'signed','multiplier':1,'numberFormat':'dot','dateFormat':'ymd','pdfReviewed':True},'cuts':[25,45,69],'revision':'p4-raw-signed-header-independent-v2','decimals':2,'defaultBudgets':{'maxOriginalBytes':8388608,'maxPages':100,'maxRows':20000,'maxProposals':4096,'maxEvidenceCells':65536},'rowYieldInterval':256,'cases':manifest,'actions':'actions.json','resourceSource':'resource-cancellation.pdf','headerBandsEvidence':'All eight literal cells per band, including blanks, from original rows; initial plus every proved carry band. Additive only on this family; legacy header evidence shapes unchanged.'})
files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.iterdir()) if p.name!='freeze.json'}
write('freeze.json',{'authorship':'Independent literal PDF operator geometry, manual complete row membership/citations, exact Python CSV and Decimal money before product header-family code. No product imports or outputs.','generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'files':files})
print('Frozen',len(CASES),'PDF truths,',len(actions),'actions,',len(files),'payloads')
