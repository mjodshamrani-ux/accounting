import { readFile as fsRead } from 'node:fs/promises';
import { readFile } from '../../lib/reconciliation/io.ts';
import {
  FINANCIAL_VERSION,
  FINANCIAL_ROLES,
  reconcileFinancialPosition,
  type FinancialCategory,
  type FinancialInput,
  type FinancialEvent,
} from '../../lib/reconciliation/tb-financial.ts';
export type FinancialTruthCase = {
  name: string;
  scope: Omit<FinancialInput['scope'], 'confirmed'>;
  complete: boolean;
  status: string;
  reject: string | null;
  actions: string[];
  files: { file: string; sha256: string }[];
  originalTables: { headers: string[]; rows: string[][] }[];
  financialFacts: null | {
    decimals: number;
    debit: number;
    credit: number;
    tbResidual: number;
    accounts: {
      account: string;
      dimensions: string;
      debit: number;
      credit: number;
      net: number;
      sourceRow: number;
    }[];
    lines: {
      id: string;
      label: string;
      category: FinancialCategory;
      row: number;
      calculated: number;
      reported: number;
      difference: number;
      review: string;
      members: {
        mappingId: string;
        account: string;
        dimensions: string;
        evidenceId: string;
        accountRow: number;
        mappingRow: number;
        evidenceRow: number;
        contribution: number;
        debit: number;
        credit: number;
        net: number;
      }[];
    }[];
    totals: {
      calculated: Record<FinancialCategory, number>;
      reported: Record<FinancialCategory, number>;
    };
    grandTotals: {
      calculated: { assets: number; liabilities: number; equity: number };
      reported: { assets: number; liabilities: number; equity: number };
    };
    equations: { calculated: number; reported: number };
  };
};
export const financialTruth = JSON.parse(
  await fsRead(new URL('./frozen/expected.json', import.meta.url), 'utf8'),
) as { cases: FinancialTruthCase[] };
export async function financialFixture(name: string): Promise<FinancialInput> {
  const c = financialTruth.cases.find((c) => c.name === name);
  if (!c) throw Error('Unknown frozen case');
  const files = await Promise.all(
    c.files.map(async (f) => {
      const bytes = await fsRead(
        new URL(`./frozen/${f.file}`, import.meta.url),
      );
      return readFile(f.file, Uint8Array.from(bytes).buffer);
    }),
  );
  return {
    files: files as FinancialInput['files'],
    readings: FINANCIAL_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: FINANCIAL_VERSION,
      confirmed: true,
    })) as FinancialInput['readings'],
    scope: { ...c.scope, confirmed: true },
    completeness: {
      confirmed: c.complete,
      reference: c.complete
        ? 'Independently supplied inventory attestation'
        : '',
      note: c.complete
        ? 'All four original sources and whole supplied post-closing account inventory reviewed; synthetic fixture'
        : '',
    },
    events: [],
  };
}
export async function finishedFinancial(name: string) {
  const c = financialTruth.cases.find((c) => c.name === name)!;
  const state = await financialFixture(name);
  let result = reconcileFinancialPosition(state);
  const originals = c.originalTables;
  const ids = (line: string) =>
    originals[1].rows
      .filter((r) => r[originals[1].headers.indexOf('Line ID')] === line)
      .map((r) => r[originals[1].headers.indexOf('Mapping ID')]);
  function decision(
    type: FinancialEvent['type'],
    line = 'REC',
    edit?: (e: FinancialEvent) => void,
  ) {
    const e: FinancialEvent = {
      id: `decision-${state.events.length}`,
      type,
      context: result.context,
      lineId: line,
      mappingIds: ids(line),
      at: `2026-10-06T00:00:00.${String(state.events.length).padStart(3, '0')}Z`,
      reference: 'Frozen independent line review',
      note: 'All original line account dimensions and presentation proofs reviewed; synthetic fixture',
    };
    edit?.(e);
    state.events = [...state.events, e];
    result = reconcileFinancialPosition(state);
  }
  for (const action of c.actions) {
    if (action === 'accept-all') {
      for (const r of originals[3].rows)
        if (r.some(Boolean))
          decision('accept', r[originals[3].headers.indexOf('Line ID')]);
    } else if (action === 'accept-rec') decision('accept');
    else if (action === 'reject-rec') decision('reject');
    else if (action === 'undo-rec') decision('undo');
    else if (action === 'partial-accept')
      decision('accept', 'REC', (e) => {
        e.mappingIds = e.mappingIds.slice(0, 1);
      });
    else if (action === 'extra-member')
      decision('accept', 'REC', (e) => {
        e.mappingIds.push('M-001');
      });
    else if (action === 'unknown-line')
      decision('accept', 'CASH', (e) => {
        e.lineId = 'UNKNOWN';
      });
    else if (action === 'repeat-accept') {
      decision('accept');
      decision('accept');
    } else if (action === 'stale-context')
      decision('accept', 'REC', (e) => {
        e.context = 'stale';
      });
    else if (action === 'missing-reference')
      decision('accept', 'REC', (e) => {
        e.reference = '';
      });
    else if (action === 'missing-utc')
      decision('accept', 'REC', (e) => {
        e.at = '2026-10-06T00:00:00.000';
      });
    else throw Error('Unknown frozen action');
  }
  return { state, result };
}
