// Browser acceptance of a frozen P2 build. No engine imports or application writes.
// MIZAN_CHROMIUM=... node audit/p2-group-resolution/browser/run.mjs candidate-name
// LIVE_URL=https://host/path/ uses the same UI audit against an already published build.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const runName =
  process.argv[2] ?? new Date().toISOString().replace(/[:.]/g, '-');
assert.match(runName, /^[a-zA-Z0-9_-]+$/);
const out = path.resolve('audit/p2-group-resolution/browser', runName);
const root = path.resolve(process.env.DIST ?? 'dist');
await mkdir(out, { recursive: true });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fingerprint(dir, prefix = '') {
  const entries = [];
  for (const f of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const rel = path.join(prefix, f.name);
    if (f.isDirectory())
      entries.push(...(await fingerprint(path.join(dir, f.name), rel)));
    else {
      const bytes = await readFile(path.join(dir, f.name));
      entries.push({ path: rel, bytes: bytes.length, sha256: sha256(bytes) });
    }
  }
  return entries;
}
const report = {
  runName,
  startedAt: new Date().toISOString(),
  sourceRevisionAtStart: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  mode: process.env.LIVE_URL ? 'live' : 'local',
  buildRoot: root,
  buildAssets: await fingerprint(root),
  scope:
    'Synthetic browser checks for whole N:M payments, atomic unlink/session restoration, competing bank/receipt identities, and invoice subgroups. No accounting approval or publication.',
  requests: [],
  externalRequests: [],
  nonGetRequests: [],
  pageErrors: [],
  workers: [],
  codeErrors: [],
  loadedCode: [],
  checks: [],
};
const header = [
  'Date',
  'Document No',
  'Reference',
  'Amount',
  'Type',
  'Bank Reference',
  'Receipt No',
  'Voucher No',
  'Description',
  'Currency',
  'PO',
];
const paymentRow = (side, i, amount, bank = 'BANK-P2-441', receipt = '') => [
  '2026-07-15',
  `${side === 'supplier' ? 'SUP' : 'LED'}-PAY-441-${i}`,
  '',
  amount,
  'Payment',
  bank,
  receipt,
  `${side === 'supplier' ? 'SUP' : 'LED'}-VOUCHER-441-${i}`,
  `${side} payment part ${i}`,
  'SAR',
  '',
];
const invoiceRow = (side, amount, ref) => [
  '2026-07-15',
  'INV-7441',
  ref,
  amount,
  'Invoice',
  '',
  '',
  '',
  `${side} goods`,
  'SAR',
  'PO-4491',
];
const fixtures = {
  group: {
    supplier: [
      paymentRow('supplier', 1, '-40.00'),
      paymentRow('supplier', 2, '-60.00'),
    ],
    ledger: [
      paymentRow('ledger', 1, '-25.00'),
      paymentRow('ledger', 2, '-75.00'),
    ],
  },
  competing: {
    supplier: [
      paymentRow('supplier', 1, '-100.00', 'BANK-P2-C91', 'RCPT-P2-C91'),
    ],
    ledger: [
      paymentRow('ledger', 1, '-40.00', 'BANK-P2-C91', 'RCPT-P2-C91'),
      paymentRow('ledger', 2, '-60.00', 'BANK-P2-C91'),
      paymentRow('ledger', 3, '-60.00', '', 'RCPT-P2-C91'),
    ],
  },
  invoice: {
    supplier: [
      invoiceRow('supplier', '1000.00', 'A'),
      invoiceRow('supplier', '500.00', 'B'),
    ],
    ledger: [
      invoiceRow('ledger', '500.00', 'B'),
      invoiceRow('ledger', '400.00', 'A'),
      invoiceRow('ledger', '600.00', 'A'),
      invoiceRow('ledger', '500.00', 'C'),
    ],
  },
  numericReceipts: {
    supplier: [
      paymentRow('supplier', 1, '-30.00', '', '000840'),
      paymentRow('supplier', 2, '-70.00', '', '000840'),
      paymentRow('supplier', 3, '-11.00', '', '00840'),
      paymentRow('supplier', 4, '-19.00', '', '00840'),
    ],
    ledger: [
      paymentRow('ledger', 1, '-20.00', '', '000840'),
      paymentRow('ledger', 2, '-35.00', '', '000840'),
      paymentRow('ledger', 3, '-45.00', '', '000840'),
      paymentRow('ledger', 4, '-30.00', '', '00840'),
    ],
  },
};
fixtures['invoice-vouchers'] = Object.fromEntries(
  Object.entries(fixtures.invoice).map(([side, rows]) => [
    side,
    rows.map((row, index) => {
      const copy = [...row];
      copy[7] = `${side === 'supplier' ? 'SUP' : 'LED'}-AP-VOUCHER-${index + 1}`;
      return copy;
    }),
  ]),
);
for (const [scenario, sources] of Object.entries(fixtures))
  for (const [side, rows] of Object.entries(sources))
    await writeFile(
      path.join(out, `${scenario}-${side}.csv`),
      [header, ...rows].map((r) => r.join(',')).join('\r\n'),
    );

let server;
let url = process.env.LIVE_URL;
if (!url) {
  server = createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(
        new URL(req.url, 'http://localhost').pathname,
      ).replace(/^\/mizan-test\//, '/');
      if (rel === '/') rel = '/index.html';
      const file = path.resolve(root, '.' + rel);
      if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
      const bytes = await readFile(file);
      res.writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html; charset=utf-8',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
            '.wasm': 'application/wasm',
          }[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/mizan-test/`;
}
const base = new URL(url);
assert.ok(['http:', 'https:'].includes(base.protocol));
report.url = url;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MIZAN_CHROMIUM
    ? { executablePath: process.env.MIZAN_CHROMIUM }
    : {}),
});
let currentPage;
const responseChecks = [];
const summaryXml = new WeakMap();
const labels = {
  ar: {
    supplier: 'كشف المورد',
    ledger: 'تقرير الحسابات الدائنة',
    editSupplier: 'تعديل كشف المورد',
    editLedger: 'تعديل تقرير الحسابات الدائنة',
    reference: 'عمود المرجع',
    confirm: 'تأكيد البيانات',
    currency: 'العملة',
    cutoff: 'تاريخ المقارنة',
    scope: 'تعديل نطاق المقارنة',
    run: 'تحقق وقارن',
    ws: 'مساحة المراجعة',
    matched: 'المطابقات',
    review: 'يحتاج مراجعة (1)',
    details: 'تفاصيل الحالة',
    prep: 'إعداد ورقة العمل',
    reviewer: 'اسم المراجع',
    notes: 'ملاحظات المراجعة',
    draft: 'تنزيل مسودة Excel',
    save: 'حفظ الجلسة للمتابعة لاحقًا',
    resume: 'استئناف جلسة محلية',
    back: 'العودة للمراجعة',
    reason: 'سبب القرار',
    unlink: 'فك الربط وإعادته للمراجعة',
  },
  en: {
    supplier: 'Supplier statement',
    ledger: 'Accounts payable report',
    editSupplier: 'Edit the supplier statement',
    editLedger: 'Edit the AP report',
    reference: 'Reference column',
    confirm: 'Confirm data',
    currency: 'Currency',
    cutoff: 'Cut-off date',
    scope: 'Edit reconciliation scope',
    run: 'Check and compare',
    ws: 'Review workspace',
    matched: 'Matched',
    review: 'Needs Review (1)',
    details: 'Case details',
    prep: 'Prepare the workpaper',
    reviewer: 'Reviewer name',
    notes: 'Review notes',
    draft: 'Download Excel draft',
    save: 'Save session to continue later',
    resume: 'Resume a local session',
    back: 'Back to review',
    reason: 'Reason for the decision',
    unlink: 'Unlink and return to review',
  },
};
async function open(lang) {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1050 },
  });
  context.setDefaultTimeout(30000);
  context.on('page', (p) => {
    p.on('pageerror', (e) => report.pageErrors.push(e.message));
    p.on('worker', (worker) => report.workers.push(worker.url()));
  });
  context.on('request', (r) => {
    const u = new URL(r.url());
    const item = { method: r.method(), url: r.url() };
    report.requests.push(item);
    if (u.origin !== base.origin && !['blob:', 'data:'].includes(u.protocol))
      report.externalRequests.push(item);
    if (r.method() !== 'GET') report.nonGetRequests.push(item);
  });
  context.on('response', (response) => {
    const u = new URL(response.url());
    if (u.origin !== base.origin || !/\.(?:js|css)$/.test(u.pathname)) return;
    // A live run must execute the same frozen code, not merely display its version string.
    responseChecks.push(
      response
        .body()
        .then((bytes) => {
          const rel = u.pathname.slice(u.pathname.lastIndexOf('/assets/') + 1);
          const expected = report.buildAssets.find(
            (asset) => asset.path === rel,
          );
          const hash = sha256(bytes);
          report.loadedCode.push({
            url: response.url(),
            path: rel,
            sha256: hash,
            matchesDist: expected?.sha256 === hash,
          });
          assert.ok(expected, `Unexpected built code asset: ${rel}`);
          assert.equal(
            hash,
            expected.sha256,
            `Loaded code differs from the frozen build: ${rel}`,
          );
        })
        .catch((error) => report.codeErrors.push(error.message)),
    );
  });
  const page = (currentPage = await context.newPage());
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector('.notice.loading'));
  if (lang === 'en')
    await page.locator('.language-switch button[lang="en"]').click();
  assert.match(
    await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content'),
    /connect-src 'none'/,
  );
  return { page, context };
}
async function switchLanguage(page, lang) {
  await page.locator(`.language-switch button[lang="${lang}"]`).click();
  await page.waitForFunction(
    (wanted) => document.documentElement.lang === wanted,
    lang,
  );
}
async function selectReference(page, side, L, option) {
  const card = page
    .locator('section.surface')
    .filter({ has: page.getByRole('heading', { name: L[side], exact: true }) });
  const edit = card.getByRole('button', {
    name: side === 'supplier' ? L.editSupplier : L.editLedger,
    exact: true,
  });
  if ((await edit.getAttribute('aria-expanded')) !== 'true') await edit.click();
  const trigger = card.getByRole('combobox', {
    name: L.reference,
    exact: true,
  });
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  assert.ok((await trigger.innerText()).includes(option.split(' · ')[1]));
  await edit.click();
}
async function upload(page, lang, scenario) {
  const L = labels[lang];
  for (const side of ['supplier', 'ledger']) {
    await page
      .getByLabel(L[side], { exact: true })
      .setInputFiles(path.join(out, `${scenario}-${side}.csv`));
    await page.waitForFunction(
      () =>
        !/قراءة الملف على جهازك|Reading the file on your device/.test(
          document.body.innerText,
        ),
    );
  }
  await page.getByRole('button', { name: L.confirm, exact: true }).click();
  for (const side of ['supplier', 'ledger'])
    await selectReference(
      page,
      side,
      L,
      scenario.startsWith('invoice') ? '3 · Reference' : '2 · Document No',
    );
  const scopeEdit = page.getByRole('button', { name: L.scope, exact: true });
  if ((await scopeEdit.getAttribute('aria-expanded')) !== 'true')
    await scopeEdit.click();
  await page.getByLabel(L.currency, { exact: true }).fill('SAR');
  await page.getByLabel(L.cutoff, { exact: true }).fill('2026-07-31');
  await page.getByRole('button', { name: L.run, exact: true }).click();
  await page.getByRole('heading', { name: L.ws, exact: true }).waitFor();
}
async function snapshot(page, tag) {
  await writeFile(
    path.join(out, `${tag}-visible.txt`),
    await page.locator('body').innerText(),
  );
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.screenshot({ path: path.join(out, `${tag}.png`), fullPage: true });
  if (await page.locator('.review-detail').count())
    await page
      .locator('.review-detail')
      .screenshot({ path: path.join(out, `${tag}-detail.png`) });
}
async function verifyGroupReview(page, lang, tag, state = 'matched') {
  const L = labels[lang];
  await page.getByRole('heading', { name: L.ws, exact: true }).waitFor();
  const matched = state === 'matched';
  await page.waitForFunction(
    (n) => document.querySelector('.metric strong')?.textContent === n,
    matched ? '1' : '0',
  );
  assert.deepEqual(await page.locator('.metric strong').allInnerTexts(), [
    matched ? '1' : '0',
    '0',
    '0',
    '0',
  ]);
  await page
    .getByRole('tab', { name: matched ? L.matched : L.review, exact: true })
    .click();
  const details = page.getByRole('button', { name: L.details, exact: true });
  assert.equal(await details.count(), 1, 'one complete group case');
  const tableText = await page.getByRole('table').innerText();
  assert.match(tableText, state === 'competing' ? /1:3/ : /2:2/);
  await details.click();
  const detail = page.locator('.review-detail');
  await detail.waitFor();
  const explanation = await detail.innerText();
  const expectedRows =
    state === 'competing'
      ? [
          ['supplier', 2],
          ['ledger', 2],
          ['ledger', 3],
          ['ledger', 4],
        ]
      : [
          ['supplier', 2],
          ['supplier', 3],
          ['ledger', 2],
          ['ledger', 3],
        ];
  for (const [side, row] of expectedRows) {
    const prefix =
      lang === 'ar'
        ? `${side === 'supplier' ? 'المورد' : 'الدفتر'}: CSV، صف ${row}`
        : `${side === 'supplier' ? 'Supplier' : 'AP ledger'}: CSV, row ${row}`;
    assert.ok(
      explanation.includes(prefix),
      `${tag}: source member ${side}:${row}`,
    );
  }
  if (matched) {
    assert.match(explanation, /EXACT_MANY_TO_MANY/);
    assert.match(explanation, /BANK-P2-441/);
    assert.ok(
      explanation.includes(
        lang === 'ar'
          ? 'لا تثبت مقابلة كل صف بصف معين أو تخصيص الدفعة لفواتير'
          : 'does not establish individual row-to-row pairings or allocate the payment to invoices',
      ),
    );
    assert.ok(
      explanation.includes(
        lang === 'ar' ? 'الفرق 0.00 SAR' : 'difference 0.00 SAR',
      ),
    );
  } else if (state === 'rejected') {
    assert.ok(
      explanation.includes(
        lang === 'ar'
          ? 'رفض المراجع رابطًا داخل المجموعة'
          : 'The reviewer rejected a link within the group',
      ),
    );
  } else {
    assert.match(explanation, /BANK-P2-C91/);
    assert.match(explanation, /RCPT-P2-C91/);
    assert.ok(
      explanation.includes(
        lang === 'ar'
          ? 'لم تُعتمد أي مجموعة تلقائيًا'
          : 'No group was matched automatically',
      ),
    );
  }
  if (lang === 'en') assert.doesNotMatch(explanation, /[؀-ۿ]/);
  await snapshot(page, tag);
  report.checks.push({
    check: 'group-review',
    tag,
    lang,
    state,
    metrics: await page.locator('.metric strong').allInnerTexts(),
    explanation,
  });
}
function records(sheet) {
  const headers = sheet.getRow(1).values.slice(1).map(String);
  const rows = [];
  for (let n = 2; n <= sheet.rowCount; n++)
    rows.push(
      Object.fromEntries(
        headers.map((h, i) => [h, sheet.getCell(n, i + 1).value]),
      ),
    );
  return rows;
}
function summaryValue(book, label) {
  const rows = records(book.getWorksheet('Summary'));
  const found = rows.find((r) => r['Field / الحقل'] === label);
  assert.ok(found, label);
  const value = found['Value / القيمة'];
  if (value?.formula && value.result === undefined) {
    // ExcelJS drops a cached numeric zero when reading formula cells. Verify
    // the actual OOXML cache instead of guessing zero from an empty result.
    const summary = book.getWorksheet('Summary');
    const row = rows.indexOf(found) + 2;
    const address = summary.getCell(row, 2).address;
    const cell = summaryXml
      .get(book)
      ?.match(new RegExp(`<c r="${address}"[^>]*>[\\s\\S]*?</c>`))?.[0];
    assert.match(cell ?? '', /<v>0<\/v>/, `${label}: missing cached value`);
    return 0;
  }
  return value?.result ?? value;
}
async function exportAndSave(page, lang, tag) {
  const L = labels[lang];
  await page.getByRole('button', { name: L.prep, exact: true }).click();
  await page
    .getByRole('textbox', { name: L.reviewer, exact: true })
    .fill('Synthetic P2 reviewer');
  await page
    .getByRole('textbox', { name: L.notes, exact: true })
    .fill(
      'Browser acceptance of complete groups and documented review decisions.',
    );
  const workbookEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: L.draft, exact: true }).click();
  const workbookPath = path.join(out, `${tag}.xlsx`);
  await (await workbookEvent).saveAs(workbookPath);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(workbookPath);
  assert.equal(book.getWorksheet('Summary').id, 1);
  const zip = await JSZip.loadAsync(await readFile(workbookPath));
  summaryXml.set(
    book,
    await zip.file('xl/worksheets/sheet1.xml').async('string'),
  );
  const sessionEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: L.save, exact: true }).click();
  const sessionPath = path.join(out, `${tag}-session.json`);
  await (await sessionEvent).saveAs(sessionPath);
  const session = JSON.parse(await readFile(sessionPath, 'utf8'));
  assert.equal(session.engine, '0.3.19-experimental');
  assert.equal(session.decisions.length, 0);
  assert.equal(session.scope.coverageConfirmed, false);
  const matches = records(book.getWorksheet('Matches'));
  const evidence = records(book.getWorksheet('Match Evidence'));
  report.checks.push({
    check: 'export-and-session',
    tag,
    engine: session.engine,
    workbookPath,
    sessionPath,
    matches,
    evidence,
    events: session.events,
    rejected: session.rejected,
  });
  await page.getByRole('button', { name: L.back, exact: true }).click();
  return { book, matches, evidence, session, sessionPath };
}
const groupIds = ['ledger:0:2', 'ledger:0:3', 'supplier:0:2', 'supplier:0:3'];
function verifyGroupExport(exported, state = 'matched') {
  const { book, matches, evidence, session } = exported;
  const expectedIds =
    state === 'competing'
      ? ['ledger:0:2', 'ledger:0:3', 'ledger:0:4', 'supplier:0:2']
      : groupIds;
  assert.deepEqual(evidence.map((r) => r['Source Row ID']).sort(), expectedIds);
  assert.equal(new Set(evidence.map((r) => r['Case ID'])).size, 1);
  const matched = state === 'matched';
  assert.equal(matches.length, matched ? 1 : 0);
  assert.equal(summaryValue(book, 'Auto Matched Cases'), matched ? 1 : 0);
  assert.equal(summaryValue(book, 'Matched Source Rows'), matched ? 4 : 0);
  if (matched) {
    assert.equal(matches[0]['Match Type'], 'N:M');
    assert.equal(matches[0]['Match Decision'], 'Auto');
    assert.equal(
      matches[0]['Rule'],
      'EXPLICIT_PAYMENT_COMPLETE_GROUP_TOTAL_V2',
    );
    assert.deepEqual(
      [matches[0]['Supplier Amount'], matches[0]['Ledger Amount']],
      [-100, -100],
    );
    assert.deepEqual(
      [matches[0]['Supplier Source Rows'], matches[0]['Ledger Source Rows']],
      [2, 2],
    );
    assert.ok(
      evidence.every(
        (r) =>
          r.Classification === 'EXACT_MANY_TO_MANY' && r.Status === 'Matched',
      ),
    );
    assert.deepEqual(session.rejected, []);
  } else {
    const rule =
      state === 'competing'
        ? 'PAYMENT_IDENTITY_COMPONENT_REVIEW_V1'
        : 'PAYMENT_GROUP_PROOF_INCOMPLETE_V1';
    assert.ok(
      evidence.every((r) => r.Rule === rule && r.Status === 'Needs Review'),
    );
    assert.equal(summaryValue(book, 'Needs Review Source Rows'), 4);
    if (state === 'rejected') {
      assert.equal(session.rejected.length, 1);
      const unlink = session.events.filter((e) => e.action === 'unlink');
      assert.equal(unlink.length, 1);
      assert.deepEqual(unlink[0].ids.slice().sort(), groupIds);
      const history = book
        .getWorksheet('Review History')
        .getSheetValues()
        .slice(2);
      const row = history.find((r) => r[2] === 'unlink');
      assert.ok(row);
      assert.deepEqual(row[3].split(' | ').sort(), groupIds);
    }
  }
}
async function restoredSession(path, lang) {
  const active = await open(lang);
  await active.page
    .getByLabel(labels[lang].resume, { exact: true })
    .setInputFiles(path);
  await active.page
    .getByRole('heading', { name: labels[lang].ws, exact: true })
    .waitFor();
  return active;
}
async function verifyNumericReceipts(page, lang, tag) {
  const L = labels[lang];
  await page.getByRole('heading', { name: L.ws, exact: true }).waitFor();
  assert.deepEqual(await page.locator('.metric strong').allInnerTexts(), [
    '2',
    '0',
    '0',
    '0',
  ]);
  await page.getByRole('tab', { name: L.matched, exact: true }).click();
  const buttons = page.getByRole('button', { name: L.details, exact: true });
  assert.equal(await buttons.count(), 2);
  const descriptions = [];
  for (let i = 0; i < 2; i++) {
    await buttons.nth(i).click();
    descriptions.push(await page.locator('.review-detail').innerText());
  }
  for (const receipt of ['000840', '00840'])
    assert.ok(
      descriptions.some((text) =>
        text.includes(
          `receiptReference: ${receipt}${lang === 'ar' ? '؛' : ';'}`,
        ),
      ),
      `literal receipt ${receipt}`,
    );
  assert.ok(descriptions.some((text) => text.includes('EXACT_MANY_TO_MANY')));
  assert.ok(descriptions.some((text) => text.includes('EXACT_MANY_TO_1')));
  if (lang === 'en')
    assert.ok(descriptions.every((text) => !/[؀-ۿ]/.test(text)));
  await snapshot(page, tag);
  report.checks.push({
    check: 'numeric-receipt-review',
    tag,
    lang,
    descriptions,
  });
}
function verifyNumericExport({ book, matches, evidence, session }) {
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((m) => m['Match Type']).sort(), ['M:1', 'N:M']);
  assert.equal(summaryValue(book, 'Auto Matched Cases'), 2);
  assert.equal(summaryValue(book, 'Matched Source Rows'), 8);
  assert.ok(
    matches.every(
      (m) =>
        m.Rule === 'EXPLICIT_PAYMENT_COMPLETE_GROUP_TOTAL_V2' &&
        m['Match Decision'] === 'Auto',
    ),
  );
  assert.equal(evidence.length, 8);
  const groups = {};
  for (const receipt of ['000840', '00840']) {
    const members = evidence.filter((r) => r['Receipt Reference'] === receipt);
    assert.equal(new Set(members.map((r) => r['Case ID'])).size, 1);
    assert.ok(members.every((r) => r.Status === 'Matched'));
    groups[receipt] = members.map((r) => r['Source Row ID']).sort();
  }
  assert.deepEqual(groups, {
    '000840': [
      'ledger:0:2',
      'ledger:0:3',
      'ledger:0:4',
      'supplier:0:2',
      'supplier:0:3',
    ],
    '00840': ['ledger:0:5', 'supplier:0:4', 'supplier:0:5'],
  });
  assert.equal(
    new Set(evidence.map((r) => r['Case ID'])).size,
    2,
    'leading-zero receipt identities must remain separate',
  );
  assert.deepEqual(session.rejected, []);
  report.checks.push({ check: 'numeric-receipt-export', sourceGroups: groups });
}
try {
  report.stage = 'whole-group';
  const original = await open('ar');
  await upload(original.page, 'ar', 'group');
  await verifyGroupReview(original.page, 'ar', 'group-ar');
  await switchLanguage(original.page, 'en');
  await verifyGroupReview(original.page, 'en', 'group-en');
  const matched = await exportAndSave(original.page, 'en', 'matched');
  verifyGroupExport(matched);
  report.stage = 'atomic-unlink';
  await original.page
    .getByRole('tab', { name: labels.en.matched, exact: true })
    .click();
  await original.page
    .getByRole('button', { name: labels.en.details, exact: true })
    .click();
  await original.page
    .getByRole('textbox', { name: labels.en.reason, exact: true })
    .fill('Synthetic P2: reject the entire payment group.');
  await original.page
    .getByRole('button', { name: labels.en.unlink, exact: true })
    .click();
  await verifyGroupReview(original.page, 'en', 'unlinked-en', 'rejected');
  const unlinked = await exportAndSave(original.page, 'en', 'unlinked');
  verifyGroupExport(unlinked, 'rejected');
  await original.context.close();

  report.stage = 'restore-rejection';
  const rejectedRestore = await restoredSession(unlinked.sessionPath, 'en');
  await verifyGroupReview(
    rejectedRestore.page,
    'en',
    'restored-rejection-en',
    'rejected',
  );
  const stillRejected = await exportAndSave(
    rejectedRestore.page,
    'en',
    'restored-rejection',
  );
  verifyGroupExport(stillRejected, 'rejected');
  assert.deepEqual(stillRejected.session.rejected, unlinked.session.rejected);
  await rejectedRestore.context.close();

  report.stage = 'restore-original-matched';
  const matchedRestore = await restoredSession(matched.sessionPath, 'ar');
  await verifyGroupReview(matchedRestore.page, 'ar', 'restored-matched-ar');
  const restoredMatch = await exportAndSave(
    matchedRestore.page,
    'ar',
    'restored-matched',
  );
  verifyGroupExport(restoredMatch);
  assert.deepEqual(restoredMatch.evidence, matched.evidence);
  await matchedRestore.context.close();

  report.stage = 'competing-identities';
  const competing = await open('ar');
  await upload(competing.page, 'ar', 'competing');
  await verifyGroupReview(competing.page, 'ar', 'competing-ar', 'competing');
  await switchLanguage(competing.page, 'en');
  await verifyGroupReview(competing.page, 'en', 'competing-en', 'competing');
  verifyGroupExport(
    await exportAndSave(competing.page, 'en', 'competing'),
    'competing',
  );
  await competing.context.close();

  for (const scenario of ['invoice', 'invoice-vouchers']) {
    report.stage = `${scenario}-subgroups`;
    const invoice = await open('en');
    await upload(invoice.page, 'en', scenario);
    assert.deepEqual(
      await invoice.page.locator('.metric strong').allInnerTexts(),
      ['2', '0', '1', '0'],
    );
    await invoice.page
      .getByRole('tab', { name: labels.en.matched, exact: true })
      .click();
    const detailButtons = invoice.page.getByRole('button', {
      name: labels.en.details,
      exact: true,
    });
    assert.equal(await detailButtons.count(), 2);
    const descriptions = [];
    for (let i = 0; i < 2; i++) {
      await detailButtons.nth(i).click();
      descriptions.push(
        await invoice.page.locator('.review-detail').innerText(),
      );
    }
    assert.ok(
      descriptions.some(
        (text) =>
          text.includes('chosen reference A') &&
          text.includes('EXACT_1_TO_MANY'),
      ),
    );
    assert.ok(descriptions.every((text) => !/[؀-ۿ]/.test(text)));
    await snapshot(invoice.page, `${scenario}-en`);
    const invoiceExport = await exportAndSave(invoice.page, 'en', scenario);
    assert.equal(invoiceExport.matches.length, 2);
    assert.equal(summaryValue(invoiceExport.book, 'Matched Source Rows'), 5);
    assert.equal(summaryValue(invoiceExport.book, 'Unmatched Source Rows'), 1);
    const byRule = new Map(invoiceExport.matches.map((m) => [m.Rule, m]));
    assert.equal(
      byRule.get('EXACT_DOCUMENT_REFERENCE_SUBGROUP_TOTAL_V1')?.['Match Type'],
      '1:M',
    );
    assert.equal(
      byRule.get('EXACT_DOCUMENT_CHOSEN_REFERENCE_UNIQUE_V1')?.['Match Type'],
      '1:1',
    );
    const groups = new Map();
    for (const row of invoiceExport.evidence) {
      const key = row.Rule;
      groups.set(
        key,
        [...(groups.get(key) ?? []), row['Source Row ID']].sort(),
      );
    }
    assert.deepEqual(groups.get('EXACT_DOCUMENT_REFERENCE_SUBGROUP_TOTAL_V1'), [
      'ledger:0:3',
      'ledger:0:4',
      'supplier:0:2',
    ]);
    assert.deepEqual(groups.get('EXACT_DOCUMENT_CHOSEN_REFERENCE_UNIQUE_V1'), [
      'ledger:0:2',
      'supplier:0:3',
    ]);
    assert.deepEqual(
      invoiceExport.evidence
        .filter((r) => r.Status === 'Unmatched')
        .map((r) => r['Source Row ID']),
      ['ledger:0:5'],
    );
    report.checks.push({
      check: 'invoice-subgroups',
      scenario,
      descriptions,
      sourceGroups: Object.fromEntries(groups),
    });
    if (scenario === 'invoice-vouchers') {
      assert.equal(
        new Set(invoiceExport.evidence.map((r) => r['Voucher Reference'])).size,
        6,
      );
      assert.ok(
        invoiceExport.evidence.every((r) =>
          /^(SUP|LED)-AP-VOUCHER-\d+$/.test(r['Voucher Reference']),
        ),
      );
    }
    await invoice.context.close();
  }

  report.stage = 'numeric-receipts';
  const numeric = await open('ar');
  await upload(numeric.page, 'ar', 'numericReceipts');
  await verifyNumericReceipts(numeric.page, 'ar', 'numeric-receipts-ar');
  await switchLanguage(numeric.page, 'en');
  await verifyNumericReceipts(numeric.page, 'en', 'numeric-receipts-en');
  const numericExport = await exportAndSave(
    numeric.page,
    'en',
    'numeric-receipts',
  );
  verifyNumericExport(numericExport);
  await numeric.context.close();
  report.stage = 'restore-numeric-receipts';
  const numericRestore = await restoredSession(numericExport.sessionPath, 'en');
  await verifyNumericReceipts(
    numericRestore.page,
    'en',
    'restored-numeric-receipts-en',
  );
  const restoredNumericExport = await exportAndSave(
    numericRestore.page,
    'en',
    'restored-numeric-receipts',
  );
  verifyNumericExport(restoredNumericExport);
  assert.deepEqual(restoredNumericExport.evidence, numericExport.evidence);
  await numericRestore.context.close();

  report.stage = 'final-integrity';
  await Promise.all(responseChecks);
  assert.ok(
    report.workers.some((worker) => worker.startsWith('blob:')) &&
      report.loadedCode.some((r) => /assets\/index-.*\.js$/.test(r.path)),
    'the blob engine worker and its containing index bundle must be observed',
  );
  assert.deepEqual(report.codeErrors, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.nonGetRequests, []);
  assert.deepEqual(
    await fingerprint(root),
    report.buildAssets,
    'dist changed during acceptance',
  );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = { message: error.message, stack: error.stack };
  if (currentPage && !currentPage.isClosed()) {
    await currentPage
      .screenshot({ path: path.join(out, 'failure.png'), fullPage: true })
      .catch(() => {});
    await writeFile(
      path.join(out, 'failure-visible.txt'),
      await currentPage.locator('body').innerText(),
    ).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await Promise.allSettled(responseChecks);
  report.finishedAt = new Date().toISOString();
  await writeFile(
    path.join(out, 'result.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  console.log(
    JSON.stringify({
      passed: report.passed,
      stage: report.stage,
      result: path.join(out, 'result.json'),
      error: report.error?.message,
    }),
  );
}
