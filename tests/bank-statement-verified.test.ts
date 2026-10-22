import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  exportBankStatement,
  replayBankStatement,
  replayVerified,
  saveBankStatement,
  statementReads,
  validateBankStatementWorkerResponse,
  type BankStatementReplay,
} from '../lib/reconciliation/bank-statement-lifecycle.ts';
import { sameStatementData } from '../lib/reconciliation/bank-statement-request.ts';
import {
  statementDecision,
  statementState,
} from '../lib/reconciliation/bank-statement-view.ts';

// The client's verified reading (BNK-PDF-1 G5): a reply is still installed
// only if this thread computes the same thing from the captured request, but
// the originals are read once per set of bytes and scope. A later request is
// settled on that reading only when its names, fingerprints, bytes and scope
// are the same; anything else is read from its own bytes.

const frozen = (name: string) =>
  readFile(
    new URL(
      `../audit/bank-statement-foundation/frozen/${name}`,
      import.meta.url,
    ),
  );
const source = async (name: string, bytes?: Buffer, as = name) => {
  const b = bytes ?? (await frozen(name));
  return {
    name: as,
    sha256: createHash('sha256').update(b).digest('hex'),
    original: Uint8Array.from(b).buffer,
  };
};
const NONE = { currency: null, period: null, confirmedClosing: null };
const pdf = async (id: string) =>
  statementState(
    await source(`${id}-statement.pdf`),
    await source(`${id}-cashbook.csv`),
    NONE,
    [],
  );
const refused = (code: string) => (e: unknown) =>
  e instanceof Error && e.message === `BANK_STATEMENT_${code}`;

void test('the same originals are read once; decisions are settled on that reading, equal to a full replay', async () => {
  const state = await pdf('BS04');
  const before = statementReads();
  const first = await replayVerified(state);
  assert.equal(statementReads(), before + 1);
  const c = first.result.cases.find((k) => k.kind === 'review')!;
  const decided = {
    ...state,
    decisions: [
      statementDecision(
        first.result,
        c,
        'accept',
        'Seen',
        'D1',
        '2026-10-22T09:00:00.000Z',
      ),
    ],
  };
  const settled = await replayVerified(decided);
  assert.equal(statementReads(), before + 1, 'no second read');
  const full = await replayBankStatement(decided);
  assert.ok(sameStatementData(settled, full));
  assert.equal(settled.result.status, 'reviewed');
  // A refused decision is refused the same way without a read.
  await assert.rejects(
    replayVerified({
      ...state,
      decisions: [{ ...decided.decisions[0], type: 'undo' }],
    }),
    refused('UNDO'),
  );
});

void test('other bytes, names, fingerprints or scope are read from their own bytes', async () => {
  const state = await pdf('BS04');
  await replayVerified(state);
  // The same fingerprint claimed for other bytes is refused, never served.
  const bytes = Buffer.from(await frozen('BS04-cashbook.csv'));
  bytes[bytes.length - 3] ^= 1;
  const forged = await pdf('BS04');
  forged.files[1] = {
    ...(await source('BS04-cashbook.csv', bytes)),
    sha256: state.files[1].sha256,
  };
  let reads = statementReads();
  await assert.rejects(replayVerified(forged), refused('SOURCE_HASH'));
  assert.equal(statementReads(), reads + 1);
  // Another name for the same bytes, and another fingerprint claim.
  reads = statementReads();
  const renamed = await pdf('BS04');
  renamed.files[1] = await source('BS04-cashbook.csv', undefined, 'other.csv');
  assert.ok(
    sameStatementData(
      await replayVerified(renamed),
      await replayBankStatement(renamed),
    ),
  );
  assert.equal(statementReads(), reads + 2);
  await replayVerified(state);
  reads = statementReads();
  const claimed = await pdf('BS04');
  claimed.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(replayVerified(claimed), refused('SOURCE_HASH'));
  assert.equal(statementReads(), reads + 1);
  // Another scope: a PDF refuses a currency.
  await replayVerified(state);
  reads = statementReads();
  await assert.rejects(
    replayVerified({ ...state, scope: { ...NONE, currency: 'SAR' } }),
    refused('STATE_SCOPE'),
  );
  assert.equal(statementReads(), reads + 1);
  // A table with another confirmed closing is read again.
  const table = statementState(
    await source('BS01-statement.csv'),
    await source('BS01-cashbook.csv'),
    {
      currency: 'SAR',
      period: { start: '2026-07-01', end: '2026-07-31' },
      confirmedClosing: null,
    },
    [],
  );
  const held = await replayVerified(table);
  assert.equal(held.result.status, 'held');
  reads = statementReads();
  const confirmed = await replayVerified({
    ...table,
    scope: { ...table.scope, confirmedClosing: -2795845 },
  });
  assert.equal(confirmed.result.status, 'reviewed');
  assert.equal(statementReads(), reads + 1);
});

void test('no result can change the reading it shares with the next', async () => {
  const state = await pdf('BS12');
  const a = await replayVerified(state);
  assert.throws(() => {
    (a.result.reading.lines as unknown[]).pop();
  }, TypeError);
  assert.throws(() => {
    (a.result.match.auto as { statement: string }[])[0].statement = 'S999';
  }, TypeError);
  a.result.cases[0].status = 'rejected';
  const b = await replayVerified(state);
  assert.equal(b.result.cases[0].status, 'matched-automatic');
});

void test('a saved session is bound by holding exactly the request’s originals, scope and decisions; restore, decisions and Excel read nothing', async () => {
  const state = await pdf('BS04');
  const { result } = await replayVerified(state);
  const c = result.cases.find((k) => k.kind === 'review')!;
  const decided = {
    ...state,
    decisions: [
      statementDecision(
        result,
        c,
        'reject',
        'Seen',
        'D1',
        '2026-10-22T09:00:00.000Z',
      ),
    ],
  };
  const session = await saveBankStatement(decided);
  const reads = statementReads();
  const returned = (await validateBankStatementWorkerResponse(
    'bank-statement-save',
    session,
    decided,
  )) as ArrayBuffer;
  assert.equal(statementReads(), reads, 'binding a save reads nothing');
  assert.equal(Buffer.from(returned).compare(Buffer.from(session)), 0);
  for (const other of [
    await saveBankStatement(state),
    await saveBankStatement(await pdf('BS12')),
    new TextEncoder().encode('{"format":"tarasuf-bank-statement-session"}')
      .buffer,
  ])
    await assert.rejects(
      validateBankStatementWorkerResponse(
        'bank-statement-save',
        other,
        decided,
      ),
      refused('WORKER_BINDING'),
    );
  const reply = await replayBankStatement(decided);
  const before = statementReads();
  const restored = (await validateBankStatementWorkerResponse(
    'bank-statement-restore',
    reply,
    { buffer: session },
  )) as BankStatementReplay;
  assert.equal(restored.result.decisions.length, 1);
  assert.equal(
    statementReads(),
    before,
    'restoring the same originals reads nothing',
  );
  // A decision's reply is verified on the same reading.
  const checked = (await validateBankStatementWorkerResponse(
    'bank-statement-reconcile',
    reply,
    decided,
  )) as BankStatementReplay;
  assert.ok(sameStatementData(checked, reply));
  assert.equal(statementReads(), before, 'verifying a decision reads nothing');
  // And an Excel reply is rebuilt on it.
  const book = await exportBankStatement(decided, reply.result);
  const exported = statementReads();
  await validateBankStatementWorkerResponse('bank-statement-export', book, {
    state: decided,
    result: reply.result,
  });
  assert.equal(statementReads(), exported, 'verifying Excel reads nothing');
});
