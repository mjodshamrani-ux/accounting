import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as readBytes } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  RUNNING_COLUMNS,
  inspectRunningBalance,
} from '../lib/reconciliation/running-balance.ts';
import {
  RunningBalanceSession,
  saveRunningArtifact,
  restoreRunningArtifact,
  exportRunningWorkbook,
} from '../lib/reconciliation/running-balance-session.ts';
import { readRunningSyntheticPages } from './running-balance-test-helper.ts';
const context = {
  columns: RUNNING_COLUMNS,
  currency: 'SAR' as const,
  decimals: 2 as const,
  perspective: 'debit-minus-credit' as const,
  extractionRevision: 'native-regressions-v1',
};
const acknowledgements = {
  originalRowsReviewed: true as const,
  referenceRolesReviewed: true as const,
  separateAmountsReviewed: true as const,
  perspectiveReviewed: true as const,
  currencyReviewed: true as const,
  balancesReviewed: true as const,
  sequenceReviewed: true as const,
  totalsReviewed: true as const,
  derivedSourceUnderstood: true as const,
};
void test('running balance supplementary Unicode survives native evidence, review, archive, restore and literal Excel', async () => {
  const base = new URL('../audit/running-balance/unicode/', import.meta.url);
  const facts = JSON.parse(
    await readBytes(new URL('facts.json', base), 'utf8'),
  );
  const bytes = await readBytes(new URL('source.pdf', base));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    facts.sourceSha256,
  );
  const source = await readFile(
    'synthetic-unicode.pdf',
    Uint8Array.from(bytes).buffer,
    facts.cuts,
    false,
    undefined,
    32767,
  );
  assert.deepEqual(source.sheets[0].rows, facts.pages.flat());
  const session = new RunningBalanceSession(source, context);
  const inspected = await session.inspect();
  assert.equal(inspected.review.state, 'review-ready');
  const movement = inspected.review.movements[0];
  assert.equal(movement.description, '😀');
  assert.equal(movement.descriptionEvidence.spanStartInclusive, 0);
  assert.equal(movement.descriptionEvidence.spanEndExclusive, 2);
  assert.equal(movement.descriptionEvidence.spanText, '😀');
  const selected = await session.select([movement.originalRow], []);
  const receipt = await session.recordReviewerDecision({
    decision: 'accept',
    reviewerLabel: 'Synthetic Unicode reviewer',
    rationale:
      'Literal supplementary code point and all original fields checked.',
    reviewedSourceHash: selected.review.sourceHash,
    reviewedExtractionHash: selected.review.extractionHash,
    reviewedContextHash: selected.review.contextHash,
    reviewedSelectionHash: selected.selectionHash,
    acknowledgements,
  });
  assert(receipt);
  const artifact = await session.apply(receipt, source, context);
  assert.equal(
    artifact.csv,
    await readBytes(new URL('expected.csv', base), 'utf8'),
  );
  const restored = await restoreRunningArtifact(
    await saveRunningArtifact(artifact),
  );
  assert.deepEqual(Buffer.from(restored.originalPdf), bytes);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exportRunningWorkbook(restored));
  assert.equal(book.getWorksheet('DerivedReading')!.getCell('D2').value, '😀');
  assert.equal(
    book.getWorksheet('OriginalInventory')!.getCell('H12').value,
    '😀',
  );
});

void test('actual native PDF at 100 pages verifies all zero movements; page101 refuses before partial output', async () => {
  const cell = (...values: string[]) => [
    ...values,
    ...Array(7 - values.length).fill(''),
  ];
  function pages(count: number) {
    return Array.from({ length: count }, (_, i) => {
      const rows = [
        cell('SYNTHETIC ONLY'),
        cell('Statement: ST-LIMIT'),
        cell('Account: ACCT-LIMIT'),
        cell('Period: 2026-10-01/2026-10-31'),
        cell('Currency: SAR'),
        cell('Balance basis: debit-minus-credit'),
        cell(`Page: ${i + 1} of ${count}`),
        [
          'Seq',
          'Date',
          'Reference',
          'Description',
          'Debit',
          'Credit',
          'Balance',
        ],
        cell(
          i ? 'Brought balance' : 'Opening balance',
          i ? '' : '2026-10-01',
          '',
          '',
          '',
          '',
          '0',
        ),
        cell(`Invoice: INV-${i + 1}`),
        [
          String(i + 1),
          '2026-10-15',
          `INV-${i + 1}`,
          'Zero remains a movement',
          '0',
          '0',
          '0',
        ],
        cell(`Section total: INV-${i + 1}`, '', '', '', '0', '0'),
        cell('Page total', '', '', '', '0', '0'),
        cell('Page count: 1'),
      ];
      if (i + 1 < count)
        rows.push(cell('Carried balance', '', '', '', '', '', '0'));
      else
        rows.push(
          cell('Closing balance', '2026-10-31', '', '', '', '', '0'),
          cell('Statement total', '', '', '', '0', '0'),
          cell(`Statement count: ${count}`),
        );
      return rows;
    });
  }
  const source = await readRunningSyntheticPages(pages(100));
  assert.equal(source.pdf!.pages, 100);
  const review = await inspectRunningBalance(source, context);
  assert.equal(review.state, 'review-ready');
  assert.equal(review.sourceVerified, true);
  assert.equal(review.movements.length, 100);
  assert.equal(review.balanceSteps.length, 100);
  assert.deepEqual(
    review.movements.map((m) => m.seq),
    Array.from({ length: 100 }, (_, i) => String(i + 1)),
  );
  assert(
    review.movements.every(
      (m) => m.debitMinor === '0' && m.creditMinor === '0',
    ),
  );
  await assert.rejects(readRunningSyntheticPages(pages(101)));
});
