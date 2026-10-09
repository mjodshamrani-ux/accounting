"""Independent pre-engine PDF/CSV derivation contract; expected rows specified manually.
Amounts computed with Python Decimal, never product imports or product output.
"""
from pathlib import Path
from decimal import Decimal
import csv, io, json, hashlib
root=Path(__file__).parent/'frozen'
if (root/'freeze.json').exists():
    raise SystemExit('Existing frozen evidence is immutable; use a new version directory.')
H=['Date','Reference','Description','Amount']
P=lambda ref:['','','Invoice: '+ref,'']
C=lambda ref:['','','Continued invoice: '+ref,'']
M=lambda description='line',reference='',amount='-12.50':['2026-10-01',reference,description,amount]
cases=[
 ('section-signed',[[H,P('INV-1'),M('line, "one"'),M('second',amount='+2.50')]], [3,4], ['INV-1','INV-1'], 'derived'),
 ('cross-page',[[H,P('INV-1'),M()],[H,C('INV-1'),M('continued',amount='+2.50')]], [3,6], ['INV-1','INV-1'], 'derived'),
 ('explicit-native-reference',[[H,M(reference='OWN-1'),P('INV-1'),M()]], [2,4], ['OWN-1','INV-1'], 'derived'),
 ('missing-parent',[[H,M()]], [], [], 'blocked'),
 ('unknown-boundary',[[H,P('INV-1'),M(),['','','Section: unknown',''],M()]], [], [], 'blocked'),
 ('late-corrupt-amount',[[H,P('INV-1'),M(),M(amount='BROKEN')]], [], [], 'blocked'),
 ('competing-reference',[[H,P('INV-1'),M(),M(reference='OTHER-1')]], [], [], 'blocked'),
 ('duplicate-parent',[[H,P('INV-1'),M(),P('INV-1'),M()]], [], [], 'blocked'),
 ('page-gap',[[H,P('INV-1'),M()],[],[H,C('INV-1'),M()]], [], [], 'blocked'),
 ('unselected-movement',[[H,P('INV-1'),M(),M('second')]], [], [], 'blocked'),
]
def pdf(pages):
    objects=['<< /Type /Catalog /Pages 2 0 R >>','','<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>']; children=[]
    for page in pages:
        number=len(objects)+1; children.append(number)
        commands=[]
        for i,row in enumerate(page):
            for col,text in enumerate(row):
                escaped=text.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
                commands.append(f'BT /F1 5 Tf 1 0 0 1 {[40,170,300,420][col]} {750-i*20} Tm ({escaped}) Tj ET')
        stream='\n'.join(commands)+'\n'
        objects.extend([f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents {number+1} 0 R >>',f'<< /Length {len(stream)} >>\nstream\n{stream}endstream'])
    objects[1]=f'<< /Type /Pages /Kids [{" ".join(str(n)+" 0 R" for n in children)}] /Count {len(children)} >>'
    result='%PDF-1.7\n'; offsets=[]
    for i,obj in enumerate(objects): offsets.append(len(result)); result+=f'{i+1} 0 obj\n{obj}\nendobj\n'
    start=len(result); result+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'+''.join(f'{offset:010} 00000 n \n' for offset in offsets)+f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'
    return result.encode('ascii')
manifest=[]
for name,pages,links,refs,outcome in cases:
    original=pdf(pages); (root/(name+'.pdf')).write_bytes(original)
    rows=[row for page in pages for row in page]
    inventory=[]; rn=0
    for page,rs in enumerate(pages):
        for row in rs: rn+=1; inventory.append({'row':rn,'page':page+1,'values':row})
    expected={'outcome':outcome,'originalSha256':hashlib.sha256(original).hexdigest(),'inventory':inventory,'links':links,'references':refs}
    if outcome=='derived':
        derived=[H]+[[rows[rn-1][0],ref,rows[rn-1][2],rows[rn-1][3]] for rn,ref in zip(links,refs)]
        buf=io.StringIO(newline=''); csv.writer(buf,lineterminator='\r\n').writerows(derived); blob=buf.getvalue().encode('utf-8')
        (root/(name+'.csv')).write_bytes(blob)
        expected.update({'csvSha256':hashlib.sha256(blob).hexdigest(),'csvRows':derived,'amountMinor':[int(Decimal(row[3])*100) for row in derived[1:]]})
    (root/(name+'.expected.json')).write_text(json.dumps(expected,indent=2)+'\n')
    manifest.append({'id':name,'original':name+'.pdf','expected':name+'.expected.json','outcome':outcome})
(root/'contract.json').write_text(json.dumps({'version':'P4_SECTION_DERIVED_V1','synthetic':True,'cases':manifest},indent=2)+'\n')
files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.iterdir()) if p.name!='freeze.json'}
(root/'freeze.json').write_text(json.dumps({'authorship':'Independent manually authored PDF/CSV truth tables frozen before TypeScript engine; no product imports.','arithmetic':'Python decimal.Decimal signed minor units','files':files},indent=2)+'\n')
print('Frozen',len(cases),'cases;',len(files),'original/expected/CSV/contract files')
