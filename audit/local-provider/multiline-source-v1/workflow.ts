// Development-only finite source contract. No product activation or model runtime.
import { readFile } from '../../../lib/reconciliation/io.ts';
import { prepareVerifiedSources } from '../../../lib/reconciliation/source-preparation.ts';
import { defaultMapping } from '../../../lib/reconciliation/types.ts';

export type Field = 'date' | 'reference' | 'amount' | 'currency';
export type Span = Readonly<{
  startUtf16: number;
  endUtf16: number;
  startByte: number;
  endByte: number;
  literal: string;
}>;
export type FieldSelection = Readonly<{
  field: Field;
  value: Span;
  role: Span;
  sourceSha256: string;
  extractionRevision: string;
}>;
export type InvoiceCandidate = Readonly<{
  fields: Readonly<Record<Field, string>>;
  selections: readonly FieldSelection[];
}>;
export type SourceSnapshot = Readonly<{
  originalBytes: Uint8Array;
  originalSha256: string;
  extractionRevision: string;
  outcome: 'candidate' | 'question' | 'abstain';
  reason: string | null;
  candidate: InvoiceCandidate | null;
}>;
export type BoundSelection = Readonly<{
  originalSha256: string;
  extractionRevision: string;
  selectionSha256: string;
  fields: Readonly<Record<Field, string>>;
  selections: readonly FieldSelection[];
  productEnabled: false;
  state: 'candidate';
}>;
const encoder = new TextEncoder();
export async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy);
  return Array.from(new Uint8Array(digest), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
}
function deepFreeze<T>(object: T): T {
  if (object && typeof object === 'object') {
    Object.values(object).forEach(deepFreeze);
    Object.freeze(object);
  }
  return object;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ':' +
            canonical((value as Record<string, unknown>)[k]),
        )
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return (
    y >= 1900 &&
    y <= 2100 &&
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
  );
}
function span(text: string, start: number, literal: string): Span {
  return {
    startUtf16: start,
    endUtf16: start + literal.length,
    startByte: encoder.encode(text.slice(0, start)).length,
    endByte: encoder.encode(text.slice(0, start + literal.length)).length,
    literal,
  };
}
const labels: Record<
  string,
  | 'reference'
  | 'date'
  | 'total'
  | 'due'
  | 'po'
  | 'quantity'
  | 'unit'
  | 'subtotal'
  | 'vat'
> = {
  'Invoice number': 'reference',
  'رقم الفاتورة': 'reference',
  'Issue date': 'date',
  'تاريخ الإصدار': 'date',
  'Invoice total': 'total',
  'إجمالي الفاتورة': 'total',
  'Due date': 'due',
  'تاريخ الاستحقاق': 'due',
  'Purchase order': 'po',
  'رقم أمر الشراء': 'po',
  Quantity: 'quantity',
  الكمية: 'quantity',
  'Unit price': 'unit',
  'سعر الوحدة': 'unit',
  Subtotal: 'subtotal',
  'المجموع الفرعي': 'subtotal',
  VAT: 'vat',
  'ضريبة القيمة المضافة': 'vat',
};
const money =
  /^(?:(SAR|Saudi riyals|ريال سعودي) ((?:0|[1-9]\d{0,7})\.\d{2})|((?:0|[1-9]\d{0,7})\.\d{2}) (SAR|Saudi riyals|ريال سعودي))$/;

/** Exact supplied UTF-8 bytes, fixed labeled lines, one invoice, explicit SAR.
 * Every unknown line causes abstention. Role labels, never number proximity,
 * decide which date/reference/amount the candidate may propose. */
export async function inspectMultilineSource(
  original: Uint8Array,
  extractionRevision: string,
): Promise<SourceSnapshot> {
  const originalBytes = new Uint8Array(original);
  const originalSha256 = await sha256(originalBytes);
  const result = (
    outcome: SourceSnapshot['outcome'],
    reason: string | null,
    candidate: InvoiceCandidate | null = null,
  ): SourceSnapshot =>
    Object.freeze({
      originalBytes,
      originalSha256,
      extractionRevision,
      outcome,
      reason,
      candidate,
    });
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(extractionRevision) ||
    !originalBytes.length ||
    originalBytes.length > 8192
  )
    return result('abstain', 'source-bound');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      originalBytes,
    );
  } catch {
    return result('abstain', 'invalid-encoding');
  }
  if (
    !text.includes('\n') ||
    Array.from(text).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 10 && code !== 13) || code === 127;
    }) ||
    /\r(?!\n)/.test(text)
  )
    return result('abstain', 'source-bound');
  if (/\b(?:USD|EUR|GBP|AED|KWD|JPY)\b|دولار|يورو/u.test(text))
    return result('abstain', 'unsupported-currency');
  const lines = text.split(/(?<=\n)/);
  if (lines.length > 80) return result('abstain', 'source-bound');
  const found: Partial<Record<Field, { value: Span; role: Span }[]>> = {};
  const push = (field: Field, value: Span, role: Span) =>
    (found[field] ??= []).push({ value, role });
  let offset = 0;
  for (const line of lines) {
    const clean = line.replace(/\r?\n$/, '');
    if (/^ *$/.test(clean)) {
      offset += line.length;
      continue;
    }
    const match = /^ *(.*?) *: *(.+?) *$/.exec(clean);
    if (!match || !Object.hasOwn(labels, match[1]))
      return result('abstain', 'unsupported-line');
    const label = match[1];
    const value = match[2];
    const role = span(text, offset + clean.indexOf(label), label);
    const valueStart = offset + clean.indexOf(value, clean.indexOf(':') + 1);
    const kind = labels[label];
    if (kind === 'date' || kind === 'due') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return result('abstain', 'invalid-value');
      if (!validDate(value)) return result('abstain', 'invalid-date');
      if (kind === 'date') push('date', span(text, valueStart, value), role);
    } else if (kind === 'reference' || kind === 'po') {
      if (
        !(kind === 'reference' ? /^INV-\d{3,8}$/ : /^PO-\d{3,8}$/).test(value)
      )
        return result('abstain', 'invalid-value');
      if (kind === 'reference')
        push('reference', span(text, valueStart, value), role);
    } else if (kind === 'quantity') {
      if (!/^(?:0|[1-9]\d{0,7})$/.test(value))
        return result('abstain', 'invalid-value');
    } else {
      const amount = money.exec(value);
      if (!amount) return result('abstain', 'invalid-value');
      const literalAmount = amount[2] ?? amount[3];
      const literalCurrency = amount[1] ?? amount[4];
      if (kind === 'total') {
        if (/^0\.00$/.test(literalAmount))
          return result('abstain', 'invalid-value');
        push(
          'amount',
          span(text, valueStart + value.indexOf(literalAmount), literalAmount),
          role,
        );
        push(
          'currency',
          span(
            text,
            valueStart + value.indexOf(literalCurrency),
            literalCurrency,
          ),
          role,
        );
      }
    }
    offset += line.length;
  }
  const fields: Field[] = ['date', 'reference', 'amount', 'currency'];
  if (fields.some((field) => (found[field]?.length ?? 0) > 1))
    return result('question', 'competing-role');
  if (fields.some((field) => !found[field]?.length))
    return result('question', 'missing-role');
  const selections = fields.map((field) => ({
    field,
    ...found[field]![0],
    sourceSha256: originalSha256,
    extractionRevision,
  }));
  const values = Object.fromEntries(
    selections.map((selection) => [selection.field, selection.value.literal]),
  ) as Record<Field, string>;
  return result('candidate', null, deepFreeze({ fields: values, selections }));
}

/** Optional model response protocol: a canonical JSON array containing only
 * the four citation-bearing selections. No approval/financial-result fields.
 * Canonical reserialization also rejects duplicate keys and trailing prose. */
export function parseModelSelections(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length > 12000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return JSON.stringify(value) === raw && Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** Re-extract the supplied bytes. Both literal AND role citation must equal
 * the deterministic role proof, including byte offsets and revision. */
export async function proposeMultilineSelection(
  snapshot: SourceSnapshot,
  selections: unknown,
): Promise<BoundSelection | null> {
  let captured: unknown;
  try {
    captured = structuredClone(selections);
  } catch {
    return null;
  }
  const source = await inspectMultilineSource(
    snapshot.originalBytes,
    snapshot.extractionRevision,
  );
  if (
    source.originalSha256 !== snapshot.originalSha256 ||
    !source.candidate ||
    !Array.isArray(captured) ||
    captured.length !== 4
  )
    return null;
  const ordered = (captured as FieldSelection[])
    .slice()
    .sort((a, b) => String(a?.field).localeCompare(String(b?.field)));
  const expected = source.candidate.selections
    .slice()
    .sort((a, b) => a.field.localeCompare(b.field));
  try {
    if (canonical(ordered) !== canonical(expected)) return null;
  } catch {
    return null;
  }
  const selectionSha256 = await sha256(encoder.encode(canonical(expected)));
  return deepFreeze({
    originalSha256: source.originalSha256,
    extractionRevision: source.extractionRevision,
    selectionSha256,
    fields: { ...source.candidate.fields },
    selections: expected,
    productEnabled: false,
    state: 'candidate',
  });
}

export type ReviewerDecision = Readonly<{
  decision: 'accept' | 'reject';
  reviewerLabel: string;
  rationale: string;
  reviewedOriginalSha256: string;
  reviewedExtractionRevision: string;
  reviewedSelectionSha256: string;
}>;
export type ReviewReceipt = Readonly<{
  originalSha256: string;
  extractionRevision: string;
  selectionSha256: string;
  reviewerLabel: string;
  rationale: string;
  decision: 'accept';
}>;
export type AppliedMultiline = Readonly<{
  state: 'applied-development-derived';
  productEnabled: false;
  originalSha256: string;
  extractionRevision: string;
  selectionSha256: string;
  originalText: string;
  review: ReviewReceipt;
  derived: {
    name: string;
    csv: string;
    sha256: string;
    kind: 'explicitly-derived-csv';
  };
  engine: {
    date: string;
    reference: string;
    originalAmount: string;
    amountMinor: string;
    transactionCount: number;
  };
}>;

/** Receipt objects are local capabilities: copied JSON/model text cannot mint
 * one. Decisions enter only through the separate reviewer action. Labels
 * identify the caller's review; this module never claims a field human trial. */
export class MultilineReviewSession {
  #bytes: Uint8Array;
  #revision: string;
  #generation = 0;
  #candidate: BoundSelection | null = null;
  #receipt: ReviewReceipt | null = null;
  #receipts = new WeakSet<object>();
  #state:
    | 'unselected'
    | 'candidate'
    | 'approved'
    | 'rejected'
    | 'applied-development-derived' = 'unselected';
  constructor(originalBytes: Uint8Array, extractionRevision: string) {
    this.#bytes = new Uint8Array(originalBytes);
    this.#revision = extractionRevision;
  }
  get state() {
    return this.#state;
  }
  get candidate() {
    return this.#candidate;
  }
  inspect() {
    return inspectMultilineSource(this.#bytes, this.#revision);
  }
  replaceSource(originalBytes: Uint8Array, extractionRevision: string): void {
    this.#bytes = new Uint8Array(originalBytes);
    this.#revision = extractionRevision;
    this.#invalidate();
  }
  #invalidate(): void {
    this.#generation++;
    this.#candidate = null;
    this.#receipt = null;
    this.#state = 'unselected';
  }
  async select(selections: unknown): Promise<BoundSelection | null> {
    // Snapshot selection before awaits and invalidate every prior decision.
    let copied: unknown;
    try {
      copied = structuredClone(selections);
    } catch {
      copied = null;
    }
    this.#invalidate();
    const generation = this.#generation;
    const snapshot = await this.inspect();
    const candidate = await proposeMultilineSelection(snapshot, copied);
    if (generation !== this.#generation) return null;
    this.#candidate = candidate;
    if (candidate) this.#state = 'candidate';
    return candidate;
  }
  recordReviewerDecision(input: ReviewerDecision): ReviewReceipt | null {
    const keys = [
      'decision',
      'reviewerLabel',
      'rationale',
      'reviewedOriginalSha256',
      'reviewedExtractionRevision',
      'reviewedSelectionSha256',
    ];
    if (
      !input ||
      typeof input !== 'object' ||
      Object.keys(input).sort().join('|') !== keys.sort().join('|')
    )
      throw Error('Separate explicit reviewer decision required');
    const decision = { ...input };
    const candidate = this.#candidate;
    if (
      !candidate ||
      !['candidate', 'approved', 'rejected'].includes(this.#state) ||
      !['accept', 'reject'].includes(decision.decision) ||
      typeof decision.reviewerLabel !== 'string' ||
      !decision.reviewerLabel.trim() ||
      decision.reviewerLabel.length > 120 ||
      typeof decision.rationale !== 'string' ||
      !decision.rationale.trim() ||
      decision.rationale.length > 1000 ||
      decision.reviewedOriginalSha256 !== candidate.originalSha256 ||
      decision.reviewedExtractionRevision !== candidate.extractionRevision ||
      decision.reviewedSelectionSha256 !== candidate.selectionSha256
    )
      throw Error(
        'Reviewer decision does not match the current source, extraction and selection',
      );
    this.#receipt = null;
    if (decision.decision === 'reject') {
      this.#state = 'rejected';
      return null;
    }
    const receipt = deepFreeze({
      originalSha256: candidate.originalSha256,
      extractionRevision: candidate.extractionRevision,
      selectionSha256: candidate.selectionSha256,
      reviewerLabel: decision.reviewerLabel,
      rationale: decision.rationale,
      decision: 'accept' as const,
    });
    this.#receipts.add(receipt);
    this.#receipt = receipt;
    this.#state = 'approved';
    return receipt;
  }
  async apply(
    receipt: ReviewReceipt,
    currentOriginalBytes: Uint8Array,
    currentExtractionRevision: string,
  ): Promise<AppliedMultiline> {
    const currentBytes = new Uint8Array(currentOriginalBytes);
    const generation = this.#generation;
    const selected = this.#candidate;
    if (
      !selected ||
      this.#state !== 'approved' ||
      this.#receipt !== receipt ||
      !this.#receipts.has(receipt)
    )
      throw Error('Apply requires a separate current reviewer receipt');
    const currentSha256 = await sha256(currentBytes);
    if (
      generation !== this.#generation ||
      this.#receipt !== receipt ||
      this.#state !== 'approved'
    )
      throw Error('Review changed during replay; approval invalidated');
    if (
      currentExtractionRevision !== selected.extractionRevision ||
      currentSha256 !== selected.originalSha256
    ) {
      this.replaceSource(currentBytes, currentExtractionRevision);
      throw Error('Original bytes or extraction changed; approval invalidated');
    }
    const snapshot = await inspectMultilineSource(
      currentBytes,
      currentExtractionRevision,
    );
    const rebound = await proposeMultilineSelection(
      snapshot,
      selected.selections,
    );
    if (!rebound || rebound.selectionSha256 !== selected.selectionSha256)
      throw Error('Selection no longer proves the supplied source');
    const row = rebound.fields;
    const csv =
      'Date,Reference,Amount,Currency,Description,Type\n' +
      `${row.date},${row.reference},${row.amount},SAR,Reviewed development multiline invoice,Invoice\n`;
    const name = 'multiline-explicitly-derived-invoice.csv';
    const derivedBytes = encoder.encode(csv);
    const source = await readFile(name, derivedBytes.buffer);
    const mapping = {
      ...defaultMapping(),
      date: 0,
      reference: 1,
      amount: 2,
      currencyColumn: 3,
      description: 4,
    };
    const scope = {
      supplier: 'Synthetic multiline supplier',
      entity: 'Synthetic entity',
      account: '2100',
      currency: 'SAR',
      decimals: 2,
      cutoff: '2100-12-31',
      dateWindow: 0,
      confirmed: true,
      coverageConfirmed: false,
    };
    const reading = prepareVerifiedSources([source], [mapping], scope, [
      'supplier',
    ]).sources[0];
    if (
      reading.transactions.length !== 1 ||
      reading.errors.length ||
      reading.excluded.some(
        (entry) => entry.row !== 1 || entry.kind !== 'non-movement',
      )
    )
      throw Error('Native engine refused the explicitly derived CSV');
    const transaction = reading.transactions[0];
    const derivedSha256 = await sha256(derivedBytes);
    if (
      generation !== this.#generation ||
      this.#receipt !== receipt ||
      this.#state !== 'approved'
    )
      throw Error('Review changed during replay; approval invalidated');
    this.#state = 'applied-development-derived';
    return deepFreeze({
      state: 'applied-development-derived',
      productEnabled: false,
      originalSha256: rebound.originalSha256,
      extractionRevision: rebound.extractionRevision,
      selectionSha256: rebound.selectionSha256,
      originalText: new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: true,
      }).decode(currentBytes),
      review: receipt,
      derived: {
        name,
        csv,
        sha256: derivedSha256,
        kind: 'explicitly-derived-csv',
      },
      engine: {
        date: transaction.date,
        reference: transaction.reference,
        originalAmount: transaction.originalAmount,
        amountMinor: String(transaction.amountMinor),
        transactionCount: reading.transactions.length,
      },
    });
  }
}
