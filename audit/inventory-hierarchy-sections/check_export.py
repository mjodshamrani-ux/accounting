"""Independent hierarchy output check; OpenXML reader retained from INV-1C's audited checker."""
import argparse,json,re,posixpath,base64,hashlib
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
from decimal import Decimal
from oracle import inspect,read,SCOPE,FIELDS
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

VERSION='inventory-posted-register-gl-1'
FAMILY='inventory-hierarchy-sections-1'
CITE_HEADERS=['Record ID','Source','SHA256','Sheet index','Sheet','Source row','Column','Field','Text','Kind','Parent row','Batch row','Boundary row','Merge range','Derived dimensions']
def citations(folder,observed):
 p=next(folder.glob('register.*'));rows,merges,_=read(p);sha=hashlib.sha256(p.read_bytes()).hexdigest();sheet='CSV' if p.suffix=='.csv' else 'Inventory hierarchy';out=[]
 def cell(row,col):return rows[row-1][col-1] if col<=len(rows[row-1]) else ''
 def add(record,row,col,field,kind,parent='',batch='',boundary='',merge='',dims=''):
  out.append([record,0,sha,0,sheet,row,col,field,cell(row,col),kind,parent,batch,boundary,merge,dims])
 add('',1,1,'Title','format')
 keys=['entity','inventoryLedger','glLedger','currency','currencyBasis','postingStatus','postingLayer','asOf','chartVersion','mapVersion','valuationPolicyVersion','inventoryAccountSetVersion']
 for n,row in enumerate(rows,1):
  if row and row[0] in SCOPE:add('',n,2,keys[SCOPE.index(row[0])],'scope')
 for f in observed['facts']:
  row,pr,br=f['row'],f['parentRow'],f['batchRow'];identity=json.dumps([VERSION,0,sha,0,row],separators=(',',':'));dims=f['values'][1];headers=rows[f['headerRow']-1]
  for field,(r,c,v) in f['fields'].items():add(identity,r,c,field,'value',pr,br,dims=dims)
  for c,field in enumerate(headers,1):add(identity,f['headerRow'],c,field,'role',pr,br)
  for r,key in [(pr,rows[pr-1][0].lower()),(br,'batch')]:
   merge=next((m for m in merges if m.startswith('B'+str(r)+':')),'');geom=json.dumps([r,2,r,6 if merge.endswith('F'+str(r)) else 7],separators=(',',':')) if merge else ''
   add(identity,r,1,key,'dimension-role',pr,br,merge=geom);add(identity,r,2,key,'dimension-value',pr,br,merge=geom,dims=dims)
  add(identity,f['parentEnd'],1,'Parent end','boundary',pr,br,f['parentEnd']);add(identity,f['batchEnd'],1,'Batch end','boundary',pr,br,f['batchEnd'])
 for n,r in enumerate(rows,1):
  if r and r[0]=='Report total':add('',n,2,'Report total','control')
  if r and r[0]=='End report':add('',n,1,'End report','report-end')
 return out

def check(book,folder,mode='pending'):
 observed=inspect(folder);assert observed['financial']!='source-error','CHECKER_SCOPE';tables=read_workbook(book)
 norm=lambda r:[None if v=='' else v for v in r]
 def table(name,headers=None):
  assert name in tables,'MISSING_TABLE '+name
  if headers is not None:assert tables[name][0]==headers,('HEADER',name)
  return [norm(r) for r in tables[name][1:]]
 summary=dict(table('Summary'))
 assert summary['Financial']==observed['financial'] and summary['Register minor']==observed['totals']['registerMinor'] and summary['GL minor']==observed['totals']['glMinor'],'FINANCIAL_SUMMARY'
 assert summary['Review']==('accepted' if mode=='accepted' else 'needs-review'),'REVIEW_STATE'
 records=table('Register',['Record ID','Source','Source row','Item ID','Item dimensions','Quantity scaled integer','Unit','Quantity precision','Posted value minor','Valuation reference'])
 source=next(folder.glob('register.*'));sha=hashlib.sha256(source.read_bytes()).hexdigest()
 assert records==[[json.dumps([VERSION,0,sha,0,f['row']],separators=(',',':')),0,f['row'],*f['values']] for f in observed['facts']],'REGISTER_VALUES_OR_ANCHOR'
 sort=lambda rows:sorted([norm(r) for r in rows],key=lambda r:json.dumps(r,separators=(',',':')))
 assert sort(table('Hierarchy citations',CITE_HEADERS))==sort(citations(folder,observed)),'HIERARCHY_OWNERSHIP_CITATIONS'
 assert table('Account comparisons')==observed['comparisons'],'ACCOUNT_DIMENSIONS_AND_MONEY'
 assert table('Issues')==[],'UNEXPECTED_ISSUES'
 sources=table('Sources');headers=tables['Sources'][0];data=[dict(zip(headers,r)) for r in sources]
 expected_files=[source]+[folder/f'source-{i}.csv' for i in range(1,4)];members=[]
 for i,p in enumerate(expected_files):
  selected=sorted([r for r in data if r['Source']==i],key=lambda r:r['Part']);assert selected
  original=p.read_bytes();assert base64.b64decode(''.join(r['Base64'] for r in selected))==original,'SOURCE_BYTES';assert all(r['SHA256']==hashlib.sha256(original).hexdigest() for r in selected),'SOURCE_HASH'
  rows,_,_=read(p)
  for n,r in enumerate(rows,1):
   if n>1 and any(v!='' for v in r):members.append(json.dumps([VERSION,i,hashlib.sha256(original).hexdigest(),0,n],separators=(',',':')))
 companion_fields=[['Mapping ID','Item ID','Item dimensions','GL account','GL dimensions','Evidence ID'],['Evidence ID','Item ID','Item dimensions','Unit','Quantity precision','Valuation reference','GL account','GL dimensions','Account class','Sign','Value basis','Valid from','Valid to','Reference'],['GL account','GL dimensions','Account class','Debit','Credit']]
 for i,(name,fields) in enumerate(zip(['Mapping','Policy evidence','GL balances'],companion_fields),1):
  p=expected_files[i];rows,_,_=read(p);sha=hashlib.sha256(p.read_bytes()).hexdigest();expected=[]
  for n,row in enumerate(rows[1:],2):
   original=dict(zip(rows[0],row));values=[]
   for field in fields:
    v=original[field]
    if field=='Quantity precision':v=int(v)
    elif field in ['Debit','Credit']:v=integer(Decimal(v)*100)
    values.append(v)
   expected.append([json.dumps([VERSION,i,sha,0,n],separators=(',',':')),i,n,*values])
  assert table(name)==expected,'COMPANION_VALUES_AND_LINKS '+name
 expected_cells=[]
 for i,p in enumerate(expected_files):
  rows,_,_=read(p);width=max(map(len,rows)) if p.suffix=='.xlsx' else None
  for n,r in enumerate(rows,1):
   values=r+['']*(width-len(r)) if width is not None else r
   for col,value in enumerate(values,1):expected_cells.append([i,n,col,r[0] if i==0 and r else rows[0][col-1] if i else '',value])
 assert table('Cell evidence')==[norm(r) for r in expected_cells],'LITERAL_PHYSICAL_CELLS'
 expected_missing=[]
 if observed['financial']=='missing':
  expected_missing=['mapping:'+json.dumps(f['values'][:2],separators=(',',':')) for f in observed['facts']]+['orphan-mapping:MAP-'+str(i) for i in range(5)]+['account:'+json.dumps(c[:2],separators=(',',':')) for c in observed['comparisons']]
 assert sorted(r[0] for r in table('Missing'))==sorted(expected_missing),'MISSING_MEMBERSHIP'
 events=table('Events');event_members=table('Event members')
 assert len(events)==({'pending':0,'accepted':1,'undone':2}[mode]),'EVENT_COUNT'
 for event in events:assert set(r[1] for r in event_members if r[0]==event[0])==set(members) and event[6]==len(members),'PHYSICAL_EVENT_MEMBERS'
 for row in records:assert len(json.loads(row[0]))==5,'ORIGINAL_ROW_ID'
 return dict(pass_=True,case=observed['id'],financial=observed['financial'],records=len(records),sourceBytes=True,quantityDimensionsLinks=True,ownershipCitations=True,mode=mode)
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--workbook',required=True);a.add_argument('--case-dir',required=True);a.add_argument('--mode',choices=['pending','accepted','undone'],default='pending');args=a.parse_args();print(json.dumps(check(Path(args.workbook),Path(args.case_dir),args.mode)))
