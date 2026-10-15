"""Literal synthetic source producer; never imports product or oracle."""
import argparse,csv,io,json,hashlib,copy
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_STORED
from xml.sax.saxutils import escape
SCOPE=[('Entity','Synthetic INV1D Owner'),('Inventory ledger','STOCK-HIER'),('GL ledger','GL-HIER'),('Currency','SAR'),('Currency basis','functional'),('Posting status','posted'),('Posting layer','Current'),('As of','2026-10-31'),('Chart version','CHART-H'),('Map version','MAP-H'),('Valuation policy version','SUPPLIED-H'),('Inventory account set version','SET-H')]
FIELDS=['Item ID','Quantity','Unit','Quantity precision','Posted value','Valuation reference']
FACTS=[['0009','warehouse=W1;batch=B7','1.25','KG','2','400.00','VAL-A','INV-A','branch=10'],['009','warehouse=W1;batch=B7','2.50','KG','2','600.00','VAL-B','INV-A','branch=20'],['9','warehouse=W2;batch=B7','4','EA','0','1000.00','VAL-C','INV-B','branch=10'],['009','warehouse=W1;batch=B8','3','EA','0','250.00','VAL-D','INV-B','branch=20'],['00','warehouse=W2;batch=Z0','0','EA','0','0.00','VAL-Z','INV-B','branch=30']]
def companions():
 headers=[['Mapping ID','Item ID','Item dimensions','GL account','GL dimensions','Evidence ID'],['Evidence ID','Item ID','Item dimensions','Unit','Quantity precision','Valuation reference','GL account','GL dimensions','Account class','Sign','Value basis','Valid from','Valid to','Reference'],['GL account','GL dimensions','Account class','Debit','Credit']]
 data=[[],[],[]]
 for n,f in enumerate(FACTS):
  item,dims,qty,unit,precision,money,ref,account,gl=f
  data[0].append([f'MAP-{n}',item,dims,account,gl,f'POL-{n}'])
  data[1].append([f'POL-{n}',item,dims,unit,precision,ref,account,gl,'inventory','debit-positive','provided-posted-carrying-value','2026-01-01','2026-12-31',f'SYN-{n}'])
  data[2].append([account,gl,'inventory',money,'0.00'])
 return [[h+[k for k,v in SCOPE]]+[r+[v for k,v in SCOPE] for r in rows] for h,rows in zip(headers,data)]
def rows(permuted=False,controls=False,explicit=False,blanks=False):
 roles=FIELDS+(['Item dimensions'] if explicit else [])
 if permuted:roles=list(reversed(roles))
 out=[['Inventory carrying-value register']]+[[k,v] for k,v in SCOPE]
 for warehouse,batches in [('W1',[('B7',[0,1]),('B8',[3])]),('W2',[('B7',[2]),('Z0',[4])])]:
  out.append(['Warehouse',warehouse]);parent=0
  for batch,indices in batches:
   out.append(['Batch',batch]);out.append(roles[:])
   for i in indices:
    f=FACTS[i];values=dict(zip(FIELDS,[f[0],f[2],f[3],f[4],f[5],f[6]]));values['Item dimensions']=f[1]
    out.append([values[r] for r in roles]);parent+=int(float(f[5])*100)
    if blanks:out.append([])
   if controls:out.append(['Batch total',f'{sum(int(float(FACTS[i][5])*100) for i in indices)/100:.2f}'])
   else:out.append(['End batch'])
  if controls:out.append(['Parent total',f'{parent/100:.2f}'])
  else:out.append(['End warehouse'])
 return out+[['Report total','2250.00'],['End report']]
def variants():
 yield 'P01','csv',rows(),[]
 yield 'P02','xlsx',rows(),['headers']
 yield 'P03','csv',rows(permuted=True,controls=True,explicit=True,blanks=True),[]
 yield 'P04','xlsx',rows(permuted=True,controls=True,explicit=True,blanks=True),['headers']
 r=rows();r=[x for x in r if not x or x[0] not in ['End batch','End warehouse']];yield 'P05','csv',r,[]
 r=rows();j=next(i for i,x in enumerate(r) if x[:2]==['Batch','B7']);r.insert(j+4,FIELDS[:]);yield 'P06','xlsx',r,[]
 r=rows();a=next(x for x in r if x and x[0]=='0009');b=next(x for x in r if x and x[0]=='009');a[4],b[4]=b[4],a[4];yield 'N01','csv',r,[]
 r=rows();[x.__setitem__(1,{'W1':'W2','W2':'W1'}[x[1]]) for x in r if x and x[0]=='Warehouse'];yield 'N02','xlsx',r,['headers']
 r=rows();j=next(i for i,x in enumerate(r) if x[:2]==['Warehouse','W2']);r.pop(j+1);yield 'N03','csv',r,[]
 r=rows();j=next(i for i,x in enumerate(r) if x[:2]==['Batch','B8']);r[j][1]='';yield 'N04','xlsx',r,[]
 r=rows(explicit=True);next(x for x in r if x and x[0]=='0009')[-1]='warehouse=W2;batch=B7';yield 'N05','csv',r,[]
 r=rows();next(x for x in r if x and x[0]=='00')[4]='';yield 'N06','xlsx',r,[]
 r=rows();j=next(i for i,x in enumerate(r) if x and x[0]=='End batch');r.insert(j+1,['0009','1','KG','2','400.00','VAL-A']);yield 'N07','csv',r,[]
 r=rows();j=next(i for i,x in enumerate(r) if x and x[0]=='0009');r.insert(j+1,['Unexpected adjustment','99.00']);yield 'N08','csv',r,[]
 r=rows();yield 'N09','xlsx',r,['money']
 r=rows();j=next(i for i,x in enumerate(r) if x and x[0]=='Warehouse');yield 'N10','xlsx',r,[f'B{j+1}:F{j+2}']
 r=rows();r.pop();yield 'N11','csv',r,[]
 r=rows(controls=True);next(x for x in r if x and x[0]=='Batch total')[1]='1000.01';yield 'N12','xlsx',r,['headers']
def csvbytes(rows):
 s=io.StringIO(newline='');csv.writer(s,lineterminator='\n').writerows(rows);return s.getvalue().encode()
def address(c):
 s=''
 while c:c,n=divmod(c-1,26);s=chr(65+n)+s
 return s
def native(rows,merges):
 ranges=[]
 for spec in merges:
  if spec=='headers':ranges += [f'B{i+1}:{address(max(len(x) for x in rows))}{i+1}' for i,r in enumerate(rows) if r and r[0] in ['Warehouse','Batch']]
  elif spec=='money':
   row=next(i+1 for i,r in enumerate(rows) if r and r[0]=='0009');ranges.append(f'E{row}:F{row}')
  else:ranges.append(spec)
 cells=[]
 for i,r in enumerate(rows,1):
  cc=[]
  for c,v in enumerate(r,1):
   if v!='':cc.append(f'<c r="{address(c)}{i}" t="inlineStr"><is><t>{escape(v)}</t></is></c>')
  cells.append(f'<row r="{i}">'+''.join(cc)+'</row>')
 merge=('<mergeCells count="'+str(len(ranges))+'">'+''.join('<mergeCell ref="'+x+'"/>' for x in ranges)+'</mergeCells>') if ranges else ''
 files={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>', '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>','xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inventory hierarchy" sheetId="1" r:id="r1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetFormatPr defaultRowHeight="15" defaultColWidth="30"/><sheetData>'+''.join(cells)+'</sheetData>'+merge+'</worksheet>'}
 out=io.BytesIO()
 with ZipFile(out,'w',compression=ZIP_STORED) as z:
  for name,content in files.items():z.writestr(ZipInfo(name,(2026,10,15,0,0,0)),content.encode())
 return out.getvalue()
def generate(target):
 target.mkdir(parents=True,exist_ok=True);cases=[]
 for code,ext,r,merges in variants():
  case='INV1D-'+code;d=target/case;d.mkdir(exist_ok=True);register=d/('register.'+ext);register.write_bytes(csvbytes(r) if ext=='csv' else native(r,merges))
  paths=[register]
  for i,data in enumerate(companions(),1):p=d/f'source-{i}.csv';p.write_bytes(csvbytes(data));paths.append(p)
  cases.append({'id':case,'container':ext,'files':[str(p.relative_to(target)) for p in paths]})
 (target/'corpus.json').write_text(json.dumps({'synthetic':True,'stories':1,'family':'hierarchy-row-details','cases':cases},indent=2)+'\n')
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--output-dir',required=True);generate(Path(a.parse_args().output_dir))
