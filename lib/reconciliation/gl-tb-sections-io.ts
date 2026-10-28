import { readFile } from './io.ts';
import { reconcileGlTbSections, type GlsInput } from './gl-tb-sections.ts';

const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const hex = async (b: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');

// The worker recomputes every account from the original bytes it is given:
// parsed rows sent by the page are never trusted, and nothing here keeps a
// decision (sessions, decisions and Excel are later layers).
export async function replayGlTbSections(input: GlsInput) {
  if (
    !plain(input) ||
    Object.keys(input).sort().join('|') !== 'files|readings|scope' ||
    !Array.isArray(input.files) ||
    input.files.length !== 2
  )
    throw Error('GLS_INPUT');
  // Take both originals, the roles and the scope synchronously, before any
  // await, so the caller cannot swap one while the other is hashed.
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
      throw Error('GLS_SOURCE');
    return {
      name: old.name,
      sha256: old.sha256,
      original: old.original.slice(0),
    };
  });
  const context = structuredClone({
    readings: input.readings,
    scope: input.scope,
  });
  const files = [];
  for (const old of snapshots) {
    if ((await hex(old.original)) !== old.sha256)
      throw Error('GLS_SOURCE_HASH');
    const file = await readFile(old.name, old.original);
    if (file.sha256 !== old.sha256) throw Error('GLS_SOURCE_HASH');
    files.push(file);
  }
  const state = {
    files: files as GlsInput['files'],
    readings: context.readings,
    scope: context.scope,
  };
  const result = reconcileGlTbSections(state);
  for (const file of files)
    if ((await hex(file.original!)) !== file.sha256)
      throw Error('GLS_SOURCE_HASH');
  return { state, result };
}
