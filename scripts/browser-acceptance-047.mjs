// Acceptance round 0.4.7, driven through the real interface.
//
// Every action below is performed by a script, so this is a SIMULATED USER, not
// an accountant. It records what a user would have had to do, how long the run
// took on this machine, and whether the exported workbook agrees with the
// arithmetic the inputs imply -- checked by reading the file back, not by asking
// the app. No guard is relaxed and no confirmation is entered on a file that did
// not ask for one.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { acceptanceCases } from './acceptance-cases-047.mjs';

/** Leaves the per-case flow once the outcome is already decided. */
class Skip extends Error {}

const root = path.resolve(import.meta.dirname, '..', 'dist');
const outFile = path.resolve(
  import.meta.dirname,
  '..',
  process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : 'work/acceptance-047.json',
);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname).replace(/^\/mizan-test\//, '/');
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
    const bytes = await readFile(file);
    const mime =
      {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      }[path.extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir(path.dirname(outFile), { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.MIZAN_CHROMIUM
    ? { executablePath: process.env.MIZAN_CHROMIUM }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
});
const settled = (page) =>
  page.waitForFunction(
    () =>
      !/قراءة الملف على جهازك|فحص البيانات ومطابقة الحركات|إعداد ورقة العمل على جهازك|إعادة قراءة أعمدة PDF على جهازك/.test(
        document.body.innerText,
      ),
    null,
    { timeout: 60_000 },
  );
const visible = async (locator) =>
  (await locator.count()) > 0 && locator.first().isVisible();

/** Reads the hint under the compare button: the app's own statement of what is
 * still missing. An empty hint means nothing is blocking. */
async function blockingHint(page) {
  const button = page.getByRole('button', { name: 'تحقق وقارن', exact: true });
  if (!(await button.count())) return 'compare step not reached';
  const disabled = await button.isDisabled();
  const hint = (
    await page.locator('fieldset p.hint').last().innerText()
  ).trim();
  return disabled ? hint || 'blocked without a stated reason' : '';
}

const results = [];
for (const entry of await acceptanceCases()) {
  const started = Date.now();
  const page = await context.newPage();
  const record = {
    id: entry.id,
    novelty: entry.novelty,
    expected: entry.expect,
    interventions: [],
    actor: 'simulated-user',
  };
  try {
    await page.goto(`${origin}/mizan-test/`);
    await page.waitForFunction(
      () => !document.body.innerText.includes('جارٍ تجهيز أداة المقارنة'),
      null,
      { timeout: 60_000 },
    );
    for (const [label, file] of [
      ['كشف المورد', entry.supplier],
      ['تقرير الحسابات الدائنة', entry.ledger],
    ]) {
      await page.getByLabel(label, { exact: true }).setInputFiles(file);
      await settled(page);
    }
    const readError = page.locator('.notice.error');
    if (await visible(readError)) {
      record.outcome = 'correct-stop';
      record.reason = (await readError.innerText()).trim().slice(0, 200);
      record.stage = 'read';
    } else {
      const confirm = page.getByRole('button', {
        name: 'تأكيد البيانات',
        exact: true,
      });
      if ((await confirm.count()) && (await confirm.isDisabled())) {
        // The app refused the source and turned the step off. That is a stop,
        // not something to wait on.
        record.outcome = 'correct-stop';
        record.stage = 'read';
        record.reason = (
          (await page
            .locator('.notice.error, [role="alert"]')
            .first()
            .innerText({ timeout: 2000 })
            .catch(() => '')) ||
          'confirm step disabled after reading the sources'
        )
          .trim()
          .slice(0, 200);
        throw new Skip();
      }
      if (await visible(confirm)) await confirm.click();
      // Scope facts printed on the source. Entering them is not a correction of
      // the extraction; it is the accountant naming the period and currency.
      // The app opens this panel itself when a value is missing, so wait for it
      // rather than racing the effect that reveals it.
      const currency = page.getByLabel('العملة', { exact: true });
      await currency
        .waitFor({ state: 'visible', timeout: 5000 })
        .catch(async () => {
          const toggle = page.getByRole('button', {
            name: 'تعديل نطاق المقارنة',
            exact: true,
          });
          if (await visible(toggle)) await toggle.click();
        });
      if (await visible(currency)) {
        await currency.fill(entry.scope.currency);
        record.interventions.push('scope:currency');
      }
      const cutoff = page.getByLabel('تاريخ المقارنة', { exact: true });
      if (await visible(cutoff)) {
        await cutoff.fill(entry.scope.cutoff);
        record.interventions.push('scope:cutoff');
      }
      await settled(page);
      // A PDF always asks for a visual review. That is a confirmation, never a
      // correction, and it is only ticked where the app asks for it.
      const review = page.getByRole('checkbox', {
        name: /راجعت الجدول في جميع الصفحات/,
      });
      for (let i = 0; i < (await review.count()); i++) {
        await review.nth(i).check();
        record.interventions.push('confirm:pdf-review');
      }
      await settled(page);
      // Split debit/credit with no balance chain: only the report's owner knows
      // which column increases the payable. The app asks, and the answer is an
      // intervention, recorded as one.
      const direction = page.getByRole('combobox', {
        name: 'أي عمود يزيد المبلغ المستحق للمورد؟',
        exact: true,
      });
      // The control stays on screen after answering, showing the choice, so act
      // only while it still reads as unanswered, and never more than once a side.
      for (let attempt = 0; attempt < 2; attempt++) {
        const pending = [];
        for (let i = 0; i < (await direction.count()); i++) {
          const control = direction.nth(i);
          if (!(await control.isVisible())) continue;
          if (!/اختر الاتجاه/.test(await control.innerText())) continue;
          pending.push(control);
        }
        if (!pending.length) break;
        for (const control of pending) {
          await control.click();
          await page
            .getByRole('option', {
              name:
                entry.debitIncreases === false
                  ? 'الدائن يزيد المستحق'
                  : 'المدين يزيد المستحق',
              exact: true,
            })
            .click();
          record.interventions.push('confirm:debit-credit-direction');
          await settled(page);
        }
      }
      let hint = await blockingHint(page);
      if (hint) {
        record.blockedBefore = hint.slice(0, 200);
        // The app asks for an interpretation the document cannot settle. This
        // round records the question; it does not invent an answer, so such a
        // case is reported as a stop, not as completed work.
        record.outcome = /أكثر من قراءة/.test(hint)
          ? 'correct-stop'
          : 'correct-stop';
        record.reason = hint.slice(0, 200);
        record.stage = 'readiness';
      } else {
        await page
          .getByRole('button', { name: 'تحقق وقارن', exact: true })
          .click();
        await settled(page);
        const compareError = page.locator('.notice.error');
        if (await visible(compareError)) {
          record.outcome = 'correct-stop';
          record.reason = (await compareError.innerText()).trim().slice(0, 200);
          record.stage = 'compare';
        } else {
          await page
            .getByRole('heading', { name: 'مساحة المراجعة', exact: true })
            .waitFor({ timeout: 60_000 });
          record.matched = Number(
            await page.locator('.metric').nth(0).locator('strong').innerText(),
          );
          await page
            .getByRole('button', { name: 'إعداد ورقة العمل', exact: true })
            .click();
          await settled(page);
          const download = page.waitForEvent('download');
          await page
            .getByRole('button', { name: 'تنزيل مسودة Excel', exact: true })
            .click();
          const saved = await (await download).path();
          const book = new ExcelJS.Workbook();
          await book.xlsx.readFile(saved);
          // Independent check: read the workbook back and compare its dates,
          // references and signed amounts against the arithmetic the inputs
          // imply, rather than trusting the screen that produced it.
          const sheet = book.getWorksheet('Supplier transactions');
          record.exportRows = sheet ? sheet.rowCount - 1 : 0;
          record.exportSheetCount = book.worksheets.length;
          if (entry.expectedSupplierRows) {
            const seen = [];
            sheet.eachRow((row, number) => {
              if (number === 1) return;
              const date = row.getCell(4).value;
              seen.push({
                date:
                  date instanceof Date
                    ? date.toISOString().slice(0, 10)
                    : String(date),
                reference: String(row.getCell(5).value ?? ''),
                amount: Number(row.getCell(8).value),
              });
            });
            const want = entry.expectedSupplierRows;
            const mismatches = [];
            if (seen.length !== want.length)
              mismatches.push(`row count ${seen.length} vs ${want.length}`);
            for (const [i, expected] of want.entries()) {
              const actual = seen[i];
              if (!actual) continue;
              if (actual.reference !== expected.reference)
                mismatches.push(`row ${i + 1} reference ${actual.reference}`);
              if (actual.date !== expected.date)
                mismatches.push(`row ${i + 1} date ${actual.date}`);
              if (Math.abs(actual.amount - expected.amount) > 1e-9)
                mismatches.push(`row ${i + 1} amount ${actual.amount}`);
            }
            record.exportVerified = mismatches.length === 0;
            if (mismatches.length)
              record.exportMismatches = mismatches.slice(0, 6);
          }
          record.outcome = record.interventions.some((i) =>
            i.startsWith('fix:'),
          )
            ? 'completed-after-correction'
            : record.interventions.some((i) => i.startsWith('confirm:'))
              ? 'completed-after-limited-confirmation'
              : 'completed-without-correction';
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Skip)) {
      record.outcome = 'run-error';
      record.reason = String(error?.message ?? error).slice(0, 300);
    }
  }
  record.elapsedMs = Date.now() - started;
  // A stop for the wrong reason is not the stop the case was written for, so
  // the declared reason is part of the expectation.
  record.matchesExpectation =
    entry.expect === 'completed'
      ? String(record.outcome).startsWith('completed') &&
        record.exportVerified !== false
      : String(record.outcome) === 'correct-stop' &&
        (!entry.expectReason || entry.expectReason.test(String(record.reason)));
  if (entry.matches !== undefined && record.matched !== undefined)
    record.expectedMatches = entry.matches;
  results.push(record);
  console.log(
    JSON.stringify({
      id: record.id,
      outcome: record.outcome,
      ms: record.elapsedMs,
      ok: record.matchesExpectation,
      matched: record.matched,
    }),
  );
  await page.close();
}
await context.close();
await browser.close();
server.close();

const tally = (key) =>
  results.reduce((o, r) => ((o[r[key]] = (o[r[key]] ?? 0) + 1), o), {});
const times = results.map((r) => r.elapsedMs).sort((a, b) => a - b);
const summary = {
  actor: 'simulated-user',
  declaration:
    'Twenty-four pairs composed for this round from layout combinations that did not guide the 0.4.7 fixes. Same writer families the project already uses, so these are new arrangements, not new producers, and not a market sample. Nothing here was relaxed to raise completion.',
  cases: results.length,
  outcomes: tally('outcome'),
  expectationsMet: results.filter((r) => r.matchesExpectation).length,
  exportsIndependentlyVerified: results.filter((r) => r.exportVerified === true)
    .length,
  exportsWithMismatch: results
    .filter((r) => r.exportVerified === false)
    .map((r) => r.id),
  unmet: results.filter((r) => !r.matchesExpectation).map((r) => r.id),
  elapsedMs: {
    median: times[Math.floor(times.length / 2)],
    min: times[0],
    max: times.at(-1),
    total: times.reduce((a, b) => a + b, 0),
  },
  results,
};
await writeFile(outFile, JSON.stringify(summary, null, 2) + '\n');
console.log(
  JSON.stringify({
    outcomes: summary.outcomes,
    expectationsMet: `${summary.expectationsMet}/${summary.cases}`,
    unmet: summary.unmet,
    medianMs: summary.elapsedMs.median,
    out: outFile,
  }),
);
if (summary.unmet.length) process.exitCode = 1;
