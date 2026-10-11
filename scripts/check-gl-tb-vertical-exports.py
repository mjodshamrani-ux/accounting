"""Independent CSV/Decimal oracle. Never imports generator or product code."""
import csv,datetime,hashlib,io,json,pathlib,re,unicodedata
from collections import Counter
from decimal import Decimal,getcontext
getcontext().prec=80
SCOPE_HEADERS=['Entity','Ledger','Account','Complete dimensions','Currency','Currency basis','Posting status','Posting layer','Period start','Period end']
GL_HEADERS=['Record ID','Record kind','Posting date',*SCOPE_HEADERS,'Debit','Credit']
TB_HEADERS=['Snapshot ID','Balance role',*SCOPE_HEADERS,'Debit','Credit']
COMPONENTS=['openingDebit','openingCredit','periodDebit','periodCredit','closingDebit','closingCredit']
PRECISION={'SAR':2,'USD':2,'EUR':2,'GBP':2,'AED':2,'QAR':2,'EGP':2,'KWD':3,'BHD':3,'OMR':3,'JPY':0}
MAX_MINOR=10**14
DIGITS=str.maketrans({**{chr(0x660+i):str(i) for i in range(10)},**{chr(0x6f0+i):str(i) for i in range(10)},'\u066b':'.','\u200e':None,'\u200f':None,'\u061c':None})
# ECMAScript WhiteSpace + LineTerminator, explicitly excluding Python-only NEL.
JS_TRIM=''.join(chr(c) for c in [0x9,0xa,0xb,0xc,0xd,0x20,0xa0,0x1680,*range(0x2000,0x200b),0x2028,0x2029,0x202f,0x205f,0x3000,0xfeff])
def js_trim(value):return value.strip(JS_TRIM)

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def identity_valid(value,policy):
    value=js_trim(value)
    return bool(value) and len(value.encode('utf-16-le',errors='surrogatepass'))//2<=policy['maxIdentityUnits'] and not value.startswith(('=','+','@','-')) and not any(unicodedata.category(c) in ['Cc','Cf'] for c in value) and not re.match(r'^#(?:REF!|VALUE!|N/A|DIV/0!)',value,re.I)
def to_minor(text,precision):
    normalized=js_trim(text).translate(DIGITS);pattern=r'[0-9]+'+(rf'(?:\.[0-9]{{1,{precision}}})?' if precision else '')
    if not re.fullmatch(pattern,normalized):raise ValueError('Malformed provided money')
    value=Decimal(normalized)*(Decimal(10)**precision)
    if not 0<=value<=MAX_MINOR:raise ValueError('Provided money exceeds inclusive bound')
    return int(value)

def parse_source(path,kind,scope,policy):
    raw=path.read_bytes();digest=hashlib.sha256(raw).hexdigest();errors=[];inventory=[];records=[]
    def fail(code,row,reason,column=None,**detail):errors.append({'code':code,'source':path.name,'row':row,'column':column,'reason':reason,**detail})
    try:rows=list(csv.reader(io.StringIO(raw.decode('utf-8-sig'),newline=''),strict=True))
    except (UnicodeDecodeError,csv.Error) as e:return {'file':path.name,'sha256':digest,'errors':[{'code':'CSV','reason':str(e)}],'inventory':[],'records':[],'amounts':None,'members':{},'missing':[]}
    expected=GL_HEADERS if kind=='gl' else TB_HEADERS
    if not rows or len(rows[0])!=len(expected) or Counter(js_trim(c) for c in rows[0])!=Counter(expected):
        fail('HEADER',1,'Missing, duplicate, unknown or extra header',expected=expected,provided=rows[0] if rows else [])
        return {'file':path.name,'sha256':digest,'errors':errors,'inventory':[{'row':i,'role':'header' if i==1 else 'unread-after-header-error','values':r} for i,r in enumerate(rows,1)],'records':[],'amounts':None,'members':{},'missing':[]}
    header=[js_trim(c) for c in rows[0]];columns={label:index for index,label in enumerate(header)};inventory.append({'row':1,'role':'header','values':rows[0].copy()})
    if len(raw)>8*1024*1024:fail('LIMIT',1,'Original CSV exceeds8MiB')
    if len(rows)>20000:fail('LIMIT',1,'Original CSV exceeds20000 source rows')
    currency=scope['Currency'];precision=PRECISION.get(currency)
    if precision is None:fail('SCOPE',1,'Unknown functional currency',currency=currency)
    def cell(row,label):return js_trim(row[columns[label]])
    def evidence(row,label,role,identifier,number):return {'source':path.name,'sha256':digest,'sheet':'CSV','row':number,'column':columns[label]+1,'header':label,'rawHeader':rows[0][columns[label]],'raw':row[columns[label]],'role':role,'snapshotId':identifier if kind=='tb' else None,'recordId':identifier if kind=='gl' else None}
    def money(row,label,number):
        original=row[columns[label]]
        try:
            if precision is None:raise ValueError('Unknown currency precision')
            return to_minor(original,precision)
        except ValueError as e:fail('AMOUNT',number,str(e),columns[label]+1,raw=original);return None
    identities=set();roles={'opening':[],'period':[],'closing':[]};snapshots=set();all_gl_ids=set();gl_moves=[]
    for number,row in enumerate(rows[1:],2):
        if not any(js_trim(c) for c in row):inventory.append({'row':number,'role':'blank','values':row});continue
        if len(row)!=len(header):fail('ROW',number,'Nonblank row has missing or extra cells');inventory.append({'row':number,'role':'error','values':row});continue
        role=cell(row,'Record kind' if kind=='gl' else 'Balance role');identifier=cell(row,'Record ID' if kind=='gl' else 'Snapshot ID');row_errors=len(errors)
        if not identity_valid(identifier,policy):fail('IDENTITY',number,'Missing, unsafe or overlong supplied identifier',columns['Record ID' if kind=='gl' else 'Snapshot ID']+1,raw=identifier)
        for label in SCOPE_HEADERS:
            literal=cell(row,label)
            if not identity_valid(literal,policy) or literal!=scope[label]:fail('ROW_SCOPE',number,'Required scope identity differs from confirmed scope or is invalid',columns[label]+1,header=label,raw=row[columns[label]],expected=scope[label])
        if cell(row,'Currency basis')!='functional':fail('SCOPE',number,'Source currency basis is not functional')
        if cell(row,'Posting status')!='posted':fail('SCOPE',number,'Source posting status is not posted')
        dates=[]
        for label in ['Period start','Period end']:
            literal=cell(row,label)
            try:
                if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}',literal):raise ValueError()
                value=datetime.date.fromisoformat(literal)
                if not policy['dateMin']<=value<=policy['dateMax']:raise ValueError()
                dates.append(value)
            except ValueError:fail('PERIOD',number,'Invalid or unsupported source period date',columns[label]+1,raw=literal)
        if len(dates)==2 and dates[0]>dates[1]:fail('PERIOD',number,'Period start exceeds end')
        allowed={'opening','movement','closing'} if kind=='gl' else {'opening','period','closing'}
        if role not in allowed:fail('ROLE',number,'Blank or unknown supplied role',columns['Record kind' if kind=='gl' else 'Balance role']+1,raw=role)
        if kind=='gl':
            if identifier in all_gl_ids:fail('DUPLICATE',number,'Duplicate GL record identity',recordId=identifier)
            all_gl_ids.add(identifier)
            posting=cell(row,'Posting date')
            try:
                if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}',posting):raise ValueError()
                day=datetime.date.fromisoformat(posting)
                if len(dates)!=2 or not dates[0]<=day<=dates[1]:raise ValueError()
                if role=='opening' and day!=dates[0] or role=='closing' and day!=dates[1]:raise ValueError()
            except ValueError:fail('PERIOD',number,'Posting date invalid, outside period or wrong balance endpoint',columns['Posting date']+1,raw=posting)
        else:
            snapshots.add(identifier);identity=(identifier,role)
            if identity in identities:fail('DUPLICATE',number,'Duplicate TB (snapshot,role), including equal copies',snapshotId=identifier,role=role)
            identities.add(identity)
            if len(snapshots)>1:fail('SNAPSHOT_CONFLICT',number,'A second supplied snapshot rejects the complete source',snapshots=sorted(snapshots))
        debit=money(row,'Debit',number);credit=money(row,'Credit',number)
        record={'role':role,'identifier':identifier,'row':number,'debitMinor':debit,'creditMinor':credit,'debitEvidence':evidence(row,'Debit',role,identifier,number),'creditEvidence':evidence(row,'Credit',role,identifier,number),'values':row.copy()};records.append(record)
        if role in ['opening','closing'] or kind=='tb' and role=='period':roles[role].append(record)
        elif kind=='gl' and role=='movement':gl_moves.append(record)
        inventory.append({'row':number,'role':role if len(errors)==row_errors else 'error','providedRole':role,'values':row.copy()})
    required=['opening','closing'] if kind=='gl' else ['opening','period','closing'];missing=[role for role in required if not roles[role]]
    for role in required:
        if len(roles[role])>1:fail('DUPLICATE',roles[role][1]['row'],'More than one supplied balance role',role=role,count=len(roles[role]))
    amounts={};members={}
    for role in ['opening','period','closing']:
        items=gl_moves if kind=='gl' and role=='period' else roles[role]
        for side in ['Debit','Credit']:
            field=role+side;key=side.lower()+'Minor';evidence_key=side.lower()+'Evidence'
            if kind=='gl' and role=='period':
                amount=None if any(r[key] is None for r in items) else sum(r[key] for r in items)
                if amount is not None and amount>MAX_MINOR:fail('LIMIT',1,'Final GL period component exceeds inclusive bound',component=field,minor=str(amount))
            else:amount=items[0][key] if len(items)==1 else None
            amounts[field]=amount;members[field]=[r[evidence_key] for r in items]
    return {'file':path.name,'sha256':digest,'header':header,'errors':errors,'inventory':inventory,'records':records,'amounts':amounts,'members':members,'missing':missing,'snapshotIds':sorted(snapshots) if kind=='tb' else [],'identityRule':'(snapshot,role)' if kind=='tb' else 'Record ID'}

def reconcile(gl,tb,policy):
    errors=[*gl['errors'],*tb['errors']];missing={'gl':gl['missing'],'tb':tb['missing']};bridges={};differences={}
    for side,source in [('gl',gl),('tb',tb)]:
        amounts=source['amounts'];value=None
        if amounts and all(amounts[field] is not None for field in COMPONENTS):
            a=amounts;value=a['closingDebit']-a['closingCredit']-a['openingDebit']+a['openingCredit']-a['periodDebit']+a['periodCredit']
            if abs(value)>policy['maxSignedMinor']:errors.append({'code':'LIMIT','source':source['file'],'reason':'Independent bridge exceeds signed bound','minor':str(value)})
        bridges[side]=value
    for field in COMPONENTS:
        a=gl['amounts'];b=tb['amounts'];value=None if not a or not b or a[field] is None or b[field] is None else a[field]-b[field]
        if value is not None and abs(value)>policy['maxSignedMinor']:errors.append({'code':'LIMIT','reason':'Component difference exceeds signed bound','component':field,'minor':str(value)})
        differences[field]=value
    if any(e['code']=='HEADER' for e in errors):status='refused'
    elif errors:status='source-error'
    elif any(missing.values()):status='missing'
    elif any(v!=0 for v in bridges.values()):status='inconsistent'
    elif any(v!=0 for v in differences.values()):status='difference'
    else:status='consistent'
    diagnostics=[dict(e) for e in errors]
    for side,source in [('gl',gl),('tb',tb)]:
        for role in source['missing']:diagnostics.append({'code':'MISSING_'+role.upper(),'source':source['file'],'reason':'Required provided role absent'})
    for side,value in bridges.items():
        if value is not None and value!=0:diagnostics.append({'code':side.upper()+'_BRIDGE','minor':str(value)})
    if any(value is not None and value!=0 for value in differences.values()):diagnostics.append({'code':'COMPONENT_DIFFERENCE','differences':{k:None if v is None else str(v) for k,v in differences.items()}})
    for item in diagnostics:
        if item['code']=='DUPLICATE' and item.get('source')==tb['file']:item['code']='DUPLICATE_ROLE'
    return {'status':status,'gl':gl,'tb':tb,'bridges':bridges,'differences':differences,'errors':errors,'diagnostics':diagnostics,'missing':missing,'glOpeningBorrowedFromTb':False,'tbOpeningBorrowedFromGl':False,'tbPeriodBorrowedFromGl':False,'sourceNetUsedToReconstructGross':False}

def check_control(path,scope,expected_amounts):
    rows=list(csv.reader(io.StringIO(path.read_bytes().decode('utf-8-sig'),newline=''),strict=True));expected=['Snapshot ID',*SCOPE_HEADERS,'Opening debit','Opening credit','Period debit','Period credit','Closing debit','Closing credit'];assert Counter(js_trim(c) for c in rows[0])==Counter(expected);assert len(rows[0])==len(expected);assert len(rows)==2;header=[js_trim(c) for c in rows[0]];row=rows[1]
    for key in SCOPE_HEADERS:assert js_trim(row[header.index(key)])==scope[key]
    names=['Opening debit','Opening credit','Period debit','Period credit','Closing debit','Closing credit'];values={field:to_minor(row[header.index(label)],PRECISION[scope['Currency']]) for field,label in zip(COMPONENTS,names)};assert values==expected_amounts
    return {'file':path.name,'sha256':sha(path),'amounts':values,'matchesVertical':True}

# CSV/Decimal functions above retained from the reviewed precode oracle, SHA-256
# 2c5823a4436b3d7fd0c7eb64019a262f212706014a0032e4a6c73b61b21e59b4.
# No product or fixture-generator imports. XLSX is parsed directly as XML/ZIP.
import argparse,base64,posixpath,zipfile,xml.etree.ElementTree as ET
from xml.sax.saxutils import escape
NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
MANIFEST_SHA='f97536a72b2d70ff5726c4ade85fcbb0aca5f1deb8d6e9b333c490e5baab0e59'
SEALS={'CONTRACT.ar.md':'aaa93fd0019adc7e66265af913a88af541529fb701a49f9bf791e6c0d80f5630','CONTRACT-DETAILS.ar.md':'84a804c1473af63accac6ff2f29ba10962b16b07a20e53d3a2a4baf375efce1f','TEXT-POLICY.ar.md':'ece315053cea0f56bf2cb1d4b707050f64c004229b475129f2801b010ccc2a44'}
POLICY={'maxIdentityUnits':500,'dateMin':datetime.date(1900,1,1),'dateMax':datetime.date(2100,12,31),'maxSignedMinor':10**14}
MAPPINGS=dict(zip(SCOPE_HEADERS,['entity','ledger','account','dimensions','currency','currencyBasis','postingStatus','postingLayer','start','end']))
def st_decode(text):return re.sub(r'_x([0-9A-Fa-f]{4})_',lambda m:chr(int(m[1],16)),text)
def col_letters(n):
    s=''
    while n:n,r=divmod(n-1,26);s=chr(65+r)+s
    return s
def col_number(s):
    n=0
    for c in s:n=n*26+ord(c)-64
    return n

def xlsx_rows(path):
    result={}
    with zipfile.ZipFile(path) as z:
        shared=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            shared=[st_decode(''.join(t.text or '' for t in si.findall('.//m:t',NS))) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',NS)]
        rels={r.attrib['Id']:r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        for sheet in ET.fromstring(z.read('xl/workbook.xml')).findall('m:sheets/m:sheet',NS):
            target=rels[sheet.attrib['{'+NS['r']+'}id']]
            member=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
            tree=ET.fromstring(z.read(member));rows=[];types={}
            assert not tree.findall('.//m:f',NS),str(path)+': formula in workbook'
            for row in tree.findall('m:sheetData/m:row',NS):
                number=int(row.attrib['r'])
                while len(rows)<number:rows.append([])
                for c in row.findall('m:c',NS):
                    ref=c.attrib['r'];column=col_number(re.match(r'[A-Z]+',ref)[0]);kind=c.attrib.get('t','n');v=c.find('m:v',NS)
                    if kind=='s':value=shared[int(v.text)]
                    elif kind=='inlineStr':value=st_decode(''.join(t.text or '' for t in c.findall('.//m:t',NS)))
                    else:value='' if v is None else (v.text or '')
                    while len(rows[number-1])<column:rows[number-1].append('')
                    rows[number-1][column-1]=value;types[(number,column)]=kind
            result[sheet.attrib['name']]={'rows':rows,'types':types}
    return result

def write_native(path,rows):
    # Serialize the frozen original CSV physical rows, all values as native text.
    # Never transform vertical balances to a horizontal source.
    def text_value(value):return escape(re.sub(r'_(?=x[0-9a-fA-F]{4}_)','_x005F_',value).replace('\r','_x000D_'))
    xml='<worksheet xmlns="'+NS['m']+'"><sheetData>'
    for i,row in enumerate(rows,1):
        xml+=f'<row r="{i}">'+''.join(f'<c r="{col_letters(j)}{i}" t="inlineStr"><is><t xml:space="preserve">{text_value(value)}</t></is></c>' for j,value in enumerate(row,1))+'</row>'
    xml+='</sheetData></worksheet>'
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
        def write_member(name,text):
            info=zipfile.ZipInfo(name,date_time=(2026,10,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,text)
        write_member('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        write_member('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        write_member('xl/workbook.xml','<workbook xmlns="'+NS['m']+'" xmlns:r="'+NS['r']+'"><sheets><sheet name="Native source" sheetId="1" r:id="rId1"/></sheets></workbook>')
        write_member('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        write_member('xl/worksheets/sheet1.xml',xml)
    native=xlsx_rows(path)['Native source'];assert native['rows']==rows
    assert all(native['types'][(i,j)]=='inlineStr' for i,row in enumerate(rows,1) for j in range(1,len(row)+1))

def seal_inputs(frozen,contract):
    manifest_path=frozen/'INPUT-MANIFEST.json';assert sha(manifest_path)==MANIFEST_SHA,'Frozen manifest seal changed'
    manifest=json.loads(manifest_path.read_text());checks=[]
    assert len(manifest['files'])==99
    for entry in manifest['files']:
        path=frozen/entry['path'];assert sha(path)==entry['sha256'] and path.stat().st_size==entry['bytes'],entry['path']
        checks.append({'path':entry['path'],'sha256':entry['sha256'],'bytes':entry['bytes'],'matched':True})
    docs=[]
    assert contract and contract.exists(),'Immutable contract copy missing'
    if contract and contract.exists():
        for name,digest in SEALS.items():
            assert sha(contract/name)==digest,name+' seal changed';docs.append({'path':name,'sha256':digest,'matched':True})
    return {'inputManifestSha256':MANIFEST_SHA,'immutablePayloadFiles':99,'files':checks,'contractSeals':docs,'contractSealsChecked':len(docs),'originalOracleSha256':'2c5823a4436b3d7fd0c7eb64019a262f212706014a0032e4a6c73b61b21e59b4'}

def prepare(frozen,out,contract):
    out.mkdir(parents=True,exist_ok=True);integrity=seal_inputs(frozen,contract);cases=[];controls=0
    for facts_path in sorted(frozen.glob('*/facts.json')):
        facts=json.loads(facts_path.read_text());scope={label:facts['scope'][key] for label,key in MAPPINGS.items()}
        assert facts['authoredBeforeProductObservation'] and facts['syntheticOnly'] and facts['family']=='GL_TB_VERTICAL_BALANCES_V1'
        gl=parse_source(facts_path.parent/'gl.csv','gl',scope,POLICY);tb=parse_source(facts_path.parent/'tb-vertical.csv','tb',scope,POLICY);oracle=reconcile(gl,tb,POLICY)
        assert oracle['status']==facts['requiredStatus'],facts['id']
        codes={d['code'] for d in oracle['diagnostics']};assert set(facts['requiredDiagnostics'])<=codes,(facts['id'],codes)
        for side,source in [('gl',gl),('tb',tb)]:
            assert [r['values'] for r in source['inventory']]==facts['inventory'][side]
            assert source['sha256']==facts['sourceSha256'][source['file']]
        if facts['financialExpectationsApplicable']:
            assert gl['amounts']=={k:int(v) for k,v in facts['glComponentsMinor'].items()}
            assert tb['amounts']=={k:int(v) for k,v in facts['tbAuthoredComponentsMinor'].items()}
            assert oracle['bridges']=={'gl':int(facts['glBridgeMinor']),'tb':int(facts['tbBridgeMinor'])}
            assert oracle['differences']=={k:int(v) for k,v in facts['componentDifferencesMinor'].items()}
        control=facts_path.parent/'tb-horizontal-control.csv'
        if control.exists():check_control(control,scope,tb['amounts']);controls+=1
        native_dir=out/facts['id']/'native';native_dir.mkdir(parents=True,exist_ok=True)
        native_hashes={}
        for side,name in [('gl','gl.csv'),('tb','tb-vertical.csv')]:
            rows=list(csv.reader(io.StringIO((facts_path.parent/name).read_bytes().decode('utf-8-sig'),newline=''),strict=True))
            dest=native_dir/(name[:-4]+'.xlsx');write_native(dest,rows);native_hashes[side]=sha(dest)
        cases.append({'id':facts['id'],'facts':facts,'oracle':oracle,'nativeHashes':native_hashes,'expectationsCheckedBeforeProduct':True,'financialValuesFilledFromPreMutationExpectations':False})
    assert len(cases)==30 and controls==9
    data={'independent':True,'productImports':False,'generatorImports':False,'syntheticOnly':True,'seal':integrity,'cases':cases,'horizontalControls':controls}
    (out/'source-expectations.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    (out/'source-check-summary.json').write_text(json.dumps({'cases':30,'sourceCSV':60,'nativeXLSX':60,'horizontalControls':9,'sealedFiles':99,'passed':True},indent=2)+'\n')
    return data

def keyed_rows(sheet):
    rows=sheet['rows'];return [dict(zip(rows[0],row+['']*max(0,len(rows[0])-len(row)))) for row in rows[1:]]
def check_export(path,case,format):
    facts=case['facts'];oracle=case['oracle'];book=xlsx_rows(path)
    required={'Summary','Balances','Records','Cell evidence','Component evidence','Component members','GL inventory','TB inventory','Reading','Sources'}
    assert required<=book.keys(),path
    summary={r['Property']:r['Value'] for r in keyed_rows(book['Summary'])}
    assert summary['Status']==facts['requiredStatus'];assert summary['Version']=='gl-tb-canonical-1'
    assert summary['Confirmed']=='true' and summary['Decimals']==str(facts['decimals'])
    for key,value in facts['scope'].items():
        if key!='confirmed':assert summary[key]==value,(path,key)
    readings=keyed_rows(book['Reading']);families={r['Side']:r['Value'] for r in readings if r['Field']=='family'}
    assert families=={'0':'gl-tb-canonical-1','1':'GL_TB_VERTICAL_BALANCES_V1'}
    sources=keyed_rows(book['Sources'])
    for side,key,name in [(0,'gl','gl.csv'),(1,'tb','tb-vertical.csv')]:
        rows=[r for r in sources if r['Side']==str(side)];rows.sort(key=lambda r:int(r['Chunk']))
        raw=base64.b64decode(''.join(r['Original bytes base64'] for r in rows),validate=True)
        expected_hash=facts['sourceSha256'][name] if format=='csv' else case['nativeHashes'][key]
        assert hashlib.sha256(raw).hexdigest()==expected_hash
        assert all(r['Source SHA-256']==expected_hash and r['Sheet']==('CSV' if format=='csv' else 'Native source') and r['Role']==('gl-detail' if side==0 else 'trial-balance') for r in rows)
        assert all(r['Family']==families[str(side)] for r in rows)
        original_rows=list(csv.reader(io.StringIO(raw.decode('utf-8-sig'),newline=''),strict=True)) if format=='csv' else xlsx_rows(io.BytesIO(raw))['Native source']['rows']
        assert original_rows==facts['inventory'][key]
        inventory_name='GL inventory' if side==0 else 'TB inventory';inventory=keyed_rows(book[inventory_name]);original=original_rows
        assert len(inventory)==len(original)
        for i,(r,values) in enumerate(zip(inventory,original),2):
            assert r['Source row']==str(i-1)
            for j,value in enumerate(values,1):
                label=f'Original column {j}';assert r[label]==value,(path,inventory_name,i,j)
                assert book[inventory_name]['types'][(i,j+3)] in ['s','inlineStr'],(path,'original must be text')
    context=json.loads(summary['Context']);assert context[0]=='gl-tb-canonical-1'
    assert context[1]==[facts['sourceSha256']['gl.csv'],facts['sourceSha256']['tb-vertical.csv']] if format=='csv' else context[1]==[case['nativeHashes']['gl'],case['nativeHashes']['tb']]
    assert context[2]==[[0,'gl-detail','gl-tb-canonical-1',True],[0,'trial-balance','GL_TB_VERTICAL_BALANCES_V1',True]]
    assert context[3]==[facts['scope'][k] for k in MAPPINGS.values()] and context[4] is True
    def check_origin(entry,side,row):
        rows=facts['inventory']['gl' if side==0 else 'tb'];header=[js_trim(v) for v in rows[0]];original=rows[row-1]
        identity=original[header.index('Record ID' if side==0 else 'Snapshot ID')];role=original[header.index('Record kind' if side==0 else 'Balance role')]
        assert entry['Source SHA-256']==context[1][side] and entry['Sheet']==('CSV' if format=='csv' else 'Native source') and entry['Family']==families[str(side)]
        assert entry['Original identity']==identity and entry['Original role']==role
        assert entry['Snapshot ID']==('' if side==0 else identity) and entry['Balance role']==('' if side==0 else role)
    records=keyed_rows(book['Records']);record_map={r['ID']:r for r in records};cells=keyed_rows(book['Cell evidence']);cell_map={(r['ID'],r['Source column']):r for r in cells}
    for record in records:check_origin(record,int(record['Side']),int(record['Source row']))
    for cell in cells:
        check_origin(cell,int(cell['Side']),int(cell['Source row']))
        record=record_map[cell['ID']];side=int(cell['Side']);key='gl' if side==0 else 'tb';rows=facts['inventory'][key];row=int(cell['Source row']);col=int(cell['Source column']);assert record['Source row']==str(row) and record['Side']==str(side)
        assert cell['Original text']==rows[row-1][col-1]
        assert cell['Field']==js_trim(rows[0][col-1])
        expected_hash=context[1][side];assert cell['ID']==f'{side}:{expected_hash}:0:{row}'
        if side==1:
            header=[js_trim(v) for v in rows[0]];assert record['Record ID']==js_trim(rows[row-1][header.index('Snapshot ID')]);assert record['Kind']==js_trim(rows[row-1][header.index('Balance role')]);assert record['Posting date']==''
    balances={r['Component']:r for r in keyed_rows(book['Balances'])};component_rows=keyed_rows(book['Component evidence']);members=keyed_rows(book['Component members'])
    if facts['financialExpectationsApplicable']:
        assert summary['GL bridge minor units']==facts['glBridgeMinor'] and summary['TB bridge minor units']==facts['tbBridgeMinor']
        for field in COMPONENTS:
            r=balances[field];assert [r['GL minor units'],r['TB minor units'],r['Difference minor units']]==[facts['glComponentsMinor'][field],facts['tbAuthoredComponentsMinor'][field],facts['componentDifferencesMinor'][field]]
        for side,key in [(0,'gl'),(1,'tb')]:
            for field in COMPONENTS:
                expected=oracle[key]['members'][field];observed=[r for r in members if r['Side']==str(side) and r['Component']==field]
                actual=[]
                for m in observed:
                    c=cell_map[(m['Record ID'],m['Source column'])];r=record_map[m['Record ID']];check_origin(m,side,int(c['Source row']));assert m['Source row']==c['Source row'] and m['Original text']==c['Original text'];actual.append((int(c['Source row']),int(c['Source column']),c['Original text'],r['Kind'],r['Record ID']))
                wanted=[(e['row'],e['column'],e['raw'],e['role'],e['recordId'] if side==0 else e['snapshotId']) for e in expected]
                assert actual==wanted,(path,field,'membership')
                totals=[r for r in component_rows if r['Side']==str(side) and r['Component']==field];assert len(totals)==1 and totals[0]['Total minor units']==str(oracle[key]['amounts'][field])
        assert len([m for m in members if m['Side']=='1'])==6
    elif facts['requiredStatus']=='missing':
        assert all(r['TB minor units']=='missing' and r['Difference minor units']=='missing' for r in balances.values())
        assert not [m for m in members if m['Side']=='1'];assert summary['TB bridge minor units']=='missing'
        missing=json.loads(summary['Missing']);assert set(missing)=={'tb-'+role for role in oracle['tb']['missing']}
    elif facts['requiredStatus']=='source-error':assert int(summary['Reading errors'])>0
    return {'file':str(path),'sha256':sha(path),'status':summary['Status'],'originalBytesVerified':True,'rawInventoryVerified':True,'financialExpectedFromFrozenSources':facts['financialExpectationsApplicable'],'componentOriginsVerified':facts['financialExpectationsApplicable']}

def check_session(path,case,format):
    session=json.loads(path.read_text());facts=case['facts']
    assert set(session)=={'format','version','files','readings','scope'}
    assert session['format']=='tarasuf-gl-tb-session' and session['version']=='gl-tb-canonical-1' and session['scope']==facts['scope']
    assert session['readings']==[{'sheet':0,'role':'gl-detail','family':'gl-tb-canonical-1','confirmed':True},{'sheet':0,'role':'trial-balance','family':'GL_TB_VERTICAL_BALANCES_V1','confirmed':True}]
    assert len(session['files'])==2
    for side,key,name in [(0,'gl','gl.csv'),(1,'tb','tb-vertical.csv')]:
        source=session['files'][side];assert set(source)=={'name','sha256','data'}
        raw=base64.b64decode(source['data'],validate=True);expected=facts['sourceSha256'][name] if format=='csv' else case['nativeHashes'][key]
        assert hashlib.sha256(raw).hexdigest()==source['sha256']==expected
        original=list(csv.reader(io.StringIO(raw.decode('utf-8-sig'),newline=''),strict=True)) if format=='csv' else xlsx_rows(io.BytesIO(raw))['Native source']['rows']
        assert original==facts['inventory'][key]
    return {'case':case['id'],'format':format,'originalBytesVerified':True,'readingFamilyPreserved':True,'parsedCacheOrStoredResultPresent':False}

def checker_sensitivity(out,cases):
    # These mutate exports only, never original sources, facts, or expectations.
    directory=out/'checker-sensitivity';directory.mkdir(exist_ok=True)
    case=next(c for c in cases if c['id']=='P01-two-sided-six-components');original=out/case['id']/'csv'/'direct.xlsx'
    check_export(original,case,'csv');book=xlsx_rows(original);results=[]
    mutations=[('computed-gross-value','Balances','TB minor units',2,'999999'),('raw-source-cell','TB inventory','Original column 13',2,'999.99'),('snapshot-identity','Records','Snapshot ID',6,'Forged snapshot'),('raw-role','Records','Balance role',6,'closing'),('component-cell-column','Component members','Source column',10,'14'),('reading-family','Reading','Value',8,'gl-tb-canonical-1')]
    for name,sheet,label,row,value in mutations:
        column=book[sheet]['rows'][0].index(label)+1;ref=col_letters(column)+str(row);dest=directory/(name+'.xlsx')
        with zipfile.ZipFile(original) as src:
            rels={r.attrib['Id']:r.attrib['Target'] for r in ET.fromstring(src.read('xl/_rels/workbook.xml.rels'))}
            selected=next(r for r in ET.fromstring(src.read('xl/workbook.xml')).findall('m:sheets/m:sheet',NS) if r.attrib['name']==sheet)
            target=rels[selected.attrib['{'+NS['r']+'}id']];part=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
            tree=ET.fromstring(src.read(part));cell=next(c for c in tree.findall('.//m:c',NS) if c.attrib['r']==ref);cell.clear();cell.attrib.update({'r':ref,'t':'inlineStr'});ET.SubElement(ET.SubElement(cell,'{'+NS['m']+'}is'),'{'+NS['m']+'}t').text=value
            with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as z:
                for entry in src.infolist():z.writestr(entry,ET.tostring(tree,encoding='utf-8',xml_declaration=True) if entry.filename==part else src.read(entry.filename))
        try:check_export(dest,case,'csv')
        except AssertionError as error:results.append({'mutation':name,'killed':True,'failureKind':'independent semantic assertion','detail':str(error)})
        else:raise AssertionError('Independent checker accepted export mutation: '+name)
    (out/'checker-sensitivity.json').write_text(json.dumps({'originalControlPassed':True,'killed':len(results),'mutations':results},indent=2)+'\n')
    return len(results)

def verify(frozen,out,contract):
    seal_inputs(frozen,contract);data=json.loads((out/'source-expectations.json').read_text());
    for case in data['cases']:
        assert case['facts']==json.loads((frozen/case['id']/'facts.json').read_text()),'Source expectation facts changed'
        scope={label:case['facts']['scope'][key] for label,key in MAPPINGS.items()}
        original_gl=parse_source(frozen/case['id']/'gl.csv','gl',scope,POLICY);original_tb=parse_source(frozen/case['id']/'tb-vertical.csv','tb',scope,POLICY)
        assert case['oracle']==reconcile(original_gl,original_tb,POLICY),'Independent oracle expectations changed'
    product=json.loads((out/'product-report.json').read_text());assert product['passed'],product
    results=[];sessions=[]
    for case in data['cases']:
        if case['facts']['requiredStatus']=='refused':continue
        for format in ['csv','xlsx']:
            directory=out/case['id']/format
            for filename in ['direct.xlsx','restored.xlsx']:results.append(check_export(directory/filename,case,format))
            sessions.append(check_session(directory/'session.json',case,format))
    killed=checker_sensitivity(out,data['cases'])
    summary={'independentCheckerMutationsKilled':killed,'passed':True,'sourceCases':30,'csvCycles':30,'nativeXlsxCycles':30,'exportsChecked':len(results),'sessionsChecked':len(sessions),'horizontalControls':data['horizontalControls'],'sealedPayloadFiles':99,'expectedFromProduct':False,'rawInventoryAndOriginalBytesVerified':True,'results':results,'sessions':sessions}
    (out/'independent-export-results.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');return summary

def main():
    parser=argparse.ArgumentParser(description='Independent frozen CSV/Decimal and native XML/ZIP GL/TB proof')
    parser.add_argument('output',nargs='?',default='work/gl-tb-vertical-proof');parser.add_argument('--prepare',action='store_true');parser.add_argument('--fixtures',default='tests/fixtures/gl-tb-vertical');parser.add_argument('--contract',default='tests/fixtures/gl-tb-vertical-contract')
    args=parser.parse_args();frozen=pathlib.Path(args.fixtures).resolve();out=pathlib.Path(args.output).resolve();contract=pathlib.Path(args.contract).resolve()
    result=prepare(frozen,out,contract) if args.prepare else verify(frozen,out,contract)
    print(json.dumps({k:v for k,v in result.items() if k not in ['cases','results','sessions','seal']},indent=2))
if __name__=='__main__':main()
