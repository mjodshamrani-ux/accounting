import { readFile, validateCellText } from './io.ts';
import type { Mapping, SourceFile } from './types.ts';
import {
  SectionOperation,
  SectionOperationError,
  type SectionOperationOptions,
  type SectionCellEvidence,
} from './section-continuation.ts';

export const SPLIT_SECTION_VERSION = 'P4_SPLIT_SECTION_SAR2_V1';
export type SplitReadingContext = {
  mapping: Mapping;
  currency: 'SAR';
  decimals: 2;
  perspective: 'debit-minus-credit';
  extractionRevision: string;
};
export type SplitOptions = SectionOperationOptions & {
  /** Explicit audit adapter for original row identity. Native rows are canonical
   * array positions; this never repairs or sorts a noncanonical inventory. */
  inventoryOriginalRows?: readonly number[];
  /** Source proofs for the two money cells of each movement, including zeros.
   * This exact unit is independent of the generic all-evidence budget. */
  maxMoneyEvidenceCells?: number;
};
export type SplitCellEvidence = SectionCellEvidence & {
  cellText: string;
  spanStartInclusive: number;
  spanEndExclusive: number;
  spanText: string;
};
export type SplitRowKind =
  | 'unclassified'
  | 'synthetic'
  | 'currency'
  | 'header'
  | 'parent'
  | 'continuation'
  | 'separator'
  | 'movement'
  | 'section-total'
  | 'page-total'
  | 'grand-total'
  | 'carried'
  | 'brought';
export type SplitProposal = {
  id: string;
  reference: string;
  evidence: {
    target: SplitCellEvidence;
    parent: SplitCellEvidence;
    continuations: SplitCellEvidence[];
    headers: SplitCellEvidence[][];
  };
};
export type SplitMovement = {
  originalRow: number;
  page: number;
  derivedRow: number;
  reference: string;
  referenceOrigin: 'explicit-source-cell' | 'accepted-section-proposal';
  date: string;
  description: string;
  debit: string;
  credit: string;
  debitMinor: string;
  creditMinor: string;
  referenceEvidence: SplitCellEvidence;
  dateEvidence: SplitCellEvidence;
  descriptionEvidence: SplitCellEvidence;
  debitEvidence: SplitCellEvidence;
  creditEvidence: SplitCellEvidence;
  proposalId?: string;
};
export type SplitReview = {
  version: typeof SPLIT_SECTION_VERSION;
  sourceHash: string;
  extractionHash: string;
  contextHash: string;
  extractionRevision: string;
  sheet: number;
  sourceVerified: boolean;
  state: 'review-ready' | 'blocked';
  financialApproval: false;
  scopeConfirmed: false;
  rows: {
    originalRow: number;
    page: number;
    values: string[];
    kind: SplitRowKind;
    derivedRow: number | null;
  }[];
  movements: SplitMovement[];
  proposals: SplitProposal[];
  headerEvidence: SplitCellEvidence[][];
  currencyEvidence: SplitCellEvidence[];
  totals: {
    originalRow: number;
    page: number;
    role: string;
    expectedDebitMinor: string;
    expectedCreditMinor: string;
    actualDebitMinor: string;
    actualCreditMinor: string;
    debitEvidence: SplitCellEvidence;
    creditEvidence: SplitCellEvidence;
  }[];
  grossDebitMinor: string;
  grossCreditMinor: string;
  netMinor: string;
  diagnostics: {
    code: string;
    stage: 'structure' | 'money' | 'aggregate' | 'source-revalidation';
    row?: number;
    message: string;
  }[];
};
const HEADER = ['Date', 'Reference', 'Description', 'Debit', 'Credit'];
const LIMIT = 100000000000000n;
const ID = '[A-Za-z0-9][A-Za-z0-9._/-]{0,63}';
const PARENT = new RegExp(`^Invoice: (${ID})$`);
const SOURCE_KEYS = [
  'name',
  'sheets',
  'original',
  'sha256',
  'pdf',
  'kind',
  'visual',
];
const SHEET_KEYS = [
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
];
const MAPPING_KEYS = [
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
];

function record(value: unknown, allowed?: readonly string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new SectionOperationError('resource-limit');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 20000) throw new SectionOperationError('resource-limit');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (
      typeof key !== 'string' ||
      key.length > 128 ||
      (allowed && !allowed.includes(key)) ||
      !Object.hasOwn(descriptor, 'value') ||
      !descriptor.enumerable
    )
      throw new SectionOperationError('resource-limit');
  }
}

/** Allocation guard only. No getter is invoked and no data is authentic here. */
export function guardSplitPlain(value: unknown, check: () => void = () => {}) {
  let nodes = 0,
    chars = 0;
  const seen = new Set<object>();
  const visit = (current: unknown, depth: number): void => {
    if (++nodes > 1000000 || depth > 14)
      throw new SectionOperationError('resource-limit');
    if (nodes % 256 === 0) check();
    if (
      current === null ||
      current === undefined ||
      typeof current === 'boolean'
    )
      return;
    if (typeof current === 'number' && Number.isFinite(current)) return;
    if (typeof current === 'string') {
      chars += current.length;
      if (current.length > 32767 || chars > 10000000)
        throw new SectionOperationError('resource-limit');
      return;
    }
    if (current instanceof ArrayBuffer) {
      if (
        Object.getPrototypeOf(current) !== ArrayBuffer.prototype ||
        Reflect.ownKeys(current).length ||
        current.byteLength > 8 * 1024 * 1024
      )
        throw new SectionOperationError('resource-limit');
      return;
    }
    if (typeof current !== 'object' || seen.has(current))
      throw new SectionOperationError('resource-limit');
    seen.add(current);
    if (Array.isArray(current)) {
      if (
        Object.getPrototypeOf(current) !== Array.prototype ||
        current.length > 65536 ||
        Reflect.ownKeys(current).length !== current.length + 1
      )
        throw new SectionOperationError('resource-limit');
      for (let i = 0; i < current.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(i));
        if (!descriptor || !Object.hasOwn(descriptor, 'value'))
          throw new SectionOperationError('resource-limit');
        visit(descriptor.value, depth + 1);
      }
    } else {
      record(current);
      for (const key of Object.keys(current)) {
        chars += key.length;
        if (chars > 10000000) throw new SectionOperationError('resource-limit');
        visit(Object.getOwnPropertyDescriptor(current, key)!.value, depth + 1);
      }
    }
    seen.delete(current);
  };
  check();
  visit(value, 0);
  check();
}

export function checkSplitOptions(options: SplitOptions = {}) {
  const operation = new SectionOperation(options);
  splitMoneyBudget(options);
  return operation;
}
function splitMoneyBudget(options: SplitOptions) {
  const descriptor = Object.getOwnPropertyDescriptor(
    options,
    'maxMoneyEvidenceCells',
  );
  if (descriptor && !Object.hasOwn(descriptor, 'value'))
    throw new SectionOperationError('invalid-budget');
  const limit = descriptor?.value ?? 65536;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 65536)
    throw new SectionOperationError('invalid-budget');
  return limit as number;
}
export class SplitContextError extends Error {
  readonly code = 'SPLIT_CONTEXT';
  readonly stage = 'reading-context';
  constructor() {
    super(
      'Split section reading requires literal five-column SAR2 transactions and debit-minus-credit perspective.',
    );
    this.name = 'SplitContextError';
  }
}
export function validateSplitReadingContext(context: SplitReadingContext) {
  record(context, [
    'mapping',
    'currency',
    'decimals',
    'perspective',
    'extractionRevision',
  ]);
  guardSplitPlain(context);
  record(context.mapping, MAPPING_KEYS);
  const m = context.mapping;
  if (
    context.currency !== 'SAR' ||
    context.decimals !== 2 ||
    context.perspective !== 'debit-minus-credit' ||
    typeof context.extractionRevision !== 'string' ||
    !context.extractionRevision.trim() ||
    context.extractionRevision.length > 200 ||
    m.sheet !== 0 ||
    m.header !== 2 ||
    m.date !== 0 ||
    m.reference !== 1 ||
    m.description !== 2 ||
    m.debit !== 3 ||
    m.credit !== 4 ||
    m.amount !== -1 ||
    m.currencyColumn !== -1 ||
    m.mode !== 'split' ||
    m.multiplier !== 1 ||
    m.numberFormat !== 'dot' ||
    m.dateFormat !== 'ymd' ||
    m.reportType !== 'transactions' ||
    m.opening !== '' ||
    m.closing !== '' ||
    m.periodStart !== '' ||
    m.directionEvidence !== undefined ||
    m.formatChoice !== undefined ||
    !m.excluded ||
    Object.keys(m.excluded).length
  )
    throw new SplitContextError();
  try {
    validateCellText(context.extractionRevision);
  } catch {
    throw new SplitContextError();
  }
}

/** Synchronous ownership boundary: pre-abort precedes every source access. */
export function snapshotSplitInputs(
  source: SourceFile,
  context: SplitReadingContext,
  options: SplitOptions = {},
) {
  const operation = checkSplitOptions(options);
  operation.check();
  record(source, SOURCE_KEYS);
  guardSplitPlain(source, () => operation.check());
  record(context, [
    'mapping',
    'currency',
    'decimals',
    'perspective',
    'extractionRevision',
  ]);
  guardSplitPlain(context, () => operation.check());
  validateSplitReadingContext(context);
  if (
    !(source.original instanceof ArrayBuffer) ||
    source.original.byteLength > operation.budgets.maxOriginalBytes ||
    !Array.isArray(source.sheets) ||
    source.sheets.length !== 1
  )
    throw new SectionOperationError('resource-limit');
  if (source.pdf) {
    record(source.pdf, ['cuts', 'pages', 'autoColumns']);
    if (
      source.pdf.pages > operation.budgets.maxPages ||
      !Array.isArray(source.pdf.cuts) ||
      source.pdf.cuts.length > 19
    )
      throw new SectionOperationError('resource-limit');
  }
  let count = 0;
  for (const sheet of source.sheets) {
    record(sheet, SHEET_KEYS);
    if (!Array.isArray(sheet.rows))
      throw new SectionOperationError('resource-limit');
    count += sheet.rows.length;
    if (count > operation.budgets.maxRows)
      throw new SectionOperationError('resource-limit');
    for (const row of sheet.rows) {
      if (
        !Array.isArray(row) ||
        row.length > 20 ||
        row.some((cell) => typeof cell !== 'string' || cell.length > 32767)
      )
        throw new SectionOperationError('resource-limit');
    }
  }
  operation.check();
  const originalRowsDescriptor = Object.getOwnPropertyDescriptor(
    options,
    'inventoryOriginalRows',
  );
  if (originalRowsDescriptor && !Object.hasOwn(originalRowsDescriptor, 'value'))
    throw new SectionOperationError('resource-limit');
  const originalRows = originalRowsDescriptor?.value as
    | readonly number[]
    | undefined;
  if (originalRows !== undefined) {
    guardSplitPlain(originalRows, () => operation.check());
    if (
      !Array.isArray(originalRows) ||
      originalRows.length > operation.budgets.maxRows
    )
      throw new SectionOperationError('resource-limit');
  }
  return {
    source: structuredClone(source),
    context: structuredClone(context),
    classificationOptions: {
      inventoryOriginalRows: originalRows ? [...originalRows] : undefined,
      maxMoneyEvidenceCells: splitMoneyBudget(options),
    },
  };
}
export async function digestSplit(value: string | ArrayBuffer) {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
class SplitRefusal extends Error {
  readonly code: string;
  readonly row?: number;
  constructor(code: string, row?: number) {
    super(code);
    this.code = code;
    this.row = row;
  }
}
function refuse(code: string, row?: number): never {
  throw new SplitRefusal(code, row);
}
function money(text: string, row: number) {
  if (!text) refuse('SPLIT_MISSING_SIDE', row);
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(text)) refuse('SPLIT_MONEY_FORMAT', row);
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > 2) refuse('SPLIT_MONEY_PRECISION', row);
  // Bound conversion before allocating an integer for a huge literal.
  const significant = whole.replace(/^0+/, '') || '0';
  if (significant.length > 13) refuse('SPLIT_MONEY_LIMIT', row);
  const value = BigInt(significant) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (value > LIMIT) refuse('SPLIT_MONEY_LIMIT', row);
  return value;
}
function validDate(text: string) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1)
    return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return (
    day <=
    [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  );
}
function diagnostic(error: SplitRefusal): SplitReview['diagnostics'][number] {
  const moneyCodes = [
    'SPLIT_DOUBLE_AMOUNT',
    'SPLIT_MISSING_SIDE',
    'SPLIT_MONEY_FORMAT',
    'SPLIT_MONEY_PRECISION',
    'SPLIT_MONEY_LIMIT',
    'SPLIT_DATE',
  ];
  const aggregateCodes = [
    'SPLIT_SECTION_TOTAL',
    'SPLIT_PAGE_TOTAL',
    'SPLIT_GRAND_TOTAL',
    'SPLIT_CARRY_TOTAL',
  ];
  return {
    code: error.code,
    stage: error.code.startsWith('SPLIT_SOURCE_')
      ? 'source-revalidation'
      : moneyCodes.includes(error.code)
        ? 'money'
        : aggregateCodes.includes(error.code)
          ? 'aggregate'
          : 'structure',
    ...(error.row ? { row: error.row } : {}),
    message: error.code,
  };
}
function block(review: SplitReview, error: SplitRefusal) {
  review.state = 'blocked';
  review.diagnostics.push(diagnostic(error));
  review.movements = [];
  review.proposals = [];
  review.grossDebitMinor = review.grossCreditMinor = review.netMinor = '0';
  for (const row of review.rows) row.derivedRow = null;
  return review;
}

async function classifyOwned(
  source: SourceFile,
  context: SplitReadingContext,
  operation: SectionOperation,
  originalRows?: readonly number[],
  maxMoneyEvidenceCells = 65536,
): Promise<SplitReview> {
  const sheet = source.sheets[0];
  const sourceHash = source.sha256 ?? '';
  const extractionHash = await digestSplit(
    JSON.stringify({
      version: SPLIT_SECTION_VERSION,
      sourceHash,
      sheets: source.sheets,
      pdf: source.pdf,
      extractionRevision: context.extractionRevision,
    }),
  );
  operation.check();
  const contextHash = await digestSplit(
    JSON.stringify({
      version: SPLIT_SECTION_VERSION,
      sourceHash,
      extractionHash,
      context,
    }),
  );
  operation.check();
  const review: SplitReview = {
    version: SPLIT_SECTION_VERSION,
    sourceHash,
    extractionHash,
    contextHash,
    extractionRevision: context.extractionRevision,
    sheet: 1,
    sourceVerified: false,
    state: 'review-ready',
    financialApproval: false,
    scopeConfirmed: false,
    rows: sheet.rows.map((values, i) => ({
      originalRow: i + 1,
      page: sheet.rowPages?.[String(i + 1)] ?? 0,
      values: [...values],
      kind: 'unclassified',
      derivedRow: null,
    })),
    movements: [],
    proposals: [],
    headerEvidence: [],
    currencyEvidence: [],
    totals: [],
    grossDebitMinor: '0',
    grossCreditMinor: '0',
    netMinor: '0',
    diagnostics: [],
  };
  const evidence = (
    row: number,
    column: number,
    start = 0,
    end?: number,
  ): SplitCellEvidence => {
    operation.evidence(1);
    const entry = review.rows[row - 1];
    const literal = entry.values[column - 1];
    const stop = end ?? literal.length;
    return {
      sourceHash,
      extractionHash,
      extractionRevision: context.extractionRevision,
      sheet: 1,
      row,
      page: entry.page,
      column,
      literal,
      cellText: literal,
      spanStartInclusive: start,
      spanEndExclusive: stop,
      spanText: literal.slice(start, stop),
    };
  };
  const same = (values: string[], expected: string[]) =>
    values.length === expected.length &&
    values.every((value, i) => value === expected[i]);
  const mark = (row: number, kind: SplitRowKind) => {
    review.rows[row - 1].kind = kind;
  };
  let processed = 0;
  const tick = async () => {
    await operation.checkpoint(++processed, review.rows.length, 'classify');
  };
  try {
    const pages = source.pdf?.pages;
    if (
      originalRows &&
      (originalRows.length !== review.rows.length ||
        originalRows.some((row, index) => row !== index + 1))
    )
      refuse('SPLIT_PAGE_MAP');
    if (
      !Number.isInteger(pages) ||
      !pages ||
      pages < 1 ||
      pages > 100 ||
      !review.rows.length ||
      !sheet.rowPages ||
      Object.keys(sheet.rowPages).length !== review.rows.length
    )
      refuse('SPLIT_PAGE_MAP');
    let previous = 1;
    const seen = new Set<number>();
    for (const entry of review.rows) {
      if (
        !Number.isInteger(entry.page) ||
        entry.page < previous ||
        entry.page > pages
      )
        refuse('SPLIT_PAGE_MAP', entry.originalRow);
      seen.add(entry.page);
      previous = entry.page;
    }
    if (seen.size !== pages) refuse('SPLIT_PAGE_MAP');
    for (const row of review.rows)
      if (row.values.length !== 5) refuse('SPLIT_COLUMNS', row.originalRow);
    if (
      !source.pdf ||
      source.pdf.autoColumns ||
      source.pdf.cuts.length !== 4 ||
      source.pdf.cuts.some(
        (cut, i, cuts) =>
          !Number.isFinite(cut) ||
          cut <= 0 ||
          cut >= 100 ||
          (i > 0 && cut <= cuts[i - 1]),
      )
    )
      refuse('SPLIT_COLUMNS');
    if (
      !/\.pdf$/i.test(source.name) ||
      source.kind ||
      source.visual ||
      !/^[a-f0-9]{64}$/.test(sourceHash)
    )
      refuse('SPLIT_SOURCE');
    if (
      sheet.hiddenRows.length ||
      sheet.formulaRows.length ||
      Object.keys(sheet.formulaCells ?? {}).length ||
      Object.values(sheet.rowIssues ?? {}).some((v) => v.length) ||
      Object.values(sheet.cellIssues ?? {}).some((v) => v.length)
    )
      refuse('SPLIT_SOURCE_ISSUES');
    const buckets = Array.from(
      { length: pages },
      () => [] as SplitReview['rows'],
    );
    for (const row of review.rows) buckets[row.page - 1].push(row);
    let active: string | null = null;
    let pending: [bigint, bigint] | null = null;
    let grand = false,
      grossDebit = 0n,
      grossCredit = 0n;
    const groups = new Map<
      string,
      {
        debit: bigint;
        credit: bigint;
        parent: number;
        continuations: number[];
        headers: number[];
      }
    >();
    for (let pn = 1; pn <= pages; pn++) {
      operation.check();
      const rows = buckets[pn - 1];
      if (!same(rows[0].values, ['SYNTHETIC ONLY', '', '', '', '']))
        refuse('SPLIT_PAGE_HEADER', rows[0].originalRow);
      mark(rows[0].originalRow, 'synthetic');
      await tick();
      let offset = 1;
      if (pn === 1) {
        if (
          rows.length < 2 ||
          !same(rows[1].values, ['Currency: SAR', '', '', '', ''])
        )
          refuse('SPLIT_CURRENCY', rows[1]?.originalRow);
        mark(rows[1].originalRow, 'currency');
        review.currencyEvidence.push(evidence(rows[1].originalRow, 1));
        await tick();
        offset = 2;
      }
      if (rows.length <= offset) refuse('SPLIT_PAGE_HEADER');
      if (!same(rows[offset].values, HEADER))
        refuse('SPLIT_HEADER', rows[offset].originalRow);
      const firstHeader = rows[offset].originalRow;
      mark(firstHeader, 'header');
      review.headerEvidence.push(
        HEADER.map((_, i) => evidence(firstHeader, i + 1)),
      );
      await tick();
      if (active) groups.get(active)!.headers.push(firstHeader);
      const body = rows.slice(offset + 1);
      let pd = 0n,
        pc = 0n,
        pageClosed = false,
        carried = false;
      if (pn > 1 && active !== null) {
        if (!body.length) refuse('SPLIT_CONTINUATION');
        const first = body[0].values[0];
        if (first !== `Continued invoice: ${active}` && !PARENT.test(first))
          refuse('SPLIT_CONTINUATION', body[0].originalRow);
        if (pending !== null && first !== `Continued invoice: ${active}`)
          refuse('SPLIT_CARRY_ORPHAN', body[0].originalRow);
      }
      for (let bi = 0; bi < body.length; bi++) {
        const entry = body[bi],
          ri = entry.originalRow,
          v = entry.values,
          text = v[0];
        if (grand) refuse('SPLIT_AFTER_GRAND_TOTAL', ri);
        if (pageClosed && text !== 'Grand total')
          refuse('SPLIT_AFTER_PAGE_TOTAL', ri);
        if (carried && text !== 'Page total') refuse('SPLIT_CARRY_ORPHAN', ri);
        const parent = PARENT.exec(text);
        if (same(v, HEADER)) {
          mark(ri, 'header');
          review.headerEvidence.push(HEADER.map((_, i) => evidence(ri, i + 1)));
          if (active) groups.get(active)!.headers.push(ri);
        } else if (text.startsWith('Currency:')) {
          if (!same(v, ['Currency: SAR', '', '', '', '']))
            refuse('SPLIT_CURRENCY', ri);
          mark(ri, 'currency');
          review.currencyEvidence.push(evidence(ri, 1));
        } else if (v.some((value) => HEADER.includes(value)) && text === 'Date')
          refuse('SPLIT_HEADER', ri);
        else if (parent) {
          if (v.slice(1).some(Boolean)) refuse('SPLIT_UNKNOWN_ROW', ri);
          if (pending !== null) refuse('SPLIT_CARRY_ORPHAN', ri);
          active = parent[1];
          if (groups.has(active)) refuse('SPLIT_DUPLICATE_PARENT', ri);
          groups.set(active, {
            debit: 0n,
            credit: 0n,
            parent: ri,
            continuations: [],
            headers: [firstHeader],
          });
          mark(ri, 'parent');
        } else if (text.startsWith('Continued invoice:')) {
          if (
            pn === 1 ||
            bi !== 0 ||
            active === null ||
            text !== `Continued invoice: ${active}` ||
            v.slice(1).some(Boolean)
          )
            refuse('SPLIT_CONTINUATION', ri);
          groups.get(active)!.continuations.push(ri);
          mark(ri, 'continuation');
        } else if (text === '---' && !v.slice(1).some(Boolean)) {
          active = null;
          mark(ri, 'separator');
        } else if (
          ['Opening balance', 'Closing balance', 'Running balance'].includes(
            text,
          )
        )
          refuse('SPLIT_BALANCE_UNSUPPORTED', ri);
        else if (
          text.startsWith('Section total:') ||
          [
            'Page total',
            'Grand total',
            'Carried forward',
            'Brought forward',
          ].includes(text)
        ) {
          if (v[1] || v[2]) refuse('SPLIT_UNKNOWN_ROW', ri);
          const d = money(v[3], ri),
            c = money(v[4], ri);
          let expectedD = 0n,
            expectedC = 0n,
            code = '',
            kind: SplitRowKind;
          if (text.startsWith('Section total:')) {
            if (active === null || text !== `Section total: ${active}`)
              refuse('SPLIT_SECTION_TOTAL', ri);
            const g = groups.get(active)!;
            expectedD = g.debit;
            expectedC = g.credit;
            code = 'SPLIT_SECTION_TOTAL';
            kind = 'section-total';
            active = null;
          } else if (text === 'Page total') {
            expectedD = pd;
            expectedC = pc;
            code = 'SPLIT_PAGE_TOTAL';
            kind = 'page-total';
            pageClosed = true;
          } else if (text === 'Grand total') {
            if (pn !== pages) refuse('SPLIT_GRAND_TOTAL', ri);
            expectedD = grossDebit;
            expectedC = grossCredit;
            code = 'SPLIT_GRAND_TOTAL';
            kind = 'grand-total';
            grand = true;
          } else if (text === 'Carried forward') {
            if (active === null || pn === pages || pending !== null)
              refuse('SPLIT_CARRY_ORPHAN', ri);
            const g = groups.get(active)!;
            expectedD = g.debit;
            expectedC = g.credit;
            code = 'SPLIT_CARRY_TOTAL';
            kind = 'carried';
            pending = [d, c];
            carried = true;
          } else {
            if (
              active === null ||
              pending === null ||
              bi !== 1 ||
              body[0].values[0] !== `Continued invoice: ${active}`
            )
              refuse('SPLIT_CARRY_ORPHAN', ri);
            [expectedD, expectedC] = pending;
            pending = null;
            code = 'SPLIT_CARRY_TOTAL';
            kind = 'brought';
          }
          review.totals.push({
            originalRow: ri,
            page: pn,
            role: text,
            expectedDebitMinor: expectedD.toString(),
            expectedCreditMinor: expectedC.toString(),
            actualDebitMinor: d.toString(),
            actualCreditMinor: c.toString(),
            debitEvidence: evidence(ri, 4),
            creditEvidence: evidence(ri, 5),
          });
          if (d !== expectedD || c !== expectedC) refuse(code, ri);
          mark(ri, kind);
        } else if (/^[0-9]/.test(text) || (!text && (v[3] || v[4]))) {
          if (active === null) refuse('SPLIT_NO_PARENT', ri);
          if (pending !== null) refuse('SPLIT_CARRY_ORPHAN', ri);
          if (!validDate(text)) refuse('SPLIT_DATE', ri);
          if (v[1] && v[1] !== active) refuse('SPLIT_REFERENCE_CONFLICT', ri);
          const d = money(v[3], ri),
            c = money(v[4], ri);
          if (d > 0n && c > 0n) refuse('SPLIT_DOUBLE_AMOUNT', ri);
          pd += d;
          pc += c;
          grossDebit += d;
          grossCredit += c;
          const g = groups.get(active)!;
          g.debit += d;
          g.credit += c;
          if (
            [pd, pc, grossDebit, grossCredit, g.debit, g.credit].some(
              (value) => value > LIMIT,
            )
          )
            refuse('SPLIT_MONEY_LIMIT', ri);
          // Refuse before creating either proof when the next movement's exact
          // two-cell requirement exceeds the owned budget. Totals do not count.
          if ((review.movements.length + 1) * 2 > maxMoneyEvidenceCells)
            throw new SectionOperationError('resource-limit');
          const move: SplitMovement = {
            originalRow: ri,
            page: pn,
            derivedRow: review.movements.length + 2,
            reference: active,
            referenceOrigin: v[1]
              ? 'explicit-source-cell'
              : 'accepted-section-proposal',
            date: text,
            description: v[2],
            debit: v[3],
            credit: v[4],
            debitMinor: d.toString(),
            creditMinor: c.toString(),
            referenceEvidence: v[1]
              ? evidence(ri, 2)
              : evidence(g.parent, 1, 'Invoice: '.length),
            dateEvidence: evidence(ri, 1),
            descriptionEvidence: evidence(ri, 3),
            debitEvidence: evidence(ri, 4),
            creditEvidence: evidence(ri, 5),
          };
          if (!v[1]) {
            operation.proposal();
            const id = `${extractionHash}:${ri}`;
            move.proposalId = id;
            review.proposals.push({
              id,
              reference: active,
              evidence: {
                target: evidence(ri, 2),
                parent: move.referenceEvidence,
                continuations: g.continuations.map((row) =>
                  evidence(row, 1, 'Continued invoice: '.length),
                ),
                headers: g.headers.map((row) =>
                  HEADER.map((_, i) => evidence(row, i + 1)),
                ),
              },
            });
          }
          review.movements.push(move);
          mark(ri, 'movement');
          entry.derivedRow = move.derivedRow;
        } else refuse('SPLIT_UNKNOWN_ROW', ri);
        await tick();
      }
    }
    if (pending !== null) refuse('SPLIT_CARRY_ORPHAN');
    if (!review.movements.length) refuse('SPLIT_NO_MOVEMENTS');
    review.grossDebitMinor = grossDebit.toString();
    review.grossCreditMinor = grossCredit.toString();
    review.netMinor = (grossDebit - grossCredit).toString();
  } catch (error) {
    if (!(error instanceof SplitRefusal)) throw error;
    block(review, error);
  }
  operation.check();
  return review;
}

/** Unit-only metadata classification. It never claims native verification. */
export async function classifySplitExtraction(
  source: SourceFile,
  context: SplitReadingContext,
  options: SplitOptions = {},
) {
  const owned = snapshotSplitInputs(source, context, options);
  return classifyOwned(
    owned.source,
    owned.context,
    checkSplitOptions(options),
    owned.classificationOptions.inventoryOriginalRows,
    owned.classificationOptions.maxMoneyEvidenceCells,
  );
}

/** Native entry point; authority requires original bytes and exact fresh facts. */
export async function inspectSplitSection(
  source: SourceFile,
  context: SplitReadingContext,
  options: SplitOptions = {},
) {
  const owned = snapshotSplitInputs(source, context, options);
  const file = owned.source,
    operation = checkSplitOptions(options);
  const review = await classifyOwned(
    file,
    owned.context,
    operation,
    owned.classificationOptions.inventoryOriginalRows,
    owned.classificationOptions.maxMoneyEvidenceCells,
  );
  const hash = await digestSplit(file.original!);
  operation.check();
  if (hash !== file.sha256)
    return block(review, new SplitRefusal('SPLIT_SOURCE_HASH'));
  const fresh = await readFile(
    file.name,
    file.original!,
    file.pdf?.cuts,
    false,
    (progress) => operation.progress(progress),
    32767,
  );
  operation.check();
  snapshotSplitInputs(fresh, owned.context, {
    ...operation.continuationOptions(),
    ...owned.classificationOptions,
  });
  if (
    fresh.pdf?.pages !== file.pdf?.pages ||
    JSON.stringify(fresh.sheets[0].rowPages) !==
      JSON.stringify(file.sheets[0].rowPages)
  ) {
    review.diagnostics = [];
    return block(review, new SplitRefusal('SPLIT_PAGE_MAP'));
  }
  if (review.state === 'blocked') return review;
  if (
    fresh.sha256 !== hash ||
    JSON.stringify(fresh.sheets) !== JSON.stringify(file.sheets) ||
    JSON.stringify(fresh.pdf) !== JSON.stringify(file.pdf)
  )
    return block(review, new SplitRefusal('SPLIT_SOURCE_CHANGED'));
  operation.check();
  review.sourceVerified = true;
  return review;
}
