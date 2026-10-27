import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  replayBankStatement,
  replayRolledStatement,
  saveBankStatement,
  type BankStatementResult,
  type StatementCase,
} from '../lib/reconciliation/bank-statement-lifecycle.ts';
import type {
  BankStatementRollState,
  BankStatementState,
} from '../lib/reconciliation/bank-statement-request.ts';
import {
  bankSessionFormat,
  carriedAtEnd,
  heldReason,
  parseStatementClosing,
  statementActions,
  statementDecision,
  statementError,
  statementMember,
  statementState,
  rolledStatementState,
} from '../lib/reconciliation/bank-statement-view.ts';

// What the bank workspace offers for a statement session. The lifecycle is
// the authority; these tests hold that every button the interface enables is
// a decision the lifecycle takes, and every one it disables, one it refuses.

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
const pdf = async (id: string) =>
  statementState(
    await source(`${id}-statement.pdf`),
    await source(`${id}-cashbook.csv`),
    NONE,
    [],
  );
let clock = 0;
const decide = (
  result: BankStatementResult,
  c: StatementCase,
  type: 'accept' | 'reject' | 'undo',
) =>
  statementDecision(
    result,
    c,
    type,
    ' Checked against the voucher ',
    `D${++clock}`,
    new Date(Date.UTC(2026, 9, 21, 9, 0, clock)).toISOString(),
  );
const takes = async (state: BankStatementState) =>
  replayBankStatement(state).then(
    () => true,
    () => false,
  );

void test('every action offered is one the lifecycle takes, and every one withheld it refuses', async () => {
  let compared = 0;
  for (const id of ['BS02', 'BS04', 'BS05', 'BS06', 'BS07', 'BS12']) {
    const base = await pdf(id);
    const { result } = await replayBankStatement(base);
    const sample = [
      ...result.cases.filter((c) => c.kind === 'review'),
      ...result.cases.filter((c) => c.kind === 'automatic').slice(0, 2),
    ];
    // Each sampled case undecided, then after each decision the lifecycle
    // took on it, against every action.
    const states: BankStatementState[] = [base];
    for (const c of sample)
      for (const type of ['accept', 'reject'] as const) {
        const next = { ...base, decisions: [decide(result, c, type)] };
        if (await takes(next)) states.push(next);
      }
    for (const state of states) {
      const { result: now } = await replayBankStatement(state);
      for (const c of now.cases.filter((x) =>
        sample.some((s) => s.id === x.id),
      )) {
        const offered = statementActions(c, 'Seen');
        assert.deepEqual(statementActions(c, '  '), {
          accept: false,
          reject: false,
          undo: false,
        });
        for (const type of ['accept', 'reject', 'undo'] as const) {
          const taken = await takes({
            ...state,
            decisions: [...state.decisions, decide(now, c, type)],
          });
          assert.equal(
            offered[type],
            taken,
            `${id} ${c.id} ${c.status} ${type}`,
          );
          compared++;
        }
      }
    }
  }
  assert.ok(compared >= 90, `only ${compared} comparisons`);
});

void test('a decision carries the case’s exact members and the trimmed reason', async () => {
  const state = await pdf('BS04');
  const { result } = await replayBankStatement(state);
  const c = result.cases.find((x) => x.kind === 'review')!;
  const d = decide(result, c, 'accept');
  assert.deepEqual(
    [d.case, d.statement, d.cashbook, d.context, d.note],
    [
      c.id,
      c.statement,
      c.cashbook,
      result.context,
      'Checked against the voucher',
    ],
  );
  assert.notEqual(d.statement, c.statement);
  const { result: after } = await replayBankStatement({
    ...state,
    decisions: [d],
  });
  assert.equal(after.status, 'reviewed');
});

void test('a closing balance is read as written, never rounded or completed', () => {
  const cases: [string, number, number | null][] = [
    ['1250.00', 2, 125000],
    ['-27,958.45', 2, -2795845],
    ['1 250.00', 2, 125000],
    ['١٬٢٥٠٫٠٠', 2, 125000],
    ['۱۲۵۰.۰۰', 2, 125000],
    ['1250', 0, 1250],
    ['1.250', 3, 1250],
    ['1250', 2, null],
    ['1250.0', 2, null],
    ['1250.000', 2, null],
    ['+1250.00', 2, null],
    ['12a0.00', 2, null],
    ['', 2, null],
    ['-', 2, null],
    ['90071992547409.93', 2, null],
  ];
  for (const [text, decimals, want] of cases)
    assert.equal(parseStatementClosing(text, decimals), want, text);
});

void test('a held statement’s reason is named, citing what is printed and never the file’s own closing', async () => {
  const bs09 = await replayBankStatement(await pdf('BS09'));
  assert.deepEqual(heldReason(bs09.result.match.held!.reason), {
    kind: 'balance-broken',
    detail:
      'page 2: printed balance 3711179 != 3710179 (items 46,48,50,52,54,56)',
  });
  const bs10 = await replayBankStatement(await pdf('BS10'));
  assert.deepEqual(heldReason(bs10.result.match.held!.reason), {
    kind: 'incomplete-pages',
    detail: 'pages 1,3 of 3',
  });
  const table = async (scope: BankStatementState['scope']) =>
    (
      await replayBankStatement(
        statementState(
          await source('BS01-statement.csv'),
          await source('BS01-cashbook.csv'),
          scope,
          [],
        ),
      )
    ).result.match.held?.reason ?? '';
  const period = { start: '2026-07-01', end: '2026-07-31' };
  assert.deepEqual(
    heldReason(
      await table({ currency: 'SAR', period, confirmedClosing: null }),
    ),
    { kind: 'confirm-closing', detail: '' },
  );
  const differs = await table({
    currency: 'SAR',
    period,
    confirmedClosing: 1,
  });
  assert.match(differs, /^confirmed closing 1 != -2795845$/u);
  assert.deepEqual(heldReason(differs), {
    kind: 'closing-differs',
    detail: '',
  });
  assert.deepEqual(
    heldReason(
      await table({
        currency: 'SAR',
        period: null,
        confirmedClosing: -2795845,
      }),
    ),
    { kind: 'no-period', detail: '' },
  );
  assert.deepEqual(heldReason('something else'), {
    kind: 'other',
    detail: 'something else',
  });
});

void test('worker refusals are named by their code', async () => {
  const refusal = async (state: BankStatementState) =>
    replayBankStatement(state).then(
      () => '',
      (e: Error) => e.message,
    );
  const cashbookAsStatement = await refusal(
    statementState(
      await source('BS01-cashbook.csv'),
      await source('BS01-cashbook.csv'),
      { currency: 'SAR', period: null, confirmedClosing: null },
      [],
    ),
  );
  assert.match(cashbookAsStatement, /^BANK_STATEMENT_HEADER: /u);
  const statementAsCashbook = await refusal(
    statementState(
      await source('BS04-statement.pdf'),
      await source('BS01-statement.csv'),
      NONE,
      [],
    ),
  );
  assert.match(statementAsCashbook, /^BANK_CASHBOOK_HEADER: /u);
  const hash = await pdf('BS04');
  hash.files[1].sha256 = '0'.repeat(64);
  const pdfScope = await pdf('BS04');
  pdfScope.scope = { ...NONE, currency: 'SAR' };
  const cases: [string, string][] = [
    [cashbookAsStatement, 'statement-layout'],
    [statementAsCashbook, 'cashbook'],
    [await refusal(hash), 'source-hash'],
    [await refusal(pdfScope), 'scope-choice'],
    ['BANK_STATEMENT_READING: page 2 line 4: clipped', 'statement-reading'],
    ['BANK_STATEMENT_SCOPE: page 1 line 3: x', 'statement-scope'],
    ['BANK_STATEMENT_AMOUNT: page 0 line 5: balance', 'statement-line'],
    ['BANK_STATEMENT_SESSION', 'session'],
    ['BANK_STATEMENT_INELIGIBLE', 'decision'],
    ['BANK_STATEMENT_HELD', 'decision'],
    ['BANK_STATEMENT_WORKER_BINDING', 'other'],
    ['تعذر', 'other'],
  ];
  for (const [message, kind] of cases)
    assert.equal(statementError(message), kind, message);
});

void test('a restored file is routed by its declared format alone', async () => {
  const encode = (v: unknown) =>
    new TextEncoder().encode(JSON.stringify(v)).buffer;
  assert.equal(
    bankSessionFormat(await saveBankStatement(await pdf('BS04'))),
    'statement',
  );
  assert.equal(
    bankSessionFormat(encode({ format: 'tarasuf-bank-session', files: [] })),
    'movements',
  );
  for (const other of [
    encode({ format: 'tarasuf-inventory-pdf-session' }),
    encode([{ format: 'tarasuf-bank-statement-session' }]),
    encode('tarasuf-bank-statement-session'),
    new TextEncoder().encode('{').buffer,
    Uint8Array.from([0xff, 0xfe, 0x7b]).buffer,
  ])
    assert.equal(bankSessionFormat(other), null);
});

void test('members are shown with the page and text items or the row they come from', async () => {
  const { result } = await replayBankStatement(await pdf('BS03'));
  const movement = result.match.movements[4];
  assert.deepEqual(statementMember(result, 'statement', movement.id), {
    id: movement.id,
    date: movement.date,
    reference: movement.reference,
    direction: movement.direction,
    amount: movement.amount,
    citation: `${movement.page}:${movement.items.join(' ')}`,
  });
  const line = result.reading.lines.filter((l) => l.kind === 'movement')[4];
  assert.deepEqual([line.page, line.items], [movement.page, movement.items]);
  const entry = result.match.cashbook.at(-1)!;
  assert.equal(
    statementMember(result, 'cashbook', entry.id)?.citation,
    String(entry.row),
  );
  assert.equal(statementMember(result, 'cashbook', 'NO-SUCH'), null);
  // Each result has its own members, looked up by its own index.
  const other = (await replayBankStatement(await pdf('BS04'))).result;
  const last = other.match.movements.at(-1)!;
  assert.equal(
    statementMember(other, 'statement', last.id)?.amount,
    last.amount,
  );
  assert.notEqual(last.amount, result.match.movements.at(-1)!.amount);
  assert.equal(
    statementMember(other, 'cashbook', other.match.cashbook[0].id)?.citation,
    String(other.match.cashbook[0].row),
  );
});

// A period that carries (bank-statement-roll-1), on the sealed stories of
// audit/bank-roll-foundation: every carried reason, an item still carried,
// and a refused previous period.
const roll = async (id: string, current: string) => {
  const file = async (name: string) => {
    const b = await readFile(
      new URL(`../audit/bank-roll-foundation/frozen/${name}`, import.meta.url),
    );
    return source(name, b);
  };
  return rolledStatementState(
    await file(`${current}-statement.pdf`),
    await file(`${current}-cashbook.csv`),
    [],
    await file(`${id}-previous-session.json`),
  );
};
const takesRolled = async (state: BankStatementRollState) =>
  replayRolledStatement(state).then(
    () => true,
    () => false,
  );

void test('on carried cases too, every action offered is one the lifecycle takes, and every one withheld it refuses', async () => {
  const reasons = new Set<string>();
  let compared = 0;
  for (const [id, current] of [
    ['R01', 'R01-AUG'],
    ['R05', 'R05-SEP'],
    ['R06', 'R06-AUG'],
    ['R07', 'R07-AUG'],
    ['R08', 'R08-AUG'],
    ['R09', 'R09-AUG'],
    ['R10', 'R10-AUG'],
  ]) {
    const base = await roll(id, current);
    const { result } = await replayRolledStatement(base);
    assert.equal(result.roll?.previous.status, 'accepted', id);
    const sample = result.cases.filter((c) => c.kind === 'carried');
    assert.ok(sample.length, id);
    const states: BankStatementRollState[] = [base];
    for (const c of sample) {
      reasons.add(c.reason);
      for (const type of ['accept', 'reject'] as const) {
        const next = { ...base, decisions: [decide(result, c, type)] };
        if (await takesRolled(next)) states.push(next);
      }
    }
    for (const state of states) {
      const { result: now } = await replayRolledStatement(state);
      for (const c of now.cases.filter((x) => x.kind === 'carried')) {
        const offered = statementActions(c, 'Seen');
        for (const type of ['accept', 'reject', 'undo'] as const) {
          const taken = await takesRolled({
            ...state,
            decisions: [...state.decisions, decide(now, c, type)],
          });
          assert.equal(
            offered[type],
            taken,
            `${id} ${c.id} ${c.reason} ${c.status} ${type}`,
          );
          compared++;
        }
      }
    }
  }
  assert.deepEqual(
    [...reasons].sort((a, b) => a.localeCompare(b)),
    [
      'carried-ambiguous',
      'carried-amount-difference',
      'carried-amount-suggestion',
      'carried-reference',
      'carried-repeated',
      'carried-restated',
    ],
  );
  assert.ok(compared >= 30, `only ${compared} comparisons`);
});

void test('a carried item is shown still carried, with its age at the period end, only when no live case holds it', async () => {
  // R04: the carried cheque has no counterpart; R09: one of two is suggested.
  for (const [id, current, still] of [
    ['R04', 'R04-AUG', 1],
    ['R09', 'R09-AUG', 1],
    ['R01', 'R01-AUG', 0],
  ] as const) {
    const state = await roll(id, current);
    const { result } = await replayRolledStatement(state);
    const held = new Set(
      result.cases.flatMap((c) =>
        c.kind === 'carried' && c.status !== 'rejected' ? c.carried! : [],
      ),
    );
    const shown = result.roll!.carried.map((i) => carriedAtEnd(result, i));
    assert.equal(shown.filter((a) => a !== null).length, still, id);
    for (const [n, i] of result.roll!.carried.entries())
      assert.equal(
        shown[n],
        held.has(i.key) ? null : i.age + 1,
        `${id} ${i.key}`,
      );
    // A rejected carried case leaves its item carried, one period older.
    const live = result.cases.find((c) => c.kind === 'carried');
    if (live) {
      const { result: after } = await replayRolledStatement({
        ...state,
        decisions: [decide(result, live, 'reject')],
      });
      for (const key of live.carried!) {
        const i = after.roll!.carried.find((x) => x.key === key)!;
        assert.equal(carriedAtEnd(after, i), i.age + 1, `${id} ${key}`);
      }
    }
  }
});

void test('a period that carries is the printed statement path, with its previous file and no scope', async () => {
  const state = await roll('R11', 'R11-AUG');
  assert.deepEqual(
    [state.version, state.scope, state.previous.name, state.files.length],
    ['bank-statement-roll-1', NONE, 'R11-previous-session.json', 2],
  );
  const { result } = await replayRolledStatement(state);
  assert.deepEqual(
    [result.roll?.previous.status, result.roll?.carried.length],
    ['refused', 0],
  );
  assert.equal(
    result.roll?.previous.status === 'refused' && result.roll.previous.code,
    'ROLL_CURRENCY',
  );
});
