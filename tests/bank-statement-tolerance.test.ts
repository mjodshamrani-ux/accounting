import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import {
  exportBankStatement,
  exportSheetStatement,
  replayBankStatement,
  replayRolledStatement,
  replaySheetStatement,
  replayVerified,
  restoreAnyStatement,
  restoreBankStatement,
  restoreRolledStatement,
  restoreSheetStatement,
  saveBankStatement,
  saveRolledStatement,
  saveSheetStatement,
  statementSessionParts,
  type BankStatementResult,
} from '../lib/reconciliation/bank-statement-lifecycle.ts';
import {
  snapshotBankStatementState,
  type BankStatementState,
  type StatementDecision,
} from '../lib/reconciliation/bank-statement-request.ts';
import {
  tolerancePolicy,
  TOLERANCE_RULES,
  type TolerancePolicy,
} from '../lib/reconciliation/bank-statement-tolerance.ts';

// bank-tolerance-1 (proposed): the policy, the pairs it tolerates, the
// decisions bound to it and the sheet's section. The proof against the
// independent oracle on the 23 sealed stories is scripts/bank-tolerance-proof;
// here each rule is held directly, with its near case, on synthetic table
// statements and on sealed PDFs.

const sha = (b: ArrayBuffer | Buffer) =>
  createHash('sha256').update(new Uint8Array(b)).digest('hex');
const bytes = (text: string) => new TextEncoder().encode(text).buffer;
const source = (name: string, original: ArrayBuffer) => ({
  name,
  sha256: sha(original),
  original,
});
const POLICY: TolerancePolicy = {
  perItem: 1,
  perPeriod: 5,
  note: 'Rounding by the payment system',
};
const refusal = (code: string) => (e: unknown) =>
  e instanceof Error && e.message === `BANK_STATEMENT_${code}`;

type Line = {
  date: string;
  reference: string;
  direction: 'in' | 'out';
  /** Minor units. */
  amount: number;
};
type Entry = Line & { voucher: string };
const PERIOD = { start: '2026-12-01', end: '2026-12-31' };
const DECIMALS: Record<string, number> = { SAR: 2, KWD: 3, JPY: 0 };
const money = (minor: number, decimals: number) => {
  const sign = minor < 0 ? '-' : '';
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  return decimals
    ? `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
    : `${sign}${digits}`;
};
/** A table statement with a printed closing balance, and its cashbook. */
function table(
  currency: string,
  lines: Line[],
  entries: Entry[],
  { closing = true } = {},
): BankStatementState {
  const d = DECIMALS[currency];
  let balance = 50_000_000;
  const rows = [
    'Date,Value Date,Description,Reference,Withdrawal,Deposit,Balance',
    `,,Opening balance,,,,${money(balance, d)}`,
  ];
  for (const l of lines) {
    balance += l.direction === 'in' ? l.amount : -l.amount;
    const [w, dep] =
      l.direction === 'out'
        ? [money(l.amount, d), '']
        : ['', money(l.amount, d)];
    rows.push(
      `${l.date},${l.date},Transfer,${l.reference},${w},${dep},${money(balance, d)}`,
    );
  }
  if (closing) rows.push(`,,Closing balance,,,,${money(balance, d)}`);
  const book = [
    'Date,Voucher,Description,Reference,Receipts,Payments',
    ...entries.map(
      (e) =>
        `${e.date},${e.voucher},Transfer,${e.reference},${e.direction === 'in' ? money(e.amount, d) : ''},${e.direction === 'out' ? money(e.amount, d) : ''}`,
    ),
  ];
  return {
    version: 'bank-statement-lifecycle-1',
    files: [
      source('statement.csv', bytes(`${rows.join('\r\n')}\r\n`)),
      source('cashbook.csv', bytes(`${book.join('\r\n')}\r\n`)),
    ],
    scope: {
      currency,
      period: PERIOD,
      confirmedClosing: closing ? null : balance,
    },
    decisions: [],
  };
}
const line = (
  reference: string,
  amount: number,
  direction: 'in' | 'out' = 'out',
  date = '2026-12-10',
): Line => ({ date, reference, direction, amount });
const entry = (
  voucher: string,
  reference: string,
  amount: number,
  direction: 'in' | 'out' = 'out',
  date = '2026-12-10',
): Entry => ({ voucher, date, reference, direction, amount });
const withPolicy = (
  state: BankStatementState,
  tolerance: unknown = POLICY,
): BankStatementState => ({ ...state, tolerance }) as BankStatementState;
const shape = (r: BankStatementResult) =>
  r.cases.map((c) => [
    c.id,
    c.kind,
    c.reason,
    c.status,
    c.statement,
    c.cashbook,
  ]);
/** A decision on the case holding these members, in the result's context. */
const decision = (
  result: BankStatementResult,
  id: string,
  type: StatementDecision['type'],
  statement: string,
): StatementDecision => {
  const c = result.cases.find((x) => x.statement.includes(statement))!;
  return {
    id,
    type,
    context: result.context,
    at: '2026-12-31T09:00:00.000Z',
    case: c.id,
    statement: [...c.statement],
    cashbook: [...c.cashbook],
    note: 'Checked against the payment file',
  };
};

void test('the policy is checked against the statement currency, by the first rule it breaks', () => {
  assert.deepEqual(TOLERANCE_RULES, [
    'CURRENCY',
    'PER_ITEM',
    'PER_PERIOD',
    'NOTE',
  ]);
  const rule = (declared: Record<string, unknown>, currency = 'SAR') => {
    try {
      tolerancePolicy({ ...POLICY, ...declared } as never, currency);
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  };
  const refused = (r: string) => `BANK_STATEMENT_TOLERANCE: ${r}`;
  assert.equal(rule({}), null);
  assert.deepEqual(tolerancePolicy({ ...POLICY }, 'SAR'), POLICY);
  // A currency without a minor unit has no tolerance, whatever else is wrong.
  assert.equal(rule({}, 'JPY'), refused('CURRENCY'));
  assert.equal(rule({ perItem: 0, note: '' }, 'JPY'), refused('CURRENCY'));
  // perItem: an integer from 1 to one major unit, exclusive.
  for (const perItem of [0, -1, 100, 1.5, '1', null, true, Number.NaN])
    assert.equal(
      rule({ perItem, perPeriod: 500 }),
      refused('PER_ITEM'),
      String(perItem),
    );
  assert.equal(rule({ perItem: 99, perPeriod: 99 }), null);
  assert.equal(rule({ perItem: 999, perPeriod: 999 }, 'KWD'), null);
  assert.equal(
    rule({ perItem: 1000, perPeriod: 1000 }, 'KWD'),
    refused('PER_ITEM'),
  );
  // perPeriod: from perItem to one hundred major units, exclusive.
  for (const perPeriod of [2, 10_000, 2.5, '5', null])
    assert.equal(
      rule({ perItem: 3, perPeriod }),
      refused('PER_PERIOD'),
      String(perPeriod),
    );
  assert.equal(rule({ perItem: 3, perPeriod: 3 }), null);
  assert.equal(rule({ perItem: 3, perPeriod: 9_999 }), null);
  assert.equal(rule({ perPeriod: 99_999 }, 'KWD'), null);
  assert.equal(rule({ perPeriod: 100_000 }, 'KWD'), refused('PER_PERIOD'));
  // The note: one line of visible text.
  for (const note of [
    '',
    '   ',
    'two\nlines',
    'a\rb',
    'tab\there',
    'mark\u200f',
    'x'.repeat(201),
    5,
    null,
  ])
    assert.equal(rule({ note }), refused('NOTE'), JSON.stringify(note));
  assert.equal(rule({ note: 'فروق التقريب' }), null);
  assert.equal(rule({ note: ' padded ' }), null);
  assert.equal(rule({ note: 'x'.repeat(200) }), null);
  // The order: a broken perItem is named before a broken period or note.
  assert.equal(
    rule({ perItem: 0, perPeriod: 0, note: '' }),
    refused('PER_ITEM'),
  );
  assert.equal(rule({ perPeriod: 0, note: '' }), refused('PER_PERIOD'));
});

void test('a declared tolerance is captured by its form alone, and absent when not declared', () => {
  const state = table('SAR', [line('R1', 100)], [entry('PV-1', 'R1', 100)]);
  assert.equal('tolerance' in snapshotBankStatementState(state), false);
  const declared = { ...POLICY };
  const captured = snapshotBankStatementState(withPolicy(state, declared));
  declared.perItem = 50;
  assert.deepEqual(captured.tolerance, POLICY);
  // Values the rules refuse are kept for the replay to name.
  assert.deepEqual(
    snapshotBankStatementState(
      withPolicy(state, { perItem: '1', perPeriod: null, note: false }),
    ).tolerance,
    { perItem: '1', perPeriod: null, note: false },
  );
  for (const tolerance of [
    undefined,
    null,
    'policy',
    [],
    { perItem: 1, perPeriod: 5 },
    { ...POLICY, scope: 'all' },
    { ...POLICY, perItem: { value: 1 } },
    { ...POLICY, note: ['a'] },
  ])
    assert.throws(
      () => snapshotBankStatementState({ ...state, tolerance }),
      refusal('INPUT'),
      JSON.stringify(tolerance),
    );
});

void test('a difference within perItem under one reference is tolerated, numbered as without the policy, with both amounts', async () => {
  const state = table(
    'SAR',
    [line('R1', 100_000), line('R2', 50_001, 'in'), line('R3', 70_000)],
    [
      entry('PV-1', 'R1', 100_000),
      entry('RV-2', 'R2', 50_000, 'in'),
      entry('PV-3', 'R3', 70_001, 'out', '2026-12-13'),
    ],
  );
  const plain = (await replayBankStatement(state)).result;
  const { result } = await replayBankStatement(withPolicy(state));
  assert.deepEqual(
    shape(plain).map(([id, kind, reason, status]) => [
      id,
      kind,
      reason,
      status,
    ]),
    [
      ['C1', 'automatic', 'reference', 'matched-automatic'],
      ['C2', 'review', 'amount-difference', 'needs-review'],
      ['C3', 'review', 'amount-difference', 'needs-review'],
    ],
  );
  assert.deepEqual(shape(result), [
    ['C1', 'automatic', 'reference', 'matched-automatic', ['S1'], ['PV-1']],
    [
      'C2',
      'tolerated',
      'within-tolerance',
      'matched-tolerated',
      ['S2'],
      ['RV-2'],
    ],
    [
      'C3',
      'tolerated',
      'within-tolerance',
      'matched-tolerated',
      ['S3'],
      ['PV-3'],
    ],
  ]);
  assert.deepEqual(result.cases[1].amounts, {
    statement: 50_001,
    cashbook: 50_000,
    difference: 1,
  });
  assert.deepEqual(result.cases[2].amounts, {
    statement: 70_000,
    cashbook: 70_001,
    difference: -1,
  });
  assert.equal(result.cases[1].reference, 'R2');
  assert.equal(result.status, 'reviewed');
  assert.deepEqual(result.outstanding, []);
  // The amounts the matching read are unchanged.
  assert.deepEqual(result.match, plain.match);
  assert.deepEqual(result.tolerance, {
    family: 'bank-tolerance-1',
    policy: POLICY,
    eligible: [
      {
        case: 'C2',
        statement: 'S2',
        cashbook: 'RV-2',
        amounts: { statement: 50_001, cashbook: 50_000, difference: 1 },
      },
      {
        case: 'C3',
        statement: 'S3',
        cashbook: 'PV-3',
        amounts: { statement: 70_000, cashbook: 70_001, difference: -1 },
      },
    ],
    sum: 2,
    exceeded: false,
  });
  // A period without a policy keeps its context; with one, the policy joins it.
  assert.equal(plain.tolerance, undefined);
  assert.deepEqual(JSON.parse(result.context), [
    ...JSON.parse(plain.context),
    { tolerance: POLICY },
  ]);
});

void test('the policy never makes, chooses or widens a pair', async () => {
  const state = table(
    'SAR',
    [
      line('R1', 100_002), // two halalas: over perItem
      line('', 30_001), // no reference: no pair by near amount
      line('R3', 40_001, 'in'), // the cashbook pays it: a direction conflict
      line('R4', 20_001), // two entries cite it: a duplicate reference
      line('R5', 10_001, 'out', '2026-12-02'), // beyond the window
      line('', 60_000), // an amount and date suggestion: never cleared
    ],
    [
      entry('PV-1', 'R1', 100_000),
      entry('PV-2', '', 30_000),
      entry('PV-3', 'R3', 40_000, 'out'),
      entry('PV-4a', 'R4', 20_000),
      entry('PV-4b', 'R4', 20_000),
      entry('PV-5', 'R5', 10_000, 'out', '2026-12-06'),
      entry('PV-6', '', 60_000),
    ],
  );
  const plain = (await replayBankStatement(state)).result;
  const { result } = await replayBankStatement(
    withPolicy(state, { ...POLICY, perItem: 1, perPeriod: 9_999 }),
  );
  assert.deepEqual(shape(result), shape(plain));
  assert.deepEqual(
    plain.cases.map((c) => c.reason),
    [
      'amount-difference',
      'direction-conflict',
      'duplicate-reference',
      'amount-difference',
      'amount-date-suggestion',
    ],
  );
  assert.equal(result.cases[4].status, 'needs-review');
  assert.deepEqual(result.tolerance!.eligible, []);
  assert.deepEqual(result.outstanding, plain.outstanding);
  assert.equal(
    result.cases.some((c) => c.kind === 'tolerated'),
    false,
  );
  // At three days apart it is within the window, and tolerated.
  const near = table(
    'SAR',
    [line('R5', 10_001, 'out', '2026-12-03')],
    [entry('PV-5', 'R5', 10_000, 'out', '2026-12-06')],
  );
  assert.equal(
    (await replayBankStatement(withPolicy(near))).result.cases[0].kind,
    'tolerated',
  );
});

void test('the eligible differences are tolerated all together or not at all, never netted', async () => {
  const lines = [
    line('R1', 10_001),
    line('R2', 20_000, 'in'),
    line('R3', 30_001),
  ];
  const entries = [
    entry('PV-1', 'R1', 10_000),
    entry('RV-2', 'R2', 20_001, 'in'),
    entry('PV-3', 'R3', 30_000),
  ];
  const state = table('SAR', lines, entries);
  const at = async (perPeriod: number) =>
    (await replayBankStatement(withPolicy(state, { ...POLICY, perPeriod })))
      .result;
  const over = await at(2);
  assert.equal(over.tolerance!.sum, 3);
  assert.equal(over.tolerance!.exceeded, true);
  assert.equal(over.tolerance!.eligible.length, 3);
  assert.deepEqual(
    over.cases.map((c) => [c.kind, c.reason, c.status]),
    Array(3).fill(['review', 'amount-difference', 'needs-review']),
  );
  const within = await at(3);
  assert.equal(within.tolerance!.exceeded, false);
  assert.deepEqual(
    within.cases.map((c) => c.status),
    Array(3).fill('matched-tolerated'),
  );
  // +1 and -1 net to zero but add up to two.
  const opposite = table(
    'SAR',
    [line('R1', 10_001), line('R2', 20_000)],
    [entry('PV-1', 'R1', 10_000), entry('PV-2', 'R2', 20_001)],
  );
  const netted = (
    await replayBankStatement(withPolicy(opposite, { ...POLICY, perPeriod: 1 }))
  ).result;
  assert.equal(netted.tolerance!.sum, 2);
  assert.equal(
    netted.cases.some((c) => c.kind === 'tolerated'),
    false,
  );
});

void test('a tolerated case may be rejected and the rejection undone, never accepted', async () => {
  const state = withPolicy(
    table(
      'SAR',
      [line('R1', 10_001), line('R2', 500)],
      [entry('PV-1', 'R1', 10_000), entry('PV-2', 'R2', 500)],
    ),
  );
  const { result } = await replayBankStatement(state);
  const tolerated = result.cases.find((c) => c.kind === 'tolerated')!;
  assert.equal(tolerated.id, 'C2');
  await assert.rejects(
    replayBankStatement({
      ...state,
      decisions: [decision(result, 'D1', 'accept', 'S1')],
    }),
    refusal('INELIGIBLE'),
  );
  const reject = decision(result, 'D1', 'reject', 'S1');
  const rejected = (
    await replayBankStatement({ ...state, decisions: [reject] })
  ).result;
  assert.equal(rejected.cases[1].status, 'rejected');
  assert.equal(rejected.cases[1].kind, 'tolerated');
  assert.deepEqual(rejected.outstanding, [
    { side: 'statement', id: 'S1', origin: 'C2' },
    { side: 'cashbook', id: 'PV-1', origin: 'C2' },
  ]);
  const undone = (
    await replayBankStatement({
      ...state,
      decisions: [reject, decision(rejected, 'D2', 'undo', 'S1')],
    })
  ).result;
  assert.equal(undone.cases[1].status, 'matched-tolerated');
  assert.equal(undone.cases[1].decision, null);
  assert.deepEqual(undone.outstanding, []);
});

void test('every decision is bound to the policy it was taken under', async () => {
  const state = table(
    'SAR',
    [line('R1', 10_001), line('R2', 500)],
    [entry('PV-1', 'R1', 10_000), entry('PV-2', 'R2', 500)],
  );
  const without = (await replayBankStatement(state)).result;
  // A decision taken with no policy is refused once one is declared.
  const onAutomatic = decision(without, 'D1', 'reject', 'S2');
  await replayBankStatement({ ...state, decisions: [onAutomatic] });
  await assert.rejects(
    replayBankStatement(withPolicy({ ...state, decisions: [onAutomatic] })),
    refusal('DECISION'),
  );
  // A decision taken under one policy is refused under another, and stands under the same.
  const under = (await replayBankStatement(withPolicy(state))).result;
  const taken = decision(under, 'D1', 'reject', 'S2');
  await replayBankStatement(withPolicy({ ...state, decisions: [taken] }));
  for (const other of [
    { ...POLICY, perItem: 2 },
    { ...POLICY, perPeriod: 6 },
    { ...POLICY, note: 'Another reason' },
  ])
    await assert.rejects(
      replayBankStatement(withPolicy({ ...state, decisions: [taken] }, other)),
      refusal('DECISION'),
      JSON.stringify(other),
    );
  await assert.rejects(
    replayBankStatement({ ...state, decisions: [taken] }),
    refusal('DECISION'),
  );
});

void test('nothing is settled under a policy the currency refuses, read or cached', async () => {
  const yen = table('JPY', [line('R1', 1001)], [entry('PV-1', 'R1', 1000)]);
  assert.equal(
    (await replayBankStatement(yen)).result.cases[0].reason,
    'amount-difference',
  );
  await assert.rejects(
    replayBankStatement(withPolicy(yen)),
    refusal('TOLERANCE: CURRENCY'),
  );
  const fils = table(
    'KWD',
    [line('R1', 10_001), line('R2', 20_000, 'in')],
    [entry('PV-1', 'R1', 10_000), entry('RV-2', 'R2', 20_010, 'in')],
  );
  const kwd = (
    await replayBankStatement(
      withPolicy(fils, { ...POLICY, perItem: 1, perPeriod: 10 }),
    )
  ).result;
  assert.deepEqual(
    kwd.cases.map((c) => c.status),
    ['matched-tolerated', 'needs-review'],
  );
  await assert.rejects(
    replayBankStatement(
      withPolicy(fils, { ...POLICY, perItem: 1000, perPeriod: 1000 }),
    ),
    refusal('TOLERANCE: PER_ITEM'),
  );
  // The thread's verified reading of the same originals does not skip the check.
  const state = table(
    'SAR',
    [line('R1', 10_001)],
    [entry('PV-1', 'R1', 10_000)],
  );
  assert.equal(
    (await replayVerified(withPolicy(state))).result.cases[0].kind,
    'tolerated',
  );
  await assert.rejects(
    replayVerified(withPolicy(state, { ...POLICY, note: ' ' })),
    refusal('TOLERANCE: NOTE'),
  );
  assert.equal((await replayVerified(state)).result.cases[0].kind, 'review');
  // A held statement has nothing to tolerate, but its policy is still checked.
  const held = table(
    'SAR',
    [line('R1', 10_001)],
    [entry('PV-1', 'R1', 10_000)],
    { closing: false },
  );
  held.scope = { ...held.scope, confirmedClosing: null };
  const h = (await replayBankStatement(withPolicy(held))).result;
  assert.equal(h.status, 'held');
  assert.deepEqual(h.tolerance!.eligible, []);
  await assert.rejects(
    replayBankStatement(withPolicy(held, { ...POLICY, perPeriod: 0 })),
    refusal('TOLERANCE: PER_PERIOD'),
  );
});

const tol = (name: string) =>
  readFile(
    new URL(
      `../audit/bank-tolerance-foundation/frozen/${name}`,
      import.meta.url,
    ),
  );
/** A sealed story's period with its closing sheet. */
const sheetOf = async (
  id: string,
  tolerance: unknown,
  decisions: StatementDecision[] = [],
) => {
  const statement = Uint8Array.from(
    await tol(`${id}-DEC-statement.pdf`),
  ).buffer;
  const cashbook = Uint8Array.from(await tol(`${id}-DEC-cashbook.csv`)).buffer;
  const facts = JSON.parse((await tol('stories.json')).toString('utf8'));
  const story = facts.stories.find((s: { id: string }) => s.id === id);
  return replaySheetStatement({
    version: 'bank-reconciliation-sheet-1',
    files: [
      source(`${id}-statement.pdf`, statement),
      source(`${id}-cashbook.csv`, cashbook),
    ],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions,
    previous: null,
    sheet: { book: story.book, language: 'en', prepared: null, reviewed: null },
    ...(tolerance ? { tolerance } : {}),
  });
};
const sheet = (r: BankStatementResult) => {
  const o = r.sheet!.outcome;
  assert.equal(o.refusal, null);
  return o.refusal === null ? o.sheet : assert.fail();
};

void test('the sheet lists each tolerated difference by its effect, and what no tolerance explains', async () => {
  const facts = JSON.parse((await tol('stories.json')).toString('utf8'));
  assert.ok(
    facts.stories.some(
      (s: { periods: { id: string }[] }) => s.periods[0].id === 'T01-DEC',
    ),
  );
  // T23: one halala tolerated, 50.00 of the book balance unexplained.
  const t23 = sheet((await sheetOf('T23', POLICY)).result);
  assert.equal(t23.status, 'difference');
  assert.equal(t23.difference, t23.tolerated! + t23.unexplained!);
  assert.equal(Math.abs(t23.unexplained!), 5000);
  assert.equal(t23.toleratedDifferences!.length, 1);
  // T19: three tolerated differences whose effects net to zero stay listed.
  const t19 = sheet(
    (await sheetOf('T19', { perItem: 3, perPeriod: 6, note: 'فروق التقريب' }))
      .result,
  );
  assert.equal(t19.status, 'reconciled-within-tolerance');
  assert.equal(t19.toleratedDifferences!.length, 3);
  assert.equal(t19.tolerated, 0);
  for (const d of t19.toleratedDifferences!)
    assert.equal(
      d.effect,
      d.direction === 'in'
        ? d.amounts.statement - d.amounts.cashbook
        : d.amounts.cashbook - d.amounts.statement,
    );
  assert.ok(
    new Set(t19.toleratedDifferences!.map((d) => d.direction)).size === 2,
  );
});

void test('without a policy the sheet keeps its form; with one that tolerates nothing it only adds the section', async () => {
  const without = sheet((await sheetOf('T22', null)).result);
  const none = sheet((await sheetOf('T22', POLICY)).result);
  for (const key of [
    'tolerance',
    'toleratedDifferences',
    'tolerated',
    'unexplained',
  ])
    assert.equal(key in without, false, key);
  const { tolerance, toleratedDifferences, tolerated, unexplained, ...rest } =
    none;
  assert.deepEqual(rest, without);
  assert.deepEqual(tolerance, POLICY);
  assert.deepEqual(
    [toleratedDifferences, tolerated, unexplained],
    [[], 0, none.difference],
  );
  assert.equal(none.status, 'reconciled');
});

void test('a rejected tolerated case clears nothing and leaves the section', async () => {
  const first = await sheetOf('T13', POLICY);
  const before = sheet(first.result);
  assert.equal(before.status, 'reconciled-within-tolerance');
  const reject = decision(first.result, 'D1', 'reject', 'S2');
  const after = sheet((await sheetOf('T13', POLICY, [reject])).result);
  assert.deepEqual(after.toleratedDifferences, []);
  const listed = Object.values(after.sections).flatMap((s) => s.items);
  assert.deepEqual(
    listed.filter((i) => i.origin === 'rejected').map((i) => [i.side, i.id]),
    [
      ['cashbook', 'PV-T13-01'],
      ['statement', 'S2'],
    ],
  );
  // Both members are listed alone, so the halala is in the sections, not
  // tolerated.
  assert.equal(after.tolerated, 0);
  assert.equal(after.difference, before.difference - before.tolerated!);
  assert.equal(after.status, 'reconciled');
});

const roll = (name: string) =>
  readFile(
    new URL(`../audit/bank-roll-foundation/frozen/${name}`, import.meta.url),
  );

void test('in a period that carries, a carried case is never tolerated and the policy joins the context', async () => {
  const buffer = (b: Buffer) => Uint8Array.from(b).buffer;
  const previous = buffer(await roll('R10-previous-session.json'));
  const state = {
    version: 'bank-statement-roll-1' as const,
    files: [
      source(
        'R10-AUG-statement.pdf',
        buffer(await roll('R10-AUG-statement.pdf')),
      ),
      source(
        'R10-AUG-cashbook.csv',
        buffer(await roll('R10-AUG-cashbook.csv')),
      ),
    ],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions: [],
    previous: {
      name: 'previous-session.json',
      sha256: sha(previous),
      original: previous,
    },
  };
  const plain = (await replayRolledStatement(state)).result;
  const carried = plain.cases.find((c) => c.kind === 'carried')!;
  assert.equal(carried.reason, 'carried-amount-difference');
  const { result } = await replayRolledStatement({
    ...state,
    tolerance: { ...POLICY, perItem: 99, perPeriod: 9_999 },
  });
  assert.deepEqual(shape(result), shape(plain));
  assert.deepEqual(result.tolerance!.eligible, []);
  assert.deepEqual(JSON.parse(result.context).at(-1), {
    tolerance: { ...POLICY, perItem: 99, perPeriod: 9_999 },
  });
  assert.deepEqual(
    JSON.parse(result.context).slice(0, -1),
    JSON.parse(plain.context),
  );
});

const r10 = async () => {
  const buffer = (b: Buffer) => Uint8Array.from(b).buffer;
  const previous = buffer(await roll('R10-previous-session.json'));
  return {
    version: 'bank-statement-roll-1' as const,
    files: [
      source(
        'R10-AUG-statement.pdf',
        buffer(await roll('R10-AUG-statement.pdf')),
      ),
      source(
        'R10-AUG-cashbook.csv',
        buffer(await roll('R10-AUG-cashbook.csv')),
      ),
    ],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions: [],
    previous: {
      name: 'previous-session.json',
      sha256: sha(previous),
      original: previous,
    },
  };
};
const doc = (b: ArrayBuffer) => JSON.parse(new TextDecoder().decode(b));
/** What a save, restore or export gives; a refusal fails as an assertion. */
async function settled<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    return assert.fail(`refused: ${(error as Error).message}`);
  }
}
const encoded = (d: unknown) =>
  new TextEncoder().encode(JSON.stringify(d)).buffer;

void test('the policy is saved with the period in each session format, and absent without one', async () => {
  const plain = table(
    'SAR',
    [line('R1', 10_001)],
    [entry('PV-1', 'R1', 10_000)],
  );
  const saved = await settled(saveBankStatement(withPolicy(plain)));
  assert.deepEqual(doc(saved).tolerance, POLICY);
  const restored = await settled(restoreBankStatement(saved));
  assert.deepEqual(restored.state.tolerance, POLICY);
  assert.equal(restored.result.cases[0].status, 'matched-tolerated');
  assert.equal(
    'tolerance' in doc(await settled(saveBankStatement(plain))),
    false,
  );
  // The sheet format.
  const t01 = await sheetOf('T01', POLICY);
  const sheetSession = await settled(saveSheetStatement(t01.state));
  assert.deepEqual(doc(sheetSession).tolerance, POLICY);
  const back = await settled(restoreSheetStatement(sheetSession));
  assert.deepEqual(back.result, t01.result);
  assert.equal(
    'tolerance' in
      doc(
        await settled(saveSheetStatement((await sheetOf('T01', null)).state)),
      ),
    false,
  );
  // The roll format, and any format by its version.
  const policy = { ...POLICY, perItem: 99, perPeriod: 9_999 };
  const rolled = await settled(
    saveRolledStatement({
      ...(await r10()),
      tolerance: policy,
    }),
  );
  assert.deepEqual(doc(rolled).tolerance, policy);
  const again = await settled(restoreRolledStatement(rolled));
  assert.deepEqual(again.state.tolerance, policy);
  assert.deepEqual(
    (await settled(restoreAnyStatement(rolled))).result,
    again.result,
  );
  assert.deepEqual(statementSessionParts(rolled).state.tolerance, policy);
});

void test('a session whose policy was changed is refused, by its decisions or by the rule it breaks', async () => {
  const state = withPolicy(
    table(
      'SAR',
      [line('R1', 10_001), line('R2', 500)],
      [entry('PV-1', 'R1', 10_000), entry('PV-2', 'R2', 500)],
    ),
  );
  const { result } = await replayBankStatement(state);
  const saved = doc(
    await settled(
      saveBankStatement({
        ...state,
        decisions: [decision(result, 'D1', 'reject', 'S1')],
      }),
    ),
  );
  const changed = async (
    change: (
      d: Record<string, unknown> & { tolerance: Record<string, unknown> },
    ) => void,
  ) => {
    const d = structuredClone(saved);
    change(d);
    return restoreBankStatement(encoded(d));
  };
  await assert.rejects(
    changed((d) => (d.tolerance.perPeriod = 6)),
    refusal('DECISION'),
  );
  await assert.rejects(
    changed((d) => {
      delete (d as Record<string, unknown>).tolerance;
    }),
    refusal('DECISION'),
  );
  await assert.rejects(
    changed((d) => (d.tolerance.perItem = 100)),
    refusal('TOLERANCE: PER_ITEM'),
  );
  await assert.rejects(
    changed((d) => (d.tolerance.scope = 'all')),
    refusal('INPUT'),
  );
  await assert.rejects(
    changed((d) => (d.extra = 1)),
    refusal('SESSION'),
  );
  // Unchanged, it restores with its decision.
  assert.equal(
    (await settled(changed(() => undefined))).result.cases[1].status,
    'rejected',
  );
});

/** A workbook's sheets as rows of cell values. */
async function sheets(workbook: ArrayBuffer) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(workbook);
  const out = new Map<string, unknown[][]>();
  book.eachSheet((ws) => {
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      rows.push((row.values as unknown[]).slice(1));
    });
    out.set(ws.name, rows);
  });
  return out;
}

void test('the workbook names the policy and every eligible pair, tolerated or not', async () => {
  const lines = [line('R1', 10_001), line('R2', 20_000, 'in'), line('R3', 500)];
  const entries = [
    entry('PV-1', 'R1', 10_000),
    entry('RV-2', 'R2', 20_002, 'in'),
    entry('PV-3', 'R3', 500),
  ];
  const base = table('SAR', lines, entries);
  const at = async (tolerance: unknown) => {
    const state = tolerance ? withPolicy(base, tolerance) : base;
    const { result } = await replayBankStatement(state);
    return sheets(await settled(exportBankStatement(state, result)));
  };
  const within = await at({ ...POLICY, perItem: 2, perPeriod: 3 });
  assert.deepEqual(within.get('Tolerance'), [
    ['Property', 'Value'],
    ['Family', 'bank-tolerance-1'],
    ['Per item minor units', 2],
    ['Per period minor units', 3],
    ['Note', POLICY.note],
    ['Eligible pairs', 2],
    ['Sum of absolute differences minor units', 3],
    ['Outcome', 'tolerated'],
  ]);
  assert.deepEqual(within.get('Tolerance pairs')!.slice(1), [
    ['C2', 'S1', 'PV-1', 'out', 10_001, 10_000, 1, 'yes', 'matched-tolerated'],
    ['C3', 'S2', 'RV-2', 'in', 20_000, 20_002, -2, 'yes', 'matched-tolerated'],
  ]);
  const claim = (s: Map<string, unknown[][]>) =>
    s.get('Summary')!.find((r) => r[0] === 'Claim')![1] as string;
  assert.match(claim(within), /tolerance the accountant declared/u);
  const over = await at({ ...POLICY, perItem: 2, perPeriod: 2 });
  assert.deepEqual(over.get('Tolerance')!.slice(-2), [
    ['Sum of absolute differences minor units', 3],
    ['Outcome', 'exceeded'],
  ]);
  assert.deepEqual(
    over
      .get('Tolerance pairs')!
      .slice(1)
      .map((r) => r.slice(-2)),
    [
      ['no', 'needs-review'],
      ['no', 'needs-review'],
    ],
  );
  const none = await at(null);
  assert.equal(none.has('Tolerance'), false);
  assert.equal(none.has('Tolerance pairs'), false);
  assert.doesNotMatch(claim(none), /tolerance/iu);
});

void test('the reconciliation worksheet lists the policy, each tolerated difference and the unexplained rest', async () => {
  for (const language of ['en', 'ar'] as const) {
    const { state, result } = await sheetOf('T23', POLICY);
    const own = { ...state, sheet: { ...state.sheet, language } };
    const replay = await replaySheetStatement(own);
    const rows = [
      ...(
        await sheets(await settled(exportSheetStatement(own, replay.result)))
      ).values(),
    ][0];
    const by = (key: string) => rows.filter((r) => r[0] === key);
    const s = sheet(result);
    assert.deepEqual(by('status')[0][3], 'difference');
    assert.deepEqual(by('tolerance')[0].slice(2), [
      '0.01',
      1,
      '0.05',
      5,
      POLICY.note,
    ]);
    assert.deepEqual(by('tolerated')[0].slice(2), [
      (s.tolerated! / 100).toFixed(2),
      s.tolerated,
    ]);
    assert.equal(by('toleratedItem').length, 1);
    const [item] = by('toleratedItem');
    const d = s.toleratedDifferences![0];
    assert.deepEqual(item.slice(2, 5), [d.case, d.statement, d.cashbook]);
    assert.deepEqual(
      [item[6], item[8], item[10]],
      [d.amounts.statement, d.amounts.cashbook, d.effect],
    );
    assert.deepEqual(
      by('unexplained')[0].slice(2),
      ['50.00', 5000].map((v, i) =>
        i
          ? Math.sign(s.unexplained!) * 5000
          : `${s.unexplained! < 0 ? '-' : ''}${v}`,
      ),
    );
    assert.match(
      by('claim')[0][2] as string,
      language === 'ar' ? /السماحية/u : /tolerance/u,
    );
  }
  const { result } = await sheetOf('T22', null);
  const plain = [
    ...(
      await sheets(
        await settled(
          exportSheetStatement((await sheetOf('T22', null)).state, result),
        ),
      )
    ).values(),
  ][0];
  for (const key of [
    'tolerance',
    'toleratedHeaders',
    'tolerated',
    'toleratedItem',
    'unexplained',
  ])
    assert.equal(
      plain.some((r) => r[0] === key),
      false,
      key,
    );
});
