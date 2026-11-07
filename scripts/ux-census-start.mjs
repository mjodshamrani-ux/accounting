// The inputs a reader sets before the first run (UX-5): for each workspace,
// committed synthetic sources and the recipe of what a reader must set once
// they are loaded, by the names the reader sees in English. The census loads
// the sources as a reader would, applies the recipe, runs, and requires a
// result (the recipe is enough); then, in English, it leaves out each step in
// turn and requires the run to stay closed or to say something else (each
// step is needed). A step the workspace no longer needs, because it reads
// the value itself or stopped asking, fails the census until the recipe
// drops it; a step the recipe misses fails the first run. So the count is
// what these sources ask of a reader, neither more nor less.
//
// Arabic repeats the English actions on the same controls by their place in
// the workspace, and requires each to be the same kind of control with a
// name of its own; the count is the same in both languages by construction,
// and the census sums the two, as it does for the focus classes.
//
// Synthetic sources only. Nothing here asserts a financial truth: the values
// are the scope the synthetic rows carry, or, where a file carries none, the
// value the workspace's own browser check declares.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const csv =
  'date,reference,amount\n2026-08-01,INV-0001,100.00\n2026-08-02,PAY-0001,-20.00';
const four = (dir, name) =>
  [0, 1, 2, 3].map((i) => `audit/${dir}/frozen/${name}-${i}.csv`);
const cases = (dir, name, k) =>
  Array.from(
    { length: k },
    (_, i) => `audit/${dir}/cases/${name}/source-${i}.csv`,
  );
const pair = (files, labels) => labels.map((label, i) => [label, files[i]]);

// A step is [kind, name, value?, occurrence?]: `check` a box whose name
// starts with `name`; `fill` a text field named `name`; `select` in the list
// named `name` the column headed `value`; `press` a button named `name`.
// `occurrence` picks among controls of the same kind and name, in order.
export const START = {
  supplier: {
    sources: [
      ['Supplier statement', { name: 'synthetic.csv', body: csv }],
      ['Accounts payable report', { name: 'synthetic.csv', body: csv + '\n' }],
    ],
    steps: [
      ['press', 'Confirm data'],
      ['fill', 'Currency', 'SAR'],
    ],
    run: 'Check and compare',
  },
  clearing: {
    sources: [['Clearing movements file', 'audit/clearing/frozen/source.csv']],
    steps: [
      ['select', 'Unique posting ID', 'Posting ID'],
      ['select', 'Clearing reference', 'Clearing Reference'],
      ['select', 'Movement date', 'Date'],
      ['select', 'Signed amount', 'Amount'],
      ['select', 'Account', 'Account'],
      ['select', 'Currency', 'Currency'],
      ['fill', 'Entity', 'Synthetic Entity'],
      ['fill', 'Ledger', 'Synthetic Ledger'],
      ['fill', 'Account', '2150'],
      ['fill', 'Period start', '2026-09-01'],
      ['fill', 'Period end', '2026-09-30'],
      ['check', 'I reviewed the column meanings and scope'],
    ],
    run: 'Check clearing',
  },
  ar: {
    sources: pair(
      [
        'audit/ar-limited/frozen/positive-ledger.csv',
        'audit/ar-limited/frozen/positive-statement.csv',
      ],
      ['Company AR ledger', 'Company-issued customer statement'],
    ),
    steps: [
      ...['Company AR ledger', 'Company-issued customer statement'].flatMap(
        (side) => [
          ...[
            ['Unique posting ID', 'Posting ID'],
            ['Document type', 'Document type'],
            ['Own document number', 'Own document number'],
            ['Posting date', 'Posting date'],
            ['Original signed amount', 'Original signed amount'],
            ['Entity', 'Entity'],
            ['Ledger', 'Ledger'],
            ['Customer ID', 'Customer'],
            ['Account', 'Account'],
            ['Currency', 'Currency'],
          ].map(([field, column]) => ['select', `${side}: ${field}`, column]),
          ['check', `${side}: I reviewed this source`],
        ],
      ),
      ['fill', 'Entity', 'Synthetic Seller'],
      ['fill', 'Ledger', 'AR Book'],
      ['fill', 'Customer ID', 'C0001'],
      ['fill', 'Account', '1200'],
      ['fill', 'Period start', '2026-09-01'],
      ['fill', 'Period end', '2026-09-30'],
      ['check', 'I reviewed the common entity, ledger, customer'],
    ],
    run: 'Compare AR documents',
  },
  'gl-tb': {
    sources: pair(
      [
        'audit/gl-tb/frozen/positive-gl.csv',
        'audit/gl-tb/frozen/positive-tb.csv',
      ],
      ['GL detail and balances', 'Trial balance source'],
    ),
    // UX-5(d): the files' scope columns fill the card; one confirmation.
    steps: [
      [
        'check',
        'I reviewed the GL detail and balances and the trial balance source',
      ],
    ],
    run: 'Verify GL/TB consistency',
  },
  allocation: {
    sources: pair(
      [0, 1, 2].map((i) => `audit/allocation/frozen/one-to-many-${i}.csv`),
      ['Available payments', 'Open invoices', 'Proposed remittance'],
    ),
    // UX-5(d): the files' scope columns fill the card; one confirmation.
    steps: [
      [
        'check',
        'I reviewed the available payments, the open invoices and the proposed remittance',
      ],
    ],
    run: 'Read value ledger',
  },
  bank: {
    sources: pair(
      [0, 1].map((i) => `audit/bank/frozen/individual-${i}.csv`),
      ['Bank statement', 'Cashbook'],
    ),
    // UX-5(d): the files' scope columns fill the card; one confirmation.
    steps: [['check', 'I reviewed the bank statement and the cashbook']],
    run: 'Compare bank movements',
  },
  'tb-financial': {
    sources: pair(four('tb-financial', 'partial-line-accept'), [
      'Trial balance',
      'Proposed mapping',
      'Independent presentation evidence',
      'Financial position',
    ]),
    // UX-5(d): the files' scope columns fill the card; one confirmation.
    steps: [
      [
        'check',
        'I reviewed the trial balance, the proposed mapping, the independent presentation evidence and the financial position',
      ],
    ],
    run: 'Check mapping and amounts',
  },
  intercompany: {
    sources: pair(four('intercompany', 'accept-timing'), [
      'Left entity ledger',
      'Right entity ledger',
      'Independent relationship evidence',
      'Independent timing evidence',
    ]),
    // UX-5(d): the files' scope columns fill the card; one confirmation.
    steps: [
      [
        'check',
        'I reviewed the left and right entity ledgers, the independent relationship evidence and the independent timing evidence',
      ],
    ],
    run: 'Check reciprocal transactions',
  },
  gateway: {
    sources: pair(four('payment-gateway', 'accepted'), [
      'Gateway sales and refunds',
      'Independent fee evidence',
      'Gateway settlement summary',
      'Bank credit evidence',
    ]),
    // UX-5(d): the files' scope columns fill the card; one confirmation.
    steps: [
      [
        'check',
        'I reviewed the gateway sales and refunds, the independent fee evidence, the gateway settlement summary and the bank credit evidence',
      ],
    ],
    run: 'Check gateway batch',
  },
  stock: {
    sources: pair(
      cases('inventory-register', 'independent-units-positive', 4),
      [
        'Posted inventory register',
        'Proposed item / GL mapping',
        'Independent supplied policy evidence',
        'Selected inventory GL balances',
      ],
    ),
    // UX-5(d): the files' scope columns fill the card; one confirmation.
    steps: [
      [
        'check',
        'I reviewed the posted inventory register, the proposed item / GL mapping, the independent supplied policy evidence and the selected inventory GL balances',
      ],
    ],
    run: 'Check inventory / GL',
  },
  assets: {
    sources: pair(cases('fixed-assets', 'jpy-zero-precision-positive', 4), [
      'Posted asset component register',
      'Proposed asset component / GL mapping',
      'Independent supplied asset policy evidence',
      'Selected asset GL balances',
    ]),
    steps: [
      ...[0, 1, 2, 3].map((i) => [
        'check',
        'I confirmed this original and its role',
        undefined,
        i,
      ]),
      ...[
        ['Entity', 'Synthetic Asset Owner'],
        ['Asset ledger', 'ASSET-BOOK'],
        ['GL ledger', 'GL-BOOK'],
        ['Currency', 'JPY'],
        ['Posting layer', 'Current'],
        ['As of', '2026-09-30'],
        ['Chart version', 'CHART-1'],
        ['Map version', 'MAP-1'],
        ['Component policy version', 'provided-components-1'],
        ['Asset account set version', 'ASSET-SET-1'],
      ].map(([field, value]) => ['fill', `Asset scope ${field}`, value]),
      ['check', 'I confirmed the complete'],
    ],
    run: 'Check asset components / GL',
  },
  payroll: {
    sources: pair(cases('payroll', 'seven-components-and-bank-positive', 5), [
      'Posted employee payroll register',
      'Proposed employee component / GL mapping',
      'Independent supplied payroll policy evidence',
      'Selected posted payroll and disbursement GL entries',
      'Independent posted bank payout',
    ]),
    steps: [
      ...[0, 1, 2, 3, 4].map((i) => [
        'check',
        'I confirmed this original and its role',
        undefined,
        i,
      ]),
      ...[
        ['Entity', 'Synthetic Payroll Owner'],
        ['Payroll run', 'RUN-2026-09'],
        ['Payroll ledger', 'PAYROLL-BOOK'],
        ['GL ledger', 'GL-BOOK'],
        ['Currency', 'SAR'],
        ['Posting layer', 'Current'],
        ['Period start', '2026-09-01'],
        ['Period end', '2026-09-30'],
        ['Payroll posting date', '2026-09-30'],
        ['Payment date', '2026-10-01'],
        ['Bank account', 'BANK-001'],
        ['Payout reference', 'PAYOUT-2026-09'],
        ['Chart version', 'CHART-1'],
        ['Map version', 'MAP-1'],
        ['Payroll policy version', 'PAYROLL-POL-1'],
        ['Bank mapping version', 'BANK-MAP-1'],
        ['Account set version', 'ACCOUNT-SET-1'],
      ].map(([field, value]) => ['fill', `Payroll scope ${field}`, value]),
      ['check', 'I confirmed the complete'],
    ],
    run: 'Check payroll components / GL / bank',
  },
};

// Every control a reader can act on in the workspace, in page order; an
// action is held as its place in this list, which Arabic replays.
const CONTROLS = 'input, select, textarea, button';

// Finds the control a step names, in page; returns its place or a reason.
function findInPage(root, { kind, name, occurrence, controls }) {
  const label = (e) =>
    (
      e.getAttribute('aria-label') ||
      (e.labels?.length
        ? [...e.labels].map((l) => l.innerText).join(' ')
        : '') ||
      (e.tagName === 'BUTTON' ? e.innerText : '')
    )
      .replace(/\s+/g, ' ')
      .trim();
  const all = [...root.querySelectorAll(controls)];
  const text = (e) =>
    e.tagName === 'TEXTAREA' ||
    (e.tagName === 'INPUT' &&
      !['checkbox', 'radio', 'file', 'button', 'submit', 'hidden'].includes(
        e.type,
      ));
  const fits = {
    check: (e) => e.type === 'checkbox' && label(e).startsWith(name),
    fill: (e) => text(e) && label(e) === name,
    select: (e) => e.tagName === 'SELECT' && label(e) === name,
    press: (e) => e.tagName === 'BUTTON' && label(e) === name,
    file: (e) => e.type === 'file' && label(e) === name,
  }[kind];
  const found = all.filter(fits);
  const element = found[occurrence ?? 0];
  if (!element)
    return {
      error: `${kind} "${name}" #${occurrence ?? 0}: ${found.length} found`,
    };
  return { index: all.indexOf(element) };
}

// What a control is, in page, by its place: its kind and its own name.
function kindInPage(root, { index, controls }) {
  const e = root.querySelectorAll(controls)[index];
  if (!e) return null;
  const name = (
    e.getAttribute('aria-label') ||
    (e.labels?.length ? [...e.labels].map((l) => l.innerText).join(' ') : '') ||
    (e.tagName === 'BUTTON' ? e.innerText : '')
  ).trim();
  return { kind: `${e.tagName}:${e.type ?? ''}`, named: name.length > 0, name };
}

// What the result says, in page: the alignment strip as drawn and read, or
// the workspace's alert where no strip is drawn.
function outcomeInPage(root) {
  const strip = root.querySelector('[data-alignment-strip]');
  if (strip)
    return `strip ${strip.textContent.replace(/\s+/g, ' ').trim()} ${JSON.stringify(
      [...strip.querySelectorAll('[data-strip-cell]')].map((c) => ({
        ...c.dataset,
      })),
    )}`;
  const alerts = [...root.querySelectorAll('[role="alert"]')]
    .map((a) => a.textContent.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return alerts.length ? `alert ${alerts.join(' | ')}` : 'none';
}

async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(resolve, 150)),
        ),
      ),
  );
}
// The workspace is idle: nothing in it is busy or loading.
async function idle(page, selector, timeout = 60000) {
  await page.waitForFunction(
    (s) => {
      const panel = document.querySelector(s);
      return (
        panel &&
        !panel.closest('[aria-busy="true"]') &&
        !panel.querySelector('[aria-busy="true"], .notice.loading')
      );
    },
    selector,
    { timeout },
  );
  await settle(page);
}

// The control at a place, as the page lists it: held by its element, so the
// place means the same thing here as in the functions that run in page.
async function control(page, selector, index) {
  const handle = await page
    .locator(selector)
    .evaluateHandle(
      (root, { index, controls }) =>
        root.querySelectorAll(controls)[index] ?? null,
      { index, controls: CONTROLS },
    );
  const element = handle.asElement();
  assert.ok(element, `no control at ${index}`);
  return element;
}

// Whether a control already holds what a step sets, in page.
function holdsInPage(root, { index, controls, kind, value }) {
  const e = root.querySelectorAll(controls)[index];
  if (kind === 'check') return e.checked;
  if (kind === 'fill') return e.value === value;
  if (kind === 'select')
    return (
      e.selectedOptions[0]?.textContent.trim().replace(/^\d+\s*[:·]\s*/, '') ===
      value
    );
  return false;
}

// What a control holds, in page: the state a step is undone to.
function stateInPage(root, { index, controls }) {
  const e = root.querySelectorAll(controls)[index];
  return { checked: e.checked, value: e.value };
}

// Applies a step, or with `before`, puts the control back as it was before
// the recipe touched it: leaving a step out leaves what the workspace put
// there itself, a value it read or a default, not an empty field.
async function act(page, selector, index, step, before = null) {
  const [kind, , value] = step;
  const element = await control(page, selector, index);
  if (before) {
    if (kind === 'check') await element.setChecked(before.checked);
    else if (kind === 'fill') await element.fill(before.value);
    else if (kind === 'select') await element.selectOption(before.value);
    await idle(page, selector);
    return;
  }
  // Applying again what a control already holds changes nothing; only what
  // a change has cleared is set again.
  if (
    await page
      .locator(selector)
      .evaluate(holdsInPage, { index, controls: CONTROLS, kind, value })
  )
    return;
  if (kind === 'check') await element.check();
  else if (kind === 'fill') await element.fill(value);
  else if (kind === 'select') {
    const options = await element.$$eval('option', (all) =>
      all.map((o) => o.textContent),
    );
    const at = options.findIndex(
      (o) =>
        o.trim() === value || o.trim().replace(/^\d+\s*[:·]\s*/, '') === value,
    );
    assert.ok(at >= 0, `select ${step[1]}: no column "${value}"`);
    await element.selectOption({ index: at });
  } else if (kind === 'press') await element.click();
  await idle(page, selector);
}

// Presses the run and waits for the worker's reply, or for the workspace to
// settle where it answers without one.
async function run(page, selector, index) {
  const before = await page.evaluate(
    () => globalThis.alignmentReplies?.length ?? 0,
  );
  await (await control(page, selector, index)).click();
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    const now = await page.evaluate(
      () => globalThis.alignmentReplies?.length ?? 0,
    );
    if (now > before) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await idle(page, selector);
  return page.locator(selector).evaluate(outcomeInPage);
}

const name = (step) =>
  `${step[0]} ${step[1]}${step[3] === undefined ? '' : ` #${step[3]}`}`;

async function source(file) {
  if (typeof file !== 'string')
    return {
      name: file.name,
      mimeType: 'text/csv',
      buffer: Buffer.from(file.body),
    };
  return {
    name: path.basename(file),
    mimeType: 'text/csv',
    buffer: await readFile(path.join(root, file)),
  };
}

/**
 * Loads the sources and applies the recipe in a fresh workspace. In English
 * it finds each control by name and returns the plan of places; given a
 * plan (Arabic), it acts on the same places and checks each is the same
 * kind of control with a name of its own. With `necessity`, each step is
 * left out in turn. Returns the count, the plan and what was found.
 */
export async function measureStart(
  page,
  domain,
  { plan = null, necessity = false, recipe = START[domain] } = {},
) {
  const selector = `[data-domain-panel="${domain}"]:not([hidden])`;
  const actions = [
    ...recipe.sources.map(([name, file]) => ({ kind: 'file', name, file })),
    ...recipe.steps.map((step) => ({ kind: step[0], name: step[1], step })),
    { kind: 'press', name: recipe.run, run: true },
  ];
  const places = [];
  const initial = [];
  const held = [];
  const at = async (i, action) => {
    const panel = page.locator(selector);
    if (plan) {
      const found = await panel.evaluate(kindInPage, {
        index: plan[i].index,
        controls: CONTROLS,
      });
      assert.ok(
        found,
        `${domain}: no control at ${plan[i].index} for ${action.name}`,
      );
      assert.equal(
        found.kind,
        plan[i].kind,
        `${domain}: ${action.name} is another kind of control here`,
      );
      assert.ok(found.named, `${domain}: ${action.name} has no name here`);
      return plan[i].index;
    }
    const found = await panel.evaluate(findInPage, {
      kind: action.kind,
      name: action.name,
      occurrence: action.step?.[3],
      controls: CONTROLS,
    });
    assert.ok(!found.error, `${domain}: ${found.error}`);
    const kind = (
      await panel.evaluate(kindInPage, {
        index: found.index,
        controls: CONTROLS,
      })
    ).kind;
    places[i] = { index: found.index, kind };
    return found.index;
  };
  await idle(page, selector);
  const runIndex = actions.length - 1;
  for (const [i, action] of actions.entries()) {
    if (action.run) break;
    const index = await at(i, action);
    if (action.kind === 'file') {
      await (
        await control(page, selector, index)
      ).setInputFiles(await source(action.file));
      await idle(page, selector);
    } else {
      if (action.kind === 'press' && necessity) {
        // A step that opens the run: the run is not there before it.
        const open = await page
          .locator(selector)
          .evaluate(findInPage, {
            kind: 'press',
            name: recipe.run,
            controls: CONTROLS,
          });
        assert.ok(
          open.error,
          `${domain}: the run is there before "${action.name}"`,
        );
      }
      if (action.kind !== 'press') {
        const panel = page.locator(selector);
        initial[i] = await panel.evaluate(stateInPage, {
          index,
          controls: CONTROLS,
        });
        // A control that already holds what the step sets: the step asks
        // the reader for nothing.
        if (
          await panel.evaluate(holdsInPage, {
            index,
            controls: CONTROLS,
            kind: action.kind,
            value: action.step[2],
          })
        )
          held.push(i - recipe.sources.length);
      }
      await act(page, selector, index, action.step);
    }
  }
  const runAt = await at(runIndex, actions[runIndex]);
  // Each step left out in turn, the others applied in order: first whether
  // the run stays closed without it, before any run, since a run can fold
  // the setup away (the supplier's steps); then, for the steps without which
  // the run opens, whether the run says something else without them.
  const first = recipe.sources.length;
  const applyFrom = async (k) => {
    for (let j = k; j < recipe.steps.length; j++)
      if (recipe.steps[j][0] !== 'press')
        await act(page, selector, places[first + j].index, recipe.steps[j]);
  };
  // Whether the run is there and open: found by its name in English, since
  // a step can put it on the page; at its place in Arabic.
  const runOpen = async () => {
    if (plan) return (await control(page, selector, runAt)).isEnabled();
    const found = await page
      .locator(selector)
      .evaluate(findInPage, {
        kind: 'press',
        name: recipe.run,
        controls: CONTROLS,
      });
    return (
      !found.error &&
      (await (await control(page, selector, found.index)).isEnabled())
    );
  };
  const open = [];
  const needless = held.map((k) => name(recipe.steps[k]));
  if (necessity)
    for (const [k, step] of recipe.steps.entries()) {
      if (step[0] === 'press' || held.includes(k)) continue;
      await act(
        page,
        selector,
        places[first + k].index,
        step,
        initial[first + k],
      );
      await applyFrom(k + 1);
      if (await runOpen()) open.push(k);
      await applyFrom(k);
    }
  assert.ok(await runOpen(), `${domain}: the run is closed after the recipe`);
  const full = await run(page, selector, runAt);
  assert.ok(
    full.startsWith('strip '),
    `${domain}: the recipe did not reach a result (${full.slice(0, 200)})`,
  );
  for (const k of open) {
    const step = recipe.steps[k];
    await act(
      page,
      selector,
      places[first + k].index,
      step,
      initial[first + k],
    );
    await applyFrom(k + 1);
    const without = (await runOpen())
      ? await run(page, selector, runAt)
      : 'closed';
    if (without === full) needless.push(name(step));
    await applyFrom(k);
  }
  return {
    count: recipe.steps.length,
    plan: plan ?? places,
    outcome: full,
    needless,
  };
}

/**
 * Compares a run with the record, workspace by workspace. Any difference is
 * reported: more inputs is a new question asked of the reader, fewer an
 * improvement the record must hold. `only` limits the run to some
 * workspaces without calling the others unmeasured.
 */
export function compareStart(recorded, current, { only } = {}) {
  const increases = [],
    decreases = [],
    missing = [];
  for (const [domain, now] of Object.entries(current)) {
    const was = recorded[domain];
    if (!Number.isInteger(was)) missing.push(`${domain}: no record`);
    else if (now > was) increases.push(`${domain}: ${was} → ${now}`);
    else if (now < was) decreases.push(`${domain}: ${was} → ${now}`);
  }
  for (const domain of Object.keys(recorded))
    if (!(domain in current) && (!only || only.includes(domain)))
      missing.push(`${domain}: not measured`);
  return { increases, decreases, missing };
}
