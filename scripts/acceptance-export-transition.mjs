// Version-transition gate for workpapers and sessions (V1.1).
//
// scripts/acceptance-export-parity.mjs stays the strict reference: any cell or
// session difference from the baseline build fails it. Between two engine
// versions that is expected to fail, so this gate names exactly what may
// change and refuses everything else:
//   - the engine version, only from FROM to TO, and only where it is written
//     (the Export Metadata cell and the session's "engine");
//   - columns appended after the baseline's last column of a sheet, never a
//     moved or removed column;
//   - the appended Retained Evidence cells, each checked against a value
//     computed here from the uploaded CSV text, not by the engine.
// Any other difference in a value, reference, decision or status fails. The
// new build must give the same workpaper and session in Arabic and English,
// and must refuse a session saved by the baseline with a clear message,
// without presenting its decisions as restored.
//   BASELINE=work/v1-bb529b6/dist FROM=0.3.15-experimental TO=0.3.16-experimental \
//   APPENDED="Match Evidence:Retained Evidence" MIZAN_CHROMIUM=... \
//   node scripts/acceptance-export-transition.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

const BASELINE = process.env.BASELINE ?? 'work/v1-bb529b6/dist';
const FROM = process.env.FROM ?? '0.3.15-experimental';
const TO = process.env.TO ?? '0.3.16-experimental';
const APPENDED = (process.env.APPENDED ?? '')
  .split(',')
  .filter(Boolean)
  .map((x) => {
    const [sheet, header] = x.split(':');
    return { sheet, header };
  });
const OUT = process.env.OUT ?? 'work/export-transition.json';

function serve(dir) {
  const root = path.resolve(dir);
  const s = createServer(async (req, res) => {
    try {
      let rel = new URL(req.url, 'http://x').pathname.replace(/^\/mizan-test\//, '/');
      if (rel === '/') rel = '/index.html';
      const f = path.resolve(root, '.' + rel);
      res.writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html; charset=utf-8',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
            '.wasm': 'application/wasm',
          }[path.extname(f)] ?? 'application/octet-stream',
      });
      res.end(await readFile(f));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s)));
}
const T = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MIZAN_CHROMIUM ? { executablePath: process.env.MIZAN_CHROMIUM } : {}),
});
const LABELS = {
  ar: {
    demo: 'جرّب المثال',
    run: 'تحقق وقارن',
    ws: 'مساحة المراجعة',
    matched: 'المطابقات',
    details: 'تفاصيل الحالة',
    note: 'سبب القرار',
    unlink: 'فك الربط وإعادته للمراجعة',
    prep: 'إعداد ورقة العمل',
    reviewer: 'اسم المراجع',
    notes: 'ملاحظات المراجعة',
    draft: 'تنزيل مسودة Excel',
    save: 'حفظ الجلسة للمتابعة لاحقًا',
    supplier: 'كشف المورد',
    ledger: 'تقرير الحسابات الدائنة',
    confirm: 'تأكيد البيانات',
    currency: 'العملة',
    cutoff: 'تاريخ المقارنة',
    resume: 'استئناف جلسة محلية',
    incompatible: 'إصدار ملف الجلسة غير متوافق. استخدم ملفات المصدر الأصلية.',
  },
  en: {
    demo: 'Try the sample',
    run: 'Check and compare',
    ws: 'Review workspace',
    matched: 'Matched',
    details: 'Case details',
    note: 'Reason for the decision',
    unlink: 'Unlink and return to review',
    prep: 'Prepare the workpaper',
    reviewer: 'Reviewer name',
    notes: 'Review notes',
    draft: 'Download Excel draft',
    save: 'Save session to continue later',
    supplier: 'Supplier statement',
    ledger: 'Accounts payable report',
    confirm: 'Confirm data',
    currency: 'Currency',
    cutoff: 'Cut-off date',
    resume: 'Resume a local session',
    incompatible: 'The session file version is not compatible. Use the original source files.',
  },
};
// The evidence scenario's files: a Batch column the engine keeps aside.
const HEAD = 'Date,Invoice No,Type,Batch,Description,Amount';
const SUPPLIER = [
  HEAD,
  '2026-08-03,INV-5101,Invoice,B-31,Goods supplied,1250.00',
  '2026-08-05,INV-5102,Invoice,B-31,Goods supplied,480.50',
  '2026-08-09,INV-5103,Invoice,B-32,Services,75.00',
];
const LEDGER = [
  HEAD,
  '2026-08-03,INV-5101,Invoice,G-7001,Purchases,1250.00',
  '2026-08-05,INV-5102,Invoice,G-7001,Purchases,480.50',
  '2026-08-12,INV-5199,Invoice,G-7002,Purchases,99.00',
];
/** The Retained Evidence text expected for a source row, from the CSV text:
 * the batch is the only value no other field keeps (the invoice number is
 * the reference; "Invoice" is already the classified type). */
const expectedRetained = (side, row) => {
  const line = (side === 'supplier' ? SUPPLIER : LEDGER)[row - 1];
  const batch = line?.split(',')[3];
  return batch ? `batch (Batch): ${batch}` : '';
};

async function open(dir, lang) {
  const server = await serve(dir);
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/mizan-test/`);
  await page.waitForFunction(() => !document.querySelector('.notice.loading'));
  if (lang === 'en') await page.locator('.language-switch button[lang="en"]').click();
  return { page, close: async () => (await context.close(), server.close()) };
}
async function workpaper(page, L) {
  await page.getByRole('button', { name: L.prep }).click();
  await page.getByRole('textbox', { name: L.reviewer, exact: true }).fill('Reviewer — مراجع');
  await page.getByRole('textbox', { name: L.notes, exact: true }).fill('notes — ملاحظات');
  const xe = page.waitForEvent('download');
  await page.getByRole('button', { name: L.draft }).click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await (await xe).path());
  const cells = {};
  const layout = {};
  for (const sheet of wb.worksheets) {
    layout[sheet.name] = (sheet.getRow(1).values ?? []).slice(1).map(String);
    sheet.eachRow((row, r) =>
      row.eachCell((cell, c) => {
        cells[`${sheet.name}!${r}:${c}`] = JSON.stringify(
          cell.value instanceof Date ? cell.value.toISOString() : cell.value,
        ).replace(T, '<t>');
      }),
    );
  }
  const se = page.waitForEvent('download');
  await page.getByRole('button', { name: L.save }).click();
  const session = (await readFile(await (await se).path(), 'utf8')).replace(T, '<t>');
  return { sheets: wb.worksheets.map((s) => s.name), layout, cells, session };
}
async function demo(dir, lang) {
  const L = LABELS[lang];
  const { page, close } = await open(dir, lang);
  await page.getByRole('button', { name: L.demo, exact: true }).click();
  await page.getByRole('button', { name: L.run, exact: true }).click();
  await page.getByRole('heading', { name: L.ws }).waitFor();
  await page.getByRole('tab', { name: L.matched, exact: true }).click();
  await page.getByRole('button', { name: L.details, exact: true }).first().click();
  await page.getByRole('textbox', { name: L.note, exact: true }).fill('transition check — فحص');
  await page.getByRole('button', { name: L.unlink }).click();
  await page.waitForFunction(() => document.querySelector('.metric strong')?.textContent === '1');
  const out = await workpaper(page, L);
  await close();
  return out;
}
async function evidence(dir, lang) {
  const L = LABELS[lang];
  const { page, close } = await open(dir, lang);
  for (const [label, name, lines] of [
    [L.supplier, 'supplier-august.csv', SUPPLIER],
    [L.ledger, 'ledger-august.csv', LEDGER],
  ]) {
    await page.getByLabel(label, { exact: true }).setInputFiles({
      name,
      mimeType: 'text/csv',
      buffer: Buffer.from(lines.join('\n')),
    });
    await page.waitForFunction(
      () => !/قراءة الملف على جهازك|Reading the file on your device/.test(document.body.innerText),
    );
  }
  await page.getByRole('button', { name: L.confirm, exact: true }).click();
  await page.getByLabel(L.currency, { exact: true }).waitFor();
  await page.getByLabel(L.currency, { exact: true }).fill('SAR');
  const cutoff = page.getByLabel(L.cutoff, { exact: true });
  if (await cutoff.count()) await cutoff.fill('2026-08-31');
  await page.getByRole('button', { name: L.run, exact: true }).click();
  await page.getByRole('heading', { name: L.ws }).waitFor();
  const out = await workpaper(page, L);
  await close();
  return out;
}
/** A session saved by the baseline, loaded into the new build. */
async function oldSession(dir, lang, session) {
  const L = LABELS[lang];
  const { page, close } = await open(dir, lang);
  await mkdir('work', { recursive: true });
  await page.getByLabel(L.resume, { exact: true }).setInputFiles({
    name: 'baseline-session.json',
    mimeType: 'application/json',
    buffer: Buffer.from(session),
  });
  await page.getByText(L.incompatible).first().waitFor({ timeout: 20000 });
  const shown = await page.getByText(L.incompatible).count();
  const workspace = await page.getByRole('heading', { name: L.ws }).count();
  await close();
  return { messageShown: shown > 0, workspaceOpened: workspace > 0 };
}

/** Every difference between two runs, each either allowed (and why) or not. */
function transition(base, now, scenario) {
  const problems = [];
  const allowed = [];
  if (JSON.stringify(base.sheets) !== JSON.stringify(now.sheets))
    problems.push(`${scenario}: sheets differ ${base.sheets} / ${now.sheets}`);
  // Columns: every baseline column in place; only named columns appended.
  const appendedAt = {};
  for (const sheet of base.sheets) {
    const b = base.layout[sheet] ?? [];
    const n = now.layout[sheet] ?? [];
    b.forEach((h, i) => {
      if (n[i] !== h) problems.push(`${scenario}: ${sheet} column ${i + 1} moved or renamed: ${h} → ${n[i]}`);
    });
    n.slice(b.length).forEach((h, j) => {
      if (APPENDED.some((a) => a.sheet === sheet && a.header === h)) {
        appendedAt[sheet] = [...(appendedAt[sheet] ?? []), { column: b.length + j + 1, header: h }];
        allowed.push(`${sheet}: column ${b.length + j + 1} "${h}" appended`);
      } else problems.push(`${scenario}: ${sheet} unexpected new column ${h}`);
    });
  }
  const keys = new Set([...Object.keys(base.cells), ...Object.keys(now.cells)]);
  let evidenceChecked = 0;
  let evidenceNonEmpty = 0;
  for (const key of keys) {
    const [sheet, rc] = key.split('!');
    const [row, column] = rc.split(':').map(Number);
    const a = base.cells[key];
    const b = now.cells[key];
    const appended = (appendedAt[sheet] ?? []).find((x) => x.column === column);
    if (appended) {
      if (row === 1) continue;
      // Independently expected content of an appended evidence cell.
      if (appended.header === 'Retained Evidence') {
        const layout = now.layout[sheet];
        const id = JSON.parse(now.cells[`${sheet}!${row}:${layout.indexOf('Source Row ID') + 1}`] ?? '""');
        const [side, , sourceRow] = String(id).split(':');
        const expected = scenario === 'evidence' ? expectedRetained(side, Number(sourceRow)) : '';
        const actual = b === undefined ? '' : JSON.parse(b);
        evidenceChecked++;
        if (actual) evidenceNonEmpty++;
        if (actual !== expected)
          problems.push(`${scenario}: ${key} retained evidence ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)} from ${id}`);
      }
      continue;
    }
    if (a === b) continue;
    if (a === JSON.stringify(FROM) && b === JSON.stringify(TO)) {
      allowed.push(`${key}: engine version ${FROM} → ${TO}`);
      continue;
    }
    problems.push(`${scenario}: ${key} ${a} → ${b}`);
  }
  // Sessions: only the engine field may change, and only FROM → TO.
  const sb = JSON.parse(base.session);
  const sn = JSON.parse(now.session);
  for (const k of new Set([...Object.keys(sb), ...Object.keys(sn)])) {
    if (JSON.stringify(sb[k]) === JSON.stringify(sn[k])) continue;
    if (k === 'engine' && sb[k] === FROM && sn[k] === TO) allowed.push('session engine version');
    else problems.push(`${scenario}: session field ${k} differs`);
  }
  return { problems, allowed: [...new Set(allowed)], evidenceChecked, evidenceNonEmpty };
}
const same = (a, b) =>
  JSON.stringify(a.cells) === JSON.stringify(b.cells) && a.session === b.session;

const summary = { baseline: BASELINE, from: FROM, to: TO, appended: APPENDED, scenarios: {} };
for (const [name, runScenario] of [
  ['demo', demo],
  ['evidence', evidence],
]) {
  const base = await runScenario(BASELINE, 'ar');
  const ar = await runScenario('dist', 'ar');
  const en = await runScenario('dist', 'en');
  const t = transition(base, ar, name);
  summary.scenarios[name] = {
    cells: Object.keys(ar.cells).length,
    ...t,
    arabicEqualsEnglish: same(ar, en),
    baseSession: base.session,
  };
}
const oldSessionFile = summary.scenarios.evidence.baseSession;
summary.oldSession = {
  ar: await oldSession('dist', 'ar', oldSessionFile),
  en: await oldSession('dist', 'en', oldSessionFile),
};
for (const s of Object.values(summary.scenarios)) delete s.baseSession;
await browser.close();
const failed =
  Object.values(summary.scenarios).some((s) => s.problems.length || !s.arabicEqualsEnglish) ||
  Object.values(summary.oldSession).some((o) => !o.messageShown || o.workspaceOpened) ||
  (APPENDED.some((a) => a.header === 'Retained Evidence') &&
    summary.scenarios.evidence.evidenceNonEmpty === 0);
summary.passed = !failed;
await writeFile(OUT, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 1));
if (failed) process.exitCode = 1;
