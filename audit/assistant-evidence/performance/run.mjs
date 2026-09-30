import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import {readFile} from '../../../lib/reconciliation/io.ts';
import {selectImportMapping} from '../../../lib/reconciliation/import-selection.ts';
import {reconcileSupplierStatement} from '../../../lib/reconciliation/supplier-reconciliation.ts';
import {hasVerifiedExplanationEvidence,explainResult} from '../../../lib/reconciliation/assistant.ts';
const n=20000;let t=performance.now();
const files=[];
for(const side of ['supplier','ledger']){
 const lines=['Date,Document No,Amount,Type,Source Book'];
 for(let i=0;i<n;i++)lines.push(`2026-07-17,INV-P5-MEASURE-${i},${100+i}.00,Invoice,${side}`);
 files.push(await readFile(side+'.csv',new TextEncoder().encode(lines.join('\r\n')).buffer));
}
const readMs=performance.now()-t;
const mappings=files.map((f,i)=>selectImportMapping(f,i?'ledger':'supplier').mapping);
t=performance.now();
const result=reconcileSupplierStatement({files,mappings,scope:{supplier:'Synthetic performance supplier',entity:'Synthetic performance entity',account:'AP-P5',currency:'SAR',decimals:2,cutoff:'2026-07-31',dateWindow:3,confirmed:true,coverageConfirmed:false}}).result;
const comparisonMs=performance.now()-t;assert.equal(result.caseCounts.autoMatchedCases,n);
t=performance.now();assert.equal(hasVerifiedExplanationEvidence(result),true);const evidenceValidationMs=performance.now()-t;
const timings=[];
for(const q of ['What checks were completed?','Explain INV-P5-MEASURE-19999']){
 t=performance.now();const answer=explainResult(result,q);const ms=performance.now()-t;
 assert.notEqual(answer.kind,'unsupported');timings.push({question:q,kind:answer.kind,sourceIds:answer.sourceIds,milliseconds:ms});
}
const report={basis:'Synthetic 20k CSV movements per side, isolated Node measurement; not a browser or device latency guarantee',engine:'0.3.26-experimental',rowsPerSide:n,approved:n,readMs,comparisonMs,evidenceValidationMs,explanations:timings};
await writeFile('work/p5-explanation-performance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
