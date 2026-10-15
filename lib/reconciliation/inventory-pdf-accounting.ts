import {
  readInventoryLiteralPdfRegister,
  STOCK_PDF_FAMILY,
  type InventoryPdfSpan,
} from './inventory-pdf-register.ts';
import type { StockScope } from './inventory-register.ts';
import type { NativePdfLiteralSource } from './pdf-native-source.ts';

export const STOCK_PDF_ACCOUNTING = 'inventory-pdf-accounting-1';
export type InventoryPdfLiteral = {
  span: InventoryPdfSpan;
  text: string;
  start: number;
  end: number;
  operators: number[];
};
export type InventoryPdfAccounting = {
  version: typeof STOCK_PDF_ACCOUNTING;
  reading: Awaited<ReturnType<typeof readInventoryLiteralPdfRegister>>;
  literals: InventoryPdfLiteral[];
  records: {
    id: string;
    page: number;
    line: number;
    row: number;
    raw: Record<string, string>;
  }[];
  issues: { page: number; line: number; code: string }[];
  pageTotals: { page: number; declaredMinor: number; actualMinor: number }[];
  reportTotal: { declaredMinor: number; actualMinor: number } | null;
};
const compact = (s: string) => s.replace(/\s/gu, '');
function stop(code: string): never {
  throw Error('STOCK_' + code);
}

type LiteralPage = NativePdfLiteralSource['pages'][number];
const pageIndexes = new WeakMap<
  LiteralPage,
  {
    ranges: Map<number, LiteralPage['literals']['items'][number]>;
    tokens: Map<number, LiteralPage['tokens'][number]>;
  }
>();
function lowerEnd<T extends { end: number }>(rows: T[], start: number) {
  let low = 0,
    high = rows.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (rows[mid].end <= start) low = mid + 1;
    else high = mid;
  }
  return low;
}
// Resolve exact glyphs, never the display assembler's inferred whitespace.
// This helper verifies evidence; only the original-bytes entry point below can
// supply a reading to the private financial path in inventory-register.ts.
export function inventoryPdfLiteral(
  source: NativePdfLiteralSource,
  span: InventoryPdfSpan,
): InventoryPdfLiteral {
  if (
    source.literalVersion !== 'native-pdf-literals-1' ||
    span.sourceHash !== source.sha256
  )
    stop('LITERAL_SOURCE');
  const page = source.pages[span.page - 1];
  if (
    !page ||
    page.page !== span.page ||
    !span.items.length ||
    new Set(span.items).size !== span.items.length
  )
    stop('LITERAL_ITEMS');
  const trace = page.literals;
  let index = pageIndexes.get(page);
  if (!index) {
    index = {
      ranges: new Map(trace.items.map((r) => [r.item, r])),
      tokens: new Map(page.tokens.map((t) => [t.item, t])),
    };
    pageIndexes.set(page, index);
  }
  const ranges = span.items.map((item) => index.ranges.get(item));
  if (ranges.some((r) => !r)) stop('LITERAL_ITEMS');
  const present = ranges.filter((r) => r !== undefined);
  for (let i = 0; i < present.length; i++) {
    const token = index.tokens.get(present[i].item);
    if (!token || token.direction !== 'ltr') stop('LITERAL_DIRECTION');
    const raw = trace.text.slice(present[i].start, present[i].end);
    if (compact(raw) !== compact(token.text)) stop('LITERAL_TEXT');
    if (i) {
      const prior = present[i - 1];
      if (prior.end > present[i].start) stop('LITERAL_ORDER');
      const between = trace.text.slice(prior.end, present[i].start);
      if (compact(between)) stop('LITERAL_FOREIGN');
      // A geometric separator with no actual whitespace is not a literal space.
      if (span.gaps[i - 1] > 0.2 && !between.length) stop('LITERAL_GAP');
    }
  }
  const first = present[0],
    last = present.at(-1)!;
  const operators = [];
  for (
    let i = lowerEnd(trace.operators, first.start);
    i < trace.operators.length && trace.operators[i].start < last.end;
    i++
  )
    operators.push(trace.operators[i]);
  if (!operators.length || operators.some((o) => o.adjusted))
    stop('LITERAL_SPACING');
  const start = operators[0].start,
    end = operators.at(-1)!.end;
  // Require complete text-show boundaries. Do not silently trim a source cell,
  // or take a field from an operator that also owns another field's glyphs.
  const selected = new Set(span.items);
  for (
    let i = lowerEnd(trace.items, start);
    i < trace.items.length && trace.items[i].start < end;
    i++
  )
    if (!selected.has(trace.items[i].item)) stop('LITERAL_BOUNDARY');
  const text = trace.text.slice(start, end);
  if (
    !text ||
    compact(text) !==
      present.map((r) => compact(trace.text.slice(r.start, r.end))).join('')
  )
    stop('LITERAL_TEXT');
  return {
    span,
    text,
    start,
    end,
    operators: operators.map((o) => o.operator),
  };
}

/** G3 only: fresh guarded original + literal fields + numerical controls. */
export async function readInventoryPdfAccounting(
  original: ArrayBuffer,
  scope: StockScope,
  scopeLabels: string[],
  scopeFields: readonly (keyof StockScope)[],
  decimals: number,
  scaled: (text: string, precision: number) => number,
  bounded: (value: bigint) => number,
): Promise<InventoryPdfAccounting> {
  const reading = await readInventoryLiteralPdfRegister(original);
  const result: InventoryPdfAccounting = {
    version: STOCK_PDF_ACCOUNTING,
    reading,
    literals: [],
    records: [],
    issues: [...reading.issues],
    pageTotals: [],
    reportTotal: null,
  };
  const offsets = new Map<number, number>();
  let offset = 0;
  for (const page of reading.source.pages) {
    offsets.set(page.page, offset);
    offset += reading.inventory.filter((r) => r.page === page.page).length;
  }
  const resolved = new Map<string, InventoryPdfLiteral>();
  let lastSpan: InventoryPdfSpan | undefined;
  const literal = (span: InventoryPdfSpan, expected?: string) => {
    lastSpan = span;
    const key = JSON.stringify([span.page, span.items]);
    let value = resolved.get(key);
    if (!value) {
      value = inventoryPdfLiteral(reading.source, span);
      resolved.set(key, value);
      result.literals.push(value);
    }
    if (expected !== undefined && value.text !== expected) stop('LITERAL_ROLE');
    return value.text;
  };
  const problem = (span: { page: number; line: number }, error: unknown) => {
    if (!(error instanceof Error) || !error.message.startsWith('STOCK_'))
      throw error;
    result.issues.push({
      page: span.page,
      line: span.line,
      code: error.message.slice(6),
    });
  };
  if (reading.status !== 'interpreted') return result;
  try {
    for (const evidence of reading.pageEvidence) {
      literal(evidence.title, 'Inventory carrying-value register');
      literal(evidence.report.role, 'Report ID');
      literal(
        evidence.report.value,
        literal(reading.pageEvidence[0].report.value),
      );
      literal(evidence.sequence.role, 'Page');
      literal(
        evidence.sequence.value,
        evidence.page + ' of ' + reading.source.pages.length,
      );
    }
    for (let i = 0; i < scopeLabels.length; i++) {
      const pair = reading.scope[scopeLabels[i]];
      if (!pair) stop('SCOPE');
      literal(pair.role, scopeLabels[i]);
      if (literal(pair.value) !== scope[scopeFields[i]]) stop('PDF_SCOPE');
    }
    for (const record of reading.records) {
      for (const pair of [
        ...record.scopeEvidence,
        ...record.documentScopeEvidence,
      ]) {
        const name = literal(pair.role);
        const i = scopeLabels.indexOf(name);
        if (i < 0 || literal(pair.value) !== scope[scopeFields[i]])
          stop('PDF_SCOPE');
      }
    }
  } catch (error) {
    problem(lastSpan ?? reading.pageEvidence[0].title, error);
  }
  const sums = new Map<number, bigint>();
  const identities = new Map<string, { page: number; line: number }[]>();
  for (const record of reading.records) {
    try {
      const raw: Record<string, string> = {};
      for (const [field, pair] of Object.entries(record.fields)) {
        literal(pair!.role, field);
        raw[field] = literal(pair!.value);
      }
      if (record.parent && record.batch) {
        literal(record.parent.role, 'Warehouse');
        literal(record.batch.role, 'Batch');
        const parent = literal(record.parent.value),
          batch = literal(record.batch.value);
        if (
          !parent ||
          !batch ||
          parent !== parent.trim() ||
          batch !== batch.trim() ||
          /[;=\p{Cc}\p{Cf}]/u.test(parent + batch)
        )
          stop('DIMENSIONS');
        raw['Item dimensions'] = 'warehouse=' + parent + ';batch=' + batch;
        if (!record.sectionEnd) stop('SECTION_END');
        literal(record.sectionEnd, record.sectionEnd.text);
        for (const [tag, pair] of [
          ['Continued section', record.incomingContinuation],
          ['Continues section', record.outgoingContinuation],
        ] as const)
          if (pair) {
            literal(pair.role, tag);
            if (literal(pair.value) !== raw['Item dimensions'])
              stop('CONTINUATION');
            if ('prior' in pair) {
              literal(pair.prior.role, 'Continues section');
              if (literal(pair.prior.value) !== literal(pair.value))
                stop('CONTINUATION');
            }
          }
      }
      if (!/^[0-6]$/.test(raw['Quantity precision']))
        stop('QUANTITY_PRECISION');
      scaled(raw.Quantity, Number(raw['Quantity precision']));
      const money = scaled(raw['Posted value'], decimals);
      sums.set(record.page, (sums.get(record.page) ?? 0n) + BigInt(money));
      bounded(sums.get(record.page)!);
      const key = JSON.stringify([raw['Item ID'], raw['Item dimensions']]);
      const group = identities.get(key) ?? [];
      group.push({ page: record.page, line: record.line });
      identities.set(key, group);
      result.records.push({
        id: JSON.stringify([
          STOCK_PDF_FAMILY,
          0,
          reading.source.sha256,
          record.page,
          record.line,
        ]),
        page: record.page,
        line: record.line,
        row: offsets.get(record.page)! + record.line,
        raw,
      });
    } catch (error) {
      problem(record, error);
    }
  }
  for (const group of identities.values())
    if (group.length > 1)
      for (const at of group) result.issues.push({ ...at, code: 'DUPLICATE' });
  for (const page of reading.pageControls)
    try {
      literal(page.total.role, 'Page total');
      literal(page.end, 'End page');
      const declaredMinor = scaled(literal(page.total.value), decimals);
      const actualMinor = bounded(sums.get(page.page) ?? 0n);
      result.pageTotals.push({ page: page.page, declaredMinor, actualMinor });
      if (declaredMinor !== actualMinor) stop('PAGE_TOTAL');
    } catch (error) {
      problem(page.total.value, error);
    }
  if (reading.reportTotal && reading.reportEnd)
    try {
      literal(reading.reportTotal.role, 'Report total');
      literal(reading.reportEnd, 'End report');
      const declaredMinor = scaled(
        literal(reading.reportTotal.value),
        decimals,
      );
      const actualMinor = bounded(
        [...sums.values()].reduce((a, b) => a + b, 0n),
      );
      result.reportTotal = { declaredMinor, actualMinor };
      if (declaredMinor !== actualMinor) stop('REPORT_TOTAL');
    } catch (error) {
      problem(reading.reportTotal.value, error);
    }
  return result;
}
