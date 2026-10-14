"""Independent instrument control workbook writer; not product code."""
import base64
import json
from xml.sax.saxutils import escape
from zipfile import ZipFile
from oracle import FIELDS,SCOPE,check_case,verify_truth
from check_export import VERSION,SECTION_FAMILY,SCOPE_KEYS,ROLES,REGISTER_BASIS,matrix_citations

def write_workbook(path, tables):
    def col(number):
        text = ''
        while number:
            number, rem = divmod(number - 1, 26); text = chr(65 + rem) + text
        return text
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    with ZipFile(path, 'w') as archive:
        names = list(tables)
        archive.writestr('xl/workbook.xml', f'<workbook xmlns="{ns}" xmlns:r="{rel}"><sheets>' + ''.join(f'<sheet name="{escape(name)}" sheetId="{n}" r:id="s{n}"/>' for n, name in enumerate(names, 1)) + '</sheets></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(f'<Relationship Id="s{n}" Type="{rel}/worksheet" Target="worksheets/sheet{n}.xml"/>' for n in range(1,len(names)+1)) + '</Relationships>')
        for number, rows in enumerate(tables.values(), 1):
            body = ''
            for r, row in enumerate(rows, 1):
                cells = ''
                for c, value in enumerate(row, 1):
                    address = f'{col(c)}{r}'
                    cells += f'<c r="{address}"><v>{value}</v></c>' if isinstance(value, (int, float)) else f'<c r="{address}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
                body += f'<row r="{r}">{cells}</row>'
            archive.writestr(f'xl/worksheets/sheet{number}.xml', f'<worksheet xmlns="{ns}"><sheetData>{body}</sheetData></worksheet>')


def reference_tables(folder):
    observation=check_case(folder); verify_truth(observation); sources=observation['sources']
    scope=dict(zip(SCOPE_KEYS,[sources[0]['records'][0]['scope'][label] for label in SCOPE]))
    readings=[{'sheet':0,'role':role,'family':SECTION_FAMILY if i==0 else VERSION,'confirmed':True} for i,role in enumerate(ROLES)]
    context=[VERSION,[source['sha256'] for source in sources],readings,dict(scope,confirmed=True),{'confirmed':False,'reference':'','note':''}]
    tables={'Summary':[['Field','Value']]+[[key,value] for key,value in {'Version':VERSION,'Decimals':3,'Financial':observation['financial'],'Review':'needs-review','Status':'needs-review' if observation['financial']=='ready' else observation['financial'],'Register minor':observation['totals']['registerMinor'],'GL minor':667134,'Register minor basis':REGISTER_BASIS,'Scope confirmed':'true','Completeness confirmed':'false','Completeness reference':'','Completeness note':'',**scope,'Context':json.dumps(context,separators=(',',':'))}.items()]}
    units={'Quantity':'Quantity scaled integer','Posted value':'Posted value minor','Debit':'Debit minor','Credit':'Credit minor'}
    from decimal import Decimal
    cells=[]; inventory=[]; embedded=[]
    for index,source in enumerate(sources):
        base=['Record ID','Source','Source row']+(['Source column'] if index==0 else [])
        table=[base+[units.get(field,field) for field in FIELDS[index]]]
        for record in source['records']:
            identity=[VERSION,index,source['sha256'],0,record['sourceRow']]+([record['column']] if index==0 else [])
            values=[record['quantityUnits'] if field=='Quantity' else record['postedValueMinor'] if field=='Posted value' else int(Decimal(record['raw'][field])*1000) if field in ['Debit','Credit'] else int(record['raw'][field]) if field=='Quantity precision' else record['raw'][field] for field in FIELDS[index]]
            table.append([json.dumps(identity,separators=(',',':')),index,record['sourceRow']]+([record['column']] if index==0 else [])+values)
        tables[['Register','Mapping','Policy evidence','GL balances'][index]]=table
        headers=[c['raw'] for c in source['inventory'][0]['cells']]; width=max(len(r['cells']) for r in source['inventory']) if source['name'].endswith('.xlsx') else None
        for row in source['inventory']:
            inventory.append([index,row['row'],row['fate']]); raw=[c['raw'] for c in row['cells']]; values=raw+['']*(width-len(raw)) if width is not None else raw; label=raw[1] if raw and raw[0]=='Scope' else raw[0] if raw else ''
            cells += [[index,row['row'],c+1,label if index==0 else headers[c],value] for c,value in enumerate(values)]
        data=base64.b64encode((folder/source['name']).read_bytes()).decode(); chunks=[data[n:n+30000] for n in range(0,len(data),30000)]
        embedded += [[index,ROLES[index],source['name'],source['sheetName'],source['sha256'],n+1,len(chunks),chunk] for n,chunk in enumerate(chunks)]
    missing=[]
    if observation['financial']=='missing': missing=['evidence:["0014","plant=P1;batch=K1"]','evidence:["0014","plant=P2;batch=K2"]','account:["INV-RM","plant=P1;branch=10"]','account:["INV-RM","plant=P2;branch=20"]']
    tables.update({
      'Account comparisons':[['GL account','GL dimensions','Register minor','Debit minor','Credit minor','GL minor','Difference minor']]+[[c['account'],c['dimensions'],c['registerMinor'],c['debitMinor'],c['creditMinor'],c['debitMinor']-c['creditMinor'],c['differenceMinor']] for c in observation['comparisons']],
      'Missing':[['Missing']]+[[value] for value in missing], 'Issues':[['Source','Source row','Source column','Code']],
      'Inventory':[['Source','Source row','Kind']]+inventory, 'Cell evidence':[['Source','Source row','Column','Field','Text']]+cells,
      'Reading':[['Source','Role','Family','Sheet','Confirmed']]+[[i,role,SECTION_FAMILY if i==0 else VERSION,0,'true'] for i,role in enumerate(ROLES)],
      'Events':[['Event ID','Type','Context','At','Reference','Note','Member count']], 'Event members':[['Event ID','Member ID']],
      'Sources':[['Source','Role','Name','Sheet','SHA256','Part','Parts','Base64']]+embedded,
      'Matrix citations':[['Record ID','Source','SHA256','Sheet index','Sheet','Source row','Column','Field','Text','Kind','Band header row','Fact column']]+matrix_citations(sources[0]),
    })
    return tables


def event_reference_tables(folder,undone=False,event_id='INV1C-ACCEPT',event_at='2026-11-01T00:00:00.000Z'):
    tables=reference_tables(folder); observation=check_case(folder); verify_truth(observation)
    assert observation['financial']=='ready','ACCEPT_FINANCIAL'
    summary=dict(tables['Summary'][1:]); context=json.loads(summary['Context'])
    context[-1]={'confirmed':True,'reference':'INV1C synthetic whole scope','note':'Synthetic matrix attestation only'}
    summary.update({'Review':'needs-review' if undone else 'accepted','Status':'needs-review' if undone else 'consistent-with-evidence','Completeness confirmed':'true','Completeness reference':'INV1C synthetic whole scope','Completeness note':'Synthetic matrix attestation only','Context':json.dumps(context,separators=(',',':'))})
    tables['Summary']=[['Field','Value']]+[[key,value] for key,value in summary.items()]
    members=[]
    for source in observation['sources']:
        for row in source['inventory']:
            if row['row']>1 and any(c['raw']!='' for c in row['cells']): members.append(json.dumps([VERSION,source['role'],source['sha256'],0,row['row']],separators=(',',':')))
    context_text=json.dumps(context,separators=(',',':'))
    tables['Events'].append([event_id,'accept',context_text,event_at,'INV1C synthetic approval','Synthetic matrix review only',len(members)])
    tables['Event members'] += [[event_id,member] for member in members]
    if undone:
        tables['Events'].append(['INV1C-UNDO','undo',context_text,'2026-11-01T00:00:01.000Z','INV1C synthetic approval','Synthetic matrix review only',len(members)])
        tables['Event members'] += [['INV1C-UNDO',member] for member in members]
    return tables
