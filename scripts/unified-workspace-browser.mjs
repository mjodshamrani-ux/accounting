// Focused local UI proof: native type selection, shared source entry, retained
// work, responsive Arabic/English bounds, and the bytes of the rendered fonts.
// Synthetic CSVs only; no OCR, model execution, financial oracle, or external IO.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const proofRoot =
  process.env.MIZAN_PROOF_DIR ?? path.join(root, 'work/qa-unified-workspace');
await mkdir(proofRoot, { recursive: true });
const out = await mkdtemp(path.join(proofRoot, 'verification-'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const domains = [
  'supplier',
  'clearing',
  'ar',
  'gl-tb',
  'allocation',
  'bank',
  'tb-financial',
  'intercompany',
  'gateway',
  'stock',
  'assets',
  'payroll',
];
const selector = '[data-reconciliation-type-select]:visible';
const sourceCounts = {
  clearing: 1,
  ar: 2,
  'gl-tb': 2,
  allocation: 3,
  bank: 2,
  'tb-financial': 4,
  intercompany: 4,
  gateway: 4,
  stock: 4,
  assets: 4,
  payroll: 5,
};
// Existing public synthetic sources, in the visible primary-pair order. These
// bytes exercise native upload/progression only; no financial result is run.
const fixturePaths = {
  clearing: ['audit/clearing/frozen/source.csv'],
  ar: [
    'audit/ar-limited/frozen/positive-ledger.csv',
    'audit/ar-limited/frozen/positive-statement.csv',
  ],
  'gl-tb': [
    'audit/gl-tb/frozen/positive-gl.csv',
    'audit/gl-tb/frozen/positive-tb.csv',
  ],
  allocation: [
    'audit/allocation/frozen/one-to-one-0.csv',
    'audit/allocation/frozen/one-to-one-1.csv',
  ],
  bank: [
    'audit/bank/frozen/individual-0.csv',
    'audit/bank/frozen/individual-1.csv',
  ],
  'tb-financial': [
    'audit/tb-financial/frozen/whole-post-closing-0.csv',
    'audit/tb-financial/frozen/whole-post-closing-3.csv',
  ],
  intercompany: [
    'audit/intercompany/frozen/pending-0.csv',
    'audit/intercompany/frozen/pending-1.csv',
  ],
  gateway: [
    'audit/payment-gateway/frozen/pending-0.csv',
    'audit/payment-gateway/frozen/pending-2.csv',
  ],
  stock: [
    'audit/inventory-register/cases/independent-units-positive/source-0.csv',
    'audit/inventory-register/cases/independent-units-positive/source-3.csv',
  ],
  assets: [
    'audit/fixed-assets/cases/three-components-positive/source-0.csv',
    'audit/fixed-assets/cases/three-components-positive/source-3.csv',
  ],
  payroll: [
    'audit/payroll/cases/seven-components-and-bank-positive/source-0.csv',
    'audit/payroll/cases/seven-components-and-bank-positive/source-3.csv',
  ],
};
const fixtures = {};
for (const [domain, paths] of Object.entries(fixturePaths))
  fixtures[domain] = await Promise.all(
    paths.map(async (file) => ({
      path: file,
      bytes: await readFile(path.join(root, file)),
    })),
  );
const fonts = [
  {
    family: 'Thmanyah Serif Display',
    path: '/fonts/thmanyah-serif-display-bold.woff2',
    sha256: 'd36da84ee5423145415425bdd9c10dc27f57a66afec031bd7b78e662572846ce',
  },
  {
    family: 'Noto Sans Arabic',
    path: '/fonts/noto-sans-arabic-variable.woff2',
    sha256: '802ec442ca217cf586882350bf8090f7a18f4cbf6cbc8659e82a1ebc282b2ebc',
  },
];
const report = {
  synthetic: true,
  fieldAcceptance: false,
  at: new Date().toISOString(),
  machine: { platform: process.platform, arch: process.arch, headless: true },
  bindings: {},
  cases: [],
  fontResponses: [],
  fixtures: Object.fromEntries(
    Object.entries(fixtures).map(([domain, files]) => [
      domain,
      files.map(({ path: file, bytes }) => ({
        path: file,
        bytes: bytes.length,
        sha256: sha(bytes),
      })),
    ]),
  ),
  blocked: [],
  errors: [],
};
for (const file of [
  'app/page.tsx',
  'components/workspace-chrome.tsx',
  'components/workspace-chrome.css',
  'dist/index.html',
  'scripts/unified-workspace-browser.mjs',
])
  report.bindings[file] = sha(await readFile(path.join(root, file)));

const server = createServer(async (req, res) => {
  try {
    const rel = new URL(req.url, 'http://local').pathname;
    const file = path.resolve(dist, '.' + (rel === '/' ? '/index.html' : rel));
    if (!file.startsWith(dist + path.sep)) throw Error('path');
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.wasm': 'application/wasm',
      }[path.extname(file)] ?? 'application/octet-stream',
    );
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
let activePage;
let failure;
const responseChecks = [];

async function bounds(page, label) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  const result = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    controls: [...document.querySelectorAll('select, button, input, textarea')]
      .filter(
        (element) =>
          element.getClientRects().length && !element.closest('[hidden]'),
      )
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.left < -1 || box.right > innerWidth + 1;
      })
      .map((element) => ({
        tag: element.tagName,
        name: element.getAttribute('aria-label'),
        text: element.textContent.slice(0, 100),
      })),
  }));
  assert.ok(
    result.document <= result.viewport + 1 &&
      result.body <= result.viewport + 1,
    `${label}: no document overflow ${JSON.stringify(result)}`,
  );
  assert.deepEqual(
    result.controls,
    [],
    `${label}: interactive controls fit the viewport`,
  );
  return result;
}

async function capture(page, name) {
  // Exercise the real scroll-reveal path before a full-page capture. A browser
  // screenshot alone does not bring offscreen sections into the viewport.
  for (const element of await page.locator('[data-reveal]').all()) {
    if ((await element.getAttribute('class'))?.includes('is-revealed'))
      continue;
    await element.scrollIntoViewIfNeeded();
    await element
      .page()
      .waitForFunction(
        (node) => node.classList.contains('is-revealed'),
        await element.elementHandle(),
      );
  }
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-reveal]')].every(
      (element) => getComputedStyle(element).opacity === '1',
    ),
  );
  // A full-page capture taken after heading focus otherwise records sticky
  // chrome at the old scroll offset, including an offscreen skip link.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.screenshot({ path: path.join(out, name), fullPage: true });
}

async function assertMainLandmark(page, domain, evidence) {
  const count = await page.getByRole('main').count();
  evidence.push({ domain, count });
  assert.equal(count, 1, `${domain}: exactly one main landmark is exposed`);
}

async function sharedPageSnapshot(page, initialSections, domain) {
  const evidence = await page.evaluate((initial) => {
    const selectors = [
      '.landing-intro',
      '.document-scene',
      '.tarasuf-benefits-wrap',
      '#how-it-works',
      '#privacy',
      '#privacy-details',
      '.site-footer',
    ];
    return {
      sections: selectors.map((selector, index) => {
        const nodes = document.querySelectorAll(selector);
        return {
          selector,
          count: nodes.length,
          retained: nodes[0] === initial[index],
          rendered: !!nodes[0]?.getClientRects().length,
        };
      }),
      titles: [...document.querySelectorAll('h1')].filter(
        (heading) =>
          heading.getClientRects().length && !heading.closest('[hidden]'),
      ).length,
      brandTarget: document
        .querySelector('.topbar .brand')
        ?.getAttribute('href'),
      privacyTarget: document
        .querySelector('.site-footer .footer-privacy-link')
        ?.getAttribute('href'),
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
    };
  }, initialSections);
  assert.equal(
    evidence.sections.every(
      ({ count, retained, rendered }) => count === 1 && retained && rendered,
    ),
    true,
    `${domain}: the hero, features, process, privacy and footer stay on one page`,
  );
  assert.equal(evidence.titles, 1, `${domain}: one visible page title`);
  assert.equal(evidence.brandTarget, '#top');
  assert.equal(evidence.privacyTarget, '#privacy-details');
  assert.ok(
    evidence.documentHeight > evidence.viewportHeight,
    `${domain}: shared page content remains scrollable`,
  );
  return evidence;
}

async function illustrationGeometry(svg) {
  return svg.evaluate((element) => ({
    viewBox: element.getAttribute('viewBox'),
    shapes: [...element.querySelectorAll('path, rect, circle, ellipse')].map(
      (shape) => ({
        tag: shape.tagName,
        geometry: Object.fromEntries(
          ['d', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry']
            .filter((name) => shape.hasAttribute(name))
            .map((name) => [name, shape.getAttribute(name)]),
        ),
      }),
    ),
    localPaints: [...element.querySelectorAll('[fill], [stroke]')]
      .flatMap((shape) =>
        ['fill', 'stroke'].map((name) => shape.getAttribute(name) ?? ''),
      )
      .filter((paint) => paint.startsWith('url(#'))
      .every((paint) => {
        const target = document.getElementById(paint.slice(5, -1));
        return target && element.contains(target);
      }),
  }));
}

async function assertSharedUploadInteraction(control, domain) {
  const input = control.locator('input[type="file"]');
  const paper = control.locator('.source-card__paper');
  assert.equal(await input.isEnabled(), true);
  const resting = await paper.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  await input.focus();
  const paperElement = await paper.elementHandle();
  try {
    await paper.page().waitForFunction((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return Math.abs(matrix.b) < 0.001 && Math.abs(matrix.f + 4) < 0.001;
    }, paperElement);
  } finally {
    await paperElement.dispose();
  }
  const focused = await paper.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  assert.notEqual(
    focused,
    resting,
    `${domain}: keyboard focus animates the same paper affordance`,
  );
  assert.equal(
    await input.evaluate((element) => document.activeElement === element),
    true,
    `${domain}: the original native file input keeps keyboard focus`,
  );
  await input.evaluate((element) => element.blur());
  const dataTransfer = await input.page().evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([''], 'visual-drag-only.csv'));
    return transfer;
  });
  try {
    await control.dispatchEvent('dragenter', { dataTransfer });
    assert.equal(
      await control.getAttribute('data-drag-active'),
      'true',
      `${domain}: file drag receives the shared visual response`,
    );
    assert.equal(
      await input.evaluate((element) => element.files.length),
      0,
      `${domain}: drag feedback does not import a file`,
    );
    await control.dispatchEvent('dragleave', { dataTransfer });
    assert.equal(await control.getAttribute('data-drag-active'), 'false');
  } finally {
    await dataTransfer.dispose();
  }
  return {
    focusChangesPaper: true,
    dragChangesPaper: true,
    nativeFileCount: 0,
  };
}

async function snapshot(panel) {
  return panel.evaluate((element) => ({
    sources: [
      ...element.querySelectorAll(
        '.source-card__description, .workspace-source p, .workspace-source h3',
      ),
    ].map((node) => node.textContent.trim()),
    inputs: [
      ...element.querySelectorAll('input:not([type="file"]), select, textarea'),
    ]
      .filter((input) => !input.matches('[data-reconciliation-type-select]'))
      .map((input) => ({
        tag: input.tagName,
        type: input.type,
        value: input.value,
        checked: input.checked,
      })),
    fileSelections: [...element.querySelectorAll('input[type="file"]')].map(
      (input) =>
        [...input.files].map((file) => ({ name: file.name, size: file.size })),
    ),
  }));
}

async function selectType(page, domain) {
  const type = page.locator(selector);
  const previous = await type.inputValue();
  await type.focus();
  assert.equal(
    await type.evaluate((element) => document.activeElement === element),
    true,
  );
  await type.selectOption(domain);
  assert.equal(await page.locator(selector).inputValue(), domain);
  assert.equal(
    await page.getByRole('alertdialog').count(),
    0,
    'type changes preserve mounted work directly',
  );
  if (previous === domain) {
    assert.equal(
      await type.evaluate((element) => document.activeElement === element),
      true,
      'choosing the current type keeps focus',
    );
    return;
  }
  const heading =
    domain === 'supplier'
      ? page.locator('.workflow-title:visible').first()
      : page
          .locator(
            `[data-domain-panel="${domain}"]:visible .workspace-intro h1`,
          )
          .first();
  await heading.waitFor();
  const focus = heading;
  assert.equal(
    await focus.evaluate((element) => document.activeElement === element),
    true,
    `${domain}: type selection restores the workflow keyboard position`,
  );
}

async function protectedUnload(page) {
  return page.evaluate(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

async function usedFonts(page, cssSelector) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    await client.send('DOM.getDocument');
    const result = await client.send('Runtime.evaluate', {
      expression: `([...document.querySelectorAll(${JSON.stringify(cssSelector)})].find(element => element.getClientRects().length && !element.closest('[hidden]')))`,
    });
    assert.ok(result.result.objectId, `font target is visible: ${cssSelector}`);
    const node = await client.send('DOM.requestNode', {
      objectId: result.result.objectId,
    });
    return (
      await client.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId })
    ).fonts;
  } finally {
    await client.detach();
  }
}

async function fontProof(page, language) {
  await page.evaluate(() => document.fonts.ready);
  const faces = await page.evaluate(() =>
    [...document.fonts].map((face) => ({
      family: face.family.replace(/["']/g, ''),
      status: face.status,
      weight: face.weight,
    })),
  );
  for (const font of fonts)
    assert.ok(
      faces.some(
        (face) => face.family === font.family && face.status === 'loaded',
      ),
      `${font.family}: local FontFace finished loading`,
    );
  const logo = await usedFonts(page, '.brand-wordmark-arabic');
  assert.ok(
    logo.some(
      (font) =>
        font.isCustomFont &&
        font.familyName.toLowerCase() === fonts[0].family.toLowerCase() &&
        font.glyphCount > 0,
    ),
    'brand glyphs actually use the official custom font',
  );
  const heading = await usedFonts(page, '.workflow-title');
  if (language === 'ar')
    assert.ok(
      heading.some(
        (font) =>
          font.isCustomFont &&
          font.familyName.toLowerCase() === fonts[0].family.toLowerCase() &&
          font.glyphCount > 0,
      ),
      'Arabic workflow heading actually uses the official custom font',
    );
  return { faces, logo, heading };
}

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.MIZAN_CHROMIUM,
  });
  report.browser = browser.version();
  for (const width of [1440, 320])
    for (const language of ['ar', 'en']) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (
          (url.origin === base || ['blob:', 'data:'].includes(url.protocol)) &&
          !/qwen|onnx|gguf|traineddata|tokenizer/i.test(url.pathname)
        )
          return route.continue();
        report.blocked.push(url.href);
        return route.abort();
      });
      let page = await context.newPage();
      activePage = page;
      page.on('pageerror', (error) => report.errors.push(error.message));
      page.on('response', (response) => {
        const font = fonts.find(
          (candidate) => new URL(response.url()).pathname === candidate.path,
        );
        if (font) {
          const check = (async () => {
            assert.equal(
              response.status(),
              200,
              `${font.path}: served successfully`,
            );
            const bytes = await response.body();
            const actual = sha(bytes);
            assert.equal(
              actual,
              font.sha256,
              `${font.path}: browser received the approved font bytes`,
            );
            report.fontResponses.push({
              width,
              language,
              path: font.path,
              bytes: bytes.length,
              sha256: actual,
            });
          })();
          // Attach a handler immediately; the assertion is rethrown by Promise.all.
          check.catch(() => {});
          responseChecks.push(check);
        }
      });
      await page.goto(base);
      if (
        (await page.evaluate(() => document.documentElement.lang)) !== language
      )
        await page
          .locator(`.language-switch button[lang="${language}"]:visible`)
          .first()
          .click();
      await page.locator(selector).waitFor();
      await page.waitForFunction(
        (cssSelector) =>
          !document.querySelector(cssSelector.replace(':visible', ''))
            ?.disabled,
        selector,
      );
      const result = { width, language, domains: [], mainLandmarks: [] };
      report.cases.push(result);
      const sharedSections = await page.evaluateHandle(() =>
        [
          '.landing-intro',
          '.document-scene',
          '.tarasuf-benefits-wrap',
          '#how-it-works',
          '#privacy',
          '#privacy-details',
          '.site-footer',
        ].map((selector) => document.querySelector(selector)),
      );
      const type = page.locator(selector);
      assert.equal(
        await type.count(),
        1,
        'one compact type selector is visible',
      );
      assert.equal(
        await type.evaluate((element) => element.tagName),
        'SELECT',
        'all workflows are keyboard-selectable through a native control',
      );
      assert.equal(
        await type.evaluate(
          (element) => !element.multiple && element.size <= 1,
        ),
        true,
        'the selector occupies one compact row',
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.dir),
        language === 'ar' ? 'rtl' : 'ltr',
        'the active language determines reading direction',
      );
      assert.deepEqual(
        await type
          .locator('option')
          .evaluateAll((options) =>
            options
              .map((option) => option.value)
              .sort((a, b) => a.localeCompare(b)),
          ),
        [...domains].sort((a, b) => a.localeCompare(b)),
      );
      assert.equal(
        await type
          .locator('option')
          .evaluateAll((options) =>
            options.every(
              (option) => option.textContent.trim() && !option.disabled,
            ),
          ),
        true,
      );
      assert.ok(
        (await type.getAttribute('aria-label')) ||
          (await type.evaluate((element) => element.labels.length > 0)),
        'the type selector has an accessible name',
      );
      assert.equal(
        await page.locator('.source-card:visible').count(),
        2,
        'supplier entry keeps exactly two upload cards',
      );
      await assertMainLandmark(page, 'supplier', result.mainLandmarks);
      result.sharedPage = await sharedPageSnapshot(
        page,
        sharedSections,
        'supplier',
      );
      const sharedIllustration = await illustrationGeometry(
        page.locator('.source-card:visible .source-card__drawing').first(),
      );
      assert.equal(sharedIllustration.localPaints, true);
      assert.equal(sharedIllustration.viewBox, '0 0 180 126');
      result.initialBounds = await bounds(page, 'supplier source entry');
      result.fonts = await fontProof(page, language);
      await capture(page, `${language}-${width}-supplier-entry.png`);

      for (const domain of domains.slice(1)) {
        await selectType(page, domain);
        await assertMainLandmark(page, domain, result.mainLandmarks);
        const panel = page.locator(`[data-domain-panel="${domain}"]:visible`);
        assert.equal(
          await page.locator('[data-domain-panel]:visible').count(),
          1,
          'only the selected specialist panel is visible',
        );
        assert.equal(
          await panel.locator('.workspace-intro:visible').count(),
          1,
          `${domain}: shared workflow intro`,
        );
        const workspace = panel.locator('.reconciliation-workspace').first();
        if (domain === 'bank') {
          const minimums = await panel.evaluate((element) => ({
            main: getComputedStyle(element.querySelector('main.bank-workspace'))
              .minHeight,
            continuation: getComputedStyle(
              element.querySelector('.workspace-bank-continuation'),
            ).minHeight,
          }));
          assert.deepEqual(
            minimums,
            { main: '0px', continuation: '0px' },
            'embedded bank sections do not each impose a full viewport of height',
          );
        }
        const cards = workspace.locator('.workspace-source');
        assert.equal(
          await cards.count(),
          sourceCounts[domain],
          `${domain}: every original source role remains mounted`,
        );
        assert.equal(
          await workspace.locator('.workspace-source:visible').count(),
          Math.min(2, sourceCounts[domain]),
          `${domain}: the primary pair is immediately visible`,
        );
        const supporting = workspace.locator(
          '[data-workspace-required-sources]',
        );
        const advanced = workspace.locator('[data-workspace-advanced]');
        assert.equal(
          await advanced.evaluateAll((details) =>
            details.every((detail) => !detail.open),
          ),
          true,
          `${domain}: advanced details start collapsed`,
        );
        if (sourceCounts[domain] > 2) {
          assert.equal(
            await supporting.count(),
            1,
            `${domain}: supporting evidence is grouped in one disclosure`,
          );
          assert.equal(
            await supporting.getAttribute('open'),
            null,
            `${domain}: supporting evidence starts collapsed`,
          );
          assert.equal(
            (
              await supporting.locator('.workspace-required-label').innerText()
            ).trim(),
            language === 'ar' ? 'مطلوبة' : 'Required',
            `${domain}: supporting documents are explicitly required`,
          );
        }
        for (const card of await cards.all()) {
          assert.equal(
            await card.locator('.workspace-source-heading').count(),
            1,
            `${domain}: source role uses shared heading`,
          );
          assert.equal(
            await card
              .locator('.workspace-file-input input[type="file"]')
              .count(),
            1,
            `${domain}: shared file-entry control`,
          );
          assert.ok(
            (
              await card.locator('.workspace-source-heading').textContent()
            ).trim(),
            `${domain}: source role has visible text`,
          );
          const illustration = card.locator(
            '.workspace-file-input .source-card__drawing',
          );
          assert.equal(
            await illustration.count(),
            1,
            `${domain}: every source role uses the original interactive paper art`,
          );
          assert.deepEqual(
            await illustrationGeometry(illustration),
            sharedIllustration,
            `${domain}: the paper, table, base and local paints match the supplier artwork`,
          );
        }
        const evidence = {
          domain,
          heading: await panel.locator('.workspace-intro h1').innerText(),
          sourceCards: await cards.count(),
          primaryRoles: await workspace
            .locator('.workspace-source:visible input[type="file"]')
            .evaluateAll((inputs) =>
              inputs.map((input) => input.getAttribute('aria-label')),
            ),
          requiredRoles: await supporting
            .locator('input[type="file"]')
            .evaluateAll((inputs) =>
              inputs.map((input) => input.getAttribute('aria-label')),
            ),
          bounds: await bounds(page, domain),
          sharedPage: await sharedPageSnapshot(page, sharedSections, domain),
        };
        evidence.uploadInteraction = await assertSharedUploadInteraction(
          workspace.locator('.workspace-file-input:visible').first(),
          domain,
        );
        result.domains.push(evidence);
        await capture(page, `${language}-${width}-${domain}-entry.png`);
        if (sourceCounts[domain] > 2) {
          await supporting.locator('summary').click();
          assert.equal(
            await workspace.locator('.workspace-source:visible').count(),
            sourceCounts[domain],
            `${domain}: required evidence roles remain reachable`,
          );
          evidence.requiredEvidenceBounds = await bounds(
            page,
            `${domain} required evidence`,
          );
          await supporting.locator('summary').click();
        }
        const primaryUploads = workspace.locator(
          '.workspace-source:visible .workspace-file-input input[type="file"]',
        );
        evidence.uploadedSources = [];
        for (const [side, fixture] of fixtures[domain].entries()) {
          const name = `ui-${domain}-primary-${side}.csv`;
          await primaryUploads.nth(side).setInputFiles({
            name,
            mimeType: 'text/csv',
            buffer: fixture.bytes,
          });
          await panel.getByText(name, { exact: true }).waitFor();
          await page.waitForFunction(
            () =>
              !document.querySelector('[data-reconciliation-type-select]')
                .disabled,
          );
          evidence.uploadedSources.push({
            name,
            path: fixture.path,
            sha256: sha(fixture.bytes),
          });
        }
        if (sourceCounts[domain] > 2)
          assert.equal(
            await supporting.getAttribute('open'),
            '',
            `${domain}: completing the primary pair reveals required evidence naturally`,
          );
        const draft = panel
          .locator(
            'input[type="text"]:visible:not([disabled]):not([readonly]), input:not([type]):visible:not([disabled]):not([readonly])',
          )
          .first();
        assert.equal(
          await draft.count(),
          1,
          `${domain}: uploaded primary sources reveal an editable scope`,
        );
        const typed = `retained-${domain}-${language}-${width}`;
        await draft.fill(typed);
        assert.equal(
          await draft.inputValue(),
          typed,
          `${domain}: the first edit must be stored before retention is assessed`,
        );
        const before = await snapshot(panel);
        evidence.scopeBounds = await bounds(
          page,
          `${domain} uploaded source and scope`,
        );
        assert.equal(
          await protectedUnload(page),
          true,
          `${domain}: uploaded source and edited scope keep the leave-page warning`,
        );
        await selectType(page, 'supplier');
        assert.equal(
          await protectedUnload(page),
          true,
          `${domain}: inactive work keeps the leave-page warning`,
        );
        await selectType(page, domain);
        assert.deepEqual(
          await snapshot(panel),
          before,
          `${domain}: returning keeps uploaded sources and edited scope inputs`,
        );
        evidence.draftRetained = true;
        await capture(page, `${language}-${width}-${domain}-retained.png`);
        evidence.retainedSharedPage = await sharedPageSnapshot(
          page,
          sharedSections,
          `${domain} after source and draft retention`,
        );
        await selectType(page, 'supplier');
      }
      await sharedSections.dispose();

      // Separate fresh pages prevent a previous scope draft from masking a
      // missing warning for the uploaded bank or supplier source itself.
      async function freshPage() {
        await page.close();
        page = await context.newPage();
        activePage = page;
        page.on('pageerror', (error) => report.errors.push(error.message));
        await page.goto(base);
        if (
          (await page.evaluate(() => document.documentElement.lang)) !==
          language
        )
          await page
            .locator(`.language-switch button[lang="${language}"]:visible`)
            .first()
            .click();
        await page.waitForFunction(
          () =>
            !document.querySelector('[data-reconciliation-type-select]')
              ?.disabled,
        );
        assert.equal(
          await protectedUnload(page),
          false,
          'a fresh page has no pending work warning',
        );
      }
      await freshPage();
      await selectType(page, 'bank');
      assert.equal(
        await protectedUnload(page),
        false,
        'changing only the native type does not create pending work',
      );
      await selectType(page, 'assets');
      assert.equal(
        await protectedUnload(page),
        false,
        'an untouched empty specialist has no leave-page warning',
      );
      const emptyAssets = page.locator('[data-domain-panel="assets"]:visible');
      const registerFamily = emptyAssets
        .locator('.workspace-source select:visible')
        .first();
      await registerFamily.selectOption('fixed-assets-long-components-gl-1');
      assert.equal(
        await registerFamily.inputValue(),
        'fixed-assets-long-components-gl-1',
        'the first register-family edit is stored',
      );
      const familySnapshot = await snapshot(emptyAssets);
      assert.equal(
        await protectedUnload(page),
        true,
        'a pre-upload register-family choice is pending work',
      );
      await selectType(page, 'supplier');
      assert.equal(
        await protectedUnload(page),
        true,
        'an inactive pre-upload register-family choice keeps its warning',
      );
      await selectType(page, 'assets');
      assert.equal(
        await registerFamily.inputValue(),
        'fixed-assets-long-components-gl-1',
      );
      assert.deepEqual(
        await snapshot(emptyAssets),
        familySnapshot,
        'type changes retain the pre-upload register-family selection',
      );
      result.preUploadChoiceRetained = true;
      await freshPage();
      const header = 'Date,Reference,Description,Amount\n';
      await selectType(page, 'bank');
      const bank = page.locator('[data-domain-panel="bank"]:visible');
      await page.evaluate(() => {
        const typeControl = document.querySelector(
          '[data-reconciliation-type-select]',
        );
        const proof = { states: [typeControl.disabled], observer: null };
        proof.observer = new MutationObserver(() =>
          proof.states.push(typeControl.disabled),
        );
        proof.observer.observe(typeControl, {
          attributes: true,
          attributeFilter: ['disabled'],
        });
        window.__mizanTypeDisabledProof = proof;
      });
      const specialistName = `retained-bank-${language}-${width}.csv`;
      await bank
        .getByTestId('bank-source-0')
        .locator('input[type="file"]')
        .setInputFiles({
          name: specialistName,
          mimeType: 'text/csv',
          buffer: fixtures.bank[0].bytes,
        });
      await bank
        .getByTestId('bank-source-0')
        .getByText(specialistName, { exact: true })
        .waitFor();
      await page.waitForFunction(
        () =>
          !document.querySelector('[data-reconciliation-type-select]').disabled,
      );
      result.busySelectorStates = await page.evaluate(() => {
        const proof = window.__mizanTypeDisabledProof;
        proof.observer.disconnect();
        delete window.__mizanTypeDisabledProof;
        return proof.states;
      });
      assert.ok(
        result.busySelectorStates.includes(true),
        'the active specialist disables type selection during actual source parsing',
      );
      assert.equal(
        result.busySelectorStates.at(-1),
        false,
        'type selection is restored after parsing',
      );
      const bankSnapshot = await snapshot(bank);
      assert.equal(
        await protectedUnload(page),
        true,
        'uploaded specialist work keeps the leave-page warning',
      );
      await selectType(page, 'supplier');
      assert.equal(
        await protectedUnload(page),
        true,
        'inactive specialist work keeps the leave-page warning',
      );
      await selectType(page, 'bank');
      assert.deepEqual(
        await snapshot(bank),
        bankSnapshot,
        'specialist source and scope inputs survive changing types',
      );
      await capture(page, `${language}-${width}-bank-file-retained.png`);
      await freshPage();
      const supplier = page
        .locator('.app-shell:visible')
        .filter({ has: page.locator('.source-card') })
        .first();
      for (const side of [0, 1]) {
        const name = `retained-${side}-${language}-${width}.csv`;
        await supplier
          .locator('.source-card input[type="file"]')
          .nth(side)
          .setInputFiles({
            name,
            mimeType: 'text/csv',
            buffer: Buffer.from(
              header + '2026-09-01,INV-100,Synthetic source,100.00\n',
            ),
          });
        await supplier
          .locator('.source-card__description')
          .getByText(name, { exact: true })
          .waitFor();
        await page.waitForFunction(
          () => !document.querySelector('.notice.loading'),
        );
      }
      const before = await snapshot(supplier);
      await selectType(page, 'supplier');
      assert.deepEqual(
        await snapshot(supplier),
        before,
        'choosing the current type keeps both supplier files and inputs',
      );
      await selectType(page, 'bank');
      assert.equal(
        await protectedUnload(page),
        true,
        'hidden supplier sources keep the leave-page warning',
      );
      await selectType(page, 'supplier');
      assert.deepEqual(
        await snapshot(supplier),
        before,
        'type-selection round trip retains supplier sources and inputs',
      );
      result.retainedSupplierSources = before.sources;
      result.retainedBounds = await bounds(
        page,
        'retained supplier source entry',
      );
      assert.equal(
        await protectedUnload(page),
        true,
        'uploaded supplier work keeps its leave-page guard',
      );
      await capture(page, `${language}-${width}-supplier-retained.png`);
      result.status = 'PASS';
      await Promise.all(responseChecks);
      await context.close();
      activePage = null;
    }
  await Promise.all(responseChecks);
  for (const result of report.cases)
    for (const font of fonts)
      assert.ok(
        report.fontResponses.some(
          (response) =>
            response.width === result.width &&
            response.language === result.language &&
            response.path === font.path,
        ),
        `${result.language}/${result.width}: the local ${font.family} was requested`,
      );
  assert.deepEqual(
    report.blocked,
    [],
    'all execution stays local and excludes OCR/models',
  );
  assert.deepEqual(report.errors, [], 'no browser page errors');
  report.status = 'PASS';
} catch (error) {
  failure = error;
  report.status = 'FAIL';
  report.failure = { message: error.message, stack: error.stack };
  await activePage
    ?.screenshot({ path: path.join(out, 'failure.png'), fullPage: true })
    .catch(() => {});
} finally {
  await Promise.allSettled(responseChecks);
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(
    path.join(out, 'REPORT.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(
  JSON.stringify({
    out,
    status: report.status,
    cases: report.cases.map(({ width, language, status }) => ({
      width,
      language,
      status,
    })),
  }),
);
if (failure) throw failure;
