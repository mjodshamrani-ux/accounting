import test from 'node:test';
import assert from 'node:assert/strict';
import {
  balanceTruth,
  balanceFixture,
} from '../audit/bank-balance/fixtures.ts';
import { reconcileBankBalances } from '../lib/reconciliation/bank-balance.ts';
import { reconcileBank } from '../lib/reconciliation/bank.ts';
import { createHash } from 'node:crypto';
import { readFile as fsRead } from 'node:fs/promises';
void test('B2.1 frozen balance originals preserve both bridges, null missing, signed limits, history and all movement members', async () => {
  const bankJson = await fsRead(
    new URL('../audit/bank/frozen/expected.json', import.meta.url),
  );
  const hash = createHash('sha256').update(bankJson).digest('hex');
  for (const c of balanceTruth.cases) {
    const input = await balanceFixture(c.name),
      before = structuredClone(input);
    assert.equal(c.bankTruth.sha256, hash);
    assert.equal(c.bankTruth.case, c.bankCase);
    if (c.reject) {
      assert.throws(
        () => reconcileBankBalances(input),
        new RegExp(c.reject),
        c.name,
      );
      assert.deepEqual(input, before);
      continue;
    }
    const r = reconcileBankBalances(input);
    assert.equal(r.status, c.status, c.name);
    assert.deepEqual(
      r.records.map(({ side, row, reference, kind, asOf, amount }) => ({
        side,
        row,
        reference,
        kind,
        asOf,
        amount,
      })),
      c.records,
      c.name,
    );
    assert.deepEqual(
      r.inventory.map(({ side, row, kind }) => ({ side, row, kind })),
      c.inventory,
      c.name,
    );
    assert.deepEqual(
      r.missing.map(({ side, kind }) => [side, kind]),
      c.missing,
      c.name,
    );
    assert.deepEqual(
      r.components.map(({ opening, closing, movement, residual }) => ({
        opening,
        closing,
        movement,
        residual,
      })),
      c.components,
      c.name,
    );
    assert.deepEqual(r.differences, c.differences, c.name);
    assert.deepEqual(r.bank, reconcileBank(input.bank));
    assert.equal(r.bank.timingItems.length, c.timingItems);
    assert.equal(r.bank.records.length, c.bankTruth.records.length);
    for (const side of [0, 1])
      assert.deepEqual(
        r.components[side].movementIds,
        r.bank.records.filter((x) => x.side === side).map((x) => x.id),
      );
    assert.equal(
      new Set(r.components.flatMap((x) => x.movementIds)).size,
      r.bank.records.length,
    );
    assert.ok(!r.claim.includes('closed'));
    assert.deepEqual(input, before);
  }
});
void test('B2.1 coverage and reading evidence rejects false perspectives, boundaries, snapshots, unconfirmed or extra fields', async () => {
  const input = await balanceFixture();
  for (const change of [
    () => {
      input.coverage.confirmed = false;
    },
    () => {
      input.coverage.basis = 'value-date' as never;
    },
    () => {
      input.coverage.boundary = 'start-of-day' as never;
    },
    () => {
      input.coverage.openingAsOf = input.bank.scope.start;
    },
    () => {
      input.coverage.closingAsOf = '2026-10-01';
    },
  ]) {
    const good = structuredClone(input.coverage);
    change();
    assert.throws(() => reconcileBankBalances(input), /BALANCE_COVERAGE/);
    input.coverage = good;
  }
  for (const change of [
    () => {
      input.readings[0].perspective = 'bank-owner' as never;
    },
    () => {
      input.readings[0].role = 'cashbook-balances';
    },
    () => {
      input.readings[0].confirmed = false;
    },
    () => {
      input.readings[0].sheet = 5;
    },
  ]) {
    const good = structuredClone(input.readings);
    change();
    assert.throws(
      () => reconcileBankBalances(input),
      /BALANCE_READING|BALANCE_COLUMNS/,
    );
    input.readings = good;
  }
  assert.throws(
    () => reconcileBankBalances({ ...input, amountOverride: 0 } as never),
    /BALANCE_INPUT/,
  );
  assert.throws(
    () =>
      reconcileBankBalances({
        ...input,
        coverage: { ...input.coverage, override: 0 },
      } as never),
    /BALANCE_COVERAGE/,
  );
});
void test('B2.1 timing and unresolved movement evidence never disappear behind consistent balance totals', async () => {
  for (const name of ['pending-movement-policy', 'timing-kept-after-undo']) {
    const r = reconcileBankBalances(await balanceFixture(name));
    assert.equal(r.status, 'balances-consistent');
    assert.equal(r.bank.status, 'needs-review');
    if (name.startsWith('timing')) {
      assert.equal(r.bank.timingItems.length, 1);
      assert.equal(r.bank.events.length, 2);
      assert.equal(r.bank.cases[0].reason, 'undone');
    }
  }
  const r = reconcileBankBalances(
    await balanceFixture('zero-net-full-reversal'),
  );
  assert.equal(r.bank.records.length, 8);
  assert.equal(r.components.flatMap((x) => x.movementIds).length, 8);
  assert.equal(r.components[0].movement, 0);
  assert.equal(r.status, 'balances-consistent');
});

void test('B2.1 native amount0.00 and date cells preserve signed source evidence while formulas/identity ambiguity/hidden rows reject', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const { readFile } = await import('../lib/reconciliation/io.ts');
  const { replayBankBalances } =
    await import('../lib/reconciliation/bank-balance-io.ts');
  const input = await balanceFixture('negative-closing');
  async function native(change?: (sheet: import('exceljs').Worksheet) => void) {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('Balances');
    for (const [i, row] of input.files[0].sheets[0].rows.entries())
      sheet.addRow(
        row.map((v, c) =>
          i
            ? c === 11
              ? Number(v)
              : [2, 7, 8].includes(c)
                ? new Date(`${v}T00:00:00.000Z`)
                : v
            : v,
        ),
      );
    sheet.getColumn(12).numFmt = '0.00';
    change?.(sheet);
    return readFile(
      'native-balances.xlsx',
      new Uint8Array(await book.xlsx.writeBuffer()).buffer,
    );
  }
  const good = await native();
  input.files[0] = good;
  assert.equal(
    (await replayBankBalances(input)).result.status,
    'balances-consistent',
  );
  assert.equal(reconcileBankBalances(input).records[1].amount, -51725);
  for (const change of [
    (s: import('exceljs').Worksheet) => {
      s.getCell('L2').value = { formula: '500', result: 500 };
    },
    (s: import('exceljs').Worksheet) => {
      s.getRow(2).hidden = true;
    },
    (s: import('exceljs').Worksheet) => {
      s.getCell('A2').value = 1;
      s.getCell('A2').numFmt = '0.00';
    },
  ]) {
    input.files[0] = await native(change);
    assert.equal(reconcileBankBalances(input).status, 'source-error');
  }
  input.files[0] = await native((s) => {
    s.getCell('L1').value = { formula: '"Amount"', result: 'Amount' };
  });
  assert.throws(() => reconcileBankBalances(input), /BALANCE_COLUMNS/);
});
void test('B2.1 replay/session/export use original balances and original movement history rather than valid cached replacements', async () => {
  const {
    replayBankBalances,
    saveBankBalances,
    restoreBankBalances,
    exportBankBalances,
  } = await import('../lib/reconciliation/bank-balance-io.ts');
  const input = await balanceFixture(),
    original = reconcileBankBalances(input);
  input.files[0].sheets[0].rows[2][11] = '982.76';
  const forged = reconcileBankBalances(input);
  assert.equal(forged.status, 'inconsistent');
  assert.deepEqual((await replayBankBalances(input)).result, original);
  const session = await saveBankBalances(input);
  assert.deepEqual((await restoreBankBalances(session)).result, original);
  await assert.rejects(
    exportBankBalances(input, forged),
    /BALANCE_STALE_EXPORT/,
  );
  await exportBankBalances(input, original);
  const p = JSON.parse(new TextDecoder().decode(session));
  assert.ok(!Object.hasOwn(p, 'result'));
  p.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(
    restoreBankBalances(new TextEncoder().encode(JSON.stringify(p)).buffer),
    /BALANCE_SOURCE_HASH/,
  );
  const extra = {
    ...JSON.parse(new TextDecoder().decode(session)),
    result: original,
  };
  await assert.rejects(
    restoreBankBalances(new TextEncoder().encode(JSON.stringify(extra)).buffer),
    /BALANCE_SESSION/,
  );
  const changed = await balanceFixture('timing-kept-after-undo'),
    old = reconcileBankBalances(changed);
  changed.bank.events.pop();
  assert.equal(reconcileBankBalances(changed).bank.events.length, 1);
  assert.equal(reconcileBankBalances(changed).bank.timingItems.length, 1);
  await assert.rejects(
    exportBankBalances(changed, old),
    /BALANCE_STALE_EXPORT/,
  );
});
void test('B2.1 reordered canonical columns retain original column evidence and all sources are immutable', async () => {
  const { readFile } = await import('../lib/reconciliation/io.ts');
  const input = await balanceFixture();
  const rows = input.files[0].sheets[0].rows;
  const moved = rows.map((row) => [row[11], ...row.slice(0, 11)]);
  input.files[0] = await readFile(
    'reordered.csv',
    new TextEncoder().encode(moved.map((r) => r.join(',')).join('\n') + '\n')
      .buffer,
  );
  const before = structuredClone(input),
    r = reconcileBankBalances(input);
  assert.equal(r.status, 'balances-consistent');
  assert.equal(r.records[0].cells.find((c) => c.field === 'Amount')?.column, 1);
  assert.deepEqual(input, before);
});

void test('B2.1 cancellation inside the whole bridge remains within the signed limit without premature intermediate rejection', async () => {
  const input = await balanceFixture('intermediate-cancellation');
  assert.doesNotThrow(() => reconcileBankBalances(input));
  const result = reconcileBankBalances(input);
  assert.equal(result.components[0].residual, -101725);
  assert.equal(result.components[1].residual, -101725);
  assert.equal(result.status, 'inconsistent');
});
