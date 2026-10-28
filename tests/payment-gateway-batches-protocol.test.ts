import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  PG_BATCHES_HEADERS,
  PG_BATCHES_ROLES,
  PG_BATCHES_VERSION,
  reviewGatewayBatches,
} from '../lib/reconciliation/payment-gateway-batches.ts';
import {
  replayGatewayBatches,
  type GatewayBatchesReplayInput,
} from '../lib/reconciliation/payment-gateway-batches-io.ts';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';

// A small synthetic card gateway in Omani rials, unrelated to the PG-1
// stories.
const MID = 'PROTO-MID-7';
const BANK = 'PROTO-BANK-3';
const SCOPE = {
  entity: 'SYN-PROTOCOL-CO',
  gateway: 'SYN-PROTOCOL-GW',
  merchantAccount: MID,
  bankAccount: BANK,
  currency: 'OMR',
  start: '2028-05-01',
  end: '2028-05-31',
  asOf: '2028-06-05',
  confirmed: true as const,
};
const rows = (credit = '19.250') => [
  [['S-1', 'B-1', 'sale', '2028-05-04', '20.000', 'Order 1', MID, 'OMR']],
  [['F-1', 'B-1', '0.750', 'Card fee', MID, 'OMR']],
  [['B-1', '2028-05-06', '20.000', '0', '0.750', '19.250', MID, 'OMR']],
  [['P-1', 'B-1', '19.250', MID, 'OMR']],
  [['K-1', 'P-1', '2028-05-07', credit, BANK, 'OMR']],
];
function request(credit?: string): GatewayBatchesReplayInput {
  return {
    files: rows(credit).map((body, side) => {
      const bytes = new TextEncoder().encode(
        [PG_BATCHES_HEADERS[side], ...body].map((r) => r.join(',')).join('\n') +
          '\n',
      );
      return {
        name: `${PG_BATCHES_ROLES[side]}.csv`,
        original: bytes.buffer as ArrayBuffer,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
    readings: PG_BATCHES_ROLES.map((role) => ({
      sheet: 0 as const,
      role,
      family: PG_BATCHES_VERSION,
      confirmed: true as const,
    })),
    scope: { ...SCOPE },
  };
}
const refused = (value: unknown, payload: unknown) =>
  assert.throws(
    () =>
      validateWorkerValue('payment-gateway-batches-reconcile', value, payload),
    /غير مكتملة/,
  );

void test('gateway batches worker: the page installs only a review it can compute again for the files it sent', async () => {
  const payload = request();
  const value = await replayGatewayBatches(payload);
  assert.deepEqual(
    value.result.batches.map((b) => [b.batch, b.status]),
    [['B-1', 'consistent']],
  );
  validateWorkerValue('payment-gateway-batches-reconcile', value, payload);
  const status = structuredClone(value);
  status.result.batches[0].status = 'review';
  refused(status, payload);
  const credits = structuredClone(value);
  credits.result.credits = [];
  credits.result.payouts[0].credit = null;
  refused(credits, payload);
  // A review of other files is not this request's review.
  refused(await replayGatewayBatches(request('19.251')), payload);
  // Nor of these files under another scope or reading.
  refused(value, { ...payload, scope: { ...SCOPE, gateway: 'OTHER' } });
  refused(value, {
    ...payload,
    readings: [...payload.readings].reverse(),
  });
  // The bytes it carries must be the bytes sent, file by file.
  const bytes = structuredClone(value);
  new Uint8Array(bytes.state.files[4].original!)[0] ^= 1;
  refused(bytes, payload);
  const swapped = structuredClone(value);
  swapped.state.files.reverse();
  refused(swapped, payload);
  // The same bytes under another name are not the file sent, even with a
  // review that names it so.
  const renamed = structuredClone(value);
  renamed.state.files[1].name = 'other-fees.csv';
  renamed.result.sources[1].name = 'other-fees.csv';
  refused(renamed, payload);
  refused({ ...value, extra: true }, payload);
  // Sheets and review forged together agree with each other: the protocol
  // cannot tell, and the page's replay of its own bytes refuses them (the
  // binding test).
  const agreeing = structuredClone(value);
  agreeing.state.files[4].sheets[0].rows[1][3] = '19.200';
  agreeing.result = reviewGatewayBatches(agreeing.state);
  assert.deepEqual(agreeing.result.payouts[0].reasons, ['CREDIT']);
  validateWorkerValue('payment-gateway-batches-reconcile', agreeing, payload);
  refused(
    {
      ...value,
      result: { ...value.result, version: 'payment-gateway-batch-1' },
    },
    payload,
  );
});

void test('gateway batches worker: refusals carry the family code, and the reader ceiling is ROWS', async () => {
  const payload = request();
  await assert.rejects(
    replayGatewayBatches({
      ...payload,
      scope: { ...SCOPE, confirmed: false as unknown as true },
    }),
    /^Error: PG_BATCHES_SCOPE$/,
  );
  await assert.rejects(
    replayGatewayBatches({
      ...payload,
      files: payload.files.map((f, i) =>
        i === 2 ? { ...f, name: 'settlements.pdf' } : f,
      ),
    }),
    /^Error: PG_BATCHES_SOURCE$/,
  );
  // A row of 101 cells is past the reader's 100 columns.
  const wide = new TextEncoder().encode(
    [PG_BATCHES_HEADERS[1].join(','), Array(101).fill('x').join(',')].join(
      '\n',
    ) + '\n',
  );
  await assert.rejects(
    replayGatewayBatches({
      ...payload,
      files: payload.files.map((f, i) =>
        i === 1
          ? {
              name: 'fees.csv',
              original: wide.buffer as ArrayBuffer,
              sha256: createHash('sha256').update(wide).digest('hex'),
            }
          : f,
      ),
    }),
    /^Error: PG_BATCHES_ROWS$/,
  );
  const hundred = new TextEncoder().encode(
    [PG_BATCHES_HEADERS[1].join(','), Array(100).fill('x').join(',')].join(
      '\n',
    ) + '\n',
  );
  const read = await replayGatewayBatches({
    ...payload,
    files: payload.files.map((f, i) =>
      i === 1
        ? {
            name: 'fees.csv',
            original: hundred.buffer as ArrayBuffer,
            sha256: createHash('sha256').update(hundred).digest('hex'),
          }
        : f,
    ),
  });
  assert.deepEqual(read.result.errors, [
    { source: 1, row: 2, code: 'COLUMNS' },
  ]);
});
