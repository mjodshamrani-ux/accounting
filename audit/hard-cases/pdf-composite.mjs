// Composite PDF hard cases (V1.1). Real PDFs printed by Chromium from HTML
// with an embedded Unicode font (DejaVu Sans), so Arabic, Arabic-Indic digits,
// several evidence columns, wrapped cells and page breaks are actually in the
// file. The ASCII writer in audit/reliability/renderers.mjs cannot carry these.
//
// Each case pairs a supplier statement PDF with a plain CSV ledger, so the PDF
// reading is what is under test. Expected results are fixed here, by hand,
// before any engine runs; nothing is computed with engine functions.
//
// Patterns (each: resolvable, insufficient evidence, conflicting):
//   EVIDENCE    bank reference, invoice number, voucher and batch in columns
//   SPLIT2D     one payment in parts over two days, with/without identity
//   ARABIC      Arabic headers and labels, Arabic-Indic digits, mixed text
//   SPLITREF    a reference wrapped over two lines inside its cell
//   CROSSPAGE   a transaction that starts on one page and ends on the next
//   REPEAT      repeated headers and carried-forward/total rows per page
//   TWOREF      two reference-like columns with different meanings
//   MISSINGPAGE a page absent (or doubled) from a numbered statement
export const PDF_COMPOSITE_VERSION = 'tarasuf-pdf-composite-1.1.0';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arabicDigits = (text) =>
  text.replace(/\d/g, (d) => AR_DIGITS[d]).replace(/,/g, '٬').replace(/\./g, '٫');
const money = (minor) => {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${whole}.${String(abs % 100).padStart(2, '0')}`;
};
const plain = (minor) => (minor / 100).toFixed(2);
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function rng(seed) {
  let x = seed >>> 0 || 1;
  return (lo, hi) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return lo + ((x >>> 0) % (hi - lo + 1));
  };
}

/** HTML for one statement. `cells(row)` returns the visible cells; `extra`
 * rows (carried forward, totals) are inserted where their `after` says. */
function statementHtml({ lang, headers, rows, cells, css = '', pages, extra = [], banner }) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const head = `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const body = (list) =>
    list
      .map((r) => {
        const own = `<tr class="${r.cls ?? ''}">${cells(r).map((c, i) => `<td class="c${i}">${esc(c)}</td>`).join('')}</tr>`;
        const after = extra
          .filter((e) => e.after === r.key)
          .map((e) => `<tr class="extra">${e.cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
          .join('');
        return own + after;
      })
      .join('');
  const table = (list) =>
    `<table><thead>${head}</thead><tbody>${body(list)}</tbody></table>`;
  const content = pages
    ? pages
        .map(
          (p, i) =>
            `<section class="page">${i === 0 ? banner : ''}${table(p.rows)}<footer>${esc(p.footer)}</footer></section>`,
        )
        .join('')
    : `${banner}${table(rows)}`;
  return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><style>
@page { size: A4 landscape; margin: 14mm }
body { font-family: 'DejaVu Sans'; font-size: 9pt }
table { border-collapse: collapse; width: 100% }
th, td { border: 0.5pt solid #555; padding: 3pt 5pt; white-space: nowrap; text-align: start; vertical-align: top }
thead { display: table-header-group }
tr { break-inside: avoid }
.page { break-after: page }
.page:last-child { break-after: auto }
footer { margin-top: 6pt; font-size: 8pt }
${css}
</style></head><body>${content}</body></html>`;
}
const banner = (lang, extra = '') =>
  lang === 'ar'
    ? `<h3>كشف حساب المورد – Synthetic Supplier</h3><p>الفترة: 2026-07-01 إلى 2026-07-31 · العملة: SAR</p>${extra}`
    : `<h3>Synthetic Supplier – Statement of account</h3><p>Period: 2026-07-01 to 2026-07-31 · Currency: SAR</p>${extra}`;

const LEDGER_HEADERS = ['Date', 'Reference', 'Type', 'Bank Reference', 'Description', 'Amount'];
const ledgerCsv = (rows) =>
  [
    LEDGER_HEADERS,
    ...rows.map((r) => [r.date, r.ref, r.type ?? 'Invoice', r.bank ?? '', r.description ?? 'Posted', plain(r.minor)]),
  ]
    .map((r) => r.join(','))
    .join('\n');

/** One composite case. Keys: supplier rows s1.., ledger rows l1... */
export function compositeCase(pattern, variant, seed = 1) {
  const r = rng(seed * 7919 + pattern.length * 131 + variant.length);
  const n = r(100, 899);
  const amount = () => r(1000, 90000) * 10 + r(0, 9);
  const day = (d) => `2026-07-${String(d).padStart(2, '0')}`;
  const supplierRows = [];
  const ledgerRows = [];
  const approved = [];
  let contract;
  let html;
  const expectArabic = pattern === 'ARABIC';
  let splitAcross = null;
  let pageCount = null;
  let shownRows = null;
  const s = (row) => {
    const key = `s${supplierRows.length + 1}`;
    supplierRows.push({ key, ...row });
    return key;
  };
  const l = (row) => {
    const key = `l${ledgerRows.length + 1}`;
    ledgerRows.push({ key, ...row });
    return key;
  };
  const pair = (row, ledger = {}) => {
    const a = s(row);
    const b = l({ date: row.date, ref: row.ref, minor: row.minor, type: row.typeLedger ?? 'Invoice', bank: row.bank, ...ledger });
    return [a, b];
  };
  const both = (a, b) => approved.push({ a: [a], b: [b] });
  // Two ordinary invoices every case must still match: refusing everything
  // cannot pass.
  const controls = () => {
    for (let i = 0; i < 2; i++) {
      const [a, b] = pair({ date: day(3 + i), ref: `INV-C${n}${i}`, minor: amount(), type: 'Invoice' });
      both(a, b);
    }
  };
  const english = (row) => [row.date, row.ref, row.type ?? 'Invoice', row.description ?? 'Goods supplied', money(row.minor)];

  switch (pattern) {
    case 'EVIDENCE': {
      // Columns: Date | Invoice No | Bank Reference | Voucher No | Batch |
      // Document Type | Description | Amount
      const inv = { date: day(9), ref: `INV-${n}1`, voucher: `JV-${n}-1`, batch: `B-${n}`, minor: amount(), type: 'Invoice' };
      const pay = { date: day(11), ref: `PAY-${n}2`, bank: `TRF-${n}77`, voucher: `PV-${n}-2`, batch: `B-${n}`, minor: -amount(), type: 'Payment' };
      if (variant === 'insufficient') inv.ref = '';
      const [ia, ib] = pair(inv, variant === 'conflicting' ? { type: 'Credit Note' } : { ref: `INV-${n}1` });
      const [pa, pb] = pair(pay, { ref: `PAY-${n}2`, type: 'Payment' });
      if (variant === 'resolvable') both(ia, ib);
      both(pa, pb);
      controls();
      html = statementHtml({
        lang: 'en',
        banner: banner('en'),
        headers: ['Date', 'Invoice No', 'Bank Reference', 'Voucher No', 'Batch', 'Document Type', 'Description', 'Amount'],
        rows: supplierRows,
        cells: (x) => [x.date, x.ref, x.bank ?? '', x.voucher ?? '', x.batch ?? '', x.type, 'Goods supplied', money(x.minor)],
      });
      contract = {
        resolvable: {
          kind: 'solve',
          retained: [
            { key: ia, field: 'voucherReference', value: inv.voucher },
            { key: ia, field: 'batch', value: inv.batch, header: 'Batch' },
            { key: pa, field: 'bankReference', value: pay.bank },
          ],
        },
        insufficient: { kind: 'refuse', note: 'without an invoice number only the voucher and batch remain, which name no document' },
        conflicting: { kind: 'surface', signal: 'نوعا المستند مختلفان', keys: [ia] },
      }[variant];
      break;
    }
    case 'SPLIT2D': {
      const bank = `TRF-${n}88`;
      const total = amount() * 3;
      const parts = [Math.floor(total / 3) + 1100, Math.floor(total / 3) - 700];
      parts.push(total - parts[0] - parts[1]);
      const keys = parts.map((p, i) =>
        s({
          date: day(i === 2 ? 15 : 14),
          ref: `PAY-${n}`,
          bank: variant === 'insufficient' && i === 2 ? '' : variant === 'conflicting' && i === 1 ? `TRF-${n}89` : bank,
          minor: -p,
          type: 'Payment',
        }),
      );
      const lb = l({ date: day(14), ref: `PAY-${n}`, bank, minor: -total, type: 'Payment' });
      if (variant === 'resolvable') approved.push({ a: keys, b: [lb] });
      controls();
      html = statementHtml({
        lang: 'en',
        banner: banner('en'),
        headers: ['Date', 'Reference', 'Document Type', 'Bank Reference', 'Description', 'Amount'],
        rows: supplierRows,
        cells: (x) => [x.date, x.ref, x.type, x.bank ?? '', x.type === 'Payment' ? 'Transfer' : 'Goods supplied', money(x.minor)],
      });
      contract = {
        resolvable: { kind: 'solve' },
        insufficient: { kind: 'surface', signal: 'لم تثبت هوية دفعة واحدة|المجموعة الكاملة لا تستوفي', keys },
        conflicting: { kind: 'refuse', note: 'one part names another transfer' },
      }[variant];
      break;
    }
    case 'ARABIC': {
      // Arabic headers, labels and description; Arabic-Indic digits in the
      // amount. The ledger is an ordinary Latin CSV.
      const label = { resolvable: 'فاتورة ضريبية', insufficient: 'فاتورة مبدئية', conflicting: 'إشعار دائن' }[variant];
      const inv = { date: day(9), ref: `INV-${n}1`, minor: amount(), type: 'Invoice', label };
      const [ia, ib] = pair(inv);
      if (variant === 'resolvable') both(ia, ib);
      for (let i = 0; i < 2; i++) {
        const [a, b] = pair({ date: day(3 + i), ref: `INV-C${n}${i}`, minor: amount(), type: 'Invoice', label: 'فاتورة' });
        both(a, b);
      }
      html = statementHtml({
        lang: 'ar',
        banner: banner('ar'),
        headers: ['التاريخ', 'رقم الفاتورة', 'نوع المستند', 'الوصف', 'المبلغ'],
        rows: supplierRows,
        cells: (x) => [x.date, x.ref, x.label, 'بضائع موردة – Goods', arabicDigits(money(x.minor))],
      });
      contract = {
        resolvable: { kind: 'solve' },
        insufficient: { kind: 'surface', signal: 'نوع مستند غير متحقق', keys: [ia] },
        conflicting: { kind: 'surface', signal: 'نوعا المستند مختلفان|متعارضة', keys: [ia] },
      }[variant];
      break;
    }
    case 'SPLITREF': {
      // The reference cell is narrow, so the reference wraps inside it.
      const ref = { resolvable: `INV-2026-${n}41`, insufficient: `INV2026${n}41`, conflicting: `INV-2026-${n}41` }[variant];
      const inv = { date: day(9), ref, minor: amount(), type: 'Invoice' };
      const [ia, ib] = pair(inv);
      if (variant === 'conflicting') {
        // A second row right below whose reference begins like the tail.
        pair({ date: day(10), ref: `${n}41-X`, minor: amount(), type: 'Invoice' });
      }
      controls();
      html = statementHtml({
        lang: 'en',
        banner: banner('en'),
        headers: ['Date', 'Invoice No', 'Document Type', 'Description', 'Amount'],
        rows: supplierRows,
        cells: english,
        css: `td.c1 { white-space: normal; width: 34pt; max-width: 34pt; word-break: break-all }`,
      });
      contract = {
        kind: 'read-or-flag',
        note: 'the wrapped reference is either read whole or flagged; never approved on a fragment',
        keys: [ia],
        pairKey: ib,
      };
      break;
    }
    case 'CROSSPAGE': {
      // Enough rows that one transaction, with a long multi-line
      // description, begins at the foot of page 1 and ends on page 2.
      const filler = [];
      for (let i = 0; i < 30; i++) filler.push({ date: day(1 + (i % 28)), ref: `INV-F${n}${String(i).padStart(2, '0')}`, minor: amount(), type: 'Invoice' });
      for (const f of filler) {
        const [a, b] = pair(f);
        both(a, b);
      }
      const long = { date: day(20), ref: `INV-L${n}`, minor: amount(), type: 'Invoice', long: true };
      const [la, lb] = pair(long);
      if (variant !== 'conflicting') both(la, lb);
      const tail =
        variant === 'conflicting'
          ? 'Delivery note 7 of 9 amount 1,000.00 reversed on credit memo'
          : 'Delivery of goods in several consignments, see delivery notes';
      html = statementHtml({
        lang: 'en',
        banner: banner('en'),
        headers: ['Date', 'Invoice No', 'Document Type', 'Description', 'Amount'],
        rows: supplierRows,
        cells: (x) => [x.date, x.ref, x.type, x.long ? `${tail} ${'— continued line '.repeat(variant === 'insufficient' ? 150 : 120)}` : 'Goods supplied', money(x.minor)],
        css: `tr { break-inside: auto } td.c3 { white-space: normal; width: 200pt }`,
      });
      splitAcross = { key: la, ref: long.ref };
      contract =
        variant === 'conflicting'
          ? { kind: 'read-or-flag', note: 'a continuation line holding a number must not become a transaction', keys: [la], pairKey: lb }
          : { kind: 'read-or-flag', note: 'the row is read whole or flagged, never split into two transactions', keys: [la], pairKey: lb };
      break;
    }
    case 'REPEAT': {
      const list = [];
      for (let i = 0; i < 9; i++) {
        const [a, b] = pair({ date: day(2 + i * 2), ref: `INV-R${n}${i}`, minor: amount(), type: 'Invoice' });
        both(a, b);
        list.push(a);
      }
      const running = (upto) => supplierRows.slice(0, upto).reduce((t, x) => t + x.minor, 0);
      const extra = [
        { after: list[2], cells: ['', '', '', variant === 'insufficient' ? '' : 'Carried forward', money(running(3))] },
        { after: list[5], cells: ['', '', '', variant === 'insufficient' ? '' : 'Carried forward', money(running(6))] },
        { after: list[8], cells: ['', '', '', 'Total', money(variant === 'conflicting' ? running(9) + 5000 : running(9))] },
      ];
      html = statementHtml({
        lang: 'en',
        banner: banner('en'),
        headers: ['Date', 'Invoice No', 'Document Type', 'Description', 'Amount'],
        extra,
        pages: [
          { rows: supplierRows.slice(0, 3), footer: 'Page 1 of 3' },
          { rows: supplierRows.slice(3, 6), footer: 'Page 2 of 3' },
          { rows: supplierRows.slice(6), footer: 'Page 3 of 3' },
        ],
        cells: english,
      });
      pageCount = 3;
      contract = { kind: 'read', note: 'carried-forward and total lines are never transactions; every invoice is read once' };
      break;
    }
    case 'TWOREF': {
      // "Reference" is the customer's order reference; "Invoice No" names
      // the document. In the conflicting variant the order references equal
      // other invoices' numbers in the ledger.
      const a1 = { date: day(9), ref: `INV-${n}1`, other: `PO-${n}1`, minor: amount(), type: 'Invoice' };
      const a2 = { date: day(10), ref: `INV-${n}2`, other: `PO-${n}2`, minor: amount(), type: 'Invoice' };
      if (variant === 'conflicting') {
        a1.other = `INV-${n}2`;
        a2.other = `INV-${n}1`;
      }
      if (variant === 'insufficient') a2.ref = '';
      const [x1, y1] = pair(a1);
      const [x2, y2] = pair(a2, { ref: `INV-${n}2` });
      both(x1, y1);
      if (variant !== 'insufficient') both(x2, y2);
      controls();
      html = statementHtml({
        lang: 'en',
        banner: banner('en'),
        headers: ['Date', 'Reference', 'Invoice No', 'Document Type', 'Description', 'Amount'],
        rows: supplierRows,
        cells: (x) => [x.date, x.other ?? `PO-${x.ref}`, x.ref, x.type, 'Goods supplied', money(x.minor)],
      });
      contract = { kind: 'solve', referenceHeader: 'Invoice No', note: 'matched on the invoice number the accountant chooses, never on the order reference' };
      break;
    }
    case 'MISSINGPAGE': {
      const list = [];
      for (let i = 0; i < 9; i++) {
        const [a, b] = pair({ date: day(2 + i * 2), ref: `INV-M${n}${i}`, minor: amount(), type: 'Invoice' });
        list.push([a, b]);
      }
      const opening = 0;
      const closing = supplierRows.reduce((t, x) => t + x.minor, opening);
      let pages = [
        { rows: supplierRows.slice(0, 3), footer: 'Page 1 of 3' },
        { rows: supplierRows.slice(3, 6), footer: 'Page 2 of 3' },
        { rows: supplierRows.slice(6), footer: 'Page 3 of 3' },
      ];
      if (variant === 'insufficient') pages = [pages[0], pages[2]];
      if (variant === 'conflicting') pages = [pages[0], pages[1], pages[1], pages[2]];
      const shown = pages.flatMap((p) => p.rows.map((x) => x.key));
      // Rows shown once may match; a doubled page's rows are two lines for
      // one invoice each and must not be approved.
      const once = (k) => shown.filter((x) => x === k).length === 1;
      for (const [a, b] of list) if (once(a)) both(a, b);
      html = statementHtml({
        lang: 'en',
        banner: banner('en', `<p>Opening balance ${money(opening)} · Closing balance ${money(closing)}</p>`),
        headers: ['Date', 'Invoice No', 'Document Type', 'Description', 'Amount'],
        pages,
        cells: english,
      });
      pageCount = pages.length;
      // What the file actually shows, doubled page included.
      shownRows = pages.flatMap((p) => p.rows);
      contract = {
        resolvable: { kind: 'read' },
        insufficient: { kind: 'incomplete', note: 'a page is missing: the statement must not be taken as complete, and absent rows are not invented' },
        conflicting: { kind: 'incomplete', note: 'a page appears twice: its rows must not be counted twice as settled' },
      }[variant];
      break;
    }
    default:
      throw new Error(`unknown pattern ${pattern}`);
  }
  return {
    id: `PDFC-${pattern}-${variant}-${seed}`,
    pattern,
    variant,
    seed,
    version: PDF_COMPOSITE_VERSION,
    html,
    supplierRows,
    ledgerRows,
    ledgerCsv: ledgerCsv(ledgerRows),
    shownRows: shownRows ?? supplierRows,
    approved,
    contract,
    independent: {
      expectArabic,
      splitAcross,
      pageCount,
      // Every value written into a cell, to be found again in the file.
      cellValues: (shownRows ?? supplierRows).flatMap((x) =>
        [x.ref, x.bank, x.voucher, x.batch, x.date].filter(Boolean),
      ),
    },
  };
}
export const PATTERNS = ['EVIDENCE', 'SPLIT2D', 'ARABIC', 'SPLITREF', 'CROSSPAGE', 'REPEAT', 'TWOREF', 'MISSINGPAGE'];
export const VARIANTS = ['resolvable', 'insufficient', 'conflicting'];
