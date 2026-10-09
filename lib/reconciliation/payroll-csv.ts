import { validateCellText } from './io.ts';
import { MAX_ROWS } from './types.ts';
// This declared family uses comma CSV and keeps the difference between a blank
// physical record (zero fields) and a quoted empty field (one literal field).
export function payrollCSV(original: ArrayBuffer): string[][] {
  if (!original.byteLength || original.byteLength > 8 * 1024 * 1024)
    throw Error('PAYROLL_SOURCE_CAPACITY');
  const input = new TextDecoder('utf-8', { fatal: true }).decode(original);
  validateCellText(input);
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false,
    touched = false;
  const finish = () => {
    if (rows.length === MAX_ROWS + 1) throw Error('PAYROLL_SOURCE_LIMIT');
    rows.push(touched ? [...row, cell] : []);
    row = [];
    cell = '';
    closed = false;
    touched = false;
  };
  const append = (character: string) => {
    if (cell.length + character.length > 32767)
      throw Error('PAYROLL_CELL_LIMIT');
    cell += character;
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          append('"');
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else append(c);
      continue;
    }
    if (c === '"') {
      if (cell || closed) throw Error('PAYROLL_CSV');
      quoted = true;
      touched = true;
      continue;
    }
    if (c === ',') {
      if (row.length === 99) throw Error('PAYROLL_SOURCE_LIMIT');
      row.push(cell);
      cell = '';
      closed = false;
      touched = true;
      continue;
    }
    if (c === '\r' || c === '\n') {
      finish();
      if (c === '\r' && input[i + 1] === '\n') i++;
      continue;
    }
    if (closed) throw Error('PAYROLL_CSV');
    append(c);
    touched = true;
  }
  if (quoted) throw Error('PAYROLL_CSV');
  if (touched) finish();
  return rows;
}
