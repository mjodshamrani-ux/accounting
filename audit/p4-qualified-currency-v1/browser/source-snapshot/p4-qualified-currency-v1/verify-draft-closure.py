"""Standalone original literal/CSV/Decimal consistency checks, no product imports.

This self-check cannot replace independent native PDF extraction acceptance.
"""
from pathlib import Path
from decimal import Decimal
import csv,hashlib,io,json,re

ROOT=Path(__file__).parent/'frozen'
freeze=json.loads((ROOT/'freeze.json').read_text())
contract=json.loads((ROOT/'contract.json').read_text())
assert contract['productImports'] is False and contract['expectedFromProduct'] is False
assert freeze['nativeAccepted'] is False
for name,item in freeze['files'].items():
    blob=(ROOT/name).read_bytes()
    assert len(blob)==item['bytes'] and hashlib.sha256(blob).hexdigest()==item['sha256'],name
counts={'derived':0,'blocked':0,'outside-new-family':0};checks=[]
for spec in contract['cases']:
    truth=json.loads((ROOT/spec['expected']).read_text());blob=(ROOT/spec['original']).read_bytes()
    assert hashlib.sha256(blob).hexdigest()==truth['originalSha256']
    assert truth['outcome']==spec['outcome'] and truth['financialApproval'] is False
    counts[truth['outcome']]+=1
    # Reconstruct each literal content-stream cell using independent PDF text
    # syntax and its absolute coordinates; require complete original inventory.
    inventory=[]
    streams=re.findall(rb'stream\n(.*?)endstream',blob,re.S)
    for page,stream in enumerate(streams,1):
        rows={}
        pattern=rb'BT /F1 5 Tf 1 0 0 1 (\d+) (\d+) Tm \(((?:\\.|[^\\)])*)\) Tj ET'
        for x,y,literal in re.findall(pattern,stream):
            text=re.sub(rb'\\([\\()])',rb'\1',literal).decode('ascii')
            cells=rows.setdefault(int(y),{})
            assert int(x) not in cells
            cells[int(x)]=text
        for y in sorted(rows,reverse=True):
            inventory.append({'row':len(inventory)+1,'page':page,'values':[v for x,v in sorted(rows[y].items())]})
    assert inventory==truth['inventory'],spec['id']+': complete original PDF literal inventory'
    if truth['outcome']=='derived':
        raw=(ROOT/(spec['id']+'.csv')).read_bytes()
        assert hashlib.sha256(raw).hexdigest()==truth['csvSha256']
        rows=list(csv.reader(io.StringIO(raw.decode(),newline='')))
        assert rows==truth['csvRows']
        context=truth['currencyContext'];code=context['currency'];decimals=context['decimals']
        assert {'SAR':2,'JPY':0,'KWD':3}[code]==decimals
        assert rows[0]==['Date','Reference','Description','Signed amount ('+code+')']
        assert context['precisionOrigin']=='finite-contract-policy'
        amount_minor=[]
        assert len(rows)-1==len(truth['links'])
        for row,link in zip(rows[1:],truth['links']):
            source=inventory[link['originalRow']-1]
            assert source['page']==link['page']
            assert [row[0],row[2],row[3]]==[source['values'][0],source['values'][2],source['values'][3]]
            assert row[1]==source['values'][1] or (source['values'][1]=='' and row[1]==inventory[link['referenceParentRow']-1]['values'][1])
            value=Decimal(row[3])*(Decimal(10)**decimals)
            assert value==value.to_integral_value()
            amount_minor.append(int(value))
        assert amount_minor==truth['amountMinor'] and sum(amount_minor)==truth['totalMinor']
        assert [row[3] for row in rows[1:]]==truth['signedAmounts']
        for item in truth['currencyEvidence']:
            source=inventory[item['row']-1]
            assert item['sourceHash']==truth['originalSha256'] and item['page']==source['page']
            assert item['column']==4 and item['literal']==source['values'][3]==rows[0][3]
        assert [e['row'] for e in truth['currencyEvidence']]==truth['headerRows']
        checks.append({'id':spec['id'],'currency':code,'decimals':decimals,'amountMinor':amount_minor,'rows':len(inventory),'qualifiedHeaderRows':truth['headerRows']})
    else:
        assert truth['newCurrencyReceipt'] is False and truth['derivedCurrencyArtifact'] is False and truth['partialArtifact'] is False
assert counts=={'derived':9,'blocked':16,'outside-new-family':2}
actions=json.loads((ROOT/'actions.json').read_text())['actions']
assert len(actions)==18 and len(set(a['id'] for a in actions))==18
assert all(a['outcome']=='refused' and a['partialArtifact'] is False and a['financialApproval'] is False for a in actions)
print(json.dumps({'passed':True,'scope':'independent-original-literal/CSV/Decimal draft self-check; native extraction not accepted','productImports':False,'expectedFromProduct':False,'nativeAccepted':False,'counts':counts,'actions':len(actions),'positiveChecks':checks},indent=2))
