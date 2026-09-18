import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as readBytes } from 'node:fs/promises';
import {
  compare,
  normalizeSource,
  inlineBalanceSummary,
  structuralSummaryLabel,
} from '../lib/reconciliation/core.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type { SourceFile, Scope } from '../lib/reconciliation/types.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { inferStatementDirection } from '../lib/reconciliation/statement-direction.ts';
import { syntheticPdf } from './helpers/pdf-fixture.ts';

test('046 Arabic presentation forms normalize document categories without rewriting source, references or amounts', () => {
  const scope: Scope = {
    supplier: '',
    entity: '',
    account: '',
    currency: 'SAR',
    decimals: 2,
    cutoff: '2026-07-31',
    dateWindow: 2,
    confirmed: true,
    coverageConfirmed: false,
  };
  const mapping = { ...defaultMapping(), date: 0, reference: 1, amount: 2 };
  for (const [raw, plain, expected, amount] of [
    ['ﻓﺎﺗﻮﺭﺓ', 'فاتورة', 'Invoice', '100.00'],
    ['ﺩﻓﻌﺔ', 'دفعة', 'Payment', '-40.00'],
    ['ﺇﺷﻌﺎﺭ ﺩﺍﺋﻦ', 'إشعار دائن', 'Credit Note', '-10.00'],
  ] as const) {
    assert.equal(
      raw.normalize('NFKC'),
      plain,
      'fixture encodes the intended category',
    );
    const source = (type: string): SourceFile => ({
      name: 'synthetic-category.csv',
      sheets: [
        {
          name: 'Data',
          formulaRows: [],
          hiddenRows: [],
          rows: [
            ['Date', 'Invoice No', 'Amount', 'نوع المستند'],
            ['2026-07-15', 'DOC-00046', amount, type],
          ],
        },
      ],
    });
    const a = source(plain),
      b = source(raw);
    const original = structuredClone(b);
    const left = normalizeSource(a, mapping, scope, 'supplier');
    const right = normalizeSource(b, mapping, scope, 'ledger');
    assert.equal(right.transactions[0].documentType, expected);
    assert.equal(right.transactions[0].originalAmount, amount);
    assert.equal(right.transactions[0].reference, 'DOC-00046');
    assert.deepEqual(right.transactions[0].referenceEvidenceIssues, []);
    assert.equal(compare(left, right, scope).matches.length, 1);
    assert.deepEqual(b, original);
  }
});

const balanceScope: Scope = {
  supplier: 'Synthetic supplier',
  entity: 'Synthetic buyer',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 0,
  confirmed: true,
  coverageConfirmed: false,
};
test('046 actual Arabic PDF balance labels establish arithmetic with original provenance, not coverage', async () => {
  const bytes = await readBytes(
    new URL(
      './fixtures/pdf-arabic-046/reportlab-arabic-balances.pdf',
      import.meta.url,
    ),
  );
  const file = await readFile(
    'reportlab-arabic-balances.pdf',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    [],
    true,
  );
  const mapping = {
    ...selectImportMapping(file, 'supplier').mapping,
    pdfReviewed: true,
  };
  const original = structuredClone(file);
  const result = normalizeSource(file, mapping, balanceScope, 'supplier');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.transactions.map((t) => t.amount),
    [123450, -25075, -9805],
  );
  assert.equal(result.metadata?.currency, 'SAR');
  assert.equal(result.metadata?.periodStart, '2026-07-01');
  assert.equal(result.metadata?.periodEnd, '2026-07-31');
  assert.equal(result.opening, 0);
  assert.equal(result.closing, 88570);
  assert.equal(result.balanceArithmeticStatus, 'BALANCE_ARITHMETIC_VERIFIED');
  assert.equal(result.balanceValid, false);
  assert.equal(
    result.metadata?.balanceRowReference.opening?.originalValue,
    '٠٫٠٠',
  );
  assert.equal(
    result.metadata?.balanceRowReference.closing?.originalValue,
    '٨٨٥٫٧٠',
  );
  assert.deepEqual(
    result.excluded.find((row) => row.row === 4)?.values,
    file.sheets[0].rows[3],
  );
  assert.deepEqual(
    result.excluded.find((row) => row.row === 8)?.values,
    file.sheets[0].rows[7],
  );
  assert.equal(
    result.excluded.length + result.transactions.length,
    file.sheets[0].rows.length,
  );
  assert.deepEqual(file, original);
  const wrongCurrency = structuredClone(file);
  wrongCurrency.sheets[0].rows[0][1] = 'USD';
  const conflicted = normalizeSource(
    wrongCurrency,
    mapping,
    balanceScope,
    'supplier',
  );
  assert.equal(conflicted.metadata?.currency, 'USD');
  assert.ok(conflicted.errors.some((error) => /عملة/.test(error.message)));
  const wrongClosing = structuredClone(file);
  wrongClosing.sheets[0].rows[7][1] = '(٨٨٥٫٧٠)';
  const wrong = normalizeSource(
    wrongClosing,
    mapping,
    balanceScope,
    'supplier',
  );
  assert.equal(wrong.closing, -88570);
  assert.equal(wrong.balanceArithmeticStatus, 'BALANCE_ARITHMETIC_FAILED');
  assert.equal(wrong.balanceValid, false);
});

test('046 balance category normalization never repairs monetary characters or erases dated documents and unsafe labels', () => {
  const mapping = { ...defaultMapping(), date: 0, reference: 1, amount: 2 };
  const opening = 'اﻟﺮﺻﻴﺪ اﻻﻓﺘﺘﺎﺣﻲ',
    closing = 'اﻟﺮﺻﻴﺪ اﻟﺨﺘﺎﻣﻲ';
  const valid = `${closing}: (٨٨٥٫٧٠) SAR`;
  assert.deepEqual(inlineBalanceSummary([valid], mapping), {
    label: 'الرصيد الختامي',
    amount: '(٨٨٥٫٧٠)',
    currency: 'SAR',
    column: 0,
    original: valid,
  });
  for (const value of ['①.00', '¹.00', '１.00', '(-100.00)', '--100.00'])
    assert.equal(
      inlineBalanceSummary([`${closing}: ${value} SAR`], mapping),
      undefined,
      value,
    );
  const dated = [closing, 'INV-00046', '100.00', '2026-07-01'];
  assert.equal(
    structuralSummaryLabel(dated, { ...mapping, date: 3 }, [
      'Description',
      'Reference',
      'Amount',
      'Date',
    ]),
    undefined,
  );
  const file: SourceFile = {
    name: 'synthetic-unsafe-balance.csv',
    sheets: [
      {
        name: 'Data',
        formulaRows: [],
        hiddenRows: [],
        rows: [
          ['Date', 'Reference', 'Amount'],
          [opening, '', '0.00'],
          ['2026-07-01', 'INV-00046', '100.00'],
          [closing, '', '100.00'],
        ],
      },
    ],
  };
  for (const issueKind of ['cellIssues', 'referenceIssues'] as const) {
    const unsafe = structuredClone(file);
    unsafe.sheets[0][issueKind] = { '2:1': ['Untrusted structural label'] };
    const result = normalizeSource(unsafe, mapping, balanceScope, 'supplier');
    assert.ok(result.errors.some((error) => error.row === 2));
    assert.equal(
      result.excluded.some((row) => row.row === 2),
      false,
    );
    assert.equal(result.balanceValid, false);
    assert.notEqual(
      result.balanceArithmeticStatus,
      'BALANCE_ARITHMETIC_VERIFIED',
    );
  }
});

test('046 shaped running balance labels retain exact sign proof and reject conflicting recurrences', () => {
  const mapping = {
    ...defaultMapping(),
    date: 0,
    reference: 1,
    debit: 2,
    credit: 3,
    mode: 'split' as const,
  };
  const file: SourceFile = {
    name: 'synthetic-shaped-direction.csv',
    sheets: [
      {
        name: 'Data',
        formulaRows: [],
        hiddenRows: [],
        rows: [
          ['Date', 'Reference', 'Debit', 'Credit', 'اﻟﺮﺻﻴﺪ اﻟﺠﺎري'],
          ['اﻟﺮﺻﻴﺪ اﻻﻓﺘﺘﺎﺣﻲ', '', '', '', '100'],
          ['2026-07-02', 'INV-100', '25', '', '125'],
          ['2026-07-03', 'PAY-100', '', '10', '115'],
        ],
      },
    ],
  };
  assert.equal(inferStatementDirection(file, mapping)?.multiplier, 1);
  file.sheets[0].rows[3][4] = '135';
  assert.equal(inferStatementDirection(file, mapping), undefined);
});

test('046 rectangular PDF clipping cannot ignore nested exclusions, holes or a later opaque cover', async () => {
  const text = [
    ['Date', 'Reference', 'Amount'],
    ['2026-07-01', 'INV-00046', '100.00'],
  ]
    .flatMap((row, r) =>
      row.map(
        (value, c) =>
          `BT /F1 10 Tf 1 0 0 1 ${[40, 170, 300][c]} ${750 - r * 20} Tm (${value}) Tj ET`,
      ),
    )
    .join('\n');
  const full = 'q 0 0 600 800 re W n\n';
  const raw = (content: string) => syntheticPdf([[]], 10, content);
  const restored = await readFile(
    'restored-rectangular-clip.pdf',
    raw(full + 'q 0 0 200 800 re W n Q\n' + text + '\nQ'),
    [],
    true,
  );
  assert.deepEqual(restored.sheets[0].rows[1], [
    '2026-07-01',
    'INV-00046',
    '100.00',
  ]);
  for (const content of [
    full + 'q 0 0 200 800 re W n\n' + text + '\nQ Q',
    'q 0 0 600 800 re 290 710 100 30 re W* n\n' + text + '\nQ',
    full + text + '\n1 g 290 720 100 30 re f\nQ',
  ])
    await assert.rejects(
      readFile('unsafe-clip-or-cover.pdf', raw(content), [], true),
      /مقصوص|يغطي|يتداخل/,
    );
});
