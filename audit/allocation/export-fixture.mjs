import { mkdir, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { allocationTruth, finishedFixture } from './fixtures.ts';
import {
  restoreAllocation,
  saveAllocation,
  exportAllocation,
  replayAllocation,
} from '../../lib/reconciliation/allocation-io.ts';
import { readFile } from '../../lib/reconciliation/io.ts';
await mkdir('work/allocation', { recursive: true });
for (const c of allocationTruth.cases) {
  const v = await finishedFixture(c);
  await writeFile(
    `work/allocation/${c.name}-direct.xlsx`,
    new Uint8Array(await exportAllocation(v.state, v.result)),
  );
  const restored = await restoreAllocation(await saveAllocation(v.state));
  await writeFile(
    `work/allocation/${c.name}-restored.xlsx`,
    new Uint8Array(await exportAllocation(restored.state, restored.result)),
  );
}
const source = await finishedFixture(
  allocationTruth.cases.find((c) => c.name === 'one-to-many'),
);
const state = { ...source.state, events: [] };
for (const side of [0, 1, 2]) {
  const b = new ExcelJS.Workbook(),
    w = b.addWorksheet('Native');
  w.addRows(state.files[side].sheets[0].rows);
  for (let r = 2; r <= w.rowCount; r++)
    for (let c = 1; c <= w.columnCount; c++) {
      const cell = w.getCell(r, c),
        h = w.getCell(1, c).text;
      if (/amount$/i.test(h)) {
        cell.value = Number(cell.value);
        cell.numFmt = '0.00';
      }
      if (/date$/i.test(h)) {
        cell.value = new Date(cell.text + 'T00:00:00.000Z');
        cell.numFmt = 'yyyy-mm-dd';
      }
    }
  const bytes = new Uint8Array(await b.xlsx.writeBuffer()).buffer;
  await writeFile(
    `work/allocation/native-source-${side}.xlsx`,
    new Uint8Array(bytes),
  );
  state.files[side] = await readFile(`native-source-${side}.xlsx`, bytes);
}
const { fixtureEvent } = await import('./fixtures.ts');
let v = await replayAllocation(state);
state.events.push(
  fixtureEvent(
    { type: 'remittance', id: 'D1', proofs: ['R1', 'R2', 'R3'] },
    v.result,
  ),
);
v = await replayAllocation(state);
await writeFile(
  'work/allocation/native-direct.xlsx',
  new Uint8Array(await exportAllocation(v.state, v.result)),
);
const restored = await restoreAllocation(await saveAllocation(v.state));
await writeFile(
  'work/allocation/native-restored.xlsx',
  new Uint8Array(await exportAllocation(restored.state, restored.result)),
);
console.log(
  '44 frozen CSV workbooks and two native XLSX workbooks generated; synthetic sources only.',
);
