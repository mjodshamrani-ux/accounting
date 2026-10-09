import { mkdir, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { adjustmentTruth, finishedAdjustment } from './fixtures.ts';
import {
  saveBankAdjustments,
  restoreBankAdjustments,
  exportBankAdjustments,
} from '../../lib/reconciliation/bank-adjustment-io.ts';
import { readFile } from '../../lib/reconciliation/io.ts';
import { reconcileBankAdjustments } from '../../lib/reconciliation/bank-adjustment.ts';
const out = 'work/bank-adjustment/exports';
await mkdir(out, { recursive: true });
for (const c of adjustmentTruth.cases) {
  if (c.reject) continue;
  const { state, result } = await finishedAdjustment(c.name);
  await writeFile(
    `${out}/${c.name}.xlsx`,
    new Uint8Array(await exportBankAdjustments(state, result)),
  );
  const restored = await restoreBankAdjustments(
    await saveBankAdjustments(state),
  );
  await writeFile(
    `${out}/${c.name}-restored.xlsx`,
    new Uint8Array(
      await exportBankAdjustments(restored.state, restored.result),
    ),
  );
}
for (const name of ['closing-outflow', 'old-carried']) {
  const { state } = await finishedAdjustment(name);
  state.events = [];
  for (const [source, old] of state.files.entries()) {
    const b = new ExcelJS.Workbook(),
      s = b.addWorksheet('Evidence');
    for (const [i, row] of old.sheets[0].rows.entries())
      s.addRow(
        row.map((v, k) =>
          i
            ? k === (source ? 14 : 4)
              ? Number(v)
              : source && [5, 6, 12, 13].includes(k)
                ? new Date(`${v}T00:00:00.000Z`)
                : v
            : v,
        ),
      );
    s.getColumn(source ? 15 : 5).numFmt = '0.00';
    const bytes = new Uint8Array(await b.xlsx.writeBuffer()),
      file = `${name}-source-${source}.xlsx`;
    await writeFile(`${out}/${file}`, bytes);
    state.files[source] = await readFile(file, bytes.buffer);
  }
  let result = reconcileBankAdjustments(state);
  for (const l of result.lifecycles) {
    state.events.push({
      id: `native-${l.reference}`,
      type: 'accept',
      context: result.context,
      at: '2026-10-06T12:00:00.000Z',
      reference: 'SYNTHETIC native proof',
      note: 'Complete original typed evidence reviewed',
      itemIds: l.itemIds,
    });
    result = reconcileBankAdjustments(state);
  }
  await writeFile(
    `${out}/${name}-native.xlsx`,
    new Uint8Array(await exportBankAdjustments(state, result)),
  );
  const r = await restoreBankAdjustments(await saveBankAdjustments(state));
  await writeFile(
    `${out}/${name}-native-restored.xlsx`,
    new Uint8Array(await exportBankAdjustments(r.state, r.result)),
  );
}
console.log(
  '88 CSV direct/restored workpapers + 4 native workpapers; synthetic only',
);
