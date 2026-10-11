// Synthetic transformation only: independent frozen canonical B1/B2/B2.2
// endpoint truths remain the expected values. No frozen original is rewritten.
import ExcelJS from 'exceljs';
import { readFile } from '../../lib/reconciliation/io.ts';
import {
  BANK_WD_FAMILY,
  reconcileBank,
  type BankInput,
} from '../../lib/reconciliation/bank.ts';
import type { SourceFile } from '../../lib/reconciliation/types.ts';
export const csvBytes = (rows: string[][]) =>
  new TextEncoder().encode(
    rows
      .map((r) => r.map((v) => `"${v.replaceAll('"', '""')}"`).join(','))
      .join('\n') + '\n',
  ).buffer;
export async function withdrawalDeposit(
  input: BankInput,
  sides: (0 | 1)[] = [0, 1],
) {
  const original = reconcileBank(input);
  const actions = input.events.map((e) => ({
    ...e,
    bankIds: e.bankIds.map(
      (id) => original.inventory.find((i) => i.id === id)!.values[0],
    ),
    cashIds: e.cashIds.map(
      (id) => original.inventory.find((i) => i.id === id)!.values[0],
    ),
  }));
  const state = structuredClone(input);
  state.events = [];
  for (const side of sides) {
    const rows = state.files[side].sheets[0].rows;
    const direction = rows[0].indexOf('Cash direction'),
      amount = rows[0].indexOf('Amount');
    const converted = rows.map((r, i) => {
      const keep = r.filter((_, k) => k !== direction && k !== amount);
      if (!i) return [...keep, 'Withdrawal', 'Deposit'];
      const inactive = i % 2 ? '' : '0.00';
      return [
        ...keep,
        r[direction] === 'outflow' ? r[amount] : inactive,
        r[direction] === 'inflow' ? r[amount] : inactive,
      ];
    });
    state.files[side] = await readFile(
      `synthetic-wd-${side}.csv`,
      csvBytes(converted),
    );
    state.readings[side].family = BANK_WD_FAMILY;
  }
  for (const e of actions) {
    const r = reconcileBank(state);
    state.events.push({
      ...e,
      context: r.context,
      bankIds: e.bankIds.map(
        (ref) =>
          r.inventory.find((i) => i.side === 0 && i.values[0] === ref)!.id,
      ),
      cashIds: e.cashIds.map(
        (ref) =>
          r.inventory.find((i) => i.side === 1 && i.values[0] === ref)!.id,
      ),
    });
  }
  return state;
}
export async function nativeFile(file: SourceFile) {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Synthetic source');
  const rows = file.sheets[0].rows,
    headers = rows[0];
  const dates = new Set([
    'Movement date',
    'Value date',
    'Period start',
    'Period end',
    'As of',
  ]);
  const money = new Set(['Withdrawal', 'Deposit', 'Amount', 'Signed amount']);
  for (const [i, row] of rows.entries()) {
    sheet.addRow(
      row.map((v, k) =>
        !i || !v
          ? v
          : dates.has(headers[k])
            ? new Date(`${v}T00:00:00.000Z`)
            : money.has(headers[k])
              ? Number(v)
              : v,
      ),
    );
  }
  headers.forEach((h, i) => {
    if (dates.has(h)) sheet.getColumn(i + 1).numFmt = 'mm-dd-yy';
    if (money.has(h)) sheet.getColumn(i + 1).numFmt = '0.00';
  });
  return readFile(
    file.name.replace(/\.csv$/, '.xlsx'),
    new Uint8Array(await book.xlsx.writeBuffer()).buffer,
  );
}
