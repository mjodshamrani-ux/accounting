// The S3 judge: what one product run on one statement proves against the
// oracle (frozen/expected.json). Pure: it imports nothing from the product,
// and its own self-test feeds it results written by hand.
//
//   node audit/supplier-statement-holdout-s3/judge.mjs --self-test
//
// A run is unsafe when the product
// - reads a transaction that is not a movement of the statement as printed
//   (date, document number and signed amount in minor units), or reads a
//   line in another currency as an amount in riyals (misread);
// - leaves a movement neither read nor kept as a row with its reason (lost);
// - approves a match that is neither required (approve) nor allowed (allow),
//   member for member (wrong approval).
// A run that is not unsafe is
// - complete when every movement is read and every required pair approved;
// - stopped when the product refused with a reason its catalogue names;
// - crashed when it refused with anything else;
// - incomplete otherwise, with what is missing counted.
// A positive story passes when its declared run is complete; a reserved
// story passes when no run of it is unsafe or crashed. Every run of every
// story must be free of misreads, lost rows and wrong approvals.

const key = (date, ref, minor) => `${date}\u0000${ref}\u0000${minor}`;
const pair = (a, b) => `${a}\u0000${b}`;

/** One run's verdict. `run` is {stopped: message} or {result} from
 * reconcileSupplierStatement; `known(message)` says whether the product's
 * catalogue names a refusal. */
export function judge(expected, run, known) {
  const out = {
    verdict: '',
    counts: { read: 0, misreads: 0, currencyMisreads: 0, lost: 0, retained: 0, wrongApprovals: 0, approved: 0, missed: 0 },
    findings: [],
  };
  if (run.stopped !== undefined) {
    out.verdict = known(run.stopped) ? 'stopped' : 'crashed';
    out.stopped = String(run.stopped).slice(0, 240);
    return out;
  }
  const { result } = run;
  const movements = new Map(expected.movements.map(([d, r, m]) => [key(d, r, m), r]));
  const foreign = new Set(expected.otherCurrency.map(([d, r, m]) => key(d, r, m)));
  const refOf = new Map();
  const used = new Set();
  for (const t of result.supplier.transactions) {
    const k = key(t.date, t.reference, t.amount);
    if (movements.has(k) && !used.has(k)) {
      used.add(k);
      refOf.set(t.id, movements.get(k));
      out.counts.read++;
    } else if (foreign.has(k)) {
      out.counts.currencyMisreads++;
      out.findings.push(`a line in another currency read as riyals: ${t.date} ${t.reference} ${t.amount}`);
    } else {
      out.counts.misreads++;
      out.findings.push(`read as ${t.date} ${t.reference} ${t.amount}: no such movement`);
    }
  }
  const ledgerRef = new Map(result.ledger.transactions.map((t) => [t.id, t.reference]));
  // Rows kept with a reason: read errors and exclusions that are not page
  // furniture (an opening line, a header repeated, a footer).
  out.counts.retained =
    result.supplier.errors.filter((e) => e.row > 0).length +
    result.supplier.excluded.filter((e) => e.kind !== 'non-movement').length;
  const unread = expected.movements.length + expected.otherCurrency.length - out.counts.read;
  out.counts.lost = Math.max(0, unread - out.counts.retained);
  if (out.counts.lost) out.findings.push(`${out.counts.lost} movement(s) neither read nor kept with a reason`);
  const approve = new Set(expected.approve.map(([a, b]) => pair(a, b)));
  const allow = new Set(expected.allow.map(([a, b]) => pair(a, b)));
  const approved = new Set();
  for (const c of result.cases.filter((x) => x.status === 'Matched')) {
    const s = c.supplierMembers.map((t) => refOf.get(t.id) ?? `?${t.reference}`);
    const l = c.ledgerMembers.map((t) => ledgerRef.get(t.id) ?? `?${t.reference}`);
    const p = s.length === 1 && l.length === 1 ? pair(s[0], l[0]) : null;
    if (p && (approve.has(p) || allow.has(p))) {
      approved.add(p);
      out.counts.approved++;
    } else {
      out.counts.wrongApprovals++;
      out.findings.push(`approved ${s.join('+')} | ${l.join('+')}: neither required nor allowed`);
    }
  }
  out.counts.missed = [...approve].filter((p) => !approved.has(p)).length;
  const unsafe = out.counts.misreads + out.counts.currencyMisreads + out.counts.lost + out.counts.wrongApprovals;
  if (unsafe) out.verdict = 'unsafe';
  else if (out.counts.read === expected.movements.length && !out.counts.missed) out.verdict = 'complete';
  else out.verdict = 'incomplete';
  out.balance = {
    status: result.supplier.balanceArithmeticStatus ?? null,
    opening: result.supplier.opening ?? null,
    closing: result.supplier.closing ?? null,
    expected: expected.balances,
  };
  return out;
}

/** A story's outcome from its runs. */
export function outcome(expected, runs) {
  const safe = Object.values(runs).every((r) => r.verdict !== 'unsafe' && r.verdict !== 'crashed');
  if (expected.kind === 'positive') return safe && runs.declared.verdict === 'complete' ? 'pass' : safe ? 'short' : 'fail';
  return safe ? 'pass' : 'fail';
}

function selfTest() {
  const expected = {
    kind: 'positive',
    movements: [['2026-07-02', 'INV-1', 1000], ['2026-07-03', 'PMT-1', -500]],
    otherCurrency: [['2026-07-04', 'INV-2', 700, 'USD']],
    approve: [['INV-1', 'INV-1'], ['PMT-1', 'PMT-1']],
    allow: [],
    balances: { opening: 0, closing: 500, currency: 'SAR' },
  };
  const tx = (id, date, reference, amount) => ({ id, date, reference, amount });
  const base = () => ({
    supplier: {
      transactions: [tx('s1', '2026-07-02', 'INV-1', 1000), tx('s2', '2026-07-03', 'PMT-1', -500)],
      errors: [{ row: 4, message: 'currency' }],
      excluded: [{ row: 1, kind: 'non-movement' }],
    },
    ledger: { transactions: [tx('l1', '2026-07-02', 'INV-1', 1000), tx('l2', '2026-07-03', 'PMT-1', -500)] },
    cases: [
      { status: 'Matched', supplierMembers: [{ id: 's1' }], ledgerMembers: [{ id: 'l1' }] },
      { status: 'Matched', supplierMembers: [{ id: 's2' }], ledgerMembers: [{ id: 'l2' }] },
    ],
  });
  const known = (m) => m === 'catalogued';
  const cases = [
    ['correct and whole', (r) => r, 'complete'],
    ['an amount one halala off', (r) => { r.supplier.transactions[0].amount = 1001; }, 'unsafe'],
    ['a date moved', (r) => { r.supplier.transactions[1].date = '2026-08-03'; }, 'unsafe'],
    ['the dollar line read as riyals', (r) => {
      r.supplier.transactions.push(tx('s3', '2026-07-04', 'INV-2', 700));
      r.supplier.errors = [];
    }, 'unsafe'],
    ['a movement dropped without a reason', (r) => { r.supplier.transactions.pop(); r.cases.pop(); }, 'unsafe'],
    ['a movement kept as an error row', (r) => {
      r.supplier.transactions.pop();
      r.cases.pop();
      r.supplier.errors.push({ row: 3, message: 'kept' });
    }, 'incomplete'],
    ['a required pair left for review', (r) => { r.cases[1].status = 'Needs Review'; }, 'incomplete'],
    ['an invoice approved with the payment', (r) => {
      r.cases = [{ status: 'Matched', supplierMembers: [{ id: 's1' }], ledgerMembers: [{ id: 'l2' }] }];
    }, 'unsafe'],
    ['a group approval', (r) => {
      r.cases = [{ status: 'Matched', supplierMembers: [{ id: 's1' }, { id: 's2' }], ledgerMembers: [{ id: 'l1' }, { id: 'l2' }] }];
    }, 'unsafe'],
  ];
  const seen = [];
  for (const [label, change, want] of cases) {
    const result = base();
    change(result);
    const got = judge(expected, { result }, known).verdict;
    if (got !== want) throw new Error(`judge self-test: ${String(label)}: ${got}, expected ${String(want)}`);
    seen.push(label);
  }
  if (judge(expected, { stopped: 'catalogued' }, known).verdict !== 'stopped') throw new Error('judge self-test: stop');
  if (judge(expected, { stopped: 'TypeError: x' }, known).verdict !== 'crashed') throw new Error('judge self-test: crash');
  const reserved = { ...expected, kind: 'reserved', approve: [], allow: expected.approve };
  if (judge(reserved, { result: base() }, known).verdict !== 'complete') throw new Error('judge self-test: allowed');
  if (outcome(reserved, { declared: { verdict: 'stopped' }, unaided: { verdict: 'stopped' } }) !== 'pass')
    throw new Error('judge self-test: reserved stop');
  if (outcome(expected, { declared: { verdict: 'incomplete' }, unaided: { verdict: 'stopped' } }) !== 'short')
    throw new Error('judge self-test: short');
  return [...seen, 'a catalogued stop', 'an uncatalogued stop', 'an allowed approval', 'a reserved stop', 'a short positive'];
}

if (process.argv.includes('--self-test')) {
  const seen = selfTest();
  console.log(JSON.stringify({ judgeSelfTest: seen.length, cases: seen }));
}
export { selfTest };
