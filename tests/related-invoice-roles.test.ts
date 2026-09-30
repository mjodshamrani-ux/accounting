import test from 'node:test';
import { askLocalModel } from '../lib/reconciliation/local-ai.ts';
import ExcelJS from 'exceljs';
import { separateSheets } from './helpers/separate-export.ts';
import assert from 'node:assert/strict';
import { readFile as bytes } from 'node:fs/promises';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import {
  explainResult,
  verifyHypothesis,
  resolveQuestionReferences,
} from '../lib/reconciliation/assistant.ts';
import { usableDiscriminator } from '../lib/reconciliation/document-pairs.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';
type F03Case = {
  id: string;
  approved: number;
  primary?: string;
  related?: string | null;
  amountMinor?: number;
  supplierRows?: number[];
  ledgerRows?: number[];
};
const contract = JSON.parse(
  await bytes(
    new URL('../audit/related-invoice/contract.json', import.meta.url),
    'utf8',
  ),
) as { scope: Scope; cases: F03Case[] };
const scope: Scope = contract.scope;
for (const c of contract.cases) {
  void test('F03 native own/related roles: ' + c.id, async () => {
    const files = (await Promise.all(
      ['supplier.xlsx', 'ledger.csv'].map(async (suffix) => {
        const name = c.id + '-' + suffix;
        const b = await bytes(
          new URL('../audit/related-invoice/frozen/' + name, import.meta.url),
        );
        return readFile(
          name,
          b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        );
      }),
    )) as [SourceFile, SourceFile];
    const mappings = files.map(
      (f, i) => selectImportMapping(f, i ? 'ledger' : 'supplier').mapping,
    ) as [Mapping, Mapping];
    const input = { files, mappings, scope };
    const r = reconcileSupplierStatement(input).result;
    assert.equal(r.caseCounts.autoMatchedCases, c.approved);
    assert.equal(r.balanceComparable, false);
    const matched = r.cases.filter((c) => c.status === 'Matched');
    if (c.approved) {
      assert.deepEqual(
        matched.map((m) => m.supplierMembers.map((t) => t.row)),
        [c.supplierRows],
      );
      assert.deepEqual(
        matched.map((m) => m.ledgerMembers.map((t) => t.row)),
        [c.ledgerRows],
      );
      assert.equal(matched[0].supplierTotal, c.amountMinor);
      assert.equal(matched[0].supplierMembers[0].reference, c.primary);
      if (c.related)
        assert.equal(
          matched[0].supplierMembers[0].relatedInvoiceReference,
          c.related,
        );
    }
    const restored = await restoreSession(
      await saveSession({
        ...input,
        decisions: [],
        rejected: [],
        events: [],
        review: { name: '', notes: '', checked: false },
      }),
    );
    assert.deepEqual(restored.result.cases, r.cases);
    assert.deepEqual(
      restored.result.supplier.transactions,
      r.supplier.transactions,
    );
    const exported = await exportWorkbook(r, files, {
      name: '',
      notes: '',
      checked: false,
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(exported);
    if (c.id === 'own-credit-note') {
      const evidence = book.getWorksheet('Match Evidence')!;
      assert.equal(evidence.getCell('L2').value, 'CN-701');
      assert.equal(evidence.getCell('AB2').value, 'INV-401');
      assert.equal(evidence.getCell('AC2').value, 'Invoice No');
      assert.equal(evidence.getCell('AD2').value, 3);
    }
    if (c.id === 'credit-note-invoice-only')
      assert.equal(r.caseCounts.needsReviewSourceRows, 2);
  });
}
const header = [
  'Date',
  'Credit Note No',
  'Invoice No',
  'Type',
  'Amount',
  'Reference',
];
const row = (own = 'CN-701', related = 'INV-401', amount = '-50.00') => [
  '2026-07-17',
  own,
  related,
  'Credit Note',
  amount,
  '',
];
const file = (rows: string[][], labels = header): SourceFile => ({
  name: 'synthetic.csv',
  sheets: [
    {
      name: 'Data',
      rows: structuredClone([labels, ...rows]),
      hiddenRows: [],
      formulaRows: [],
    },
  ],
});
const mapping = { ...defaultMapping(), date: 0, reference: 2, amount: 4 };
const run = (a: SourceFile, b: SourceFile, am = mapping, bm = mapping) =>
  compare(
    normalizeSource(a, am, scope, 'supplier'),
    normalizeSource(separateSheets(b), bm, scope, 'ledger'),
    scope,
  );

void test('F03 selected related-invoice column supplies neither own identity nor discriminator authority', () => {
  const r = run(file([row()]), file([row()]));
  const t = r.supplier.transactions[0];
  assert.equal(r.matches.length, 1);
  assert.equal(t.reference, 'CN-701');
  assert.equal(t.chosenReference, 'INV-401');
  assert.deepEqual(t.chosenReferenceEvidence, {
    role: 'related-invoice',
    header: 'Invoice No',
    column: 3,
  });
  assert.equal(t.documentNumberEvidence?.column, 2);
  assert.equal(usableDiscriminator(t.relatedInvoiceReference!), true); // spelling alone supplies no authority
  const repeat = run(file([row(), row()]), file([row(), row()]));
  assert.equal(
    repeat.matches.length,
    0,
    'a repeated original invoice is never a document partition',
  );
});
void test('F03 different selected roles permit the same proven short credit note', () => {
  const a = file([row('CN-3')]),
    b = file([row('CN-3')]);
  const r = run(a, b, { ...mapping, reference: 1 }, mapping);
  assert.equal(r.matches.length, 1);
  assert.equal(
    r.cases[0].matchingRule,
    'EXPLICIT_SHORT_DOCUMENT_EXACT_DATE_V1',
  );
});
void test('F03 column permutation and explicit Arabic headers preserve roles', () => {
  const a = file(
    [row('CN-3')],
    [
      'التاريخ',
      'رقم الإشعار الدائن',
      'رقم الفاتورة',
      'نوع المستند',
      'المبلغ',
      'المرجع',
    ],
  );
  const b = file(
    [['INV-401', '-50.00', '2026-07-17', 'Credit Note', 'CN-3']],
    ['Invoice No', 'Amount', 'Date', 'Type', 'Credit Note No'],
  );
  const r = run(a, b, mapping, {
    ...mapping,
    date: 2,
    reference: 0,
    amount: 1,
  });
  assert.equal(r.matches.length, 1);
  assert.equal(
    r.supplier.transactions[0].relatedInvoiceEvidence?.header,
    'رقم الفاتورة',
  );
  assert.equal(r.ledger.transactions[0].documentNumberEvidence?.column, 5);
});
for (const failure of [
  'duplicate own headers',
  'duplicate related headers',
  'hidden own cell',
  'unsafe related cell',
  'different chosen generic reference',
]) {
  void test('F03 keeps ambiguous evidence for review: ' + failure, () => {
    const a = file([row()]),
      b = file([row()]);
    let am = mapping,
      bm = mapping;
    if (failure === 'duplicate own headers') {
      a.sheets[0].rows[0][5] = 'Document No';
      a.sheets[0].rows[1][5] = 'CN-701';
    }
    if (failure === 'duplicate related headers') {
      a.sheets[0].rows[0][5] = 'Original Invoice No';
      a.sheets[0].rows[1][5] = 'INV-401';
    }
    if (failure === 'hidden own cell')
      a.sheets[0].referenceIssues = { '2:2': ['hidden identity'] };
    if (failure === 'unsafe related cell') a.sheets[0].rows[1][2] = '=INV-401';
    if (failure === 'different chosen generic reference') {
      a.sheets[0].rows[1][5] = 'DOC-A';
      b.sheets[0].rows[1][5] = 'DOC-B';
      am = { ...mapping, reference: 5 };
      bm = { ...mapping, reference: 5 };
    }
    const original = structuredClone(a);
    const r = run(a, b, am, bm);
    assert.equal(r.matches.length, 0);
    assert.deepEqual(a, original);
    assert.ok(r.caseCounts.needsReviewSourceRows >= 1);
    assert.equal(
      r.caseCounts.needsReviewSourceRows + r.caseCounts.unmatchedSourceRows,
      2,
    );
  });
}
for (const competitor of ['excluded', 'outside-period', 'failed amount']) {
  void test('F03 an own-number competitor remains after ' + competitor, () => {
    const a = file([row(), row('CN-701', 'INV-999', '-90.00')]),
      b = file([row()]);
    const am = { ...mapping };
    if (competitor === 'excluded') am.excluded = { 3: 'manual test exclusion' };
    if (competitor === 'outside-period') a.sheets[0].rows[2][0] = '2026-08-01';
    if (competitor === 'failed amount') a.sheets[0].rows[2][4] = 'not a number';
    const r = run(a, b, am);
    assert.equal(r.matches.length, 0);
    assert.equal(r.supplier.transactions.length, 1);
    assert.equal(
      r.supplier.errors.length +
        r.supplier.excluded.filter((e) => e.kind !== 'non-movement').length,
      1,
    );
  });
}
void test('F03 chat cites the original invoice without substituting it for a credit-note identity', () => {
  const r = run(file([row()]), file([row()]));
  assert.equal(resolveQuestionReferences(r, 'لماذا INV-401')?.length, 2);
  const answer = explainResult(r, 'لماذا CN-701');
  assert.match(answer.text, /الفاتورة المرتبطة «INV-401»/);
  assert.match(answer.text, /عمود «Invoice No»/);
  assert.equal(resolveQuestionReferences(r, 'لماذا INV-4010'), null);
});
void test('F03 AI cannot resolve a related-invoice contradiction or forge its provenance', () => {
  const r = run(file([row()]), file([row('CN-701', 'INV-402')]));
  const hypothesis = {
    supplierIds: [r.supplier.transactions[0].id],
    ledgerIds: [r.ledger.transactions[0].id],
  };
  const verified = verifyHypothesis(r, hypothesis);
  assert.equal(verified.status, 'rejected');
  assert.match(verified.reason, /الفواتير المرتبطة/);
  const forged = structuredClone(r);
  forged.cases[0].supplierMembers[0].relatedInvoiceEvidence = {
    header: 'Document No',
    column: 2,
  };
  assert.equal(verifyHypothesis(forged, hypothesis).status, 'rejected');
});
for (const id of [
  'own-credit-note',
  'short-own-credit-note',
  'different-credit-notes',
]) {
  void test('F03 native PDF uses own credit-note number: ' + id, async () => {
    const expected = contract.cases.find((c: { id: string }) => c.id === id);
    assert.ok(expected);
    const source = await bytes(
      new URL(
        '../audit/related-invoice/frozen/' + id + '-supplier.pdf',
        import.meta.url,
      ),
    );
    const ledger = await bytes(
      new URL(
        '../audit/related-invoice/frozen/' + id + '-ledger.csv',
        import.meta.url,
      ),
    );
    const files = (await Promise.all([
      readFile(
        id + '.pdf',
        source.buffer.slice(
          source.byteOffset,
          source.byteOffset + source.byteLength,
        ),
        [20, 41, 62, 79],
      ),
      readFile(
        id + '.csv',
        ledger.buffer.slice(
          ledger.byteOffset,
          ledger.byteOffset + ledger.byteLength,
        ),
      ),
    ])) as [SourceFile, SourceFile];
    const maps = files.map(
      (f, i) => selectImportMapping(f, i ? 'ledger' : 'supplier').mapping,
    ) as [Mapping, Mapping];
    maps[0].pdfReviewed = true; // explicit source review, never claimed automatic
    const r = reconcileSupplierStatement({
      files,
      mappings: maps,
      scope,
    }).result;
    assert.equal(r.matches.length, expected.approved);
    assert.equal(
      r.supplier.transactions[0].documentReference,
      expected.primary ?? 'CN-701',
    );
    assert.equal(r.supplier.transactions[0].relatedInvoiceReference, 'INV-401');
    assert.equal(r.supplier.transactions[0].sourcePage, 1);
    assert.equal(
      r.supplier.transactions[0].documentNumberEvidence?.header,
      'Credit Note No',
    );
  });
}

void test('F03 original invoice cannot partition repeated credit-note numbers', () => {
  const r = run(
    file([
      row('CN-701', 'INV-401', '-20.00'),
      row('CN-701', 'INV-402', '-30.00'),
    ]),
    file([
      row('CN-701', 'INV-401', '-20.00'),
      row('CN-701', 'INV-402', '-30.00'),
    ]),
  );
  assert.equal(r.matches.length, 0);
  assert.equal(r.caseCounts.needsReviewSourceRows, 4);
});

void test('F03 local model context keeps own/related roles and their canonical source columns', async () => {
  const r = run(file([row()]), file([row('CN-701', 'INV-402')]));
  let data:
    | {
        candidates: {
          reference: string;
          relatedInvoiceReference: string;
          relatedInvoiceEvidence: { header: string; column: number };
          signedMinorUnits: number;
        }[];
      }
    | undefined;
  await askLocalModel(
    r,
    'What should I review?',
    new AbortController().signal,
    {
      availability: async () => 'available',
      create: async () => ({
        prompt: async (prompt) => {
          data = JSON.parse(prompt.split('DATA=')[1]);
          return '{"intent":"unknown"}';
        },
        destroy() {},
      }),
    },
  );
  assert.ok(data);
  assert.equal(data.candidates.length, 2);
  assert.deepEqual(
    data.candidates.map((t) => t.reference),
    ['CN-701', 'CN-701'],
  );
  assert.deepEqual(
    data.candidates.map((t) => t.relatedInvoiceReference),
    ['INV-401', 'INV-402'],
  );
  for (const t of data.candidates) {
    assert.deepEqual(t.relatedInvoiceEvidence, {
      header: 'Invoice No',
      column: 3,
    });
    assert.equal(t.signedMinorUnits, -5000);
  }
});

void test('F03 an exact candidate with unverified type stays one review case with both source rows', () => {
  const a = file(
    [['2026-07-17', 'CN-701', 'INV-401', 'Issuer-CNX', '-50.00', '']],
    [
      'Date',
      'Document No',
      'Original Invoice No',
      'Type',
      'Amount',
      'Reference',
    ],
  );
  const b = structuredClone(a);
  const r = run(
    a,
    b,
    { ...mapping, reference: 1 },
    { ...mapping, reference: 1 },
  );
  assert.equal(r.matches.length, 0);
  assert.equal(
    r.cases.length,
    1,
    'unproved candidate must not become two unrelated review rows',
  );
  assert.equal(r.cases[0].status, 'Needs Review');
  assert.equal(r.cases[0].supplierMembers.length, 1);
  assert.equal(r.cases[0].ledgerMembers.length, 1);
});

void test('F03 a shared native Document No cannot erase contradictory document types', () => {
  for (const kind of ['Credit Note', 'Payment', 'Journal']) {
    const labels = [
      'Date',
      'Document No',
      'Original Invoice No',
      'Type',
      'Amount',
      'Reference',
    ];
    const a = file(
      [['2026-07-17', 'DOC-701', 'INV-401', 'Invoice', '50.00', '']],
      labels,
    );
    const b = file(
      [['2026-07-17', 'DOC-701', 'INV-401', kind, '50.00', '']],
      labels,
    );
    const r = run(
      a,
      b,
      { ...mapping, reference: 1 },
      { ...mapping, reference: 1 },
    );
    assert.equal(r.matches.length, 0, kind);
    assert.equal(r.cases.length, 1);
    assert.equal(r.cases[0].supplierMembers.length, 1);
    assert.equal(r.cases[0].ledgerMembers.length, 1);
    assert.ok(
      r.cases[0].evidence.some((text) => text.includes('نوعا المستند مختلفان')),
    );
  }
});

void test('F03 bank/receipt roles cannot authorize a voucher-only credit note or journal', () => {
  for (const type of ['Credit Note', 'Journal', 'Unknown'])
    for (const selected of [-1, 1])
      for (const paymentField of ['Bank Reference', 'Receipt No']) {
        const labels = [
          'Date',
          'Original Invoice No',
          'Type',
          'Amount',
          'AP Voucher',
          paymentField,
        ];
        const a = file(
          [['2026-07-17', 'INV-401', type, '-50.00', 'VCH-701', 'BANK-714']],
          labels,
        );
        const r = run(
          a,
          structuredClone(a),
          { ...mapping, reference: selected, amount: 3 },
          { ...mapping, reference: selected, amount: 3 },
        );
        assert.equal(
          r.matches.length,
          0,
          type + ' ' + paymentField + ' selected=' + selected,
        );
        assert.ok(r.supplier.transactions[0].referenceEvidenceIssues?.length);
      }
});
