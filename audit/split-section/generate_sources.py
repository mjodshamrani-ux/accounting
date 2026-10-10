"""Rebuild synthetic sources from public facts with the accepted preparatory PDF writer.

Only source PDFs are generated. Immutable financial oracle and expected CSV files
remain separately frozen. No PDF/product/checker library or product imports.
"""
from pathlib import Path
import hashlib,json,sys
ROOT=Path(__file__).resolve().parent

def pdf(recipe):
    # Derived from the approved generate.py and prepare_revision.py literal writer.
    xs=recipe['columns'];width=recipe['width']
    objects=[b'',b'',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];ids=[]
    for page in recipe['pages']:
        tokens=[]
        for ri,values in enumerate(page):
            for ci,s in enumerate(values):
                if not s:continue
                literal=s.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
                tokens.append(f'BT /F1 8 Tf 1 0 0 1 {xs[ci]} {760-ri*18} Tm ({literal}) Tj ET')
        raw='\n'.join(tokens).encode('ascii');pid=len(objects)+1;ids.append(pid)
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} 820] /Resources << /Font << /F1 3 0 R >> >> /Contents {pid+1} 0 R >>'.encode())
        objects.append(f'<< /Length {len(raw)} >>\nstream\n'.encode()+raw+b'\nendstream')
    objects[0]=b'<< /Type /Catalog /Pages 2 0 R >>';objects[1]=f'<< /Type /Pages /Kids [{" ".join(str(x)+" 0 R" for x in ids)}] /Count {len(ids)} >>'.encode()
    out=b'%PDF-1.4\n% '+recipe['banner'].encode('ascii')+b'\n';offsets=[]
    for i,o in enumerate(objects,1):offsets.append(len(out));out+=f'{i} 0 obj\n'.encode()+o+b'\nendobj\n'
    off=len(out);out+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()+b''.join(f'{x:010d} 00000 n \n'.encode() for x in offsets)+f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{off}\n%%EOF\n'.encode()
    return out

def main():
    if len(sys.argv)<2:raise SystemExit('Usage: generate_sources.py NEW_OUTPUT_DIRECTORY [NEW_REPORT_FILE]')
    dest=Path(sys.argv[1]);assert not dest.exists(),'Refuse to overwrite generated sources'
    assert not dest.resolve().is_relative_to((ROOT/'frozen').resolve()),'Never overwrite immutable input'
    facts_bytes=(ROOT/'SOURCE-FACTS.json').read_bytes();facts=json.loads(facts_bytes)
    dest.mkdir(parents=True);results=[]
    for recipe in facts['cases']:
        generated=pdf(recipe);original=(ROOT/'frozen'/recipe['id']/'source.pdf').read_bytes()
        digest=hashlib.sha256(generated).hexdigest()
        folder=dest/recipe['id'];folder.mkdir();(folder/'source.pdf').write_bytes(generated)
        results.append({'id':recipe['id'],'sourceBytes':len(generated),'sourceSha256':digest,'expectedSourceSha256':recipe['sourceSha256'],'exactCanonicalByteMatch':generated==original,'recipeIntegrity':digest==recipe['sourceSha256'] and len(generated)==recipe['sourceBytes']})
    report={'cases':len(results),'passedCases':sum(r['exactCanonicalByteMatch'] and r['recipeIntegrity'] for r in results),'productImports':False,'factsSha256':hashlib.sha256(facts_bytes).hexdigest(),'generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'regenerates':'Source PDF bytes only; financial expectations remain independently frozen','results':results}
    if len(sys.argv)>2:
        p=Path(sys.argv[2]);assert not p.exists(),'Refuse report overwrite';p.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='results'}))
    raise SystemExit(0 if report['passedCases']==55 else 1)
if __name__=='__main__':main()
