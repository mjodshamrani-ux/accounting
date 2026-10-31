import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import {
  exportAnyStatement,
  replayAnyStatement,
  replayBankStatement,
  replaySheetStatement,
  restoreAnyStatement,
  restoreBankStatement,
  restoreRolledStatement,
  saveAnyStatement,
  statementSessionParts,
  validateBankStatementWorkerResponse,
} from '../lib/reconciliation/bank-statement-lifecycle.ts';
import { snapshotAnyStatementState } from '../lib/reconciliation/bank-statement-request.ts';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';

// bank-reconciliation-sheet-1 (proposed) in the lifecycle: the sheet state,
// its session, the worker's envelope and binding, and the workbook's first
// sheet. The proof on the twenty-four sealed stories is
// scripts/bank-sheet-lifecycle-proof; here each rule is held directly.

const file = (name: string) =>
  readFile(new URL(`../audit/bank-sheet-foundation/frozen/${name}`, import.meta.url));
const buffer = (b: Buffer) => Uint8Array.from(b).buffer;
const sha = (b: Buffer | ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(b)).digest('hex');
const source = (name: string, b: Buffer) => ({ name, sha256: sha(b), original: buffer(b) });
const SHEET = 'bank-reconciliation-sheet-1';
/** A product call the test expects to succeed: a refusal fails the test by
 * assertion, not by the product's own error. */
async function must<T>(call: () => Promise<T>): Promise<T> {
  let value: T | undefined;
  await assert.doesNotReject(async () => {
    value = await call();
  });
  return value as T;
}
/** A sealed story's last period as a sheet state. */
async function state(
  id: string,
  current: string,
  {
    book = { balance: 0, note: 'General ledger' } as { balance: number; note: string } | null,
    language = 'en',
    previous = false,
  } = {},
) {
  return {
    version: SHEET,
    files: [
      source(`${current}-statement.pdf`, await file(`${current}-statement.pdf`)),
      source(`${current}-cashbook.csv`, await file(`${current}-cashbook.csv`)),
    ],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions: [] as unknown[],
    previous: previous
      ? source(`${id}-previous-session.json`, await file(`${id}-previous-session.json`))
      : null,
    sheet: { book, language, prepared: null, reviewed: null },
  };
}
/** The same period as a plain lifecycle state. */
const plainOf = (s: Awaited<ReturnType<typeof state>>) => ({
  version: 'bank-statement-lifecycle-1',
  files: s.files,
  scope: s.scope,
  decisions: s.decisions,
});
const facts = async () =>
  JSON.parse((await file('stories.json')).toString('utf8')) as {
    stories: { id: string; sheet: { book?: { balance: number; note: string } }[] }[];
  };
const ledger = async (id: string) =>
  (await facts()).stories.find((s) => s.id === id)!.sheet.find((a) => a.book)!.book!;

void test('the sheet state captures its inputs and refuses any other form', async () => {
  const s = await state('T02', 'T02-NOV', { book: await ledger('T02') });
  const captured = snapshotAnyStatementState(s);
  assert.equal(captured.version, SHEET);
  assert.notEqual((captured as unknown as typeof s).files[0].original, s.files[0].original);
  const sheet = s.sheet;
  const signoff = { name: 'A. Accountant', date: '2026-12-02', fingerprint: 'a'.repeat(64) };
  for (const [name, bad, code] of [
    ['language', { ...sheet, language: 'fr' }, /BANK_STATEMENT_SHEET/u],
    ['book fraction', { ...sheet, book: { balance: 1.5, note: '' } }, /BANK_STATEMENT_SHEET/u],
    ['book note control', { ...sheet, book: { balance: 1, note: 'a\u202eb' } }, /BANK_STATEMENT_SHEET/u],
    ['book extra key', { ...sheet, book: { balance: 1, note: '', at: 'x' } }, /BANK_STATEMENT_SHEET/u],
    ['signoff date', { ...sheet, prepared: { ...signoff, date: '2026-02-30' } }, /BANK_STATEMENT_SHEET/u],
    ['signoff fingerprint', { ...sheet, prepared: { ...signoff, fingerprint: 'A'.repeat(64) } }, /BANK_STATEMENT_SHEET/u],
    ['signoff name', { ...sheet, reviewed: { ...signoff, name: ' padded ' } }, /BANK_STATEMENT_SHEET/u],
    ['signoff long name', { ...sheet, reviewed: { ...signoff, name: 'x'.repeat(121) } }, /BANK_STATEMENT_SHEET/u],
    ['sheet key', { ...sheet, approved: true }, /BANK_STATEMENT_SHEET/u],
  ] as const)
    assert.throws(() => snapshotAnyStatementState({ ...s, sheet: bad }), code, name);
  const { previous: _, ...withoutPrevious } = s;
  assert.throws(() => snapshotAnyStatementState(withoutPrevious), /BANK_STATEMENT_INPUT/u);
  assert.throws(() => snapshotAnyStatementState({ ...s, version: 'bank-reconciliation-sheet-2' }), /BANK_STATEMENT_INPUT/u);
});

void test('the sheet replays its period as it is and keeps the decisions’ own context', async () => {
  const s = await state('T02', 'T02-NOV', { book: await ledger('T02') });
  const { result } = await must(() => replaySheetStatement(s));
  const plain = await must(() => replayBankStatement(plainOf(s)));
  assert.equal(result.version, SHEET);
  assert.equal(result.context, plain.result.context);
  assert.deepEqual(result.outstanding, plain.result.outstanding);
  assert.equal(result.sheet?.outcome.refusal, null);
  assert.equal(result.sheet?.outcome.refusal === null && result.sheet.outcome.sheet.status, 'reconciled');
  const refused = await must(() => replaySheetStatement({ ...s, sheet: { ...s.sheet, book: null } }));
  assert.deepEqual(refused.result.sheet?.outcome, { refusal: 'SHEET_NO_BOOK_BALANCE' });
  assert.equal(refused.result.sheet?.fingerprint, null);
});

void test('a sign-off holds only on the sheet it was given on', async () => {
  const s = await state('T02', 'T02-NOV', { book: await ledger('T02') });
  const { result } = await must(() => replaySheetStatement(s));
  const fingerprint = result.sheet!.fingerprint!;
  const signed = { ...s, sheet: { ...s.sheet, prepared: { name: 'A. Accountant', date: '2026-12-02', fingerprint } } };
  assert.equal((await must(() => replaySheetStatement(signed))).result.sheet?.prepared?.valid, true);
  // The note is content: changing it voids the sign-off.
  const noted = { ...signed, sheet: { ...signed.sheet, book: { ...signed.sheet.book!, note: 'Trial balance' } } };
  assert.equal((await must(() => replaySheetStatement(noted))).result.sheet?.prepared?.valid, false);
  // The language is not content.
  const arabic = { ...signed, sheet: { ...signed.sheet, language: 'ar' } };
  assert.equal((await must(() => replaySheetStatement(arabic))).result.sheet?.prepared?.valid, true);
  // A refused sheet voids every sign-off.
  const refused = { ...signed, sheet: { ...signed.sheet, book: null } };
  assert.equal((await must(() => replaySheetStatement(refused))).result.sheet?.prepared?.valid, false);
});

void test('a sheet session restores with its inputs; the plain restores refuse it', async () => {
  const s = await state('T16', 'T16-NOV', { book: await ledger('T16'), language: 'ar', previous: true });
  const saved = await must(() => saveAnyStatement(s));
  const parts = statementSessionParts(saved);
  assert.ok(parts.previous && parts.sheet);
  assert.equal(parts.sheet.language, 'ar');
  const back = await must(() => restoreAnyStatement(saved));
  assert.equal(back.result.version, SHEET);
  assert.deepEqual(JSON.parse(JSON.stringify(back.result)), JSON.parse(JSON.stringify((await must(() => replayAnyStatement(s))).result)));
  await assert.rejects(restoreBankStatement(saved), /BANK_STATEMENT_SESSION/u);
  await assert.rejects(restoreRolledStatement(saved), /BANK_STATEMENT_SESSION/u);
  // Without a previous period, `previous` is saved as null.
  const ownState = await state('T02', 'T02-NOV', { book: await ledger('T02') });
  const own = await must(() => saveAnyStatement(ownState));
  const doc = JSON.parse(new TextDecoder().decode(own)) as Record<string, unknown>;
  assert.equal(doc.version, SHEET);
  assert.equal(doc.previous, null);
  const broken = (change: (d: Record<string, unknown>) => void) => {
    const d = structuredClone(doc);
    change(d);
    return new TextEncoder().encode(JSON.stringify(d)).buffer;
  };
  for (const [name, change] of [
    ['no sheet', (d: Record<string, unknown>) => delete d.sheet],
    ['no previous key', (d: Record<string, unknown>) => delete d.previous],
    ['sheet language', (d: Record<string, unknown>) => ((d.sheet as { language: string }).language = 'de')],
  ] as const)
    assert.throws(() => statementSessionParts(broken(change)), /BANK_STATEMENT_(SESSION|SHEET)/u, name);
});

void test('the worker envelope takes the sheet version, the result in its state’s own', async () => {
  const s = await state('T02', 'T02-NOV', { book: await ledger('T02') });
  const sheet = await must(() => replaySheetStatement(s));
  const envelope = /BANK_STATEMENT_ENVELOPE/u;
  for (const action of ['bank-statement-reconcile', 'bank-statement-restore'])
    assert.doesNotThrow(() => validateWorkerValue(action, sheet, {}));
  const plain = await must(() => replayBankStatement(plainOf(s)));
  for (const [st, result] of [
    [sheet.state, plain.result],
    [plain.state, sheet.result],
  ])
    assert.throws(() => validateWorkerValue('bank-statement-reconcile', { state: st, result }, {}), envelope);
});

void test('the main thread recomputes a sheet reply and refuses an altered one', async () => {
  const s = await state('T02', 'T02-NOV', { book: await ledger('T02') });
  const reply = await must(() => replaySheetStatement(s));
  const accepted = await must(() => validateBankStatementWorkerResponse('bank-statement-reconcile', reply, s));
  assert.equal((accepted as typeof reply).result.sheet?.outcome.refusal, null);
  const altered = structuredClone(reply) as typeof reply & { result: { sheet: { outcome: { sheet: { difference: number } } } } };
  altered.result.sheet.outcome.sheet.difference += 1;
  await assert.rejects(validateBankStatementWorkerResponse('bank-statement-reconcile', altered, s), /BANK_STATEMENT_WORKER_BINDING/u);
  const saved = await must(() => saveAnyStatement(s));
  await assert.doesNotReject(validateBankStatementWorkerResponse('bank-statement-save', saved, s));
  const other = await must(() => saveAnyStatement({ ...s, sheet: { ...s.sheet, language: 'ar' } }));
  await assert.rejects(validateBankStatementWorkerResponse('bank-statement-save', other, s), /BANK_STATEMENT_WORKER_BINDING/u);
});

void test('the workbook opens on the sheet, right to left in Arabic, and stops claiming no bridge', async () => {
  for (const language of ['en', 'ar']) {
    const s = await state('T02', 'T02-NOV', { book: await ledger('T02'), language });
    const { result } = await must(() => replaySheetStatement(s));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await must(() => exportAnyStatement(s, result)));
    const [first] = book.worksheets;
    assert.equal(first.name, language === 'ar' ? 'التسوية' : 'Reconciliation');
    assert.equal(Boolean(first.views[0]?.rightToLeft), language === 'ar');
    assert.equal(first.getRow(1).getCell(3).value, SHEET);
    let claim = '';
    book.getWorksheet('Summary')!.eachRow((row) => {
      if (row.getCell(1).value === 'Claim') claim = String(row.getCell(2).value as string);
    });
    assert.doesNotMatch(claim, /no balance bridge/u);
    assert.match(claim, /closing reconciliation sheet/u);
  }
  // A lifecycle export is as it was: no sheet, and its claim.
  const s = await state('T02', 'T02-NOV');
  const plain = await must(() => replayBankStatement(plainOf(s)));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await must(() => exportAnyStatement(plain.state, plain.result)));
  assert.equal(book.worksheets[0].name, 'Summary');
});
