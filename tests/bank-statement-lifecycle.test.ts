import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import {
  exportBankStatement,
  replayBankStatement,
  restoreBankStatement,
  saveBankStatement,
} from '../lib/reconciliation/bank-statement-lifecycle.ts';
import {
  sameStatementData,
  snapshotBankStatementState,
  type BankStatementState,
  type StatementDecision,
} from '../lib/reconciliation/bank-statement-request.ts';

// bank-statement-lifecycle-1. The proof on all sixteen frozen statements,
// with every workbook checked independently, is
// scripts/bank-statement-g3-proof; here each rule is held directly.

const frozen = (name: string) =>
  readFile(
    new URL(
      `../audit/bank-statement-foundation/frozen/${name}`,
      import.meta.url,
    ),
  );
const source = async (name: string, bytes?: Buffer) => {
  const b = bytes ?? (await frozen(name));
  return {
    name,
    sha256: createHash('sha256').update(b).digest('hex'),
    original: Uint8Array.from(b).buffer,
  };
};
const NONE = { currency: null, period: null, confirmedClosing: null };
const PERIOD = { start: '2026-07-01', end: '2026-07-31' };
const pdf = async (id: string): Promise<BankStatementState> => ({
  version: 'bank-statement-lifecycle-1',
  files: [
    await source(`${id}-statement.pdf`),
    await source(`${id}-cashbook.csv`),
  ],
  scope: { ...NONE },
  decisions: [],
});
const refusal = (code: string) => (e: unknown) =>
  e instanceof Error && e.message === `BANK_STATEMENT_${code}`;
/** A decision on the first case matching the test, in the state's context. */
async function decided(
  state: BankStatementState,
  decisions: [
    type: StatementDecision['type'],
    pick: (c: { kind: string; reason: string }) => boolean,
  ][],
) {
  const { result } = await replayBankStatement(state);
  state.decisions = decisions.map(([type, pick], i) => {
    const c = result.cases.find(pick)!;
    return {
      id: `D${i + 1}`,
      type,
      context: result.context,
      at: `2026-10-21T09:00:0${i}.000Z`,
      case: c.id,
      statement: [...c.statement],
      cashbook: [...c.cashbook],
      note: 'Reviewed against the voucher',
    };
  });
  return result;
}

void test('a state is captured strictly, with its own copy of the bytes', async () => {
  const state = await pdf('BS04');
  const cases: [string, (s: Record<string, unknown>) => void][] = [
    ['INPUT', (s) => (s.reading = {})],
    ['INPUT', (s) => (s.decisions = Array(1))],
    [
      'SOURCE',
      (s) => ((s.files as { name: string }[])[0].name = 'statement.txt'),
    ],
    [
      'SOURCE',
      (s) => ((s.files as { name: string }[])[1].name = 'cashbook.pdf'),
    ],
    [
      'SOURCE',
      (s) => {
        const f = (s.files as { sha256: string }[])[0];
        f.sha256 = f.sha256.toUpperCase();
      },
    ],
    ['STATE_SCOPE', (s) => (s.scope = { ...NONE, extra: null })],
    ['STATE_SCOPE', (s) => (s.scope = { ...NONE, currency: 'XXX' })],
    [
      'STATE_SCOPE',
      (s) =>
        (s.scope = {
          ...NONE,
          period: { start: '2026-07-31', end: '2026-07-01' },
        }),
    ],
    ['STATE_SCOPE', (s) => (s.scope = { ...NONE, confirmedClosing: 1.5 })],
  ];
  const decision = {
    id: 'D1',
    type: 'reject',
    context: '[]',
    at: '2026-10-21T09:00:00.000Z',
    case: 'C1',
    statement: ['S1'],
    cashbook: ['V1'],
    note: 'Seen',
  };
  for (const change of [
    { extra: 1 },
    { type: 'approve' },
    { at: '2026-10-21T09:00:00Z' },
    { note: '' },
    { note: 'Seen‏' },
    { statement: ['S1', 'S1 '] },
  ])
    cases.push([
      'DECISION',
      (s) => (s.decisions = [{ ...decision, ...change }]),
    ]);
  for (const [code, change] of cases) {
    const s = structuredClone(state) as unknown as Record<string, unknown>;
    change(s);
    assert.throws(() => snapshotBankStatementState(s), refusal(code), code);
  }
  const copy = snapshotBankStatementState(state);
  new Uint8Array(state.files[0].original)[0] ^= 1;
  assert.notEqual(
    new Uint8Array(copy.files[0].original)[0],
    new Uint8Array(state.files[0].original)[0],
  );
});

void test('a PDF prints its own scope; a table needs a currency, and a confirmation only when it prints no closing', async () => {
  for (const scope of [
    { ...NONE, period: PERIOD },
    { ...NONE, confirmedClosing: 1 },
    { ...NONE, currency: 'SAR' },
  ])
    await assert.rejects(
      replayBankStatement({ ...(await pdf('BS04')), scope }),
      refusal('STATE_SCOPE'),
    );
  const table = async (scope: BankStatementState['scope'], text?: string) => ({
    version: 'bank-statement-lifecycle-1' as const,
    files: [
      await source(
        'BS01-statement.csv',
        text === undefined ? undefined : Buffer.from(text),
      ),
      await source('BS01-cashbook.csv'),
    ] as BankStatementState['files'],
    scope,
    decisions: [],
  });
  await assert.rejects(
    replayBankStatement(await table(NONE)),
    refusal('STATE_SCOPE'),
  );
  const csv = (await frozen('BS01-statement.csv')).toString('utf8');
  const last = csv.trimEnd().split('\r\n').at(-1)!.split(',').at(-1)!;
  const closed = `${csv.trimEnd()}\r\n,,Closing balance,,,,${last}\r\n`;
  const own = Math.round(Number(last) * 100);
  await assert.rejects(
    replayBankStatement(
      await table(
        { currency: 'SAR', period: PERIOD, confirmedClosing: own },
        closed,
      ),
    ),
    refusal('STATE_SCOPE'),
  );
  const printed = await replayBankStatement(
    await table(
      { currency: 'SAR', period: PERIOD, confirmedClosing: null },
      closed,
    ),
  );
  assert.equal(printed.result.match.statement.completeness, 'printed');
  const undated = await replayBankStatement(
    await table({ currency: 'SAR', period: null, confirmedClosing: own }),
  );
  assert.equal(undated.result.status, 'held');
  assert.equal(undated.result.match.held?.reason, 'no statement period');
  const confirmed = await replayBankStatement(
    await table({ currency: 'SAR', period: PERIOD, confirmedClosing: own }),
  );
  assert.equal(
    confirmed.result.match.statement.completeness,
    'confirmed-closing',
  );
  assert.equal(confirmed.result.cases.length, 10);
});

void test('both fingerprints are checked against the bytes', async () => {
  for (const side of [0, 1]) {
    const state = await pdf('BS04');
    state.files[side].sha256 = '0'.repeat(64);
    await assert.rejects(replayBankStatement(state), refusal('SOURCE_HASH'));
  }
});

void test('only a one-to-one review case whose values agree may be accepted', async () => {
  const bs04 = await pdf('BS04');
  await decided(bs04, [['accept', (c) => c.kind === 'review']]);
  const { result } = await replayBankStatement(bs04);
  assert.equal(result.status, 'reviewed');
  const accepted = result.cases.find((c) => c.decision === 'D1')!;
  assert.deepEqual(
    [accepted.reason, accepted.status],
    ['amount-date-suggestion', 'matched-accepted'],
  );
  for (const [id, pick] of [
    ['BS05', (c: { kind: string }) => c.kind === 'review'],
    ['BS06', (c: { kind: string }) => c.kind === 'review'],
    ['BS07', (c: { kind: string }) => c.kind === 'review'],
    ['BS04', (c: { kind: string }) => c.kind === 'automatic'],
  ] as const) {
    const state = await pdf(id);
    await decided(state, [['accept', pick]]);
    await assert.rejects(replayBankStatement(state), refusal('INELIGIBLE'), id);
  }
  const twice = await pdf('BS04');
  await decided(twice, [
    ['accept', (c) => c.kind === 'review'],
    ['accept', (c) => c.kind === 'review'],
  ]);
  await assert.rejects(replayBankStatement(twice), refusal('INELIGIBLE'));
});

void test('any undecided case may be rejected and a decision undone; outstanding items name their origin', async () => {
  const state = await pdf('BS02');
  const auto = (c: { kind: string }) => c.kind === 'automatic';
  const before = await decided(state, [['reject', auto]]);
  const { result } = await replayBankStatement(state);
  const c = result.cases.find((x) => x.decision === 'D1')!;
  assert.equal(c.status, 'rejected');
  assert.deepEqual(result.outstanding, [
    { side: 'statement', id: c.statement[0], origin: c.id },
    { side: 'cashbook', id: c.cashbook[0], origin: c.id },
  ]);
  await decided(state, [
    ['reject', auto],
    ['undo', auto],
  ]);
  assert.deepEqual(
    (await replayBankStatement(state)).result.cases,
    before.cases,
  );
  for (const [code, steps] of [
    [
      'INELIGIBLE',
      [
        ['reject', auto],
        ['reject', auto],
      ],
    ],
    ['UNDO', [['undo', auto]]],
    [
      'UNDO',
      [
        ['reject', auto],
        ['undo', auto],
        ['undo', auto],
      ],
    ],
  ] as const) {
    const s = await pdf('BS02');
    await decided(s, steps as never);
    await assert.rejects(replayBankStatement(s), refusal(code), code);
  }
});

void test('a decision is bound to its context and its exact members', async () => {
  const state = await pdf('BS07');
  await decided(state, [['reject', (c) => c.kind === 'review']]);
  const d = state.decisions[0];
  assert.equal(d.statement.length, 2);
  const changes: [string, Partial<StatementDecision>][] = [
    ['DECISION', { context: d.context.replace('"SAR"', '"USD"') }],
    ['MEMBERS', { case: 'C999' }],
    ['MEMBERS', { statement: [...d.statement].reverse() }],
    ['MEMBERS', { statement: d.statement.slice(1) }],
    ['MEMBERS', { cashbook: [...d.cashbook, 'PV-OTHER'] }],
  ];
  for (const [code, change] of changes) {
    const s = structuredClone(state);
    s.decisions = [{ ...d, ...change }];
    await assert.rejects(replayBankStatement(s), refusal(code), code);
  }
  const repeated = structuredClone(state);
  repeated.decisions.push({ ...d, type: 'undo' });
  await assert.rejects(replayBankStatement(repeated), refusal('DECISION'));
  // Another file means another context, though the case ids are the same.
  const other = structuredClone(state);
  const text = (await frozen('BS07-cashbook.csv'))
    .toString('utf8')
    .replace('Supplier payment by cheque', 'Supplier payment by cheque.');
  other.files[1] = await source('BS07-cashbook.csv', Buffer.from(text));
  assert.deepEqual(
    (await replayBankStatement({ ...other, decisions: [] })).result.cases.map(
      (c) => [c.id, c.statement, c.cashbook],
    ),
    (await replayBankStatement({ ...state, decisions: [] })).result.cases.map(
      (c) => [c.id, c.statement, c.cashbook],
    ),
  );
  await assert.rejects(replayBankStatement(other), refusal('DECISION'));
});

void test('a held statement takes no decisions', async () => {
  const state = await pdf('BS09');
  const { result } = await replayBankStatement(state);
  assert.equal(result.status, 'held');
  assert.deepEqual([result.cases, result.outstanding], [[], []]);
  state.decisions = [
    {
      id: 'D1',
      type: 'reject',
      context: result.context,
      at: '2026-10-21T09:00:00.000Z',
      case: 'C1',
      statement: ['S1'],
      cashbook: [],
      note: 'Seen',
    },
  ];
  await assert.rejects(replayBankStatement(state), refusal('HELD'));
});

void test('a saved session restores to the same replay; a tampered one is refused', async () => {
  const state = await pdf('BS04');
  await decided(state, [['accept', (c) => c.kind === 'review']]);
  // A valid state saves, and its session carries the decisions as taken.
  let session = new ArrayBuffer(0);
  await assert.doesNotReject(async () => {
    session = await saveBankStatement(state);
  });
  assert.deepEqual(
    JSON.parse(new TextDecoder().decode(session)).decisions,
    state.decisions,
  );
  assert.ok(
    sameStatementData(
      await restoreBankStatement(session),
      await replayBankStatement(state),
    ),
  );
  const parsed = JSON.parse(new TextDecoder().decode(session));
  const tampered = (change: (s: typeof parsed) => void) => {
    const s = structuredClone(parsed);
    change(s);
    return restoreBankStatement(
      new TextEncoder().encode(JSON.stringify(s)).buffer,
    );
  };
  await assert.rejects(
    restoreBankStatement(new TextEncoder().encode('{').buffer),
    refusal('SESSION'),
  );
  await assert.rejects(
    tampered((s) => (s.result = {})),
    refusal('SESSION'),
  );
  await assert.rejects(
    tampered((s) => (s.files[1].data = `${s.files[1].data} `)),
    refusal('SESSION'),
  );
  await assert.rejects(
    tampered((s) => {
      const b = Buffer.from(s.files[1].data, 'base64');
      b[b.length - 3] ^= 1;
      s.files[1].data = b.toString('base64');
    }),
    refusal('SOURCE_HASH'),
  );
  await assert.rejects(
    tampered((s) => (s.decisions[0].type = 'undo')),
    refusal('UNDO'),
  );
});

void test('the workbook refuses a stale result, cites every member and carries both originals', async () => {
  const state = await pdf('BS12');
  await decided(state, [['reject', (c) => c.kind === 'review']]);
  const { result } = await replayBankStatement(state);
  const stale = structuredClone(result);
  stale.outstanding.pop();
  await assert.rejects(
    exportBankStatement(state, stale),
    refusal('STALE_RESULT'),
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exportBankStatement(state, result));
  assert.deepEqual(
    book.worksheets.map((s) => s.name),
    [
      'Summary',
      'Statement lines',
      'Pages',
      'Cashbook',
      'Cases',
      'Case members',
      'Outstanding',
      'Timing',
      'Decisions',
      'Decision members',
      'Sources',
    ],
  );
  const rows = (name: string) =>
    (book.getWorksheet(name)!.getSheetValues() as unknown[][])
      .slice(2)
      .map((r) => r.slice(1));
  const lines = new Map(rows('Statement lines').map((r) => [r[4], r]));
  for (const [, side, id, page, items] of rows('Outstanding')) {
    if (side !== 'statement') continue;
    const line = lines.get(id)!;
    assert.deepEqual([page, items], [line[2], line[3]], String(id));
  }
  assert.equal(rows('Outstanding').length, 2);
  const sources = rows('Sources');
  for (const [i, f] of state.files.entries()) {
    const data = sources
      .filter((r) => r[0] === (i ? 'cashbook' : 'statement'))
      .map((r) => r[4])
      .join('');
    assert.ok(
      Buffer.from(data, 'base64').equals(Buffer.from(f.original)),
      f.name,
    );
  }
});
