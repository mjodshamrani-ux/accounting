import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  clearCarried,
  rollBankStatement,
  rollContinuity,
  type CarriedItem,
} from '../lib/reconciliation/bank-statement-roll.ts';
import {
  restoreBankStatement,
  saveBankStatement,
  statementSessionParts,
  type BankStatementResult,
} from '../lib/reconciliation/bank-statement-lifecycle.ts';
import type { CashbookEntry } from '../lib/reconciliation/bank-statement-match.ts';
import type { BankStatementReading } from '../lib/reconciliation/bank-statement-native.ts';

// bank-statement-roll-1 (proposed), engine part. The proof against the
// independent oracle on the twenty sealed stories is scripts/bank-roll-proof;
// here each rule is held directly, with its near case.

const roll = (name: string) =>
  readFile(new URL(`../audit/bank-roll-foundation/frozen/${name}`, import.meta.url));
const bank = (name: string) =>
  readFile(new URL(`../audit/bank-statement-foundation/frozen/${name}`, import.meta.url));
const buffer = (b: Buffer) => Uint8Array.from(b).buffer;
const sha = (b: Buffer | ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(b)).digest('hex');
const NONE = { currency: null, period: null, confirmedClosing: null };
const source = (name: string, b: Buffer) => ({ name, sha256: sha(b), original: buffer(b) });
/** A story's current period, as a lifecycle state. */
const current = async (id: string) => ({
  version: 'bank-statement-lifecycle-1' as const,
  files: [
    source(`${id}-statement.pdf`, await roll(`${id}-statement.pdf`)),
    source(`${id}-cashbook.csv`, await roll(`${id}-cashbook.csv`)),
  ],
  scope: NONE,
  decisions: [],
});
const session = async (story: string) => buffer(await roll(`${story}-previous-session.json`));
/** A session file as JSON, for planting one change in it. */
type SessionDoc = {
  version: string;
  decisions: { context: string; case: string; statement: string[]; cashbook: string[] }[];
  previous?: { name: string; sha256: string; data: string; extra?: number };
};
const edited = async (story: string, change: (doc: SessionDoc) => void) => {
  const doc = JSON.parse((await roll(`${story}-previous-session.json`)).toString('utf8'));
  change(doc);
  return buffer(Buffer.from(JSON.stringify(doc)));
};
const refused = (r: Awaited<ReturnType<typeof rollBankStatement>>) =>
  r.previous.status === 'refused' ? r.previous.code : r.previous.status;

type Row = [date: string, reference: string, signed: number];
/** A proved July statement holding these movements (positive = deposit). */
function statement(rows: Row[], held = false): BankStatementReading {
  return {
    family: 'bank-statement-native-1',
    format: 'pdf',
    layout: 'en',
    sha256: '',
    currency: 'SAR',
    decimals: 2,
    period: { start: '2026-08-01', end: '2026-08-31' },
    heading: '',
    pages: [{ page: 1, number: 1, of: 1 }],
    lines: rows.map(([date, reference, signed], i) => ({
      kind: 'movement',
      page: 1,
      items: [i + 1],
      date,
      valueDate: date,
      description: '',
      reference,
      withdrawal: signed < 0 ? -signed : 0,
      deposit: signed > 0 ? signed : 0,
      balance: 0,
    })),
    status: held ? 'balance-broken' : 'verified',
    opening: 0,
    closing: 0,
    withdrawals: 0,
    deposits: 0,
  };
}
/** Cashbook entries (positive = receipt), vouchers as given. */
const entries = (rows: [voucher: string, date: string, reference: string, signed: number][]) =>
  rows.map(
    ([id, date, reference, signed], i): CashbookEntry => ({
      id,
      row: i + 2,
      date,
      description: '',
      reference,
      direction: signed > 0 ? 'in' : 'out',
      amount: Math.abs(signed),
    }),
  );
/** A July item outstanding at the end of July (positive = in). */
function carried(side: 'S' | 'C', id: string, reference: string, signed: number, date = '2026-07-29'): CarriedItem {
  return {
    key: `${side}:${id}@2026-07-31`,
    side: side === 'S' ? 'statement' : 'cashbook',
    id,
    page: side === 'S' ? 1 : null,
    row: side === 'C' ? 6 : null,
    period: { start: '2026-07-01', end: '2026-07-31' },
    date,
    direction: signed > 0 ? 'in' : 'out',
    amount: Math.abs(signed),
    reference,
    origin: 'unmatched',
    age: 1,
    source: 'a'.repeat(64),
    session: 'b'.repeat(64),
  };
}
const cases = (r: ReturnType<typeof clearCarried>) =>
  r.cases.map((c) => `${c.reason} ${c.carried.join(',')} / ${[...c.statement, ...c.cashbook].join(',')}`);

void test('a carried item pairs by reference only with what the own matching left, and never automatically', () => {
  const cheque = carried('C', 'PV-9', 'CHQ-9', -5000);
  const pays = (signed: number, ref = 'CHQ-9') =>
    clearCarried([cheque], statement([['2026-08-03', 'TRF-1', 700], ['2026-08-04', ref, signed]]),
      entries([['RV-1', '2026-08-03', 'TRF-1', 700]]));
  const same = pays(-5000);
  assert.deepEqual(cases(same), ['carried-reference C:PV-9@2026-07-31 / S2']);
  // R4: a unique identical reference and amount is still review.
  assert.deepEqual(same.match.auto.map((a) => a.statement), ['S1']);
  assert.deepEqual(same.match.statementOnly, ['S2']);
  assert.deepEqual(same.still, []);
  assert.deepEqual(cases(pays(-5100)), ['carried-amount-difference C:PV-9@2026-07-31 / S2']);
  // Another direction is no counterpart; the cheque stays carried, older.
  const back = pays(5000);
  assert.deepEqual(cases(back), []);
  assert.deepEqual(back.still.map((c) => [c.key, c.age]), [['C:PV-9@2026-07-31', 2]]);
  // Two movements with the reference: the engine picks neither.
  const twice = clearCarried([cheque], statement([['2026-08-04', 'CHQ-9', -5000], ['2026-08-20', 'CHQ-9', -5000]]), []);
  assert.deepEqual(cases(twice), ['carried-ambiguous C:PV-9@2026-07-31 / S1,S2']);
  // A movement the period matched itself is not left for a carried item,
  // even one its amount would suggest.
  const receipt = carried('C', 'RV-9', '', 50000);
  const own = clearCarried([receipt], statement([['2026-08-04', 'TRF-1', 50000]]),
    entries([['RV-1', '2026-08-04', 'TRF-1', 50000]]));
  assert.deepEqual(own.match.auto.map((a) => a.statement), ['S1']);
  assert.deepEqual(cases(own), []);
  assert.deepEqual(own.still.map((c) => c.key), ['C:RV-9@2026-07-31']);
  const left = clearCarried([receipt], statement([['2026-08-04', 'TRF-1', 50000]]), []);
  assert.deepEqual(cases(left), ['carried-amount-suggestion C:RV-9@2026-07-31 / S1']);
});

void test('a current item that repeats the carried item on its own side withholds its reference', () => {
  const cheque = carried('C', 'PV-9', 'CHQ-9', -5000);
  const reading = statement([['2026-08-03', 'TRF-1', 700], ['2026-08-04', 'CHQ-9', -5000]]);
  // The cheque recorded again in August: its reference would match the
  // movement automatically; the repetition holds both for review instead.
  const again = clearCarried([cheque], reading,
    entries([['RV-1', '2026-08-03', 'TRF-1', 700], ['PV-20', '2026-07-29', 'CHQ-9', -5000]]));
  assert.deepEqual(cases(again), ['carried-repeated C:PV-9@2026-07-31 / S2,PV-20']);
  assert.deepEqual(again.withheld, { statement: ['S2'], cashbook: ['PV-20'] });
  assert.deepEqual(again.match.auto.map((a) => a.statement), ['S1']);
  assert.deepEqual([again.match.statementOnly, again.match.cashbookOnly], [[], []]);
  // Restated: the repeating entry differs in amount, date or direction.
  for (const [date, signed] of [['2026-07-29', -5200], ['2026-07-30', -5000], ['2026-07-29', 5000]] as const)
    assert.deepEqual(
      cases(clearCarried([cheque], reading, entries([['PV-20', date, 'CHQ-9', signed]]))),
      ['carried-restated C:PV-9@2026-07-31 / S2,PV-20'],
      `${date} ${signed}`,
    );
  // The same voucher repeats it even without a reference.
  const plain = carried('C', 'PV-9', '', -5000);
  assert.deepEqual(
    cases(clearCarried([plain], statement([]), entries([['PV-9', '2026-07-29', '', -5000]]))),
    ['carried-repeated C:PV-9@2026-07-31 / PV-9'],
  );
  // Cases follow carried order, whichever rule made them.
  const deposit = carried('S', 'S1', '', 900);
  assert.deepEqual(
    cases(clearCarried([deposit, cheque], reading,
      entries([['PV-20', '2026-07-29', 'CHQ-9', -5000], ['RV-5', '2026-08-02', '', 900]]))),
    ['carried-amount-suggestion S:S1@2026-07-31 / RV-5', 'carried-repeated C:PV-9@2026-07-31 / S2,PV-20'],
  );
  // A statement movement is identified by its reference, never by its id.
  const fee = carried('S', 'S2', '', -1500);
  assert.deepEqual(
    cases(clearCarried([fee], statement([['2026-08-03', '', -700], ['2026-08-05', '', -1500]]), [])),
    [],
  );
});

void test('by amount only where a reference is missing, and never across two references', () => {
  const deposit = carried('S', 'S5', '', 123400);
  const one = clearCarried([deposit], statement([]), entries([['RV-3', '2026-08-02', '', 123400]]));
  assert.deepEqual(cases(one), ['carried-amount-suggestion S:S5@2026-07-31 / RV-3']);
  // The entry has a reference the carried item lacks: still a suggestion.
  assert.deepEqual(
    cases(clearCarried([deposit], statement([]), entries([['RV-3', '2026-08-02', 'DEP-3', 123400]]))),
    ['carried-amount-suggestion S:S5@2026-07-31 / RV-3'],
  );
  // Two different non-empty references never pair by an equal amount.
  const named = carried('C', 'PV-9', 'CHQ-9', -5000);
  assert.deepEqual(cases(clearCarried([named], statement([['2026-08-04', 'CHQ-8', -5000]]), [])), []);
  assert.deepEqual(
    cases(clearCarried([named], statement([['2026-08-04', '', -5000]]), [])),
    ['carried-amount-suggestion C:PV-9@2026-07-31 / S1'],
  );
  // Two candidates of the amount: ambiguous.
  assert.deepEqual(
    cases(clearCarried([deposit], statement([]),
      entries([['RV-3', '2026-08-02', '', 123400], ['RV-4', '2026-08-09', '', 123400]]))),
    ['carried-ambiguous S:S5@2026-07-31 / RV-3,RV-4'],
  );
});

void test('two carried items claiming one current item make one ambiguous case, in carried order', () => {
  const a = carried('C', 'PV-1', '', -5000, '2026-07-20');
  const b = carried('C', 'PV-2', '', -5000, '2026-07-25');
  const other = carried('S', 'S3', 'DEP-3', 800);
  const r = clearCarried([other, b, a], statement([['2026-08-04', '', -5000]]),
    entries([['RV-7', '2026-08-02', 'DEP-3', 800]]));
  assert.deepEqual(cases(r), [
    'carried-reference S:S3@2026-07-31 / RV-7',
    'carried-ambiguous C:PV-2@2026-07-31,C:PV-1@2026-07-31 / S1',
  ]);
  assert.deepEqual(r.still, []);
});

void test('a held current period clears nothing', () => {
  const r = clearCarried([carried('C', 'PV-9', 'CHQ-9', -5000)],
    statement([['2026-08-04', 'CHQ-9', -5000]], true), []);
  assert.ok(r.match.held);
  assert.deepEqual([r.cases, r.still, r.withheld], [[], [], { statement: [], cashbook: [] }]);
});

void test('continuity: the same currency, the next day, the printed closing as the printed opening', () => {
  const result = (currency: string, start: string, end: string, opening: number | null, closing: number | null) =>
    ({
      reading: { currency, opening, closing },
      match: { statement: { period: { start, end } } },
    }) as unknown as BankStatementResult;
  const july = result('SAR', '2026-07-01', '2026-07-31', 100, 250);
  assert.equal(rollContinuity(july, result('SAR', '2026-08-01', '2026-08-31', 250, 0)), null);
  assert.equal(rollContinuity(july, result('USD', '2026-08-01', '2026-08-31', 250, 0)), 'ROLL_CURRENCY');
  assert.equal(rollContinuity(july, result('SAR', '2026-08-02', '2026-08-31', 250, 0)), 'ROLL_NOT_CONSECUTIVE');
  assert.equal(rollContinuity(july, result('SAR', '2026-07-31', '2026-08-31', 250, 0)), 'ROLL_NOT_CONSECUTIVE');
  assert.equal(rollContinuity(july, result('SAR', '2026-08-01', '2026-08-31', 251, 0)), 'ROLL_OPENING');
  assert.equal(rollContinuity(july, result('SAR', '2026-08-01', '2026-08-31', null, 0)), 'ROLL_OPENING');
  const feb = result('SAR', '2028-02-01', '2028-02-29', 0, 250);
  assert.equal(rollContinuity(feb, result('SAR', '2028-03-01', '2028-03-31', 250, 0)), null);
  // The currency is checked first.
  assert.equal(rollContinuity(july, result('USD', '2026-09-01', '2026-09-30', 1, 0)), 'ROLL_CURRENCY');
});

void test('the previous session is replayed from its originals: a decision from another context, or an ineligible one, refuses it', async () => {
  const state = await current('R09-AUG');
  const accepted = await rollBankStatement({ previous: await session('R09'), current: state });
  assert.equal(refused(accepted), 'accepted');
  assert.equal(accepted.previous.status === 'accepted' && accepted.previous.sha256, sha(await roll('R09-previous-session.json')));
  const context = await edited('R09', (doc) => {
    doc.decisions[0].context = doc.decisions[0].context.replace('"printed"', '"confirmed-closing"');
  });
  assert.equal(refused(await rollBankStatement({ previous: context, current: state })), 'ROLL_PREVIOUS_UNREADABLE');
  const undecided = await edited('R09', (doc) => (doc.decisions = []));
  assert.equal(refused(await rollBankStatement({ previous: undecided, current: state })), 'ROLL_PREVIOUS_UNDECIDED');
  const ineligible = await edited('R18', (doc) =>
    Object.assign(doc.decisions[0], { case: 'C1', statement: ['S1'], cashbook: [] }));
  assert.equal(refused(await rollBankStatement({ previous: ineligible, current: await current('R18-AUG') })),
    'ROLL_PREVIOUS_UNREADABLE');
  // Refused, nothing is carried and the period is matched as without it.
  const none = await rollBankStatement({ previous: null, current: state });
  const off = await rollBankStatement({ previous: undecided, current: state });
  assert.deepEqual([off.carried, off.cases, off.still], [[], [], []]);
  assert.deepEqual(off.match, none.match);
  assert.deepEqual(none.match, none.current.result.match);
});

void test('only a printed statement carries: a table statement session is not read as a previous period', async () => {
  const csv = (await bank('BS01-statement.csv')).toString('utf8');
  const last = csv.trimEnd().split('\r\n').at(-1)!.split(',').at(-1)!;
  const table = await saveBankStatement({
    version: 'bank-statement-lifecycle-1',
    files: [source('BS01-statement.csv', await bank('BS01-statement.csv')), source('BS01-cashbook.csv', await bank('BS01-cashbook.csv'))],
    scope: { currency: 'SAR', period: { start: '2026-07-01', end: '2026-07-31' }, confirmedClosing: Math.round(Number(last) * 100) },
    decisions: [],
  });
  const r = await rollBankStatement({ previous: table, current: await current('R01-AUG') });
  assert.equal(refused(r), 'ROLL_PREVIOUS_UNREADABLE');
  assert.match(r.previous.status === 'refused' ? r.previous.detail : '', /STATE_SCOPE/u);
});

void test('a chain: the previous session carries its own previous session, checked to its fingerprint', async () => {
  const state = await current('R05-SEP');
  const chained = await rollBankStatement({ previous: await session('R05'), current: state });
  assert.equal(refused(chained), 'accepted');
  assert.deepEqual(chained.carried.map((c) => [c.key, c.age]), [['C:PV-R05-93@2026-07-31', 2]]);
  const fingerprint = await edited('R05', (doc) => (doc.previous!.sha256 = 'f'.repeat(64)));
  assert.equal(refused(await rollBankStatement({ previous: fingerprint, current: state })), 'ROLL_PREVIOUS_UNREADABLE');
  // Its own previous period must be closed and consecutive too: June's
  // session (R12) in place of July's is refused as the chain's.
  const june = await roll('R12-previous-session.json');
  const gap = await edited('R05', (doc) => {
    doc.previous = { name: 'R12-JUN-session.json', sha256: sha(june), data: june.toString('base64') };
  });
  const r = await rollBankStatement({ previous: gap, current: state });
  assert.equal(refused(r), 'ROLL_PREVIOUS_UNREADABLE');
  assert.match(r.previous.status === 'refused' ? r.previous.detail : '', /ROLL_NOT_CONSECUTIVE/u);
  // A period that carried in and left a carried case undecided is not closed:
  // August carrying July's cheque, which August's statement pays (R01).
  const file = async (name: string) => {
    const b = await roll(name);
    return { name, sha256: sha(b), data: b.toString('base64') };
  };
  const july = await roll('R01-previous-session.json');
  const august = buffer(Buffer.from(JSON.stringify({
    format: 'tarasuf-bank-statement-session',
    version: 'bank-statement-roll-1',
    files: [await file('R01-AUG-statement.pdf'), await file('R01-AUG-cashbook.csv')],
    scope: NONE,
    decisions: [],
    previous: { name: 'R01-JUL-session.json', sha256: sha(july), data: july.toString('base64') },
  })));
  const open = await rollBankStatement({ previous: august, current: await current('R01-AUG') });
  assert.equal(refused(open), 'ROLL_PREVIOUS_UNDECIDED');
});

void test('the roll format is read only as such: the restore path still refuses it, and a missing or extra previous is refused', async () => {
  await assert.rejects(restoreBankStatement(await session('R05')), /BANK_STATEMENT_SESSION/u);
  const parts = statementSessionParts(await session('R05'));
  assert.equal(parts.previous?.name, 'R05-JUL-session.json');
  assert.equal(parts.previous && sha(parts.previous.original), parts.previous?.sha256);
  assert.equal(statementSessionParts(await session('R01')).previous, null);
  const changes: [string, (doc: SessionDoc) => void][] = [
    ['no previous', (doc) => delete doc.previous],
    ['a previous in the lifecycle format', (doc) => (doc.version = 'bank-statement-lifecycle-1')],
    ['an extra key', (doc) => (doc.previous!.extra = 1)],
    ['data that is not base64', (doc) => (doc.previous!.data = '!')],
    ['a fingerprint that is not one', (doc) => (doc.previous!.sha256 = 'F'.repeat(64))],
  ];
  for (const [name, change] of changes)
    assert.throws(() => statementSessionParts(roll05(change)), /BANK_STATEMENT_SESSION/u, name);
  // A session of an unknown version, with or without a previous one.
  const unknown = JSON.parse((await roll('R01-previous-session.json')).toString('utf8'));
  unknown.version = 'bank-statement-lifecycle-2';
  assert.throws(() => statementSessionParts(buffer(Buffer.from(JSON.stringify(unknown)))), /BANK_STATEMENT_SESSION/u);
  assert.throws(
    () => statementSessionParts(roll05((doc) => (doc.version = 'bank-statement-roll-2'))),
    /BANK_STATEMENT_SESSION/u,
  );
});
let r05: string;
const roll05 = (change: (doc: SessionDoc) => void) => {
  const doc = JSON.parse(r05);
  change(doc);
  return buffer(Buffer.from(JSON.stringify(doc)));
};
test.before(async () => {
  r05 = (await roll('R05-previous-session.json')).toString('utf8');
});

void test('decisions on a period that carries are not taken here', async () => {
  const state = await current('R01-AUG');
  await assert.rejects(
    rollBankStatement({
      previous: await session('R01'),
      current: { ...state, decisions: [{ id: 'D1', type: 'reject', context: 'x', at: '2026-08-31T00:00:00.000Z', case: 'C1', statement: ['S1'], cashbook: ['PV-1'], note: 'n' }] },
    }),
    /BANK_STATEMENT_DECISION/u,
  );
});
