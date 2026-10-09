import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as readBytes } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import { compare } from '../lib/reconciliation/core.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import { DOCUMENT_PAIR_RULE } from '../lib/reconciliation/document-pairs.ts';
import type { Mapping, Scope, SourceFile, Comparison } from '../lib/reconciliation/types.ts';
const root = new URL('../', import.meta.url);
const frozen = new URL('audit/p1v206-source-proof-v1/frozen/', root);
const proofContract = JSON.parse(await readBytes(new URL('contract.json', frozen), 'utf8')) as {
  original: { supplierFile: string; ledgerFile: string; requiredAutoPairs: number[][]; supplierRows: string[][]; ledgerRows: string[][] };
  positiveControl: { supplierCsv: string; ledgerCsv: string; expectedForcedPairs: number[][] };
};
const oldContract = JSON.parse(await readBytes(new URL('audit/p1-reference-resolution/independent-v2/frozen/contracts.json', root), 'utf8')) as {
  scope: Scope; cases: { id: string; supplier: { mapping: Mapping }; ledger: { mapping: Mapping }; requiredAutoPairs: number[][] }[];
};
const original = oldContract.cases.find((c) => c.id === 'P1V206')!;
const mappings: [Mapping, Mapping] = [original.supplier.mapping, original.ledger.mapping];
const scope = oldContract.scope;
const encoder = new TextEncoder();
async function files(a?: string, b?: string): Promise<[SourceFile, SourceFile]> {
  const bytes = await Promise.all([a, b].map((text, side) => text === undefined
    ? readBytes(new URL(side ? proofContract.original.ledgerFile : proofContract.original.supplierFile, root))
    : Promise.resolve(encoder.encode(text))));
  return Promise.all(bytes.map((data, side) => readFile(side ? 'ledger.csv' : 'supplier.csv',
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer))) as Promise<[SourceFile, SourceFile]>;
}
const reconcile = (sources: [SourceFile, SourceFile]) => reconcileSupplierStatement({ files: sources, mappings, scope }).result;
function autoPairs(result: Comparison): number[][] {
  const rows = new Map([...result.supplier.transactions, ...result.ledger.transactions].map((t) => [t.id, t.row]));
  return result.matches.filter((m) => m.kind === 'auto').map((m) => {
    assert.equal((m.supplierIds ?? [m.supplierId]).length, 1, 'No automatic group from a 1:1 proof');
    assert.equal((m.ledgerIds ?? [m.ledgerId]).length, 1);
    return [rows.get(m.supplierId)!, rows.get(m.ledgerId)!];
  }).sort((a, b) => a[0] - b[0]);
}
function partition(result: Comparison) {
  const input = [...result.supplier.transactions, ...result.ledger.transactions];
  const represented = result.cases.flatMap((c) => [...c.supplierMembers, ...c.ledgerMembers]);
  assert.deepEqual(represented.map((t) => t.id).sort(), input.map((t) => t.id).sort());
  for (const side of [result.supplier, result.ledger]) {
    assert.equal(side.transactions.length, 4); assert.deepEqual(side.errors, []);
    assert.equal(side.transactions.reduce((sum, t) => sum + t.amount, 0), 77500);
    for (const row of side.transactions) assert.equal(row.amount, 19375);
  }
}
void test('independent precode Python/Decimal proof admits 14 bijections and no forced original pair', () => {
  const output: unknown = JSON.parse(execFileSync('python3', [new URL('source_proof.py', frozen).pathname], { encoding: 'utf8' }));
  const value = output as { sourceProofStatus: string; originalPositiveRequirementStatus: string; compatibleBijectionCount: number; forcedPairs: unknown[]; neitherRequiredPairBijectionCount: number; approvalAuthority: boolean; positiveControlCompatibleBijectionCount: number };
  assert.equal(value.sourceProofStatus, 'PASS');
  assert.equal(value.originalPositiveRequirementStatus, 'UNFULFILLED_BY_NATIVE_EVIDENCE');
  assert.equal(value.compatibleBijectionCount, 14); assert.deepEqual(value.forcedPairs, []);
  assert.equal(value.neitherRequiredPairBijectionCount, 4); assert.equal(value.approvalAuthority, false);
  assert.equal(value.positiveControlCompatibleBijectionCount, 1);
});
void test('original P1V206 preserves required positives as FAIL and all eight native rows for review', async () => {
  assert.deepEqual(original.requiredAutoPairs, [[2, 5], [4, 3]]);
  const result = reconcile(await files());
  assert.deepEqual(autoPairs(result), []);
  assert.notDeepEqual(autoPairs(result), original.requiredAutoPairs, 'Original positive requirement is unmet, not reclassified');
  assert.equal(result.cases.length, 1); assert.equal(result.cases[0].status, 'Needs Review');
  assert.equal(result.cases[0].classification, 'AMBIGUOUS_CANDIDATE'); partition(result);
  for (const [side, expected] of [[result.supplier, proofContract.original.supplierRows], [result.ledger, proofContract.original.ledgerRows]] as const) {
    assert.deepEqual(side.transactions.map((t) => t.chosenReference), expected.map((row) => row[2]));
    assert.ok(side.transactions.every((t) => t.reference === 'D-850' && t.date === '2026-09-24' && t.currency === 'SAR'));
  }
});
void test('independently frozen synthetic positive must prove Z and ر alongside fully stated siblings', async () => {
  const control = proofContract.positiveControl;
  const result = reconcile(await files(control.supplierCsv, control.ledgerCsv));
  assert.deepEqual(autoPairs(result), control.expectedForcedPairs); partition(result);
  assert.equal(result.matches.length, 4);
  assert.ok(result.matches.every((m) => m.evidence?.rule === DOCUMENT_PAIR_RULE));
  assert.deepEqual(result.matches.map((m) => m.evidence?.discriminator?.value).sort((a, b) => String(a).localeCompare(String(b))), ['A', 'B', 'Z', 'ر'].sort((a, b) => a.localeCompare(b)));
});
void test('reordering original rows cannot make an unknown sibling noncompeting', async () => {
  const native = await files();
  const texts = [native[0], native[1]].map((file) => new TextDecoder().decode(file.original));
  const reverse = (csv: string) => { const lines = csv.trimEnd().split('\n'); return [lines[0], ...lines.slice(1).reverse()].join('\n') + '\n'; };
  for (const [a, b] of [[reverse(texts[0]), texts[1]], [texts[0], reverse(texts[1])], [reverse(texts[0]), reverse(texts[1])]]) {
    const result = reconcile(await files(a, b)); assert.deepEqual(autoPairs(result), []); partition(result);
  }
});
void test('any single missing sibling blocks otherwise positive document proof without losing rows', async () => {
  const control = proofContract.positiveControl;
  for (const marker of ['N/A', '-', '']) {
    for (const side of [0, 1]) {
      const texts = [control.supplierCsv, control.ledgerCsv];
      texts[side] = texts[side].replace(',A,', `,${marker},`);
      const result = reconcile(await files(texts[0], texts[1]));
      assert.deepEqual(autoPairs(result), []); partition(result);
    }
  }
});
void test('manual consumption or rejection does not hide missing original competitors', async () => {
  const result = reconcile(await files());
  const s = result.supplier.transactions.find((t) => t.row === 2)!;
  const l = result.ledger.transactions.find((t) => t.row === 5)!;
  const manual = compare(result.supplier, result.ledger, scope, [{ supplierId: s.id, ledgerId: l.id, note: 'Synthetic separate reviewer action, not field evidence' }]);
  assert.deepEqual(autoPairs(manual), []); assert.equal(manual.matches.filter((m) => m.kind === 'manual').length, 1); partition(manual);
  const rejected = compare(result.supplier, result.ledger, scope, [], [`${s.id}|${l.id}`]);
  assert.deepEqual(autoPairs(rejected), []); partition(rejected);
});
void test('native session restore retains unresolved original and literal missing references', async () => {
  const sources = await files(); const result = reconcile(sources);
  const saved = await saveSession({ files: sources, mappings, scope, decisions: [], rejected: [], events: [], review: { name: 'Synthetic audit', notes: '', checked: true } });
  const restored = await restoreSession(saved);
  assert.deepEqual(restored.result, result); assert.deepEqual(autoPairs(restored.result), []); partition(restored.result);
});
void test('verified XLSX retains original rows, placeholder literals and money without claiming matches', async () => {
  const sources = await files(); const result = reconcile(sources);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await exportWorkbook(result, sources, { name: 'Synthetic audit', notes: '', checked: true }));
  for (const [name, expected] of [['Parsed Supplier Source', proofContract.original.supplierRows], ['Parsed Ledger Source', proofContract.original.ledgerRows]] as const) {
    const sheet = book.getWorksheet(name)!; assert.equal(sheet.rowCount, 6);
    for (let index = 0; index < 4; index++) {
      const actual = sheet.getRow(index + 3).values as ExcelJS.CellValue[];
      assert.deepEqual(actual.slice(2), expected[index]);
    }
  }
  for (const name of ['Supplier transactions', 'Ledger transactions']) {
    const sheet = book.getWorksheet(name)!; assert.equal(sheet.rowCount, 5);
    for (let row = 2; row <= 5; row++) assert.equal(sheet.getCell(row, 8).value, 193.75);
  }
  const evidence = book.getWorksheet('Match Evidence')!;
  assert.equal(evidence.rowCount, 9, 'All eight unresolved original rows retain evidence');
  const evidenceText = JSON.stringify(evidence.getSheetValues());
  assert.ok(!evidenceText.includes(DOCUMENT_PAIR_RULE), 'Export grants no automatic identity certificate');
});
void test('original assets and the independent precode seal remain byte exact after native replay', async () => {
  const manifest = JSON.parse(await readBytes(new URL('MANIFEST.json', frozen), 'utf8')) as { originalSourceSha256: Record<string, string>; frozenArtifactSha256: Record<string, string> };
  for (const [path, expected] of Object.entries(manifest.originalSourceSha256))
    assert.equal(createHash('sha256').update(await readBytes(new URL(path, root))).digest('hex'), expected);
  for (const [path, expected] of Object.entries(manifest.frozenArtifactSha256))
    assert.equal(createHash('sha256').update(await readBytes(new URL(path, frozen))).digest('hex'), expected);
});
