// EXPERIMENT ONLY — architecture spike: General Ledger detail ↔ Trial Balance
// tie-out. Not a product feature, not imported by lib/, not part of `pnpm test`.
//
// Conventions of this experiment only (minor units throughout):
//   beginNet = beginningDebit − beginningCredit
//   activityNet = periodDebit − periodCredit
//   endNet = endingDebit − endingCredit, and endNet must equal beginNet + activityNet.
// GL detail is read by the production reader, one account per run. The Trial
// Balance is not a list of transactions and has its own small reader here.
import { parseMoney } from '../../lib/reconciliation/core.ts';
import { assertInputFormats } from '../../lib/reconciliation/input-readiness.ts';
import { prepareVerifiedSources } from '../../lib/reconciliation/source-preparation.ts';
import { extractStatementMetadata } from '../../lib/reconciliation/statement-metadata.ts';
import { defaultMapping } from '../../lib/reconciliation/types.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
  SourceResult,
} from '../../lib/reconciliation/types.ts';

export type CellTrace = {
  sheet: string;
  row: number;
  column: number;
  text: string;
};

// ------------------------------------------------------------- Trial Balance

export const TB_FIELDS = [
  'beginningDebit',
  'beginningCredit',
  'periodDebit',
  'periodCredit',
  'endingDebit',
  'endingCredit',
] as const;
export type TbField = (typeof TB_FIELDS)[number];
export type TrialBalanceLayout = {
  header: number;
  account: number;
  columns: Record<TbField, number>;
};
export type TrialBalanceRow = {
  account: string;
  row: number;
  amounts: Record<TbField, number>;
  trace: Record<'account' | TbField, CellTrace>;
};
export type TrialBalance = {
  rows: TrialBalanceRow[];
  errors: { row: number; message: string }[];
  period: { start: string; end: string };
  currency: string;
  entity: string;
};

/** A reading of one debit/credit column pair, so the production format guard
 * and metadata reader can look at a Trial Balance. It has no date column:
 * a Trial Balance row has no date. */
const pairReading = (
  layout: TrialBalanceLayout,
  debit: TbField,
  credit: TbField,
): Mapping => ({
  ...defaultMapping(),
  header: layout.header,
  mode: 'split',
  debit: layout.columns[debit],
  credit: layout.columns[credit],
});

export function readTrialBalance(
  file: SourceFile,
  layout: TrialBalanceLayout,
  scope: Scope,
): TrialBalance {
  const sheet = file.sheets[0];
  // Reused: the amount format guard, one column pair at a time.
  for (const [debit, credit] of [
    ['beginningDebit', 'beginningCredit'],
    ['periodDebit', 'periodCredit'],
    ['endingDebit', 'endingCredit'],
  ] as const)
    assertInputFormats([file], [pairReading(layout, debit, credit)], scope);
  // Reused: the labelled lines above the table (period, currency, entity).
  const metadata = extractStatementMetadata(
    file,
    pairReading(layout, 'periodDebit', 'periodCredit'),
    scope,
  );
  const rows: TrialBalanceRow[] = [];
  const errors: TrialBalance['errors'] = [];
  const seen = new Set<string>();
  for (let i = layout.header + 1; i < sheet.rows.length; i++) {
    const cells = sheet.rows[i];
    const rn = i + 1;
    if (cells.every((c) => !c.trim())) continue;
    const cell = (column: number): CellTrace => ({
      sheet: sheet.name,
      row: rn,
      column: column + 1,
      text: cells[column] ?? '',
    });
    const account = cells[layout.account]?.trim() ?? '';
    try {
      if (!account) throw new Error('account missing');
      if (seen.has(account))
        throw new Error(`account ${account} appears twice`);
      const trace = {
        account: cell(layout.account),
      } as TrialBalanceRow['trace'];
      const amounts = {} as Record<TbField, number>;
      for (const field of TB_FIELDS) {
        trace[field] = cell(layout.columns[field]);
        const text = trace[field].text.trim();
        // Reused: parseMoney, in minor units. A blank balance cell is zero.
        amounts[field] = text ? parseMoney(text, 'dot', scope.decimals) : 0;
        if (amounts[field] < 0) throw new Error(`${field} is negative`);
      }
      seen.add(account);
      rows.push({ account, row: rn, amounts, trace });
    } catch (error) {
      errors.push({ row: rn, message: (error as Error).message });
    }
  }
  return {
    rows,
    errors,
    period: { start: metadata.periodStart, end: metadata.periodEnd },
    currency: metadata.currency,
    entity: metadata.entityName,
  };
}

// ------------------------------------------------------------- GL detail

export type GlAccount = {
  account: string;
  /** The production reader's result for this account alone. */
  source?: SourceResult;
  failure?: string;
  debit: number;
  credit: number;
  debitRows: number[];
  creditRows: number[];
};
export type GeneralLedger = {
  accounts: Map<string, GlAccount>;
  /** Data rows with no account: reported, never dropped. */
  unassigned: number[];
  period: { start: string; end: string };
  entity: string;
};

/** One production reading per account. The reader holds one account per run,
 * so every other account's rows are excluded from that run with a reason. */
export function readGeneralLedger(
  file: SourceFile,
  mapping: Mapping,
  accountColumn: number,
  scope: Scope,
): GeneralLedger {
  const sheet = file.sheets[mapping.sheet];
  const byAccount = new Map<string, number[]>();
  const unassigned: number[] = [];
  for (let i = mapping.header + 1; i < sheet.rows.length; i++) {
    const cells = sheet.rows[i];
    if (cells.every((c) => !c.trim())) continue;
    const account = cells[accountColumn]?.trim() ?? '';
    if (!account) unassigned.push(i + 1);
    else byAccount.set(account, [...(byAccount.get(account) ?? []), i + 1]);
  }
  const accounts = new Map<string, GlAccount>();
  let metadataSource: SourceResult | undefined;
  for (const [account, own] of byAccount) {
    const excluded = { ...mapping.excluded };
    for (const [other, rows] of byAccount)
      if (other !== account)
        for (const row of rows)
          excluded[String(row)] = `Account ${other}: tied out in its own run`;
    for (const row of unassigned)
      excluded[String(row)] = 'No account on the row';
    const entry: GlAccount = {
      account,
      debit: 0,
      credit: 0,
      debitRows: [],
      creditRows: [],
    };
    try {
      const {
        sources: [source],
      } = prepareVerifiedSources(
        [file],
        [{ ...mapping, excluded }],
        { ...scope, account },
        ['ledger'],
      );
      entry.source = source;
      metadataSource ??= source;
      if (source.errors.length)
        entry.failure = source.errors
          .map((e) => `row ${e.row}: ${e.message}`)
          .join('; ');
      // Gross amounts from the sign: in split mode the reader refuses a row
      // with both a debit and a credit, so each row's sign names its column.
      for (const t of source.transactions) {
        if (!own.includes(t.row))
          throw new Error(`row ${t.row} is not account ${account}`);
        if (t.amount > 0) {
          entry.debit += t.amount;
          entry.debitRows.push(t.row);
        } else if (t.amount < 0) {
          entry.credit -= t.amount;
          entry.creditRows.push(t.row);
        }
      }
    } catch (error) {
      entry.failure = (error as Error).message;
    }
    accounts.set(account, entry);
  }
  return {
    accounts,
    unassigned,
    period: {
      start: metadataSource?.metadata?.periodStart ?? '',
      end: metadataSource?.metadata?.periodEnd ?? '',
    },
    entity: metadataSource?.metadata?.entityName ?? '',
  };
}

// ------------------------------------------------------------- tie-out

export type TieOutStatus =
  | 'tied'
  | 'mismatch'
  | 'tb-inconsistent'
  | 'scope-error'
  | 'unsupported';
export type AccountTieOut = {
  account: string;
  status: TieOutStatus;
  findings: string[];
  gl: {
    debit: number;
    credit: number;
    net: number;
    debitRows: number[];
    creditRows: number[];
  } | null;
  tb: {
    beginningNet: number;
    debit: number;
    credit: number;
    net: number;
    endingNet: number;
    trace: TrialBalanceRow['trace'];
  } | null;
  rollforwardVariance: number | null;
  debitVariance: number | null;
  creditVariance: number | null;
  netVariance: number | null;
};
export type TieOutScope = {
  accounts: string[];
  currency: string;
  period: { start: string; end: string };
};

/** Scope first, then the Trial Balance's own arithmetic, then GL against it:
 * debits, credits and the net separately. */
export function tieOut(
  gl: GeneralLedger,
  tb: TrialBalance,
  expected: TieOutScope,
) {
  // Run-wide scope: nothing is compared across a different period, currency
  // or entity. Evidence that is absent is reported, not assumed.
  const scopeErrors: string[] = [];
  const unverified: string[] = ['ledger', 'posting status'];
  if (tb.currency !== expected.currency)
    scopeErrors.push(
      `TB currency ${tb.currency || 'unknown'} is not ${expected.currency}`,
    );
  const samePeriod = (p: { start: string; end: string }) =>
    p.start === expected.period.start && p.end === expected.period.end;
  if (!samePeriod(tb.period))
    scopeErrors.push('TB period differs from the expected period');
  if (!gl.period.start && !gl.period.end)
    unverified.push('GL period (no period line)');
  else if (!samePeriod(gl.period))
    scopeErrors.push('GL period differs from the expected period');
  if (!gl.entity || !tb.entity) unverified.push('entity');
  else if (gl.entity !== tb.entity)
    scopeErrors.push('GL and TB entities differ');

  const tbByAccount = new Map(tb.rows.map((r) => [r.account, r]));
  const names = [
    ...new Set([...tbByAccount.keys(), ...gl.accounts.keys()]),
  ].sort();
  const results: AccountTieOut[] = names.map((account) => {
    const g = gl.accounts.get(account);
    const t = tbByAccount.get(account);
    const glSide = g
      ? {
          debit: g.debit,
          credit: g.credit,
          net: g.debit - g.credit,
          debitRows: g.debitRows,
          creditRows: g.creditRows,
        }
      : { debit: 0, credit: 0, net: 0, debitRows: [], creditRows: [] };
    const tbSide = t && {
      beginningNet: t.amounts.beginningDebit - t.amounts.beginningCredit,
      debit: t.amounts.periodDebit,
      credit: t.amounts.periodCredit,
      net: t.amounts.periodDebit - t.amounts.periodCredit,
      endingNet: t.amounts.endingDebit - t.amounts.endingCredit,
      trace: t.trace,
    };
    const base = {
      account,
      gl: g || t ? glSide : null,
      tb: tbSide ?? null,
      rollforwardVariance: null,
      debitVariance: null,
      creditVariance: null,
      netVariance: null,
    };
    // 1. Scope, before any number is compared.
    const accountScope = expected.accounts.includes(account)
      ? []
      : [`account ${account} is outside the expected accounts`];
    if (scopeErrors.length || accountScope.length)
      return {
        ...base,
        status: 'scope-error',
        findings: [...scopeErrors, ...accountScope],
      };
    // 2. A source that could not be read completely is not compared.
    if (g?.failure)
      return { ...base, status: 'unsupported', findings: [`GL: ${g.failure}`] };
    if (!t)
      return {
        ...base,
        status: 'mismatch',
        findings: ['NOT_IN_TRIAL_BALANCE'],
        debitVariance: glSide.debit,
        creditVariance: glSide.credit,
        netVariance: glSide.net,
      };
    // 3. The Trial Balance's own arithmetic, independent of the GL.
    const rollforwardVariance =
      tbSide!.endingNet - (tbSide!.beginningNet + tbSide!.net);
    if (rollforwardVariance !== 0)
      return {
        ...base,
        status: 'tb-inconsistent',
        findings: [
          'TB_ROLLFORWARD_BROKEN: ending ≠ beginning + period activity; GL not compared',
        ],
        rollforwardVariance,
      };
    // 4. GL against TB: each component on its own, the net as a derived check.
    const debitVariance = glSide.debit - tbSide!.debit;
    const creditVariance = glSide.credit - tbSide!.credit;
    const netVariance = glSide.net - tbSide!.net;
    const findings = [
      ...(g
        ? []
        : tbSide!.net || tbSide!.debit || tbSide!.credit
          ? ['NO_GL_DETAIL']
          : []),
      ...(debitVariance ? ['DEBIT_VARIANCE'] : []),
      ...(creditVariance ? ['CREDIT_VARIANCE'] : []),
      ...(netVariance ? ['NET_VARIANCE'] : []),
    ];
    return {
      ...base,
      status: findings.length ? 'mismatch' : 'tied',
      findings,
      rollforwardVariance,
      debitVariance,
      creditVariance,
      netVariance,
    };
  });
  return {
    results,
    scopeErrors,
    unverified,
    tbErrors: tb.errors,
    unassigned: gl.unassigned,
  };
}
