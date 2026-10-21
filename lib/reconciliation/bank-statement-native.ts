// bank-statement-native-1, reading part: a bank statement as the bank issues
// it, read into its printed lines and proved before anything is matched. The
// contract and frozen cases are in audit/bank-statement-foundation. Nothing
// here matches the statement against a cashbook.
//
// A line is either a movement or one of the declared non-movement lines
// (opening, brought forward, carried forward, closing, totals, page totals,
// continuation). Column membership comes from each page's own header: a
// value must lie wholly inside one column. Labels, headers and page numbers
// are compared exactly with the declared vocabulary; nothing is guessed, and
// a line that fits no declared form stops the reading with its page and
// line. A statement that was read but cannot be proved (pages missing or out
// of sequence, a broken balance chain, no proof of completeness) is returned
// with that status; it is never treated as complete.
import { currencyPrecision } from './currency-precision.ts';
import type { NativePdfWordSource } from './pdf-native-source.ts';
import type { SourceFile } from './types.ts';

export const BANK_STATEMENT_NATIVE = 'bank-statement-native-1';

export type StatementLayout = 'en' | 'ar';
export type StatementLineKind =
  | 'opening'
  | 'brought-forward'
  | 'movement'
  | 'continuation'
  | 'page-totals'
  | 'carried-forward'
  | 'closing'
  | 'totals';
export type StatementLine = {
  kind: StatementLineKind;
  /** Physical page in the file (1-based); 0 for a table file. */
  page: number;
  /** PDF.js text items cited (PDF), or the 1-based row (table file). */
  items: number[];
  date?: string;
  valueDate?: string;
  description?: string;
  reference?: string;
  /** Minor units. */
  withdrawal?: number;
  deposit?: number;
  balance?: number;
  /** Continuation text, as printed. */
  text?: string;
};
export type StatementStatus =
  | 'verified'
  | 'incomplete-pages'
  | 'balance-broken'
  | 'completeness-unproven';
export type BankStatementReading = {
  family: typeof BANK_STATEMENT_NATIVE;
  format: 'pdf' | 'csv' | 'xlsx';
  layout: StatementLayout;
  sha256: string;
  currency: string;
  decimals: number;
  period: { start: string; end: string } | null;
  /** Page furniture above the table, identical on every page. */
  heading: string;
  /** Printed page numbers per physical page (PDF only). */
  pages: { page: number; number: number; of: number }[];
  lines: StatementLine[];
  status: StatementStatus;
  reason?: string;
  /** Minor units, as printed: opening and closing lines, sums of movements. */
  opening: number | null;
  closing: number | null;
  withdrawals: number;
  deposits: number;
};

export class BankStatementReadError extends Error {
  readonly code: string;
  readonly page: number;
  readonly line: number;
  constructor(code: string, page: number, line: number, detail: string) {
    super(`BANK_STATEMENT_${code}: page ${page} line ${line}: ${detail}`);
    this.code = code;
    this.page = page;
    this.line = line;
  }
}

type Vocabulary = {
  direction: 'ltr' | 'rtl';
  headers: string[];
  labels: Record<
    Exclude<StatementLineKind, 'movement' | 'continuation'>,
    string
  >;
  page: RegExp;
};
// The declared wording of this family. Another bank's wording is added here
// with its own evidence; labels are never matched approximately.
export const STATEMENT_VOCABULARY: Record<StatementLayout, Vocabulary> = {
  en: {
    direction: 'ltr',
    headers: [
      'Date',
      'Value Date',
      'Description',
      'Reference',
      'Withdrawal',
      'Deposit',
      'Balance',
    ],
    labels: {
      opening: 'Opening balance',
      'brought-forward': 'Balance brought forward',
      'carried-forward': 'Balance carried forward',
      closing: 'Closing balance',
      totals: 'Total withdrawals / deposits',
      'page-totals': 'Page total withdrawals / deposits',
    },
    page: /^Page (\d+) of (\d+)$/u,
  },
  ar: {
    direction: 'rtl',
    headers: [
      'التاريخ',
      'تاريخ القيمة',
      'البيان',
      'المرجع',
      'سحب',
      'إيداع',
      'الرصيد',
    ],
    labels: {
      opening: 'الرصيد الافتتاحي',
      'brought-forward': 'رصيد منقول من الصفحة السابقة',
      'carried-forward': 'رصيد منقول إلى الصفحة التالية',
      closing: 'الرصيد الختامي',
      totals: 'إجمالي السحب / الإيداع',
      'page-totals': 'إجمالي الصفحة سحب / إيداع',
    },
    page: /^صفحة (\d+) من (\d+)$/u,
  },
};
const COLUMN = {
  date: 0,
  valueDate: 1,
  description: 2,
  reference: 3,
  withdrawal: 4,
  deposit: 5,
  balance: 6,
} as const;

const latinDigits = (s: string) =>
  s
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/٬/gu, ',')
    .replace(/٫/gu, '.');
const normal = (s: string) => s.normalize('NFKC').replace(/\s+/gu, ' ').trim();
const squeeze = (s: string) => s.normalize('NFKC').replace(/\s+/gu, '');

/** Minor units of a printed amount in this family's format, or undefined. */
export function statementAmount(
  text: string,
  decimals: number,
  allowDebit: boolean,
): number | undefined {
  const m = new RegExp(
    `^(\\d{1,3}(?:,\\d{3})*|\\d+)${decimals ? `\\.(\\d{${decimals}})` : ''}( DR)?$`,
    'u',
  ).exec(latinDigits(normal(text)));
  if (!m || (m[3] && !allowDebit)) return undefined;
  const value = Number(m[1].replace(/,/gu, '') + (m[2] ?? ''));
  if (!Number.isSafeInteger(value)) return undefined;
  return m[3] ? -value : value;
}
/** The one ISO date among the readings of a printed date, or undefined. In
 * a right-to-left layout the bidi algorithm lays the segments of a date that
 * follows Arabic text out right to left (2026-07-01 shows as 01-07-2026); the
 * reversed segment order is read back as well. */
export function statementDate(readings: string[], layout: StatementLayout) {
  const found = new Set<string>();
  for (const reading of readings) {
    const forms = [reading];
    if (layout === 'ar') forms.push(reading.split('-').reverse().join('-'));
    for (const form of forms) {
      const date = isoDate(form);
      if (date) found.add(date);
    }
  }
  return found.size === 1 ? [...found][0] : undefined;
}
const isoDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(latinDigits(normal(s)));
  if (!m) return undefined;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}`
    ? `${m[1]}-${m[2]}-${m[3]}`
    : undefined;
};

type Token = NativePdfWordSource['pages'][number]['tokens'][number];
type Piece = {
  text: string;
  /** The readings of this text: a whole token's text and PDF.js reading, or
   * a word part's own text. */
  readings: string[];
  x0: number;
  x1: number;
  y: number;
  height: number;
  rtl: boolean;
  item: number;
  token: Token;
};
const pieceOf = (t: Token): Piece => ({
  text: t.text,
  readings: [
    t.text,
    ...(t.extractionText === undefined ? [] : [t.extractionText]),
  ],
  x0: t.x,
  x1: t.x + t.width,
  y: t.y,
  height: t.height,
  rtl: t.direction === 'rtl',
  item: t.item,
  token: t,
});
const partsOf = (t: Token): Piece[] =>
  t.parts?.map((p) => ({
    ...pieceOf(t),
    text: p.text,
    readings: [p.text],
    x0: p.x,
    x1: p.x + p.width,
  })) ?? [pieceOf(t)];
const strongLtr = (p: Piece) => !p.rtl && /[\p{L}\p{N}]/u.test(p.text);
const strongRtl = (p: Piece) => p.rtl && /\p{Script=Arabic}/u.test(p.text);

/** Reading order of pieces on one line: the paragraph direction, with
 * opposite-direction runs kept in their own visual order. */
function readingOrder(pieces: Piece[], direction: 'ltr' | 'rtl'): Piece[] {
  const sorted = [...pieces].sort((a, b) =>
    direction === 'ltr' ? a.x0 - b.x0 : b.x1 - a.x1,
  );
  const opposite = direction === 'ltr' ? strongRtl : strongLtr;
  const out: Piece[] = [];
  for (let i = 0; i < sorted.length;) {
    if (!opposite(sorted[i])) {
      out.push(sorted[i++]);
      continue;
    }
    let j = i;
    while (j < sorted.length && opposite(sorted[j])) j++;
    out.push(...sorted.slice(i, j).reverse());
    i = j;
  }
  return out;
}
/** Text of pieces in reading order; touching pieces join without a space. */
function textOf(pieces: Piece[], direction: 'ltr' | 'rtl'): string {
  const ordered = readingOrder(pieces, direction);
  let out = '';
  for (const [i, p] of ordered.entries()) {
    if (i) {
      const q = ordered[i - 1];
      const gap = Math.max(p.x0, q.x0) - Math.min(p.x1, q.x1);
      out += gap > 0.15 * Math.min(p.height, q.height) ? ' ' : '';
    }
    out += p.text;
  }
  return normal(out);
}

type Line = { y: number; tokens: Token[] };
function linesOf(tokens: Token[]): Line[] {
  const lines: Line[] = [];
  for (const t of [...tokens].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - t.y) <= 1) last.tokens.push(t);
    else lines.push({ y: t.y, tokens: [t] });
  }
  return lines;
}

// Each header cell starts at its column's start edge (left in a left-to-right
// table, right in a right-to-left one). A value belongs to a column when it
// lies between that edge (less the cell padding) and the next column's edge.
const PADDING = 2.5,
  SEPARATION = 1;
type Columns = { start: number[]; direction: 'ltr' | 'rtl' };
function columnOf(c: Columns, p: Piece): number | undefined {
  for (let k = 0; k < c.start.length; k++) {
    const next = c.start[k + 1];
    if (c.direction === 'ltr') {
      if (
        p.x0 >= c.start[k] - PADDING &&
        (next === undefined || p.x1 <= next - SEPARATION)
      )
        return k;
    } else if (
      p.x1 <= c.start[k] + PADDING &&
      (next === undefined || p.x0 >= next + SEPARATION)
    )
      return k;
  }
  return undefined;
}

/** A token as it sits in the table: whole when it fits one column, else
 * its proved word parts (or itself, to be refused by the caller). */
function fitted(columns: Columns, t: Token): Piece[] {
  const whole = pieceOf(t);
  return columnOf(columns, whole) !== undefined ? [whole] : partsOf(t);
}

/** The header band of a page: up to three stacked lines whose cells are the
 * declared headers, exactly and in order. */
function findHeader(
  lines: Line[],
  v: Vocabulary,
): { first: number; last: number; columns: Columns } | undefined {
  const target = v.headers.map(squeeze);
  for (let first = 0; first < lines.length; first++)
    for (let last = first; last < Math.min(first + 3, lines.length); last++) {
      if (lines[first].y - lines[last].y > 3 * lines[first].tokens[0].height)
        break;
      const pieces = lines
        .slice(first, last + 1)
        .flatMap((l) => l.tokens.flatMap(partsOf));
      // Pieces stacked over one another (a wrapped header) form one cell.
      const cells: Piece[][] = [];
      for (const p of pieces) {
        const overlapping = cells.filter((cell) =>
          cell.some(
            (q) => q.y !== p.y && p.x0 < q.x1 - 0.5 && p.x1 > q.x0 + 0.5,
          ),
        );
        const merged = [p, ...overlapping.flat()];
        for (const cell of overlapping) cells.splice(cells.indexOf(cell), 1);
        cells.push(merged);
      }
      const units = cells.map((cell) => {
        const rows = [...new Set(cell.map((p) => p.y))].sort((a, b) => b - a);
        return {
          text: squeeze(
            rows
              .map((y) =>
                textOf(
                  cell.filter((p) => p.y === y),
                  v.direction,
                ),
              )
              .join(' '),
          ),
          x0: Math.min(...cell.map((p) => p.x0)),
          x1: Math.max(...cell.map((p) => p.x1)),
          piece: cell[0],
        };
      });
      const ordered = readingOrder(
        units.map((u) => ({ ...u.piece, x0: u.x0, x1: u.x1, text: u.text })),
        v.direction,
      );
      // Walk the declared headers over the cells in reading order; every
      // boundary must fall between cells.
      const start: number[] = [];
      let at = 0,
        ok = true;
      for (const label of target) {
        let text = '';
        const group: Piece[] = [];
        while (at < ordered.length && text.length < label.length) {
          text += ordered[at].text;
          group.push(ordered[at++]);
        }
        if (text !== label) {
          ok = false;
          break;
        }
        start.push(
          v.direction === 'ltr'
            ? Math.min(...group.map((p) => p.x0))
            : Math.max(...group.map((p) => p.x1)),
        );
      }
      if (ok && at === ordered.length)
        return { first, last, columns: { start, direction: v.direction } };
    }
  return undefined;
}

type PageRead = {
  page: number;
  number: number;
  of: number;
  heading: string;
  lines: StatementLine[];
};

function readPage(
  page: NativePdfWordSource['pages'][number],
  layout: StatementLayout,
  decimals: number,
): PageRead {
  const v = STATEMENT_VOCABULARY[layout];
  const lines = linesOf(page.tokens);
  const header = findHeader(lines, v);
  if (!header)
    throw new BankStatementReadError(
      'HEADER',
      page.page,
      0,
      'no line carries the declared column headers in order',
    );
  const { columns } = header;
  const heading = lines
    .slice(0, header.first)
    .map((l) => textOf(l.tokens.map(pieceOf), v.direction))
    .join('\n');
  const footerLine = lines.at(-1)!;
  const footer = v.page.exec(
    latinDigits(textOf(footerLine.tokens.map(pieceOf), v.direction)),
  );
  if (!footer || lines.length - 1 <= header.last)
    throw new BankStatementReadError(
      'PAGE_NUMBER',
      page.page,
      lines.length,
      'the last line is not the declared page number',
    );
  const out: StatementLine[] = [];
  const labelKinds = Object.entries(v.labels).map(
    ([kind, label]) => [kind, squeeze(label)] as const,
  );
  let wrapTarget: StatementLine | undefined;
  for (let index = header.last + 1; index < lines.length - 1; index++) {
    const line = lines[index];
    const at = index + 1;
    const fail = (code: string, detail: string): never => {
      throw new BankStatementReadError(code, page.page, at, detail);
    };
    const items = line.tokens.map((t) => t.item).sort((a, b) => a - b);
    // Declared non-movement lines: label text plus amounts in amount columns.
    const amounts = new Map<number, Piece[]>();
    const label: Piece[] = [];
    for (const p of line.tokens.flatMap((t) => fitted(columns, t))) {
      const col = columnOf(columns, p);
      if (
        col !== undefined &&
        col >= COLUMN.withdrawal &&
        statementAmount(p.text, decimals, col === COLUMN.balance) !== undefined
      )
        amounts.set(col, [...(amounts.get(col) ?? []), p]);
      else label.push(p);
    }
    const labelText = squeeze(textOf(label, v.direction));
    const kind = labelKinds.find(([, text]) => text === labelText)?.[0] as
      | Exclude<StatementLineKind, 'movement' | 'continuation'>
      | undefined;
    if (kind && label.length) {
      const one = (col: number, debit: boolean) => {
        const found = amounts.get(col) ?? [];
        if (found.length > 1) fail('AMOUNT', `two amounts in one column`);
        return found.length
          ? statementAmount(found[0].text, decimals, debit)!
          : undefined;
      };
      if (kind === 'totals' || kind === 'page-totals') {
        if (amounts.has(COLUMN.balance))
          fail('AMOUNT', `a balance on a ${kind} line`);
        out.push({
          kind,
          page: page.page,
          items,
          // A total the bank prints empty is zero.
          withdrawal: one(COLUMN.withdrawal, false) ?? 0,
          deposit: one(COLUMN.deposit, false) ?? 0,
        });
      } else {
        const balance = one(COLUMN.balance, true);
        if (
          balance === undefined ||
          amounts.has(COLUMN.withdrawal) ||
          amounts.has(COLUMN.deposit)
        )
          fail('AMOUNT', `${kind} needs one balance and nothing else`);
        out.push({ kind, page: page.page, items, balance });
      }
      wrapTarget = undefined;
      continue;
    }
    // Otherwise every piece must sit in one column; a token that crosses
    // columns counts only through its proved word parts.
    const cells: Piece[][] = Array.from({ length: 7 }, () => []);
    for (const t of line.tokens) {
      for (const p of fitted(columns, t)) {
        const col =
          columnOf(columns, p) ??
          fail('COLUMN', `${JSON.stringify(p.text)} is not inside one column`);
        cells[col].push(p);
      }
    }
    const text = (col: number) => textOf(cells[col], v.direction);
    const filled = cells.map((c) => c.length > 0);
    if (filled.every((f, col) => f === (col === COLUMN.description))) {
      // Description text alone: a wrapped line of the movement above, or at
      // the top of a page the rest of the previous page's last movement.
      const previous = out.at(-1);
      const body = text(COLUMN.description);
      if (previous && previous === wrapTarget && previous.kind === 'movement')
        previous.description = `${previous.description}\n${body}`;
      else if (previous && previous === wrapTarget)
        previous.text = `${previous.text} ${body}`;
      else if (previous?.kind === 'brought-forward') {
        wrapTarget = {
          kind: 'continuation',
          page: page.page,
          items: [],
          text: body,
        };
        out.push(wrapTarget);
      } else fail('LINE', 'description text without its movement');
      wrapTarget!.items.push(...items);
      continue;
    }
    const single = (col: number, name: string) => {
      if (cells[col].length !== 1) fail('FIELD', `${name} needs one value`);
      return cells[col][0];
    };
    const cellDate = (col: number, name: string) => {
      const piece = single(col, name);
      return (
        statementDate(piece.readings, layout) ??
        fail('DATE', `${name} ${JSON.stringify(piece.text)} is not one date`)
      );
    };
    const date = cellDate(COLUMN.date, 'date');
    const valueDate = cellDate(COLUMN.valueDate, 'value date');
    const money = (col: number, debit: boolean) =>
      cells[col].length
        ? (statementAmount(single(col, 'amount').text, decimals, debit) ??
          fail(
            'AMOUNT',
            `${JSON.stringify(cells[col][0].text)} is not an amount`,
          ))
        : undefined;
    const withdrawal = money(COLUMN.withdrawal, false);
    const deposit = money(COLUMN.deposit, false);
    const balance = money(COLUMN.balance, true);
    if (
      (withdrawal === undefined) === (deposit === undefined) ||
      balance === undefined
    )
      fail(
        'AMOUNT',
        'a movement needs one withdrawal or deposit and its balance',
      );
    const movement: StatementLine = {
      kind: 'movement',
      page: page.page,
      items,
      date,
      valueDate,
      description: text(COLUMN.description),
      reference: text(COLUMN.reference),
      withdrawal: withdrawal ?? 0,
      deposit: deposit ?? 0,
      balance,
    };
    out.push(movement);
    wrapTarget = movement;
  }
  return {
    page: page.page,
    number: Number(footer[1]),
    of: Number(footer[2]),
    heading,
    lines: out,
  };
}

/** Page sequence, balance chain, carried balances and totals, as in the
 * foundation's statementProof. The first difference is the reason. */
export function proveStatement(
  pages: { number: number; of: number }[] | null,
  lines: StatementLine[],
): Pick<
  BankStatementReading,
  'status' | 'reason' | 'opening' | 'closing' | 'withdrawals' | 'deposits'
> {
  const movements = lines.filter((l) => l.kind === 'movement');
  const withdrawals = movements.reduce((t, l) => t + l.withdrawal!, 0);
  const deposits = movements.reduce((t, l) => t + l.deposit!, 0);
  const opening = lines.find((l) => l.kind === 'opening')?.balance ?? null;
  const closing = lines.find((l) => l.kind === 'closing')?.balance ?? null;
  const base = { opening, closing, withdrawals, deposits };
  if (pages) {
    const declared = new Set(pages.map((p) => p.of));
    const total = pages[0]?.of ?? 0;
    if (
      declared.size !== 1 ||
      pages.length !== total ||
      pages.some((p, i) => p.number !== i + 1)
    )
      return {
        ...base,
        status: 'incomplete-pages',
        reason: `pages ${pages.map((p) => p.number).join(',')} of ${[...declared].join(',')}`,
      };
  }
  let running: number | null = null;
  let pageW = 0,
    pageD = 0,
    totalW = 0,
    totalD = 0,
    page = -1;
  const broken = (detail: string) => ({
    ...base,
    status: 'balance-broken' as const,
    reason: detail,
  });
  for (const [i, l] of lines.entries()) {
    if (l.page !== page) {
      page = l.page;
      totalW += pageW;
      totalD += pageD;
      pageW = pageD = 0;
      const first = pages
        ? l.kind === (i === 0 ? 'opening' : 'brought-forward')
        : l.kind === 'opening' && i === 0;
      if (!first)
        return broken(`page ${l.page} does not start with its carried balance`);
    }
    switch (l.kind) {
      case 'opening':
        if (running !== null) return broken('a second opening balance');
        running = l.balance!;
        break;
      case 'brought-forward':
      case 'carried-forward':
      case 'closing':
        if (l.balance !== running)
          return broken(`page ${l.page}: ${l.kind} ${l.balance} != ${running}`);
        break;
      case 'movement':
        running = running! + l.deposit! - l.withdrawal!;
        pageW += l.withdrawal!;
        pageD += l.deposit!;
        if (l.balance !== running)
          return broken(
            `page ${l.page}: printed balance ${l.balance} != ${running} (items ${l.items.join(',')})`,
          );
        break;
      case 'page-totals':
        if (l.withdrawal !== pageW || l.deposit !== pageD)
          return broken(
            `page ${l.page}: page totals differ from its movements`,
          );
        break;
      case 'totals':
        if (l.withdrawal !== totalW + pageW || l.deposit !== totalD + pageD)
          return broken('statement totals differ from its movements');
        break;
    }
    const next = lines[i + 1];
    if (pages && next && next.page !== l.page && l.kind !== 'carried-forward')
      return broken(`page ${l.page} does not end with a carried-forward line`);
  }
  if (pages && (closing === null || !lines.some((l) => l.kind === 'totals')))
    return broken('no closing balance and totals');
  if (!pages && closing === null)
    return {
      ...base,
      status: 'completeness-unproven',
      reason: 'a table without page numbers or a closing balance',
    };
  return { ...base, status: 'verified' };
}

/** Reads a bank statement PDF (native text with word geometry). */
export function readBankStatementPdf(
  source: NativePdfWordSource,
): BankStatementReading {
  if (source.readingIssues.length)
    throw new BankStatementReadError(
      'READING',
      source.readingIssues[0].page,
      source.readingIssues[0].line,
      source.readingIssues[0].reasons.join('; '),
    );
  const first = source.pages[0];
  const layout = (['en', 'ar'] as const).find((l) =>
    findHeader(linesOf(first.tokens), STATEMENT_VOCABULARY[l]),
  );
  if (!layout)
    throw new BankStatementReadError(
      'HEADER',
      1,
      0,
      'no declared header layout on the first page',
    );
  // The heading names the currency and the period; read it before amounts.
  const firstLines = linesOf(first.tokens);
  const header = findHeader(firstLines, STATEMENT_VOCABULARY[layout])!;
  const headingTokens = firstLines
    .slice(0, header.first)
    .flatMap((l) => l.tokens);
  const currencies = [
    ...new Set(
      headingTokens
        .flatMap(partsOf)
        .flatMap((p) => (/^[A-Z]{3}$/u.test(p.text) ? [p.text] : [])),
    ),
  ];
  // Each date is one reading of a token or word part; the period is the
  // earlier and the later of exactly two dates, whatever the reading order.
  const dates = headingTokens
    .flatMap(partsOf)
    .flatMap((p) => statementDate(p.readings, layout) ?? [])
    .sort();
  const decimals =
    currencies.length === 1 ? currencyPrecision(currencies[0]) : undefined;
  if (decimals === undefined || dates.length !== 2)
    throw new BankStatementReadError(
      'SCOPE',
      1,
      header.first,
      'the heading must state one currency and one period',
    );
  const pages = source.pages.map((p) => readPage(p, layout, decimals));
  const differs = pages.find((p) => p.heading !== pages[0].heading);
  if (differs)
    throw new BankStatementReadError(
      'HEADING',
      differs.page,
      1,
      'the page heading differs from the first page',
    );
  const lines = pages.flatMap((p) => p.lines);
  // A continuation belongs to the last movement of the page before it.
  for (const [i, l] of lines.entries())
    if (l.kind === 'continuation') {
      let j = i - 1;
      while (
        j >= 0 &&
        ['brought-forward', 'carried-forward', 'page-totals'].includes(
          lines[j].kind,
        )
      )
        j--;
      if (lines[j]?.kind !== 'movement' || lines[j].page !== l.page - 1)
        throw new BankStatementReadError(
          'LINE',
          l.page,
          0,
          'a continuation without a movement on the previous page',
        );
    }
  return {
    family: BANK_STATEMENT_NATIVE,
    format: 'pdf',
    layout,
    sha256: source.sha256,
    currency: currencies[0],
    decimals,
    period: { start: dates[0], end: dates[1] },
    heading: pages[0].heading,
    pages: pages.map(({ page, number, of }) => ({ page, number, of })),
    lines,
    ...proveStatement(pages, lines),
  };
}

/** Reads a statement exported as a table (CSV or XLSX) in the declared
 * English headers: header, opening row, movements, optional closing row. */
export function readBankStatementTable(
  file: SourceFile,
  currency: string,
): BankStatementReading {
  const decimals = currencyPrecision(currency);
  if (decimals === undefined)
    throw new BankStatementReadError('SCOPE', 0, 0, 'unknown currency');
  const format = /\.xlsx$/iu.test(file.name)
    ? 'xlsx'
    : /\.csv$/iu.test(file.name)
      ? 'csv'
      : undefined;
  const rows = file.sheets[0]?.rows ?? [];
  const headers = STATEMENT_VOCABULARY.en.headers;
  if (
    !format ||
    file.sheets.length !== 1 ||
    rows[0]?.length !== headers.length ||
    rows[0].some((h, i) => h.trim() !== headers[i])
  )
    throw new BankStatementReadError(
      'HEADER',
      0,
      1,
      'the first row must be the declared headers in order',
    );
  const plain = (s: string, signed: boolean) => {
    const m = new RegExp(
      `^(${signed ? '-?' : ''})(\\d+)${decimals ? `\\.(\\d{${decimals}})` : ''}$`,
      'u',
    ).exec(s.trim());
    if (!m) return undefined;
    const value = Number(m[2] + (m[3] ?? ''));
    return Number.isSafeInteger(value) ? (m[1] ? -value : value) : undefined;
  };
  const lines: StatementLine[] = [];
  for (const [i, row] of rows.slice(1).entries()) {
    const at = i + 2;
    const [date, valueDate, description, reference, w, d, b] = [
      ...row,
      ...Array<string>(headers.length).fill(''),
    ].map((s) => s.trim());
    const fail = (code: string, detail: string): never => {
      throw new BankStatementReadError(code, 0, at, detail);
    };
    if (
      row.length > headers.length &&
      row.slice(headers.length).some((s) => s.trim())
    )
      fail('COLUMN', 'a value outside the declared columns');
    const balance = plain(b, true) ?? fail('AMOUNT', 'balance');
    const kind = (
      [
        ['opening', 'Opening balance'],
        ['closing', 'Closing balance'],
      ] as const
    ).find(([, label]) => description === label)?.[0];
    if (kind && !date && !valueDate && !reference && !w && !d) {
      lines.push({ kind, page: 0, items: [at], balance });
      continue;
    }
    const withdrawal = w
      ? (plain(w, false) ?? fail('AMOUNT', 'withdrawal'))
      : undefined;
    const deposit = d
      ? (plain(d, false) ?? fail('AMOUNT', 'deposit'))
      : undefined;
    if ((withdrawal === undefined) === (deposit === undefined))
      fail('AMOUNT', 'a movement needs one withdrawal or deposit');
    lines.push({
      kind: 'movement',
      page: 0,
      items: [at],
      date: isoDate(date) ?? fail('DATE', 'date'),
      valueDate: isoDate(valueDate) ?? fail('DATE', 'value date'),
      description,
      reference,
      withdrawal: withdrawal ?? 0,
      deposit: deposit ?? 0,
      balance,
    });
  }
  const closingAt = lines.findIndex((l) => l.kind === 'closing');
  if (closingAt >= 0 && closingAt !== lines.length - 1)
    throw new BankStatementReadError(
      'LINE',
      0,
      rows.length,
      'rows after the closing balance',
    );
  return {
    family: BANK_STATEMENT_NATIVE,
    format,
    layout: 'en',
    sha256: file.sha256 ?? '',
    currency,
    decimals,
    period: null,
    heading: '',
    pages: [],
    lines,
    ...proveStatement(null, lines),
  };
}
