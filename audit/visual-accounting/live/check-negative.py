import sys,json,base64,hashlib,xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path.cwd();sys.path.insert(0,str(ROOT/'audit/export-design'))
from check_membership import Book,value,require
folder=ROOT/(sys.argv[1] if len(sys.argv)>1 else 'work/visual-accounting-live');cases=json.loads((folder/'negative-contract.json').read_text());report=[]
for case in cases:
 book=Book(folder/(case['case']+'.xlsx'))
 try:
  for n in book.names:
   if n.endswith(('.xml','.rels')):ET.fromstring(book.archive.read(n))
  matches,_=book.rows('Matches',{'Supplier References','Supplier Amount','Ledger Amount'})
  require(len(matches)==0,'unproved automatic match exported')
  evidence,_=book.rows('Match Evidence',{'Status'})
  require(all(value(r,'Status')!='Matched' for r in evidence),'hidden matched membership')
  excluded,_=book.rows('Excluded Rows',{'الطرف','صف المصدر','سبب الاستبعاد','المحتوى'})
  require(any(value(r,'الطرف')=='المورد' and int(value(r,'صف المصدر'))==case['unknownExclusionRow'] and value(r,'سبب الاستبعاد') for r in excluded),'uncertain exclusion vanished')
  parts,_=book.rows('Visual Source Record',{'Side','Part','Original JSON text'})
  require(all(int(value(r,'Part'))==i+1 and value(r,'Side')=='supplier' for i,r in enumerate(parts)),'record chunk order')
  recordText=''.join(value(r,'Original JSON text') for r in parts)
  require(recordText.encode()==(folder/(case['case']+'-source.json')).read_bytes(),'original reviewed record rewritten')
  original=base64.b64decode(json.loads(recordText)['table']['image']['source']['originalPng'].split(',',1)[1])
  require([book.archive.read(n) for n in book.names if n.startswith('xl/media/') and not n.endswith('/')]==[original],'PNG changed or omitted')
  report.append({'case':case['case'],'approvedMatches':0,'excludedRowRetained':True,'originalRecord':True,'originalPNG':True,'xmlReadable':True,'workbookSHA256':hashlib.sha256((folder/(case['case']+'.xlsx')).read_bytes()).hexdigest()})
 finally:book.close()
(folder/'negative-oracle.json').write_text(json.dumps({'assertions':'Adversarial reviewed annotations: zero approved matches and retained original evidence; not OCR accuracy','cases':report},indent=2)+'\n');print(json.dumps(report))
