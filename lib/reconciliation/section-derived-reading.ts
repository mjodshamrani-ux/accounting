import { parseDate, parseMoney } from './core.ts';
import { readFile } from './io.ts';
import { prepareVerifiedSources } from './source-preparation.ts';
import { suggestFormats } from './format-inference.ts';
import { formatChoice } from './input-readiness.ts';
import {
  qualifiedSectionCurrency,
  SECTION_CURRENCY_POLICY,
  SECTION_FORMAT_CHOICE_KEYS,
  validateSectionNumberChoice,
  type SectionCurrencyContext,
} from './section-currency-context.ts';
import {
  defaultMapping,
  type Mapping,
  type Scope,
  type SourceFile,
  type FormatChoice,
} from './types.ts';
import {
  inspectSectionContinuation,
  revalidateSectionContinuation,
  SectionOperation,
  rawSignedSectionHeaderRows,
  type SectionOperationOptions,
  type SectionCellEvidence,
  type SectionContinuationReview,
  type SectionReferenceProposal,
} from './section-continuation.ts';

export const SECTION_DERIVED_VERSION = 'P4_SECTION_DERIVED_V1';
export type SectionDerivedAcknowledgements = {
  originalRowsReviewed: true;
  referenceRolesReviewed: true;
  signedAmountsPreserved: true;
  derivedSourceUnderstood: true;
  originalDotInterpretationReviewed?: true;
};
export type SectionDerivedReviewerDecision = {
  decision: 'accept' | 'reject';
  reviewerLabel: string;
  rationale: string;
  reviewedSourceHash: string;
  reviewedExtractionHash: string;
  reviewedExtractionRevision: string;
  reviewedSelectionHash: string;
  acknowledgements: SectionDerivedAcknowledgements;
};
export type SectionDerivedSelection = {
  review: SectionContinuationReview;
  selectedProposalIds: string[];
  selectionHash: string;
};
declare const receiptBrand: unique symbol;
/** The runtime object must be issued by this live session. Copying, deserializing
 * or casting these audit fields never creates an owned receipt. */
export type SectionDerivedReceipt = Readonly<{
  id: string;
  sourceHash: string;
  extractionHash: string;
  extractionRevision: string;
  selectionHash: string;
  reviewerHash: string;
  authority: 'explicit-interpretation-review';
}> & { readonly [receiptBrand]: true };
export type SectionDerivedProvenance = {
  version: typeof SECTION_DERIVED_VERSION;
  kind: 'explicitly-derived-section-csv';
  financialApproval: false;
  scopeConfirmed?: false;
  originalName: string;
  originalSha256: string;
  derivedName: string;
  derivedSha256: string;
  extractionRevision: string;
  extractionHash: string;
  selectionHash: string;
  selectedProposalIds: string[];
  originalReading: Mapping;
  derivedReading: Mapping;
  decimals: number;
  currencyContext?: SectionCurrencyContext;
  originalNumberInterpretation?: FormatChoice;
  derivedNumberInterpretation?: FormatChoice;
  /** Original raw signed-header cells, independent of reference origin. */
  headerBands?: SectionCellEvidence[][];
  reviewer: {
    label: string;
    rationale: string;
    acknowledgements: SectionDerivedAcknowledgements;
    reviewerHash: string;
  };
  inventory: {
    originalRow: number;
    page: number;
    values: string[];
    kind: SectionContinuationReview['rows'][number]['kind'];
    derivedRow: number | null;
  }[];
  links: {
    originalRow: number;
    page: number;
    derivedRow: number;
    referenceOrigin: 'explicit-source-cell' | 'accepted-section-proposal';
    reference: string;
    referenceEvidence: SectionCellEvidence;
    proposal?: SectionReferenceProposal;
    dateEvidence: SectionCellEvidence;
    descriptionEvidence: SectionCellEvidence;
    amountEvidence: SectionCellEvidence;
  }[];
};
export type SectionDerivedReadingArtifact = {
  kind: 'explicitly-derived-section-csv';
  financialApproval: false;
  /** This reader owns the derived CSV bytes. Its original is the CSV, while the
   * wrapper's originalPdf preserves the independently hashed source PDF. */
  nativeSource: SourceFile;
  mapping: Mapping;
  csv: string;
  originalPdf: ArrayBuffer;
  provenance: SectionDerivedProvenance;
  receipt: SectionDerivedReceipt;
};
type ReceiptOwnership = {
  generation: number;
  serialized: string;
  decision: SectionDerivedReviewerDecision;
};
async function digest(value: string | ArrayBuffer) {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
function boundedReading(mapping: Mapping, qualified = false) {
  if (
    mapping.reportType !== 'transactions' ||
    mapping.multiplier !== 1 ||
    mapping.currencyColumn !== -1 ||
    mapping.debit !== -1 ||
    mapping.credit !== -1 ||
    mapping.opening.trim() ||
    mapping.closing.trim() ||
    mapping.periodStart.trim() ||
    mapping.directionEvidence !== undefined ||
    (!qualified && mapping.formatChoice !== undefined) ||
    (qualified &&
      (mapping.dateFormat !== 'ymd' ||
        mapping.numberFormat !== 'dot' ||
        Object.keys(mapping.excluded).length > 0))
  )
    throw new Error(
      'Section derivation supports signed transactions without currency, balance, period or direction overrides.',
    );
}
function boundedSourceContext(source: SourceFile, reading: Mapping) {
  const sheet = source.sheets[reading.sheet];
  const header = sheet.rows[reading.header];
  const rawHeaderRows = rawSignedSectionHeaderRows(sheet, reading);
  const currency = qualifiedSectionCurrency(sheet, reading);
  if (
    currency &&
    (!source.pdf ||
      source.pdf.autoColumns ||
      source.pdf.cuts.length !== 3 ||
      source.pdf.cuts.some((cut, index) => cut !== [25, 45, 70][index]))
  )
    throw new Error(
      'Unsupported qualified currency extraction cuts; the finite family requires original declared cuts.',
    );
  // Bare finite source roles: do not erase a currency-qualified amount header,
  // auxiliary monetary column or unrecognized context into the canonical CSV.
  if (
    sheet.rows.some((row) => row.length !== 4) ||
    !/^(?:Date|Transaction date|Posting date|Invoice date|التاريخ|تاريخ الحركة|تاريخ الفاتورة)$/i.test(
      header[reading.date].trim(),
    ) ||
    !/^(?:Reference|المرجع)$/i.test(header[reading.reference].trim()) ||
    !/^(?:Description|Details|الوصف|البيان)$/i.test(
      header[reading.description].trim(),
    ) ||
    (!currency &&
      !rawHeaderRows &&
      !/^(?:Amount|Signed amount|المبلغ)$/i.test(
        header[reading.amount].trim(),
      )) ||
    Object.values(sheet.rowIssues ?? {}).some((issues) => issues.length) ||
    Object.values(sheet.cellIssues ?? {}).some((issues) => issues.length) ||
    sheet.hiddenRows.length ||
    sheet.formulaRows.length ||
    Object.keys(sheet.formulaCells ?? {}).length
  )
    throw new Error(
      'Unsupported original header, monetary context or source issues prevent section derivation.',
    );
  if (
    currency &&
    sheet.rows.some(
      (row) =>
        (row.slice(0, 3).every((value, col) => value === header[col]) &&
          row[3] !== header[3]) ||
        row[0] === 'Currency',
    )
  )
    throw new Error(
      'Conflicting original qualified currency context prevents section derivation.',
    );
  return currency;
}
function guardedNumberChoice(operation: SectionOperation, reading: Mapping) {
  if (reading.formatChoice !== undefined) {
    operation.preflightMetadata(reading.formatChoice, ['numberFormat']);
    if (reading.formatChoice.numberFormat !== undefined)
      operation.preflightMetadata(
        reading.formatChoice.numberFormat,
        SECTION_FORMAT_CHOICE_KEYS,
      );
  }
}
function qualifiedPrecision(context: SectionCurrencyContext, decimals: number) {
  if (
    context.decimals !== decimals ||
    SECTION_CURRENCY_POLICY[context.code] !== decimals
  )
    throw new Error(
      'The selected exponent does not match the finite qualified currency precision policy.',
    );
}
function guardedCurrencyContext(
  operation: SectionOperation,
  context: SectionCurrencyContext,
) {
  operation.preflightMetadata(context, [
    'code',
    'decimals',
    'precisionOrigin',
    'headerCells',
  ]);
  for (const cell of context.headerCells)
    operation.preflightMetadata(cell, [
      'sourceHash',
      'extractionHash',
      'extractionRevision',
      'sheet',
      'row',
      'page',
      'column',
      'literal',
    ]);
}
function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
function serializeCsv(rows: string[][]) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function ownedReviewer(label: string, rationale: string) {
  if (
    typeof label !== 'string' ||
    typeof rationale !== 'string' ||
    !label.trim() ||
    !rationale.trim() ||
    label.length > 200 ||
    rationale.length > 4000
  )
    throw new Error('An explicit reviewer label and rationale are required.');
  return { label, rationale };
}

/** Explicit review changes an interpretation only. There is no comparison or
 * financial approval API here, and no proposal can mint a receipt on its own. */
export class SectionDerivedReadingSession {
  #source: SourceFile;
  #reading: Mapping;
  #revision: string;
  #decimals: number;
  #generation = 0;
  #selection: SectionDerivedSelection | null = null;
  #reviewer: { label: string; rationale: string } | null = null;
  #receipt: SectionDerivedReceipt | null = null;
  #owned = new WeakMap<object, ReceiptOwnership>();
  #state: 'empty' | 'review-ready' | 'reviewed' | 'rejected' | 'derived' =
    'empty';
  constructor(
    source: SourceFile,
    reading: Mapping,
    extractionRevision: string,
    decimals = 2,
  ) {
    const operation = new SectionOperation();
    operation.preflight(source);
    operation.preflightReading(reading);
    this.#source = structuredClone(source);
    this.#reading = structuredClone(reading);
    this.#revision = extractionRevision;
    this.#decimals = decimals;
  }
  get state() {
    return this.#state;
  }
  get selection(): SectionDerivedSelection | null {
    return this.#selection ? structuredClone(this.#selection) : null;
  }
  #invalidate() {
    this.#generation++;
    this.#receipt = null;
  }
  #assertCurrent(generation: number) {
    if (generation !== this.#generation)
      throw new Error(
        'Section derivation changed while the operation was pending.',
      );
  }
  replaceSource(
    source: SourceFile,
    reading: Mapping,
    extractionRevision: string,
    decimals = 2,
  ) {
    this.#invalidate();
    this.#selection = null;
    this.#state = 'empty';
    const operation = new SectionOperation();
    operation.preflight(source);
    operation.preflightReading(reading);
    this.#source = structuredClone(source);
    this.#reading = structuredClone(reading);
    this.#revision = extractionRevision;
    this.#decimals = decimals;
    this.#selection = null;
    this.#state = 'empty';
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
    this.#reviewer = ownedReviewer(label, rationale);
  }
  async inspect(
    options: SectionOperationOptions = {},
  ): Promise<SectionDerivedSelection> {
    this.#invalidate();
    this.#selection = null;
    this.#state = 'empty';
    const generation = this.#generation;
    const operation = new SectionOperation(options, () =>
      this.#assertCurrent(generation),
    );
    operation.preflight(this.#source);
    operation.preflightReading(this.#reading);
    const source = structuredClone(this.#source);
    const reading = structuredClone(this.#reading);
    boundedReading(
      reading,
      !!qualifiedSectionCurrency(source.sheets[reading.sheet], reading),
    );
    const review = await inspectSectionContinuation(
      source,
      reading,
      this.#revision,
      this.#decimals,
      operation.continuationOptions(),
    );
    this.#assertCurrent(generation);
    boundedSourceContext(source, reading);
    const selectionHash = await digest(
      JSON.stringify({
        version: SECTION_DERIVED_VERSION,
        sourceHash: review.sourceHash,
        originalName: source.name,
        extractionHash: review.extractionHash,
        extractionRevision: review.extractionRevision,
        selectedProposalIds: [],
      }),
    );
    this.#assertCurrent(generation);
    operation.check();
    this.#selection = { review, selectedProposalIds: [], selectionHash };
    this.#state = 'review-ready';
    return structuredClone(this.#selection);
  }
  async selectProposalIds(
    ids: readonly string[],
  ): Promise<SectionDerivedSelection> {
    if (!this.#selection)
      throw new Error(
        'Inspect the current original before selecting section proposals.',
      );
    this.#invalidate();
    this.#state = 'review-ready';
    if (
      !Array.isArray(ids) ||
      ids.length > this.#selection.review.proposals.length ||
      ids.some((id) => typeof id !== 'string') ||
      new Set(ids).size !== ids.length
    )
      throw new Error('Section proposal selection is invalid or duplicated.');
    const supplied = [...ids];
    const suppliedSet = new Set(supplied);
    const review = structuredClone(this.#selection.review);
    const currentIds = new Set(review.proposals.map((p) => p.id));
    if (supplied.some((id) => !currentIds.has(id)))
      throw new Error(
        'A selected section proposal is not part of the current extraction.',
      );
    const generation = this.#generation;
    const selectedProposalIds = review.proposals
      .filter((p) => suppliedSet.has(p.id))
      .map((p) => p.id);
    const selectionHash = await digest(
      JSON.stringify({
        version: SECTION_DERIVED_VERSION,
        sourceHash: review.sourceHash,
        originalName: this.#source.name,
        extractionHash: review.extractionHash,
        extractionRevision: review.extractionRevision,
        selectedProposalIds,
      }),
    );
    this.#assertCurrent(generation);
    this.#selection = { review, selectedProposalIds, selectionHash };
    return structuredClone(this.#selection);
  }
  async recordReviewerDecision(
    input: SectionDerivedReviewerDecision,
  ): Promise<SectionDerivedReceipt | null> {
    this.#invalidate();
    this.#state = this.#selection ? 'review-ready' : 'empty';
    if (!this.#selection || !input || typeof input !== 'object')
      throw new Error(
        'A separate explicit current review decision is required.',
      );
    const operation = new SectionOperation();
    operation.preflightMetadata(input, [
      'decision',
      'reviewerLabel',
      'rationale',
      'reviewedSourceHash',
      'reviewedExtractionHash',
      'reviewedExtractionRevision',
      'reviewedSelectionHash',
      'acknowledgements',
    ]);
    ownedReviewer(input.reviewerLabel, input.rationale);
    if (input.acknowledgements)
      operation.preflightMetadata(input.acknowledgements, [
        'originalRowsReviewed',
        'referenceRolesReviewed',
        'signedAmountsPreserved',
        'derivedSourceUnderstood',
        ...(this.#selection.review.currencyContext
          ? ['originalDotInterpretationReviewed']
          : []),
      ]);
    const decision = structuredClone(input);
    const selection = this.#selection;
    if (
      !['accept', 'reject'].includes(decision.decision) ||
      decision.reviewedSourceHash !== selection.review.sourceHash ||
      decision.reviewedExtractionHash !== selection.review.extractionHash ||
      decision.reviewedExtractionRevision !==
        selection.review.extractionRevision ||
      decision.reviewedSelectionHash !== selection.selectionHash
    )
      throw new Error(
        'The review decision is not bound to the current source and selection.',
      );
    const reviewer = ownedReviewer(decision.reviewerLabel, decision.rationale);
    this.updateReviewer(reviewer.label, reviewer.rationale);
    const generation = this.#generation;
    if (decision.decision === 'reject') {
      this.#state = 'rejected';
      return null;
    }
    const acknowledgements = decision.acknowledgements;
    if (
      !acknowledgements ||
      acknowledgements.originalRowsReviewed !== true ||
      acknowledgements.referenceRolesReviewed !== true ||
      acknowledgements.signedAmountsPreserved !== true ||
      acknowledgements.derivedSourceUnderstood !== true
    )
      throw new Error(
        'Explicit original, role, signed-amount and derived-source acknowledgements are required.',
      );
    const currencyContext = selection.review.currencyContext;
    if (currencyContext) {
      guardedCurrencyContext(operation, currencyContext);
      qualifiedPrecision(currencyContext, this.#decimals);
      guardedNumberChoice(operation, this.#reading);
      const replayOperation = new SectionOperation({}, () =>
        this.#assertCurrent(generation),
      );
      await revalidateSectionContinuation(
        selection.review,
        this.#source,
        this.#reading,
        this.#revision,
        this.#decimals,
        replayOperation.continuationOptions(),
      );
      replayOperation.check();
      boundedSourceContext(this.#source, this.#reading);
      const interpretation = validateSectionNumberChoice(
        this.#source,
        this.#reading,
        currencyContext,
      );
      if (
        interpretation.ambiguous &&
        acknowledgements.originalDotInterpretationReviewed !== true
      )
        throw new Error(
          'Explicit original dot interpretation review acknowledgement is required.',
        );
    }
    const reviewerHash = await digest(
      JSON.stringify({
        reviewer,
        acknowledgements,
        selectionHash: selection.selectionHash,
        decimals: this.#decimals,
        reading: this.#reading,
      }),
    );
    this.#assertCurrent(generation);
    const receipt = Object.freeze({
      id: crypto.randomUUID(),
      sourceHash: selection.review.sourceHash,
      extractionHash: selection.review.extractionHash,
      extractionRevision: selection.review.extractionRevision,
      selectionHash: selection.selectionHash,
      reviewerHash,
      authority: 'explicit-interpretation-review' as const,
    }) as SectionDerivedReceipt;
    this.#owned.set(receipt, {
      generation,
      serialized: JSON.stringify(receipt),
      decision,
    });
    this.#receipt = receipt;
    this.#state = 'reviewed';
    return receipt;
  }
  async apply(
    receipt: SectionDerivedReceipt,
    currentSource: SourceFile,
    currentReading: Mapping,
    currentExtractionRevision: string,
    currentDecimals = 2,
    options: SectionOperationOptions = {},
  ): Promise<SectionDerivedReadingArtifact> {
    const ownership =
      receipt && typeof receipt === 'object'
        ? this.#owned.get(receipt)
        : undefined;
    if (
      !ownership ||
      receipt !== this.#receipt ||
      ownership.generation !== this.#generation ||
      JSON.stringify(receipt) !== ownership.serialized ||
      this.#state !== 'reviewed' ||
      !this.#selection
    )
      throw new Error(
        'Apply requires the separate current reviewer receipt owned by this live session.',
      );
    // Consume before the first await: two concurrent applies cannot share a
    // receipt, and a failed/stale application requires a separate new review.
    this.#invalidate();
    this.#state = 'review-ready';
    const generation = this.#generation;
    const operation = new SectionOperation(options, () =>
      this.#assertCurrent(generation),
    );
    operation.preflight(currentSource);
    operation.preflightReading(currentReading);
    const source = structuredClone(currentSource);
    const reading = structuredClone(currentReading);
    const selection = structuredClone(this.#selection);
    boundedReading(
      reading,
      !!qualifiedSectionCurrency(source.sheets[reading.sheet], reading),
    );
    if (
      currentExtractionRevision !== this.#revision ||
      currentDecimals !== this.#decimals ||
      source.name !== this.#source.name ||
      JSON.stringify(reading) !== JSON.stringify(this.#reading)
    )
      throw new Error(
        'The current section reading, precision or extraction revision has changed.',
      );
    const review = await revalidateSectionContinuation(
      selection.review,
      source,
      reading,
      currentExtractionRevision,
      currentDecimals,
      operation.continuationOptions(),
    );
    this.#assertCurrent(generation);
    boundedSourceContext(source, reading);
    const currencyContext = review.currencyContext;
    let originalNumberInterpretation: FormatChoice | undefined;
    if (currencyContext) {
      guardedCurrencyContext(operation, currencyContext);
      qualifiedPrecision(currencyContext, currentDecimals);
      guardedNumberChoice(operation, reading);
      const interpretation = validateSectionNumberChoice(
        source,
        reading,
        currencyContext,
      );
      if (
        interpretation.ambiguous &&
        ownership.decision.acknowledgements
          .originalDotInterpretationReviewed !== true
      )
        throw new Error(
          'The owned original dot interpretation acknowledgement is missing.',
        );
      originalNumberInterpretation = interpretation.choice;
    }
    if (!review.sourceVerified || !(source.original instanceof ArrayBuffer))
      throw new Error('A fresh original native PDF verification is required.');
    const sheet = source.sheets[reading.sheet];
    const cite = (rn: number, col: number): SectionCellEvidence => ({
      sourceHash: review.sourceHash,
      extractionHash: review.extractionHash,
      extractionRevision: review.extractionRevision,
      sheet: reading.sheet + 1,
      row: rn,
      page: sheet.rowPages![String(rn)],
      column: col + 1,
      literal: sheet.rows[rn - 1][col],
    });
    const selectedIds = new Set(selection.selectedProposalIds);
    const selected = review.proposals.filter((p) => selectedIds.has(p.id));
    const referenceFor = new Map(selected.map((p) => [p.target.row, p]));
    for (const evidence of [
      ...(currencyContext?.headerCells ?? []),
      ...(review.headerBands?.flat() ?? []),
      ...selected.flatMap((proposal) => [
        proposal.target,
        proposal.parent,
        ...proposal.continuation,
        ...proposal.headers.flat(),
        ...(proposal.parentSpan ?? []),
        ...(proposal.continuationSpans?.flat() ?? []),
        ...(proposal.headerBands?.flat() ?? []),
      ]),
    ]) {
      const actual = cite(evidence.row, evidence.column - 1);
      if (JSON.stringify(actual) !== JSON.stringify(evidence))
        throw new Error(
          'A selected section role or physical citation changed.',
        );
    }
    // Only a missing-parent question on a complete explicitly referenced source
    // movement can be resolved by its own native cell. All other questions stop.
    if (
      review.questions.some(
        (q) =>
          q.code !== 'missing-parent' ||
          q.rows.some((rn) => !sheet.rows[rn - 1][reading.reference].trim()),
      )
    )
      throw new Error(
        'Unresolved source boundaries or financial rows prevent a derived reading.',
      );
    const links: SectionDerivedProvenance['links'] = [];
    const csvRows = [
      currencyContext
        ? [...sheet.rows[reading.header]]
        : ['Date', 'Reference', 'Description', 'Amount'],
    ];
    const expected: {
      date: string;
      reference: string;
      amountMinor: number;
      originalAmount: string;
    }[] = [];
    for (const row of review.rows) {
      await operation.checkpoint(row.row, review.rows.length, 'derived');
      if (row.kind === 'boundary')
        throw new Error(
          'An unknown original row cannot be omitted from a financial derivation.',
        );
      if (row.kind !== 'movement') continue;
      const proposal = referenceFor.get(row.row);
      const explicitReference = row.values[reading.reference];
      const reference = explicitReference.trim()
        ? explicitReference
        : proposal?.reference;
      if (!reference)
        throw new Error(
          'Every original movement needs an explicit reference or a selected accepted section proposal.',
        );
      const date = row.values[reading.date];
      const amount = row.values[reading.amount];
      const description = row.values[reading.description];
      const issues =
        sheet.rowIssues?.[String(row.row)]?.length ||
        sheet.formulaRows.includes(row.row) ||
        sheet.hiddenRows.includes(row.row) ||
        row.values.some(
          (_, col) =>
            sheet.cellIssues?.[`${row.row}:${col + 1}`]?.length ||
            sheet.formulaCells?.[`${row.row}:${col + 1}`],
        );
      if (issues)
        throw new Error(
          'An issue-bearing original movement cannot be omitted or transformed.',
        );
      let normalizedDate: string, amountMinor: number;
      try {
        normalizedDate = parseDate(date, reading.dateFormat);
        amountMinor = parseMoney(amount, reading.numberFormat, currentDecimals);
      } catch {
        throw new Error(
          'A corrupt original date or signed amount prevents the derived reading.',
        );
      }
      const derivedRow = csvRows.length + 1;
      csvRows.push([date, reference, description, amount]);
      links.push({
        originalRow: row.row,
        page: row.page,
        derivedRow,
        referenceOrigin: explicitReference.trim()
          ? 'explicit-source-cell'
          : 'accepted-section-proposal',
        reference,
        referenceEvidence: explicitReference.trim()
          ? cite(row.row, reading.reference)
          : proposal!.parent,
        ...(proposal ? { proposal } : {}),
        dateEvidence: cite(row.row, reading.date),
        descriptionEvidence: cite(row.row, reading.description),
        amountEvidence: cite(row.row, reading.amount),
      });
      expected.push({
        date: normalizedDate,
        reference: reference.trim(),
        amountMinor,
        originalAmount: amount.trim(),
      });
    }
    if (!links.length)
      throw new Error(
        'A derived reading must contain at least one justified movement.',
      );
    const csv = serializeCsv(csvRows);
    const name = source.name.replace(/\.pdf$/i, '') + '.section-derived.csv';
    const bytes = new TextEncoder().encode(csv).buffer;
    const nativeSource = await readFile(name, bytes);
    operation.check();
    this.#assertCurrent(generation);
    const freshCsv = await readFile(name, nativeSource.original!);
    operation.check();
    this.#assertCurrent(generation);
    if (
      nativeSource.sha256 !== (await digest(bytes)) ||
      JSON.stringify(freshCsv.sheets) !== JSON.stringify(nativeSource.sheets)
    )
      throw new Error('The derived native CSV did not replay exactly.');
    this.#assertCurrent(generation);
    const mapping: Mapping = {
      ...defaultMapping(),
      date: 0,
      reference: 1,
      description: 2,
      amount: 3,
      dateFormat: reading.dateFormat,
      numberFormat: reading.numberFormat,
    };
    let derivedNumberInterpretation: FormatChoice | undefined;
    if (currencyContext && originalNumberInterpretation) {
      const assessment = suggestFormats(
        freshCsv,
        mapping,
        currentDecimals,
      ).numberFormat;
      mapping.formatChoice = {
        numberFormat: formatChoice(
          freshCsv,
          mapping,
          'numberFormat',
          'dot',
          assessment.candidates,
          currentDecimals,
        ),
      };
      operation.preflightReading(mapping);
      guardedNumberChoice(operation, mapping);
      derivedNumberInterpretation = validateSectionNumberChoice(
        freshCsv,
        mapping,
        currencyContext,
      ).choice;
    }
    // The qualified branch prepares under its actual original code; the bare
    // branch retains its internal arithmetic sentinel. Neither confirms scope.
    const syntaxScope: Scope = {
      supplier: '',
      entity: '',
      account: '',
      currency: currencyContext?.code ?? 'XXX',
      decimals: currentDecimals,
      cutoff: '2100-12-31',
      dateWindow: 0,
      confirmed: false,
      coverageConfirmed: false,
    };
    const prepared = prepareVerifiedSources(
      [freshCsv],
      [mapping],
      syntaxScope,
      ['supplier'],
    ).sources[0];
    if (
      prepared.errors.length ||
      prepared.excluded.length !== 1 ||
      prepared.excluded[0].row !== 1 ||
      prepared.excluded[0].kind !== 'non-movement' ||
      JSON.stringify(prepared.excluded[0].values) !==
        JSON.stringify(csvRows[0]) ||
      prepared.transactions.length !== expected.length ||
      prepared.transactions.some(
        (t, i) =>
          t.date !== expected[i].date ||
          t.reference !== expected[i].reference ||
          t.amount !== expected[i].amountMinor ||
          t.originalAmount !== expected[i].originalAmount,
      )
    )
      throw new Error(
        'The derived native financial reading did not preserve every justified movement.',
      );
    const originalHash = await digest(source.original);
    operation.check();
    this.#assertCurrent(generation);
    if (currencyContext) {
      guardedCurrencyContext(operation, currencyContext);
      qualifiedPrecision(currencyContext, currentDecimals);
      if (
        JSON.stringify(currencyContext) !==
        JSON.stringify(selection.review.currencyContext)
      )
        throw new Error(
          'The generated qualified currency evidence changed before publication.',
        );
      guardedNumberChoice(operation, reading);
      const original = validateSectionNumberChoice(
        source,
        reading,
        currencyContext,
      );
      if (
        JSON.stringify(original.choice) !==
        JSON.stringify(originalNumberInterpretation)
      )
        throw new Error(
          'The generated original dot choice changed before publication.',
        );
      guardedNumberChoice(operation, mapping);
      const derived = validateSectionNumberChoice(
        freshCsv,
        mapping,
        currencyContext,
      );
      if (
        JSON.stringify(derived.choice) !==
        JSON.stringify(derivedNumberInterpretation)
      )
        throw new Error(
          'The generated derived dot choice changed before publication.',
        );
    }
    if (originalHash !== review.sourceHash)
      throw new Error('The original PDF bytes changed during derivation.');
    const reviewer = this.#reviewer!;
    const derivedRowForOriginal = new Map(
      links.map((link) => [link.originalRow, link.derivedRow]),
    );
    const provenance: SectionDerivedProvenance = {
      version: SECTION_DERIVED_VERSION,
      kind: 'explicitly-derived-section-csv',
      financialApproval: false,
      originalName: source.name,
      originalSha256: review.sourceHash,
      derivedName: nativeSource.name,
      derivedSha256: nativeSource.sha256!,
      extractionRevision: review.extractionRevision,
      extractionHash: review.extractionHash,
      selectionHash: selection.selectionHash,
      selectedProposalIds: [...selection.selectedProposalIds],
      originalReading: reading,
      derivedReading: mapping,
      decimals: currentDecimals,
      ...(currencyContext
        ? { currencyContext, scopeConfirmed: false as const }
        : {}),
      ...(originalNumberInterpretation ? { originalNumberInterpretation } : {}),
      ...(derivedNumberInterpretation ? { derivedNumberInterpretation } : {}),
      ...(review.headerBands ? { headerBands: review.headerBands } : {}),
      reviewer: {
        label: reviewer.label,
        rationale: reviewer.rationale,
        acknowledgements: structuredClone(ownership.decision.acknowledgements),
        reviewerHash: receipt.reviewerHash,
      },
      inventory: review.rows.map((row) => ({
        originalRow: row.row,
        page: row.page,
        values: [...row.values],
        kind: row.kind,
        derivedRow: derivedRowForOriginal.get(row.row) ?? null,
      })),
      links,
    };
    operation.check();
    this.#state = 'derived';
    this.#receipt = null;
    return {
      kind: 'explicitly-derived-section-csv',
      financialApproval: false,
      nativeSource,
      mapping,
      csv,
      originalPdf: source.original.slice(0),
      provenance,
      receipt,
    };
  }
}
