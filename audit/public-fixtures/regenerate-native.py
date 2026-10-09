"""Deterministic synthetic display/date regressions from independently frozen CSV.

No legacy regression workbook is read. The only XLSX scaffolds are the published
synthetic pending-native family. Numeric financial facts stay in their frozen
CSV originals; display/date faults are authored explicitly below.
"""
import csv, datetime, hashlib, json, pathlib, struct, zlib, xml.etree.ElementTree as ET
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = pathlib.Path(__file__).resolve().parents[2]
N = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
Q = '{'+N+'}'
ET.register_namespace('',N)
def letter(number):
    value=''
    while number:
        number,rest=divmod(number-1,26);value=chr(65+rest)+value
    return value
def parts(path):
    with ZipFile(path) as book:return {n:book.read(n) for n in book.namelist()}
def source_sheet(rows):
    sheet=ET.Element(Q+'worksheet');body=ET.SubElement(sheet,Q+'sheetData')
    for number,values in enumerate(rows,1):
        row=ET.SubElement(body,Q+'row',{'r':str(number)})
        for column,value in enumerate(values,1):
            cell=ET.SubElement(row,Q+'c',{'r':letter(column)+str(number),'t':'inlineStr'})
            ET.SubElement(ET.SubElement(cell,Q+'is'),Q+'t').text=value
    return sheet
def write(relative,content,inputs,recipe):
    path=ROOT/relative;path.parent.mkdir(parents=True,exist_ok=True)
    with ZipFile(path,'w') as book:
        for name,data in content.items():
            info=ZipInfo(name,(2026,9,1,0,0,0));info.compress_type=ZIP_DEFLATED;book.writestr(info,data)
    return {'path':relative,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'kind':'approved-binary','provenance':{'type':'synthetic','description':'Deterministic authored '+recipe+'; no legacy regression binary input.','inputs':[{'path':p,'sha256':hashlib.sha256((ROOT/p).read_bytes()).hexdigest()} for p in inputs]}}
def mutate(content,kind,header=None):
    content=dict(content);style=ET.fromstring(content['xl/styles.xml']);sheet=ET.fromstring(content['xl/worksheets/sheet1.xml'])
    if kind=='white-font':
        font=style.find(Q+'fonts')[0];color=font.find(Q+'color');color.attrib.clear();color.set('rgb','FFFFFFFF')
    if kind=='black-fill':
        pattern=style.find(Q+'fills')[0].find(Q+'patternFill');pattern.set('patternType','solid');ET.SubElement(pattern,Q+'fgColor',{'rgb':'FF000000'})
    if kind in ['black-background','black-background-wrapped']:
        # A worksheet background image is different from a cell fill. The
        # wrapper case exercises descendant discovery through AlternateContent.
        # All XML and image bytes below are freshly authored synthetic content.
        relations='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
        container=sheet
        if kind=='black-background-wrapped':
            mc='http://schemas.openxmlformats.org/markup-compatibility/2006'
            alternate=ET.SubElement(sheet,'{'+mc+'}AlternateContent',{'xmlns:x14':'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main'})
            container=ET.SubElement(alternate,'{'+mc+'}Choice',{'Requires':'x14'})
            ET.SubElement(alternate,'{'+mc+'}Fallback')
        ET.SubElement(container,Q+'picture',{'{'+relations+'}id':'syntheticBackground'})
        relns='http://schemas.openxmlformats.org/package/2006/relationships'
        rels=ET.Element('{'+relns+'}Relationships')
        ET.SubElement(rels,'{'+relns+'}Relationship',{'Id':'syntheticBackground','Type':relations+'/image','Target':'../media/synthetic-black.png'})
        content['xl/worksheets/_rels/sheet1.xml.rels']=ET.tostring(rels,encoding='utf-8',xml_declaration=True)
        def chunk(tag,payload):
            return struct.pack('>I',len(payload))+tag+payload+struct.pack('>I',zlib.crc32(tag+payload)&0xffffffff)
        content['xl/media/synthetic-black.png']=(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\x00\x00\x00\x00'))+chunk(b'IEND',b''))
        types=ET.fromstring(content['[Content_Types].xml']);tn='http://schemas.openxmlformats.org/package/2006/content-types'
        if not any(x.get('Extension')=='png' for x in types):ET.SubElement(types,'{'+tn+'}Default',{'Extension':'png','ContentType':'image/png'})
        content['[Content_Types].xml']=ET.tostring(types,encoding='utf-8',xml_declaration=True)
    if kind=='tiny-row':sheet.find(Q+'sheetData')[1].set('ht','0.1')
    if kind in ['tiny-column','hex-column']:
        columns=ET.SubElement(sheet,Q+'cols');ET.SubElement(columns,Q+'col',{'min':'1','max':'1','width':'0x10' if kind=='hex-column' else '0.1','customWidth':'1'})
    if kind=='low-zoom':
        views=ET.SubElement(sheet,Q+'sheetViews');ET.SubElement(views,Q+'sheetView',{'workbookViewId':'0','zoomScale':'50'})
    if kind in ['integer-date','fractional-date']:
        columns=style.find(Q+'cellXfs');index=len(columns);ET.SubElement(columns,Q+'xf',{'numFmtId':'14','fontId':'0','fillId':'0','borderId':'0','xfId':'0','applyNumberFormat':'1'});columns.set('count',str(len(columns)))
        rows=sheet.find(Q+'sheetData');first=rows[0]
        dates=[i for i,c in enumerate(first) if ''.join(c.itertext())==header];assert len(dates)==1
        cell=rows[1][dates[0]];date=datetime.date.fromisoformat(''.join(cell.itertext()));serial=(date-datetime.date(1899,12,30)).days
        cell.clear();cell.set('r',letter(dates[0]+1)+'2');cell.set('s',str(index));ET.SubElement(cell,Q+'v').text=str(serial)+( '.5' if kind=='fractional-date' else '')
    content['xl/styles.xml']=ET.tostring(style,encoding='utf-8',xml_declaration=True)
    content['xl/worksheets/sheet1.xml']=ET.tostring(sheet,encoding='utf-8',xml_declaration=True)
    return content
def main():
    records=[]
    for family,date_column in [('intercompany','Posting date'),('payment-gateway','Posting date')]:
        scaffold=f'audit/{family}/native/source-0.xlsx';base=parts(ROOT/scaffold)
        kinds=['white-font','fractional-date']+(['integer-date'] if family=='payment-gateway' else [])
        for kind in kinds:
            filename=('native-' if family=='intercompany' else '')+kind+'.xlsx';relative=f'audit/{family}/regressions/'+filename
            records.append(write(relative,mutate(base,kind,date_column),[scaffold],family+' '+kind))
    scaffold='audit/intercompany/native/source-0.xlsx';base=parts(ROOT/scaffold)
    truth=json.loads((ROOT/'audit/bank-adjustment/frozen/expected.json').read_text());case=next(c for c in truth['cases'] if c['name']=='closing-outflow')
    original='audit/bank-adjustment/frozen/'+case['files'][5]['file']
    rows=list(csv.reader((ROOT/original).read_text().splitlines()));base['xl/worksheets/sheet1.xml']=ET.tostring(source_sheet(rows),encoding='utf-8',xml_declaration=True)
    for kind in ['white-font','black-fill','tiny-row','tiny-column','low-zoom','hex-column','black-background','black-background-wrapped']:
        relative='audit/bank-adjustment/regressions/'+('native-visibility/' if kind not in ['black-background','black-background-wrapped'] else '')+'native-'+kind+'.xlsx'
        records.append(write(relative,mutate(base,kind),[scaffold,original],'bank evidence '+kind))
    target=ROOT/'audit/public-fixtures/regenerated-native.json';target.write_text(json.dumps({'version':1,'generator':'audit/public-fixtures/regenerate-native.py','records':records},indent=2)+'\n')
    print(json.dumps({'generated':len(records)}))
if __name__=='__main__':main()
