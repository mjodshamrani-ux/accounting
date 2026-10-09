import { validateCellText } from './io.ts';

/** Reject text Excel cannot represent; never clean review evidence silently. */
export function validateExportText(value: string | number, code: string) {
  if (typeof value !== 'string') return;
  if (value.length > 32767) throw new Error(code);
  validateCellText(value);
}

/** OOXML ST_Xstring encoding preserves CR, DEL and literal escape markers. */
export function excelExportText(value: string | number): string | number {
  return typeof value !== 'string'
    ? value
    : value
        // Consume only the opening underscore: a closing underscore may also
        // open the next literal escape, as in _x005F_x0041_.
        .replace(/_(?=x[0-9a-fA-F]{4}_)/g, '_x005F_')
        .replaceAll('\r', '_x000D_')
        .replaceAll('\u007f', '_x007F_');
}
