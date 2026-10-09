import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readGatewayFile } from '../lib/reconciliation/payment-gateway-source.ts';
import { gatewayFixture } from '../audit/payment-gateway/fixtures.ts';
import { reconcileGateway } from '../lib/reconciliation/payment-gateway.ts';
import {
  saveGateway,
  restoreGateway,
  exportGateway,
} from '../lib/reconciliation/payment-gateway-io.ts';
import { gatewayCSV } from '../lib/reconciliation/payment-gateway-csv.ts';
const root = new URL(
  '../audit/payment-gateway/comma-provenance/',
  import.meta.url,
);
const truth = JSON.parse(
  await readFile(new URL('expected.json', root), 'utf8'),
);
void test('Declared gateway comma CSV preserves malformed semicolon physical records without delimiter inference', async () => {
  const bytes = new Uint8Array(await readFile(new URL('source-0.csv', root)))
    .buffer;
  assert.deepEqual(gatewayCSV(bytes), truth.rows);
  const input = await gatewayFixture('pending');
  input.files[0] = await readGatewayFile('source-0.csv', bytes);
  const r = reconcileGateway(input);
  assert.equal(r.status, truth.status);
  assert.equal(r.records[0].length, truth.validTransactions);
  assert.equal(r.memberIds.length, truth.physicalMembers);
  assert.deepEqual(
    r.issues.map((i) => [i.code, i.source, i.row]),
    truth.issueRows.map((row: number) => ['COLUMNS', 0, row]),
  );
  assert.equal(r.totals, null);
  assert.equal(r.residuals, null);
  input.events = [
    {
      id: 'comma-full-reject',
      type: 'reject',
      batchId: input.scope.batchId,
      at: '2026-10-07T23:00:00.000Z',
      reference: 'Synthetic physical inventory',
      note: 'Reject all11 physical members including4malformed records; not field evidence',
      context: r.context,
      memberIds: r.memberIds,
    },
  ];
  const current = reconcileGateway(input);
  assert.equal(current.review, 'rejected');
  const restored = await restoreGateway(await saveGateway(input));
  assert.deepEqual(restored.result, current);
  await mkdir('work/payment-comma/exports', { recursive: true });
  await writeFile(
    'work/payment-comma/exports/full-physical-reject.xlsx',
    new Uint8Array(await exportGateway(input, current)),
  );
  await writeFile(
    'work/payment-comma/exports/full-physical-reject-session.json',
    new Uint8Array(await saveGateway(input)),
  );
  assert.throws(
    () =>
      reconcileGateway({
        ...input,
        events: [{ ...input.events[0], memberIds: r.memberIds.slice(0, -1) }],
      }),
    /PG_EVENT/,
  );
});
void test('Declared comma parser retains bounded rows columns cells quote grammar UTF8 and source controls', async () => {
  const csv = (s: string) => gatewayCSV(new TextEncoder().encode(s).buffer);
  assert.equal(csv('a,b\n'.repeat(20001)).length, 20001);
  assert.throws(() => csv('a,b\n'.repeat(20002)), /PG_SOURCE_LIMIT/);
  assert.equal(csv(Array(100).fill('a').join(','))[0].length, 100);
  assert.throws(() => csv(Array(101).fill('a').join(',')), /PG_SOURCE_LIMIT/);
  assert.equal(csv('"' + 'x'.repeat(32767) + '"')[0][0].length, 32767);
  assert.throws(() => csv('"' + 'x'.repeat(32768) + '"'), /PG_CELL_LIMIT/);
  for (const s of ['"unclosed', '"closed"tail', 'a"b'])
    assert.throws(() => csv(s), /PG_CSV/);
  assert.throws(() => csv('safe\u0000control'));
  assert.throws(() => gatewayCSV(Uint8Array.of(0xff).buffer));
  assert.deepEqual(csv('\ufeffh1,h2\r\n"a,b","quote""inside"\r\n\n""\n'), [
    ['h1', 'h2'],
    ['a,b', 'quote"inside'],
    [],
    [''],
  ]);
});
