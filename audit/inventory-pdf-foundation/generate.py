"""Synthetic PDF/CSV sources only. Standard-library writer; no product/oracle imports."""
import argparse,copy,csv,io,json
from pathlib import Path
SCOPE=[('Entity','Synthetic INV1F Owner'),('Inventory ledger','STOCK-PDF'),('GL ledger','GL-PDF'),('Currency','KWD'),('Currency basis','functional'),('Posting status','posted'),('Posting layer','Current'),('As of','2026-10-31'),('Chart version','CHART-F'),('Map version','MAP-F'),('Valuation policy version','SUPPLIED-F'),('Inventory account set version','SET-F')]
# item, warehouse, batch, qty, unit, precision, posted value, ref, account, GL dimension
FACTS=[['0008','NORTH','LOT-X','1.250','KG','3','410.125','VAL-FA','INV-RAW','branch=10'],['08','NORTH','LOT-Y','2.50','KG','2','189.875','VAL-FB','INV-RAW','branch=20'],['0008','SOUTH','LOT-X','1250','G','0','600.000','VAL-FC','INV-RAW','branch=30'],['8','SOUTH','LOT-Z','3','EA','0','42.500','VAL-FD','INV-PACK','branch=40'],['008','EAST','LOT-X','0.50','KG','2','42.500','VAL-FE','INV-PACK','branch=50'],['00','NORTH','LOT-X','0','EA','0','0.000','VAL-FZ','INV-RAW','branch=60'],['00008','WEST','RETURN','0.125','KG','3','0.750','VAL-FF','INV-RET','branch=70']]
HEADERS=['Item ID','Item dimensions','Quantity','Unit','Quantity precision','Posted value','Valuation reference']
DETAIL=['Item ID','Quantity','Unit','Quantity precision','Posted value','Valuation reference']
def dims(f):return f'warehouse={f[1]};batch={f[2]}'
def flat(f):return [f[0],dims(f),*f[3:8]]
def companions():
 headers=[['Mapping ID','Item ID','Item dimensions','GL account','GL dimensions','Evidence ID'],['Evidence ID','Item ID','Item dimensions','Unit','Quantity precision','Valuation reference','GL account','GL dimensions','Account class','Sign','Value basis','Valid from','Valid to','Reference'],['GL account','GL dimensions','Account class','Debit','Credit']]
 rows=[[],[],[]]
 for i,f in enumerate(FACTS):
  rows[0].append([f'MAP-F-{i}',f[0],dims(f),f[8],f[9],f'POL-F-{i}'])
  rows[1].append([f'POL-F-{i}',f[0],dims(f),f[4],f[5],f[7],f[8],f[9],'inventory','debit-positive','provided-posted-carrying-value','2026-01-01','2026-12-31',f'SYN-F-{i}'])
  rows[2].append([f[8],f[9],'inventory',f[6],'0.000'])
 return [[[ *h,*[k for k,v in SCOPE]],*[r+[v for k,v in SCOPE] for r in data]] for h,data in zip(headers,rows)]
def csv_bytes(rows):
 s=io.StringIO(newline='');csv.writer(s,lineterminator='\n').writerows(rows);return s.getvalue().encode()
def cash(indices,facts):
 from decimal import Decimal
 return format(sum((Decimal(facts[i][6]) for i in indices if facts[i][6]),Decimal(0)),'.3f')
def rows_for(code):
 facts=copy.deepcopy(FACTS)
 if code=='N04':facts[0][6],facts[1][6]=facts[1][6],facts[0][6]
 if code=='N05':facts[3][7],facts[4][7]=facts[4][7],facts[3][7]
 if code=='N06':facts[5][6]=''
 if code=='N11':facts[2][4]='KG'
 if code=='N12':facts[0][5]='1'
 flat_layout=code=='P01'
 if flat_layout:groups=[[0,1,5],[2,3,4,6]]
 elif code=='P02':groups=[[0,5,1],[2,3],[4,6]]
 else:groups=[[0],[5,1],[2,3,4,6]]
 pages=[]
 for page,indices in enumerate(groups,1):
  scope=copy.deepcopy(SCOPE)
  if code=='N10' and page==3:scope[3]=('Currency','USD')
  rows=[['Inventory carrying-value register'],['Report ID','INV1F-OCT2026'],['Page',f'{page} of {len(groups)}'],*map(list,scope)]
  if not flat_layout and code!='P02' and page==2:
   rows.append(['Continued section','warehouse=NORTH;batch=LOT-X' if code!='N03' else 'warehouse=SOUTH;batch=LOT-X'])
  order=list(HEADERS if flat_layout else DETAIL)
  # A genuinely reordered table on a later page, not reordered PDF paint only.
  if flat_layout and page==2:order=['Valuation reference','Posted value','Quantity precision','Unit','Quantity','Item dimensions','Item ID']
  parent=batch=None
  for i in indices:
   f=facts[i]
   if not flat_layout and (parent,batch)!=(f[1],f[2]):
    if parent is not None:rows.append(['End section'])
    rows += [['Warehouse',f[1]],['Batch',f[2]],order[:]]
    parent,batch=f[1:3]
   elif flat_layout and i==indices[0]:rows.append(order[:])
   values=dict(zip(HEADERS,flat(f)))
   rows.append([values[k] for k in order])
  continued=not flat_layout and code!='P02' and page==1
  if continued:rows.append(['Continues section','warehouse=NORTH;batch=LOT-X'])
  elif not flat_layout:rows.append(['End section'])
  if code=='N07' and page==2:rows.append(['Unassigned value','0.001'])
  total=cash(indices,facts)
  if code=='N09' and page==2:total='189.876'
  rows += [['Page total',total],['End page']]
  if page==len(groups):
   rows += [['Report total','1285.750']]
   if code!='N08':rows.append(['End report'])
  pages.append(rows)
 if code=='N01':pages.pop(1)
 if code=='N02':pages.insert(2,copy.deepcopy(pages[1]))
 if code in ['P04','N13','N14','N15']:
  for pn,rows in enumerate(pages,1):
   if pn>1:rows[:]=[r for r in rows if r[0] not in dict(SCOPE) or r[0] in ['Currency','As of']]
   rows[:]=[r for r in rows if r[0]!='End section']
  if code=='N13':
   rows=pages[1];pos=next(i for i,r in enumerate(rows) if r==['Batch','LOT-Y']);rows.pop(pos)
  if code=='N14':pages[2][1][1]='INV1F-OCT2027'
  if code=='N15':pages[1][:]=[r for r in pages[1] if r[0]!='Continued section']
 return pages,flat_layout

def pdf_bytes(pages,landscape,fragmented=False):
 # Standard PDF text operators, actual xref/lengths, no hidden truth layer.
 width,height=(842,595) if landscape else (595,842)
 streams=[]
 for rows in pages:
  commands=[];y=height-30;table=False;columns=None
  for row in rows:
   header='Item ID' in row and 'Posted value' in row
   if header:
    table=True;columns=len(row)
   elif row[0] in ['Warehouse','Batch','End section','Continues section','Page total','Report total','End page','End report']:table=False
   if table:
    if landscape:
     widths={'Item ID':50,'Item dimensions':213,'Quantity':65,'Unit':38,'Quantity precision':97,'Posted value':80,'Valuation reference':100}
     if header:
      positions=[];x=30
      for key in row:positions.append(x);x+=widths[key]
    else:positions=[30,100,171,215,326,429]
    xs=positions
   else:xs=[30,220]
   for ci,text in enumerate(row):
    if not text:continue
    x=xs[ci];size=7 if table else 8
    escape=lambda s:s.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
    if fragmented and table and not header and len(text)>2 and ci%2==0:
     cut=len(text)//2;a,b=text[:cut],text[cut:]
     commands.append(f'BT /F1 {size} Tf 1 0 0 1 {x} {y} Tm ({escape(a)}) Tj ({escape(b)}) Tj ET')
    else:commands.append(f'BT /F1 {size} Tf 1 0 0 1 {x} {y} Tm ({escape(text)}) Tj ET')
   y-=16 if not table else 19
  assert y>25,('PAGE_OVERFLOW',len(rows),y)
  streams.append('\n'.join(commands).encode('ascii'))
 objects=[b'<< /Type /Catalog /Pages 2 0 R >>',None,b'<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>']
 kids=[]
 for stream in streams:
  page_id=len(objects)+1;content_id=page_id+1;kids.append(f'{page_id} 0 R')
  objects += [f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] /Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>'.encode(),b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
 objects[1]=('<< /Type /Pages /Kids ['+' '.join(kids)+f'] /Count {len(kids)} >>').encode()
 out=b'%PDF-1.7\n% Synthetic inventory only\n';offsets=[]
 for i,obj in enumerate(objects,1):offsets.append(len(out));out+=f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
 start=len(out)
 out+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()+b''.join(f'{n:010d} 00000 n \n'.encode() for n in offsets)+f'trailer << /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode()
 return out

def generate(root,include_scope_controls=False):
 root.mkdir(parents=True,exist_ok=True);entries=[]
 for code in ['P00','P01','P02','P03']+[f'N{i:02}' for i in range(1,13)]+(['P04','N13','N14','N15'] if include_scope_controls else []):
  folder=root/('INV1F-'+code);folder.mkdir(exist_ok=True)
  if code=='P00':
   headers=HEADERS+[k for k,v in SCOPE]
   content=csv_bytes([headers]+[flat(f)+[v for k,v in SCOPE] for f in FACTS]);name='register.csv'
  else:
   pages,landscape=rows_for(code);content=pdf_bytes(pages,landscape,code=='P03');name='register.pdf'
  (folder/name).write_bytes(content)
  for n,rows in zip(['mapping.csv','policy.csv','gl.csv'],companions()):(folder/n).write_bytes(csv_bytes(rows))
  entries.append({'id':folder.name,'layout':'flat-csv' if code=='P00' else 'paginated-flat-table' if code=='P01' else 'closed-section-table' if code=='P02' else 'continued-section-table','files':[f'{folder.name}/{x}' for x in [name,'mapping.csv','policy.csv','gl.csv']]})
 (root/'corpus.json').write_text(json.dumps({'schema':'tarasuf-inv1f-pdf-foundation/1','synthetic':True,'cases':entries},indent=2)+'\n')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--include-scope-controls',action='store_true');a=p.parse_args();generate(a.output_dir,a.include_scope_controls)
