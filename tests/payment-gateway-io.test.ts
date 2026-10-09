import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead, mkdir, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import {
  gatewayTruth,
  gatewayFixture,
  finishedGateway,
} from '../audit/payment-gateway/fixtures.ts';
import { reconcileGateway } from '../lib/reconciliation/payment-gateway.ts';
import { readGatewayFile } from '../lib/reconciliation/payment-gateway-source.ts';
import {
  replayGateway,
  saveGateway,
  restoreGateway,
  exportGateway,
} from '../lib/reconciliation/payment-gateway-io.ts';
const directory = new URL('../work/payment-gateway/exports/', import.meta.url);
void test('Gateway IO: every supported frozen original reparses/session/restores/exports all15 native evidence tables', async () => {
  await mkdir(directory, { recursive: true });
  const contract = JSON.parse(
    await fsRead(
      new URL('../audit/payment-gateway/export-contract.json', import.meta.url),
      'utf8',
    ),
  ) as { sheets: Record<string, string[]> };
  for (const c of gatewayTruth.cases) {
    if (c.status.startsWith('throws:')) continue;
    const base = await finishedGateway(c.name),
      fresh = await replayGateway(base.state),
      session = await saveGateway(fresh.state),
      restored = await restoreGateway(session);
    assert.deepEqual(restored.result, fresh.result, c.name);
    for (const [suffix, x] of [
      ['direct', fresh],
      ['restored', restored],
    ] as const) {
      const data = await exportGateway(x.state, x.result);
      await writeFile(
        new URL(c.name + '-' + suffix + '.xlsx', directory),
        new Uint8Array(data),
      );
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(data as never);
      assert.deepEqual(
        book.worksheets.map((w) => w.name),
        Object.keys(contract.sheets),
        c.name,
      );
      for (const sheet of book.worksheets)
        assert.deepEqual(
          (sheet.getRow(1).values as unknown[]).slice(1),
          contract.sheets[sheet.name],
        );
    }
  }
});
void test('Gateway IO: four independently authored original XLSX remain accepted before any cached result is used', async () => {
  const state = await gatewayFixture('pending');
  for (let i = 0; i < 4; i++) {
    const b = await fsRead(
      new URL(
        '../audit/payment-gateway/native/source-' + i + '.xlsx',
        import.meta.url,
      ),
    );
    state.files[i] = await readGatewayFile(
      'source-' + i + '.xlsx',
      Uint8Array.from(b).buffer,
    );
  }
  const fresh = await replayGateway(state),
    restored = await restoreGateway(await saveGateway(state));
  assert.equal(fresh.result.status, 'needs-review');
  assert.deepEqual(restored.result, fresh.result);
  for (const [suffix, x] of [
    ['direct', fresh],
    ['restored', restored],
  ] as const)
    await writeFile(
      new URL('native-pending-' + suffix + '.xlsx', directory),
      new Uint8Array(await exportGateway(x.state, x.result)),
    );
});
void test('Gateway IO: real asynchronous digest snapshots all bytes, scope and decisions; changed cached cells cannot forge money', async () => {
  const base = await finishedGateway('accepted'),
    expected = structuredClone(base.result);
  const subtle = crypto.subtle;
  // oxlint-disable-next-line typescript/unbound-method -- Invoked with apply(subtle,args) and restored unchanged.
  const digest = subtle.digest;
  let calls = 0;
  subtle.digest = function (...args: Parameters<typeof digest>) {
    const pending = digest.apply(subtle, args);
    if (++calls === 1) {
      new Uint8Array(base.state.files[3].original!).fill(0);
      base.state.scope.policyVersion = 'changed';
      base.state.events = [];
      base.state.completeness.confirmed = false;
    }
    return pending;
  };
  try {
    assert.deepEqual((await replayGateway(base.state)).result, expected);
  } finally {
    subtle.digest = digest;
  }
  const stale = await gatewayFixture('wrong-net');
  stale.files[2].sheets[0].rows[1][
    stale.files[2].sheets[0].rows[0].indexOf('Net')
  ] = '97.00';
  assert.equal(reconcileGateway(stale).financial, 'ready');
  assert.equal((await replayGateway(stale)).result.status, 'difference');
});
void test('Gateway IO: stale export/forged hash/session extras/base64 and native hidden display never become accepted evidence', async () => {
  const base = await finishedGateway('accepted');
  await assert.rejects(
    () => exportGateway(base.state, { ...base.result, status: 'needs-review' }),
    /PG_STALE_EXPORT/,
  );
  const parsed = JSON.parse(
    new TextDecoder().decode(await saveGateway(base.state)),
  );
  parsed.result = base.result;
  await assert.rejects(
    () =>
      restoreGateway(new TextEncoder().encode(JSON.stringify(parsed)).buffer),
    /PG_SESSION/,
  );
  delete parsed.result;
  parsed.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(
    () =>
      restoreGateway(new TextEncoder().encode(JSON.stringify(parsed)).buffer),
    /PG_SOURCE_HASH/,
  );
  // The original visibility regression stays byte-identical; no rewritten user file.
  const white = await fsRead(
    new URL(
      '../audit/intercompany/regressions/native-white-font.xlsx',
      import.meta.url,
    ),
  );
  await assert.rejects(() =>
    readGatewayFile('white.xlsx', Uint8Array.from(white).buffer),
  );
});
void test('Gateway IO: correctly headed native visibility and fractional dates reject, while the integer control works', async () => {
  for (const [name, reason] of [
    ['white-font.xlsx', 'BANK_NATIVE_DISPLAY'],
    ['fractional-date.xlsx', 'PG_NATIVE_DISPLAY'],
  ] as const) {
    const b = await fsRead(
      new URL('../audit/payment-gateway/regressions/' + name, import.meta.url),
    );
    await assert.rejects(
      () => readGatewayFile(name, Uint8Array.from(b).buffer),
      new RegExp(reason),
    );
  }
  const b = await fsRead(
    new URL(
      '../audit/payment-gateway/regressions/integer-date.xlsx',
      import.meta.url,
    ),
  );
  const file = await readGatewayFile(
    'integer-date.xlsx',
    Uint8Array.from(b).buffer,
  );
  assert.equal(file.sheets[0].rows[1][2], '2026-09-10');
});
void test('Gateway IO: a full rejected batch retains every malformed physical record through the session and export', async () => {
  const corpus = JSON.parse(
    await fsRead(
      new URL('../audit/payment-gateway/event-contracts.json', import.meta.url),
      'utf8',
    ),
  );
  const c = corpus.cases.find(
    (e: { name: string }) => e.name === 'reject-malformed-whole-batch',
  );
  const state = await gatewayFixture(c.case);
  state.completeness = c.complete;
  state.events = c.events;
  const fresh = await replayGateway(state),
    restored = await restoreGateway(await saveGateway(state));
  assert.equal(fresh.result.status, 'source-error');
  assert.equal(fresh.result.review, 'rejected');
  assert.equal(fresh.result.memberIds.length, 8);
  assert.deepEqual(restored.result, fresh.result);
  await writeFile(
    new URL('malformed-whole-reject.xlsx', directory),
    new Uint8Array(await exportGateway(restored.state, restored.result)),
  );
  const partial = structuredClone(state);
  partial.events[0].memberIds.splice(3, 1);
  await assert.rejects(() => replayGateway(partial), /PG_EVENT_MEMBERS/);
});
void test('Gateway IO: the aggregate decision budget rejects excessive membership before asynchronous source replay', async () => {
  const state = await gatewayFixture('pending');
  const base = (await finishedGateway('accepted')).state.events[0];
  state.events = Array.from({ length: 6 }, (_, i) => ({
    ...base,
    id: 'CAP-' + i,
    memberIds: Array.from({ length: 20000 }, () => base.memberIds[0]),
  }));
  await assert.rejects(() => replayGateway(state), /PG_EVENT_CAPACITY/);
  await assert.rejects(() => saveGateway(state), /PG_EVENT_CAPACITY/);
});
void test('Gateway source: blank physical records and quoted empty fields retain their distinct original cell inventory', async () => {
  const blank = await gatewayFixture('blank-rows-retained');
  assert.deepEqual(blank.files[0].sheets[0].rows[2], []);
  const bytes = await fsRead(
    new URL(
      '../audit/payment-gateway/regressions/quoted-empty-record.csv',
      import.meta.url,
    ),
  );
  const quoted = await readGatewayFile(
    'quoted-empty-record.csv',
    Uint8Array.from(bytes).buffer,
  );
  assert.deepEqual(quoted.sheets[0].rows[2], ['']);
});
void test('Gateway source: actual SHA digest cannot replace the original behind parsed CSV cells', async () => {
  const source = await fsRead(
    new URL('../audit/payment-gateway/frozen/pending-0.csv', import.meta.url),
  );
  const original = Uint8Array.from(source).buffer;
  const subtle = crypto.subtle;
  // oxlint-disable-next-line typescript/unbound-method -- Calls the actual digest with its original receiver.
  const digest = subtle.digest;
  let calls = 0;
  subtle.digest = function (...args: Parameters<typeof digest>) {
    const pending = digest.apply(subtle, args);
    if (++calls === 1) new Uint8Array(original).fill(0);
    return pending;
  };
  try {
    const file = await readGatewayFile('pending-0.csv', original);
    assert.deepEqual(new Uint8Array(file.original!), new Uint8Array(source));
    assert.equal(file.sheets[0].rows[1][3], '80.00');
    assert.equal(
      file.sha256,
      gatewayTruth.cases.find((c) => c.name === 'pending')!.files[0].sha256,
    );
  } finally {
    subtle.digest = digest;
  }
});
