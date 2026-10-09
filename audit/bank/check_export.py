"""Independent bank movement CSV/Decimal/OpenXML fixture oracle; no product imports."""
import argparse,base64,csv,hashlib,io,json,zipfile
from decimal import Decimal
from pathlib import Path
import xml.etree.ElementTree as ET
from datetime import date,timedelta
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'


def display_styles(archive, native=False):
    """Known workpaper display profile, independently enforced from raw values.

    Exports use General and a bold header. Native fixture sources additionally
    use built-in 0.00 and date formats. Arbitrary Excel formatting is outside
    this audit contract; a correct raw value must not hide a misleading view.
    """
    def shape(node):
        return (node.tag.split('}')[-1], tuple(sorted(node.attrib.items())),
                tuple(shape(child) for child in node))
    xml = ET.fromstring(archive.read('xl/styles.xml'))
    custom = xml.find('s:numFmts', NS)
    assert custom is None or len(custom) == 0, 'unsupported custom display format'
    default_font = ET.fromstring('<font><color theme="1"/><family val="2"/><scheme val="minor"/><sz val="11"/><name val="Calibri"/></font>')
    allowed_fonts = {shape(default_font), shape(ET.fromstring('<font><b/></font>'))}
    fonts = xml.find('s:fonts', NS)
    assert fonts is not None and len(fonts) and all(shape(f) in allowed_fonts for f in fonts), 'unsupported font visibility'
    fills = xml.find('s:fills', NS)
    assert fills is not None and [shape(f) for f in fills] == [shape(ET.fromstring('<fill><patternFill patternType="none"/></fill>')), shape(ET.fromstring('<fill><patternFill patternType="gray125"/></fill>'))], 'unsupported cell background'
    borders = xml.find('s:borders', NS)
    assert borders is not None and [shape(b) for b in borders] == [shape(ET.fromstring('<border><left/><right/><top/><bottom/><diagonal/></border>'))], 'unsupported border display'
    styles = xml.find('s:cellStyleXfs', NS)
    assert styles is not None and [shape(x) for x in styles] == [shape(ET.fromstring('<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'))], 'unsupported inherited style'
    dxfs = xml.find('s:dxfs', NS)
    assert dxfs is None or not len(dxfs), 'unsupported conditional display style'
    xfs = xml.find('s:cellXfs', NS)
    assert xfs is not None and len(xfs)
    for xf in xfs:
        assert not len(xf) and set(xf.attrib) <= {'numFmtId','fontId','fillId','borderId','xfId','applyFont','applyNumberFormat'}, 'unsupported cell display attributes'
        assert xf.get('numFmtId','0') in ({'0','2','14'} if native else {'0'}), 'unsupported number display format'
        assert xf.get('fillId','0') == xf.get('borderId','0') == xf.get('xfId','0') == '0'
        assert 0 <= int(xf.get('fontId','0')) < len(fonts)
        assert all(xf.get(key,'1') == '1' for key in ['applyFont','applyNumberFormat'])
    # Both default and bold-only fonts resolve to theme black. A modified theme
    # can conceal them without touching cell styles, so check its actual colors.
    drawing = {'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
    theme = ET.fromstring(archive.read('xl/theme/theme1.xml'))
    colors = theme.find('a:themeElements/a:clrScheme', drawing)
    assert colors is not None
    for key,system,rgb in [('dk1','windowText','000000'),('lt1','window','FFFFFF')]:
        node = colors.find('a:'+key, drawing)
        assert node is not None and len(node)==1 and node[0].tag.endswith('}sysClr') and node[0].attrib == {'val':system,'lastClr':rgb}, 'unsupported theme visibility'
    return [xf.get('numFmtId','0') for xf in xfs]


def sheets(path, native=False):
    result = {}
    with zipfile.ZipFile(path) as archive:
        styles = display_styles(archive, native)
        style_count = len(styles)
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            nodes=ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si',NS)
            assert all(len(n)==1 and n[0].tag=='{'+NS['s']+'}t' for n in nodes), 'unsupported hidden/rich string content'
            strings = [n[0].text or '' for n in nodes]
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        properties = workbook.find('s:workbookPr', NS)
        assert properties is None or properties.get('date1904','0') in ['0','false'], 'unsupported workbook date system'
        relations = {node.attrib['Id']: node.attrib['Target'].lstrip('/') for node in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        source_sheets = workbook.findall('s:sheets/s:sheet', NS)
        for key in ['name','sheetId',R]:
            values = [s.get(key) for s in source_sheets]
            assert all(values) and len(values)==len(set(v.casefold() if key=='name' else v for v in values)), 'duplicate or missing sheet identity'
        for sheet in source_sheets:
            assert sheet.get('state','visible')=='visible', 'hidden export sheet'
            target = relations[sheet.attrib[R]]
            if not target.startswith('xl/'):
                target = 'xl/' + target
            rows = []
            xml=ET.fromstring(archive.read(target));assert xml.find('s:mergeCells',NS) is None
            assert not any(node.tag.rsplit('}',1)[-1] in ['conditionalFormatting','drawing','legacyDrawing','picture','extLst'] for node in xml.iter()), 'unsupported sheet display overlay'
            assert all(view.get('showZeros','1')=='1' and float(view.get('zoomScale','100'))>=100 for view in xml.findall('s:sheetViews/s:sheetView',NS)), 'unsupported sheet visibility'
            dimensions = xml.find('s:sheetFormatPr',NS)
            if dimensions is not None:
                assert dimensions.get('zeroHeight','0') == '0'
                assert float(dimensions.get('defaultRowHeight','15')) >= 15 and float(dimensions.get('defaultColWidth','9')) >= 9, 'tiny default dimensions'
            assert all(c.get('hidden','0')=='0' and float(c.get('width','24')) >= (9 if native else 24) and 0 <= int(c.get('style','0')) < style_count for c in xml.findall('s:cols/s:col',NS)), 'hidden or styled column'
            if native:
                for column in xml.findall('s:cols/s:col',NS):
                    fmt=styles[int(column.get('style','0'))]
                    assert fmt=='0' or (fmt=='2' and column.get('min')==column.get('max')=='17'), 'native column format differs from meaning'
            for row_index,row in enumerate(xml.findall('s:sheetData/s:row',NS),1):
                assert int(row.attrib['r'])==row_index and row.get('hidden','0')=='0' and float(row.get('ht','15')) >= 15 and 0 <= int(row.get('s','0')) < style_count, 'hidden or styled row'
                assert not native or styles[int(row.get('s','0'))]=='0', 'native inherited row format'
                cells = {}
                for cell in row.findall('s:c', NS):
                    assert cell.get('t') in [None,'n','s'], 'unsupported displayed cell type'
                    assert 0 <= int(cell.get('s','0')) < style_count, 'unknown cell display style'
                    assert cell.find('s:f', NS) is None, 'unexpected executable formula'
                    index = 0
                    for char in ''.join(c for c in cell.attrib['r'] if c.isalpha()):
                        index = index * 26 + ord(char) - 64
                    if native:
                        # This native fixture family has fixed canonical columns.
                        # Date serial conversion is justified by its date style,
                        # never by a global number-format allowlist.
                        fmt = styles[int(cell.get('s',row.get('s','0')))]
                        assert fmt=='0' or (fmt=='2' and index==17) or (fmt=='14' and row_index>1 and index in [3,4,15,16]), 'native format differs from column meaning'
                        if row_index>1 and index in [3,4,15,16,17]:
                            assert cell.get('t') not in ['s','str','inlineStr'] and fmt==('2' if index==17 else '14'), 'native value type differs from column meaning'
                    assert int(''.join(c for c in cell.attrib['r'] if c.isdigit()))==row_index and index-1 not in cells
                    value = cell.find('s:v', NS)
                    raw = value.text if value is not None else ''
                    assert cell.get('t')=='s' or not raw or re.fullmatch(r'-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?',raw), 'invalid displayed numeric value'
                    if cell.get('t')=='s':
                        assert re.fullmatch(r'\d+',raw) and 0<=int(raw)<len(strings), 'invalid shared string index'
                    cells[index-1] = strings[int(raw)] if cell.get('t') == 's' else raw
                rows.append([cells.get(i, '') for i in range(max(cells, default=-1)+1)])
            result[sheet.attrib['name']] = rows
    return result


import re,unicodedata

def visible(v,maxlen=500,identity=False):
    assert isinstance(v,str) and v and v==v.strip() and len(v.encode('utf-16-le'))//2<=maxlen
    assert all(unicodedata.category(c) not in ['Cc','Cf'] for c in v), 'invisible review evidence'
    assert not identity or not re.match(r'^[=+@-]|^#(?:REF!|VALUE!|N/A|DIV/0!)',v,re.I)
    return v


def verify(path,contract='outgoing-fees',native_sources=None,through=None,profile=None):
    # Explicit frozen test profile only; defaults preserve the original B1 contracts.
    root=Path(profile['root']) if profile else Path(__file__).parent/'frozen'
    truth=profile['truth'] if profile else json.loads((root/'expected.json').read_text());expected=next(c for c in truth['cases'] if c['name']==contract)
    version=truth['version'];scope=truth['scope'];book=sheets(path);summary=dict(book['Summary'][1:]);assert len(summary)==len(book['Summary'])-1
    assert summary['Domain']=='bank-cash-movements' and summary['Version']==version and summary['Decimals']=='2' and summary['Confirmed']=='true'
    assert all(summary[k]==v for k,v in scope.items());assert summary['Claim']=='Movement comparison only; no opening/closing balance bridge, ERP posting, source authenticity or period completeness assurance'
    assert set(book)=={'Summary','Movements','Cell evidence','Groups','Group members','Timing items','Events','Event members','Inventory','Reading','Sources'}
    headers={"Summary": ["Property", "Value"], "Movements": ["ID", "Side", "Source row", "Own reference", "Settlement", "Movement date", "Value date", "Cash direction", "Role", "Parent payment", "Reverses", "Policy", "Status", "Amount minor units", "Signed minor units"], "Cell evidence": ["ID", "Side", "Source row", "Field", "Source column", "Original text"], "Groups": ["Case ID", "Source identity", "Kind", "Status", "Reason", "Eligible", "Policy", "Bank minor units", "Cash minor units", "Difference minor units", "Timing review"], "Group members": ["Case ID", "Side", "Member ID"], "Timing items": ["ID", "Side", "Source row", "Own reference", "Movement date", "Value date", "Outside period", "Valid movement"], "Events": ["Index", "Decision", "Type", "Context", "Device UTC", "Evidence reference", "Reason"], "Event members": ["Decision", "Side", "Member ID"], "Inventory": ["ID", "Side", "Source row", "Kind", "Error", "Original cells"], "Reading": ["Side", "Sheet index", "Role", "Family", "Perspective", "Confirmed"], "Sources": ["Side", "Name", "SHA256", "Chunk index", "Base64"]}
    assert all(book[name][0]==columns for name,columns in headers.items())
    files=[dict(f) for f in expected['files']]
    if native_sources:
        assert len(native_sources)==2 and (profile is not None or contract in ['outgoing-fees','timing-after-cutoff'])
        for f,p in zip(files,native_sources):f['sha256']=hashlib.sha256(Path(p).read_bytes()).hexdigest()
    roles=['bank-statement','cashbook'];readings=[[0,role,version,'company-cash',True] for role in roles]
    assert book['Reading'][1:]==[[str(i),'0',role,version,'company-cash','true'] for i,role in enumerate(roles)]
    context=json.dumps([version,[f['sha256'] for f in files],readings,list(scope.values()),True],separators=(',',':'));assert summary['Context']==context
    originals=[]
    for side,f in enumerate(files):
        data=Path(native_sources[side]).read_bytes() if native_sources else (root/f['file']).read_bytes();assert hashlib.sha256(data).hexdigest()==f['sha256']
        chunks=[r for r in book['Sources'][1:] if r[0]==str(side)];assert chunks and [int(r[3]) for r in chunks]==list(range(len(chunks)))
        assert all(r[1] and r[2]==f['sha256'] for r in chunks)
        encoded=''.join(r[4] for r in chunks);assert base64.b64decode(encoded,validate=True)==data;assert base64.b64encode(data).decode()==encoded
        original=list(csv.reader(io.StringIO((root/expected['files'][side]['file']).read_text())))
        if native_sources:
            native=sheets(native_sources[side],native=True);assert len(native)==1;rows=next(iter(native.values()));assert rows[0]==original[0]
            for r in rows[1:]:
                for col in [2,3,14,15]:
                    value=Decimal(r[col]);assert value==value.to_integral_value();r[col]=(date(1899,12,30)+timedelta(days=int(value))).isoformat()
            assert len(rows)==len(original)
            for a,b in zip(rows,original):
                assert a[:-1]==b[:-1]
                assert a[-1]==b[-1] or Decimal(a[-1])==Decimal(b[-1])
            original=rows
        originals.append(original)
    assert len(book['Sources'][1:])==sum(len([r for r in book['Sources'][1:] if r[0]==str(s)]) for s in [0,1])
    def rid(side,row):return f"{side}:{files[side]['sha256']}:0:{row}"
    records=expected['records'];byref={(r['side'],r['reference']):r for r in records};byid={rid(r['side'],r['row']):r for r in records}
    movement=[];cells=[]
    for r in records:
        side=r['side'];original=originals[side][r['row']-1];columns={h:i for i,h in enumerate(originals[side][0])}
        # Frozen facts predate the product; Decimal checks the source, never a product result.
        minor=Decimal(original[columns['Amount']])*100;assert minor==minor.to_integral_value()==r['amount'];assert r['signed']==r['amount']*(1 if r['direction']=='inflow' else -1)
        assert date.fromisoformat(r['movementDate']).isoformat()==r['movementDate'];assert date.fromisoformat(r['valueDate']).isoformat()==r['valueDate']
        movement.append([rid(side,r['row']),str(side),str(r['row']),r['reference'],r['settlement'],r['movementDate'],r['valueDate'],r['direction'],r['role'],r['parent'],r['reverses'],r['policy'],'posted' if side else 'booked',str(r['amount']),str(r['signed'])])
        cells.extend([rid(side,r['row']),str(side),str(r['row']),h,str(col+1),original[col]] for h,col in columns.items())
    assert book['Movements'][1:]==movement and book['Cell evidence'][1:]==cells
    inv=book['Inventory'][1:];assert len(inv)==len(expected['inventory'])
    for actual,e in zip(inv,expected['inventory']):
        side=e['side'];row=e['row'];assert actual[:4]==[rid(side,row),str(side),str(row),e['kind']];assert bool(actual[4])==(e['kind']=='error');assert json.loads(actual[5])==originals[side][row-1]
    timing=[]
    for t in expected['timingItems']:
        assert date.fromisoformat(t['valueDate']).isoformat()==t['valueDate'];assert not(scope['start']<=t['valueDate']<=scope['end'])
        timing.append([rid(t['side'],t['row']),str(t['side']),str(t['row']),t['reference'],t['movementDate'],t['valueDate'],'true',str(t['validMovement']).lower()])
    assert book['Timing items'][1:]==timing, 'timing must survive accept undo session export'
    groups=[]
    def caseid(kind,key):return json.dumps([version,[f['sha256'] for f in files],json.dumps([kind,*key],separators=(',',':'))],separators=(',',':'))
    for g in expected['groups']:
        m=[byref[(side,ref)] for side,refs in [(0,g['bank']),(1,g['cash'])] for ref in refs];first=m[0];kind='reference' if first['settlement'] else 'missing';cid=caseid('reference',[first['settlement']]) if kind=='reference' else caseid('blank',[first['side'],first['reference']])
        groups.append(dict(g,id=cid,kind=kind,bankIds=[rid(0,byref[(0,r)]['row']) for r in g['bank']],cashIds=[rid(1,byref[(1,r)]['row']) for r in g['cash']],policy=first['policy'] if len({r['policy'] for r in m})==1 else '',timingReview=g['eligible'] and (len({r['movementDate'] for r in m})!=1 or len({r['valueDate'] for r in m})!=1 or any(not(scope['start']<=r['valueDate']<=scope['end']) for r in m))))
    actions=[a for a in expected['actions'] if not a.get('reject')];actions=actions if through is None else actions[:through]
    events=book['Events'][1:];assert len(events)==len(actions);assert not(expected['sourceError'] and events)
    seen=set();eventmembers=[]
    for i,(a,e) in enumerate(zip(actions,events)):
        assert len(e)==7 and e[0]==str(i) and e[2]==a['type'] and e[3]==context
        visible(e[1],identity=True);visible(e[5],identity=True);visible(e[6],2000);assert e[1] not in seen;seen.add(e[1]);assert re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z',e[4]);datetime_value=__import__('datetime').datetime.fromisoformat(e[4].replace('Z','+00:00'));assert datetime_value.isoformat(timespec='milliseconds').replace('+00:00','Z')==e[4]
        bids=[rid(0,byref[(0,r)]['row']) for r in a['bank']];cids=[rid(1,byref[(1,r)]['row']) for r in a['cash']];eventmembers.extend([e[1],str(side),id] for side,ids in [(0,bids),(1,cids)] for id in ids)
        target=next((g for g in groups if set(g['bankIds'])==set(bids) and set(g['cashIds'])==set(cids)),None)
        if target:
            if a['type']=='accept':assert target['eligible'] and target['deltaMinor']==0 and target['status']=='needs-review';target.update(status='matched-manual',reason='human-review')
            else:
                assert target['status'] in ['matched-evidence','matched-manual']
                if target['kind']=='human':
                    groups.remove(target)
                    for id in bids+cids:
                        r=byid[id];key=f"blank:{r['side']}:{r['reference']}";groups.append(dict(id=caseid('blank',[r['side'],r['reference']]),key=key,kind='missing',bankIds=[id] if not r['side'] else [],cashIds=[id] if r['side'] else [],bankMinor=r['signed'] if not r['side'] else 0,cashMinor=r['signed'] if r['side'] else 0,deltaMinor=-r['signed'] if r['side'] else r['signed'],status='needs-review',reason='missing-identity',eligible=False,policy=r['policy'],timingReview=False))
                else:target.update(status='needs-review',reason='undone')
        else:
            assert a['type']=='accept' and len(bids)==len(cids)==1
            b=byid[bids[0]];c=byid[cids[0]];assert not b['settlement'] and not c['settlement'];assert b['policy']==c['policy']=='individual' and b['direction']==c['direction'] and b['role']==c['role'] and b['amount']==c['amount']
            singles=[g for g in groups if set(g['bankIds']+g['cashIds']) & set(bids+cids)];assert len(singles)==2 and all(g['status']=='needs-review' and len(g['bankIds']+g['cashIds'])==1 for g in singles)
            for g in singles:groups.remove(g)
            groups.append(dict(id=json.dumps([version,'manual',bids[0],cids[0]],separators=(',',':')),key=f'manual:{bids[0]}:{cids[0]}',kind='human',bankIds=bids,cashIds=cids,bankMinor=b['signed'],cashMinor=c['signed'],deltaMinor=0,status='matched-manual',reason='human-review',eligible=True,policy='individual',timingReview=b['movementDate']!=c['movementDate'] or b['valueDate']!=c['valueDate'] or any(not(scope['start']<=r['valueDate']<=scope['end']) for r in [b,c])))
    assert book['Event members'][1:]==eventmembers
    actualgroups=[];membership=[]
    for g in groups:
        assert sum(byid[id]['signed'] for id in g['bankIds'])==g['bankMinor'];assert sum(byid[id]['signed'] for id in g['cashIds'])==g['cashMinor'];assert g['bankMinor']-g['cashMinor']==g['deltaMinor']
        if g['status'].startswith('matched'):assert g['eligible'] and g['deltaMinor']==0
        actualgroups.append([g['id'],g['key'],g['kind'],g['status'],g['reason'],str(g['eligible']).lower(),g['policy'],str(g['bankMinor']),str(g['cashMinor']),str(g['deltaMinor']),str(g['timingReview']).lower()]);membership.extend([g['id'],str(side),id] for side,ids in [(0,g['bankIds']),(1,g['cashIds'])] for id in ids)
    assert book['Groups'][1:]==actualgroups and book['Group members'][1:]==membership
    assert len(set(r[2] for r in membership))==len(membership)==len(records), 'every valid row belongs to exactly one whole movement case'
    status='source-error' if expected['sourceError'] else 'empty' if not records else 'movements-consistent' if all(g['status'].startswith('matched') for g in groups) else 'needs-review';assert summary['Status']==status
    return dict(contract=contract,records=len(records),groups=len(groups),events=len(events),timingItems=len(timing),passed=True,sample='synthetic-not-field')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('file');p.add_argument('--contract',default='outgoing-fees');p.add_argument('--native-sources',nargs=2);p.add_argument('--through',type=int);a=p.parse_args();print(json.dumps(verify(a.file,a.contract,a.native_sources,a.through),indent=2))
