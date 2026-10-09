import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as bytes } from 'node:fs/promises';
import { readFile } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import {
  explainResult,
  resolveQuestionReferences,
  verifyHypothesis,
} from '../lib/reconciliation/assistant.ts';
import { SHORT_DOCUMENT_RULE } from '../lib/reconciliation/transaction-references.ts';
import type { Mapping, Scope, SourceFile } from '../lib/reconciliation/types.ts';

const scope: Scope = {
  supplier: 'S',
  entity: 'E',
  account: 'AP-714',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 3,
  confirmed: true,
  coverageConfirmed: false,
};
const header = [
  'Date',
  'Document No',
  'Type',
  'Amount',
  'PO',
  'Reference',
  'Description',
];
const row = (
  ref = 'CN-3',
  type = 'Credit Note',
  amount = '-50.00',
  date = '2026-07-17',
) => [date, ref, type, amount, '', '', ''];
async function csv(rows: string[][], side: string, labels = header) {
  // Distinct books, not an identical SHA compared with itself. The extra
  // source label is an unused helper and grants no matching authority.
  const sourceRows = [
    [...labels, 'Source file label'],
    ...rows.map((r) => [...r, side + ' book']),
  ];
  return readFile(
    side + '.csv',
    new TextEncoder().encode(
      sourceRows
        .map((r) => r.map((v) => '"' + v.replace(/"/g, '""') + '"').join(','))
        .join('\n'),
    ).buffer,
  );
}
async function run(
  a: string[][],
  b: string[][],
  options: {
    leftHeader?: string[];
    rightHeader?: string[];
    change?: (maps: [Mapping, Mapping]) => void;
  } = {},
) {
  const files = [
    await csv(a, 'supplier', options.leftHeader),
    await csv(b, 'ledger', options.rightHeader),
  ] as const;
  const mappings = files.map(
    (f, i) => selectImportMapping(f, i ? 'ledger' : 'supplier').mapping,
  ) as [Mapping, Mapping];
  options.change?.(mappings);
  return reconcileSupplierStatement({ files: [...files], mappings, scope })
    .result;
}
const auto = (r: Awaited<ReturnType<typeof run>>) =>
  r.matches.filter((m) => m.kind === 'auto');

for (const [ref, type, amount] of [
  ['CN-3', 'Credit Note', '-50.00'],
  ['C3', 'إشعار دائن', '-50.00'],
  ['I1', 'Invoice', '50.00'],
  ['ف١', 'فاتورة', '50.00'],
]) {
  void test(
    'typed short literal ' +
      ref +
      ': native rows require a successful exact 1:1 proof',
    async () => {
      const result = await run(
        [row(ref, type, amount)],
        [row(ref, type, amount)],
      );
      assert.equal(auto(result).length, 1);
      assert.equal(result.cases[0].matchingRule, SHORT_DOCUMENT_RULE);
      assert.equal(result.matches[0].evidence?.dateGap, 0);
      assert.equal(result.balanceComparable, false);
    },
  );
}
const negative: [string, string[][], string[][], Parameters<typeof run>[2]?][] =
  [
    ['missing type in supplier', [row('CN-3', '')], [row()]],
    ['missing type in ledger', [row()], [row('CN-3', '')]],
    [
      'issuer-specific type code is not a type',
      [row('CN-3', 'CN')],
      [row('CN-3', 'CN')],
    ],
    [
      'description cannot supply type',
      [[...row('CN-3', '').slice(0, 6), 'Credit Note']],
      [row()],
    ],
    ['different explicit types', [row()], [row('CN-3', 'Invoice', '-50.00')]],
    [
      'payment is not a short document',
      [row('P1', 'Payment')],
      [row('P1', 'Payment')],
    ],
    [
      'journal is not a short document',
      [row('J1', 'Journal')],
      [row('J1', 'Journal')],
    ],
    [
      'credit note with positive sign',
      [row('C3', 'Credit Note', '50.00')],
      [row('C3', 'Credit Note', '50.00')],
    ],
    [
      'invoice with negative sign',
      [row('I1', 'Invoice', '-50.00')],
      [row('I1', 'Invoice', '-50.00')],
    ],
    [
      'zero cannot be approved',
      [row('C3', 'Credit Note', '0.00')],
      [row('C3', 'Credit Note', '0.00')],
    ],
    [
      'numeric-only short identifier stays outside this rule',
      [row('123')],
      [row('123')],
    ],
    [
      'letter-only identifier stays outside this rule',
      [row('CN')],
      [row('CN')],
    ],
    [
      'date gap of one day is too much for a short identifier',
      [row()],
      [row('CN-3', 'Credit Note', '-50.00', '2026-07-18')],
    ],
    ['different amount', [row()], [row('CN-3', 'Credit Note', '-51.00')]],
    [
      'normalization cannot grant literal equality',
      [row('CN-3')],
      [row('CN3')],
    ],
    [
      'case normalization cannot grant literal equality',
      [row('cn-3')],
      [row('CN-3')],
    ],
    [
      'Unicode normalization cannot grant literal equality',
      [row('ＣＮ３')],
      [row('CN3')],
    ],
    [
      'conflicting order',
      [['2026-07-17', 'CN-3', 'Credit Note', '-50.00', 'PO-1', '', '']],
      [['2026-07-17', 'CN-3', 'Credit Note', '-50.00', 'PO-2', '', '']],
    ],
    [
      'conflicting description',
      [row()],
      [
        [
          '2026-07-17',
          'CN-3',
          'Credit Note',
          '-50.00',
          '',
          '',
          'Invoice adjustment',
        ],
      ],
    ],
    [
      'generic chosen Reference is not an explicit document number',
      [row()],
      [row()],
      {
        leftHeader: [
          'Date',
          'Reference',
          'Type',
          'Amount',
          'PO',
          'Other Reference',
          'Description',
        ],
      },
    ],
    [
      'voucher number is not an explicit document number',
      [row()],
      [row()],
      {
        leftHeader: [
          'Date',
          'Voucher',
          'Type',
          'Amount',
          'PO',
          'Reference',
          'Description',
        ],
      },
    ],
    [
      'repeated original short reference with a different amount',
      [row(), row('CN-3', 'Credit Note', '-49.00')],
      [row()],
    ],
    [
      'invoice number on a credit note may identify the original invoice',
      [row()],
      [row()],
      {
        leftHeader: [
          'Date',
          'Invoice No',
          'Type',
          'Amount',
          'PO',
          'Reference',
          'Description',
        ],
      },
    ],
    [
      'generic supplier reference is not a document number',
      [row()],
      [row()],
      {
        leftHeader: [
          'Date',
          'Supplier Reference',
          'Type',
          'Amount',
          'PO',
          'Reference',
          'Description',
        ],
      },
    ],
    [
      'repeated normalized reference with different spelling',
      [row(), row('CN3', 'Credit Note', '-49.00')],
      [row()],
    ],
    [
      'manually excluded competitor',
      [row(), row()],
      [row()],
      {
        change: (m) => {
          m[0].excluded['3'] = 'duplicate needs review';
        },
      },
    ],
    [
      'unread competitor',
      [row(), row('CN-3', 'Credit Note', 'invalid')],
      [row()],
    ],
    [
      'outside-period competitor still occupies the identity',
      [row(), row('CN-3', 'Credit Note', '-50.00', '2026-08-01')],
      [row()],
    ],
    [
      'two short credit parts are not a certified group',
      [row('C3', 'Credit Note', '-20.00'), row('C3', 'Credit Note', '-30.00')],
      [row('C3', 'Credit Note', '-50.00')],
    ],
    [
      'formula-like source text is never identity authority',
      [row('=C3')],
      [row('=C3')],
    ],
    [
      'a conflicting selected reference is retained',
      [[...row().slice(0, 5), 'OTHER-1', '']],
      [row()],
      {
        change: (m) => {
          m[0].reference = 5;
        },
      },
    ],
    [
      'an unread row with no identity cannot be isolated',
      [row(), row('', 'Credit Note', 'invalid')],
      [row()],
    ],
  ];
for (const [name, a, b, options] of negative)
  void test('typed short safety: ' + name, async () => {
    const result = await run(a, b, options);
    assert.equal(auto(result).length, 0, name);
    assert.equal(
      result.supplier.transactions.length +
        result.supplier.errors.filter((e) => e.row > 0).length +
        result.supplier.excluded.length,
      a.length + 1,
      'all physical rows retained',
    );
    assert.equal(result.balanceComparable, false);
  });

void test('typed short: an isolated unrelated bad amount does not disable a proven match', async () => {
  const r = await run([row(), row('OTHER-55', 'Invoice', 'invalid')], [row()]);
  assert.equal(r.supplier.errors.length, 1);
  assert.equal(auto(r).length, 1);
  assert.equal(r.balanceComparable, false);
});
void test('typed short: Arabic and English type/header labels name the same explicit source role', async () => {
  const r = await run([row('C3')], [row('C3', 'إشعار دائن')], {
    rightHeader: [
      'التاريخ',
      'رقم المستند',
      'نوع المستند',
      'المبلغ',
      'أمر الشراء',
      'المرجع',
      'الوصف',
    ],
  });
  assert.equal(auto(r).length, 1);
  assert.equal(r.cases[0].matchingRule, SHORT_DOCUMENT_RULE);
});
void test('typed short: Invoice No supplies number authority for an invoice only', async () => {
  const r = await run(
    [row('I1', 'Invoice', '50.00')],
    [row('I1', 'فاتورة', '50.00')],
    {
      leftHeader: [
        'Date',
        'Invoice No',
        'Type',
        'Amount',
        'PO',
        'Reference',
        'Description',
      ],
    },
  );
  assert.equal(auto(r).length, 1);
  assert.equal(
    r.supplier.transactions[0].documentNumberEvidence?.role,
    'invoice-number',
  );
});
void test('typed short: row order and a disjoint decoy do not change approved membership', async () => {
  for (const reversed of [false, true]) {
    const a = [row('C3'), row('OTHER-55', 'Credit Note', '-50.00')];
    if (reversed) a.reverse();
    const r = await run(a, [row('C3')]);
    assert.equal(auto(r).length, 1);
    const c = r.cases.find((c) => c.status === 'Matched')!;
    assert.deepEqual(
      c.supplierMembers.map((t) => t.documentReference),
      ['C3'],
    );
  }
});
void test('typed short: original membership survives a manual decision consuming the rival', async () => {
  const files = [
    await csv([row(), row('CN-3', 'Credit Note', '-49.00')], 's'),
    await csv([row(), row('OTHER-55', 'Credit Note', '-49.00')], 'l'),
  ];
  const mappings = files.map(
    (f, i) => selectImportMapping(f, i ? 'ledger' : 'supplier').mapping,
  ) as [Mapping, Mapping];
  const r = reconcileSupplierStatement({
    files: files as [SourceFile, SourceFile],
    mappings,
    scope,
    decisions: [
      {
        supplierId: 'supplier:0:3',
        ledgerId: 'ledger:0:3',
        note: 'confirmed by accountant',
      },
    ],
  }).result;
  assert.equal(r.matches.filter((m) => m.kind === 'manual').length, 1);
  assert.equal(auto(r).length, 0);
});
void test('typed short: a rejected pair cannot be recreated by the new rule', async () => {
  const files = [await csv([row()], 's'), await csv([row()], 'l')];
  const mappings = files.map(
    (f, i) => selectImportMapping(f, i ? 'ledger' : 'supplier').mapping,
  ) as [Mapping, Mapping];
  const r = reconcileSupplierStatement({
    files: files as [SourceFile, SourceFile],
    mappings,
    scope,
    rejected: ['supplier:0:2|ledger:0:2'],
  }).result;
  assert.equal(auto(r).length, 0);
});
void test('typed short: chat resolves complete C3, refuses C30 and never manufactures approval', async () => {
  const r = await run([row('C3')], [row('C3')]);
  assert.equal(resolveQuestionReferences(r, 'لماذا C3')?.length, 2);
  assert.equal(resolveQuestionReferences(r, 'لماذا C30'), null);
  const answer = explainResult(r, 'لماذا C3');
  assert.ok(answer.sourceIds.length === 2 && answer.text.includes('نوعه'));
  const review = await run([row('C3', '')], [row('C3', '')]);
  const h = verifyHypothesis(review, {
    supplierIds: ['supplier:0:2'],
    ledgerIds: ['ledger:0:2'],
  });
  assert.equal(auto(review).length, 0);
  assert.equal(h.status, 'needs-review');
  assert.equal(auto(review).length, 0, 'the hypothesis cannot create a match');
});

void test('F02-E: actual OOXML files give all required matches and keep the equal-sum conflict unapproved', async () => {
  const contract = JSON.parse(
    await bytes('audit/typed-document/contract.json', 'utf8'),
  );
  for (const kind of ['proven', 'conflict']) {
    const names = ['supplier-typed-' + kind + '.xlsx', 'ledger-typed.csv'];
    const files = await Promise.all(
      names.map(async (name) =>
        readFile(
          name,
          new Uint8Array(await bytes('audit/typed-document/frozen/' + name))
            .buffer,
        ),
      ),
    );
    const mappings = files.map(
      (f, i) => selectImportMapping(f, i ? 'ledger' : 'supplier').mapping,
    ) as [Mapping, Mapping];
    const r = reconcileSupplierStatement({
      files: files as [SourceFile, SourceFile],
      mappings,
      scope: contract.scope,
    }).result;
    assert.deepEqual(r.supplier.errors, []);
    assert.equal(r.supplier.transactions.length, 4);
    assert.deepEqual(
      r.cases
        .filter((c) => c.status === 'Matched')
        .map((c) => c.supplierMembers.map((t) => t.row))
        .sort((a, b) => a[0] - b[0]),
      kind === 'proven' ? [[6, 7], [8], [9]] : [[8], [9]],
    );
    assert.equal(r.balanceComparable, false);
  }
});
