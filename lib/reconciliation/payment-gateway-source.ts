import { assertGatewayNative } from './payment-gateway-native.ts';
import { readFile } from './io.ts';
import { gatewayCSV } from './payment-gateway-csv.ts';
import { MAX_FILE_BYTES } from './types.ts';
// The one-batch gateway family declares the Excel cell capacity explicitly.
// Other readers retain their existing4096 limit. No source bytes are rewritten.
export async function readGatewayFile(name: string, original: ArrayBuffer) {
  if (
    typeof name !== 'string' ||
    name.length > 255 ||
    !/\.(csv|xlsx)$/i.test(name) ||
    !(original instanceof ArrayBuffer) ||
    !original.byteLength ||
    original.byteLength > MAX_FILE_BYTES
  )
    throw Error('PG_SOURCE');
  try {
    const snapshot = original.slice(0);
    // CSV has a declared comma grammar. Delimiter inference must not discard
    // malformed physical records before the domain engine can inventory them.
    const file = /\.csv$/i.test(name)
      ? {
          name,
          original: snapshot.slice(0),
          sheets: [
            {
              name: 'CSV',
              rows: gatewayCSV(snapshot),
              formulaRows: [],
              hiddenRows: [],
            },
          ],
          sha256: Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', snapshot)),
            (n) => n.toString(16).padStart(2, '0'),
          ).join(''),
        }
      : await readFile(name, snapshot, undefined, false, undefined, 32767);
    await assertGatewayNative(file);
    const after = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', snapshot)),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
    if (after !== file.sha256) throw Error('PG_SOURCE_HASH');
    return file;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'نص إحدى الخلايا يتجاوز الحد المسموح'
    )
      throw Error('PG_CELL_LIMIT');
    throw error;
  }
}
