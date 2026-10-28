import { MAX_FILE_BYTES } from './types.ts';
import {
  reconcileLongRegister,
  type PlrInput,
  type PlrResult,
} from './payroll-long-register.ts';

export type PlrReplayFile = {
  name: string;
  original: ArrayBuffer;
  sha256?: string;
};
export type PlrReplayInput = {
  files: [PlrReplayFile];
  readings: PlrInput['readings'];
  scope: PlrInput['scope'];
};

const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The PAY-1 engine on the original bytes: the name, buffer, reading and scope
 * are copied before the first await, the copy is hashed, a hash the caller
 * sent must match it, and the engine reads only the copy. Nothing here keeps
 * a decision; sessions, decisions and Excel are later layers.
 */
export async function replayLongRegister(input: PlrReplayInput): Promise<{
  state: {
    files: [{ name: string; sha256: string; original: ArrayBuffer }];
    readings: PlrInput['readings'];
    scope: PlrInput['scope'];
  };
  result: PlrResult;
}> {
  if (!plain(input) || !Array.isArray(input.files) || input.files.length !== 1)
    throw new Error('PLR_INPUT');
  const f = input.files[0];
  if (
    !plain(f) ||
    typeof f.name !== 'string' ||
    !(f.original instanceof ArrayBuffer) ||
    !f.original.byteLength ||
    f.original.byteLength > MAX_FILE_BYTES ||
    (f.sha256 !== undefined && typeof f.sha256 !== 'string')
  )
    throw new Error('PLR_SOURCE');
  const copy = {
    name: f.name,
    claimed: f.sha256,
    bytes: new Uint8Array(f.original.slice(0)),
  };
  const readings = structuredClone(input.readings);
  const scope = structuredClone(input.scope);
  const sha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', copy.bytes)),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');
  if (copy.claimed !== undefined && copy.claimed !== sha256)
    throw new Error('PLR_SOURCE_HASH');
  // The state carries the copy the result was computed from, so the page can
  // hold it to its own request byte for byte and compute it again.
  return {
    state: {
      files: [{ name: copy.name, sha256, original: copy.bytes.slice().buffer }],
      readings,
      scope,
    },
    result: reconcileLongRegister({
      files: [{ name: copy.name, sha256, bytes: copy.bytes }],
      readings,
      scope,
    }),
  };
}
