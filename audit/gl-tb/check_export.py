"""Independent CSV/Decimal/OpenXML GL and TB oracle; no product imports."""
import argparse,base64,csv,hashlib,io,json,zipfile
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


def verify(path, contract='positive', native_sources=None):
    root=Path(__file__).parent/'frozen'
    truth=json.loads((root/'expected.json').read_text())
    expected=next(c for c in truth['cases'] if c['name']==contract)
    if native_sources:
        assert contract=='positive' and len(native_sources)==2
        for f,source in zip(expected['files'],native_sources):f['sha256']=hashlib.sha256(Path(source).read_bytes()).hexdigest()
    scope=truth['scope'];fields=truth['amountFields'];version='gl-tb-canonical-1'
    book=sheets(path);summary=dict(book['Summary'][1:])
    assert summary['Domain']=='gl-trial-balance-consistency' and summary['Version']==version
    assert summary['Status']==expected['status'] and summary['Decimals']=='2' and summary['Confirmed']=='true'
    assert all(summary[k]==v for k,v in scope.items())
    readings=[dict(sheet=0,role=role,family=version,confirmed=True) for role in ['gl-detail','trial-balance']]
    reading_rows=book['Reading'][1:];actual={(int(r[0]),r[1]):r[2] for r in reading_rows}
    assert len(actual)==len(reading_rows)==8
    assert actual=={(i,k):('true' if v is True else str(v)) for i,r in enumerate(readings) for k,v in r.items()}
    context=json.dumps([version,[f['sha256'] for f in expected['files']],[[r[k] for k in ['sheet','role','family','confirmed']] for r in readings],list(scope.values()),True],separators=(',',':'))
    assert summary['Context']==context
    facts=[];expected_inventory=[];source_maps=[]
    for side,f in enumerate(expected['files']):
        data=(Path(native_sources[side]) if native_sources else root/f['file']).read_bytes();assert hashlib.sha256(data).hexdigest()==f['sha256']
        sources=[r for r in book['Sources'][1:] if int(r[0])==side]
        assert sources and [int(r[5]) for r in sources]==list(range(1,len(sources)+1))
        assert base64.b64decode(''.join(r[6] for r in sources),validate=True)==data
        assert all(r[1]==readings[side]['role'] and r[3]==f['sha256'] for r in sources)
        if native_sources:
            native=sheets(native_sources[side]);assert len(native)==1
            original=next(iter(native.values()))
            for raw in original[1:]:
                for c in ([2,11,12] if not side else [9,10]):
                    serial=Decimal(raw[c]);assert serial==serial.to_integral_value()
                    raw[c]=(date(1899,12,30)+timedelta(days=int(serial))).isoformat()
            expected_csv=list(csv.reader(io.StringIO((root/f['file']).read_text())))
            assert original==expected_csv, 'native conversion must preserve the frozen positive source facts'
        else:original=list(csv.reader(io.StringIO(data.decode())))
        assert len(original)==f['rows']
        header=original[0];columns={h:i for i,h in enumerate(header)};source_maps.append(columns)
        metadata=['Entity','Ledger','Account','Complete dimensions','Currency','Currency basis','Posting status','Posting layer','Period start','Period end']
        inv=[{'row':1,'kind':'header','raw':original[0]}];parsed=[]
        for row,raw in enumerate(original[1:],2):
            kind='balance' if side else raw[columns['Record kind']]
            entry={'row':row,'kind':kind,'raw':raw};inv.append(entry)
            if all(not v.strip() for v in raw):entry['kind']='blank';continue
            if any(raw[columns[h]].strip()!=v for h,v in zip(metadata,scope.values())):entry['kind']='error';continue
            numeric=['Debit','Credit'] if not side else ['Opening debit','Opening credit','Period debit','Period credit','Closing debit','Closing credit']
            values=[]
            try:
                for h in numeric:
                    text=raw[columns[h]].strip();assert text and all(c in '0123456789.' for c in text)
                    n=Decimal(text);assert n.is_finite() and n>=0 and n*100==(n*100).to_integral_value();values.append(int(n*100))
            except (AssertionError,ValueError):entry['kind']='error';continue
            record=raw[columns['Snapshot ID' if side else 'Record ID']]
            posting_date='' if side else raw[columns['Posting date']]
            assert side or kind in ['opening','movement','closing']
            assert side or scope['start']<=posting_date<=scope['end']
            assert kind!='opening' or posting_date==scope['start'];assert kind!='closing' or posting_date==scope['end']
            parsed.append({'id':f"{side}:{f['sha256']}:0:{row}",'side':side,'row':row,'record':record,'kind':kind,'date':posting_date,'values':values,'raw':raw,'numeric':numeric})
        for p in parsed:
            duplicate_id=sum(r['record']==p['record'] for r in parsed)>1
            duplicate_role=p['kind']!='movement' and sum(r['kind']==p['kind'] for r in parsed)>1
            if duplicate_id or duplicate_role:next(e for e in inv if e['row']==p['row'])['kind']='error'
        facts.extend(p for p in parsed if next(e for e in inv if e['row']==p['row'])['kind']!='error')
        actual_inv=book[['GL inventory','TB inventory'][side]][1:];assert len(actual_inv)==len(inv)
        for actual_row,e in zip(actual_inv,inv):
            assert int(actual_row[0])==e['row'] and actual_row[1]==e['kind']
            assert bool(actual_row[2])==(e['kind']=='error')
            assert (actual_row[3:]+['']*len(e['raw']))[:len(e['raw'])]==e['raw']
        expected_inventory.extend(inv)
    expected_records=[[p['id'],str(p['side']),str(p['row']),p['record'],p['kind'],p['date'],json.dumps(p['values'],separators=(',',':'))] for p in facts]
    assert book['Records'][1:]==expected_records
    assert int(summary['Valid records'])==len(facts)
    assert int(summary['Reading errors'])==sum(e['kind']=='error' for e in expected_inventory)
    expected_cells=[]
    for p in facts:
        for h,n in zip(p['numeric'],p['values']):
            c=source_maps[p['side']][h]
            expected_cells.append([p['id'],str(p['side']),str(p['row']),h,str(c+1),p['raw'][c],str(n)])
    assert book['Cell evidence'][1:]==expected_cells
    opening=next((p for p in facts if p['kind']=='opening'),None);closing=next((p for p in facts if p['kind']=='closing'),None);balance=next((p for p in facts if p['kind']=='balance'),None)
    movement=[p for p in facts if p['kind']=='movement'];components=[];component_members=[]
    gl=None;tb=None
    if opening and closing:
        groups=[[opening],[opening],movement,movement,[closing],[closing]]
        gl=[sum(p['values'][i%2] for p in g) for i,g in enumerate(groups)]
        for i,(field,g,n) in enumerate(zip(fields,groups,gl)):
            cells=[dict(id=p['id'],column=source_maps[0][p['numeric'][i%2]]+1) for p in g]
            components.append(['0',field,str(n)])
            component_members.extend(['0',field,c['id'],str(c['column'])] for c in cells)
    if balance:
        tb=balance['values']
        for i,(field,n) in enumerate(zip(fields,tb)):
            components.append(['1',field,str(n)])
            component_members.append(['1',field,balance['id'],str(source_maps[1][balance['numeric'][i]]+1)])
    assert book['Component evidence'][1:]==components
    assert book['Component members'][1:]==component_members
    delta=[a-b for a,b in zip(gl,tb)] if gl is not None and tb is not None else None
    assert book['Balances'][1:]==[[f,str(gl[i]) if gl is not None else 'missing',str(tb[i]) if tb is not None else 'missing',str(delta[i]) if delta is not None else 'missing'] for i,f in enumerate(fields)]
    def bridge(a):return a[4]-a[5]-a[0]+a[1]-a[2]+a[3]
    for key,a in [('GL',gl),('TB',tb)]:assert summary[key+' bridge minor units']==(str(bridge(a)) if a is not None else 'missing')
    missing=[name for name,item in [('gl-opening',opening),('gl-closing',closing),('tb-balance',balance)] if item is None]
    assert json.loads(summary['Missing'])==missing
    return dict(file=str(path),contract=contract,status=summary['Status'],records=len(facts),passed=True,scope='independent synthetic source cells and balances; not field accuracy')
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('files',nargs='+');parser.add_argument('--contract',default='positive');parser.add_argument('--native-sources',nargs=2);args=parser.parse_args()
    print(json.dumps([verify(p,args.contract,args.native_sources) for p in args.files],indent=2))
