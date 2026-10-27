import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import {
  CashbookReadError,
  matchBankStatement,
  readBankCashbookTable,
  STATEMENT_DATE_WINDOW_DAYS,
  type CashbookEntry,
} from '../lib/reconciliation/bank-statement-match.ts';
import {
  readBankStatementPdf,
  readBankStatementTable,
  type BankStatementReading,
} from '../lib/reconciliation/bank-statement-native.ts';
import { readNativePdfWordSource } from '../lib/reconciliation/pdf.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

// bank-statement-native-1 matching. The proof against the oracle on all
// sixteen frozen statements is scripts/bank-statement-g2-proof, and the
// 10,000-case comparison with the oracle's matcher is
// scripts/bank-statement-g2-differential; here each rule is held directly.

const frozen = (name: string) =>
  fsRead(
    new URL(
      `../audit/bank-statement-foundation/frozen/${name}`,
      import.meta.url,
    ),
  );
const csv = async (name: string, text?: string) =>
  readFile(
    name,
    text === undefined
      ? Uint8Array.from(await frozen(name)).buffer
      : new TextEncoder().encode(text).buffer,
  );
const pdf = async (id: string) =>
  readBankStatementPdf(
    await readNativePdfWordSource(
      Uint8Array.from(await frozen(`${id}-statement.pdf`)).buffer,
    ),
  );
const cashbookOf = async (id: string) =>
  readBankCashbookTable(await csv(`${id}-cashbook.csv`), 'SAR');

type Row = [
  date: string,
  reference: string,
  signed: number,
  valueDate?: string,
];
/** A proved statement holding these movements (positive = deposit). */
function statement(rows: Row[]): BankStatementReading {
  return {
    family: 'bank-statement-native-1',
    format: 'pdf',
    layout: 'en',
    sha256: '',
    currency: 'SAR',
    decimals: 2,
    period: { start: '2026-07-01', end: '2026-07-31' },
    heading: '',
    pages: [{ page: 1, number: 1, of: 1 }],
    lines: rows.map(([date, reference, signed, valueDate], i) => ({
      kind: 'movement',
      page: 1,
      items: [i + 1],
      date,
      valueDate: valueDate ?? date,
      description: '',
      reference,
      withdrawal: signed < 0 ? -signed : 0,
      deposit: signed > 0 ? signed : 0,
      balance: 0,
    })),
    status: 'verified',
    opening: 0,
    closing: 0,
    withdrawals: 0,
    deposits: 0,
  };
}
/** Cashbook entries (positive = receipt). */
const entries = (rows: [date: string, reference: string, signed: number][]) =>
  rows.map(
    ([date, reference, signed], i): CashbookEntry => ({
      id: `V${i + 1}`,
      row: i + 2,
      date,
      description: '',
      reference,
      direction: signed > 0 ? 'in' : 'out',
      amount: Math.abs(signed),
    }),
  );
const outcome = (r: ReturnType<typeof matchBankStatement>) => ({
  auto: r.auto.map((a) => `${a.statement}=${a.cashbook}`),
  review: r.review.map(
    (g) => `${g.statement.join(',')}/${g.cashbook.join(',')}/${g.reason}`,
  ),
  statementOnly: r.statementOnly,
  cashbookOnly: r.cashbookOnly,
  timing: r.timing,
});

void test('the date window is the contract window', async () => {
  const contract = JSON.parse(
    (
      await fsRead(
        new URL(
          '../audit/bank-statement-foundation/contract.json',
          import.meta.url,
        ),
      )
    ).toString(),
  );
  assert.equal(STATEMENT_DATE_WINDOW_DAYS, contract.matching.dateWindowDays);
});

void test('one explicit identical reference: automatic only with direction, amount and window', () => {
  const r = matchBankStatement(
    statement([
      ['2026-07-10', 'TRF-1', 5000],
      ['2026-07-10', 'TRF-2', 5000],
      ['2026-07-10', 'TRF-3', -5000],
      ['2026-07-10', 'TRF-4', 5000],
      ['2026-07-10', 'TRF-5', 5000],
    ]),
    entries([
      ['2026-07-13', 'TRF-1', 5000],
      ['2026-07-10', 'TRF-2', -5000],
      ['2026-07-10', 'TRF-3', -5001],
      ['2026-07-14', 'TRF-4', 5000],
      ['2026-07-07', 'TRF-5', 5000],
    ]),
  );
  assert.deepEqual(outcome(r), {
    auto: ['S1=V1', 'S5=V5'],
    review: [
      'S2/V2/direction-conflict',
      'S3/V3/amount-difference',
      'S4/V4/date-gap',
    ],
    statementOnly: [],
    cashbookOnly: [],
    timing: [],
  });
});

void test('a reference repeated on either side sends all its members to review', () => {
  const r = matchBankStatement(
    statement([
      ['2026-07-10', 'CHQ-9', -100],
      ['2026-07-10', 'CHQ-9', -100],
      ['2026-07-11', 'TRF-7', 300],
    ]),
    entries([
      ['2026-07-10', 'CHQ-9', -100],
      ['2026-07-11', 'TRF-7', 300],
      ['2026-07-11', 'TRF-7', 300],
    ]),
  );
  assert.deepEqual(outcome(r).review, [
    'S1,S2/V1/duplicate-reference',
    'S3/V2,V3/duplicate-reference',
  ]);
  assert.deepEqual(r.auto, []);
});

void test('references are compared after trimming only, never by case or similarity', () => {
  const r = matchBankStatement(
    statement([
      ['2026-07-10', ' TRF-1 ', 700],
      ['2026-07-10', 'TRF-2', 800],
      ['2026-07-10', '776611', -900],
    ]),
    entries([
      ['2026-07-10', 'TRF-1', 700],
      ['2026-07-10', 'trf-2', 800],
      ['2026-07-10', 'CHQ-776611', -900],
    ]),
  );
  assert.deepEqual(outcome(r).auto, ['S1=V1']);
  assert.deepEqual(outcome(r).review, [
    'S2/V2/amount-date-suggestion',
    'S3/V3/amount-date-suggestion',
  ]);
});

void test('equal amount and date never prove identity: one candidate is a suggestion, several are one group', () => {
  const r = matchBankStatement(
    statement([
      ['2026-07-14', '', 1250000],
      ['2026-07-14', '', 1250000],
      ['2026-07-20', '', 4400],
      ['2026-07-20', '', 9900],
    ]),
    entries([
      ['2026-07-14', '', 1250000],
      ['2026-07-15', '', 1250000],
      ['2026-07-23', '', 4400],
      ['2026-07-24', '', 9900],
    ]),
  );
  assert.deepEqual(outcome(r), {
    auto: [],
    review: [
      'S1,S2/V1,V2/ambiguous-amount-date',
      'S3/V3/amount-date-suggestion',
    ],
    statementOnly: ['S4'],
    cashbookOnly: ['V4'],
    timing: [],
  });
});

void test('a value date outside the period is flagged beside the match', () => {
  const r = matchBankStatement(
    statement([
      ['2026-07-31', 'TRF-1', 225000, '2026-08-01'],
      ['2026-07-01', '', -2500, '2026-06-30'],
    ]),
    entries([['2026-07-31', 'TRF-1', 225000]]),
  );
  assert.deepEqual(outcome(r).auto, ['S1=V1']);
  assert.deepEqual(r.timing, ['S1', 'S2']);
  assert.deepEqual(r.statementOnly, ['S2']);
});

void test('frozen statements: outstanding items, timing, duplicate reference', async () => {
  const fee = matchBankStatement(await pdf('BS03'), await cashbookOf('BS03'));
  assert.equal(fee.statementOnly.length, 1);
  const s = fee.movements.find((m) => m.id === fee.statementOnly[0])!;
  assert.deepEqual([s.reference, s.amount, s.direction], ['', 2500, 'out']);
  assert.deepEqual(fee.cashbookOnly.sort(), ['PV-OUT1', 'RV-DIT1']);
  assert.equal(fee.auto.length, 10);
  const timing = matchBankStatement(
    await pdf('BS13'),
    await cashbookOf('BS13'),
  );
  assert.equal(timing.timing.length, 1);
  assert.ok(timing.auto.some((a) => a.statement === timing.timing[0]));
  const dup = matchBankStatement(await pdf('BS07'), await cashbookOf('BS07'));
  assert.deepEqual(
    dup.review.map((g) => [g.statement.length, g.cashbook, g.reason]),
    [[2, ['PV-DUP1'], 'duplicate-reference']],
  );
});

void test('an unproved statement is held whole: nothing approved, suggested or outstanding', async () => {
  for (const [id, reason] of [
    ['BS09', /^balance-broken/],
    ['BS10', /^incomplete-pages: pages 1,3 of 3/],
  ] as const) {
    const r = matchBankStatement(await pdf(id), await cashbookOf(id));
    assert.match(r.held?.reason ?? '', reason);
    assert.equal(r.held?.statement, r.movements.length);
    assert.equal(r.held?.cashbook, r.cashbook.length);
    assert.deepEqual(
      [r.auto, r.review, r.statementOnly, r.cashbookOnly, r.timing],
      [[], [], [], [], []],
    );
  }
});

void test('a table statement needs a confirmed closing equal to its own, and a period', async () => {
  const table = readBankStatementTable(await csv('BS01-statement.csv'), 'SAR');
  const cashbook = await cashbookOf('BS01');
  const period = { start: '2026-07-01', end: '2026-07-31' };
  const own = table.lines.at(-1)!.balance!;
  assert.match(
    matchBankStatement(table, cashbook, { period }).held?.reason ?? '',
    /completeness-unproven/,
  );
  assert.match(
    matchBankStatement(table, cashbook, { period, confirmedClosing: own - 1 })
      .held?.reason ?? '',
    /confirmed closing/,
  );
  assert.match(
    matchBankStatement(table, cashbook, { confirmedClosing: own }).held
      ?.reason ?? '',
    /no statement period/,
  );
  const r = matchBankStatement(table, cashbook, {
    period,
    confirmedClosing: own,
  });
  assert.equal(r.held, undefined);
  assert.equal(r.statement.completeness, 'confirmed-closing');
  assert.equal(r.auto.length, 10);
});

void test('the cashbook is read strictly', async () => {
  const text = (await frozen('BS01-cashbook.csv')).toString();
  const rows = text.split('\r\n');
  assert.equal((await cashbookOf('BS01')).length, 10);
  const payment = rows.findIndex((r) => /,,\d+\.\d{2}$/.test(r));
  const edit = (at: number, change: (row: string) => string) =>
    rows.map((r, i) => (i === at ? change(r) : r)).join('\r\n');
  const cases: [string, string][] = [
    [text.replace('Voucher', 'Voucher No'), 'HEADER'],
    [[rows[0], rows[1], rows[1], ...rows.slice(2)].join('\r\n'), 'VOUCHER'],
    [edit(payment, (r) => r.replace(/,,(\d+\.\d{2})$/, ',1.00,$1')), 'AMOUNT'],
    [edit(1, (r) => r.replace(/\.(\d{2})(,|$)/, '.$10$2')), 'AMOUNT'],
    [edit(1, (r) => r.replace(/^2026-07-0\d/, '2026-07-32')), 'DATE'],
    [[rows[0], ',,,,,', ...rows.slice(1)].join('\r\n'), 'ROW'],
  ];
  for (const [changed, code] of cases) {
    const file = await csv('cashbook.csv', changed);
    assert.throws(
      () => readBankCashbookTable(file, 'SAR'),
      (e: unknown) => e instanceof CashbookReadError && e.code === code,
      code,
    );
  }
});

void test('a typed cashbook amount holds its value, not printed decimals (G8)', async () => {
  // K02 of the G8 holdout, saved by XlsxWriter with dates and amounts as
  // numbers: 366445 is 366445.00. Regression since G8 was fixed on it.
  const g8 = (name: string) =>
    fsRead(new URL(`../audit/bank-statement-holdout-g8/frozen/${name}`, import.meta.url));
  /** A cashbook that must read: a refusal fails as an assertion. */
  const entries = (file: Awaited<ReturnType<typeof readFile>>) => {
    let out: CashbookEntry[] = [];
    assert.doesNotThrow(() => {
      out = readBankCashbookTable(file, 'SAR');
    });
    return out;
  };
  const typed = entries(
    await readFile('K02-cashbook.xlsx', Uint8Array.from(await g8('K02-cashbook.xlsx')).buffer),
  );
  const text = entries(
    await readFile('K02-cashbook.csv', Uint8Array.from(await g8('K02-cashbook.csv')).buffer),
  );
  assert.deepEqual(typed, text);
  assert.ok(typed.some((e) => e.amount % 100 === 0));
  // Built here: whole and one-decimal numbers read; three decimals do not.
  const book = async (receipt: number) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cashbook');
    ws.addRow(['Date', 'Voucher', 'Description', 'Reference', 'Receipts', 'Payments']);
    ws.addRow([new Date(Date.UTC(2026, 6, 1)), 'RV-1', 'Receipt', 'FT1', receipt, null]);
    ws.getCell('A2').numFmt = 'yyyy-mm-dd';
    ws.getCell('E2').numFmt = '0.00';
    return readFile('typed.xlsx', Uint8Array.from(Buffer.from(await wb.xlsx.writeBuffer())).buffer);
  };
  assert.equal(entries(await book(366445))[0]?.amount, 36644500);
  assert.equal(entries(await book(1234.5))[0]?.amount, 123450);
  await assert.rejects(
    async () => readBankCashbookTable(await book(12.345), 'SAR'),
    (e: unknown) => e instanceof CashbookReadError && e.code === 'AMOUNT',
  );
  // Text keeps its form: a CSV amount without its decimals is refused.
  const rows = (await frozen('BS01-cashbook.csv')).toString().split('\r\n');
  const whole = rows.map((r, i) => (i === 1 ? r.replace(/(\d+)\.\d{2}(,|$)/, '$1$2') : r)).join('\r\n');
  await assert.rejects(
    async () => readBankCashbookTable(await csv('cashbook.csv', whole), 'SAR'),
    (e: unknown) => e instanceof CashbookReadError && e.code === 'AMOUNT',
  );
});

void test('a cashbook cell the reader marked as hidden, unreadable, computed or re-written is refused (G16)', async () => {
  // The generic XLSX reader records what Excel would not show as stored: a
  // hidden column, an unreadable font, a formula, a merge, an error, an
  // identifier a number format rewrites. The other families' readers use
  // these records; a cashbook entry must not rest on such a cell either.
  /** Optionally stores one cell's number as other digits, the way some
   * writers do, after ExcelJS has written the workbook. */
  const book = async (
    edit: (ws: ExcelJS.Worksheet) => void = () => {},
    stored?: [cell: string, digits: string],
  ) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cashbook');
    ws.addRow(['Date', 'Voucher', 'Description', 'Reference', 'Receipts', 'Payments']);
    ws.addRow(['2026-07-01', 'RV-1', 'Synthetic receipt', 'FT1', '1150.00', null]);
    ws.addRow(['2026-07-02', 'PV-1', 'Synthetic payment', 'FT2', null, '200.00']);
    edit(ws);
    let bytes: Uint8Array = Buffer.from(await wb.xlsx.writeBuffer());
    if (stored) {
      const zip = await JSZip.loadAsync(bytes);
      const part = 'xl/worksheets/sheet1.xml';
      const xml = await zip.file(part)!.async('string');
      const changed = xml.replace(
        new RegExp(`(<c r="${stored[0]}"[^>]*><v>)[^<]*(</v>)`),
        `$1${stored[1]}$2`,
      );
      assert.notEqual(changed, xml, `no stored number in ${stored[0]}`);
      zip.file(part, changed);
      bytes = await zip.generateAsync({ type: 'nodebuffer' });
    }
    return readFile('cashbook.xlsx', Uint8Array.from(bytes).buffer);
  };
  /** A cashbook that must read: a refusal fails as an assertion. */
  const accepted = (file: Awaited<ReturnType<typeof readFile>>) => {
    let out: CashbookEntry[] = [];
    assert.doesNotThrow(() => {
      out = readBankCashbookTable(file, 'SAR');
    });
    return out;
  };
  assert.equal(accepted(await book()).length, 2);
  const refused: [string, (ws: ExcelJS.Worksheet) => void, string, number][] = [
    ['white amount on white', (ws) => {
      ws.getCell('F3').value = 200;
      ws.getCell('F3').font = { color: { argb: 'FFFFFFFF' } };
    }, 'CELL', 3],
    ['hidden amount column', (ws) => (ws.getColumn(5).hidden = true), 'CELL', 1],
    ['formula with its stored result', (ws) => (ws.getCell('E2').value = { formula: '1000+150', result: 1150 }), 'CELL', 2],
    ['description merged over the reference', (ws) => ws.mergeCells('C2:D2'), 'CELL', 2],
    ['voucher typed as a number that loses digits', (ws) => (ws.getCell('B3').value = Number('12345678901234567890')), 'CELL', 3],
    ['the only sheet hidden', (ws) => (ws.state = 'hidden'), 'SHEET', 1],
    ['reference a number format rewrites', (ws) => {
      ws.getCell('D3').value = 17;
      ws.getCell('D3').numFmt = '0.00';
    }, 'CELL', 3],
  ];
  for (const [name, edit, code, row] of refused)
    await assert.rejects(
      async () => readBankCashbookTable(await book(edit), 'SAR'),
      (e: unknown) => e instanceof CashbookReadError && e.code === code && e.row === row,
      name,
    );
  // Stored digits that do not survive reading: refused in an identifier,
  // read by its value in an amount, where the typed-amount rule decides.
  await assert.rejects(
    async () =>
      readBankCashbookTable(
        await book((ws) => (ws.getCell('D2').value = 1709.1), ['D2', '1709.0999999999999']),
        'SAR',
      ),
    (e: unknown) => e instanceof CashbookReadError && e.code === 'CELL' && e.row === 2,
    'reference stored with digits the reader cannot keep',
  );
  const amount = await book(
    (ws) => (ws.getCell('E2').value = 1150),
    ['E2', '1149.9999999999999'],
  );
  assert.ok(amount.sheets[0].cellIssues?.['2:5']?.length);
  assert.equal(accepted(amount)[0]?.amount, 115000);
  // R03 of the G14 holdout, saved by PhpSpreadsheet: 8620.08 is stored as
  // 8620.079999999999927. The precision note on a typed amount stays out;
  // the typed-amount rule above already refuses a third decimal.
  const g14 = (name: string) =>
    fsRead(new URL(`../audit/bank-statement-holdout-g14/frozen/${name}`, import.meta.url));
  const typed = await readFile('R03-cashbook.xlsx', Uint8Array.from(await g14('R03-cashbook.xlsx')).buffer);
  assert.ok(Object.keys(typed.sheets[0].cellIssues ?? {}).length > 0);
  assert.deepEqual(
    accepted(typed),
    accepted(
      await readFile('R03-cashbook.csv', Uint8Array.from(await g14('R03-cashbook.csv')).buffer),
    ),
  );
});

void test('withheld items stay out of every pair, group and one-sided list', () => {
  // bank-statement-roll-1: a carried item's repetition withholds these from
  // the period's own matching; the rest is matched exactly as without them.
  const reading = statement([
    ['2026-07-10', 'CHQ-1', -5000],
    ['2026-07-11', 'TRF-2', 7000],
    ['2026-07-12', '', -900],
  ]);
  const cash = entries([
    ['2026-07-09', 'CHQ-1', -5000],
    ['2026-07-11', 'TRF-2', 7000],
    ['2026-07-12', '', -900],
    ['2026-07-13', 'CHQ-1', -5000],
  ]);
  assert.deepEqual(outcome(matchBankStatement(reading, cash)), {
    auto: ['S2=V2'],
    review: ['S1/V1,V4/duplicate-reference', 'S3/V3/amount-date-suggestion'],
    statementOnly: [],
    cashbookOnly: [],
    timing: [],
  });
  const withheld = new Set(['S:S1', 'C:V4']);
  const r = matchBankStatement(reading, cash, { withheld });
  assert.deepEqual(outcome(r), {
    auto: ['S2=V2'],
    review: ['S3/V3/amount-date-suggestion'],
    statementOnly: [],
    // V1 keeps its reference but meets no unwithheld movement with it.
    cashbookOnly: ['V1'],
    timing: [],
  });
  assert.equal(r.movements.length, 3, 'the movements themselves stay listed');
  assert.equal(r.cashbook.length, 4);
  // A withheld entry is out of its reference too: the other entry with it
  // pairs alone, rather than the reference counting as used twice.
  assert.deepEqual(
    outcome(matchBankStatement(reading, cash, { withheld: new Set(['C:V1']) })).auto,
    ['S1=V4', 'S2=V2'],
  );
  // Withholding every entry of a reference leaves its movement unmatched.
  const single = matchBankStatement(reading, cash, { withheld: new Set(['C:V1', 'C:V4']) });
  assert.deepEqual(outcome(single).statementOnly, ['S1']);
});
