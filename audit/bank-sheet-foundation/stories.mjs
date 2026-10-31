// WF-1 REPORT-1 foundation: the closing reconciliation sheet of a bank
// statement period. Each story is one account and one currency over one,
// two or three consecutive months (October to December 2026), printed in the
// layout the bank statement foundation fixed (bank-statement-native-1) by
// the ROLL-1 foundation's printedStatement, unchanged. Amounts are minor
// units. A `previous` entry describes the session file the story brings, as
// in the ROLL-1 foundation. `sheet` is what the accountant does on the
// current period, in order: declare the book balance (`book`), decide a case
// (`decide`, named by its members), prepare or review the sheet. `recipe`
// says how the story was made; `intent` is the expected sheet, written by
// hand. The oracle reads neither.
//   node audit/bank-sheet-foundation/stories.mjs > stories.json
import { printedStatement } from '../bank-roll-foundation/stories.mjs';

export const STORIES_VERSION = 'bank-sheet-foundation-1';
export const PERIODS = {
  OCT: { start: '2026-10-01', end: '2026-10-31' },
  NOV: { start: '2026-11-01', end: '2026-11-30' },
  DEC: { start: '2026-12-01', end: '2026-12-31' },
};
const MONTH = { OCT: 10, NOV: 11, DEC: 12 };

function rng(seed) {
  let x = seed >>> 0 || 1;
  return (lo, hi) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return lo + ((x >>> 0) % (hi - lo + 1));
  };
}
const day = (m, d) => `2026-${MONTH[m]}-${String(d).padStart(2, '0')}`;

/** `count` ordinary movements of one month, recorded on both sides under the
 * same reference, dated within the matching window. */
function ordinary(random, month, count, prefix) {
  const bank = [],
    cash = [];
  for (let i = 0; i < count; i++) {
    const d = 4 + Math.floor((21 * i) / Math.max(count - 1, 1));
    const out = random(0, 1) === 1;
    const amount = random(200, 45000) * 100 + random(0, 99);
    const ref = `${out ? 'PAY' : 'RCV'}-${prefix}${String(i + 1).padStart(2, '0')}`;
    bank.push({
      date: day(month, d),
      valueDate: day(month, d),
      description: out ? `Transfer out ${ref.slice(4)}` : `Transfer in ${ref.slice(4)}`,
      reference: ref,
      withdrawal: out ? amount : 0,
      deposit: out ? 0 : amount,
    });
    cash.push({
      date: day(month, Math.max(d - random(0, 2), 1)),
      voucher: `${out ? 'BP' : 'BR'}-${prefix}${String(i + 1).padStart(2, '0')}`,
      description: out ? 'Payment to supplier' : 'Receipt from customer',
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

function period(random, story, month, { bank = [], cash = [], count = 4, opening, currency = 'SAR', rowsPerPage = 10 } = {}) {
  const base = ordinary(random, month, count, `${story.slice(1)}${month[0]}`);
  return {
    id: `${story}-${month}`,
    month,
    currency,
    period: PERIODS[month],
    opening: opening ?? random(30000, 700000) * 100,
    rowsPerPage,
    bank: byDate([...base.bank, ...bank]),
    cash: byDate([...base.cash, ...cash]),
  };
}

const closingOf = (p) => p.bank.reduce((b, r) => b + r.deposit - r.withdrawal, p.opening);
const cashNet = (p) => p.cash.reduce((t, r) => t + r.receipt - r.payment, 0);
/** The books' balance at the last period end when the cashbook files are the
 * whole ledger and the first period opened equal to the bank. */
const ledger = (periods) => periods.reduce((b, p) => b + cashNet(p), periods[0].opening);

// Planted rows.
const payment = (m, d, ref, amount, voucher, description = 'Supplier payment by cheque') =>
  ({ date: day(m, d), voucher, description, reference: ref, receipt: 0, payment: amount });
const receipt = (m, d, ref, amount, voucher, description = 'Cash deposited') =>
  ({ date: day(m, d), voucher, description, reference: ref, receipt: amount, payment: 0 });
const withdrawal = (m, d, ref, amount, description = `Cheque paid ${ref.slice(4)}`) =>
  ({ date: day(m, d), valueDate: day(m, d), description, reference: ref, withdrawal: amount, deposit: 0 });
const deposit = (m, d, ref, amount, description = 'Cash deposit') =>
  ({ date: day(m, d), valueDate: day(m, d), description, reference: ref, withdrawal: 0, deposit: amount });

// Items as the intent names them: the period, then S<n> or the voucher.
const S = (p, row) => `${p.month}:S${p.bank.indexOf(row) + 1}`;
const C = (p, voucher) => `${p.month}:${voucher}`;
const ref = (p, reference) => p.bank.filter((r) => r.reference === reference).map((r) => S(p, r));
const amount = (p, value) => p.bank.filter((r) => r.withdrawal === value || r.deposit === value);
const book = (balance, note = 'General ledger, cash at bank, period end') => ({ book: { balance, note } });
const prepared = { prepare: { name: 'Prepared by A. Accountant', date: '2026-12-02' } };
const reviewed = { review: { name: 'Reviewed by R. Reviewer', date: '2026-12-03' } };

export function buildStories() {
  const stories = [];
  const add = (id, title, build) => {
    const random = rng(9100 + Number(id.slice(1)));
    stories.push({ id, title, layout: 'en', language: 'en', previous: null, ...build(random, id) });
  };

  add('T01', 'Every movement matched: the sheet balances with no item', (random, id) => {
    const nov = period(random, id, 'NOV', { count: 5 });
    return {
      periods: [nov],
      sheet: [book(ledger([nov]))],
      recipe: 'five movements recorded on both sides; the book balance is the ledger',
      intent: { status: 'reconciled', difference: 0, items: [], signoffs: {} },
    };
  });

  add('T02', 'An outstanding cheque and a deposit in transit, prepared and reviewed', (random, id) => {
    const nov = period(random, id, 'NOV', {
      cash: [payment('NOV', 27, 'CHQ-T02-301', 518040, 'BP-T02-91'), receipt('NOV', 30, 'DEP-T02-302', 1275000, 'BR-T02-92')],
    });
    return {
      periods: [nov],
      sheet: [book(ledger([nov])), prepared, reviewed],
      recipe: 'the cashbook pays CHQ-T02-301 and receives DEP-T02-302 at month end; the statement shows neither',
      intent: {
        status: 'reconciled', difference: 0,
        items: [
          { item: C(nov, 'BP-T02-91'), section: 'bookPaymentsNotOnStatement', origin: 'unmatched' },
          { item: C(nov, 'BR-T02-92'), section: 'bookReceiptsNotOnStatement', origin: 'unmatched' },
        ],
        signoffs: { prepared: 'valid', reviewed: 'valid' },
      },
    };
  });

  add('T03', 'A bank charge and interest not yet in the book', (random, id) => {
    const nov = period(random, id, 'NOV', {
      bank: [withdrawal('NOV', 29, 'FEE-T03-1129', 9775, 'Account maintenance charge'), deposit('NOV', 30, 'INT-T03-1130', 41210, 'Interest credited')],
    });
    return {
      periods: [nov],
      sheet: [book(ledger([nov]))],
      recipe: 'the statement charges a fee and credits interest; the cashbook records neither',
      intent: {
        status: 'reconciled', difference: 0,
        items: [
          { item: ref(nov, 'FEE-T03-1129')[0], section: 'statementWithdrawalsNotInBook', origin: 'unmatched' },
          { item: ref(nov, 'INT-T03-1130')[0], section: 'statementDepositsNotInBook', origin: 'unmatched' },
        ],
        signoffs: {},
      },
    };
  });

  add('T04', 'An Arabic statement and sheet with all four sections', (random, id) => {
    const nov = period(random, id, 'NOV', {
      bank: [withdrawal('NOV', 28, 'FEE-T04-1128', 15000, 'Card fee'), deposit('NOV', 30, 'INT-T04-1130', 22050, 'Profit credited')],
      cash: [payment('NOV', 29, 'CHQ-T04-401', 312500, 'BP-T04-91'), receipt('NOV', 30, 'DEP-T04-402', 880000, 'BR-T04-92')],
    });
    return {
      layout: 'ar',
      language: 'ar',
      periods: [nov],
      sheet: [book(ledger([nov]), 'دفتر الأستاذ، النقد لدى البنك')],
      recipe: 'as T02 and T03 together, printed in Arabic with Arabic-Indic digits, the sheet in Arabic',
      intent: {
        status: 'reconciled', difference: 0,
        items: [
          { item: C(nov, 'BP-T04-91'), section: 'bookPaymentsNotOnStatement', origin: 'unmatched' },
          { item: C(nov, 'BR-T04-92'), section: 'bookReceiptsNotOnStatement', origin: 'unmatched' },
          { item: ref(nov, 'FEE-T04-1128')[0], section: 'statementWithdrawalsNotInBook', origin: 'unmatched' },
          { item: ref(nov, 'INT-T04-1130')[0], section: 'statementDepositsNotInBook', origin: 'unmatched' },
        ],
        signoffs: {},
      },
    };
  });

  add('T05', 'A book balance declared 900.00 above the ledger', (random, id) => {
    const nov = period(random, id, 'NOV', { cash: [payment('NOV', 26, 'CHQ-T05-501', 204500, 'BP-T05-91')] });
    return {
      periods: [nov],
      sheet: [book(ledger([nov]) + 90000)],
      recipe: 'one outstanding cheque; the declared balance is 900.00 more than the ledger',
      intent: {
        status: 'difference', difference: -90000,
        items: [{ item: C(nov, 'BP-T05-91'), section: 'bookPaymentsNotOnStatement', origin: 'unmatched' }],
        signoffs: {},
      },
    };
  });

  add('T06', 'The ledger holds a payment the cashbook file lacks', (random, id) => {
    const nov = period(random, id, 'NOV', { count: 5 });
    return {
      periods: [nov],
      sheet: [book(ledger([nov]) - 75000, 'General ledger after a 750.00 accrual paid by cheque')],
      recipe: 'the books record a 750.00 payment that is in neither the cashbook file nor the statement',
      intent: { status: 'difference', difference: 75000, items: [], signoffs: {} },
    };
  });

  add('T07', 'An outstanding receipt and payment of the same amount are both listed', (random, id) => {
    const nov = period(random, id, 'NOV', {
      cash: [receipt('NOV', 30, 'DEP-T07-701', 50000, 'BR-T07-91'), payment('NOV', 30, 'CHQ-T07-702', 50000, 'BP-T07-92')],
    });
    return {
      periods: [nov],
      sheet: [book(ledger([nov]))],
      recipe: 'a 500.00 receipt and a 500.00 cheque, both at month end, both missing from the statement',
      intent: {
        status: 'reconciled', difference: 0,
        items: [
          { item: C(nov, 'BR-T07-91'), section: 'bookReceiptsNotOnStatement', origin: 'unmatched' },
          { item: C(nov, 'BP-T07-92'), section: 'bookPaymentsNotOnStatement', origin: 'unmatched' },
        ],
        signoffs: {},
      },
    };
  });

  add('T08', 'A difference equal to a listed cheque is still a difference', (random, id) => {
    const nov = period(random, id, 'NOV', { cash: [payment('NOV', 27, 'CHQ-T08-801', 230000, 'BP-T08-91')] });
    return {
      periods: [nov],
      sheet: [book(ledger([nov]) + 230000, 'General ledger before the cheque was posted')],
      recipe: 'an outstanding 2,300.00 cheque; the declared balance omits it, so the difference equals its amount',
      intent: {
        status: 'difference', difference: -230000,
        items: [{ item: C(nov, 'BP-T08-91'), section: 'bookPaymentsNotOnStatement', origin: 'unmatched' }],
        signoffs: {},
      },
    };
  });

  add('T09', 'One minor unit is a difference', (random, id) => {
    const nov = period(random, id, 'NOV', { count: 4 });
    return {
      periods: [nov],
      sheet: [book(ledger([nov]) - 1)],
      recipe: 'the declared balance is one halala below the ledger',
      intent: { status: 'difference', difference: 1, items: [], signoffs: {} },
    };
  });

  add('T10', 'An overdrawn account', (random, id) => {
    const nov = period(random, id, 'NOV', {
      count: 0,
      opening: -4520000,
      bank: [withdrawal('NOV', 6, 'PAY-T10-01', 1210000, 'Transfer out T10-01'), deposit('NOV', 18, 'RCV-T10-02', 905050, 'Transfer in T10-02')],
      cash: [
        payment('NOV', 5, 'PAY-T10-01', 1210000, 'BP-T10-01', 'Payment to supplier'),
        receipt('NOV', 17, 'RCV-T10-02', 905050, 'BR-T10-02', 'Receipt from customer'),
        payment('NOV', 28, 'CHQ-T10-901', 133300, 'BP-T10-91'),
      ],
    });
    if (closingOf(nov) >= 0 || ledger([nov]) >= 0) throw new Error('T10 must stay overdrawn');
    return {
      periods: [nov],
      sheet: [book(ledger([nov]), 'General ledger, credit balance')],
      recipe: 'the statement opens and closes in debit (DR); the books show a credit balance; one cheque outstanding',
      intent: {
        status: 'reconciled', difference: 0,
        items: [{ item: C(nov, 'BP-T10-91'), section: 'bookPaymentsNotOnStatement', origin: 'unmatched' }],
        signoffs: {},
      },
    };
  });

  // An amount suggestion: a deposit and a receipt with no reference, same
  // amount, within the window.
  const suggestion = (random, id, value) =>
    period(random, id, 'NOV', {
      bank: [deposit('NOV', 21, '', value, 'Cash deposit branch 12')],
      cash: [receipt('NOV', 20, '', value, `BR-${id}-91`, 'Counter sales banked')],
    });

  add('T11', 'An undecided suggestion makes a draft', (random, id) => {
    const nov = suggestion(random, id, 645000);
    return {
      periods: [nov],
      sheet: [book(ledger([nov]))],
      recipe: 'a 6,450.00 deposit and receipt without references; the suggestion is not decided',
      intent: {
        status: 'draft', difference: 0,
        items: [
          { item: C(nov, 'BR-T11-91'), section: 'bookReceiptsNotOnStatement', origin: 'pending', reason: 'amount-date-suggestion' },
          { item: S(nov, amount(nov, 645000)[0]), section: 'statementDepositsNotInBook', origin: 'pending', reason: 'amount-date-suggestion' },
        ],
        signoffs: {},
      },
    };
  });

  add('T12', 'Prepared before a rejection, reviewed after', (random, id) => {
    const nov = suggestion(random, id, 318800);
    const members = { statement: [S(nov, amount(nov, 318800)[0]).split(':')[1]], cashbook: ['BR-T12-91'], carried: [] };
    return {
      periods: [nov],
      sheet: [book(ledger([nov])), prepared, { decide: { type: 'reject', ...members } }, reviewed],
      recipe: 'as T11 for 3,188.00; prepared, then the accountant rejects the suggestion, then reviewed',
      intent: {
        status: 'reconciled', difference: 0,
        items: [
          { item: C(nov, 'BR-T12-91'), section: 'bookReceiptsNotOnStatement', origin: 'rejected', reason: 'amount-date-suggestion' },
          { item: S(nov, amount(nov, 318800)[0]), section: 'statementDepositsNotInBook', origin: 'rejected', reason: 'amount-date-suggestion' },
        ],
        signoffs: { prepared: 'void', reviewed: 'valid' },
      },
    };
  });

  add('T13', 'An accepted suggestion clears both members', (random, id) => {
    const nov = suggestion(random, id, 92500);
    const members = { statement: [S(nov, amount(nov, 92500)[0]).split(':')[1]], cashbook: ['BR-T13-91'], carried: [] };
    return {
      periods: [nov],
      sheet: [book(ledger([nov])), { decide: { type: 'accept', ...members } }],
      recipe: 'as T11 for 925.00; the accountant accepts the suggestion',
      intent: { status: 'reconciled', difference: 0, items: [], signoffs: {} },
    };
  });

  add('T14', 'A rejected amount difference leaves both sides listed', (random, id) => {
    const nov = period(random, id, 'NOV', {
      bank: [withdrawal('NOV', 15, 'CHQ-T14-140', 125000)],
      cash: [payment('NOV', 14, 'CHQ-T14-140', 120500, 'BP-T14-91')],
    });
    const members = { statement: [ref(nov, 'CHQ-T14-140')[0].split(':')[1]], cashbook: ['BP-T14-91'], carried: [] };
    return {
      periods: [nov],
      sheet: [book(ledger([nov])), { decide: { type: 'reject', ...members } }],
      recipe: 'CHQ-T14-140 paid 1,250.00 by the bank and booked as 1,205.00; the accountant rejects the pair',
      intent: {
        status: 'reconciled', difference: 0,
        items: [
          { item: C(nov, 'BP-T14-91'), section: 'bookPaymentsNotOnStatement', origin: 'rejected', reason: 'amount-difference' },
          { item: ref(nov, 'CHQ-T14-140')[0], section: 'statementWithdrawalsNotInBook', origin: 'rejected', reason: 'amount-difference' },
        ],
        signoffs: {},
      },
    };
  });

  // Two periods: an October cheque the November statement may present.
  const carried = (random, id, novRows = {}, octCash = []) => {
    const oct = period(random, id, 'OCT', { cash: octCash });
    const nov = period(random, id, 'NOV', { opening: closingOf(oct), ...novRows });
    return { oct, nov };
  };

  add('T15', 'A carried cheque cleared by an accepted case', (random, id) => {
    const { oct, nov } = carried(random, id, { bank: [withdrawal('NOV', 4, 'CHQ-T15-150', 482500)] },
      [payment('OCT', 29, 'CHQ-T15-150', 482500, 'BP-T15-91')]);
    return {
      periods: [oct, nov],
      previous: { holds: ['OCT'], decisions: [] },
      sheet: [book(ledger([oct, nov])), { decide: { type: 'accept', statement: [ref(nov, 'CHQ-T15-150')[0].split(':')[1]], cashbook: [], carried: [C(oct, 'BP-T15-91')] } }],
      recipe: 'October books CHQ-T15-150; November presents it; the accountant accepts the carried case',
      intent: { status: 'reconciled', difference: 0, items: [], signoffs: {} },
    };
  });

  add('T16', 'A carried cheque still outstanding, the sheet in Arabic', (random, id) => {
    const { oct, nov } = carried(random, id, {}, [payment('OCT', 30, 'CHQ-T16-160', 271000, 'BP-T16-91')]);
    return {
      language: 'ar',
      periods: [oct, nov],
      previous: { holds: ['OCT'], decisions: [] },
      sheet: [book(ledger([oct, nov]))],
      recipe: 'October books CHQ-T16-160; November does not present it; an English statement with an Arabic sheet',
      intent: {
        status: 'reconciled', difference: 0,
        items: [{ item: C(oct, 'BP-T16-91'), section: 'bookPaymentsNotOnStatement', origin: 'carried', age: 2 }],
        signoffs: {},
      },
    };
  });

  add('T17', 'An undecided carried case makes a draft', (random, id) => {
    const { oct, nov } = carried(random, id, { bank: [withdrawal('NOV', 3, 'CHQ-T17-170', 96000)] },
      [payment('OCT', 28, 'CHQ-T17-170', 96000, 'BP-T17-91')]);
    return {
      periods: [oct, nov],
      previous: { holds: ['OCT'], decisions: [] },
      sheet: [book(ledger([oct, nov]))],
      recipe: 'as T15 for 960.00, the carried case left undecided',
      intent: {
        status: 'draft', difference: 0,
        items: [
          { item: C(oct, 'BP-T17-91'), section: 'bookPaymentsNotOnStatement', origin: 'pending', reason: 'carried-reference', age: 2 },
          { item: ref(nov, 'CHQ-T17-170')[0], section: 'statementWithdrawalsNotInBook', origin: 'pending', reason: 'carried-reference' },
        ],
        signoffs: {},
      },
    };
  });

  add('T18', 'A carried cheque presented for another amount, rejected', (random, id) => {
    const { oct, nov } = carried(random, id, { bank: [withdrawal('NOV', 5, 'CHQ-T18-180', 341800)] },
      [payment('OCT', 29, 'CHQ-T18-180', 348100, 'BP-T18-91')]);
    return {
      periods: [oct, nov],
      previous: { holds: ['OCT'], decisions: [] },
      sheet: [book(ledger([oct, nov])), { decide: { type: 'reject', statement: [ref(nov, 'CHQ-T18-180')[0].split(':')[1]], cashbook: [], carried: [C(oct, 'BP-T18-91')] } }],
      recipe: 'October books CHQ-T18-180 as 3,481.00; November presents 3,418.00; the accountant rejects the case',
      intent: {
        status: 'reconciled', difference: 0,
        items: [
          { item: C(oct, 'BP-T18-91'), section: 'bookPaymentsNotOnStatement', origin: 'rejected', reason: 'carried-amount-difference', age: 2 },
          { item: ref(nov, 'CHQ-T18-180')[0], section: 'statementWithdrawalsNotInBook', origin: 'rejected', reason: 'carried-amount-difference' },
        ],
        signoffs: {},
      },
    };
  });

  add('T19', 'A carried cheque booked again in the next period and presented, rejected', (random, id) => {
    const { oct, nov } = carried(random, id, {
      bank: [withdrawal('NOV', 6, 'CHQ-T19-190', 157500)],
      cash: [payment('NOV', 2, 'CHQ-T19-190', 157500, 'BP-T19-92')],
    }, [payment('OCT', 30, 'CHQ-T19-190', 157500, 'BP-T19-91')]);
    return {
      periods: [oct, nov],
      previous: { holds: ['OCT'], decisions: [] },
      sheet: [book(ledger([oct, nov])), { decide: { type: 'reject', statement: [ref(nov, 'CHQ-T19-190')[0].split(':')[1]], cashbook: ['BP-T19-92'], carried: [C(oct, 'BP-T19-91')] } }],
      recipe: 'October books CHQ-T19-190; November books it again on 2 November and the bank presents it once; the restated case is rejected',
      intent: {
        status: 'reconciled', difference: 0,
        items: [
          { item: C(oct, 'BP-T19-91'), section: 'bookPaymentsNotOnStatement', origin: 'rejected', reason: 'carried-restated', age: 2 },
          { item: ref(nov, 'CHQ-T19-190')[0], section: 'statementWithdrawalsNotInBook', origin: 'rejected', reason: 'carried-restated' },
          { item: C(nov, 'BP-T19-92'), section: 'bookPaymentsNotOnStatement', origin: 'rejected', reason: 'carried-restated' },
        ],
        signoffs: {},
      },
    };
  });

  add('T20', 'A refused previous session gives no sheet', (random, id) => {
    const oct = period(random, id, 'OCT', { currency: 'USD', cash: [payment('OCT', 29, 'CHQ-T20-200', 64000, 'BP-T20-91')] });
    const nov = period(random, id, 'NOV', { opening: closingOf(oct), bank: [withdrawal('NOV', 3, 'CHQ-T20-200', 64000)] });
    return {
      periods: [oct, nov],
      previous: { holds: ['OCT'], decisions: [] },
      sheet: [book(ledger([oct, nov]))],
      recipe: 'the October session is in USD; the November statement is in SAR',
      intent: { refusal: 'SHEET_PREVIOUS_REFUSED', previous: 'ROLL_CURRENCY' },
    };
  });

  add('T21', 'A held statement gives no sheet', (random, id) => {
    const nov = period(random, id, 'NOV', { count: 5 });
    nov.balanceFaultAt = 2;
    return {
      periods: [nov],
      sheet: [book(ledger([nov]))],
      recipe: 'the third printed balance is 10.00 off the chain',
      intent: { refusal: 'SHEET_STATEMENT_HELD' },
    };
  });

  add('T22', 'No book balance gives no sheet', (random, id) => {
    const nov = period(random, id, 'NOV', { cash: [payment('NOV', 27, 'CHQ-T22-220', 41000, 'BP-T22-91')] });
    return {
      periods: [nov],
      sheet: [],
      recipe: 'one outstanding cheque; no book balance is declared',
      intent: { refusal: 'SHEET_NO_BOOK_BALANCE' },
    };
  });

  add('T23', 'An October cheque still outstanding in December, through a chain', (random, id) => {
    const oct = period(random, id, 'OCT', { cash: [payment('OCT', 30, 'CHQ-T23-230', 1110000, 'BP-T23-91')] });
    const nov = period(random, id, 'NOV', { opening: closingOf(oct) });
    const dec = period(random, id, 'DEC', { opening: closingOf(nov) });
    return {
      periods: [oct, nov, dec],
      previous: { holds: ['OCT', 'NOV'], decisions: [] },
      sheet: [book(ledger([oct, nov, dec])), prepared, reviewed],
      recipe: 'October books CHQ-T23-230; neither November nor December presents it; the November session carries October',
      intent: {
        status: 'reconciled', difference: 0,
        items: [{ item: C(oct, 'BP-T23-91'), section: 'bookPaymentsNotOnStatement', origin: 'carried', age: 3 }],
        signoffs: { prepared: 'valid', reviewed: 'valid' },
      },
    };
  });

  add('T24', 'A corrected book balance voids both sign-offs', (random, id) => {
    const nov = period(random, id, 'NOV', { bank: [withdrawal('NOV', 30, 'FEE-T24-1130', 5750, 'Transfer charge')] });
    return {
      periods: [nov],
      sheet: [book(ledger([nov]) + 100000), prepared, reviewed, book(ledger([nov]), 'General ledger after correcting a posting')],
      recipe: 'declared 1,000.00 high, prepared and reviewed, then corrected to the ledger',
      intent: {
        status: 'reconciled', difference: 0,
        items: [{ item: ref(nov, 'FEE-T24-1130')[0], section: 'statementWithdrawalsNotInBook', origin: 'unmatched' }],
        signoffs: { prepared: 'void', reviewed: 'void' },
      },
    };
  });
  return stories;
}

/** The facts: each period's printed statement and cashbook rows, what the
 * previous session holds, and what the accountant does on the sheet. */
export function facts(stories = buildStories()) {
  return {
    version: STORIES_VERSION,
    stories: stories.map((s) => ({
      id: s.id,
      title: s.title,
      layout: s.layout,
      language: s.language,
      periods: s.periods.map((p) => ({
        id: p.id,
        statement: printedStatement(p, s.id),
        cashbook: p.cash.map((r) => ({
          date: r.date, voucher: r.voucher, description: r.description, reference: r.reference, receipt: r.receipt, payment: r.payment,
        })),
      })),
      previous: s.previous,
      sheet: s.sheet,
      recipe: s.recipe,
      intent: s.intent,
    })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(facts(), null, 1)}\n`);
