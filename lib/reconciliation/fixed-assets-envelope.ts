import {
  ASSET_FIELDS,
  assertAssetEventBudget,
  type AssetInput,
} from './fixed-assets.ts';
import { MAX_FILE_BYTES } from './types.ts';
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, expected: string[]) =>
  Object.keys(v).sort().join('|') === [...expected].sort().join('|');
function bytes(v: unknown): asserts v is ArrayBuffer {
  if (
    !(v instanceof ArrayBuffer) ||
    !v.byteLength ||
    v.byteLength > MAX_FILE_BYTES
  )
    throw Error('ASSET_SOURCE');
}
/** Capture only authoritative bytes and bounded decision metadata, never parsed caches. */
export function snapshotAsset(input: AssetInput): AssetInput {
  if (
    !plain(input) ||
    !keys(input, ['files', 'readings', 'scope', 'completeness', 'events']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 4 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 4
  )
    throw Error('ASSET_INPUT');
  assertAssetEventBudget(input.events);
  const bounded = (v: unknown, max: number) =>
    typeof v === 'string' && v.length <= max;
  if (
    !plain(input.scope) ||
    !keys(input.scope, [...ASSET_FIELDS, 'confirmed']) ||
    typeof input.scope.confirmed !== 'boolean' ||
    !ASSET_FIELDS.every((k) => bounded(input.scope[k], 500))
  )
    throw Error('ASSET_SCOPE');
  if (
    !plain(input.completeness) ||
    !keys(input.completeness, ['confirmed', 'reference', 'note']) ||
    typeof input.completeness.confirmed !== 'boolean' ||
    !bounded(input.completeness.reference, 2000) ||
    !bounded(input.completeness.note, 2000)
  )
    throw Error('ASSET_COMPLETENESS');
  for (const r of input.readings)
    if (
      !plain(r) ||
      !keys(r, ['sheet', 'role', 'family', 'confirmed']) ||
      r.sheet !== 0 ||
      !bounded(r.role, 100) ||
      !bounded(r.family, 100) ||
      typeof r.confirmed !== 'boolean'
    )
      throw Error('ASSET_READING');
  for (const e of input.events)
    if (
      !keys(e, [
        'id',
        'type',
        'memberIds',
        'context',
        'at',
        'reference',
        'note',
      ]) ||
      !bounded(e.id, 500) ||
      !bounded(e.type, 10) ||
      !bounded(e.context, 65536) ||
      !bounded(e.at, 100) ||
      !bounded(e.reference, 2000) ||
      !bounded(e.note, 2000) ||
      !e.memberIds.every((id) => bounded(id, 500))
    )
      throw Error('ASSET_EVENT');
  const files = input.files.map((f) => {
    if (
      !plain(f) ||
      f.kind !== undefined ||
      typeof f.name !== 'string' ||
      !f.name ||
      f.name.length > 255 ||
      !/\.csv$/i.test(f.name) ||
      typeof f.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      throw Error('ASSET_SOURCE');
    bytes(f.original);
    return {
      name: f.name,
      sha256: f.sha256,
      original: f.original.slice(0),
      sheets: [],
    };
  });
  return {
    files: [files[0], files[1], files[2], files[3]],
    ...structuredClone({
      readings: input.readings,
      scope: input.scope,
      completeness: input.completeness,
      events: input.events,
    }),
  };
}
