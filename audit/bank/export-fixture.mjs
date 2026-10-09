import { mkdir,writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { bankTruth,bankFixture,finishedBank,bankEvent } from './fixtures.ts';
import { readFile } from '../../lib/reconciliation/io.ts';
import { reconcileBank } from '../../lib/reconciliation/bank.ts';
import { exportBank,saveBank,restoreBank } from '../../lib/reconciliation/bank-io.ts';
await mkdir('work/bank/exports',{recursive:true});
for(const c of bankTruth.cases){const {state,result}=await finishedBank(c);await writeFile(`work/bank/exports/${c.name}.xlsx`,new Uint8Array(await exportBank(state,result)));const restored=await restoreBank(await saveBank(state));await writeFile(`work/bank/exports/${c.name}-restored.xlsx`,new Uint8Array(await exportBank(restored.state,restored.result)));}
for(const name of ['outgoing-fees','timing-after-cutoff']){
 const c=bankTruth.cases.find(c=>c.name===name),state=await bankFixture(name);
 for(const [side,source]of state.files.entries()){
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Movements');
  for(const [i,row]of source.sheets[0].rows.entries())sheet.addRow(row.map((v,k)=>i?(k===16?Number(v):[2,3,14,15].includes(k)?new Date(`${v}T00:00:00.000Z`):v):v));sheet.getColumn(17).numFmt='0.00';
  const buffer=new Uint8Array(await book.xlsx.writeBuffer());await writeFile(`work/bank/exports/${name}-source-${side}.xlsx`,buffer);state.files[side]=await readFile(`${name}-source-${side}.xlsx`,buffer.buffer);
 }
 for(const [i,a]of c.actions.entries())if(!a.reject)state.events.push(bankEvent(a,reconcileBank(state),`D${i+1}`));
 await writeFile(`work/bank/exports/${name}-native.xlsx`,new Uint8Array(await exportBank(state,reconcileBank(state))));const restored=await restoreBank(await saveBank(state));await writeFile(`work/bank/exports/${name}-native-restored.xlsx`,new Uint8Array(await exportBank(restored.state,restored.result)));
}
console.log('106 CSV workbooks + 4 native workbooks and 4 native sources generated; synthetic only');
