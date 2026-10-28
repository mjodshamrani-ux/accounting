import { MAX_FILE_BYTES } from './types.ts';
import {
  reconcileMovementBridge,
  type ImbInput,
  type ImbResult,
} from './inventory-movement-bridge.ts';

export type ImbReplayFile = {
  name: string;
  original: ArrayBuffer;
  sha256?: string;
};
export type ImbReplayInput = {
  files: [ImbReplayFile, ImbReplayFile];
  readings: ImbInput['readings'];
  scope: ImbInput['scope'];
};
type ImbStateFile = { name: string; sha256: string; original: ArrayBuffer };

const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The INV-2 engine on the original bytes: the names, buffers, readings and
 * scope are copied before the first await, each copy is hashed, a hash the
 * caller sent must match it, and the engine reads only the copies. Nothing
 * here keeps a decision; sessions, decisions and Excel are later layers.
 */
export async function replayMovementBridge(input: ImbReplayInput): Promise<{
  state: {
    files: [ImbStateFile, ImbStateFile];
    readings: ImbInput['readings'];
    scope: ImbInput['scope'];
  };
  result: ImbResult;
}> {
  if (!plain(input) || !Array.isArray(input.files) || input.files.length !== 2)
    throw new Error('IMB_INPUT');
  const copies = input.files.map((f) => {
    if (
      !plain(f) ||
      typeof f.name !== 'string' ||
      !(f.original instanceof ArrayBuffer) ||
      !f.original.byteLength ||
      f.original.byteLength > MAX_FILE_BYTES ||
      (f.sha256 !== undefined && typeof f.sha256 !== 'string')
    )
      throw new Error('IMB_SOURCE');
    return {
      name: f.name,
      claimed: f.sha256,
      bytes: new Uint8Array(f.original.slice(0)),
    };
  });
  const readings = structuredClone(input.readings);
  const scope = structuredClone(input.scope);
  const hashed: (ImbStateFile & { bytes: Uint8Array })[] = [];
  for (const c of copies) {
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', c.bytes)),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
    if (c.claimed !== undefined && c.claimed !== sha256)
      throw new Error('IMB_SOURCE_HASH');
    hashed.push({
      name: c.name,
      sha256,
      original: c.bytes.slice().buffer,
      bytes: c.bytes,
    });
  }
  const [register, gl] = hashed;
  // The state carries the copies the result was computed from, so the page
  // can hold it to its own request byte for byte and compute it again.
  return {
    state: {
      files: [
        {
          name: register.name,
          sha256: register.sha256,
          original: register.original,
        },
        { name: gl.name, sha256: gl.sha256, original: gl.original },
      ],
      readings,
      scope,
    },
    result: reconcileMovementBridge({
      files: [
        { name: register.name, sha256: register.sha256, bytes: register.bytes },
        { name: gl.name, sha256: gl.sha256, bytes: gl.bytes },
      ],
      readings,
      scope,
    }),
  };
}
