// WF-1 ROLL-1 foundation: bank statements and cashbooks over consecutive
// periods, and the previous-period session the accountant would bring.
// Each period is one account, one currency and one month, in the layout the
// bank statement foundation fixed (bank-statement-native-1). Amounts are
// minor units. `periods[k].statement.pages` is what each printed page shows,
// line by line; render.mjs prints exactly these lines and writes the
// cashbooks and the session files; verify.py reads the PDFs back. A
// `previous` entry describes the session file the story brings: which
// periods it holds, the decisions recorded in it (by the product's case
// numbering, derived here from the documented order), and any fault planted
// in it. `recipe` says how the story was made; `intent` is the expected
// outcome, written by hand. The oracle reads neither.
//   node audit/bank-roll-foundation/stories.mjs > stories.json
export const STORIES_VERSION = 'bank-roll-foundation-1';
export const PERIODS = {
  JUN: { start: '2026-06-01', end: '2026-06-30' },
  JUL: { start: '2026-07-01', end: '2026-07-31' },
  AUG: { start: '2026-08-01', end: '2026-08-31' },
  SEP: { start: '2026-09-01', end: '2026-09-30' },
};
const MONTH = { JUN: 6, JUL: 7, AUG: 8, SEP: 9 };
export const DATE_WINDOW_DAYS = 3;

function rng(seed) {
  let x = seed >>> 0 || 1;
  return (lo, hi) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return lo + ((x >>> 0) % (hi - lo + 1));
  };
}
const day = (m, d) =>
  `2026-${String(MONTH[m]).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** `count` ordinary movements of one month, each recorded on both sides
 * under the same explicit reference, dated within the window. */
function ordinary(random, month, count, prefix) {
  const bank = [],
    cash = [];
  for (let i = 0; i < count; i++) {
    const d = 3 + Math.floor((22 * i) / Math.max(count - 1, 1));
    const out = random(0, 1) === 1;
    const amount = random(150, 60000) * 100 + random(0, 99);
    const ref = `${out ? 'CHQ' : 'TRF'}-${prefix}${String(i + 1).padStart(2, '0')}`;
    bank.push({
      date: day(month, d),
      valueDate: day(month, d),
      description: out ? `Cheque paid ${ref.slice(4)}` : `Incoming transfer ${ref.slice(4)}`,
      reference: ref,
      withdrawal: out ? amount : 0,
      deposit: out ? 0 : amount,
    });
    cash.push({
      date: day(month, Math.max(d - random(0, 1), 1)),
      voucher: `${out ? 'PV' : 'RV'}-${prefix}${String(i + 1).padStart(2, '0')}`,
      description: out ? 'Supplier payment by cheque' : 'Customer receipt',
      reference: ref,
      receipt: out ? 0 : amount,
      payment: out ? amount : 0,
    });
  }
  return { bank, cash };
}

const byDate = (rows) =>
  rows
    .map((r, i) => [r, i])
    .sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : a[1] - b[1]))
    .map(([r]) => r);

/** One period: its own ordinary movements plus the story's planted rows. */
function period(random, story, month, { bank = [], cash = [], count = 4, opening, currency = 'SAR', rowsPerPage = 9 } = {}) {
  const base = ordinary(random, month, count, `${story.slice(1)}${month}`);
  return {
    id: `${story}-${month}`,
    month,
    currency,
    period: PERIODS[month],
    opening: opening ?? random(20000, 900000) * 100,
    rowsPerPage,
    bank: byDate([...base.bank, ...bank]),
    cash: byDate([...base.cash, ...cash]),
  };
}

const closingOf = (p) => p.bank.reduce((b, r) => b + r.deposit - r.withdrawal, p.opening);

/** The printed pages of one period's statement, as the bank statement
 * foundation prints them. */
export function printedStatement(p, story) {
  let balance = p.opening;
  const rows = p.bank.map((r) => {
    balance += r.deposit - r.withdrawal;
    return { ...r, balance };
  });
  const printed = rows.map((r) => ({ ...r }));
  if (p.balanceFaultAt !== undefined) printed[p.balanceFaultAt].balance += 1000;
  const chunks = [];
  for (let i = 0; i < rows.length; i += p.rowsPerPage)
    chunks.push([i, Math.min(i + p.rowsPerPage, rows.length)]);
  const total = chunks.length;
  const pages = chunks.map(([from, to], k) => {
    const number = k + 1;
    const lines = [
      number === 1
        ? { kind: 'opening', balance: p.opening }
        : { kind: 'brought-forward', balance: rows[from - 1].balance },
    ];
    for (const [j, r] of printed.slice(from, to).entries())
      lines.push({
        kind: 'movement',
        // The movement's id as the product numbers it: S1, S2, … in printed order.
        key: `S${from + j + 1}`,
        date: r.date,
        valueDate: r.valueDate,
        description: r.description,
        reference: r.reference,
        withdrawal: r.withdrawal,
        deposit: r.deposit,
        balance: r.balance,
      });
    if (number < total) lines.push({ kind: 'carried-forward', balance: rows[to - 1].balance });
    else {
      lines.push({ kind: 'closing', balance: rows.length ? rows[rows.length - 1].balance : p.opening });
      lines.push({
        kind: 'totals',
        withdrawal: rows.reduce((t, r) => t + r.withdrawal, 0),
        deposit: rows.reduce((t, r) => t + r.deposit, 0),
      });
    }
    return { number, of: total, lines };
  });
  return {
    account: `SA00 0000 0000 77${story.slice(1)}4417`,
    currency: p.currency,
    period: p.period,
    pages,
  };
}

// The product's case numbering in a session (bank-statement-lifecycle-1):
// automatic pairs and reference review groups in ascending reference order,
// then amount components by their first member key, cashbook keys before
// statement keys. Statement movements are S1, S2, … in printed order. Used
// only to name the case a recorded decision takes; the oracle derives the
// cases itself and checks the decision against them.
function caseOf(p, members) {
  const S = new Map(p.bank.map((r, i) => [r, `S${i + 1}`]));
  const refs = [...new Set([...p.bank, ...p.cash].map((r) => r.reference).filter(Boolean))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const auto = [],
    review = [];
  const used = new Set();
  for (const ref of refs) {
    const b = p.bank.filter((r) => r.reference === ref);
    const c = p.cash.filter((r) => r.reference === ref);
    if (!b.length || !c.length) continue;
    const key = { statement: b.map((r) => S.get(r)), cashbook: c.map((r) => r.voucher) };
    const sameAmount = b.length === 1 && c.length === 1 && (b[0].withdrawal || b[0].deposit) === (c[0].payment || c[0].receipt);
    const gap = b.length === 1 && c.length === 1 &&
      Math.abs(Date.parse(b[0].date) - Date.parse(c[0].date)) / 86400000 > DATE_WINDOW_DAYS;
    if (b.length === 1 && c.length === 1 && sameAmount && !gap && !!b[0].withdrawal === !!c[0].payment) auto.push(key);
    else review.push(key);
    for (const r of [...b, ...c]) used.add(r);
  }
  const rest = [];
  for (const r of p.bank) if (!used.has(r)) for (const c of p.cash) {
    if (used.has(c)) continue;
    const dir = (r.withdrawal ? 'out' : 'in') === (c.payment ? 'out' : 'in');
    const amt = (r.withdrawal || r.deposit) === (c.payment || c.receipt);
    const near = Math.abs(Date.parse(r.date) - Date.parse(c.date)) / 86400000 <= DATE_WINDOW_DAYS;
    if (dir && amt && near) rest.push({ statement: [S.get(r)], cashbook: [c.voucher], first: `C:${c.voucher}` });
  }
  rest.sort((a, b) => (a.first < b.first ? -1 : 1));
  const cases = [...auto, ...review, ...rest.map(({ statement, cashbook }) => ({ statement, cashbook }))];
  const k = cases.findIndex((c) => JSON.stringify(c) === JSON.stringify(members));
  if (k < 0) throw new Error(`no case ${JSON.stringify(members)} in ${p.id}`);
  return { case: `C${k + 1}`, ...members };
}
const sid = (p, row) => `S${p.bank.indexOf(row) + 1}`;
// Items as the intent names them: the period, then S<n> or the voucher.
const S = (p, row) => `${p.month}:${sid(p, row)}`;
const C = (p, voucher) => `${p.month}:${voucher}`;
const find = (p, ref) => p.bank.filter((r) => r.reference === ref);

export function buildStories() {
  const stories = [];
  const add = (id, title, build) => {
    const random = rng(7000 + Number(id.slice(1)));
    const s = { id, title, layout: 'en', ...build(random, id) };
    stories.push(s);
  };
  // A cheque, a deposit or a charge planted in one period, and its other side.
  const cheque = (m, d, ref, amount, voucher) => ({
    date: day(m, d), voucher, description: 'Supplier payment by cheque', reference: ref, receipt: 0, payment: amount,
  });
  const presented = (m, d, ref, amount) => ({
    date: day(m, d), valueDate: day(m, d), description: `Cheque paid ${ref.slice(4)}`, reference: ref, withdrawal: amount, deposit: 0,
  });

  add('R01', 'An outstanding cheque clears in the next period', (random, id) => {
    const jul = period(random, id, 'JUL', { cash: [cheque('JUL', 29, 'CHQ-R01-900', 482500, 'PV-R01-90')] });
    const aug = period(random, id, 'AUG', { opening: closingOf(jul), bank: [presented('AUG', 6, 'CHQ-R01-900', 482500)] });
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [] },
      recipe: 'July cashbook pays CHQ-R01-900; the July statement does not show it; the August statement does',
      intent: { previous: 'accepted', carried: [C(jul, 'PV-R01-90')], cases: [{ reason: 'carried-reference', carried: [C(jul, 'PV-R01-90')], current: find(aug, 'CHQ-R01-900').map((r) => S(aug, r)) }], stillCarried: [] },
    };
  });

  add('R02', 'A deposit in transit', (random, id) => {
    const jul = period(random, id, 'JUL', {
      cash: [{ date: day('JUL', 31), voucher: 'RV-R02-91', description: 'Cash deposited after cut-off', reference: 'DEP-R02-910', receipt: 1290000, payment: 0 }],
    });
    const aug = period(random, id, 'AUG', {
      opening: closingOf(jul),
      bank: [{ date: day('AUG', 2), valueDate: day('AUG', 2), description: 'Cash deposit', reference: 'DEP-R02-910', withdrawal: 0, deposit: 1290000 }],
    });
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [] },
      recipe: 'a receipt recorded on 31 July reaches the bank on 2 August',
      intent: { previous: 'accepted', carried: [C(jul, 'RV-R02-91')], cases: [{ reason: 'carried-reference', carried: [C(jul, 'RV-R02-91')], current: find(aug, 'DEP-R02-910').map((r) => S(aug, r)) }], stillCarried: [] },
    };
  });

  add('R03', 'A bank charge booked in the next period', (random, id) => {
    const jul = period(random, id, 'JUL', {
      bank: [{ date: day('JUL', 31), valueDate: day('JUL', 31), description: 'Account maintenance charge', reference: 'FEE-R03-0731', withdrawal: 11500, deposit: 0 }],
    });
    const aug = period(random, id, 'AUG', {
      opening: closingOf(jul),
      cash: [{ date: day('AUG', 4), voucher: 'PV-R03-95', description: 'Bank charge July', reference: 'FEE-R03-0731', receipt: 0, payment: 11500 }],
    });
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [] },
      recipe: 'the July statement charges FEE-R03-0731; the company books it in August',
      intent: { previous: 'accepted', carried: find(jul, 'FEE-R03-0731').map((r) => S(jul, r)), cases: [{ reason: 'carried-reference', carried: find(jul, 'FEE-R03-0731').map((r) => S(jul, r)), current: [C(aug, 'PV-R03-95')] }], stillCarried: [] },
    };
  });

  // R04 and R05 share their months: the cheque waits through August.
  const chain = (random, id) => {
    const ref = `CHQ-${id}-930`;
    const jul = period(random, id, 'JUL', { cash: [cheque('JUL', 27, ref, 2150000, `PV-${id}-93`)] });
    const aug = period(random, id, 'AUG', { opening: closingOf(jul) });
    const sep = period(random, id, 'SEP', { opening: closingOf(aug), bank: [presented('SEP', 9, ref, 2150000)] });
    return { jul, aug, sep, ref };
  };
  add('R04', 'A cheque still outstanding at the end of the next period', (random, id) => {
    const { jul, aug } = chain(random, id);
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [] },
      recipe: 'CHQ-R04-930 written in July is not presented in August',
      intent: { previous: 'accepted', carried: [C(jul, 'PV-R04-93')], cases: [], stillCarried: [{ item: C(jul, 'PV-R04-93'), age: 2 }] },
    };
  });
  add('R05', 'A cheque clears two periods later, through the chain', (random, id) => {
    const { jul, aug, sep, ref } = chain(random, id);
    return {
      periods: [jul, aug, sep],
      previous: { holds: ['JUL', 'AUG'], decisions: [] },
      recipe: 'the August session carries the July session; CHQ-R05-930, written in July, is presented in September',
      intent: { previous: 'accepted', carried: [C(jul, 'PV-R05-93')], cases: [{ reason: 'carried-reference', carried: [C(jul, 'PV-R05-93')], current: find(sep, ref).map((r) => S(sep, r)) }], stillCarried: [] },
    };
  });

  add('R06', 'The carried cheque is presented twice', (random, id) => {
    const jul = period(random, id, 'JUL', { cash: [cheque('JUL', 30, 'CHQ-R06-940', 760000, 'PV-R06-94')] });
    const aug = period(random, id, 'AUG', {
      opening: closingOf(jul),
      bank: [presented('AUG', 5, 'CHQ-R06-940', 760000), presented('AUG', 19, 'CHQ-R06-940', 760000)],
    });
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [] },
      recipe: 'two August withdrawals print CHQ-R06-940 for the carried amount',
      intent: { previous: 'accepted', carried: [C(jul, 'PV-R06-94')], cases: [{ reason: 'carried-ambiguous', carried: [C(jul, 'PV-R06-94')], current: find(aug, 'CHQ-R06-940').map((r) => S(aug, r)) }], stillCarried: [] },
    };
  });

  add('R07', 'The carried cheque is recorded again in the next cashbook', (random, id) => {
    const jul = period(random, id, 'JUL', { cash: [cheque('JUL', 28, 'CHQ-R07-950', 330000, 'PV-R07-95')] });
    const aug = period(random, id, 'AUG', {
      opening: closingOf(jul),
      cash: [cheque('JUL', 28, 'CHQ-R07-950', 330000, 'PV-R07-95')],
      bank: [presented('AUG', 8, 'CHQ-R07-950', 330000)],
    });
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [] },
      recipe: 'the August cashbook export starts with the July cheque again, voucher and values unchanged; the August statement presents it',
      intent: { previous: 'accepted', carried: [C(jul, 'PV-R07-95')], cases: [{ reason: 'carried-repeated', carried: [C(jul, 'PV-R07-95')], current: [...find(aug, 'CHQ-R07-950').map((r) => S(aug, r)), C(aug, 'PV-R07-95')] }], stillCarried: [] },
    };
  });

  add('R08', 'The carried cheque is restated with another amount', (random, id) => {
    const jul = period(random, id, 'JUL', { cash: [cheque('JUL', 28, 'CHQ-R08-960', 415000, 'PV-R08-96')] });
    const aug = period(random, id, 'AUG', {
      opening: closingOf(jul),
      cash: [cheque('AUG', 2, 'CHQ-R08-960', 451000, 'PV-R08-96')],
    });
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [] },
      recipe: 'the August cashbook carries voucher PV-R08-96 again, dated 2 August, for 4,510.00 instead of 4,150.00',
      intent: { previous: 'accepted', carried: [C(jul, 'PV-R08-96')], cases: [{ reason: 'carried-restated', carried: [C(jul, 'PV-R08-96')], current: [C(aug, 'PV-R08-96')] }], stillCarried: [] },
    };
  });

  add('R09', 'A rejected suggestion leaves two items; one clears by amount', (random, id) => {
    const bankRow = { date: day('JUL', 28), valueDate: day('JUL', 28), description: 'Cash deposit', reference: '', withdrawal: 0, deposit: 123400 };
    const cashRow = { date: day('JUL', 29), voucher: 'RV-R09-97', description: 'Counter receipt', reference: '', receipt: 123400, payment: 0 };
    const jul = period(random, id, 'JUL', { bank: [bankRow], cash: [cashRow] });
    const later = { date: day('AUG', 3), valueDate: day('AUG', 3), description: 'Cash deposit', reference: '', withdrawal: 0, deposit: 123400 };
    const aug = period(random, id, 'AUG', { opening: closingOf(jul), bank: [later] });
    const decision = caseOf(jul, { statement: [sid(jul, bankRow)], cashbook: ['RV-R09-97'] });
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [{ type: 'reject', ...decision, note: 'Different deposits: teller slips differ' }] },
      recipe: 'July: a deposit and a receipt of 1,234.00 without references, suggested by amount and date, rejected by the accountant; August: one more such deposit',
      intent: {
        previous: 'accepted',
        carried: [S(jul, bankRow), C(jul, 'RV-R09-97')],
        cases: [{ reason: 'carried-amount-suggestion', carried: [C(jul, 'RV-R09-97')], current: [S(aug, later)] }],
        stillCarried: [{ item: S(jul, bankRow), age: 2 }],
      },
    };
  });

  add('R10', 'The carried cheque is presented for another amount', (random, id) => {
    const jul = period(random, id, 'JUL', { cash: [cheque('JUL', 29, 'CHQ-R10-970', 150000, 'PV-R10-97')] });
    const aug = period(random, id, 'AUG', { opening: closingOf(jul), bank: [presented('AUG', 7, 'CHQ-R10-970', 155000)] });
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [] },
      recipe: 'CHQ-R10-970 written for 1,500.00 is presented for 1,550.00',
      intent: { previous: 'accepted', carried: [C(jul, 'PV-R10-97')], cases: [{ reason: 'carried-amount-difference', carried: [C(jul, 'PV-R10-97')], current: find(aug, 'CHQ-R10-970').map((r) => S(aug, r)) }], stillCarried: [] },
    };
  });

  add('R11', 'The previous session is in another currency', (random, id) => {
    const jul = period(random, id, 'JUL', { currency: 'USD', cash: [cheque('JUL', 29, 'CHQ-R11-980', 99000, 'PV-R11-98')] });
    const aug = period(random, id, 'AUG', { bank: [presented('AUG', 6, 'CHQ-R11-980', 99000)] });
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [] },
      recipe: 'the July statement is printed in USD; the August one in SAR',
      intent: { previous: 'ROLL_CURRENCY', carried: [], cases: [], stillCarried: [] },
    };
  });

  add('R12', 'The previous session is not the previous period', (random, id) => {
    const jun = period(random, id, 'JUN', { cash: [cheque('JUN', 29, 'CHQ-R12-990', 210000, 'PV-R12-99')] });
    const aug = period(random, id, 'AUG', { opening: closingOf(jun), bank: [presented('AUG', 6, 'CHQ-R12-990', 210000)] });
    return {
      periods: [jun, aug],
      previous: { holds: ['JUN'], decisions: [] },
      recipe: 'a June session brought to August; June closing equals August opening',
      intent: { previous: 'ROLL_NOT_CONSECUTIVE', carried: [], cases: [], stillCarried: [] },
    };
  });

  add('R13', 'The current opening differs from the previous closing', (random, id) => {
    const jul = period(random, id, 'JUL', { cash: [cheque('JUL', 29, 'CHQ-R13-901', 310000, 'PV-R13-91')] });
    const aug = period(random, id, 'AUG', { opening: closingOf(jul) + 10000, bank: [presented('AUG', 6, 'CHQ-R13-901', 310000)] });
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [] },
      recipe: 'the August statement opens 100.00 above the July closing',
      intent: { previous: 'ROLL_OPENING', carried: [], cases: [], stillCarried: [] },
    };
  });

  add('R14', 'The previous period still has an undecided case', (random, id) => {
    const jul = period(random, id, 'JUL', {
      bank: [{ date: day('JUL', 20), valueDate: day('JUL', 20), description: 'Cash deposit', reference: '', withdrawal: 0, deposit: 88000 }],
      cash: [{ date: day('JUL', 21), voucher: 'RV-R14-92', description: 'Counter receipt', reference: '', receipt: 88000, payment: 0 },
        cheque('JUL', 29, 'CHQ-R14-902', 270000, 'PV-R14-92')],
    });
    const aug = period(random, id, 'AUG', { opening: closingOf(jul), bank: [presented('AUG', 6, 'CHQ-R14-902', 270000)] });
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [] },
      recipe: 'July leaves an amount and date suggestion undecided',
      intent: { previous: 'ROLL_PREVIOUS_UNDECIDED', carried: [], cases: [], stillCarried: [] },
    };
  });

  add('R15', 'The previous statement has a broken balance chain', (random, id) => {
    const jul = period(random, id, 'JUL', { cash: [cheque('JUL', 29, 'CHQ-R15-903', 120000, 'PV-R15-93')] });
    jul.balanceFaultAt = 2;
    const aug = period(random, id, 'AUG', { opening: closingOf(jul), bank: [presented('AUG', 6, 'CHQ-R15-903', 120000)] });
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [] },
      recipe: 'one July running balance is printed 10.00 off',
      intent: { previous: 'ROLL_PREVIOUS_HELD', carried: [], cases: [], stillCarried: [] },
    };
  });

  add('R16', 'The previous session file was altered', (random, id) => {
    const jul = period(random, id, 'JUL', { cash: [cheque('JUL', 29, 'CHQ-R16-904', 640000, 'PV-R16-94')] });
    const aug = period(random, id, 'AUG', { opening: closingOf(jul), bank: [presented('AUG', 6, 'CHQ-R16-904', 640000)] });
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [], tamper: 'cashbook amount 6400.00 changed to 6400.01 inside the session, its recorded fingerprint kept' },
      recipe: 'the July cashbook inside the session was edited after saving',
      intent: { previous: 'ROLL_PREVIOUS_UNREADABLE', carried: [], cases: [], stillCarried: [] },
    };
  });

  add('R17', 'No previous session: the period as today', (random, id) => {
    const jul = period(random, id, 'JUL', { cash: [cheque('JUL', 29, 'CHQ-R17-905', 52000, 'PV-R17-95')] });
    const aug = period(random, id, 'AUG', { opening: closingOf(jul), bank: [presented('AUG', 6, 'CHQ-R17-905', 52000)] });
    return {
      periods: [jul, aug],
      previous: null,
      recipe: 'August alone; the cheque written in July has no counterpart there',
      intent: { previous: 'none', carried: [], cases: [], stillCarried: [] },
    };
  });

  add('R18', 'An accepted case is not carried; an outstanding cheque is', (random, id) => {
    const bankRow = { date: day('JUL', 22), valueDate: day('JUL', 22), description: 'Incoming transfer', reference: 'TRF-R18-906', withdrawal: 0, deposit: 405000 };
    const cashRow = { date: day('JUL', 15), voucher: 'RV-R18-96', description: 'Customer receipt', reference: 'TRF-R18-906', receipt: 405000, payment: 0 };
    const jul = period(random, id, 'JUL', { bank: [bankRow], cash: [cashRow, cheque('JUL', 30, 'CHQ-R18-907', 98000, 'PV-R18-97')] });
    const aug = period(random, id, 'AUG', { opening: closingOf(jul), bank: [presented('AUG', 4, 'CHQ-R18-907', 98000)] });
    const decision = caseOf(jul, { statement: [sid(jul, bankRow)], cashbook: ['RV-R18-96'] });
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [{ type: 'accept', ...decision, note: 'Receipt booked a week before the bank credit' }] },
      recipe: 'July: TRF-R18-906 seven days apart, a date gap the accountant accepts; CHQ-R18-907 outstanding',
      intent: { previous: 'accepted', carried: [C(jul, 'PV-R18-97')], cases: [{ reason: 'carried-reference', carried: [C(jul, 'PV-R18-97')], current: find(aug, 'CHQ-R18-907').map((r) => S(aug, r)) }], stillCarried: [] },
    };
  });

  add('R19', 'Equal amounts with different references do not pair', (random, id) => {
    const jul = period(random, id, 'JUL', { cash: [cheque('JUL', 29, 'CHQ-R19-908', 250000, 'PV-R19-98')] });
    const aug = period(random, id, 'AUG', { opening: closingOf(jul), bank: [presented('AUG', 5, 'CHQ-R19-918', 250000)] });
    return {
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [] },
      recipe: 'CHQ-R19-908 is carried; August presents CHQ-R19-918 for the same amount',
      intent: { previous: 'accepted', carried: [C(jul, 'PV-R19-98')], cases: [], stillCarried: [{ item: C(jul, 'PV-R19-98'), age: 2 }] },
    };
  });

  add('R20', 'An Arabic statement: an outstanding cheque clears', (random, id) => {
    const jul = period(random, id, 'JUL', { cash: [cheque('JUL', 30, 'CHQ-R20-909', 365000, 'PV-R20-99')] });
    const aug = period(random, id, 'AUG', { opening: closingOf(jul), bank: [presented('AUG', 3, 'CHQ-R20-909', 365000)] });
    return {
      layout: 'ar',
      periods: [jul, aug],
      previous: { holds: ['JUL'], decisions: [] },
      recipe: 'as R01, both statements printed in Arabic with Arabic-Indic digits',
      intent: { previous: 'accepted', carried: [C(jul, 'PV-R20-99')], cases: [{ reason: 'carried-reference', carried: [C(jul, 'PV-R20-99')], current: find(aug, 'CHQ-R20-909').map((r) => S(aug, r)) }], stillCarried: [] },
    };
  });
  return stories;
}

/** The facts: each period's printed statement and cashbook rows, and what
 * the previous session holds. */
export function facts(stories = buildStories()) {
  return {
    version: STORIES_VERSION,
    stories: stories.map((s) => ({
      id: s.id,
      title: s.title,
      layout: s.layout,
      periods: s.periods.map((p) => ({
        id: p.id,
        statement: printedStatement(p, s.id),
        cashbook: p.cash.map((r) => ({
          date: r.date, voucher: r.voucher, description: r.description, reference: r.reference, receipt: r.receipt, payment: r.payment,
        })),
      })),
      previous: s.previous,
      recipe: s.recipe,
      intent: s.intent,
    })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(facts(), null, 1)}\n`);
