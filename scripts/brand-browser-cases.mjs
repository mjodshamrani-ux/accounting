import assert from 'node:assert/strict';

const workflowHeadings = {
  confirm: 'راجع الملخص، ثم قارن.',
  review: 'الفروق أمامك. القرار لك.',
  export: 'ورقة عمل تحكي التفاصيل.',
};

const displayFont = 'Thmanyah Serif Display';
const displayFontPath = '/fonts/thmanyah-serif-display-bold.woff2';
const narrowWorkflowType = new WeakMap();

async function verifyNativeHeading(page, id) {
  const heading = page.locator(`[data-display-heading="${id}"]`);
  assert.equal(await heading.count(), 1, `${id}: one native text heading`);
  assert.equal(await heading.locator('img, svg, canvas').count(), 0);
  assert.equal(await heading.getAttribute('dir'), 'rtl');
  assert.equal(await heading.getAttribute('lang'), 'ar');
  const rendered = await heading.evaluate(async (element, family) => {
    await document.fonts.ready;
    const style = getComputedStyle(element);
    return {
      text: element.textContent,
      family: style.fontFamily,
      weight: style.fontWeight,
      letterSpacing: style.letterSpacing,
      transform: style.transform,
      synthesis: style.fontSynthesis,
      loaded: [...document.fonts].some(
        (font) =>
          font.family.replace(/["']/g, '') === family &&
          font.status === 'loaded',
      ),
      available: document.fonts.check(
        `700 32px "${family}"`,
        element.textContent,
      ),
    };
  }, displayFont);
  assert.ok(
    rendered.text.trim(),
    `${id}: real text remains readable and selectable`,
  );
  assert.ok(
    !rendered.text.includes('ـ'),
    `${id}: headings use natural Arabic shaping`,
  );
  assert.match(rendered.family, /Thmanyah Serif Display/);
  assert.equal(rendered.weight, '700');
  assert.equal(
    rendered.loaded,
    true,
    `${id}: original font loaded even offline`,
  );
  assert.equal(
    rendered.available,
    true,
    `${id}: native font is available for the text`,
  );
  assert.ok(
    ['normal', '0px'].includes(rendered.letterSpacing),
    `${id}: do not distort Arabic joins with letter spacing`,
  );
  assert.equal(
    rendered.transform,
    'none',
    `${id}: do not reshape lettering with CSS transforms`,
  );
  assert.equal(
    rendered.synthesis,
    'none',
    `${id}: no browser-generated bold or italic`,
  );
}

async function verifyNarrowWorkflowTypography(page, step) {
  const viewport = page.viewportSize();
  try {
    await page.setViewportSize({ width: 320, height: 844 });
    const typography = await page
      .locator(`[data-display-heading="${step}"]`)
      .evaluate(async (element) => {
        await document.fonts.ready;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        const style = getComputedStyle(element);
        const range = document.createRange();
        range.selectNodeContents(element);
        const fragments = [...range.getClientRects()].filter(
          (rect) => rect.width > 0,
        );
        const bounds = element.getBoundingClientRect();
        return {
          size: parseFloat(style.fontSize),
          lineHeight: parseFloat(style.lineHeight),
          lines: new Set(fragments.map((rect) => Math.round(rect.top))).size,
          staysWithinHeading: fragments.every(
            (rect) =>
              rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1,
          ),
          pageWidth: document.documentElement.scrollWidth,
        };
      });
    assert.ok(typography.size >= 30, `${step}: mobile heading stays legible`);
    assert.ok(
      typography.lineHeight >= typography.size * 1.3,
      `${step}: line spacing accommodates Arabic marks`,
    );
    assert.equal(
      typography.staysWithinHeading,
      true,
      `${step}: text must wrap inside its container`,
    );
    assert.ok(
      typography.pageWidth <= 322,
      `${step}: no horizontal overflow at 320px`,
    );
    if (step === 'confirm') narrowWorkflowType.set(page, typography);
    if (step === 'export') {
      const confirmation = narrowWorkflowType.get(page);
      assert.ok(
        confirmation,
        'the confirmation heading establishes the same-role type scale',
      );
      assert.equal(
        typography.size,
        confirmation.size,
        'long export heading must not shrink to fit a fixed image width',
      );
      assert.ok(
        typography.lines >= 2,
        'the longest workflow heading wraps naturally at 320px',
      );
    }
  } finally {
    if (viewport) await page.setViewportSize(viewport);
  }
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
  assert.equal(
    await page.locator('.display-heading img, .brand-wordmark img').count(),
    0,
    'headings and the wordmark use original-font text, not outlined images',
  );
  for (const id of ['heroLine1', 'heroLine2', 'upload', 'process', 'privacy']) {
    await verifyNativeHeading(page, id);
  }
  const wordmarks = page.locator('.brand-wordmark-arabic');
  assert.ok(await wordmarks.count(), 'the native Arabic wordmark is present');
  for (const wordmark of await wordmarks.all()) {
    const lettering = await wordmark.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        text: element.textContent,
        family: style.fontFamily,
        weight: style.fontWeight,
        letterSpacing: style.letterSpacing,
        transform: style.transform,
        synthesis: style.fontSynthesis,
      };
    });
    assert.equal(
      lettering.text,
      'تَـراصُـف',
      'preserve the exact original brand diacritics and two kashidas',
    );
    assert.match(lettering.family, /Thmanyah Serif Display/);
    assert.equal(lettering.weight, '700');
    assert.ok(['normal', '0px'].includes(lettering.letterSpacing));
    assert.equal(lettering.transform, 'none');
    assert.equal(lettering.synthesis, 'none');
  }

  // The production preload and first native headings load the one authentic
  // face. Future workflow steps must render with that face while offline.
  const displayAssets = await page.evaluate((fontPath) => {
    const preload = document.querySelector(
      `link[rel="preload"][as="font"][href$="${fontPath}"]`,
    );
    return {
      origin: location.origin,
      preloadOrigin: preload ? new URL(preload.href).origin : null,
      preloadType: preload?.type,
      preloadCrossOrigin: preload?.crossOrigin,
      requests: performance
        .getEntriesByType('resource')
        .filter((entry) => new URL(entry.name).pathname.endsWith(fontPath))
        .map((entry) => ({
          origin: new URL(entry.name).origin,
          completed: entry.responseEnd > 0,
        })),
      outlinedPreloads: document.querySelectorAll(
        'link[rel="preload"][as="image"][href*="/brand/type/"]',
      ).length,
    };
  }, displayFontPath);
  assert.equal(
    displayAssets.preloadOrigin,
    displayAssets.origin,
    'preload font from this site only',
  );
  assert.equal(displayAssets.preloadType, 'font/woff2');
  assert.equal(displayAssets.preloadCrossOrigin, 'anonymous');
  assert.ok(
    displayAssets.requests.length > 0,
    'the original local display font is requested',
  );
  assert.ok(
    displayAssets.requests.every(
      (request) => request.origin === displayAssets.origin && request.completed,
    ),
  );
  assert.equal(
    displayAssets.outlinedPreloads,
    0,
    'obsolete outlined heading images are not preloaded',
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
  await verifyNativeHeading(page, step);
  await verifyNarrowWorkflowTypography(page, step);
}
