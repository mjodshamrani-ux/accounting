import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile as fsRead } from 'node:fs/promises';
import {
  replayBankStatement,
  replayRolledStatement,
  replayVerified,
  restoreBankStatement,
  saveBankStatement,
} from '../lib/reconciliation/bank-statement-lifecycle.ts';
import { snapshotAnyStatementState } from '../lib/reconciliation/bank-statement-request.ts';
import {
  chooseCashbookColumns,
  type CashbookColumns,
} from '../lib/reconciliation/bank-cashbook-map.ts';
import { readFile } from '../lib/reconciliation/io.ts';

// bank-cashbook-map-1, proposed: the columns a cashbook is read with travel
// with that file in the bank statement lifecycle. The proof on the sealed
// stories is scripts/bank-map-lifecycle; here each rule is held directly on
// one sealed period, R17's July, read from its declared twin and from its
// mapped copy M01-JUL-cashbook.xlsx.

const bytes = async (url: string) =>
  Uint8Array.from(await fsRead(new URL(url, import.meta.url))).buffer;
const sha = (b: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(b)).digest('hex');
const STATEMENT = '../audit/bank-roll-foundation/frozen/R17-JUL-statement.pdf';
const TWIN = '../audit/bank-roll-foundation/frozen/R17-JUL-cashbook.csv';
const MAPPED = '../audit/bank-map-foundation/frozen/M01-JUL-cashbook.xlsx';
const CHOICE = {
  header: 4,
  columns: {
    date: 2,
    voucher: 1,
    description: 5,
    reference: 4,
    receipts: 6,
    payments: 7,
  },
};

async function inputs() {
  const statement = await bytes(STATEMENT);
  const cashbook = await bytes(MAPPED);
  const chosen = chooseCashbookColumns(
    await readFile('M01-JUL-cashbook.xlsx', cashbook.slice(0)),
    CHOICE,
  );
  assert.ok('columns' in chosen);
  return { statement, cashbook, columns: chosen.columns };
}
function state(
  statement: ArrayBuffer,
  cashbook: ArrayBuffer,
  name: string,
  columns?: unknown,
  statementColumns?: unknown,
) {
  return {
    version: 'bank-statement-lifecycle-1',
    files: [
      {
        name: 'R17-JUL-statement.pdf',
        sha256: sha(statement),
        original: statement,
        ...(statementColumns === undefined
          ? {}
          : { columns: statementColumns }),
      },
      {
        name,
        sha256: sha(cashbook),
        original: cashbook,
        ...(columns === undefined ? {} : { columns }),
      },
    ],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions: [],
  };
}
/** A replay's error message, or null: a test asserts on either. */
async function refusal(input: unknown) {
  try {
    await replayBankStatement(input);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
/** A lifecycle step's value, or its error message: a test asserts on
 * either, so a planted defect fails an assertion, not a throw (DEV-22). */
async function settled<T>(step: () => Promise<T>) {
  try {
    return { value: await step(), error: null };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
/** The columns a mapped reading left out, as the result cites them. */
const unreadOf = (r: { sources: object[] }) =>
  (r.sources[1] as Record<string, unknown>).unread as unknown[];
const casesOf = (r: { cases: { id: string; reason: string }[] }) =>
  r.cases.map((c) => `${c.id}:${c.reason}`);

void test('a mapped cashbook settles as its declared twin', async () => {
  const { statement, cashbook, columns } = await inputs();
  const twin = await bytes(TWIN);
  const mapped = await replayBankStatement(
    state(statement, cashbook, 'M01-JUL-cashbook.xlsx', columns),
  );
  const declared = await replayBankStatement(
    state(statement, twin, 'R17-JUL-cashbook.csv'),
  );
  assert.deepEqual(casesOf(mapped.result), casesOf(declared.result));
  assert.deepEqual(
    mapped.result.match.cashbook.map((e) => [e.id, e.row]),
    declared.result.match.cashbook.map((e) => [e.id, e.row + 3]),
  );
  // The result names the columns and what was left out; the declared
  // reading names none.
  const cited = mapped.result.sources[1] as Record<string, unknown>;
  assert.deepEqual(cited.columns, columns);
  assert.equal(cited.above, 3);
  assert.deepEqual(
    (cited.unread as { label: string }[]).map((u) => u.label),
    ['Document No', 'Balance'],
  );
  assert.ok(!('columns' in declared.result.sources[1]));
});

void test('the context includes the columns, and only when there are some', async () => {
  const { statement, cashbook, columns } = await inputs();
  const twin = await bytes(TWIN);
  const mapped = await replayBankStatement(
    state(statement, cashbook, 'M01-JUL-cashbook.xlsx', columns),
  );
  const declared = await replayBankStatement(
    state(statement, twin, 'R17-JUL-cashbook.csv'),
  );
  const parts = JSON.parse(mapped.result.context) as unknown[];
  assert.deepEqual(parts.at(-1), columns);
  assert.equal((JSON.parse(declared.result.context) as unknown[]).length, 7);
  assert.equal(parts.length, 8);
});

void test('a session keeps the columns with the cashbook, and a declared one keeps its form', async () => {
  const { statement, cashbook, columns } = await inputs();
  const twin = await bytes(TWIN);
  const saved = await settled(() =>
    saveBankStatement(
      state(statement, cashbook, 'M01-JUL-cashbook.xlsx', columns),
    ),
  );
  assert.equal(saved.error, null);
  const session = saved.value!;
  const parsed = JSON.parse(new TextDecoder().decode(session)) as {
    files: Record<string, unknown>[];
  };
  assert.deepEqual(Object.keys(parsed.files[1]).sort(), [
    'columns',
    'data',
    'name',
    'sha256',
  ]);
  assert.deepEqual(parsed.files[1].columns, columns);
  assert.ok(!('columns' in parsed.files[0]));
  const restored = await settled(() => restoreBankStatement(session));
  assert.equal(restored.error, null);
  assert.deepEqual(restored.value?.state.files[1].columns, columns);
  const plain = JSON.parse(
    new TextDecoder().decode(
      await saveBankStatement(state(statement, twin, 'R17-JUL-cashbook.csv')),
    ),
  ) as { files: Record<string, unknown>[] };
  assert.deepEqual(Object.keys(plain.files[1]).sort(), [
    'data',
    'name',
    'sha256',
  ]);
});

void test('columns belong to the cashbook and must have a map form', async () => {
  const { statement, cashbook, columns } = await inputs();
  assert.equal(
    await refusal(
      state(statement, cashbook, 'M01-JUL-cashbook.xlsx', columns, columns),
    ),
    'BANK_STATEMENT_SOURCE',
  );
  type Draft = {
    [key: string]: unknown;
    columns: Record<string, { [key: string]: unknown } | null>;
  };
  const broken = (change: (c: Draft) => void) => {
    const c = structuredClone(columns) as unknown as Draft;
    change(c);
    return c;
  };
  for (const c of [
    broken((c) => (c.header = 0)),
    broken((c) => (c.columns.payments!.column = 6)),
    broken((c) => (c.currency = 'SAR')),
    broken((c) => (c.columns.reference!.label = ' Reference')),
    broken((c) => (c.columns.date = null)),
  ])
    assert.equal(
      await refusal(state(statement, cashbook, 'M01-JUL-cashbook.xlsx', c)),
      'BANK_STATEMENT_SOURCE_COLUMNS',
    );
});

void test('columns that do not fit their file are refused, not read', async () => {
  const { statement, cashbook, columns } = await inputs();
  const moved: CashbookColumns = {
    ...columns,
    columns: {
      ...columns.columns,
      reference: { column: 3, label: 'Reference' },
    },
  };
  assert.match(
    (await refusal(
      state(statement, cashbook, 'M01-JUL-cashbook.xlsx', moved),
    )) ?? '',
    /^BANK_CASHBOOK_MAP: row 4:/u,
  );
  // The declared reading of the same file refuses its header.
  assert.match(
    (await refusal(state(statement, cashbook, 'M01-JUL-cashbook.xlsx'))) ?? '',
    /^BANK_CASHBOOK_HEADER: row 1:/u,
  );
});

void test('a reading is reused only under the same columns', async () => {
  const { statement, cashbook, columns } = await inputs();
  const other: CashbookColumns = {
    ...columns,
    columns: {
      ...columns.columns,
      description: { column: 3, label: 'Document No' },
    },
  };
  const first = await replayVerified(
    state(statement, cashbook, 'M01-JUL-cashbook.xlsx', columns),
  );
  const second = await replayVerified(
    state(statement, cashbook, 'M01-JUL-cashbook.xlsx', other),
  );
  assert.deepEqual(
    [
      first.result.match.cashbook[0].description,
      second.result.match.cashbook[0].description,
    ],
    ['Supplier payment by cheque', 'DOC-R17JUL-001'],
  );
  assert.notEqual(first.result.context, second.result.context);
});

void test('no result can change the mapped reading it shares with the next', async () => {
  const { statement, cashbook, columns } = await inputs();
  const own = state(statement, cashbook, 'M01-JUL-cashbook.xlsx', columns);
  const a = await replayVerified(own);
  const unread = unreadOf(a.result);
  assert.throws(() => {
    unread.pop();
  }, TypeError);
  assert.throws(() => {
    (a.result.match.cashbook as unknown[]).pop();
  }, TypeError);
  const b = await replayVerified(own);
  assert.equal(unreadOf(b.result).length, 2);
  assert.equal(b.result.match.cashbook.length, a.result.match.cashbook.length);
});

void test('a mapped cashbook is copied from the caller, as a declared one is', async () => {
  const { statement, cashbook, columns } = await inputs();
  const snapshot = snapshotAnyStatementState(
    state(statement, cashbook, 'M01-JUL-cashbook.xlsx', columns),
  );
  const held = sha(snapshot.files[1].original);
  new Uint8Array(cashbook)[0] ^= 0xff;
  assert.notEqual(snapshot.files[1].original, cashbook);
  assert.equal(sha(snapshot.files[1].original), held);
});

void test('a roll or sheet state carries the cashbook columns as a period does', async () => {
  const { statement, cashbook, columns } = await inputs();
  const own = state(statement, cashbook, 'M01-JUL-cashbook.xlsx', columns);
  const previous = {
    name: 'previous.json',
    sha256: '0'.repeat(64),
    original: new ArrayBuffer(2),
  };
  const rolled = snapshotAnyStatementState({
    ...own,
    version: 'bank-statement-roll-1',
    previous,
  });
  assert.deepEqual(rolled.files[1].columns, columns);
  assert.throws(
    () =>
      snapshotAnyStatementState({
        ...state(statement, cashbook, 'M01-JUL-cashbook.xlsx', { header: 4 }),
        version: 'bank-statement-roll-1',
        previous,
      }),
    /BANK_STATEMENT_SOURCE_COLUMNS/u,
  );
});

void test('next month carries from a session whose cashbook was read with columns', async () => {
  const { statement, cashbook, columns } = await inputs();
  const saved = await settled(() =>
    saveBankStatement(
      state(statement, cashbook, 'M01-JUL-cashbook.xlsx', columns),
    ),
  );
  assert.equal(saved.error, null);
  const session = saved.value!;
  const august = await bytes(
    '../audit/bank-map-foundation/frozen/M01-AUG-cashbook.xlsx',
  );
  const augustStatement = await bytes(
    '../audit/bank-roll-foundation/frozen/R17-AUG-statement.pdf',
  );
  const chosen = chooseCashbookColumns(
    await readFile('M01-AUG-cashbook.xlsx', august.slice(0)),
    CHOICE,
  );
  assert.ok('columns' in chosen);
  const own = state(
    augustStatement,
    august,
    'M01-AUG-cashbook.xlsx',
    chosen.columns,
  );
  own.files[0].name = 'R17-AUG-statement.pdf';
  const rolled = await settled(() =>
    replayRolledStatement({
      ...own,
      version: 'bank-statement-roll-1',
      previous: {
        name: 'R17-JUL.json',
        sha256: sha(session),
        original: session,
      },
    }),
  );
  assert.equal(rolled.error, null);
  const { roll, cases } = rolled.value!.result;
  assert.ok(roll);
  assert.equal(roll.previous.status, 'accepted');
  assert.deepEqual(
    roll.carried.map((c) => c.key),
    ['C:PV-R17-95@2026-07-31'],
  );
  assert.deepEqual(
    cases.filter((c) => c.kind === 'carried').map((c) => c.reason),
    ['carried-reference'],
  );
});
