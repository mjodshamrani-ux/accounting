"""Independent XLSX control checker. Generic OpenXML reader retained from INV-1E."""
import argparse,json,re,posixpath,base64,hashlib,csv
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
from decimal import Decimal
from oracle import inspect,number,SCOPE
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
ROLES=['register','mapping','policy-evidence','gl']
FIELDS=[['Item ID','Item dimensions','Quantity','Unit','Quantity precision','Posted value','Valuation reference'],['Mapping ID','Item ID','Item dimensions','GL account','GL dimensions','Evidence ID'],['Evidence ID','Item ID','Item dimensions','Unit','Quantity precision','Valuation reference','GL account','GL dimensions','Account class','Sign','Value basis','Valid from','Valid to','Reference'],['GL account','GL dimensions','Account class','Debit','Credit']]
def check(book,folder):
 r=inspect(folder);assert folder.name=='INV1F-P00' and r['financial']=='ready','CONTROL_ONLY';tables=read_workbook(book)
 def table(name):
  assert name in tables,'TABLE'
  return [[None if v=='' else v for v in row+['']*(len(tables[name][0])-len(row))] for row in tables[name][1:]]
 summary=dict(table('Summary'));assert summary['Financial']=='ready' and summary['Review']=='needs-review' and summary['Status']=='needs-review','STATE'
 assert summary['Version']==VERSION and summary['Decimals']==3 and summary['Scope confirmed']=='true' and summary['Completeness confirmed']=='false','SUMMARY_SCOPE'
 for key,label in zip(['entity','inventoryLedger','glLedger','currency','currencyBasis','postingStatus','postingLayer','asOf','chartVersion','mapVersion','valuationPolicyVersion','inventoryAccountSetVersion'],SCOPE):assert summary[key]==r['scope'][label],'SUMMARY_SCOPE'
 assert summary['Register minor']==1285750 and summary['GL minor']==1285750,'SUMMARY_MONEY'
 assert table('Account comparisons')==r['comparisons'],'COMPARISONS'
 assert not table('Issues') and not table('Missing') and not table('Events') and not table('Event members'),'UNEXPECTED_ISSUES_OR_EVENTS'
 files=[folder/f for f in ['register.csv','mapping.csv','policy.csv','gl.csv']];expected_members=[]
 for source,(file,name) in enumerate(zip(files,['Register','Mapping','Policy evidence','GL balances'])):
  raw=list(csv.DictReader(file.open()));sha=hashlib.sha256(file.read_bytes()).hexdigest();expected=[]
  for row,data in enumerate(raw,2):
   identity=json.dumps([VERSION,source,sha,0,row],separators=(',',':'));expected_members.append(identity)
   if source==0:values=[f for f in r['facts'] if f['row']==row][0]['values']
   else:
    values=[data[k] for k in FIELDS[source]]
    if source==2:values[4]=int(values[4])
    if source==3:values[3]=number(values[3],3);values[4]=number(values[4],3)
   expected.append([identity,source,row,*values])
  assert table(name)==expected,('RECORD_VALUES',name)
  cells=table('Cell evidence');expected_cells=[]
  rows=list(csv.reader(file.open()))
  for n,row in enumerate(rows,1):
   for column,text in enumerate(row,1):expected_cells.append([source,n,column,rows[0][column-1],text])
  assert [row for row in cells if row[0]==source]==expected_cells,'ORIGINAL_CELLS'
 sources=[dict(zip(tables['Sources'][0],row)) for row in table('Sources')]
 assert {s['Source'] for s in sources}=={0,1,2,3},'SOURCE_SET'
 for n,file in enumerate(files):
  selected=sorted([s for s in sources if s['Source']==n],key=lambda s:s['Part']);assert [s['Part'] for s in selected]==list(range(1,len(selected)+1)) and all(s['Parts']==len(selected) for s in selected),'SOURCE_PARTS'
  raw=file.read_bytes();sha=hashlib.sha256(raw).hexdigest();encoded=''.join(s['Base64'] for s in selected);decoded=base64.b64decode(encoded,validate=True)
  assert decoded==raw and base64.b64encode(decoded).decode()==encoded,'SOURCE_BYTES'
  assert all(s['Name']==file.name and s['SHA256']==sha and s['Role']==ROLES[n] for s in selected),'SOURCE_IDENTITY'
 assert len(set(expected_members))==28,'MEMBERS'
 assert table('Reading')==[[i,role,VERSION,0,'true'] for i,role in enumerate(ROLES)],'READING'
 expected_inventory=[[source,row,'header' if row==1 else 'data'] for source,file in enumerate(files) for row,_ in enumerate(csv.reader(file.open()),1)]
 assert table('Inventory')==expected_inventory,'PHYSICAL_ROW_INVENTORY'
 return dict(control='INV1F-P00',records=7,links=7,physicalMembers=28,passed=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('book',type=Path);p.add_argument('folder',type=Path);a=p.parse_args();print(json.dumps(check(a.book,a.folder)))
