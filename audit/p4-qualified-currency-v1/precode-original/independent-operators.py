"""Read only independently frozen bytes: no product/generator/checker imports."""
from pathlib import Path
import re, json, hashlib, csv, io
from decimal import Decimal

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent/'next-contracts/p4-qualified-currency-v1'
F=ROOT/'frozen'
policy={'SAR':2,'JPY':0,'KWD':3}
digest=lambda b:hashlib.sha256(b).hexdigest()
load=lambda p:json.loads(p.read_text())
freeze=load(F/'freeze.json')
assert digest((F/'freeze.json').read_bytes())=='1b9612a623e3055fe6fa369eb4b7b175da67ab04e07f0895e42b112fb251c7c4'
for name,pin in freeze['files'].items():
    raw=(F/name).read_bytes()
    assert {'bytes':len(raw),'sha256':digest(raw)}==pin, name
manifest=load(ROOT/'MANIFEST.json')
for pin in manifest['files']:
    raw=(ROOT/pin['path']).read_bytes()
    assert len(raw)==pin['bytes'] and digest(raw)==pin['sha256'],pin['path']
contract=load(F/'contract.json')
assert contract['precisionPolicy']==policy
assert contract['exactAmountHeaders']==['Signed amount ('+code+')' for code in policy]
assert len(contract['cases'])==27

def unescape(value):
    result='';i=0
    while i<len(value):
        if value[i]=='\\':
            i+=1
            assert i<len(value) and value[i] in '()\\', 'unsupported synthetic escape'
        result+=value[i];i+=1
    return result

results=[]
for case in contract['cases']:
    e=load(F/case['expected']);raw=(F/case['original']).read_bytes()
    assert len(raw)==e['originalByteLength'] and digest(raw)==e['originalSha256']
    text=raw.decode('ascii')
    objects={int(m[1]):m[2] for m in re.finditer(r'(\d+) 0 obj\n(.*?)\nendobj\n',text,re.S)}
    assert '/BaseFont /Courier' in text
    # Verify xref points at every actual original object byte offset.
    xref=int(re.search(r'startxref\n(\d+)\n%%EOF',text)[1])
    assert text[xref:].startswith('xref\n')
    lines=text[xref:].splitlines();count=int(lines[1].split()[1])
    assert count==len(objects)+1
    for oid in objects:
        offset=int(lines[oid+2].split()[0])
        assert text[offset:].startswith(str(oid)+' 0 obj\n')
    pages_object=next(obj for obj in objects.values() if '/Type /Pages ' in obj)
    page_ids=[int(x) for x in re.findall(r'(\d+) 0 R',re.search(r'/Kids \[([^]]*)\]',pages_object)[1])]
    assert len(page_ids)==int(re.search(r'/Count (\d+)',pages_object)[1])
    inventory=[];geometry=[];streams=[]
    for page,oid in enumerate(page_ids,1):
        page_object=objects[oid]
        assert re.search(r'/MediaBox \[0 0 600 800\]',page_object)
        stream_obj=objects[int(re.search(r'/Contents (\d+) 0 R',page_object)[1])]
        stream=re.search(r'stream\n(.*?)endstream',stream_obj,re.S)[1]
        assert len(stream.encode('ascii'))==int(re.search(r'/Length (\d+)',stream_obj)[1])
        streams.append({'page':page,'bytes':len(stream),'sha256':digest(stream.encode())})
        operators=list(re.finditer(r'BT /F1 ([\d.]+) Tf 1 0 0 1 ([\d.]+) ([\d.]+) Tm \(((?:\\.|[^\\)])*)\) Tj ET\n',stream))
        assert ''.join(m[0] for m in operators)==stream,'unexpected PDF operator'
        rows={}; bounds=[0]+e['cuts']+[100]
        for m in operators:
            size,x,y=map(float,m.group(1,2,3));literal=unescape(m[4])
            assert size==5
            col=next(i for i in range(len(bounds)-1) if bounds[i]<=x/6<bounds[i+1])
            if y not in rows: rows[y]=['']*(len(bounds)-1)
            assert rows[y][col]=='','multiple original operators in one logical cell'
            rows[y][col]=literal
            # Courier glyph advance is 600/1000 em: these original ASCII literals
            # have width len * 5 * .6. Whole header fits the cited positional cell.
            right=x+len(literal)*size*.6
            assert x>=bounds[col]*6 and right<=bounds[col+1]*6 and 0<=y<=800
            if literal:
                geometry.append({'page':page,'physicalY':y,'column':col+1,'literal':literal,'x':x,'right':right,'cutLeft':bounds[col]*6,'cutRight':bounds[col+1]*6,'font':'Courier','fontSize':size})
        for y in sorted(rows,reverse=True):
            inventory.append({'row':len(inventory)+1,'page':page,'values':rows[y]})
    assert inventory==e['inventory'],case['id']
    proof={'id':case['id'],'originalSha256':digest(raw),'pages':len(page_ids),'operatorInventoryExact':True,'xrefExact':True,'streams':streams,'geometry':geometry}
    if case['outcome']=='derived':
        ctx=e['currencyContext'];code=ctx['currency'];decimals=policy[code]
        assert ctx=={'currency':code,'decimals':decimals,'precisionOrigin':'finite-contract-policy','precisionPolicy':policy}
        header=['Date','Reference','Description','Signed amount ('+code+')']
        csv_bytes=(F/(case['id']+'.csv')).read_bytes()
        csv_rows=list(csv.reader(io.StringIO(csv_bytes.decode(),newline='')))
        assert csv_rows==e['csvRows'] and csv_rows[0]==header
        serialized=io.StringIO(newline='');csv.writer(serialized,lineterminator='\r\n').writerows(csv_rows)
        assert serialized.getvalue().encode()==csv_bytes and digest(csv_bytes)==e['csvSha256']
        movements=[r for r in inventory if re.fullmatch(r'\d{4}-\d{2}-\d{2}',r['values'][0])]
        assert len(movements)==len(e['links'])==len(csv_rows)-1
        amounts=[]
        for movement,link,derived in zip(movements,e['links'],csv_rows[1:]):
            original=movement['values']
            assert link['originalRow']==movement['row'] and link['page']==movement['page']
            assert link['derivedRow']==len(amounts)+2
            assert link['amountLiteral']==original[3]==derived[3]
            assert derived[0]==original[0] and derived[2]==original[2]
            parent=inventory[link['referenceParentRow']-1]
            assert parent['values'][0]=='Invoice No'
            expected_reference=original[1] or parent['values'][1]
            assert derived[1]==link['reference']==expected_reference
            assert link['referenceOrigin']==('explicit-source-cell' if original[1] else 'accepted-section-proposal')
            if parent['page']!=movement['page']:
                prior=inventory[movement['row']-2]
                assert prior['values'][0]=='Continued invoice' or any(r['page']==movement['page'] and r['row']<movement['row'] and r['values'][:2]==['Continued invoice',expected_reference] for r in inventory)
            exact=Decimal(original[3])*Decimal(10)**decimals
            assert exact==exact.to_integral_value()
            amounts.append(int(exact))
        assert amounts==e['amountMinor'] and sum(amounts)==e['totalMinor']
        assert [r[3] for r in csv_rows[1:]]==e['signedAmounts']
        headers=[r for r in inventory if r['values']==header]
        assert [r['row'] for r in headers]==e['headerRows']
        expected_evidence=[{'sourceHash':digest(raw),'row':r['row'],'page':r['page'],'column':4,'literal':r['values'][3]} for r in headers]
        assert e['currencyEvidence']==expected_evidence
        assert len(headers)==len(page_ids)
        proof.update({'csvByteExact':True,'csvSha256':digest(csv_bytes),'signedLiteralExact':True,'minorUnits':amounts,'totalMinor':sum(amounts),'sourceHeaderEvidenceExact':True})
    else:
        assert not (F/(case['id']+'.csv')).exists()
        assert e['partialArtifact']==e['newCurrencyReceipt']==e['derivedCurrencyArtifact']==e['financialApproval']==False
        proof['manualRefusalReason']=e['reason']
    results.append(proof)
actions=load(F/'actions.json')['actions']
assert len(actions)==18 and len({a['id'] for a in actions})==18
for a in actions:
    assert a['outcome']=='refused' and a['partialArtifact']==a['financialApproval']==False
    assert a['source'] in {c['id'] for c in contract['cases'] if c['outcome']=='derived'}
output={'outcome':'PASS','claim':'Independent original PDF operator, positional width, xref, source and freeze pins, manual CSV literal/link/Decimal verification. Action definitions checked structurally, no future product implementation acceptance.','freezeSha256':digest((F/'freeze.json').read_bytes()),'manifestSha256':digest((ROOT/'MANIFEST.json').read_bytes()),'frozenPayloadFilesChecked':len(freeze['files']),'manifestFilesChecked':len(manifest['files']),'cases':results,'actions':actions}
(HERE/'operators-results.json').write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps({'outcome':'PASS','PDFs':len(results),'CSVs':9,'actions':len(actions),'freezeSha256':output['freezeSha256'],'allOriginalOperatorsInventoriesAndColumnWidthsExact':True,'allSignedCsvMinorUnitsExact':True}))
