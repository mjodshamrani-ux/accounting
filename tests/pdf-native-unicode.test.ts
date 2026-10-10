import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as bytes } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import {
  SplitSectionSession,
  saveSplitArtifact,
  restoreSplitArtifact,
  exportSplitWorkbook,
} from '../lib/reconciliation/split-section-session.ts';
const root = new URL('../audit/native-unicode/frozen/', import.meta.url);
const context = {
  mapping: {
    ...defaultMapping(),
    header: 2,
    date: 0,
    reference: 1,
    description: 2,
    amount: -1,
    debit: 3,
    credit: 4,
    mode: 'split' as const,
    pdfReviewed: true,
  },
  currency: 'SAR' as const,
  decimals: 2 as const,
  perspective: 'debit-minus-credit' as const,
  extractionRevision: 'synthetic-native-unicode-v1',
};
async function fixture(name: string) {
  const expected = JSON.parse(
    await bytes(new URL(`${name}.json`, root), 'utf8'),
  ) as {
    rows: string[][];
    sourceSha256: string;
    cuts: number[];
  };
  const original = await bytes(new URL(`${name}.pdf`, root));
  assert.equal(
    createHash('sha256').update(original).digest('hex'),
    expected.sourceSha256,
  );
  return { expected, original, buffer: Uint8Array.from(original).buffer };
}
for (const name of [
  'letters',
  'private-use',
  'compressed',
  'ranged',
  'multi-map',
]) {
  void test(`native Unicode source ${name}: independent facts through receipt/archive/restore/Excel`, async () => {
    const { expected, original, buffer } = await fixture(name);
    const source = await readFile(`${name}.pdf`, buffer, expected.cuts);
    assert.deepEqual(source.sheets[0].rows, expected.rows);
    assert.ok(source.original);
    assert.deepEqual(new Uint8Array(source.original), new Uint8Array(original));
    const session = new SplitSectionSession(source, context);
    const inspected = await session.inspect();
    assert.equal(inspected.review.state, 'review-ready');
    assert.equal(inspected.review.sourceVerified, true);
    assert.deepEqual(
      inspected.review.movements.map((m) => [
        m.reference,
        m.description,
        m.debitMinor,
        m.creditMinor,
      ]),
      expected.rows
        .slice(4)
        .map((r, i) => [
          r[1],
          r[2],
          i === 0 ? '1234' : '0',
          i === 0 ? '0' : '56',
        ]),
    );
    const selection = await session.select(
      inspected.review.movements.map((m) => m.originalRow),
      inspected.review.proposals.map((p) => p.id),
    );
    const receipt = await session.recordReviewerDecision({
      decision: 'accept',
      reviewerLabel: 'Synthetic Unicode Reviewer',
      rationale: 'Checked literal source facts.',
      reviewedSourceHash: selection.review.sourceHash,
      reviewedExtractionHash: selection.review.extractionHash,
      reviewedContextHash: selection.review.contextHash,
      reviewedSelectionHash: selection.selectionHash,
      acknowledgements: {
        originalRowsReviewed: true,
        referenceRolesReviewed: true,
        separateAmountsReviewed: true,
        perspectiveReviewed: true,
        currencyReviewed: true,
        totalsReviewed: true,
        derivedSourceUnderstood: true,
      },
    });
    assert.ok(receipt);
    const artifact = await session.apply(receipt, source, context);
    const restored = await restoreSplitArtifact(
      await saveSplitArtifact(artifact),
    );
    assert.deepEqual(
      restored.provenance.review.movements.map((m) => [
        m.reference,
        m.description,
      ]),
      expected.rows.slice(4).map((r) => [r[1], r[2]]),
    );
    for (const row of expected.rows.slice(4)) {
      assert.ok(restored.csv.includes(row[2]));
      assert.ok(
        restored.provenance.inventory.some((item) => item.values[2] === row[2]),
      );
    }
    assert.equal(restored.financialApproval, false);
    assert.equal(restored.scopeConfirmed, false);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await exportSplitWorkbook(restored));
    for (const sheet of [
      'DerivedReading',
      'OriginalInventory',
      'SourceCellEvidence',
    ]) {
      const cells: string[] = [];
      workbook.getWorksheet(sheet)!.eachRow((row) =>
        row.eachCell((cell) => {
          if (typeof cell.value === 'string') cells.push(cell.value);
        }),
      );
      for (const row of expected.rows.slice(4))
        assert.ok(cells.includes(row[2]), `${sheet}: ${row[2]}`);
    }
  });
}
void test('native supplementary references preserve generic source but stay outside ASCII-only P4 contract', async () => {
  const { expected, buffer } = await fixture('unicode-reference');
  const source = await readFile('unicode-reference.pdf', buffer, expected.cuts);
  assert.deepEqual(source.sheets[0].rows, expected.rows);
  const review = await new SplitSectionSession(source, context).inspect();
  assert.equal(review.review.state, 'blocked');
});
for (const name of [
  'high-only',
  'low-only',
  'high-ascii',
  'reversed',
  'double-high',
  'odd-byte',
  'mixed-font',
]) {
  void test(`malformed original ToUnicode ${name} rejects before any source authorization`, async () => {
    const { expected, buffer } = await fixture(`invalid-${name}`);
    await assert.rejects(readFile(`${name}.pdf`, buffer, expected.cuts), /PDF/);
    const valid = await fixture('letters');
    const source = await readFile(
      'recovered.pdf',
      valid.buffer,
      valid.expected.cuts,
    );
    assert.deepEqual(source.sheets[0].rows, valid.expected.rows);
  });
}
