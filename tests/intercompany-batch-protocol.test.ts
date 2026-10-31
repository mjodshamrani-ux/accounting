import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readIntercompanyFile } from '../lib/reconciliation/intercompany-source.ts';
import {
  IC_BATCH_VERSION,
  type IntercompanyBatchInput,
} from '../lib/reconciliation/intercompany-batch.ts';
import { replayIntercompanyBatches } from '../lib/reconciliation/intercompany-batch-io.ts';
import {
  WORKER_CHANNEL,
  isRequest,
  validateWorkerValue,
} from '../lib/reconciliation/protocol.ts';

const FROZEN = new URL(
  '../audit/intercompany-batch-foundation/frozen/',
  import.meta.url,
);
async function story(sid: string): Promise<IntercompanyBatchInput> {
  const names = (await readdir(FROZEN))
    .filter((n) => n.startsWith(`${sid}-`) && n.endsWith('.csv'))
    .sort();
  const files = [];
  for (const name of names) {
    const bytes = await readFile(new URL(name, FROZEN));
    files.push(await readIntercompanyFile(name, Uint8Array.from(bytes).buffer));
  }
  return {
    files,
    readings: names.map((n) => ({
      sheet: 0,
      role: n.endsWith('-batches.csv')
        ? 'batch-declaration'
        : n.endsWith('-relations.csv')
          ? 'relation-members'
          : 'entity-ledger',
      family: IC_BATCH_VERSION,
      confirmed: true,
    })),
  };
}

void test('IC batch worker: the replay recomputes from original bytes and the page installs only a result it can recompute', async () => {
  const value = await replayIntercompanyBatches(await story('I10'));
  assert.deepEqual(
    value.result.batches.map((b) => [b.id, b.status]),
    [
      ['AB', 'difference'],
      ['AG', 'ready'],
      ['BG', 'difference'],
    ],
  );
  assert.doesNotThrow(() =>
    validateWorkerValue('intercompany-batch-reconcile', value, {}),
  );
  for (const edit of [
    (v: typeof value) => {
      v.result.batches[0].status = 'ready';
    },
    (v: typeof value) => {
      v.result.batches[0].relations[0].residual = 0;
    },
    (v: typeof value) => {
      v.result.batches.pop();
    },
    (v: typeof value) => {
      v.result.unassigned.push({
        source: 1,
        row: 2,
        code: 'UNASSIGNED',
        entity: 'x',
      });
    },
    (v: typeof value) => {
      v.state.readings[0].role = 'entity-ledger';
    },
    (v: typeof value) => {
      v.state.files.reverse();
    },
  ]) {
    const bad = structuredClone(value);
    edit(bad);
    assert.throws(() =>
      validateWorkerValue('intercompany-batch-reconcile', bad, {}),
    );
  }
  assert.ok(
    isRequest({
      channel: WORKER_CHANNEL,
      id: 1,
      action: 'intercompany-batch-reconcile',
      payload: {},
    }),
  );
});

void test('IC batch worker: rows the page sends are not trusted; a changed original or another format is refused', async () => {
  const input = await story('I07');
  const forged = structuredClone(input);
  forged.files[1].sheets[0].rows[3][1] = 'Synthetic Beta Trading';
  const replayed = await replayIntercompanyBatches(forged);
  assert.deepEqual(
    replayed.result.batches.map((b) => [b.id, b.status, b.codes]),
    [
      ['AB', 'blocked', ['UNASSIGNED']],
      ['AG', 'blocked', ['UNASSIGNED']],
      ['BG', 'ready', []],
    ],
  );
  const changed = structuredClone(input);
  new Uint8Array(changed.files[2].original!)[0] ^= 1;
  await assert.rejects(
    () => replayIntercompanyBatches(changed),
    /IC_BATCH_SOURCE_HASH/,
  );
  const xlsx = structuredClone(input);
  xlsx.files[0].name = 'I07-batches.xlsx';
  await assert.rejects(
    () => replayIntercompanyBatches(xlsx),
    /IC_BATCH_SOURCE/,
  );
  await assert.rejects(
    () =>
      replayIntercompanyBatches({
        ...input,
        extra: 1,
      } as IntercompanyBatchInput),
    /IC_BATCH_INPUT/,
  );
});
