// bank-statement-roll-1 (proposed), rules part: a closed previous period's
// outstanding items carried into the current bank statement period, by the
// contract in audit/bank-roll-foundation/contract.json. The lifecycle reads
// the previous session file and settles decisions (bank-statement-lifecycle.ts);
// this module only decides, from readings it is given.
//
// A previous period is carried only when it reads whole, its statement is
// proved and printed, every case in it is automatic or decided, and it ends
// the day before the current period in the same currency with a printed
// closing equal to the current printed opening. Otherwise nothing is carried
// and the refusal names its code.
//
// A carried item is candidate evidence with its provenance, never an
// approved fact. A current item that repeats it on its own side withholds
// that reference from the period's own matching; what the own matching
// leaves unmatched is set against the carried items; and every pairing with a
// carried item is a review case. None is automatic.
import {
  matchBankStatement,
  statementMovements,
  type CashbookEntry,
  type Direction,
  type StatementMatchResult,
} from './bank-statement-match.ts';
import type { BankStatementReading } from './bank-statement-native.ts';
import type { BankStatementResult } from './bank-statement-lifecycle.ts';

/** In the order they are checked. */
export const ROLL_REFUSALS = [
  'ROLL_PREVIOUS_UNREADABLE',
  'ROLL_PREVIOUS_HELD',
  'ROLL_PREVIOUS_UNDECIDED',
  'ROLL_CURRENCY',
  'ROLL_NOT_CONSECUTIVE',
  'ROLL_OPENING',
] as const;
export type RollRefusal = (typeof ROLL_REFUSALS)[number];
export type CarriedReason =
  | 'carried-repeated'
  | 'carried-restated'
  | 'carried-reference'
  | 'carried-amount-difference'
  | 'carried-ambiguous'
  | 'carried-amount-suggestion';
/** Carried cases an accountant may accept as they stand: one carried item
 * and one current item that agree by reference and amount, or by amount where
 * a reference is missing. */
export const CARRIED_ACCEPTABLE: readonly CarriedReason[] = [
  'carried-reference',
  'carried-amount-suggestion',
];
export type CarriedItem = {
  /** `S:<movement>@<period end>` or `C:<voucher>@<period end>`. */
  key: string;
  side: 'statement' | 'cashbook';
  id: string;
  /** Where it is printed: a movement's page, an entry's row. */
  page: number | null;
  row: number | null;
  /** The period it was left outstanding in. */
  period: { start: string; end: string };
  date: string;
  direction: Direction;
  /** Minor units, positive. */
  amount: number;
  reference: string;
  /** 'unmatched', or the rejected case of its period that left it. */
  origin: string;
  /** Period ends it has been outstanding at. */
  age: number;
  /** The file it is read from, and the session file that left it. */
  source: string;
  session: string;
};
export type CarriedCase = {
  reason: CarriedReason;
  /** Carried item keys, in carried order. */
  carried: string[];
  /** Current movements and vouchers, in printed and row order. */
  statement: string[];
  cashbook: string[];
};
export type CarriedClearing = {
  /** The current period's own matching, without the withheld items. */
  match: StatementMatchResult;
  /** Current items a repetition holds in its case. */
  withheld: { statement: string[]; cashbook: string[] };
  cases: CarriedCase[];
  /** Carried items in no case, with their age at this period's end. */
  still: CarriedItem[];
};
/** A previous period that may not be carried, with its code. */
export class RollRefused extends Error {
  readonly code: RollRefusal;
  readonly detail: string;
  constructor(code: RollRefusal, detail: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}
export const refuse = (code: RollRefusal, detail = ''): never => {
  throw new RollRefused(code, detail);
};
const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);

type Period = Pick<BankStatementResult, 'reading' | 'match'>;
/** Whether a closed period may hand its items to the next one: the same
 * currency, the day before, and its printed closing as the printed opening. */
export function rollContinuity(
  previous: Period,
  current: Period,
): RollRefusal | null {
  if (previous.reading.currency !== current.reading.currency)
    return 'ROLL_CURRENCY';
  const before = previous.match.statement.period;
  const after = current.match.statement.period;
  if (!before || !after || nextDay(before.end) !== after.start)
    return 'ROLL_NOT_CONSECUTIVE';
  if (
    previous.reading.closing === null ||
    previous.reading.closing !== current.reading.opening
  )
    return 'ROLL_OPENING';
  return null;
}

/** A closed period's own outstanding items as carried items, one period end
 * old, named by the session file that left them. */
export function carriedItems(
  result: BankStatementResult,
  session256: string,
): CarriedItem[] {
  const period = result.match.statement.period!;
  const [statement256, cashbook256] = result.sources.map((s) => s.sha256);
  const movements = new Map(result.match.movements.map((m) => [m.id, m]));
  const entries = new Map(result.match.cashbook.map((e) => [e.id, e]));
  return result.outstanding.map((o): CarriedItem => {
    const m = o.side === 'statement' ? movements.get(o.id)! : null;
    const e = o.side === 'cashbook' ? entries.get(o.id)! : null;
    const x = (m ?? e)!;
    return {
      key: `${m ? 'S' : 'C'}:${o.id}@${period.end}`,
      side: o.side,
      id: o.id,
      page: m ? m.page : null,
      row: e ? e.row : null,
      period: { start: period.start, end: period.end },
      date: x.date,
      direction: x.direction,
      amount: x.amount,
      reference: x.reference.trim(),
      origin: o.origin,
      age: 1,
      source: m ? statement256 : cashbook256,
      session: session256,
    };
  });
}

type Current = {
  key: string;
  side: 'S' | 'C';
  id: string;
  direction: Direction;
  amount: number;
  reference: string;
  date: string;
};
type Link = { items: Set<string>; members: Set<string>; reasons: Set<string> };
/** Links that share a carried item or a current item are one case. */
function merge(links: Link[]): Link[] {
  const groups: Link[] = [];
  for (const link of links) {
    const joined = groups.filter(
      (g) =>
        [...link.items].some((i) => g.items.has(i)) ||
        [...link.members].some((m) => g.members.has(m)),
    );
    const merged: Link = {
      items: new Set(link.items),
      members: new Set(link.members),
      reasons: new Set(link.reasons),
    };
    for (const g of joined) {
      groups.splice(groups.indexOf(g), 1);
      for (const i of g.items) merged.items.add(i);
      for (const m of g.members) merged.members.add(m);
      for (const r of g.reasons) merged.reasons.add(r);
    }
    groups.push(merged);
  }
  return groups;
}

/** The current period with carried items: repetition first, then the
 * period's own matching on what repetition left, then carried items against
 * what that matching left unmatched on the other side. Nothing is automatic. */
export function clearCarried(
  carried: readonly CarriedItem[],
  reading: BankStatementReading,
  cashbook: CashbookEntry[],
  options: { confirmedClosing?: number; period?: { start: string; end: string } } = {},
): CarriedClearing {
  const movements = statementMovements(reading);
  const current: Current[] = [
    ...movements.map((m) => ({
      key: `S:${m.id}`,
      side: 'S' as const,
      id: m.id,
      direction: m.direction,
      amount: m.amount,
      reference: m.reference.trim(),
      date: m.date,
    })),
    ...cashbook.map((e) => ({
      key: `C:${e.id}`,
      side: 'C' as const,
      id: e.id,
      direction: e.direction,
      amount: e.amount,
      reference: e.reference.trim(),
      date: e.date,
    })),
  ];
  const position = new Map(current.map((x, i) => [x.key, i]));
  const rank = new Map(carried.map((c, i) => [c.key, i]));
  const sideOf = (c: CarriedItem) => (c.side === 'statement' ? 'S' : 'C');

  // 1) Repetition: a current item on the carried item's own side with its
  // reference, or in the cashbook its voucher. It, the carried item and every
  // current item of that reference are one review case (R5).
  const repeats: Link[] = [];
  for (const c of carried) {
    const own = sideOf(c);
    const same = current.filter(
      (x) =>
        x.side === own &&
        ((c.reference !== '' && x.reference === c.reference) ||
          (own === 'C' && x.id === c.id)),
    );
    if (!same.length) continue;
    const members = new Set(same.map((x) => x.key));
    if (c.reference)
      for (const x of current)
        if (x.reference === c.reference) members.add(x.key);
    const restated = same.some(
      (x) =>
        x.direction !== c.direction ||
        x.amount !== c.amount ||
        x.date !== c.date,
    );
    repeats.push({
      items: new Set([c.key]),
      members,
      reasons: new Set([restated ? 'carried-restated' : 'carried-repeated']),
    });
  }
  const repeated = merge(repeats).map((g) => ({
    ...g,
    reason: (g.reasons.has('carried-restated')
      ? 'carried-restated'
      : 'carried-repeated') as CarriedReason,
  }));
  const withheld = new Set(repeated.flatMap((g) => [...g.members]));

  // 2) The period's own matching, unchanged, on what repetition left.
  const match = matchBankStatement(reading, cashbook, { ...options, withheld });
  if (match.held)
    return { match, withheld: { statement: [], cashbook: [] }, cases: [], still: [] };

  // 3) Carried items against what the own matching left unmatched, on the
  // other side: by reference, or by amount when a reference is missing.
  const left = new Set([
    ...match.statementOnly.map((id) => `S:${id}`),
    ...match.cashbookOnly.map((id) => `C:${id}`),
  ]);
  const unmatched = current.filter((x) => left.has(x.key));
  const inRepetition = new Set(repeated.flatMap((g) => [...g.items]));
  const pairs: Link[] = [];
  for (const c of carried) {
    if (inRepetition.has(c.key)) continue;
    const other = sideOf(c) === 'S' ? 'C' : 'S';
    const pool = unmatched.filter(
      (x) => x.side === other && x.direction === c.direction,
    );
    const byReference = c.reference
      ? pool.filter((x) => x.reference === c.reference)
      : [];
    let found = byReference;
    let reason: CarriedReason;
    if (byReference.length)
      reason =
        byReference.length > 1
          ? 'carried-ambiguous'
          : byReference[0].amount === c.amount
            ? 'carried-reference'
            : 'carried-amount-difference';
    else {
      // Equal amounts never pair two different non-empty references.
      found = pool.filter(
        (x) => x.amount === c.amount && (!c.reference || !x.reference),
      );
      if (!found.length) continue;
      reason =
        found.length > 1 ? 'carried-ambiguous' : 'carried-amount-suggestion';
    }
    pairs.push({
      items: new Set([c.key]),
      members: new Set(found.map((x) => x.key)),
      reasons: new Set([reason]),
    });
  }
  // Two carried items claiming one current item: the engine picks neither.
  const paired = merge(pairs).map((g) => ({
    ...g,
    reason: (g.items.size > 1
      ? 'carried-ambiguous'
      : [...g.reasons][0]) as CarriedReason,
  }));

  const byRank = (a: string, b: string) => rank.get(a)! - rank.get(b)!;
  const byPosition = (a: string, b: string) =>
    position.get(a)! - position.get(b)!;
  const cases = [...repeated, ...paired]
    .map((g) => ({
      reason: g.reason,
      carried: [...g.items].sort(byRank),
      members: [...g.members].sort(byPosition),
    }))
    .sort((a, b) => byRank(a.carried[0], b.carried[0]))
    .map(
      (g): CarriedCase => ({
        reason: g.reason,
        carried: g.carried,
        statement: g.members
          .filter((k) => k.startsWith('S:'))
          .map((k) => k.slice(2)),
        cashbook: g.members
          .filter((k) => k.startsWith('C:'))
          .map((k) => k.slice(2)),
      }),
    );
  const inCase = new Set(cases.flatMap((c) => c.carried));
  const ordered = [...withheld].sort(byPosition);
  return {
    match,
    withheld: {
      statement: ordered.filter((k) => k.startsWith('S:')).map((k) => k.slice(2)),
      cashbook: ordered.filter((k) => k.startsWith('C:')).map((k) => k.slice(2)),
    },
    cases,
    still: carried
      .filter((c) => !inCase.has(c.key))
      .map((c) => ({ ...c, age: c.age + 1 })),
  };
}
