import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as bytes } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import { separateSheets } from './helpers/separate-export.ts';
import { verifyHypothesis } from '../lib/reconciliation/assistant.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import { localizeEngineText } from '../lib/i18n/engine.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';
const root = '../audit/related-invoice/unknown-role/';
const contract = JSON.parse(
  await bytes(new URL(root + 'contract.json', import.meta.url), 'utf8'),
) as {
  scope: Scope;
  cases: {
    id: string;
    approved: number;
    supplierCredit: string;
    ledgerCredit: string;
    chosenReference?: boolean;
  }[];
};
for (const ext of ['xlsx', 'csv'])
  for (const c of contract.cases) {
    void test('Unknown credit role native ' + ext + ': ' + c.id, async () => {
      const files = (await Promise.all(
        ['supplier.' + ext, 'ledger.csv'].map(async (suffix) => {
          const name = c.id + '-' + suffix,
            b = await bytes(new URL(root + 'frozen/' + name, import.meta.url));
          return readFile(
            name,
            b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
          );
        }),
      )) as [SourceFile, SourceFile];
      const mappings = files.map(
        (f, i) => selectImportMapping(f, i ? 'ledger' : 'supplier').mapping,
      ) as [Mapping, Mapping];
      if (c.chosenReference) for (const m of mappings) m.reference = 6;
      const input = { files, mappings, scope: contract.scope };
      const r = reconcileSupplierStatement(input).result;
      assert.equal(r.caseCounts.autoMatchedCases, c.approved);
      assert.equal(r.balanceComparable, false);
      assert.equal(r.supplier.transactions.length, 1);
      assert.equal(r.ledger.transactions.length, 1);
      if (!c.approved) {
        assert.equal(r.caseCounts.needsReviewSourceRows, 2);
        for (const [i, t] of [
          r.supplier.transactions[0],
          r.ledger.transactions[0],
        ].entries()) {
          assert.equal(t.documentType, 'Unknown');
          assert.equal(t.documentNumberEvidence, undefined);
          assert.deepEqual(
            t.retainedEvidence?.find(
              (e) => e.field === 'unverifiedCreditNoteNumber',
            ),
            {
              field: 'unverifiedCreditNoteNumber',
              header: c.id.startsWith('arabic')
                ? 'رقم الإشعار الدائن'
                : 'Credit Note No',
              value: i ? c.ledgerCredit : c.supplierCredit,
            },
          );
          const warning = t.referenceEvidenceIssues?.find((s) =>
            s.includes('لم يتضح نوع المستند'),
          );
          assert.ok(warning);
          assert.match(
            localizeEngineText(warning, 'en'),
            /document type is unclear/,
          );
        }
        assert.equal(
          verifyHypothesis(r, {
            supplierIds: [r.supplier.transactions[0].id],
            ledgerIds: [r.ledger.transactions[0].id],
          }).status,
          'rejected',
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
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(
        await exportWorkbook(r, files, { name: '', notes: '', checked: false }),
      );
      const retained = book.getWorksheet('Match Evidence')!.getCell('W2').value;
      if (c.supplierCredit) {
        assert.equal(typeof retained, 'string');
        assert.match(retained as string, /unverifiedCreditNoteNumber.*CN-701/);
      } else assert.equal(retained, '');
    });
  }
const labels = ['Date', 'Credit Note No', 'Invoice No', 'Amount', 'Type'];
const source = (credit = 'CN-701', kind = ''): SourceFile => ({
  name: 'synthetic.csv',
  sheets: [
    {
      name: 'Data',
      rows: [[...labels], ['2026-07-17', credit, 'INV-401', '-50.00', kind]],
      hiddenRows: [],
      formulaRows: [],
    },
  ],
});
const mapping = { ...defaultMapping(), date: 0, reference: 2, amount: 3 };
const run = (a: SourceFile, b: SourceFile) =>
  compare(
    normalizeSource(a, mapping, contract.scope, 'supplier'),
    normalizeSource(separateSheets(b), mapping, contract.scope, 'ledger'),
    contract.scope,
  );
for (const cue of ['hidden cell', 'unsafe value', 'duplicate header']) {
  void test('Unknown credit cue cannot bypass review: ' + cue, () => {
    const a = source(),
      b = source();
    b.sheets[0].name = 'Other';
    if (cue === 'hidden cell')
      a.sheets[0].referenceIssues = { '2:2': ['hidden identity'] };
    if (cue === 'unsafe value') a.sheets[0].rows[1][1] = '=CN-701';
    if (cue === 'duplicate header') {
      a.sheets[0].rows[0].push('Credit Memo No');
      a.sheets[0].rows[1].push('CN-701');
    }
    const original = structuredClone(a);
    const r = run(a, b);
    assert.equal(r.matches.length, 0);
    assert.ok(r.caseCounts.needsReviewSourceRows >= 1);
    assert.deepEqual(a, original);
  });
}
void test('Unknown credit cue remains negative even if the chosen reference is its credit number', () => {
  const a = source(),
    b = source();
  b.sheets[0].name = 'Other';
  const m = { ...mapping, reference: 1 };
  const r = compare(
    normalizeSource(a, m, contract.scope, 'supplier'),
    normalizeSource(separateSheets(b), m, contract.scope, 'ledger'),
    contract.scope,
  );
  assert.equal(r.matches.length, 0);
  assert.equal(r.supplier.transactions[0].documentType, 'Unknown');
});
void test('Explicit native credit type verifies roles while removing the type never does', () => {
  const a = source('CN-701', 'Credit Note'),
    b = source('CN-701', 'Credit Note');
  b.sheets[0].name = 'Other';
  assert.equal(run(a, b).matches.length, 1);
  for (const f of [a, b]) {
    f.sheets[0].rows[0].splice(4, 1);
    f.sheets[0].rows[1].splice(4, 1);
  }
  const r = run(a, b);
  assert.equal(r.matches.length, 0);
  assert.equal(r.caseCounts.needsReviewSourceRows, 2);
});
void test('A mixed file keeps proved invoice work alongside untyped credit warnings', () => {
  const a = source(),
    b = source();
  b.sheets[0].name = 'Other';
  for (const f of [a, b])
    f.sheets[0].rows.push(['2026-07-18', '', 'INV-402', '80.00', 'Invoice']);
  const r = run(a, b);
  assert.equal(r.matches.length, 1);
  assert.equal(r.caseCounts.needsReviewSourceRows, 2);
  assert.equal(
    r.cases.find((c) => c.status === 'Matched')?.supplierMembers[0].reference,
    'INV-402',
  );
});
void test('AI cannot erase retained native credit cues from canonical case members', () => {
  const a = source(),
    b = source();
  b.sheets[0].name = 'Other';
  const r = run(a, b);
  const hypothesis = {
    supplierIds: [r.supplier.transactions[0].id],
    ledgerIds: [r.ledger.transactions[0].id],
  };
  const forged = structuredClone(r);
  for (const c of forged.cases) {
    c.supplierMembers = c.supplierMembers.map((t) => ({
      ...t,
      retainedEvidence: [],
      referenceEvidenceIssues: [],
    }));
    c.ledgerMembers = c.ledgerMembers.map((t) => ({
      ...t,
      retainedEvidence: [],
      referenceEvidenceIssues: [],
    }));
  }
  assert.equal(verifyHypothesis(forged, hypothesis).status, 'rejected');
});
