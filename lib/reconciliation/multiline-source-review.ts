// UI lifecycle only. The accepted source/review/financial replay contract stays frozen.
import {
  MultilineReviewSession,
  type AppliedMultiline,
  type BoundSelection,
  type Field,
  type InvoiceCandidate,
  type ReviewReceipt,
} from '../../audit/local-provider/multiline-source-v1/workflow.ts';
export type SourceReviewPhase =
  | 'empty'
  | 'reading'
  | 'candidate'
  | 'question'
  | 'abstain'
  | 'approved'
  | 'rejected'
  | 'applying'
  | 'applied';
export type SourceReviewView = Readonly<{
  phase: SourceReviewPhase;
  name: string;
  synthetic: boolean;
  originalText: string;
  originalSha256: string;
  extractionRevision: string;
  reason: string | null;
  proposal: InvoiceCandidate | null;
  bound: BoundSelection | null;
  selectedFields: readonly Field[];
  reviewer: Readonly<{ label: string; rationale: string }> | null;
  applied: AppliedMultiline | null;
}>;
const fields: Field[] = ['date', 'reference', 'amount', 'currency'];
const empty = (): SourceReviewView =>
  Object.freeze({
    phase: 'empty',
    name: '',
    synthetic: false,
    originalText: '',
    originalSha256: '',
    extractionRevision: '',
    reason: null,
    proposal: null,
    bound: null,
    selectedFields: Object.freeze([]),
    reviewer: null,
    applied: null,
  });
/** Owns no financial source, comparison or financial approval. Pending jobs
 * may finish, but only the current original/read/selection can publish a view. */
export class MultilineSourceReviewController {
  #epoch = 0;
  #readingRevision = 0;
  #session: MultilineReviewSession | null = null;
  #bytes: Uint8Array | null = null;
  #receipt: ReviewReceipt | null = null;
  #view: SourceReviewView = empty();
  get view(): SourceReviewView {
    return this.#view;
  }
  #set(patch: Partial<SourceReviewView>) {
    this.#view = Object.freeze({ ...this.#view, ...patch });
  }
  clear(): void {
    this.#epoch++;
    this.#session?.replaceSource(new Uint8Array(), 'cleared-ui-source');
    this.#session = null;
    this.#bytes = null;
    this.#receipt = null;
    this.#view = empty();
  }
  beginSource(name: string, synthetic = false): number {
    this.clear();
    this.#set({ phase: 'reading', name, synthetic });
    return this.#epoch;
  }
  failSource(ticket: number, reason: string): void {
    if (ticket === this.#epoch) this.#set({ phase: 'abstain', reason });
  }
  async finishSource(
    ticket: number,
    suppliedBytes: Uint8Array,
  ): Promise<boolean> {
    if (ticket !== this.#epoch) return false;
    const bytes = new Uint8Array(suppliedBytes);
    const revision = `ui-text-reading:${++this.#readingRevision}`;
    const session = new MultilineReviewSession(bytes, revision);
    this.#session = session;
    const snapshot = await session.inspect();
    if (ticket !== this.#epoch) return false;
    let text = '';
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        bytes,
      );
    } catch {
      /* inspection supplies invalid-encoding */
    }
    this.#bytes = bytes;
    this.#set({
      phase: snapshot.outcome,
      originalText: text,
      originalSha256: snapshot.originalSha256,
      extractionRevision: revision,
      proposal: snapshot.candidate,
      reason: snapshot.reason,
      selectedFields: Object.freeze(snapshot.candidate ? fields.slice() : []),
    });
    if (snapshot.candidate) {
      const bound = await session.select(snapshot.candidate.selections);
      if (ticket !== this.#epoch) return false;
      this.#set({ bound });
    }
    return true;
  }
  async reread(): Promise<boolean> {
    if (!this.#bytes) return false;
    const bytes = new Uint8Array(this.#bytes);
    const { name, synthetic } = this.#view;
    return this.finishSource(this.beginSource(name, synthetic), bytes);
  }
  async select(selectedFields: readonly Field[]): Promise<boolean> {
    const session = this.#session;
    const proposal = this.#view.proposal;
    if (!session || !proposal) return false;
    const ticket = ++this.#epoch;
    this.#receipt = null;
    const selected = fields.filter((field) => selectedFields.includes(field));
    this.#set({
      phase: 'candidate',
      bound: null,
      selectedFields: Object.freeze(selected),
      reviewer: null,
      applied: null,
    });
    const bound = await session.select(
      proposal.selections.filter((selection) =>
        selected.includes(selection.field),
      ),
    );
    if (ticket !== this.#epoch) return false;
    this.#set({ bound });
    return true;
  }
  /** Reviewer metadata/acknowledgement edits revoke earlier decisions too. */
  invalidateReview(): Promise<boolean> {
    return this.select(this.#view.selectedFields);
  }
  recordReview(
    label: string,
    rationale: string,
    acknowledged: boolean,
    decision: 'accept' | 'reject',
  ): boolean {
    const session = this.#session;
    const bound = this.#view.bound;
    if (
      !session ||
      !bound ||
      !label.trim() ||
      !rationale.trim() ||
      label.length > 120 ||
      rationale.length > 1000 ||
      (decision === 'accept' && !acknowledged)
    )
      return false;
    this.#epoch++;
    this.#receipt = session.recordReviewerDecision({
      decision,
      reviewerLabel: label.trim(),
      rationale: rationale.trim(),
      reviewedOriginalSha256: bound.originalSha256,
      reviewedExtractionRevision: bound.extractionRevision,
      reviewedSelectionSha256: bound.selectionSha256,
    });
    this.#set({
      phase: decision === 'accept' ? 'approved' : 'rejected',
      reviewer: Object.freeze({
        label: label.trim(),
        rationale: rationale.trim(),
      }),
      applied: null,
    });
    return true;
  }
  async apply(): Promise<AppliedMultiline | null> {
    const session = this.#session;
    const receipt = this.#receipt;
    const bytes = this.#bytes;
    if (!session || !receipt || !bytes || this.#view.phase !== 'approved')
      return null;
    const ticket = ++this.#epoch;
    const revision = this.#view.extractionRevision;
    this.#set({ phase: 'applying', applied: null });
    try {
      const applied = await session.apply(receipt, bytes, revision);
      if (ticket !== this.#epoch) return null;
      this.#receipt = null;
      this.#set({ phase: 'applied', applied });
      return applied;
    } catch {
      if (ticket !== this.#epoch) return null;
      this.#receipt = null;
      this.#set({
        phase: 'candidate',
        reason: 'replay-refused',
        reviewer: null,
        applied: null,
      });
      return null;
    }
  }
}
