import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../lib/reconciliation/io.ts';
import type { ProcessingProgress } from '../lib/reconciliation/processing-progress.ts';
import { ImportDiagnosticError } from '../lib/reconciliation/import-diagnostics.ts';
import { syntheticPdf } from './helpers/pdf-fixture.ts';

test('100-page native import retains the last page and reports progress without replacing the final source', async () => {
  const pages = Array.from({ length: 100 }, (_, i) => [
    ['Date', 'Reference', 'Amount'],
    ['2026-07-01', `LONG-${String(i + 1).padStart(4, '0')}`, '-17.25'],
  ]);
  const seen: ProcessingProgress[] = [];
  const file = await readFile(
    'full-100.pdf',
    syntheticPdf(pages),
    undefined,
    true,
    (p) => seen.push(p),
  );
  assert.equal(file.pdf?.pages, 100);
  assert.deepEqual(file.sheets[0].rows, pages.flat());
  assert.equal(file.sheets[0].rowPages?.['200'], 100);
  assert.deepEqual(
    seen,
    ['pdf-read', 'pdf-layout'].flatMap((stage) =>
      Array.from({ length: 101 }, (_, completed) => ({
        stage,
        completed,
        total: 100,
      })),
    ),
  );
});

test('failure on page 70 does not emit layout or return a usable prefix and the next import is clean', async () => {
  const row = [
    ['Date', 'Reference', 'Amount'],
    ['2026-07-01', 'END-7001', '12.34'],
  ];
  const pages = Array.from({ length: 70 }, (_, i) => (i === 69 ? [] : row));
  const seen: ProcessingProgress[] = [];
  await assert.rejects(
    readFile('bad-last.pdf', syntheticPdf(pages), undefined, true, (p) =>
      seen.push(p),
    ),
    (error) => {
      assert.ok(error instanceof ImportDiagnosticError);
      assert.equal(error.diagnosis.page, 70);
      assert.equal(error.diagnosis.totalPages, 70);
      assert.equal(error.diagnosis.inspectedAllPages, false);
      return true;
    },
  );
  assert.deepEqual(seen.at(-1), {
    stage: 'pdf-read',
    completed: 69,
    total: 70,
  });
  assert.ok(seen.every((p) => p.stage === 'pdf-read'));
  const recovered = await readFile(
    'clean.pdf',
    syntheticPdf([row]),
    undefined,
    true,
  );
  assert.deepEqual(recovered.sheets[0].rows, row);
});
