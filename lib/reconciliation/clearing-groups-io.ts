import {
  groupClearing,
  refuse,
  type ClearingGroupsInput,
} from './clearing-groups.ts';
import { readFile } from './io.ts';
import { MAX_ROWS, type SourceFile } from './types.ts';

/** The reader's own ceiling, by its exact message: the sheet holds more
 * rows than MAX_ROWS lines and the header. */
const readerCeiling = `الحد ${MAX_ROWS} حركة تقريبًا مع صفوف العناوين`;

/** Trust native bytes, never caller-supplied parsed sheets. */
export async function replayClearingGroups(input: ClearingGroupsInput) {
  if (
    !input ||
    !input.file ||
    typeof input.file.name !== 'string' ||
    input.file.name.length > 255 ||
    input.file.kind !== undefined ||
    !/\.(csv|xlsx)$/i.test(input.file.name) ||
    !(input.file.original instanceof ArrayBuffer)
  )
    refuse('SOURCE');
  const source = {
    name: input.file.name,
    sha256: input.file.sha256,
    original: input.file.original!.slice(0),
  };
  const metadata = structuredClone({
    reading: input.reading,
    scope: input.scope,
  });
  let file: SourceFile;
  try {
    file = await readFile(source.name, source.original);
  } catch (error) {
    return refuse(
      String((error as Error).message) === readerCeiling ? 'ROWS' : 'SOURCE',
    );
  }
  if (file.sha256 !== source.sha256) refuse('SOURCE_HASH');
  const state: ClearingGroupsInput = { file, ...metadata };
  return { state, result: groupClearing(state) };
}
