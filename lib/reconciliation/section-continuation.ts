import { parseDate, parseMoney } from './core.ts';
import { readFile } from './io.ts';
import {
  MAX_ROWS,
  MAX_PDF_PAGES,
  MAX_FILE_BYTES,
  type Mapping,
  type SheetData,
  type SourceFile,
} from './types.ts';
import type { ProcessingProgress } from './processing-progress.ts';
import { suggestFormats, type FormatStatus } from './format-inference.ts';
import {
  qualifiedSectionCurrency,
  SECTION_CURRENCY_POLICY,
  type SectionCurrencyContext,
} from './section-currency-context.ts';

export const SECTION_CONTINUATION_VERSION = 'P4_SECTION_CONTINUATION_V1';
export type SectionQuestionCode =
  | 'unknown-boundary'
  | 'missing-parent'
  | 'duplicate-parent'
  | 'competing-reference'
  | 'corrupt-row'
  | 'page-gap'
  | 'unproven-page-boundary';
/** Extraction coordinates: one-based sheet, row, page and column. These are not
 * PDF byte offsets or a claim of visual bounding-box verification. */
export type SectionCellEvidence = {
  sourceHash: string;
  extractionHash: string;
  extractionRevision: string;
  sheet: number;
  row: number;
  page: number;
  column: number;
  literal: string;
};
export type SectionReferenceProposal = {
  id: string;
  reference: string;
  target: SectionCellEvidence;
  parent: SectionCellEvidence;
  continuation: SectionCellEvidence[];
  headers: SectionCellEvidence[][];
  /** Additive literal spans; legacy fields remain value-cell citations. */
  parentSpan?: SectionCellEvidence[];
  continuationSpans?: SectionCellEvidence[][];
  /** Original raw two-row signed bands: eight cells including blanks. */
  headerBands?: SectionCellEvidence[][];
  rule: 'explicit-section-reference' | 'explicit-page-continuation';
  authority: 'structural-review-only';
};
export type SectionReviewQuestion = {
  id: string;
  code: SectionQuestionCode;
  rows: number[];
  evidence: SectionCellEvidence[];
};
export type SectionContinuationReview = {
  version: typeof SECTION_CONTINUATION_VERSION;
  authority: 'structural-review-only';
  sourceVerified: boolean;
  sourceHash: string;
  extractionHash: string;
  extractionRevision: string;
  sheet: number;
  rows: {
    row: number;
    page: number;
    values: string[];
    amounts: SectionCellEvidence[];
    kind:
      | 'header'
      | 'parent'
      | 'continuation'
      | 'movement'
      | 'blank'
      | 'boundary';
  }[];
  proposals: SectionReferenceProposal[];
  questions: SectionReviewQuestion[];
  /** Recognized original bands, including those preceding own references. */
  headerBands?: SectionCellEvidence[][];
  /** Finite literal header authority; the exponent comes from contract policy. */
  currencyContext?: SectionCurrencyContext;
  originalNumberFormat?: {
    status: FormatStatus;
    candidates: Mapping['numberFormat'][];
  };
};
type Section = {
  reference: string;
  parent: SectionCellEvidence;
  parentSpan: SectionCellEvidence[];
  continuations: SectionCellEvidence[];
  continuationSpans: SectionCellEvidence[][];
  headers: SectionCellEvidence[][];
  headerBands?: SectionCellEvidence[][];
  targets: SectionCellEvidence[];
  movements: number[];
  blockers: Set<SectionQuestionCode>;
};
export type SectionResourceBudgets = {
  maxOriginalBytes: number;
  maxPages: number;
  maxRows: number;
  maxProposals: number;
  maxEvidenceCells: number;
};
export const SECTION_RESOURCE_BUDGETS: Readonly<SectionResourceBudgets> =
  Object.freeze({
    maxOriginalBytes: MAX_FILE_BYTES,
    maxPages: MAX_PDF_PAGES,
    maxRows: MAX_ROWS,
    maxProposals: 4096,
    maxEvidenceCells: 65536,
  });
export type SectionOperationProgress =
  | ProcessingProgress
  | {
      stage: 'section-rows';
      completed: number;
      total: number;
      phase: 'parents' | 'classify' | 'proposals' | 'derived';
    };
export type SectionOperationOptions = {
  signal?: AbortSignal;
  budgets?: Partial<SectionResourceBudgets>;
  onProgress?: (progress: SectionOperationProgress) => void;
  /** Optional refusal check, used by the owned session generation guard. */
  checkCurrent?: () => void;
};
export class SectionOperationError extends Error {
  readonly code: 'cancelled' | 'resource-limit' | 'invalid-budget';
  constructor(code: 'cancelled' | 'resource-limit' | 'invalid-budget') {
    super(`Section operation refused: ${code}.`);
    this.name = 'SectionOperationError';
    this.code = code;
  }
}
const sourceCopyKeys = new Set([
  'name',
  'sheets',
  'original',
  'sha256',
  'pdf',
  'kind',
  'visual',
]);
const sheetCopyKeys = new Set([
  'name',
  'rows',
  'formulaRows',
  'hiddenRows',
  'xlsxHeaders',
  'numericCells',
  'formulaCells',
  'rowIssues',
  'cellIssues',
  'cellNotes',
  'referenceIssues',
  'rowPages',
  'pdfHeaderFragments',
  'pdfTextTransforms',
]);
const readingCopyKeys = new Set([
  'pdfReviewed',
  'sheet',
  'header',
  'date',
  'reference',
  'description',
  'amount',
  'debit',
  'credit',
  'currencyColumn',
  'mode',
  'multiplier',
  'directionEvidence',
  'numberFormat',
  'dateFormat',
  'formatChoice',
  'reportType',
  'opening',
  'closing',
  'periodStart',
  'excluded',
]);
function copyRecord(value: unknown, allowed?: ReadonlySet<string>) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new SectionOperationError('resource-limit');
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_ROWS) throw new SectionOperationError('resource-limit');
  for (const key of keys) {
    if (
      typeof key !== 'string' ||
      key.length > 128 ||
      (allowed && !allowed.has(key)) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value')
    )
      throw new SectionOperationError('resource-limit');
  }
  return keys as string[];
}
/** Bounds every property that structuredClone will traverse, including fields
 * not used for classification. This is allocation safety, never authenticity.
 * Fresh native replay still compares all known source facts without omission. */
function boundedCopyTree(value: unknown, check: () => void) {
  let nodes = 0;
  let chars = 0;
  const seen = new Set<object>();
  const visit = (current: unknown, depth: number) => {
    if (++nodes > 1000000 || depth > 10)
      throw new SectionOperationError('resource-limit');
    if (nodes % 256 === 0) check();
    if (
      current === null ||
      current === undefined ||
      typeof current === 'boolean'
    )
      return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current))
        throw new SectionOperationError('resource-limit');
      return;
    }
    if (typeof current === 'string') {
      chars += current.length;
      if (current.length > 4096 || chars > 10000000)
        throw new SectionOperationError('resource-limit');
      return;
    }
    if (
      typeof current !== 'object' ||
      current instanceof ArrayBuffer ||
      seen.has(current)
    )
      throw new SectionOperationError('resource-limit');
    seen.add(current);
    if (Array.isArray(current)) {
      if (
        Object.getPrototypeOf(current) !== Array.prototype ||
        current.length > MAX_ROWS
      )
        throw new SectionOperationError('resource-limit');
      const keys = Reflect.ownKeys(current);
      if (keys.length !== current.length + 1)
        throw new SectionOperationError('resource-limit');
      for (let index = 0; index < current.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(
          current,
          String(index),
        );
        if (!descriptor || !Object.hasOwn(descriptor, 'value'))
          throw new SectionOperationError('resource-limit');
        visit(descriptor.value, depth + 1);
      }
    } else {
      for (const key of copyRecord(current)) {
        chars += key.length;
        if (chars > 10000000) throw new SectionOperationError('resource-limit');
        visit(Object.getOwnPropertyDescriptor(current, key)!.value, depth + 1);
      }
    }
    seen.delete(current);
  };
  visit(value, 0);
  check();
}
/** Execution guard, never source evidence or review authority. Only the session
 * supplies a generation check; progress callbacks can only refuse work. */
export class SectionOperation {
  readonly budgets: Readonly<SectionResourceBudgets>;
  #signal: AbortSignal | undefined;
  #onProgress: SectionOperationOptions['onProgress'];
  #assertCurrent: () => void;
  #evidenceCells = 0;
  #proposals = 0;
  constructor(
    options: SectionOperationOptions = {},
    assertCurrent?: () => void,
  ) {
    this.#signal = options.signal;
    this.#onProgress = options.onProgress;
    this.#assertCurrent = assertCurrent ?? options.checkCurrent ?? (() => {});
    const budgets = { ...SECTION_RESOURCE_BUDGETS };
    for (const [key, value] of Object.entries(options.budgets ?? {})) {
      if (
        !Object.hasOwn(budgets, key) ||
        !Number.isSafeInteger(value) ||
        value <= 0 ||
        value > SECTION_RESOURCE_BUDGETS[key as keyof SectionResourceBudgets]
      )
        throw new SectionOperationError('invalid-budget');
      budgets[key as keyof SectionResourceBudgets] = value;
    }
    this.budgets = Object.freeze(budgets);
    this.check();
  }
  check() {
    this.#assertCurrent();
    if (this.#signal?.aborted) throw new SectionOperationError('cancelled');
  }
  continuationOptions(): SectionOperationOptions {
    return {
      signal: this.#signal,
      budgets: this.budgets,
      onProgress: this.#onProgress,
      checkCurrent: this.#assertCurrent,
    };
  }
  preflight(source: SourceFile) {
    this.check();
    copyRecord(source, sourceCopyKeys);
    if (
      source.original instanceof ArrayBuffer &&
      source.original.byteLength > this.budgets.maxOriginalBytes
    )
      throw new SectionOperationError('resource-limit');
    if (source.pdf) {
      copyRecord(source.pdf, new Set(['cuts', 'pages', 'autoColumns']));
      if (source.pdf.pages > this.budgets.maxPages)
        throw new SectionOperationError('resource-limit');
      if (!Array.isArray(source.pdf.cuts) || source.pdf.cuts.length > 19)
        throw new SectionOperationError('resource-limit');
    }
    if (!Array.isArray(source.sheets) || source.sheets.length > 40)
      throw new SectionOperationError('resource-limit');
    // original is the only supported binary field. Its actual byte length was
    // bounded above; the rest must be finite plain native-source metadata.
    for (const key of copyRecord(source, sourceCopyKeys)) {
      if (key === 'original') {
        if (
          source.original !== undefined &&
          !(source.original instanceof ArrayBuffer)
        )
          throw new SectionOperationError('resource-limit');
        continue;
      }
      boundedCopyTree(Object.getOwnPropertyDescriptor(source, key)!.value, () =>
        this.check(),
      );
    }
    // Bound native cached cell storage before cloning it. Fresh replay later
    // proves authenticity; this allocation guard grants no source authority.
    let rows = 0;
    let chars = 0;
    for (const sheet of source.sheets ?? []) {
      copyRecord(sheet, sheetCopyKeys);
      rows += sheet.rows?.length ?? 0;
      if (rows > this.budgets.maxRows)
        throw new SectionOperationError('resource-limit');
      for (const row of sheet.rows ?? []) {
        if (!Array.isArray(row) || row.length > 20)
          throw new SectionOperationError('resource-limit');
        for (const cell of row) {
          if (typeof cell !== 'string' || cell.length > 4096)
            throw new SectionOperationError('resource-limit');
          chars += cell.length;
          if (chars > 2000000)
            throw new SectionOperationError('resource-limit');
        }
      }
    }
    this.check();
  }
  preflightReading(reading: Mapping) {
    this.check();
    copyRecord(reading, readingCopyKeys);
    boundedCopyTree(reading, () => this.check());
  }
  preflightMetadata(value: unknown, allowedKeys: readonly string[]) {
    this.check();
    copyRecord(value, new Set(allowedKeys));
    boundedCopyTree(value, () => this.check());
  }
  progress(progress: SectionOperationProgress) {
    this.check();
    if ('total' in progress && progress.stage.startsWith('pdf-')) {
      if (progress.total > this.budgets.maxPages)
        throw new SectionOperationError('resource-limit');
    }
    this.#onProgress?.(progress);
    this.check();
  }
  async checkpoint(
    completed: number,
    total: number,
    phase: 'parents' | 'classify' | 'proposals' | 'derived',
  ) {
    this.check();
    if (completed % 256 === 0 && completed > 0) {
      this.progress({ stage: 'section-rows', completed, total, phase });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      this.check();
    }
  }
  evidence(count: number) {
    this.#evidenceCells += count;
    if (this.#evidenceCells > this.budgets.maxEvidenceCells)
      throw new SectionOperationError('resource-limit');
    this.check();
  }
  proposal() {
    if (++this.#proposals > this.budgets.maxProposals)
      throw new SectionOperationError('resource-limit');
    this.check();
  }
}
async function hash(value: ArrayBuffer | string): Promise<string> {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
function validateReading(
  file: SourceFile,
  mapping: Mapping,
  revision: string,
  decimals: number,
) {
  if (
    !file ||
    !Array.isArray(file.sheets) ||
    !mapping ||
    !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') ||
    !revision.trim() ||
    revision.length > 128 ||
    ![0, 2, 3].includes(decimals) ||
    mapping.mode !== 'signed' ||
    !['dot', 'comma'].includes(mapping.numberFormat) ||
    !['ymd', 'dmy', 'mdy'].includes(mapping.dateFormat) ||
    !Number.isInteger(mapping.sheet) ||
    mapping.sheet < 0 ||
    !Number.isInteger(mapping.header) ||
    mapping.header < 0 ||
    !file.pdf ||
    !Number.isInteger(file.pdf.pages) ||
    file.pdf.pages < 1 ||
    file.pdf.pages > MAX_PDF_PAGES ||
    !Array.isArray(file.pdf.cuts)
  )
    throw new Error(
      'Section review needs a bound native PDF, signed reading and extraction revision.',
    );
  const sheet = file.sheets[mapping.sheet];
  const columns = [
    mapping.date,
    mapping.reference,
    mapping.description,
    mapping.amount,
  ];
  if (
    !sheet ||
    !Array.isArray(sheet.rows) ||
    sheet.rows.length > MAX_ROWS ||
    !sheet.rows[mapping.header] ||
    !sheet.rowPages ||
    columns.some((c) => !Number.isInteger(c) || c < 0) ||
    new Set(columns).size !== columns.length ||
    !Array.isArray(sheet.formulaRows) ||
    !Array.isArray(sheet.hiddenRows) ||
    Object.keys(mapping.excluded ?? {}).length
  )
    throw new Error(
      'Section review requires four distinct columns and every source row, without exclusions.',
    );
  let page = 0;
  for (const [i, row] of sheet.rows.entries()) {
    const current = sheet.rowPages[String(i + 1)];
    if (
      !Array.isArray(row) ||
      row.some((s) => typeof s !== 'string') ||
      columns.some((c) => c >= row.length) ||
      !Number.isInteger(current) ||
      current < 1 ||
      current > file.pdf.pages ||
      current < page
    )
      throw new Error(
        'Invalid original row, column or physical page provenance.',
      );
    page = current;
  }
  return sheet;
}
/** Finite original-cell recognizer only. It does not prove source bytes or
 * authorize derivation; callers still need fresh native replay and review. */
export function rawSignedSectionHeaderRows(
  sheet: SheetData,
  mapping: Mapping,
): [number, number] | null {
  if (
    mapping.date !== 0 ||
    mapping.reference !== 1 ||
    mapping.description !== 2 ||
    mapping.amount !== 3
  )
    return null;
  const upper = sheet.rows[mapping.header];
  const lower = sheet.rows[mapping.header + 1];
  if (
    !upper ||
    !lower ||
    upper.length !== 4 ||
    lower.length !== 4 ||
    upper[0] !== 'Date' ||
    upper[1] !== 'Reference' ||
    upper[2] !== 'Description' ||
    lower.slice(0, 3).some((cell) => cell !== '') ||
    !(
      (upper[3] === 'Signed' && lower[3] === 'amount') ||
      (upper[3] === 'Movement' && lower[3] === 'Signed amount')
    ) ||
    !Number.isInteger(sheet.rowPages?.[String(mapping.header + 1)]) ||
    sheet.rowPages?.[String(mapping.header + 1)] !==
      sheet.rowPages?.[String(mapping.header + 2)]
  )
    return null;
  return [mapping.header, mapping.header + 1];
}
function structuralLabel(row: string[], amountColumn: number) {
  const cells = row
    .map((literal, column) => ({ literal, column }))
    .filter((c) => c.literal.trim());
  if (cells.length === 2) {
    const [role, value] = cells;
    if (
      value.column !== role.column + 1 ||
      row[amountColumn].trim() ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/.test(value.literal)
    )
      return null;
    const label =
      /^(?:(Invoice (?:No|Number):?|رقم الفاتورة)|(Continued invoice(?: No)?:?|تابع الفاتورة))$/.exec(
        role.literal.trim(),
      );
    if (!label) return null;
    return {
      ...value,
      reference: value.literal,
      kind:
        label[1] !== undefined
          ? ('parent' as const)
          : ('continuation' as const),
      spanColumns: [role.column, value.column],
    };
  }
  if (cells.length !== 1) return null;
  const cell = cells[0];
  // Finite anchored role labels; do not strip bidi controls from an identity.
  const match =
    /^(?:(Invoice|فاتورة)|(Continued invoice|تابع فاتورة)):\s*([A-Za-z0-9][A-Za-z0-9._/-]{0,63})$/.exec(
      cell.literal.trim(),
    );
  if (!match) return null;
  return {
    ...cell,
    reference: match[3],
    spanColumns: [cell.column],
    // Capture group 1 contains a finite parent label; group 2 contains a
    // continuation label. Both are source roles, never interface messages.
    kind:
      match[1] !== undefined ? ('parent' as const) : ('continuation' as const),
  };
}

/** Low-level extraction-only proposal API for deterministic synthetic contracts.
 * It cannot establish that the caller's cells came from original bytes. Product
 * callers must use inspectSectionContinuation, which rereads the native source. */
export async function proposeSectionContinuationFromExtraction(
  source: SourceFile,
  reading: Mapping,
  extractionRevision: string,
  decimals = 2,
  options: SectionOperationOptions = {},
): Promise<SectionContinuationReview> {
  const operation = new SectionOperation(options);
  // Own all extraction facts and settings before awaiting a hash.
  operation.preflight(source);
  operation.preflightReading(reading);
  const file = structuredClone(source);
  const mapping = structuredClone(reading);
  const sheet = validateReading(file, mapping, extractionRevision, decimals);
  const sourceHash = file.sha256!;
  operation.check();
  const extractionHash = await hash(
    JSON.stringify({
      version: SECTION_CONTINUATION_VERSION,
      sourceHash,
      extractionRevision,
      sheets: file.sheets,
      pdf: file.pdf,
      mapping,
      decimals,
    }),
  );
  operation.check();
  const evidence = (row: number, column: number): SectionCellEvidence => ({
    sourceHash,
    extractionHash,
    extractionRevision,
    sheet: mapping.sheet + 1,
    row,
    page: sheet.rowPages![String(row)],
    column: column + 1,
    literal: sheet.rows[row - 1][column],
  });
  const header = sheet.rows[mapping.header];
  const rawHeaderRows = rawSignedSectionHeaderRows(sheet, mapping);
  const sameRow = (row: string[] | undefined, expected: string[]) =>
    !!row &&
    row.length === expected.length &&
    row.every((cell, col) => cell === expected[col]);
  const bandStart = (index: number) =>
    !!rawHeaderRows &&
    index >= mapping.header &&
    sameRow(sheet.rows[index], header) &&
    sameRow(sheet.rows[index + 1], sheet.rows[rawHeaderRows[1]]) &&
    sheet.rowPages![String(index + 1)] === sheet.rowPages![String(index + 2)];
  const bandLower = (index: number) =>
    index > mapping.header && bandStart(index - 1);
  const isHeader = (row: string[], index: number) =>
    rawHeaderRows
      ? bandStart(index) || bandLower(index)
      : row.length === header.length &&
        row.every((cell, col) => cell === header[col]);
  const changedHeader = (row: string[]) =>
    row.length === header.length &&
    [mapping.date, mapping.reference, mapping.description].every(
      (col) => row[col] === header[col],
    );
  const rowHasIssues = (rn: number) =>
    !!sheet.rowIssues?.[String(rn)]?.length ||
    sheet.formulaRows.includes(rn) ||
    sheet.hiddenRows.includes(rn) ||
    sheet.rows[rn - 1].some(
      (_, col) =>
        !!sheet.cellIssues?.[`${rn}:${col + 1}`]?.length ||
        !!sheet.formulaCells?.[`${rn}:${col + 1}`],
    );
  const headerEvidence = (row: number) =>
    rawHeaderRows
      ? [row, row + 1].flatMap((rn) =>
          header.map((_, col) => evidence(rn, col)),
        )
      : header.map((_, col) => evidence(row, col));
  const headerBands: SectionCellEvidence[][] = [];
  const currency = qualifiedSectionCurrency(sheet, mapping);
  const currencyContext: SectionCurrencyContext | undefined = currency
    ? {
        code: currency,
        decimals: SECTION_CURRENCY_POLICY[currency],
        precisionOrigin: 'finite-contract-policy',
        headerCells: [],
      }
    : undefined;
  const originalNumberFormat = currencyContext
    ? suggestFormats(file, mapping, currencyContext.decimals).numberFormat
    : undefined;
  const initialBand = rawHeaderRows ? headerEvidence(mapping.header + 1) : null;
  const rows: SectionContinuationReview['rows'] = [];
  const sections: Section[] = [];
  const questions: SectionReviewQuestion[] = [];
  const question = (
    code: SectionQuestionCode,
    rowNumbers: number[],
    facts: SectionCellEvidence[],
  ) => {
    operation.evidence(facts.length);
    questions.push({
      id: `${extractionHash}:${code}:${rowNumbers.join(',')}`,
      code,
      rows: rowNumbers,
      evidence: facts,
    });
  };
  const parents = new Map<string, number>();
  for (const [i, row] of sheet.rows.entries()) {
    await operation.checkpoint(i + 1, sheet.rows.length, 'parents');
    const label =
      i > mapping.header ? structuralLabel(row, mapping.amount) : null;
    if (label?.kind === 'parent')
      parents.set(label.reference, (parents.get(label.reference) ?? 0) + 1);
  }
  let active: Section | null = null;
  let previousPage = sheet.rowPages![String(mapping.header + 1)];
  let carry: {
    section: Section;
    from: number;
    to: number;
    header?: SectionCellEvidence[];
    interrupted: boolean;
  } | null = null;
  for (const [i, values] of sheet.rows.entries()) {
    await operation.checkpoint(i + 1, sheet.rows.length, 'classify');
    const rn = i + 1;
    const page = sheet.rowPages![String(rn)];
    const amounts =
      values[mapping.amount].trim() && !isHeader(values, i)
        ? [evidence(rn, mapping.amount)]
        : [];
    operation.evidence(amounts.length);
    const label = structuralLabel(values, mapping.amount);
    const kind = isHeader(values, i)
      ? 'header'
      : changedHeader(values)
        ? 'boundary'
        : (label?.kind ??
          (values.every((v) => !v.trim())
            ? 'blank'
            : amounts.length
              ? 'movement'
              : 'boundary'));
    rows.push({ row: rn, page, values: [...values], amounts, kind });
    if (currencyContext && kind === 'header') {
      operation.evidence(1);
      currencyContext.headerCells.push(evidence(rn, mapping.amount));
    }
    if (bandStart(i)) {
      const band = headerEvidence(rn);
      operation.evidence(band.length);
      headerBands.push(band);
    }
    if (i <= mapping.header || (rawHeaderRows && i === rawHeaderRows[1]))
      continue;
    if (page !== previousPage) {
      carry = active
        ? { section: active, from: previousPage, to: page, interrupted: false }
        : null;
      if (carry && page !== previousPage + 1) {
        question('page-gap', [rn], [evidence(rn, mapping.description)]);
        carry.interrupted = true;
      }
      active = null;
      previousPage = page;
    }
    if (kind === 'header') {
      if (bandLower(i)) continue;
      if (
        carry &&
        !carry.interrupted &&
        !carry.header &&
        !rowHasIssues(rn) &&
        (!rawHeaderRows || !rowHasIssues(rn + 1))
      )
        carry.header = headerEvidence(rn);
      else if (active) {
        // An unexpected header within a physical page ends the section.
        question('unknown-boundary', [rn], headerEvidence(rn));
        active = null;
      }
      continue;
    }
    if (kind === 'blank') continue;
    if (label?.kind === 'parent') {
      carry = null;
      active = {
        reference: label.reference,
        parent: evidence(rn, label.column),
        parentSpan: label.spanColumns.map((column) => evidence(rn, column)),
        continuations: [],
        continuationSpans: [],
        headers: [],
        ...(initialBand ? { headerBands: [initialBand] } : {}),
        targets: [],
        movements: [],
        blockers: new Set(),
      };
      if (parents.get(label.reference)! > 1)
        active.blockers.add('duplicate-parent');
      if (rowHasIssues(rn)) active.blockers.add('corrupt-row');
      sections.push(active);
      continue;
    }
    if (label?.kind === 'continuation') {
      if (
        carry &&
        !carry.interrupted &&
        carry.to === carry.from + 1 &&
        carry.header &&
        !rowHasIssues(rn) &&
        label.reference === carry.section.reference
      ) {
        active = carry.section;
        active.continuations.push(evidence(rn, label.column));
        active.continuationSpans.push(
          label.spanColumns.map((column) => evidence(rn, column)),
        );
        active.headers.push(carry.header);
        active.headerBands?.push(carry.header);
      } else {
        if (!carry || carry.to === carry.from + 1)
          question(
            'unproven-page-boundary',
            [rn],
            label.spanColumns.map((column) => evidence(rn, column)),
          );
        active = null;
      }
      carry = null;
      continue;
    }
    if (carry) {
      if (!carry.interrupted)
        question(
          'unproven-page-boundary',
          [rn],
          [...carry.section.parentSpan, evidence(rn, mapping.description)],
        );
      carry.interrupted = true;
    }
    if (kind === 'boundary') {
      question(
        'unknown-boundary',
        [rn],
        values.flatMap((v, col) => (v.trim() ? [evidence(rn, col)] : [])),
      );
      active = null;
      continue;
    }
    if (!active) {
      question(
        'missing-parent',
        [rn],
        [evidence(rn, mapping.reference), ...amounts],
      );
      continue;
    }
    active.movements.push(rn);
    let corrupt = !values[mapping.date].trim() || rowHasIssues(rn);
    try {
      parseDate(values[mapping.date], mapping.dateFormat);
      parseMoney(values[mapping.amount], mapping.numberFormat, decimals);
    } catch {
      corrupt = true;
    }
    if (corrupt) active.blockers.add('corrupt-row');
    const stated = values[mapping.reference].trim();
    if (stated && stated !== active.reference)
      active.blockers.add('competing-reference');
    if (!stated) active.targets.push(evidence(rn, mapping.reference));
  }
  const proposals: SectionReferenceProposal[] = [];
  for (const section of sections) {
    if (section.blockers.size) {
      for (const code of section.blockers)
        question(
          code,
          [section.parent.row, ...section.movements],
          [
            ...section.parentSpan,
            ...section.movements.flatMap((rn) => [
              evidence(rn, mapping.reference),
              evidence(rn, mapping.amount),
            ]),
          ],
        );
      continue;
    }
    for (const target of section.targets) {
      await operation.checkpoint(
        proposals.length + 1,
        sheet.rows.length,
        'proposals',
      );
      // Only carry facts that precede this target; later markers do not prove earlier rows.
      const continuations = section.continuations.filter(
        (c) => c.row < target.row,
      );
      const continuationSpans = section.continuationSpans.filter(
        (span) => span[0].row < target.row,
      );
      const headers = section.headers.filter((h) => h[0].row < target.row);
      const provedBands = section.headerBands?.filter(
        (band) => band.at(-1)!.row < target.row,
      );
      const paired =
        section.parentSpan.length === 2 ||
        continuationSpans.some((span) => span.length === 2);
      operation.proposal();
      operation.evidence(
        2 +
          continuations.length +
          headers.reduce((n, h) => n + h.length, 0) +
          (provedBands?.reduce((n, band) => n + band.length, 0) ?? 0) +
          (paired
            ? section.parentSpan.length +
              continuationSpans.reduce((n, span) => n + span.length, 0)
            : 0),
      );
      proposals.push({
        id: `${extractionHash}:${target.row}`,
        reference: section.reference,
        target,
        parent: section.parent,
        continuation: continuations,
        headers,
        ...(provedBands ? { headerBands: provedBands } : {}),
        ...(paired
          ? { parentSpan: section.parentSpan, continuationSpans }
          : {}),
        rule:
          target.page === section.parent.page
            ? 'explicit-section-reference'
            : 'explicit-page-continuation',
        authority: 'structural-review-only',
      });
    }
  }
  operation.check();
  return {
    version: SECTION_CONTINUATION_VERSION,
    authority: 'structural-review-only',
    sourceVerified: false,
    sourceHash,
    extractionHash,
    extractionRevision,
    sheet: mapping.sheet + 1,
    rows,
    proposals,
    questions,
    ...(rawHeaderRows ? { headerBands } : {}),
    ...(currencyContext ? { currencyContext } : {}),
    ...(originalNumberFormat
      ? {
          originalNumberFormat: {
            status: originalNumberFormat.status,
            candidates: [...originalNumberFormat.candidates],
          },
        }
      : {}),
  };
}

/** Product entry point: caller sheets, pages and issues must agree with a fresh
 * native extraction of the owned original. Nothing is written or normalized. */
export async function inspectSectionContinuation(
  source: SourceFile,
  reading: Mapping,
  extractionRevision: string,
  decimals = 2,
  options: SectionOperationOptions = {},
): Promise<SectionContinuationReview> {
  const operation = new SectionOperation(options);
  operation.preflight(source);
  operation.preflightReading(reading);
  const file = structuredClone(source);
  const mapping = structuredClone(reading);
  validateReading(file, mapping, extractionRevision, decimals);
  if (
    !(file.original instanceof ArrayBuffer) ||
    !/\.pdf$/i.test(file.name) ||
    file.kind ||
    file.visual
  )
    throw new Error('Section review needs original native PDF bytes.');
  operation.check();
  const currentHash = await hash(file.original);
  operation.check();
  if (currentHash !== file.sha256)
    throw new Error('Section source hash does not match original bytes.');
  const fresh = await readFile(
    file.name,
    file.original,
    file.pdf!.autoColumns ? [] : file.pdf!.cuts,
    !!file.pdf!.autoColumns,
    (progress) => operation.progress(progress),
  );
  operation.preflight(fresh);
  if (
    fresh.sha256 !== currentHash ||
    JSON.stringify(fresh.sheets) !== JSON.stringify(file.sheets) ||
    JSON.stringify(fresh.pdf) !== JSON.stringify(file.pdf)
  )
    throw new Error(
      'Section extraction differs from the fresh original; reread the source.',
    );
  const review = await proposeSectionContinuationFromExtraction(
    fresh,
    mapping,
    extractionRevision,
    decimals,
    operation.continuationOptions(),
  );
  operation.check();
  return { ...review, sourceVerified: true };
}

/** Reject a stale or edited review instead of treating a saved proposal as proof. */
export async function revalidateSectionContinuation(
  review: SectionContinuationReview,
  file: SourceFile,
  mapping: Mapping,
  extractionRevision: string,
  decimals = 2,
  options: SectionOperationOptions = {},
): Promise<SectionContinuationReview> {
  const operation = new SectionOperation(options);
  const fresh = await inspectSectionContinuation(
    file,
    mapping,
    extractionRevision,
    decimals,
    operation.continuationOptions(),
  );
  operation.check();
  if (JSON.stringify(review) !== JSON.stringify(fresh))
    throw new Error(
      'Section review is stale or altered; inspect the current source.',
    );
  return fresh;
}
