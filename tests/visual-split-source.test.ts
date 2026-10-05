import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile as fsRead } from 'node:fs/promises';
import { splitCase } from '../audit/visual-split/export-fixture.mjs';
import { knownSplitSource } from '../audit/visual-split/make-record.mjs';
import {
  createVisualTable,
  restoreVisualTable,
  saveVisualTable,
  editVisualTableRow,
  tableCellCandidates,
} from '../lib/reconciliation/visual-table.ts';
import {
  restoreVisualAccountingRecord,
  replayReviewedVisualSource,
  VISUAL_SOURCE_INVALID,
} from '../lib/reconciliation/visual-accounting-source.ts';
import { normalizeSource } from '../lib/reconciliation/core.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import { exportWorkbook } from '../lib/reconciliation/io.ts';
import type { Mapping, Scope } from '../lib/reconciliation/types.ts';
const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const forbidden = (e: unknown) =>
  e instanceof Error && e.message === VISUAL_SOURCE_INVALID;
const cases = { en: splitCase('en'), ar: splitCase('ar') };
for (const lang of ['en', 'ar'] as const)
  void test(`${lang} reviewed split source matches only the three valid signed movements and retains every error`, async () => {
    const { f, file, state, result } = await cases[lang];
    assert.equal(f.record.version, 2);
    assert.equal(f.table.version, 2);
    assert.deepEqual(
      [
        state.mappings[0].mode,
        state.mappings[0].amount,
        state.mappings[0].debit,
        state.mappings[0].credit,
      ],
      ['split', -1, 2, 3],
    );
    assert.deepEqual(
      result.matches.map((m) => [m.supplierId, m.ledgerId]),
      [
        ['supplier:0:2', 'ledger:0:2'],
        ['supplier:0:3', 'ledger:0:3'],
        ['supplier:0:4', 'ledger:0:4'],
      ],
    );
    assert.deepEqual(
      result.supplier.transactions.map((t) => t.amount),
      [100000, -25000, -12500],
    );
    assert.equal(result.supplier.total, 62500);
    assert.deepEqual(
      result.supplier.errors.map((e) => e.row),
      [5, 6, 7],
    );
    assert.ok(result.supplier.errors.every((e) => e.isolation));
    assert.ok(file.sheets[0].cellIssues!['7:4']);
    assert.equal(file.sheets[0].rows[6][3], '');
    assert.equal(
      result.supplier.excluded.find((e) => e.row === 8)?.kind,
      'non-movement',
    );
    assert.equal(file.sheets[0].rows.length, 8);
    assert.deepEqual(
      result.ledgerOnly.map((t) => t.normalizedReference),
      ['BOTH400', 'NEG500', 'MISS600'],
    );
    assert.equal(result.supplier.balanceValid, false);
    assert.equal(result.supplier.opening, null);
    assert.equal(result.supplier.closing, null);
    assert.ok(
      tableCellCandidates(f.table, 1, 3).some(
        (c) => c.value === (lang === 'ar' ? '٢٥٠٫٠٠' : '250.00'),
      ),
    );
  });
void test('missing split amount remains a reading issue while an explicitly reviewed printed zero is a value', async () => {
  const { file, state } = await cases.en;
  const raw = structuredClone(file);
  raw.sheets[0].rows[6][3] = '0.00';
  await assert.rejects(replayReviewedVisualSource(raw), forbidden);
  assert.equal(file.sheets[0].rows[1][3], '0.00');
  assert.equal(file.sheets[0].rows[2][2], '0.00');
  const damaged = await splitCase('en', { cells: { '0:2': 'unreadable' } });
  assert.deepEqual(
    damaged.result.matches.map((m) => m.supplierId),
    ['supplier:0:3', 'supplier:0:4'],
  );
  assert.ok(damaged.result.supplier.errors.some((e) => e.row === 2));
  assert.throws(
    () =>
      normalizeSource(
        file,
        { ...state.mappings[0], debit: 3, credit: 2 },
        state.scope,
        'supplier',
      ),
    forbidden,
  );
});
void test('one split table cannot mix an amount basis, omit a side, duplicate roles or swap printed headers', async () => {
  const f = await knownSplitSource();
  for (const roles of [
    ['reference', 'date', 'debit', 'balance', 'currency'],
    ['reference', 'date', 'amount', 'credit', 'balance'],
    ['reference', 'date', 'amount', 'debit', 'credit'],
    ['reference', 'date', 'debit', 'debit', 'balance'],
  ])
    await assert.rejects(
      createVisualTable(f.table.image, {
        ...f.table.grid,
        roles: roles as typeof f.table.grid.roles,
      }),
    );
  await assert.rejects(
    knownSplitSource('en', {
      roles: ['reference', 'date', 'credit', 'debit', 'balance'],
    }),
    forbidden,
  );
});
void test('version two cannot be downgraded and old signed version one records remain byte compatible', async () => {
  const f = await knownSplitSource();
  const table = {...structuredClone(f.table), version: 1};
  await assert.rejects(restoreVisualTable(encode(table)));
  const record = {...structuredClone(f.record), version: 1};
  await assert.rejects(
    restoreVisualAccountingRecord(encode(record)),
    forbidden,
  );
  const old = await fsRead('audit/visual-accounting/baseline/with-footer.json');
  const restored = await restoreVisualAccountingRecord(new Uint8Array(old));
  assert.equal(restored.version, 1);
  assert.equal(restored.table.version, 1);
  const expected = JSON.parse(old.toString());
  assert.equal(restored.review.fingerprint, expected.review.fingerprint);
  const changed = {...structuredClone(restored), version: 2};
  await assert.rejects(
    restoreVisualAccountingRecord(encode(changed)),
    forbidden,
  );
});
void test('split reading is locked across normalization, original replay, session save and export', async () => {
  const { file, state, result } = await cases.en;
  for (const patch of [
    { mode: 'signed', amount: 4 },
    { debit: 4 },
    { credit: 4 },
    { multiplier: -1 },
    { numberFormat: 'comma' },
    { excluded: { '7': 'Ignore missing credit' } },
  ]) {
    const m = { ...state.mappings[0], ...patch } as Mapping;
    assert.throws(
      () => normalizeSource(file, m, state.scope as Scope, 'supplier'),
      forbidden,
    );
    await assert.rejects(
      saveSession({ ...state, mappings: [m, state.mappings[1]] }),
      forbidden,
    );
    await assert.rejects(
      exportWorkbook(
        { ...result, supplier: { ...result.supplier, mapping: m } },
        state.files,
        state.review,
      ),
      forbidden,
    );
  }
  const cloned = structuredClone(file);
  delete cloned.sheets[0].cellIssues!['7:4'];
  await assert.rejects(replayReviewedVisualSource(cloned), forbidden);
  const bytes = await saveSession(state),
    restored = await restoreSession(bytes);
  assert.deepEqual(restored.result.matches, result.matches);
  assert.equal(restored.files[0].visual!.version, 2);
  assert.equal(
    createHash('sha256')
      .update(new Uint8Array(restored.files[0].original!))
      .digest('hex'),
    file.sha256,
  );
  assert.deepEqual(restored.result.supplier.errors, result.supplier.errors);
});
void test('changing a split row revokes table coverage and its exclusion receipt', async () => {
  const f = await knownSplitSource();
  const edited = editVisualTableRow(f.table, 6, {
    disposition: 'non-movement',
    note: 'Changed',
    cells: f.table.rows[6].cells,
  });
  assert.equal(edited.coverage, null);
  assert.equal(edited.rows[6].review, null);
  assert.equal(
    (await restoreVisualTable(await saveVisualTable(f.table))).version,
    2,
  );
});
