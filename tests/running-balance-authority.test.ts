import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as readBytes } from 'node:fs/promises';
import { readFile } from '../lib/reconciliation/io.ts';
import { RUNNING_COLUMNS } from '../lib/reconciliation/running-balance.ts';
import {
  RunningBalanceSession,
  saveRunningArtifact,
  restoreRunningArtifact,
  type RunningReceipt,
  type RunningSelection,
} from '../lib/reconciliation/running-balance-session.ts';
const context = {
  columns: RUNNING_COLUMNS,
  currency: 'SAR' as const,
  decimals: 2 as const,
  perspective: 'debit-minus-credit' as const,
  extractionRevision: 'independent-authority-regression-v1',
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
function decision(selection: RunningSelection) {
  return {
    decision: 'accept' as const,
    reviewerLabel: 'Synthetic authority reviewer',
    rationale: 'All literal supplied fields and independent controls reviewed.',
    reviewedSourceHash: selection.review.sourceHash,
    reviewedExtractionHash: selection.review.extractionHash,
    reviewedContextHash: selection.review.contextHash,
    reviewedSelectionHash: selection.selectionHash,
    acknowledgements,
  };
}
void test('historical receipt cannot borrow the authority of a fresh live decision for the identical source', async () => {
  const bytes = await readBytes(
    new URL(
      '../audit/running-balance/frozen/P03-zero-and-identical-movements/source.pdf',
      import.meta.url,
    ),
  );
  const source = await readFile(
    'synthetic-authority.pdf',
    Uint8Array.from(bytes).buffer,
    [10, 25, 40, 65, 77, 88],
    false,
    undefined,
    32767,
  );
  async function reviewed() {
    const session = new RunningBalanceSession(source, context);
    const inspected = await session.inspect();
    const selection = await session.select(
      inspected.review.movements.map((m) => m.originalRow),
      inspected.review.proposals.map((p) => p.id),
    );
    const receipt = await session.recordReviewerDecision(decision(selection));
    assert(receipt);
    return { session, receipt };
  }
  const first = await reviewed();
  const artifact = await first.session.apply(first.receipt, source, context);
  const restored = await restoreRunningArtifact(
    await saveRunningArtifact(artifact),
  );
  const next = await reviewed();
  const historical = restored.provenance.historicalReceipt as RunningReceipt;
  assert.notEqual(historical.id, next.receipt.id);
  assert.equal(historical.reviewerHash, next.receipt.reviewerHash);
  await assert.rejects(
    next.session.apply(historical, source, context),
    (error) => {
      assert.equal((error as { code: string }).code, 'RUNNING_RECEIPT');
      return true;
    },
  );
  const accepted = await next.session.apply(next.receipt, source, context);
  assert.equal(accepted.csv, artifact.csv);
});
