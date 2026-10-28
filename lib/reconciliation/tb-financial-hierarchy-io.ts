import { MAX_FILE_BYTES } from './types.ts';
import {
  reconcileFinancialHierarchy,
  type FinHInput,
  type FinHResult,
} from './tb-financial-hierarchy.ts';

export type FinHReplayFile = {
  name: string;
  original: ArrayBuffer;
  sha256?: string;
};
export type FinHReplayInput = {
  files: [FinHReplayFile, FinHReplayFile, FinHReplayFile, FinHReplayFile];
  readings: FinHInput['readings'];
  scope: FinHInput['scope'];
};

const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The FIN-1 engine on the original bytes: every name, buffer, reading and
 * scope is copied before the first await, each copy is hashed, a hash the
 * caller sent must match it, and the engine reads only the copies.
 */
export async function replayFinancialHierarchy(
  input: FinHReplayInput,
): Promise<{ result: FinHResult }> {
  if (
    !plain(input) ||
    !Array.isArray(input.files) ||
    input.files.length !== 4
  )
    throw new Error('FINH_INPUT');
  const copies = input.files.map((f) => {
    if (
      !plain(f) ||
      typeof f.name !== 'string' ||
      !(f.original instanceof ArrayBuffer) ||
      !f.original.byteLength ||
      f.original.byteLength > MAX_FILE_BYTES ||
      (f.sha256 !== undefined && typeof f.sha256 !== 'string')
    )
      throw new Error('FINH_SOURCE');
    return {
      name: f.name,
      claimed: f.sha256,
      bytes: new Uint8Array(f.original.slice(0)),
    };
  });
  const readings = structuredClone(input.readings);
  const scope = structuredClone(input.scope);
  const files = [];
  for (const c of copies) {
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', c.bytes)),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
    if (c.claimed !== undefined && c.claimed !== sha256)
      throw new Error('FINH_SOURCE_HASH');
    files.push({ name: c.name, sha256, bytes: c.bytes });
  }
  return {
    result: reconcileFinancialHierarchy({
      files: files as FinHInput['files'],
      readings,
      scope,
    }),
  };
}
