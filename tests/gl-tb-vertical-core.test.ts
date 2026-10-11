import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  BALANCE_FIELDS,
  GL_TB_VERSION,
  GL_TB_VERTICAL_FAMILY,
  TB_VERTICAL_HEADERS,
  reconcileGlTb,
  readBalanceSource,
  readGlDetail,
  type GlTbInput,
  type BalanceAmounts,
} from '../lib/reconciliation/gl-tb.ts';
const frozen = resolve(
  process.env.GL_TB_VERTICAL_FROZEN_DIR ||
    process.env.GL_TB_VERTICAL_FIXTURE_DIR ||
    new URL('./fixtures/gl-tb-vertical/', import.meta.url).pathname,
);
export async function verticalFixture(
  name = 'P01-two-sided-six-components',
): Promise<GlTbInput> {
  const facts = JSON.parse(
    await fsRead(resolve(frozen, name, 'facts.json'), 'utf8'),
  );
  const files = await Promise.all(
    ['gl.csv', 'tb-vertical.csv'].map(async (file) => {
      const bytes = await fsRead(resolve(frozen, name, file));
      assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        facts.sourceSha256[file],
      );
      return readFile(file, Uint8Array.from(bytes).buffer);
    }),
  );
  return {
    files: files as GlTbInput['files'],
    scope: facts.scope,
    readings: [
      { sheet: 0, role: 'gl-detail', family: GL_TB_VERSION, confirmed: true },
      {
        sheet: 0,
        role: 'trial-balance',
        family: GL_TB_VERTICAL_FAMILY,
        confirmed: true,
      },
    ],
  };
}
const asNumbers = (value: Record<string, string>) =>
  Object.fromEntries(
    BALANCE_FIELDS.map((f) => [f, Number(value[f])]),
  ) as BalanceAmounts;
void test('vertical frozen CSV contracts retain thirty authored statuses, financial vectors and full inventory', async (t) => {
  const names = (await readdir(frozen))
    .filter((n) => /^[PN]\d\d-/.test(n))
    .sort();
  assert.equal(names.length, 30);
  for (const name of names)
    await t.test(name, async () => {
      const input = await verticalFixture(name),
        facts = JSON.parse(
          await fsRead(resolve(frozen, name, 'facts.json'), 'utf8'),
        );
      if (facts.requiredStatus === 'refused') {
        assert.throws(() => reconcileGlTb(input), /GL_TB_COLUMNS/);
        return;
      }
      const result = reconcileGlTb(input);
      assert.equal(result.status, facts.requiredStatus, name);
      for (const side of [0, 1] as const)
        assert.deepEqual(
          result.inventory.filter((i) => i.side === side).map((i) => i.values),
          facts.inventory[side === 0 ? 'gl' : 'tb'],
          `${name} raw inventory`,
        );
      if (facts.financialExpectationsApplicable) {
        assert.deepEqual(result.gl, asNumbers(facts.glComponentsMinor));
        assert.deepEqual(result.tb, asNumbers(facts.tbAuthoredComponentsMinor));
        assert.deepEqual(
          result.differences,
          asNumbers(facts.componentDifferencesMinor),
        );
        assert.equal(result.glBridge, Number(facts.glBridgeMinor));
        assert.equal(result.tbBridge, Number(facts.tbBridgeMinor));
      }
    });
});
void test('vertical zero period must be supplied, never inferred or silently dropped', async () => {
  const supplied = reconcileGlTb(
    await verticalFixture('P04-zero-period-must-exist'),
  );
  assert.equal(supplied.status, 'consistent');
  assert.ok(supplied.rows.some((r) => r.side === 1 && r.kind === 'period'));
  assert.deepEqual(
    supplied.rows.find((r) => r.side === 1 && r.kind === 'period')!.amounts,
    [0, 0],
  );
  const missing = reconcileGlTb(
    await verticalFixture('N01-missing-zero-period'),
  );
  assert.equal(missing.status, 'missing');
  assert.deepEqual(missing.missing, ['tb-period']);
  assert.equal(missing.tb, null);
  assert.equal(missing.tbBridge, null);
  assert.equal(missing.differences, null);
  assert.equal(
    missing.components.some((c) => c.side === 1),
    false,
  );
});
void test('vertical duplicate roles reject all occurrences including malformed and conflicting later values', async () => {
  for (const credit of ['125.00', '175.00', '']) {
    const input = await verticalFixture('N02-identical-period-duplicate');
    input.files[1].sheets[0].rows[4][13] = credit;
    const result = reconcileGlTb(input);
    assert.equal(result.status, 'source-error');
    assert.deepEqual(
      result.inventory
        .filter((i) => i.side === 1 && i.kind === 'error')
        .map((i) => i.row),
      [3, 5],
    );
    assert.equal(
      result.rows.some((r) => r.side === 1 && r.kind === 'period'),
      false,
    );
    assert.equal(result.tb, null);
  }
});
void test('vertical two-sided debit and credit are supplied independently and never swapped', async () => {
  const result = reconcileGlTb(await verticalFixture());
  assert.equal(result.status, 'consistent');
  assert.deepEqual(
    BALANCE_FIELDS.map((f) => result.tb![f]),
    [100000, 20000, 35000, 12500, 125000, 22500],
  );
  const source = readBalanceSource(
    (await verticalFixture()).files[1],
    result.readings[1],
    result.scope,
  );
  assert.deepEqual(
    source.rows.map((r) => [r.kind, r.amounts]),
    [
      ['opening', [100000, 20000]],
      ['period', [35000, 12500]],
      ['closing', [125000, 22500]],
    ],
  );
  assert.ok(
    source.rows.every((r) => r.record === 'TB-SNAP-01' && r.date === ''),
  );
});
void test('vertical matching net never conceals six gross differences or either independent bridge', async () => {
  const result = reconcileGlTb(
    await verticalFixture('N17-equal-net-hidden-gross-difference'),
  );
  assert.equal(result.status, 'difference');
  assert.equal(result.glBridge, 0);
  assert.equal(result.tbBridge, 0);
  assert.equal(result.differences!.periodDebit, 5000);
  assert.equal(result.differences!.periodCredit, 5000);
  const broken = reconcileGlTb(await verticalFixture('N16-tb-bridge-broken'));
  assert.equal(broken.status, 'inconsistent');
  assert.equal(broken.glBridge, 0);
  assert.notEqual(broken.tbBridge, 0);
  const independent = reconcileGlTb(
    await verticalFixture('N20-gl-bridge-independent'),
  );
  assert.equal(independent.status, 'inconsistent');
  assert.notEqual(independent.glBridge, 0);
  assert.equal(independent.tbBridge, 0);
  const opening = await verticalFixture();
  opening.files[1].sheets[0].rows[1][12] = '1100.00';
  const changed = reconcileGlTb(opening);
  assert.equal(changed.tb!.openingDebit, 110000);
  assert.equal(changed.tbBridge, -10000);
  assert.equal(changed.differences!.openingDebit, -10000);
});
void test('vertical six component links resolve to exact raw cells on three physical permuted rows', async () => {
  const input = await verticalFixture('P05-role-column-permutation'),
    result = reconcileGlTb(input);
  assert.equal(result.status, 'consistent');
  const headers = input.files[1].sheets[0].rows[0];
  assert.equal(headers.length, TB_VERTICAL_HEADERS.length);
  const expectedRows = { opening: 4, period: 5, closing: 2 };
  const components = result.components.filter((c) => c.side === 1);
  assert.equal(components.length, 6);
  for (const [i, component] of components.entries()) {
    const role = ['opening', 'period', 'closing'][
      Math.floor(i / 2)
    ] as keyof typeof expectedRows;
    assert.equal(component.cells.length, 1);
    const cell = component.cells[0],
      row = result.rows.find((r) => r.id === cell.id)!;
    assert.equal(row.side, 1);
    assert.equal(row.row, expectedRows[role]);
    assert.equal(row.kind, role);
    assert.equal(row.record, 'TB-SNAP-01');
    assert.equal(row.id, `1:${input.files[1].sha256}:0:${expectedRows[role]}`);
    assert.equal(cell.column, headers.indexOf(i % 2 ? 'Credit' : 'Debit') + 1);
    const trace = row.trace.find((v) => v.column === cell.column)!;
    assert.equal(
      trace.text,
      input.files[1].sheets[0].rows[row.row - 1][cell.column - 1],
    );
    assert.equal(trace.amount, component.amount);
  }
  assert.equal(
    new Set(components.flatMap((c) => c.cells.map((cell) => cell.id))).size,
    3,
  );
  assert.equal(
    result.inventory.find((i) => i.side === 1 && i.row === 3)!.kind,
    'blank',
  );
  assert.equal(
    result.inventory.some((i) => i.side === 1 && i.kind === 'balance'),
    false,
  );
});
void test('vertical family is explicit, TB-only and bound to result context', async () => {
  const input = await verticalFixture(),
    result = reconcileGlTb(input);
  assert.equal(result.version, GL_TB_VERSION);
  assert.equal(JSON.parse(result.context)[2][1][2], GL_TB_VERTICAL_FAMILY);
  const wrong = structuredClone(input);
  wrong.readings[1].family = GL_TB_VERSION;
  assert.throws(() => reconcileGlTb(wrong), /GL_TB_COLUMNS/);
  wrong.readings[0].family = GL_TB_VERTICAL_FAMILY;
  assert.throws(() => reconcileGlTb(wrong), /GL_TB_READING/);
  const changed = structuredClone(input);
  changed.files[1].sha256 = 'a'.repeat(64);
  assert.notEqual(reconcileGlTb(changed).context, result.context);
});
void test('vertical missing identities, second snapshots and late bad rows prevent partial consistency', async () => {
  for (const name of [
    'N03-second-snapshot',
    'N15-late-unknown-role',
    'N21-missing-snapshot',
  ]) {
    const input = await verticalFixture(name),
      result = reconcileGlTb(input);
    assert.equal(result.status, 'source-error', name);
    assert.equal(
      result.inventory.filter((i) => i.side === 1).length,
      input.files[1].sheets[0].rows.length,
    );
    assert.ok(result.inventory.some((i) => i.side === 1 && i.kind === 'error'));
  }
});
void test('vertical preserves existing financial text policy without widening identity trim', async () => {
  const input = await verticalFixture();
  input.files[1].sheets[0].rows[1][12] = '\u200f١٠٠٠٫٠٠\u061c';
  input.files[1].sheets[0].rows[1][0] = '\ufeffTB-SNAP-01\ufeff';
  const legal = reconcileGlTb(input);
  assert.equal(legal.status, 'consistent');
  assert.equal(
    legal.rows.find((r) => r.side === 1 && r.kind === 'opening')!.trace[0].text,
    '\u200f١٠٠٠٫٠٠\u061c',
  );
  input.files[1].sheets[0].rows[1][0] = '\u0085TB-SNAP-01\u0085';
  assert.equal(reconcileGlTb(input).status, 'source-error');
  input.files[1].sheets[0].rows[1][0] = 'TB-SNAP-01';
  input.files[1].sheets[0].rows[1][12] = '1\u2060000.00';
  assert.equal(reconcileGlTb(input).status, 'source-error');
});
void test('vertical positive contracts match all nine original horizontal controls without changing old family', async (t) => {
  const names = (await readdir(frozen)).filter((n) => /^P\d\d-/.test(n)).sort();
  assert.equal(names.length, 9);
  for (const name of names)
    await t.test(name, async () => {
      const input = await verticalFixture(name),
        vertical = reconcileGlTb(input),
        facts = JSON.parse(
          await fsRead(resolve(frozen, name, 'facts.json'), 'utf8'),
        ),
        bytes = await fsRead(
          resolve(frozen, name, 'tb-horizontal-control.csv'),
        );
      assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        facts.sourceSha256['tb-horizontal-control.csv'],
      );
      input.files[1] = await readFile(
        'tb-horizontal-control.csv',
        Uint8Array.from(bytes).buffer,
      );
      input.readings[1].family = GL_TB_VERSION;
      const horizontal = reconcileGlTb(input);
      assert.equal(horizontal.status, 'consistent');
      assert.deepEqual(horizontal.gl, vertical.gl);
      assert.deepEqual(horizontal.tb, vertical.tb);
      assert.deepEqual(horizontal.differences, vertical.differences);
      assert.equal(horizontal.glBridge, vertical.glBridge);
      assert.equal(horizontal.tbBridge, vertical.tbBridge);
      assert.equal(horizontal.rows.filter((r) => r.side === 1).length, 1);
      assert.equal(horizontal.rows.find((r) => r.side === 1)!.kind, 'balance');
      assert.equal(horizontal.readings[1].family, GL_TB_VERSION);
      assert.notEqual(horizontal.context, vertical.context);
      assert.throws(
        () =>
          reconcileGlTb({
            ...input,
            readings: [
              input.readings[0],
              { ...input.readings[1], family: GL_TB_VERTICAL_FAMILY },
            ],
          }),
        /GL_TB_COLUMNS/,
      );
    });
});
void test('vertical fixed numeric displays preserve supplied minor units across currency precision', async () => {
  for (const [currency, raw, minor, formats, accepted] of [
    ['SAR', '1000.01', 100001, ['0'], false],
    ['SAR', '1000.01', 100001, ['0.0'], false],
    ['SAR', '1000.10', 100010, ['0.0'], true],
    ['SAR', '1000.01', 100001, ['0.00'], true],
    ['SAR', '1000.01', 100001, ['0.##'], true],
    ['SAR', '1000.01', 100001, ['"SAR" #,##0.00'], true],
    ['SAR', '1000.01', 100001, ['[$SAR-409]#,##0.00'], true],
    ['SAR', '1000.01', 100001, ['0.00', '0'], false],
    ['SAR', '1000.01', 100001, ['"0.00"0'], false],
    ['SAR', '1000.00', 100000, ['0'], true],
    ['SAR', '0.00', 0, ['0.00;(0.00);"-"'], true],
    ['KWD', '1000.001', 1000001, ['0.00'], false],
    ['KWD', '1000.010', 1000010, ['0.00'], true],
    ['KWD', '1000.001', 1000001, ['0.000'], true],
    ['JPY', '1000', 1000, ['0'], true],
  ] as const) {
    const input = await verticalFixture();
    input.scope.currency = currency;
    for (const side of [0, 1] as const)
      for (const row of input.files[side].sheets[0].rows.slice(1)) {
        row[side === 0 ? 7 : 6] = currency;
        if (currency === 'JPY')
          for (const column of side === 0 ? [13, 14] : [12, 13])
            row[column] = String(Number(row[column]));
      }
    const sheet = input.files[1].sheets[0];
    sheet.rows[1][12] = raw;
    sheet.numericCells = { '2:13': { value: Number(raw), format: formats[0] } };
    sheet.numericDisplayFormats = { '2:13': [...formats] };
    const result = reconcileGlTb(input);
    assert.equal(
      result.status === 'source-error',
      !accepted,
      `${currency} ${raw} ${formats.join(',')}`,
    );
    if (accepted) assert.equal(result.tb!.openingDebit, minor);
    else
      assert.equal(
        result.inventory.find((i) => i.side === 1 && i.row === 2)!.error,
        'GL_TB_CELL',
      );
  }
});
void test('vertical native XLSX rounding formats cannot hide supplied cents or conditional cents', async () => {
  for (const [format, raw, conditional, accepted] of [
    ['0', 1000.01, false, false],
    ['0.0', 1000.01, false, false],
    ['0.00', 1000.01, true, false],
    ['0', 1000, false, true],
    ['General', 1000.01, false, true],
    ['0.00', 1000.01, false, true],
    ['0.000', 1000.01, false, true],
    ['0.##', 1000.01, false, true],
  ] as const) {
    const input = await verticalFixture(),
      workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet('TB');
    sheet.addRows(input.files[1].sheets[0].rows);
    const cell = sheet.getCell('M2');
    cell.value = raw;
    cell.numFmt = format;
    if (conditional)
      sheet.addConditionalFormatting({
        ref: 'M2',
        rules: [
          {
            type: 'expression',
            formulae: ['TRUE'],
            priority: 1,
            style: { numFmt: '0' },
          },
        ],
      });
    input.files[1] = await readFile(
      'tb-vertical.xlsx',
      new Uint8Array(await workbook.xlsx.writeBuffer()).buffer,
    );
    const result = reconcileGlTb(input);
    assert.equal(
      result.status,
      accepted
        ? raw === 1000
          ? 'consistent'
          : 'inconsistent'
        : 'source-error',
      `${format} ${raw} conditional=${conditional}`,
    );
    assert.equal(input.files[1].sheets[0].rows[1][12], String(raw));
    assert.ok(
      input.files[1].sheets[0].numericDisplayFormats!['2:13'].includes(format),
    );
    if (accepted)
      assert.equal(result.tb!.openingDebit, raw === 1000 ? 100000 : 100001);
    else
      assert.equal(
        result.inventory.find((i) => i.side === 1 && i.row === 2)!.error,
        'GL_TB_CELL',
      );
  }
});
void test('vertical paired GL native displays retain cents while canonical GL reading keeps its default', async () => {
  for (const [format, raw, conditional, accepted] of [
    ['0', 1000.01, false, false],
    ['0.0', 1000.01, false, false],
    ['0.00', 1000.01, true, false],
    ['0', 1000, false, true],
    ['General', 1000.01, false, true],
    ['0.00', 1000.01, false, true],
    ['0.000', 1000.01, false, true],
    ['0.##', 1000.01, false, true],
  ] as const) {
    const input = await verticalFixture(),
      workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet('GL');
    sheet.addRows(input.files[0].sheets[0].rows);
    const cell = sheet.getCell('N2');
    cell.value = raw;
    cell.numFmt = format;
    if (conditional)
      sheet.addConditionalFormatting({
        ref: 'N2',
        rules: [
          {
            type: 'expression',
            formulae: ['TRUE'],
            priority: 1,
            style: { numFmt: '0' },
          },
        ],
      });
    input.files[0] = await readFile(
      'gl.xlsx',
      new Uint8Array(await workbook.xlsx.writeBuffer()).buffer,
    );
    const result = reconcileGlTb(input);
    assert.equal(
      result.status,
      accepted
        ? raw === 1000
          ? 'consistent'
          : 'inconsistent'
        : 'source-error',
      `${format} ${raw} conditional=${conditional}`,
    );
    assert.equal(input.files[0].sheets[0].rows[1][13], String(raw));
    if (accepted)
      assert.equal(result.gl!.openingDebit, raw === 1000 ? 100000 : 100001);
    else
      assert.equal(
        result.inventory.find((i) => i.side === 0 && i.row === 2)!.error,
        'GL_TB_CELL',
      );
    const legacy = readGlDetail(input.files[0], input.readings[0], input.scope);
    assert.equal(
      legacy.inventory.some((i) => i.kind === 'error'),
      false,
    );
    assert.equal(
      legacy.rows.find((r) => r.kind === 'opening')!.amounts[0],
      raw === 1000 ? 100000 : 100001,
    );
    const strict = readGlDetail(
      input.files[0],
      input.readings[0],
      input.scope,
      true,
    );
    assert.equal(
      strict.inventory.some((i) => i.kind === 'error'),
      !accepted,
    );
    const bytes = await fsRead(
      resolve(
        frozen,
        'P01-two-sided-six-components',
        'tb-horizontal-control.csv',
      ),
    );
    input.files[1] = await readFile(
      'tb-horizontal-control.csv',
      Uint8Array.from(bytes).buffer,
    );
    input.readings[1].family = GL_TB_VERSION;
    assert.equal(
      reconcileGlTb(input).status,
      raw === 1000 ? 'consistent' : 'inconsistent',
    );
  }
});
