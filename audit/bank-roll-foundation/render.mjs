// Renders the ROLL-1 stories into the frozen assets: each period's
// statement printed to PDF by Chromium exactly as the bank statement
// foundation prints its statements (same page template, DejaVu Sans, real
// text layer), each period's cashbook as CSV, and the previous-period
// session file each story brings, written here from the documented session
// format, never by the product:
//   bank-statement-lifecycle-1: {format, version, files: [statement,
//     cashbook] as {name, sha256, data (base64)}, scope, decisions};
//   bank-statement-roll-1 (proposed, contract.json): the same, and
//     `previous`: the previous session file as {name, sha256, data}.
// A decision's context is the one bank-statement-lifecycle-1 documents: the
// lifecycle version, the statement family, both file hashes, the statement
// currency and printed period, the confirmed closing (null for a PDF) and
// how completeness was proved ('printed'). The PDF bytes include Chromium's
// dates, so a re-render is not byte-equal: the committed files are the
// assets, sealed by INPUT-MANIFEST.json.
//   MIZAN_CHROMIUM=... node audit/bank-roll-foundation/render.mjs [--out dir]
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { STORIES_VERSION, buildStories, facts, printedStatement } from './stories.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({ options: { out: { type: 'string', default: resolve(here, 'frozen') } } });
const out = resolve(args.out);
mkdirSync(out, { recursive: true });

const AR = '٠١٢٣٤٥٦٧٨٩';
const arDigits = (s) => s.replace(/\d/g, (d) => AR[d]).replace(/,/g, '٬').replace(/\./g, '٫');
const money = (minor) => {
  if (!minor) return '';
  const sign = minor < 0 ? '-' : '';
  const a = Math.abs(minor);
  return `${sign}${String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(a % 100).padStart(2, '0')}`;
};
const balanceText = (minor) => (minor < 0 ? `${money(-minor)} DR` : money(minor) || '0.00');
const plain = (minor) => (minor ? (minor / 100).toFixed(2) : '');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

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
  const st = printedStatement(p, story.id);
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
const cashbookCsv = (p) => csv([
  ['Date', 'Voucher', 'Description', 'Reference', 'Receipts', 'Payments'],
  ...p.cash.map((r) => [r.date, r.voucher, r.description, r.reference, plain(r.receipt), plain(r.payment)]),
]);

/** A session file from originals, scope and decisions, in the documented
 * format; `previous` makes it the proposed roll format. */
function session(statement, cashbook, p, decisions, previous) {
  const files = [statement, cashbook].map((f) => ({ name: f.name, sha256: sha(f.bytes), data: f.bytes.toString('base64') }));
  const context = JSON.stringify([
    'bank-statement-lifecycle-1', 'bank-statement-native-1', files.map((f) => f.sha256), p.currency,
    { start: p.period.start, end: p.period.end }, null, 'printed',
  ]);
  const body = {
    format: 'tarasuf-bank-statement-session',
    version: previous ? 'bank-statement-roll-1' : 'bank-statement-lifecycle-1',
    files,
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions: decisions.map((d, i) => ({
      id: `D${i + 1}`, type: d.type, context, at: `2026-08-01T09:0${i}:00.000Z`,
      case: d.case, statement: d.statement, cashbook: d.cashbook, note: d.note,
    })),
  };
  if (previous) body.previous = { name: previous.name, sha256: sha(previous.bytes), data: previous.bytes.toString('base64') };
  return Buffer.from(JSON.stringify(body));
}

const stories = buildStories();
const browser = await chromium.launch(process.env.MIZAN_CHROMIUM ? { executablePath: process.env.MIZAN_CHROMIUM } : {});
const page = await browser.newPage();
const written = [];
for (const s of stories) {
  const files = {};
  for (const p of s.periods) {
    await page.setContent(statementHtml(s, p), { waitUntil: 'load' });
    const pdf = Buffer.from(await page.pdf({ format: 'A4', printBackground: false, preferCSSPageSize: true }));
    const cb = Buffer.from(cashbookCsv(p));
    files[p.month] = {
      statement: { name: `${p.id}-statement.pdf`, bytes: pdf },
      cashbook: { name: `${p.id}-cashbook.csv`, bytes: cb },
      period: p,
    };
    for (const f of [files[p.month].statement, files[p.month].cashbook]) {
      writeFileSync(resolve(out, f.name), f.bytes);
      written.push(f.name);
    }
  }
  if (!s.previous) continue;
  // The chain: each held period's session carries the one before it.
  let previous = null;
  for (const [k, month] of s.previous.holds.entries()) {
    const f = files[month];
    const last = k === s.previous.holds.length - 1;
    const bytes = session(f.statement, f.cashbook, f.period, last ? s.previous.decisions : [], previous);
    previous = { name: `${s.id}-${month}-session.json`, bytes };
  }
  let bytes = previous.bytes;
  if (s.previous.tamper) {
    // The cashbook inside the session edited after saving, its recorded
    // fingerprint kept.
    const doc = JSON.parse(bytes.toString('utf8'));
    const text = Buffer.from(doc.files[1].data, 'base64').toString('utf8');
    const edited = text.replace(',6400.00\r\n', ',6400.01\r\n');
    if (edited === text) throw new Error(`${s.id}: nothing to tamper`);
    doc.files[1].data = Buffer.from(edited).toString('base64');
    bytes = Buffer.from(JSON.stringify(doc));
  }
  writeFileSync(resolve(out, `${s.id}-previous-session.json`), bytes);
  written.push(`${s.id}-previous-session.json`);
}
const version = browser.version();
await browser.close();
writeFileSync(resolve(out, 'stories.json'), `${JSON.stringify(facts(stories), null, 1)}\n`);
console.log(JSON.stringify({ version: STORIES_VERSION, chromium: version, files: written.length }));
