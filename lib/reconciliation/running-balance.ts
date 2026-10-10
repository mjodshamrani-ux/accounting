import { readFile, validateCellText } from './io.ts';
import type { SourceFile } from './types.ts';
import {
  SectionOperation,
  SectionOperationError,
  SECTION_RESOURCE_BUDGETS,
  type SectionOperationOptions,
  type SectionResourceBudgets,
  type SectionCellEvidence,
} from './section-continuation.ts';

export const RUNNING_BALANCE_VERSION = 'P4_RUNNING_BALANCE_SAR2_V1';
export const RUNNING_COLUMNS = Object.freeze({
  seq: 0,
  date: 1,
  reference: 2,
  description: 3,
  debit: 4,
  credit: 5,
  balance: 6,
} as const);
export const RUNNING_CUTS = Object.freeze([10, 25, 40, 65, 77, 88]);
export type RunningBalanceContext = {
  columns: typeof RUNNING_COLUMNS;
  currency: 'SAR';
  decimals: 2;
  perspective: 'debit-minus-credit';
  extractionRevision: string;
};
export type RunningBudgets = SectionResourceBudgets & {
  maxCellTextUnits: number;
  maxCsvBytes: number;
  maxPlainNodes: number;
  maxPlainTextUnits: number;
  maxPlainDepth: number;
};
export const RUNNING_RESOURCE_BUDGETS: Readonly<RunningBudgets> = Object.freeze(
  {
    ...SECTION_RESOURCE_BUDGETS,
    maxCellTextUnits: 32767,
    maxCsvBytes: 8 * 1024 * 1024,
    maxPlainNodes: 1000000,
    maxPlainTextUnits: 10000000,
    maxPlainDepth: 14,
  },
);
export type RunningOptions = Omit<SectionOperationOptions, 'budgets'> & {
  budgets?: Partial<RunningBudgets>;
  inventoryOriginalRows?: readonly number[];
};
export type RunningCellEvidence = SectionCellEvidence & {
  cellText: string;
  spanStartInclusive: number;
  spanEndExclusive: number;
  spanText: string;
};
export type RunningProposal = {
  id: string;
  reference: string;
  evidence: {
    target: RunningCellEvidence;
    parent: RunningCellEvidence;
    continuations: RunningCellEvidence[];
    headers: RunningCellEvidence[][];
  };
};
export type RunningMovement = {
  originalRow: number;
  page: number;
  derivedRow: number;
  seq: string;
  reference: string;
  referenceOrigin: 'explicit-source-cell' | 'accepted-section-proposal';
  date: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
  debitMinor: string;
  creditMinor: string;
  balanceMinor: string;
  seqEvidence: RunningCellEvidence;
  dateEvidence: RunningCellEvidence;
  referenceEvidence: RunningCellEvidence;
  descriptionEvidence: RunningCellEvidence;
  debitEvidence: RunningCellEvidence;
  creditEvidence: RunningCellEvidence;
  balanceEvidence: RunningCellEvidence;
  parentEvidence: RunningCellEvidence;
  continuationEvidence: RunningCellEvidence[];
  proposalId?: string;
};
export type RunningBalanceStep = {
  originalRow: number;
  page: number;
  previousProvidedMinor: string | null;
  debitProvidedMinor: string | null;
  creditProvidedMinor: string | null;
  nextProvidedMinor: string | null;
  computedMinor: string | null;
  differenceMinor: string | null;
  previousEvidence: RunningCellEvidence | null;
  debitEvidence: RunningCellEvidence;
  creditEvidence: RunningCellEvidence;
  nextEvidence: RunningCellEvidence;
};
export type RunningControl = {
  originalRow: number;
  page: number;
  role: string;
  evidence: RunningCellEvidence[];
  members: RunningCellEvidence[];
  providedMinor: string | null;
  expectedMinor: string | null;
  differenceMinor: string | null;
  debitProvidedMinor?: string | null;
  creditProvidedMinor?: string | null;
  debitExpectedMinor?: string;
  creditExpectedMinor?: string;
  debitDifferenceMinor?: string | null;
  creditDifferenceMinor?: string | null;
};
export type RunningReview = {
  version: typeof RUNNING_BALANCE_VERSION;
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
    kind: string;
    derivedRow: number | null;
  }[];
  movements: RunningMovement[];
  proposals: RunningProposal[];
  headerEvidence: RunningCellEvidence[][];
  metadataEvidence: RunningCellEvidence[];
  declaredScope: {
    statement: string;
    account: string;
    periodStart: string;
    periodEnd: string;
    evidence: RunningCellEvidence[];
  } | null;
  balanceSteps: RunningBalanceStep[];
  controls: RunningControl[];
  openingMinor: string | null;
  closingMinor: string | null;
  grossDebitMinor: string;
  grossCreditMinor: string;
  netMinor: string;
  diagnostics: {
    code: string;
    stage: 'structure' | 'money' | 'aggregate' | 'source-revalidation';
    row?: number;
    page?: number;
    message: string;
    evidence: RunningCellEvidence[];
  }[];
};

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
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if (
      typeof key !== 'string' ||
      key.length > 128 ||
      (allowed && !allowed.includes(key)) ||
      !Object.hasOwn(d, 'value') ||
      !d.enumerable
    )
      throw new SectionOperationError('resource-limit');
  }
}
function precheckOptions(options: RunningOptions) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new SectionOperationError('resource-limit');
  const signal = Object.getOwnPropertyDescriptor(options, 'signal');
  if (signal && !Object.hasOwn(signal, 'value'))
    throw new SectionOperationError('resource-limit');
  if (signal?.value !== undefined) {
    const value = signal.value;
    let isAborted: boolean;
    try {
      isAborted = Object.getOwnPropertyDescriptor(
        AbortSignal.prototype,
        'aborted',
      )!.get!.call(value) as boolean;
    } catch {
      throw new SectionOperationError('resource-limit');
    }
    if (isAborted) throw new SectionOperationError('cancelled');
    if (Object.hasOwn(value, 'aborted'))
      throw new SectionOperationError('resource-limit');
  }
  const generation = Object.getOwnPropertyDescriptor(options, 'checkCurrent');
  if (
    generation &&
    (!Object.hasOwn(generation, 'value') ||
      (generation.value !== undefined &&
        typeof generation.value !== 'function'))
  )
    throw new SectionOperationError('resource-limit');
  generation?.value?.();
}
export function runningBudgets(
  options: RunningOptions = {},
): Readonly<RunningBudgets> {
  precheckOptions(options);
  record(options, [
    'signal',
    'budgets',
    'onProgress',
    'checkCurrent',
    'inventoryOriginalRows',
  ]);
  if (
    options.onProgress !== undefined &&
    typeof options.onProgress !== 'function'
  )
    throw new SectionOperationError('resource-limit');
  const result = { ...RUNNING_RESOURCE_BUDGETS };
  if (options.budgets) {
    record(options.budgets, Object.keys(result));
    for (const [key, value] of Object.entries(options.budgets)) {
      if (
        !Number.isSafeInteger(value) ||
        value! <= 0 ||
        value! > result[key as keyof RunningBudgets]
      )
        throw new SectionOperationError('invalid-budget');
      result[key as keyof RunningBudgets] = value!;
    }
  }
  return Object.freeze(result);
}
export function checkRunningOptions(options: RunningOptions = {}) {
  const budgets = runningBudgets(options);
  const base = Object.fromEntries(
    Object.keys(SECTION_RESOURCE_BUDGETS).map((key) => [
      key,
      budgets[key as keyof RunningBudgets],
    ]),
  );
  return new SectionOperation({
    signal: options.signal,
    onProgress: options.onProgress,
    checkCurrent: options.checkCurrent,
    budgets: base,
  });
}
/** Allocation guard only; descriptors are inspected before any property value. */
export function guardRunningPlain(
  value: unknown,
  check: () => void = () => {},
  budgets: Partial<RunningBudgets> = {},
) {
  const limits = runningBudgets({ budgets });
  let nodes = 0,
    chars = 0;
  const seen = new Set<object>();
  const visit = (current: unknown, depth: number): void => {
    if (++nodes > limits.maxPlainNodes || depth > limits.maxPlainDepth)
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
      if (
        current.length > limits.maxCellTextUnits ||
        chars > limits.maxPlainTextUnits
      )
        throw new SectionOperationError('resource-limit');
      return;
    }
    if (current instanceof ArrayBuffer) {
      if (
        Object.getPrototypeOf(current) !== ArrayBuffer.prototype ||
        Reflect.ownKeys(current).length ||
        current.byteLength > limits.maxOriginalBytes
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
      chars += 'length'.length;
      if (chars > limits.maxPlainTextUnits)
        throw new SectionOperationError('resource-limit');
      for (let i = 0; i < current.length; i++) {
        const key = String(i);
        chars += key.length;
        if (chars > limits.maxPlainTextUnits)
          throw new SectionOperationError('resource-limit');
        const d = Object.getOwnPropertyDescriptor(current, key);
        if (!d || !Object.hasOwn(d, 'value') || !d.enumerable)
          throw new SectionOperationError('resource-limit');
        visit(d.value, depth + 1);
      }
    } else {
      record(current);
      for (const key of Object.keys(current)) {
        chars += key.length;
        if (chars > limits.maxPlainTextUnits)
          throw new SectionOperationError('resource-limit');
        visit(Object.getOwnPropertyDescriptor(current, key)!.value, depth + 1);
      }
    }
    seen.delete(current);
  };
  check();
  visit(value, 0);
  check();
}
export function validateRunningBalanceContext(context: RunningBalanceContext) {
  record(context, [
    'columns',
    'currency',
    'decimals',
    'perspective',
    'extractionRevision',
  ]);
  guardRunningPlain(context);
  record(context.columns, Object.keys(RUNNING_COLUMNS));
  if (
    context.currency !== 'SAR' ||
    context.decimals !== 2 ||
    context.perspective !== 'debit-minus-credit' ||
    typeof context.extractionRevision !== 'string' ||
    !context.extractionRevision.trim() ||
    context.extractionRevision.length > 200 ||
    Object.keys(context.columns).length !== 7 ||
    Object.entries(RUNNING_COLUMNS).some(
      ([key, value]) =>
        context.columns[key as keyof typeof RUNNING_COLUMNS] !== value,
    )
  )
    throw new Error('RUNNING_CONTEXT');
  validateCellText(context.extractionRevision);
}
export function snapshotRunningInputs(
  source: SourceFile,
  context: RunningBalanceContext,
  options: RunningOptions = {},
) {
  const operation = checkRunningOptions(options),
    budgets = runningBudgets(options);
  operation.check();
  record(source, [
    'name',
    'sheets',
    'original',
    'sha256',
    'pdf',
    'kind',
    'visual',
  ]);
  guardRunningPlain(source, () => operation.check(), budgets);
  guardRunningPlain(context, () => operation.check(), budgets);
  validateRunningBalanceContext(context);
  if (
    !(source.original instanceof ArrayBuffer) ||
    source.original.byteLength > budgets.maxOriginalBytes ||
    !Array.isArray(source.sheets) ||
    source.sheets.length !== 1 ||
    source.sheets[0].rows.length > budgets.maxRows
  )
    throw new SectionOperationError('resource-limit');
  if (source.pdf) {
    record(source.pdf, ['cuts', 'pages', 'autoColumns']);
    if (
      !Number.isSafeInteger(source.pdf.pages) ||
      source.pdf.pages < 1 ||
      source.pdf.pages > budgets.maxPages ||
      source.pdf.cuts.length > 19
    )
      throw new SectionOperationError('resource-limit');
  }
  for (const sheet of source.sheets) {
    record(sheet, [
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
    if (
      !Array.isArray(sheet.rows) ||
      sheet.rows.some(
        (row) =>
          !Array.isArray(row) ||
          row.length > 20 ||
          row.some(
            (cell) =>
              typeof cell !== 'string' ||
              cell.length > budgets.maxCellTextUnits,
          ),
      )
    )
      throw new SectionOperationError('resource-limit');
  }
  if (options.inventoryOriginalRows)
    guardRunningPlain(
      options.inventoryOriginalRows,
      () => operation.check(),
      budgets,
    );
  operation.check();
  return {
    source: structuredClone(source),
    context: structuredClone(context),
    classificationOptions: {
      inventoryOriginalRows: options.inventoryOriginalRows
        ? [...options.inventoryOriginalRows]
        : undefined,
    },
  };
}
export async function digestRunning(value: string | ArrayBuffer) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        typeof value === 'string' ? new TextEncoder().encode(value) : value,
      ),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
const HEADER = [
  'Seq',
  'Date',
  'Reference',
  'Description',
  'Debit',
  'Credit',
  'Balance',
];
const ID = '[A-Za-z0-9][A-Za-z0-9._/-]{0,63}';
const MONEY_LIMIT = 100000000000000n;
function validDate(text: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
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
async function classifyOwned(
  source: SourceFile,
  context: RunningBalanceContext,
  options: RunningOptions,
  operation: SectionOperation,
): Promise<RunningReview> {
  const sourceHash = source.sha256 ?? '';
  const extractionHash = await digestRunning(
    JSON.stringify({
      version: RUNNING_BALANCE_VERSION,
      sourceHash,
      sheets: source.sheets,
      pdf: source.pdf,
      extractionRevision: context.extractionRevision,
    }),
  );
  operation.check();
  const review: RunningReview = {
    version: RUNNING_BALANCE_VERSION,
    sourceHash,
    extractionHash,
    contextHash: '',
    extractionRevision: context.extractionRevision,
    sheet: 1,
    sourceVerified: false,
    state: 'review-ready',
    financialApproval: false,
    scopeConfirmed: false,
    rows: source.sheets[0].rows.map((values, i) => ({
      originalRow: i + 1,
      page: source.sheets[0].rowPages?.[String(i + 1)] ?? 0,
      values: [...values],
      kind: 'unclassified',
      derivedRow: null,
    })),
    movements: [],
    proposals: [],
    headerEvidence: [],
    metadataEvidence: [],
    declaredScope: null,
    balanceSteps: [],
    controls: [],
    openingMinor: null,
    closingMinor: null,
    grossDebitMinor: '0',
    grossCreditMinor: '0',
    netMinor: '0',
    diagnostics: [],
  };
  let allocatedProofs = 0;
  const evidence = (
    row: number,
    column: number,
    start = 0,
    end?: number,
  ): RunningCellEvidence => {
    if (++allocatedProofs > operation.budgets.maxEvidenceCells)
      throw new SectionOperationError('resource-limit');
    operation.check();
    const entry = review.rows[row - 1],
      literal = entry.values[column - 1] ?? '';
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
  const reuse = (proof: RunningCellEvidence): RunningCellEvidence => {
    operation.evidence(1);
    return proof;
  };
  const refs = (proofs: RunningCellEvidence[]) => proofs.map(reuse);
  const diag = (
    code: string,
    row?: number,
    proofs: RunningCellEvidence[] = [],
  ) => {
    review.diagnostics.push({
      code,
      stage: ['MONEY', 'LIMIT', 'PERIOD'].includes(code)
        ? 'money'
        : ['STEP', 'CARRY', 'CLOSING', 'COUNT', 'TOTAL'].includes(code)
          ? 'aggregate'
          : code.startsWith('SOURCE')
            ? 'source-revalidation'
            : 'structure',
      ...(row ? { row, page: review.rows[row - 1]?.page } : {}),
      message: code,
      evidence: proofs.length ? refs(proofs) : row ? [evidence(row, 1)] : [],
    });
  };
  const amount = (text: string, row: number, signed = false): bigint | null => {
    if (
      !(
        signed ? /^-?[0-9]+(?:\.[0-9]{1,2})?$/ : /^[0-9]+(?:\.[0-9]{1,2})?$/
      ).test(text)
    ) {
      diag('MONEY', row);
      return null;
    }
    const negative = text.startsWith('-'),
      [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.'),
      significant = whole.replace(/^0+/, '') || '0';
    if (significant.length > 13) {
      diag('LIMIT', row);
      return null;
    }
    const abs = BigInt(significant) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (abs > MONEY_LIMIT) {
      diag('LIMIT', row);
      return null;
    }
    if (negative && abs === 0n) {
      diag('MONEY', row);
      return null;
    }
    return negative ? -abs : abs;
  };
  const bounded = (value: bigint, row: number) => {
    if (value > MONEY_LIMIT || value < -MONEY_LIMIT) diag('LIMIT', row);
  };
  const roleCells = (row: number, allowed: number[]) => {
    const values = review.rows[row - 1].values;
    if (
      values.length !== 7 ||
      values.some((text, col) => !allowed.includes(col) && text !== '')
    )
      diag('ROLE', row);
  };
  const sheet = source.sheets[0];
  if (
    !/\.pdf$/i.test(source.name) ||
    source.kind !== undefined ||
    source.visual !== undefined ||
    !source.pdf ||
    source.pdf.autoColumns ||
    JSON.stringify(source.pdf.cuts) !== JSON.stringify(RUNNING_CUTS)
  )
    diag('HEADER');
  if (
    sheet.formulaRows.length ||
    sheet.hiddenRows.length ||
    Object.keys(sheet.rowIssues ?? {}).length ||
    Object.keys(sheet.cellIssues ?? {}).length ||
    Object.keys(sheet.referenceIssues ?? {}).length
  )
    diag('ROLE');
  if (
    options.inventoryOriginalRows &&
    (options.inventoryOriginalRows.length !== review.rows.length ||
      options.inventoryOriginalRows.some((row, i) => row !== i + 1))
  )
    diag('PAGE_ORDER');
  if (!review.rows.length || !source.pdf) diag('PAGE_ORDER');
  const pages: RunningReview['rows'][] = [];
  let priorPage = 0;
  for (const row of review.rows) {
    await operation.checkpoint(row.originalRow, review.rows.length, 'classify');
    if (
      !Number.isSafeInteger(row.page) ||
      row.page < 1 ||
      row.page > operation.budgets.maxPages ||
      (row.page !== priorPage && row.page !== priorPage + 1)
    )
      diag('PAGE_ORDER', row.originalRow);
    if (row.page !== priorPage) {
      pages.push([]);
      priorPage = row.page;
    }
    pages[pages.length - 1]?.push(row);
    if (row.values.length !== 7) diag('HEADER', row.originalRow);
  }
  if (
    pages.length !== source.pdf?.pages ||
    pages.some((page, i) => page[0].page !== i + 1)
  )
    diag('PAGE_ORDER');
  let last: bigint | null = null,
    lastProof: RunningCellEvidence | null = null,
    opening: bigint | null = null,
    openingProof: RunningCellEvidence | null = null,
    carried: bigint | null = null,
    carriedProof: RunningCellEvidence | null = null;
  let grossDebit = 0n,
    grossCredit = 0n,
    nextSeq = 1;
  const allMovements: RunningMovement[] = [];
  let active: {
    id: string;
    parent: RunningCellEvidence;
    continuations: RunningCellEvidence[];
    members: RunningMovement[];
    debit: bigint;
    credit: bigint;
  } | null = null;
  const ids = new Set<string>();
  const balanceControl = (
    row: number,
    role: string,
    supplied: bigint | null,
    expected: bigint | null,
    members: RunningCellEvidence[],
    code: string,
    date = false,
  ) => {
    const proof = evidence(row, 7);
    const difference =
      supplied !== null && expected !== null ? supplied - expected : null;
    review.controls.push({
      originalRow: row,
      page: review.rows[row - 1].page,
      role,
      evidence: [
        evidence(row, 1),
        ...(date ? [evidence(row, 2)] : []),
        reuse(proof),
      ],
      members: refs(members),
      providedMinor: supplied?.toString() ?? null,
      expectedMinor: expected?.toString() ?? null,
      differenceMinor: difference?.toString() ?? null,
    });
    if (difference !== 0n && difference !== null)
      diag(code, row, [proof, ...members]);
    return proof;
  };
  const totalControl = (
    row: number,
    role: string,
    debit: bigint,
    credit: bigint,
    members: RunningMovement[],
  ) => {
    const values = review.rows[row - 1].values,
      actualDebit = amount(values[4] ?? '', row),
      actualCredit = amount(values[5] ?? '', row);
    roleCells(row, [0, 4, 5]);
    const de = evidence(row, 5),
      ce = evidence(row, 6);
    bounded(debit, row);
    bounded(credit, row);
    review.controls.push({
      originalRow: row,
      page: review.rows[row - 1].page,
      role,
      evidence: [evidence(row, 1), reuse(de), reuse(ce)],
      members: members.flatMap((m) => [
        reuse(m.debitEvidence),
        reuse(m.creditEvidence),
      ]),
      providedMinor: null,
      expectedMinor: null,
      differenceMinor: null,
      debitProvidedMinor: actualDebit?.toString() ?? null,
      creditProvidedMinor: actualCredit?.toString() ?? null,
      debitExpectedMinor: debit.toString(),
      creditExpectedMinor: credit.toString(),
      debitDifferenceMinor:
        actualDebit === null ? null : (actualDebit - debit).toString(),
      creditDifferenceMinor:
        actualCredit === null ? null : (actualCredit - credit).toString(),
    });
    if (
      (actualDebit !== null && actualDebit !== debit) ||
      (actualCredit !== null && actualCredit !== credit)
    )
      diag('TOTAL', row, [de, ce]);
  };
  const countControl = (
    row: number,
    role: string,
    label: string,
    members: RunningMovement[],
  ) => {
    roleCells(row, [0]);
    const m = new RegExp(`^${label}: (0|[1-9][0-9]*)$`).exec(
      review.rows[row - 1].values[0],
    );
    const supplied = m && m[1].length <= 5 ? BigInt(m[1]) : null;
    const expected = BigInt(members.length);
    const proof = evidence(row, 1);
    review.controls.push({
      originalRow: row,
      page: review.rows[row - 1].page,
      role,
      evidence: [reuse(proof)],
      members: members.map((m) => reuse(m.seqEvidence)),
      providedMinor: supplied?.toString() ?? null,
      expectedMinor: expected.toString(),
      differenceMinor:
        supplied === null ? null : (supplied - expected).toString(),
    });
    if (
      supplied === null ||
      supplied !== expected ||
      supplied > BigInt(operation.budgets.maxRows)
    )
      diag('COUNT', row, [proof]);
  };
  for (let pi = 0; pi < pages.length; pi++) {
    operation.check();
    const page = pages[pi];
    if (page.length < 8) {
      diag('HEADER', page[0]?.originalRow);
      continue;
    }
    const meta = page.slice(0, 7);
    const text = meta.map((row) => row.values[0]);
    const sm = new RegExp(`^Statement: (${ID})$`).exec(text[1]),
      am = new RegExp(`^Account: (${ID})$`).exec(text[2]),
      pm =
        /^Period: ([0-9]{4}-[0-9]{2}-[0-9]{2})\/([0-9]{4}-[0-9]{2}-[0-9]{2})$/.exec(
          text[3],
        );
    meta.forEach((row, i) => {
      row.kind = [
        'synthetic',
        'statement',
        'account',
        'period',
        'currency',
        'perspective',
        'page-marker',
      ][i];
      roleCells(row.originalRow, [0]);
      review.metadataEvidence.push(evidence(row.originalRow, 1));
    });
    if (text[0] !== 'SYNTHETIC ONLY') diag('HEADER', meta[0].originalRow);
    if (
      !sm ||
      !am ||
      text[4] !== 'Currency: SAR' ||
      text[5] !== 'Balance basis: debit-minus-credit'
    )
      diag('SCOPE', meta[1].originalRow);
    if (!pm || !validDate(pm[1]) || !validDate(pm[2]) || pm[1] > pm[2])
      diag('PERIOD', meta[3].originalRow);
    if (
      sm &&
      am &&
      pm &&
      validDate(pm[1]) &&
      validDate(pm[2]) &&
      pm[1] <= pm[2]
    ) {
      const scope = {
        statement: sm[1],
        account: am[1],
        periodStart: pm[1],
        periodEnd: pm[2],
      };
      if (!review.declaredScope)
        review.declaredScope = {
          ...scope,
          evidence: [
            evidence(meta[1].originalRow, 1, 11),
            evidence(meta[2].originalRow, 1, 9),
            evidence(meta[3].originalRow, 1, 8),
          ],
        };
      else if (
        scope.statement !== review.declaredScope.statement ||
        scope.account !== review.declaredScope.account ||
        scope.periodStart !== review.declaredScope.periodStart ||
        scope.periodEnd !== review.declaredScope.periodEnd
      )
        diag('SCOPE', meta[1].originalRow);
    }
    if (text[6] !== `Page: ${pi + 1} of ${pages.length}`)
      diag('PAGE_ORDER', meta[6].originalRow);
    const header = page[7];
    header.kind = 'header';
    review.headerEvidence.push(
      HEADER.map((_, c) => evidence(header.originalRow, c + 1)),
    );
    if (JSON.stringify(header.values) !== JSON.stringify(HEADER))
      diag('HEADER', header.originalRow);
    let index = 8;
    const first = page[index];
    if (pi === 0) {
      if (!first || first.values[0] !== 'Opening balance')
        diag('OPENING', first?.originalRow);
      else {
        first.kind = 'opening';
        roleCells(first.originalRow, [0, 1, 6]);
        if (
          !review.declaredScope ||
          first.values[1] !== review.declaredScope.periodStart
        )
          diag('PERIOD', first.originalRow);
        opening = last = amount(first.values[6], first.originalRow, true);
        openingProof = lastProof = balanceControl(
          first.originalRow,
          'opening',
          opening,
          opening,
          [],
          'OPENING',
          true,
        );
        review.openingMinor = opening?.toString() ?? null;
        index++;
      }
    } else {
      if (!first || first.values[0] !== 'Brought balance')
        diag('CARRY', first?.originalRow);
      else {
        first.kind = 'brought';
        roleCells(first.originalRow, [0, 6]);
        const brought = amount(first.values[6], first.originalRow, true);
        const proof = balanceControl(
          first.originalRow,
          'brought',
          brought,
          carried,
          carriedProof ? [carriedProof] : [],
          'CARRY',
        );
        last = brought;
        lastProof = proof;
        index++;
      }
      if (active) {
        const continuation = page[index];
        if (
          !continuation ||
          continuation.values[0] !== `Continued invoice: ${active.id}`
        )
          diag('CONTINUATION', continuation?.originalRow);
        else {
          continuation.kind = 'continuation';
          roleCells(continuation.originalRow, [0]);
          active.continuations.push(evidence(continuation.originalRow, 1, 19));
          index++;
        }
      }
    }
    let phase = 0,
      pageDebit = 0n,
      pageCredit = 0n;
    const pageMovements: RunningMovement[] = [];
    for (; index < page.length; index++) {
      const row = page[index],
        rn = row.originalRow,
        v = row.values,
        label = v[0] ?? '';
      await operation.checkpoint(rn, review.rows.length, 'classify');
      const parent = new RegExp(`^Invoice: (${ID})$`).exec(label),
        sectionTotal = new RegExp(`^Section total: (${ID})$`).exec(label);
      if (parent) {
        row.kind = 'parent';
        roleCells(rn, [0]);
        if (phase !== 0) diag('FOOTER', rn);
        if (active || ids.has(parent[1])) diag('CONTINUATION', rn);
        ids.add(parent[1]);
        active = {
          id: parent[1],
          parent: evidence(rn, 1, 9),
          continuations: [],
          members: [],
          debit: 0n,
          credit: 0n,
        };
        continue;
      }
      if (sectionTotal) {
        row.kind = 'section-total';
        if (phase !== 0) diag('FOOTER', rn);
        if (!active || active.id !== sectionTotal[1] || !active.members.length)
          diag('CONTINUATION', rn);
        totalControl(
          rn,
          'section-total',
          active?.debit ?? 0n,
          active?.credit ?? 0n,
          active?.members ?? [],
        );
        active = null;
        continue;
      }
      if (label === 'Page total') {
        row.kind = 'page-total';
        if (phase !== 0) diag('FOOTER', rn);
        totalControl(rn, 'page-total', pageDebit, pageCredit, pageMovements);
        phase = 1;
        continue;
      }
      if (label.startsWith('Page count:')) {
        row.kind = 'page-count';
        if (phase !== 1) diag('FOOTER', rn);
        countControl(rn, 'page-count', 'Page count', pageMovements);
        phase = 2;
        continue;
      }
      if (label === 'Carried balance') {
        row.kind = 'carried';
        if (pi === pages.length - 1 || phase !== 2 || index !== page.length - 1)
          diag('FOOTER', rn);
        roleCells(rn, [0, 6]);
        carried = amount(v[6], rn, true);
        carriedProof = balanceControl(
          rn,
          'carried',
          carried,
          last,
          lastProof ? [lastProof] : [],
          'CARRY',
        );
        phase = 3;
        continue;
      }
      if (label === 'Closing balance') {
        row.kind = 'closing';
        if (pi !== pages.length - 1 || phase !== 2) diag('FOOTER', rn);
        if (active) diag('CONTINUATION', rn);
        roleCells(rn, [0, 1, 6]);
        if (!review.declaredScope || v[1] !== review.declaredScope.periodEnd)
          diag('PERIOD', rn);
        const close = amount(v[6], rn, true);
        balanceControl(
          rn,
          'closing',
          close,
          last,
          lastProof ? [lastProof] : [],
          'CLOSING',
          true,
        );
        const computed =
          opening === null ? null : opening + grossDebit - grossCredit;
        balanceControl(
          rn,
          'closing-global',
          close,
          computed,
          [
            ...(openingProof ? [openingProof] : []),
            ...allMovements.flatMap((m) => [m.debitEvidence, m.creditEvidence]),
          ],
          'CLOSING',
          true,
        );
        review.closingMinor = close?.toString() ?? null;
        phase = 3;
        continue;
      }
      if (label === 'Statement total') {
        row.kind = 'statement-total';
        if (
          pi !== pages.length - 1 ||
          phase !== 3 ||
          review.closingMinor === null
        ) {
          diag('FOOTER', rn);
          if (review.closingMinor === null) diag('CLOSING', rn);
        }
        totalControl(
          rn,
          'statement-total',
          grossDebit,
          grossCredit,
          allMovements,
        );
        phase = 4;
        continue;
      }
      if (label.startsWith('Statement count:')) {
        row.kind = 'statement-count';
        if (pi !== pages.length - 1 || phase !== 4 || index !== page.length - 1)
          diag('FOOTER', rn);
        countControl(rn, 'statement-count', 'Statement count', allMovements);
        phase = 5;
        continue;
      }
      if (/^[1-9][0-9]*$/.test(label)) {
        row.kind = 'movement';
        if (phase !== 0) diag('FOOTER', rn);
        if (!active) diag('CONTINUATION', rn);
        if (label !== String(nextSeq)) diag('SEQUENCE', rn);
        nextSeq++;
        if (
          !validDate(v[1]) ||
          !review.declaredScope ||
          v[1] < review.declaredScope.periodStart ||
          v[1] > review.declaredScope.periodEnd
        )
          diag('PERIOD', rn);
        if (!v[3]) diag('ROLE', rn);
        if (v[2] && (!active || v[2] !== active.id)) diag('REFERENCE', rn);
        const debit = amount(v[4], rn),
          credit = amount(v[5], rn),
          balance = amount(v[6], rn, true);
        if (debit !== null && credit !== null && debit > 0n && credit > 0n)
          diag('MONEY', rn);
        const proofs = HEADER.map((_, c) => evidence(rn, c + 1));
        const computed =
          last !== null && debit !== null && credit !== null
            ? last + debit - credit
            : null;
        if (computed !== null) bounded(computed, rn);
        const difference =
          balance !== null && computed !== null ? balance - computed : null;
        review.balanceSteps.push({
          originalRow: rn,
          page: row.page,
          previousProvidedMinor: last?.toString() ?? null,
          debitProvidedMinor: debit?.toString() ?? null,
          creditProvidedMinor: credit?.toString() ?? null,
          nextProvidedMinor: balance?.toString() ?? null,
          computedMinor: computed?.toString() ?? null,
          differenceMinor: difference?.toString() ?? null,
          previousEvidence: lastProof ? reuse(lastProof) : null,
          debitEvidence: reuse(proofs[4]),
          creditEvidence: reuse(proofs[5]),
          nextEvidence: reuse(proofs[6]),
        });
        if (difference !== null && difference !== 0n)
          diag('STEP', rn, [
            ...(lastProof ? [lastProof] : []),
            proofs[4],
            proofs[5],
            proofs[6],
          ]);
        last = balance;
        lastProof = proofs[6];
        if (debit === null || credit === null || balance === null || !active)
          continue;
        const movement: RunningMovement = {
          originalRow: rn,
          page: row.page,
          derivedRow: allMovements.length + 2,
          seq: label,
          date: v[1],
          reference: v[2] || active.id,
          referenceOrigin: v[2]
            ? 'explicit-source-cell'
            : 'accepted-section-proposal',
          description: v[3],
          debit: v[4],
          credit: v[5],
          balance: v[6],
          debitMinor: debit.toString(),
          creditMinor: credit.toString(),
          balanceMinor: balance.toString(),
          seqEvidence: reuse(proofs[0]),
          dateEvidence: reuse(proofs[1]),
          referenceEvidence: reuse(proofs[2]),
          descriptionEvidence: reuse(proofs[3]),
          debitEvidence: reuse(proofs[4]),
          creditEvidence: reuse(proofs[5]),
          balanceEvidence: reuse(proofs[6]),
          parentEvidence: reuse(active.parent),
          continuationEvidence: refs(active.continuations),
        };
        if (!v[2]) {
          operation.proposal();
          const id = `running-reference-${rn}`;
          movement.proposalId = id;
          review.proposals.push({
            id,
            reference: active.id,
            evidence: {
              target: reuse(proofs[2]),
              parent: reuse(active.parent),
              continuations: refs(active.continuations),
              headers: review.headerEvidence.map(refs),
            },
          });
        }
        row.derivedRow = movement.derivedRow;
        allMovements.push(movement);
        pageMovements.push(movement);
        active.members.push(movement);
        active.debit += debit;
        active.credit += credit;
        pageDebit += debit;
        pageCredit += credit;
        grossDebit += debit;
        grossCredit += credit;
        bounded(active.debit, rn);
        bounded(active.credit, rn);
        bounded(pageDebit, rn);
        bounded(pageCredit, rn);
        bounded(grossDebit, rn);
        bounded(grossCredit, rn);
        continue;
      }
      row.kind = 'unclassified';
      diag('ROLE', rn);
      if (phase !== 0) diag('FOOTER', rn);
      if (label.startsWith('Continued invoice:')) diag('CONTINUATION', rn);
    }
    if (!pageMovements.length) diag('COUNT', page[0].originalRow);
    if (pi < pages.length - 1 && phase !== 3)
      diag('CARRY', page[page.length - 1].originalRow);
    if (pi === pages.length - 1 && phase !== 5) {
      diag('FOOTER', page[page.length - 1].originalRow);
      if (review.closingMinor === null)
        diag('CLOSING', page[page.length - 1].originalRow);
    }
    operation.check();
  }
  if (active) diag('CONTINUATION', active.parent.row);
  review.movements = allMovements;
  review.grossDebitMinor = grossDebit.toString();
  review.grossCreditMinor = grossCredit.toString();
  review.netMinor = (grossDebit - grossCredit).toString();
  review.contextHash = await digestRunning(
    JSON.stringify({
      version: RUNNING_BALANCE_VERSION,
      sourceHash,
      extractionHash,
      context,
      declaredScope: review.declaredScope,
    }),
  );
  operation.check();
  if (review.diagnostics.length) {
    review.state = 'blocked';
    review.movements = [];
    review.proposals = [];
    for (const row of review.rows) row.derivedRow = null;
  }
  // Bound the literal seven-field movement export incrementally, before allocating it.
  let csvBytes = new TextEncoder().encode(HEADER.join(',') + '\r\n').byteLength;
  const csvCap = runningBudgets(options).maxCsvBytes;
  for (const movement of review.movements) {
    const fields = [
      movement.seq,
      movement.date,
      movement.reference,
      movement.description,
      movement.debit,
      movement.credit,
      movement.balance,
    ];
    for (const text of fields) {
      csvBytes += new TextEncoder().encode(text).byteLength;
      if (/[",\r\n]/.test(text))
        csvBytes += 2 + (text.match(/"/g)?.length ?? 0);
    }
    csvBytes += 8; // Six delimiters and CRLF.
    if (csvBytes > csvCap) throw new SectionOperationError('resource-limit');
  }
  if (csvBytes > csvCap) throw new SectionOperationError('resource-limit');
  // Count every published evidence occurrence, including repeated references.
  const finalOperation = checkRunningOptions(options);
  const countEvidence = (value: unknown): void => {
    if (!value || typeof value !== 'object' || value instanceof ArrayBuffer)
      return;
    if (
      !Array.isArray(value) &&
      Object.hasOwn(value, 'spanStartInclusive') &&
      Object.hasOwn(value, 'sourceHash')
    ) {
      finalOperation.evidence(1);
    }
    for (const child of Object.values(value)) countEvidence(child);
  };
  guardRunningPlain(review, () => operation.check(), runningBudgets(options));
  countEvidence(review);
  operation.check();
  return review;
}
export async function classifyRunningExtraction(
  source: SourceFile,
  context: RunningBalanceContext,
  options: RunningOptions = {},
) {
  const owned = snapshotRunningInputs(source, context, options);
  return classifyOwned(
    owned.source,
    owned.context,
    { ...options, ...owned.classificationOptions },
    checkRunningOptions(options),
  );
}
export async function inspectRunningBalance(
  source: SourceFile,
  context: RunningBalanceContext,
  options: RunningOptions = {},
) {
  const owned = snapshotRunningInputs(source, context, options),
    file = owned.source,
    operation = checkRunningOptions(options);
  const review = await classifyOwned(
    file,
    owned.context,
    { ...options, ...owned.classificationOptions },
    operation,
  );
  const block = (code: string) => {
    review.state = 'blocked';
    review.movements = [];
    review.proposals = [];
    for (const row of review.rows) row.derivedRow = null;
    review.diagnostics.push({
      code,
      stage: 'source-revalidation',
      message: code,
      evidence: [],
    });
    return review;
  };
  const hash = await digestRunning(file.original!);
  operation.check();
  if (hash !== file.sha256) return block('SOURCE_HASH');
  if (
    !/\.pdf$/i.test(file.name) ||
    !file.pdf ||
    JSON.stringify(file.pdf.cuts) !== JSON.stringify(RUNNING_CUTS)
  )
    return block('SOURCE_MAPPING');
  const fresh = await readFile(
    file.name,
    file.original!,
    [...RUNNING_CUTS],
    false,
    (progress) => operation.progress(progress),
    32767,
  );
  operation.check();
  snapshotRunningInputs(fresh, owned.context, options);
  if (
    fresh.pdf?.pages !== file.pdf.pages ||
    JSON.stringify(fresh.sheets[0].rowPages) !==
      JSON.stringify(file.sheets[0].rowPages)
  )
    return block('PAGE_ORDER');
  if (
    fresh.sha256 !== hash ||
    JSON.stringify(fresh.sheets) !== JSON.stringify(file.sheets) ||
    JSON.stringify(fresh.pdf) !== JSON.stringify(file.pdf)
  )
    return block('SOURCE_CHANGED');
  operation.check();
  if (review.state === 'review-ready') review.sourceVerified = true;
  return review;
}
