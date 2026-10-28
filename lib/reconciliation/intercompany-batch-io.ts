import {
  IC_BATCH_FILE_LIMIT,
  reconcileIntercompanyBatches,
  type IntercompanyBatchInput,
} from './intercompany-batch.ts';
import { readIntercompanyFile } from './intercompany-source.ts';

const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const hex = async (b: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');

// The worker recomputes every batch from the original bytes it is given, as
// the single-pair path does: parsed rows sent by the page are never trusted,
// and nothing here keeps a decision (sessions and decisions are IC-3).
export async function replayIntercompanyBatches(input: IntercompanyBatchInput) {
  if (
    !plain(input) ||
    Object.keys(input).sort().join('|') !== 'files|readings' ||
    !Array.isArray(input.files) ||
    !Array.isArray(input.readings) ||
    input.files.length > IC_BATCH_FILE_LIMIT
  )
    throw Error('IC_BATCH_INPUT');
  // Take every original and every role synchronously, before any await, so the
  // caller cannot swap a later file or role while an earlier one is hashed.
  const snapshots = input.files.map((old) => {
    if (
      !plain(old) ||
      old.kind !== undefined ||
      typeof old.name !== 'string' ||
      old.name.length > 255 ||
      !/\.csv$/i.test(old.name) ||
      !(old.original instanceof ArrayBuffer) ||
      typeof old.sha256 !== 'string'
    )
      throw Error('IC_BATCH_SOURCE');
    return {
      name: old.name,
      sha256: old.sha256,
      original: old.original.slice(0),
    };
  });
  const readings = structuredClone(input.readings);
  const files = [];
  for (const old of snapshots) {
    if ((await hex(old.original)) !== old.sha256)
      throw Error('IC_BATCH_SOURCE_HASH');
    const file = await readIntercompanyFile(old.name, old.original);
    if (file.sha256 !== old.sha256) throw Error('IC_BATCH_SOURCE_HASH');
    files.push(file);
  }
  const state: IntercompanyBatchInput = { files, readings };
  const result = reconcileIntercompanyBatches(state);
  for (const file of files)
    if ((await hex(file.original!)) !== file.sha256)
      throw Error('IC_BATCH_SOURCE_HASH');
  return { state, result };
}
