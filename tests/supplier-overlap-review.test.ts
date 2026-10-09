import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import { restoreSession } from '../lib/reconciliation/session.ts';
import { compare } from '../lib/reconciliation/core.ts';
import { buildReconciliationCases } from '../lib/reconciliation/cases.ts';
import { hasVerifiedExplanationEvidence } from '../lib/reconciliation/assistant.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import { InvoiceOverlapReviewLedger } from '../lib/reconciliation/invoice-overlap-review.ts';
import { SupplierInvoiceOverlapReview } from '../lib/reconciliation/supplier-overlap-review.ts';
import type { SupplierMainReviewInput } from '../lib/reconciliation/supplier-overlap-review.ts';
import type { InvoiceOverlapSelection } from '../lib/reconciliation/invoice-overlap-review.ts';
import type { Comparison, Decision, Mapping, SourceFile, Transaction } from '../lib/reconciliation/types.ts';
import { ENGINE_VERSION } from '../lib/reconciliation/types.ts';

type Member = { key: string; side: 'supplier' | 'ledger'; invoice: string;
  selectedReference: string; amountMinor: number; date: string; documentType: string;
  poReference?: string; voucherReference?: string };
const frozenBytes = readFileSync(new URL('../audit/p2-main-integration-v1/frozen/contract.json', import.meta.url));
const frozen = JSON.parse(frozenBytes.toString());
const nativeAddendumBytes = readFileSync(new URL('../audit/p2-main-integration-v1/frozen/native-encoding-addendum.json', import.meta.url));
const nativeAddendum = JSON.parse(nativeAddendumBytes.toString());
const nativeInvoiceLabels = nativeAddendum.mapping as Record<string, string>;
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function saveProof(name: string, bytes: ArrayBuffer) {
  if (process.env.P2_MAIN_SAVE_FIXTURES !== '1') return;
  const run = process.env.P2_MAIN_FIXTURE_RUN === 'final' ? 'native-final' : 'native';
  const root = new URL(`../audit/p2-main-integration-v1/validation/${run}/`, import.meta.url);
  mkdirSync(root, {recursive:true});
  writeFileSync(new URL(name, root),new Uint8Array(bytes));
}
const truth = (id: string) => frozen.cases.find((c: { id: string }) => c.id === id);
const mapping: Mapping = { sheet: 0, header: 0, date: 3, reference: 0, description: -1,
  amount: 2, debit: -1, credit: -1, currencyColumn: -1, mode: 'signed', multiplier: 1,
  numberFormat: 'dot', dateFormat: 'ymd', reportType: 'transactions', opening: '',
  closing: '', periodStart: '', excluded: {} };
const csvCell = (value: string | number) => '"' + String(value).replace(/"/g, '""') + '"';
async function fixture(members: Member[], balances = false, nativeInstantiation = true) {
  const files: SourceFile[] = [];
  const keysById = new Map<string, string>(), idsByKey = new Map<string, string>();
  for (const side of ['supplier', 'ledger'] as const) {
    const rows = members.filter((m) => m.side === side);
    const csv = 'Invoice No,Reference,Amount,Date,Document Type,PO No,Voucher No,Source note\n' +
      rows.map((m) => [nativeInstantiation ? nativeInvoiceLabels[m.invoice] ?? m.invoice : m.invoice,
        m.selectedReference, m.amountMinor, m.date,
        m.documentType, m.poReference ?? '', m.voucherReference ?? '', `${side} native`]
        .map(csvCell).join(',')).join('\n') + '\n';
    files.push(await readFile(`${side}-main.csv`, new TextEncoder().encode(csv).buffer));
  }
  const input: SupplierMainReviewInput = { currentSourceFiles: files as [SourceFile, SourceFile],
    mappings: [structuredClone(mapping), structuredClone(mapping)], scope: structuredClone(frozen.scope),
    revision: 'main-native-v1', main: { generation: 0, decisions: [], rejected: [] } };
  if (balances) {
    input.mappings[0].opening = '100'; input.mappings[0].closing = '200';
    input.mappings[1].opening = '120'; input.mappings[1].closing = '320';
    for (const m of input.mappings) m.periodStart = '2026-09-01';
  }
  const baseline = reconcileSupplierStatement({ files: input.currentSourceFiles,
    mappings: input.mappings, scope: input.scope }).result;
  for (const source of [baseline.supplier, baseline.ledger]) {
    const rows = members.filter((m) => m.side === source.transactions[0].side);
    source.transactions.forEach((t, i) => { keysById.set(t.id, rows[i].key); idsByKey.set(rows[i].key, t.id); });
  }
  return { input, baseline, keysById, idsByKey };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function rowKeys(transactions: Transaction[], fixture: Fixture) {
  return transactions.map((t) => fixture.keysById.get(t.id)!).sort(lexical);
}
async function selection(owner: SupplierInvoiceOverlapReview, fixture: Fixture,
  accepted: string[][], componentIndex = 0): Promise<InvoiceOverlapSelection> {
  const snapshot = await owner.inspect(fixture.input);
  const component = snapshot.search.components[componentIndex];
  assert.ok(component);
  const memberships = accepted.map((keys) => [...keys].sort(lexical).join('|'));
  const decisions = snapshot.search.candidates.filter((c) => component.candidateIds.includes(c.id))
    .map((candidate) => ({ candidateId: candidate.id,
      decision: memberships.includes([...candidate.supplierIds, ...candidate.ledgerIds]
        .map((id) => fixture.keysById.get(id)!).sort(lexical).join('|')) ? 'accepted' as const : 'rejected' as const,
      rationale: 'Reviewed all original invoice rows and competitors; this is the economic group decision.' }));
  assert.equal(decisions.filter((d) => d.decision === 'accepted').length, accepted.length);
  return { generation: owner.state.generation, snapshotKey: snapshot.snapshotKey,
    componentId: component.id, reviewerLabel: 'Accountant A',
    rationale: 'Whole component, competing alternatives and residual original rows reviewed.',
    decisions, reviewedRowKeys: [...component.rowKeys] };
}
function assertPartition(result: Comparison, rows: number) {
  const keys = result.cases.flatMap((c) => c.sourceTrace.map((t) => `${t.side}:${t.sourceRowId}`));
  assert.equal(keys.length, rows); assert.equal(new Set(keys).size, rows);
  assert.equal(result.caseCounts.matchedSourceRows + result.caseCounts.needsReviewSourceRows +
    result.caseCounts.unmatchedSourceRows + result.cases.filter((c) => c.status === 'Rejected')
      .reduce((n, c) => n + c.sourceTrace.length, 0), rows);
}
function assertTruthGroups(result: Comparison, fixture: Fixture, expected: ReturnType<typeof truth>) {
  assert.deepEqual(result.caseCounts, expected.expected.counts);
  const groups = result.cases.filter((c) => c.reviewedAggregate);
  assert.equal(groups.length, expected.expected.groups.length);
  for (const economic of expected.expected.groups) {
    const group = groups.find((c) => rowKeys(c.supplierMembers, fixture).join('|') ===
      [...economic.supplierKeys].sort(lexical).join('|'))!;
    assert.ok(group);
    assert.deepEqual(rowKeys(group.ledgerMembers, fixture), [...economic.ledgerKeys].sort(lexical));
    assert.equal(group.supplierTotal, economic.totalMinor); assert.equal(group.ledgerTotal, economic.totalMinor);
    assert.equal(group.variance, 0); assert.equal(group.bridgeEffect, 0);
    assert.equal(group.reviewedAggregate!.relation, 'group-equivalence');
    assert.equal(group.reviewedAggregate!.pairwiseAllocation, false);
    const match = result.matches.find((m) => m.caseId === group.caseId)!;
    assert.equal(match.kind, 'manual');
    assert.deepEqual(match.supplierIds, group.supplierMembers.map((t) => t.id));
    assert.deepEqual(match.ledgerIds, group.ledgerMembers.map((t) => t.id));
  }
  assert.deepEqual(rowKeys([...result.supplierOnly, ...result.ledgerOnly], fixture),
    [...expected.expected.residualKeys].sort(lexical));
  assertPartition(result, expected.expected.partitionRows ?? expected.originalMembers.length);
}

void test('A-L independent acceptance contract remains exactly sealed before product changes', () => {
  const sha = readFileSync(new URL('../audit/p2-main-integration-v1/frozen/contract.sha256', import.meta.url), 'utf8').split(' ')[0];
  assert.equal(createHash('sha256').update(frozenBytes).digest('hex'), sha);
  assert.deepEqual(frozen.cases.map((c: { id: string }) => c.id), Array.from('ABCDEFGHIJKL'));
  assert.equal(frozen.authority.groupEquivalenceCreatesPairwiseAllocation, false);
});
void test('Separately frozen native instantiation is bijective and original literal labels remain unqualified', async () => {
  const sha = readFileSync(new URL('../audit/p2-main-integration-v1/frozen/native-encoding-addendum.sha256', import.meta.url),'utf8').split(' ')[0];
  assert.equal(createHash('sha256').update(nativeAddendumBytes).digest('hex'),sha);
  assert.equal(new Set(Object.values(nativeInvoiceLabels)).size,Object.keys(nativeInvoiceLabels).length);
  for (const scenario of truth('E').scenarios.filter((s: {owner:string})=>s.owner.startsWith('automatic'))) {
    const literal = await fixture(scenario.originalMembers,false,false);
    assert.equal(literal.baseline.caseCounts.autoMatchedCases,0); assert.equal(literal.baseline.caseCounts.matchedSourceRows,0);
  }
  const literalA = await fixture(truth('A').originalMembers,false,false);
  assert.equal(literalA.baseline.caseCounts.autoMatchedCases,0); assert.equal(literalA.baseline.caseCounts.manualMatches,0);
  assert.equal(literalA.baseline.caseCounts.matchedSourceRows,0); assert.equal(literalA.baseline.caseCounts.unmatchedCases,4);
  assert.equal(literalA.baseline.caseCounts.unmatchedSourceRows,4);
});
for (const id of ['A', 'B', 'C']) void test(`${id}: main group membership, native money, counts, residuals and whole undo match independent truth`, async () => {
  const expected = truth(id), f = await fixture(expected.originalMembers),
    owner = new SupplierInvoiceOverlapReview(), before = structuredClone(f.input);
  const { state, result } = await owner.commit(f.input, await selection(owner, f, expected.action.accept));
  assert.equal(state.activeReceiptIds.length, 1); assertTruthGroups(result, f, expected);
  assert.equal(hasVerifiedExplanationEvidence(result),true);
  assert.deepEqual(f.input, before);
  assert.deepEqual(result.supplier.transactions, f.baseline.supplier.transactions);
  assert.deepEqual(result.ledger.transactions, f.baseline.ledger.transactions);
  const undone = await owner.undo(f.input, { generation: state.generation, receiptId: state.activeReceiptIds[0],
    reviewerLabel: 'Accountant A', rationale: 'Reopen the whole original component.' });
  assert.deepEqual(undone.result, f.baseline); assert.deepEqual(undone.state.activeReceiptIds, []);
  if (expected.afterUndo?.counts) assert.deepEqual(undone.result.caseCounts, expected.afterUndo.counts);
  assert.deepEqual(undone.state.receipts.map((r) => r.action), ['commit', 'undo']);
  if (id === 'A') saveProof('undone-main.xlsx',await owner.exportWorkbook(f.input));
});
void test('D: separate components retain two receipts and every residual row', async () => {
  const expected = truth('D'), f = await fixture(expected.originalMembers), owner = new SupplierInvoiceOverlapReview();
  const firstSnapshot = await owner.inspect(f.input);
  const indexX = firstSnapshot.search.components.findIndex((c) => c.invoice === nativeInvoiceLabels['INV-X']);
  const indexY = firstSnapshot.search.components.findIndex((c) => c.invoice === nativeInvoiceLabels['INV-Y']);
  await owner.commit(f.input, await selection(owner, f, [expected.action.accept[0]], indexX));
  const { state, result } = await owner.commit(f.input, await selection(owner, f, [expected.action.accept[1]], indexY));
  assert.equal(state.activeReceiptIds.length, 2); assertTruthGroups(result, f, expected);
});
for (const scenario of truth('E').scenarios) void test(`E: ${scenario.owner} refuses whole new component before any receipt`, async () => {
  const f = await fixture(scenario.originalMembers), owner = new SupplierInvoiceOverlapReview();
  if (scenario.existingDecision) f.input.main.decisions.push({ supplierId: f.idsByKey.get('s1')!,
    ledgerId: f.idsByKey.get('l3')!, note: scenario.existingDecision.note });
  const baseline = await owner.comparison(f.input), before = owner.state;
  assert.ok(baseline.matches.length);
  if (scenario.baselineCounts) assert.deepEqual(baseline.caseCounts, scenario.baselineCounts);
  const requested = [...scenario.requestedGroup.supplierKeys, ...scenario.requestedGroup.ledgerKeys];
  await assert.rejects(owner.commit(f.input, await selection(owner, f, [requested])), /already owned/);
  assert.deepEqual(owner.state, before); assert.deepEqual(await owner.comparison(f.input), baseline);
});
void test('F: owned scalar link refuses; disjoint scalar link preserves group and stales older selections', async () => {
  const expected = truth('F'), f = await fixture([...expected.originalMembers, ...expected.additionalOriginalMembers]),
    owner = new SupplierInvoiceOverlapReview();
  await owner.commit(f.input, await selection(owner, f, [['s1','l1','l2']]));
  const before = owner.state, oldSelection = await selection(owner, f, [['s1','l1','l2']]);
  const invalid = structuredClone(f.input);
  invalid.main.generation++; invalid.main.decisions.push({ supplierId: f.idsByKey.get('s1')!,
    ledgerId: f.idsByKey.get('l3')!, note: 'Attempt to reuse an owned row.' });
  await assert.rejects(owner.comparison(invalid), /already owned/);
  assert.deepEqual(owner.state, before);
  f.input.main.generation++;
  f.input.main.decisions.push({ supplierId: f.idsByKey.get('s2')!, ledgerId: f.idsByKey.get('l4')!,
    note: 'Human review of the separate original invoice.' });
  const result = await owner.comparison(f.input);
  assert.deepEqual(result.caseCounts, expected.scenarios[1].expected.counts);
  assert.equal(result.matches.filter((m) => m.reviewedAggregate).length, 1);
  assertPartition(result, 6); assert.deepEqual(owner.state, before);
  await assert.rejects(owner.commit(f.input, oldSelection), /Stale main selection/);
});
void test('G: original consumed members still prevent automatic residual uniqueness', async () => {
  const members: Member[] = [
    { key:'s1',side:'supplier',invoice:'INV-X',selectedReference:'',amountMinor:100,date:'2026-09-01',documentType:'Invoice' },
    { key:'s2',side:'supplier',invoice:'INV-X',selectedReference:'',amountMinor:70,date:'2026-09-02',documentType:'Invoice' },
    { key:'l1',side:'ledger',invoice:'INV-X',selectedReference:'',amountMinor:40,date:'2026-09-01',documentType:'Invoice' },
    { key:'l2',side:'ledger',invoice:'INV-X',selectedReference:'',amountMinor:60,date:'2026-09-02',documentType:'Invoice' },
    { key:'l3',side:'ledger',invoice:'INV-X',selectedReference:'',amountMinor:70,date:'2026-09-02',documentType:'Invoice' },
  ];
  const f = await fixture(members), owner = new SupplierInvoiceOverlapReview();
  const committed = await owner.commit(f.input, await selection(owner, f, [['s1','l1','l2']]));
  assert.equal(committed.result.matches.length, 1);
  const residual = committed.result.cases.find((c) => c.supplierMembers.some((t) => f.keysById.get(t.id) === 's2'))!;
  assert.equal(residual.status, 'Needs Review'); assert.equal(residual.matchingRule, 'REFERENCE_GROUP_NOT_PROVEN');
  assertPartition(committed.result, 5);
  const invalidMembers = [...members, { ...members[1], key:'s3' }];
  const invalid = await fixture(invalidMembers), other = new SupplierInvoiceOverlapReview(), snapshot = await other.inspect(invalid.input);
  assert.ok(snapshot.search.components.some((c) => c.reasons.includes('duplicate-invoice-members')));
  const c = snapshot.search.components[0];
  await assert.rejects(other.commit(invalid.input, { generation:0,snapshotKey:snapshot.snapshotKey,
    componentId:c?.id ?? '',reviewerLabel:'A',rationale:'Reviewed all rows.',reviewedRowKeys:c?.rowKeys ?? [],
    decisions:snapshot.search.candidates.map((candidate) => ({candidateId:candidate.id,decision:'accepted',rationale:'Original reviewed.'})) }));
  assert.equal(other.state.generation, 0);
});
const stale: [string, (input: SupplierMainReviewInput) => void][] = [
  ['bytes', (i) => { new Uint8Array(i.currentSourceFiles[0].original!)[0] ^= 1; }],
  ['hash', (i) => { i.currentSourceFiles[0].sha256 = '0'.repeat(64); }],
  ['cache', (i) => { i.currentSourceFiles[0].sheets[0].rows[1][2] = '101'; }],
  ['mapping', (i) => { i.mappings[0].reference = 1; }],
  ['scope', (i) => { i.scope.cutoff = '2026-09-29'; }],
  ['revision', (i) => { i.revision = 'another-revision'; }],
  ['main generation', (i) => { i.main.generation++; }],
  ['main decisions', (i) => { i.main.decisions.push({supplierId:'missing',ledgerId:'missing',note:'Changed.'}); }],
  ['main rejection', (i) => { i.main.rejected.push('missing|missing'); }],
];
for (const [name, change] of stale) void test(`H: stale ${name} cannot publish ledger or main result`, async () => {
  const f = await fixture(truth('A').originalMembers), owner = new SupplierInvoiceOverlapReview(),
    chosen = await selection(owner, f, [['s1','l1','l2']]), before = owner.state;
  change(f.input); await assert.rejects(owner.commit(f.input, chosen)); assert.deepEqual(owner.state, before);
});
void test('H: concurrent commits, in-flight invalidation and truncated search retain atomic state', async () => {
  const f = await fixture(truth('A').originalMembers), owner = new SupplierInvoiceOverlapReview(),
    chosen = await selection(owner, f, [['s1','l1','l2']]);
  const outcomes = await Promise.allSettled([owner.commit(f.input, chosen), owner.commit(f.input, chosen)]);
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  assert.equal(owner.state.receipts.length, 1);
  const pending = owner.undo(f.input, {generation:1,receiptId:owner.state.activeReceiptIds[0],reviewerLabel:'A',rationale:'Undo whole.'});
  owner.invalidatePending(); await assert.rejects(pending); assert.equal(owner.state.generation, 1);
  const cancelled = new SupplierInvoiceOverlapReview(), pendingCommit = cancelled.commit(f.input,
    await selection(cancelled, f, [['s1','l1','l2']]));
  cancelled.invalidatePending(); await assert.rejects(pendingCommit); assert.equal(cancelled.state.generation, 0);
  const large: Member[] = [truth('A').originalMembers[0], ...Array.from({length:16}, (_,i) =>
    ({...truth('A').originalMembers[1],key:`l${i+1}`,amountMinor:i+1,date:`2026-09-${String(i+1).padStart(2,'0')}`}))];
  const big = await fixture(large), bounded = new SupplierInvoiceOverlapReview(), snapshot = await bounded.inspect(big.input);
  assert.equal(snapshot.search.searchComplete, false); assert.equal(bounded.state.generation, 0);
  await assert.rejects(bounded.commit(big.input, { generation:0,snapshotKey:snapshot.snapshotKey,componentId:'',
    reviewerLabel:'A',rationale:'Review cannot override search budget.',decisions:[],reviewedRowKeys:[] }));
});
void test('H: prospective projection failure and asynchronous publication hooks cannot mutate native ledger', async () => {
  const f = await fixture(truth('A').originalMembers), native = new InvoiceOverlapReviewLedger(), snapshot = await native.inspect(f.input);
  const chosen = await selection(new SupplierInvoiceOverlapReview(), f, [['s1','l1','l2']]);
  chosen.snapshotKey = snapshot.snapshotKey;
  await assert.rejects(native.commit(f.input, chosen, () => { throw new Error('Prospective main comparison failed.'); }), /Prospective/);
  assert.equal(native.state.generation, 0);
  await assert.rejects(native.commit(f.input, chosen, (() => Promise.resolve(undefined)) as never), /synchronously/);
  assert.equal(native.state.generation, 0);
  let escaped: ((decisions: Decision[], rejected: string[]) => Comparison) | undefined;
  await assert.rejects(native.commit(f.input, chosen, (_s,_state,project) => {
    escaped = project; throw new Error('Abort the proposed transaction.');
  }), /Abort/);
  assert.throws(()=>escaped!([],[]), /cannot escape/);
  assert.equal(native.state.generation,0);
});
void test('H: a main decision mutated during native replay cannot publish an obsolete-context aggregate', async () => {
  const f = await fixture(truth('A').originalMembers), owner = new SupplierInvoiceOverlapReview(),
    chosen = await selection(owner,f,[['s1','l1','l2']]);
  const pending = owner.commit(f.input,chosen);
  f.input.main.generation++;
  f.input.main.decisions.push({supplierId:f.idsByKey.get('s1')!,ledgerId:f.idsByKey.get('l3')!,note:'A new main row owner.'});
  await assert.rejects(pending, /current input changed/);
  assert.equal(owner.state.generation,0);
  assert.equal(owner.state.receipts.length,0);
});
void test('H: native and main resource budgets reject before cloning or publication', async () => {
  const f = await fixture(truth('A').originalMembers);
  const probes: [string, (input: SupplierMainReviewInput) => void][] = [
    ['original bytes', (input) => { input.currentSourceFiles[0].original = new ArrayBuffer(8 * 1024 * 1024 + 1); }],
    ['cached rows', (input) => { input.currentSourceFiles[0].sheets[0].rows = Array.from({length:20001},()=>[]); }],
    ['cached cell', (input) => { input.currentSourceFiles[0].sheets[0].rows[1][0] = 'x'.repeat(32768); }],
    ['main note', (input) => { input.main.decisions = [{supplierId:'s',ledgerId:'l',note:'x'.repeat(4001)}]; }],
    ['rejected token', (input) => { input.main.rejected = ['x'.repeat(2002)]; }],
  ];
  for (const [label, change] of probes) {
    const input = structuredClone(f.input), owner = new SupplierInvoiceOverlapReview(); change(input);
    await assert.rejects(owner.inspect(input), /budget|valid current main|bounded/, label);
    assert.equal(owner.state.generation, 0);
  }
  const owner = new SupplierInvoiceOverlapReview(), choice = await selection(owner, f, [['s1','l1','l2']]);
  Object.assign(choice,{unreviewedBlob:'x'.repeat(2 * 1024 * 1024 + 1)});
  await assert.rejects(owner.commit(f.input,choice), /budget/); assert.equal(owner.state.generation, 0);
});
void test('I: original-byte session restores baseline and archive only; fresh whole human commit remains required', async () => {
  const f = await fixture(truth('A').originalMembers), owner = new SupplierInvoiceOverlapReview();
  await owner.commit(f.input, await selection(owner, f, [['s1','l1','l2']]));
  const bytes = await owner.saveSession(f.input, { review:{name:'Accountant A',notes:'Reviewed.',checked:true},events:[] });
  saveProof('main-session.json',bytes);
  saveProof('accepted-main.xlsx',await owner.exportWorkbook(f.input));
  const restored = await restoreSession(bytes);
  assert.deepEqual(restored.result, f.baseline); assert.equal(restored.review.checked, false);
  assert.ok(restored.overlapArchive);
  const newOwner = new SupplierInvoiceOverlapReview(), restoredInput = {...f.input,
    currentSourceFiles:restored.files,mappings:restored.mappings,scope:restored.scope,
    revision:restored.overlapArchive.revision,main:{generation:0,decisions:restored.decisions,rejected:restored.rejected}};
  const imported = await newOwner.reimportSession(restoredInput, restored.overlapArchive.session);
  assert.equal(imported.status, 'archived-not-authoritative'); assert.equal(newOwner.state.generation, 0);
  assert.deepEqual(await newOwner.comparison(restoredInput), f.baseline);
  saveProof('imported-draft-main.xlsx',await newOwner.exportWorkbook(restoredInput));
  const edited = structuredClone(restored.overlapArchive.session);
  edited.state.receipts[0].decisions.forEach((d) => d.decision = d.decision === 'accepted' ? 'rejected' : 'accepted');
  await newOwner.reimportSession(restoredInput, edited);
  assert.equal(newOwner.state.activeReceiptIds.length, 0);
  const forged = JSON.parse(new TextDecoder().decode(bytes));
  forged.overlapArchive.session.state.activeReceiptIds = ['missing'];
  await assert.rejects(restoreSession(new TextEncoder().encode(JSON.stringify(forged)).buffer));
  const draftSaved = await newOwner.saveSession(restoredInput,{review:{name:'',notes:'',checked:false},events:[]});
  assert.deepEqual((await restoreSession(draftSaved)).overlapArchive!.session, edited);
  const renewed = await newOwner.commit(restoredInput, await selection(newOwner, {...f,input:restoredInput}, [['s1','l1','l2']]));
  assertTruthGroups(renewed.result, f, truth('A'));
  saveProof('reaccepted-main.xlsx',await newOwner.exportWorkbook(restoredInput));
});
void test('I/H: stale main context cannot publish an imported draft', async () => {
  const f = await fixture(truth('A').originalMembers), owner = new SupplierInvoiceOverlapReview();
  await owner.commit(f.input,await selection(owner,f,[['s1','l1','l2']]));
  const archive = await owner.exportSession(f.input), restored = new SupplierInvoiceOverlapReview();
  const pending = restored.reimportSession(f.input,archive); f.input.main.generation++;
  await assert.rejects(pending, /current input changed/);
  assert.equal(restored.archivedReviewDraft,null); assert.equal(restored.state.generation,0);
});
void test('J: native workbook keeps full group proof, original money and inventory; ordinary DTO exporter refuses', async () => {
  const f = await fixture(truth('A').originalMembers), owner = new SupplierInvoiceOverlapReview(),
    committed = await owner.commit(f.input, await selection(owner, f, [['s1','l1','l2']]));
  await assert.rejects(exportWorkbook(committed.result, f.input.currentSourceFiles,
    {checked:false,name:'',notes:''}), /live supplier review coordinator/);
  const forged = structuredClone(committed.result);
  forged.matches.forEach((m) => { delete m.reviewedAggregate; });
  forged.cases.forEach((c) => { delete c.reviewedAggregate; c.matchingRule = 'MANUAL_REVIEW'; });
  await assert.rejects(exportWorkbook(forged, f.input.currentSourceFiles,
    {checked:false,name:'',notes:''}), /live supplier review coordinator/);
  assert.throws(() => compare(f.baseline.supplier,f.baseline.ledger,f.input.scope,[],[],{}), /Live original-bound/);
  assert.throws(() => buildReconciliationCases(f.baseline.supplier,f.baseline.ledger,f.input.scope,[],[],
    undefined,[committed.result.matches[0].reviewedAggregate]), /Live original-bound/);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await owner.exportWorkbook(f.input));
  const mainMatches = book.getWorksheet('Matches')!;
  assert.equal(mainMatches.getCell('B2').value, '1:M'); assert.equal(mainMatches.getCell('E2').value, 100);
  assert.equal(mainMatches.getCell('H2').value, 100); assert.equal(mainMatches.getCell('Q2').value, 'Manual');
  assert.equal(book.getWorksheet('Accepted aggregates')!.getCell('F2').value, 100);
  assert.equal(book.getWorksheet('Accepted aggregates')!.getCell('H2').value, false);
  const original = book.getWorksheet('Original movements')!;
  assert.deepEqual([2,3,4,5].map((r) => original.getCell(r,6).value), [100,40,60,100]);
  assert.deepEqual([2,3,4,5].map((r) => original.getCell(r,8).value),
    ['accepted-aggregate-member','accepted-aggregate-member','accepted-aggregate-member','unmatched']);
  const inventory = book.getWorksheet('Native row inventory')!;
  assert.equal(inventory.rowCount, 7); assert.ok(book.getWorksheet('Main aggregate proof'));
  assert.ok(book.getWorksheet('Main comparison binding')); assert.ok(book.getWorksheet('Review ledger'));
  // Accountant-facing summary links must resolve in this specialized export,
  // and provenance must describe the original native bytes used for approval.
  const metadata = book.getWorksheet('Export Metadata');
  assert.ok(metadata, 'Summary promises an Export Metadata sheet');
  assert.equal(metadata.state, 'hidden');
  const fields = new Map<string, ExcelJS.CellValue>();
  metadata.eachRow((row, number) => { if (number > 1) fields.set(row.getCell(1).text, row.getCell(2).value); });
  assert.equal(fields.get('Engine version'), ENGINE_VERSION);
  for (const [index, side] of ['Supplier', 'Ledger'].entries())
    assert.equal(fields.get(side + ' SHA-256'), createHash('sha256').update(new Uint8Array(f.input.currentSourceFiles[index].original!)).digest('hex'));
  assert.ok(fields.get('Export time') instanceof Date);
  book.getWorksheet('Summary')!.eachRow((row) => {
    const value = row.getCell(2).value;
    if (value && typeof value === 'object' && 'hyperlink' in value) {
      const sheet = value.hyperlink.match(/^#'([^']+)'!/);
      if (sheet) assert.ok(book.getWorksheet(sheet[1]), `Missing summary destination ${sheet[1]}`);
    }
  });
});
void test('Main explanation recognizes reviewed groups but rejects inconsistent proof metadata without creating authority', async () => {
  const f = await fixture(truth('A').originalMembers), owner = new SupplierInvoiceOverlapReview(),
    result = (await owner.commit(f.input,await selection(owner,f,[['s1','l1','l2']]))).result;
  assert.equal(hasVerifiedExplanationEvidence(result),true);
  const changes: ((copy:Comparison)=>void)[] = [
    (copy)=> { copy.matches[0].reviewedAggregate!.totalMinor++; },
    (copy)=> { delete copy.matches[0].reviewedAggregate; },
    (copy)=> { copy.cases.find((c)=>c.reviewedAggregate)!.reviewedAggregate!.supplierIds=[]; },
    (copy)=> { copy.cases.find((c)=>c.reviewedAggregate)!.reviewerDecision='Rejected'; },
    (copy)=> { copy.matches[0].kind='auto'; },
    (copy)=> { copy.matches[0].reviewedAggregate!.reviewerLabel='Other reviewer';
      copy.cases.find((c)=>c.reviewedAggregate)!.reviewedAggregate!.reviewerLabel='Other reviewer'; },
    (copy)=> { copy.cases.find((c)=>c.reviewedAggregate)!.classification='EXACT_1_TO_1'; },
  ];
  for (const change of changes) { const copy=structuredClone(result); change(copy);
    assert.equal(hasVerifiedExplanationEvidence(copy),false); }
  await assert.rejects(exportWorkbook(structuredClone(result),f.input.currentSourceFiles,
    {checked:false,name:'',notes:''}), /live supplier review coordinator/);
});
void test('J/H: invalidation prevents native export delivery and owned session save', async () => {
  const f = await fixture(truth('A').originalMembers), owner = new SupplierInvoiceOverlapReview();
  await owner.commit(f.input, await selection(owner, f, [['s1','l1','l2']]));
  const book = owner.exportWorkbook(f.input); owner.invalidatePending(); await assert.rejects(book);
  const session = owner.saveSession(f.input,{review:{name:'',notes:'',checked:false},events:[]});
  owner.invalidatePending(); await assert.rejects(session); assert.equal(owner.state.generation, 1);
});
void test('K: overlap receipt has no allocation links, capacities or amount adjustments', async () => {
  const f = await fixture(truth('A').originalMembers), owner = new SupplierInvoiceOverlapReview();
  await owner.commit(f.input, await selection(owner, f, [['s1','l1','l2']]));
  const accepted = await owner.acceptedView(f.input);
  assert.equal(accepted.aggregates[0].pairwiseAllocation, false);
  assert.ok(accepted.aggregates.every((a) => !('links' in a) && !('available' in a)));
  assert.deepEqual(accepted.sourceTransactions, [f.baseline.supplier.transactions,f.baseline.ledger.transactions]);
  const economic = truth('K');
  assert.equal(economic.originalAvailableMinor.payment - economic.allocationEventMinor.reduce((n:number,l:{amount:number})=>n+l.amount,0), economic.expectedAvailableMinor.payment);
});
void test('L: bridge counts each original movement once with zero reviewed aggregate effect', async () => {
  const expected = truth('L'), f = await fixture(expected.originalMembers,true), owner = new SupplierInvoiceOverlapReview();
  const result = (await owner.commit(f.input, await selection(owner,f,[['s1','l1','l2']]))).result;
  assert.deepEqual(result.bridge, expected.expected.bridge); assert.deepEqual(result.caseCounts, expected.expected.counts);
  assert.equal(result.cases.find((c) => c.reviewedAggregate)!.bridgeEffect, 0); assertPartition(result,4);
});
