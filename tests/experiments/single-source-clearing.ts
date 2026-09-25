// EXPERIMENT ONLY — architecture spike for a single-source clearing account.
// Not a product feature, not imported by lib/, and not part of `pnpm test`.
// It takes the transactions the production reader already normalised and
// groups rows that offset each other inside one account.
//
// Rules for this experiment only:
// - an approved group nets to exactly zero in minor units (the currency's
//   precision), and holds at least one debit and one credit;
// - the basis of a group is explicit evidence (a shared clearing reference) or
//   an accountant's decision, never equal amounts;
// - a reference groups its whole bucket or nothing: no subset is ever chosen,
//   and there is no search over combinations;
// - every read row ends in exactly one case, and no row is used twice.
import type {
  SourceResult,
  Transaction,
} from '../../lib/reconciliation/types.ts';

export type ClearingStatus = 'cleared' | 'needs-review' | 'open';
export type ClearingReason =
  | 'SHARED_REFERENCE_NETS_TO_ZERO'
  | 'SHARED_REFERENCE_RESIDUAL'
  | 'ACCOUNTANT_DECISION'
  | 'AMOUNT_ONLY_CANDIDATE'
  | 'AMBIGUOUS_AMOUNT_CANDIDATES'
  | 'NO_COUNTERPART'
  | 'SOURCE_INCOMPLETE';
export type ClearingCase = {
  id: string;
  status: ClearingStatus;
  reason: ClearingReason;
  basis?: 'shared-clearing-reference' | 'accountant-decision';
  /** One role only: rows of the same account that offset each other. */
  members: Transaction[];
  /** Net of the members in minor units; zero for every cleared case. */
  net: number;
  evidence: string[];
  trace: { sourceRowId: string; sheet: string; row: number; page?: number }[];
};
/** The smallest decision this experiment needs: which rows clear each other,
 * on what basis, and why. Not a proposal for the production Decision type. */
export type ClearingDecision = {
  memberIds: string[];
  basis: 'external-confirmation';
  note: string;
};

const net = (rows: Transaction[]) =>
  rows.reduce((total, t) => total + t.amount, 0);
const debitsAndCredits = (rows: Transaction[]) =>
  rows.some((t) => t.amount > 0) && rows.some((t) => t.amount < 0);

export function clearSingleSource(
  source: SourceResult,
  decisions: ClearingDecision[] = [],
) {
  const byId = new Map(source.transactions.map((t) => [t.id, t]));
  if (byId.size !== source.transactions.length)
    throw new Error('duplicate source row id');
  const cases: ClearingCase[] = [];
  const used = new Set<string>();
  const add = (
    status: ClearingStatus,
    reason: ClearingReason,
    members: Transaction[],
    evidence: string[],
    basis?: ClearingCase['basis'],
  ) => {
    if (!members.length || members.some((t) => used.has(t.id)))
      throw new Error('a source row cannot belong to two cases');
    const total = net(members);
    if (status === 'cleared' && (total !== 0 || !debitsAndCredits(members)))
      throw new Error('a cleared case must offset debits and credits to zero');
    cases.push({
      id: `${reason}:${members.map((t) => t.id).join('+')}`,
      status,
      reason,
      ...(basis ? { basis } : {}),
      members,
      net: total,
      evidence,
      trace: members.map((t) => ({
        sourceRowId: t.id,
        sheet: t.sheet,
        row: t.row,
        ...(t.sourcePage ? { page: t.sourcePage } : {}),
      })),
    });
    members.forEach((t) => used.add(t.id));
  };
  const remaining = () => source.transactions.filter((t) => !used.has(t.id));

  // A reading with errors is incomplete: nothing is cleared, and every row
  // that was read stays visible.
  if (source.errors.length) {
    for (const t of source.transactions)
      add(
        'open',
        'SOURCE_INCOMPLETE',
        [t],
        ['The source has reading errors; no group is approved.'],
      );
    return { cases, stopped: source.errors.map((e) => e.message) };
  }

  // 1. Decisions: the accountant's basis first, then the accounting check.
  for (const decision of decisions) {
    const members = decision.memberIds.map((id) => byId.get(id));
    if (
      decision.basis !== 'external-confirmation' ||
      !decision.note.trim() ||
      new Set(decision.memberIds).size !== decision.memberIds.length ||
      members.some((t) => !t || used.has(t.id))
    )
      throw new Error('decision refused: basis, note or members are invalid');
    const rows = members as Transaction[];
    if (net(rows) !== 0 || !debitsAndCredits(rows))
      throw new Error('decision refused: its rows do not offset to zero');
    add(
      'cleared',
      'ACCOUNTANT_DECISION',
      rows,
      [decision.note],
      'accountant-decision',
    );
  }

  // 2. Whole evidence buckets: every open row that shares a clearing
  //    reference, taken together or not at all.
  const buckets = new Map<string, Transaction[]>();
  for (const t of remaining())
    if (t.normalizedReference)
      buckets.set(t.normalizedReference, [
        ...(buckets.get(t.normalizedReference) ?? []),
        t,
      ]);
  for (const [reference, rows] of buckets) {
    if (rows.length < 2) continue;
    if (net(rows) === 0 && debitsAndCredits(rows))
      add(
        'cleared',
        'SHARED_REFERENCE_NETS_TO_ZERO',
        rows,
        [
          `All ${rows.length} rows share the reference ${reference} and offset to zero.`,
        ],
        'shared-clearing-reference',
      );
    else
      add('needs-review', 'SHARED_REFERENCE_RESIDUAL', rows, [
        `The rows share the reference ${reference} but leave ${net(rows)} unexplained. No subset is chosen.`,
      ]);
  }

  // 3. Equal and opposite amounts without evidence are only a question for
  //    the reviewer. Several possibilities are one ambiguous question.
  const byAmount = new Map<number, Transaction[]>();
  for (const t of remaining())
    byAmount.set(Math.abs(t.amount), [
      ...(byAmount.get(Math.abs(t.amount)) ?? []),
      t,
    ]);
  for (const rows of byAmount.values()) {
    const debits = rows.filter((t) => t.amount > 0),
      credits = rows.filter((t) => t.amount < 0);
    if (!debits.length || !credits.length) continue;
    if (debits.length === 1 && credits.length === 1)
      add(
        'needs-review',
        'AMOUNT_ONLY_CANDIDATE',
        [...debits, ...credits],
        ['Equal and opposite amounts, but no shared evidence. Not approved.'],
      );
    else
      add('needs-review', 'AMBIGUOUS_AMOUNT_CANDIDATES', rows, [
        `${debits.length} debits and ${credits.length} credits of the same amount; more than one pairing is possible.`,
      ]);
  }

  // 4. Everything else stays open, one row per case, visible.
  for (const t of remaining())
    add('open', 'NO_COUNTERPART', [t], ['No evidence of an offsetting entry.']);
  return { cases, stopped: [] as string[] };
}
