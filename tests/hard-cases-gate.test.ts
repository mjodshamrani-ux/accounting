import test from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../audit/hard-cases/gate-rules.mjs';
import * as triageModule from '../audit/hard-cases/triage.mjs';

// The EVAL-1 gate is itself under test: an unsafe case is never excused by
// triage, an unnamed failure fails, and a triage entry that stops failing
// fails as stale.
type Rec = {
  id: string;
  formats?: string[];
  template: string;
  variant: string;
  assist: string;
  verdict: string;
  counts: Record<string, number>;
};
type Entry = {
  keys: string[];
  formats?: string[];
  assist: string[];
  verdicts: string[];
  class: string;
};
const { judge } = rules as unknown as {
  judge: (
    records: Rec[],
    triage?: Entry[],
  ) => {
    unsafe: string[];
    untriaged: string[];
    stale: string[];
    triaged: Map<string, number>;
    passed: boolean;
  };
};
const { TRIAGE } = triageModule as unknown as { TRIAGE: Entry[] };
const clean = {
  falseApprovals: 0,
  wrongMemberGroups: 0,
  silentMisreads: 0,
  rowsLost: 0,
};
const rec = (over: Partial<Rec>): Rec => ({
  id: 'HC-1',
  template: 'T-x',
  variant: 'v',
  assist: 'declared',
  verdict: 'pass',
  counts: { ...clean },
  ...over,
});
const register: Entry[] = [
  {
    keys: ['T-x|v'],
    assist: ['declared'],
    verdicts: ['fail-outcome'],
    class: 'product-gap',
  },
];

void test('gate: a named, safe failure passes and is counted', () => {
  const r = judge([rec({ verdict: 'fail-outcome' })], register);
  assert.equal(r.passed, true);
  assert.equal([...r.triaged.values()][0], 1);
});

void test('gate: triage never excuses an unsafe case', () => {
  for (const bad of [
    rec({ verdict: 'fail-unsafe' }),
    rec({ verdict: 'fail-crash' }),
    rec({ verdict: 'fail-outcome', counts: { ...clean, falseApprovals: 1 } }),
    rec({
      verdict: 'fail-outcome',
      counts: { ...clean, wrongMemberGroups: 1 },
    }),
    rec({ verdict: 'pass', counts: { ...clean, silentMisreads: 1 } }),
    rec({ verdict: 'pass', counts: { ...clean, rowsLost: 1 } }),
  ]) {
    const r = judge([bad, rec({ verdict: 'fail-outcome' })], register);
    assert.equal(r.passed, false, bad.verdict);
    assert.equal(r.unsafe.length, 1);
  }
});

void test('gate: a failure no entry names fails, also in another mode or verdict', () => {
  for (const other of [
    rec({ template: 'T-y', verdict: 'fail-outcome' }),
    rec({ assist: 'none', verdict: 'fail-outcome' }),
    rec({ verdict: 'fail-missed' }),
  ]) {
    const r = judge([rec({ verdict: 'fail-outcome' }), other], register);
    assert.equal(r.passed, false);
    assert.equal(r.untriaged.length, 1);
  }
});

void test('gate: an entry that ran and stopped failing is stale; one that did not run is not', () => {
  const r = judge([rec({ verdict: 'pass' })], register);
  assert.equal(r.passed, false);
  assert.deepEqual(r.stale, ['T-x|v [declared] (product-gap)']);
  assert.equal(judge([rec({ template: 'T-z' })], register).passed, true);
});

void test('gate: every triage entry is complete and classified', () => {
  for (const t of TRIAGE) {
    assert.ok(t.keys.length && t.assist.length && t.verdicts.length);
    assert.ok(
      ['product-gap', 'assistance-gap', 'harness-defect'].includes(t.class),
    );
    for (const v of t.verdicts)
      assert.ok(!['fail-unsafe', 'fail-crash', 'pass'].includes(v), v);
  }
});

void test('gate: a format-scoped entry covers only records with that format, and is stale only where it ran', () => {
  const pdfOnly: Entry[] = [
    {
      keys: ['*'],
      formats: ['pdf'],
      assist: ['none'],
      verdicts: ['needs-assistance'],
      class: 'assistance-gap',
    },
  ];
  const ask = { assist: 'none', verdict: 'needs-assistance' };
  assert.equal(
    judge([rec({ ...ask, formats: ['pdf', 'xlsx'] })], pdfOnly).passed,
    true,
  );
  const csv = judge([rec({ ...ask, formats: ['csv', 'xlsx'] })], pdfOnly);
  assert.equal(csv.untriaged.length, 1);
  // No PDF ran: not stale. PDF ran and passed: stale.
  assert.deepEqual(csv.stale, []);
  const passedPdf = judge(
    [rec({ assist: 'none', formats: ['pdf', 'csv'] })],
    pdfOnly,
  );
  assert.deepEqual(passedPdf.stale, ['* [none] {pdf} (assistance-gap)']);
});
