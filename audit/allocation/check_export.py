"""Independent CSV/Decimal/OpenXML payment allocation oracle; no product imports."""
import argparse,base64,csv,hashlib,io,json,zipfile,unicodedata
from decimal import Decimal
from pathlib import Path
import xml.etree.ElementTree as ET
from datetime import date,timedelta
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'


def sheets(path):
    result = {}
    with zipfile.ZipFile(path) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(n.itertext()) for n in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        relations = {node.attrib['Id']: node.attrib['Target'].lstrip('/') for node in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        for sheet in ET.fromstring(archive.read('xl/workbook.xml')).findall('s:sheets/s:sheet', NS):
            target = relations[sheet.attrib[R]]
            if not target.startswith('xl/'):
                target = 'xl/' + target
            rows = []
            for row in ET.fromstring(archive.read(target)).findall('s:sheetData/s:row', NS):
                cells = {}
                for cell in row.findall('s:c', NS):
                    assert cell.find('s:f', NS) is None, 'unexpected executable formula'
                    index = 0
                    for char in ''.join(c for c in cell.attrib['r'] if c.isalpha()):
                        index = index * 26 + ord(char) - 64
                    value = cell.find('s:v', NS)
                    raw = value.text if value is not None else ''
                    cells[index-1] = strings[int(raw)] if cell.get('t') == 's' else raw
                rows.append([cells.get(i, '') for i in range(max(cells, default=-1)+1)])
            result[sheet.attrib['name']] = rows
    return result


def visible_text(value, maximum=500, identity=False):
    assert isinstance(value,str) and value and value==value.strip() and len(value.encode('utf-16-le'))//2<=maximum
    assert all(unicodedata.category(c) not in ['Cc','Cf'] for c in value), 'non-visible evidence text'
    if identity:assert value[0] not in '=+@-' and not value.upper().startswith(('#REF!','#VALUE!','#N/A','#DIV/0!'))
    return value

def verify(path, contract='one-to-many', native_sources=None):
    root=Path(__file__).parent/'frozen';truth=json.loads((root/'expected.json').read_text());case=next(c for c in truth['cases'] if c['name']==contract)
    scope=truth['scope'];version=truth['version'];roles=['available-payments','open-invoices','proposed-remittance']
    book=sheets(path);summary=dict(book['Summary'][1:]);assert len(summary)==len(book['Summary'])-1
    assert summary['Domain']=='payment-allocation' and summary['Version']==version and summary['Status']==case['status'] and summary['Decimals']=='2' and summary['Confirmed']=='true'
    assert all(summary[k]==v for k,v in scope.items())
    hashes=[];facts=[];proofs=[];inventory=[];traces=[];sources=[]
    for side,f in enumerate(case['files']):
        source=Path(native_sources[side]) if native_sources else root/f['file'];raw=source.read_bytes();sha=hashlib.sha256(raw).hexdigest();hashes.append(sha)
        if not native_sources:assert sha==f['sha256']
        chunks=[r for r in book['Sources'][1:] if int(r[0])==side];assert chunks and [int(r[5]) for r in chunks]==list(range(1,len(chunks)+1))
        assert all(r[1]==roles[side] and r[3]==sha for r in chunks);assert base64.b64decode(''.join(r[6] for r in chunks),validate=True)==raw
        rows=list(csv.reader(io.StringIO((root/f['file']).read_text())))
        if native_sources:
            original=sheets(source);assert len(original)==1
            native=next(iter(original.values()))
            for line in native[1:]:
                for col,h in enumerate(native[0]):
                    if h.lower().endswith('date'):
                        serial=Decimal(line[col]);assert serial==int(serial);line[col]=(date(1899,12,30)+timedelta(days=int(serial))).isoformat()
            assert native==rows,'native source must preserve the frozen CSV facts'
        header=rows[0];assert header==truth['headers'][side];cols={h:i for i,h in enumerate(header)}
        inventory.append([str(side),'1','header','',json.dumps(rows[0],separators=(',',':'))])
        parsed=[]
        for row,line in enumerate(rows[1:],2):
            get=lambda h:line[cols[h]].strip();ident=f'{side}:{sha}:0:{row}';kind='proof' if side==2 else 'item';error=''
            if any(get(h)!=v for h,v in zip(['Entity','Ledger','Party','Account','Currency','Snapshot date','Allocation basis'],scope.values())):error='ALLOCATION_ROW_SCOPE'
            values={}
            for h in (['Allocation amount'] if side==2 else ['Original amount','Available amount']):
                try:
                    text=get(h);assert text and text.replace('.','',1).isdigit();d=Decimal(text);assert d>=0 and d*100==(d*100).to_integral_value() and d*100<=10**14;values[h]=int(d*100)
                except (AssertionError,ValueError):error=error or 'ALLOCATION_AMOUNT'
            if not side==2:
                when=get('Invoice date' if side else 'Payment date')
                if date.fromisoformat(when).isoformat()!=when or when>scope['cutoff']:error=error or 'ALLOCATION_DATE'
                if not error and (values['Original amount']<=0 or values['Available amount']>values['Original amount']):error='ALLOCATION_CAPACITY'
            elif not error and values['Allocation amount']<=0:error='ALLOCATION_AMOUNT'
            inv=[str(side),str(row),'error' if error else kind,error,json.dumps(line,separators=(',',':'))];inventory.append(inv)
            if error:continue
            if side==2:record=dict(id=ident,side=side,row=row,reference=get('Advice line ID'),payment=get('Payment ID'),invoice=get('Invoice ID'),amount=values['Allocation amount'],column=cols['Allocation amount']+1,text=line[cols['Allocation amount']]);proofs.append(record)
            else:
                record=dict(id=ident,side=side,row=row,reference=get('Invoice ID' if side else 'Payment ID'),date=when,original=values['Original amount'],available=values['Available amount']);facts.append(record)
                for h in ['Original amount','Available amount']:traces.append([ident,str(side),str(row),h,str(cols[h]+1),line[cols[h]],str(values[h])])
            parsed.append(record)
        counts={ref:sum(p['reference']==ref for p in parsed) for ref in {p['reference'] for p in parsed}}
        bad={p['id'] for p in parsed if counts[p['reference']]>1}
        for i in inventory:
            if int(i[0])==side and any(p['row']==int(i[1]) and p['id'] in bad for p in parsed):i[2:4]=['error','ALLOCATION_DUPLICATE']
        facts=[p for p in facts if p['id'] not in bad];proofs=[p for p in proofs if p['id'] not in bad];traces=[r for r in traces if r[0] not in bad]
    byid={p['id']:p for p in facts};byref={(p['side'],p['reference']):p for p in facts}
    missing=[]
    for p in proofs:
        if (0,p['payment']) not in byref or (1,p['invoice']) not in byref:
            missing.append(p['id']);next(i for i in inventory if i[:2]==['2',str(p['row'])])[2:4]=['error','ALLOCATION_PROOF_MEMBER']
    proofs=[p for p in proofs if p['id'] not in missing];proofbyid={p['id']:p for p in proofs}
    assert ('source-error' if any(i[2]=='error' for i in inventory) else 'ready')==case['status']
    assert book['Inventory'][1:]==inventory and book['Cell evidence'][1:]==traces
    assert book['Remittance evidence'][1:]==[[p['id'],str(p['row']),p['reference'],p['payment'],p['invoice'],str(p['amount']),str(p['column']),p['text']] for p in proofs]
    readings=[dict(sheet=0,role=role,family=version,confirmed=True) for role in roles]
    rows=book['Reading'][1:];actual={(int(r[0]),r[1]):r[2] for r in rows};assert len(actual)==len(rows)==12
    assert actual=={(i,k):('true' if v is True else str(v)) for i,r in enumerate(readings) for k,v in r.items()}
    context=json.dumps([version,hashes,[[r[k] for k in ['sheet','role','family','confirmed']] for r in readings],list(scope.values()),True],separators=(',',':'));assert summary['Context']==context
    events=book['Events'][1:];seen=set();active={};expected_actions=[a for a in case['actions'] if not a.get('reject')];assert len(events)==len(expected_actions)
    links=book['Decision links'][1:];assert len({(r[0],r[1]) for r in links})==len(links)
    for event,action in zip(events,expected_actions):
        ident,kind,at,ctx,note,target,marked=event;visible_text(ident,identity=True);visible_text(note,2000);assert ident not in seen and ctx==context;seen.add(ident)
        from datetime import datetime,timezone
        stamp=datetime.strptime(at,'%Y-%m-%dT%H:%M:%S.%fZ');assert stamp.strftime('%Y-%m-%dT%H:%M:%S.')+f'{stamp.microsecond//1000:03d}Z'==at
        assert kind==('undo' if action['type']=='undo' else 'allocate')
        if kind=='undo':
            visible_text(target,identity=True);assert target in active;del active[target];assert not any(l[0]==ident for l in links)
        else:
            assert target=='';ls=[l for l in links if l[0]==ident];assert 0<len(ls)<=100 and [int(l[1]) for l in ls]==list(range(len(ls)))
            used={p['id']:0 for p in facts};usedproofs=set()
            for old in active.values():
                for l in old:used[l[2]]+=int(l[4]);used[l[3]]+=int(l[4]);usedproofs.add(l[8]) if l[5]=='remittance' else None
            expected=[]
            for l in ls:
                _,index,pay,inv,amount,basis,reference,reason,proof=l;amount=int(amount)
                assert pay in byid and inv in byid and byid[pay]['side']==0 and byid[inv]['side']==1 and 0<amount<=10**14
                visible_text(reference);visible_text(reason,2000)
                if basis=='remittance':
                    p=proofbyid[proof];assert proof not in usedproofs and p['reference']==reference and p['payment']==byid[pay]['reference'] and p['invoice']==byid[inv]['reference'] and p['amount']==amount;usedproofs.add(proof)
                    assert action['type']=='remittance' and reference in action['proofs']
                else:assert action['type']=='human' and basis in ['accountant-review','external-confirmation'] and proof==''
                used[pay]+=amount;used[inv]+=amount;assert used[pay]<=byid[pay]['available'] and used[inv]<=byid[inv]['available']
                expected.append([byid[pay]['reference'],byid[inv]['reference'],amount])
            if action['type']=='human':assert expected==[[p,i,int(Decimal(str(a))*100)] for p,i,a in action['links']]
            else:assert len(ls)==len(action['proofs']) and {l[6] for l in ls}==set(action['proofs'])
            active[ident]=ls
    assert all(r[0] in seen for r in links)
    active_rows=[l for ls in active.values() for l in ls];assert book['Active links'][1:]==active_rows
    assert all(r[6]==str(r[0] in active).lower() for r in events)
    assert [[byid[l[2]]['reference'],byid[l[3]]['reference'],int(l[4])] for l in active_rows]==case['links']
    ledger=book['Value ledger'][1:];assert len(ledger)==len(facts)
    out=inn=0
    for row,p in zip(ledger,facts):
        allocated=sum(int(l[4]) for l in active_rows if (l[2] if p['side']==0 else l[3])==p['id']);remaining=p['available']-allocated
        assert row==[p['id'],str(p['side']),str(p['row']),p['reference'],p['date'],str(p['original']),str(p['available']),str(allocated),str(remaining)]
        assert allocated+remaining==p['available'] and remaining>=0
        if case['balances']:assert [p['original'],p['available'],allocated,remaining]==case['balances'][f"{p['side']}:{p['reference']}"]
        if p['side']==0:out+=allocated
        else:inn+=allocated
    assert out==inn
    return dict(passed=True,contract=contract,items=len(facts),activeLinks=len(active_rows),events=len(events),allocatedMinor=out)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--contract',default='one-to-many');parser.add_argument('--native-sources',nargs=3);parser.add_argument('files',nargs='+');args=parser.parse_args()
    print(json.dumps([verify(f,args.contract,args.native_sources) for f in args.files],indent=2))
