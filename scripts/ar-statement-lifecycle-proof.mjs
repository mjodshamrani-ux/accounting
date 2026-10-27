// AR-1 PDF A3: the printed customer statement through the AR lifecycle, from
// original bytes only. For each sealed story: replay from the two originals,
// equal to the engine on the A1 reading; save and restore to the same state and
// result; export a workpaper and have the independent Python checker judge it
// against the sealed files, EXPECTED.json and the oracle's reading. Then a
// recorded decision through save, restore and export; the worker binding,
// which must refuse a reply that differs from the replay; refusals of changed
// bytes, a foreign session version and a decision from another statement;
// and the checker itself, which must refuse planted faults in a workpaper.
//   node --experimental-strip-types scripts/ar-statement-lifecycle-proof.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/ar-statement-foundation');
const frozen = path.join(suite, 'frozen');
const out = path.resolve(
  process.env.AR_STATEMENT_A3_DIR || path.join(root, 'work/ar-statement-a3'),
);
const lib = (name) => import(path.join(root, 'lib/reconciliation', name));
const { replayAr, saveAr, restoreAr, exportAr } = await lib('ar-io.ts');
const { reconcileArStatement } = await lib('ar.ts');
const { readArFile } = await lib('ar-source.ts');
const { readNativePdfWordSource } = await lib('pdf.ts');
const { readArStatementPdf } = await lib('ar-statement-pdf.ts');
const { snapshotArRequest, validateArWorkerResponse } = await lib(
  'ar-worker-binding.ts',
);

await mkdir(out, { recursive: true });
const facts = JSON.parse(
  await readFile(path.join(frozen, 'stories.json'), 'utf8'),
);
const bytes = async (name) =>
  Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const sha = (buffer) =>
  createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
const statementReading = {
  family: 'ar-statement-pdf-1',
  role: 'company-issued-customer-statement',
  perspective: 'seller-receivable',
  basis: 'original-movement',
  confirmed: true,
};
const ledgerReading = (header) => {
  const at = (name) => header.indexOf(name);
  return {
    sheet: 0,
    header: 0,
    posting: at('Posting ID'),
    kind: at('Document type'),
    document: at('Own document number'),
    date: at('Posting date'),
    amount: at('Original signed amount'),
    entity: at('Entity'),
    ledger: at('Ledger'),
    customer: at('Customer'),
    account: at('Account'),
    currency: at('Currency'),
    related: at('Related invoice'),
    description: at('Description'),
    role: 'company-ar-ledger',
    perspective: 'seller-receivable',
    basis: 'original-movement',
    confirmed: true,
  };
};
async function inputOf(story, events = []) {
  const ledger = await bytes(`${story.id}-ledger.csv`);
  const statement = await bytes(`${story.id}-statement.pdf`);
  const header = (await readArFile(`${story.id}-ledger.csv`, ledger.slice(0)))
    .sheets[0].rows[0];
  return {
    files: [
      { name: `${story.id}-ledger.csv`, sha256: sha(ledger), original: ledger },
      {
        name: `${story.id}-statement.pdf`,
        sha256: sha(statement),
        original: statement,
      },
    ],
    readings: [ledgerReading(header), { ...statementReading }],
    scope: { ...story.scope, confirmed: true },
    events,
  };
}
const check = (id, file, reopened = []) =>
  JSON.parse(
    execFileSync(
      'python3',
      [
        '-B',
        path.join(suite, 'check_export.py'),
        id,
        file,
        ...(reopened.length ? ['--reopened', ...reopened] : []),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
const refuses = (id, file, reopened = []) => {
  try {
    check(id, file, reopened);
    return false;
  } catch {
    return true;
  }
};
const json = (value) => JSON.stringify(value);

const stories = [];
for (const story of facts.stories) {
  const input = await inputOf(story);
  const { state, result } = await replayAr(input);
  // The replay equals the engine on the A1 reading of the same bytes.
  const reading = readArStatementPdf(
    await readNativePdfWordSource(input.files[1].original.slice(0)),
  );
  const ledger = await readArFile(
    input.files[0].name,
    input.files[0].original.slice(0),
  );
  const direct = reconcileArStatement({
    files: [
      ledger,
      {
        kind: 'ar-statement-pdf',
        name: input.files[1].name,
        sha256: reading.sha256,
        reading,
      },
    ],
    readings: input.readings,
    scope: input.scope,
    events: [],
  });
  assert.equal(json(result), json(direct), `${story.id} replay`);
  const session = await saveAr(input);
  const restored = await restoreAr(session);
  assert.equal(json(restored.result), json(result), `${story.id} restore`);
  const workbook = await exportAr(state, result);
  const file = path.join(out, `${story.id}.xlsx`);
  await writeFile(file, new Uint8Array(workbook));
  stories.push({ id: story.id, status: result.status, ...check(story.id, file) });
}

// A recorded decision: reopen one automatic match, then save, restore, export.
const a01 = facts.stories.find((s) => s.id === 'A01');
const first = await replayAr(await inputOf(a01));
const target = first.result.cases.find((c) => c.document === 'INV-1001');
const decided = await inputOf(a01, [
  {
    context: first.result.context,
    at: '2026-10-27T09:00:00.000Z',
    action: 'reopen',
    ids: target.ids,
    note: 'Customer disputes the invoice date',
  },
]);
const reopened = await restoreAr(await saveAr(decided));
assert.deepEqual(
  [reopened.result.cases.find((c) => c.document === 'INV-1001')].map((c) => [
    c.status,
    c.reason,
    c.note,
  ]),
  [['review', 'reopened', 'Customer disputes the invoice date']],
);
const decisionFile = path.join(out, 'A01-reopened.xlsx');
await writeFile(
  decisionFile,
  new Uint8Array(await exportAr(reopened.state, reopened.result)),
);
const decision = check('A01', decisionFile, ['INV-1001']);
assert.equal(refuses('A01', decisionFile), true, 'a decision the checker was not told of');

// The worker binding replays the request and refuses any other reply.
const binding = {};
for (const action of ['ar-reconcile', 'ar-save', 'ar-export']) {
  const input = await inputOf(a01);
  const replay = await replayAr(input);
  const payload =
    action === 'ar-export'
      ? snapshotArRequest(action, { state: replay.state, result: replay.result })
      : snapshotArRequest(action, input);
  const value =
    action === 'ar-reconcile'
      ? replay
      : action === 'ar-save'
        ? await saveAr(input)
        : await exportAr(replay.state, replay.result);
  await validateArWorkerResponse(action, value, payload);
  binding[action] = 'accepted';
}
{
  const input = await inputOf(a01);
  const replay = await replayAr(input);
  const forged = structuredClone(replay);
  forged.result.cases[0].reason = 'exact-own-document';
  forged.result.cases[0].status = 'matched';
  forged.result.cases.find((c) => c.document === 'INV-1001').status = 'review';
  await assert.rejects(
    validateArWorkerResponse(
      'ar-reconcile',
      forged,
      snapshotArRequest('ar-reconcile', input),
    ),
    /AR_WORKER_BINDING/,
  );
  binding.forgedReply = 'refused';
}

// Refusals: changed statement bytes, a foreign session version, a decision
// made on another statement.
const refusals = {};
{
  const session = JSON.parse(
    new TextDecoder().decode(await saveAr(await inputOf(a01))),
  );
  const changed = structuredClone(session);
  const pdf = Buffer.from(changed.files[1].data, 'base64');
  pdf[pdf.length - 2] ^= 1;
  changed.files[1].data = pdf.toString('base64');
  await assert.rejects(
    restoreAr(new TextEncoder().encode(json(changed)).buffer),
    /AR_SOURCE_HASH/,
  );
  refusals.changedBytes = 'refused';
  const foreign = { ...session, version: 'ar-limited-1' };
  await assert.rejects(
    restoreAr(new TextEncoder().encode(json(foreign)).buffer),
    /AR_SESSION/,
  );
  refusals.foreignVersion = 'refused';
  const a03 = facts.stories.find((s) => s.id === 'A03');
  const other = await replayAr(await inputOf(a03));
  const elsewhere = await inputOf(a01, [
    {
      context: other.result.context,
      at: '2026-10-27T09:00:00.000Z',
      action: 'reopen',
      ids: target.ids,
      note: 'Decision recorded on another statement',
    },
  ]);
  await assert.rejects(replayAr(elsewhere), /AR_DECISION/);
  refusals.foreignDecision = 'refused';
}

// The checker refuses planted faults in a correct workpaper.
const planted = {};
{
  const base = path.join(out, 'A03.xlsx');
  assert.equal(refuses('A03', base), false, 'the unplanted workpaper');
  const plant = async (name, edit) => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(base);
    edit(book);
    const file = path.join(out, `plant-${name}.xlsx`);
    await book.xlsx.writeFile(file);
    planted[name] = refuses('A03', file) ? 'refused' : 'ACCEPTED';
  };
  const rowWhere = (sheet, column, predicate) => {
    const header = sheet.getRow(1).values;
    const at = header.indexOf(column);
    for (let r = 2; r <= sheet.rowCount; r++)
      if (predicate(String(sheet.getRow(r).getCell(at).value ?? '')))
        return { row: sheet.getRow(r), at };
    throw Error(`no row in ${sheet.name} ${column}`);
  };
  await plant('printed-line-dropped', (book) =>
    book.getWorksheet('Statement inventory').spliceRows(3, 1),
  );
  await plant('out-of-scope-line-as-movement', (book) => {
    const s = book.getWorksheet('Statement inventory');
    const { row } = rowWhere(s, 'Classification', (v) => v === 'out-of-scope');
    const header = s.getRow(1).values;
    row.getCell(header.indexOf('Classification')).value = 'detail';
    row.getCell(header.indexOf('Kind')).value = 'movement';
  });
  await plant('section-compared-flag', (book) => {
    const s = book.getWorksheet('Statement sections');
    const header = s.getRow(1).values;
    const cell = s.getRow(3).getCell(header.indexOf('Compared'));
    cell.value = cell.value === true || cell.value === 'true' ? 'false' : 'true';
  });
  await plant('case-reason', (book) => {
    const s = book.getWorksheet('Cases');
    const header = s.getRow(1).values;
    s.getRow(2).getCell(header.indexOf('Reason')).value = 'missing-counterpart';
  });
  await plant('member-moved', (book) => {
    const s = book.getWorksheet('Membership');
    s.spliceRows(2, 1);
  });
  await plant('source-byte', (book) => {
    const s = book.getWorksheet('Sources');
    const header = s.getRow(1).values;
    const { row, at } = rowWhere(s, 'Side', (v) => v === '1');
    const cell = row.getCell(header.indexOf('Original bytes base64'));
    const text = String(cell.value);
    cell.value = (text[0] === 'A' ? 'B' : 'A') + text.slice(1);
    void at;
  });
  await plant('scope-customer', (book) => {
    const s = book.getWorksheet('Summary');
    const { row } = rowWhere(s, 'Property', (v) => v === 'customer');
    row.getCell(2).value = 'C0002';
  });
}
assert.ok(
  Object.values(planted).every((v) => v === 'refused'),
  `checker accepted a planted fault: ${json(planted)}`,
);
console.log(
  json({
    stories: stories.length,
    checked: stories,
    decision,
    binding,
    refusals,
    planted,
  }),
);
