import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  inspectSourceStructure,
  SourceStructureReviewController,
} from '../lib/reconciliation/source-structure-review.ts';
import type {
  SourceStructureReviewInput,
  SourceStructureReviewResult,
} from '../lib/reconciliation/source-structure-review.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';
const mapping: Mapping = {
  sheet: 0,
  header: 0,
  date: 3,
  reference: 0,
  description: -1,
  amount: 2,
  debit: -1,
  credit: -1,
  currencyColumn: -1,
  mode: 'signed',
  multiplier: 1,
  numberFormat: 'dot',
  dateFormat: 'ymd',
  reportType: 'transactions',
  opening: '',
  closing: '',
  periodStart: '',
  excluded: {},
};
const scope: Scope = {
  entity: 'ENTITY',
  account: 'AP',
  supplier: 'SUPPLIER',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-09-30',
  dateWindow: 7,
  confirmed: true,
  coverageConfirmed: true,
};
async function fixture(): Promise<SourceStructureReviewInput> {
  const files = await Promise.all(
    [
      'Invoice No,Reference,Amount,Date,Document Type\nINV-412,,100.00,2026-09-01,Invoice\n',
      'Invoice No,Reference,Amount,Date,Document Type\nINV-412,,40.00,2026-09-01,Invoice\nINV-412,,60.00,2026-09-01,Invoice\n',
    ].map((csv, i) =>
      readFile(`source-${i}.csv`, new TextEncoder().encode(csv).buffer),
    ),
  );
  return {
    files: files as [SourceFile, SourceFile],
    mappings: [structuredClone(mapping), structuredClone(mapping)],
    scope: structuredClone(scope),
    extractionRevision: 'test-v1',
  };
}
void test('real CSV replay produces group evidence only and preserves all financial inputs', async () => {
  const input = await fixture(),
    before = structuredClone(input);
  const result = await inspectSourceStructure(input);
  assert.equal(result.groupError, null);
  assert.deepEqual(result.groups?.matches, []);
  assert.equal(result.groups?.candidates.length, 1);
  assert.equal(result.groups?.candidates[0].supplierTotalMinor, 10000);
  assert.equal(result.groups?.candidates[0].ledgerTotalMinor, 10000);
  assert.equal(result.groups?.candidates[0].evidence.pairwiseAllocation, false);
  assert.deepEqual(
    result.groups?.candidates[0].evidence.members.map((m) => m.row),
    [2, 3, 2],
  );
  assert.deepEqual(input, before);
  assert.ok(result.sections.every((s) => !s.applicable && !s.review));
});
void test('edited cached extraction/hash and missing original cannot yield positive candidates', async () => {
  for (const edit of [
    (i: SourceStructureReviewInput) => {
      i.files[0]!.sheets[0].rows[1][2] = '999.00';
    },
    (i: SourceStructureReviewInput) => {
      i.files[0]!.sha256 = 'a'.repeat(64);
    },
    (i: SourceStructureReviewInput) => {
      delete i.files[0]!.original;
    },
  ]) {
    const input = await fixture();
    edit(input);
    const r = await inspectSourceStructure(input);
    assert.equal(r.groups, null);
    assert.ok(r.groupError);
  }
});
void test('unconfirmed scope cannot become an empty successful review', async () => {
  const input = await fixture();
  input.scope.confirmed = false;
  const result = await inspectSourceStructure(input);
  assert.ok(result.groupError || result.groups?.status === 'needs-review');
});
const empty: SourceStructureReviewResult = {
  groups: null,
  groupError: 'old',
  sections: [],
};
void test('clear cancels publication of pending work and snapshots input before awaits', async () => {
  const input = await fixture();
  let finish!: (r: SourceStructureReviewResult) => void;
  let owned!: SourceStructureReviewInput;
  const controller = new SourceStructureReviewController(async (snapshot) => {
    owned = snapshot;
    return await new Promise((resolve) => {
      finish = resolve;
    });
  });
  const task = controller.run(input);
  input.scope.currency = 'USD';
  input.files[0]!.sheets[0].rows[1][2] = '9';
  assert.equal(owned.scope.currency, 'SAR');
  assert.equal(owned.files[0]!.sheets[0].rows[1][2], '100.00');
  controller.clear();
  finish(empty);
  assert.equal(await task, false);
  assert.equal(controller.result, null);
  assert.equal(controller.busy, false);
});
void test('newer run remains authoritative when earlier promise completes last', async () => {
  const pending: ((r: SourceStructureReviewResult) => void)[] = [];
  const controller = new SourceStructureReviewController(
    async () => await new Promise((resolve) => pending.push(resolve)),
  );
  const input = await fixture();
  const old = controller.run(input);
  const latest = controller.run({ ...input, extractionRevision: 'test-v2' });
  const newer = { ...empty, groupError: 'new' };
  pending[1](newer);
  assert.equal(await latest, true);
  pending[0](empty);
  assert.equal(await old, false);
  assert.deepEqual(controller.result, newer);
});
void test('cancelled parser rejection cannot replace newer review or resurrect a cleared error', async () => {
  let reject!: (e: Error) => void;
  const controller = new SourceStructureReviewController(
    async () =>
      await new Promise((_resolve, no) => {
        reject = no;
      }),
  );
  const input = await fixture();
  const task = controller.run(input);
  controller.clear();
  reject(new Error('late parse failure'));
  assert.equal(await task, false);
  assert.equal(controller.result, null);
  assert.equal(controller.busy, false);
});
void test('local candidate declaration leaves shared financial scope flags unconfirmed', async () => {
  const input = await fixture();
  input.scope.confirmed = false;
  input.scope.coverageConfirmed = false;
  const original = structuredClone(input);
  const result = await inspectSourceStructure({
    ...input,
    scope: { ...input.scope, confirmed: true, coverageConfirmed: true },
  });
  assert.ok(result.groups?.candidates.length);
  assert.deepEqual(result.groups?.matches, []);
  assert.deepEqual(input, original);
  assert.equal(input.scope.confirmed, false);
  assert.equal(input.scope.coverageConfirmed, false);
  assert.equal('decisions' in result, false);
  assert.equal('result' in result, false);
});
void test('native PDF structural review remains explicit alongside refused financial group normalization', async () => {
  const { readFile: readBytes } = await import('node:fs/promises');
  const bytes = await readBytes(
    new URL(
      '../audit/section-continuation-v1/frozen/explicit-continuation.pdf',
      import.meta.url,
    ),
  );
  const file = await readFile(
    'explicit-continuation.pdf',
    Uint8Array.from(bytes).buffer,
    [25, 45, 69],
  );
  const input = await fixture();
  input.files[0] = file;
  input.mappings[0] = {
    ...mapping,
    date: 0,
    reference: 1,
    description: 2,
    amount: 3,
    pdfReviewed: true,
  };
  const before = structuredClone(input);
  const result = await inspectSourceStructure(input);
  assert.equal(result.sections[0].review?.sourceVerified, true);
  assert.equal(result.sections[0].review?.rows.length, 6);
  assert.equal(result.sections[0].review?.proposals.length, 2);
  assert.equal(result.sections[0].review?.proposals[1].continuation[0].page, 2);
  assert.equal(result.sections[0].review?.rows[5].values[3], '-12.50');
  assert.deepEqual(input, before);
  assert.deepEqual(result.groups?.matches ?? [], []);
});
