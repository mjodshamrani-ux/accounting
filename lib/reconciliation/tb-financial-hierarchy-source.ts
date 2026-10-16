import {
  FIN_HIERARCHY_INTAKE_CONTRACT,
  FIN_HIERARCHY_SCOPE_HEADERS as SCOPE,
  FIN_HIERARCHY_NODE_HEADERS as NODE,
  FIN_HIERARCHY_CATEGORIES as CATEGORIES,
  FIN_HIERARCHY_LIMITS as LIMITS,
  type FinancialHierarchyScope,
  type FinancialHierarchyIssueCode,
  type FinancialHierarchySource4Input,
  type FinancialHierarchySource4Result,
  type FinancialHierarchyNode,
} from './tb-financial-hierarchy-contract.ts';

const plain = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  (Object.getPrototypeOf(v) === Object.prototype ||
    Object.getPrototypeOf(v) === null);
const textLength = (v: string) => Array.from(v).length;
const abs = (v: bigint) => (v < 0n ? -v : v);
const category = (v: string): v is (typeof CATEGORIES)[number] =>
  (CATEGORIES as readonly string[]).includes(v);

function validDate(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return (
    day <=
    [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  );
}

interface CSVRecord {
  raw: string[];
  lexemes: string[];
  serialized: string;
}
/** Strict comma CSV with LF/CRLF/bare CR record endings; quoted newlines stay literal. */
function readCSV(text: string): {
  records: CSVRecord[];
  reason: FinancialHierarchyIssueCode | null;
} {
  const records: CSVRecord[] = [];
  let i = 0;
  while (i < text.length) {
    const recordStart = i;
    const raw: string[] = [],
      lexemes: string[] = [];
    let recordDone = false;
    while (!recordDone) {
      const start = i;
      let value = '';
      if (text[i] === '"') {
        i++;
        let closed = false;
        while (i < text.length) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              value += '"';
              i += 2;
            } else {
              i++;
              closed = true;
              break;
            }
          } else {
            value += text[i];
            i++;
          }
        }
        if (
          !closed ||
          (i < text.length && ![',', '\r', '\n'].includes(text[i]))
        )
          return { records, reason: 'CSV' };
      } else {
        while (i < text.length && ![',', '\r', '\n'].includes(text[i])) {
          if (text[i] === '"') return { records, reason: 'CSV' };
          value += text[i++];
        }
      }
      raw.push(value);
      lexemes.push(text.slice(start, i));
      if (text[i] === ',') i++;
      else recordDone = true;
    }
    records.push({ raw, lexemes, serialized: text.slice(recordStart, i) });
    // Retain the first exceeding record, then explicitly abort the remaining inventory.
    if (records.length > LIMITS.rows + 1) return { records, reason: 'ROWS' };
    if (raw.some((v) => textLength(v) > LIMITS.fieldCodePoints))
      return { records, reason: 'TEXT' };
    if (text[i] === '\r' && text[i + 1] === '\n') i += 2;
    else if (text[i] === '\r' || text[i] === '\n') i++;
  }
  return { records, reason: null };
}

/** All output is diagnostic. A blocked tree never selects a duplicate contender. */
function inspectTree(
  result: FinancialHierarchySource4Result,
  problem: (
    code: FinancialHierarchyIssueCode,
    row?: number | null,
    field?: string | null,
  ) => void,
) {
  const byId = new Map<string, FinancialHierarchyNode[]>();
  for (const node of result.nodes) {
    if (!node.id) problem('IDENTITY', node.row, 'Node ID');
    const contenders = byId.get(node.id) ?? [];
    contenders.push(node);
    byId.set(node.id, contenders);
  }
  for (const contenders of byId.values())
    if (contenders.length > 1)
      for (const node of contenders)
        problem('DUPLICATE_NODE', node.row, 'Node ID');
  const unique = (id: string) => {
    const candidates = byId.get(id);
    return candidates?.length === 1 ? candidates[0] : undefined;
  };
  for (const node of result.nodes) {
    if (node.parentId) {
      const parents = byId.get(node.parentId) ?? [];
      result.edges.push({
        childId: node.id,
        childRow: node.row,
        parentId: node.parentId,
        parentRows: parents.map((p) => p.row),
        citationIndices: result.citations.flatMap((c, index) =>
          c.row === node.row && c.field === 'Parent ID' ? [index] : [],
        ),
      });
      const owner = unique(node.parentId);
      if (!owner || owner.kind !== 'parent' || node.kind === 'title')
        problem('PARENT', node.row, 'Parent ID');
      else if (owner.lineClass !== node.lineClass)
        problem('CLASSIFICATION', node.row, 'Line class');
    }
    const visited = new Set<string>();
    let cursor: FinancialHierarchyNode | undefined = node;
    while (cursor && cursor.kind !== 'title') {
      if (visited.has(cursor.id)) {
        problem('CYCLE', node.row, 'Parent ID');
        break;
      }
      visited.add(cursor.id);
      if (visited.size > LIMITS.depth) {
        problem('DEPTH', node.row, 'Parent ID');
        break;
      }
      cursor = cursor.parentId ? unique(cursor.parentId) : undefined;
    }
  }
  const checkedSum = (values: bigint[], row: number | null, field: string) => {
    const sum = values.reduce((a, b) => a + b, 0n);
    if (
      values.some((v) => abs(v) > LIMITS.minorAbs) ||
      abs(sum) > LIMITS.minorAbs
    )
      problem('SUM', row, field);
    return sum;
  };
  for (const node of result.nodes.filter((n) => n.kind === 'parent')) {
    const children = result.nodes.filter(
      (n) => n.parentId === node.id && n.kind !== 'title',
    );
    if (!children.length) problem('EMPTY_PARENT', node.row, 'Node ID');
    const unambiguous =
      unique(node.id) &&
      children.every(
        (c) =>
          unique(c.id) &&
          ['leaf', 'parent'].includes(c.kind) &&
          c.amountMinor !== null,
      );
    const childTotal =
      unambiguous && children.length
        ? checkedSum(
            children.map((c) => c.amountMinor!),
            node.row,
            'Parent child total',
          )
        : null;
    const difference =
      childTotal !== null && node.amountMinor !== null
        ? checkedSum(
            [node.amountMinor, -childTotal],
            node.row,
            'Control difference',
          )
        : null;
    if (difference !== null && difference !== 0n)
      problem('CONTROL_TOTAL', node.row, 'Amount');
    result.controls.push({
      nodeId: node.id,
      row: node.row,
      children: children.map((c) => ({
        nodeId: c.id,
        row: c.row,
        amountMinor: c.amountMinor,
      })),
      suppliedMinor: node.amountMinor,
      childTotalMinor: childTotal,
      differenceMinor: difference,
      matches: difference === null ? null : difference === 0n,
      citationIndices: node.citationIndices,
    });
  }
  if (!result.nodes.some((n) => n.kind === 'leaf'))
    problem('NO_FINANCIAL_LEAF');
  // Do not publish a seemingly canonical set of contributions after malformed/ambiguous input.
  if (result.issues.length) return;
  const leaves = result.nodes.filter((n) => n.kind === 'leaf');
  const categoryMinor = Object.fromEntries(
    CATEGORIES.map((c) => [
      c,
      checkedSum(
        leaves.filter((n) => n.lineClass === c).map((n) => n.amountMinor!),
        null,
        c,
      ),
    ]),
  ) as Record<(typeof CATEGORIES)[number], bigint>;
  const assetsMinor = checkedSum(
    [categoryMinor['current-asset'], categoryMinor['noncurrent-asset']],
    null,
    'Assets',
  );
  const liabilitiesMinor = checkedSum(
    [categoryMinor['current-liability'], categoryMinor['noncurrent-liability']],
    null,
    'Liabilities',
  );
  const equityMinor = categoryMinor.equity;
  const equationMinor = checkedSum(
    [assetsMinor, -liabilitiesMinor, -equityMinor],
    null,
    'Statement equation',
  );
  result.leafSums = {
    leaves: leaves.map((n) => ({
      nodeId: n.id,
      row: n.row,
      lineClass: n.lineClass,
      amountMinor: n.amountMinor!,
    })),
    categoryMinor,
    assetsMinor,
    liabilitiesMinor,
    equityMinor,
    equationMinor,
  };
}

export async function inspectFinancialHierarchySource4(
  input: FinancialHierarchySource4Input,
): Promise<FinancialHierarchySource4Result> {
  const result: FinancialHierarchySource4Result = {
    intakeContract: FIN_HIERARCHY_INTAKE_CONTRACT,
    kind: 'passive-source4-inspection',
    status: 'blocked',
    scope: null,
    source: null,
    header: null,
    nodes: [],
    edges: [],
    controls: [],
    leafSums: null,
    inventory: [],
    citations: [],
    inventoryState: { complete: false, reason: 'INPUT', recordsObserved: 0 },
    issues: [],
  };
  const problem = (
    code: FinancialHierarchyIssueCode,
    row: number | null = null,
    field: string | null = null,
  ) => {
    if (
      !result.issues.some(
        (p) => p.code === code && p.row === row && p.field === field,
      )
    )
      result.issues.push({
        code,
        row,
        field,
        citationIndices: result.citations.flatMap((c, i) =>
          c.row === row && (field === null || c.field === field) ? [i] : [],
        ),
      });
  };
  let name: string, snapshot: ArrayBuffer;
  // Capture every caller-owned input before the first await (including before digest).
  try {
    if (!plain(input)) {
      problem('INPUT');
      return result;
    }
    name = input.name;
    const original = input.original;
    if (!(original instanceof ArrayBuffer)) {
      problem('INPUT');
      return result;
    }
    const byteLength = original.byteLength;
    if (!byteLength || byteLength > LIMITS.bytes) {
      problem('BYTES');
      result.inventoryState.reason = 'BYTES';
      return result;
    }
    const bytes = new Uint8Array(byteLength);
    bytes.set(new Uint8Array(original));
    snapshot = bytes.buffer;
    const scope = input.expectedScope;
    if (!plain(scope) || Object.keys(scope).length !== SCOPE.length)
      problem('SCOPE');
    else {
      const captured: Record<string, string> = {};
      for (const key of SCOPE) {
        const descriptor = Object.getOwnPropertyDescriptor(scope, key);
        if (
          !descriptor ||
          !('value' in descriptor) ||
          typeof descriptor.value !== 'string' ||
          !descriptor.value ||
          textLength(descriptor.value) > LIMITS.fieldCodePoints
        )
          problem('SCOPE', null, key);
        else captured[key] = descriptor.value;
      }
      if (Object.keys(captured).length === SCOPE.length)
        result.scope = captured as FinancialHierarchyScope;
    }
    if (
      typeof name !== 'string' ||
      !name ||
      textLength(name) > 255 ||
      !/\.csv$/i.test(name)
    )
      problem('NAME');
  } catch {
    problem('INPUT');
    return result;
  }
  let hash: string;
  try {
    hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', snapshot)),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
  } catch {
    problem('HASH');
    result.inventoryState.reason = 'HASH';
    return result;
  }
  result.source = {
    name: typeof name === 'string' ? name : '',
    original: snapshot,
    sha256: hash,
    byteLength: snapshot.byteLength,
  };
  if (result.scope) {
    const s = result.scope;
    for (const [key, value] of [
      ['Currency', 'SAR'],
      ['Currency basis', 'functional'],
      ['Posting status', 'posted'],
      ['Posting layer', 'actual'],
      ['Closing basis', 'post-closing'],
    ] as const)
      if (s[key] !== value) problem('UNSUPPORTED_SCOPE', null, key);
    for (const key of ['Period start', 'Period end', 'As of'] as const)
      if (!validDate(s[key])) problem('DATE', null, key);
    if (s['Period start'] > s['Period end'] || s['As of'] !== s['Period end'])
      problem('SCOPE');
  }
  let text: string;
  try {
    // ignoreBOM=true preserves U+FEFF so a BOM header is rejected, never silently stripped.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      snapshot,
    );
  } catch {
    problem('UTF8');
    result.inventoryState.reason = 'UTF8';
    return result;
  }
  const parsed = readCSV(text);
  result.inventoryState = {
    complete: parsed.reason === null,
    reason: parsed.reason,
    recordsObserved: Math.max(0, parsed.records.length - 1),
  };
  const header = parsed.records[0]?.raw ?? null;
  result.header = header;
  const wanted = [...NODE, ...SCOPE];
  const validHeader =
    !!header &&
    header.length === wanted.length &&
    new Set(header).size === wanted.length &&
    wanted.every((field) => header.includes(field));
  for (const [index, record] of parsed.records.entries()) {
    const row = index + 1;
    const citationIndices: number[] = [];
    for (const [column, raw] of record.raw.entries()) {
      citationIndices.push(result.citations.length);
      result.citations.push({
        sourceRole: 'financial-position',
        sha256: hash,
        row,
        column: column + 1,
        field: header?.[column] ?? null,
        raw,
        lexeme: record.lexemes[column],
      });
    }
    if (!index) continue;
    result.inventory.push({
      row,
      ...record,
      validWidth: header ? record.raw.length === header.length : null,
      citationIndices,
    });
    if (record.raw.length !== header?.length) problem('WIDTH', row);
    for (const [column, raw] of record.raw.entries())
      if (textLength(raw) > LIMITS.fieldCodePoints)
        problem('TEXT', row, header?.[column] ?? null);
  }
  if (parsed.reason)
    problem(
      parsed.reason,
      parsed.reason === 'CSV'
        ? parsed.records.length + 1
        : parsed.records.length,
    );
  if (!validHeader) problem('HEADERS', 1);
  if (!result.inventory.length) problem('EMPTY_SOURCE', 1);
  if (validHeader)
    for (const record of result.inventory) {
      if (
        !record.validWidth ||
        record.row > LIMITS.rows + 1 ||
        record.raw.some((v) => textLength(v) > LIMITS.fieldCodePoints)
      )
        continue;
      const get = (field: string) => record.raw[header!.indexOf(field)];
      for (const key of SCOPE)
        if (!result.scope || get(key) !== result.scope[key])
          problem('SCOPE', record.row, key);
      const kind = get('Kind'),
        amount = get('Amount');
      let amountMinor: bigint | null = null;
      if (!['leaf', 'parent', 'title'].includes(kind))
        problem('KIND', record.row, 'Kind');
      if (kind === 'title') {
        if (get('Parent ID') || get('Line class') || amount)
          problem('TITLE', record.row);
      } else if (['leaf', 'parent'].includes(kind)) {
        if (!category(get('Line class')))
          problem('CLASSIFICATION', record.row, 'Line class');
        if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(amount))
          problem('MONEY', record.row, 'Amount');
        else {
          const negative = amount.startsWith('-');
          const [whole, fraction = ''] = (
            negative ? amount.slice(1) : amount
          ).split('.');
          const minor =
            (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) *
            (negative ? -1n : 1n);
          if (abs(minor) > LIMITS.minorAbs)
            problem('MONEY', record.row, 'Amount');
          else amountMinor = minor;
        }
      }
      result.nodes.push({
        row: record.row,
        id: get('Node ID'),
        parentId: get('Parent ID'),
        kind,
        label: get('Line label'),
        lineClass: get('Line class'),
        amountMinor,
        citationIndices: record.citationIndices,
      });
    }
  inspectTree(result, problem);
  if (!result.issues.length && result.inventoryState.complete)
    result.status = 'inspected';
  return result;
}
