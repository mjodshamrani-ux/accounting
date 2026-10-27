// WF-1 REVIEW-1 foundation: the review queue of a bank statement period.
// Each story is one account and one currency over November 2026, printed in
// the layout the bank statement foundation fixed (bank-statement-native-1)
// by the ROLL-1 foundation's printedStatement, unchanged. Amounts are minor
// units. Review cases are planted by the rules of the bank statement
// foundation's contract: unreferenced pairs of one amount within the date
// window (amount-date-suggestion), referenced pairs further apart
// (date-gap), a reference with different amounts (amount-difference) or
// opposite directions (direction-conflict), a reference repeated on one side
// (duplicate-reference), and unreferenced rows of one amount with more than
// one candidate (ambiguous-amount-date). `actions` is what the accountant
// does, in order: decide a group (`group`, named by one member of one of its
// cases), decide or undo one case (`decide`, `undo`, named by its members),
// or replace the cashbook by a corrected copy (`replace`). `recipe` says how
// the story was made; `intent` is the expected queue and outcome, written
// by hand. The oracle reads neither.
//   node audit/bank-review-foundation/stories.mjs > stories.json
import { printedStatement } from '../bank-roll-foundation/stories.mjs';

export const STORIES_VERSION = 'bank-review-foundation-1';
const NOV = { start: '2026-11-01', end: '2026-11-30' };

function rng(seed) {
  let x = seed >>> 0 || 1;
  return (lo, hi) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return lo + ((x >>> 0) % (hi - lo + 1));
  };
}
const day = (d) => `2026-11-${String(d).padStart(2, '0')}`;

/** `count` ordinary movements, recorded on both sides under one reference,
 * dated within the matching window: automatic matches. */
function ordinary(random, count, prefix) {
  const bank = [],
    cash = [];
  for (let i = 0; i < count; i++) {
    const d = 2 + Math.floor((26 * i) / Math.max(count - 1, 1));
    const out = random(0, 1) === 1;
    const amount = random(200, 45000) * 100 + random(0, 99);
    const ref = `${out ? 'PAY' : 'RCV'}-${prefix}${String(i + 1).padStart(2, '0')}`;
    bank.push({ date: day(d), valueDate: day(d), description: out ? `Transfer out ${ref.slice(4)}` : `Transfer in ${ref.slice(4)}`, reference: ref, withdrawal: out ? amount : 0, deposit: out ? 0 : amount });
    cash.push({ date: day(Math.max(d - random(0, 1), 1)), voucher: `${out ? 'BP' : 'BR'}-${prefix}${String(i + 1).padStart(2, '0')}`, description: out ? 'Payment to supplier' : 'Receipt from customer', reference: ref, receipt: out ? 0 : amount, payment: out ? amount : 0 });
  }
  return { bank, cash };
}
const byDate = (rows) =>
  rows
    .map((r, i) => [r, i])
    .sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : a[1] - b[1]))
    .map(([r]) => r);

function period(random, story, { bank = [], cash = [], count = 4, opening, rowsPerPage = 12 } = {}) {
  const base = ordinary(random, count, `${story.slice(1)}N`);
  return {
    id: `${story}-NOV`,
    month: 'NOV',
    currency: 'SAR',
    period: NOV,
    opening: opening ?? random(300000, 900000) * 100,
    rowsPerPage,
    bank: byDate([...base.bank, ...bank]),
    cash: byDate([...base.cash, ...cash]),
  };
}

// Planted rows.
const out = (d, ref, amount, description = 'Counter withdrawal') => ({ date: day(d), valueDate: day(d), description, reference: ref, withdrawal: amount, deposit: 0 });
const inn = (d, ref, amount, description = 'Cash deposit') => ({ date: day(d), valueDate: day(d), description, reference: ref, withdrawal: 0, deposit: amount });
const paid = (d, ref, amount, voucher, description = 'Payment voucher') => ({ date: day(d), voucher, description, reference: ref, receipt: 0, payment: amount });
const got = (d, ref, amount, voucher, description = 'Receipt voucher') => ({ date: day(d), voucher, description, reference: ref, receipt: amount, payment: 0 });

/** `n` unreferenced pairs of one amount each, dated within the window and
 * apart from one another: n amount-date suggestions. */
function suggestions(n, direction, tag, amounts, firstDay = 3) {
  const bank = [],
    cash = [];
  for (let i = 0; i < n; i++) {
    const d = firstDay + (i % 24);
    const a = amounts[i];
    if (direction === 'out') {
      bank.push(out(d, '', a));
      cash.push(paid(Math.max(d - (i % 2), 1), '', a, `PV-${tag}-${String(i + 1).padStart(2, '0')}`, 'Petty cash payment'));
    } else {
      bank.push(inn(d, '', a));
      cash.push(got(Math.max(d - (i % 2), 1), '', a, `RV-${tag}-${String(i + 1).padStart(2, '0')}`, 'Counter receipt'));
    }
  }
  return { bank, cash };
}
/** `n` referenced pairs of one amount, the movement `gap` days after the
 * entry: n date-gap cases. */
function gaps(n, direction, tag, amounts, gap, firstDay = 2) {
  const bank = [],
    cash = [];
  for (let i = 0; i < n; i++) {
    const d = firstDay + (i % (28 - gap - firstDay));
    const ref = `${direction === 'out' ? 'CHQ' : 'DEP'}-${tag}-${String(i + 1).padStart(2, '0')}`;
    if (direction === 'out') {
      bank.push(out(d + gap, ref, amounts[i], `Cheque paid ${ref.slice(4)}`));
      cash.push(paid(d, ref, amounts[i], `BP-${tag}-${String(i + 1).padStart(2, '0')}`));
    } else {
      bank.push(inn(d + gap, ref, amounts[i], `Deposit ${ref.slice(4)}`));
      cash.push(got(d, ref, amounts[i], `BR-${tag}-${String(i + 1).padStart(2, '0')}`));
    }
  }
  return { bank, cash };
}
const join = (...parts) => ({ bank: parts.flatMap((p) => p.bank), cash: parts.flatMap((p) => p.cash) });
/** Distinct amounts from a seed, none equal to another. */
function amounts(random, n, lo = 150, hi = 9000) {
  const seen = new Set();
  const list = [];
  while (list.length < n) {
    const a = random(lo, hi) * 100 + random(0, 99);
    if (!seen.has(a)) {
      seen.add(a);
      list.push(a);
    }
  }
  return list;
}

// The statement id of a planted row, as the product numbers movements.
const S = (p, row) => `S${p.bank.indexOf(row) + 1}`;
const group = (type, member) => ({ group: { type, with: member } });
const decide = (type, statement, cashbook) => ({ decide: { type, statement, cashbook } });
const undo = (statement, cashbook) => ({ undo: { statement, cashbook } });
const g = (reason, direction, shape, cases, extra = {}) => ({ reason, direction, statement: shape[0], cashbook: shape[1], cases, ...extra });

export function buildStories() {
  const stories = [];
  const add = (id, title, build) => {
    const random = rng(7700 + Number(id.slice(1)));
    stories.push({ id, title, layout: 'en', actions: [], replace: null, ...build(random, id) });
  };

  add('Q01', 'Twenty cases of two reasons, decided by group, then one undone', (random, id) => {
    const a = amounts(random, 20);
    const sug = suggestions(10, 'out', 'Q01', a.slice(0, 10));
    const gap = gaps(10, 'in', 'Q01', a.slice(10), 5);
    const nov = period(random, id, join(sug, gap));
    return {
      periods: [nov],
      actions: [group('accept', S(nov, sug.bank[0])), group('accept', S(nov, gap.bank[0])), undo([S(nov, sug.bank[3])], [sug.cash[3].voucher])],
      recipe: 'ten unreferenced payments each paid by the bank within the window, and ten referenced deposits credited five days after the receipt; both groups accepted; then one suggestion undone',
      intent: {
        queue: [g('date-gap', 'in', [1, 1], 10, { gap: 5 }), g('amount-date-suggestion', 'out', [1, 1], 10)],
        after: { accepted: 19, rejected: 0, open: 1 },
        actions: { single: 20, grouped: 2 },
      },
    };
  });

  add('Q02', 'Exceptions come first, whatever their amounts, each by its impact', (random, id) => {
    const big = amounts(random, 3, 20000, 40000);
    const nov = period(random, id, {
      bank: [
        out(5, 'INV-Q02-501', 30000),
        out(9, 'INV-Q02-502', 45000, 'Card settlement'),
        inn(11, 'RCV-Q02-503', 60000),
        out(14, 'CHQ-Q02-504', 20000),
        out(15, 'CHQ-Q02-504', 20000),
        out(19, '', 15000),
        out(20, '', 15000),
        ...suggestions(3, 'in', 'Q02', big, 22).bank,
      ],
      cash: [
        paid(5, 'INV-Q02-501', 31000, 'PV-Q02-51'),
        got(9, 'INV-Q02-502', 45000, 'RV-Q02-52'),
        got(11, 'RCV-Q02-503', 59950, 'RV-Q02-53'),
        paid(14, 'CHQ-Q02-504', 20000, 'PV-Q02-54'),
        paid(19, '', 15000, 'PV-Q02-55'),
        ...suggestions(3, 'in', 'Q02', big, 22).cash,
      ],
    });
    return {
      periods: [nov],
      recipe: 'small exceptions of every kind: 600.00 received as 599.50 (impact 600.00), a 450.00 card settlement booked as a receipt (450.00), a 200.00 cheque paid twice (400.00 on the statement side), 300.00 paid as 310.00 (310.00), two 150.00 withdrawals for one 150.00 entry (300.00); and three large suggestions; no decision',
      intent: {
        queue: [
          g('amount-difference', 'in', [1, 1], 1),
          g('direction-conflict', 'in+out', [1, 1], 1),
          g('duplicate-reference', 'out', [2, 1], 1),
          g('amount-difference', 'out', [1, 1], 1),
          g('ambiguous-amount-date', 'out', [2, 1], 1),
          g('amount-date-suggestion', 'in', [1, 1], 3),
        ],
        order: [
          ['amount-difference', 'in'],
          ['direction-conflict', 'in+out'],
          ['duplicate-reference', 'out'],
          ['amount-difference', 'out'],
          ['ambiguous-amount-date', 'out'],
          ['amount-date-suggestion', 'in'],
        ],
        after: { accepted: 0, rejected: 0, open: 8 },
        actions: { single: 8, grouped: 6 },
      },
    };
  });

  add('Q03', 'Equal impact: the group with more members first, then case number', (random, id) => {
    const nov = period(random, id, {
      bank: [out(4, '', 250000), out(12, '', 100000), out(21, '', 250000), inn(15, '', 250000)],
      cash: [paid(4, '', 250000, 'PV-Q03-31'), paid(12, '', 100000, 'PV-Q03-32'), paid(20, '', 250000, 'PV-Q03-33'), got(15, '', 250000, 'RV-Q03-34')],
    });
    return {
      periods: [nov],
      recipe: 'unreferenced payments of 2,500.00 on the 4th and the 21st and of 1,000.00 on the 12th, each with its entry, and an unreferenced deposit of 2,500.00 with its receipt: the cases of 2,500.00 come first, in case number order, then the case of 1,000.00 numbered between them',
      intent: {
        queue: [g('amount-date-suggestion', 'out', [1, 1], 3), g('amount-date-suggestion', 'in', [1, 1], 1)],
        order: [['amount-date-suggestion', 'out'], ['amount-date-suggestion', 'in']],
        caseOrder: ['PV-Q03-31', 'PV-Q03-33', 'PV-Q03-32'],
        after: { accepted: 0, rejected: 0, open: 4 },
        actions: { single: 4, grouped: 2 },
      },
    };
  });

  add('Q04', 'Suggestions in both directions are two groups', (random, id) => {
    const a = amounts(random, 6);
    const nov = period(random, id, join(suggestions(3, 'in', 'Q04I', a.slice(0, 3)), suggestions(3, 'out', 'Q04O', a.slice(3), 12)));
    return {
      periods: [nov],
      actions: [group('accept', S(nov, nov.bank.find((r) => r.reference === '' && r.deposit)))],
      recipe: 'three unreferenced deposits and three unreferenced withdrawals, each with its entry; the deposits accepted as a group',
      intent: {
        queue: [g('amount-date-suggestion', 'in', [1, 1], 3), g('amount-date-suggestion', 'out', [1, 1], 3)],
        after: { accepted: 3, rejected: 0, open: 3 },
        actions: { single: 6, grouped: 2 },
      },
    };
  });

  add('Q05', 'Date gaps of five and nine days are two groups', (random, id) => {
    const a = amounts(random, 3);
    const five = gaps(2, 'out', 'Q05F', a.slice(0, 2), 5);
    const nine = gaps(1, 'out', 'Q05N', a.slice(2), 9, 10);
    const nov = period(random, id, join(five, nine));
    return {
      periods: [nov],
      actions: [group('accept', S(nov, five.bank[0]))],
      recipe: 'two cheques paid five days after the book and one nine days after; the five-day group accepted',
      intent: {
        queue: [g('date-gap', 'out', [1, 1], 2, { gap: 5 }), g('date-gap', 'out', [1, 1], 1, { gap: 9 })],
        after: { accepted: 2, rejected: 0, open: 1 },
        actions: { single: 3, grouped: 2 },
      },
    };
  });

  add('Q06', 'Amount differences rejected as a group stay listed by case', (random, id) => {
    const a = amounts(random, 3, 1000, 5000);
    const nov = period(random, id, {
      bank: a.map((v, i) => out(6 + 5 * i, `INV-Q06-60${i + 1}`, v, 'Supplier transfer')),
      cash: a.map((v, i) => paid(6 + 5 * i, `INV-Q06-60${i + 1}`, v + 100 * (i + 1), `PV-Q06-6${i + 1}`)),
    });
    return {
      periods: [nov],
      actions: [group('reject', 'PV-Q06-61')],
      recipe: 'three supplier transfers paid by the bank for less than the book records under the same reference; rejected as a group',
      intent: {
        queue: [g('amount-difference', 'out', [1, 1], 3)],
        after: { accepted: 0, rejected: 3, open: 0 },
        actions: { single: 3, grouped: 1 },
      },
    };
  });

  add('Q07', 'A case decided on its own is left out of the group decision', (random, id) => {
    const a = amounts(random, 4);
    const sug = suggestions(4, 'in', 'Q07', a);
    const nov = period(random, id, sug);
    return {
      periods: [nov],
      actions: [decide('reject', [S(nov, sug.bank[1])], [sug.cash[1].voucher]), group('accept', S(nov, sug.bank[0]))],
      recipe: 'four unreferenced deposits; the accountant rejects one, then accepts the group',
      intent: {
        queue: [g('amount-date-suggestion', 'in', [1, 1], 4)],
        after: { accepted: 3, rejected: 1, open: 0 },
        actions: { single: 4, grouped: 1 },
      },
    };
  });

  add('Q08', 'A corrected cashbook after a group decision refuses the session', (random, id) => {
    const a = amounts(random, 3);
    const sug = suggestions(3, 'out', 'Q08', a);
    const nov = period(random, id, sug);
    const corrected = [...nov.cash, paid(29, 'CHQ-Q08-801', 77700, 'PV-Q08-99')];
    return {
      periods: [nov],
      actions: [group('accept', S(nov, sug.bank[0])), { replace: { cashbook: 'corrected' } }],
      replace: { cashbook: byDate(corrected) },
      recipe: 'three unreferenced payments accepted as a group; then the cashbook is replaced by a corrected copy with one more cheque',
      intent: {
        queue: [g('amount-date-suggestion', 'out', [1, 1], 3)],
        refusal: 'BANK_STATEMENT_DECISION',
        actions: { single: 3, grouped: 1 },
      },
    };
  });

  add('Q09', 'Amount differences in each direction: rejecting one group leaves the other', (random, id) => {
    const a = amounts(random, 4, 1000, 5000);
    const nov = period(random, id, {
      bank: [out(5, 'INV-Q09-901', a[0]), out(9, 'INV-Q09-902', a[1]), inn(13, 'RCV-Q09-903', a[2]), inn(17, 'RCV-Q09-904', a[3])],
      cash: [paid(5, 'INV-Q09-901', a[0] - 500, 'PV-Q09-91'), paid(9, 'INV-Q09-902', a[1] - 700, 'PV-Q09-92'), got(13, 'RCV-Q09-903', a[2] + 300, 'RV-Q09-93'), got(17, 'RCV-Q09-904', a[3] + 900, 'RV-Q09-94')],
    });
    return {
      periods: [nov],
      actions: [group('reject', 'PV-Q09-91')],
      recipe: 'two payments and two receipts with amount differences under their references; the payments rejected as a group',
      intent: {
        queue: [g('amount-difference', 'out', [1, 1], 2), g('amount-difference', 'in', [1, 1], 2)],
        after: { accepted: 0, rejected: 2, open: 2 },
        actions: { single: 4, grouped: 2 },
      },
    };
  });

  add('Q10', 'An Arabic statement: suggestions accepted as a group', (random, id) => {
    const a = amounts(random, 5);
    const sug = suggestions(5, 'out', 'Q10', a);
    for (const r of sug.bank) r.description = 'سحب نقدي';
    for (const r of sug.cash) r.description = 'سند صرف';
    const nov = period(random, id, sug);
    return {
      layout: 'ar',
      periods: [nov],
      actions: [group('accept', S(nov, sug.bank[2]))],
      recipe: 'as Q07 with five payments, printed in Arabic with Arabic-Indic digits; accepted as a group',
      intent: {
        queue: [g('amount-date-suggestion', 'out', [1, 1], 5)],
        after: { accepted: 5, rejected: 0, open: 0 },
        actions: { single: 5, grouped: 1 },
      },
    };
  });

  add('Q11', 'Sixty suggestions in two groups', (random, id) => {
    const a = amounts(random, 60);
    const nov = period(random, id, { ...join(suggestions(40, 'out', 'Q11O', a.slice(0, 40)), suggestions(20, 'in', 'Q11I', a.slice(40), 2)), rowsPerPage: 16 });
    return {
      periods: [nov],
      actions: [group('accept', S(nov, nov.bank.find((r) => r.reference === '' && r.withdrawal))), group('accept', S(nov, nov.bank.find((r) => r.reference === '' && r.deposit)))],
      recipe: 'forty unreferenced payments and twenty unreferenced deposits, each with its entry, over several pages; both groups accepted',
      intent: {
        queue: [g('amount-date-suggestion', 'out', [1, 1], 40), g('amount-date-suggestion', 'in', [1, 1], 20)],
        after: { accepted: 60, rejected: 0, open: 0 },
        actions: { single: 60, grouped: 2 },
      },
    };
  });

  add('Q12', 'A held statement has no queue', (random, id) => {
    const a = amounts(random, 3);
    const nov = period(random, id, suggestions(3, 'out', 'Q12', a));
    nov.balanceFaultAt = 2;
    return {
      periods: [nov],
      recipe: 'three suggestions planted, but the third printed balance is 10.00 off the chain',
      intent: { held: true, queue: [], after: { accepted: 0, rejected: 0, open: 0 }, actions: { single: 0, grouped: 0 } },
    };
  });

  add('Q13', 'Nothing to decide', (random, id) => {
    const nov = period(random, id, { count: 6 });
    return {
      periods: [nov],
      recipe: 'six movements recorded on both sides under their references',
      intent: { queue: [], after: { accepted: 0, rejected: 0, open: 0 }, actions: { single: 0, grouped: 0 } },
    };
  });

  add('Q14', 'One reference repeated on either side: two shapes, two groups', (random, id) => {
    const a = amounts(random, 4, 500, 3000);
    const nov = period(random, id, {
      bank: [out(6, 'CHQ-Q14-141', a[0]), out(7, 'CHQ-Q14-141', a[0]), out(12, 'CHQ-Q14-142', a[1]), out(13, 'CHQ-Q14-142', a[1]), out(20, 'CHQ-Q14-143', a[2])],
      cash: [paid(6, 'CHQ-Q14-141', a[0], 'PV-Q14-41'), paid(12, 'CHQ-Q14-142', a[1], 'PV-Q14-42'), paid(20, 'CHQ-Q14-143', a[2], 'PV-Q14-43'), paid(21, 'CHQ-Q14-143', a[2], 'PV-Q14-44')],
    });
    return {
      periods: [nov],
      recipe: 'two cheques each paid twice by the bank, and one cheque recorded twice in the book',
      intent: {
        queue: [g('duplicate-reference', 'out', [2, 1], 2), g('duplicate-reference', 'out', [1, 2], 1)],
        after: { accepted: 0, rejected: 0, open: 3 },
        actions: { single: 3, grouped: 2 },
      },
    };
  });

  add('Q15', 'Undo two, then decide the group again', (random, id) => {
    const a = amounts(random, 5);
    const sug = suggestions(5, 'in', 'Q15', a);
    const nov = period(random, id, sug);
    const one = (i) => [[S(nov, sug.bank[i])], [sug.cash[i].voucher]];
    return {
      periods: [nov],
      actions: [group('accept', S(nov, sug.bank[0])), undo(...one(1)), undo(...one(3)), group('reject', S(nov, sug.bank[1]))],
      recipe: 'five unreferenced deposits accepted as a group; two undone; the group, now those two, rejected',
      intent: {
        queue: [g('amount-date-suggestion', 'in', [1, 1], 5)],
        after: { accepted: 3, rejected: 2, open: 0 },
        actions: { single: 5, grouped: 1 },
      },
    };
  });

  add('Q16', 'A small exception before a large suggestion', (random, id) => {
    const nov = period(random, id, {
      bank: [out(8, 'INV-Q16-161', 1200), out(18, '', 9850000)],
      cash: [paid(8, 'INV-Q16-161', 1210, 'PV-Q16-61'), paid(17, '', 9850000, 'PV-Q16-62')],
    });
    return {
      periods: [nov],
      recipe: 'a 12.00 transfer the book records as 12.10 under its reference, and a 98,500.00 unreferenced payment with its entry',
      intent: {
        queue: [g('amount-difference', 'out', [1, 1], 1), g('amount-date-suggestion', 'out', [1, 1], 1)],
        order: [['amount-difference', 'out'], ['amount-date-suggestion', 'out']],
        after: { accepted: 0, rejected: 0, open: 2 },
        actions: { single: 2, grouped: 2 },
      },
    };
  });
  return stories;
}

const cashRow = (r) => ({ date: r.date, voucher: r.voucher, description: r.description, reference: r.reference, receipt: r.receipt, payment: r.payment });

/** The facts: each story's printed statement and cashbook rows, the
 * corrected cashbook a story replaces its own with, and what the accountant
 * does. */
export function facts(stories = buildStories()) {
  return {
    version: STORIES_VERSION,
    stories: stories.map((s) => ({
      id: s.id,
      title: s.title,
      layout: s.layout,
      periods: s.periods.map((p) => ({ id: p.id, statement: printedStatement(p, s.id), cashbook: p.cash.map(cashRow) })),
      previous: null,
      replace: s.replace && { cashbook: s.replace.cashbook.map(cashRow) },
      actions: s.actions,
      recipe: s.recipe,
      intent: s.intent,
    })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(facts(), null, 1)}\n`);
