// WF-1 cycle: a replayed month in the terms of the sealed cycle oracle
// (audit/bank-cycle-foundation/oracle.py), shared by the library run
// (bank-cycle-run.mjs) and the browser run (bank-cycle-browser.mjs) so both
// are judged by the same reading of the result. The queue is the product's
// queue of the same month before its decisions; the items a month leaves
// outstanding are the product's own carriedItems of the result, then the
// carried items its roll keeps. A sheet without a policy is put as the
// oracle states it: no tolerated difference, the difference unexplained.
import assert from 'node:assert/strict';
import { CASHBOOK_ROLES as ROLES } from '../lib/reconciliation/bank-cashbook-map.ts';
import { reviewQueue } from '../lib/reconciliation/bank-review-queue.ts';
import { carriedItems } from '../lib/reconciliation/bank-statement-roll.ts';

export const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];
export const month = (period) => MONTHS[Number(period.start.slice(5, 7)) - 1];
export const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
assert.deepEqual(
  canonical({ b: [{ y: 1, x: 2 }], a: 1 }),
  canonical({ a: 1, b: [{ x: 2, y: 1 }] }),
);
assert.notDeepEqual(canonical({ a: [1, 2] }), canonical({ a: [2, 1] }));
export const same = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
// undefined stays undefined, so a missing field shows as a difference.
export const plain = (x) =>
  x === undefined ? x : JSON.parse(JSON.stringify(x));
/** The replayed month in the oracle's terms: pid and period as the story
 * names them, the result the product gave, the result of the same month
 * before any decision, and how the run read the ledger. */
export function asOracle(pid, period, result, before, read) {
  const now = result.match.statement.period;
  const names = new Map(
    (result.roll?.carried ?? []).map((c) => [
      c.key,
      `${month(c.period)}:${c.id}`,
    ]),
  );
  const cited = result.sources[1];
  const declared =
    now &&
    now.start === period.statement.period.start &&
    now.end === period.statement.period.end;
  const out = {
    period: declared
      ? pid
      : `${pid}: ${now ? `${now.start}..${now.end}` : 'none'}`,
    previous: result.roll
      ? result.roll.previous.status === 'refused'
        ? result.roll.previous.code
        : 'accepted'
      : 'none',
    reading: {
      ...read.out,
      header: cited.columns?.header,
      above: cited.above,
      unread: plain(cited.unread),
      columns: Object.fromEntries(
        ROLES.map((r) => [r, cited.columns?.columns[r]?.column ?? null]),
      ),
      entries: result.match.cashbook.length,
    },
    policy: plain(result.tolerance?.policy ?? null),
    refused: null,
    held: result.status === 'held',
  };
  if (out.held) return out;
  const at = month(now);
  const carried = (result.roll?.carried ?? []).map((c) => ({
    item: `${month(c.period)}:${c.id}`,
    side: c.side,
    id: c.id,
    period: month(c.period),
    date: c.date,
    direction: c.direction,
    amount: c.amount,
    reference: c.reference,
    origin: c.origin,
    age: c.age,
  }));
  const inCase = new Set(result.cases.flatMap((c) => c.carried ?? []));
  const left = [
    ...carriedItems(result, ''),
    ...(result.roll?.outstanding ?? []),
  ].map((c) => ({
    item: `${month(c.period)}:${c.id}`,
    side: c.side,
    id: c.id,
    period: month(c.period),
    date: c.date,
    direction: c.direction,
    amount: c.amount,
    reference: c.reference,
    origin: c.origin,
    age: c.age,
  }));
  const { outcome } = result.sheet;
  let sheet = { refusal: outcome.refusal };
  if (!outcome.refusal) {
    const s = outcome.sheet;
    sheet = {
      refusal: null,
      status: s.status,
      bank: s.bank,
      book: s.book,
      sections: Object.fromEntries(
        Object.entries(s.sections).map(([name, x]) => [
          name,
          {
            total: x.total,
            items: x.items.map((i) => ({
              item: `${month(i.period)}:${i.id}`,
              side: i.side,
              id: i.id,
              period: month(i.period),
              page: i.page,
              row: i.row,
              date: i.date,
              direction: i.direction,
              amount: i.amount,
              reference: i.reference,
              origin: i.origin,
              reason: i.reason,
              age: i.age,
              source: i.source,
            })),
          },
        ]),
      ),
      adjustedBank: s.adjustedBank,
      adjustedBook: s.adjustedBook,
      difference: s.difference,
      toleratedDifferences: (s.toleratedDifferences ?? []).map((t) => ({
        case: t.case,
        statement: [t.statement],
        cashbook: [t.cashbook],
        amounts: { ...t.amounts, direction: t.direction },
        effect: t.effect,
      })),
      tolerated: s.tolerated ?? 0,
      unexplained: s.unexplained ?? s.difference,
      policy: plain(s.tolerance ?? null),
    };
  }
  const standing = (x) => x && { name: x.name, date: x.date, valid: x.valid };
  return {
    ...out,
    cases: result.cases.map((c) => ({
      id: c.id,
      kind: c.kind,
      reason: c.reason,
      status: c.status,
      statement: [...c.statement],
      cashbook: [...c.cashbook],
      carried: (c.carried ?? []).map((k) => names.get(k)),
    })),
    exceeded: result.tolerance?.exceeded
      ? { sum: result.tolerance.sum, cap: result.tolerance.policy.perPeriod }
      : null,
    tolerated: result.cases
      .filter((c) => c.status === 'matched-tolerated')
      .map((c) => c.id),
    queue: reviewQueue(before).map((g) => ({
      reason: g.reason,
      class: g.class,
      direction: g.direction,
      shape: `${g.statement}:${g.cashbook}`,
      gap: g.gap ?? null,
      cases: g.cases.map((x) => x.case),
      impact: g.impact,
      offers: { ...g.offers },
    })),
    carried,
    withheld: result.roll
      ? [
          ...result.roll.withheld.statement.map((s) => `${at}:${s}`),
          ...result.roll.withheld.cashbook.map((v) => `${at}:${v}`),
        ].sort(byText)
      : [],
    still: (result.roll?.outstanding ?? [])
      .filter((c) => !inCase.has(c.key))
      .map((c) => ({ item: `${month(c.period)}:${c.id}`, age: c.age })),
    pending: result.cases.filter((c) => c.status === 'needs-review').length,
    outstanding: left,
    sheet,
    language: result.sheet.language,
    signoffs: {
      prepared: standing(result.sheet.prepared),
      reviewed: standing(result.sheet.reviewed),
    },
  };
}
