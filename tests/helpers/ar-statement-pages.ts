// Customer statement pages built from words, for the ar-statement-pdf-1
// tests: each test states the printed lines it needs and nothing else.
import type { NativePdfWordSource } from '../../lib/reconciliation/pdf-native-source.ts';

export type Cell = [x: number, text: string];
const CHAR = 5;
let item = 0;
export const line = (y: number, cells: Cell[]) =>
  cells.map(([x, text]) => ({
    text,
    x,
    y,
    width: text.length * CHAR,
    height: 9,
    item: item++,
    direction: 'ltr',
  }));
export type Tokens = ReturnType<typeof line>;
export const text = (y: number, value: string) => line(y, [[40, value]]);
export const X = { date: 40, type: 110, document: 170, original: 260, balance: 340 };
const at = [X.date, X.type, X.document, X.original, X.balance];
export const headings = (
  y: number,
  roles = ['Date', 'Type', 'Document No', 'Original amount', 'Balance'],
) => line(y, roles.map((h, i) => [at[i], h]));
export const detail = (y: number, values: string[]) =>
  line(y, values.flatMap((v, i) => (v ? [[at[i], v] as Cell] : [])));
export const header = (
  y: number,
  {
    customer = 'C0001',
    name = 'Synthetic Buyer',
    account = '1200',
    currency = 'SAR',
    period = '2026-09-01 to 2026-09-30',
  } = {},
) => [
  ...text(y, `Customer ID: ${customer}`),
  ...text(y - 12, `Customer name: ${name}`),
  ...text(y - 24, `Account: ${account}`),
  ...text(y - 36, `Currency: ${currency}`),
  ...text(y - 48, `Period: ${period}`),
];
export const top = (entity = 'Synthetic Seller Co', ledger = 'AR Book') => [
  ...text(780, 'Statement of account'),
  ...text(766, `Issued by: ${entity}`),
  ...text(754, `Ledger: ${ledger}`),
];
/** A word source of pages; its hash names the bytes it stands for. */
export const source = (
  pages: Tokens[],
  sha256 = '0'.repeat(64),
): NativePdfWordSource =>
  ({
    version: 'native-pdf-source-1',
    wordVersion: 'native-pdf-words-3',
    sha256,
    byteLength: 0,
    coordinateSystem: 'visible-page-bottom-left-pdf-units',
    readingIssues: [],
    pages: pages.map((tokens, i) => ({
      page: i + 1,
      view: [0, 0, 600, 800],
      width: 600,
      height: 800,
      tokens,
    })),
  }) as unknown as NativePdfWordSource;
export const page = (...blocks: Tokens[]) => blocks.flat();
export const invoice = (y: number, document = 'INV-1', amount = '1,250.00', date = '2026-09-02') =>
  detail(y, [date, 'invoice', document, amount, amount]);
