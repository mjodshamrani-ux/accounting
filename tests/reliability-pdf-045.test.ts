import test from 'node:test';
import assert from 'node:assert/strict';
import {
  foundationManifest,
  buildManifest,
} from '../audit/reliability/manifest.mjs';
import { generateCase } from '../audit/reliability/generator.mjs';
import { renderCase } from '../audit/reliability/renderers.mjs';
import { readFile } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import { syntheticPdf } from './helpers/pdf-fixture.ts';
import type { SourceFile, Scope } from '../lib/reconciliation/types.ts';

const scope: Scope = {
  supplier: 'Vendor',
  entity: 'Buyer',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: true,
};
const map = {
  ...defaultMapping(),
  date: 0,
  reference: 1,
  amount: 2,
  pdfReviewed: true,
};
const buffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
for (const number of [3, 4, 19])
  test(`045 PDF foundation ${number}: real files preserve metadata, balances, footer and all movements`, async () => {
    const spec = generateCase(foundationManifest()[number - 1]);
    const rendered = await renderCase(spec);
    const configuredScope = {
      ...scope,
      ...spec.sources[0].metadata,
      confirmed: true,
      coverageConfirmed: true,
    };
    const sources = [];
    for (const [i, f] of rendered.files.entries()) {
      const src = spec.sources[i];
      const parsed = await readFile(f.name, buffer(f.bytes), [], true);
      const side = i === 0 ? 'supplier' : 'ledger';
      const selection = selectImportMapping(parsed, side).mapping;
      const result = normalizeSource(
        parsed,
        {
          ...selection,
          dateFormat: src.metadata.dateFormat,
          numberFormat: src.metadata.numberFormat,
          pdfReviewed: true,
        },
        configuredScope,
        side,
      );
      assert.deepEqual(result.errors, [], f.name);
      assert.deepEqual(
        result.transactions.map((t) => t.amount).sort((a, b) => a - b),
        src.rows
          .map((r: { minor: number }) => r.minor)
          .sort((a: number, b: number) => a - b),
      );
      assert.equal(result.metadata?.currency, src.metadata.currency);
      assert.equal(result.metadata?.periodStart, src.metadata.periodStart);
      assert.equal(result.metadata?.periodEnd, src.metadata.cutoff);
      assert.equal(result.opening, src.metadata.opening);
      assert.equal(result.closing, src.metadata.closing);
      assert.equal(
        result.balanceArithmeticStatus,
        'BALANCE_ARITHMETIC_VERIFIED',
      );
      if (f.format === 'pdf') {
        assert.ok(
          result.excluded.some((r) => /Page 1/.test(r.values.join(' '))),
        );
        assert.ok(result.metadata?.balanceRowReference.closing?.page);
      }
      sources.push(result);
    }
    const result = compare(sources[0], sources[1], configuredScope);
    assert.equal(
      result.matches.length,
      number === 19 ? 0 : spec.oracle.permittedAutoMatches.length,
    );
    if (number === 19)
      assert.ok(
        result.cases.some((c) => c.status === 'Needs Review'),
        'payment groups remain review-only without supported allocation proof',
      );
    assert.equal(result.bridge?.residual, 0);
  });
for (const id of ['C01436', 'C03754'])
  test(`045 PDF reordered multi-page source ${id} retains every movement and excludes only repeated page metadata`, async () => {
    const spec = generateCase(
      buildManifest().find((d: { id: string }) => d.id === id),
    );
    const rendered = await renderCase(spec);
    const pdf = rendered.files.find(
      (f: { format: string }) => f.format === 'pdf',
    )!;
    const original = spec.sources.find(
      (s: { format: string }) => s.format === 'pdf',
    )!;
    const parsed = await readFile(pdf.name, buffer(pdf.bytes), [], true);
    const selected = selectImportMapping(parsed, 'supplier').mapping;
    assert.equal(selected.date, 1);
    assert.equal(selected.reference, 0);
    const result = normalizeSource(
      parsed,
      {
        ...selected,
        dateFormat: original.metadata.dateFormat,
        numberFormat: original.metadata.numberFormat,
        pdfReviewed: true,
      },
      { ...scope, ...original.metadata },
      'supplier',
    );
    assert.deepEqual(result.errors, []);
    assert.equal(result.transactions.length, original.rows.length);
    assert.equal(result.balanceArithmeticStatus, 'BALANCE_ARITHMETIC_VERIFIED');
    assert.deepEqual(
      result.transactions.map((r) => [r.reference, r.amount]),
      original.rows.map((r: { reference: string; minor: number }) => [
        r.reference,
        r.minor,
      ]),
    );
    assert.ok(result.excluded.some((r) => /رأس صفحة/.test(r.reason)));
  });
test('045 a later-page changed identity or a transaction before the repeated header is never excluded as metadata', () => {
  const first = [
    ['Currency: SAR Entity: Buyer', '', ''],
    ['Date', 'Reference', 'Amount'],
    ['2026-07-15', 'INV-21', '100'],
    ['Page 1', '', ''],
  ];
  for (const extra of [
    ['Currency: USD Entity: Other', '', ''],
    ['2026-07-16', 'INV-22', '25'],
  ]) {
    const f = inMemory([
      ...first,
      extra,
      ['Date', 'Reference', 'Amount'],
      ['2026-07-17', 'INV-23', '100'],
    ]);
    f.sheets[0].rowPages = {
      '1': 1,
      '2': 1,
      '3': 1,
      '4': 1,
      '5': 2,
      '6': 2,
      '7': 2,
    };
    const r = normalizeSource(f, { ...map, header: 1 }, scope, 'supplier');
    assert.ok(!r.excluded.some((e) => e.row === 5));
    if (extra[0].startsWith('Currency'))
      assert.ok(r.errors.some((e) => e.row === 5));
    else
      assert.ok(r.transactions.some((t) => t.row === 5 && t.amount === 2500));
  }
});
function inMemory(rows: string[][], header = 0): SourceFile {
  return {
    name: 'source.pdf',
    pdf: { cuts: [30, 60], pages: 1 },
    sheets: [
      {
        name: 'PDF',
        rows,
        formulaRows: [],
        hiddenRows: [],
        rowPages: Object.fromEntries(rows.map((_, i) => [String(i + 1), 1])),
      },
    ],
  };
}
test('045 only an isolated exact page-number footer is excluded', () => {
  for (const footer of ['Page 1', 'Page 2 of 3', 'صفحة ١', 'الصفحة ٢ من ٣']) {
    const file = inMemory([
      ['Date', 'Reference', 'Amount'],
      ['2026-07-15', 'INV-20', '100'],
      [footer, '', ''],
    ]);
    const result = normalizeSource(file, map, scope, 'supplier');
    assert.equal(result.errors.length, 0, footer);
    assert.equal(result.transactions.length, 1);
    assert.ok(result.excluded.some((r) => r.row === 3));
  }
  for (const footer of [
    ['Page invoice', '', ''],
    ['Page 1', 'INV-2', '100'],
    ['Page 1 100', '', ''],
    ['Page 1/INV-2', '', ''],
  ]) {
    const result = normalizeSource(
      inMemory([
        ['Date', 'Reference', 'Amount'],
        ['2026-07-15', 'INV-20', '100'],
        footer,
      ]),
      map,
      scope,
      'supplier',
    );
    assert.ok(
      result.errors.some((r) => r.row === 3),
      footer.join('|'),
    );
    assert.ok(!result.excluded.some((r) => r.row === 3));
  }
});
test('045 inline closing balances retain amount and source evidence without erasing a dated invoice', () => {
  const file = inMemory([
    ['Date', 'Reference', 'Amount'],
    ['2026-07-15', 'INV-20', '100'],
    ['Closing balance: 100.00', '', ''],
  ]);
  const result = normalizeSource(
    file,
    { ...map, opening: '0', periodStart: '2026-07-01' },
    scope,
    'supplier',
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.closing, 10000);
  assert.equal(
    result.metadata?.balanceRowReference.closing?.originalValue,
    'Closing balance: 100.00',
  );
  const adverse = inMemory([
    ['Date', 'Reference', 'Amount', 'Description'],
    ['2026-07-15', 'INV-20', '100', 'Closing balance: 100.00'],
  ]);
  assert.equal(
    normalizeSource(adverse, { ...map, description: 3 }, scope, 'supplier')
      .transactions.length,
    1,
  );
  for (const text of [
    'Closing balance: 10 000123',
    'Closing balance: 1OO.00',
    'Closing balance: - 100.00',
  ]) {
    const invalid = normalizeSource(
      inMemory([
        ['Date', 'Reference', 'Amount'],
        ['2026-07-15', 'INV-20', '100'],
        [text, '', ''],
      ]),
      map,
      scope,
      'supplier',
    );
    assert.ok(
      invalid.errors.some((r) => r.row === 3),
      text,
    );
  }
});
test('045 PDF metadata outside table columns can span cuts without concatenating financial values', async () => {
  const bytes = syntheticPdf(
    [
      [
        ['Currency: SAR Account: AP-231 Entity: North Distribution'],
        ['Period: 2026-07-01 to 2026-07-31'],
        ['Opening balance: 0.00'],
        ['Date', 'Reference', 'Amount'],
        ['2026-07-15', 'INV-20', '100.00'],
        ['Closing balance: 100.00'],
        ['Page 1'],
      ],
    ],
    8,
  );
  const parsed = await readFile('synthetic.pdf', bytes, [25, 46]);
  const result = normalizeSource(
    parsed,
    { ...map, header: 3 },
    { ...scope, account: 'AP-231', entity: 'North Distribution' },
    'supplier',
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.metadata?.currency, 'SAR');
  assert.equal(result.metadata?.entityName, 'North Distribution');
  assert.equal(result.metadata?.periodEnd, '2026-07-31');
  assert.equal(result.closing, 10000);
});

test('045 all 24 supported four-column PDF orders preserve the same financial fields', async () => {
  const fields = ['Date', 'Reference', 'Description', 'Amount'];
  function permutations<T>(values: T[]): T[][] {
    return values.length
      ? values.flatMap((v, i) =>
          permutations(values.filter((_, j) => j !== i)).map((rest) => [
            v,
            ...rest,
          ]),
        )
      : [[]];
  }
  for (const order of permutations(fields)) {
    const values: Record<string, string> = {
      Date: '2026-07-15',
      Reference: 'INV-045-61',
      Description: 'Goods supplied',
      Amount: '123.45',
    };
    const bytes = syntheticPdf(
      [[order, order.map((field) => values[field])]],
      8,
    );
    const file = await readFile('column-order.pdf', bytes, [], true);
    const mapping = selectImportMapping(file, 'supplier').mapping;
    const r = normalizeSource(
      file,
      { ...mapping, pdfReviewed: true },
      scope,
      'supplier',
    );
    assert.deepEqual(r.errors, [], order.join('|'));
    assert.equal(r.transactions.length, 1);
    assert.deepEqual(
      [
        r.transactions[0].date,
        r.transactions[0].reference,
        r.transactions[0].amount,
      ],
      ['2026-07-15', 'INV-045-61', 12345],
    );
  }
});
