// Renders the TOL-1 foundation stories into the frozen assets, as the
// REVIEW-1 foundation renders its own (this file is its render.mjs with these
// stories, amounts printed to the currency's exponent, and no corrected
// cashbook): each statement printed to PDF by Chromium exactly as the bank
// statement foundation prints its statements (same page template, DejaVu
// Sans, real text layer), each cashbook as CSV. The PDF bytes include
// Chromium's dates, so a re-render is not byte-equal: the committed files
// are the assets, sealed by INPUT-MANIFEST.json.
//   MIZAN_CHROMIUM=... node audit/bank-tolerance-foundation/render.mjs [--out dir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { STORIES_VERSION, buildStories, facts, statement } from './stories.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({ options: { out: { type: 'string', default: resolve(here, 'frozen') } } });
const out = resolve(args.out);
mkdirSync(out, { recursive: true });

const AR = '٠١٢٣٤٥٦٧٨٩';
const arDigits = (s) => s.replace(/\d/g, (d) => AR[d]).replace(/,/g, '٬').replace(/\./g, '٫');
const EXPONENT = { SAR: 2, KWD: 3 };
// Amounts in minor units, printed to the currency's exponent.
let exponent = 2;
const money = (minor) => {
  if (!minor) return '';
  const unit = 10 ** exponent;
  const sign = minor < 0 ? '-' : '';
  const a = Math.abs(minor);
  return `${sign}${String(Math.floor(a / unit)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(a % unit).padStart(exponent, '0')}`;
};
const balanceText = (minor) => (minor < 0 ? `${money(-minor)} DR` : money(minor) || (0).toFixed(exponent));
const plain = (minor) => (minor ? (minor / 10 ** exponent).toFixed(exponent) : '');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const LABELS = {
  en: {
    bank: 'Sample Commercial Bank', title: 'Account Statement', account: 'Account', currency: 'Currency', period: 'Period',
    headers: ['Date', 'Value Date', 'Description', 'Reference', 'Withdrawal', 'Deposit', 'Balance'],
    opening: 'Opening balance', bf: 'Balance brought forward', cf: 'Balance carried forward', closing: 'Closing balance',
    totals: 'Total withdrawals / deposits', page: (p, n) => `Page ${p} of ${n}`,
  },
  ar: {
    bank: 'البنك التجاري التجريبي', title: 'كشف حساب', account: 'رقم الحساب', currency: 'العملة', period: 'الفترة',
    headers: ['التاريخ', 'تاريخ القيمة', 'البيان', 'المرجع', 'سحب', 'إيداع', 'الرصيد'],
    opening: 'الرصيد الافتتاحي', bf: 'رصيد منقول من الصفحة السابقة', cf: 'رصيد منقول إلى الصفحة التالية', closing: 'الرصيد الختامي',
    totals: 'إجمالي السحب / الإيداع', page: (p, n) => `صفحة ${p} من ${n}`,
  },
};

function statementHtml(story, p) {
  const L = LABELS[story.layout];
  const num = (t) => (story.layout === 'ar' ? arDigits(t) : t);
  const st = statement(p, story.id);
  const cell = (t, cls = '') => `<td class="${cls}">${esc(t)}</td>`;
  const label = (text, amount) => `<tr class="carry"><td colspan="6">${esc(text)}</td>${cell(num(balanceText(amount)), 'amt')}</tr>`;
  const line = (l) => {
    switch (l.kind) {
      case 'opening': return label(L.opening, l.balance);
      case 'brought-forward': return label(L.bf, l.balance);
      case 'carried-forward': return label(L.cf, l.balance);
      case 'closing': return label(L.closing, l.balance);
      case 'totals':
        return `<tr class="carry"><td colspan="4">${esc(L.totals)}</td>${cell(num(money(l.withdrawal)), 'amt')}${cell(num(money(l.deposit)), 'amt')}<td></td></tr>`;
      case 'movement':
        return `<tr>${cell(num(l.date), 'date')}${cell(num(l.valueDate), 'date')}${cell(l.description, 'desc')}${cell(l.reference, 'ref')}${cell(num(money(l.withdrawal)), 'amt')}${cell(num(money(l.deposit)), 'amt')}${cell(num(balanceText(l.balance)), 'amt')}</tr>`;
    }
    throw new Error(`unknown line ${l.kind}`);
  };
  const body = st.pages.map((page) => `<section class="page">
<header><h1>${esc(L.bank)}</h1><h2>${esc(L.title)}</h2>
<p>${esc(L.account)}: ${st.account} · ${esc(L.currency)}: ${st.currency} · ${esc(L.period)}: ${num(st.period.start)} — ${num(st.period.end)}</p></header>
<table><thead><tr>${L.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${page.lines.map(line).join('\n')}</tbody></table>
<footer>${esc(num(L.page(page.number, page.of)))}</footer></section>`).join('\n');
  return `<!doctype html><html lang="${story.layout}" dir="${story.layout === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>Synthetic account statement ${p.id}</title><style>
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

const csv = (rows) => `${rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\r\n')}\r\n`;
const cashbookCsv = (rows) => csv([
  ['Date', 'Voucher', 'Description', 'Reference', 'Receipts', 'Payments'],
  ...rows.map((r) => [r.date, r.voucher, r.description, r.reference, plain(r.receipt), plain(r.payment)]),
]);

const stories = buildStories();
const browser = await chromium.launch(process.env.MIZAN_CHROMIUM ? { executablePath: process.env.MIZAN_CHROMIUM } : {});
const page = await browser.newPage();
const written = [];
for (const s of stories) {
  for (const p of s.periods) {
    exponent = EXPONENT[p.currency];
    await page.setContent(statementHtml(s, p), { waitUntil: 'load' });
    const pdf = Buffer.from(await page.pdf({ format: 'A4', printBackground: false, preferCSSPageSize: true }));
    for (const [name, bytes] of [
      [`${p.id}-statement.pdf`, pdf],
      [`${p.id}-cashbook.csv`, Buffer.from(cashbookCsv(p.cash))],
    ]) {
      writeFileSync(resolve(out, name), bytes);
      written.push(name);
    }
  }
}
const version = browser.version();
await browser.close();
writeFileSync(resolve(out, 'stories.json'), `${JSON.stringify(facts(stories), null, 1)}\n`);
console.log(JSON.stringify({ version: STORIES_VERSION, chromium: version, files: written.length }));
