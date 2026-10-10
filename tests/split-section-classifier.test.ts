import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile as readNativeFile } from '../lib/reconciliation/io.ts';
import {
  defaultMapping,
  type SourceFile,
} from '../lib/reconciliation/types.ts';
import {
  classifySplitExtraction,
  inspectSplitSection,
  snapshotSplitInputs,
  type SplitReadingContext,
  type SplitOptions,
} from '../lib/reconciliation/split-section.ts';

const frozen = new URL('../audit/split-section/frozen/', import.meta.url);
const context: SplitReadingContext = {
  currency: 'SAR',
  decimals: 2,
  perspective: 'debit-minus-credit',
  extractionRevision: 'frozen-classifier-v1',
  mapping: {
    ...defaultMapping(),
    sheet: 0,
    header: 2,
    date: 0,
    reference: 1,
    description: 2,
    amount: -1,
    debit: 3,
    credit: 4,
    currencyColumn: -1,
    mode: 'split',
    multiplier: 1,
    dateFormat: 'ymd',
    numberFormat: 'dot',
    pdfReviewed: true,
  },
};
type Oracle = {
  accepted: boolean;
  expectedCode: string | null;
  expectedStage: string;
  sourceSha256: string;
  cuts: number[];
  pageCount: number;
  inventory: { row: number; page: number; kind: string; values: string[] }[];
  movements: {
    originalRow: number;
    page: number;
    derivedRow: number;
    reference: string;
    referenceOrigin: 'explicit-source-cell' | 'accepted-section-proposal';
    date: string;
    description: string;
    debitText: string;
    creditText: string;
    debitMinor: number;
    creditMinor: number;
  }[];
  totals: { debitMinor: number; creditMinor: number; netMinor: number };
};
async function load(id: string) {
  const oracle = JSON.parse(
    await readFile(new URL(`${id}/oracle.json`, frozen), 'utf8'),
  ) as Oracle;
  const bytes = await readFile(new URL(`${id}/source.pdf`, frozen));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    oracle.sourceSha256,
  );
  const source: SourceFile = {
    name: `${id}.pdf`,
    original: Uint8Array.from(bytes).buffer,
    sha256: oracle.sourceSha256,
    pdf: { cuts: oracle.cuts, pages: oracle.pageCount },
    sheets: [
      {
        name: 'PDF',
        rows: oracle.inventory.map((r) => r.values),
        rowPages: Object.fromEntries(
          oracle.inventory.map((r, i) => [String(i + 1), r.page]),
        ),
        formulaRows: [],
        hiddenRows: [],
      },
    ],
  };
  return { source, oracle };
}

void test('literal classifier matches all 55 independently frozen reasons and financial components', async () => {
  const cases = JSON.parse(
    await readFile(new URL('CASES.json', frozen), 'utf8'),
  ) as { id: string }[];
  assert.equal(cases.length, 55);
  for (const { id } of cases) {
    const { source, oracle } = await load(id);
    const inspect =
      id === 'MAP-count-inconsistent-with-original'
        ? inspectSplitSection
        : classifySplitExtraction;
    const review = await inspect(source, context, {
      inventoryOriginalRows: oracle.inventory.map((row) => row.row),
    });
    assert.equal(review.sourceVerified, false, id);
    assert.equal(review.rows.length, oracle.inventory.length, id);
    assert.equal(
      review.state,
      oracle.accepted ? 'review-ready' : 'blocked',
      id,
    );
    if (!oracle.accepted) {
      assert.equal(review.diagnostics[0].code, oracle.expectedCode, id);
      assert.equal(review.diagnostics[0].stage, oracle.expectedStage, id);
      assert.equal(review.movements.length, 0, id);
      assert.equal(review.proposals.length, 0, id);
      assert.ok(
        review.rows.every((row) => row.derivedRow === null),
        id,
      );
      continue;
    }
    assert.deepEqual(
      [review.grossDebitMinor, review.grossCreditMinor, review.netMinor],
      [
        oracle.totals.debitMinor,
        oracle.totals.creditMinor,
        oracle.totals.netMinor,
      ].map(String),
      id,
    );
    assert.deepEqual(
      review.rows.map((row) => row.kind),
      oracle.inventory.map((row) => row.kind),
      id,
    );
    assert.deepEqual(
      review.movements.map((m) => [
        m.originalRow,
        m.page,
        m.derivedRow,
        m.reference,
        m.date,
        m.description,
        m.debit,
        m.credit,
        m.debitMinor,
        m.creditMinor,
      ]),
      oracle.movements.map((m) => [
        m.originalRow,
        m.page,
        m.derivedRow,
        m.reference,
        m.date,
        m.description,
        m.debitText,
        m.creditText,
        String(m.debitMinor),
        String(m.creditMinor),
      ]),
      id,
    );
    for (const m of review.movements)
      for (const proof of [
        m.referenceEvidence,
        m.dateEvidence,
        m.descriptionEvidence,
        m.debitEvidence,
        m.creditEvidence,
      ]) {
        assert.equal(
          proof.literal,
          source.sheets[0].rows[proof.row - 1][proof.column - 1],
        );
        assert.equal(proof.cellText, proof.literal);
        assert.equal(
          proof.spanText,
          proof.literal.slice(proof.spanStartInclusive, proof.spanEndExclusive),
        );
      }
    for (const p of review.proposals) {
      assert.equal(p.evidence.parent.spanStartInclusive, 9);
      assert.equal(p.evidence.parent.spanText, p.reference);
      assert.ok(p.evidence.headers.every((header) => header.length === 5));
    }
  }
});

void test('native inspection matches all 55 canonical PDFs and exact metadata mutation refusals', async () => {
  const cases = JSON.parse(
    await readFile(new URL('CASES.json', frozen), 'utf8'),
  ) as { id: string; metadataMutation: boolean }[];
  assert.equal(cases.length, 55);
  for (const { id, metadataMutation } of cases) {
    const { source: oracleSource, oracle } = await load(id);
    const native = await readNativeFile(
      oracleSource.name,
      oracleSource.original!,
      oracle.cuts,
      false,
      undefined,
      32767,
    );
    assert.equal(native.sha256, oracle.sourceSha256, id);
    if (!metadataMutation) {
      assert.equal(native.pdf!.pages, oracle.pageCount, id);
      assert.deepEqual(
        native.sheets[0].rows,
        oracle.inventory.map((row) => row.values),
        id,
      );
      assert.deepEqual(
        native.sheets[0].rowPages,
        Object.fromEntries(
          oracle.inventory.map((row) => [String(row.row), row.page]),
        ),
        id,
      );
    } else {
      native.sheets[0].rows = structuredClone(oracleSource.sheets[0].rows);
      native.sheets[0].rowPages = structuredClone(
        oracleSource.sheets[0].rowPages,
      );
      native.pdf!.pages = oracle.pageCount;
    }
    const review = await inspectSplitSection(native, context, {
      inventoryOriginalRows: oracle.inventory.map((row) => row.row),
    });
    assert.equal(
      review.state,
      oracle.accepted ? 'review-ready' : 'blocked',
      id,
    );
    assert.equal(review.rows.length, oracle.inventory.length, id);
    assert.deepEqual(
      review.rows.map((row) => row.values),
      oracle.inventory.map((row) => row.values),
      id,
    );
    if (!oracle.accepted) {
      assert.equal(review.sourceVerified, false, id);
      assert.equal(review.diagnostics[0].code, oracle.expectedCode, id);
      assert.equal(review.diagnostics[0].stage, oracle.expectedStage, id);
      assert.deepEqual(review.movements, [], id);
      assert.deepEqual(review.proposals, [], id);
      assert.ok(
        review.rows.every((row) => row.derivedRow === null),
        id,
      );
      continue;
    }
    assert.equal(review.sourceVerified, true, id);
    assert.deepEqual(
      [review.grossDebitMinor, review.grossCreditMinor, review.netMinor],
      [
        oracle.totals.debitMinor,
        oracle.totals.creditMinor,
        oracle.totals.netMinor,
      ].map(String),
      id,
    );
    assert.deepEqual(
      review.rows.map((row) => row.kind),
      oracle.inventory.map((row) => row.kind),
      id,
    );
    assert.equal(review.movements.length, oracle.movements.length, id);
    for (let i = 0; i < review.movements.length; i++) {
      const actual = review.movements[i],
        expected = oracle.movements[i];
      assert.deepEqual(
        [
          actual.originalRow,
          actual.page,
          actual.derivedRow,
          actual.reference,
          actual.referenceOrigin,
          actual.date,
          actual.description,
          actual.debit,
          actual.credit,
          actual.debitMinor,
          actual.creditMinor,
        ],
        [
          expected.originalRow,
          expected.page,
          expected.derivedRow,
          expected.reference,
          expected.referenceOrigin,
          expected.date,
          expected.description,
          expected.debitText,
          expected.creditText,
          String(expected.debitMinor),
          String(expected.creditMinor),
        ],
        id,
      );
      for (const proof of [
        actual.referenceEvidence,
        actual.dateEvidence,
        actual.descriptionEvidence,
        actual.debitEvidence,
        actual.creditEvidence,
      ]) {
        assert.equal(proof.sourceHash, oracle.sourceSha256, id);
        assert.equal(
          proof.literal,
          native.sheets[0].rows[proof.row - 1][proof.column - 1],
          id,
        );
        assert.equal(
          proof.page,
          native.sheets[0].rowPages![String(proof.row)],
          id,
        );
        assert.equal(
          proof.spanText,
          proof.literal.slice(proof.spanStartInclusive, proof.spanEndExclusive),
          id,
        );
      }
      assert.equal(actual.referenceEvidence.spanText, actual.reference, id);
      if (actual.referenceOrigin === 'explicit-source-cell') {
        assert.equal(actual.referenceEvidence.row, actual.originalRow, id);
        assert.equal(actual.referenceEvidence.column, 2, id);
        assert.equal(actual.proposalId, undefined, id);
      } else {
        const proposal = review.proposals.find(
          (p) => p.id === actual.proposalId,
        )!;
        assert.deepEqual(
          actual.referenceEvidence,
          proposal.evidence.parent,
          id,
        );
        assert.equal(proposal.evidence.target.row, actual.originalRow, id);
        assert.equal(proposal.evidence.target.literal, '', id);
      }
    }
  }
});

void test('finite fractional cuts are supported and nonfinite cuts are refused', async () => {
  const { source } = await load('P08-complete-zero-section');
  source.pdf!.cuts = [18.1, 36.2, 69.3, 83.4];
  assert.equal(
    (await classifySplitExtraction(source, context)).state,
    'review-ready',
  );
  source.pdf!.cuts[0] = Infinity;
  await assert.rejects(classifySplitExtraction(source, context), {
    code: 'resource-limit',
  });
});

void test('money evidence budget counts exactly two proofs per movement and owns its value before await', async () => {
  const { source } = await load('R01-nine-pages-270-movements');
  await assert.rejects(
    classifySplitExtraction(source, context, { maxMoneyEvidenceCells: 539 }),
    { code: 'resource-limit' },
  );
  const options: SplitOptions = { maxMoneyEvidenceCells: 540 };
  const pending = classifySplitExtraction(source, context, options);
  options.maxMoneyEvidenceCells = 1;
  const ready = await pending;
  assert.equal(ready.movements.length, 270);
  assert.equal(ready.state, 'review-ready');
  const { source: zero } = await load('P08-complete-zero-section');
  await assert.rejects(
    classifySplitExtraction(zero, context, { maxMoneyEvidenceCells: 1 }),
    { code: 'resource-limit' },
  );
  assert.equal(
    (await classifySplitExtraction(zero, context, { maxMoneyEvidenceCells: 2 }))
      .state,
    'review-ready',
  );
  for (const maxMoneyEvidenceCells of [0, -1, 1.5, 65537])
    await assert.rejects(
      classifySplitExtraction(source, context, { maxMoneyEvidenceCells }),
      { code: 'invalid-budget' },
    );
});

void test('pre-abort refuses before touching a hostile source descriptor', () => {
  const abort = new AbortController();
  abort.abort();
  let touched = false;
  const source = Object.defineProperty({}, 'sheets', {
    get() {
      touched = true;
      throw new Error('getter executed');
    },
  }) as SourceFile;
  assert.throws(
    () => snapshotSplitInputs(source, context, { signal: abort.signal }),
    { code: 'cancelled' },
  );
  assert.equal(touched, false);
});

void test('source getters are refused without executing them', async () => {
  const { source } = await load('P08-complete-zero-section');
  let touched = false;
  Object.defineProperty(source.sheets[0].rows[4], '2', {
    get() {
      touched = true;
      return 'forged';
    },
    enumerable: true,
    configurable: true,
  });
  assert.throws(() => snapshotSplitInputs(source, context), {
    code: 'resource-limit',
  });
  assert.equal(touched, false);
});

void test('split cell cap is inclusive 32767 without raising legacy guard', async () => {
  const { source } = await load('P08-complete-zero-section');
  source.sheets[0].rows[4][2] = 'x'.repeat(32767);
  assert.equal(
    (await classifySplitExtraction(source, context)).state,
    'review-ready',
  );
  source.sheets[0].rows[4][2] += 'x';
  await assert.rejects(classifySplitExtraction(source, context), {
    code: 'resource-limit',
  });
});

void test('gross 1e14 is inclusive on each side and net cancellation cannot hide overflow', async () => {
  const { source } = await load('P08-complete-zero-section');
  source.sheets[0].rows = source.sheets[0].rows.slice(0, 4).concat([
    ['2026-10-01', '', 'Debit', '1000000000000.00', '0'],
    ['2026-10-01', '', 'Credit', '0', '1000000000000.00'],
    ['2026-10-01', '', 'True zero', '0', '0'],
  ]);
  source.sheets[0].rowPages = Object.fromEntries(
    source.sheets[0].rows.map((_, i) => [String(i + 1), 1]),
  );
  const valid = await classifySplitExtraction(source, context);
  assert.equal(valid.state, 'review-ready');
  assert.deepEqual(
    [valid.grossDebitMinor, valid.grossCreditMinor, valid.netMinor],
    ['100000000000000', '100000000000000', '0'],
  );
  assert.equal(valid.movements.length, 3);
  source.sheets[0].rows[6][3] = '0.01';
  const blocked = await classifySplitExtraction(source, context);
  assert.equal(blocked.diagnostics[0].code, 'SPLIT_MONEY_LIMIT');
  assert.equal(blocked.movements.length, 0);
});

void test('256 physical rows yield and support cancellation and current-generation refusal', async () => {
  const { source } = await load('R01-nine-pages-270-movements');
  const abort = new AbortController();
  let seen = 0;
  await assert.rejects(
    classifySplitExtraction(source, context, {
      signal: abort.signal,
      onProgress(progress) {
        if (progress.stage === 'section-rows') {
          seen = progress.completed;
          abort.abort();
        }
      },
    }),
    { code: 'cancelled' },
  );
  assert.equal(seen, 256);
  let current = true;
  await assert.rejects(
    classifySplitExtraction(source, context, {
      checkCurrent() {
        if (!current) throw new Error('generation changed');
      },
      onProgress(progress) {
        if (progress.stage === 'section-rows') current = false;
      },
    }),
    /generation changed/,
  );
});

void test('every lowered resource budget is enforced without partial review', async () => {
  const { source } = await load('R01-nine-pages-270-movements');
  for (const budgets of [
    { maxOriginalBytes: source.original!.byteLength - 1 },
    { maxPages: 8 },
    { maxRows: source.sheets[0].rows.length - 1 },
    { maxEvidenceCells: 539 },
    { maxProposals: 269 },
  ])
    await assert.rejects(
      classifySplitExtraction(source, context, { budgets }),
      { code: 'resource-limit' },
    );
  await assert.rejects(
    classifySplitExtraction(source, context, { budgets: { maxRows: 20001 } }),
    { code: 'invalid-budget' },
  );
});
