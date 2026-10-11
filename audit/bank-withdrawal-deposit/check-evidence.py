"""Independent source arithmetic. No import of author oracle or product calculations."""
import csv, json, hashlib, re, datetime, zipfile, xml.etree.ElementTree as ET
from pathlib import Path
SEAL='057d53edf12bfca5dd268fdc5e9cd2e1f3c82c35f7e00e8458a1b71681a03817'
NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
CAN=['Record ID','Settlement ID','Movement date','Value date','Cash direction','Role','Parent payment ID','Reverses record ID','Policy','Status','Entity','Ledger','Bank account','Currency','Period start','Period end','Amount']
WD=[h for h in CAN if h not in ['Amount','Cash direction']]+['Withdrawal','Deposit']
def minor(s,d,blank=False):
    if s=='' and blank:return None
    s=s.strip(' ').translate(str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫','01234567890123456789.'))
    if not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?',s): raise ValueError('money-lexeme')
    a,_,b=s.partition('.')
    if len(b)>d:raise ValueError('precision')
    n=int(a)*10**d+int(b.ljust(d,'0') or '0')
    if n>10**14:raise ValueError('limit')
    return n

def load(p, sheet_index=0):
    if p.suffix=='.csv':return list(csv.reader(p.open(encoding='utf-8-sig',newline=''))),{},set(),False
    z=zipfile.ZipFile(p)
    wb=ET.fromstring(z.read('xl/workbook.xml'));rels=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    sheets=wb.find('m:sheets',NS);rid=sheets[sheet_index].attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'];rel=next(r for r in rels if r.attrib['Id']==rid)
    import posixpath
    target=rel.attrib['Target'];part=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
    sh=ET.fromstring(z.read(part))
    ss=ET.fromstring(z.read('xl/sharedStrings.xml')) if 'xl/sharedStrings.xml' in z.namelist() else []
    strings=[''.join(x.itertext()) for x in ss]
    st=ET.fromstring(z.read('xl/styles.xml'));xfs=st.find('m:cellXfs',NS)
    rows=[];nums={};bad=set();native=False
    if sh.find('m:mergeCells',NS) is not None:native=True
    for row in sh.findall('.//m:sheetData/m:row',NS):
        ri=int(row.attrib['r']);vals=[]
        if row.attrib.get('hidden') in ['1','true']:native=True
        for c in row:
            address=c.attrib['r'];letters=re.match('[A-Z]+',address)[0];ci=0
            for ch in letters:ci=ci*26+ord(ch)-64
            while len(vals)<ci:vals.append('')
            v=c.find('m:v',NS);s=v.text if v is not None else ''
            if c.find('m:f',NS) is not None:bad.add(ri)
            if c.attrib.get('t')=='s':s=strings[int(s)]
            elif c.attrib.get('t')=='inlineStr':s=''.join(c.find('m:is',NS).itertext())
            elif s:
                fmt=int(xfs[int(c.attrib.get('s',0))].attrib.get('numFmtId',0));nums[(ri,ci)]=(s,fmt)
            if s and (ri,ci) in nums and nums[(ri,ci)][1]==14:
                s=(datetime.date(1899,12,30)+datetime.timedelta(days=int(s))).isoformat()
            vals[ci-1]=s or ''
        while len(rows)<ri:rows.append([])
        rows[ri-1]=vals
    return rows,nums,bad,native

def analyse(facts,side,p):
    scope=facts['scope'];d={'SAR':2,'JPY':0,'KWD':3}.get(scope['currency'])
    if d is None:return {'fatal':'scope'}
    if facts.get('readingOverride') or facts.get('perspective','company-cash')!='company-cash':return {'fatal':'reading'}
    rows,nums,bad,native=load(p,facts.get('readingSheets',[0,0])[side]);family=facts['families'][side];head=rows[0]
    if sorted(head)!=sorted(WD if family=='wd' else CAN):return {'fatal':'columns'}
    # Under the WD contract both native peers must display exact amounts.
    for (ri,ci),(lex,fmt) in nums.items():
        h=head[ci-1]
        if h in ['Withdrawal','Deposit','Amount']:
            if fmt not in [0,2]:native=True
            if fmt==2:
                from decimal import Decimal
                if Decimal(lex)!=Decimal(lex).quantize(Decimal('.01')):native=True
        elif h not in ['Movement date','Value date','Period start','Period end']:native=True
    if native or bad:return {'fatal':'native'}
    records=[];inventory=[];raw=[]
    for ri,vals in enumerate(rows[1:],2):
        row=dict(zip(head,vals+['']*len(head)));raw.append((ri,row))
        if not any(x.strip() for x in vals):inventory.append([ri,'blank']);continue
        try:
            if ri in bad:raise ValueError('formula')
            if any(x.strip() for x in vals[len(head):]):raise ValueError('extra')
            for col,key in [('Entity','entity'),('Ledger','ledger'),('Bank account','account'),('Currency','currency'),('Period start','start'),('Period end','end')]:
                if row[col].strip()!=scope[key]:raise ValueError('scope')
            states=None
            if family=='wd':
                w=minor(row['Withdrawal'],d,True);dep=minor(row['Deposit'],d,True)
                if (int(bool(w))+int(bool(dep)))!=1:raise ValueError('direction')
                sign=(dep or 0)-(w or 0)
                states=[{'column':head.index(col)+1,'text':row[col],'state':'blank-inactive' if n is None else 'explicit-zero-inactive' if n==0 else 'active','minor':n} for col,n in [('Withdrawal',w),('Deposit',dep)]]
            else:
                n=minor(row['Amount'],d)
                if n==0 or row['Cash direction'] not in ['inflow','outflow']:raise ValueError('direction')
                sign=n if row['Cash direction']=='inflow' else -n
            for h in ['Movement date','Value date']:
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',row[h]):raise ValueError('date')
                datetime.date.fromisoformat(row[h])
            if not scope['start']<=row['Movement date']<=scope['end']:raise ValueError('period')
            if row['Status']!=['booked','posted'][side]:raise ValueError('status')
            policy=row['Policy'];role=row['Role'];parent=row['Parent payment ID'];rev=row['Reverses record ID']
            allowed={'individual':['principal','periodic-fee'],'reversal':['reversal'],'outgoing-inclusive':['settlement'] if side==0 else ['principal','fee','fee-tax'],'incoming-net':['settlement'] if side==0 else ['principal','fee','fee-tax']}
            if role not in allowed.get(policy,[]):raise ValueError('role')
            if role in ['fee','fee-tax'] and (sign>=0 or not parent):raise ValueError('parent')
            if role not in ['fee','fee-tax'] and parent:raise ValueError('parent')
            if (policy=='reversal')!=bool(rev):raise ValueError('reverse')
            for h in ['Record ID','Settlement ID','Parent payment ID','Reverses record ID']:
                val=row[h]
                if (h=='Record ID' and not val) or (val and (val[0] in '=+@-' or val!=val.strip())):raise ValueError('identity')
            records.append({'side':side,'row':ri,'reference':row['Record ID'],'signed':sign,'states':states,'raw':row});inventory.append([ri,'movement'])
        except (ValueError,KeyError):inventory.append([ri,'error'])
    invalid=set()
    for h in ['Record ID','Reverses record ID']:
        claims={v:sum(r[h]==v for _,r in raw) for _,r in raw if (v:=r[h])}
        invalid.update(r['row'] for r in records if claims.get(r['raw'][h],0)>1)
    while True:
        before=set(invalid);available={r['reference']:r for r in records if r['row'] not in invalid}
        for r in records:
            rr=r['raw'];p=available.get(rr['Parent payment ID']);o=available.get(rr['Reverses record ID'])
            if rr['Parent payment ID'] and (not p or p['raw']['Role']!='principal' or p['raw']['Settlement ID']!=rr['Settlement ID'] or p['raw']['Policy']!=rr['Policy'] or not rr['Settlement ID']):invalid.add(r['row'])
            if rr['Reverses record ID'] and (not o or o['raw']['Policy']=='reversal' or not o['raw']['Settlement ID'] or r['signed']!=-o['signed'] or rr['Movement date']<o['raw']['Movement date'] or rr['Value date']<o['raw']['Value date']):invalid.add(r['row'])
        if invalid==before:break
    inventory=[[r,'error' if r in invalid else k] for r,k in inventory]
    records=[{k:v for k,v in r.items() if k!='raw'} for r in records if r['row'] not in invalid]
    return {'records':records,'inventory':inventory,'net':sum(r['signed'] for r in records),'nativeNumericCells':[[ri,ci,lex,fmt] for (ri,ci),(lex,fmt) in nums.items()]}

# Independent portable evidence verifier. It does not import product code,
# expected.json, author oracle, or producer REPORT.expected values.
# Synthetic evidence only. Arithmetic/provenance verification is not browser
# execution, source authenticity, or a replacement lifecycle eligibility engine.
import argparse,base64,tempfile,io,posixpath
from decimal import Decimal

def check(ok,message):
    if not ok:raise AssertionError(message)
def signed_minor(s,d):
    neg=s.startswith('-');n=minor(s[1:] if neg else s,d)
    check(not(neg and n==0),'signed zero')
    return -n if neg else n

def tables(data):
    z=zipfile.ZipFile(io.BytesIO(data));strings=[]
    if 'xl/sharedStrings.xml' in z.namelist():strings=[''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml'))]
    wb=ET.fromstring(z.read('xl/workbook.xml'));rels={r.attrib['Id']:r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))};out={}
    for sheet in wb.find('m:sheets',NS):
        target=rels[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']];part=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target);rows=[]
        for row in ET.fromstring(z.read(part)).findall('.//m:sheetData/m:row',NS):
            cells=[]
            for c in row:
                col=0
                for ch in re.match('[A-Z]+',c.attrib['r'])[0]:col=col*26+ord(ch)-64
                while len(cells)<col:cells.append('')
                v=c.find('m:v',NS);v=v.text if v is not None else ''
                if c.attrib.get('t')=='s':v=strings[int(v)]
                elif c.attrib.get('t')=='inlineStr':v=''.join(c.find('m:is',NS).itertext())
                cells[col-1]=v
            rows.append(cells)
        out[sheet.attrib['name']]=rows
    return out

def exported_sources(t):
    groups={}
    for row in t[1:]:groups.setdefault(int(row[0]),[]).append(row)
    out=[]
    for side,rows in sorted(groups.items()):
        check(side==len(out),'source side gap');rows.sort(key=lambda r:int(r[3]));check([int(r[3]) for r in rows]==list(range(len(rows))),'source chunk gap')
        b=base64.b64decode(''.join(r[4] for r in rows),validate=True);check(hashlib.sha256(b).hexdigest()==rows[0][2],'export source hash');out.append(b)
    return out

def child(t):
    rows=sorted(t[1:],key=lambda r:int(r[0]));check([int(r[0]) for r in rows]==list(range(len(rows))),'child chunk gap');return base64.b64decode(''.join(r[1] for r in rows),validate=True)

def session_sources(s):
    own=[]
    for f in s['files']:
        b=base64.b64decode(f['data'],validate=True);check(hashlib.sha256(b).hexdigest()==f['sha256'],'session source hash');own.append((f['name'],b))
    if 'balance' in s:return session_sources(json.loads(base64.b64decode(s['balance'])))+own
    if 'bank' in s:return session_sources(json.loads(base64.b64decode(s['bank'])))+own
    return own

def temporary_sources(s,folder):
    paths=[]
    for i,f in enumerate(s['files']):
        b=base64.b64decode(f['data'],validate=True);check(hashlib.sha256(b).hexdigest()==f['sha256'],'session SHA256');p=folder/(str(i)+Path(f['name']).suffix);p.write_bytes(b);paths.append(p)
    return paths

def numeric_text_equal(a,b,native):
    return a==b or (native and a!='' and b!='' and Decimal(a)==Decimal(b))

def verify_b1(s,result,folder):
    folder.mkdir();paths=temporary_sources(s,folder);facts={'scope':s['scope'],'families':['wd' if r['family']=='bank-withdrawal-deposit-1' else 'canonical' for r in s['readings']],'readingSheets':[r['sheet'] for r in s['readings']]}
    sides=[analyse(facts,i,p) for i,p in enumerate(paths)]
    check(not any('fatal'in side for side in sides),'unexpected structural source in completed cycle')
    expected=[r for side in sides for r in side['records']];check(len(expected)==len(result['records']),'movement record count from originals')
    for er,ar in zip(expected,result['records']):
        for field in ['side','row','reference','signed']:check(er[field]==ar[field],'original movement '+field)
        check(abs(er['signed'])==ar['amount'],'absolute amount')
        check(ar['direction']==('inflow' if er['signed']>0 else 'outflow'),'calculated direction')
        if er['states'] is None:check('withdrawalDeposit' not in ar,'legacy family provenance');continue
        native={(r,c) for r,c,_,_ in sides[er['side']]['nativeNumericCells']}
        for ec,ac in zip(er['states'],[ar['withdrawalDeposit']['withdrawal'],ar['withdrawalDeposit']['deposit']]):
            for k in ['column','state','minor']:check(ec[k]==ac[k],'cash cell '+k)
            check(numeric_text_equal(ec['text'],ac['text'],(er['row'],ec['column']) in native),'cash cell original text')
    inv=[[i,*r] for i,side in enumerate(sides) for r in side['inventory']]
    actual=[[r['side'],r['row'],r['kind']] for r in result['inventory'] if r['row']>1];check(inv==actual,'complete original movement inventory')
    source_error=any(k=='error' for _,_,k in inv);check((result['status']=='source-error')==source_error,'B1 error gate')
    return {'sides':sides,'sourceError':source_error,'movement':[side['net'] for side in sides],'result':result}

def verify_b2(s,result,folder):
    folder.mkdir();bank=json.loads(base64.b64decode(s['bank']));b1=verify_b1(bank,result['bank'],folder/'b1');paths=temporary_sources(s,folder);d={'SAR':2,'JPY':0,'KWD':3}[bank['scope']['currency']];valid=[];error=b1['sourceError']
    for side,p in enumerate(paths):
        rows,_,bad,native=load(p,s['readings'][side]['sheet']);check(not native,'unsafe native balance source');head=rows[0];claims=[];candidates=[]
        for ri,row in enumerate(rows[1:],2):
            if not any(v.strip() for v in row):continue
            raw=dict(zip(head,row+['']*len(head)));claims.append(raw)
            try:
                check(ri not in bad,'formula');check(raw['Record ID'] and raw['Record ID'][0] not in '=+@-','balance ID')
                for col,key in [('Entity','entity'),('Ledger','ledger'),('Bank account','account'),('Currency','currency'),('Period start','start'),('Period end','end')]:check(raw[col]==bank['scope'][key],'balance row scope')
                kind=raw['Balance kind'];check(kind in ['opening','closing'],'balance kind');check(raw['As of']==s['coverage'][kind+'AsOf'],'balance date');check(raw['Balance basis']=='movement-date','balance basis');check(raw['Status']==['booked','posted'][side],'balance status');amount=signed_minor(raw['Amount'],d);candidates.append({'side':side,'row':ri,'kind':kind,'amount':amount,'reference':raw['Record ID']})
            except (AssertionError,ValueError,KeyError):error=True
        for r in candidates:
            if sum(c['Record ID']==r['reference'] for c in claims)>1 or sum(c['Balance kind']==r['kind'] for c in claims)>1:error=True
            else:valid.append(r)
    check([{k:r[k] for k in ['side','row','kind','amount','reference']} for r in result['records']]==valid,'balance records from originals')
    comp=[]
    for side in [0,1]:
        vals={r['kind']:r['amount'] for r in valid if r['side']==side};o=None if error else vals.get('opening');c=None if error else vals.get('closing');m=None if error else b1['movement'][side];res=o+m-c if None not in [o,c,m] else None;comp.append({'opening':o,'closing':c,'movement':m,'residual':res})
    check([{k:c[k] for k in ['opening','closing','movement','residual']} for c in result['components']]==comp,'independent raw balance bridge')
    differences={k:comp[0][k]-comp[1][k] if comp[0][k] is not None and comp[1][k] is not None else None for k in ['opening','closing']};check(result['differences']==differences,'independent opening/closing differences')
    return {'components':comp,'error':error,'b1':b1}

def verify_b22(s,result,folder):
    folder.mkdir();balance=json.loads(base64.b64decode(s['balance']));b2=verify_b2(balance,result['balance'],folder/'b2');paths=temporary_sources(s,folder);d=result['balance']['decimals'];check(d=={'SAR':2,'JPY':0,'KWD':3}[balance_scope(balance)['currency']],'currency precision')
    items={}
    for ri,row in enumerate(load(paths[0],s['readings'][0]['sheet'])[0][1:],2):
        if not any(row):continue
        head=load(paths[0],s['readings'][0]['sheet'])[0][0];raw=dict(zip(head,row));key=json.dumps(['bank-adjustment-ledger-1',0,s['files'][0]['sha256'],s['readings'][0]['sheet'],ri],separators=(',',':'));items[key]={'point':raw['Point'],'side':0 if raw['Adjust side']=='bank' else 1,'amount':signed_minor(raw['Amount'],d),'reference':raw['Item ID']}
    for item in result['items']:
        own=items[item['id']]
        for k in ['point','side','amount','reference']:check(item[k]==own[k],'adjustment source '+k)
    accepted=set()
    for event in s['events']:
        check(set(event['itemIds'])<=items.keys(),'event original item IDs')
        if event['type']=='accept':accepted.update(event['itemIds'])
        else:accepted.difference_update(event['itemIds'])
    for endpoint in result['endpoints']:
        point=endpoint['point'];raw=[c[point] for c in b2['components']];check([endpoint['rawBank'],endpoint['rawCash']]==raw,'endpoint raw source')
        if result['status']=='source-error':check(all(endpoint[k] is None for k in ['bankAdjustment','cashAdjustment','adjustedBank','adjustedCash','difference']),'source error cannot produce adjusted truth');continue
        adjustment=[sum(x['amount'] for key,x in items.items() if key in accepted and x['point']==point and x['side']==i) for i in [0,1]];adjusted=[raw[i]+adjustment[i] if raw[i] is not None else None for i in [0,1]]
        check([endpoint['bankAdjustment'],endpoint['cashAdjustment']]==adjustment,'explicit accepted item sums');check([endpoint['adjustedBank'],endpoint['adjustedCash']]==adjusted,'adjusted raw plus items');check(endpoint['difference']==(adjusted[0]-adjusted[1] if None not in adjusted else None),'adjusted difference')
    if result['status']=='reconciled-with-evidence':check(all(c['residual']==0 for c in b2['components']),'raw bridge cannot be repaired by endpoint equality')

def balance_scope(s):return json.loads(base64.b64decode(s['bank']))['scope']

def verify_export(data,s):
    w=tables(data);kind=s['format']
    if kind=='tarasuf-bank-adjustment-session':
        b=tables(child(w['Balance workpaper']));m=tables(child(b['Movement workpaper']));sources=exported_sources(m['Sources'])+exported_sources(b['Sources'])+exported_sources(w['Sources']);movement=m
    elif kind=='tarasuf-bank-balance-session':
        m=tables(child(w['Movement workpaper']));sources=exported_sources(m['Sources'])+exported_sources(w['Sources']);movement=m
    else:sources=exported_sources(w['Sources']);movement=w
    check(sources==[b for _,b in session_sources(s)],'export reconstructs every original byte')
    b1=s
    if 'balance' in b1:b1=json.loads(base64.b64decode(b1['balance']))
    if 'bank' in b1:b1=json.loads(base64.b64decode(b1['bank']))
    with tempfile.TemporaryDirectory(prefix='wd-export-cells-') as tmp:
        paths=temporary_sources(b1,Path(tmp));facts={'scope':b1['scope'],'families':['wd' if r['family']=='bank-withdrawal-deposit-1' else 'canonical' for r in b1['readings']],'readingSheets':[r['sheet'] for r in b1['readings']]}
        expected={};movements={}
        for side,path in enumerate(paths):
            parsed=analyse(facts,side,path);check('fatal' not in parsed,'exported structural movement source')
            native={(r,c) for r,c,_,_ in parsed['nativeNumericCells']}
            for record in parsed['records']:
                movements[(side,record['row'])]=record
                if record['states'] is None:continue
                for field,cell in zip(['Withdrawal','Deposit'],record['states']):expected[(side,record['row'],cell['column'],field)]=(cell,(record['row'],cell['column']) in native)
        data=movement.get('Withdrawal Deposit evidence',[[]])[1:];check(len(data)==len(expected),'all two-cell provenance rows exported')
        seen=set()
        for raw in data:
            row=raw+['']*(11-len(raw));side,ri,col=int(row[1]),int(row[4]),int(row[6]);key=(side,ri,col,row[5]);check(key in expected and key not in seen,'unique cash source coordinate');seen.add(key);cell,native=expected[key]
            check(row[2]==b1['readings'][side]['family'] and int(row[3])==b1['readings'][side]['sheet'],'cash source family/sheet')
            check(row[0]==f"{side}:{b1['files'][side]['sha256']}:{b1['readings'][side]['sheet']}:{ri}",'cash source ID/hash')
            check(numeric_text_equal(row[7],cell['text'],native),'export cash original text')
            check(row[8]==cell['state'],'export cash cell state');check(row[9]==('' if cell['minor'] is None else str(cell['minor'])),'export cash minor units');check(row[10]==('false' if cell['minor'] is None else 'true'),'export cash amount present')
        rows=movement['Movements'][1:];check(len(rows)==len(movements),'export complete movement rows')
        for row in rows:
            record=movements[(int(row[1]),int(row[2]))];check(row[3]==record['reference'] and int(row[13])==abs(record['signed']) and int(row[14])==record['signed'],'export independent signed money')

    return len(sources)

def main_portable():
    parser=argparse.ArgumentParser(description='Independent synthetic WD arithmetic/provenance checker; no product expected values');parser.add_argument('evidence',nargs='+',type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args();sessions=sorted({p for root in args.evidence for p in root.rglob('session.json')});check(bool(sessions),'no session evidence found');summary=[]
    for sp in sessions:
        folder=sp.parent;s=json.loads(sp.read_text());rp=folder/('actual-result.json' if (folder/'actual-result.json').exists() else 'result.json');result=json.loads(rp.read_text())
        with tempfile.TemporaryDirectory(prefix='wd-independent-') as temp:
            root=Path(temp)/'work'
            if s['format']=='tarasuf-bank-session':verify_b1(s,result,root)
            elif s['format']=='tarasuf-bank-balance-session':verify_b2(s,result,root)
            elif s['format']=='tarasuf-bank-adjustment-session':verify_b22(s,result,root)
            else:raise AssertionError('unknown evidence domain')
        for name in ['direct.xlsx','restored.xlsx']:count=verify_export((folder/name).read_bytes(),s)
        summary.append({'folder':str(folder),'domain':s['format'],'originals':count,'directAndRestoredExports':True})
    report={'passed':True,'syntheticOnly':True,'browserExecuted':False,'sessions':len(summary),'originals':sum(x['originals'] for x in summary),'expectedProductValuesImported':False,'limits':'Checks original-source money/inventory, raw bridges, event-authorized adjustment arithmetic and byte-preserving exports. Does not replace full event eligibility, native display/browser acceptance, or field authenticity.','cases':summary}
    if args.output:args.output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='cases'}))
if __name__=='__main__':main_portable()
