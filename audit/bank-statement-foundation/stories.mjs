// BNK-PDF-1 foundation: synthetic bank statements and cashbooks as facts.
// Each story is one account, one currency (SAR, 2 decimals) and one period.
// Rows carry what a real statement or cashbook shows: dates, description,
// reference, withdrawal/deposit or receipt/payment. Amounts are minor units.
// `statement.pages` is what each printed page shows, line by line, including
// the lines that are not movements; render.mjs prints exactly these lines and
// verify_assets.py reads them back from the PDF. `recipe` is how the pages
// were made (and which fault was planted); `intent` is the designer's
// expected outcome, written by hand. The independent oracle (oracle.py) reads
// neither: it derives the outcome from the printed lines and the cashbook
// files and must agree with `intent`. Nothing here is read by the product.
//   node audit/bank-statement-foundation/stories.mjs > stories.json
export const STORIES_VERSION = 'bank-statement-foundation-1';
export const PERIOD = { start: '2026-07-01', end: '2026-07-31' };
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
const day = (d, m = 7) =>
  `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** `count` ordinary movements, each recorded on both sides under the same
 * explicit reference. Deterministic per story seed. */
function ordinary(random, count, prefix, firstDay = 2, lastDay = 28) {
  const bank = [],
    cash = [],
    auto = [];
  for (let i = 0; i < count; i++) {
    const d =
      firstDay +
      Math.floor(((lastDay - firstDay) * i) / Math.max(count - 1, 1));
    const outflow = random(0, 1) === 1;
    const amount = random(150, 95000) * 100 + random(0, 99);
    const ref = outflow
      ? `CHQ-${prefix}${String(100000 + i).slice(1)}`
      : `TRF-${prefix}${String(100000 + i).slice(1)}`;
    const k = `${prefix}${i + 1}`;
    bank.push({
      key: `b:${k}`,
      date: day(d),
      valueDate: day(d),
      description: outflow
        ? `Cheque paid ${ref.slice(4)}`
        : `Incoming transfer ${ref.slice(4)}`,
      reference: ref,
      withdrawal: outflow ? amount : 0,
      deposit: outflow ? 0 : amount,
    });
    cash.push({
      key: `c:${k}`,
      date: day(Math.max(d - random(0, 1), 1)),
      voucher: `${outflow ? 'PV' : 'RV'}-${prefix}${i + 1}`,
      description: outflow ? 'Supplier payment by cheque' : 'Customer receipt',
      reference: ref,
      receipt: outflow ? 0 : amount,
      payment: outflow ? amount : 0,
    });
    auto.push([`b:${k}`, `c:${k}`]);
  }
  return { bank, cash, auto };
}
const byDate = (rows) =>
  [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

function story(id, seed, title, build, extra = {}) {
  const random = rng(seed);
  const base = ordinary(random, extra.ordinary ?? 10, id.replace('BS', 'S'));
  const s = {
    id,
    title,
    layout: 'en',
    rowsPerPage: 9,
    opening: random(20000, 900000) * 100,
    bank: base.bank,
    cash: base.cash,
    intent: {
      statement: 'verified',
      auto: base.auto,
      review: [],
      bankOnly: [],
      cashOnly: [],
      timing: [],
    },
    ...extra,
  };
  build(s, random);
  s.bank = byDate(s.bank);
  s.cash = byDate(s.cash);
  delete s.ordinary;
  return s;
}

export function buildStories() {
  return [
    story(
      'BS01',
      101,
      'clean statement: every movement under an explicit shared reference',
      () => {},
    ),
    story(
      'BS02',
      102,
      'two transfers on one day for the same amount, told apart only by reference',
      (s) => {
        const amount = 1250000;
        for (const n of [1, 2]) {
          const ref = `TRF-S02X${n}`;
          s.bank.push({
            key: `b:x${n}`,
            date: day(14),
            valueDate: day(14),
            description: 'Incoming transfer',
            reference: ref,
            withdrawal: 0,
            deposit: amount,
          });
          s.cash.push({
            key: `c:x${n}`,
            date: day(14),
            voucher: `RV-X${n}`,
            description: 'Customer receipt',
            reference: ref,
            receipt: amount,
            payment: 0,
          });
        }
        // Listed in opposite orders on the two sides.
        s.cash.push(
          s.cash.splice(
            s.cash.findIndex((r) => r.key === 'c:x1'),
            1,
          )[0],
        );
        s.intent.auto.push(['b:x1', 'c:x1'], ['b:x2', 'c:x2']);
      },
    ),
    story(
      'BS03',
      103,
      'bank charge only on the statement; outstanding cheque and deposit in transit only in the cashbook',
      (s) => {
        s.bank.push({
          key: 'b:fee',
          date: day(30),
          valueDate: day(30),
          description: 'Account maintenance fee',
          reference: '',
          withdrawal: 2500,
          deposit: 0,
        });
        s.cash.push({
          key: 'c:chq',
          date: day(29),
          voucher: 'PV-OUT1',
          description: 'Supplier payment by cheque',
          reference: 'CHQ-S03OUT',
          receipt: 0,
          payment: 480000,
        });
        s.cash.push({
          key: 'c:dit',
          date: day(31),
          voucher: 'RV-DIT1',
          description: 'Cash deposited at branch',
          reference: 'DEP-S03DIT',
          receipt: 715000,
          payment: 0,
        });
        s.intent.bankOnly.push('b:fee');
        s.intent.cashOnly.push('c:chq', 'c:dit');
      },
    ),
    story(
      'BS04',
      104,
      'one movement with no reference on either side, unique amount and date',
      (s) => {
        s.bank.push({
          key: 'b:nr',
          date: day(17),
          valueDate: day(17),
          description: 'POS settlement',
          reference: '',
          withdrawal: 0,
          deposit: 334455,
        });
        s.cash.push({
          key: 'c:nr',
          date: day(17),
          voucher: 'RV-NR1',
          description: 'Card sales deposit',
          reference: '',
          receipt: 334455,
          payment: 0,
        });
        s.intent.review.push({
          bank: ['b:nr'],
          cash: ['c:nr'],
          reason: 'amount-date-suggestion',
        });
      },
    ),
    story('BS05', 105, 'same reference, amounts one halala apart', (s) => {
      s.bank.push({
        key: 'b:d',
        date: day(19),
        valueDate: day(19),
        description: 'Cheque paid S05D',
        reference: 'CHQ-S05D',
        withdrawal: 1000001,
        deposit: 0,
      });
      s.cash.push({
        key: 'c:d',
        date: day(19),
        voucher: 'PV-D1',
        description: 'Supplier payment by cheque',
        reference: 'CHQ-S05D',
        receipt: 0,
        payment: 1000000,
      });
      s.intent.review.push({
        bank: ['b:d'],
        cash: ['c:d'],
        reason: 'amount-difference',
      });
    }),
    story(
      'BS06',
      106,
      'same reference and amount, opposite directions',
      (s) => {
        s.bank.push({
          key: 'b:o',
          date: day(20),
          valueDate: day(20),
          description: 'Returned transfer S06O',
          reference: 'TRF-S06O',
          withdrawal: 0,
          deposit: 560000,
        });
        s.cash.push({
          key: 'c:o',
          date: day(20),
          voucher: 'PV-O1',
          description: 'Supplier transfer',
          reference: 'TRF-S06O',
          receipt: 0,
          payment: 560000,
        });
        s.intent.review.push({
          bank: ['b:o'],
          cash: ['c:o'],
          reason: 'direction-conflict',
        });
      },
    ),
    story(
      'BS07',
      107,
      'one reference twice on the statement for one cashbook entry',
      (s) => {
        for (const n of [1, 2])
          s.bank.push({
            key: `b:dup${n}`,
            date: day(21),
            valueDate: day(21),
            description: 'Cheque paid S07DUP',
            reference: 'CHQ-S07DUP',
            withdrawal: 210000,
            deposit: 0,
          });
        s.cash.push({
          key: 'c:dup',
          date: day(21),
          voucher: 'PV-DUP1',
          description: 'Supplier payment by cheque',
          reference: 'CHQ-S07DUP',
          receipt: 0,
          payment: 210000,
        });
        s.intent.review.push({
          bank: ['b:dup1', 'b:dup2'],
          cash: ['c:dup'],
          reason: 'duplicate-reference',
        });
      },
    ),
    story(
      'BS08',
      108,
      'descriptions wrapped over two lines and a movement continuing onto the next page',
      (s) => {
        for (const r of s.bank.slice(0, 4))
          r.description = `${r.description}\nRef. beneficiary account ending 4417`;
        s.wrapAcrossPage = true;
      },
      { ordinary: 14 },
    ),
    story(
      'BS09',
      109,
      'printed running balance off by 10.00 on one line of the last page',
      (s) => {
        s.balanceFaultAt = -3;
        s.intent.statement = 'balance-broken';
        s.intent.auto = [];
      },
      { ordinary: 14 },
    ),
    story(
      'BS10',
      110,
      'page 2 of 3 missing from the statement',
      (s) => {
        s.dropPage = 2;
        s.intent.statement = 'incomplete-pages';
        s.intent.auto = [];
      },
      { ordinary: 20 },
    ),
    story(
      'BS11',
      111,
      'Arabic statement, right-to-left table, Arabic-Indic digits',
      (s) => {
        s.layout = 'ar';
      },
    ),
    story(
      'BS12',
      112,
      'reference written differently on the two sides (100245 / CHQ-100245)',
      (s) => {
        s.bank.push({
          key: 'b:fmt',
          date: day(22),
          valueDate: day(22),
          description: 'Cheque paid 776611',
          reference: '776611',
          withdrawal: 98765,
          deposit: 0,
        });
        s.cash.push({
          key: 'c:fmt',
          date: day(22),
          voucher: 'PV-FMT1',
          description: 'Supplier payment by cheque',
          reference: 'CHQ-776611',
          receipt: 0,
          payment: 98765,
        });
        s.intent.review.push({
          bank: ['b:fmt'],
          cash: ['c:fmt'],
          reason: 'amount-date-suggestion',
        });
      },
    ),
    story(
      'BS13',
      113,
      'movement on the last day with value date in the next period',
      (s) => {
        s.bank.push({
          key: 'b:vd',
          date: day(31),
          valueDate: day(1, 8),
          description: 'Incoming transfer S13VD',
          reference: 'TRF-S13VD',
          withdrawal: 0,
          deposit: 225000,
        });
        s.cash.push({
          key: 'c:vd',
          date: day(31),
          voucher: 'RV-VD1',
          description: 'Customer receipt',
          reference: 'TRF-S13VD',
          receipt: 225000,
          payment: 0,
        });
        s.intent.auto.push(['b:vd', 'c:vd']);
        s.intent.timing.push('b:vd');
      },
    ),
    story(
      'BS14',
      114,
      'long statement: 70 pages of movements under explicit references, with page totals',
      () => {},
      { ordinary: 1680, rowsPerPage: 24, pageTotals: true },
    ),
    story(
      'BS15',
      115,
      'very long statement: 100 pages of movements under explicit references, with page totals',
      () => {},
      { ordinary: 2400, rowsPerPage: 24, pageTotals: true },
    ),
    story(
      'BS16',
      116,
      'Arabic statement, right-to-left table, Latin digits',
      (s) => {
        s.layout = 'ar';
        s.digits = 'latin';
      },
    ),
  ];
}

/** The printed statement: pages of lines as they appear, faults applied as
 * the recipe asks. Balances are running balances in minor units. */
export function printedStatement(s) {
  let balance = s.opening;
  const rows = s.bank.map((r) => {
    balance += r.deposit - r.withdrawal;
    return { ...r, balance };
  });
  const printed = rows.map((r) => ({ ...r }));
  if (s.balanceFaultAt !== undefined)
    printed[rows.length + s.balanceFaultAt].balance += 1000;
  const chunks = [];
  for (let i = 0; i < rows.length; i += s.rowsPerPage)
    chunks.push([i, Math.min(i + s.rowsPerPage, rows.length)]);
  const total = chunks.length;
  const pages = chunks.map(([from, to], p) => {
    const number = p + 1;
    const lines = [
      number === 1
        ? { kind: 'opening', balance: s.opening }
        : { kind: 'brought-forward', balance: rows[from - 1].balance },
    ];
    // A movement whose description continues at the top of the next page.
    if (s.wrapAcrossPage && number === 2) {
      const r = rows[from - 1];
      lines.push({
        kind: 'continuation',
        text: `${r.description.split('\n')[0]} (continued) Ref. beneficiary account ending 4417`,
      });
    }
    for (const r of printed.slice(from, to))
      lines.push({
        kind: 'movement',
        key: r.key,
        date: r.date,
        valueDate: r.valueDate,
        description: r.description,
        reference: r.reference,
        withdrawal: r.withdrawal,
        deposit: r.deposit,
        balance: r.balance,
      });
    if (s.pageTotals) {
      const own = rows.slice(from, to);
      lines.push({
        kind: 'page-totals',
        withdrawal: own.reduce((t, r) => t + r.withdrawal, 0),
        deposit: own.reduce((t, r) => t + r.deposit, 0),
      });
    }
    if (number < total)
      lines.push({ kind: 'carried-forward', balance: rows[to - 1].balance });
    else {
      lines.push({ kind: 'closing', balance: rows[rows.length - 1].balance });
      lines.push({
        kind: 'totals',
        withdrawal: rows.reduce((t, r) => t + r.withdrawal, 0),
        deposit: rows.reduce((t, r) => t + r.deposit, 0),
      });
    }
    return { number, of: total, lines };
  });
  return {
    account: `SA00 0000 0000 00${s.id.slice(2)}4417`,
    currency: 'SAR',
    period: PERIOD,
    pages: s.dropPage ? pages.filter((p) => p.number !== s.dropPage) : pages,
  };
}

/** The facts file: one story per entry, one printed line or cashbook row per
 * text line, so the frozen copy stays readable and diffs stay small. */
export function factsJson(stories = buildStories()) {
  const line = (v) => JSON.stringify(v);
  const block = (items, indent) =>
    `[\n${items.map((v) => `${indent}${line(v)}`).join(',\n')}\n${indent.slice(1)}]`;
  const story = (s) => {
    const {
      bank,
      cash,
      intent,
      opening,
      rowsPerPage,
      balanceFaultAt,
      dropPage,
      wrapAcrossPage,
      pageTotals,
      ...head
    } = s;
    void bank;
    const recipe = {
      opening,
      rowsPerPage,
      ...(balanceFaultAt !== undefined && { balanceFaultAt }),
      ...(dropPage && { dropPage }),
      ...(wrapAcrossPage && { wrapAcrossPage }),
      ...(pageTotals && { pageTotals }),
    };
    const st = printedStatement(s);
    const pages = st.pages
      .map(
        (p) =>
          `   {"number":${p.number},"of":${p.of},"lines":${block(p.lines, '    ')}}`,
      )
      .join(',\n');
    return `  {${Object.entries(head)
      .map(([k, v]) => `${line(k)}:${line(v)}`)
      .join(
        ',',
      )},\n   "recipe":${line(recipe)},\n   "intent":${line(intent)},\n   "statement":{"account":${line(st.account)},"currency":"SAR","period":${line(st.period)},"pages":[\n${pages}\n   ]},\n   "cashbook":${block(cash, '    ')}}`;
  };
  return `{"version":${line(STORIES_VERSION)},"period":${line(PERIOD)},"dateWindowDays":${DATE_WINDOW_DAYS},"currency":"SAR","decimals":2,"stories":[\n${stories.map(story).join(',\n')}\n]}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`)
  process.stdout.write(factsJson());
