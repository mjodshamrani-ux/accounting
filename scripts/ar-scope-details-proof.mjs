// Integration driver: emits actual product artifacts for a separate raw checker.
// It never imports manual truth, oracle output, or the independent checker.
import assert from 'node:assert/strict';
import {
  readFile as fsRead,
  writeFile,
  mkdir,
  readdir,
} from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  reconcileAr,
  suggestArScopeReading,
} from '../lib/reconciliation/ar.ts';
import {
  replayAr,
  saveAr,
  restoreAr,
  exportAr,
} from '../lib/reconciliation/ar-io.ts';

const fixtures = path.resolve(
  process.env.AR_SCOPE_DETAILS_FIXTURE_DIR || 'audit/ar-scope-details/fixtures',
);
const out = path.resolve(
  process.env.AR_SCOPE_DETAILS_REPORT_DIR || 'work/ar-scope-details-proof',
);
const ab = (bytes) => Uint8Array.from(bytes).buffer;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = {
  schema: 'ar-scope-details-1',
  syntheticOnly: true,
  fieldOriginals: 0,
  productDerivedExpectations: false,
  fixtures,
  cases: [],
  lifecycle: [],
  lifecycleRejections: [],
  passed: false,
};
await mkdir(out, { recursive: true });
const role = (side) =>
  side ? 'company-issued-customer-statement' : 'company-ar-ledger';
function legacyReading(file, side) {
  const header = file.sheets[0].rows[0];
  const fields = {
    posting: 'Posting ID',
    kind: 'Document type',
    document: 'Own document number',
    date: 'Posting date',
    amount: 'Original signed amount',
    entity: 'Entity',
    ledger: 'Ledger',
    customer: 'Customer',
    account: 'Account',
    currency: 'Currency',
    related: 'Related invoice',
    description: 'Description',
  };
  return {
    sheet: 0,
    header: 0,
    ...Object.fromEntries(
      Object.entries(fields).map(([k, label]) => [k, header.indexOf(label)]),
    ),
    role: role(side),
    perspective: 'seller-receivable',
    basis: 'original-movement',
    confirmed: true,
  };
}
async function load(id) {
  const directory = path.join(fixtures, id),
    bundle = JSON.parse(
      await fsRead(path.join(directory, 'bundle.json'), 'utf8'),
    );
  const files = [];
  for (const name of bundle.files)
    files.push(
      await readFile(name, ab(await fsRead(path.join(directory, name)))),
    );
  const readings = files.map((file, side) => {
    const reading =
      bundle.families[side] === 'ar-scope-details-1'
        ? {
            ...suggestArScopeReading(file, side, bundle.sheets[side]),
            confirmed: bundle.readingConfirmed[side],
          }
        : legacyReading(file, side);
    if (bundle.selectedAmountHeaders?.[side])
      reading.amount = file.sheets[reading.sheet].rows[reading.header].indexOf(
        bundle.selectedAmountHeaders[side],
      );
    return reading;
  });
  return {
    bundle,
    input: { files, readings, scope: bundle.scope, events: [] },
  };
}
async function emit(id, input, bundle, collection = report.cases) {
  const folder = path.join(
      collection === report.cases ? 'cases' : 'lifecycle',
      id,
    ),
    directory = path.join(out, folder);
  await mkdir(directory, { recursive: true });
  const entry = {
    id,
    bundle:
      collection === report.cases
        ? path.join(fixtures, id, 'bundle.json')
        : null,
    input: `${folder}/input.json`,
    files: [],
    artifacts: {},
    status: 'pending',
  };
  collection.push(entry);
  const saveArtifact = async (name, bytes) => {
    const data =
      typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes);
    await writeFile(path.join(directory, name), data);
    entry.artifacts[name] = {
      path: `${folder}/${name}`,
      sha256: sha(data),
      bytes: data.byteLength,
    };
    return `${folder}/${name}`;
  };
  for (const [side, file] of input.files.entries()) {
    const name = `source-${side}${path.extname(file.name)}`;
    await saveArtifact(name, file.original);
    entry.files.push({
      side,
      name: file.name,
      path: `${folder}/${name}`,
      sha256: sha(Buffer.from(file.original)),
    });
  }
  await saveArtifact(
    'input.json',
    JSON.stringify(
      {
        ...bundle,
        files: input.files.map((f) => f.name),
        families: input.readings.map((r) => r.family || 'ar-limited-1'),
        readings: input.readings,
        scope: input.scope,
        events: input.events,
        sourcePaths: entry.files.map((f) => f.path),
      },
      null,
      2,
    ) + '\n',
  );
  let stage = 'replay';
  try {
    const { state, result } = await replayAr(input);
    entry.result = await saveArtifact(
      'result.json',
      JSON.stringify(result, null, 2) + '\n',
    );
    stage = 'save';
    const session = await saveAr(state);
    entry.session = await saveArtifact('session.json', session);
    stage = 'restore';
    const restored = await restoreAr(session);
    assert.deepEqual(restored.result, result, `${id}: save/restore`);
    entry.restored = await saveArtifact(
      'restored.json',
      JSON.stringify(restored.result, null, 2) + '\n',
    );
    stage = 'export';
    entry.export = await saveArtifact(
      'export.xlsx',
      await exportAr(restored.state, restored.result),
    );
    entry.status = 'completed';
    entry.resultStatus =
      result.status ||
      (result.cases.every((c) => c.status === 'matched')
        ? 'matched'
        : 'review');
    entry.matchedPairs = result.cases.filter(
      (c) => c.status === 'matched',
    ).length;
    entry.movements = result.rows.length;
    entry.inventoryRecords = result.inventory.length;
    return { state: restored.state, result: restored.result, entry };
  } catch (error) {
    entry.status = 'rejected';
    entry.stage = stage;
    entry.error = error.message;
    await saveArtifact(
      'rejection.json',
      JSON.stringify({ stage, code: error.message }, null, 2) + '\n',
    );
    return { entry };
  }
}
const dirs = (await readdir(fixtures, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
for (const id of dirs) {
  try {
    const { input, bundle } = await load(id);
    await emit(id, input, bundle);
  } catch (error) {
    report.cases.push({
      id,
      bundle: path.join(fixtures, id, 'bundle.json'),
      status: 'rejected',
      stage: 'read',
      error: error.message,
    });
  }
}
const { input: matchedInput, bundle: matchedBundle } = await load(
  'one-invoice-open-differs',
);
const matched = await emit(
  'matched',
  matchedInput,
  matchedBundle,
  report.lifecycle,
);
assert.ok(matched.state, 'matched lifecycle prerequisites');
const decision = (state, action) => ({
  context: reconcileAr(state).context,
  at: '2026-10-11T00:00:00.000Z',
  action,
  ids: reconcileAr(state).cases[0].ids,
  note: 'Synthetic document correspondence reviewed',
});
const reopenedInput = structuredClone(matched.state);
reopenedInput.events.push(decision(reopenedInput, 'reopen'));
const reopened = await emit(
  'reopened',
  reopenedInput,
  matchedBundle,
  report.lifecycle,
);
assert.equal(reopened.result.cases[0].reason, 'reopened');
const acceptedInput = structuredClone(reopened.state);
acceptedInput.events.push(decision(acceptedInput, 'accept'));
const accepted = await emit(
  'human-confirmation',
  acceptedInput,
  matchedBundle,
  report.lifecycle,
);
assert.equal(accepted.result.cases[0].basis, 'human-confirmation');
for (const [id, source] of [
  ['review', 'date-difference'],
  ['source-error', 'late-invalid-competitor'],
  ['mixed-new-legacy', 'mixed-new-canonical'],
  ['empty-review', 'empty-source-review'],
]) {
  const { input, bundle } = await load(source);
  await emit(id, input, bundle, report.lifecycle);
}
const nativeInput = structuredClone(matched.state);
const nativeBook = new ExcelJS.Workbook();
nativeBook
  .addWorksheet('Synthetic native original')
  .addRows(nativeInput.files[1].sheets[0].rows);
nativeInput.files[1] = await readFile(
  'statement-native.xlsx',
  ab(await nativeBook.xlsx.writeBuffer()),
);
nativeInput.readings[1] = {
  ...suggestArScopeReading(nativeInput.files[1], 1),
  confirmed: true,
};
await emit('mixed-native-csv', nativeInput, matchedBundle, report.lifecycle);
const legacy = structuredClone(matched.state);
for (const side of [0, 1]) {
  const row = legacy.files[side].sheets[0].rows[15];
  const rows = [
    [
      'Posting ID',
      'Document type',
      'Own document number',
      'Posting date',
      'Original signed amount',
      'Entity',
      'Ledger',
      'Customer',
      'Account',
      'Currency',
      'Related invoice',
      'Description',
    ],
    [
      row[1],
      row[2],
      row[3],
      row[4],
      row[5],
      legacy.scope.entity,
      legacy.scope.ledger,
      legacy.scope.customer,
      legacy.scope.account,
      legacy.scope.currency,
      row[6],
      row[8],
    ],
  ];
  legacy.files[side] = await readFile(
    `legacy-${side}.csv`,
    new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n') + '\n')
      .buffer,
  );
  legacy.readings[side] = legacyReading(legacy.files[side], side);
}
const legacyEmitted = await emit(
  'legacy-session',
  legacy,
  matchedBundle,
  report.lifecycle,
);
assert.equal(legacyEmitted.result.version, 'ar-limited-1');
async function reject(id, run, pattern) {
  try {
    await run();
    throw new Error(`${id}: accepted forbidden mutation`);
  } catch (error) {
    assert.match(error.message, pattern, id);
    report.lifecycleRejections.push({ id, code: error.message });
  }
}
const envelope = JSON.parse(
  await fsRead(path.join(out, accepted.entry.session), 'utf8'),
);
await reject(
  'cached-result',
  () =>
    restoreAr(
      new TextEncoder().encode(
        JSON.stringify({ ...envelope, result: accepted.result }),
      ).buffer,
    ),
  /AR_SESSION/,
);
await reject(
  'version-only-migration',
  () =>
    restoreAr(
      new TextEncoder().encode(
        JSON.stringify({ ...envelope, version: 'ar-limited-1' }),
      ).buffer,
    ),
  /AR_SESSION/,
);
const wrongHash = structuredClone(envelope);
wrongHash.files[0].sha256 = '0'.repeat(64);
await reject(
  'forged-hash',
  () => restoreAr(new TextEncoder().encode(JSON.stringify(wrongHash)).buffer),
  /AR_SOURCE_HASH/,
);
const changedOpen = structuredClone(accepted.state);
changedOpen.files[0] = await readFile(
  changedOpen.files[0].name,
  new TextEncoder().encode(
    new TextDecoder()
      .decode(changedOpen.files[0].original)
      .replace(',40,', ',39,'),
  ).buffer,
);
await reject(
  'changed-open-invalidates-event',
  () => replayAr(changedOpen),
  /AR_DECISION/,
);
const changedReading = structuredClone(accepted.state);
changedReading.readings[0].description = -1;
await reject(
  'changed-reading-invalidates-event',
  () => replayAr(changedReading),
  /AR_DECISION/,
);
report.completedCases = report.cases.filter(
  (c) => c.status === 'completed',
).length;
report.rejectedCases = report.cases.filter(
  (c) => c.status === 'rejected',
).length;
report.passed =
  report.cases.length === 75 &&
  report.lifecycle.every((c) => c.status === 'completed');
await writeFile(
  path.join(out, 'evidence-index.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    cases: report.cases.length,
    completed: report.completedCases,
    rejected: report.rejectedCases,
    lifecycle: report.lifecycle.length,
    lifecycleRejections: report.lifecycleRejections.length,
    passed: report.passed,
    out,
  }),
);
assert.equal(report.passed, true);
