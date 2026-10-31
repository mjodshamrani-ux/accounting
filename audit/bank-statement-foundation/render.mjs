// Renders the stories into the frozen assets: each statement printed to PDF
// by Chromium (DejaVu Sans, a real text layer with embedded fonts), each
// cashbook as CSV, and BS01 also as statement CSV/XLSX and cashbook XLSX.
// The PDF bytes include Chromium's dates, so a re-render is not byte-equal:
// the committed files under frozen/ are the assets, sealed by
// INPUT-MANIFEST.json; this file is their recipe. The facts file is not
// stored: `node stories.mjs` regenerates it byte for byte, and the seal
// carries its hash.
//   MIZAN_CHROMIUM=... node audit/bank-statement-foundation/render.mjs [--out dir]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
import {
  STORIES_VERSION,
  buildStories,
  factsJson,
  printedStatement,
} from './stories.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: { out: { type: 'string', default: resolve(here, 'frozen') } },
});
const out = resolve(args.out);
mkdirSync(out, { recursive: true });

const AR = '٠١٢٣٤٥٦٧٨٩';
const arDigits = (s) =>
  s
    .replace(/\d/g, (d) => AR[d])
    .replace(/,/g, '٬')
    .replace(/\./g, '٫');
const money = (minor) => {
  if (!minor) return '';
  const sign = minor < 0 ? '-' : '';
  const a = Math.abs(minor);
  return `${sign}${String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(a % 100).padStart(2, '0')}`;
};
const balanceText = (minor) =>
  minor < 0 ? `${money(-minor)} DR` : money(minor) || '0.00';
const plain = (minor) => (minor ? (minor / 100).toFixed(2) : '');
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

const LABELS = {
  en: {
    bank: 'Sample Commercial Bank',
    title: 'Account Statement',
    account: 'Account',
    currency: 'Currency',
    period: 'Period',
    headers: [
      'Date',
      'Value Date',
      'Description',
      'Reference',
      'Withdrawal',
      'Deposit',
      'Balance',
    ],
    opening: 'Opening balance',
    bf: 'Balance brought forward',
    cf: 'Balance carried forward',
    closing: 'Closing balance',
    totals: 'Total withdrawals / deposits',
    pageTotals: 'Page total withdrawals / deposits',
    page: (p, n) => `Page ${p} of ${n}`,
  },
  ar: {
    bank: 'البنك التجاري التجريبي',
    title: 'كشف حساب',
    account: 'رقم الحساب',
    currency: 'العملة',
    period: 'الفترة',
    headers: [
      'التاريخ',
      'تاريخ القيمة',
      'البيان',
      'المرجع',
      'سحب',
      'إيداع',
      'الرصيد',
    ],
    opening: 'الرصيد الافتتاحي',
    bf: 'رصيد منقول من الصفحة السابقة',
    cf: 'رصيد منقول إلى الصفحة التالية',
    closing: 'الرصيد الختامي',
    totals: 'إجمالي السحب / الإيداع',
    pageTotals: 'إجمالي الصفحة سحب / إيداع',
    page: (p, n) => `صفحة ${p} من ${n}`,
  },
};

function statementHtml(s) {
  const L = LABELS[s.layout];
  const num = (t) =>
    s.layout === 'ar' && s.digits !== 'latin' ? arDigits(t) : t;
  const st = printedStatement(s);
  const cell = (t, cls = '') => `<td class="${cls}">${esc(t)}</td>`;
  const label = (text, amount) =>
    `<tr class="carry"><td colspan="6">${esc(text)}</td>${cell(num(balanceText(amount)), 'amt')}</tr>`;
  const line = (l) => {
    switch (l.kind) {
      case 'opening':
        return label(L.opening, l.balance);
      case 'brought-forward':
        return label(L.bf, l.balance);
      case 'carried-forward':
        return label(L.cf, l.balance);
      case 'closing':
        return label(L.closing, l.balance);
      case 'totals':
      case 'page-totals':
        return `<tr class="carry"><td colspan="4">${esc(l.kind === 'totals' ? L.totals : L.pageTotals)}</td>${cell(num(money(l.withdrawal)), 'amt')}${cell(num(money(l.deposit)), 'amt')}<td></td></tr>`;
      case 'continuation':
        return `<tr class="cont"><td></td><td></td>${cell(l.text, 'desc')}<td></td><td></td><td></td><td></td></tr>`;
      case 'movement':
        return `<tr>${cell(num(l.date), 'date')}${cell(num(l.valueDate), 'date')}${cell(l.description, 'desc')}${cell(l.reference, 'ref')}${cell(num(money(l.withdrawal)), 'amt')}${cell(num(money(l.deposit)), 'amt')}${cell(num(balanceText(l.balance)), 'amt')}</tr>`;
    }
    throw new Error(`unknown line ${l.kind}`);
  };
  const body = st.pages
    .map(
      (page) => `<section class="page">
<header><h1>${esc(L.bank)}</h1><h2>${esc(L.title)}</h2>
<p>${esc(L.account)}: ${st.account} · ${esc(L.currency)}: ${st.currency} · ${esc(L.period)}: ${num(st.period.start)} — ${num(st.period.end)}</p></header>
<table><thead><tr>${L.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${page.lines.map(line).join('\n')}</tbody></table>
<footer>${esc(num(L.page(page.number, page.of)))}</footer></section>`,
    )
    .join('\n');
  return `<!doctype html><html lang="${s.layout}" dir="${s.layout === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>Synthetic account statement ${s.id}</title><style>
@page { size: A4; margin: 14mm 12mm; }
body { font-family: 'DejaVu Sans'; font-size: 8pt; color: #000; }
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
h1 { font-size: 12pt; margin: 0; } h2 { font-size: 10pt; margin: 2pt 0; } header p { margin: 2pt 0 8pt; }
table { width: 100%; border-collapse: collapse; }
th { text-align: start; border-bottom: 1px solid #000; padding: 3pt 2pt; }
td { padding: 2pt 2pt; vertical-align: top; }
td.amt, td.ref, td.date { white-space: nowrap; } td.amt { text-align: end; }
td.desc { white-space: pre-line; }
tr.carry td { font-weight: bold; }
footer { margin-top: 8pt; text-align: center; }
</style></head><body>${body}</body></html>`;
}

const csv = (rows) =>
  `${rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\r\n')}\r\n`;
const cashbookRows = (s) => [
  ['Date', 'Voucher', 'Description', 'Reference', 'Receipts', 'Payments'],
  ...s.cash.map((r) => [
    r.date,
    r.voucher,
    r.description,
    r.reference,
    plain(r.receipt),
    plain(r.payment),
  ]),
];
function statementTable(s) {
  let balance = s.opening;
  return [
    [
      'Date',
      'Value Date',
      'Description',
      'Reference',
      'Withdrawal',
      'Deposit',
      'Balance',
    ],
    ['', '', 'Opening balance', '', '', '', (s.opening / 100).toFixed(2)],
    ...s.bank.map((r) => {
      balance += r.deposit - r.withdrawal;
      return [
        r.date,
        r.valueDate,
        r.description.replace('\n', ' — '),
        r.reference,
        plain(r.withdrawal),
        plain(r.deposit),
        (balance / 100).toFixed(2),
      ];
    }),
  ];
}
async function xlsx(rows, file) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'tarasuf-synthetic';
  wb.created = new Date('2026-07-31T00:00:00Z');
  wb.modified = wb.created;
  const ws = wb.addWorksheet('Sheet1');
  for (const r of rows) ws.addRow(r);
  writeFileSync(file, Buffer.from(await wb.xlsx.writeBuffer()));
}

const stories = buildStories();
const browser = await chromium.launch(
  process.env.MIZAN_CHROMIUM
    ? { executablePath: process.env.MIZAN_CHROMIUM }
    : {},
);
const page = await browser.newPage();
const written = [];
for (const s of stories) {
  await page.setContent(statementHtml(s), { waitUntil: 'load' });
  const pdf = resolve(out, `${s.id}-statement.pdf`);
  writeFileSync(
    pdf,
    await page.pdf({
      format: 'A4',
      printBackground: false,
      preferCSSPageSize: true,
    }),
  );
  const cb = resolve(out, `${s.id}-cashbook.csv`);
  writeFileSync(cb, csv(cashbookRows(s)));
  written.push(pdf, cb);
  if (s.id === 'BS01') {
    const sc = resolve(out, 'BS01-statement.csv');
    writeFileSync(sc, csv(statementTable(s)));
    await xlsx(statementTable(s), resolve(out, 'BS01-statement.xlsx'));
    await xlsx(cashbookRows(s), resolve(out, 'BS01-cashbook.xlsx'));
    written.push(
      sc,
      resolve(out, 'BS01-statement.xlsx'),
      resolve(out, 'BS01-cashbook.xlsx'),
    );
  }
}
const version = browser.version();
await browser.close();
const facts = factsJson(stories);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const manifest = {
  version: STORIES_VERSION,
  producer: `Chromium ${version} page.pdf, DejaVu Sans; exceljs; CSV UTF-8 CRLF`,
  facts: {
    file: 'stories.json',
    stored: false,
    recipe: 'node audit/bank-statement-foundation/stories.mjs',
    sha256: sha(facts),
    bytes: Buffer.byteLength(facts),
  },
  files: written.map((f) => {
    const b = readFileSync(f);
    return { file: f.slice(out.length + 1), sha256: sha(b), bytes: b.length };
  }),
};
writeFileSync(
  resolve(out, 'INPUT-MANIFEST.json'),
  `${JSON.stringify(manifest, null, 1)}\n`,
);
console.log(
  JSON.stringify({ files: manifest.files.length, producer: manifest.producer }),
);
