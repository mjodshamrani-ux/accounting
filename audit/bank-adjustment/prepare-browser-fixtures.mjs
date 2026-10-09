import { mkdir, writeFile } from 'node:fs/promises';
import { adjustmentFixture, finishedAdjustment } from './fixtures.ts';
import { saveBankAdjustments } from '../../lib/reconciliation/bank-adjustment-io.ts';
await mkdir('work/bank-adjustment/browser', { recursive: true });
for (const name of [
  'old-carried',
  'isolated-own-bridge-gap',
  'settlement-cannot-hide-policy',
  'settlement-cannot-hide-undo',
  'malformed-competing-item',
]) {
  const { state } = await finishedAdjustment(name);
  await writeFile(
    `work/bank-adjustment/browser/${name}.json`,
    new Uint8Array(await saveBankAdjustments(state)),
  );
}
const state = await adjustmentFixture('closing-outflow');
await writeFile(
  'work/bank-adjustment/browser/pending.json',
  new Uint8Array(await saveBankAdjustments(state)),
);
const session = JSON.parse(
  new TextDecoder().decode(await saveBankAdjustments(state)),
);
session.files[0].sha256 = '0'.repeat(64);
await writeFile(
  'work/bank-adjustment/browser/tampered.json',
  JSON.stringify(session),
);

const { readFile: readSource } = await import('../../lib/reconciliation/io.ts');
const invalid = await adjustmentFixture('closing-outflow');
const rows = structuredClone(invalid.balance.files[0].sheets[0].rows);
rows[2][11] = 'broken-original-balance';
invalid.balance.files[0] = await readSource(
  'invalid-original-balance.csv',
  new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n') + '\n')
    .buffer,
);
await writeFile(
  'work/bank-adjustment/browser/invalid-balance.json',
  new Uint8Array(await saveBankAdjustments(invalid)),
);
