import assert from 'node:assert/strict';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
export async function verifyBank(page, url, out = 'work/qa') {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await openDomainWorkspace(page, 'bank');
  await page
    .getByRole('heading', { name: 'حركات البنك ودفتر النقدية', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'افتح مثال حركات بنك اصطناعيًا', exact: true })
    .click();
  await page.getByTestId('bank-result').waitFor();
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  const truth = JSON.parse(
      await readFile('audit/bank/frozen/expected.json', 'utf8'),
    ),
    sides = ['Bank statement', 'Cashbook'],
    scopeLabels = [
      'Entity',
      'Ledger',
      'Bank account',
      'Currency',
      'Period start',
      'Period end',
    ];
  const table = (heading) =>
    page
      .getByRole('heading', { name: heading, exact: true })
      .locator('..')
      .locator('table');
  const rows = (heading) => table(heading).locator('tbody tr');
  const section = (heading) =>
    page.getByRole('heading', { name: heading, exact: true }).locator('..');
  async function upload(name, native = false, dir = 'audit/bank/frozen') {
    for (const side of [0, 1]) {
      let file = `${dir}/${name}-${side}.csv`;
      if (native) {
        file = `${out}/bank-native-source-${side}.xlsx`;
        await copyFile(`work/bank/exports/${name}-source-${side}.xlsx`, file);
      }
      const source = page.getByTestId(`bank-source-${side}`);
      await source.getByLabel(sides[side], { exact: true }).setInputFiles(file);
      await source.getByText(file.split('/').at(-1), { exact: true }).waitFor();
      await source
        .getByLabel(`${sides[side]} I reviewed this table`, { exact: false })
        .check();
    }
    for (const [i, label] of scopeLabels.entries())
      await page
        .getByLabel(label, { exact: true })
        .fill(Object.values(truth.scope)[i]);
    await page
      .getByLabel(
        'I reviewed the common entity, ledger, bank account, currency and period. This is a movement comparison; it does not close balances.',
        { exact: true },
      )
      .check();
    await page
      .getByRole('button', { name: 'Compare bank movements', exact: true })
      .click();
    await page.getByTestId('bank-result').waitFor();
  }
  async function evidence() {
    await page
      .getByLabel('Evidence reference', { exact: true })
      .fill('Synthetic bank review B1');
    await page
      .getByLabel('Decision or undo reason', { exact: true })
      .fill(
        'Synthetic complete members and dates reviewed; movement comparison only',
      );
  }
  // The decision controls say why they are closed, from the same conditions
  // they use, and each decision button is described by that sentence.
  const hints = {
    both: 'Write the “Evidence reference” and the “Decision or undo reason” to enable approval, undo and the human pairing.',
    reason: 'Write the “Decision or undo reason” to enable a decision.',
    ready:
      'Approval is offered only for an eligible case that needs review, undo only for a matched case, and the human pairing once a movement is chosen on each side.',
    sourceError:
      'Source errors block every decision; correct the source in its original file, then compare again.',
  };
  async function decisionHint(expected) {
    const hint = page.locator('[data-bank-decision-hint]');
    assert.equal(
      await hint.count(),
      1,
      'the decision controls say why they are closed',
    );
    assert.equal(await hint.innerText(), expected);
    const id = await hint.getAttribute('id');
    for (const name of [
      'Approve complete eligible case',
      'Undo complete movement case',
      'Approve documented one-to-one pairing',
      'Evidence reference',
      'Decision or undo reason',
    ])
      for (const control of await page
        .getByRole(
          name.startsWith('Approve') || name.startsWith('Undo')
            ? 'button'
            : 'textbox',
          {
            name,
            exact: true,
          },
        )
        .all())
        assert.equal(
          await control.getAttribute('aria-describedby'),
          id,
          `${name} is described by the hint`,
        );
  }
  // The case status has its own column, before the decisions it governs.
  async function statusColumn(expected) {
    const headers = await table('Whole movement cases')
      .locator('thead th')
      .allInnerTexts();
    const at = headers.indexOf('Status');
    assert.ok(at >= 0, 'the case status has its own column');
    assert.equal(headers[at + 1], 'Approve complete eligible case');
    const cells = await rows('Whole movement cases')
      .first()
      .locator('td')
      .allInnerTexts();
    assert.equal(cells[at], expected);
    assert.equal(cells[at + 1], 'Approve complete eligible case');
  }
  // The reader's position as numbers: the focused element, its row's own
  // record, and whether it sits in view below the sticky top bar.
  const focused = () =>
    page.evaluate(() => {
      const a = document.activeElement,
        box = a.getBoundingClientRect(),
        bar = document.querySelector('.topbar')?.getBoundingClientRect();
      return {
        tag: a.tagName,
        text: a.textContent,
        row: a.closest('tr')?.children[2]?.textContent ?? null,
        inView: box.top >= (bar ? bar.bottom : 0) && box.bottom <= innerHeight,
      };
    });
  // Opening a movement's evidence on a phone takes the reader to it, and the
  // way back returns to that movement's row.
  async function evidenceFocus(index) {
    const row = rows('Original movements').nth(index),
      ref = await row.locator('td').nth(2).innerText();
    await row
      .getByRole('button', { name: 'Review source cells', exact: true })
      .click();
    const opened = await focused();
    assert.equal(opened.tag, 'H2', 'the evidence takes focus when it opens');
    assert.ok(opened.text.startsWith('Source cell evidence'), opened.text);
    assert.ok(opened.text.includes(ref), `${opened.text} names ${ref}`);
    assert.ok(opened.inView, 'the evidence heading is in view');
    await page
      .getByRole('button', {
        name: 'Back to the movement in its table',
        exact: true,
      })
      .click();
    const back = await focused();
    assert.equal(back.row, ref, 'the way back returns to the same movement');
    assert.ok(back.inView, 'the movement is in view');
    return ref;
  }
  // Each table pages on its own: turning the movements leaves the cases and
  // the source rows where they are.
  async function ownPages() {
    assert.equal(await rows('Original movements').count(), 50);
    assert.equal(await rows('Every original source row').count(), 50);
    assert.equal(await rows('Whole movement cases').count(), 30);
    const next = (heading) =>
      section(heading).getByRole('button', { name: 'Next', exact: true });
    assert.equal(
      await next('Original movements').count(),
      1,
      'the movements table pages on its own',
    );
    assert.equal(
      await next('Whole movement cases').count(),
      0,
      'a table on one page has no pager',
    );
    await next('Original movements').click();
    assert.equal(await rows('Original movements').count(), 10);
    assert.equal(
      await rows('Whole movement cases').count(),
      30,
      'turning the movements leaves the cases',
    );
    assert.equal(
      await rows('Every original source row').count(),
      50,
      'and the source rows',
    );
  }
  async function download(button, file) {
    const promise = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    await (await promise).saveAs(`${out}/${file}`);
  }
  // The movement tables scroll inside their frame: no line breaks inside a
  // word, an amount or an identity, and the page itself does not overflow.
  async function wholeTokens(width) {
    await page.setViewportSize({ width, height: 1050 });
    const broken = await page.evaluate(() => {
      const found = [];
      // The movement result's own tables, whatever their class.
      const cells = document.querySelectorAll(
        '[data-testid="bank-result"] ~ fieldset .gl-tb-table :is(th, td)',
      );
      for (const cell of cells) {
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) =>
            n.parentElement.closest('pre')
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT,
        });
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent;
          const range = document.createRange();
          let line = null;
          for (let i = 0; i < text.length; i++) {
            if (/\s/u.test(text[i])) {
              line = null;
              continue;
            }
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const box = range.getClientRects()[0];
            if (!box) continue;
            if (line !== null && Math.abs(box.top - line) > box.height / 2)
              found.push(text);
            line = box.top;
          }
        }
      }
      return { cells: cells.length, found };
    });
    assert.ok(broken.cells > 50, `${width}px: no movement table cells`);
    assert.deepEqual(broken.found, [], `${width}px: broken inside a word`);
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
      0,
      `${width}px: the page overflows`,
    );
  }
  async function exportFile(file) {
    await download('Download bank movement workpaper', file);
  }
  async function eventCount(n) {
    await page.waitForFunction(
      ({ heading, n }) => {
        const h = [...document.querySelectorAll('h2')].find(
          (h) => h.textContent === heading,
        );
        return h?.parentElement.querySelectorAll('tbody tr').length === n;
      },
      { heading: 'Dated decisions', n },
    );
  }
  await exportFile('bank-direct.xlsx');
  await download('Save bank movement session', 'bank-session.json');
  await page
    .locator('select[data-reconciliation-type-select]')
    .selectOption('supplier');
  await openDomainWorkspace(page, 'bank');
  assert.equal(await rows('Original movements').count(), 4);
  await page
    .getByLabel('Restore bank movement session', { exact: true })
    .setInputFiles(`${out}/bank-session.json`);
  await page.getByTestId('bank-result').waitFor();
  await exportFile('bank-restored.xlsx');
  await page
    .getByRole('button', { name: 'Review source cells', exact: true })
    .first()
    .click();
  assert.equal(
    await page
      .getByRole('heading', { name: /Source cell evidence/ })
      .locator('..')
      .locator('tbody tr')
      .count(),
    17,
  );
  await upload('individual');
  await statusColumn('Matched by explicit source identity');
  await decisionHint(hints.both);
  await page
    .getByLabel('Evidence reference', { exact: true })
    .fill('Synthetic bank review B1');
  await decisionHint(hints.reason);
  await evidence();
  await decisionHint(hints.ready);
  await page
    .getByRole('button', { name: 'Undo complete movement case', exact: true })
    .click();
  await eventCount(1);
  assert.ok(
    (await table('Whole movement cases').innerText()).includes(
      'Undone; requires review',
    ),
  );
  await page
    .getByRole('button', {
      name: 'Approve complete eligible case',
      exact: true,
    })
    .click();
  await eventCount(2);
  await exportFile('bank-individual.xlsx');
  await upload('timing-after-cutoff');
  assert.equal(await rows('Value dates outside the period').count(), 1);
  await evidence();
  await page
    .getByRole('button', {
      name: 'Approve complete eligible case',
      exact: true,
    })
    .click();
  await eventCount(1);
  assert.equal(await rows('Value dates outside the period').count(), 1);
  await exportFile('bank-timing-manual.xlsx');
  await download('Save bank movement session', 'bank-timing-session.json');
  await page
    .getByLabel('Restore bank movement session', { exact: true })
    .setInputFiles(`${out}/bank-timing-session.json`);
  await eventCount(1);
  await exportFile('bank-timing-restored.xlsx');
  await evidence();
  await page
    .getByRole('button', { name: 'Undo complete movement case', exact: true })
    .click();
  await eventCount(2);
  assert.equal(await rows('Value dates outside the period').count(), 1);
  await exportFile('bank-timing-undo.xlsx');
  await upload('no-identity');
  assert.equal(await rows('Whole movement cases').count(), 2);
  await evidence();
  const record = await rows('Original movements').evaluateAll((rows) =>
    rows.map((r) => ({
      side: r.children[0].textContent,
      ref: r.children[2].textContent,
    })),
  );
  assert.equal(record.length, 2);
  await page
    .getByLabel('Bank movement for human review', { exact: true })
    .selectOption({ label: 'B1 · -1,000.00' });
  await page
    .getByLabel('Cashbook movement for human review', { exact: true })
    .selectOption({ label: 'L1 · -1,000.00' });
  await page
    .getByRole('button', {
      name: 'Approve documented one-to-one pairing',
      exact: true,
    })
    .click();
  await eventCount(1);
  assert.equal(await rows('Whole movement cases').count(), 1);
  await exportFile('bank-noidentity-manual.xlsx');
  await page
    .getByRole('button', { name: 'Undo complete movement case', exact: true })
    .click();
  await eventCount(2);
  assert.equal(await rows('Whole movement cases').count(), 2);
  await exportFile('bank-noidentity-undo.xlsx');
  // Thirty settlements on each side: sixty movements and sixty-two source
  // rows run past one page, the thirty cases do not.
  for (const side of [0, 1]) {
    const lines = [
      'Record ID,Settlement ID,Movement date,Value date,Cash direction,Role,Parent payment ID,Reverses record ID,Policy,Status,Entity,Ledger,Bank account,Currency,Period start,Period end,Amount',
    ];
    for (let i = 1; i <= 30; i++)
      lines.push(
        `${side ? 'L' : 'B'}${i},S${i},2026-09-15,2026-09-16,outflow,principal,,,individual,${side ? 'posted' : 'booked'},Synthetic Cash Owner,Primary Book,BANK-001,SAR,2026-09-01,2026-09-30,${1000 + i}`,
      );
    await writeFile(`${out}/long-${side}.csv`, `${lines.join('\n')}\n`);
  }
  await upload('long', false, out);
  await page.setViewportSize({ width: 390, height: 844 });
  await evidenceFocus(3);
  await ownPages();
  const later = await evidenceFocus(4);
  await section('Original movements')
    .getByRole('button', { name: 'Previous', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Back to the movement in its table',
      exact: true,
    })
    .click();
  assert.equal(
    await rows('Original movements').count(),
    10,
    'the way back turns the movements to the page of the evidence',
  );
  assert.equal((await focused()).row, later);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await upload('balanced-extra-members');
  await wholeTokens(1440);
  await wholeTokens(390);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await evidence();
  assert.equal(
    await page
      .getByRole('button', {
        name: 'Approve complete eligible case',
        exact: true,
      })
      .isEnabled(),
    false,
  );
  await exportFile('bank-policy-error.xlsx');
  await upload('wrong-fee-parent');
  await evidence();
  assert.ok(
    (await table('Every original source row').innerText()).includes(
      'Fee has no valid principal in the same group.',
    ),
  );
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  assert.ok(
    (await table('جرد كل صف مصدر أصلي').innerText()).includes(
      'الرسم لا يرتبط بأصل صالح في المجموعة نفسها.',
    ),
  );
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  assert.ok(
    (await page.getByTestId('bank-result').innerText()).includes(
      'Source errors',
    ),
  );
  for (const button of await page
    .getByRole('button', {
      name: 'Approve complete eligible case',
      exact: true,
    })
    .all())
    assert.equal(await button.isEnabled(), false);
  await decisionHint(hints.sourceError);
  await exportFile('bank-source-error.xlsx');
  await upload('outgoing-fees', true);
  await exportFile('bank-native.xlsx');
  await download('Save bank movement session', 'bank-native-session.json');
  await page
    .getByLabel('Restore bank movement session', { exact: true })
    .setInputFiles(`${out}/bank-native-session.json`);
  await page.getByTestId('bank-result').waitFor();
  await exportFile('bank-native-restored.xlsx');
  await page.getByLabel('Bank statement', { exact: true }).setInputFiles({
    name: 'unsupported.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('synthetic rejected extension'),
  });
  await page.getByRole('alert').waitFor();
  assert.equal(await rows('Original movements').count(), 4);
  assert.ok(
    (await page.getByTestId('bank-result').innerText()).includes(
      'Supplied movements matched',
    ),
  );
  await page
    .getByLabel('Entity', { exact: true })
    .fill('Changed synthetic owner');
  assert.equal(await page.getByTestId('bank-result').count(), 0);
  assert.equal(
    await page
      .getByRole('button', { name: 'Compare bank movements', exact: true })
      .isEnabled(),
    false,
  );
  await page
    .getByRole('button', {
      name: 'Open synthetic bank movement example',
      exact: true,
    })
    .click();
  await page.getByTestId('bank-result').waitFor();
  for (const [lang, width] of [
    ['ar', 390],
    ['en', 320],
  ]) {
    await page
      .getByRole('button', {
        name: lang === 'ar' ? 'AR العربية' : 'EN English',
        exact: true,
      })
      .click();
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      'bank mobile root overflow',
    );
    await page.screenshot({
      path: `${out}/bank-${lang}-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  return { downloads: 12, synthetic: true, movementOnly: true };
}
