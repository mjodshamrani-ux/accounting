"""Independent frozen split-image truth. Receipts are binding, not OCR truth.
No application imports; exact source pixels and manually defined literals.
"""
import importlib.util
import json
import re
import sys
from datetime import datetime
from functools import lru_cache
from pathlib import Path
ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location('split_png_oracle', ROOT.parent/'visual-cell-review/check_record.py')
png = importlib.util.module_from_spec(spec); spec.loader.exec_module(png)
pixels = lru_cache(maxsize=4)(png.pixels)
def literal(v, lang):
    if v is None: return None
    return v.replace('Total','الإجمالي').replace('.', '٫').translate(str.maketrans('0123456789','٠١٢٣٤٥٦٧٨٩')) if lang == 'ar' else v
def stamp(v):
    assert isinstance(v,str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z',v)
    datetime.strptime(v,'%Y-%m-%dT%H:%M:%S.%fZ')
def check(p, original):
    contract=json.loads((ROOT/'contract.json').read_text()); manifests=json.loads((ROOT/'fixtures/manifest.json').read_text())
    lang=next(lang for lang,m in manifests.items() if m['sha256']==png.sha(original)); manifest=manifests[lang]
    assert len(original)==manifest['bytes']
    assert set(p)=={'kind','version','basis','table','headers','currencyProof','context','review'}
    assert (p['kind'],p['version'],p['basis'])==('reviewed-visual-source',2,'human-reviewed-transactions')
    assert p['context']==contract['context'] and p['headers']==['region:%d'%i for i in range(1,6)] and p['currencyProof']=='region:6'
    t=p['table']; im=t['image']; source=im['source']; draft=im['draft']; page=draft['pages'][0]
    assert set(t)=={'kind','version','status','image','revision','grid','rows','coverage'}
    assert (t['kind'],t['version'],t['status'])==('visual-table',2,'table-evidence-only')
    assert set(im)=={'kind','version','status','source','draft','pixelSha256','revision','cells','regions'}
    assert (im['kind'],im['version'],im['status'],im['cells'])==('visual-review',2,'cell-evidence-only',[])
    assert set(source)=={'name','sha256','originalPng'} and png.png_bytes(source['originalPng'])==original and source['sha256']==png.sha(original)
    assert draft['source']=={'name':source['name'],'sha256':source['sha256']}
    assert set(draft)=={'kind','version','status','source','engine','pageCount','pages'}
    assert (draft['kind'],draft['version'],draft['status'],draft['pageCount'],len(draft['pages']))==('visual-draft',1,'unverified',1,1)
    assert draft['engine']==png.ENGINE and set(page)=={'page','width','height','imageDataUrl','words'} and page['page']==1
    assert pixels(original)==pixels(png.png_bytes(page['imageDataUrl']))==(1400,860,im['pixelSha256'])
    raw=(ROOT/f'fixtures/{lang}-ocr.json').read_bytes(); assert png.sha(raw)==manifest['rawOCRSHA256']
    words=[]
    for block in json.loads(raw):
        for paragraph in block['paragraphs']:
            for line in paragraph['lines']:
                for w in line['words']:
                    b=w['bbox']; words.append({'id':'p1:w%d:%s,%s,%s,%s'%(len(words)+1,b['x0'],b['y0'],b['x1'],b['y1']),'text':w['text'],'confidence':w['confidence'],'bbox':b})
    assert page['words']==words, 'raw OCR observations rewritten'
    assert im['revision']==png.fingerprint(['tarasuf-visual-review-v1',source['sha256'],im['pixelSha256'],draft['engine'],words])
    grid={**contract['grid'],'roles':contract['roles']}; assert t['grid']==grid
    expected=[]; cells=[]
    for i,v in enumerate(contract['headers'][lang]): expected.append(('reference',v,{'x0':grid['columnCuts'][i]+8,'x1':grid['columnCuts'][i+1]-8,'y0':165,'y1':210}))
    expected.append(('currency','SAR',contract['currencyRegion']))
    for i,row in enumerate(contract['rows']):
        ids=[]
        for col,v in enumerate(row):
            v=literal(v,lang)
            if v in ('',None):ids.append(None);continue
            expected.append((contract['roles'][col] if col<2 else 'amount',v,{'x0':grid['columnCuts'][col]+8,'x1':grid['columnCuts'][col+1]-8,'y0':grid['rowCuts'][i]+8,'y1':grid['rowCuts'][i+1]-8}))
            ids.append('region:%d'%len(expected))
        cells.append(ids)
    assert len(im['regions'])==len(expected)==39
    for i,(r,(role,v,box)) in enumerate(zip(im['regions'],expected)):
        assert set(r)=={'id','origin','role','observed','value','region','review'}
        assert r['id']=='region:%d'%(i+1) and r['origin']=='manual-crop' and (r['role'],r['value'],r['region'])==(role,v,box)
        observed=[]
        for w in words:
            b=w['bbox']
            if b['x0']<box['x1'] and b['x1']>box['x0'] and b['y0']<box['y1'] and b['y1']>box['y0']:
                observed.append({'wordId':w['id'],'text':w['text'],'complete':b['x0']>=box['x0'] and b['x1']<=box['x1'] and b['y0']>=box['y0'] and b['y1']<=box['y1']})
        assert r['observed']==observed
        proof=r['review']; assert set(proof)=={'revision','fingerprint','checkedAt'} and proof['revision']==im['revision'];stamp(proof['checkedAt'])
        assert proof['fingerprint']==png.fingerprint(['tarasuf-visual-region-v1',im['revision'],r['id'],'manual-crop',role,observed,v,box])
    assert t['revision']==png.fingerprint(['tarasuf-visual-table-v2',im,grid]) and len(t['rows'])==7
    for i,row in enumerate(t['rows']):
        assert set(row)=={'id','disposition','note','cells','review'} and row['id']=='row:%d'%(i+1) and row['cells']==cells[i]
        assert row['disposition']==('non-movement' if i==6 else 'movement') and row['note']==('Printed total row, retained for audit' if i==6 else '')
        if i!=6:assert row['review'] is None
        else:
            proof=row['review'];assert set(proof)=={'fingerprint','checkedAt'};stamp(proof['checkedAt'])
            assert proof['fingerprint']==png.fingerprint(['tarasuf-table-exclusion-v2',t['revision'],row['id'],row['disposition'],row['note'],row['cells']])
    proof=t['coverage'];assert set(proof)=={'fingerprint','checkedAt'};stamp(proof['checkedAt'])
    assert proof['fingerprint']==png.fingerprint(['tarasuf-table-coverage-v2',t['revision'],t['rows']])
    proof=p['review'];assert set(proof)=={'fingerprint','checkedAt'};stamp(proof['checkedAt'])
    assert proof['fingerprint']==png.fingerprint(['tarasuf-reviewed-visual-source-v2',t,p['headers'],p['currencyProof'],p['context']])
    return {'passed':True,'language':lang,'sourceRows':7,'manualCrops':39,'rowDecisions':7,'unreadableAmountCells':1,'automaticOCR':False,'training':False,'humanElapsedTimeMeasured':False}
if __name__=='__main__':print(json.dumps(check(json.loads(Path(sys.argv[1]).read_text()),Path(sys.argv[2]).read_bytes())))
