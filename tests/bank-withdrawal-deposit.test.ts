import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile as fsRead } from 'node:fs/promises';
import {
  BANK_VERSION,
  BANK_WD_FAMILY,
  BANK_HEADERS,
  BANK_WD_HEADERS,
  reconcileBank,
  type BankInput,
  type BankMoneyCell,
} from '../lib/reconciliation/bank.ts';
import { currencyPrecision } from '../lib/reconciliation/currency-precision.ts';
import { assertBankNativeDisplay } from '../lib/reconciliation/bank-native-display.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { bankEvent } from '../audit/bank/fixtures.ts';
import { wdRoot, wdFixture, wdRows } from './bank-wd-fixtures.ts';

void test('WD: all 66 independently sealed source contracts and 20 canonical controls', async () => {
  const manifestBytes = await fsRead(
    new URL('frozen/INPUT-MANIFEST.json', wdRoot),
  );
  const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  assert.equal(
    hash(manifestBytes),
    '9ebd3eaf22bc90b021f7e65d82a1f4be3496b5976cfcef8076d5df641e669a95',
  );
  const manifest = JSON.parse(manifestBytes.toString()) as {
    files: { path: string; sha256: string; bytes: number }[];
  };
  for (const entry of manifest.files) {
    const b = await fsRead(new URL(`frozen/${entry.path}`, wdRoot));
    assert.equal(hash(b), entry.sha256, entry.path);
    assert.equal(b.length, entry.bytes, entry.path);
  }
  const names = manifest.files
    .filter((f) => f.path.endsWith('/facts.json'))
    .map((f) => f.path.split('/')[0]);
  assert.equal(names.length, 65);
  let controls = 0;
  for (const [name, supplemental] of [
    ...names.map((name) => [name, false] as const),
    ['66-isolated-native-canonical-peer', true] as const,
  ]) {
    const { input, facts, folder } = await wdFixture(name, supplemental);
    const unchanged = structuredClone(input.files);
    const run = async () => {
      for (const file of input.files)
        await assertBankNativeDisplay(file, 'BANK_NATIVE_DISPLAY', {
          strictMovementDisplay: true,
          decimals: currencyPrecision(input.scope.currency),
        });
      return reconcileBank(input);
    };
    if (facts.expected.status === 'structural-refusal') {
      await assert.rejects(run, /BANK_/, name);
    } else {
      const result = await run();
      assert.equal(result.status, facts.expected.status, name);
      if (facts.expected.signedMinor) {
        assert.deepEqual(
          [0, 1].map((side) =>
            result.records.filter((r) => r.side === side).map((r) => r.signed),
          ),
          facts.expected.signedMinor,
          name,
        );
        assert.deepEqual(
          [0, 1].map((side) =>
            result.records
              .filter((r) => r.side === side)
              .reduce((n, r) => n + r.signed, 0),
          ),
          facts.expected.netMinor,
          name,
        );
        assert.deepEqual(
          Object.fromEntries(result.cases.map((c) => [c.key, c.status])),
          facts.expected.groups,
          name,
        );
      }
      if (facts.expected.status === 'source-error') {
        assert.ok(
          result.inventory.some((r) => r.kind === 'error'),
          name,
        );
        assert.ok(
          result.cases.every((c) => !c.eligible && c.status === 'source-error'),
          name,
        );
      }
      if (facts.expected.timingInvalid)
        assert.ok(
          result.timingItems.some((t) => !t.validMovement),
          name,
        );
      assert.equal(
        result.inventory.length,
        input.files.reduce((n, f) => n + f.sheets[0].rows.length, 0),
        name,
      );
      for (const r of result.records) {
        if (input.readings[r.side].family === BANK_WD_FAMILY) {
          assert.ok(r.withdrawalDeposit, name);
          assert.equal(r.traces.length, 17);
          assert.ok(
            !r.traces.some((t) =>
              ['Amount', 'Cash direction'].includes(t.field),
            ),
            name,
          );
          for (const field of ['withdrawal', 'deposit'] as const) {
            const cell: BankMoneyCell = r.withdrawalDeposit[field];
            assert.equal(
              cell.text,
              input.files[r.side].sheets[0].rows[r.row - 1][cell.column - 1] ??
                '',
              name,
            );
          }
        } else assert.equal(r.withdrawalDeposit, undefined, name);
      }
    }
    assert.deepEqual(input.files, unchanged, name + ' unchanged source');
    if (facts.canonicalControls) {
      const files = await Promise.all(
        facts.canonicalControls.map(async (f) =>
          readFile(f, new Uint8Array(await fsRead(new URL(f, folder))).buffer),
        ),
      );
      const canonical: BankInput = {
        ...input,
        files: files as BankInput['files'],
        readings: input.readings.map((r) => ({
          ...r,
          family: BANK_VERSION,
        })) as BankInput['readings'],
      };
      const result = reconcileBank(canonical);
      assert.equal(result.status, facts.expected.status, name + ' canonical');
      assert.ok(result.records.every((r) => r.withdrawalDeposit === undefined));
      controls++;
    }
  }
  assert.equal(controls, 20);
});

void test('WD: inactive blank and written zero preserve distinct evidence and physical coordinates', async () => {
  const { input } = await wdFixture('04-inactive-blanks-and-written-zero');
  const result = reconcileBank(input),
    money = result.records
      .filter((r) => r.side === 0)
      .map((r) => r.withdrawalDeposit!);
  assert.equal(money[0].deposit.state, 'blank-inactive');
  assert.equal(money[0].deposit.minor, null);
  assert.equal(money[0].deposit.text, '');
  assert.equal(money[1].withdrawal.state, 'explicit-zero-inactive');
  assert.equal(money[1].withdrawal.minor, 0);
  assert.equal(BANK_WD_HEADERS.length, BANK_HEADERS.length);
  const permuted = await wdFixture('40-permuted-columns');
  const r = reconcileBank(permuted.input).records[0];
  assert.equal(
    r.withdrawalDeposit!.withdrawal.column,
    permuted.input.files[0].sheets[0].rows[0].indexOf('Withdrawal') + 1,
  );
});

void test('WD: family selection has no fallback and equivalent old decisions cannot transfer', async () => {
  const { input } = await wdFixture('42-value-date-outside');
  const result = reconcileBank(input),
    event = bankEvent(
      { type: 'accept', bank: ['B-OUT'], cash: ['C-OUT'] },
      result,
    );
  assert.equal(
    reconcileBank({ ...input, events: [event] }).status,
    'movements-consistent',
  );
  const canonical = structuredClone(input);
  const oldRows = canonical.files[0].sheets[0].rows.map((row, i) => {
    if (!i) return BANK_HEADERS;
    const map = Object.fromEntries(
      BANK_WD_HEADERS.map((h, c) => [h, row[c] ?? '']),
    );
    return BANK_HEADERS.map((h) =>
      h === 'Amount'
        ? map.Withdrawal || map.Deposit
        : h === 'Cash direction'
          ? map.Withdrawal && Number(map.Withdrawal)
            ? 'outflow'
            : 'inflow'
          : map[h],
    );
  });
  canonical.files[0] = await readFile(
    'old.csv',
    new TextEncoder().encode(oldRows.map((r) => r.join(',')).join('\n')).buffer,
  );
  canonical.readings[0].family = BANK_VERSION;
  assert.notEqual(reconcileBank(canonical).context, result.context);
  assert.throws(
    () => reconcileBank({ ...canonical, events: [event] }),
    /BANK_EVENT/,
  );
  for (const family of [BANK_VERSION, 'auto', 'debit-credit']) {
    const bad = structuredClone(input);
    Object.assign(bad.readings[0], { family });
    assert.throws(() => reconcileBank(bad), /BANK_(COLUMNS|READING)/);
  }
});

void test('WD: malformed duplicate originals and reversals invalidate every dependent claim', async () => {
  for (const field of ['Record ID', 'Reverses record ID']) {
    const { input } = await wdFixture('50-full-reversal');
    await wdRows(input, 0, (rows) => {
      const col = rows[0].indexOf(field),
        extra = [...rows[field === 'Record ID' ? 1 : 2]];
      extra[rows[0].indexOf('Record ID')] =
        field === 'Record ID' ? rows[1][0] : 'BAD-REV';
      extra[col] = rows[field === 'Record ID' ? 1 : 2][col];
      extra[rows[0].indexOf('Withdrawal')] = '-1';
      rows.push(extra);
    });
    const result = reconcileBank(input);
    assert.equal(result.status, 'source-error');
    assert.ok(
      result.inventory.some(
        (r) =>
          r.error ===
          `BANK_DUPLICATE_${field === 'Record ID' ? 'ID' : 'REVERSAL'}`,
      ),
    );
    assert.ok(result.cases.every((c) => !c.eligible));
    const event = bankEvent(
      { type: 'accept', bank: ['ORIG-B'], cash: ['ORIG-C'] },
      result,
    );
    assert.throws(
      () => reconcileBank({ ...input, events: [event] }),
      /BANK_SOURCE_ERRORS/,
    );
  }
});

void test('WD: inactive unparsed or signed inputs, whitespace-only cells and excess zero precision never become zero', async () => {
  for (const bad of [
    ' ',
    '\u00a0',
    '-0',
    '+0',
    '0.000',
    '—',
    'N/A',
    '=0',
    '0e0',
    '(0)',
    '\u200e0',
  ]) {
    const { input } = await wdFixture();
    await wdRows(input, 0, (rows) => {
      rows[1][rows[0].indexOf('Deposit')] = bad;
    });
    const result = reconcileBank(input);
    assert.equal(result.status, 'source-error', JSON.stringify(bad));
    assert.equal(
      result.inventory.find((r) => r.side === 0 && r.row === 2)?.kind,
      'error',
    );
  }
});

void test('WD: a malformed competing parent blocks its fees and every unrelated case', async () => {
  const { input } = await wdFixture('46-outgoing-components');
  await wdRows(input, 1, (rows) => {
    const extra = [...rows[1]];
    extra[rows[0].indexOf('Withdrawal')] = '-1000';
    rows.push(extra);
  });
  const result = reconcileBank(input);
  assert.equal(result.status, 'source-error');
  assert.equal(result.records.filter((r) => r.side === 1).length, 0);
  assert.equal(
    result.inventory.filter((i) => i.error === 'BANK_PARENT').length,
    2,
  );
  assert.ok(result.cases.every((c) => !c.eligible));
});

void test('WD: incoming-net exact sum permits intermediate cancellation and rejects an excessive final component', async () => {
  const { input } = await wdFixture('47-incoming-net-components');
  await wdRows(input, 0, (rows) => {
    rows[1][rows[0].indexOf('Deposit')] = '1000000000000';
  });
  await wdRows(input, 1, (rows) => {
    const deposit = rows[0].indexOf('Deposit'),
      withdrawal = rows[0].indexOf('Withdrawal');
    const second = [...rows[1]];
    second[0] = 'PR2';
    rows[1][deposit] = '1000000000000';
    second[deposit] = '1000000000000';
    rows[2][withdrawal] = '1000000000000';
    rows.splice(3, 1);
    rows.splice(2, 0, second);
  });
  const result = reconcileBank(input);
  assert.equal(result.status, 'movements-consistent');
  assert.equal(result.cases[0].cashMinor, 100000000000000);
  await wdRows(input, 1, (rows) => {
    rows[3][rows[0].indexOf('Withdrawal')] = '0.01';
  });
  assert.throws(() => reconcileBank(input), /BANK_SUM/);
});

void test('WD: complete 100-member groups are accepted and 101-member groups cannot be approved', async () => {
  for (const count of [100, 101]) {
    const { input } = await wdFixture('46-outgoing-components');
    await wdRows(input, 0, (rows) => {
      rows[1][rows[0].indexOf('Withdrawal')] = (1 + (count - 1) / 100).toFixed(
        2,
      );
    });
    await wdRows(input, 1, (rows) => {
      const fee = [...rows[2]],
        withdrawal = rows[0].indexOf('Withdrawal');
      rows.splice(2);
      rows[1][withdrawal] = '1.00';
      for (let i = 1; i < count; i++) {
        const row = [...fee];
        row[0] = `F${i}`;
        row[withdrawal] = '0.01';
        rows.push(row);
      }
    });
    const result = reconcileBank(input),
      group = result.cases[0];
    assert.equal(group.cashIds.length, count);
    assert.equal(group.deltaMinor, 0);
    assert.equal(
      group.status,
      count === 100 ? 'matched-evidence' : 'needs-review',
    );
    assert.equal(
      group.reason,
      count === 100 ? 'explicit-identity' : 'member-limit',
    );
    if (count === 101) {
      const event = bankEvent(
        {
          type: 'accept',
          bank: ['SET'],
          cash: ['PR', ...Array.from({ length: 100 }, (_, i) => `F${i + 1}`)],
        },
        result,
      );
      assert.throws(
        () => reconcileBank({ ...input, events: [event] }),
        /BANK_MEMBERS/,
      );
    }
  }
});

void test('WD: 1000 complete accept/undo events retain original amounts and timing while 1001 is rejected', async () => {
  const { input } = await wdFixture('42-value-date-outside'),
    before = reconcileBank(input);
  input.events = Array.from({ length: 1000 }, (_, i) =>
    bankEvent(
      { type: i % 2 ? 'undo' : 'accept', bank: ['B-OUT'], cash: ['C-OUT'] },
      before,
      `D${i}`,
    ),
  );
  const result = reconcileBank(input);
  assert.equal(result.events.length, 1000);
  assert.equal(result.cases.find((c) => c.key === 'PAY-OUT')!.reason, 'undone');
  assert.deepEqual(result.records, before.records);
  assert.deepEqual(result.timingItems, before.timingItems);
  input.events.push(
    bankEvent(
      { type: 'accept', bank: ['B-OUT'], cash: ['C-OUT'] },
      before,
      'D1000',
    ),
  );
  assert.throws(() => reconcileBank(input), /BANK_INPUT/);
});
