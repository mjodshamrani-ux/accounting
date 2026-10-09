import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBank } from '../lib/reconciliation/bank.ts';
import { bankFixture, bankTruth, bankEvent } from '../audit/bank/fixtures.ts';
void test('bank: all 53 independently frozen movement, identity, gross/net, reversal and timing contracts', async () => {
  for (const c of bankTruth.cases) {
    const s = await bankFixture(c.name),
      before = JSON.stringify(s.files);
    let r = reconcileBank(s);
    assert.equal(r.status === 'source-error', c.sourceError, c.name);
    assert.deepEqual(
      r.records.map(({ id: _id, status: _status, traces: _traces, ...v }) => v),
      c.records,
      c.name + ' records',
    );
    assert.deepEqual(
      r.inventory.map(({ id: _id, error: _error, ...v }) => v),
      c.inventory,
      c.name + ' inventory',
    );
    const own = (id: string) => r.records.find((v) => v.id === id)!.reference;
    assert.deepEqual(
      r.cases.map((g) => ({
        key: g.key,
        bank: g.bankIds.map(own),
        cash: g.cashIds.map(own),
        bankMinor: g.bankMinor,
        cashMinor: g.cashMinor,
        deltaMinor: g.deltaMinor,
        status: g.status,
        reason: g.reason,
        eligible: g.eligible,
      })),
      c.groups,
      c.name + ' groups',
    );
    const timing = () => r.timingItems.map(({ id: _id, ...v }) => v);
    assert.deepEqual(timing(), c.timingItems, c.name + ' timing');
    for (const [index, a] of c.actions.entries()) {
      const e = bankEvent(a, r, `D${index + 1}`),
        previous = structuredClone(r);
      if (a.reject) {
        assert.throws(
          () => reconcileBank({ ...s, events: [...s.events, e] }),
          /BANK_/,
          c.name,
        );
        assert.deepEqual(reconcileBank(s), previous, c.name + ' atomic reject');
      } else {
        s.events.push(e);
        r = reconcileBank(s);
        const involved = r.cases.filter((g) =>
          [...g.bankIds, ...g.cashIds].some((id) =>
            [...e.bankIds, ...e.cashIds].includes(id),
          ),
        );
        assert.ok(
          involved.every((g) => g.status === a.expectedStatus),
          c.name + ' event status',
        );
      }
      assert.deepEqual(timing(), c.timingItems, c.name + ' persistent timing');
    }
    assert.equal(
      JSON.stringify(s.files),
      before,
      c.name + ' unchanged sources',
    );
    for (const g of r.cases) {
      assert.equal(g.bankMinor - g.cashMinor, g.deltaMinor);
      if (g.status.startsWith('matched')) {
        assert.equal(g.deltaMinor, 0);
        assert.ok(g.eligible);
      }
    }
  }
});

void test('bank: decisions require exact context, visible evidence, UTC device time and complete unique members', async () => {
  const s = await bankFixture('timing-after-cutoff'),
    r = reconcileBank(s),
    e = bankEvent({ type: 'accept', bank: ['B1'], cash: ['L1'] }, r);
  for (const edit of [
    (x: typeof e) => {
      x.context = 'stale';
    },
    (x: typeof e) => {
      x.reference = '';
    },
    (x: typeof e) => {
      x.note = '\u200b';
    },
    (x: typeof e) => {
      x.at = '2026-10-06T18:40:00Z';
    },
    (x: typeof e) => {
      x.bankIds.push(x.bankIds[0]);
    },
    (x: typeof e) => {
      x.cashIds = ['unknown'];
    },
    (x: typeof e) => {
      Object.assign(x, { override: true });
    },
  ]) {
    const bad = structuredClone(e);
    edit(bad);
    assert.throws(() => reconcileBank({ ...s, events: [bad] }), /BANK_/);
  }
  const accepted = reconcileBank({ ...s, events: [e] });
  assert.deepEqual(accepted.timingItems, r.timingItems);
  assert.equal(accepted.status, 'movements-consistent');
  assert.throws(
    () => reconcileBank({ ...s, events: [e, { ...e, id: 'D2' }] }),
    /BANK_/,
  );
  assert.throws(() => reconcileBank({ ...s, events: [e, e] }), /BANK_/);
  const undo = { ...e, id: 'U1', type: 'undo' as const };
  assert.equal(
    reconcileBank({ ...s, events: [e, undo] }).cases[0].status,
    'needs-review',
  );
  assert.throws(
    () => reconcileBank({ ...s, events: [e, undo, { ...undo, id: 'U2' }] }),
    /BANK_UNDO/,
  );
});
void test('bank: bad source rows block decisions on unrelated valid groups and false scope or cash perspective', async () => {
  const s = await bankFixture('wrong-fee-parent'),
    r = reconcileBank(s),
    e = bankEvent({ type: 'accept', bank: ['B1'], cash: ['L1', 'T1'] }, r);
  assert.throws(
    () => reconcileBank({ ...s, events: [e] }),
    /BANK_SOURCE_ERRORS/,
  );
  const good = await bankFixture();
  assert.throws(
    () =>
      reconcileBank({ ...good, scope: { ...good.scope, confirmed: false } }),
    /BANK_SCOPE/,
  );
  for (const side of [0, 1]) {
    const bad = structuredClone(good);
    Object.assign(bad.readings[side], { perspective: 'bank-credit' });
    assert.throws(() => reconcileBank(bad), /BANK_READING/);
  }
  assert.throws(
    () =>
      reconcileBank({ ...good, scope: { ...good.scope, currency: 'UNKNOWN' } }),
    /BANK_SCOPE/,
  );
});
void test('bank: equal fees cannot be substituted across original settlement members', async () => {
  const s = await bankFixture('equal-fees-independent-members'),
    r = reconcileBank(s),
    undo = bankEvent(
      { type: 'undo', bank: ['B1'], cash: ['L1', 'F1', 'T1'] },
      r,
      'U1',
    );
  s.events.push(undo);
  const reviewed = reconcileBank(s),
    swap = bankEvent(
      { type: 'accept', bank: ['B1'], cash: ['L1', 'F2', 'T1'] },
      reviewed,
      'D2',
    );
  assert.throws(
    () => reconcileBank({ ...s, events: [...s.events, swap] }),
    /BANK_/,
  );
  assert.equal(reconcileBank(s).cases[0].status, 'needs-review');
  assert.equal(reconcileBank(s).cases[1].status, 'matched-evidence');
});

import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  replayBank,
  saveBank,
  restoreBank,
  exportBank,
} from '../lib/reconciliation/bank-io.ts';
async function nativeBank(
  s: Awaited<ReturnType<typeof bankFixture>>,
  edit?: (book: ExcelJS.Workbook, side: number) => void,
) {
  const files = [];
  for (const [side, f] of s.files.entries()) {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('Movements');
    for (const [i, line] of f.sheets[0].rows.entries())
      sheet.addRow(
        line.map((v, c) =>
          i
            ? c === 16
              ? Number(v)
              : [2, 3, 14, 15].includes(c)
                ? new Date(`${v}T00:00:00.000Z`)
                : v
            : v,
        ),
      );
    sheet.getColumn(17).numFmt = '0.00';
    edit?.(book, side);
    files.push(
      await readFile(
        `native-${side}.xlsx`,
        new Uint8Array(await book.xlsx.writeBuffer()).buffer,
      ),
    );
  }
  return { ...s, files: files as typeof s.files };
}
void test('bank: native decimal amounts and dates retain strict formula hidden and identity guards', async () => {
  const s = await bankFixture(),
    n = await nativeBank(s),
    r = reconcileBank(n);
  assert.equal(r.status, 'movements-consistent');
  assert.equal(r.cases[0].bankMinor, -101725);
  assert.equal(r.records[0].movementDate, '2026-09-15');
  const restored = await restoreBank(await saveBank(n));
  assert.deepEqual(restored.result, r);
  await exportBank(n, r);
  for (const [index, edit] of [
    (b: ExcelJS.Workbook) => {
      b.worksheets[0].getCell('Q2').value = {
        formula: '1017.25',
        result: 1017.25,
      };
    },
    (b: ExcelJS.Workbook) => {
      b.worksheets[0].getRow(2).hidden = true;
    },
    (b: ExcelJS.Workbook) => {
      b.worksheets[0].getCell('A2').value = 1;
      b.worksheets[0].getCell('A2').numFmt = '0.00';
    },
    (b: ExcelJS.Workbook) => {
      b.worksheets[0].getCell('Q2').value = 1017.251;
    },
  ].entries()) {
    const bad = await nativeBank(s, (b, side) => {
      if (!side) edit(b);
    });
    assert.equal(
      reconcileBank(bad).status,
      'source-error',
      `native edit ${index}: ${JSON.stringify(bad.files[0].sheets[0].referenceIssues)} / ${JSON.stringify(bad.files[0].sheets[0].cellIssues)}`,
    );
  }
  for (const edit of [
    (b: ExcelJS.Workbook) => {
      b.worksheets[0].getCell('Q1').value = {
        formula: '"Amount"',
        result: 'Amount',
      };
    },
    (b: ExcelJS.Workbook) => {
      b.worksheets[0].getColumn(1).hidden = true;
    },
    (b: ExcelJS.Workbook) => {
      b.worksheets[0].mergeCells('A1:B1');
    },
  ]) {
    const bad = await nativeBank(s, (b, side) => {
      if (!side) edit(b);
    });
    assert.throws(() => reconcileBank(bad), /BANK_COLUMNS/);
  }
  const blank = await nativeBank(s, (b, side) => {
    if (!side) {
      b.worksheets[0].addRow(Array(17).fill(''));
      b.worksheets[0].getCell('Q3').value = { formula: '1+1' };
    }
  });
  assert.equal(reconcileBank(blank).status, 'source-error');
  assert.equal(
    reconcileBank(blank).inventory.find((i) => i.side === 0 && i.row === 3)
      ?.kind,
    'error',
  );
});
void test('bank: cached source forgery, obsolete exports, changed readings and tampered sessions are rejected or recomputed', async () => {
  const s = await bankFixture('timing-after-cutoff'),
    r = reconcileBank(s),
    event = bankEvent({ type: 'accept', bank: ['B1'], cash: ['L1'] }, r);
  s.events.push(event);
  const finished = reconcileBank(s),
    restored = await restoreBank(await saveBank(s));
  assert.deepEqual(restored.result, finished);
  const cached = structuredClone(s);
  cached.files[0].sheets[0].rows[1][3] = '2026-10-03';
  assert.deepEqual((await replayBank(cached)).result, finished);
  await assert.rejects(
    exportBank(s, { ...finished, timingItems: [] }),
    /BANK_STALE_RESULT/,
  );
  const session = JSON.parse(new TextDecoder().decode(await saveBank(s)));
  session.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(
    restoreBank(new TextEncoder().encode(JSON.stringify(session)).buffer),
    /BANK_SOURCE_HASH/,
  );
  const original = new Uint8Array(s.files[0].original!).slice();
  original[0] ^= 1;
  const hash = structuredClone(s);
  hash.files[0].original = original.buffer;
  await assert.rejects(replayBank(hash), /BANK_SOURCE_HASH/);
  const scope = { ...s.scope, end: '2026-10-02' };
  assert.throws(() => reconcileBank({ ...s, scope }), /BANK_SOURCE_ERRORS/);
  const changed = structuredClone(s);
  changed.files[0].sheets.push(structuredClone(changed.files[0].sheets[0]));
  changed.readings[0].sheet = 1;
  assert.throws(() => reconcileBank(changed), /BANK_EVENT/);
});
void test('bank: source reference namespaces cannot collide with missing or human case identities', async () => {
  const s = await bankFixture('no-identity');
  const b = [
    'B2',
    'blank:0:B1',
    '2026-09-15',
    '2026-09-16',
    'outflow',
    'principal',
    '',
    '',
    'individual',
    'booked',
    ...Object.values(bankTruth.scope),
    '20',
  ].join(',');
  s.files[0] = await readFile(
    'namespace-bank.csv',
    new TextEncoder().encode(
      new TextDecoder().decode(s.files[0].original!) + b + '\n',
    ).buffer,
  );
  const cash = [
    'L2',
    'blank:0:B1',
    '2026-09-15',
    '2026-09-16',
    'outflow',
    'principal',
    '',
    '',
    'individual',
    'posted',
    ...Object.values(bankTruth.scope),
    '20',
  ].join(',');
  s.files[1] = await readFile(
    'namespace-cash.csv',
    new TextEncoder().encode(
      new TextDecoder().decode(s.files[1].original!) + cash + '\n',
    ).buffer,
  );
  let r = reconcileBank(s);
  assert.equal(r.cases.length, 3);
  assert.equal(
    r.cases.filter((g) => g.kind === 'reference')[0].status,
    'matched-evidence',
  );
  assert.equal(new Set(r.cases.map((g) => g.id)).size, 3);
  const accept = bankEvent({ type: 'accept', bank: ['B1'], cash: ['L1'] }, r);
  s.events.push(accept);
  r = reconcileBank(s);
  assert.equal(r.cases.filter((g) => g.kind === 'human').length, 1);
  const undo = bankEvent({ type: 'undo', bank: ['B1'], cash: ['L1'] }, r, 'U1');
  s.events.push(undo);
  assert.equal(reconcileBank(s).cases.length, 3);
  const manualRef = await bankFixture('individual');
  for (const side of [0, 1]) {
    const rows = manualRef.files[side].sheets[0].rows;
    rows[1][1] = 'manual:source-identity';
    manualRef.files[side] = await readFile(
      `explicit-${side}.csv`,
      new TextEncoder().encode(
        rows.map((row) => row.join(',')).join('\n') + '\n',
      ).buffer,
    );
  }
  const mr = reconcileBank(manualRef);
  manualRef.events.push(
    bankEvent({ type: 'undo', bank: ['B1'], cash: ['L1'] }, mr),
  );
  const undone = reconcileBank(manualRef);
  assert.equal(undone.cases.length, 1);
  assert.equal(undone.cases[0].kind, 'reference');
  assert.equal(undone.cases[0].status, 'needs-review');
});

void test('bank: equal-money partial reversals, wrong-direction reversals and unrelated source errors remain blocked', async () => {
  for (const [name, column, value] of [
    ['reversal-partial-amount', 16, '900'],
    ['reversal-wrong-direction', 4, 'outflow'],
  ] as const) {
    const state = await bankFixture(name);
    const rows = state.files[1].sheets[0].rows.map((r) => [...r]);
    rows[2][column] = value;
    state.files[1] = await readFile(
      `balanced-${name}.csv`,
      new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n') + '\n')
        .buffer,
    );
    const result = reconcileBank(state);
    assert.equal(result.status, 'source-error');
    const event = bankEvent(
      { type: 'accept', bank: ['B1'], cash: ['L1'] },
      result,
    );
    assert.throws(
      () => reconcileBank({ ...state, events: [event] }),
      /BANK_SOURCE_ERRORS/,
    );
  }
  const state = await bankFixture('equal-fees-independent-members'),
    rows = state.files[1].sheets[0].rows.map((r) => [...r]);
  rows[2][6] = 'L2';
  state.files[1] = await readFile(
    'wrong-parent-unrelated.csv',
    new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n') + '\n')
      .buffer,
  );
  const result = reconcileBank(state);
  assert.equal(result.status, 'source-error');
  const undo = bankEvent(
    { type: 'undo', bank: ['B2'], cash: ['L2', 'F2', 'T2'] },
    result,
  );
  assert.throws(
    () => reconcileBank({ ...state, events: [undo] }),
    /BANK_SOURCE_ERRORS/,
  );
});
void test('bank: reordered canonical columns preserve scope and original cell coordinates', async () => {
  const state = await bankFixture();
  for (const [side, f] of state.files.entries()) {
    const rows = f.sheets[0].rows.map((r) => [r[16], ...r.slice(0, 16)]);
    state.files[side] = await readFile(
      `reordered-${side}.csv`,
      new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n') + '\n')
        .buffer,
    );
  }
  const result = reconcileBank(state);
  assert.equal(result.status, 'movements-consistent');
  assert.equal(result.cases[0].bankMinor, -101725);
  assert.equal(
    result.records[0].traces.find((t) => t.field === 'Amount')?.column,
    1,
  );
});
