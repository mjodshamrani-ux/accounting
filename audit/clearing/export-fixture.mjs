import { readFile as read, writeFile, mkdir } from 'node:fs/promises';
import { readFile } from '../../lib/reconciliation/io.ts';
import { reconcileClearing } from '../../lib/reconciliation/clearing.ts';
import {
  exportClearing,
  saveClearing,
  restoreClearing,
} from '../../lib/reconciliation/clearing-io.ts';
import {
  clearingDemoReading,
  clearingDemoScope,
} from '../../lib/reconciliation/clearing-demo.ts';
await mkdir('work/clearing', { recursive: true });
const bytes = await read('audit/clearing/frozen/source.csv');
const input = {
  file: await readFile('clearing.csv', new Uint8Array(bytes).buffer),
  reading: { ...clearingDemoReading },
  scope: { ...clearingDemoScope },
  events: [],
};
await writeFile(
  'work/clearing/direct.xlsx',
  new Uint8Array(await exportClearing(input, reconcileClearing(input))),
);
const session = await saveClearing(input);
await writeFile('work/clearing/session.json', new Uint8Array(session));
const restored = await restoreClearing(session);
await writeFile(
  'work/clearing/restored.xlsx',
  new Uint8Array(await exportClearing(restored.state, restored.result)),
);
