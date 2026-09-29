import { readFile } from '../../lib/reconciliation/io.ts';
import type { SourceFile } from '../../lib/reconciliation/types.ts';

// A supplier statement and a ledger are two documents. A fixture that hands
// the very same file (same bytes, sheet and rows) to both sides is one source
// compared with itself, and since V1.1 the engine keeps every case of such a
// comparison for review. Fixtures that mean "the ledger records the same
// entries" use these helpers to make the ledger a separate file: the same
// cells, but not the same file. Nothing about the entries changes.

/** The same bytes followed by one line break: a separate CSV export. */
export function separateBytes(bytes: ArrayBuffer): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength + 1);
  copy.set(new Uint8Array(bytes));
  copy[bytes.byteLength] = 0x0a;
  return copy.buffer;
}

/** The same sheets with a trailing blank row, for a file built in memory
 * without bytes or a SHA-256. */
export function separateSheets(file: SourceFile, name = file.name): SourceFile {
  if (file.sha256)
    throw new Error(
      'separateSheets is for in-memory files; re-read separateBytes instead',
    );
  return {
    ...file,
    name,
    sheets: file.sheets.map((sheet) => ({
      ...sheet,
      rows: [...sheet.rows.map((row) => [...row]), []],
    })),
  };
}

/** A file already read, read again from its own bytes plus one line break
 * (after a PDF's end marker or a CSV's last row), as the ledger's copy. */
export function readSeparately(
  file: SourceFile,
  ...options: [pdfCuts?: number[], autoPdfColumns?: boolean]
): Promise<SourceFile> {
  if (!file.original)
    throw new Error('readSeparately needs the original bytes');
  // A workbook with bytes after its archive is rightly refused; write a
  // second export of the workbook instead.
  if (/\.xlsx$/i.test(file.name))
    throw new Error('readSeparately is for CSV and PDF files');
  return readFile(
    `ledger-${file.name}`,
    separateBytes(file.original),
    ...options,
  );
}
