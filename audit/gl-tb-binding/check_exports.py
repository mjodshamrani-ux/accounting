"""Independent stdlib CSV/Decimal/OpenXML checks for synthetic horizontal binding controls."""
import base64,csv,hashlib,io,json,sys,zipfile
from decimal import Decimal
from pathlib import Path
import xml.etree.ElementTree as ET
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
RID='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
FIELDS=['openingDebit','openingCredit','periodDebit','periodCredit','closingDebit','closingCredit']
ROOT=Path(__file__).parent/'frozen'
def sheets(data):
 with zipfile.ZipFile(io.BytesIO(data)) as z:
  strings=[]
  if 'xl/sharedStrings.xml' in z.namelist():
   strings=[''.join(n.itertext()) for n in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',NS)]
  rel={n.attrib['Id']:n.attrib['Target'].lstrip('/') for n in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
  result={}
  for s in ET.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',NS):
   target=rel[s.attrib[RID]]
   if not target.startswith('xl/'):target='xl/'+target
   rows=[]
   for row in ET.fromstring(z.read(target)).findall('s:sheetData/s:row',NS):
    cells={}
    for c in row.findall('s:c',NS):
     assert c.find('s:f',NS) is None,'FORMULA'
     col=0
     for char in ''.join(x for x in c.attrib['r'] if x.isalpha()):col=col*26+ord(char)-64
     v=c.find('s:v',NS);raw='' if v is None else v.text or ''
     cells[col-1]=strings[int(raw)] if c.get('t')=='s' else ''.join(c.find('s:is',NS).itertext()) if c.get('t')=='inlineStr' else raw
    rows.append([cells.get(i,'') for i in range(max(cells,default=-1)+1)])
   assert s.attrib['name'] not in result
   result[s.attrib['name']]=rows
  return result

def facts():
 raw=[list(csv.reader(io.StringIO((ROOT/f'{side}.csv').read_text()))) for side in ['gl','tb']]
 records=[dict(zip(raw[0][0],row)) for row in raw[0][1:]];balance=dict(zip(raw[1][0],raw[1][1]))
 minor=lambda value:int(Decimal(value)*100)
 assert all(Decimal(r[f])*100==(Decimal(r[f])*100).to_integral_value() for r in records for f in ['Debit','Credit'])
 opening=next(r for r in records if r['Record kind']=='opening');closing=next(r for r in records if r['Record kind']=='closing');moves=[r for r in records if r['Record kind']=='movement']
 gl=[minor(opening['Debit']),minor(opening['Credit']),sum(minor(r['Debit']) for r in moves),sum(minor(r['Credit']) for r in moves),minor(closing['Debit']),minor(closing['Credit'])]
 tb=[minor(balance[h]) for h in ['Opening debit','Opening credit','Period debit','Period credit','Closing debit','Closing credit']]
 assert gl==tb==[9107,1103,913,317,10020,1420]
 assert gl[0]-gl[1]+gl[2]-gl[3]-gl[4]+gl[5]==0
 return raw,gl

def verify(folder):
 raw,amounts=facts();report=json.loads((folder/'RESULTS.json').read_text());assert report['syntheticOnly'] and report['browser'] is False
 ids={'csv-csv','xlsx-xlsx','csv-xlsx','xlsx-csv'};assert len(report['cases'])==4 and {c['id'] for c in report['cases']}==ids
 count=0
 for case in report['cases']:
  ident=case['id'];assert case['formats']==ident.split('-') and case['status']=='consistent'
  originals=[]
  for i,fmt in enumerate(case['formats']):
   data=(folder/f'{ident}-{i}.{fmt}').read_bytes();originals.append(data)
   actual=list(csv.reader(io.StringIO(data.decode()))) if fmt=='csv' else next(iter(sheets(data).values()))
   assert actual==raw[i],'ORIGINAL_CELLS'
  session=json.loads((folder/f'{ident}-session.json').read_text());assert session['format']=='tarasuf-gl-tb-session' and session['version']=='gl-tb-canonical-1'
  assert session['scope']['account']=='000781' and len(session['files'])==2
  for stored,data in zip(session['files'],originals):assert base64.b64decode(stored['data'],validate=True)==data and stored['sha256']==hashlib.sha256(data).hexdigest(),'SESSION_ORIGINAL'
  expected=[f'{ident}-direct.xlsx',f'{ident}-restored.xlsx'];assert case['exports']==expected
  for name in expected:
   book=sheets((folder/name).read_bytes());summary=dict(book['Summary'][1:])
   assert summary['Status']=='consistent' and summary['Version']=='gl-tb-canonical-1' and summary['account']=='000781'
   assert summary['GL bridge minor units']==summary['TB bridge minor units']=='0' and summary['Reading errors']=='0'
   assert book['Balances'][1:]==[[f,str(n),str(n),'0'] for f,n in zip(FIELDS,amounts)],'BALANCES'
   assert len(book['Component evidence'][1:])==12
   assert sorted(book['Component evidence'][1:])==sorted([[str(side),f,str(n)] for side in [0,1] for f,n in zip(FIELDS,amounts)]),'COMPONENTS'
   for i,data in enumerate(originals):
    rows=[r for r in book['Sources'][1:] if r[0]==str(i)];assert rows and [int(r[5]) for r in rows]==list(range(1,len(rows)+1))
    assert base64.b64decode(''.join(r[6] for r in rows),validate=True)==data,'EXPORT_ORIGINAL'
    assert all(r[3]==hashlib.sha256(data).hexdigest() for r in rows)
    inventory=book[['GL inventory','TB inventory'][i]][1:];assert len(inventory)==len(raw[i])
    for row,original in zip(inventory,raw[i]):assert row[3:]==original,'INVENTORY'
   expected_cells=[]
   for side,data in enumerate(originals):
    columns=raw[side][0];digest=hashlib.sha256(data).hexdigest()
    numeric=['Debit','Credit'] if side==0 else ['Opening debit','Opening credit','Period debit','Period credit','Closing debit','Closing credit']
    for line,source_row in enumerate(raw[side][1:],2):
     for field in numeric:
      col=columns.index(field);text=source_row[col]
      expected_cells.append([f'{side}:{digest}:0:{line}',str(side),str(line),field,str(col+1),text,str(int(Decimal(text)*100))])
   assert len(expected_cells)==12
   assert book['Cell evidence'][1:]==expected_cells,'CELL_EVIDENCE_COMPLETE_EXACT'
   count+=1
 return {'passed':True,'cases':4,'exports':count,'sessions':4,'oracle':'stdlib CSV/Decimal/ZIP XML; no product imports','amountsMinor':amounts,'syntheticOnly':True,'browser':False}
if __name__=='__main__':print(json.dumps(verify(Path(sys.argv[1])),indent=2))
