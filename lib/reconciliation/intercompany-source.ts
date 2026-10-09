import { assertIntercompanyNative } from './intercompany-native.ts';
import { readFile } from './io.ts';
import { MAX_FILE_BYTES } from './types.ts';
// The reciprocal-ledger family declares the Excel cell capacity explicitly.
// Other readers retain their existing4096 limit. No source bytes are rewritten.
export async function readIntercompanyFile(
  name: string,
  original: ArrayBuffer,
) {
  if (
    typeof name !== 'string' ||
    name.length > 255 ||
    !/\.(csv|xlsx)$/i.test(name) ||
    !(original instanceof ArrayBuffer) ||
    !original.byteLength ||
    original.byteLength > MAX_FILE_BYTES
  )
    throw Error('IC_SOURCE');
  try {
    const snapshot = original.slice(0);
    const file = await readFile(
      name,
      snapshot,
      undefined,
      false,
      undefined,
      32767,
    );
    await assertIntercompanyNative(file);
    const after = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', snapshot)),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
    if (after !== file.sha256) throw Error('IC_SOURCE_HASH');
    return file;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'نص إحدى الخلايا يتجاوز الحد المسموح'
    )
      throw Error('IC_CELL_LIMIT');
    throw error;
  }
}
