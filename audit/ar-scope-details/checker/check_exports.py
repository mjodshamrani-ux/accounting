#!/usr/bin/env python3
"""Verify a proof/browser evidence index against original bytes, never expected JSON."""
import argparse,json,sys
from pathlib import Path
import check_export as c

def resolved(root,value):
 path=(root/value).resolve();return path
def verify_digest(path,digest,size=None):
 data=path.read_bytes();c.eq(c.sha(data),digest,'actual artifact SHA-256 '+str(path))
 if size is not None:c.eq(len(data),size,'actual artifact byte count')

def lifecycle_bundle(entry,root,output,prep):
 """Executed options + actual original snapshot are inputs, never expectations."""
 input_path=resolved(root,entry['input']);metadata=json.loads(input_path.read_text())
 bundle={k:metadata[k] for k in ('families','scope','readingConfirmed','sheets')}
 if 'selectedAmountHeaders' in metadata:bundle['selectedAmountHeaders']=metadata['selectedAmountHeaders']
 bundle['files']=[str(resolved(root,f['path'])) for f in sorted(entry['files'],key=lambda x:x['side'])]
 directory=output/'inputs';directory.mkdir(parents=True,exist_ok=True);path=directory/(entry['id']+'.bundle.json');path.write_text(json.dumps(bundle,indent=2)+'\n')
 return path

def run(index,output,prep):
 root=index.parent;data=json.loads(index.read_text());output.mkdir(parents=True,exist_ok=True)
 browser=data.get('schema')=='ar-scope-details-browser-evidence-1'
 c.require(browser or data.get('schema')=='ar-scope-details-1','supported evidence index schema')
 entries=data.get('artifacts',[]) if browser else data.get('cases',[])+data.get('lifecycle',[])
 results=[]
 for number,entry in enumerate(entries):
  name=entry.get('case',entry.get('id',str(number)));phase=entry.get('phase','proof');record={'id':name,'phase':phase}
  try:
   if browser:
    workbook=resolved(root,entry['workbook']);session=resolved(root,entry['session']);bundle=resolved(root,entry['bundle'])
    verify_digest(workbook,entry['workbookSHA256']);verify_digest(session,entry['sessionSHA256'])
   else:
    c.eq(entry.get('status'),'completed','actual completed source evidence')
    for artifact in entry['artifacts'].values():verify_digest(resolved(root,artifact['path']),artifact['sha256'],artifact.get('bytes'))
    workbook=resolved(root,entry['export']);session=resolved(root,entry['session'])
    sealed=prep/'fixtures'/name/'bundle.json'
    if sealed.exists():
     bundle=sealed;original=json.loads(sealed.read_text())
     for f in entry['files']:
      data_original=(sealed.parent/original['files'][f['side']]).read_bytes();actual=resolved(root,f['path']).read_bytes();c.eq(actual,data_original,'evidence exact sealed original bytes')
    else:bundle=lifecycle_bundle(entry,root,output,prep)
   record.update(c.verify(workbook,bundle,session,prep))
   if not browser:
    record['actualResult']=c.verify_claim(resolved(root,entry['result']),workbook,session)
    record['actualReplay']=c.verify_claim(resolved(root,entry['restored']),workbook,session)
   if browser:
    record.update({k:entry[k] for k in ('lang','width') if k in entry})
  except (AssertionError,ValueError,KeyError,TypeError,OSError,IndexError) as error:
   record.update(passed=False,errorType=type(error).__name__,error=str(error))
  results.append(record)
  (output/f'{number:03d}-{name}-{phase}.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
 failed=[r for r in results if not r['passed']]
 report={'passed':bool(results) and not failed,'index':str(index),'indexSHA256':c.sha(index.read_bytes()),'checked':len(results),'passedCount':len(results)-len(failed),'failedCount':len(failed),'syntheticOnly':True,'fieldOriginals':0,'productExpectedJSONUsed':False,'checkerSHA256':c.sha(Path(__file__).read_bytes()),'singleCheckerSHA256':c.sha((Path(__file__).parent/'check_export.py').read_bytes()),'oracleSHA256':c.sha((prep/'oracle/ar_oracle.py').read_bytes()),'contractSHA256':c.sha((prep/'CONTRACT.ar.md').read_bytes()),'results':results,'rejectionReceipts':data.get('lifecycleRejections',[])}
 # Rejection receipts are retained as product claims, never counted as independently
 # verified rejection outcomes without their actual rejected bytes and errors.
 report['rejectionReceiptsIndependentlyVerified']=False
 (output/'REPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 return report

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--index',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--prep',type=Path,default=c.DEFAULT_PREP);a=p.parse_args()
 try:r=run(a.index,a.output_dir,a.prep)
 except (AssertionError,ValueError,KeyError,TypeError,OSError) as error:
  print(json.dumps({'passed':False,'error':str(error)}));return 1
 print(json.dumps({k:v for k,v in r.items() if k!='results'},ensure_ascii=False,indent=2));return 0 if r['passed'] else 1
if __name__=='__main__':sys.exit(main())
