import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import {
  createWorkerClient,
  type WorkerPort,
} from '../lib/reconciliation/worker-client.ts';
import {
  replayBankStatement,
  saveBankStatement,
  exportBankStatement,
  type BankStatementReplay,
} from '../lib/reconciliation/bank-statement-lifecycle.ts';
import type { BankStatementState } from '../lib/reconciliation/bank-statement-request.ts';

// bank-statement-lifecycle-1 through the real worker dispatch: the client
// installs only what it computes itself from the captured originals, so a
// reply that is altered, foreign or stale is refused before installation.

class Port {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  onmessageerror: WorkerPort['onmessageerror'] = null;
  stopped = false;
  transform: (data: Record<string, unknown>) => Record<string, unknown> = (v) =>
    v;
  worker = new NodeWorker(
    new URL('./helpers/bank-wd-worker.mjs', import.meta.url),
    { execArgv: ['--experimental-strip-types'] },
  );
  constructor() {
    this.worker.on('message', (data) =>
      this.onmessage?.call(
        this as unknown as Worker,
        { data: this.transform(data) } as MessageEvent,
      ),
    );
    this.worker.on('error', () =>
      this.onerror?.call(this as unknown as AbstractWorker, {} as ErrorEvent),
    );
  }
  postMessage(data: unknown) {
    this.worker.postMessage(data);
  }
  terminate() {
    this.stopped = true;
    void this.worker.terminate();
  }
}
const source = async (name: string) => {
  const bytes = await readFile(
    new URL(
      `../audit/bank-statement-foundation/frozen/${name}`,
      import.meta.url,
    ),
  );
  return {
    name,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    original: Uint8Array.from(bytes).buffer,
  };
};
const pdfState = async (id: string): Promise<BankStatementState> => ({
  version: 'bank-statement-lifecycle-1',
  files: [
    await source(`${id}-statement.pdf`),
    await source(`${id}-cashbook.csv`),
  ],
  scope: { currency: null, period: null, confirmedClosing: null },
  decisions: [],
});

void test('statement worker: reconcile, save, restore and export from the original bytes', async () => {
  const ports: Port[] = [];
  const client = createWorkerClient(() => {
    const p = new Port();
    ports.push(p);
    return p;
  }, 60000);
  const state = await pdfState('BS04');
  const { result } = await replayBankStatement(state);
  const review = result.cases.find((c) => c.kind === 'review')!;
  state.decisions.push({
    id: 'D1',
    type: 'accept',
    context: result.context,
    at: '2026-10-21T09:00:00.000Z',
    case: review.id,
    statement: review.statement,
    cashbook: review.cashbook,
    note: 'Deposit slip seen',
  });
  const expected = await replayBankStatement(state);
  try {
    const value = await client.request<BankStatementReplay>(
      'bank-statement-reconcile',
      state,
    );
    assert.deepEqual(value.result, expected.result);
    assert.equal(value.result.status, 'reviewed');
    const saved = await client.request<ArrayBuffer>(
      'bank-statement-save',
      state,
    );
    const restored = await client.request<BankStatementReplay>(
      'bank-statement-restore',
      { buffer: saved },
    );
    assert.deepEqual(restored.result, expected.result);
    const exported = await client.request<ArrayBuffer>(
      'bank-statement-export',
      { state: restored.state, result: restored.result },
    );
    assert.deepEqual(
      Array.from(new Uint8Array(exported).slice(0, 2)),
      [80, 75],
    );
    // A parsed reading beside the originals is not accepted as state.
    await assert.rejects(
      () =>
        client.request('bank-statement-reconcile', {
          ...state,
          reading: expected.result.reading,
        }),
      /BANK_STATEMENT_INPUT/,
    );
    const bad = structuredClone(state);
    bad.files[0].sha256 = '0'.repeat(64);
    await assert.rejects(
      () => client.request('bank-statement-reconcile', bad),
      /BANK_STATEMENT_SOURCE_HASH/,
    );
  } finally {
    ports.forEach((p) => p.terminate());
  }
});

void test('statement worker: an altered, foreign or stale reply is refused', async () => {
  const ports: Port[] = [];
  const client = createWorkerClient(() => {
    const p = new Port();
    ports.push(p);
    return p;
  }, 60000);
  const state = await pdfState('BS04');
  const foreignState = await pdfState('BS03');
  const foreign = await replayBankStatement(foreignState);
  const foreignSession = await saveBankStatement(foreignState);
  const foreignWorkbook = await exportBankStatement(
    foreignState,
    foreign.result,
  );
  const { result } = await replayBankStatement(state);
  const binding = /BANK_STATEMENT_WORKER_BINDING/;
  const cases: [
    string,
    unknown,
    (d: Record<string, unknown>) => Record<string, unknown>,
    RegExp,
  ][] = [
    // A self-consistent result for other files.
    [
      'bank-statement-reconcile',
      state,
      (d) => ({ ...d, value: foreign }),
      binding,
    ],
    // One case marked accepted with no decision.
    [
      'bank-statement-reconcile',
      state,
      (d) => {
        const v = d.value as BankStatementReplay;
        v.result.cases.at(-1)!.status = 'matched-accepted';
        return d;
      },
      binding,
    ],
    // Other original bytes under the same name and fingerprint.
    [
      'bank-statement-reconcile',
      state,
      (d) => {
        const v = d.value as BankStatementReplay;
        v.state.files[1].original = new ArrayBuffer(1);
        return d;
      },
      binding,
    ],
    [
      'bank-statement-reconcile',
      state,
      (d) => ({ ...d, value: {} }),
      /BANK_STATEMENT_ENVELOPE/,
    ],
    [
      'bank-statement-save',
      state,
      (d) => ({ ...d, value: foreignSession }),
      binding,
    ],
    [
      'bank-statement-export',
      { state, result },
      (d) => ({ ...d, value: foreignWorkbook }),
      binding,
    ],
  ];
  try {
    for (const [action, payload, transform, refusal] of cases) {
      await client.prepare();
      const port = ports.at(-1)!;
      port.transform = transform;
      await assert.rejects(() => client.request(action, payload), refusal);
      assert.equal(port.stopped, true);
    }
    // A result that no longer matches its state is stale.
    const stale = structuredClone(result);
    stale.cases[0].status = 'rejected';
    await client.prepare();
    await assert.rejects(
      () => client.request('bank-statement-export', { state, result: stale }),
      /BANK_STATEMENT_STALE_RESULT/,
    );
  } finally {
    ports.forEach((p) => p.terminate());
  }
});
