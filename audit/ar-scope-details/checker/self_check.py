#!/usr/bin/env python3
"""Preserve independently authored checker controls and pinned implementation hashes."""
import argparse,hashlib,json,platform,subprocess,sys
from pathlib import Path
import check_export as c

CONTROLS=['original-open-substitution','source-chunk-tamper','inventory-drop','parent-provenance-drop','foreign-member','foreign-amount','foreign-document','foreign-date','fraudulent-allocation','fraudulent-completeness','double-coverage','session-cache','family-migration','reading-column-tamper','source-head-drop','replayed-case-state','replayed-foreign-context','replayed-illegal-action-order','replayed-event-loss']
def main():
 p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,default=Path(__file__).parent/'logs/self-check');a=p.parse_args();a.output_dir.mkdir(parents=True,exist_ok=True)
 run=subprocess.run([sys.executable,'-B','-m','unittest','-v','test_check_export'],cwd=Path(__file__).parent,capture_output=True,text=True)
 (a.output_dir/'unittest.log').write_text(run.stdout+run.stderr)
 receipt={'passed':run.returncode==0,'python':platform.python_version(),'testMethods':6,'positiveSourceCases':4,'corruptionControls':CONTROLS,'corruptionCount':len(CONTROLS),'nativeOriginalChecks':['numeric-100.00-lexeme-preserved','zero-row-height-rejected','literal-text-format-;;;-rejected'],'rawOOXMLRoundTrip':True,'actualProductExportsCheckedByUnitControls':0,'fieldOriginals':0,'syntheticOnly':True,'dependencies':['sealed preparation contract','sealed manual TRUTHS.json','sealed independent oracle/ar_oracle.py'],'forbiddenReads':['product implementation','product tests','product fixture generator','product driver expectations'],'hashes':{p.name:c.sha(p.read_bytes()) for p in [Path(__file__),Path(__file__).parent/'check_export.py',Path(__file__).parent/'check_exports.py',Path(__file__).parent/'test_check_export.py',c.DEFAULT_PREP/'oracle/ar_oracle.py',c.DEFAULT_PREP/'CONTRACT.ar.md',c.DEFAULT_PREP/'fixtures/TRUTHS.json']}}
 (a.output_dir/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,indent=2));return run.returncode
if __name__=='__main__':sys.exit(main())
