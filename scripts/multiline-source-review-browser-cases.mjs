import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const fixtureRoot = new URL(
  '../audit/local-provider/multiline-source-v1/frozen/',
  import.meta.url,
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function verifyMultilineSourceReview(page, url, out) {
  await mkdir(out, { recursive: true });
  const records = [];
  for (const lang of ['ar', 'en'])
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await page
        .getByRole('button', {
          name: lang === 'en' ? 'EN English' : 'AR العربية',
          exact: true,
        })
        .click();
      const ui = page.locator('[data-multiline-source-review]');
      assert.equal(
        await ui.locator('[data-source-review-toggle]').textContent(),
        lang === 'en' ? 'Source interpretation review' : 'مراجعة تفسير المصدر',
      );
      await ui.locator('[data-source-review-toggle]').click();
      const original = await readFile(
        new URL(
          lang === 'en' ? 'en-distractors.txt' : 'ar-distractors.txt',
          fixtureRoot,
        ),
      );
      const expected = JSON.parse(
        await readFile(
          new URL(
            lang === 'en'
              ? 'en-distractors.expected.json'
              : 'ar-distractors.expected.json',
            fixtureRoot,
          ),
          'utf8',
        ),
      );
      const upload = (buffer = original, name = 'original-invoice.txt') =>
        ui
          .locator('[data-source-review-file]')
          .setInputFiles({ name, mimeType: 'text/plain', buffer });
      const state = (phase) =>
        ui.locator(`[data-source-review-state="${phase}"]`).waitFor();
      const waitEnabled = async (selector) =>
        page.waitForFunction(
          (element) => !element.disabled,
          await ui.locator(selector).elementHandle(),
        );
      const review = async () => {
        await ui
          .locator('[data-source-review-reviewer]')
          .fill('Synthetic browser review action; no field trial');
        await ui
          .locator('[data-source-review-rationale]')
          .fill(
            'Scripted separate action checks each literal value and role label.',
          );
        await ui.locator('[data-source-review-acknowledge]').check();
        await waitEnabled('[data-source-review-accept]');
        await ui.locator('[data-source-review-accept]').click();
        await state('approved');
      };
      const assertFinancialUnchanged = async () => {
        assert.deepEqual(
          await page
            .locator('.file-grid input[type="file"]')
            .evaluateAll((inputs) => inputs.map((input) => input.files.length)),
          [0, 0],
        );
        assert.equal(
          await page
            .locator('.upload-surface .surface-footer button')
            .isDisabled(),
          true,
        );
        assert.equal(
          await page.locator('[data-testid="comparison-result"]').count(),
          0,
        );
      };
      await upload();
      await state('candidate');
      await waitEnabled('[data-source-review-reread]');
      assert.equal(
        await ui.locator('[data-source-review-original]').textContent(),
        original.toString('utf8'),
      );
      assert.equal(
        await ui.locator('[data-source-review-hash]').textContent(),
        hash(original),
      );
      assert.equal(
        await ui.locator('[data-source-review-apply]').isDisabled(),
        true,
      );
      assert.equal(
        await ui.locator('[data-source-review-accept]').isDisabled(),
        true,
      );
      assert.equal(await ui.locator('[data-source-review-derived]').count(), 0);
      assert.equal(
        await ui.locator('[data-source-review-recorded-review]').count(),
        0,
      );
      assert.equal(
        await ui.locator('[data-source-review-synthetic]').count(),
        0,
      );
      for (const field of ['date', 'reference', 'amount', 'currency']) {
        assert.equal(
          await ui
            .locator(`[data-source-review-literal="${field}"]`)
            .textContent(),
          expected.fields[field],
        );
        for (const kind of ['value', 'role']) {
          const evidence = expected.evidence[field][kind];
          const highlight = ui.locator(
            `[data-source-span="${kind}"][data-source-fields~="${field}"]`,
          );
          assert.equal(await highlight.textContent(), evidence.literal);
          assert.equal(
            await highlight.getAttribute('data-start-utf16'),
            String(evidence.startUtf16),
          );
          assert.equal(
            await highlight.getAttribute('data-end-utf16'),
            String(evidence.endUtf16),
          );
        }
      }
      await assertFinancialUnchanged();
      const overflow = await ui.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        viewport: innerWidth,
        right: element.getBoundingClientRect().right,
        left: element.getBoundingClientRect().left,
      }));
      assert.ok(
        overflow.scrollWidth <= overflow.clientWidth + 1,
        JSON.stringify(overflow),
      );
      assert.ok(
        overflow.left >= -1 && overflow.right <= width + 1,
        JSON.stringify(overflow),
      );
      await ui.screenshot({ path: `${out}/${lang}-${width}-candidate.png` });
      await review();
      assert.equal(await ui.locator('[data-source-review-derived]').count(), 0);
      await assertFinancialUnchanged();
      await ui.locator('[data-source-review-apply]').click();
      await state('applied');
      assert.equal(
        await ui.locator('[data-source-review-minor]').textContent(),
        expected.amountMinor,
      );
      await assertFinancialUnchanged();
      const downloading = page.waitForEvent('download');
      await ui.locator('[data-source-review-download]').click();
      const download = await downloading;
      assert.equal(
        download.suggestedFilename(),
        'multiline-explicitly-derived-invoice.csv',
      );
      const downloaded = await readFile(await download.path());
      assert.notEqual(hash(downloaded), hash(original));
      assert.match(
        downloaded.toString('utf8'),
        /^Date,Reference,Amount,Currency,Description,Type\n/,
      );
      assert.ok(
        downloaded
          .toString('utf8')
          .includes(
            `${expected.fields.date},${expected.fields.reference},${expected.fields.amount},SAR,`,
          ),
      );
      await download.saveAs(`${out}/${lang}-${width}-derived.csv`);
      await ui.screenshot({ path: `${out}/${lang}-${width}-applied.png` });
      await assertFinancialUnchanged();

      // A reading-version change preserves bytes but cancels the prior decision/output.
      const previousRevision = await ui
        .locator('[data-source-review-revision]')
        .textContent();
      await ui.locator('[data-source-review-reread]').click();
      await state('candidate');
      assert.notEqual(
        await ui.locator('[data-source-review-revision]').textContent(),
        previousRevision,
      );
      assert.equal(
        await ui.locator('[data-source-review-hash]').textContent(),
        hash(original),
      );
      assert.equal(
        await ui.locator('[data-source-review-apply]').isDisabled(),
        true,
      );
      assert.equal(await ui.locator('[data-source-review-derived]').count(), 0);
      await review();
      await ui.locator('[data-source-review-include="amount"]').uncheck();
      await state('candidate');
      assert.equal(
        await ui.locator('[data-source-review-apply]').isDisabled(),
        true,
      );
      assert.equal(
        await ui.locator('[data-source-review-recorded-review]').count(),
        0,
      );
      await ui.locator('[data-source-review-include="amount"]').check();
      await review();
      await ui
        .locator('[data-source-review-reviewer]')
        .fill('Changed synthetic reviewer label');
      await state('candidate');
      assert.equal(
        await ui.locator('[data-source-review-apply]').isDisabled(),
        true,
      );
      await review();
      await ui.locator('[data-source-review-reject]').click();
      await state('rejected');
      assert.equal(
        await ui.locator('[data-source-review-apply]').isDisabled(),
        true,
      );

      // Injected digest delay exercises native browser cancellation; not performance evidence.
      for (const action of ['source', 'cancel', 'reread', 'reviewer']) {
        await upload();
        await state('candidate');
        await review();
        await page.evaluate(() => {
          globalThis.multilineReviewDigestDelay = 350;
        });
        await ui.locator('[data-source-review-apply]').click();
        await state('applying');
        if (action === 'source') {
          const replacement = Buffer.from(
            original
              .toString('utf8')
              .replace(expected.fields.reference, 'INV-999'),
          );
          await upload(replacement, 'replacement.txt');
        }
        if (action === 'cancel')
          await ui.locator('[data-source-review-clear]').click();
        if (action === 'reread')
          await ui.locator('[data-source-review-reread]').click();
        if (action === 'reviewer')
          await ui
            .locator('[data-source-review-rationale]')
            .fill('Changed rationale while Apply is pending.');
        await page.evaluate(() => {
          globalThis.multilineReviewDigestDelay = 0;
        });
        await state(action === 'cancel' ? 'empty' : 'candidate');
        await page.waitForTimeout(900);
        assert.equal(
          await ui.locator('[data-source-review-derived]').count(),
          0,
          action,
        );
        assert.equal(
          await ui.locator('[data-source-review-recorded-review]').count(),
          0,
          action,
        );
        if (action === 'source')
          assert.equal(
            await ui
              .locator('[data-source-review-literal="reference"]')
              .textContent(),
            'INV-999',
          );
        await assertFinancialUnchanged();
      }
      const missingIssueDate = Buffer.from(
        original
          .toString('utf8')
          .split('\n')
          .filter(
            (line) =>
              !line.startsWith(expected.evidence.date.role.literal + ':'),
          )
          .join('\n'),
      );
      await upload(missingIssueDate, 'missing-issue-date.txt');
      await state('question');
      assert.equal(
        await ui
          .locator('[data-source-review-reason]')
          .getAttribute('data-source-review-reason'),
        'missing-role',
      );
      assert.equal(await ui.locator('[data-source-review-accept]').count(), 0);
      assert.equal(await ui.locator('[data-source-review-derived]').count(), 0);
      const competingTotal = Buffer.from(
        original.toString('utf8') +
          expected.evidence.amount.role.literal +
          ': SAR 999.00\n',
      );
      await upload(competingTotal, 'competing-total.txt');
      await state('question');
      assert.equal(
        await ui
          .locator('[data-source-review-reason]')
          .getAttribute('data-source-review-reason'),
        'competing-role',
      );
      assert.equal(await ui.locator('[data-source-review-accept]').count(), 0);
      assert.equal(await ui.locator('[data-source-review-derived]').count(), 0);
      const injected = Buffer.from(
        original.toString('utf8') +
          '<script>window.sourceInstructionExecuted=true</script>\n',
      );
      await upload(injected, 'source-instructions.txt');
      await state('abstain');
      assert.equal(await ui.locator('[data-source-review-derived]').count(), 0);
      assert.equal(
        await page.evaluate(
          () => globalThis.sourceInstructionExecuted ?? false,
        ),
        false,
      );
      await upload(Buffer.from([0xff, 0xfe]), 'invalid-utf8.txt');
      await state('abstain');
      assert.equal(
        await ui
          .locator('[data-source-review-reason]')
          .getAttribute('data-source-review-reason'),
        'invalid-encoding',
      );
      await upload(Buffer.alloc(8193, 65), 'too-large.txt');
      await state('abstain');
      assert.equal(
        await ui
          .locator('[data-source-review-reason]')
          .getAttribute('data-source-review-reason'),
        'source-bound',
      );
      await ui.locator('[data-source-review-demo]').click();
      await state('candidate');
      assert.equal(
        await ui.locator('[data-source-review-synthetic]').count(),
        1,
      );
      assert.equal(
        await ui.locator('[data-source-review-apply]').isDisabled(),
        true,
      );
      await ui.locator('[data-source-review-toggle]').click();
      await ui.locator('[data-source-review-toggle]').click();
      await state('empty');
      await assertFinancialUnchanged();
      const workerActions = await page.evaluate(
        () => globalThis.multilineReviewWorkerActions,
      );
      assert.deepEqual(
        workerActions,
        ['ready'],
        'Only worker readiness, no financial read or comparison request',
      );
      const record = {
        lang,
        width,
        exactOriginalText: true,
        valueAndRoleSpanHighlights: true,
        originalByteHash: hash(original),
        candidateGrantsNoApproval: true,
        separateReviewerDecision: true,
        derivedNativeReplayMinor: expected.amountMinor,
        derivedDownloadSha256: hash(downloaded),
        financialSourcesUnchanged: true,
        readingSelectionReviewerInvalidate: true,
        pendingSourceCancelRereadReviewerDiscarded: true,
        sourceInstructionsEscaped: true,
        missingAndCompetingRolesAskWithoutApproval: true,
        invalidUtf8AndSizeRefused: true,
        syntheticDemoLabeled: true,
        noHorizontalOverflow: true,
        injectedDelayIsNotPerformanceEvidence: true,
      };
      records.push(record);
      console.log(JSON.stringify(record));
    }
  const report = {
    browser: 'native installed Chrome',
    synthetic: true,
    fieldValidation: false,
    modelInferenceRun: false,
    productActivated: false,
    records,
  };
  await writeFile(`${out}/cases.json`, JSON.stringify(report, null, 2) + '\n');
  return report;
}
