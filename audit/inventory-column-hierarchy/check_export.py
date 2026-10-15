"""Independent column hierarchy output check; OpenXML reader retained from INV-1C's audited checker."""
import argparse,json,re,posixpath,base64,hashlib
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
from decimal import Decimal
from oracle import inspect,read,SCOPE,coordinate
NS='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
DRAW='{http://schemas.openxmlformats.org/drawingml/2006/main}'
def integer(value):
    number = Decimal(str(value))
    assert number.is_finite() and number == number.to_integral_value(), 'NONINTEGER_NUMBER'
    return int(number)


def read_workbook(path):
    with ZipFile(path) as archive:
        names = archive.namelist()
        assert len(names) == len(set(names)) and len(names) < 1000, 'ZIP_MEMBERS'
        assert sum(e.file_size for e in archive.infolist()) <= 32 * 1024 * 1024, 'ZIP_SIZE'
        def xml(name):
            raw = archive.read(name)
            assert b'<!DOCTYPE' not in raw and b'<!ENTITY' not in raw, 'XML_DTD'
            return ET.fromstring(raw)
        assert not any('/drawings/' in name or '/externalLinks/' in name or 'vbaProject' in name for name in names), 'OUTPUT_DISPLAY_PARTS'
        if 'xl/theme/theme1.xml' in names:
            dark = xml('xl/theme/theme1.xml').find(DRAW + 'themeElements/' + DRAW + 'clrScheme/' + DRAW + 'dk1')
            assert dark is not None and len(dark) == 1 and dark[0].get('lastClr', dark[0].get('val')) == '000000', 'OUTPUT_DISPLAY_THEME'
        styles = xml('xl/styles.xml') if 'xl/styles.xml' in names else None
        xfs = []
        if styles is not None:
            assert not styles.findall(NS + 'numFmts/' + NS + 'numFmt') and not styles.findall(NS + 'dxfs/' + NS + 'dxf'), 'OUTPUT_DISPLAY_FORMAT'
            for font in styles.findall(NS + 'fonts/' + NS + 'font'):
                assert font.find(NS + 'vanish') is None and font.find(NS + 'strike') is None, 'OUTPUT_DISPLAY_FONT'
                color = font.find(NS + 'color')
                assert color is None or dict(color.attrib) in [{'theme':'1'}, {'rgb':'FF000000'}], 'OUTPUT_DISPLAY_FONT'
                size = font.find(NS + 'sz')
                assert size is None or Decimal(size.get('val', '0')) >= 10, 'OUTPUT_DISPLAY_FONT'
            xfs = styles.findall(NS + 'cellXfs/' + NS + 'xf')
            assert all(xf.get('numFmtId', '0') == '0' and xf.get('fillId', '0') == '0' and xf.get('fontId', '0') == '0' and xf.find(NS + 'alignment') is None and not any(key.startswith('apply') for key in xf.attrib) for xf in xfs), 'OUTPUT_DISPLAY_XF'
        strings = [''.join(t.text or '' for t in si.iter(NS + 't')) for si in xml('xl/sharedStrings.xml')] if 'xl/sharedStrings.xml' in names else []
        relationships = list(xml('xl/_rels/workbook.xml.rels'))
        assert len({e.get('Id') for e in relationships}) == len(relationships), 'DUPLICATE_RELATIONSHIP'
        links = {e.get('Id'): e for e in relationships}
        tables, used = {}, set()
        for sheet in xml('xl/workbook.xml').findall(NS + 'sheets/' + NS + 'sheet'):
            name = sheet.get('name'); assert name not in tables and sheet.get('state') in [None, 'visible'], 'SHEET_IDENTITY'
            link = links[sheet.get(REL + 'id')]
            assert link.get('TargetMode') != 'External' and link.get('Type', '').endswith('/worksheet'), 'SHEET_RELATIONSHIP'
            target = posixpath.normpath(posixpath.join('xl', link.get('Target', ''))) if not link.get('Target', '').startswith('/') else link.get('Target')[1:]
            assert target.startswith('xl/') and target in names and target not in used, 'SHEET_TARGET'
            used.add(target); root = xml(target); data = root.findall(NS + 'sheetData')
            assert len(data) == 1 and root.find(NS + 'mergeCells') is None, 'SHEET_STRUCTURE'
            assert not any(root.find(NS + feature) is not None for feature in ['conditionalFormatting','drawing','legacyDrawing','hyperlinks']), 'OUTPUT_DISPLAY_FEATURE'
            assert all(view.get('showZeros') not in ['0','false'] for view in root.findall(NS + 'sheetViews/' + NS + 'sheetView')), 'OUTPUT_DISPLAY_ZERO'
            assert all(column.get('hidden') not in ['1','true'] and ('width' not in column.attrib or Decimal(column.get('width')) > 0) for column in root.findall(NS + 'cols/' + NS + 'col')), 'OUTPUT_DISPLAY_COLUMN'
            rows, occupied = [], set()
            for row in data[0]:
                assert row.tag == NS + 'row' and row.get('hidden') not in ['1', 'true'], 'ROW_VISIBILITY'
                assert row.get('ht') is None or Decimal(row.get('ht')) > 0, 'OUTPUT_DISPLAY_ROW'
                number = integer(row.get('r')); assert number == len(rows) + 1, 'ROW_ORDER'
                values = []
                for cell in row:
                    address = re.fullmatch(r'([A-Z]+)([1-9][0-9]*)', cell.get('r', ''))
                    assert cell.tag == NS + 'c' and address and int(address[2]) == number, 'CELL_ADDRESS'
                    column = 0
                    for char in address[1]: column = column * 26 + ord(char) - 64
                    assert column <= 100 and (number, column) not in occupied and cell.find(NS + 'f') is None, 'CELL_DUPLICATE_OR_FORMULA'
                    occupied.add((number, column)); kind = cell.get('t', 'n'); raw = cell.findtext(NS + 'v')
                    assert 's' not in cell.attrib or cell.get('s').isdigit() and int(cell.get('s')) < len(xfs), 'OUTPUT_DISPLAY_STYLE_INDEX'
                    if kind == 's':
                        assert raw is not None and re.fullmatch(r'0|[1-9][0-9]*', raw), 'STRING_INDEX'
                        index = int(raw); assert index < len(strings), 'STRING_BOUND'; value = strings[index]
                    elif kind == 'inlineStr': value = ''.join(t.text or '' for t in cell.findall(NS + 'is/' + NS + 't'))
                    elif kind == 'n': value = integer(raw) if raw is not None else ''
                    else: raise AssertionError('UNSUPPORTED_CELL_TYPE')
                    while len(values) < column: values.append('')
                    values[column - 1] = value
                rows.append(values)
            tables[name] = rows
    return tables

VERSION = 'inventory-posted-register-gl-1'
FAMILY = 'inventory-column-hierarchy-1'
CITE_HEADERS = ['Record ID','Source','SHA256','Sheet index','Sheet','Source row','Column','Field','Text','Kind','Parent row','Batch row','Panel end row','Axis row','Record column','Merge range','Derived dimensions']
def citations(folder, observed):
    source = next(folder.glob('register.*'))
    rows, merges, stored, part = read(source)
    sha = hashlib.sha256(source.read_bytes()).hexdigest()
    sheet = 'CSV' if source.suffix == '.csv' else 'Column dimensions'
    out = []
    def raw(row, column):
        return rows[row-1][column-1] if column <= len(rows[row-1]) else ''
    def add(identity, row, column, field, kind, context=None):
        out.append([identity,0,sha,0,sheet,row,column,field,raw(row,column),kind,*(context if context is not None else ['','','','','','',''])])
    add('',1,1,'Title','format')
    keys=['entity','inventoryLedger','glLedger','currency','currencyBasis','postingStatus','postingLayer','asOf','chartVersion','mapVersion','valuationPolicyVersion','inventoryAccountSetVersion']
    for n,row in enumerate(rows,1):
        if row and row[0] in SCOPE:
            add('',n,2,keys[SCOPE.index(row[0])],'scope')
    for fact in observed['facts']:
        column=fact['column']; row=fact['fields']['Item ID']['value'][0]
        identity=json.dumps([FAMILY,0,sha,0,row,column],separators=(',',':'))
        pr,pc,parent=fact['parent'];br,bc,batch=fact['batch'];ar,ac,axis=fact['axis']
        geometry=''
        if fact['merge']:
            first,last=fact['merge'].split(':');top,left=coordinate(first);bottom,right=coordinate(last)
            geometry=json.dumps([top,left,bottom,right],separators=(',',':'))
        context=[pr,br,fact['panelEnd'],ar,column,geometry,fact['values'][1]]
        for field,pair in fact['fields'].items():
            for key,kind in [('value','value'),('role','role')]:
                r,c,value=pair[key];add(identity,r,c,field,kind,context)
        add(identity,ar,ac,'Axis','axis',context)
        add(identity,pr,1,rows[pr-1][0].lower(),'dimension-role',context)
        add(identity,pr,pc,rows[pr-1][0].lower(),'dimension-value',context)
        add(identity,br,1,'batch','dimension-role',context)
        add(identity,br,bc,'batch','dimension-value',context)
        add(identity,fact['panelEnd'],1,'End panel','boundary',context)
    for n,row in enumerate(rows,1):
        if row and row[0]=='Report total':add('',n,2,'Report total','control')
        if row and row[0]=='End report':add('',n,1,'End report','report-end')
    return out

def check(book, folder, mode='pending'):
    observed=inspect(folder);tables=read_workbook(book)
    norm=lambda r:[None if v=='' else v for v in r]
    def table(name,headers=None):
        assert name in tables,'MISSING_TABLE '+name
        if headers is not None:assert tables[name][0]==headers,('HEADER',name)
        return [norm(row+['']*(len(tables[name][0])-len(row))) for row in tables[name][1:]]
    summary=dict(table('Summary'))
    assert summary['Financial']==observed['financial'],'FINANCIAL_SUMMARY'
    assert summary['Review']==('accepted' if mode=='accepted' else 'needs-review'),'REVIEW_STATE'
    expected_status=observed['financial'] if observed['financial']!='ready' else 'consistent-with-evidence' if mode=='accepted' else 'needs-review'
    assert summary['Status']==expected_status,'UNPROVED_COMPLETE_STATUS'
    source=next(folder.glob('register.*'));expected_files=[source]+[folder/f'source-{i}.csv' for i in range(1,4)]
    sources=table('Sources');headers=tables['Sources'][0];data=[dict(zip(headers,row)) for row in sources];members=[]
    assert set(row['Source'] for row in data)=={0,1,2,3},'FOREIGN_SOURCE'
    for i,file in enumerate(expected_files):
        selected=sorted([row for row in data if row['Source']==i],key=lambda row:row['Part']);assert selected,'MISSING_ORIGINAL'
        original=file.read_bytes();sha=hashlib.sha256(original).hexdigest()
        assert [row['Part'] for row in selected]==list(range(1,len(selected)+1)) and all(row['Parts']==len(selected) for row in selected),'SOURCE_PARTS'
        encoded=''.join(row['Base64'] for row in selected)
        decoded=base64.b64decode(encoded,validate=True)
        assert decoded==original and base64.b64encode(decoded).decode()==encoded,'SOURCE_BYTES'
        assert all(row['SHA256']==sha for row in selected),'SOURCE_HASH'
        assert all(row['Role']==['register','mapping','policy-evidence','gl'][i] and row['Name']==file.name for row in selected),'SOURCE_ROLE'
        rows,merges,stored,part=read(file)
        for n,row in enumerate(rows,1):
            if n>1 and any(v!='' for v in row):members.append(json.dumps([VERSION,i,sha,0,n],separators=(',',':')))
    if observed['financial']=='source-error':
        assert summary['Register minor'] is None and summary['GL minor'] is None,'ERROR_MONEY'
        assert table('Issues'),'ERROR_DIAGNOSTICS'
        for row in table('Account comparisons'):
            assert row[2:]==[None]*5,'ERROR_COMPARISON_MONEY'
        assert mode=='pending' and not table('Events'),'ERROR_APPROVAL'
        return {'pass_':True,'case':observed['id'],'financial':'source-error','originals':True,'blockedMoney':True}
    assert summary['Register minor']==observed['totals']['registerMinor'] and summary['GL minor']==observed['totals']['glMinor'],'FINANCIAL_TOTALS'
    records=table('Register',['Record ID','Source','Source row','Source column','Item ID','Item dimensions','Quantity scaled integer','Unit','Quantity precision','Posted value minor','Valuation reference'])
    sha=hashlib.sha256(source.read_bytes()).hexdigest()
    assert records==[[json.dumps([FAMILY,0,sha,0,f['fields']['Item ID']['value'][0],f['column']],separators=(',',':')),0,f['fields']['Item ID']['value'][0],f['column'],*f['values']] for f in observed['facts']],'REGISTER_QUANTITY_DIMENSIONS_MONEY'
    sort=lambda rows:sorted([norm(row) for row in rows],key=lambda row:json.dumps(row,separators=(',',':')))
    assert sort(table('Column citations',CITE_HEADERS))==sort(citations(folder,observed)),'COLUMN_SOURCE_OWNERSHIP'
    assert table('Account comparisons')==observed['comparisons'],'ACCOUNT_DIMENSIONS_AND_MONEY'
    assert table('Issues')==[],'UNEXPECTED_ISSUES'
    companion_fields=[['Mapping ID','Item ID','Item dimensions','GL account','GL dimensions','Evidence ID'],['Evidence ID','Item ID','Item dimensions','Unit','Quantity precision','Valuation reference','GL account','GL dimensions','Account class','Sign','Value basis','Valid from','Valid to','Reference'],['GL account','GL dimensions','Account class','Debit','Credit']]
    companions=[]
    for i,(name,fields) in enumerate(zip(['Mapping','Policy evidence','GL balances'],companion_fields),1):
        file=expected_files[i];rows,_,_,_=read(file);sha=hashlib.sha256(file.read_bytes()).hexdigest();expected=[]
        companions.append([dict(zip(rows[0],row)) for row in rows[1:]])
        for n,row in enumerate(rows[1:],2):
            original=dict(zip(rows[0],row));values=[]
            for field in fields:
                v=original[field]
                if field=='Quantity precision':v=int(v)
                elif field in ['Debit','Credit']:v=integer(Decimal(v)*1000)
                values.append(v)
            expected.append([json.dumps([VERSION,i,sha,0,n],separators=(',',':')),i,n,*values])
        assert table(name)==expected,'COMPANION_VALUES_AND_LINKS '+name
    expected_missing=[]
    for fact in observed['facts']:
        key=fact['values'][:2];mapping=[m for m in companions[0] if [m['Item ID'],m['Item dimensions']]==key]
        if len(mapping)!=1:expected_missing.append('mapping:'+json.dumps(key,separators=(',',':')))
        elif not any(link['key']==key for link in observed['links']):expected_missing.append('evidence:'+json.dumps(key,separators=(',',':')))
    keys=[f['values'][:2] for f in observed['facts']]
    for mapping in companions[0]:
        if [mapping['Item ID'],mapping['Item dimensions']] not in keys:expected_missing.append('orphan-mapping:'+mapping['Mapping ID'])
    for comparison in observed['comparisons']:
        if not any(link['account']==comparison[:2] for link in observed['links']):expected_missing.append('account:'+json.dumps(comparison[:2],separators=(',',':')))
    assert sorted(r[0] for r in table('Missing'))==sorted(expected_missing),'MISSING_MEMBERSHIP'
    expected_cells=[]
    for i,file in enumerate(expected_files):
        rows,_,_,_=read(file);width=max(map(len,rows)) if file.suffix=='.xlsx' else None
        for n,row in enumerate(rows,1):
            values=row+['']*(width-len(row)) if width is not None else row
            for c,value in enumerate(values,1):expected_cells.append([i,n,c,row[0] if i==0 and row else rows[0][c-1] if i else '',value])
    assert table('Cell evidence')==[norm(row) for row in expected_cells],'LITERAL_PHYSICAL_CELLS'
    events=table('Events');event_members=table('Event members')
    assert len(events)=={'pending':0,'accepted':1,'undone':2}[mode],'EVENT_COUNT'
    assert len({event[0] for event in events})==len(events) and all(row[0] in [event[0] for event in events] for row in event_members),'EVENT_IDENTITY'
    for event in events:
        actual=[row[1] for row in event_members if row[0]==event[0]]
        assert len(actual)==len(set(actual))==len(members) and set(actual)==set(members) and event[6]==len(members),'PHYSICAL_EVENT_MEMBERS'
    return {'pass_':True,'case':observed['id'],'financial':observed['financial'],'records':len(records),'originals':True,'quantityDimensionsLinks':True,'columnOwnership':True,'mode':mode}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--workbook',required=True);parser.add_argument('--case-dir',required=True);parser.add_argument('--mode',choices=['pending','accepted','undone'],default='pending');args=parser.parse_args()
    print(json.dumps(check(Path(args.workbook),Path(args.case_dir),args.mode)))
