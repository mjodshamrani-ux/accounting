import ExcelJS from 'exceljs';
import { readFile } from './io.ts';
import { prepareVerifiedSources } from './source-preparation.ts';
import { invoiceGroupSourcesFromVerifiedReading } from './invoice-group-search.ts';
import { MAX_FILE_BYTES, MAX_ROWS, MAX_SHEETS } from './types.ts';
import { compare } from './core.ts';
import {
  searchInvoiceOverlaps,
  INVOICE_OVERLAP_HARD_REASONS,
} from './invoice-overlap-search.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
  SourceResult,
  Transaction,
  Comparison,
  Decision,
  ReviewedInvoiceAggregateProof,
} from './types.ts';

export const INVOICE_OVERLAP_REVIEW_VERSION = 'INVOICE_OVERLAP_REVIEW_V1';
export type InvoiceOverlapReviewInput = {
  currentSourceFiles: [SourceFile, SourceFile];
  mappings: [Mapping, Mapping];
  scope: Scope;
  revision: string;
  signal?: AbortSignal;
};
export type InvoiceOverlapSelection = {
  generation: number;
  snapshotKey: string;
  componentId: string;
  reviewerLabel: string;
  rationale: string;
  decisions: {
    candidateId: string;
    decision: 'accepted' | 'rejected';
    rationale: string;
  }[];
  reviewedRowKeys: string[];
};
export type InvoiceOverlapUndo = {
  generation: number;
  receiptId: string;
  reviewerLabel: string;
  rationale: string;
};
export type InvoiceOverlapReceipt = {
  id: string;
  generation: number;
  action: 'commit' | 'undo';
  snapshotKey: string;
  componentId: string;
  reviewerLabel: string;
  rationale: string;
  decisions: InvoiceOverlapSelection['decisions'];
  reviewedRowKeys: string[];
  undoReceiptId?: string;
};
export type InvoiceOverlapAggregate = {
  receiptId: string;
  candidateId: string;
  componentId: string;
  supplierIds: string[];
  ledgerIds: string[];
  totalMinor: number;
  relation: 'group-equivalence';
  pairwiseAllocation: false;
};
export type InvoiceOverlapState = {
  generation: number;
  snapshotKey: string | null;
  receipts: InvoiceOverlapReceipt[];
  activeReceiptIds: string[];
};
export type InvoiceOverlapSession = {
  version: typeof INVOICE_OVERLAP_REVIEW_VERSION;
  state: InvoiceOverlapState;
};
const clone = <T>(v: T): T => structuredClone(v);
const json = (v: unknown) => JSON.stringify(v);
function chunks(text: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + 30000);
    if (end < text.length && /[\ud800-\udbff]/.test(text[end - 1])) end--;
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts.length ? parts : [''];
}
const fail = (s: string): never => {
  throw new Error(s);
};
const meaningful = (s: unknown): s is string =>
  typeof s === 'string' &&
  !!s.trim() &&
  s.length <= 4000 &&
  !Array.from(s).some((ch) => {
    const n = ch.codePointAt(0)!;
    return (
      n < 32 ||
      n === 127 ||
      n === 0xfffe ||
      n === 0xffff ||
      (n >= 0xd800 && n <= 0xdfff)
    );
  });
async function hash(v: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json(v))),
    ),
  )
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
export function assertInvoiceOverlapInputBudget(input: InvoiceOverlapReviewInput) {
  if (
    !input ||
    !Array.isArray(input.currentSourceFiles) ||
    input.currentSourceFiles.length !== 2 ||
    !Array.isArray(input.mappings) ||
    input.mappings.length !== 2
  )
    fail('Two native sources and mappings are required.');
  for (const f of input.currentSourceFiles) {
    if (
      !f ||
      !(f.original instanceof ArrayBuffer) ||
      f.original.byteLength > MAX_FILE_BYTES ||
      !Array.isArray(f.sheets) ||
      !f.sheets.length || f.sheets.length > MAX_SHEETS ||
      f.sheets.some((s) => !s || !Array.isArray(s.rows)) ||
      f.sheets.reduce((n, s) => n + s.rows.length, 0) > MAX_ROWS
    )
      fail('Native source budget or original bytes are invalid.');
    if (typeof f.name !== 'string' || f.name.length > 255 || f.kind || f.visual)
      fail('Original native CSV, XLSX or PDF bytes are required; derived sources need their own reviewed authority path.');
    for (const key in f)
      if (Object.hasOwn(f, key) && !['name', 'kind', 'visual', 'sha256', 'sheets', 'pdf', 'original'].includes(key))
        fail('Unknown native source fields are not a reviewed source binding.');
    for (const s of f.sheets)
      if (typeof s.name !== 'string' || s.name.length > 255)
        fail('Native sheet identity is invalid.');
    for (const s of f.sheets)
      for (const row of s.rows)
        if (!Array.isArray(row) || row.length > 100 ||
          row.some((cell) => typeof cell !== 'string' || cell.length > 32767))
          fail('Native cached row or cell budget is invalid.');
    assertInvoiceReviewDataBudget([f.name, f.sha256, f.sheets, f.pdf], 64 * 1024 * 1024, 8000000);
  }
  if (typeof input.revision !== 'string' || input.revision.length > 4000)
    fail('A bounded current source revision is required.');
  assertInvoiceReviewDataBudget([input.mappings, input.scope, input.revision], 4 * 1024 * 1024, 200000);
}
/** Checks structure without serialization or an unbounded traversal stack. */
export function assertInvoiceReviewDataBudget(value: unknown, maxCharacters: number, maxNodes: number) {
  let characters = 0, nodes = 0;
  const active = new Set<object>();
  function visit(item: unknown, depth: number) {
    if (++nodes > maxNodes || depth > 24) fail('Invoice review context exceeds its resource budget.');
    if (typeof item === 'string') {
      characters += item.length;
      if (characters > maxCharacters) fail('Invoice review context exceeds its text budget.');
      return;
    }
    if (item === null || item === undefined || typeof item === 'boolean') return;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('Invoice review context contains a nonfinite number.');
      return;
    }
    if (typeof item !== 'object' || active.has(item)) fail('Invoice review context must contain bounded plain data.');
    active.add(item);
    if (Array.isArray(item)) {
      if (item.length > maxNodes - nodes) fail('Invoice review context exceeds its resource budget.');
      for (const child of item) visit(child, depth + 1);
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        fail('Invoice review context must contain bounded plain data.');
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        visit(key, depth + 1);
        visit((item as Record<string, unknown>)[key], depth + 1);
      }
    }
    active.delete(item);
  }
  visit(value, 0);
}
export function invoiceNativeBytesEqual(files: readonly SourceFile[], originals: readonly ArrayBuffer[]) {
  return files.length === originals.length && files.every((f, i) => {
    if (!(f.original instanceof ArrayBuffer) || f.original.byteLength !== originals[i].byteLength) return false;
    const current = new Uint8Array(f.original), owned = new Uint8Array(originals[i]);
    for (let j = 0; j < current.length; j++) if (current[j] !== owned[j]) return false;
    return true;
  });
}
function inputStamp(input: InvoiceOverlapReviewInput) {
  assertInvoiceOverlapInputBudget(input);
  return json([
    input.currentSourceFiles.map((f) => [
      f.name,
      f.kind,
      f.visual,
      f.sha256,
      f.sheets,
      f.pdf,
    ]),
    input.mappings,
    input.scope,
    input.revision,
  ]);
}
function inputBinding(input: InvoiceOverlapReviewInput) {
  return { stamp: inputStamp(input), originals: input.currentSourceFiles.map((f) => f.original!.slice(0)) };
}
function bindingUnchanged(input: InvoiceOverlapReviewInput, binding: ReturnType<typeof inputBinding>) {
  return binding.stamp === inputStamp(input) && invoiceNativeBytesEqual(input.currentSourceFiles, binding.originals);
}
function cancelled(input: InvoiceOverlapReviewInput) {
  if (input.signal?.aborted) fail('Invoice overlap review was cancelled.');
}

/** Every operation starts from current original bytes; cached search/results have no authority. */
export async function prepareInvoiceOverlapReview(
  input: InvoiceOverlapReviewInput,
) {
  cancelled(input);
  const initial = inputStamp(input),
    owned = clone({ currentSourceFiles: input.currentSourceFiles, mappings: input.mappings,
      scope: input.scope, revision: input.revision });
  if (!meaningful(owned.revision))
    fail('A current source revision is required.');
  const files: SourceFile[] = [];
  for (const f of owned.currentSourceFiles) {
    if (
      !(f.original instanceof ArrayBuffer) ||
      !/\.(csv|xlsx|pdf)$/i.test(f.name) ||
      f.kind ||
      f.visual
    )
      fail(
        'Original native CSV, XLSX or PDF bytes are required; derived sources need their own reviewed authority path.',
      );
    const replay = await readFile(
      f.name,
      f.original!,
      f.pdf?.cuts,
      !!f.pdf?.autoColumns,
    );
    if (
      replay.sha256 !== f.sha256 ||
      json(replay.sheets) !== json(f.sheets) ||
      json(replay.pdf) !== json(f.pdf)
    )
      fail(
        'Native source bytes, hash or extraction changed. Reread the source.',
      );
    files.push(replay);
    cancelled(input);
  }
  const prepared = prepareVerifiedSources(files, owned.mappings, owned.scope, [
    'supplier',
    'ledger',
  ]);
  const search = await searchInvoiceOverlaps({
    sources: invoiceGroupSourcesFromVerifiedReading(
      files as [SourceFile, SourceFile],
      prepared.mappings as [Mapping, Mapping],
      prepared.sources as [SourceResult, SourceResult],
      owned.scope,
    ),
    scope: owned.scope,
    revision: owned.revision,
    signal: input.signal,
  });
  const snapshotKey = await hash([
    search.snapshotKey,
    owned.mappings,
    owned.scope,
    owned.revision,
  ]);
  cancelled(input);
  if (initial !== inputStamp(input) || !invoiceNativeBytesEqual(input.currentSourceFiles,
    owned.currentSourceFiles.map((f) => f.original!)))
    fail('Source input changed during review.');
  return {
    snapshotKey,
    search: clone(search),
    sources: clone(prepared.sources),
    scope: clone(owned.scope),
    revision: owned.revision,
  };
}
export type InvoiceOverlapReviewSnapshot = Awaited<
  ReturnType<typeof prepareInvoiceOverlapReview>
>;
const hardReasons = new Set<string>(INVOICE_OVERLAP_HARD_REASONS);
function assertFresh(snapshot: InvoiceOverlapReviewSnapshot) {
  if (
    !snapshot.search.searchComplete ||
    snapshot.search.reasons.some((r) => hardReasons.has(r))
  )
    fail('Complete valid membership and fresh search are required.');
}
const rowKey = (side: string, id: string) => `${side}:${id}`;
// Tokens exist only during a synchronous, native-ledger-owned projection.
// DTOs, cloned tokens and imported receipts cannot enter this registry.
export type SupplierAggregateAuthority = object;
const projectionAuthorities = new WeakMap<object, {
  binding: string;
  aggregates: ReviewedInvoiceAggregateProof[];
}>();
export function resolveSupplierAggregateAuthority(
  authority: SupplierAggregateAuthority,
  supplier: SourceResult,
  ledger: SourceResult,
  scope: Scope,
  decisions: Decision[],
  rejected: string[],
): ReviewedInvoiceAggregateProof[] {
  const proof = projectionAuthorities.get(authority);
  if (!proof || proof.binding !== json([supplier, ledger, scope, decisions, rejected]))
    fail('Live original-bound supplier aggregate authority is required.');
  return clone(proof!.aggregates);
}
type MainProjection = (decisions: Decision[], rejected: string[]) => Comparison;
type PublicationGuard = (
  snapshot: InvoiceOverlapReviewSnapshot,
  prospectiveState: InvoiceOverlapState,
  project: MainProjection,
) => undefined;
type WorkbookAugment = (
  book: ExcelJS.Workbook,
  snapshot: InvoiceOverlapReviewSnapshot,
  state: InvoiceOverlapState,
  project: MainProjection,
) => undefined;
/** Isolated aggregate review ledger. No pairwise matches or allocation are manufactured. */
export class InvoiceOverlapReviewLedger {
  #state: InvoiceOverlapState = {
    generation: 0,
    snapshotKey: null,
    receipts: [],
    activeReceiptIds: [],
  };
  #archive: InvoiceOverlapSession | null = null;
  #epoch = 0;
  #controller = new AbortController();
  invalidatePending() {
    this.#epoch++;
    this.#controller.abort();
    this.#controller = new AbortController();
  }
  async #prepare(input: InvoiceOverlapReviewInput) {
    const epoch = this.#epoch,
      binding = inputBinding(input);
    const signal = input.signal
      ? AbortSignal.any([input.signal, this.#controller.signal])
      : this.#controller.signal;
    const s = await prepareInvoiceOverlapReview({ ...input, signal });
    if (epoch !== this.#epoch || !bindingUnchanged(input, binding))
      fail('Review operation was invalidated or source input changed.');
    return s;
  }
  get state(): InvoiceOverlapState {
    return clone(this.#state);
  }
  get archivedReviewDraft(): InvoiceOverlapSession | null {
    return clone(this.#archive);
  }
  async inspect(
    input: InvoiceOverlapReviewInput,
  ): Promise<InvoiceOverlapReviewSnapshot> {
    return this.#prepare(input);
  }
  #project(
    snapshot: InvoiceOverlapReviewSnapshot,
    state: InvoiceOverlapState,
    decisions: Decision[],
    rejected: string[],
  ): Comparison {
    const [supplier, ledger] = snapshot.sources;
    const baseline = compare(supplier, ledger, snapshot.scope, decisions, rejected);
    const owners = new Set(baseline.cases.filter((c) => c.status === 'Matched')
      .flatMap((c) => c.sourceTrace.map((t) => rowKey(t.side, t.sourceRowId))));
    const aggregates: ReviewedInvoiceAggregateProof[] = [];
    for (const receipt of state.receipts.filter((r) => state.activeReceiptIds.includes(r.id))) {
      for (const decision of receipt.decisions.filter((d) => d.decision === 'accepted')) {
        const candidate = snapshot.search.candidates.find((c) => c.id === decision.candidateId)
          ?? fail('Accepted aggregate is absent from the current original search.');
        if ([...candidate.supplierIds.map((id) => rowKey('supplier', id)),
          ...candidate.ledgerIds.map((id) => rowKey('ledger', id))].some((k) => owners.has(k)))
          fail('An aggregate member is already owned by an automatic or manual main match.');
        aggregates.push({
          receiptId: receipt.id, candidateId: candidate.id, componentId: candidate.componentId,
          snapshotKey: snapshot.snapshotKey, reviewerLabel: receipt.reviewerLabel,
          rationale: decision.rationale, supplierIds: [...candidate.supplierIds],
          ledgerIds: [...candidate.ledgerIds], totalMinor: candidate.totalMinor,
          relation: 'group-equivalence', pairwiseAllocation: false,
        });
      }
    }
    if (!aggregates.length) return baseline;
    const authority = {};
    projectionAuthorities.set(authority, {
      binding: json([supplier, ledger, snapshot.scope, decisions, rejected]), aggregates,
    });
    try {
      return compare(supplier, ledger, snapshot.scope, decisions, rejected, authority);
    } finally {
      projectionAuthorities.delete(authority);
    }
  }
  #withProjection<T>(snapshot: InvoiceOverlapReviewSnapshot, state: InvoiceOverlapState,
    action: (project: MainProjection) => T): T {
    let active = true;
    try {
      return action((decisions, rejected) => {
        if (!active) fail('A supplier projection cannot escape its synchronous native operation.');
        return this.#project(snapshot, state, decisions, rejected);
      });
    } finally {
      active = false;
    }
  }
  async inspectMainComparison(
    input: InvoiceOverlapReviewInput,
    decisions: Decision[],
    rejected: string[],
  ) {
    const generation = this.#state.generation;
    const snapshot = await this.#prepare(input);
    if (generation !== this.#state.generation) fail('Stale ledger generation.');
    if (this.#state.snapshotKey) this.#assertBinding(snapshot, generation);
    const baselineComparison = compare(snapshot.sources[0], snapshot.sources[1], snapshot.scope, decisions, rejected);
    const mainComparison = this.#project(snapshot, this.#state, decisions, rejected);
    return { ...snapshot, mainComparison, baselineComparison,
      ownedRowKeys: mainComparison.cases.filter((c) => c.status === 'Matched')
        .flatMap((c) => c.sourceTrace.map((t) => rowKey(t.side, t.sourceRowId))) };
  }
  #assertBinding(s: InvoiceOverlapReviewSnapshot, generation: number) {
    assertFresh(s);
    if (generation !== this.#state.generation) fail('Stale ledger generation.');
    if (this.#state.snapshotKey && this.#state.snapshotKey !== s.snapshotKey)
      fail('Source, mapping, scope or revision changed.');
  }
  #activeRows(s: InvoiceOverlapReviewSnapshot) {
    const used = new Set<string>();
    for (const receipt of this.#state.receipts.filter((r) =>
      this.#state.activeReceiptIds.includes(r.id),
    ))
      for (const decision of receipt.decisions.filter(
        (d) => d.decision === 'accepted',
      )) {
        const c =
          s.search.candidates.find((c) => c.id === decision.candidateId) ??
          fail('An accepted candidate is no longer present.');
        for (const k of [
          ...c.supplierIds.map((id) => rowKey('supplier', id)),
          ...c.ledgerIds.map((id) => rowKey('ledger', id)),
        ]) {
          if (used.has(k)) fail('A globally reused row is forbidden.');
          used.add(k);
        }
      }
    return used;
  }
  async commit(
    input: InvoiceOverlapReviewInput,
    selection: InvoiceOverlapSelection,
    beforePublish?: PublicationGuard,
  ): Promise<InvoiceOverlapState> {
    assertInvoiceReviewDataBudget(selection, 2 * 1024 * 1024, 10000);
    const chosen = clone(selection),
      start = this.#state.generation,
      binding = inputBinding(input),
      epoch = this.#epoch;
    const s = await this.#prepare(input);
    this.#assertBinding(s, chosen.generation);
    if (
      epoch !== this.#epoch ||
      start !== this.#state.generation ||
      !bindingUnchanged(input, binding)
    )
      fail('State or source changed during commit.');
    if (chosen.snapshotKey !== s.snapshotKey) fail('Stale selection snapshot.');
    if (!meaningful(chosen.reviewerLabel) || !meaningful(chosen.rationale))
      fail('Reviewer label and grounded rationale are required.');
    const component =
      s.search.components.find((c) => c.id === chosen.componentId) ??
      fail('Unknown component.');
    if (
      !component.complete ||
      component.reasons.some((r) => hardReasons.has(r))
    )
      fail('Known invalid component membership cannot be overridden.');
    if (
      this.#state.receipts.some(
        (r) =>
          this.#state.activeReceiptIds.includes(r.id) &&
          r.componentId === component.id,
      )
    )
      fail('Undo the whole component before reviewing it again.');
    const ids = chosen.decisions.map((d) => d.candidateId);
    if (
      new Set(ids).size !== ids.length ||
      json([...ids].sort()) !== json([...component.candidateIds].sort())
    )
      fail('Every candidate and competitor needs an explicit decision.');
    if (
      new Set(chosen.reviewedRowKeys).size !== chosen.reviewedRowKeys.length ||
      json([...chosen.reviewedRowKeys].sort()) !==
        json([...component.rowKeys].sort())
    )
      fail('Every component member and residual row must be reviewed.');
    const used = this.#activeRows(s);
    for (const d of chosen.decisions) {
      if (
        !['accepted', 'rejected'].includes(d.decision) ||
        !meaningful(d.rationale)
      )
        fail('Each candidate needs an explicit grounded decision.');
      const c =
        s.search.candidates.find((c) => c.id === d.candidateId) ??
        fail('Unknown candidate.');
      if (c.componentId !== component.id) fail('Candidate outside component.');
      if (d.decision !== 'accepted') continue;
      if (
        c.reasons?.some((r) => hardReasons.has(r)) ||
        !Number.isSafeInteger(c.totalMinor) ||
        c.totalMinor <= 0 ||
        !c.supplierIds.length ||
        !c.ledgerIds.length
      )
        fail('Invalid candidate cannot be accepted.');
      for (const k of [
        ...c.supplierIds.map((id) => rowKey('supplier', id)),
        ...c.ledgerIds.map((id) => rowKey('ledger', id)),
      ]) {
        if (used.has(k))
          fail(
            'Accepted candidates must be disjoint across both sides and the global ledger.',
          );
        used.add(k);
      }
    }
    cancelled(input);
    const generation = start + 1;
    const receipt: InvoiceOverlapReceipt = {
      id: `${INVOICE_OVERLAP_REVIEW_VERSION}:${generation}`,
      generation,
      action: 'commit',
      snapshotKey: s.snapshotKey,
      componentId: component.id,
      reviewerLabel: chosen.reviewerLabel,
      rationale: chosen.rationale,
      decisions: chosen.decisions,
      reviewedRowKeys: chosen.reviewedRowKeys,
    };
    const prospectiveState: InvoiceOverlapState = {
      generation,
      snapshotKey: s.snapshotKey,
      receipts: [...this.#state.receipts, receipt],
      activeReceiptIds: [...this.#state.activeReceiptIds, receipt.id],
    };
    if (beforePublish && this.#withProjection(s, prospectiveState,
      (project) => beforePublish(clone(s), clone(prospectiveState), project)) !== undefined)
      fail('Publication validation must finish synchronously.');
    if (epoch !== this.#epoch || start !== this.#state.generation || !bindingUnchanged(input, binding))
      fail('State or source changed during publication validation.');
    cancelled(input);
    this.#state = prospectiveState;
    return this.state;
  }
  async undo(
    input: InvoiceOverlapReviewInput,
    undo: InvoiceOverlapUndo,
    beforePublish?: PublicationGuard,
  ): Promise<InvoiceOverlapState> {
    assertInvoiceReviewDataBudget(undo, 32000, 100);
    const choice = clone(undo),
      start = this.#state.generation,
      binding = inputBinding(input),
      epoch = this.#epoch;
    const s = await this.#prepare(input);
    this.#assertBinding(s, choice.generation);
    if (
      epoch !== this.#epoch ||
      start !== this.#state.generation ||
      !bindingUnchanged(input, binding)
    )
      fail('State or source changed during undo.');
    if (!meaningful(choice.reviewerLabel) || !meaningful(choice.rationale))
      fail('Reviewer label and undo reason are required.');
    const prior =
      this.#state.receipts.find(
        (r) =>
          r.id === choice.receiptId &&
          this.#state.activeReceiptIds.includes(r.id),
      ) ?? fail('Unknown or already undone receipt.');
    cancelled(input);
    const generation = start + 1;
    const receipt: InvoiceOverlapReceipt = {
      id: `${INVOICE_OVERLAP_REVIEW_VERSION}:${generation}`,
      generation,
      action: 'undo',
      snapshotKey: s.snapshotKey,
      componentId: prior.componentId,
      reviewerLabel: choice.reviewerLabel,
      rationale: choice.rationale,
      decisions: [],
      reviewedRowKeys: [],
      undoReceiptId: prior.id,
    };
    const prospectiveState: InvoiceOverlapState = {
      generation,
      snapshotKey: s.snapshotKey,
      receipts: [...this.#state.receipts, receipt],
      activeReceiptIds: this.#state.activeReceiptIds.filter(
        (id) => id !== prior.id,
      ),
    };
    if (beforePublish && this.#withProjection(s, prospectiveState,
      (project) => beforePublish(clone(s), clone(prospectiveState), project)) !== undefined)
      fail('Publication validation must finish synchronously.');
    if (epoch !== this.#epoch || start !== this.#state.generation || !bindingUnchanged(input, binding))
      fail('State or source changed during publication validation.');
    cancelled(input);
    this.#state = prospectiveState;
    return this.state;
  }
  async exportSession(
    input: InvoiceOverlapReviewInput,
  ): Promise<InvoiceOverlapSession> {
    const generation = this.#state.generation;
    const s = await this.#prepare(input);
    this.#assertBinding(s, generation);
    this.#activeRows(s);
    return { version: INVOICE_OVERLAP_REVIEW_VERSION, state: this.state };
  }
  async reimportSession(
    input: InvoiceOverlapReviewInput,
    session: InvoiceOverlapSession,
    beforeArchive?: (snapshot: InvoiceOverlapReviewSnapshot, archive: InvoiceOverlapSession) => undefined,
  ): Promise<{
    status: 'archived-not-authoritative';
    state: InvoiceOverlapState;
    archive: InvoiceOverlapSession;
  }> {
    assertInvoiceReviewDataBudget(session, 32 * 1024 * 1024, 1000000);
    const owned = clone(session),
      start = this.#state.generation,
      binding = inputBinding(input),
      epoch = this.#epoch;
    if (
      owned.version !== INVOICE_OVERLAP_REVIEW_VERSION ||
      !owned.state ||
      !Array.isArray(owned.state.receipts) ||
      owned.state.receipts.length > 10000
    )
      fail('Invalid review session.');
    const replay = new InvoiceOverlapReviewLedger();
    const replayInput = {
      ...input,
      signal: input.signal
        ? AbortSignal.any([input.signal, this.#controller.signal])
        : this.#controller.signal,
    };
    for (const r of owned.state.receipts) {
      if (r.action === 'commit')
        await replay.commit(replayInput, {
          generation: replay.state.generation,
          snapshotKey: r.snapshotKey,
          componentId: r.componentId,
          reviewerLabel: r.reviewerLabel,
          rationale: r.rationale,
          decisions: r.decisions,
          reviewedRowKeys: r.reviewedRowKeys,
        });
      else if (r.action === 'undo')
        await replay.undo(replayInput, {
          generation: replay.state.generation,
          receiptId: r.undoReceiptId!,
          reviewerLabel: r.reviewerLabel,
          rationale: r.rationale,
        });
      else fail('Unknown review event.');
    }
    const s = await this.#prepare(input);
    assertFresh(s);
    if (json(replay.state) !== json(owned.state))
      fail('Session ledger was altered.');
    if (
      epoch !== this.#epoch ||
      start !== this.#state.generation ||
      !bindingUnchanged(input, binding)
    )
      fail('State or source changed during restore.');
    cancelled(input);
    if (beforeArchive && beforeArchive(clone(s), clone(owned)) !== undefined)
      fail('Archive publication validation must finish synchronously.');
    if (epoch !== this.#epoch || start !== this.#state.generation || !bindingUnchanged(input, binding))
      fail('State or source changed during archive publication.');
    cancelled(input);
    this.#archive = owned;
    return {
      status: 'archived-not-authoritative',
      state: this.state,
      archive: clone(owned),
    };
  }
  async acceptedView(
    input: InvoiceOverlapReviewInput,
  ): Promise<{
    aggregates: InvoiceOverlapAggregate[];
    unmatched: Transaction[];
    sourceTransactions: Transaction[][];
  }> {
    const generation = this.#state.generation,
      snapshot = await this.#prepare(input);
    this.#assertBinding(snapshot, generation);
    const used = this.#activeRows(snapshot),
      aggregates: InvoiceOverlapAggregate[] = [];
    for (const receipt of this.#state.receipts.filter((r) =>
      this.#state.activeReceiptIds.includes(r.id),
    ))
      for (const d of receipt.decisions.filter(
        (d) => d.decision === 'accepted',
      )) {
        const c = snapshot.search.candidates.find(
          (c) => c.id === d.candidateId,
        )!;
        aggregates.push({
          receiptId: receipt.id,
          candidateId: c.id,
          componentId: c.componentId,
          supplierIds: [...c.supplierIds],
          ledgerIds: [...c.ledgerIds],
          totalMinor: c.totalMinor,
          relation: 'group-equivalence',
          pairwiseAllocation: false,
        });
      }
    return clone({
      aggregates,
      unmatched: snapshot.sources.flatMap((s) =>
        s.transactions.filter((t) => !used.has(rowKey(t.side, t.id))),
      ),
      sourceTransactions: snapshot.sources.map((s) => s.transactions),
    });
  }
  async exportWorkbook(input: InvoiceOverlapReviewInput, augment?: WorkbookAugment): Promise<ArrayBuffer> {
    const start = this.#state.generation,
      binding = inputBinding(input),
      epoch = this.#epoch,
      s = await this.#prepare(input);
    this.#assertBinding(s, start);
    const used = this.#activeRows(s),
      state = this.state;
    const book = new ExcelJS.Workbook();
    const aggregates = book.addWorksheet('Accepted aggregates');
    aggregates.addRow([
      'Receipt',
      'Candidate',
      'Component',
      'Supplier member IDs',
      'Ledger member IDs',
      'Total minor',
      'Relation',
      'Pairwise allocation',
    ]);
    for (const receipt of state.receipts.filter((r) =>
      state.activeReceiptIds.includes(r.id),
    ))
      for (const d of receipt.decisions.filter(
        (d) => d.decision === 'accepted',
      )) {
        const c = s.search.candidates.find((c) => c.id === d.candidateId)!;
        aggregates.addRow([
          receipt.id,
          c.id,
          c.componentId,
          json(c.supplierIds),
          json(c.ledgerIds),
          c.totalMinor,
          'group-equivalence',
          false,
        ]);
      }
    const original = book.addWorksheet('Original movements');
    original.addRow([
      'Side',
      'ID',
      'Sheet',
      'Row',
      'Date',
      'Amount minor',
      'Original reference',
      'Disposition',
    ]);
    for (const source of s.sources)
      for (const t of source.transactions)
        original.addRow([
          t.side,
          t.id,
          t.sheet,
          t.row,
          t.date,
          t.amountMinor,
          t.chosenReference,
          used.has(rowKey(t.side, t.id))
            ? 'accepted-aggregate-member'
            : 'unmatched',
        ]);
    const audit = book.addWorksheet('Review ledger');
    audit.addRow([
      'Receipt ID',
      'Chunk',
      'Total chunks',
      'Immutable receipt JSON',
    ]);
    for (const r of state.receipts) {
      const parts = chunks(json(r));
      parts.forEach((part, i) =>
        audit.addRow([r.id, i + 1, parts.length, part]),
      );
    }
    const native = book.addWorksheet('Native row inventory');
    native.addRow([
      'Side',
      'Source SHA',
      'Sheet',
      'Row',
      'Raw cells JSON chunk',
      'Chunk',
      'Total chunks',
    ]);
    for (const [side, f] of input.currentSourceFiles.entries())
      for (const sheet of f.sheets)
        for (const [i, cells] of sheet.rows.entries()) {
          const parts = chunks(json(cells));
          parts.forEach((part, j) =>
            native.addRow([
              side === 0 ? 'supplier' : 'ledger',
              f.sha256,
              sheet.name,
              i + 1,
              part,
              j + 1,
              parts.length,
            ]),
          );
        }
    const archived = book.addWorksheet('Imported review draft');
    archived.addRow([
      'Authority',
      'Chunk',
      'Total chunks',
      'Imported session JSON',
    ]);
    if (this.#archive) {
      const parts = chunks(json(this.#archive));
      parts.forEach((part, i) =>
        archived.addRow([
          'archived-not-authoritative',
          i + 1,
          parts.length,
          part,
        ]),
      );
    }
    const sourceBinding = book.addWorksheet('Source binding');
    sourceBinding.addRow(['Version', 'Snapshot', 'Revision', 'Scope JSON']);
    sourceBinding.addRow([
      INVOICE_OVERLAP_REVIEW_VERSION,
      s.snapshotKey,
      s.revision,
      json(s.scope),
    ]);
    if (augment && this.#withProjection(s, state,
      (project) => augment(book, clone(s), clone(state), project)) !== undefined)
      fail('Workbook projection must finish synchronously.');
    const bytes = await book.xlsx.writeBuffer();
    await this.#prepare(input);
    if (
      epoch !== this.#epoch ||
      start !== this.#state.generation ||
      !bindingUnchanged(input, binding)
    )
      fail('State or source changed during export.');
    cancelled(input);
    return new Uint8Array(bytes).slice().buffer;
  }
}
