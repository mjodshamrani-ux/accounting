// EXPERIMENT ONLY — see ./gl-tb-tieout.ts. Run it directly:
//   node --experimental-strip-types --test tests/experiments/*.test.ts
// Synthetic sources, small enough to check by hand. SAR, two places: 300.00
// is 30000 minor units.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../../lib/reconciliation/io.ts';
import { normalizeSource, parseMoney } from '../../lib/reconciliation/core.ts';
import { prepareVerifiedSources } from '../../lib/reconciliation/source-preparation.ts';
import { suggestFormats } from '../../lib/reconciliation/format-inference.ts';
import {
  assertInputFormats,
  formatChoice,
} from '../../lib/reconciliation/input-readiness.ts';
import { defaultMapping } from '../../lib/reconciliation/types.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../../lib/reconciliation/types.ts';
import {
  TB_FIELDS,
  readGeneralLedger,
  readTrialBalance,
  tieOut,
  type TieOutStatus,
  type TrialBalanceLayout,
} from './gl-tb-tieout.ts';

const scope: Scope = {
  supplier: '',
  entity: 'Synthetic Entity',
  account: '',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-09-30',
  dateWindow: 0,
  confirmed: true,
  coverageConfirmed: false,
};
const PERIOD = { start: '2026-09-01', end: '2026-09-30' };
const meta = ({
  title,
  entity = 'Synthetic Entity',
  period = '2026-09-01 to 2026-09-30',
  currency = 'SAR',
}: {
  title: string;
  entity?: string;
  period?: string;
  currency?: string;
}) => [
  [title],
  ...(entity ? [['Entity', entity]] : []),
  ['Period', period],
  ['Currency', currency],
  [],
];
const csv = (rows: string[][]) =>
  new TextEncoder().encode(
    rows.map((r) => r.map((c) => '"' + c + '"').join(',')).join('\n'),
  ).buffer as ArrayBuffer;

// GL detail: one posting per row, debit or credit.
const GL_HEADER = [
  'Account',
  'Posting Date',
  'Journal',
  'Description',
  'Debit',
  'Credit',
  'Currency',
];
const gl = (
  account: string,
  debit: string,
  credit = '',
  date = '2026-09-10',
  currency = 'SAR',
) => [
  account,
  date,
  `JV-${account}-${debit || credit}`,
  'Synthetic posting',
  debit,
  credit,
  currency,
];
const glMapping = (header: number): Mapping => ({
  ...defaultMapping(),
  header,
  date: 1,
  reference: 2,
  description: 3,
  debit: 4,
  credit: 5,
  currencyColumn: 6,
  mode: 'split',
  periodStart: PERIOD.start,
});
// TB: one row per account.
const TB_HEADER = [
  'Account',
  'Account Name',
  'Beginning Debit',
  'Beginning Credit',
  'Period Debit',
  'Period Credit',
  'Ending Debit',
  'Ending Credit',
];
const tb = (account: string, ...amounts: string[]) => [
  account,
  `Account ${account}`,
  ...amounts,
];
const tbLayout = (header: number): TrialBalanceLayout => ({
  header,
  account: 0,
  columns: {
    beginningDebit: 2,
    beginningCredit: 3,
    periodDebit: 4,
    periodCredit: 5,
    endingDebit: 6,
    endingCredit: 7,
  },
});

type Run = {
  glRows: string[][];
  tbRows: string[][];
  accounts: string[];
  glMeta?: Parameters<typeof meta>[0];
  tbMeta?: Parameters<typeof meta>[0];
};
async function run({ glRows, tbRows, accounts, glMeta, tbMeta }: Run) {
  const glTop = meta(glMeta ?? { title: 'General Ledger Detail' });
  const tbTop = meta(tbMeta ?? { title: 'Trial Balance' });
  const glFile = await readFile(
    'gl.csv',
    csv([...glTop, GL_HEADER, ...glRows]),
  );
  const tbFile = await readFile(
    'tb.csv',
    csv([...tbTop, TB_HEADER, ...tbRows]),
  );
  const before = JSON.stringify([glFile.sheets, tbFile.sheets]);
  const G = readGeneralLedger(glFile, glMapping(glTop.length), 0, scope);
  const T = readTrialBalance(tbFile, tbLayout(tbTop.length), scope);
  const out = tieOut(G, T, { accounts, currency: 'SAR', period: PERIOD });
  assertInvariants(glFile, tbFile, G, T, out, glTop.length);
  // 10. The original sources are never changed.
  assert.equal(JSON.stringify([glFile.sheets, tbFile.sheets]), before);
  return {
    G,
    T,
    out,
    byAccount: new Map(out.results.map((r) => [r.account, r])),
  };
}

function assertInvariants(
  glFile: SourceFile,
  tbFile: SourceFile,
  G: ReturnType<typeof readGeneralLedger>,
  T: ReturnType<typeof readTrialBalance>,
  out: ReturnType<typeof tieOut>,
  glHeader: number,
) {
  const accounts = out.results.map((r) => r.account);
  // 4, 5. No account disappears: every TB account and every GL account has
  // exactly one result, with or without transactions.
  assert.equal(new Set(accounts).size, accounts.length);
  assert.deepEqual(
    [...accounts].sort(),
    [
      ...new Set([...T.rows.map((r) => r.account), ...G.accounts.keys()]),
    ].sort(),
  );
  const sheet = glFile.sheets[0];
  const used = new Map<number, string>();
  for (const [account, g] of G.accounts) {
    // 8. No GL row counts for two accounts, or for an account it is not in.
    for (const row of [...g.debitRows, ...g.creditRows]) {
      assert.ok(
        !used.has(row),
        `row ${row} used by ${used.get(row)} and ${account}`,
      );
      used.set(row, account);
      assert.equal(sheet.rows[row - 1][0], account);
    }
    // 6, 7. The declared totals are the sums of the traced source cells.
    const cells = (rows: number[], column: number) =>
      rows.reduce(
        (total, row) =>
          total + parseMoney(sheet.rows[row - 1][column], 'dot', 2),
        0,
      );
    assert.equal(cells(g.debitRows, 4), g.debit, `${account} debit`);
    assert.equal(cells(g.creditRows, 5), g.credit, `${account} credit`);
    // Every row of the account is counted, excluded with a reason, or in error.
    if (g.source) {
      const own = sheet.rows
        .map((cells, i) => ({ cells, rn: i + 1 }))
        .filter(
          ({ cells, rn }) => rn > glHeader + 1 && cells[0]?.trim() === account,
        )
        .map(({ rn }) => rn);
      const seen = new Set([
        ...g.source.transactions.map((t) => t.row),
        ...g.source.excluded
          .filter((x) => !/^Account /.test(x.reason))
          .map((x) => x.row),
        ...g.source.errors.map((e) => e.row),
      ]);
      for (const row of own)
        assert.ok(seen.has(row), `${account} row ${row} lost`);
    }
  }
  // 7, 9. Every TB number comes from its cell; one account per TB row.
  const tbSheet = tbFile.sheets[0];
  assert.equal(new Set(T.rows.map((r) => r.row)).size, T.rows.length);
  for (const r of T.rows)
    for (const field of TB_FIELDS) {
      const trace = r.trace[field];
      assert.equal(tbSheet.rows[trace.row - 1][trace.column - 1], trace.text);
      assert.equal(
        trace.text ? parseMoney(trace.text, 'dot', 2) : 0,
        r.amounts[field],
      );
    }
  for (const r of out.results) {
    // 1. Nothing is compared outside the scope.
    if (r.status === 'scope-error')
      assert.deepEqual(
        [r.debitVariance, r.creditVariance, r.netVariance],
        [null, null, null],
      );
    // 2. A TB that does not roll forward is never reported as matching.
    if (r.status === 'tb-inconsistent') assert.equal(r.debitVariance, null);
    // 3. Tied means debit, credit and net all agree, not the net alone.
    if (r.status === 'tied')
      assert.deepEqual(
        [
          r.debitVariance,
          r.creditVariance,
          r.netVariance,
          r.rollforwardVariance,
        ],
        [0, 0, 0, 0],
      );
  }
}
const status = (out: ReturnType<typeof tieOut>) =>
  out.results.map((r): [string, TieOutStatus, string[]] => [
    r.account,
    r.status,
    r.findings,
  ]);

// ---------------------------------------------------------------- A–I

test('A: GL activity ties to the TB in debits, credits and net', async () => {
  const { out, byAccount } = await run({
    glRows: [
      gl('1100', '200.00'),
      gl('1100', '100.00'),
      gl('1100', '', '100.00'),
    ],
    tbRows: [
      tb('1100', '1000.00', '0.00', '300.00', '100.00', '1200.00', '0.00'),
    ],
    accounts: ['1100'],
  });
  assert.deepEqual(status(out), [['1100', 'tied', []]]);
  const r = byAccount.get('1100')!;
  assert.deepEqual(r.gl, {
    debit: 30000,
    credit: 10000,
    net: 20000,
    debitRows: [7, 8],
    creditRows: [9],
  });
  assert.deepEqual(
    [r.tb!.beginningNet, r.tb!.net, r.tb!.endingNet],
    [100000, 20000, 120000],
  );
  assert.deepEqual(out.unverified, ['ledger', 'posting status']);
});

test('B: an equal net with different debits and credits is a mismatch', async () => {
  const { out, byAccount } = await run({
    glRows: [gl('1100', '150.00'), gl('1100', '', '50.00')],
    tbRows: [tb('1100', '0.00', '0.00', '100.00', '0.00', '100.00', '0.00')],
    accounts: ['1100'],
  });
  const r = byAccount.get('1100')!;
  assert.equal(r.gl!.net, r.tb!.net, 'a net-only check would pass');
  assert.deepEqual(status(out), [
    ['1100', 'mismatch', ['DEBIT_VARIANCE', 'CREDIT_VARIANCE']],
  ]);
  assert.deepEqual(
    [r.debitVariance, r.creditVariance, r.netVariance],
    [5000, 5000, 0],
  );
});

test('C: a TB that does not roll forward is diagnosed before GL is compared', async () => {
  const { out, byAccount } = await run({
    glRows: [gl('1100', '300.00'), gl('1100', '', '100.00')],
    tbRows: [
      tb('1100', '1000.00', '0.00', '300.00', '100.00', '1300.00', '0.00'),
    ],
    accounts: ['1100'],
  });
  const r = byAccount.get('1100')!;
  assert.equal(r.status, 'tb-inconsistent');
  assert.equal(r.rollforwardVariance, 10000);
  // The GL activity itself matches the TB period columns; that is not a tie.
  assert.deepEqual([r.gl!.debit, r.gl!.credit], [r.tb!.debit, r.tb!.credit]);
  assert.equal(status(out)[0][1], 'tb-inconsistent');
});

test('D: each component of a GL difference is named on its own', async () => {
  const { out, byAccount } = await run({
    glRows: [gl('1100', '300.00'), gl('1100', '', '150.00')],
    tbRows: [
      tb('1100', '1000.00', '0.00', '300.00', '100.00', '1200.00', '0.00'),
    ],
    accounts: ['1100'],
  });
  const r = byAccount.get('1100')!;
  assert.deepEqual(status(out), [
    ['1100', 'mismatch', ['CREDIT_VARIANCE', 'NET_VARIANCE']],
  ]);
  assert.deepEqual(
    [r.rollforwardVariance, r.debitVariance, r.creditVariance, r.netVariance],
    [0, 0, 5000, -5000],
  );
});

test('E: an account with a balance and no activity is a result, not a missing transaction', async () => {
  const { out, byAccount, G } = await run({
    glRows: [gl('1100', '300.00'), gl('1100', '', '100.00')],
    tbRows: [
      tb('1100', '1000.00', '0.00', '300.00', '100.00', '1200.00', '0.00'),
      tb('1300', '0.00', '500.00', '0.00', '0.00', '0.00', '500.00'),
    ],
    accounts: ['1100', '1300'],
  });
  assert.equal(G.accounts.has('1300'), false, 'no GL row, no reading');
  assert.deepEqual(status(out), [
    ['1100', 'tied', []],
    ['1300', 'tied', []],
  ]);
  assert.deepEqual(
    [
      byAccount.get('1300')!.tb!.beginningNet,
      byAccount.get('1300')!.tb!.endingNet,
    ],
    [-50000, -50000],
  );
});

test('F: GL activity with no TB row stays visible', async () => {
  const { out, byAccount } = await run({
    glRows: [
      gl('1100', '300.00'),
      gl('1100', '', '100.00'),
      gl('1400', '75.00'),
    ],
    tbRows: [
      tb('1100', '1000.00', '0.00', '300.00', '100.00', '1200.00', '0.00'),
    ],
    accounts: ['1100', '1400'],
  });
  assert.deepEqual(status(out), [
    ['1100', 'tied', []],
    ['1400', 'mismatch', ['NOT_IN_TRIAL_BALANCE']],
  ]);
  assert.deepEqual(byAccount.get('1400')!.gl!.debitRows, [9]);
});

test('G: TB activity with no GL detail is a difference', async () => {
  const { out, byAccount } = await run({
    glRows: [gl('1100', '300.00'), gl('1100', '', '100.00')],
    tbRows: [
      tb('1100', '1000.00', '0.00', '300.00', '100.00', '1200.00', '0.00'),
      tb('1500', '0.00', '0.00', '200.00', '0.00', '200.00', '0.00'),
    ],
    accounts: ['1100', '1500'],
  });
  assert.deepEqual(status(out)[1], [
    '1500',
    'mismatch',
    ['NO_GL_DETAIL', 'DEBIT_VARIANCE', 'NET_VARIANCE'],
  ]);
  assert.equal(byAccount.get('1500')!.debitVariance, -20000);
});

test('H: currency, period, account and entity are checked before any number', async () => {
  const same = {
    glRows: [gl('1100', '300.00'), gl('1100', '', '100.00')],
    tbRows: [
      tb('1100', '1000.00', '0.00', '300.00', '100.00', '1200.00', '0.00'),
    ],
    accounts: ['1100'],
  };
  // A TB in another currency: scope error, no variance computed.
  const usd = await run({
    ...same,
    tbMeta: { title: 'Trial Balance', currency: 'USD' },
  });
  assert.deepEqual(status(usd.out), [
    ['1100', 'scope-error', ['TB currency USD is not SAR']],
  ]);
  // A GL posting in another currency: the reader marks the row; nothing is compared.
  const usdRow = await run({
    ...same,
    glRows: [...same.glRows, gl('1100', '10.00', '', '2026-09-11', 'USD')],
  });
  assert.equal(usdRow.byAccount.get('1100')!.status, 'unsupported');
  assert.match(
    usdRow.byAccount.get('1100')!.findings[0],
    /عملة الصف لا تطابق العملة المؤكدة/,
  );
  // A TB for another period.
  const august = await run({
    ...same,
    tbMeta: { title: 'Trial Balance', period: '2026-08-01 to 2026-08-31' },
  });
  assert.deepEqual(status(august.out), [
    ['1100', 'scope-error', ['TB period differs from the expected period']],
  ]);
  // A posting dated after the cutoff is excluded with its reason, not counted.
  const late = await run({
    ...same,
    glRows: [...same.glRows, gl('1100', '40.00', '', '2026-10-01')],
  });
  assert.deepEqual(status(late.out), [['1100', 'tied', []]]);
  assert.deepEqual(
    late.G.accounts
      .get('1100')!
      .source!.excluded.filter((x) => x.row === 9)
      .map((x) => x.reason),
    ['بعد تاريخ المقارنة'],
  );
  // Equal numbers under different accounts never tie.
  const otherInput = {
    glRows: [gl('1200', '300.00'), gl('1200', '', '100.00')],
    tbRows: same.tbRows,
    accounts: ['1100', '1200'],
  };
  const other = await run(otherInput);
  assert.deepEqual(status(other.out), [
    [
      '1100',
      'mismatch',
      ['NO_GL_DETAIL', 'DEBIT_VARIANCE', 'CREDIT_VARIANCE', 'NET_VARIANCE'],
    ],
    ['1200', 'mismatch', ['NOT_IN_TRIAL_BALANCE']],
  ]);
  // An account outside the expected set is a scope error.
  const outside = await run({ ...otherInput, accounts: ['1100'] });
  assert.equal(outside.byAccount.get('1200')!.status, 'scope-error');
  // Different entities; and no entity line leaves the entity unverified.
  const entity = await run({
    ...same,
    tbMeta: { title: 'Trial Balance', entity: 'Other Entity' },
  });
  assert.deepEqual(status(entity.out), [
    ['1100', 'scope-error', ['GL and TB entities differ']],
  ]);
  const noEntity = await run({
    ...same,
    tbMeta: { title: 'Trial Balance', entity: '' },
  });
  assert.deepEqual(noEntity.out.unverified, [
    'ledger',
    'posting status',
    'entity',
  ]);
  assert.equal(noEntity.byAccount.get('1100')!.status, 'tied');
});

test('I: two accounts need two reader runs', async () => {
  const glRows = [
    gl('1100', '300.00'),
    gl('1100', '', '100.00'),
    gl('1200', '', '80.00'),
  ];
  const { out } = await run({
    glRows,
    tbRows: [
      tb('1100', '1000.00', '0.00', '300.00', '100.00', '1200.00', '0.00'),
      tb('1200', '0.00', '20.00', '0.00', '80.00', '0.00', '100.00'),
    ],
    accounts: ['1100', '1200'],
  });
  assert.deepEqual(status(out), [
    ['1100', 'tied', []],
    ['1200', 'tied', []],
  ]);
  // One run over both accounts: the reader refuses a source with two accounts.
  const top = meta({ title: 'General Ledger Detail' });
  const file = await readFile('gl.csv', csv([...top, GL_HEADER, ...glRows]));
  for (const account of ['', '1100']) {
    const {
      sources: [source],
    } = prepareVerifiedSources(
      [file],
      [glMapping(top.length)],
      { ...scope, account },
      ['ledger'],
    );
    assert.ok(
      source.errors.some((e) => e.row === 0 && /رقم الحساب/.test(e.message)),
      account,
    );
  }
});

// ------------------------------------------------ what the model holds

test('GL: gross debits and credits survive normalisation through the sign', async () => {
  const top = meta({ title: 'General Ledger Detail' });
  const file = await readFile(
    'gl.csv',
    csv([...top, GL_HEADER, gl('1100', '150.00'), gl('1100', '', '50.00')]),
  );
  const {
    sources: [source],
  } = prepareVerifiedSources(
    [file],
    [glMapping(top.length)],
    { ...scope, account: '1100' },
    ['ledger'],
  );
  // Transaction keeps one signed amount per row, and the original cells.
  assert.deepEqual(
    source.transactions.map((t) => [t.amount, t.originalAmount]),
    [
      [15000, '150.00 | '],
      [-5000, ' | 50.00'],
    ],
  );
  // That is enough only because the reader refuses a row with both a debit and
  // a credit, and a negative value in either column: such a row is an error,
  // never silently netted.
  const mixed = await readFile(
    'gl.csv',
    csv([
      ...top,
      GL_HEADER,
      gl('1100', '150.00', '50.00'),
      gl('1100', '-20.00'),
    ]),
  );
  const {
    sources: [refused],
  } = prepareVerifiedSources(
    [mixed],
    [glMapping(top.length)],
    { ...scope, account: '1100' },
    ['ledger'],
  );
  assert.deepEqual(refused.transactions, []);
  assert.deepEqual(
    refused.errors.map((e) => e.row),
    [7, 8],
  );
  // Transaction carries no account: the account is only checked as one scope
  // value per source, so grouping by account reads the source row.
  for (const t of source.transactions)
    assert.ok(!Object.values(t).includes('1100'));
});

test('TB: a Trial Balance row is not a transaction', async () => {
  const top = meta({ title: 'Trial Balance' });
  const rows = [
    tb('1100', '1000.00', '0.00', '300.00', '100.00', '1200.00', '0.00'),
  ];
  const file = await readFile('tb.csv', csv([...top, TB_HEADER, ...rows]));
  const asActivity: Mapping = {
    ...defaultMapping(),
    header: top.length,
    mode: 'split',
    debit: 4,
    credit: 5,
  };
  // It has no date, and the reader requires one.
  assert.throws(
    () =>
      normalizeSource(
        file,
        asActivity,
        { ...scope, account: '1100' },
        'ledger',
      ),
    /حدد أعمدة التاريخ/,
  );
  // With a date column added, a period with both debits and credits (300 and
  // 100) is refused as a row that holds both.
  const dated = await readFile(
    'tb.csv',
    csv([...top, ['As Of', ...TB_HEADER], ['2026-09-30', ...rows[0]]]),
  );
  const source = normalizeSource(
    dated,
    { ...asActivity, date: 0, debit: 5, credit: 6 },
    { ...scope, account: '1100' },
    'ledger',
  );
  assert.deepEqual(source.transactions, []);
  assert.match(
    source.errors[0].message,
    /مبلغًا غير صفري في كل من المدين والدائن/,
  );
  // And beginning and ending balances have no place in a transaction; the
  // prototype's reader keeps all six with their cells.
  const T = readTrialBalance(file, tbLayout(top.length), scope);
  assert.deepEqual(T.rows[0].amounts, {
    beginningDebit: 100000,
    beginningCredit: 0,
    periodDebit: 30000,
    periodCredit: 10000,
    endingDebit: 120000,
    endingCredit: 0,
  });
  assert.deepEqual(
    [T.period, T.currency, T.entity],
    [PERIOD, 'SAR', 'Synthetic Entity'],
  );
});

test('TB: one row per account; a repeated account is an error, not a merge', async () => {
  const top = meta({ title: 'Trial Balance' });
  const file = await readFile(
    'tb.csv',
    csv([
      ...top,
      TB_HEADER,
      tb('1100', '1000.00', '0.00', '300.00', '100.00', '1200.00', '0.00'),
      tb('1100', '0.00', '0.00', '5.00', '0.00', '5.00', '0.00'),
    ]),
  );
  const T = readTrialBalance(file, tbLayout(top.length), scope);
  assert.deepEqual(
    T.rows.map((r) => r.row),
    [7],
  );
  assert.deepEqual(T.errors, [
    { row: 8, message: 'account 1100 appears twice' },
  ]);
});

test('TB: the amount format guard is reused one column pair at a time', async () => {
  const kwd = { ...scope, currency: 'KWD', decimals: 3 };
  const top = meta({ title: 'Trial Balance', currency: 'KWD' });
  const file = await readFile(
    'tb.csv',
    csv([
      ...top,
      TB_HEADER,
      tb('1100', '1.000', '0', '0.300', '0.100', '1.200', '0'),
    ]),
  );
  // 1.000 reads as one dinar or as a thousand: the guard refuses to guess.
  assert.throws(
    () => readTrialBalance(file, tbLayout(top.length), kwd),
    /صيغة المبالغ/,
  );
});

test('TB: the format guard reads every row as a movement, so blank balances are refused', async () => {
  // Trial Balances often leave a zero blank. The production guard, built for
  // transactions, refuses a row with neither a debit nor a credit, in split
  // and in signed readings alike. It can guard a TB only when every cell
  // is written out.
  const top = meta({ title: 'Trial Balance' });
  const file = await readFile(
    'tb.csv',
    csv([
      ...top,
      TB_HEADER,
      tb('1100', '1000.00', '0.00', '300.00', '100.00', '1200.00', '0.00'),
      tb('1300', '0.00', '500.00', '', '', '0.00', '500.00'),
    ]),
  );
  assert.throws(
    () => readTrialBalance(file, tbLayout(top.length), scope),
    /المدين والدائن فارغان في الصف 8/,
  );
});

test('I: a format answer for the whole GL does not carry into per-account runs', async () => {
  // 1.250 reads as one dinar and a quarter or as 1,250. The accountant answers
  // once for the file; the per-account runs exclude the other account's rows,
  // and a format answer is bound to the rows it was given for.
  const kwd = { ...scope, currency: 'KWD', decimals: 3 };
  const top = meta({ title: 'General Ledger Detail', currency: 'KWD' });
  const rows = [
    gl('1100', '1.250', '', '2026-09-10', 'KWD'),
    gl('1200', '', '2.500', '2026-09-11', 'KWD'),
  ];
  const file = await readFile('gl.csv', csv([...top, GL_HEADER, ...rows]));
  const whole = glMapping(top.length);
  const { candidates } = suggestFormats(file, whole, 3).numberFormat;
  const answered: Mapping = {
    ...whole,
    formatChoice: {
      numberFormat: formatChoice(
        file,
        whole,
        'numberFormat',
        'dot',
        candidates,
        3,
      ),
    },
  };
  assertInputFormats([file], [answered], kwd);
  const G = readGeneralLedger(file, answered, 0, kwd);
  for (const account of ['1100', '1200'])
    assert.match(
      G.accounts.get(account)!.failure!,
      /صيغة المبالغ تحتمل أكثر من قراءة/,
      account,
    );
});
