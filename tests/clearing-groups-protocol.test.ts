import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../lib/reconciliation/io.ts';
import type { ClearingGroupsInput } from '../lib/reconciliation/clearing-groups.ts';
import { replayClearingGroups } from '../lib/reconciliation/clearing-groups-io.ts';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';

// A small synthetic suspense account, unrelated to the CLR-1 stories.
const HEAD = 'Journal,Clearing Document,Date,Net,GL,Ccy,Narrative';
const text = (net = '-75.00') =>
  [
    HEAD,
    'J1,DOC-1,2028-03-02,75.00,2299,QAR,Freight',
    `J2,DOC-1,2028-03-03,${net},2299,QAR,Settlement`,
    'J3,DOC-2,2028-03-04,bad,2299,QAR,Faulty',
  ].join('\n') + '\n';
const READING = {
  sheet: 0,
  header: 0,
  posting: 0,
  reference: 1,
  date: 2,
  amount: 3,
  debit: -1,
  credit: -1,
  account: 4,
  currency: 5,
  description: 6,
  mode: 'signed' as const,
};
const SCOPE = {
  entity: 'SYN-PROTOCOL-CO',
  ledger: 'P-GL',
  account: '2299',
  currency: 'QAR',
  start: '2028-03-01',
  end: '2028-03-31',
  confirmed: true,
};
async function request(net?: string): Promise<ClearingGroupsInput> {
  const bytes = new TextEncoder().encode(text(net));
  return {
    file: await readFile('suspense.csv', bytes.buffer),
    reading: { ...READING },
    scope: { ...SCOPE },
  };
}
const refused = (value: unknown, payload: unknown) =>
  assert.throws(
    () => validateWorkerValue('clearing-groups-reconcile', value, payload),
    /غير مكتملة/,
  );

void test('clearing groups worker: the page installs only a result it can compute again for the file it sent', async () => {
  const payload = await request();
  const value = await replayClearingGroups(payload);
  assert.deepEqual(
    value.result.groups.map((g) => [g.reference, g.status]),
    [['DOC-1', 'cleared']],
  );
  validateWorkerValue('clearing-groups-reconcile', value, payload);
  const changed = structuredClone(value);
  changed.result.groups[0].status = 'review';
  refused(changed, payload);
  const hidden = structuredClone(value);
  hidden.result.faulty = [];
  refused(hidden, payload);
  // A result for another extract is not this request's result.
  refused(await replayClearingGroups(await request('-75.01')), payload);
  // Nor for this extract under another scope or reading.
  refused(value, { ...payload, scope: { ...SCOPE, ledger: 'P-GL-2' } });
  refused(value, { ...payload, reading: { ...READING, description: -1 } });
  // The bytes it carries must be the bytes sent.
  const bytes = structuredClone(value);
  new Uint8Array(bytes.state.file.original!)[0] ^= 1;
  refused(bytes, payload);
  refused({ ...value, extra: true }, payload);
  refused(
    { ...value, result: { ...value.result, version: 'clearing-1' } },
    payload,
  );
});

void test('clearing groups worker: refusals carry the family code', async () => {
  const payload = await request();
  await assert.rejects(
    replayClearingGroups({
      ...payload,
      scope: { ...SCOPE, confirmed: false },
    }),
    /^Error: CLEARING_GROUPS_SCOPE$/,
  );
  await assert.rejects(
    replayClearingGroups({
      ...payload,
      file: { ...payload.file, name: 'suspense.pdf' },
    }),
    /^Error: CLEARING_GROUPS_SOURCE$/,
  );
});
