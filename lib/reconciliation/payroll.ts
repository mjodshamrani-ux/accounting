import { currencyPrecision } from './currency-precision.ts';
import { assertSourceFile } from './protocol.ts';
import { MAX_ROWS, MAX_FILE_BYTES, type SourceFile } from './types.ts';
export const PAYROLL_VERSION = 'payroll-posted-run-gl-bank-1';
export const PAYROLL_ROLES = [
  'register',
  'mapping',
  'policy-evidence',
  'gl',
  'bank-payout',
] as const;
export const PAYROLL_FIELDS = [
  'entity',
  'payrollRun',
  'payrollLedger',
  'glLedger',
  'currency',
  'currencyBasis',
  'postingStatus',
  'postingLayer',
  'periodStart',
  'periodEnd',
  'payrollPostingDate',
  'paymentDate',
  'bankAccount',
  'payoutReference',
  'chartVersion',
  'mapVersion',
  'payrollPolicyVersion',
  'bankMappingVersion',
  'accountSetVersion',
] as const;
export const PAYROLL_SCOPE_HEADERS = [
  'Entity',
  'Payroll run',
  'Payroll ledger',
  'GL ledger',
  'Currency',
  'Currency basis',
  'Posting status',
  'Posting layer',
  'Period start',
  'Period end',
  'Payroll posting date',
  'Payment date',
  'Bank account',
  'Payout reference',
  'Chart version',
  'Map version',
  'Payroll policy version',
  'Bank mapping version',
  'Account set version',
] as const;
export const PAYROLL_COMPONENTS = [
  'gross-expense',
  'employee-deduction-payable',
  'net-payable',
  'employer-expense',
  'employer-payable',
  'net-clearing',
  'bank-cash',
] as const;
export const PAYROLL_CLASSES = [
  'payroll-expense',
  'employee-deduction-liability',
  'payroll-net-liability',
  'employer-contribution-expense',
  'employer-contribution-liability',
  'payroll-net-liability',
  'cash',
] as const;
export const PAYROLL_SIGNS = [
  'debit-positive',
  'credit-positive',
  'credit-positive',
  'debit-positive',
  'credit-positive',
  'debit-positive',
  'credit-positive',
] as const;
export const PAYROLL_PHASES = [
  'payroll',
  'payroll',
  'payroll',
  'payroll',
  'payroll',
  'disbursement',
  'disbursement',
] as const;
export const PAYROLL_AMOUNT_KEYS = [
  'gross',
  'deductions',
  'net',
  'employer',
  'employer',
  'net',
  'net',
] as const;
export const PAYROLL_VALUES = [
  [
    'Employee ID',
    'Employee dimensions',
    'Gross',
    'Deductions',
    'Employer contribution',
    'Net',
    'Payroll reference',
  ],
  [
    'Mapping ID',
    'Employee ID',
    'Employee dimensions',
    'Component',
    'GL account',
    'GL dimensions',
    'Evidence ID',
  ],
  [
    'Evidence ID',
    'Employee ID',
    'Employee dimensions',
    'Component',
    'Payroll reference',
    'GL account',
    'GL dimensions',
    'Account class',
    'Sign',
    'Value basis',
    'Valid from',
    'Valid to',
    'Reference',
  ],
  [
    'Entry ID',
    'Phase',
    'Component',
    'GL account',
    'GL dimensions',
    'Account class',
    'Debit',
    'Credit',
    'Entry date',
    'Posting reference',
  ],
  [
    'Transaction ID',
    'Transaction bank account',
    'Direction',
    'Amount',
    'Value date',
    'Transaction payout reference',
  ],
] as const;
export const PAYROLL_HEADERS = PAYROLL_VALUES.map((v) => [
  ...v,
  ...PAYROLL_SCOPE_HEADERS,
]);
export type PayrollComponent = (typeof PAYROLL_COMPONENTS)[number];
export type PayrollScope = Record<(typeof PAYROLL_FIELDS)[number], string> & {
  confirmed: boolean;
};
export type PayrollReading = {
  sheet: number;
  role: (typeof PAYROLL_ROLES)[number];
  family: typeof PAYROLL_VERSION;
  confirmed: boolean;
};
export type PayrollEvent = {
  id: string;
  type: 'accept' | 'reject' | 'undo';
  memberIds: string[];
  context: string;
  at: string;
  reference: string;
  note: string;
};
export type PayrollInput = {
  files: [SourceFile, SourceFile, SourceFile, SourceFile, SourceFile];
  readings: [
    PayrollReading,
    PayrollReading,
    PayrollReading,
    PayrollReading,
    PayrollReading,
  ];
  scope: PayrollScope;
  completeness: { confirmed: boolean; reference: string; note: string };
  events: PayrollEvent[];
};
type Physical = { memberId: string; source: number; row: number };
export type PayrollRegisterRow = Physical & {
  employee: string;
  dimensions: string;
  gross: number;
  deductions: number;
  employer: number;
  net: number;
  payrollReference: string;
};
export type PayrollMappingRow = Physical & {
  id: string;
  employee: string;
  dimensions: string;
  component: PayrollComponent;
  account: string;
  glDimensions: string;
  evidence: string;
};
export type PayrollEvidenceRow = Physical & {
  id: string;
  employee: string;
  dimensions: string;
  component: PayrollComponent;
  payrollReference: string;
  account: string;
  glDimensions: string;
  accountClass: string;
  sign: string;
  basis: string;
  validFrom: string;
  validTo: string;
  reference: string;
};
export type PayrollGLRow = Physical & {
  id: string;
  phase: 'payroll' | 'disbursement';
  component: PayrollComponent;
  account: string;
  glDimensions: string;
  accountClass: string;
  debit: number;
  credit: number;
  entryDate: string;
  postingReference: string;
  normal: number;
};
export type PayrollBankRow = Physical & {
  id: string;
  bankAccount: string;
  direction: 'outflow';
  amount: number;
  valueDate: string;
  payoutReference: string;
};
export type PayrollTotals = {
  gross: number;
  deductions: number;
  employer: number;
  net: number;
};
export type PayrollMissing = {
  reason: string;
  source: number;
  row: number;
  component?: PayrollComponent;
};
export type PayrollComparison = {
  account: string;
  dimensions: string;
  component: PayrollComponent;
  register: number | null;
  gl: number | null;
  difference: number | null;
  glRow: number;
  registerRows: number[];
};
export type PayrollBankComparison = {
  register: number | null;
  bank: number | null;
  difference: number | null;
  bankRows: number[];
};
export type PayrollResult = {
  version: typeof PAYROLL_VERSION;
  context: string;
  scope: PayrollScope;
  readings: PayrollInput['readings'];
  completeness: PayrollInput['completeness'];
  decimals: number;
  records: [
    PayrollRegisterRow[],
    PayrollMappingRow[],
    PayrollEvidenceRow[],
    PayrollGLRow[],
    PayrollBankRow[],
  ];
  issues: { source: number; row: number; code: string }[];
  missing: PayrollMissing[];
  comparisons: PayrollComparison[];
  bankComparison: PayrollBankComparison;
  totals: {
    register: PayrollTotals;
    gl: Record<PayrollComponent, number>;
    bank: number;
  } | null;
  inventory: {
    source: number;
    row: number;
    kind: 'header' | 'blank' | 'data';
  }[];
  cells: {
    source: number;
    row: number;
    column: number;
    field: string;
    text: string;
  }[];
  memberIds: string[];
  events: PayrollEvent[];
  financial: 'source-error' | 'missing' | 'difference' | 'ready';
  review: 'needs-review' | 'accepted' | 'rejected';
  status:
    | 'source-error'
    | 'missing'
    | 'difference'
    | 'needs-review'
    | 'consistent-with-evidence';
};
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, expected: string[]) =>
  Object.keys(v).sort().join('|') === [...expected].sort().join('|');
function fail(code: string): never {
  throw Error('PAYROLL_' + code);
}
function text(value: unknown, max = 500): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value.length > max ||
    /[\p{Cc}\p{Cf}]/u.test(value) ||
    /^[=+@-]|^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(value)
  )
    fail('IDENTITY');
  return value;
}
function day(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.slice(0, 4) === '0000' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail('VALIDITY');
  return value;
}
function scaled(value: string, precision: number) {
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(value)) fail('NUMBER');
  const [integer, fraction = ''] = value.split('.');
  if (fraction.length > precision) fail('PRECISION');
  const n = BigInt(integer + fraction.padEnd(precision, '0'));
  if (n > 100000000000000n) fail('BOUND');
  return Number(n);
}
export function assertPayrollEventBudget(events: unknown) {
  if (!Array.isArray(events) || events.length > 1000) fail('EVENT_CAPACITY');
  let total = 0;
  for (const e of events) {
    if (
      !plain(e) ||
      !Array.isArray(e.memberIds) ||
      e.memberIds.length > MAX_ROWS
    )
      fail('EVENT_CAPACITY');
    total += e.memberIds.length;
    if (total > 100000) fail('EVENT_CAPACITY');
  }
}
export function reconcilePayroll(input: PayrollInput): PayrollResult {
  if (
    !plain(input) ||
    !keys(input, ['files', 'readings', 'scope', 'completeness', 'events']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 5 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 5
  )
    fail('INPUT');
  assertPayrollEventBudget(input.events);
  const s = input.scope;
  if (
    !plain(s) ||
    !keys(s, [...PAYROLL_FIELDS, 'confirmed']) ||
    s.confirmed !== true ||
    !PAYROLL_FIELDS.every((k) => text(s[k]) === s[k])
  )
    fail('SCOPE');
  const decimals = currencyPrecision(s.currency);
  if (decimals === undefined || !['SAR', 'JPY', 'KWD'].includes(s.currency))
    fail('CURRENCY');
  if (s.currencyBasis !== 'functional' || s.postingStatus !== 'posted')
    fail('SCOPE');
  const periodStart = day(s.periodStart),
    periodEnd = day(s.periodEnd),
    posting = day(s.payrollPostingDate),
    paid = day(s.paymentDate);
  if (!(periodStart <= periodEnd && periodEnd <= posting && posting <= paid))
    fail('SCOPE_DATES');
  if (
    input.files.reduce((n, f) => n + (f.original?.byteLength ?? 0), 0) >
    32 * 1024 * 1024
  )
    fail('SOURCE_CAPACITY');
  const c = input.completeness;
  if (
    !plain(c) ||
    !keys(c, ['confirmed', 'reference', 'note']) ||
    typeof c.confirmed !== 'boolean' ||
    typeof c.reference !== 'string' ||
    typeof c.note !== 'string'
  )
    fail('COMPLETENESS');
  if (c.confirmed || c.reference) text(c.reference, 2000);
  if (c.confirmed || c.note) text(c.note, 2000);
  input.readings.forEach((r, i) => {
    if (
      !plain(r) ||
      !keys(r, ['sheet', 'role', 'family', 'confirmed']) ||
      r.sheet !== 0 ||
      r.role !== PAYROLL_ROLES[i] ||
      r.family !== PAYROLL_VERSION ||
      r.confirmed !== true
    )
      fail('READING');
  });
  input.files.forEach((f) => {
    assertSourceFile(f);
    text(f.name, 255);
    if (
      f.kind !== undefined ||
      !/\.csv$/i.test(f.name) ||
      f.sheets.length !== 1 ||
      !(f.original instanceof ArrayBuffer) ||
      !f.original.byteLength ||
      f.original.byteLength > MAX_FILE_BYTES ||
      !/^[a-f0-9]{64}$/.test(f.sha256 ?? '')
    )
      fail('SOURCE');
    const sh = f.sheets[0];
    if (
      sh.rows.length > MAX_ROWS + 1 ||
      sh.rows.some((r) => r.length > 100 || r.some((v) => v.length > 32767))
    )
      fail('SOURCE_CAPACITY');
    if (
      sh.rows.reduce((n, row) => n + row.reduce((a, v) => a + v.length, 0), 0) >
      f.original.byteLength
    )
      fail('SOURCE_CAPACITY');
    if (
      sh.hiddenRows.length ||
      sh.formulaRows.length ||
      Object.keys(sh).some(
        (k) => !['name', 'rows', 'formulaRows', 'hiddenRows'].includes(k),
      )
    )
      fail('SOURCE_METADATA');
  });
  if (new Set(input.files.map((f) => f.sha256)).size !== 5)
    fail('INDEPENDENT_SOURCES');
  if (
    input.files.reduce(
      (n, f) => n + Math.max(0, f.sheets[0].rows.length - 1),
      0,
    ) > MAX_ROWS
  )
    fail('ROWS');
  const scope = {
      ...Object.fromEntries(PAYROLL_FIELDS.map((k) => [k, s[k]])),
      confirmed: true,
    } as PayrollScope,
    readings = input.readings.map((r) => ({
      sheet: r.sheet,
      role: r.role,
      family: r.family,
      confirmed: r.confirmed,
    })) as PayrollInput['readings'],
    completeness = { ...c };
  const context = JSON.stringify([
    PAYROLL_VERSION,
    input.files.map((f) => f.sha256),
    readings,
    scope,
    completeness,
  ]);
  const result: PayrollResult = {
    version: PAYROLL_VERSION,
    context,
    scope,
    readings,
    completeness,
    decimals,
    records: [[], [], [], [], []],
    issues: [],
    missing: [],
    comparisons: [],
    bankComparison: {
      register: null,
      bank: null,
      difference: null,
      bankRows: [],
    },
    totals: null,
    inventory: [],
    cells: [],
    memberIds: [],
    events: [],
    financial: 'ready',
    review: 'needs-review',
    status: 'needs-review',
  };
  const problem = (source: number, row: number, code: string) =>
    result.issues.push({ source, row, code });
  const absent = (
    reason: string,
    source: number,
    row: number,
    component?: PayrollComponent,
  ) =>
    result.missing.push({
      reason,
      source,
      row,
      ...(component ? { component } : {}),
    });
  const component = (v: string): PayrollComponent => {
    if (!PAYROLL_COMPONENTS.includes(v as PayrollComponent)) fail('COMPONENT');
    return v as PayrollComponent;
  };
  input.files.forEach((f, source) => {
    const rows = f.sheets[0].rows,
      header = rows[0] ?? [],
      desired = PAYROLL_HEADERS[source];
    const good =
      header.length === desired.length &&
      new Set(header).size === desired.length &&
      desired.every((h) => header.includes(h));
    const positions = Object.fromEntries(header.map((h, i) => [h, i]));
    if (!rows.length) problem(source, 1, 'COLUMNS');
    rows.forEach((raw, index) => {
      const row = index + 1,
        blank = raw.every((v) => !v.trim()),
        memberId = JSON.stringify([PAYROLL_VERSION, source, f.sha256, 0, row]);
      result.inventory.push({
        source,
        row,
        kind: index === 0 ? 'header' : blank ? 'blank' : 'data',
      });
      raw.forEach((v, column) =>
        result.cells.push({
          source,
          row,
          column: column + 1,
          field: header[column] ?? '',
          text: v,
        }),
      );
      if (index > 0 && !blank) result.memberIds.push(memberId);
      if (index === 0) {
        if (!good) problem(source, row, 'COLUMNS');
        return;
      }
      if (blank) return;
      if (!good || raw.length !== header.length) {
        problem(source, row, 'COLUMNS');
        return;
      }
      const get = (key: string) => raw[positions[key]],
        physical = { source, row, memberId };
      try {
        if (
          PAYROLL_FIELDS.some(
            (k, i) => get(PAYROLL_SCOPE_HEADERS[i]) !== scope[k],
          )
        )
          fail('ROW_SCOPE');
        if (source === 0) {
          const gross = scaled(get('Gross'), decimals),
            deductions = scaled(get('Deductions'), decimals),
            employer = scaled(get('Employer contribution'), decimals),
            net = scaled(get('Net'), decimals);
          if (
            BigInt(gross) - BigInt(deductions) < 0n ||
            BigInt(gross) - BigInt(deductions) !== BigInt(net)
          )
            fail('NET_EQUATION');
          result.records[0].push({
            ...physical,
            employee: text(get('Employee ID')),
            dimensions: text(get('Employee dimensions')),
            gross,
            deductions,
            employer,
            net,
            payrollReference: text(get('Payroll reference'), 2000),
          });
        } else if (source === 1) {
          result.records[1].push({
            ...physical,
            id: text(get('Mapping ID')),
            employee: text(get('Employee ID')),
            dimensions: text(get('Employee dimensions')),
            component: component(get('Component')),
            account: text(get('GL account')),
            glDimensions: text(get('GL dimensions')),
            evidence: text(get('Evidence ID')),
          });
        } else if (source === 2) {
          const c = component(get('Component')),
            i = PAYROLL_COMPONENTS.indexOf(c),
            accountClass = get('Account class'),
            sign = get('Sign'),
            basis = get('Value basis');
          if (
            accountClass !== PAYROLL_CLASSES[i] ||
            sign !== PAYROLL_SIGNS[i] ||
            basis !== 'provided-posted-payroll-component'
          )
            fail('POLICY');
          const validFrom = day(get('Valid from')),
            validTo = day(get('Valid to')),
            relevant =
              PAYROLL_PHASES[i] === 'payroll'
                ? scope.payrollPostingDate
                : scope.paymentDate;
          if (validFrom > relevant || validTo < relevant) fail('VALIDITY');
          result.records[2].push({
            ...physical,
            id: text(get('Evidence ID')),
            employee: text(get('Employee ID')),
            dimensions: text(get('Employee dimensions')),
            component: c,
            payrollReference: text(get('Payroll reference'), 2000),
            account: text(get('GL account')),
            glDimensions: text(get('GL dimensions')),
            accountClass,
            sign,
            basis,
            validFrom,
            validTo,
            reference: text(get('Reference'), 2000),
          });
        } else if (source === 3) {
          const c = component(get('Component')),
            i = PAYROLL_COMPONENTS.indexOf(c),
            phase = get('Phase'),
            accountClass = get('Account class');
          if (phase !== PAYROLL_PHASES[i]) fail('PHASE');
          if (accountClass !== PAYROLL_CLASSES[i]) fail('CLASS');
          const entryDate = day(get('Entry date')),
            postingReference = get('Posting reference');
          if (
            entryDate !==
              (phase === 'payroll'
                ? scope.payrollPostingDate
                : scope.paymentDate) ||
            postingReference !==
              (phase === 'payroll' ? scope.payrollRun : scope.payoutReference)
          )
            fail('POSTING_REFERENCE');
          const debit = scaled(get('Debit'), decimals),
            credit = scaled(get('Credit'), decimals);
          result.records[3].push({
            ...physical,
            id: text(get('Entry ID')),
            phase: phase as PayrollGLRow['phase'],
            component: c,
            account: text(get('GL account')),
            glDimensions: text(get('GL dimensions')),
            accountClass,
            debit,
            credit,
            entryDate,
            postingReference: text(postingReference),
            normal:
              PAYROLL_SIGNS[i] === 'debit-positive'
                ? debit - credit
                : credit - debit,
          });
        } else {
          const bankAccount = get('Transaction bank account'),
            direction = get('Direction'),
            valueDate = day(get('Value date')),
            payoutReference = get('Transaction payout reference');
          if (
            bankAccount !== scope.bankAccount ||
            direction !== 'outflow' ||
            valueDate !== scope.paymentDate ||
            payoutReference !== scope.payoutReference
          )
            fail('BANK_SCOPE');
          const amount = scaled(get('Amount'), decimals);
          if (amount === 0) fail('BANK_AMOUNT');
          result.records[4].push({
            ...physical,
            id: text(get('Transaction ID')),
            bankAccount: text(bankAccount),
            direction,
            amount,
            valueDate,
            payoutReference: text(payoutReference),
          });
        }
      } catch (e) {
        if (!(e instanceof Error) || !e.message.startsWith('PAYROLL_')) throw e;
        problem(source, row, e.message.slice(8));
      }
    });
    const detect = (fields: string[], code: string) => {
      if (!fields.every((k) => header.includes(k))) return;
      const groups = new Map<string, number[]>();
      rows.slice(1).forEach((raw, i) => {
        if (!raw.some((v) => v.trim())) return;
        const key = JSON.stringify(fields.map((k) => raw[positions[k]] ?? '')),
          group = groups.get(key) ?? [];
        group.push(i + 2);
        groups.set(key, group);
      });
      for (const group of groups.values())
        if (group.length > 1)
          for (const row of group) problem(source, row, code);
    };
    detect(
      source === 0
        ? ['Employee ID', 'Employee dimensions']
        : source === 1
          ? ['Employee ID', 'Employee dimensions', 'Component']
          : source === 2
            ? ['Evidence ID']
            : source === 3
              ? ['Phase', 'Component', 'GL account', 'GL dimensions']
              : ['Transaction ID'],
      'DUPLICATE',
    );
    if (source === 1) detect(['Mapping ID'], 'DUPLICATE_MAPPING_ID');
  });
  // Independent entry identities and raw bank cardinality include malformed rows.
  {
    const rows = input.files[3].sheets[0].rows,
      header = rows[0] ?? [],
      p = header.indexOf('Entry ID'),
      groups = new Map<string, number[]>();
    if (p >= 0) {
      rows.slice(1).forEach((r, i) => {
        if (!r.some((v) => v.trim())) return;
        const k = r[p] ?? '',
          g = groups.get(k) ?? [];
        g.push(i + 2);
        groups.set(k, g);
      });
      for (const g of groups.values())
        if (g.length > 1)
          for (const row of g) problem(3, row, 'DUPLICATE_ENTRY_ID');
    }
    if (
      input.files[4].sheets[0].rows
        .slice(1)
        .filter((r) => r.some((v) => v.trim())).length > 1
    )
      problem(4, 0, 'BANK_CARDINALITY');
  }
  const [register, mapping, policies, gls, banks] = result.records;
  const key = (v: { employee: string; dimensions: string }) =>
    JSON.stringify([v.employee, v.dimensions]);
  const accountKey = (v: { account: string; glDimensions: string }) =>
    JSON.stringify([v.account, v.glDimensions]);
  const componentKey = (v: {
    account: string;
    glDimensions: string;
    component: PayrollComponent;
  }) => JSON.stringify([v.account, v.glDimensions, v.component]);
  const mappingIndex = new Map<string, PayrollMappingRow[]>(),
    evidenceIndex = new Map<string, PayrollEvidenceRow[]>(),
    glIndex = new Map<string, PayrollGLRow[]>();
  for (const m of mapping) {
    const k = JSON.stringify([key(m), m.component]),
      group = mappingIndex.get(k) ?? [];
    group.push(m);
    mappingIndex.set(k, group);
  }
  for (const p of policies) {
    const group = evidenceIndex.get(p.id) ?? [];
    group.push(p);
    evidenceIndex.set(p.id, group);
  }
  for (const g of gls) {
    const k = componentKey(g),
      group = glIndex.get(k) ?? [];
    group.push(g);
    glIndex.set(k, group);
  }
  const seen = new Map<string, Set<PayrollComponent>>();
  for (const g of gls) {
    const k = accountKey(g),
      roles = seen.get(k) ?? new Set<PayrollComponent>();
    roles.add(g.component);
    seen.set(k, roles);
    if (
      roles.size > 1 &&
      !(
        roles.size === 2 &&
        roles.has('net-payable') &&
        roles.has('net-clearing')
      )
    )
      problem(3, g.row, 'ACCOUNT_ROLE_CONFLICT');
  }
  const usedMapping = new Set<number>(),
    usedEvidence = new Set<number>(),
    allocations = new Map<
      string,
      { item: PayrollRegisterRow; component: PayrollComponent }[]
    >();
  for (const item of register) {
    const nm =
        mappingIndex.get(JSON.stringify([key(item), 'net-payable'])) ?? [],
      cm = mappingIndex.get(JSON.stringify([key(item), 'net-clearing'])) ?? [];
    if (
      nm.length === 1 &&
      cm.length === 1 &&
      accountKey(nm[0]) !== accountKey(cm[0])
    )
      absent('net-liability-account', 1, cm[0].row, 'net-clearing');
    for (const c of PAYROLL_COMPONENTS) {
      const group = mappingIndex.get(JSON.stringify([key(item), c])) ?? [];
      if (group.length !== 1) {
        absent('mapping', 0, item.row, c);
        continue;
      }
      const m = group[0];
      usedMapping.add(m.row);
      const evidence = evidenceIndex.get(m.evidence) ?? [];
      if (evidence.length !== 1) {
        absent('evidence', 1, m.row, c);
        continue;
      }
      const p = evidence[0];
      if (
        key(p) !== key(item) ||
        p.component !== c ||
        p.payrollReference !== item.payrollReference ||
        accountKey(p) !== accountKey(m)
      ) {
        absent('evidence-match', 1, m.row, c);
        continue;
      }
      usedEvidence.add(p.row);
      const gs = glIndex.get(componentKey(m)) ?? [];
      if (gs.length !== 1) {
        absent('gl', 1, m.row, c);
        continue;
      }
      const k = componentKey(m),
        assigned = allocations.get(k) ?? [];
      assigned.push({ item, component: c });
      allocations.set(k, assigned);
    }
  }
  for (const m of mapping)
    if (!usedMapping.has(m.row))
      absent('orphan-mapping', 1, m.row, m.component);
  for (const p of policies)
    if (!usedEvidence.has(p.row))
      absent('orphan-evidence', 2, p.row, p.component);
  const totalsKeys = ['gross', 'deductions', 'employer', 'net'] as const;
  const registerTotals = { gross: 0n, deductions: 0n, employer: 0n, net: 0n };
  const glTotals = Object.fromEntries(
    PAYROLL_COMPONENTS.map((c) => [c, 0n]),
  ) as Record<PayrollComponent, bigint>;
  for (const item of register)
    for (const k of totalsKeys) registerTotals[k] += BigInt(item[k]);
  if (totalsKeys.some((k) => registerTotals[k] > 100000000000000n))
    problem(0, 0, 'AGGREGATE_BOUND');
  if (register.length && registerTotals.net === 0n)
    problem(0, 0, 'ZERO_RUN_UNSUPPORTED');
  for (const g of gls) {
    glTotals[g.component] += BigInt(g.normal);
    if (
      glTotals[g.component] > 100000000000000n ||
      glTotals[g.component] < -100000000000000n
    )
      problem(3, g.row, 'AGGREGATE_BOUND');
    const assigned = allocations.get(componentKey(g)) ?? [];
    if (!assigned.length) absent('unmapped-gl', 3, g.row, g.component);
    const value = assigned.reduce(
      (n, { item, component: c }) =>
        n + BigInt(item[PAYROLL_AMOUNT_KEYS[PAYROLL_COMPONENTS.indexOf(c)]]),
      0n,
    );
    if (value > 100000000000000n) problem(3, g.row, 'AGGREGATE_BOUND');
    result.comparisons.push({
      account: g.account,
      dimensions: g.glDimensions,
      component: g.component,
      register: value <= 100000000000000n ? Number(value) : null,
      gl: g.normal,
      difference:
        value <= 100000000000000n ? Number(value - BigInt(g.normal)) : null,
      glRow: g.row,
      registerRows: assigned.map(({ item }) => item.row),
    });
  }
  const bankValue = banks.reduce((n, b) => n + BigInt(b.amount), 0n);
  if (bankValue > 100000000000000n) problem(4, 0, 'AGGREGATE_BOUND');
  result.bankComparison = {
    register:
      registerTotals.net <= 100000000000000n
        ? Number(registerTotals.net)
        : null,
    bank: bankValue <= 100000000000000n ? Number(bankValue) : null,
    difference:
      registerTotals.net <= 100000000000000n && bankValue <= 100000000000000n
        ? Number(registerTotals.net - bankValue)
        : null,
    bankRows: banks.map((b) => b.row),
  };
  result.records.forEach((r, i) => {
    if (!r.length) absent('empty-source', i, 0);
  });
  if (result.issues.length) {
    for (const c of result.comparisons)
      Object.assign(c, { register: null, gl: null, difference: null });
    Object.assign(result.bankComparison, {
      register: null,
      bank: null,
      difference: null,
    });
  } else
    result.totals = {
      register: Object.fromEntries(
        totalsKeys.map((k) => [k, Number(registerTotals[k])]),
      ) as PayrollTotals,
      gl: Object.fromEntries(
        PAYROLL_COMPONENTS.map((c) => [c, Number(glTotals[c])]),
      ) as Record<PayrollComponent, number>,
      bank: Number(bankValue),
    };
  result.financial = result.issues.length
    ? 'source-error'
    : result.missing.length
      ? 'missing'
      : result.comparisons.some((c) => c.difference !== 0) ||
          result.bankComparison.difference !== 0
        ? 'difference'
        : 'ready';
  const ids = new Set<string>();
  const physicalIds = new Set(result.memberIds);
  let active: 'accept' | 'reject' | null = null,
    at = '';
  for (const event of input.events) {
    if (
      !plain(event) ||
      !keys(event, [
        'id',
        'type',
        'memberIds',
        'context',
        'at',
        'reference',
        'note',
      ])
    )
      fail('EVENT');
    text(event.id);
    text(event.reference, 2000);
    text(event.note, 2000);
    if (
      ids.has(event.id) ||
      !['accept', 'reject', 'undo'].includes(event.type) ||
      event.context !== context ||
      typeof event.at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.at) ||
      !Number.isFinite(Date.parse(event.at)) ||
      new Date(event.at).toISOString() !== event.at ||
      event.at.slice(0, 4) === '0000' ||
      event.at < at
    )
      fail('EVENT');
    if (
      event.memberIds.length !== result.memberIds.length ||
      !result.memberIds.length ||
      new Set(event.memberIds).size !== event.memberIds.length ||
      !event.memberIds.every((id) => physicalIds.has(id))
    )
      fail('EVENT_MEMBERS');
    if (event.type === 'undo') {
      if (active === null) fail('EVENT_SEQUENCE');
      active = null;
    } else {
      if (active !== null) fail('EVENT_SEQUENCE');
      if (
        event.type === 'accept' &&
        (result.financial !== 'ready' || !completeness.confirmed)
      )
        fail('EVENT_ACCEPT');
      active = event.type;
    }
    ids.add(event.id);
    at = event.at;
    result.events.push({ ...event, memberIds: [...event.memberIds] });
  }
  result.review =
    active === 'accept'
      ? 'accepted'
      : active === 'reject'
        ? 'rejected'
        : 'needs-review';
  result.status =
    result.financial !== 'ready'
      ? result.financial
      : result.review === 'accepted'
        ? 'consistent-with-evidence'
        : 'needs-review';
  return result;
}
