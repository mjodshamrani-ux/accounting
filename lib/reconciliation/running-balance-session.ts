import ExcelJS from 'exceljs';
import { readFile } from './io.ts';
import { excelExportText, validateExportText } from './export-text.ts';
import { defaultMapping, type Mapping, type SourceFile } from './types.ts';
import {
  SectionOperationError,
  type SectionOperation,
} from './section-continuation.ts';
import {
  RUNNING_BALANCE_VERSION,
  snapshotRunningInputs,
  inspectRunningBalance,
  digestRunning,
  guardRunningPlain,
  type RunningBalanceContext,
  checkRunningOptions,
  runningBudgets,
  type RunningReview,
  type RunningOptions,
  type RunningCellEvidence,
} from './running-balance.ts';

export const RUNNING_ARTIFACT_VERSION = 'P4_RUNNING_BALANCE_ARTIFACT_V1';
export type RunningAcknowledgements = {
  originalRowsReviewed: true;
  referenceRolesReviewed: true;
  separateAmountsReviewed: true;
  perspectiveReviewed: true;
  currencyReviewed: true;
  balancesReviewed: true;
  sequenceReviewed: true;
  totalsReviewed: true;
  derivedSourceUnderstood: true;
};
const acknowledgementKeys = [
  'originalRowsReviewed',
  'referenceRolesReviewed',
  'separateAmountsReviewed',
  'perspectiveReviewed',
  'currencyReviewed',
  'balancesReviewed',
  'sequenceReviewed',
  'totalsReviewed',
  'derivedSourceUnderstood',
] as const;
export type RunningSelection = {
  review: RunningReview;
  selectedMovementRows: number[];
  selectedProposalIds: string[];
  selectionHash: string;
};
export type RunningReviewerDecision = {
  decision: 'accept' | 'reject';
  reviewerLabel: string;
  rationale: string;
  reviewedSourceHash: string;
  reviewedExtractionHash: string;
  reviewedContextHash: string;
  reviewedSelectionHash: string;
  acknowledgements: RunningAcknowledgements;
};
declare const receiptBrand: unique symbol;
export type RunningReceipt = Readonly<{
  id: string;
  sourceHash: string;
  extractionHash: string;
  contextHash: string;
  selectionHash: string;
  reviewerHash: string;
  authority: 'explicit-interpretation-review';
}> & { readonly [receiptBrand]: true };
export type RunningSessionOptions = RunningOptions & {
  /** Supplied review/selection remains evidence to revalidate, never authority. */
  currentSelection?: RunningSelection;
  onCheckpoint?: (event: {
    stage: 'owned-snapshot' | 'before-publish';
  }) => void | Promise<void>;
};
export type RunningArtifact = {
  version: typeof RUNNING_ARTIFACT_VERSION;
  kind: 'explicitly-derived-running-balance-csv';
  financialApproval: false;
  scopeConfirmed: false;
  originalSource: SourceFile;
  context: RunningBalanceContext;
  originalPdf: ArrayBuffer;
  csv: string;
  nativeSource: SourceFile;
  mapping: Mapping;
  provenance: {
    version: typeof RUNNING_ARTIFACT_VERSION;
    financialApproval: false;
    scopeConfirmed: false;
    originalSha256: string;
    derivedSha256: string;
    review: RunningReview;
    inventory: RunningReview['rows'];
    links: RunningReview['movements'];
    steps: RunningReview['balanceSteps'];
    controls: RunningReview['controls'];
    selection: RunningSelection;
    reviewer: {
      label: string;
      rationale: string;
      acknowledgements: RunningAcknowledgements;
      reviewerHash: string;
    };
    /** Historical audit only: serialization never reinstates receipt ownership. */
    historicalReceipt: Omit<RunningReceipt, typeof receiptBrand>;
  };
};
export class RunningSessionError extends Error {
  readonly code: string;
  readonly stage: string;
  constructor(code: string, stage: string) {
    super(`${code}: ${stage}`);
    this.code = code;
    this.stage = stage;
    this.name = 'RunningSessionError';
  }
}
function fail(code: string, stage: string): never {
  throw new RunningSessionError(code, stage);
}
/** Inspect option descriptors before accessing callbacks or caller evidence. */
function coreOptions(
  options: RunningSessionOptions = {},
  generationCheck?: () => void,
): RunningOptions {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype)
    throw new SectionOperationError('invalid-budget');
  const signalDescriptor = Object.getOwnPropertyDescriptor(options, 'signal');
  if (signalDescriptor && !Object.hasOwn(signalDescriptor, 'value'))
    throw new SectionOperationError('invalid-budget');
  if (signalDescriptor?.value !== undefined) {
    let aborted: boolean;
    try {
      aborted = Object.getOwnPropertyDescriptor(
        AbortSignal.prototype,
        'aborted',
      )!.get!.call(signalDescriptor.value);
    } catch {
      throw new SectionOperationError('invalid-budget');
    }
    if (aborted) throw new SectionOperationError('cancelled');
  }
  const allowed = [
    'signal',
    'budgets',
    'onProgress',
    'checkCurrent',
    'inventoryOriginalRows',
    'currentSelection',
    'onCheckpoint',
  ];
  const values: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(options)) {
    const d = Object.getOwnPropertyDescriptor(options, key)!;
    if (
      typeof key !== 'string' ||
      !allowed.includes(key) ||
      !Object.hasOwn(d, 'value') ||
      !d.enumerable
    )
      throw new SectionOperationError('invalid-budget');
    if (key !== 'currentSelection' && key !== 'onCheckpoint')
      values[key] = d.value;
  }
  if (generationCheck) {
    const external = values.checkCurrent as (() => void) | undefined;
    values.checkCurrent = () => {
      external?.();
      generationCheck();
    };
  }
  return values as RunningOptions;
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
    fail('RUNNING_REVIEWER', 'reviewer-context');
  try {
    validateExportText(label, 'RUNNING_REVIEWER');
    validateExportText(rationale, 'RUNNING_REVIEWER');
  } catch {
    fail('RUNNING_REVIEWER', 'reviewer-context');
  }
  return { label, rationale };
}
function acknowledgements(value: RunningAcknowledgements) {
  guardRunningPlain(value);
  if (
    !value ||
    Object.keys(value).length !== acknowledgementKeys.length ||
    acknowledgementKeys.some((key) => value[key] !== true)
  )
    fail('RUNNING_REVIEWER', 'reviewer-context');
}
function validList<T extends string | number>(
  value: readonly T[],
  allowed: readonly T[],
  options: RunningOptions = {},
) {
  const operation = checkRunningOptions(coreOptions(options));
  guardRunningPlain(
    value,
    () => operation.check(),
    runningBudgets(coreOptions(options)),
  );
  if (
    !Array.isArray(value) ||
    value.length > allowed.length ||
    new Set(value).size !== value.length ||
    value.some((x) => !allowed.includes(x))
  )
    fail('RUNNING_SELECTION', 'complete-selection');
  return allowed.filter((x) => value.includes(x));
}
function complete(selection: RunningSelection) {
  const { review } = selection;
  if (
    review.state !== 'review-ready' ||
    !review.sourceVerified ||
    review.diagnostics.length
  )
    fail('RUNNING_STALE_REVIEW', 'evidence-revalidation');
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
    fail('RUNNING_SELECTION', 'complete-selection');
}
async function selectionDigest(
  review: RunningReview,
  rows: number[],
  ids: string[],
) {
  return digestRunning(
    JSON.stringify({
      version: RUNNING_BALANCE_VERSION,
      sourceHash: review.sourceHash,
      extractionHash: review.extractionHash,
      contextHash: review.contextHash,
      selectedMovementRows: rows,
      selectedProposalIds: ids,
    }),
  );
}
async function reviewerDigest(
  selection: RunningSelection,
  decision: RunningReviewerDecision,
) {
  return digestRunning(
    JSON.stringify({
      selectionHash: selection.selectionHash,
      contextHash: selection.review.contextHash,
      label: decision.reviewerLabel,
      rationale: decision.rationale,
      acknowledgements: decision.acknowledgements,
    }),
  );
}
function csvFor(review: RunningReview) {
  const cell = (s: string) =>
    /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  return (
    [
      ['Seq', 'Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'],
      ...review.movements.map((x) => [
        x.seq,
        x.date,
        x.reference,
        x.description,
        x.debit,
        x.credit,
        x.balance,
      ]),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\r\n') + '\r\n'
  );
}
async function derivedReading(
  source: SourceFile,
  review: RunningReview,
  options: RunningOptions = {},
) {
  const csv = csvFor(review);
  const budgets = runningBudgets(coreOptions(options));
  if (csv.length > budgets.maxCsvBytes) fail('RUNNING_CSV', 'resource');
  const bytes = new TextEncoder().encode(csv).buffer;
  if (bytes.byteLength > budgets.maxCsvBytes) fail('RUNNING_CSV', 'resource');
  const name = source.name.replace(/\.pdf$/i, '') + '.running-balance.csv';
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
    date: 1,
    reference: 2,
    description: 3,
    amount: -1,
    debit: 4,
    credit: 5,
    mode: 'split',
    multiplier: 1,
    numberFormat: 'dot',
    dateFormat: 'ymd',
    reportType: 'transactions',
  };
  if (
    nativeSource.sheets.length !== 1 ||
    !same(nativeSource.sheets[0].rows, [
      ['Seq', 'Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'],
      ...review.movements.map((x) => [
        x.seq,
        x.date,
        x.reference,
        x.description,
        x.debit,
        x.credit,
        x.balance,
      ]),
    ])
  )
    fail('RUNNING_DERIVED_REPLAY', 'source-revalidation');
  return { csv, nativeSource, mapping };
}

/** Structural review has no matching, allocation or financial approval API. */
export class RunningBalanceSession {
  #source: SourceFile;
  #context: RunningBalanceContext;
  #generation = 0;
  #selection: RunningSelection | null = null;
  #reviewer: { label: string; rationale: string } | null = null;
  #receipt: RunningReceipt | null = null;
  #owned = new WeakMap<
    object,
    { generation: number; decision: RunningReviewerDecision }
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
    context: RunningBalanceContext,
    options: RunningOptions = {},
  ) {
    const owned = snapshotRunningInputs(source, context, coreOptions(options));
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
    if (generation !== this.#generation)
      fail('RUNNING_GENERATION', 'generation');
  }
  invalidate() {
    this.#invalidate();
    this.#selection = null;
    this.#state = 'empty';
  }
  replaceSource(
    source: SourceFile,
    context: RunningBalanceContext,
    options: RunningOptions = {},
  ) {
    this.invalidate();
    const owned = snapshotRunningInputs(source, context, coreOptions(options));
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
  async inspect(
    options: RunningSessionOptions = {},
  ): Promise<RunningSelection> {
    coreOptions(options);
    this.invalidate();
    const generation = this.#generation;
    coreOptions(options);
    const checkCurrent = () => {
      options.checkCurrent?.();
      this.#check(generation);
    };
    const guarded = { ...options, checkCurrent };
    const owned = snapshotRunningInputs(
      this.#source,
      this.#context,
      coreOptions(guarded),
    );
    if (options.onCheckpoint)
      await options.onCheckpoint({ stage: 'owned-snapshot' });
    checkCurrent();
    const review = await inspectRunningBalance(
      owned.source,
      owned.context,
      coreOptions(guarded),
    );
    checkCurrent();
    const selectionHash = await selectionDigest(review, [], []);
    checkCurrent();
    checkRunningOptions(coreOptions(guarded)).check();
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
    options: RunningOptions = {},
  ): Promise<RunningSelection> {
    coreOptions(options);
    this.#invalidate();
    this.#state = this.#selection?.review.state ?? 'empty';
    const generation = this.#generation;
    const operation = checkRunningOptions(
      coreOptions(options, () => this.#check(generation)),
    );
    if (!this.#selection) fail('RUNNING_SELECTION', 'complete-selection');
    guardRunningPlain(
      this.#selection,
      () => operation.check(),
      runningBudgets(coreOptions(options)),
    );
    const review = structuredClone(this.#selection.review);
    const selectedMovementRows = validList(
      rows,
      review.movements.map((x) => x.originalRow),
      coreOptions(options),
    );
    const selectedProposalIds = validList(
      ids,
      review.proposals.map((x) => x.id),
      coreOptions(options),
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
    input: RunningReviewerDecision,
    options: RunningSessionOptions = {},
  ): Promise<RunningReceipt | null> {
    coreOptions(options);
    this.#invalidate();
    this.#state = this.#selection?.review.state ?? 'empty';
    const generation = this.#generation;
    const operation = checkRunningOptions(
      coreOptions(options, () => this.#check(generation)),
    );
    guardRunningPlain(
      input,
      () => operation.check(),
      runningBudgets(coreOptions(options)),
    );
    if (
      !this.#selection ||
      !input ||
      !['accept', 'reject'].includes(input.decision)
    )
      fail('RUNNING_REVIEWER', 'reviewer-context');
    const decision = structuredClone(input);
    guardRunningPlain(
      this.#selection,
      () => operation.check(),
      runningBudgets(coreOptions(options)),
    );
    const selection = structuredClone(this.#selection);
    if (options.currentSelection !== undefined) {
      guardRunningPlain(
        options.currentSelection,
        () => operation.check(),
        runningBudgets(coreOptions(options)),
      );
      if (!same(options.currentSelection, selection))
        fail('RUNNING_STALE_REVIEW', 'evidence-revalidation');
    }
    const ownedReviewer = reviewer(decision.reviewerLabel, decision.rationale);
    if (
      decision.reviewedSourceHash !== selection.review.sourceHash ||
      decision.reviewedExtractionHash !== selection.review.extractionHash ||
      decision.reviewedContextHash !== selection.review.contextHash ||
      decision.reviewedSelectionHash !== selection.selectionHash
    )
      fail('RUNNING_STALE_REVIEW', 'evidence-revalidation');
    this.#reviewer = ownedReviewer;
    if (decision.decision === 'reject') {
      operation.check();
      this.#state = 'rejected';
      return null;
    }
    complete(selection);
    acknowledgements(decision.acknowledgements);
    const fresh = await inspectRunningBalance(
      this.#source,
      this.#context,
      coreOptions({
        ...options,
        checkCurrent: () => {
          options.checkCurrent?.();
          this.#check(generation);
        },
      }),
    );
    operation.check();
    if (!same(fresh, selection.review))
      fail('RUNNING_STALE_REVIEW', 'evidence-revalidation');
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
    }) as RunningReceipt;
    this.#owned.set(receipt, { generation, decision });
    this.#receipt = receipt;
    this.#state = 'reviewed';
    return receipt;
  }
  async apply(
    receipt: RunningReceipt,
    currentSource: SourceFile,
    currentContext: RunningBalanceContext,
    options: RunningSessionOptions = {},
  ): Promise<RunningArtifact> {
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
      fail('RUNNING_REVIEWER', 'reviewer-context');
    if (
      !ownership ||
      receipt !== this.#receipt ||
      ownership.generation !== this.#generation ||
      this.#state !== 'reviewed' ||
      !this.#selection
    )
      fail('RUNNING_RECEIPT', 'receipt-ownership');
    // Consume before snapshot/hash/native awaits, including failing applications.
    this.#invalidate();
    this.#state = 'review-ready';
    const generation = this.#generation;
    coreOptions(options);
    const checkCurrent = () => {
      options.checkCurrent?.();
      this.#check(generation);
    };
    const guarded = { ...options, checkCurrent };
    const operation = checkRunningOptions(coreOptions(guarded));
    const owned = snapshotRunningInputs(
      currentSource,
      currentContext,
      coreOptions(guarded),
    );
    guardRunningPlain(
      this.#selection,
      () => operation.check(),
      runningBudgets(coreOptions(options)),
    );
    const selection = structuredClone(this.#selection);
    if (options.currentSelection !== undefined) {
      guardRunningPlain(
        options.currentSelection,
        () => operation.check(),
        runningBudgets(coreOptions(options)),
      );
      const supplied = structuredClone(options.currentSelection);
      if (
        !same(supplied.selectedMovementRows, selection.selectedMovementRows) ||
        !same(supplied.selectedProposalIds, selection.selectedProposalIds)
      )
        fail('RUNNING_SELECTION', 'complete-selection');
      if (!same(supplied, selection))
        fail('RUNNING_STALE_REVIEW', 'evidence-revalidation');
    }
    if (
      !same(owned.context, this.#context) ||
      !same(owned.source.pdf?.cuts, this.#source.pdf?.cuts)
    )
      fail('RUNNING_CONTEXT', 'reading-context');
    if (owned.source.name !== this.#source.name)
      fail('RUNNING_STALE_REVIEW', 'source-revalidation');
    complete(selection);
    if (options.onCheckpoint)
      await options.onCheckpoint({ stage: 'owned-snapshot' });
    operation.check();
    const review = await inspectRunningBalance(
      owned.source,
      owned.context,
      coreOptions(guarded),
    );
    operation.check();
    if (!same(review, selection.review))
      fail('RUNNING_STALE_REVIEW', 'source-revalidation');
    const derived = await derivedReading(
      owned.source,
      review,
      coreOptions(guarded),
    );
    operation.check();
    const artifact: RunningArtifact = {
      version: RUNNING_ARTIFACT_VERSION,
      kind: 'explicitly-derived-running-balance-csv',
      financialApproval: false,
      scopeConfirmed: false,
      originalSource: owned.source,
      context: owned.context,
      originalPdf: owned.source.original!.slice(0),
      ...derived,
      provenance: {
        version: RUNNING_ARTIFACT_VERSION,
        financialApproval: false,
        scopeConfirmed: false,
        originalSha256: review.sourceHash,
        derivedSha256: derived.nativeSource.sha256!,
        review,
        inventory: structuredClone(review.rows),
        links: structuredClone(review.movements),
        steps: structuredClone(review.balanceSteps),
        controls: structuredClone(review.controls),
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
    guardArtifactMetadata(artifact, operation, options);
    if (options.onCheckpoint)
      await options.onCheckpoint({ stage: 'before-publish' });
    operation.check();
    this.#state = 'derived';
    return artifact;
  }
}

function ownArtifact(input: RunningArtifact, options: RunningOptions) {
  const operation = checkRunningOptions(coreOptions(options));
  // This check occurs before walking descriptors, cloning, decoding or hashing.
  operation.check();
  guardArtifactMetadata(input, operation, options);
  if (
    !input ||
    input.version !== RUNNING_ARTIFACT_VERSION ||
    input.kind !== 'explicitly-derived-running-balance-csv' ||
    input.financialApproval !== false ||
    input.scopeConfirmed !== false ||
    !(input.originalPdf instanceof ArrayBuffer)
  )
    fail('RUNNING_ARTIFACT', 'source-revalidation');
  const owned = snapshotRunningInputs(
    input.originalSource,
    input.context,
    coreOptions(options),
  );
  if (
    input.originalPdf.byteLength !== owned.source.original!.byteLength ||
    input.originalPdf.byteLength > operation.budgets.maxOriginalBytes
  )
    fail('RUNNING_ARTIFACT', 'source-revalidation');
  return structuredClone(input);
}
function guardArtifactMetadata(
  input: unknown,
  operation: SectionOperation,
  options: RunningOptions = {},
) {
  if (
    !input ||
    typeof input !== 'object' ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    fail('RUNNING_ARTIFACT', 'source-revalidation');
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
    fail('RUNNING_ARTIFACT', 'source-revalidation');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      typeof key !== 'string' ||
      !descriptor ||
      !Object.hasOwn(descriptor, 'value')
    )
      fail('RUNNING_ARTIFACT', 'source-revalidation');
    values[key] = descriptor.value;
  }
  // A whole CSV has a file limit; individual source/evidence cells keep 32767.
  const budgets = runningBudgets(coreOptions(options));
  const csv = values.csv;
  if (
    typeof csv !== 'string' ||
    csv.length > budgets.maxCsvBytes ||
    new TextEncoder().encode(csv).byteLength > budgets.maxCsvBytes
  )
    fail('RUNNING_ARCHIVE', 'resource');
  values.csv = '';
  guardRunningPlain(values, () => operation.check(), budgets);
  countArtifactEvidence(values, budgets.maxEvidenceCells, () =>
    operation.check(),
  );
}
export async function revalidateRunningArtifact(
  input: RunningArtifact,
  options: RunningOptions = {},
): Promise<RunningArtifact> {
  const operation = checkRunningOptions(coreOptions(options));
  const artifact = ownArtifact(input, options);
  const review = await inspectRunningBalance(
    artifact.originalSource,
    artifact.context,
    coreOptions(options),
  );
  operation.check();
  const p = artifact.provenance;
  if (
    !p ||
    p.version !== RUNNING_ARTIFACT_VERSION ||
    p.financialApproval !== false ||
    p.scopeConfirmed !== false ||
    !same(p.review, review) ||
    !same(p.inventory, review.rows) ||
    !same(p.links, review.movements) ||
    !same(p.steps, review.balanceSteps) ||
    !same(p.controls, review.controls) ||
    !same(p.selection.review, review) ||
    p.originalSha256 !== review.sourceHash ||
    (await digestRunning(artifact.originalPdf)) !== review.sourceHash
  )
    fail('RUNNING_STALE_REVIEW', 'evidence-revalidation');
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
    fail('RUNNING_SELECTION', 'complete-selection');
  const decision: RunningReviewerDecision = {
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
    fail('RUNNING_STALE_REVIEW', 'evidence-revalidation');
  const derived = await derivedReading(
    artifact.originalSource,
    review,
    options,
  );
  operation.check();
  const { original: nativeBytes, ...nativeMetadata } = artifact.nativeSource;
  const { original: _derivedBytes, ...derivedMetadata } = derived.nativeSource;
  if (
    artifact.csv !== derived.csv ||
    !same(artifact.mapping, derived.mapping) ||
    p.derivedSha256 !== derived.nativeSource.sha256 ||
    !same(nativeMetadata, derivedMetadata) ||
    !(nativeBytes instanceof ArrayBuffer) ||
    (await digestRunning(nativeBytes)) !== derived.nativeSource.sha256
  )
    fail('RUNNING_DERIVED_REPLAY', 'source-revalidation');
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
    fail('RUNNING_ARCHIVE', 'source-revalidation');
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0)).buffer;
  if (bytes.byteLength > limit) fail('RUNNING_ARCHIVE', 'source-revalidation');
  return bytes;
}
export async function saveRunningArtifact(
  input: RunningArtifact,
  options: RunningOptions = {},
): Promise<ArrayBuffer> {
  const operation = checkRunningOptions(coreOptions(options));
  const artifact = await revalidateRunningArtifact(input, options);
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
    version: RUNNING_ARTIFACT_VERSION,
    artifact: metadata,
    sourceMetadata,
    csvMetadata,
    pdf: encode(pdf!),
    derived: encode(csv!),
  });
  if (text.length > 64 * 1024 * 1024) fail('RUNNING_ARCHIVE', 'resource');
  operation.check();
  return new TextEncoder().encode(text).buffer;
}
export async function restoreRunningArtifact(
  bytes: ArrayBuffer,
  options: RunningOptions = {},
): Promise<RunningArtifact> {
  const operation = checkRunningOptions(coreOptions(options));
  operation.check();
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > 64 * 1024 * 1024)
    fail('RUNNING_ARCHIVE', 'resource');
  const copy = bytes.slice(0);
  const payload = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(copy),
  ) as {
    version: string;
    artifact: Omit<
      RunningArtifact,
      'originalPdf' | 'originalSource' | 'nativeSource'
    >;
    sourceMetadata: Omit<SourceFile, 'original'>;
    csvMetadata: Omit<SourceFile, 'original'>;
    pdf: string;
    derived: string;
  };
  if (
    !payload ||
    payload.version !== RUNNING_ARTIFACT_VERSION ||
    !same(Object.keys(payload).sort(), [
      'artifact',
      'csvMetadata',
      'derived',
      'pdf',
      'sourceMetadata',
      'version',
    ])
  )
    fail('RUNNING_ARCHIVE', 'source-revalidation');
  const pdf = decode(payload.pdf, operation.budgets.maxOriginalBytes);
  const csv = decode(
    payload.derived,
    runningBudgets(coreOptions(options)).maxCsvBytes,
  );
  guardArtifactMetadata(payload.artifact, operation, options);
  guardRunningPlain(
    payload.sourceMetadata,
    () => operation.check(),
    runningBudgets(coreOptions(options)),
  );
  guardRunningPlain(
    payload.csvMetadata,
    () => operation.check(),
    runningBudgets(coreOptions(options)),
  );
  const artifact: RunningArtifact = {
    ...payload.artifact,
    originalPdf: pdf,
    originalSource: { ...payload.sourceMetadata, original: pdf.slice(0) },
    nativeSource: { ...payload.csvMetadata, original: csv },
  };
  return revalidateRunningArtifact(artifact, options);
}

/** Every stored evidence occurrence consumes budget, including repeated aliases. */
function countArtifactEvidence(
  value: unknown,
  limit: number,
  check: () => void,
) {
  let occurrences = 0;
  const visit = (current: unknown): void => {
    if (
      !current ||
      typeof current !== 'object' ||
      current instanceof ArrayBuffer
    )
      return;
    if (
      Object.hasOwn(current, 'spanStartInclusive') &&
      Object.hasOwn(current, 'sourceHash') &&
      ++occurrences > limit
    )
      throw new SectionOperationError('resource-limit');
    if (occurrences % 256 === 0) check();
    for (const key of Object.keys(current))
      visit(Object.getOwnPropertyDescriptor(current, key)!.value);
  };
  visit(value);
  check();
}

export async function exportRunningWorkbook(
  input: RunningArtifact,
  options: RunningOptions = {},
): Promise<ArrayBuffer> {
  const operation = checkRunningOptions(coreOptions(options));
  const budgets = runningBudgets(coreOptions(options));
  const artifact = await revalidateRunningArtifact(input, options);
  operation.check();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tarasuf';
  const add = (name: string, rows: (string | number | null)[][]) => {
    const sheet = workbook.addWorksheet(name);
    for (let i = 0; i < rows.length; i++) {
      if (i % 256 === 0) operation.check();
      const values = rows[i].map((value) =>
        value === null ? '' : String(value),
      );
      for (const value of values) {
        if (value.length > budgets.maxCellTextUnits)
          fail('RUNNING_EXPORT_CELL', 'resource');
        validateExportText(value, 'RUNNING_EXPORT_CELL');
      }
      sheet.addRow(values.map(excelExportText)).eachCell((cell) => {
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
    ['Seq', 'Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'],
    ...review.movements.map((m) => [
      m.seq,
      m.date,
      m.reference,
      m.description,
      m.debit,
      m.credit,
      m.balance,
    ]),
  ]);
  add('OriginalInventory', [
    [
      'OriginalRow',
      'Page',
      'Kind',
      'DerivedRow',
      'Seq',
      'Date',
      'Reference',
      'Description',
      'Debit',
      'Credit',
      'Balance',
    ],
    ...review.rows.map((row) => [
      row.originalRow,
      row.page,
      row.kind,
      row.derivedRow,
      ...row.values,
    ]),
  ]);
  const proofRows: (string | number | null)[][] = [
    [
      'Owner',
      'Role',
      'SourceHash',
      'ExtractionHash',
      'ExtractionRevision',
      'Sheet',
      'Row',
      'Page',
      'Column',
      'Literal',
      'CellText',
      'SpanStartInclusive',
      'SpanEndExclusive',
      'SpanText',
    ],
  ];
  const proof = (
    owner: string | number,
    role: string,
    e: RunningCellEvidence | null,
  ) => {
    if (e)
      proofRows.push([
        owner,
        role,
        e.sourceHash,
        e.extractionHash,
        e.extractionRevision,
        e.sheet,
        e.row,
        e.page,
        e.column,
        e.literal,
        e.cellText,
        e.spanStartInclusive,
        e.spanEndExclusive,
        e.spanText,
      ]);
  };
  for (const m of review.movements) {
    proof(m.originalRow, 'seq', m.seqEvidence);
    proof(m.originalRow, 'date', m.dateEvidence);
    proof(m.originalRow, 'reference', m.referenceEvidence);
    proof(m.originalRow, 'description', m.descriptionEvidence);
    proof(m.originalRow, 'debit', m.debitEvidence);
    proof(m.originalRow, 'credit', m.creditEvidence);
    proof(m.originalRow, 'balance', m.balanceEvidence);
    proof(m.originalRow, 'parent', m.parentEvidence);
    for (const e of m.continuationEvidence)
      proof(m.originalRow, 'continuation', e);
  }
  for (const p of review.proposals) {
    proof(p.id, 'proposal-target', p.evidence.target);
    proof(p.id, 'proposal-parent', p.evidence.parent);
    for (const e of p.evidence.continuations)
      proof(p.id, 'proposal-continuation', e);
    for (const band of p.evidence.headers)
      for (const e of band) proof(p.id, 'proposal-header', e);
  }
  for (const band of review.headerEvidence)
    for (const e of band) proof('', 'header', e);
  for (const e of review.metadataEvidence) proof('', 'metadata', e);
  for (const e of review.declaredScope?.evidence ?? [])
    proof('', 'declared-scope', e);
  for (const s of review.balanceSteps) {
    proof(s.originalRow, 'previous-provided-balance', s.previousEvidence);
    proof(s.originalRow, 'step-debit', s.debitEvidence);
    proof(s.originalRow, 'step-credit', s.creditEvidence);
    proof(s.originalRow, 'next-provided-balance', s.nextEvidence);
  }
  const memberRows: (string | number | null)[][] = [
    [
      'ControlOriginalRow',
      'Role',
      'MemberIndex',
      'Sheet',
      'Row',
      'Page',
      'Column',
      'Literal',
      'CellText',
      'SpanStartInclusive',
      'SpanEndExclusive',
      'SpanText',
    ],
  ];
  for (const c of review.controls) {
    for (const e of c.evidence) proof(c.originalRow, `control:${c.role}`, e);
    c.members.forEach((e, i) => {
      proof(c.originalRow, `control-member:${c.role}:${i + 1}`, e);
      memberRows.push([
        c.originalRow,
        c.role,
        i + 1,
        e.sheet,
        e.row,
        e.page,
        e.column,
        e.literal,
        e.cellText,
        e.spanStartInclusive,
        e.spanEndExclusive,
        e.spanText,
      ]);
    });
  }
  add('SourceCellEvidence', proofRows);
  add('BalanceSteps', [
    [
      'OriginalRow',
      'Page',
      'PreviousProvidedMinor',
      'DebitProvidedMinor',
      'CreditProvidedMinor',
      'NextProvidedMinor',
      'ComputedMinor',
      'DifferenceMinor',
      'PreviousProvidedRow',
      'NextProvidedRow',
    ],
    ...review.balanceSteps.map((s) => [
      s.originalRow,
      s.page,
      s.previousProvidedMinor,
      s.debitProvidedMinor,
      s.creditProvidedMinor,
      s.nextProvidedMinor,
      s.computedMinor,
      s.differenceMinor,
      s.previousEvidence?.row ?? '',
      s.nextEvidence.row,
    ]),
  ]);
  add('Controls', [
    [
      'OriginalRow',
      'Page',
      'Role',
      'ProvidedMinor',
      'ExpectedMinor',
      'DifferenceMinor',
      'DebitProvidedMinor',
      'CreditProvidedMinor',
      'DebitExpectedMinor',
      'CreditExpectedMinor',
      'DebitDifferenceMinor',
      'CreditDifferenceMinor',
      'MemberCount',
    ],
    ...review.controls.map((c) => [
      c.originalRow,
      c.page,
      c.role,
      c.providedMinor,
      c.expectedMinor,
      c.differenceMinor,
      c.debitProvidedMinor ?? '',
      c.creditProvidedMinor ?? '',
      c.debitExpectedMinor ?? '',
      c.creditExpectedMinor ?? '',
      c.debitDifferenceMinor ?? '',
      c.creditDifferenceMinor ?? '',
      c.members.length,
    ]),
  ]);
  add('ControlMembers', memberRows);
  add('ReviewHistory', [
    ['Key', 'Value'],
    ['Version', RUNNING_ARTIFACT_VERSION],
    ['FinancialApproval', 'false'],
    ['ScopeConfirmed', 'false'],
    ['OriginalSha256', artifact.provenance.originalSha256],
    ['DerivedSha256', artifact.provenance.derivedSha256],
    ['OpeningMinor', review.openingMinor],
    ['ClosingMinor', review.closingMinor],
    ['GrossDebitMinor', review.grossDebitMinor],
    ['GrossCreditMinor', review.grossCreditMinor],
    ['NetMinor', review.netMinor],
    ['Reviewer', artifact.provenance.reviewer.label],
    ['Rationale', artifact.provenance.reviewer.rationale],
    ['Context', JSON.stringify(artifact.context)],
    [
      'Acknowledgements',
      JSON.stringify(artifact.provenance.reviewer.acknowledgements),
    ],
    [
      'HistoricalReceipt',
      JSON.stringify(artifact.provenance.historicalReceipt),
    ],
  ]);
  const encoded = encode(artifact.originalPdf);
  const chunkSize = Math.min(30000, budgets.maxCellTextUnits);
  const pdfRows: (string | number | null)[][] = [['Chunk', 'Base64Pdf']];
  for (let i = 0; i < encoded.length; i += chunkSize)
    pdfRows.push([i / chunkSize + 1, encoded.slice(i, i + chunkSize)]);
  add('OriginalPdf', pdfRows);
  operation.check();
  const buffer = await workbook.xlsx.writeBuffer();
  operation.check();
  return new Uint8Array(buffer).slice().buffer;
}
