// Evidence producer only. Truth origin: pre-existing independently frozen
// canonical B2/B2.2 expected.json. WD is a declared synthetic input transform,
// preserving source Record IDs and absolute amounts; hashes/contexts change.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import {
  withdrawalDeposit,
  nativeFile,
} from '../../tests/helpers/bank-wd-fixtures.ts';
import { balanceFixture, balanceTruth } from '../bank-balance/fixtures.ts';
import {
  adjustmentFixture,
  adjustmentTruth,
} from '../bank-adjustment/fixtures.ts';
import {
  replayBankBalances,
  saveBankBalances,
  restoreBankBalances,
  exportBankBalances,
} from '../../lib/reconciliation/bank-balance-io.ts';
import {
  replayBankAdjustments,
  saveBankAdjustments,
  restoreBankAdjustments,
  exportBankAdjustments,
} from '../../lib/reconciliation/bank-adjustment-io.ts';
const output = resolve(
  process.argv[2] ??
    `../evidence/bank-wd-lifecycle/attempt-${new Date().toISOString().replaceAll(':', '-')}`,
);
await mkdir(output, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = {
  sample: 'synthetic-not-field',
  actualBrowser: false,
  truthOrigin:
    'audit/bank-balance/frozen/expected.json and audit/bank-adjustment/frozen/expected.json, pre-existing independent frozen canonical truths; WD transform only; no expected value derived from product',
  transform:
    'Drop Cash direction and Amount, add Withdrawal/Deposit, active positive amount unchanged, inactive alternates truly blank/explicit zero. Preserve Record ID and all other values. Regenerate review context only after original source hash changes.',
  truthFiles: [],
  cases: [],
};
for (const path of [
  'audit/bank-balance/frozen/expected.json',
  'audit/bank-adjustment/frozen/expected.json',
])
  report.truthFiles.push({ path, sha256: hash(await readFile(path)) });
async function artifact(folder, name, bytes) {
  const content = Buffer.from(bytes);
  await writeFile(join(folder, name), content);
  return { name, bytes: content.length, sha256: hash(content) };
}
async function sources(folder, files) {
  const rows = [];
  for (const [index, file] of files.entries())
    rows.push({
      index,
      originalName: file.name,
      sourceSHA256: file.sha256,
      recordIds: file.sheets[0].rows.slice(1).map((r) => r[0]),
      ...(await artifact(folder, `${index}-${file.name}`, file.original)),
    });
  return rows;
}
for (const c of balanceTruth.cases.filter((c) => !c.reject)) {
  const state = await balanceFixture(c.name);
  state.bank = await withdrawalDeposit(state.bank);
  const fresh = await replayBankBalances(state),
    r = fresh.result;
  assert.equal(r.status, c.status, c.name);
  assert.deepEqual(r.differences, c.differences);
  assert.deepEqual(
    r.components.map((v) => v.residual),
    c.components.map((v) => v.residual),
  );
  const folder = join(output, `b2-${c.name}`);
  await mkdir(folder);
  const session = await saveBankBalances(state),
    restored = await restoreBankBalances(session);
  assert.deepEqual(restored.result, r);
  report.cases.push({
    domain: 'B2',
    name: c.name,
    truthCase: c.name,
    sources: await sources(folder, [...state.bank.files, ...state.files]),
    artifacts: [
      await artifact(folder, 'session.json', session),
      await artifact(folder, 'direct.xlsx', await exportBankBalances(state, r)),
      await artifact(
        folder,
        'restored.xlsx',
        await exportBankBalances(restored.state, restored.result),
      ),
      await artifact(
        folder,
        'actual-result.json',
        Buffer.from(JSON.stringify(r, null, 2) + '\n'),
      ),
    ],
    expected: c,
    actual: {
      status: r.status,
      components: r.components,
      differences: r.differences,
      sourceIDs: r.bank.records.map((v) => v.id),
      events: r.bank.events,
      context: r.bank.context,
    },
  });
}
const cases = [
  'closing-outflow',
  'closing-inflow',
  'old-carried',
  'old-cleared',
  'old-correction-carried',
  'pending',
  'undo',
  'reject',
  'reject-undo-accept',
  'carry-undo',
  'isolated-own-bridge-gap',
  'settlement-cannot-hide-policy',
  'settlement-cannot-hide-undo',
  'wrong-clearing-sign',
  'amount-not-proof',
  'wrong-current-record',
];
for (const native of [false, true])
  for (const name of native ? cases.slice(0, 5) : cases) {
    const c = adjustmentTruth.cases.find((c) => c.name === name);
    const state = await adjustmentFixture(name);
    state.balance.bank = await withdrawalDeposit(state.balance.bank);
    if (native) {
      state.balance.bank.files = await Promise.all(
        state.balance.bank.files.map(nativeFile),
      );
      state.balance.files = await Promise.all(
        state.balance.files.map(nativeFile),
      );
      state.files = await Promise.all(state.files.map(nativeFile));
    }
    let r = (await replayBankAdjustments(state)).result;
    if (!c.invalid)
      for (const [index, type] of c.actions.entries())
        for (const l of r.lifecycles) {
          state.events.push({
            id: `${index}-${l.id}`,
            type,
            context: r.context,
            at: '2026-10-10T12:00:00.000Z',
            reference: 'Synthetic independently frozen original truth',
            note: 'Complete lifecycle from six original sources reviewed',
            itemIds: l.itemIds,
          });
          r = (await replayBankAdjustments(state)).result;
        }
    assert.equal(r.status, c.status, name);
    assert.deepEqual(
      r.balance.components.map((v) => v.residual),
      c.residual,
    );
    for (const e of r.endpoints) {
      assert.deepEqual([e.rawBank, e.rawCash], c.raw[e.point]);
      assert.deepEqual(
        [e.bankAdjustment, e.cashAdjustment],
        c.invalid ? [null, null] : c.adjustments[e.point],
      );
      assert.deepEqual(
        [e.adjustedBank, e.adjustedCash],
        c.invalid ? [null, null] : c.adjusted[e.point],
      );
      assert.equal(e.difference, c.invalid ? null : c.differences[e.point]);
    }
    const folder = join(output, `b22-${native ? 'native-' : 'csv-'}${name}`);
    await mkdir(folder);
    const session = await saveBankAdjustments(state),
      restored = await restoreBankAdjustments(session);
    assert.deepEqual(restored.result, r);
    report.cases.push({
      domain: 'B2.2',
      name,
      native,
      truthCase: name,
      sources: await sources(folder, [
        ...state.balance.bank.files,
        ...state.balance.files,
        ...state.files,
      ]),
      artifacts: [
        await artifact(folder, 'session.json', session),
        await artifact(
          folder,
          'direct.xlsx',
          await exportBankAdjustments(state, r),
        ),
        await artifact(
          folder,
          'restored.xlsx',
          await exportBankAdjustments(restored.state, restored.result),
        ),
        await artifact(
          folder,
          'actual-result.json',
          Buffer.from(JSON.stringify(r, null, 2) + '\n'),
        ),
      ],
      expected: c,
      actual: {
        status: r.status,
        endpoints: r.endpoints,
        residual: r.balance.components.map((v) => v.residual),
        sourceIDs: r.balance.bank.records.map((v) => v.id),
        movementEvents: r.balance.bank.events,
        events: r.events,
        lifecycles: r.lifecycles,
        context: r.context,
      },
    });
  }
await writeFile(
  join(output, 'REPORT.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    output,
    cases: report.cases.length,
    allPassed: true,
    truthOrigin: report.truthOrigin,
  }),
);
