import {
  evidenceQuestionKind,
  type EvidenceQuestion,
  type evidenceLabels,
} from '../i18n/domain-evidence.ts';
import {
  reconcileClearing,
  type ClearingInput,
  type ClearingResult,
} from './clearing.ts';
import { reconcileAr, type ArInput, type ArResult } from './ar.ts';
import {
  reconcileGlTb,
  BALANCE_FIELDS,
  type GlTbInput,
  type GlTbResult,
} from './gl-tb.ts';
import {
  reconcileAllocation,
  type AllocationInput,
  type AllocationResult,
} from './allocation.ts';
import { reconcileBank, type BankInput, type BankResult } from './bank.ts';
import {
  reconcileBankAdjustments,
  type BankAdjustmentInput,
  type BankAdjustmentResult,
} from './bank-adjustment.ts';
import {
  reconcileFinancialPosition,
  type FinancialInput,
  type FinancialResult,
} from './tb-financial.ts';
import {
  reconcileIntercompany,
  type IntercompanyInput,
  type IntercompanyResult,
} from './intercompany.ts';
import {
  reconcileGateway,
  type GatewayInput,
  type GatewayResult,
} from './payment-gateway.ts';

import {
  reconcileStock,
  type StockInput,
  type StockResult,
} from './inventory-register.ts';
import {
  reconcileAsset,
  ASSET_COMPONENTS,
  type AssetInput,
  type AssetResult,
} from './fixed-assets.ts';
import {
  reconcilePayroll,
  PAYROLL_COMPONENTS,
  type PayrollInput,
  type PayrollResult,
} from './payroll.ts';

export type SpecializedEvidenceSnapshot =
  | { domain: 'inventory-register'; input: StockInput; result: StockResult }
  | { domain: 'fixed-assets'; input: AssetInput; result: AssetResult }
  | { domain: 'payroll'; input: PayrollInput; result: PayrollResult };
export function isSpecializedEvidenceSnapshot(
  snapshot: DomainEvidenceSnapshot,
): snapshot is SpecializedEvidenceSnapshot {
  return ['inventory-register', 'fixed-assets', 'payroll'].includes(
    snapshot.domain,
  );
}

export type DomainEvidenceSnapshot =
  | { domain: 'clearing'; input: ClearingInput; result: ClearingResult }
  | { domain: 'ar'; input: ArInput; result: ArResult }
  | { domain: 'gl-tb'; input: GlTbInput; result: GlTbResult }
  | { domain: 'allocation'; input: AllocationInput; result: AllocationResult }
  | { domain: 'bank'; input: BankInput; result: BankResult }
  | {
      domain: 'bank-adjustment';
      input: BankAdjustmentInput;
      result: BankAdjustmentResult;
    }
  | { domain: 'financial'; input: FinancialInput; result: FinancialResult }
  | {
      domain: 'intercompany';
      input: IntercompanyInput;
      result: IntercompanyResult;
    }
  | { domain: 'gateway'; input: GatewayInput; result: GatewayResult }
  | SpecializedEvidenceSnapshot;
type Label = keyof typeof evidenceLabels;
export type DomainEvidenceFact = {
  label: Label;
  subject?: Label;
  value: number | boolean | string | null;
  money?: true;
};
export type DomainEvidenceAnswer = {
  kind: EvidenceQuestion | 'unsupported' | 'stale';
  facts: DomainEvidenceFact[];
  sources: { name: string; hash: string; sheet: string }[];
  context?: string;
  currency: string;
  decimals: number;
  individualAmounts?: true;
};
// Explains the current, already-read input only. It neither rehashes original
// bytes nor takes the place of the IO replay gate for financial decisions.
export function askDomainEvidence(
  snapshot: DomainEvidenceSnapshot,
  question: string,
): DomainEvidenceAnswer {
  const kind = evidenceQuestionKind(question);
  const empty = (k: DomainEvidenceAnswer['kind']): DomainEvidenceAnswer => ({
    kind: k,
    facts: [],
    sources: [],
    currency: '',
    decimals: 0,
  });
  if (kind === 'unsupported') return empty(kind);
  try {
    let fresh: DomainEvidenceSnapshot['result'];
    switch (snapshot.domain) {
      case 'clearing':
        fresh = reconcileClearing(snapshot.input);
        break;
      case 'ar':
        fresh = reconcileAr(snapshot.input);
        break;
      case 'gl-tb':
        fresh = reconcileGlTb(snapshot.input);
        break;
      case 'allocation':
        fresh = reconcileAllocation(snapshot.input);
        break;
      case 'bank':
        fresh = reconcileBank(snapshot.input);
        break;
      case 'bank-adjustment':
        fresh = reconcileBankAdjustments(snapshot.input);
        break;
      case 'financial':
        fresh = reconcileFinancialPosition(snapshot.input);
        break;
      case 'intercompany':
        fresh = reconcileIntercompany(snapshot.input);
        break;
      case 'gateway':
        fresh = reconcileGateway(snapshot.input);
        break;
      case 'inventory-register':
        fresh = reconcileStock(snapshot.input);
        break;
      case 'fixed-assets':
        fresh = reconcileAsset(snapshot.input);
        break;
      case 'payroll':
        fresh = reconcilePayroll(snapshot.input);
        break;
      default:
        return empty('stale');
    }
    if (JSON.stringify(fresh) !== JSON.stringify(snapshot.result))
      return empty('stale');
    const r = snapshot.result;
    const facts: DomainEvidenceFact[] = [];
    const add = (
      label: Label,
      value: DomainEvidenceFact['value'],
      subject?: Label,
      money?: true,
    ) =>
      facts.push({
        label,
        value,
        ...(subject ? { subject } : {}),
        ...(money ? { money } : {}),
      });
    const amount = (label: Label, value: number | null, subject?: Label) =>
      add(label, value, subject, true);
    let sources: DomainEvidenceAnswer['sources'];
    let currency: string;
    let decimals: number;
    if (isSpecializedEvidenceSnapshot(snapshot)) {
      const v = snapshot.result;
      sources = snapshot.input.files.map((f, i) => ({
        name: f.name,
        hash: f.sha256!,
        sheet: f.sheets[snapshot.input.readings[i].sheet].name,
      }));
      currency = v.scope.currency;
      decimals = v.decimals;
      if (kind !== 'amounts') {
        add('status', v.status);
        add('financial', v.financial);
        add('review', v.review);
        add('diagnostics', v.issues.length);
        add('missing', v.missing.length);
        add('members', v.memberIds.length);
        add('completeness', v.completeness.confirmed);
      } else if (snapshot.domain === 'inventory-register') {
        amount(
          'carrying',
          snapshot.result.totals?.registerMinor ?? null,
          'register',
        );
        amount('carrying', snapshot.result.totals?.glMinor ?? null, 'gl');
      } else if (snapshot.domain === 'fixed-assets') {
        for (const subject of ['register', 'gl'] as const)
          for (const component of [...ASSET_COMPONENTS, 'carrying'] as const)
            amount(
              component,
              snapshot.result.totals?.[subject][component] ?? null,
              subject,
            );
      } else {
        for (const component of [
          'grossPay',
          'deductions',
          'employer',
          'net',
        ] as const) {
          const key = component === 'grossPay' ? 'gross' : component;
          amount(
            component,
            snapshot.result.totals?.register[key] ?? null,
            'register',
          );
        }
        for (const component of PAYROLL_COMPONENTS)
          amount(
            component,
            snapshot.result.totals?.gl[component] ?? null,
            'gl',
          );
        amount('net', snapshot.result.bankComparison.register, 'register');
        amount('net', snapshot.result.bankComparison.bank, 'bank');
        amount('bankDifference', snapshot.result.bankComparison.difference);
      }
    } else if (snapshot.domain === 'clearing') {
      const v = snapshot.result;
      sources = [
        { name: snapshot.input.file.name, hash: v.sourceHash, sheet: v.sheet },
      ];
      currency = v.scope.currency;
      decimals = v.decimals;
      if (kind === 'amounts') amount('total', v.total);
      else {
        add('errors', v.inventory.filter((x) => x.kind === 'error').length);
        add('pending', v.cases.filter((x) => x.status === 'review').length);
        add('matched', v.cases.filter((x) => x.status === 'cleared').length);
      }
    } else if (snapshot.domain === 'bank-adjustment') {
      const v = snapshot.result;
      sources = [...v.balance.bank.sources, ...v.balance.sources, ...v.sources];
      currency = v.balance.scope.currency;
      decimals = v.balance.decimals;
      if (kind === 'amounts')
        for (const e of v.endpoints)
          for (const f of [
            'rawBank',
            'rawCash',
            'bankAdjustment',
            'cashAdjustment',
            'adjustedBank',
            'adjustedCash',
            'difference',
          ] as const)
            amount(f, e[f], e.point);
      else {
        add('status', v.status);
        add('missing', v.balance.missing.length);
        add('pending', v.unresolved.length);
        add('completeness', v.completeness.confirmed);
        add(
          'errors',
          [
            ...v.balance.bank.inventory,
            ...v.balance.inventory,
            ...v.inventory,
          ].filter((x) => x.kind === 'error').length,
        );
      }
    } else {
      sources = (
        r as Exclude<
          DomainEvidenceSnapshot['result'],
          ClearingResult | SpecializedEvidenceSnapshot['result']
        >
      ).sources.map((x) => ({ name: x.name, hash: x.hash, sheet: x.sheet }));
      const v = r as Exclude<
        DomainEvidenceSnapshot['result'],
        BankAdjustmentResult
      >;
      currency = v.scope.currency;
      decimals = v.decimals;
      if (kind !== 'amounts') {
        if ('status' in v) add('status', v.status);
        add('errors', v.inventory.filter((x) => x.kind === 'error').length);
        if ('missing' in v) add('missing', v.missing.length);
        if ('issues' in v) add('diagnostics', v.issues.length);
        if ('completeness' in v) add('completeness', v.completeness.confirmed);
      }
      switch (snapshot.domain) {
        case 'ar': {
          const v = snapshot.result;
          if (kind === 'amounts') {
            amount('total', v.totals[0], 'ledger');
            amount('total', v.totals[1], 'statement');
          } else {
            add('pending', v.cases.filter((x) => x.status === 'review').length);
            add(
              'matched',
              v.cases.filter((x) => x.status === 'matched').length,
            );
          }
          break;
        }
        case 'gl-tb': {
          const v = snapshot.result;
          if (kind === 'amounts')
            for (const f of BALANCE_FIELDS) {
              amount(f, v.gl?.[f] ?? null, 'gl');
              amount(f, v.tb?.[f] ?? null, 'tb');
              amount(f, v.differences?.[f] ?? null, 'difference');
            }
          break;
        }
        case 'allocation':
          add('active', snapshot.result.activeDecisions.length);
          break;
        case 'bank':
          add(
            'pending',
            snapshot.result.cases.filter((x) => x.status === 'needs-review')
              .length,
          );
          break;
        case 'financial': {
          const v = snapshot.result;
          if (kind === 'amounts')
            for (const subject of ['calculated', 'reported'] as const)
              for (const f of [
                'assets',
                'liabilities',
                'equity',
                'equation',
              ] as const)
                amount(f, v.grandTotals?.[subject][f] ?? null, subject);
          else
            add(
              'pending',
              v.lines.filter((x) => x.review !== 'accepted').length,
            );
          break;
        }
        case 'intercompany': {
          const v = snapshot.result;
          if (kind === 'amounts')
            for (const [i, subject] of ['left', 'right'].entries())
              for (const f of ['debit', 'credit', 'net'] as const)
                amount(f, v.totals?.[i][f] ?? null, subject as Label);
          else
            add(
              'pending',
              v.pairs.filter((x) => x.review !== 'accepted').length,
            );
          break;
        }
        case 'gateway': {
          const v = snapshot.result;
          if (kind === 'amounts') {
            (['gross', 'refunds', 'fees', 'net'] as const).forEach((f, i) =>
              amount(f, v.totals?.[i] ?? null),
            );
            (
              [
                'grossDifference',
                'refundDifference',
                'feeDifference',
                'netDifference',
                'bankDifference',
              ] as const
            ).forEach((f, i) => amount(f, v.residuals?.[i] ?? null));
          } else add('pending', v.review === 'accepted' ? 0 : 1);
          break;
        }
      }
    }
    return {
      kind,
      facts: kind === 'sources' ? [] : facts,
      sources,
      currency,
      decimals,
      ...(isSpecializedEvidenceSnapshot(snapshot)
        ? { context: snapshot.result.context }
        : {}),
      ...(kind === 'amounts' &&
      (snapshot.domain === 'bank' || snapshot.domain === 'allocation')
        ? { individualAmounts: true as const }
        : {}),
    };
  } catch {
    return empty('stale');
  }
}

// The UI supplies the existing domain worker replay: originals are re-read and
// hashed there. Capture display and metadata before awaiting; a delayed reply
// may never explain a different display or substitute a new result.
export async function askVerifiedSpecializedEvidence(
  snapshot: SpecializedEvidenceSnapshot,
  question: string,
  replay: (
    snapshot: SpecializedEvidenceSnapshot,
  ) => Promise<SpecializedEvidenceSnapshot>,
): Promise<DomainEvidenceAnswer> {
  const initial = askDomainEvidence(snapshot, question);
  if (initial.kind === 'unsupported' || initial.kind === 'stale')
    return initial;
  try {
    const captured = structuredClone(snapshot);
    const expected = JSON.stringify(captured.result);
    const expectedDomain = captured.domain;
    const expectedReadings = JSON.stringify(captured.input.readings);
    const expectedSources = JSON.stringify(
      captured.input.files.map((f) => [f.name, f.sha256]),
    );
    const fresh = await replay(captured);
    if (
      fresh.domain !== expectedDomain ||
      JSON.stringify(fresh.result) !== expected
    )
      throw Error('STALE_EVIDENCE_RESULT');
    // Compare context and selected source identity, not a callback-owned display.
    if (
      JSON.stringify(fresh.input.readings) !== expectedReadings ||
      JSON.stringify(fresh.input.files.map((f) => [f.name, f.sha256])) !==
        expectedSources
    )
      throw Error('STALE_EVIDENCE_SOURCE');
    return askDomainEvidence(fresh, question);
  } catch {
    return { kind: 'stale', facts: [], sources: [], currency: '', decimals: 0 };
  }
}
