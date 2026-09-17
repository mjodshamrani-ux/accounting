import assert from 'node:assert/strict';

const workflowHeadings = {
  confirm: 'راجع الملخص، ثم قارن.',
  review: 'الفروق أمامك. القرار لك.',
  export: 'ورقة عمل تحكي التفاصيل.',
};

async function decodeHeading(page, id) {
  const image = page.locator(`.display-heading img[src$="/type/${id}.svg"]`);
  assert.equal(await image.count(), 1, `${id}: one lettering image`);
  assert.equal(await image.getAttribute('alt'), '');
  assert.equal(await image.getAttribute('aria-hidden'), 'true');
  assert.equal(
    await image.evaluate(async (element) => {
      await element.decode();
      return element.complete && element.naturalWidth > 0;
    }),
    true,
    `${id}: lettering must decode, including during the offline workflow`,
  );
}

export async function verifyNarrowLayouts(page, stage) {
  const originalViewport = page.viewportSize();
  try {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.evaluate(async () => {
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return {
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
        };
      });
      assert.equal(layout.viewport, width);
      assert.ok(
        layout.document <= width + 2 && layout.body <= width + 2,
        `${stage}: ${width}px page must not overflow horizontally (${JSON.stringify(layout)})`,
      );
    }
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}

export async function verifyBrandLanding(page) {
  const plainTitle = (await page.title()).replace(
    /[\u0640\u064b-\u065f\u0670]/g,
    '',
  );
  assert.match(plainTitle, /^تراصف — بين السجلات نجد الوضوح$/);
  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(await page.locator('.dropzone').count(), 2);
  for (const label of ['كشف المورد', 'تقرير الحسابات الدائنة']) {
    const input = page.getByLabel(label, { exact: true });
    assert.equal(await input.getAttribute('type'), 'file');
    assert.equal(
      await input.isEnabled(),
      true,
      'native upload has no account gate',
    );
    assert.equal(await input.locator('..').isVisible(), true);
  }
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => ({
    bodyFamily: getComputedStyle(document.body).fontFamily,
    loaded: [...document.fonts].some(
      (font) =>
        font.family.replace(/["']/g, '') === 'Noto Sans Arabic' &&
        font.status === 'loaded',
    ),
    requests: performance
      .getEntriesByType('resource')
      .filter((entry) =>
        new URL(entry.name).pathname.endsWith(
          '/fonts/noto-sans-arabic-variable.woff2',
        ),
      )
      .map((entry) => new URL(entry.name).origin),
    origin: location.origin,
  }));
  assert.match(fonts.bodyFamily, /Noto Sans Arabic/);
  assert.equal(
    fonts.loaded,
    true,
    'the actual local font face must finish loading; a fallback is insufficient',
  );
  assert.ok(fonts.requests.length > 0, 'the local font file must be requested');
  assert.ok(fonts.requests.every((origin) => origin === fonts.origin));
  await decodeHeading(page, 'upload');

  // Only the production preloads warm these future headings. Do not create
  // images or fetch them in the test: decoding is asserted after going offline.
  await page.waitForFunction(() =>
    ['upload', 'confirm', 'review', 'export'].every((id) => {
      const preload = document.querySelector(
        `link[rel="preload"][as="image"][href$="/type/${id}.svg"]`,
      );
      return (
        preload &&
        performance
          .getEntriesByName(preload.href)
          .some((entry) => entry.responseEnd > 0)
      );
    }),
  );

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const scene = page.locator('.document-scene');
  await scene.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => document.querySelector('.document-scene')?.dataset.running === 'true',
  );
  const pause = scene.getByRole('button', {
    name: 'إيقاف حركة المشهد التوضيحي',
    exact: true,
  });
  assert.equal(await pause.getAttribute('aria-pressed'), 'false');
  await pause.click();
  await page.waitForFunction(
    () =>
      document.querySelector('.document-scene')?.dataset.running === 'false',
  );
  assert.equal(
    await scene.getByRole('button').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await scene
      .locator('.document-scene__float')
      .first()
      .evaluate((element) => getComputedStyle(element).animationPlayState),
    'paused',
  );
  await scene
    .getByRole('button', { name: 'تشغيل حركة المشهد التوضيحي', exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector('.document-scene')?.dataset.running === 'true',
  );

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => {
    const scene = document.querySelector('.document-scene');
    return (
      scene?.dataset.running === 'false' &&
      [
        ...scene.querySelectorAll(
          '.document-scene__float, .document-scene__scan',
        ),
      ].every((element) => getComputedStyle(element).animationName === 'none')
    );
  });
  assert.equal(await scene.getByRole('button').isDisabled(), true);
  assert.equal(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((animation) => animation.playState === 'running').length,
    ),
    0,
    'reduced motion must remove animations and reveal transitions',
  );
  await verifyNarrowLayouts(page, 'landing');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}

export async function verifyWorkflowBrand(page, step) {
  const name = workflowHeadings[step];
  assert.ok(name, 'known workflow step');
  await page.getByRole('heading', { level: 1, name, exact: true }).waitFor();
  assert.equal(
    await page.locator('h1').count(),
    1,
    `${step}: one semantic page title`,
  );
  assert.equal(
    await page.locator('.landing-intro').count(),
    0,
    'the hero leaves the active accounting workflow',
  );
  await page.waitForFunction(
    () =>
      document.activeElement === document.querySelector('h1.workflow-title'),
  );
  await decodeHeading(page, step);
}
