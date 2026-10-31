// BNK-PDF-1 G2 differential test: the product matching engine against the
// foundation oracle's own matcher (audit/bank-statement-foundation/oracle.py,
// a separate Python implementation of the same contract), on seeded random
// cases built to collide: a few shared amounts, references that repeat, that
// differ only by case or by surrounding spaces, or are empty, dates on both
// sides of the window, value dates outside the period, and counterparts
// copied from the other side with one fact changed. Every case must agree in
// full, and every automatic pair must also satisfy the contract directly.
//   node --experimental-strip-types scripts/bank-statement-g2-differential.mjs [--cases 10000] [--seed 20261021]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const root = path.resolve(import.meta.dirname, '..');
const { values: args } = parseArgs({
  options: {
    cases: { type: 'string', default: '10000' },
    seed: { type: 'string', default: '20261021' },
  },
});
const outDir =
  process.env.BNK_G2_DIFFERENTIAL_DIR ??
  path.join(root, 'work/bank-statement-g2-differential');
const { matchBankStatement, STATEMENT_DATE_WINDOW_DAYS } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-match.ts')
);

let state = Number(args.seed) >>> 0 || 1;
const random = (n) => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) % n;
};
const pick = (xs) => xs[random(xs.length)];
const REFERENCES = ['', '', '', 'R1', 'R2', 'R3', 'R4', 'r1', ' R2 '];
const AMOUNTS = [10000, 10000, 10001, 25000, 99999, 500];
const day = (d) =>
  `2026-0${d < 1 ? 6 : d > 31 ? 8 : 7}-${String(d < 1 ? 30 : d > 31 ? 1 : d).padStart(2, '0')}`;
const PERIOD = { start: '2026-07-01', end: '2026-07-31' };

function makeCase() {
  const bank = [];
  const cash = [];
  const nb = random(9),
    nc = random(9);
  for (let i = 0; i < nb; i++) {
    const d = 1 + random(10);
    const out = random(2) === 1;
    const amount = pick(AMOUNTS);
    bank.push({
      key: `b${i + 1}`,
      date: day(d),
      valueDate: random(8) === 0 ? day(pick([0, 32])) : day(d),
      reference: pick(REFERENCES),
      withdrawal: out ? amount : 0,
      deposit: out ? 0 : amount,
    });
  }
  for (let i = 0; i < nc; i++) {
    const copy = bank.length && random(3) !== 0 ? pick(bank) : undefined;
    let direction = copy
      ? copy.withdrawal
        ? 'out'
        : 'in'
      : pick(['in', 'out']);
    let amount = copy ? copy.withdrawal || copy.deposit : pick(AMOUNTS);
    let reference = copy ? copy.reference : pick(REFERENCES);
    let d = copy ? Number(copy.date.slice(8)) : 1 + random(10);
    if (copy)
      // Half the copies stay exact counterparts; the rest change one fact.
      switch (random(8)) {
        case 0:
          direction = direction === 'in' ? 'out' : 'in';
          break;
        case 1:
          amount += pick([1, -1, 100]);
          break;
        case 2:
          d += pick([3, 4, -4]);
          break;
        case 3:
          reference = pick(REFERENCES);
          break;
      }
    cash.push({
      voucher: `V${i + 1}`,
      date: day(Math.min(Math.max(d, 1), 31)),
      reference,
      direction,
      amount: Math.max(amount, 1),
    });
  }
  return { bank, cash };
}

const cases = Array.from({ length: Number(args.cases) }, makeCase);
// The product engine on a proved statement holding the same movements.
const product = cases.map(({ bank, cash }) => {
  const reading = {
    family: 'bank-statement-native-1',
    format: 'pdf',
    layout: 'en',
    sha256: '',
    currency: 'SAR',
    decimals: 2,
    period: PERIOD,
    heading: '',
    pages: [],
    lines: bank.map((b, i) => ({
      kind: 'movement',
      page: 1,
      items: [i + 1],
      date: b.date,
      valueDate: b.valueDate,
      description: '',
      reference: b.reference,
      withdrawal: b.withdrawal,
      deposit: b.deposit,
      balance: 0,
    })),
    status: 'verified',
    opening: 0,
    closing: 0,
    withdrawals: 0,
    deposits: 0,
  };
  const entries = cash.map((c, i) => ({
    id: c.voucher,
    row: i + 2,
    date: c.date,
    description: '',
    reference: c.reference.trim(),
    direction: c.direction,
    amount: c.amount,
  }));
  return matchBankStatement(reading, entries);
});
// The oracle on the same cases, in one batch.
const run = spawnSync(
  process.env.PYTHON ?? 'python3',
  [
    '-B',
    path.join(root, 'audit/bank-statement-foundation/differential_match.py'),
  ],
  {
    cwd: path.join(root, 'audit/bank-statement-foundation'),
    input: JSON.stringify({
      window: STATEMENT_DATE_WINDOW_DAYS,
      period: PERIOD,
      cases: cases.map(({ bank, cash }) => ({
        bank,
        cash: cash.map((c) => ({ ...c, amount: (c.amount / 100).toFixed(2) })),
      })),
    }),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  },
);
assert.equal(run.status, 0, run.stderr);
const oracle = JSON.parse(run.stdout);
assert.equal(oracle.length, cases.length);

const sortedText = (xs) => xs.map(String).sort((a, b) => (a < b ? -1 : 1));
const groups = (gs, s, c) =>
  sortedText(
    gs.map(
      (g) =>
        `${sortedText(g[s]).join(',')}/${sortedText(g[c]).join(',')}/${g.reason}`,
    ),
  );
const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
const counts = {};
let automatic = 0;
for (const [i, got] of product.entries()) {
  const { bank, cash } = cases[i];
  const key = (id) => `b${id.slice(1)}`;
  const want = oracle[i];
  const where = `case ${i}: ${JSON.stringify(cases[i])}`;
  assert.deepEqual(
    sortedText(got.auto.map((a) => `${key(a.statement)}|${a.cashbook}`)),
    sortedText(want.auto.map(([b, c]) => `${b}|${c}`)),
    `auto, ${where}`,
  );
  assert.deepEqual(
    groups(
      got.review.map((g) => ({ ...g, statement: g.statement.map(key) })),
      'statement',
      'cashbook',
    ),
    groups(want.review, 'bank', 'cash'),
    `review, ${where}`,
  );
  assert.deepEqual(
    sortedText(got.statementOnly.map(key)),
    sortedText(want.bankOnly),
    `bankOnly, ${where}`,
  );
  assert.deepEqual(
    sortedText(got.cashbookOnly),
    sortedText(want.cashOnly),
    `cashOnly, ${where}`,
  );
  assert.deepEqual(
    sortedText(got.timing.map(key)),
    sortedText(want.timing),
    `timing, ${where}`,
  );
  // The contract, checked directly on every automatic pair.
  for (const a of got.auto) {
    const b = bank[Number(a.statement.slice(1)) - 1];
    const c = cash.find((x) => x.voucher === a.cashbook);
    const ref = b.reference.trim();
    assert.ok(ref && ref === c.reference.trim(), `reference, ${where}`);
    assert.equal(
      bank.filter((x) => x.reference.trim() === ref).length,
      1,
      where,
    );
    assert.equal(
      cash.filter((x) => x.reference.trim() === ref).length,
      1,
      where,
    );
    assert.equal(
      b.withdrawal ? 'out' : 'in',
      c.direction,
      `direction, ${where}`,
    );
    assert.equal(b.withdrawal || b.deposit, c.amount, `amount, ${where}`);
    assert.ok(
      days(b.date, c.date) <= STATEMENT_DATE_WINDOW_DAYS,
      `date, ${where}`,
    );
    automatic++;
  }
  for (const g of got.review) counts[g.reason] = (counts[g.reason] ?? 0) + 1;
  counts.statementOnly = (counts.statementOnly ?? 0) + got.statementOnly.length;
  counts.cashbookOnly = (counts.cashbookOnly ?? 0) + got.cashbookOnly.length;
  counts.timing = (counts.timing ?? 0) + got.timing.length;
}
// Every outcome must have occurred, or the cases did not test it.
for (const reason of [
  'direction-conflict',
  'amount-difference',
  'date-gap',
  'duplicate-reference',
  'amount-date-suggestion',
  'ambiguous-amount-date',
  'statementOnly',
  'cashbookOnly',
  'timing',
])
  assert.ok(
    (counts[reason] ?? 0) >= 20,
    `too few ${reason}: ${counts[reason] ?? 0}`,
  );
assert.ok(automatic >= 1000, `too few automatic pairs: ${automatic}`);

const report = {
  seed: Number(args.seed),
  cases: cases.length,
  agreed: cases.length,
  automatic,
  outcomes: counts,
};
await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, 'differential.json'),
  `${JSON.stringify(report, null, 1)}\n`,
);
console.log(JSON.stringify(report));
