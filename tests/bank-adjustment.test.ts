import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFile as fsRead } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  adjustmentTruth,
  adjustmentFixture,
  finishedAdjustment,
} from '../audit/bank-adjustment/fixtures.ts';
import {
  reconcileBankAdjustments,
  type BankAdjustmentInput,
  type AdjustmentEvent,
} from '../lib/reconciliation/bank-adjustment.ts';
import {
  replayBankAdjustments,
  saveBankAdjustments,
  restoreBankAdjustments,
  exportBankAdjustments,
} from '../lib/reconciliation/bank-adjustment-io.ts';
import { reconcileBank } from '../lib/reconciliation/bank.ts';
import { readFile } from '../lib/reconciliation/io.ts';
function decision(
  input: BankAdjustmentInput,
  type: AdjustmentEvent['type'] = 'accept',
  itemIds?: string[],
) {
  const r = reconcileBankAdjustments(input);
  return {
    id: crypto.randomUUID(),
    type,
    context: r.context,
    at: '2026-10-06T12:00:00.000Z',
    reference: 'SYNTHETIC original evidence',
    note: 'Complete lifecycle members reviewed',
    itemIds: itemIds ?? r.lifecycles[0].itemIds,
  };
}
void test('B2.2 independent frozen sources preserve endpoint facts, lifecycle membership, B1 history, timing and immutability', async () => {
  for (const c of adjustmentTruth.cases) {
    const original = await adjustmentFixture(c.name),
      before = structuredClone(original);
    for (const [i, f] of c.files.entries()) {
      const p = new URL(
        `../audit/bank-adjustment/frozen/${f.file}`,
        import.meta.url,
      );
      assert.equal(
        createHash('sha256')
          .update(await fsRead(p))
          .digest('hex'),
        f.sha256,
        c.name,
      );
      assert.equal(
        [
          original.balance.bank.files[0],
          original.balance.bank.files[1],
          original.balance.files[0],
          original.balance.files[1],
          ...original.files,
        ][i].sha256,
        f.sha256,
      );
    }
    if (c.reject) {
      await assert.rejects(
        () => finishedAdjustment(c.name),
        new RegExp(c.reject),
      );
      continue;
    }
    const { state, result: r } = await finishedAdjustment(c.name);
    assert.equal(r.status, c.status, c.name);
    assert.deepEqual(original, before);
    assert.deepEqual(r.balance.bank, reconcileBank(state.balance.bank));
    assert.deepEqual(
      r.balance.components.map((x) => x.residual),
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
    if (!c.invalid) {
      assert.deepEqual(
        r.items.map((i) => i.reference),
        c.itemIds,
      );
      assert.deepEqual(
        r.proofs.map((i) => i.reference),
        c.proofIds,
      );
      assert.equal(
        new Set(r.lifecycles.flatMap((l) => l.itemIds)).size,
        r.items.length,
      );
      assert.equal(
        new Set(r.lifecycles.flatMap((l) => l.proofIds)).size,
        r.proofs.length,
      );
    }
    assert.equal(
      r.inventory.length,
      c.itemRows.length + c.proofRows.length + 2,
    );
    for (const record of [...r.items, ...r.proofs])
      assert.equal(record.cells.length, 'proofReference' in record ? 12 : 15);
  }
});
void test('B2.2 complete lifecycle accept reject undo is atomic and rejects stale, repeated, malformed and evidence-free events', async () => {
  const base = await adjustmentFixture('old-carried'),
    event = decision(base);
  for (const change of [
    () => {
      event.itemIds = event.itemIds.slice(0, 1);
    },
    () => {
      event.itemIds = [event.itemIds[0], event.itemIds[0]];
    },
    () => {
      event.note = '';
    },
    () => {
      event.reference = '';
    },
    () => {
      event.context += 'stale';
    },
    () => {
      event.at = '2026-02-30T12:00:00.000Z';
    },
    () => {
      Object.assign(event, { result: true });
    },
  ]) {
    const e = structuredClone(event);
    change();
    assert.throws(
      () => reconcileBankAdjustments({ ...base, events: [event] }),
      /ADJUSTMENT_/,
    );
    Object.keys(event).forEach(
      (k) => delete (event as unknown as Record<string, unknown>)[k],
    );
    Object.assign(event, e);
  }
  const accepted = { ...base, events: [event] };
  assert.equal(
    reconcileBankAdjustments(accepted).status,
    'reconciled-with-evidence',
  );
  assert.throws(
    () =>
      reconcileBankAdjustments({
        ...accepted,
        events: [event, { ...event, id: 'repeat' }],
      }),
    /EVENT_STATE/,
  );
  assert.throws(
    () => reconcileBankAdjustments({ ...accepted, events: [event, event] }),
    /EVENT/,
  );
  const undone = { ...accepted, events: [event, decision(accepted, 'undo')] };
  assert.equal(reconcileBankAdjustments(undone).status, 'needs-review');
  const rejected = {
    ...undone,
    events: [...undone.events, decision(undone, 'reject')],
  };
  assert.equal(
    reconcileBankAdjustments(rejected).lifecycles[0].status,
    'rejected',
  );
  assert.throws(
    () =>
      reconcileBankAdjustments({
        ...rejected,
        events: [...rejected.events, decision(rejected)],
      }),
    /EVENT_STATE/,
  );
  for (const c of adjustmentTruth.cases.filter(
    (c: { invalid: boolean }) => c.invalid,
  )) {
    const state = await adjustmentFixture(c.name),
      r = reconcileBankAdjustments(state);
    assert.throws(
      () =>
        reconcileBankAdjustments({
          ...state,
          events: [
            {
              ...event,
              context: r.context,
              itemIds: r.items.slice(0, 1).map((i) => i.id),
            },
          ],
        }),
      /EVENT/,
    );
  }
});
void test('B2.2 B1 policy conflicts and undo cannot be erased by complete settlements or equal adjusted balances', async () => {
  for (const name of [
    'settlement-cannot-hide-policy',
    'settlement-cannot-hide-undo',
  ]) {
    const { result } = await finishedAdjustment(name);
    assert.deepEqual(
      result.endpoints.map((e) => e.difference),
      [0, 0],
    );
    assert.deepEqual(
      result.balance.components.map((c) => c.residual),
      [0, 0],
    );
    assert.equal(result.status, 'needs-review');
    assert.equal(result.unresolved.length, 1);
    assert.equal(result.lifecycles.length, 2);
    assert.ok(result.lifecycles.every((l) => l.status === 'accepted'));
  }
  const state = await adjustmentFixture('settlement-cannot-hide-undo');
  state.balance.bank.events = [];
  let r = reconcileBankAdjustments(state);
  for (const l of r.lifecycles) {
    state.events.push(decision(state, 'accept', l.itemIds));
    r = reconcileBankAdjustments(state);
  }
  assert.equal(r.status, 'reconciled-with-evidence');
  const b = reconcileBank(state.balance.bank),
    g = b.cases[0];
  state.balance.bank.events = [
    {
      id: 'later-original-undo',
      type: 'undo',
      context: b.context,
      at: '2026-10-06T13:00:00.000Z',
      reference: 'Original B1',
      note: 'Undo original movement approval',
      bankIds: g.bankIds,
      cashIds: g.cashIds,
    },
  ];
  assert.throws(() => reconcileBankAdjustments(state), /EVENT/);
});
void test('B2.2 completeness, role, perspective, source scope, null balances and isolated raw bridge remain gates', async () => {
  for (const change of [
    (s: BankAdjustmentInput) => {
      s.completeness.confirmed = false;
    },
    (s: BankAdjustmentInput) => {
      s.readings[0].confirmed = false;
    },
    (s: BankAdjustmentInput) => {
      s.readings[1].role = s.readings[0].role;
    },
    (s: BankAdjustmentInput) => {
      Object.assign(s.completeness, { closure: true });
    },
  ]) {
    const s = await adjustmentFixture();
    change(s);
    assert.throws(() => reconcileBankAdjustments(s), /ADJUSTMENT_/);
  }
  const { result } = await finishedAdjustment('isolated-own-bridge-gap');
  assert.deepEqual(
    result.endpoints.map((e) => e.difference),
    [0, 0],
  );
  assert.deepEqual(
    result.balance.components.map((c) => c.residual),
    [-1, 0],
  );
  assert.equal(result.status, 'inconsistent');
  const s = await adjustmentFixture('equal-empty');
  s.balance.files[0].sheets[0].rows.pop();
  const missing = reconcileBankAdjustments(s);
  assert.equal(missing.status, 'missing');
  assert.equal(missing.endpoints[1].rawBank, null);
  assert.equal(missing.endpoints[1].adjustedBank, null);
});
void test('B2.2 native dates and signed money preserve column evidence; formulas, hidden data, misleading identity and reordered headers stay safe', async () => {
  const base = await adjustmentFixture(),
    convert = async (
      source: number,
      edit?: (sheet: ExcelJS.Worksheet) => void,
    ) => {
      const old = base.files[source],
        book = new ExcelJS.Workbook(),
        sheet = book.addWorksheet('Evidence');
      for (const [i, row] of old.sheets[0].rows.entries())
        sheet.addRow(
          row.map((v, k) =>
            i
              ? k === (source ? 14 : 4)
                ? Number(v)
                : source && [5, 6, 12, 13].includes(k)
                  ? new Date(`${v}T00:00:00.000Z`)
                  : v
              : v,
          ),
        );
      sheet.getColumn(source ? 15 : 5).numFmt = '0.00';
      if (edit) edit(sheet);
      const data = new Uint8Array(await book.xlsx.writeBuffer()).buffer;
      return readFile(`source-${source}.xlsx`, data);
    };
  const files = [
      await convert(0),
      await convert(1),
    ] as BankAdjustmentInput['files'],
    state = { ...base, files };
  state.events = [decision(state)];
  assert.equal(
    reconcileBankAdjustments(state).status,
    'reconciled-with-evidence',
  );
  assert.equal(reconcileBankAdjustments(state).proofs[0].amount, -10000);
  for (const edit of [
    (s: ExcelJS.Worksheet) => {
      s.getCell('O2').value = { formula: '-100', result: -100 };
    },
    (s: ExcelJS.Worksheet) => {
      s.getRow(2).hidden = true;
    },
    (s: ExcelJS.Worksheet) => {
      s.getCell('A2').value = 123;
      s.getCell('A2').numFmt = '"P1"';
    },
  ]) {
    const input = {
      ...base,
      files: [files[0], await convert(1, edit)] as BankAdjustmentInput['files'],
    };
    assert.equal(reconcileBankAdjustments(input).status, 'source-error');
  }
  const reordered = await adjustmentFixture();
  for (const f of reordered.files) {
    const rows = f.sheets[0].rows;
    for (const row of rows) {
      const last = row.pop()!;
      row.unshift(last);
    }
  }
  const r = reconcileBankAdjustments(reordered);
  assert.equal(r.status, 'needs-review');
  assert.equal(
    r.proofs[0].cells.find((c) => c.field === 'Signed amount')!.column,
    1,
  );
});
void test('B2.2 replay and sessions ignore forged valid cache, retain decisions and reject stale exports and tampered original bytes', async () => {
  const { state, result } = await finishedAdjustment(),
    tampered = structuredClone(state);
  tampered.files[0].sheets[0].rows[1][4] = '-99.99';
  let replay!: Awaited<ReturnType<typeof replayBankAdjustments>>;
  await assert.doesNotReject(async () => {
    replay = await replayBankAdjustments(tampered);
  });
  assert.deepEqual(replay.result, result);
  const session = await saveBankAdjustments(tampered),
    restored = await restoreBankAdjustments(session);
  assert.deepEqual(restored.result, result);
  assert.deepEqual(restored.result.events, result.events);
  await exportBankAdjustments(restored.state, restored.result);
  const payload = JSON.parse(new TextDecoder().decode(session));
  assert.equal('result' in payload, false);
  for (const edit of [
    (p: typeof payload) => {
      p.files[0].sha256 = '0'.repeat(64);
    },
    (p: typeof payload) => {
      p.files[1].data = btoa('changed');
    },
    (p: typeof payload) => {
      p.events[0].context += 'stale';
    },
    (p: typeof payload) => {
      p.result = result;
    },
  ]) {
    const p = structuredClone(payload);
    edit(p);
    await assert.rejects(() =>
      restoreBankAdjustments(
        new TextEncoder().encode(JSON.stringify(p)).buffer,
      ),
    );
  }
  const stale = structuredClone(result);
  stale.endpoints[1].difference = 1;
  await assert.rejects(
    () => exportBankAdjustments(state, stale),
    /STALE_EXPORT/,
  );
  const forged = structuredClone(state);
  forged.balance.bank.files[1].sheets[0].rows[1][16] = '99.99';
  forged.balance.files[1].sheets[0].rows[2][11] = '1900.01';
  forged.files[0].sheets[0].rows[1][4] = '-99.99';
  forged.files[1].sheets[0].rows[1][14] = '-99.99';
  const staleCache = reconcileBankAdjustments(forged);
  assert.equal(staleCache.status, 'reconciled-with-evidence');
  assert.notDeepEqual(staleCache.endpoints, result.endpoints);
  assert.deepEqual((await replayBankAdjustments(forged)).result, result);
  await assert.rejects(
    () => exportBankAdjustments(forged, staleCache),
    /STALE_EXPORT/,
  );
});
void test('B2.2 sums full accepted endpoint membership before enforcing the final bound; large intermediate cancellations are retained', async () => {
  const state = await adjustmentFixture('old-correction-carried'),
    max = 100000000000000;
  const csv = (rows: string[][]) =>
    new TextEncoder().encode(
      rows
        .map((row) => row.map((v) => `"${v.replaceAll('"', '""')}"`).join(','))
        .join('\n') + '\n',
    ).buffer;
  for (const side of [0, 1] as const) {
    const rows = structuredClone(state.balance.files[side].sheets[0].rows);
    for (const r of rows.slice(1)) r[11] = side ? '0.00' : '-1000000000000.00';
    state.balance.files[side] = await readFile(
      `balance-${side}.csv`,
      csv(rows),
    );
  }
  const ledger = structuredClone(state.files[0].sheets[0].rows),
    proof = structuredClone(state.files[1].sheets[0].rows);
  for (const r of ledger.slice(1)) {
    r[2] = 'bank';
    r[4] = '1000000000000.00';
  }
  proof[1][2] = 'bank-error';
  proof[1][3] = 'bank';
  proof[1][14] = '1000000000000.00';
  for (const [suffix, value] of [
    ['plus', '1000000000000.00'],
    ['minus', '-1000000000000.00'],
  ]) {
    const p = [...proof[1]];
    p[0] = `PROOF-${suffix}`;
    p[1] = `LIFE-${suffix}`;
    p[4] = `RECORD-${suffix}`;
    p[5] = p[6] = '2026-09-20';
    p[14] = value;
    proof.push(p);
    const i = [...ledger[2]];
    i[0] = `ITEM-${suffix}`;
    i[3] = p[0];
    i[4] = value;
    ledger.push(i);
  }
  state.files = [
    await readFile('large-items.csv', csv(ledger)),
    await readFile('large-proof.csv', csv(proof)),
  ];
  const initial = reconcileBankAdjustments(state);
  state.events = initial.lifecycles.map((l) =>
    decision(state, 'accept', l.itemIds),
  );
  const result = reconcileBankAdjustments(state);
  assert.equal(result.status, 'reconciled-with-evidence');
  assert.deepEqual(
    result.endpoints.map((e) => e.bankAdjustment),
    [max, max],
  );
  assert.deepEqual(
    result.endpoints.map((e) => e.adjustedBank),
    [0, 0],
  );
  assert.equal(result.endpoints[1].bankItemIds.length, 3);
  assert.equal(result.lifecycles.length, 3);
  assert.equal(result.proofs.length, 3);
});
void test('B2.2 refuses an oversized audit cell without truncating the original inventory or issuing a workbook', async () => {
  const state = await adjustmentFixture();
  const rows = structuredClone(state.files[0].sheets[0].rows);
  rows[1] = rows[1].map(() => 'x'.repeat(4096));
  const bytes = new TextEncoder().encode(
    rows.map((row) => row.join(',')).join('\n') + '\n',
  ).buffer;
  state.files[0] = await readFile('large-invalid-items.csv', bytes);
  const r = reconcileBankAdjustments(state);
  assert.equal(r.status, 'source-error');
  assert.equal(
    r.inventory.find((i) => i.source === 0 && i.row === 2)!.values[5].length,
    4096,
  );
  await assert.rejects(
    () => exportBankAdjustments(state, r),
    /ADJUSTMENT_EXPORT_CELL/,
  );
});
void test('B2.2 reread blocks the independent black-background original and native display overlays at every bank source layer', async () => {
  const bad = await fsRead(
    new URL(
      '../audit/bank-adjustment/regressions/native-black-background.xlsx',
      import.meta.url,
    ),
  );
  const state = await adjustmentFixture('closing-outflow');
  state.files[1] = await readFile(
    'native-black-background.xlsx',
    Uint8Array.from(bad).buffer,
  );
  await assert.rejects(
    () => replayBankAdjustments(state),
    /BANK_NATIVE_DISPLAY/,
  );
  await assert.rejects(() => saveBankAdjustments(state), /BANK_NATIVE_DISPLAY/);
  const wrapped = await fsRead(
    new URL(
      '../audit/bank-adjustment/regressions/native-black-background-wrapped.xlsx',
      import.meta.url,
    ),
  );
  state.files[1] = await readFile(
    'wrapped.xlsx',
    Uint8Array.from(wrapped).buffer,
  );
  await assert.rejects(
    () => replayBankAdjustments(state),
    /BANK_NATIVE_DISPLAY/,
  );
  const { default: JSZip } = await import('jszip');
  for (let layer = 0; layer < 6; layer++) {
    const input = await adjustmentFixture('closing-outflow');
    const files = [
      ...input.balance.bank.files,
      ...input.balance.files,
      ...input.files,
    ];
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Plain source');
    for (const row of files[layer].sheets[0].rows) sheet.addRow(row);
    const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
    const path = 'xl/worksheets/sheet1.xml';
    const xml = await zip.file(path)!.async('string');
    zip.file(
      path,
      xml.replace('</worksheet>', '<picture r:id="background"/></worksheet>'),
    );
    const source = await readFile(
      `source-${layer}.xlsx`,
      await zip.generateAsync({ type: 'arraybuffer' }),
    );
    if (layer < 2) input.balance.bank.files[layer] = source;
    else if (layer < 4) input.balance.files[layer - 2] = source;
    else input.files[layer - 4] = source;
    await assert.rejects(
      () => replayBankAdjustments(input),
      /BANK_NATIVE_DISPLAY/,
      `source ${layer}`,
    );
  }
});

void test('B2.2 worker response boundary rejects incomplete sessions and non-file downloads', async () => {
  const { validateWorkerValue } =
    await import('../lib/reconciliation/protocol.ts');
  const { state, result } = await finishedAdjustment('closing-outflow');
  for (const action of [
    'bank-adjustment-reconcile',
    'bank-adjustment-restore',
  ]) {
    assert.doesNotThrow(() =>
      validateWorkerValue(action, { state, result }, {}),
    );
    for (const value of [
      {},
      { state, result: { version: 'old' } },
      { state: { ...state, files: [] }, result },
    ])
      assert.throws(() => validateWorkerValue(action, value, {}));
  }
  const exported = await exportBankAdjustments(state, result);
  assert.ok(exported instanceof ArrayBuffer);
  for (const action of ['bank-adjustment-save', 'bank-adjustment-export']) {
    assert.doesNotThrow(() =>
      validateWorkerValue(action, new ArrayBuffer(2), {}),
    );
    for (const value of [{}, 'fake', new ArrayBuffer(0)])
      assert.throws(() => validateWorkerValue(action, value, {}));
  }
});

void test('B2.2 a reported old cashbook correction at closing still requires its independent opening item', async () => {
  const state = await adjustmentFixture('old-correction-carried');
  const rows = state.files[0].sheets[0].rows.filter(
    (r, i) => !i || r[1] !== 'opening',
  );
  state.files[0] = await readFile(
    'missing-old-correction-opening.csv',
    new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n') + '\n')
      .buffer,
  );
  const result = reconcileBankAdjustments(state);
  assert.equal(result.status, 'source-error');
  assert.ok(result.inventory.some((i) => i.error === 'ADJUSTMENT_OLD_ITEM'));
  assert.throws(
    () => reconcileBankAdjustments({ ...state, events: [decision(state)] }),
    /ADJUSTMENT_EVENT_SOURCE/,
  );
});
void test('B2.2 rejects the independently accepted native visibility originals at every approval persistence boundary', async () => {
  for (const kind of [
    'white-font',
    'black-fill',
    'tiny-row',
    'tiny-column',
    'low-zoom',
    'hex-column',
  ]) {
    const state = await adjustmentFixture('closing-outflow');
    const data = await fsRead(
      new URL(
        `../audit/bank-adjustment/regressions/native-visibility/native-${kind}.xlsx`,
        import.meta.url,
      ),
    );
    state.files[1] = await readFile(
      `${kind}.xlsx`,
      Uint8Array.from(data).buffer,
    );
    const result = reconcileBankAdjustments(state);
    assert.notEqual(result.status, 'source-error');
    for (const operation of [
      () => replayBankAdjustments(state),
      () => saveBankAdjustments(state),
      () => exportBankAdjustments(state, result),
    ])
      await assert.rejects(operation, /BANK_NATIVE_DISPLAY/);
    // A pre-fix valid schema/session bypasses the save guard; restore must still inspect originals.
    const clean = await adjustmentFixture('closing-outflow');
    const session = JSON.parse(
      new TextDecoder().decode(await saveBankAdjustments(clean)),
    );
    session.files[1] = {
      name: state.files[1].name,
      sha256: state.files[1].sha256,
      data: Buffer.from(data).toString('base64'),
    };
    await assert.rejects(
      () =>
        restoreBankAdjustments(
          new TextEncoder().encode(JSON.stringify(session)).buffer,
        ),
      /BANK_NATIVE_DISPLAY/,
    );
  }
});
