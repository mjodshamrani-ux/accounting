import { InvoiceOverlapReviewLedger, assertInvoiceOverlapInputBudget,
  assertInvoiceReviewDataBudget, invoiceNativeBytesEqual } from './invoice-overlap-review.ts';
import type {
  InvoiceOverlapReviewInput, InvoiceOverlapSelection, InvoiceOverlapUndo,
  InvoiceOverlapSession, InvoiceOverlapReviewSnapshot,
} from './invoice-overlap-review.ts';
import type { AuditEvent, Comparison, Decision } from './types.ts';
import { ENGINE_VERSION } from './types.ts';
import { addCaseWorksheets } from './case-workbook.ts';
import { validateCellText } from './io.ts';
import { saveSession } from './session.ts';

export const SUPPLIER_OVERLAP_MAIN_VERSION = 'SUPPLIER_OVERLAP_MAIN_V1';
export type SupplierMainReviewInput = InvoiceOverlapReviewInput & {
  main: { generation: number; decisions: Decision[]; rejected: string[] };
};
export type SupplierMainReviewSnapshot = InvoiceOverlapReviewSnapshot & {
  nativeSnapshotKey: string;
  mainComparison: Comparison;
  baselineComparison: Comparison;
  ownedRowKeys: string[];
};
export type SupplierWorkbookReview = {
  checked: boolean; name: string; notes: string; events?: AuditEvent[];
};
const clone = <T>(v: T): T => structuredClone(v);
const json = (v: unknown) => JSON.stringify(v);
const fail = (message: string): never => { throw new Error(message); };
function mainKey(main: SupplierMainReviewInput['main']) { return json(main); }
function selectionKey(nativeKey: string, main: SupplierMainReviewInput['main']) {
  return json([SUPPLIER_OVERLAP_MAIN_VERSION, nativeKey, main]);
}
function inputStamp(input: SupplierMainReviewInput) {
  assertInvoiceOverlapInputBudget(input);
  assertMain(input);
  return json([input.currentSourceFiles.map((f) => [f.name, f.kind, f.visual, f.sha256,
    f.sheets, f.pdf]),
  input.mappings, input.scope, input.revision, input.main]);
}
function nativeInput(input: SupplierMainReviewInput): InvoiceOverlapReviewInput {
  return { currentSourceFiles: input.currentSourceFiles, mappings: input.mappings,
    scope: input.scope, revision: input.revision, signal: input.signal };
}
function assertMain(input: SupplierMainReviewInput) {
  const main = input?.main;
  if (!main || !Number.isSafeInteger(main.generation) || main.generation < 0 ||
    !Array.isArray(main.decisions) || main.decisions.length > 20000 ||
    !main.decisions.every((d) => d && typeof d.supplierId === 'string' &&
      typeof d.ledgerId === 'string' && typeof d.note === 'string' &&
      d.supplierId.length <= 1000 && d.ledgerId.length <= 1000 && d.note.length <= 4000) ||
    !Array.isArray(main.rejected) || main.rejected.length > 20000 ||
    !main.rejected.every((r) => typeof r === 'string' && r.length <= 2001))
    fail('A valid current main comparison generation and decisions are required.');
  assertInvoiceReviewDataBudget(main, 32 * 1024 * 1024, 200000);
}
function chunks(text: string) {
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + 30000);
    if (end < text.length && /[\ud800-\udbff]/.test(text[end - 1])) end--;
    parts.push(text.slice(start, end)); start = end;
  }
  return parts.length ? parts : [''];
}

/** The parent owns this live coordinator; imported DTOs never own source rows. */
export class SupplierInvoiceOverlapReview {
  #ledger = new InvoiceOverlapReviewLedger();
  #epoch = 0;
  #controller = new AbortController();
  #latestMain: { generation: number; key: string } | null = null;
  get state() { return this.#ledger.state; }
  get archivedReviewDraft() { return this.#ledger.archivedReviewDraft; }
  invalidatePending() {
    this.#epoch++;
    this.#controller.abort();
    this.#controller = new AbortController();
    this.#ledger.invalidatePending();
  }
  #assertContext(main: SupplierMainReviewInput['main']) {
    if (this.#latestMain && (main.generation < this.#latestMain.generation ||
      (main.generation === this.#latestMain.generation && mainKey(main) !== this.#latestMain.key)))
      fail('Main comparison decisions changed without a fresh generation.');
  }
  #capture(input: SupplierMainReviewInput) {
    assertInvoiceOverlapInputBudget(input);
    assertMain(input);
    this.#assertContext(input.main);
    const stamp = inputStamp(input), epoch = this.#epoch,
      generation = this.state.generation;
    const signal = input.signal;
    const owned: SupplierMainReviewInput = { ...clone({ currentSourceFiles: input.currentSourceFiles,
      mappings: input.mappings, scope: input.scope, revision: input.revision, main: input.main }), signal: signal
      ? AbortSignal.any([signal, this.#controller.signal]) : this.#controller.signal };
    return { input, owned, stamp, epoch, generation };
  }
  #check(operation: { input: SupplierMainReviewInput; owned: SupplierMainReviewInput;
    stamp: string; epoch: number; generation: number }) {
    if (operation.epoch !== this.#epoch || operation.owned.signal?.aborted ||
      operation.stamp !== inputStamp(operation.input) || !invoiceNativeBytesEqual(
        operation.input.currentSourceFiles, operation.owned.currentSourceFiles.map((f) => f.original!)))
      fail('Supplier review was cancelled or its current input changed.');
    this.#assertContext(operation.owned.main);
  }
  #adopt(main: SupplierMainReviewInput['main']) {
    if (!this.#latestMain || main.generation >= this.#latestMain.generation)
      this.#latestMain = { generation: main.generation, key: mainKey(main) };
  }
  async inspect(input: SupplierMainReviewInput): Promise<SupplierMainReviewSnapshot> {
    const operation = this.#capture(input);
    const s = await this.#ledger.inspectMainComparison(nativeInput(operation.owned),
      operation.owned.main.decisions, operation.owned.main.rejected);
    this.#check(operation);
    if (operation.generation !== this.state.generation) fail('Stale ledger generation.');
    this.#adopt(operation.owned.main);
    return { ...s, nativeSnapshotKey: s.snapshotKey,
      snapshotKey: selectionKey(s.snapshotKey, operation.owned.main) };
  }
  async comparison(input: SupplierMainReviewInput): Promise<Comparison> {
    return (await this.inspect(input)).mainComparison;
  }
  async commit(input: SupplierMainReviewInput, selection: InvoiceOverlapSelection) {
    assertInvoiceReviewDataBudget(selection, 2 * 1024 * 1024, 10000);
    const operation = this.#capture(input), choice = clone(selection);
    let parsed: unknown;
    try { parsed = JSON.parse(choice.snapshotKey); } catch { fail('Stale main selection snapshot.'); }
    if (!Array.isArray(parsed) || parsed.length !== 3 || parsed[0] !== SUPPLIER_OVERLAP_MAIN_VERSION ||
      typeof parsed[1] !== 'string' || choice.snapshotKey !== selectionKey(parsed[1], operation.owned.main))
      fail('Stale main selection snapshot.');
    let result: Comparison | undefined;
    const nativeSnapshotKey = (parsed as unknown[])[1] as string;
    const state = await this.#ledger.commit(nativeInput(operation.owned),
      { ...choice, snapshotKey: nativeSnapshotKey }, (s, _prospective, project) => {
        this.#check(operation);
        if (selectionKey(s.snapshotKey, operation.owned.main) !== choice.snapshotKey)
          fail('Stale main selection snapshot.');
        result = project(operation.owned.main.decisions, operation.owned.main.rejected);
        this.#check(operation);
        return undefined;
      });
    // The ledger linearizes after the synchronous projection. No new await or
    // fallible check may turn a published transaction into an apparent failure.
    this.#adopt(operation.owned.main);
    return { state, result: result! };
  }
  async undo(input: SupplierMainReviewInput, undo: InvoiceOverlapUndo) {
    assertInvoiceReviewDataBudget(undo, 32000, 100);
    const operation = this.#capture(input);
    let result: Comparison | undefined;
    const state = await this.#ledger.undo(nativeInput(operation.owned), clone(undo),
      (_s, _prospective, project) => {
        this.#check(operation);
        result = project(operation.owned.main.decisions, operation.owned.main.rejected);
        this.#check(operation);
        return undefined;
      });
    this.#adopt(operation.owned.main);
    return { state, result: result! };
  }
  async acceptedView(input: SupplierMainReviewInput) {
    const operation = this.#capture(input);
    await this.#ledger.inspectMainComparison(nativeInput(operation.owned),
      operation.owned.main.decisions, operation.owned.main.rejected);
    const view = await this.#ledger.acceptedView(nativeInput(operation.owned));
    this.#check(operation);
    if (operation.generation !== this.state.generation) fail('Stale ledger generation.');
    this.#adopt(operation.owned.main);
    return view;
  }
  async exportSession(input: SupplierMainReviewInput): Promise<InvoiceOverlapSession> {
    const operation = this.#capture(input);
    await this.#ledger.inspectMainComparison(nativeInput(operation.owned),
      operation.owned.main.decisions, operation.owned.main.rejected);
    const session = await this.#ledger.exportSession(nativeInput(operation.owned));
    this.#check(operation);
    if (operation.generation !== this.state.generation) fail('Stale ledger generation.');
    this.#adopt(operation.owned.main);
    return session;
  }
  async reimportSession(input: SupplierMainReviewInput, session: InvoiceOverlapSession) {
    assertInvoiceReviewDataBudget(session, 32 * 1024 * 1024, 1000000);
    const operation = this.#capture(input);
    // Native archive validation cannot publish source ownership.
    const imported = await this.#ledger.reimportSession(nativeInput(operation.owned), clone(session), () => {
      this.#check(operation);
      if (operation.generation !== this.state.generation) fail('Stale ledger generation.');
      return undefined;
    });
    this.#adopt(operation.owned.main);
    return imported;
  }
  async saveSession(input: SupplierMainReviewInput, options: {
    review: { name: string; notes: string; checked: boolean }; events: AuditEvent[];
  }): Promise<ArrayBuffer> {
    assertInvoiceReviewDataBudget(options, 4 * 1024 * 1024, 200000);
    const operation = this.#capture(input), ownedOptions = clone(options);
    const liveSession = await this.exportSession(operation.owned);
    const session = liveSession.state.receipts.length ? liveSession :
      this.archivedReviewDraft ?? liveSession;
    const bytes = await saveSession({ files: operation.owned.currentSourceFiles,
      mappings: operation.owned.mappings, scope: operation.owned.scope,
      decisions: operation.owned.main.decisions, rejected: operation.owned.main.rejected,
      events: ownedOptions.events, review: ownedOptions.review,
      overlapArchive: { revision: operation.owned.revision, session } });
    this.#check(operation);
    if (operation.generation !== this.state.generation) fail('Stale ledger generation.');
    return bytes;
  }
  async exportWorkbook(input: SupplierMainReviewInput, review: SupplierWorkbookReview = {
    checked: false, name: '', notes: '',
  }): Promise<ArrayBuffer> {
    assertInvoiceReviewDataBudget(review, 4 * 1024 * 1024, 200000);
    const operation = this.#capture(input), ownedReview = clone(review);
    const bytes = await this.#ledger.exportWorkbook(nativeInput(operation.owned),
      (book, snapshot, _state, project) => {
        this.#check(operation);
        const result = project(operation.owned.main.decisions, operation.owned.main.rejected);
        const disposition = new Map<string, string>(result.cases.flatMap((c) => c.sourceTrace.map((t) =>
          [`${t.side}:${t.sourceRowId}`, c.reviewedAggregate ? 'accepted-aggregate-member' :
            c.status === 'Matched' ? (c.reviewerDecision === 'Accepted' ? 'manual-main-match' : 'automatic-main-match') :
              c.status === 'Needs Review' ? 'needs-review' : c.status.toLowerCase()] as const)));
        book.getWorksheet('Original movements')!.eachRow((row, number) => {
          if (number > 1) row.getCell(8).value = disposition.get(`${row.getCell(1).text}:${row.getCell(2).text}`) ?? 'unmatched';
        });
        addCaseWorksheets(book, result, operation.owned.currentSourceFiles, ownedReview, validateCellText);
        // The shared Summary links here. Hashes belong to the native sources
        // already re-read and verified by the ledger, never to edited DTOs.
        const metadata = book.addWorksheet('Export Metadata', { state: 'hidden' });
        metadata.addRow(['Field', 'Value']);
        metadata.addRows([
          ['Engine version', ENGINE_VERSION],
          ['Supplier SHA-256', operation.owned.currentSourceFiles[0].sha256],
          ['Ledger SHA-256', operation.owned.currentSourceFiles[1].sha256],
          ['Export time', book.created],
          ['Workbook mode', 'Verified snapshot; workbook edits do not change engine decisions'],
          ['Parsed source meaning', 'Original selected native cells; physical row numbers and hashes are retained in Native row inventory'],
        ]);
        metadata.getCell('B5').numFmt = 'yyyy-mm-dd hh:mm:ss';
        for (const [side, source] of operation.owned.currentSourceFiles.entries()) {
          const sheet = book.addWorksheet(side === 0 ? 'Parsed Supplier Source' : 'Parsed Ledger Source');
          // One header row makes case source hyperlinks resolve to physical row+1.
          sheet.addRow(['Original selected source row']);
          for (const row of source.sheets[operation.owned.mappings[side].sheet].rows)
            sheet.addRow(row);
        }
        const binding = book.addWorksheet('Main comparison binding');
        binding.addRow(['Contract', 'Native snapshot', 'Main generation', 'Chunk', 'Total chunks', 'Main decisions and rejected JSON']);
        const parts = chunks(mainKey(operation.owned.main));
        parts.forEach((part, i) => binding.addRow([SUPPLIER_OVERLAP_MAIN_VERSION, snapshot.snapshotKey,
          operation.owned.main.generation, i + 1, parts.length, part]));
        const proof = book.addWorksheet('Main aggregate proof');
        proof.addRow(['Receipt', 'Candidate', 'Chunk', 'Total chunks', 'Original member proof JSON']);
        for (const match of result.matches.filter((m) => m.reviewedAggregate)) {
          const parts = chunks(json(match.reviewedAggregate));
          parts.forEach((part, i) => proof.addRow([match.reviewedAggregate!.receiptId,
            match.reviewedAggregate!.candidateId, i + 1, parts.length, part]));
        }
        this.#check(operation);
        return undefined;
      });
    this.#check(operation);
    if (operation.generation !== this.state.generation) fail('Stale ledger generation.');
    this.#adopt(operation.owned.main);
    return bytes;
  }
}
