import { readFile as fsRead,mkdir,writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { readFile } from '../../lib/reconciliation/io.ts';
import { GL_TB_VERSION } from '../../lib/reconciliation/gl-tb.ts';
import { replayGlTb,saveGlTb,restoreGlTb,exportGlTb } from '../../lib/reconciliation/gl-tb-io.ts';
const root='audit/gl-tb/frozen/',truth=JSON.parse(await fsRead(root+'expected.json','utf8'));
await mkdir('work/gl-tb',{recursive:true});
for(const c of truth.cases){
  const files=await Promise.all(c.files.map(async f=>readFile(f.file,new Uint8Array(await fsRead(root+f.file)).buffer)));
  const input={files,scope:{...truth.scope,confirmed:true},readings:[{sheet:0,role:'gl-detail',family:GL_TB_VERSION,confirmed:true},{sheet:0,role:'trial-balance',family:GL_TB_VERSION,confirmed:true}]};
  const {result}=await replayGlTb(input);await writeFile(`work/gl-tb/${c.name}-direct.xlsx`,new Uint8Array(await exportGlTb(input,result)));
  const restored=await restoreGlTb(await saveGlTb(input));await writeFile(`work/gl-tb/${c.name}-restored.xlsx`,new Uint8Array(await exportGlTb(restored.state,restored.result)));
}
const nativeFiles=[];
for(const [side,name] of ['gl','tb'].entries()) {
  const csv=await readFile(`positive-${name}.csv`,new Uint8Array(await fsRead(root+`positive-${name}.csv`)).buffer);
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Native source');sheet.addRows(csv.sheets[0].rows);
  for(const row of sheet.getRows(2,sheet.rowCount-1)) {
    for(let c=side?12:14;c<=sheet.columnCount;c++){const cell=row.getCell(c);cell.value=Number(cell.value);cell.numFmt='0.00';}
    for(const c of side?[10,11]:[3,12,13]){const cell=row.getCell(c),text=cell.value;if(typeof text!=='string')throw Error('Synthetic ISO source date required');cell.value=new Date(text+'T00:00:00.000Z');cell.numFmt='yyyy-mm-dd';}
  }
  const bytes=new Uint8Array(await book.xlsx.writeBuffer());await writeFile(`work/gl-tb/native-source-${name}.xlsx`,bytes);
  nativeFiles.push(await readFile(`native-source-${name}.xlsx`,bytes.buffer));
}
const nativeInput={files:nativeFiles,scope:{...truth.scope,confirmed:true},readings:[{sheet:0,role:'gl-detail',family:GL_TB_VERSION,confirmed:true},{sheet:0,role:'trial-balance',family:GL_TB_VERSION,confirmed:true}]};
const nativeReplay=await replayGlTb(nativeInput);await writeFile('work/gl-tb/native-direct.xlsx',new Uint8Array(await exportGlTb(nativeReplay.state,nativeReplay.result)));
const nativeRestored=await restoreGlTb(await saveGlTb(nativeInput));await writeFile('work/gl-tb/native-restored.xlsx',new Uint8Array(await exportGlTb(nativeRestored.state,nativeRestored.result)));
console.log('GL/TB original and restored native workbooks generated.');
