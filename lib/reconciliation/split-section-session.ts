import ExcelJS from 'exceljs';
import { readFile } from './io.ts';
import { excelExportText, validateExportText } from './export-text.ts';
import { defaultMapping, type Mapping, type SourceFile } from './types.ts';
import { prepareVerifiedSources } from './source-preparation.ts';
import { suggestFormats } from './format-inference.ts';
import { formatChoice } from './input-readiness.ts';
import { SectionOperation } from './section-continuation.ts';
import {
  SPLIT_SECTION_VERSION,
  snapshotSplitInputs,
  inspectSplitSection,
  digestSplit,
  guardSplitPlain,
  type SplitReadingContext,
  type SplitReview,
  type SplitOptions,
  type SplitCellEvidence,
} from './split-section.ts';

export const SPLIT_ARTIFACT_VERSION = 'P4_SPLIT_SECTION_ARTIFACT_V1';
export type SplitAcknowledgements = {
  originalRowsReviewed: true;
  referenceRolesReviewed: true;
  separateAmountsReviewed: true;
  perspectiveReviewed: true;
  currencyReviewed: true;
  totalsReviewed: true;
  derivedSourceUnderstood: true;
};
const acknowledgementKeys = [
  'originalRowsReviewed',
  'referenceRolesReviewed',
  'separateAmountsReviewed',
  'perspectiveReviewed',
  'currencyReviewed',
  'totalsReviewed',
  'derivedSourceUnderstood',
] as const;
export type SplitSelection = {
  review: SplitReview;
  selectedMovementRows: number[];
  selectedProposalIds: string[];
  selectionHash: string;
};
export type SplitReviewerDecision = {
  decision: 'accept' | 'reject';
  reviewerLabel: string;
  rationale: string;
  reviewedSourceHash: string;
  reviewedExtractionHash: string;
  reviewedContextHash: string;
  reviewedSelectionHash: string;
  acknowledgements: SplitAcknowledgements;
};
declare const receiptBrand: unique symbol;
export type SplitReceipt = Readonly<{
  id: string;
  sourceHash: string;
  extractionHash: string;
  contextHash: string;
  selectionHash: string;
  reviewerHash: string;
  authority: 'explicit-interpretation-review';
}> & { readonly [receiptBrand]: true };
export type SplitSessionOptions = SplitOptions & {
  /** Supplied review/selection remains evidence to revalidate, never authority. */
  currentSelection?: SplitSelection;
  onCheckpoint?: (event: { stage: 'owned-snapshot' }) => void | Promise<void>;
};
export type SplitArtifact = {
  version: typeof SPLIT_ARTIFACT_VERSION;
  kind: 'explicitly-derived-split-section-csv';
  financialApproval: false;
  scopeConfirmed: false;
  originalSource: SourceFile;
  context: SplitReadingContext;
  originalPdf: ArrayBuffer;
  csv: string;
  nativeSource: SourceFile;
  mapping: Mapping;
  provenance: {
    version: typeof SPLIT_ARTIFACT_VERSION;
    financialApproval: false;
    scopeConfirmed: false;
    originalSha256: string;
    derivedSha256: string;
    review: SplitReview;
    inventory: SplitReview['rows'];
    links: SplitReview['movements'];
    totals: SplitReview['totals'];
    selection: SplitSelection;
    reviewer: {
      label: string;
      rationale: string;
      acknowledgements: SplitAcknowledgements;
      reviewerHash: string;
    };
    /** Historical audit only: serialization never reinstates receipt ownership. */
    historicalReceipt: Omit<SplitReceipt, typeof receiptBrand>;
  };
};
export class SplitSessionError extends Error {
  readonly code: string;
  readonly stage: string;
  constructor(code: string, stage: string) {
    super(`${code}: ${stage}`);
    this.code = code;
    this.stage = stage;
    this.name = 'SplitSessionError';
  }
}
function fail(code: string, stage: string): never {
  throw new SplitSessionError(code, stage);
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function reviewer(label: string, rationale: string) {
  if (
    typeof label !== 'string' ||
    typeof rationale !== 'string' ||
    !label.trim() ||
    !rationale.trim() ||
    label.length > 200 ||
    rationale.length > 4000
  )
    fail('SPLIT_REVIEWER', 'reviewer-context');
  try {
    validateExportText(label, 'SPLIT_REVIEWER');
    validateExportText(rationale, 'SPLIT_REVIEWER');
  } catch {
    fail('SPLIT_REVIEWER', 'reviewer-context');
  }
  return { label, rationale };
}
function acknowledgements(value: SplitAcknowledgements) {
  guardSplitPlain(value);
  if (
    !value ||
    Object.keys(value).length !== acknowledgementKeys.length ||
    acknowledgementKeys.some((key) => value[key] !== true)
  )
    fail('SPLIT_REVIEWER', 'reviewer-context');
}
function validList<T extends string | number>(
  value: readonly T[],
  allowed: readonly T[],
) {
  guardSplitPlain(value);
  if (
    !Array.isArray(value) ||
    value.length > allowed.length ||
    new Set(value).size !== value.length ||
    value.some((x) => !allowed.includes(x))
  )
    fail('SPLIT_SELECTION', 'complete-selection');
  return allowed.filter((x) => value.includes(x));
}
function complete(selection: SplitSelection) {
  const { review } = selection;
  if (
    review.state !== 'review-ready' ||
    !review.sourceVerified ||
    review.diagnostics.length
  )
    fail('SPLIT_STALE_REVIEW', 'evidence-revalidation');
  if (
    !same(
      selection.selectedMovementRows,
      review.movements.map((x) => x.originalRow),
    ) ||
    !same(
      selection.selectedProposalIds,
      review.proposals.map((x) => x.id),
    ) ||
    !review.movements.length
  )
    fail('SPLIT_SELECTION', 'complete-selection');
}
async function selectionDigest(
  review: SplitReview,
  rows: number[],
  ids: string[],
) {
  return digestSplit(
    JSON.stringify({
      version: SPLIT_SECTION_VERSION,
      sourceHash: review.sourceHash,
      extractionHash: review.extractionHash,
      contextHash: review.contextHash,
      selectedMovementRows: rows,
      selectedProposalIds: ids,
    }),
  );
}
async function reviewerDigest(
  selection: SplitSelection,
  decision: SplitReviewerDecision,
) {
  return digestSplit(
    JSON.stringify({
      selectionHash: selection.selectionHash,
      contextHash: selection.review.contextHash,
      label: decision.reviewerLabel,
      rationale: decision.rationale,
      acknowledgements: decision.acknowledgements,
    }),
  );
}
function csvFor(review: SplitReview) {
  const cell = (s: string) =>
    /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  return (
    [
      ['Date', 'Reference', 'Description', 'Debit', 'Credit'],
      ...review.movements.map((x) => [
        x.date,
        x.reference,
        x.description,
        x.debit,
        x.credit,
      ]),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\r\n') + '\r\n'
  );
}
async function derivedReading(source: SourceFile, review: SplitReview) {
  const csv = csvFor(review);
  const bytes = new TextEncoder().encode(csv).buffer;
  const name = source.name.replace(/\.pdf$/i, '') + '.split-section.csv';
  const nativeSource = await readFile(
    name,
    bytes,
    undefined,
    false,
    undefined,
    32767,
  );
  const mapping: Mapping = {
    ...defaultMapping(),
    header: 0,
    date: 0,
    reference: 1,
    description: 2,
    amount: -1,
    debit: 3,
    credit: 4,
    mode: 'split',
    multiplier: 1,
    numberFormat: 'dot',
    dateFormat: 'ymd',
    reportType: 'transactions',
  };
  const assessment = suggestFormats(nativeSource, mapping, 2).numberFormat;
  mapping.formatChoice = {
    numberFormat: formatChoice(
      nativeSource,
      mapping,
      'numberFormat',
      'dot',
      assessment.candidates,
      2,
    ),
  };
  const prepared = prepareVerifiedSources(
    [nativeSource],
    [mapping],
    {
      supplier: '',
      entity: '',
      account: '',
      currency: 'SAR',
      decimals: 2,
      cutoff: '2100-12-31',
      dateWindow: 0,
      confirmed: false,
      coverageConfirmed: false,
    },
    ['supplier'],
  ).sources[0];
  if (
    prepared.errors.length ||
    prepared.transactions.length !== review.movements.length ||
    prepared.excluded.length !== 1 ||
    prepared.excluded[0].row !== 1 ||
    prepared.transactions.some(
      (t, i) =>
        t.date !== review.movements[i].date ||
        t.reference !== review.movements[i].reference ||
        t.amount !==
          Number(
            BigInt(review.movements[i].debitMinor) -
              BigInt(review.movements[i].creditMinor),
          ),
    )
  )
    fail('SPLIT_DERIVED_REPLAY', 'source-revalidation');
  return { csv, nativeSource, mapping };
}

/** Structural review has no matching, allocation or financial approval API. */
export class SplitSectionSession {
  #source: SourceFile;
  #context: SplitReadingContext;
  #generation = 0;
  #selection: SplitSelection | null = null;
  #reviewer: { label: string; rationale: string } | null = null;
  #receipt: SplitReceipt | null = null;
  #owned = new WeakMap<
    object,
    { generation: number; decision: SplitReviewerDecision }
  >();
  #state:
    | 'empty'
    | 'blocked'
    | 'review-ready'
    | 'reviewed'
    | 'rejected'
    | 'derived' = 'empty';
  constructor(
    source: SourceFile,
    context: SplitReadingContext,
    options: SplitOptions = {},
  ) {
    const owned = snapshotSplitInputs(source, context, options);
    this.#source = owned.source;
    this.#context = owned.context;
  }
  get state() {
    return this.#state;
  }
  get selection() {
    return this.#selection ? structuredClone(this.#selection) : null;
  }
  #invalidate() {
    this.#generation++;
    this.#receipt = null;
  }
  #check(generation: number) {
    if (generation !== this.#generation) fail('SPLIT_GENERATION', 'generation');
  }
  invalidate() {
    this.#invalidate();
    this.#selection = null;
    this.#state = 'empty';
  }
  replaceSource(
    source: SourceFile,
    context: SplitReadingContext,
    options: SplitOptions = {},
  ) {
    this.invalidate();
    const owned = snapshotSplitInputs(source, context, options);
    this.#source = owned.source;
    this.#context = owned.context;
  }
  updateReviewer(label: string, rationale: string) {
    this.#invalidate();
    this.#reviewer = null;
    this.#state = this.#selection ? 'review-ready' : 'empty';
    if (
      typeof label === 'string' &&
      typeof rationale === 'string' &&
      (!label.trim() || !rationale.trim())
    )
      return;
    this.#reviewer = reviewer(label, rationale);
  }
  async inspect(options: SplitSessionOptions = {}): Promise<SplitSelection> {
    this.invalidate();
    const generation = this.#generation;
    const checkCurrent = () => {
      options.checkCurrent?.();
      this.#check(generation);
    };
    const guarded = { ...options, checkCurrent };
    const owned = snapshotSplitInputs(this.#source, this.#context, guarded);
    if (options.onCheckpoint)
      await options.onCheckpoint({ stage: 'owned-snapshot' });
    checkCurrent();
    const review = await inspectSplitSection(
      owned.source,
      owned.context,
      guarded,
    );
    checkCurrent();
    const selectionHash = await selectionDigest(review, [], []);
    checkCurrent();
    new SectionOperation(guarded).check();
    this.#selection = {
      review,
      selectedMovementRows: [],
      selectedProposalIds: [],
      selectionHash,
    };
    this.#state = review.state;
    return structuredClone(this.#selection);
  }
  async select(
    rows: readonly number[],
    ids: readonly string[],
    options: SplitOptions = {},
  ): Promise<SplitSelection> {
    this.#invalidate();
    this.#state = this.#selection?.review.state ?? 'empty';
    const generation = this.#generation;
    const operation = new SectionOperation(options, () =>
      this.#check(generation),
    );
    if (!this.#selection) fail('SPLIT_SELECTION', 'complete-selection');
    const review = structuredClone(this.#selection.review);
    const selectedMovementRows = validList(
      rows,
      review.movements.map((x) => x.originalRow),
    );
    const selectedProposalIds = validList(
      ids,
      review.proposals.map((x) => x.id),
    );
    const selectionHash = await selectionDigest(
      review,
      selectedMovementRows,
      selectedProposalIds,
    );
    operation.check();
    this.#selection = {
      review,
      selectedMovementRows,
      selectedProposalIds,
      selectionHash,
    };
    return structuredClone(this.#selection);
  }
  async recordReviewerDecision(
    input: SplitReviewerDecision,
    options: SplitSessionOptions = {},
  ): Promise<SplitReceipt | null> {
    this.#invalidate();
    this.#state = this.#selection?.review.state ?? 'empty';
    const generation = this.#generation;
    const operation = new SectionOperation(options, () =>
      this.#check(generation),
    );
    guardSplitPlain(input);
    if (
      !this.#selection ||
      !input ||
      !['accept', 'reject'].includes(input.decision)
    )
      fail('SPLIT_REVIEWER', 'reviewer-context');
    const decision = structuredClone(input);
    const selection = structuredClone(this.#selection);
    if (options.currentSelection !== undefined) {
      guardSplitPlain(options.currentSelection);
      if (!same(options.currentSelection, selection))
        fail('SPLIT_STALE_REVIEW', 'evidence-revalidation');
    }
    const ownedReviewer = reviewer(decision.reviewerLabel, decision.rationale);
    if (
      decision.reviewedSourceHash !== selection.review.sourceHash ||
      decision.reviewedExtractionHash !== selection.review.extractionHash ||
      decision.reviewedContextHash !== selection.review.contextHash ||
      decision.reviewedSelectionHash !== selection.selectionHash
    )
      fail('SPLIT_STALE_REVIEW', 'evidence-revalidation');
    this.#reviewer = ownedReviewer;
    if (decision.decision === 'reject') {
      operation.check();
      this.#state = 'rejected';
      return null;
    }
    complete(selection);
    acknowledgements(decision.acknowledgements);
    const fresh = await inspectSplitSection(this.#source, this.#context, {
      ...options,
      checkCurrent: () => {
        options.checkCurrent?.();
        this.#check(generation);
      },
    });
    operation.check();
    if (!same(fresh, selection.review))
      fail('SPLIT_STALE_REVIEW', 'evidence-revalidation');
    const reviewerHash = await reviewerDigest(selection, decision);
    operation.check();
    const receipt = Object.freeze({
      id: crypto.randomUUID(),
      sourceHash: fresh.sourceHash,
      extractionHash: fresh.extractionHash,
      contextHash: fresh.contextHash,
      selectionHash: selection.selectionHash,
      reviewerHash,
      authority: 'explicit-interpretation-review' as const,
    }) as SplitReceipt;
    this.#owned.set(receipt, { generation, decision });
    this.#receipt = receipt;
    this.#state = 'reviewed';
    return receipt;
  }
  async apply(
    receipt: SplitReceipt,
    currentSource: SourceFile,
    currentContext: SplitReadingContext,
    options: SplitSessionOptions = {},
  ): Promise<SplitArtifact> {
    const ownership =
      receipt && typeof receipt === 'object'
        ? this.#owned.get(receipt)
        : undefined;
    if (
      ownership &&
      this.#reviewer &&
      (this.#reviewer.label !== ownership.decision.reviewerLabel ||
        this.#reviewer.rationale !== ownership.decision.rationale)
    )
      fail('SPLIT_REVIEWER', 'reviewer-context');
    if (
      !ownership ||
      receipt !== this.#receipt ||
      ownership.generation !== this.#generation ||
      this.#state !== 'reviewed' ||
      !this.#selection
    )
      fail('SPLIT_RECEIPT', 'receipt-ownership');
    // Consume before snapshot/hash/native awaits, including failing applications.
    this.#invalidate();
    this.#state = 'review-ready';
    const generation = this.#generation;
    const checkCurrent = () => {
      options.checkCurrent?.();
      this.#check(generation);
    };
    const guarded = { ...options, checkCurrent };
    const operation = new SectionOperation(guarded);
    const owned = snapshotSplitInputs(currentSource, currentContext, guarded);
    const selection = structuredClone(this.#selection);
    if (options.currentSelection !== undefined) {
      guardSplitPlain(options.currentSelection);
      const supplied = structuredClone(options.currentSelection);
      if (
        !same(supplied.selectedMovementRows, selection.selectedMovementRows) ||
        !same(supplied.selectedProposalIds, selection.selectedProposalIds)
      )
        fail('SPLIT_SELECTION', 'complete-selection');
      if (!same(supplied, selection))
        fail('SPLIT_STALE_REVIEW', 'evidence-revalidation');
    }
    if (
      !same(owned.context, this.#context) ||
      !same(owned.source.pdf?.cuts, this.#source.pdf?.cuts)
    )
      fail('SPLIT_CONTEXT', 'reading-context');
    if (owned.source.name !== this.#source.name)
      fail('SPLIT_STALE_REVIEW', 'source-revalidation');
    complete(selection);
    if (options.onCheckpoint)
      await options.onCheckpoint({ stage: 'owned-snapshot' });
    operation.check();
    const review = await inspectSplitSection(
      owned.source,
      owned.context,
      guarded,
    );
    operation.check();
    if (!same(review, selection.review))
      fail('SPLIT_STALE_REVIEW', 'source-revalidation');
    const derived = await derivedReading(owned.source, review);
    operation.check();
    const artifact: SplitArtifact = {
      version: SPLIT_ARTIFACT_VERSION,
      kind: 'explicitly-derived-split-section-csv',
      financialApproval: false,
      scopeConfirmed: false,
      originalSource: owned.source,
      context: owned.context,
      originalPdf: owned.source.original!.slice(0),
      ...derived,
      provenance: {
        version: SPLIT_ARTIFACT_VERSION,
        financialApproval: false,
        scopeConfirmed: false,
        originalSha256: review.sourceHash,
        derivedSha256: derived.nativeSource.sha256!,
        review,
        inventory: structuredClone(review.rows),
        links: structuredClone(review.movements),
        totals: structuredClone(review.totals),
        selection,
        reviewer: {
          ...this.#reviewer!,
          acknowledgements: structuredClone(
            ownership.decision.acknowledgements,
          ),
          reviewerHash: receipt.reviewerHash,
        },
        historicalReceipt: { ...receipt },
      },
    };
    // Apply must never publish an artifact that the archive/export allocation
    // guard already refuses. Receipt consumption still happens before work.
    guardArtifactMetadata(artifact, operation);
    operation.check();
    this.#state = 'derived';
    return artifact;
  }
}

function ownArtifact(input: SplitArtifact, options: SplitOptions) {
  const operation = new SectionOperation(options);
  // This check occurs before walking descriptors, cloning, decoding or hashing.
  operation.check();
  guardArtifactMetadata(input, operation);
  if (
    !input ||
    input.version !== SPLIT_ARTIFACT_VERSION ||
    input.kind !== 'explicitly-derived-split-section-csv' ||
    input.financialApproval !== false ||
    input.scopeConfirmed !== false ||
    !(input.originalPdf instanceof ArrayBuffer)
  )
    fail('SPLIT_ARTIFACT', 'source-revalidation');
  const owned = snapshotSplitInputs(
    input.originalSource,
    input.context,
    options,
  );
  if (
    input.originalPdf.byteLength !== owned.source.original!.byteLength ||
    input.originalPdf.byteLength > operation.budgets.maxOriginalBytes
  )
    fail('SPLIT_ARTIFACT', 'source-revalidation');
  return structuredClone(input);
}
function guardArtifactMetadata(input: unknown, operation: SectionOperation) {
  if (
    !input ||
    typeof input !== 'object' ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    fail('SPLIT_ARTIFACT', 'source-revalidation');
  const values: Record<string, unknown> = {};
  const keys = Reflect.ownKeys(input);
  const allowed = [
    'version',
    'kind',
    'financialApproval',
    'scopeConfirmed',
    'originalSource',
    'context',
    'originalPdf',
    'csv',
    'nativeSource',
    'mapping',
    'provenance',
  ];
  if (keys.some((key) => typeof key !== 'string' || !allowed.includes(key)))
    fail('SPLIT_ARTIFACT', 'source-revalidation');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      typeof key !== 'string' ||
      !descriptor ||
      !Object.hasOwn(descriptor, 'value')
    )
      fail('SPLIT_ARTIFACT', 'source-revalidation');
    values[key] = descriptor.value;
  }
  // A whole CSV has a file limit; individual source/evidence cells keep 32767.
  const csv = values.csv;
  if (
    typeof csv !== 'string' ||
    csv.length > operation.budgets.maxOriginalBytes ||
    new TextEncoder().encode(csv).byteLength >
      operation.budgets.maxOriginalBytes
  )
    fail('SPLIT_ARCHIVE', 'resource');
  values.csv = '';
  guardSplitPlain(values, () => operation.check());
}
export async function revalidateSplitArtifact(
  input: SplitArtifact,
  options: SplitOptions = {},
): Promise<SplitArtifact> {
  const operation = new SectionOperation(options);
  const artifact = ownArtifact(input, options);
  const review = await inspectSplitSection(
    artifact.originalSource,
    artifact.context,
    options,
  );
  operation.check();
  const p = artifact.provenance;
  if (
    !p ||
    p.version !== SPLIT_ARTIFACT_VERSION ||
    p.financialApproval !== false ||
    p.scopeConfirmed !== false ||
    !same(p.review, review) ||
    !same(p.inventory, review.rows) ||
    !same(p.links, review.movements) ||
    !same(p.totals, review.totals) ||
    !same(p.selection.review, review) ||
    p.originalSha256 !== review.sourceHash ||
    (await digestSplit(artifact.originalPdf)) !== review.sourceHash
  )
    fail('SPLIT_STALE_REVIEW', 'evidence-revalidation');
  complete(p.selection);
  acknowledgements(p.reviewer.acknowledgements);
  reviewer(p.reviewer.label, p.reviewer.rationale);
  if (
    p.selection.selectionHash !==
    (await selectionDigest(
      review,
      p.selection.selectedMovementRows,
      p.selection.selectedProposalIds,
    ))
  )
    fail('SPLIT_SELECTION', 'complete-selection');
  const decision: SplitReviewerDecision = {
    decision: 'accept',
    reviewerLabel: p.reviewer.label,
    rationale: p.reviewer.rationale,
    reviewedSourceHash: review.sourceHash,
    reviewedExtractionHash: review.extractionHash,
    reviewedContextHash: review.contextHash,
    reviewedSelectionHash: p.selection.selectionHash,
    acknowledgements: p.reviewer.acknowledgements,
  };
  const reviewerHash = await reviewerDigest(p.selection, decision);
  const h = p.historicalReceipt;
  if (
    p.reviewer.reviewerHash !== reviewerHash ||
    !h ||
    typeof h.id !== 'string' ||
    !h.id ||
    h.authority !== 'explicit-interpretation-review' ||
    h.sourceHash !== review.sourceHash ||
    h.extractionHash !== review.extractionHash ||
    h.contextHash !== review.contextHash ||
    h.selectionHash !== p.selection.selectionHash ||
    h.reviewerHash !== reviewerHash
  )
    fail('SPLIT_STALE_REVIEW', 'evidence-revalidation');
  const derived = await derivedReading(artifact.originalSource, review);
  operation.check();
  const { original: nativeBytes, ...nativeMetadata } = artifact.nativeSource;
  const { original: _derivedBytes, ...derivedMetadata } = derived.nativeSource;
  if (
    artifact.csv !== derived.csv ||
    !same(artifact.mapping, derived.mapping) ||
    p.derivedSha256 !== derived.nativeSource.sha256 ||
    !same(nativeMetadata, derivedMetadata) ||
    !(nativeBytes instanceof ArrayBuffer) ||
    (await digestSplit(nativeBytes)) !==
      derived.nativeSource.sha256
  )
    fail('SPLIT_DERIVED_REPLAY', 'source-revalidation');
  operation.check();
  // Historical receipt stays a plain value. No WeakMap registration occurs.
  return artifact;
}
function encode(bytes: ArrayBuffer) {
  let out = '';
  const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i += 8192)
    out += String.fromCharCode(...a.subarray(i, i + 8192));
  return btoa(out);
}
function decode(value: unknown, limit: number) {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(limit / 3) * 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    fail('SPLIT_ARCHIVE', 'source-revalidation');
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0)).buffer;
  if (bytes.byteLength > limit) fail('SPLIT_ARCHIVE', 'source-revalidation');
  return bytes;
}
export async function saveSplitArtifact(
  input: SplitArtifact,
  options: SplitOptions = {},
): Promise<ArrayBuffer> {
  const operation = new SectionOperation(options);
  const artifact = await revalidateSplitArtifact(input, options);
  operation.check();
  const { original: pdf, ...sourceMetadata } = artifact.originalSource;
  const { original: csv, ...csvMetadata } = artifact.nativeSource;
  const {
    originalPdf: _originalPdf,
    originalSource: _source,
    nativeSource: _native,
    ...metadata
  } = artifact;
  const text = JSON.stringify({
    version: SPLIT_ARTIFACT_VERSION,
    artifact: metadata,
    sourceMetadata,
    csvMetadata,
    pdf: encode(pdf!),
    derived: encode(csv!),
  });
  if (text.length > 64 * 1024 * 1024) fail('SPLIT_ARCHIVE', 'resource');
  operation.check();
  return new TextEncoder().encode(text).buffer;
}
export async function restoreSplitArtifact(
  bytes: ArrayBuffer,
  options: SplitOptions = {},
): Promise<SplitArtifact> {
  const operation = new SectionOperation(options);
  operation.check();
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > 64 * 1024 * 1024)
    fail('SPLIT_ARCHIVE', 'resource');
  const copy = bytes.slice(0);
  const payload = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(copy),
  ) as {
    version: string;
    artifact: Omit<
      SplitArtifact,
      'originalPdf' | 'originalSource' | 'nativeSource'
    >;
    sourceMetadata: Omit<SourceFile, 'original'>;
    csvMetadata: Omit<SourceFile, 'original'>;
    pdf: string;
    derived: string;
  };
  if (
    !payload ||
    payload.version !== SPLIT_ARTIFACT_VERSION ||
    !same(Object.keys(payload).sort(), [
      'artifact',
      'csvMetadata',
      'derived',
      'pdf',
      'sourceMetadata',
      'version',
    ])
  )
    fail('SPLIT_ARCHIVE', 'source-revalidation');
  const pdf = decode(payload.pdf, operation.budgets.maxOriginalBytes);
  const csv = decode(payload.derived, operation.budgets.maxOriginalBytes);
  guardArtifactMetadata(payload.artifact, operation);
  guardSplitPlain(payload.sourceMetadata);
  guardSplitPlain(payload.csvMetadata);
  const artifact: SplitArtifact = {
    ...payload.artifact,
    originalPdf: pdf,
    originalSource: { ...payload.sourceMetadata, original: pdf.slice(0) },
    nativeSource: { ...payload.csvMetadata, original: csv },
  };
  return revalidateSplitArtifact(artifact, options);
}
export async function exportSplitWorkbook(
  input: SplitArtifact,
  options: SplitOptions = {},
): Promise<ArrayBuffer> {
  const operation = new SectionOperation(options);
  const artifact = await revalidateSplitArtifact(input, options);
  operation.check();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tarasuf';
  const add = (name: string, rows: (string | number)[][]) => {
    const sheet = workbook.addWorksheet(name);
    for (const row of rows) {
      if (row.some((value) => String(value).length > 32767))
        fail('SPLIT_EXPORT_CELL', 'resource');
      const values = row.map((value) => String(value));
      for (const value of values) validateExportText(value, 'SPLIT_EXPORT_CELL');
      const added = sheet.addRow(values.map(excelExportText));
      added.eachCell((cell) => {
        cell.numFmt = '@';
      });
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.columns.forEach((column) => {
      column.width = 24;
    });
  };
  const { review } = artifact.provenance;
  add('DerivedReading', [
    ['Date', 'Reference', 'Description', 'Debit', 'Credit'],
    ...review.movements.map((x) => [
      x.date,
      x.reference,
      x.description,
      x.debit,
      x.credit,
    ]),
  ]);
  add('OriginalInventory', [
    [
      'OriginalRow',
      'Page',
      'Kind',
      'DerivedRow',
      'Date',
      'Reference',
      'Description',
      'Debit',
      'Credit',
    ],
    ...review.rows.map((x) => [
      x.originalRow,
      x.page,
      x.kind,
      x.derivedRow ?? '',
      ...x.values,
    ]),
  ]);
  add('MovementEvidence', [
    [
      'OriginalRow',
      'Page',
      'DerivedRow',
      'Reference',
      'DebitMinor',
      'CreditMinor',
      'ProposalId',
    ],
    ...review.movements.map((x) => [
      x.originalRow,
      x.page,
      x.derivedRow,
      x.reference,
      x.debitMinor,
      x.creditMinor,
      x.proposalId ?? '',
    ]),
  ]);
  const proofRows: (string | number)[][] = [
    [
      'MovementOriginalRow',
      'Role',
      'SourceHash',
      'ExtractionHash',
      'ExtractionRevision',
      'Sheet',
      'Row',
      'Page',
      'Column',
      'Literal',
      'SpanStartInclusive',
      'SpanEndExclusive',
      'SpanText',
    ],
  ];
  const proof = (
    movement: number | string,
    role: string,
    e: SplitCellEvidence,
  ) => {
    proofRows.push([
      movement,
      role,
      e.sourceHash,
      e.extractionHash,
      e.extractionRevision,
      e.sheet,
      e.row,
      e.page,
      e.column,
      e.literal,
      e.spanStartInclusive,
      e.spanEndExclusive,
      e.spanText,
    ]);
  };
  for (const m of review.movements) {
    proof(m.originalRow, 'date', m.dateEvidence);
    proof(m.originalRow, 'description', m.descriptionEvidence);
    proof(m.originalRow, 'reference', m.referenceEvidence);
    proof(m.originalRow, 'debit', m.debitEvidence);
    proof(m.originalRow, 'credit', m.creditEvidence);
  }
  for (const p of review.proposals) {
    const row = p.evidence.target.row;
    proof(row, 'proposal-target', p.evidence.target);
    proof(row, 'parent', p.evidence.parent);
    for (const e of p.evidence.continuations) proof(row, 'continuation', e);
    for (const band of p.evidence.headers)
      for (const e of band) proof(row, 'proposal-header', e);
  }
  for (const e of review.currencyEvidence) proof('', 'currency', e);
  for (const band of review.headerEvidence)
    for (const e of band) proof('', 'header', e);
  for (const t of review.totals) {
    proof('', 'total-debit', t.debitEvidence);
    proof('', 'total-credit', t.creditEvidence);
  }
  add('SourceCellEvidence', proofRows);
  add('ComponentTotals', [
    [
      'OriginalRow',
      'Page',
      'Role',
      'ExpectedDebitMinor',
      'ExpectedCreditMinor',
      'ActualDebitMinor',
      'ActualCreditMinor',
    ],
    ...review.totals.map((x) => [
      x.originalRow,
      x.page,
      x.role,
      x.expectedDebitMinor,
      x.expectedCreditMinor,
      x.actualDebitMinor,
      x.actualCreditMinor,
    ]),
  ]);
  add('ReviewHistory', [
    ['Key', 'Value'],
    ['Version', SPLIT_ARTIFACT_VERSION],
    ['FinancialApproval', 'false'],
    ['ScopeConfirmed', 'false'],
    ['OriginalSha256', artifact.provenance.originalSha256],
    ['DerivedSha256', artifact.provenance.derivedSha256],
    ['GrossDebitMinor', review.grossDebitMinor],
    ['GrossCreditMinor', review.grossCreditMinor],
    ['NetMinor', review.netMinor],
    ['Context', JSON.stringify(artifact.context)],
    ['Reviewer', artifact.provenance.reviewer.label],
    ['Rationale', artifact.provenance.reviewer.rationale],
    [
      'Acknowledgements',
      JSON.stringify(artifact.provenance.reviewer.acknowledgements),
    ],
    [
      'HistoricalReceipt',
      JSON.stringify(artifact.provenance.historicalReceipt),
    ],
  ]);
  // Preserve original bytes in bounded text chunks, separate from CSV money.
  const encoded = encode(artifact.originalPdf);
  const originalRows: (string | number)[][] = [['Chunk', 'Base64Pdf']];
  for (let i = 0; i < encoded.length; i += 30000)
    originalRows.push([i / 30000 + 1, encoded.slice(i, i + 30000)]);
  add('OriginalPdf', originalRows);
  operation.check();
  const buffer = await workbook.xlsx.writeBuffer();
  operation.check();
  return new Uint8Array(buffer).slice().buffer;
}
