// Focused browser acceptance against an already built dist; no engine imports.
// MIZAN_CHROMIUM=... node audit/p1-reference-resolution/browser/run.mjs candidate-02f4f33
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';

const runName =
  process.argv[2] ?? new Date().toISOString().replace(/[:.]/g, '-');
assert.match(runName, /^[a-zA-Z0-9_-]+$/);
const out = path.resolve('audit/p1-reference-resolution/browser', runName);
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
    else if (/\.(?:html|js|css|json)$/.test(f.name)) {
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
  buildRoot: root,
  buildAssets: await fingerprint(root),
  scope:
    'Synthetic CSV browser acceptance; two repeated document rows, explicitly selected Reference, reversed ledger order. No financial approval or publication.',
  requests: [],
  externalRequests: [],
  nonGetRequests: [],
  pageErrors: [],
  checks: [],
};
const header = 'Date,Document No,Reference,Type,Description,Amount';
const sourceRows = {
  supplier: [
    '2026-07-09,INV-8170,LINE-0011,Invoice,Supplier goods,100.00',
    '2026-07-09,INV-8170,LINE-0012,Invoice,Supplier goods,100.00',
  ],
  ledger: [
    '2026-07-09,INV-8170,LINE-0012,Invoice,Ledger goods,100.00',
    '2026-07-09,INV-8170,LINE-0011,Invoice,Ledger goods,100.00',
  ],
};
for (const [side, rows] of Object.entries(sourceRows))
  await writeFile(path.join(out, `${side}.csv`), [header, ...rows].join('\n'));
const server = createServer(async (req, res) => {
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
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MIZAN_CHROMIUM
    ? { executablePath: process.env.MIZAN_CHROMIUM }
    : {}),
});
let currentPage;
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
    run: 'تحقق وقارن',
    ws: 'مساحة المراجعة',
    matched: 'المطابقات',
    details: 'تفاصيل الحالة',
    prep: 'إعداد ورقة العمل',
    reviewer: 'اسم المراجع',
    notes: 'ملاحظات المراجعة',
    draft: 'تنزيل مسودة Excel',
    save: 'حفظ الجلسة للمتابعة لاحقًا',
    resume: 'استئناف جلسة محلية',
  },
  en: {
    supplier: 'Supplier statement',
    ledger: 'Accounts payable report',
    editSupplier: 'Edit supplier statement',
    editLedger: 'Edit accounts payable report',
    reference: 'Reference column',
    confirm: 'Confirm data',
    currency: 'Currency',
    cutoff: 'Cut-off date',
    run: 'Check and compare',
    ws: 'Review workspace',
    matched: 'Matched',
    details: 'Case details',
    prep: 'Prepare the workpaper',
    reviewer: 'Reviewer name',
    notes: 'Review notes',
    draft: 'Download Excel draft',
    save: 'Save session to continue later',
    resume: 'Resume a local session',
  },
};
async function open(lang) {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1050 },
  });
  context.setDefaultTimeout(30000);
  context.on('page', (p) =>
    p.on('pageerror', (e) => report.pageErrors.push(e.message)),
  );
  context.on('request', (r) => {
    const u = new URL(r.url());
    const item = { method: r.method(), url: r.url() };
    report.requests.push(item);
    if (u.origin !== origin && !['blob:', 'data:'].includes(u.protocol))
      report.externalRequests.push(item);
    if (r.method() !== 'GET') report.nonGetRequests.push(item);
  });
  const page = (currentPage = await context.newPage());
  await page.goto(`${origin}/mizan-test/`);
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
async function selectReference(page, side, L) {
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
  await page
    .getByRole('option', { name: '3 · Reference', exact: true })
    .click();
  assert.match(await trigger.innerText(), /Reference/);
  await edit.click();
}
async function verifyReview(page, lang, tag) {
  const L = labels[lang];
  await page.getByRole('heading', { name: L.ws, exact: true }).waitFor();
  assert.equal(await page.locator('.metric strong').nth(0).innerText(), '2');
  assert.equal(await page.locator('.metric strong').nth(1).innerText(), '0');
  await page.getByRole('tab', { name: L.matched, exact: true }).click();
  const details = page.getByRole('button', { name: L.details, exact: true });
  assert.equal(await details.count(), 2);
  const explanations = [];
  for (let i = 0; i < 2; i++) {
    await details.nth(i).click();
    const ref = `LINE-001${i + 1}`;
    const expected =
      lang === 'ar'
        ? `رقم المستند INV-8170 متكرر، لكن المرجع المختار ${ref} يميز هذا الصف وحده داخل المستند في كل طرف. يتطابق المرجعان بنصهما الأصلي والمبلغ بإشارته، وفرق التاريخ 0 يوم.`
        : `Document number INV-8170 is repeated, but chosen reference ${ref} identifies this row uniquely within that document on each side. Both references match their original text, the signed amounts agree, and the dates are 0 days apart.`;
    await page
      .locator('.review-detail')
      .getByText(expected, { exact: false })
      .first()
      .waitFor();
    const actual = await page.locator('.review-detail').innerText();
    assert.ok(actual.includes(expected));
    explanations.push({ expected, actual });
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: path.join(out, `${tag}-case-${i + 1}.png`),
      fullPage: true,
    });
  }
  const text = await page.locator('body').innerText();
  await writeFile(path.join(out, `${tag}-visible.txt`), text);
  report.checks.push({
    check: 'review',
    tag,
    lang,
    metrics: await page.locator('.metric strong').allInnerTexts(),
    explanations,
  });
}
async function exportAndSave(page, lang, tag) {
  const L = labels[lang];
  await page.getByRole('button', { name: L.prep, exact: true }).click();
  await page
    .getByRole('textbox', { name: L.reviewer, exact: true })
    .fill('Synthetic P1 reviewer');
  await page
    .getByRole('textbox', { name: L.notes, exact: true })
    .fill(
      'Browser acceptance: repeated document, selected reference, reversed ledger rows.',
    );
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: L.draft, exact: true }).click();
  const workbookPath = path.join(out, `${tag}.xlsx`);
  await (await downloadEvent).saveAs(workbookPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const matched = workbook.getWorksheet('Matches');
  assert.equal(matched.rowCount, 3);
  for (let i = 2; i <= 3; i++) {
    assert.equal(
      matched.getCell(i, 11).value,
      'EXACT_DOCUMENT_CHOSEN_REFERENCE_UNIQUE_V1',
    );
    assert.equal(matched.getCell(i, 17).value, 'Auto');
  }
  const evidence = workbook.getWorksheet('Match Evidence');
  const rows = evidence
    .getSheetValues()
    .slice(2)
    .map((r) => ({
      caseId: r[1],
      rule: r[4],
      side: r[6],
      rowId: r[7],
      row: r[9],
      document: r[13],
      retained: r[23],
    }));
  assert.equal(rows.length, 4);
  const pairs = [...new Set(rows.map((r) => r.caseId))]
    .map((id) =>
      rows
        .filter((r) => r.caseId === id)
        .map((r) => `${r.side}:${r.row}`)
        .sort()
        .join('|'),
    )
    .sort();
  assert.deepEqual(pairs, ['ledger:2|supplier:3', 'ledger:3|supplier:2']);
  assert.ok(
    rows.every(
      (r) =>
        r.document === 'INV-8170' &&
        r.rule === 'EXACT_DOCUMENT_CHOSEN_REFERENCE_UNIQUE_V1',
    ),
  );
  const sessionEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: L.save, exact: true }).click();
  const sessionPath = path.join(out, `${tag}-session.json`);
  await (await sessionEvent).saveAs(sessionPath);
  const session = JSON.parse(await readFile(sessionPath, 'utf8'));
  assert.ok(session.mappings.every((m) => m.reference === 2));
  assert.equal(session.decisions.length, 0);
  assert.equal(session.scope.coverageConfirmed, false);
  report.checks.push({
    check: 'workpaper-and-session',
    tag,
    engine: session.engine,
    pairs,
    evidence: rows,
    sessionPath,
    workbookPath,
    mappings: session.mappings,
    scope: session.scope,
  });
  return { sessionPath, pairs };
}
try {
  const { page, context } = await open('ar');
  const L = labels.ar;
  for (const side of ['supplier', 'ledger']) {
    await page
      .getByLabel(L[side], { exact: true })
      .setInputFiles(path.join(out, `${side}.csv`));
    await page.waitForFunction(
      () =>
        !/قراءة الملف على جهازك|Reading the file on your device/.test(
          document.body.innerText,
        ),
    );
  }
  await page.getByRole('button', { name: L.confirm, exact: true }).click();
  for (const side of ['supplier', 'ledger'])
    await selectReference(page, side, L);
  await page.getByLabel(L.currency, { exact: true }).fill('SAR');
  await page.getByLabel(L.cutoff, { exact: true }).fill('2026-07-31');
  await page.getByRole('button', { name: L.run, exact: true }).click();
  await verifyReview(page, 'ar', 'ar');
  await page.locator('.language-switch button[lang="en"]').click();
  await verifyReview(page, 'en', 'en');
  const original = await exportAndSave(page, 'en', 'original');
  await context.close();
  const restored = await open('en');
  await restored.page
    .getByLabel(labels.en.resume, { exact: true })
    .setInputFiles(original.sessionPath);
  await verifyReview(restored.page, 'en', 'restored-en');
  const after = await exportAndSave(restored.page, 'en', 'restored');
  assert.deepEqual(after.pairs, original.pairs);
  await restored.context.close();
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.nonGetRequests, []);
  assert.deepEqual(
    await fingerprint(root),
    report.buildAssets,
    'Build changed during acceptance',
  );
  report.passed = true;
} catch (e) {
  report.passed = false;
  report.error = { message: e.message, stack: e.stack };
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
  report.finishedAt = new Date().toISOString();
  await writeFile(
    path.join(out, 'result.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  console.log(
    JSON.stringify({
      passed: report.passed,
      result: path.join(out, 'result.json'),
      error: report.error?.message,
    }),
  );
}
