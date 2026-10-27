// WF-1 TOL-1 foundation: a tolerance the accountant declares on a bank
// statement period (bank-tolerance-1, proposed). Each story is one account
// and one currency over December 2026, printed in the layout the bank
// statement foundation fixed (bank-statement-native-1) by the ROLL-1
// foundation's printedStatement, unchanged. Amounts are integers in the
// currency's minor units: halalas for SAR, fils for KWD.
//
// Pairs are planted by the bank statement foundation's matching rules: a
// reference on both sides with amounts a few minor units apart
// (amount-difference), the same with dates further apart than the window,
// a reference repeated, a reference in opposite directions, and rows
// without a reference whose amounts differ. `actions` is what the
// accountant does, in order: declare a policy (`policy`), reject or undo a
// case named by its members (`reject`, `undo`). `book` is the book balance
// the accountant declares for the reconciliation sheet. `recipe` says how
// the story was made; `intent` is the expected outcome, written by hand.
// The oracle reads neither.
//   node audit/bank-tolerance-foundation/stories.mjs > stories.json
import { printedStatement } from '../bank-roll-foundation/stories.mjs';

export const STORIES_VERSION = 'bank-tolerance-foundation-1';
const DEC = { start: '2026-12-01', end: '2026-12-31' };
const EXPONENT = { SAR: 2, KWD: 3 };

function rng(seed) {
  let x = seed >>> 0 || 1;
  return (lo, hi) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return lo + ((x >>> 0) % (hi - lo + 1));
  };
}
const day = (d) => `2026-12-${String(d).padStart(2, '0')}`;

/** `count` ordinary movements recorded on both sides under one reference,
 * within the matching window: automatic matches. */
function ordinary(random, count, prefix, unit) {
  const bank = [],
    cash = [];
  for (let i = 0; i < count; i++) {
    const d = 2 + Math.floor((26 * i) / Math.max(count - 1, 1));
    const out = random(0, 1) === 1;
    const amount = random(200, 45000) * unit + random(0, unit - 1);
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

function period(random, story, { bank = [], cash = [], count = 4, currency = 'SAR', rowsPerPage = 12 } = {}) {
  const unit = 10 ** EXPONENT[currency];
  const base = ordinary(random, count, `${story.slice(1)}N`, unit);
  return {
    id: `${story}-DEC`,
    month: 'DEC',
    currency,
    period: DEC,
    opening: random(300000, 900000) * unit,
    rowsPerPage,
    bank: byDate([...base.bank, ...bank]),
    cash: byDate([...base.cash, ...cash]),
  };
}

// Planted rows.
const out = (d, ref, amount, description = 'Transfer out') => ({ date: day(d), valueDate: day(d), description, reference: ref, withdrawal: amount, deposit: 0 });
const inn = (d, ref, amount, description = 'Transfer in') => ({ date: day(d), valueDate: day(d), description, reference: ref, withdrawal: 0, deposit: amount });
const paid = (d, ref, amount, voucher, description = 'Payment voucher') => ({ date: day(d), voucher, description, reference: ref, receipt: 0, payment: amount });
const got = (d, ref, amount, voucher, description = 'Receipt voucher') => ({ date: day(d), voucher, description, reference: ref, receipt: amount, payment: 0 });

/** The book balance a cashbook gives from the statement's opening: the
 * accountant's declared balance in every story here. */
const bookOf = (p) => p.opening + p.cash.reduce((t, r) => t + r.receipt - r.payment, 0);
const policy = (perItem, perPeriod, note = 'Rounding by the payment system') => ({ policy: { perItem, perPeriod, note } });
const reject = (statement, cashbook) => ({ reject: { statement, cashbook } });
const undo = (statement, cashbook) => ({ undo: { statement, cashbook } });
const S = (p, row) => `S${p.bank.indexOf(row) + 1}`;

export function buildStories() {
  const stories = [];
  const add = (id, title, build, layout = 'en') => {
    const random = rng(8800 + Number(id.slice(1)));
    const s = { id, title, layout, actions: [], ...build(random, id) };
    s.book = { balance: bookOf(s.periods[0]) + (s.bookOffset ?? 0), note: 'General ledger 1010, December closing' };
    delete s.bookOffset;
    stories.push(s);
  };

  add('T01', 'One rounding difference inside the tolerance', (random, id) => {
    const nov = period(random, id, { bank: [out(9, 'INV-T01-101', 125000)], cash: [paid(9, 'INV-T01-101', 125001, 'PV-T01-11')] });
    return {
      periods: [nov],
      actions: [policy(1, 5)],
      recipe: 'a 1,250.00 transfer the book records as 1,250.01 under its reference; a policy of 0.01 a pair and 0.05 a period',
      intent: { tolerated: [['INV-T01-101', -1]], exceeded: null, open: 0, sheet: { status: 'reconciled-within-tolerance', difference: 1, tolerated: 1, unexplained: 0 } },
    };
  });

  add('T02', 'One minor unit outside the tolerance', (random, id) => {
    const nov = period(random, id, { bank: [out(9, 'INV-T02-201', 125000)], cash: [paid(9, 'INV-T02-201', 125002, 'PV-T02-21')] });
    return {
      periods: [nov],
      actions: [policy(1, 5)],
      recipe: 'a 1,250.00 transfer recorded as 1,250.02; a policy of 0.01 a pair',
      intent: { tolerated: [], exceeded: null, open: 1, sheet: { status: 'draft', difference: 0, tolerated: 0, unexplained: 0 } },
    };
  });

  add('T03', 'A difference at the limit is inside', (random, id) => {
    const nov = period(random, id, { bank: [inn(12, 'RCV-T03-301', 480000)], cash: [got(12, 'RCV-T03-301', 479995, 'RV-T03-31')] });
    return {
      periods: [nov],
      actions: [policy(5, 5)],
      recipe: 'a 4,800.00 receipt the book records as 4,799.95; a policy of 0.05 a pair and a period',
      intent: { tolerated: [['RCV-T03-301', 5]], exceeded: null, open: 0, sheet: { status: 'reconciled-within-tolerance', difference: 5, tolerated: 5, unexplained: 0 } },
    };
  });

  add('T04', 'Two differences on the same side exceed the period total', (random, id) => {
    const nov = period(random, id, {
      bank: [out(6, 'INV-T04-401', 30000), out(15, 'INV-T04-402', 72050)],
      cash: [paid(6, 'INV-T04-401', 30001, 'PV-T04-41'), paid(15, 'INV-T04-402', 72051, 'PV-T04-42')],
    });
    return {
      periods: [nov],
      actions: [policy(1, 1)],
      recipe: 'two transfers each recorded one halala higher; 0.01 a pair, 0.01 a period',
      intent: { tolerated: [], exceeded: { sum: 2, cap: 1 }, open: 2, sheet: { status: 'draft', difference: 0, tolerated: 0, unexplained: 0 } },
    };
  });

  add('T05', 'Opposite differences are not netted', (random, id) => {
    const nov = period(random, id, {
      bank: [out(7, 'INV-T05-501', 10000), out(19, 'INV-T05-502', 20001)],
      cash: [paid(7, 'INV-T05-501', 10001, 'PV-T05-51'), paid(19, 'INV-T05-502', 20000, 'PV-T05-52')],
    });
    return {
      periods: [nov],
      actions: [policy(1, 1)],
      recipe: 'one transfer recorded a halala higher and another a halala lower; they would net to zero; 0.01 a pair and a period',
      intent: { tolerated: [], exceeded: { sum: 2, cap: 1 }, open: 2, sheet: { status: 'draft', difference: 0, tolerated: 0, unexplained: 0 } },
    };
  });

  add('T06', 'Two differences within the period total', (random, id) => {
    const nov = period(random, id, {
      bank: [out(6, 'INV-T06-601', 30000), out(15, 'INV-T06-602', 72050)],
      cash: [paid(6, 'INV-T06-601', 30001, 'PV-T06-61'), paid(15, 'INV-T06-602', 72051, 'PV-T06-62')],
    });
    return {
      periods: [nov],
      actions: [policy(1, 2)],
      recipe: 'as T04, with 0.02 a period',
      intent: { tolerated: [['INV-T06-601', -1], ['INV-T06-602', -1]], exceeded: null, open: 0, sheet: { status: 'reconciled-within-tolerance', difference: 2, tolerated: 2, unexplained: 0 } },
    };
  });

  add('T07', 'Kuwaiti dinar, three decimals: one fils inside, ten fils outside', (random, id) => {
    const receipt = inn(16, 'RCV-T07-702', 2500010);
    const nov = period(random, id, {
      currency: 'KWD',
      bank: [out(8, 'INV-T07-701', 1000), receipt],
      cash: [paid(8, 'INV-T07-701', 1001, 'PV-T07-71'), got(16, 'RCV-T07-702', 2500000, 'RV-T07-72')],
    });
    return {
      periods: [nov],
      actions: [policy(1, 10, 'Fils rounding'), reject([S(nov, receipt)], ['RV-T07-72'])],
      recipe: 'a 1.000 KWD transfer recorded as 1.001, and a 2,500.010 receipt recorded as 2,500.000; 0.001 a pair, 0.010 a period; the receipt rejected',
      intent: { tolerated: [['INV-T07-701', -1]], exceeded: null, open: 0, rejected: 1, sheet: { status: 'reconciled-within-tolerance', difference: 1, tolerated: 1, unexplained: 0 } },
    };
  });

  add('T08', 'No policy: the difference awaits a decision as before', (random, id) => {
    const nov = period(random, id, { bank: [out(9, 'INV-T08-801', 125000)], cash: [paid(9, 'INV-T08-801', 125001, 'PV-T08-81')] });
    return {
      periods: [nov],
      recipe: 'T01 without a policy',
      intent: { tolerated: [], exceeded: null, open: 1, sheet: { status: 'draft', difference: 0, tolerated: 0, unexplained: 0 } },
    };
  });

  add('T09', 'No reference: the tolerance never makes a pair', (random, id) => {
    const nov = period(random, id, { bank: [out(11, '', 50000, 'Counter withdrawal')], cash: [paid(11, '', 50001, 'PV-T09-91', 'Petty cash payment')] });
    return {
      periods: [nov],
      actions: [policy(1, 5)],
      recipe: 'an unreferenced 500.00 withdrawal and an unreferenced 500.01 payment on the same day; 0.01 a pair',
      intent: { tolerated: [], exceeded: null, open: 0, unmatched: 2, sheet: { status: 'reconciled', difference: 0, tolerated: 0, unexplained: 0 } },
    };
  });

  add('T10', 'A direction conflict stays a conflict', (random, id) => {
    const nov = period(random, id, { bank: [out(10, 'TRF-T10-1001', 30000)], cash: [got(10, 'TRF-T10-1001', 30001, 'RV-T10-01')] });
    return {
      periods: [nov],
      actions: [policy(1, 5)],
      recipe: 'a 300.00 transfer out the book records as a 300.01 receipt under its reference',
      intent: { tolerated: [], exceeded: null, open: 1, sheet: { status: 'draft', difference: 0, tolerated: 0, unexplained: 0 } },
    };
  });

  add('T11', 'A repeated reference stays a review group', (random, id) => {
    const nov = period(random, id, {
      bank: [out(13, 'CHQ-T11-1101', 25000, 'Cheque paid'), out(14, 'CHQ-T11-1101', 25000, 'Cheque paid')],
      cash: [paid(13, 'CHQ-T11-1101', 25001, 'PV-T11-01')],
    });
    return {
      periods: [nov],
      actions: [policy(1, 5)],
      recipe: 'a 250.00 cheque paid twice by the bank, recorded once as 250.01',
      intent: { tolerated: [], exceeded: null, open: 1, sheet: { status: 'draft', difference: 0, tolerated: 0, unexplained: 0 } },
    };
  });

  add('T12', 'A small difference with dates beyond the window is not tolerated', (random, id) => {
    const nov = period(random, id, { bank: [out(20, 'CHQ-T12-1201', 64000, 'Cheque paid')], cash: [paid(9, 'CHQ-T12-1201', 64001, 'PV-T12-01')] });
    return {
      periods: [nov],
      actions: [policy(1, 5)],
      recipe: 'a cheque written on the 9th for 640.01 and paid by the bank on the 20th as 640.00',
      intent: { tolerated: [], exceeded: null, open: 1, sheet: { status: 'draft', difference: 0, tolerated: 0, unexplained: 0 } },
    };
  });

  add('T13', 'A tolerated case rejected', (random, id) => {
    const r = out(9, 'INV-T13-1301', 125000);
    const nov = period(random, id, { bank: [r], cash: [paid(9, 'INV-T13-1301', 125001, 'PV-T13-01')] });
    return {
      periods: [nov],
      actions: [policy(1, 5), reject([S(nov, r)], ['PV-T13-01'])],
      recipe: 'T01, then the tolerated case rejected',
      intent: { tolerated: [], exceeded: null, open: 0, rejected: 1, sheet: { status: 'reconciled', difference: 0, tolerated: 0, unexplained: 0 } },
    };
  });

  add('T14', 'A rejection undone: the case is tolerated again', (random, id) => {
    const r = out(9, 'INV-T14-1401', 125000);
    const nov = period(random, id, { bank: [r], cash: [paid(9, 'INV-T14-1401', 125001, 'PV-T14-01')] });
    return {
      periods: [nov],
      actions: [policy(1, 5), reject([S(nov, r)], ['PV-T14-01']), undo([S(nov, r)], ['PV-T14-01'])],
      recipe: 'T13, then the rejection undone',
      intent: { tolerated: [['INV-T14-1401', -1]], exceeded: null, open: 0, sheet: { status: 'reconciled-within-tolerance', difference: 1, tolerated: 1, unexplained: 0 } },
    };
  });

  add('T15', 'The policy changed after a decision', (random, id) => {
    const r = out(9, 'INV-T15-1501', 125000);
    const nov = period(random, id, { bank: [r], cash: [paid(9, 'INV-T15-1501', 125001, 'PV-T15-01')] });
    return {
      periods: [nov],
      actions: [policy(1, 5), reject([S(nov, r)], ['PV-T15-01']), policy(2, 5)],
      recipe: 'T13, then the policy changed to 0.02 a pair',
      intent: { refused: 'DECISION' },
    };
  });

  add('T16', 'A tolerance of one riyal a pair is refused', (random, id) => {
    const nov = period(random, id, { bank: [out(9, 'INV-T16-1601', 125000)], cash: [paid(9, 'INV-T16-1601', 125050, 'PV-T16-01')] });
    return {
      periods: [nov],
      actions: [policy(100, 500)],
      recipe: 'a 0.50 difference and a policy of 1.00 a pair, one major unit',
      intent: { refused: 'TOLERANCE:PER_ITEM' },
    };
  });

  add('T17', 'A period total below the pair limit is refused', (random, id) => {
    const nov = period(random, id, { bank: [out(9, 'INV-T17-1701', 125000)], cash: [paid(9, 'INV-T17-1701', 125001, 'PV-T17-01')] });
    return {
      periods: [nov],
      actions: [policy(3, 2)],
      recipe: '0.03 a pair and 0.02 a period',
      intent: { refused: 'TOLERANCE:PER_PERIOD' },
    };
  });

  add('T18', 'A policy without a note is refused', (random, id) => {
    const nov = period(random, id, { bank: [out(9, 'INV-T18-1801', 125000)], cash: [paid(9, 'INV-T18-1801', 125001, 'PV-T18-01')] });
    return {
      periods: [nov],
      actions: [policy(1, 5, '   ')],
      recipe: 'a valid policy whose note is only spaces',
      intent: { refused: 'TOLERANCE:NOTE' },
    };
  });

  add(
    'T19',
    'Arabic statement over pages, three differences up to the period total',
    (random, id) => {
      const nov = period(random, id, {
        count: 14,
        rowsPerPage: 8,
        bank: [out(5, 'INV-T19-1901', 410000), inn(14, 'RCV-T19-1902', 96075), out(24, 'INV-T19-1903', 15500)],
        cash: [paid(5, 'INV-T19-1901', 410001, 'PV-T19-01'), got(14, 'RCV-T19-1902', 96073, 'RV-T19-02'), paid(24, 'INV-T19-1903', 15497, 'PV-T19-03')],
      });
      return {
        periods: [nov],
        actions: [policy(3, 6, 'فروق التقريب')],
        recipe: 'differences of 0.01 (book higher), 0.02 (book lower on a receipt) and 0.03 (book lower on a payment); 0.03 a pair and 0.06 a period',
        intent: { tolerated: [['INV-T19-1901', -1], ['RCV-T19-1902', 2], ['INV-T19-1903', 3]], exceeded: null, open: 0, sheet: { status: 'reconciled-within-tolerance', difference: 0, tolerated: 0, unexplained: 0 } },
      };
    },
    'ar',
  );

  add('T20', 'The tolerance keeps the referenced member, not the exact amount', (random, id) => {
    const nov = period(random, id, {
      bank: [out(17, 'INV-T20-2001', 100000)],
      cash: [paid(17, 'INV-T20-2001', 99999, 'PV-T20-01'), paid(17, '', 100000, 'PV-T20-02', 'Petty cash payment')],
    });
    return {
      periods: [nov],
      actions: [policy(1, 5)],
      recipe: 'a 1,000.00 transfer under INV-T20-2001, its entry under the same reference as 999.99, and an unreferenced 1,000.00 payment the same day',
      intent: { tolerated: [['INV-T20-2001', 1]], exceeded: null, open: 0, unmatched: 1, sheet: { status: 'reconciled-within-tolerance', difference: -1, tolerated: -1, unexplained: 0 } },
    };
  });

  add('T21', 'A long month with five small differences', (random, id) => {
    const nov = period(random, id, {
      count: 40,
      rowsPerPage: 14,
      bank: [out(3, 'INV-T21-2101', 18000), inn(8, 'RCV-T21-2102', 250000), out(13, 'INV-T21-2103', 7725), inn(21, 'RCV-T21-2104', 61010), out(27, 'INV-T21-2105', 330000)],
      cash: [paid(3, 'INV-T21-2101', 18001, 'PV-T21-01'), got(8, 'RCV-T21-2102', 250001, 'RV-T21-02'), paid(13, 'INV-T21-2103', 7723, 'PV-T21-03'), got(21, 'RCV-T21-2104', 61009, 'RV-T21-04'), paid(27, 'INV-T21-2105', 330001, 'PV-T21-05')],
    });
    return {
      periods: [nov],
      actions: [policy(2, 6)],
      recipe: 'forty ordinary pairs and five referenced pairs one or two halalas apart (sum 6); 0.02 a pair and 0.06 a period',
      intent: { tolerated: [['INV-T21-2101', -1], ['RCV-T21-2102', -1], ['INV-T21-2103', 2], ['RCV-T21-2104', 1], ['INV-T21-2105', -1]], exceeded: null, open: 0, sheet: { status: 'reconciled-within-tolerance', difference: 0, tolerated: 0, unexplained: 0 } },
    };
  });

  add('T22', 'A policy with nothing to tolerate', (random, id) => {
    const nov = period(random, id, { count: 6 });
    return {
      periods: [nov],
      actions: [policy(1, 5)],
      recipe: 'six ordinary pairs and a policy',
      intent: { tolerated: [], exceeded: null, open: 0, sheet: { status: 'reconciled', difference: 0, tolerated: 0, unexplained: 0 } },
    };
  });
  add('T23', 'The tolerance does not explain a book difference', (random, id) => {
    const nov = period(random, id, { bank: [out(9, 'INV-T23-2301', 125000)], cash: [paid(9, 'INV-T23-2301', 125001, 'PV-T23-01')] });
    return {
      periods: [nov],
      actions: [policy(1, 5)],
      bookOffset: -5000,
      recipe: 'T01, with a book balance declared 50.00 lower than the cashbook gives',
      intent: { tolerated: [['INV-T23-2301', -1]], exceeded: null, open: 0, sheet: { status: 'difference', difference: 5001, tolerated: 1, unexplained: 5000 } },
    };
  });
  return stories;
}

const cashRow = (r) => ({ date: r.date, voucher: r.voucher, description: r.description, reference: r.reference, receipt: r.receipt, payment: r.payment });

/** The printed statement, with an account of the currency's country. */
export function statement(p, story) {
  const st = printedStatement(p, story);
  if (p.currency === 'KWD') st.account = `KW00 0000 0000 81${story.slice(1)}4417`;
  return st;
}

/** The facts: each story's printed statement and cashbook rows, the book
 * balance declared, and what the accountant does. */
export function facts(stories = buildStories()) {
  return {
    version: STORIES_VERSION,
    stories: stories.map((s) => ({
      id: s.id,
      title: s.title,
      layout: s.layout,
      periods: s.periods.map((p) => ({ id: p.id, statement: statement(p, s.id), cashbook: p.cash.map(cashRow) })),
      book: s.book,
      actions: s.actions,
      recipe: s.recipe,
      intent: s.intent,
    })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(facts(), null, 1)}\n`);
