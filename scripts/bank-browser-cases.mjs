import assert from 'node:assert/strict';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
import { bankSheetSaysScreen } from './reconciliation-sheet-browser.mjs';
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
    sides = ['Bank statement', 'Cashbook'];
  const workspace = page.locator('main.bank-workspace'),
    card = workspace.locator('[data-scope-card]');
  // The card's one confirmation (UX-5(d)) carries both source attestations
  // and the scope attestation; its label names the two sources.
  const confirmBox = () =>
    workspace.getByLabel('I reviewed the bank statement and the cashbook', {
      exact: false,
    });
  const runButton = () =>
    workspace.getByRole('button', {
      name: 'Compare bank movements',
      exact: true,
    });
  // The fields fold under the card's sentence when nothing is asked; an
  // accountant opens them to change one.
  async function openFields() {
    const fields = card.locator('details');
    if ((await fields.getAttribute('open')) === null)
      await fields.locator('summary').click();
  }
  // What the card says each field holds, read here from the CSV bytes with
  // this check's own split, not the app's reader: every non-blank data row of
  // both files, the six scope columns by header. The native case copies
  // workbooks written from the same CSV text, so the same answer holds.
  const scopeHeaders = {
    entity: 'Entity',
    ledger: 'Ledger',
    account: 'Bank account',
    currency: 'Currency',
    start: 'Period start',
    end: 'Period end',
  };
  async function filesSay(name, dir = 'audit/bank/frozen') {
    const tables = [];
    for (const [side, label] of sides.entries()) {
      const text = await readFile(`${dir}/${name}-${side}.csv`, 'utf8');
      assert.ok(!text.includes('"'), 'the bank sources are unquoted');
      const [head, ...body] = text
        .split(/\r?\n/u)
        .filter((line) => line.trim())
        .map((line) => line.split(','));
      tables.push({ label, head, body });
    }
    return Object.fromEntries(
      Object.entries(scopeHeaders).map(([key, header]) => {
        const counts = new Map(),
          read = [];
        let rows = 0;
        for (const { label, head, body } of tables) {
          const at = head.indexOf(header);
          assert.ok(at >= 0, `${header} is a column of ${label}`);
          read.push(`${label}: rows ${body.length}`);
          for (const row of body) {
            rows += 1;
            const value = (row[at] ?? '').trim(),
              bySide = counts.get(value) ?? new Map();
            bySide.set(label, (bySide.get(label) ?? 0) + 1);
            counts.set(value, bySide);
          }
        }
        return [key, { header, rows, read, counts }];
      }),
    );
  }
  async function cardField(key) {
    const field = card.locator(`[data-scope-field="${key}"]`);
    return {
      origin: await field.getAttribute('data-origin'),
      value: await field.locator('input').inputValue(),
      // textContent: the fields are folded when nothing is asked.
      hint: (await field.locator('.hint').textContent()).trim(),
      values: (await field.locator('li').allTextContents()).map((t) =>
        t.trim(),
      ),
    };
  }
  // Every field the files agree on holds their value, marked from the file
  // with its column and each file's rows; the sentence says the same.
  async function cardSaysFiles(name, dir, when) {
    assert.equal(
      await card.count(),
      1,
      `${name} ${when}: the files show the card «ما فهمناه من ملفاتك»`,
    );
    const said = await filesSay(name, dir);
    for (const [key, { header, read, counts }] of Object.entries(said)) {
      assert.equal(counts.size, 1, `${name}: one ${key} in the two files`);
      const [value] = counts.keys(),
        shown = await cardField(key);
      assert.equal(
        shown.value,
        value,
        `${name} ${when}: ${key} from the files`,
      );
      assert.equal(shown.origin, 'file', `${name} ${when}: ${key} as theirs`);
      assert.equal(
        shown.hint,
        `From the file: column ${header} · ${read.join(' · ')}`,
        `${name} ${when}: ${key} names its column and each file's rows`,
      );
    }
    const one = (key) => said[key].counts.keys().next().value;
    assert.equal(
      await card.locator('[data-scope-summary]').innerText(),
      `${one('entity')}, bank account ${one('account')}, ${one('start')} to ${one('end')}, in ${one('currency')}; ${said.entity.rows} rows read from the two files.`,
      `${name} ${when}: the sentence says the files' scope`,
    );
    assert.equal(
      await card.locator('[data-scope-summary] bdi').count(),
      5,
      'each value in the sentence is isolated from the words around it',
    );
  }
  const table = (heading) =>
    page
      .getByRole('heading', { name: heading, exact: true })
      .locator('..')
      .locator('table');
  const rows = (heading) => table(heading).locator('tbody tr');
  const section = (heading) =>
    page.getByRole('heading', { name: heading, exact: true }).locator('..');
  async function load(name, native = false, dir = 'audit/bank/frozen') {
    for (const side of [0, 1]) {
      let file = `${dir}/${name}-${side}.csv`;
      if (native) {
        file = `${out}/bank-native-source-${side}.xlsx`;
        await copyFile(`work/bank/exports/${name}-source-${side}.xlsx`, file);
      }
      const source = page.getByTestId(`bank-source-${side}`);
      await source.getByLabel(sides[side], { exact: true }).setInputFiles(file);
      await source.getByText(file.split('/').at(-1), { exact: true }).waitFor();
    }
    // The card fills after the file is shown; wait for that paint to pass.
    await page.evaluate(
      () =>
        new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))),
    );
  }
  // The two files fill the card; nothing is confirmed and the run stays
  // closed until the accountant confirms with the one box.
  async function upload(name, native = false, dir = 'audit/bank/frozen') {
    await load(name, native, dir);
    await cardSaysFiles(name, dir, 'loaded');
    assert.equal(
      await card.locator('details').getAttribute('open'),
      null,
      `${name}: with nothing to ask, the fields stay folded`,
    );
    assert.equal(
      await confirmBox().isChecked(),
      false,
      `${name}: a suggestion never confirms`,
    );
    assert.equal(
      await runButton().isEnabled(),
      false,
      `${name}: the run waits for the accountant's confirmation`,
    );
    await confirmBox().check();
    await runButton().click();
    await page.getByTestId('bank-result').waitFor();
    // After the run the files are put back; what they hold still shows as
    // theirs.
    await cardSaysFiles(name, dir, 'after the run');
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
        row: a.closest('tr')?.children[3]?.textContent ?? null,
        inView: box.top >= (bar ? bar.bottom : 0) && box.bottom <= innerHeight,
      };
    });
  // The evidence drawer slides in for 160 ms with motion (UX-10); where it
  // ends is what the reader sees.
  const arrived = () =>
    page
      .locator('[data-evidence-drawer]')
      .evaluate((e) =>
        Promise.all(e.getAnimations().map((a) => a.finished)),
      );
  // Opening a movement's evidence on a phone takes the reader to it, and the
  // way back returns to that movement's row. The way in opens the row and
  // names its movement (UX-10).
  async function evidenceFocus(index) {
    const row = rows('Original movements').nth(index),
      ref = await row.locator('td').nth(3).innerText();
    await row
      .getByRole('button', {
        name: `Review source cells · ${ref}`,
        exact: true,
      })
      .click();
    await arrived();
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
    assert.equal(
      await page.locator('[data-evidence-drawer]').count(),
      0,
      'the way back closes the evidence',
    );
    return ref;
  }
  // The evidence thread (UX-10). The drawer is fixed over the page, so the
  // table does not move when it opens or closes. The row stays marked and
  // its way in stays reachable beside the drawer. The drawer names the row
  // the movement was read from. Escape closes it and returns the focus to the
  // row's button. With motion it slides in for 160 ms; with reduced motion it
  // is simply there.
  async function threadDrawer(width, motion) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: motion });
    const what = `${width} px, ${motion}`,
      frame = () =>
        section('Original movements').evaluate((e) => {
          const r = e.getBoundingClientRect();
          return [r.x, r.y + scrollY, r.width, r.height];
        }),
      row = rows('Original movements').nth(1),
      ref = await row.locator('td').nth(3).innerText(),
      place = await row.locator('td').nth(2).innerText(),
      button = row.getByRole('button', {
        name: `Review source cells · ${ref}`,
        exact: true,
      }),
      drawer = page.locator('[data-evidence-drawer]');
    const before = await frame();
    await button.click();
    await drawer.waitFor();
    assert.deepEqual(await frame(), before, `${what}: the table stays put`);
    assert.equal(await button.getAttribute('aria-expanded'), 'true', what);
    assert.equal(
      await button.getAttribute('aria-controls'),
      await drawer.getAttribute('id'),
      `${what}: the way in names the drawer`,
    );
    const marked = page.locator('tr[data-thread-open]');
    assert.equal(await marked.count(), 1, `${what}: one row is marked`);
    assert.equal(await marked.locator('td').nth(3).innerText(), ref, what);
    assert.equal(
      await drawer.locator('[data-thread-row]').innerText(),
      place,
      `${what}: the drawer names the row the movement was read from`,
    );
    const style = await drawer.evaluate((e) => {
      const s = getComputedStyle(e);
      return [s.position, s.animationName, s.animationDuration];
    });
    assert.deepEqual(
      style,
      motion === 'reduce'
        ? ['fixed', 'none', '0s']
        : ['fixed', 'evidence-drawer-in', '0.16s'],
      what,
    );
    if (width >= 1024)
      assert.deepEqual(
        await page.evaluate(() =>
          [...document.querySelectorAll('[data-bank-evidence-for]')]
            .filter((b) => {
              const r = b.getBoundingClientRect();
              if (r.bottom < 0 || r.top > innerHeight) return false;
              const hit = document.elementFromPoint(
                r.x + r.width / 2,
                r.y + r.height / 2,
              );
              return !!hit?.closest('[data-evidence-drawer]');
            })
            .map((b) => b.textContent),
        ),
        [],
        `${what}: no way in is under the drawer`,
      );
    await drawer.getByRole('heading', { level: 2 }).press('Escape');
    assert.equal(await drawer.count(), 0, `${what}: Escape closes it`);
    assert.deepEqual(await frame(), before, `${what}: the table stays put`);
    const back = await focused();
    assert.deepEqual(
      [back.tag, back.row],
      ['BUTTON', ref],
      `${what}: Escape returns to the row's way in`,
    );
    assert.equal(await button.getAttribute('aria-expanded'), 'false', what);
    await page.emulateMedia({ reducedMotion: null });
  }
  // Each table pages on its own: turning the movements leaves the cases and
  // the source rows where they are.
  async function ownPages() {
    assert.equal(await rows('Original movements').count(), 50);
    assert.equal(await rows('Every original source row').count(), 50);
    assert.equal(await rows('Whole movement cases').count(), 30);
    const next = (heading) =>
      section(heading).getByRole('button', { name: 'Next page', exact: true });
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
        '[data-testid="bank-result"] ~ fieldset :is(.gl-tb-table, .record-frame) :is(th, td)',
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
  // Every workpaper the page downloads opens on the reconciliation sheet,
  // which says what the screen says (UX-6(b)).
  const sheets = [];
  async function exportFile(file, lang = 'en') {
    await download(
      lang === 'ar'
        ? 'نزّل ورقة عمل حركات البنك'
        : 'Download bank movement workpaper',
      file,
    );
    sheets.push({
      file,
      ...(await bankSheetSaysScreen(page, {
        file: `${out}/${file}`,
        lang,
        result: page.getByTestId('bank-result').locator('..'),
      })),
    });
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
  // Each movement's way to its evidence names the movement (UX-10).
  const ways = page.getByRole('button', { name: /^Review source cells · / });
  assert.equal(
    await ways.count(),
    await rows('Original movements').count(),
    'each way to the evidence names its movement',
  );
  // An open evidence does not outlive a change of type, nor a restored
  // session (UX-10).
  await page
    .getByRole('button', { name: /^Review source cells · / })
    .first()
    .click();
  await page.locator('[data-evidence-drawer]').waitFor();
  await page
    .locator('select[data-reconciliation-type-select]')
    .selectOption('supplier');
  await openDomainWorkspace(page, 'bank');
  assert.equal(await rows('Original movements').count(), 4);
  assert.equal(
    await page.locator('[data-evidence-drawer]').count(),
    0,
    'a change of type closes the evidence',
  );
  await page
    .getByRole('button', { name: /^Review source cells · / })
    .first()
    .click();
  await page.locator('[data-evidence-drawer]').waitFor();
  await page
    .getByLabel('Restore bank movement session', { exact: true })
    .setInputFiles(`${out}/bank-session.json`);
  await page.getByTestId('bank-result').waitFor();
  // The result shown before stays until the session is read, so the check
  // waits a while for the evidence to close, then requires it.
  await page
    .locator('[data-evidence-drawer]')
    .waitFor({ state: 'detached', timeout: 15000 })
    .catch(() => {});
  assert.equal(
    await page.locator('[data-evidence-drawer]').count(),
    0,
    'a restored session closes the evidence',
  );
  await exportFile('bank-restored.xlsx');
  await page
    .getByRole('button', { name: /^Review source cells · / })
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
      side: r.children[1].textContent,
      ref: r.children[3].textContent,
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
  // With the evidence open, the reader turns the movements to another page;
  // the way back still returns to its movement, on that movement's page.
  await rows('Original movements')
    .nth(4)
    .getByRole('button', {
      name: `Review source cells · ${later}`,
      exact: true,
    })
    .click();
  await arrived();
  await section('Original movements')
    .getByRole('button', { name: 'Previous page', exact: true })
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
  for (const width of [1440, 1024, 390])
    for (const motion of ['no-preference', 'reduce'])
      await threadDrawer(width, motion);
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
  await openFields();
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
  assert.equal((await cardField('entity')).origin, 'user');
  // Rows that disagree leave the field a question: emptied, the fields
  // open, each value shown with its file and count. New files never write
  // over the accountant's entry.
  await load('account-mismatch');
  const entity = await cardField('entity');
  assert.equal(entity.value, 'Changed synthetic owner', 'the entry is kept');
  assert.equal(entity.origin, 'user');
  assert.equal(entity.hint, 'Your entry');
  const mixed = await filesSay('account-mismatch');
  assert.equal(mixed.account.counts.size, 2, 'the two files differ in account');
  const account = await cardField('account');
  assert.equal(account.origin, 'question');
  assert.equal(account.value, '', 'a disagreement is never filled');
  assert.equal(account.hint, 'The rows disagree, so enter the value');
  assert.deepEqual(
    account.values,
    [...mixed.account.counts].flatMap(([value, bySide]) =>
      [...bySide].map(([side, n]) => `“${value}” in ${side}: ${n}`),
    ),
  );
  assert.equal(await card.locator('details').getAttribute('open'), '');
  assert.equal(await confirmBox().isChecked(), false);
  await page.getByLabel('Entity', { exact: true }).fill(truth.scope.entity);
  await page
    .getByLabel('Bank account', { exact: true })
    .fill(truth.scope.account);
  assert.equal(
    await card.locator('details').getAttribute('open'),
    '',
    'answering the last question does not fold the field being typed in',
  );
  await confirmBox().check();
  assert.equal(await runButton().isEnabled(), true);
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
    // In Arabic the same example downloads with the sheet in Arabic.
    if (lang === 'ar') await exportFile('bank-example-ar.xlsx', 'ar');
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
  assert.ok(
    sheets.some((s) => s.waiting) && sheets.some((s) => s.decisions),
    'a sheet with a case waiting and one with a decision',
  );
  return { downloads: 13, synthetic: true, movementOnly: true, sheets };
}
