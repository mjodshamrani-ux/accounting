"""Independent synthetic truth tables, authored before the TypeScript implementation.
No imports from product code. Expected row decisions are literal author judgments.
"""
from pathlib import Path
import json, hashlib
root = Path(__file__).parent / 'frozen'
H = ['Date', 'Reference', 'Description', 'Amount']
P = lambda ref: ['', '', 'Invoice: ' + ref, '']
C = lambda ref: ['', '', 'Continued invoice: ' + ref, '']
M = lambda desc='line', ref='', amount='-12.50': ['2026-10-01', ref, desc, amount]
cases = [
 ('en-section', [H,P('INV-1'),M(),M(amount='+2.50')], [1]*4, {3:'INV-1',4:'INV-1'}, []),
 ('ar-section', [H,['','','فاتورة: AR-1',''],M('سطر مستقل',amount='−١٢٫٥٠')], [1]*3, {3:'AR-1'}, []),
 ('explicit-continuation', [H,P('INV-1'),M(),H,C('INV-1'),M()], [1,1,1,2,2,2], {3:'INV-1',6:'INV-1'}, []),
 ('no-marker', [H,P('INV-1'),M(),H,M()], [1,1,1,2,2], {3:'INV-1'}, ['unproven-page-boundary','missing-parent']),
 ('page-gap', [H,P('INV-1'),M(),H,C('INV-1'),M()], [1,1,1,3,3,3], {3:'INV-1'}, ['page-gap','missing-parent']),
 ('unknown-section', [H,P('INV-1'),M(),['','','Section: expenses',''],M()], [1]*5, {3:'INV-1'}, ['unknown-boundary','missing-parent']),
 ('duplicate-parent', [H,P('INV-1'),M(),P('INV-1'),M()], [1]*5, {}, ['duplicate-parent']),
 ('competing-row-reference', [H,P('INV-1'),M(),M(ref='OTHER-1')], [1]*4, {}, ['competing-reference']),
 ('new-section', [H,P('INV-1'),M(),P('INV-2'),M()], [1]*5, {3:'INV-1',5:'INV-2'}, []),
 ('late-corrupt-amount', [H,P('INV-1'),M(),M(amount='BROKEN')], [1]*4, {}, ['corrupt-row']),
 ('no-header-carry', [H,P('INV-1'),M(),C('INV-1'),M()], [1,1,1,2,2], {3:'INV-1'}, ['unproven-page-boundary','missing-parent']),
 ('changed-header', [H,P('INV-1'),M(),['Date','Reference','Description','Balance'],C('INV-1'),M()], [1,1,1,2,2,2], {3:'INV-1'}, ['unproven-page-boundary','unknown-boundary','missing-parent']),
 ('competing-continuation', [H,P('INV-1'),M(),H,C('INV-2'),M()], [1,1,1,2,2,2], {3:'INV-1'}, ['unproven-page-boundary','missing-parent']),
 ('bidi-parent-rejected', [H,['','','Invoice: INV-\u202e1',''],M()], [1]*3, {}, ['unknown-boundary','missing-parent']),
 ('fringe-rtl-spans', [H,['','','فاتورة: AR-2',''],M('\u200fتفاصيل (مرجع آخر: X-9)\u200e',amount='(١٢٫٥٠)')], [1]*3, {3:'AR-2'}, []),
 ('competing-parent-cells', [H,['Invoice: INV-1','','Invoice: INV-2',''],M()], [1]*3, {}, ['unknown-boundary','missing-parent']),
 ('explicit-own-reference', [H,P('INV-1'),M(ref='INV-1'),M()], [1]*4, {4:'INV-1'}, []),
 ('pre-parent-movement', [H,M(),P('INV-1'),M()], [1]*4, {4:'INV-1'}, ['missing-parent']),
]
manifest=[]
for name,rows,pages,proposals,codes in cases:
    source={'rows':rows,'rowPages':{str(i+1):page for i,page in enumerate(pages)},'pages':max(pages)}
    blob=(json.dumps(source,ensure_ascii=False,indent=2)+'\n').encode()
    (root/(name+'.source.json')).write_bytes(blob)
    expected={'proposals':proposals,'questionCodes':sorted(codes),'rowCount':len(rows),'sourceHash':hashlib.sha256(blob).hexdigest(),'extractionRevision':'synthetic-native-text-v1','signedAmounts':{str(i+1):r[3] for i,r in enumerate(rows) if r[3] and r!=H and r[3]!='Balance'}}
    (root/(name+'.expected.json')).write_text(json.dumps(expected,ensure_ascii=False,indent=2)+'\n')
    manifest.append({'id':name,'source':name+'.source.json','expected':name+'.expected.json'})
(root/'contract.json').write_text(json.dumps({'version':'P4_SECTION_CONTINUATION_V1','synthetic':True,'cases':manifest},indent=2)+'\n')
files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.iterdir()) if p.name!='freeze.json'}
(root/'freeze.json').write_text(json.dumps({'authorship':'Manually specified Python truth tables before TypeScript engine; no product imports or output-derived expectations.','files':files},indent=2)+'\n')
print('Frozen',len(cases),'independently specified cases,',len(files),'files')
# Physical native-PDF fixtures are separately authored without the product PDF writer.
def native_pdf(pages):
    objs=['<< /Type /Catalog /Pages 2 0 R >>','','<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>']; kids=[]
    for rows in pages:
        ident=len(objs)+1; kids.append(ident)
        stream='\n'.join(f'BT /F1 5 Tf 1 0 0 1 {[40,170,300,420][j]} {750-i*20} Tm ({text.replace(chr(92),chr(92)*2).replace("(",chr(92)+"(").replace(")",chr(92)+")")}) Tj ET' for i,row in enumerate(rows) for j,text in enumerate(row))+'\n'
        objs.extend([f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents {ident+1} 0 R >>', f'<< /Length {len(stream)} >>\nstream\n{stream}endstream'])
    objs[1]=f'<< /Type /Pages /Kids [{" ".join(str(k)+" 0 R" for k in kids)}] /Count {len(kids)} >>'
    out='%PDF-1.7\n'; offsets=[0]
    for i,obj in enumerate(objs): offsets.append(len(out)); out+=f'{i+1} 0 obj\n{obj}\nendobj\n'
    xref=len(out); out+=f'xref\n0 {len(objs)+1}\n0000000000 65535 f \n'+''.join(f'{n:010} 00000 n \n' for n in offsets[1:])+f'trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'
    return out.encode('ascii')
for name in ['en-section','explicit-continuation','late-corrupt-amount']:
    case=next(c for c in cases if c[0]==name); pages=[[] for _ in range(max(case[2]))]
    for row,page in zip(case[1],case[2]): pages[page-1].append(row)
    (root/(name+'.pdf')).write_bytes(native_pdf(pages))
files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.iterdir()) if p.name!='freeze.json'}
(root/'freeze.json').write_text(json.dumps({'authorship':'Manually specified Python truth tables and physical PDF originals before TypeScript engine; no product imports or output-derived expectations.','files':files},indent=2)+'\n')
