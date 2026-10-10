import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile as readNative } from '../lib/reconciliation/io.ts';
import type { SourceFile } from '../lib/reconciliation/types.ts';
import {
  RUNNING_COLUMNS,
  RUNNING_CUTS,
  inspectRunningBalance,
  classifyRunningExtraction,
  snapshotRunningInputs,
  guardRunningPlain,
  type RunningBalanceContext,
  type RunningReview,
} from '../lib/reconciliation/running-balance.ts';
const frozen = new URL('../audit/running-balance/frozen/', import.meta.url);
const context: RunningBalanceContext = {
  columns: RUNNING_COLUMNS,
  currency: 'SAR',
  decimals: 2,
  perspective: 'debit-minus-credit',
  extractionRevision: 'running-frozen-v1',
};
type Facts = {
  id: string;
  accepted: boolean;
  requiredDiagnostic: string | null;
  pages: string[][][];
  sourceSha256: string;
  expected: {
    openingMinor: number;
    debitMinor: number;
    creditMinor: number;
    closingMinor: number;
    count: number;
    balancesMinor: number[];
    references: string[];
  } | null;
};
async function load(id: string, native = false) {
  const facts = JSON.parse(
    await readFile(new URL(`${id}/facts.json`, frozen), 'utf8'),
  ) as Facts;
  const bytes = await readFile(new URL(`${id}/source.pdf`, frozen));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    facts.sourceSha256,
  );
  const source: SourceFile = native
    ? await readNative(
        `${id}.pdf`,
        Uint8Array.from(bytes).buffer,
        [...RUNNING_CUTS],
        false,
        undefined,
        32767,
      )
    : {
        name: `${id}.pdf`,
        sha256: facts.sourceSha256,
        original: Uint8Array.from(bytes).buffer,
        pdf: {
          cuts: [...RUNNING_CUTS],
          pages: facts.pages.length,
          autoColumns: false,
        },
        sheets: [
          {
            name: 'PDF',
            rows: facts.pages.flat(),
            formulaRows: [],
            hiddenRows: [],
            rowPages: Object.fromEntries(
              facts.pages
                .flatMap((page, p) => page.map(() => p + 1))
                .map((p, i) => [String(i + 1), p]),
            ),
          },
        ],
      };
  return { facts, source };
}
function csv(review: RunningReview) {
  const quote = (text: string) =>
    /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  return (
    [
      ['Seq', 'Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'],
      ...review.movements.map((m) => [
        m.seq,
        m.date,
        m.reference,
        m.description,
        m.debit,
        m.credit,
        m.balance,
      ]),
    ]
      .map((row) => row.map(quote).join(','))
      .join('\r\n') + '\r\n'
  );
}
function verifyProofs(review: RunningReview, source: SourceFile) {
  let count = 0;
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, 'spanStartInclusive')) {
      const e = value as {
        row: number;
        column: number;
        page: number;
        literal: string;
        cellText: string;
        spanStartInclusive: number;
        spanEndExclusive: number;
        spanText: string;
        sourceHash: string;
      };
      assert.equal(e.sourceHash, source.sha256);
      assert.equal(e.literal, source.sheets[0].rows[e.row - 1][e.column - 1]);
      assert.equal(e.page, source.sheets[0].rowPages![String(e.row)]);
      assert.equal(e.cellText, e.literal);
      assert.equal(
        e.spanText,
        e.literal.slice(e.spanStartInclusive, e.spanEndExclusive),
      );
      count++;
    }
    Object.values(value).forEach(walk);
  };
  walk(review);
  return count;
}
void test('all 44 sealed cases preserve exact native inventory and authored financial truth', async () => {
  const entries = (await readdir(frozen)).filter((id) =>
    /^[PN][0-9]{2}-/.test(id),
  );
  assert.equal(entries.length, 44);
  for (const id of entries) {
    const { facts, source } = await load(id, true);
    assert.deepEqual(source.sheets[0].rows, facts.pages.flat(), id);
    const review = await inspectRunningBalance(source, context);
    assert.equal(review.rows.length, facts.pages.flat().length, id);
    assert.deepEqual(
      review.rows.map((row) => row.values),
      facts.pages.flat(),
      id,
    );
    assert.equal(
      review.state,
      facts.accepted ? 'review-ready' : 'blocked',
      `${id}: ${JSON.stringify(review.diagnostics)}`,
    );
    verifyProofs(review, source);
    if (!facts.accepted) {
      assert.ok(
        review.diagnostics.some((d) => d.code === facts.requiredDiagnostic),
        `${id}: expected ${facts.requiredDiagnostic}: ${JSON.stringify(review.diagnostics)}`,
      );
      assert.equal(review.movements.length, 0, id);
      assert.equal(review.proposals.length, 0, id);
      assert.ok(review.rows.every((row) => row.derivedRow === null));
      continue;
    }
    assert.equal(review.sourceVerified, true, id);
    const expected = facts.expected!;
    assert.deepEqual(
      [
        review.openingMinor,
        review.grossDebitMinor,
        review.grossCreditMinor,
        review.closingMinor,
      ],
      [
        expected.openingMinor,
        expected.debitMinor,
        expected.creditMinor,
        expected.closingMinor,
      ].map(String),
      id,
    );
    assert.equal(review.movements.length, expected.count, id);
    assert.deepEqual(
      review.movements.map((m) => m.balanceMinor),
      expected.balancesMinor.map(String),
      id,
    );
    assert.deepEqual(
      review.movements.map((m) => m.reference),
      expected.references,
      id,
    );
    assert.equal(
      csv(review),
      await readFile(new URL(`${id}/expected.csv`, frozen), 'utf8'),
      id,
    );
    for (const step of review.balanceSteps) {
      assert.notEqual(step.previousProvidedMinor, null);
      assert.equal(
        BigInt(step.previousProvidedMinor!) +
          BigInt(step.debitProvidedMinor!) -
          BigInt(step.creditProvidedMinor!),
        BigInt(step.computedMinor!),
      );
      assert.equal(
        BigInt(step.nextProvidedMinor!) - BigInt(step.computedMinor!),
        BigInt(step.differenceMinor!),
      );
      assert.equal(step.differenceMinor, '0');
    }
    for (const c of review.controls) {
      if (c.differenceMinor !== null) assert.equal(c.differenceMinor, '0', id);
      if (c.debitDifferenceMinor !== undefined) {
        assert.equal(c.debitDifferenceMinor, '0');
        assert.equal(c.creditDifferenceMinor, '0');
      }
    }
  }
});
void test('frozen payload copy is byte-identical to the sealed input manifest', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('INPUT-MANIFEST.json', frozen), 'utf8'),
  ) as { files: { path: string; bytes: number; sha256: string }[] };
  assert.equal(manifest.files.length, 96);
  for (const f of manifest.files) {
    const bytes = await readFile(new URL(f.path, frozen));
    assert.equal(bytes.length, f.bytes);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      f.sha256,
      f.path,
    );
  }
});
void test('generic identifiers and valid shifted periods bind declared scope without names authority', async () => {
  const { source } = await load('P01-two-pages-two-sections');
  for (const row of source.sheets[0].rows)
    for (let i = 0; i < row.length; i++)
      row[i] = row[i]
        .replaceAll('ST-001', 'Statement.New/7')
        .replaceAll('ACCT-1', 'Account.A/9')
        .replaceAll('INV-A', 'Doc-Delta/3')
        .replaceAll('INV-B', 'Doc-Beta/4')
        .replaceAll('2026-10-', '2024-03-');
  const review = await classifyRunningExtraction(source, context);
  assert.equal(review.state, 'review-ready');
  assert.equal(review.sourceVerified, false);
  assert.equal(review.declaredScope?.statement, 'Statement.New/7');
  assert.equal(review.declaredScope?.periodStart, '2024-03-01');
  const altered = structuredClone(source);
  altered.sheets[0].rows[1][0] = 'Statement: wrong scope';
  assert.equal(
    (await classifyRunningExtraction(altered, context)).state,
    'blocked',
  );
});
void test('calendar, literal sequence, all role blanks and missing late controls fail closed', async () => {
  const { source } = await load('P01-two-pages-two-sections');
  const changes = [
    { row: 3, col: 0, text: 'Period: 2026-02-29/2026-10-31', code: 'PERIOD' },
    { row: 10, col: 0, text: '01', code: 'ROLE' },
    { row: 9, col: 6, text: '0', code: 'ROLE' },
    { row: 8, col: 2, text: 'INV-A', code: 'ROLE' },
  ];
  for (const c of changes) {
    const changed = structuredClone(source);
    changed.sheets[0].rows[c.row][c.col] = c.text;
    const review = await classifyRunningExtraction(changed, context);
    assert.equal(review.state, 'blocked');
    assert.ok(review.diagnostics.some((d) => d.code === c.code));
  }
});
void test('pre-abort and descriptor guards precede getters and cloning', async () => {
  const { source } = await load('P01-two-pages-two-sections');
  let touched = false;
  Object.defineProperty(source, 'name', {
    enumerable: true,
    get: () => {
      touched = true;
      return 'x.pdf';
    },
  });
  const abort = new AbortController();
  abort.abort();
  assert.throws(
    () => snapshotRunningInputs(source, context, { signal: abort.signal }),
    /cancelled/,
  );
  assert.equal(touched, false);
  assert.throws(() => snapshotRunningInputs(source, context), /resource-limit/);
  assert.equal(touched, false);
  const getterBudget = {};
  Object.defineProperty(getterBudget, 'maxRows', {
    enumerable: true,
    get: () => {
      touched = true;
      return 1;
    },
  });
  assert.throws(
    () => snapshotRunningInputs(source, context, { budgets: getterBudget }),
    /resource-limit/,
  );
  assert.equal(touched, false);
  assert.throws(
    () => guardRunningPlain({ a: 'abcd' }, undefined, { maxPlainTextUnits: 4 }),
    /resource-limit/,
  );
});
void test('reduced budgets and repeated proof occurrences are enforced before publication', async () => {
  const { source } = await load('P01-two-pages-two-sections');
  const review = await classifyRunningExtraction(source, context);
  const occurrences = verifyProofs(review, source);
  assert.ok(occurrences > review.movements.length * 7);
  await assert.rejects(
    classifyRunningExtraction(source, context, {
      budgets: { maxEvidenceCells: 20 },
    }),
    /resource-limit/,
  );
  await assert.rejects(
    classifyRunningExtraction(source, context, {
      budgets: { maxRows: source.sheets[0].rows.length - 1 },
    }),
    /resource-limit/,
  );
  await assert.rejects(
    classifyRunningExtraction(source, context, { budgets: { maxPages: 1 } }),
    /resource-limit/,
  );
  await assert.rejects(
    classifyRunningExtraction(source, context, {
      budgets: { maxOriginalBytes: source.original!.byteLength - 1 },
    }),
    /resource-limit/,
  );
  await assert.rejects(
    classifyRunningExtraction(source, context, {
      budgets: { maxCellTextUnits: 20 },
    }),
    /resource-limit/,
  );
  await assert.rejects(
    classifyRunningExtraction(source, context, {
      budgets: { maxProposals: 1 },
    }),
    /resource-limit/,
  );
});
void test('native replay refuses fabricated extraction and changed scope with same original', async () => {
  const { source } = await load('P01-two-pages-two-sections', true);
  source.sheets[0].rows[1][0] = 'Statement: New-7';
  const review = await inspectRunningBalance(source, context);
  assert.equal(review.state, 'blocked');
  assert.ok(review.diagnostics.some((d) => d.code === 'SOURCE_CHANGED'));
  assert.equal(review.movements.length, 0);
});
void test('native generic identifiers and calendar shift preserve declared source scope', async () => {
  const { facts } = await load('P01-two-pages-two-sections');
  const { readRunningSyntheticPages } =
    await import('./running-balance-test-helper.ts');
  for (const page of facts.pages)
    for (const row of page)
      for (let i = 0; i < row.length; i++)
        row[i] = row[i]
          .replaceAll('ST-001', 'Stmt.X/2')
          .replaceAll('ACCT-1', 'Acct.Q/3')
          .replaceAll('INV-A', 'Doc.X-7')
          .replaceAll('INV-B', 'Doc.Y-8')
          .replaceAll('2026-10-', '2024-03-');
  const source = await readRunningSyntheticPages(facts.pages);
  assert.deepEqual(source.sheets[0].rows, facts.pages.flat());
  const review = await inspectRunningBalance(source, context);
  assert.equal(review.state, 'review-ready');
  assert.equal(review.sourceVerified, true);
  assert.equal(review.declaredScope?.account, 'Acct.Q/3');
  assert.equal(review.declaredScope?.periodEnd, '2024-03-31');
  assert.equal(review.closingMinor, String(facts.expected!.closingMinor));
});
void test('independent omission witnesses distinguish counts, gross totals, and internal consistency', async () => {
  const { facts } = await load('P03-zero-and-identical-movements');
  const { readRunningSyntheticPages } =
    await import('./running-balance-test-helper.ts');
  const missingZero = structuredClone(facts.pages);
  missingZero[0] = missingZero[0].filter((row) => row[0] !== '4');
  let review = await inspectRunningBalance(
    await readRunningSyntheticPages(missingZero),
    context,
  );
  assert.equal(review.state, 'blocked');
  assert.deepEqual(
    [...new Set(review.diagnostics.map((d) => d.code))],
    ['COUNT'],
  );
  assert.equal(review.closingMinor, '0');
  const pairGone = structuredClone(facts.pages);
  pairGone[0] = pairGone[0].filter(
    (row) =>
      !['Invoice: INV-A', '1', '2', 'Section total: INV-A'].includes(row[0]),
  );
  for (const row of pairGone[0]) {
    if (row[0] === '3') row[0] = '1';
    else if (row[0] === '4') row[0] = '2';
    else if (row[0] === 'Page count: 4') row[0] = 'Page count: 2';
    else if (row[0] === 'Statement count: 4') row[0] = 'Statement count: 2';
  }
  review = await inspectRunningBalance(
    await readRunningSyntheticPages(pairGone),
    context,
  );
  assert.equal(review.state, 'blocked');
  assert.deepEqual(
    [...new Set(review.diagnostics.map((d) => d.code))],
    ['TOTAL'],
  );
  assert.equal(review.closingMinor, '0');
  for (const row of pairGone[0])
    if (row[0] === 'Page total' || row[0] === 'Statement total')
      row[4] = row[5] = '0';
  review = await inspectRunningBalance(
    await readRunningSyntheticPages(pairGone),
    context,
  );
  assert.equal(review.state, 'review-ready');
  assert.equal(review.movements.length, 2);
  assert.equal(review.grossDebitMinor, '0');
  assert.equal(review.grossCreditMinor, '0');
  assert.equal(review.financialApproval, false);
  assert.equal(review.scopeConfirmed, false);
});
void test('every control forbids stray cells and no role repairs or falls back', async () => {
  const { source } = await load('P01-two-pages-two-sections');
  let cases = 0;
  for (let r = 0; r < source.sheets[0].rows.length; r++) {
    const values = source.sheets[0].rows[r],
      label = values[0];
    if (/^[1-9][0-9]*$/.test(label) || label === 'Seq') continue;
    const allowed =
      label === 'Opening balance' || label === 'Closing balance'
        ? [0, 1, 6]
        : label === 'Brought balance' || label === 'Carried balance'
          ? [0, 6]
          : label.startsWith('Section total:') ||
              label === 'Page total' ||
              label === 'Statement total'
            ? [0, 4, 5]
            : [0];
    for (let c = 0; c < 7; c++) {
      if (allowed.includes(c)) continue;
      const altered = structuredClone(source);
      altered.sheets[0].rows[r][c] = 'stray';
      const review = await classifyRunningExtraction(altered, context);
      assert.equal(review.state, 'blocked', `${r}/${c}`);
      assert.ok(
        review.diagnostics.some((d) => d.code === 'ROLE'),
        `${r}/${c}`,
      );
      assert.equal(review.movements.length, 0);
      cases++;
    }
  }
  assert.ok(cases >= 100);
});
void test('steps use previous supplied balance and retain signed supplied-minus-reference differences', async () => {
  const { source } = await load('P01-two-pages-two-sections');
  source.sheets[0].rows.find((row) => row[0] === '1')![6] = '220.01';
  const review = await classifyRunningExtraction(source, context);
  const first = review.balanceSteps[0],
    second = review.balanceSteps[1];
  assert.equal(second.previousProvidedMinor, first.nextProvidedMinor);
  assert.notEqual(second.previousProvidedMinor, first.computedMinor);
  assert.equal(
    BigInt(first.nextProvidedMinor!) - BigInt(first.computedMinor!),
    BigInt(first.differenceMinor!),
  );
  assert.equal(
    BigInt(second.nextProvidedMinor!) - BigInt(second.computedMinor!),
    BigInt(second.differenceMinor!),
  );
  const { source: totalSource } = await load('N26-wrong-page-total');
  const totalReview = await classifyRunningExtraction(totalSource, context);
  const total = totalReview.controls.find((c) => c.role === 'page-total')!;
  assert.equal(
    BigInt(total.debitProvidedMinor!) - BigInt(total.debitExpectedMinor!),
    BigInt(total.debitDifferenceMinor!),
  );
});
void test('CSV and plain budgets are lower-only and preabort outranks nested budget traversal', async () => {
  const { source } = await load('P01-two-pages-two-sections');
  await assert.rejects(
    classifyRunningExtraction(source, context, {
      budgets: { maxCsvBytes: 10 },
    }),
    /resource-limit/,
  );
  await assert.rejects(
    classifyRunningExtraction(source, context, {
      budgets: { maxCsvBytes: 8 * 1024 * 1024 + 1 },
    }),
    /invalid-budget/,
  );
  const abort = new AbortController();
  abort.abort();
  let invoked = false;
  const budgets = {};
  Object.defineProperty(budgets, 'maxRows', {
    enumerable: true,
    get: () => {
      invoked = true;
      return 1;
    },
  });
  assert.throws(
    () =>
      snapshotRunningInputs(source, context, { signal: abort.signal, budgets }),
    /cancelled/,
  );
  assert.equal(invoked, false);
  const fake = {
    get aborted() {
      invoked = true;
      return false;
    },
  };
  assert.throws(
    () =>
      snapshotRunningInputs(source, context, { signal: fake as AbortSignal }),
    /resource-limit/,
  );
  assert.equal(invoked, false);
});
void test('plain text budget includes array indices and length with exact-plus-one witnesses', () => {
  guardRunningPlain(['ab'], undefined, { maxPlainTextUnits: 9 });
  assert.throws(
    () => guardRunningPlain(['abc'], undefined, { maxPlainTextUnits: 9 }),
    /resource-limit/,
  );
  guardRunningPlain(Array(11).fill(null), undefined, { maxPlainTextUnits: 18 });
  assert.throws(
    () =>
      guardRunningPlain(Array(12).fill(null), undefined, {
        maxPlainTextUnits: 18,
      }),
    /resource-limit/,
  );
  guardRunningPlain({ list: ['ab'] }, undefined, { maxPlainTextUnits: 13 });
  assert.throws(
    () =>
      guardRunningPlain({ lists: ['ab'] }, undefined, {
        maxPlainTextUnits: 13,
      }),
    /resource-limit/,
  );
});
void test('the final evidence budget counts repeated published occurrences exactly', async () => {
  const { source } = await load('P01-two-pages-two-sections');
  const ready = await classifyRunningExtraction(source, context);
  const count = verifyProofs(ready, source);
  assert.equal(
    (
      await classifyRunningExtraction(source, context, {
        budgets: { maxEvidenceCells: count },
      })
    ).state,
    'review-ready',
  );
  await assert.rejects(
    classifyRunningExtraction(source, context, {
      budgets: { maxEvidenceCells: count - 1 },
    }),
    /resource-limit/,
  );
});
