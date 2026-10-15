import { readNativePdfSource } from './pdf.ts';
import type { NativePdfSource } from './pdf-native-source.ts';
import type { ProcessingProgress } from './processing-progress.ts';
import { MAX_ROWS } from './types.ts';

// Interpretation of this explicit native-text family only. No numeric parsing,
// valuation, match, accounting approval, cached geometry input or stock activation.
export const STOCK_PDF_FAMILY = 'inventory-native-pdf-register-1';
const title = 'Inventory carrying-value register';
const fields = [
  'Item ID',
  'Item dimensions',
  'Quantity',
  'Unit',
  'Quantity precision',
  'Posted value',
  'Valuation reference',
] as const;
export type InventoryPdfField = (typeof fields)[number];
const scopeLabels = [
  'Entity',
  'Inventory ledger',
  'GL ledger',
  'Currency',
  'Currency basis',
  'Posting status',
  'Posting layer',
  'As of',
  'Chart version',
  'Map version',
  'Valuation policy version',
  'Inventory account set version',
];
const controls = [
  'Report ID',
  'Page',
  'Warehouse',
  'Batch',
  'Continued section',
  'Continues section',
  'End section',
  'Page total',
  'End page',
  'Report total',
  'End report',
  ...scopeLabels,
];
type Token = NativePdfSource['pages'][number]['tokens'][number];
export type InventoryPdfSpan = {
  sourceHash: string;
  page: number;
  line: number;
  items: number[];
  /** Display assembly only. A physical gap does not prove a whitespace count. */
  text: string;
  textAssembly:
    | 'single-native-item'
    | 'adjacent-native-items'
    | 'gap-presentation';
  gaps: number[];
  box: [number, number, number, number]; // x, baseline y, width, font height
};
type Pair = { role: InventoryPdfSpan; value: InventoryPdfSpan };
type IncomingContinuation = Pair & { prior: Pair };
export type InventoryPdfRecord = {
  id: string;
  page: number;
  line: number;
  fields: Partial<Record<InventoryPdfField, Pair>>;
  parent: Pair | null;
  batch: Pair | null;
  sectionEnd: InventoryPdfSpan | null;
  incomingContinuation: IncomingContinuation | null;
  outgoingContinuation: Pair | null;
  scopeEvidence: Pair[];
  documentScopeEvidence: Pair[];
};
type LineKind =
  | 'unresolved'
  | 'title'
  | 'identity'
  | 'scope'
  | 'header'
  | 'record'
  | 'dimension'
  | 'continuation'
  | 'control';
type SourceLine = {
  page: number;
  line: number;
  kind: LineKind;
  tokens: Token[];
};
export type InventoryPdfReading = {
  family: typeof STOCK_PDF_FAMILY;
  status: 'interpreted' | 'source-error';
  financialApproval: false;
  source: NativePdfSource;
  reportId: string | null;
  scope: Record<string, Pair>;
  pageEvidence: {
    page: number;
    title: InventoryPdfSpan;
    report: Pair;
    sequence: Pair;
  }[];
  records: InventoryPdfRecord[];
  inventory: { page: number; line: number; kind: LineKind; items: number[] }[];
  pageControls: { page: number; total: Pair; end: InventoryPdfSpan }[];
  reportTotal: Pair | null;
  reportEnd: InventoryPdfSpan | null;
  issues: { code: string; page: number; line: number }[];
};
class ReadingFailure extends Error {
  readonly code: string;
  readonly page: number;
  readonly line: number;
  constructor(code: string, page: number, line: number) {
    super(code);
    this.code = code;
    this.page = page;
    this.line = line;
  }
}
const compact = (s: string) => s.replace(/\s+/g, '');
function fail(line: SourceLine, code: string): never {
  throw new ReadingFailure(code, line.page, line.line);
}
function sourceLines(source: NativePdfSource): SourceLine[][] {
  let count = 0;
  return source.pages.map((page) => {
    const lines: SourceLine[] = [];
    for (const t of [...page.tokens].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const previous = lines.at(-1);
      if (
        previous &&
        Math.abs(previous.tokens[0].y - t.y) <= Math.min(1, t.height / 8)
      )
        previous.tokens.push(t);
      else {
        if (++count > MAX_ROWS)
          throw new ReadingFailure('ROW_LIMIT', page.page, lines.length + 1);
        lines.push({
          page: page.page,
          line: lines.length + 1,
          kind: 'unresolved',
          tokens: [t],
        });
      }
    }
    return lines;
  });
}

/** Always starts from owned original bytes through the G1 guard pipeline. */
export async function readInventoryPdfRegister(
  original: ArrayBuffer,
  onProgress?: (p: ProcessingProgress) => void,
): Promise<InventoryPdfReading> {
  const source = await readNativePdfSource(original, onProgress);
  const pages = sourceLines(source);
  const result: InventoryPdfReading = {
    family: STOCK_PDF_FAMILY,
    status: 'source-error',
    financialApproval: false,
    source,
    reportId: null,
    scope: {},
    pageEvidence: [],
    records: [],
    inventory: [],
    pageControls: [],
    reportTotal: null,
    reportEnd: null,
    issues: [],
  };
  const span = (line: SourceLine, tokens = line.tokens): InventoryPdfSpan => {
    if (!tokens.length) fail(line, 'MISSING_FIELD');
    let text = tokens[0].text;
    const gaps: number[] = [];
    for (let i = 1; i < tokens.length; i++) {
      const a = tokens[i - 1],
        b = tokens[i];
      gaps.push(b.x - (a.x + a.width));
      // Adjacent pieces may compose one source run. A visible gap stays a space;
      // numbers/references are never joined by stripping arbitrary whitespace.
      text += (b.x - (a.x + a.width) > 0.2 ? ' ' : '') + b.text;
    }
    let left = Infinity,
      right = -Infinity,
      height = 0;
    for (const t of tokens) {
      left = Math.min(left, t.x);
      right = Math.max(right, t.x + t.width);
      height = Math.max(height, t.height);
    }
    return {
      sourceHash: source.sha256,
      page: line.page,
      line: line.line,
      items: tokens.map((t) => t.item),
      text,
      textAssembly:
        tokens.length === 1
          ? 'single-native-item'
          : gaps.some((gap) => gap > 1e-7)
            ? 'gap-presentation'
            : 'adjacent-native-items',
      gaps,
      box: [left, tokens[0].y, right - left, height],
    };
  };
  // A role may occupy adjacent native pieces, including a reader-split space.
  // Limit role-label search to its literal length, with bounded physical gaps.
  const prefix = (line: SourceLine, label: string, offset = 0) => {
    let text = '';
    for (let i = offset; i < line.tokens.length; i++) {
      const t = line.tokens[i],
        previous = line.tokens[i - 1];
      if (
        i > offset &&
        (t.x - previous.x - previous.width >
          Math.max(t.height, previous.height) * 1.2 ||
          Math.abs(t.height - previous.height) > 0.2)
      )
        break;
      text += compact(t.text);
      if (text === compact(label)) return i + 1;
      if (!compact(label).startsWith(text)) break;
    }
    return -1;
  };
  const pair = (line: SourceLine, label: string): Pair => {
    const end = prefix(line, label);
    if (end < 0 || end === line.tokens.length) fail(line, 'MISSING_FIELD');
    const roleTokens = line.tokens.slice(0, end),
      valueTokens = line.tokens.slice(end);
    const lastRole = roleTokens.at(-1)!,
      firstValue = valueTokens[0];
    if (
      firstValue.x - lastRole.x - lastRole.width <
      Math.max(lastRole.height, firstValue.height)
    )
      fail(line, 'LABEL_VALUE_BOUNDARY');
    return { role: span(line, roleTokens), value: span(line, valueTokens) };
  };
  const tagged = (line: SourceLine): string | undefined =>
    controls
      .filter((label) => prefix(line, label) > 0)
      .sort((a, b) => b.length - a.length)[0];
  const literal = (line: SourceLine, label: string) => {
    if (prefix(line, label) !== line.tokens.length) fail(line, 'CONTROL_SHAPE');
    return span(line);
  };
  const header = (
    line: SourceLine,
  ): { name: InventoryPdfField; role: InventoryPdfSpan }[] | null => {
    const roles: { name: InventoryPdfField; role: InventoryPdfSpan }[] = [];
    let offset = 0;
    while (offset < line.tokens.length) {
      const candidates = fields
        .map((name) => ({ name, end: prefix(line, name, offset) }))
        .filter((c) => c.end > offset)
        .sort((a, b) => b.name.length - a.name.length);
      if (!candidates.length) return null;
      const { name, end } = candidates[0];
      if (roles.some((r) => r.name === name)) fail(line, 'HEADER');
      roles.push({ name, role: span(line, line.tokens.slice(offset, end)) });
      offset = end;
    }
    return roles.length >= 6 ? roles : null;
  };
  let current: SourceLine = pages[0]?.[0] ?? {
    page: 1,
    line: 1,
    kind: 'unresolved',
    tokens: [],
  };
  let pending: { key: string; evidence: Pair } | null = null;
  try {
    if (source.readingIssues.length) fail(current, 'SOURCE_DISPLAY');
    if (pages.some((p) => p.length < 8)) fail(current, 'PAGE_STRUCTURE');
    for (const [index, lines] of pages.entries()) {
      const pn = index + 1;
      let at = 0;
      const next = () => {
        const line = lines[at++];
        if (!line) fail(current, 'PAGE_STRUCTURE');
        current = line;
        return line;
      };
      const titleLine = next();
      literal(titleLine, title);
      titleLine.kind = 'title';
      const reportLine = next(),
        report = pair(reportLine, 'Report ID');
      reportLine.kind = 'identity';
      if (!result.reportId) result.reportId = report.value.text;
      if (
        !report.value.text ||
        report.value.text.length > 255 ||
        report.value.text !== result.reportId
      )
        fail(reportLine, 'REPORT_ID');
      const pageLine = next(),
        sequence = pair(pageLine, 'Page');
      pageLine.kind = 'identity';
      if (sequence.value.text !== pn + ' of ' + pages.length)
        fail(pageLine, 'PAGE_SEQUENCE');
      result.pageEvidence.push({
        page: pn,
        title: span(titleLine),
        report,
        sequence,
      });
      const local: Record<string, Pair> = {};
      while (at < lines.length) {
        const line = lines[at],
          tag = tagged(line);
        if (!tag || !scopeLabels.includes(tag)) break;
        current = line;
        if (local[tag]) fail(line, 'SCOPE_DUPLICATE');
        local[tag] = pair(line, tag);
        line.kind = 'scope';
        at++;
      }
      if (pn === 1) {
        if (Object.keys(local).length !== scopeLabels.length)
          fail(current, 'SCOPE');
        result.scope = { ...local };
      } else {
        if (!local.Currency || !local['As of']) fail(current, 'SCOPE');
        for (const [key, value] of Object.entries(local))
          if (value.value.text !== result.scope[key]?.value.text)
            fail(lines[value.role.line - 1], 'SCOPE_CONFLICT');
      }
      let continuationResolved = !pending;
      let sectionIncoming: IncomingContinuation | null = null;
      let incoming: IncomingContinuation | null = null;
      let outgoing: Pair | null = null;
      let parent: Pair | null = null,
        batch: Pair | null = null;
      let roles: ReturnType<typeof header> = null;
      let section: InventoryPdfRecord[] = [];
      let pageTotal: Pair | null = null,
        pageEnd: InventoryPdfSpan | null = null;
      const closeSection = (end: InventoryPdfSpan) => {
        for (const r of section) r.sectionEnd = end;
        section = [];
        parent = null;
        batch = null;
        roles = null;
      };
      if (pending) {
        const line = next();
        if (prefix(line, 'Continued section') < 0) fail(line, 'CONTINUATION');
        incoming = {
          ...pair(line, 'Continued section'),
          prior: pending.evidence,
        };
        line.kind = 'continuation';
        if (incoming.value.text !== pending.key) fail(line, 'CONTINUATION');
      }
      while (at < lines.length) {
        const line = next();
        let tag = tagged(line);
        // A legitimate item can be named "Page" or "Batch". Complete local
        // field occupancy distinguishes a data row from a label/value control;
        // the normal field-boundary and ownership checks still run below.
        if (
          roles &&
          tag &&
          roles.every((role, column) => {
            const left = role.role.box[0];
            const right =
              roles![column + 1]?.role.box[0] ?? source.pages[index].width;
            return line.tokens.some(
              (t) => t.x >= left - 0.2 && t.x < right - 0.2,
            );
          })
        )
          tag = undefined;
        if (result.reportEnd) fail(line, 'TRAILING_AFTER_REPORT');
        if (outgoing && !pageTotal && tag !== 'Page total')
          fail(line, 'CONTINUATION');
        if (pageEnd && tag !== 'Report total' && tag !== 'End report')
          fail(line, 'TRAILING_AFTER_PAGE');
        if (pageTotal && !pageEnd && tag !== 'End page') fail(line, 'PAGE_END');
        if (tag === 'Warehouse') {
          const nextParent = pair(line, tag);
          closeSection(nextParent.role);
          parent = nextParent;
          sectionIncoming = pending ? incoming : null;
          if (/[;=]/.test(parent.value.text)) fail(line, 'DIMENSION');
          line.kind = 'dimension';
        } else if (tag === 'Batch') {
          if (!parent || batch) fail(line, 'HEADER_DIMENSIONS');
          batch = pair(line, tag);
          if (/[;=]/.test(batch.value.text)) fail(line, 'DIMENSION');
          if (incoming && pending) {
            const key =
              'warehouse=' + parent.value.text + ';batch=' + batch.value.text;
            if (key !== pending.key) fail(line, 'CONTINUATION');
            pending = null;
            continuationResolved = true;
          }
          line.kind = 'dimension';
        } else if (tag === 'End section') {
          if (!parent || !batch || !section.length) fail(line, 'END_SECTION');
          closeSection(literal(line, tag));
          line.kind = 'control';
        } else if (tag === 'Continues section') {
          if (
            !parent ||
            !batch ||
            !roles ||
            !section.length ||
            outgoing ||
            pn === pages.length
          )
            fail(line, 'CONTINUATION');
          outgoing = pair(line, tag);
          const key =
            'warehouse=' + parent.value.text + ';batch=' + batch.value.text;
          if (outgoing.value.text !== key) fail(line, 'CONTINUATION');
          for (const r of section) r.outgoingContinuation = outgoing;
          closeSection(outgoing.role);
          pending = { key, evidence: outgoing };
          line.kind = 'continuation';
        } else if (tag === 'Page total') {
          pageTotal = pair(line, tag);
          closeSection(pageTotal.role);
          line.kind = 'control';
        } else if (tag === 'End page') {
          if (!pageTotal || pageEnd) fail(line, 'PAGE_END');
          pageEnd = literal(line, tag);
          line.kind = 'control';
          result.pageControls.push({
            page: pn,
            total: pageTotal,
            end: pageEnd,
          });
        } else if (tag === 'Report total') {
          if (pn !== pages.length || !pageEnd || result.reportTotal)
            fail(line, 'REPORT_TOTAL');
          result.reportTotal = pair(line, tag);
          line.kind = 'control';
        } else if (tag === 'End report') {
          if (pn !== pages.length || !result.reportTotal)
            fail(line, 'REPORT_END');
          result.reportEnd = literal(line, tag);
          line.kind = 'control';
        } else {
          if (tag) fail(line, 'UNCLASSIFIED_ROW');
          const candidates = header(line);
          if (candidates) {
            const names = candidates.map((c) => c.name);
            const isFlat = names.includes('Item dimensions');
            if (
              names.length !== (isFlat ? 7 : 6) ||
              (!isFlat && (!parent || !batch))
            )
              fail(line, 'HEADER_DIMENSIONS');
            if (isFlat && (parent || batch)) fail(line, 'HEADER_DIMENSIONS');
            roles = candidates;
            line.kind = 'header';
          } else {
            if (!roles) fail(line, 'UNCLASSIFIED_ROW');
            const valueFields: InventoryPdfRecord['fields'] = {};
            const owned = new Set<number>();
            for (const [column, role] of roles.entries()) {
              const left = role.role.box[0],
                right =
                  roles[column + 1]?.role.box[0] ?? source.pages[index].width;
              const tokens = line.tokens.filter(
                (t) => t.x >= left - 0.2 && t.x < right - 0.2,
              );
              if (!tokens.length) fail(line, 'MISSING_FIELD');
              if (tokens.some((t) => t.x + t.width > right + 0.2))
                fail(line, 'FIELD_BOUNDARY');
              for (const t of tokens) {
                if (owned.has(t.item)) fail(line, 'FIELD_OWNERSHIP');
                owned.add(t.item);
              }
              valueFields[role.name] = {
                role: role.role,
                value: span(line, tokens),
              };
            }
            if (owned.size !== line.tokens.length)
              fail(line, 'UNCLASSIFIED_VALUE');
            if (incoming && pending) fail(line, 'CONTINUATION');
            const record: InventoryPdfRecord = {
              id: JSON.stringify([
                STOCK_PDF_FAMILY,
                source.sha256,
                pn,
                line.line,
                line.tokens.map((t) => t.item),
              ]),
              page: pn,
              line: line.line,
              fields: valueFields,
              parent,
              batch,
              sectionEnd: null,
              incomingContinuation: sectionIncoming,
              outgoingContinuation: null,
              scopeEvidence: Object.values(local),
              documentScopeEvidence: Object.values(result.scope),
            };
            result.records.push(record);
            if (parent) section.push(record);
            line.kind = 'record';
          }
        }
      }
      if (!pageTotal || !pageEnd) fail(current, 'PAGE_END');
      if (!continuationResolved) fail(current, 'CONTINUATION');
    }
    if (pending) fail(current, 'CONTINUATION');
    if (!result.reportTotal || !result.reportEnd) fail(current, 'REPORT_END');
    if (!result.records.length) fail(current, 'NO_RECORDS');
    result.status = 'interpreted';
  } catch (error) {
    if (!(error instanceof ReadingFailure)) throw error;
    result.issues.push({
      code: error.code,
      page: error.page,
      line: error.line,
    });
  }
  result.inventory = pages.flatMap((lines) =>
    lines.map((line) => ({
      page: line.page,
      line: line.line,
      kind: line.kind,
      items: line.tokens.map((t) => t.item),
    })),
  );
  return result;
}
