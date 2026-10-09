import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as readBytes } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  defaultMapping,
  type SourceFile,
} from '../lib/reconciliation/types.ts';
import { syntheticPdf } from './helpers/pdf-fixture.ts';
import {
  inspectSectionContinuation,
  proposeSectionContinuationFromExtraction,
  revalidateSectionContinuation,
  type SectionContinuationReview,
} from '../lib/reconciliation/section-continuation.ts';
const base = new URL(
  '../audit/section-continuation-v1/frozen/',
  import.meta.url,
);
const revision = 'synthetic-native-text-v1';
const mapping = {
  ...defaultMapping(),
  sheet: 0,
  header: 0,
  date: 0,
  reference: 1,
  description: 2,
  amount: 3,
  pdfReviewed: true,
};
const contract = JSON.parse(
  await readBytes(new URL('contract.json', base), 'utf8'),
) as {
  cases: { id: string; source: string; expected: string }[];
};
type Expected = {
  proposals: Record<string, string>;
  questionCodes: string[];
  rowCount: number;
  sourceHash: string;
  extractionRevision: string;
  signedAmounts: Record<string, string>;
};
async function fixture(c: (typeof contract.cases)[number]) {
  const bytes = await readBytes(new URL(c.source, base));
  const data = JSON.parse(bytes.toString()) as {
    rows: string[][];
    rowPages: Record<string, number>;
    pages: number;
  };
  const golden = JSON.parse(
    await readBytes(new URL(c.expected, base), 'utf8'),
  ) as Expected;
  const file: SourceFile = {
    name: c.id + '.pdf',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    original: Uint8Array.from(bytes).buffer,
    sheets: [
      {
        name: 'PDF',
        rows: data.rows,
        rowPages: data.rowPages,
        formulaRows: [],
        hiddenRows: [],
      },
    ],
    pdf: { cuts: [25, 45, 69], pages: data.pages },
  };
  return { file, golden };
}
function decisions(review: SectionContinuationReview) {
  return Object.fromEntries(
    review.proposals.map((p) => [String(p.target.row), p.reference]),
  );
}
void test('section truth tables and physical PDF originals were frozen independently before engine implementation', async () => {
  const freeze = JSON.parse(
    await readBytes(new URL('freeze.json', base), 'utf8'),
  ) as {
    authorship: string;
    files: Record<string, string>;
  };
  assert.match(freeze.authorship, /before TypeScript engine/);
  assert.equal(contract.cases.length, 18);
  for (const [name, digest] of Object.entries(freeze.files)) {
    assert.equal(
      createHash('sha256')
        .update(await readBytes(new URL(name, base)))
        .digest('hex'),
      digest,
      name,
    );
  }
});
void test('all 18 independently frozen section and boundary outcomes preserve every original signed cell', async () => {
  for (const c of contract.cases) {
    const { file, golden } = await fixture(c);
    const before = structuredClone(file);
    const review = await proposeSectionContinuationFromExtraction(
      file,
      mapping,
      revision,
    );
    assert.equal(review.sourceVerified, false, c.id);
    assert.equal(review.authority, 'structural-review-only');
    assert.equal(review.sourceHash, golden.sourceHash, c.id);
    assert.equal(review.extractionRevision, golden.extractionRevision);
    assert.equal(review.rows.length, golden.rowCount, c.id);
    assert.deepEqual(
      review.rows.map((r) => r.values),
      file.sheets[0].rows,
      c.id,
    );
    assert.deepEqual(decisions(review), golden.proposals, c.id);
    assert.deepEqual(
      [...new Set(review.questions.map((q) => q.code))].sort(),
      golden.questionCodes,
      c.id,
    );
    for (const [rn, literal] of Object.entries(golden.signedAmounts)) {
      assert.equal(review.rows[Number(rn) - 1].values[3], literal, c.id + rn);
    }
    for (const p of review.proposals) {
      const facts = [
        p.target,
        p.parent,
        ...p.continuation,
        ...p.headers.flat(),
      ];
      for (const e of facts) {
        assert.equal(
          e.literal,
          file.sheets[e.sheet - 1].rows[e.row - 1][e.column - 1],
        );
        assert.equal(e.page, file.sheets[0].rowPages![String(e.row)]);
        assert.equal(e.sourceHash, file.sha256);
        assert.equal(e.extractionHash, review.extractionHash);
        assert.equal(e.extractionRevision, revision);
      }
      assert.equal(p.target.literal, '');
      assert.equal(p.authority, 'structural-review-only');
    }
    assert.deepEqual(file, before, c.id + ' source was mutated');
  }
});
async function native(id = 'explicit-continuation') {
  const bytes = await readBytes(new URL(id + '.pdf', base));
  return readFile(id + '.pdf', Uint8Array.from(bytes).buffer, [25, 45, 69]);
}
void test('native PDF replay proves physical rows/pages and preserves signed amounts for positive and late-corrupt originals', async () => {
  for (const id of [
    'en-section',
    'explicit-continuation',
    'late-corrupt-amount',
  ]) {
    const file = await native(id);
    const c = contract.cases.find((c) => c.id === id)!;
    const { file: truth, golden } = await fixture(c);
    assert.deepEqual(file.sheets[0].rows, truth.sheets[0].rows);
    assert.deepEqual(file.sheets[0].rowPages, truth.sheets[0].rowPages);
    const review = await inspectSectionContinuation(file, mapping, revision);
    assert.equal(review.sourceVerified, true);
    assert.deepEqual(decisions(review), golden.proposals);
    assert.deepEqual(
      [...new Set(review.questions.map((q) => q.code))].sort(),
      golden.questionCodes,
    );
    assert.deepEqual(
      await revalidateSectionContinuation(review, file, mapping, revision),
      review,
    );
    if (id === 'explicit-continuation') {
      const proposal = review.proposals.find((p) => p.target.page === 2)!;
      assert.equal(proposal.rule, 'explicit-page-continuation');
      assert.equal(proposal.parent.page, 1);
      assert.equal(proposal.continuation[0].page, 2);
      assert.equal(proposal.headers[0][0].page, 2);
    }
  }
});
void test('forged cached cells, pages, source hashes, source issues and PDF metadata cannot pass native replay', async () => {
  const file = await native();
  const faults = [
    (f: SourceFile) => {
      f.sheets[0].rows[1][2] = 'Invoice: FORGED';
    },
    (f: SourceFile) => {
      f.sheets[0].rows[2][3] = '12.50';
    },
    (f: SourceFile) => {
      f.sheets[0].rowPages!['3'] = 2;
    },
    (f: SourceFile) => {
      f.sheets[0].rowIssues = { '3': ['forged issue'] };
    },
    (f: SourceFile) => {
      f.sheets[0].cellIssues = { '3:4': ['forged issue'] };
    },
    (f: SourceFile) => {
      f.sheets[0].pdfTextTransforms = { '3': [] };
    },
    (f: SourceFile) => {
      f.pdf!.pages = 3;
    },
    (f: SourceFile) => {
      f.sha256 = 'a'.repeat(64);
    },
    (f: SourceFile) => {
      new Uint8Array(f.original!)[10] ^= 1;
    },
  ];
  for (const mutate of faults) {
    const forged = structuredClone(file);
    mutate(forged);
    await assert.rejects(
      inspectSectionContinuation(forged, mapping, revision),
      /original|provenance/,
    );
  }
});
void test('review is bound to exact source extraction, settings, revision, row order and proposal contents', async () => {
  const file = await native();
  const review = await inspectSectionContinuation(file, mapping, revision);
  const changed = structuredClone(review);
  changed.proposals[0].reference = 'FORGED';
  await assert.rejects(
    revalidateSectionContinuation(changed, file, mapping, revision),
    /stale or altered/,
  );
  await assert.rejects(
    revalidateSectionContinuation(review, file, mapping, revision + '-2'),
    /stale or altered/,
  );
  await assert.rejects(
    revalidateSectionContinuation(
      review,
      file,
      { ...mapping, multiplier: -1 },
      revision,
    ),
    /stale or altered/,
  );
  await assert.rejects(
    revalidateSectionContinuation(review, file, mapping, revision, 3),
    /stale or altered/,
  );
  await assert.rejects(
    inspectSectionContinuation(
      file,
      { ...mapping, excluded: { '3': 'hide' } },
      revision,
    ),
    /every source row/,
  );
  await assert.rejects(
    inspectSectionContinuation(
      { ...file, original: undefined },
      mapping,
      revision,
    ),
    /original native PDF/,
  );
  await assert.rejects(
    inspectSectionContinuation(file, { ...mapping, reference: 3 }, revision),
    /distinct columns/,
  );
});
void test('extraction snapshot is owned before hashing; concurrent caller mutation cannot alter pending proposals', async () => {
  const { file } = await fixture(contract.cases[0]);
  const reading = structuredClone(mapping);
  const pending = proposeSectionContinuationFromExtraction(
    file,
    reading,
    revision,
  );
  file.sheets[0].rows[1][2] = 'Invoice: MUTATED';
  reading.multiplier = -1;
  assert.deepEqual(decisions(await pending), { '3': 'INV-1', '4': 'INV-1' });
});
void test('native auto-column extraction replays its inference instead of silently changing the extraction profile', async () => {
  const file = await readFile(
    'auto.pdf',
    syntheticPdf([
      [
        ['Date', 'Reference', 'Description', 'Amount'],
        ['2026-10-01', 'INV-1', 'line', '-12.50'],
      ],
    ]),
    [],
    true,
  );
  assert.equal(file.pdf!.autoColumns, true);
  const review = await inspectSectionContinuation(file, mapping, revision);
  assert.equal(review.sourceVerified, true);
  assert.equal(review.rows.length, file.sheets[0].rows.length);
});
void test('issue-bearing parent/amount rows cannot propose identity and issue-bearing carried headers cannot prove continuation', async () => {
  const c = contract.cases.find((c) => c.id === 'explicit-continuation')!;
  const parent = await fixture(c);
  parent.file.sheets[0].rowIssues = { '2': ['damaged parent'] };
  const p = await proposeSectionContinuationFromExtraction(
    parent.file,
    mapping,
    revision,
  );
  assert.equal(p.proposals.length, 0);
  assert.ok(p.questions.some((q) => q.code === 'corrupt-row'));
  const header = await fixture(c);
  header.file.sheets[0].rowIssues = { '4': ['damaged carried header'] };
  const h = await proposeSectionContinuationFromExtraction(
    header.file,
    mapping,
    revision,
  );
  assert.deepEqual(decisions(h), { '3': 'INV-1' });
  assert.ok(h.questions.some((q) => q.code === 'unproven-page-boundary'));
  const amount = await fixture(c);
  amount.file.sheets[0].cellIssues = { '6:4': ['damaged signed amount'] };
  const a = await proposeSectionContinuationFromExtraction(
    amount.file,
    mapping,
    revision,
  );
  assert.equal(a.proposals.length, 0);
  assert.equal(a.rows[5].values[3], '-12.50');
});
void test('same-page unmatched continuation is an explicit boundary and cannot forward-fill subsequent rows', async () => {
  const { file } = await fixture(contract.cases[0]);
  file.sheets[0].rows.splice(3, 0, ['', '', 'Continued invoice: INV-2', '']);
  file.sheets[0].rowPages!['5'] = 1;
  const review = await proposeSectionContinuationFromExtraction(
    file,
    mapping,
    revision,
  );
  assert.deepEqual(decisions(review), { '3': 'INV-1' });
  assert.ok(review.questions.some((q) => q.code === 'unproven-page-boundary'));
  assert.ok(
    review.questions.some(
      (q) => q.code === 'missing-parent' && q.rows.includes(5),
    ),
  );
});
void test('a late invalid date also blocks earlier section proposals without dropping the damaged movement', async () => {
  const { file } = await fixture(contract.cases[0]);
  file.sheets[0].rows[3][0] = '2026-02-31';
  const review = await proposeSectionContinuationFromExtraction(
    file,
    mapping,
    revision,
  );
  assert.equal(review.proposals.length, 0);
  assert.ok(review.questions.some((q) => q.code === 'corrupt-row'));
  assert.equal(review.rows[3].values[0], '2026-02-31');
  assert.equal(review.rows[3].values[3], '+2.50');
});
