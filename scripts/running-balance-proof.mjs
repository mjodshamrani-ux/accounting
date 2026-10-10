// Frozen source truth precedes this product driver. Outputs stay outside source.
import assert from 'node:assert/strict';
import {
  readFile as fsRead,
  readdir,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from '../lib/reconciliation/io.ts';
import { RUNNING_COLUMNS } from '../lib/reconciliation/running-balance.ts';
import {
  RunningBalanceSession,
  saveRunningArtifact,
  restoreRunningArtifact,
  exportRunningWorkbook,
} from '../lib/reconciliation/running-balance-session.ts';

const frozen = path.resolve('audit/running-balance/frozen');
const output = path.resolve(
  process.env.RUNNING_REPORT_DIR || '../evidence/product-proof',
);
await mkdir(output, { recursive: true });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await fsRead(path.join(frozen, 'INPUT-MANIFEST.json'));
assert.equal(
  sha(manifestBytes),
  '76a277fcee53c7448507244058e5760e269e78dd666d144b5b8d3ed6bac8b552',
);
for (const entry of JSON.parse(manifestBytes).files) {
  const bytes = await fsRead(path.join(frozen, entry.path));
  assert.equal(bytes.length, entry.bytes);
  assert.equal(sha(bytes), entry.sha256);
}
const acknowledgements = Object.fromEntries(
  [
    'originalRowsReviewed',
    'referenceRolesReviewed',
    'separateAmountsReviewed',
    'perspectiveReviewed',
    'currencyReviewed',
    'balancesReviewed',
    'sequenceReviewed',
    'totalsReviewed',
    'derivedSourceUnderstood',
  ].map((key) => [key, true]),
);
const context = {
  columns: RUNNING_COLUMNS,
  currency: 'SAR',
  decimals: 2,
  perspective: 'debit-minus-credit',
  extractionRevision: 'native-running-balance-proof-v1',
};
const report = {
  syntheticOnly: true,
  expectedFromProduct: false,
  inputManifestSha256: sha(manifestBytes),
  cases: [],
  passed: false,
};
try {
  const ids = [
    ...(await readdir(frozen)).filter((name) => /^[PN]\d/.test(name)).sort(),
    'unicode',
  ];
  for (const id of ids) {
    const fixtureRoot = id === 'unicode' ? path.dirname(frozen) : frozen;
    const directory = path.join(output, id);
    await mkdir(directory, { recursive: true });
    const facts = JSON.parse(
      await fsRead(path.join(fixtureRoot, id, 'facts.json')),
    );
    const pdf = await fsRead(path.join(fixtureRoot, id, 'source.pdf'));
    assert.equal(sha(pdf), facts.sourceSha256);
    const source = await readFile(
      `${id}.pdf`,
      Uint8Array.from(pdf).buffer,
      facts.cuts,
      false,
      undefined,
      32767,
    );
    assert.deepEqual(source.sheets[0].rows, facts.pages.flat());
    const session = new RunningBalanceSession(source, context);
    let selected = await session.inspect();
    const review = selected.review;
    if (facts.accepted) assert.equal(review.sourceVerified, true);
    assert.equal(review.state, facts.accepted ? 'review-ready' : 'blocked');
    await writeFile(
      path.join(directory, 'review.json'),
      JSON.stringify(review, null, 2) + '\n',
    );
    const observation = {
      id,
      accepted: facts.accepted,
      sourceSha256: facts.sourceSha256,
      rows: review.rows.length,
      movements: review.movements.length,
      diagnosticCodes: review.diagnostics.map((d) => d.code),
      passed: false,
    };
    report.cases.push(observation);
    if (!facts.accepted) {
      assert(
        review.diagnostics.some((d) => d.code === facts.requiredDiagnostic),
        `${id}: required ${facts.requiredDiagnostic}`,
      );
      await assert.rejects(session.apply({}, source, context));
      observation.receiptAndArtifactRefused = true;
      observation.passed = true;
      continue;
    }
    assert.equal(review.openingMinor, String(facts.expected.openingMinor));
    assert.equal(review.closingMinor, String(facts.expected.closingMinor));
    assert.equal(review.grossDebitMinor, String(facts.expected.debitMinor));
    assert.equal(review.grossCreditMinor, String(facts.expected.creditMinor));
    assert.deepEqual(
      review.movements.map((m) => m.balanceMinor),
      facts.expected.balancesMinor.map(String),
    );
    assert.deepEqual(
      review.movements.map((m) => m.reference),
      facts.expected.references,
    );
    assert.equal(review.movements.length, facts.expected.count);
    assert(review.balanceSteps.every((step) => step.differenceMinor === '0'));
    selected = await session.select(
      review.movements.map((m) => m.originalRow),
      review.proposals.map((p) => p.id),
    );
    const receipt = await session.recordReviewerDecision({
      decision: 'accept',
      reviewerLabel: 'Synthetic verifier',
      rationale:
        'All original rows and provided balance controls checked against frozen authored truth.',
      reviewedSourceHash: review.sourceHash,
      reviewedExtractionHash: review.extractionHash,
      reviewedContextHash: review.contextHash,
      reviewedSelectionHash: selected.selectionHash,
      acknowledgements,
    });
    assert(receipt);
    const artifact = await session.apply(receipt, source, context, {
      currentSelection: selected,
    });
    assert.equal(artifact.financialApproval, false);
    assert.equal(artifact.scopeConfirmed, false);
    assert.deepEqual(Buffer.from(artifact.originalPdf), pdf);
    const expectedCsv = await fsRead(
      path.join(fixtureRoot, id, 'expected.csv'),
    );
    assert.deepEqual(Buffer.from(artifact.csv), expectedCsv);
    await assert.rejects(session.apply(receipt, source, context));
    const archive = await saveRunningArtifact(artifact);
    const restored = await restoreRunningArtifact(archive);
    assert.equal(restored.csv, artifact.csv);
    assert.deepEqual(restored.provenance, artifact.provenance);
    await assert.rejects(
      new RunningBalanceSession(source, context).apply(
        restored.provenance.historicalReceipt,
        source,
        context,
      ),
    );
    await writeFile(path.join(directory, 'derived.csv'), artifact.csv);
    await writeFile(path.join(directory, 'archive.json'), Buffer.from(archive));
    await writeFile(
      path.join(directory, 'original.pdf'),
      Buffer.from(restored.originalPdf),
    );
    await writeFile(
      path.join(directory, 'direct.xlsx'),
      Buffer.from(await exportRunningWorkbook(artifact)),
    );
    await writeFile(
      path.join(directory, 'restored.xlsx'),
      Buffer.from(await exportRunningWorkbook(restored)),
    );
    observation.exactSevenFieldCsv = true;
    observation.exactOriginalPdf = true;
    observation.archiveReplay = true;
    observation.historicalReceiptRefused = true;
    observation.workbooks = 2;
    observation.passed = true;
  }
  assert.equal(report.cases.length, 45);
  report.passed = true;
} catch (error) {
  report.failure = String(error);
  throw error;
} finally {
  await writeFile(
    path.join(output, 'PRODUCT-PROOF.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(
  JSON.stringify({
    passed: true,
    cases: report.cases.length,
    fullCycles: report.cases.filter((c) => c.accepted).length,
    workbooks: 18,
  }),
);
