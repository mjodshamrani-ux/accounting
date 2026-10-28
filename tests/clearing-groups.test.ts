import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import { reconcileClearing } from '../lib/reconciliation/clearing.ts';
import {
  groupClearing,
  type ClearingGroupsInput,
} from '../lib/reconciliation/clearing-groups.ts';
import { replayClearingGroups } from '../lib/reconciliation/clearing-groups-io.ts';

// A freight forwarder's suspense account, in dirhams, for June 2027: a
// lineage of its own, not the sealed CLR-1 stories.
const HEADER = [
  'Journal',
  'Clearing Document',
  'Posting date',
  'Net',
  'GL',
  'Ccy',
  'Narrative',
];
const READING = {
  sheet: 0,
  header: 0,
  posting: 0,
  reference: 1,
  date: 2,
  amount: 3,
  debit: -1,
  credit: -1,
  account: 4,
  currency: 5,
  description: 6,
  mode: 'signed' as const,
};
const SCOPE = {
  entity: 'Synthetic Freight Forwarding LLC',
  ledger: 'FF-GL',
  account: '2290',
  currency: 'AED',
  start: '2027-06-01',
  end: '2027-06-30',
  confirmed: true,
};
type Row = string[];
const line = (
  journal: string,
  doc: string,
  day: number,
  net: string,
  narrative = 'Freight',
  gl = '2290',
  ccy = 'AED',
): Row => [
  journal,
  doc,
  `2027-06-${String(day).padStart(2, '0')}`,
  net,
  gl,
  ccy,
  narrative,
];
const csv = (rows: Row[]) =>
  rows
    .map((r) =>
      r
        .map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v))
        .join(','),
    )
    .join('\n') + '\n';
async function book(
  rows: Row[],
  header: Row = HEADER,
  name = 'suspense.csv',
): Promise<ClearingGroupsInput> {
  const bytes = new TextEncoder().encode(csv([header, ...rows]));
  const file = await readFile(name, bytes.buffer);
  return { file, reading: { ...READING }, scope: { ...SCOPE } };
}
async function workbook(
  rows: Row[],
  edit: (sheet: ExcelJS.Worksheet) => void,
): Promise<ClearingGroupsInput> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Suspense');
  sheet.addRows([HEADER, ...rows]);
  edit(sheet);
  const bytes = await wb.xlsx.writeBuffer();
  const file = await readFile(
    'suspense.xlsx',
    new Uint8Array(bytes as unknown as Uint8Array).buffer,
  );
  return { file, reading: { ...READING }, scope: { ...SCOPE } };
}
const summary = (input: ClearingGroupsInput) =>
  groupClearing(input).groups.map((g) => [
    g.reference,
    g.members.map((m) => m.row),
    g.status,
    g.reasons,
  ]);
const reasons = (input: ClearingGroupsInput) =>
  groupClearing(input).groups.map((g) => g.reasons);
const pair = (doc: string, journal: string, day = 3): Row[] => [
  line(journal + 'A', doc, day, '450.00', 'Freight invoice'),
  line(journal + 'B', doc, day, '-450.00', 'Settlement'),
];

void test('a whole document that nets to zero clears, with each member, its basis and the net', async () => {
  const input = await book([
    line('J1', 'D-900', 2, '1200.00'),
    line('J2', 'D-900', 3, '-700.00'),
    line('J3', 'D-900', 4, '-500.00'),
  ]);
  const r = groupClearing(input);
  assert.deepEqual(summary(input), [['D-900', [2, 3, 4], 'cleared', []]]);
  assert.deepEqual(
    r.groups[0].members.map((m) => [m.posting, m.amount, m.basis]),
    [
      ['J1', 120000, 'REFERENCE'],
      ['J2', -70000, 'REFERENCE'],
      ['J3', -50000, 'REFERENCE'],
    ],
  );
  assert.equal(r.groups[0].net, 0);
  assert.equal(
    reconcileClearing({ ...input, events: [] }).cases[0].status,
    'cleared',
  );
});

void test('a faulty line under a document no group has holds nothing, where clearing-1 holds everything', async () => {
  const input = await book([
    ...pair('D-1', 'J1'),
    ...pair('D-2', 'J2'),
    line('J9', 'D-77', 5, 'n/a'),
  ]);
  assert.deepEqual(reasons(input), [[], []]);
  assert.deepEqual(
    groupClearing(input).faulty.map((f) => [f.row, f.code, f.isolated]),
    [[6, 'AMOUNT_FORMAT', true]],
  );
  assert.equal(
    reconcileClearing({ ...input, events: [] }).cases.filter(
      (c) => c.status === 'cleared',
    ).length,
    0,
  );
});

void test('a faulty line holds the group of its document, of any cell, and of a member posting number', async () => {
  for (const [faulty, want] of [
    [line('J9', 'D-1', 5, 'n/a'), [['CONNECTED_ERROR'], []]],
    [line('J9', 'D-77', 5, 'D-2'), [[], ['CONNECTED_ERROR']]],
    [line('J9', 'D-77', 5, 'n/a', ' D-1 '), [['CONNECTED_ERROR'], []]],
    [line('J2B', 'D-77', 5, 'n/a'), [[], ['CONNECTED_ERROR']]],
    [line('J9', 'D-2', 5, '1.00', 'Bank', '1010'), [[], ['CONNECTED_ERROR']]],
    [
      line('J9', 'D-2', 5, '1.00', 'Bank', '2290', 'USD'),
      [[], ['CONNECTED_ERROR']],
    ],
  ] as const) {
    const input = await book([
      ...pair('D-1', 'J1'),
      ...pair('D-2', 'J2'),
      [...faulty],
    ]);
    assert.deepEqual(reasons(input), want, faulty.join(','));
  }
  const r = groupClearing(
    await book([
      ...pair('D-1', 'J1'),
      ['J9', 'D-1', '2027-07-01', '1.00', '2290', 'AED', 'x'],
    ]),
  );
  assert.deepEqual(r.groups[0].connected, [{ row: 4, code: 'PERIOD' }]);
});

void test('what a faulty line cannot prove holds every group', async () => {
  const all = [['UNISOLATED_ERROR'], ['UNISOLATED_ERROR']];
  for (const faulty of [
    line('J9', '', 5, 'n/a'),
    line('J9', 'Grand total:', 5, 'n/a'),
    line('J9', 'المجموع', 5, 'n/a'),
    line('J9', '=D-1', 5, '1.00'),
    [...line('J9', 'D-77', 5, 'n/a'), 'overflow'],
    [...HEADER],
    ['', 'Total', '', '0.00', '2290', 'AED', ''],
  ]) {
    const input = await book([
      ...pair('D-1', 'J1'),
      ...pair('D-2', 'J2'),
      faulty,
    ]);
    assert.deepEqual(reasons(input), all, faulty.join(','));
  }
  const unverified = await book(
    [...pair('D-1', 'J1'), line('J9', 'D-77', 5, 'n/a')],
    ['Journal', 'Reference', 'Posting date', 'Net', 'GL', 'Ccy', 'Narrative'],
  );
  assert.deepEqual(reasons(unverified), [
    ['UNISOLATED_ERROR', 'UNVERIFIED_REFERENCE_ROLE'],
  ]);
});

void test('a blank line is blank, and a line without a document is its own group by row', async () => {
  const input = await book([
    ...pair('D-1', 'J1'),
    ['', '', '', '', '', '', ''],
    line('J5', '', 4, '3.00'),
  ]);
  const r = groupClearing(input);
  assert.deepEqual(r.blank, [4]);
  assert.deepEqual(r.faulty, []);
  assert.deepEqual(
    r.groups.map((g) => [
      g.reference,
      g.status,
      g.reasons,
      g.members.map((m) => m.basis),
    ]),
    [
      ['D-1', 'cleared', [], ['REFERENCE', 'REFERENCE']],
      ['', 'review', ['MISSING_REFERENCE'], ['ROW']],
    ],
  );
});

void test('an empty cell past the header does not stop isolation', async () => {
  const input = await book([
    ...pair('D-1', 'J1'),
    [...line('J9', 'D-77', 5, 'n/a'), '  '],
  ]);
  assert.deepEqual(reasons(input), [[]]);
});

void test('XLSX: a hidden line and a formula anywhere in a line hold every group; a plain faulty line holds its own', async () => {
  const rows = [
    ...pair('D-1', 'J1'),
    ...pair('D-2', 'J2'),
    line('J9', 'D-1', 5, '9.00'),
  ];
  const hidden = await workbook(rows, (s) => {
    s.getRow(6).hidden = true;
  });
  assert.deepEqual(reasons(hidden), [
    ['UNISOLATED_ERROR'],
    ['UNISOLATED_ERROR'],
  ]);
  const formula = await workbook(rows, (s) => {
    s.getCell('C6').value = '2027-06-31';
    s.getCell('G6').value = { formula: '"Fr" & "eight"', result: 'Freight' };
  });
  formula.reading = { ...READING, description: -1 };
  assert.deepEqual(reasons(formula), [
    ['UNISOLATED_ERROR'],
    ['UNISOLATED_ERROR'],
  ]);
  const plain = await workbook(rows, (s) => {
    s.getCell('C6').value = '2027-06-31';
  });
  assert.deepEqual(reasons(plain), [['CONNECTED_ERROR'], []]);
  assert.deepEqual(
    groupClearing(plain).faulty.map((f) => f.code),
    ['DATE'],
  );
});

void test('a journal on two lines is two movements, where clearing-1 refuses both as duplicates', async () => {
  const input = await book([
    line('J1', 'D-1', 2, '600.00'),
    line('J2', 'D-2', 2, '400.00'),
    line('J7', 'D-1', 9, '-600.00', 'Batch, line 1'),
    line('J7', 'D-2', 9, '-400.00', 'Batch, line 2'),
  ]);
  assert.deepEqual(summary(input), [
    ['D-1', [2, 4], 'cleared', []],
    ['D-2', [3, 5], 'cleared', []],
  ]);
  assert.equal(groupClearing(input).faulty.length, 0);
  assert.deepEqual(
    reconcileClearing({ ...input, events: [] })
      .inventory.filter((r) => r.kind === 'error')
      .map((r) => r.error),
    ['CLEARING_DUPLICATE_POSTING', 'CLEARING_DUPLICATE_POSTING'],
  );
});

void test('lines equal in every selected cell hold their group and all stay members', async () => {
  const twice = await book([
    line('J1', 'D-1', 2, '300.00', 'Pallet'),
    line('J1', 'D-1', 2, '300.0', 'Pallet'),
    line('J2', 'D-1', 3, '-600.00', 'Settlement'),
  ]);
  const r = groupClearing(twice);
  assert.deepEqual(summary(twice), [
    ['D-1', [2, 3, 4], 'review', ['DUPLICATE_MEMBER']],
  ]);
  assert.deepEqual(r.groups[0].duplicates, [[2, 3]]);
  const different = await book([
    line('J1', 'D-1', 2, '300.00', 'Pallet 1'),
    line('J1', 'D-1', 2, '300.00', 'Pallet 2'),
    line('J2', 'D-1', 3, '-600.00', 'Settlement'),
  ]);
  assert.deepEqual(reasons(different), [[]]);
  const loose = await book([
    line('J1', '', 2, '5.00', 'Same'),
    line('J1', '', 2, '5.00', 'Same'),
  ]);
  assert.deepEqual(reasons(loose), [
    ['DUPLICATE_MEMBER', 'MISSING_REFERENCE'],
    ['DUPLICATE_MEMBER', 'MISSING_REFERENCE'],
  ]);
});

void test('each line code, in clearing-1 order', async () => {
  const code = async (row: Row, split = false) => {
    const input = split
      ? await book(
          [
            ['J1', 'D-1', '2027-06-02', '5.00', '0.00', '2290', 'AED', 'x'],
            row,
          ],
          [
            'Journal',
            'Clearing Document',
            'Posting date',
            'Dr',
            'Cr',
            'GL',
            'Ccy',
            'Narrative',
          ],
        )
      : await book([line('J1', 'D-1', 2, '5.00'), row]);
    if (split)
      input.reading = {
        ...READING,
        amount: -1,
        debit: 3,
        credit: 4,
        account: 5,
        currency: 6,
        description: 7,
        mode: 'split',
      };
    return groupClearing(input).faulty.map((f) => f.code);
  };
  assert.deepEqual(await code(line('', 'D-9', 2, '1.00')), ['POSTING']);
  assert.deepEqual(await code(line('+J9', 'D-9', 2, '1.00')), ['IDENTITY']);
  assert.deepEqual(await code(line('J9', '#REF!', 2, '1.00')), ['IDENTITY']);
  assert.deepEqual(await code(line('J9', 'D-9', 2, '1.00', 'x', '2291')), [
    'ROW_SCOPE',
  ]);
  assert.deepEqual(
    await code(['J9', 'D-9', '02/06/2027', '1.00', '2290', 'AED', 'x']),
    ['DATE'],
  );
  assert.deepEqual(
    await code(['J9', 'D-9', '2027-02-29', '1.00', '2290', 'AED', 'x']),
    ['DATE'],
  );
  assert.deepEqual(
    await code(['J9', 'D-9', '2027-07-01', 'bad', '2290', 'AED', 'x']),
    ['PERIOD'],
  );
  assert.deepEqual(
    await code(['J9', 'D-9', '2027-05-31', '1.00', '2290', 'AED', 'x']),
    ['PERIOD'],
  );
  for (const edge of ['2027-06-01', '2027-06-30'])
    assert.deepEqual(
      await code(['J9', 'D-9', edge, '1.00', '2290', 'AED', 'x']),
      [],
      edge,
    );
  for (const net of ['1,000.00', '(5.00)', '', '1.005', '7.'])
    assert.deepEqual(
      await code(line('J9', 'D-9', 2, net)),
      ['AMOUNT_FORMAT'],
      net,
    );
  assert.deepEqual(
    await code(line('J9', 'D-9', 2, '\u0661\u0662٫\u0665\u0660')),
    [],
  );
  assert.deepEqual(
    await code(
      ['J9', 'D-9', '2027-06-02', '1.00', '1.00', '2290', 'AED', 'x'],
      true,
    ),
    ['SPLIT'],
  );
  assert.deepEqual(
    await code(
      ['J9', 'D-9', '2027-06-02', '-1.00', '0.00', '2290', 'AED', 'x'],
      true,
    ),
    ['SPLIT'],
  );
});

void test('every reason that applies, in contract order, and the edges of each', async () => {
  const residual = await book([
    line('J1', 'D-1', 2, '10.00'),
    line('J2', 'D-1', 3, '-9.00'),
  ]);
  assert.deepEqual(summary(residual), [
    ['D-1', [2, 3], 'review', ['RESIDUAL']],
  ]);
  assert.equal(groupClearing(residual).groups[0].net, 100);
  const zeros = await book([
    line('J1', 'D-1', 2, '0.00'),
    line('J2', 'D-1', 3, '0.00'),
  ]);
  assert.deepEqual(reasons(zeros), [['RESIDUAL']]);
  const kept = await book([line('J0', 'D-1', 2, '0.00'), ...pair('D-1', 'J1')]);
  assert.deepEqual(summary(kept), [['D-1', [2, 3, 4], 'cleared', []]]);
  const rows = (n: number) =>
    Array.from({ length: n }, (_, k) =>
      line(`J${k}`, 'D-1', 2, k ? '-1.00' : `${n - 1}.00`),
    );
  assert.deepEqual(reasons(await book(rows(100))), [[]]);
  assert.deepEqual(reasons(await book(rows(101))), [['GROUP_LIMIT']]);
  const mixed = await book([
    line('J1', 'D-1', 2, '5.00'),
    line('J1', 'D-1', 2, '5.00'),
    line('J9', 'D-1', 3, 'x'),
    line('J9', '', 3, 'y'),
  ]);
  assert.deepEqual(reasons(mixed), [
    ['UNISOLATED_ERROR', 'CONNECTED_ERROR', 'DUPLICATE_MEMBER', 'RESIDUAL'],
  ]);
});

void test('reordered lines keep every group by journal, and the total is the sum of the nets', async () => {
  const lines = [
    line('J1', 'D-1', 2, '100.00'),
    line('J2', 'D-1', 3, '-100.00'),
    line('J3', 'D-2', 3, '40.00'),
    line('J4', '', 4, '7.00'),
    line('J5', 'D-1', 5, 'bad'),
  ];
  const view = async (order: number[]) => {
    const r = groupClearing(await book(order.map((k) => lines[k])));
    assert.equal(
      r.total,
      r.groups.reduce((n, g) => n + g.net, 0),
    );
    return r.groups
      .map((g) => [
        g.reference,
        g.members.map((m) => m.posting).sort(),
        g.status,
        g.reasons,
      ])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  };
  assert.deepEqual(await view([0, 1, 2, 3, 4]), await view([4, 3, 1, 2, 0]));
});

void test('refusals under the family name, the reader ceiling as ROWS, and a replay that reads the bytes', async () => {
  const input = await book(pair('D-1', 'J1'));
  assert.throws(
    () => groupClearing({ ...input, scope: { ...SCOPE, confirmed: false } }),
    /^Error: CLEARING_GROUPS_SCOPE$/,
  );
  assert.throws(
    () => groupClearing({ ...input, reading: { ...READING, amount: 7 } }),
    /^Error: CLEARING_GROUPS_COLUMNS$/,
  );
  const many = Array.from({ length: 20030 }, (_, k) =>
    line(`J${k}`, '', 2, '1.00'),
  );
  const bytes = new TextEncoder().encode(csv([HEADER, ...many]));
  const original = bytes.buffer;
  await assert.rejects(
    replayClearingGroups({
      file: { name: 'big.csv', original, sha256: 'x'.repeat(64), sheets: [] },
      reading: READING,
      scope: SCOPE,
    }),
    /^Error: CLEARING_GROUPS_ROWS$/,
  );
  const ok = new TextEncoder().encode(
    csv([HEADER, ...many.slice(0, 20029)]),
  ).buffer;
  const file = await readFile('ok.csv', ok);
  const forged = { ...file, sheets: [{ ...file.sheets[0], rows: [HEADER] }] };
  const replayed = await replayClearingGroups({
    file: forged,
    reading: READING,
    scope: SCOPE,
  });
  assert.equal(replayed.result.movements.length, 20029);
  await assert.rejects(
    replayClearingGroups({
      file: { ...file, sha256: '0'.repeat(64) },
      reading: READING,
      scope: SCOPE,
    }),
    /^Error: CLEARING_GROUPS_SOURCE_HASH$/,
  );
});

void test('the same bytes give the same result, and the context follows the scope', async () => {
  const rows = [...pair('D-1', 'J1'), line('J9', 'D-1', 5, 'n/a')];
  const a = groupClearing(await book(rows));
  const b = groupClearing(await book(rows));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const other = groupClearing({
    ...(await book(rows)),
    scope: { ...SCOPE, ledger: 'FF-GL-2' },
  });
  assert.notEqual(other.context, a.context);
});

void test('Bahraini dinars with three places and Arabic headers', async () => {
  const header = [
    'رقم القيد',
    'رقم المقاصة',
    'التاريخ',
    'المبلغ',
    'الحساب',
    'العملة',
    'البيان',
  ];
  const input = await book(
    [
      line('ق1', 'م-5', 2, '12.345', 'شحن', '2290', 'BHD'),
      line('ق2', 'م-5', 3, '-12.345', 'تسوية', '2290', 'BHD'),
    ],
    header,
  );
  input.scope = { ...SCOPE, currency: 'BHD' };
  const r = groupClearing(input);
  assert.equal(r.role, true);
  assert.deepEqual(
    r.groups.map((g) => [g.status, g.members.map((m) => m.amount)]),
    [['cleared', [12345, -12345]]],
  );
});
