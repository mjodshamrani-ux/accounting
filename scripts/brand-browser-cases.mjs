import assert from 'node:assert/strict';

const workflowHeadings = {
  confirm: 'راجع الملخص، ثم قارن.',
  review: 'الفروق أمامك. القرار لك.',
  export: 'ورقة عمل تحكي التفاصيل.',
};

const displayFont = 'Thmanyah Serif Display';
const displayFontPath = '/fonts/thmanyah-serif-display-bold.woff2';
const narrowWorkflowType = new WeakMap();
const layoutWidths = [320, 390, 768, 820, 1024, 1280];

async function verifyPrivacyNavigation(page) {
  assert.equal(await page.locator('.tarasuf-benefit').count(), 3);
  assert.equal(await page.locator('.tarasuf-process-track > li').count(), 3);
  const marketingLabels = await page
    .locator('.hero-bottomline, .tarasuf-section-kicker')
    .allTextContents();
  assert.ok(
    marketingLabels.every((text) => !/[A-Za-z]/.test(text)),
    'Arabic marketing labels do not mix in English slogans',
  );
  await page
    .getByRole('link', { name: 'تعرّف على حدود الخصوصية', exact: true })
    .click();
  assert.equal(new URL(page.url()).hash, '#privacy');
  await page
    .getByRole('link', { name: 'اقرأ حدود الخصوصية بالتفصيل', exact: true })
    .click();
  assert.equal(new URL(page.url()).hash, '#privacy-details');
  const policy = page.locator('#privacy-details');
  await page.waitForFunction(() => {
    const title = document.getElementById('privacy-formal-title');
    if (!title) return false;
    const bounds = title.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
  });
  const disclosures = policy.locator('details');
  assert.equal(
    await disclosures.count(),
    4,
    'formal privacy includes processing, storage, connection and device limits',
  );
  const firstSummary = disclosures.first().locator('summary');
  await firstSummary.focus();
  await page.keyboard.press('Enter');
  assert.equal(
    await disclosures.first().evaluate((element) => element.open),
    true,
    'privacy details open with the keyboard',
  );
  assert.equal(await disclosures.first().locator('p').isVisible(), true);
  await page.keyboard.press('Space');
  assert.equal(
    await disclosures.first().evaluate((element) => element.open),
    false,
  );
  for (const disclosure of await disclosures.all()) {
    await disclosure.locator('summary').click();
    assert.equal(await disclosure.locator('p').isVisible(), true);
    assert.ok(
      (await disclosure.locator('p').innerText()).trim().length > 30,
      'the detail has substantive text',
    );
    await disclosure.locator('summary').click();
  }
  const footerLink = page
    .locator('.site-footer')
    .getByRole('link', { name: 'حدود الخصوصية', exact: true });
  assert.equal(await footerLink.getAttribute('href'), '#privacy-details');
  await footerLink.click();
  assert.equal(new URL(page.url()).hash, '#privacy-details');

  // The existing compact panel remains available during an active session.
  const opener = page
    .locator('.topbar')
    .getByRole('button', { name: 'المعالجة على جهازك', exact: true });
  await opener.click();
  await page.waitForFunction(
    () =>
      document.activeElement ===
      document.getElementById('privacy-detail-title'),
  );
  await page
    .getByRole('button', { name: 'إغلاق الخصوصية', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.activeElement === document.querySelector('.topbar .local-pill'),
  );
  assert.equal(
    await opener.getAttribute('aria-expanded'),
    'false',
    'closing the privacy panel restores focus to its opener',
  );
}

async function verifySceneGeometry(page) {
  const viewport = page.viewportSize();
  try {
    for (const width of layoutWidths) {
      await page.setViewportSize({ width, height: 844 });
      await page.locator('.document-scene').scrollIntoViewIfNeeded();
      const geometry = await page
        .locator('.document-scene__art')
        .evaluate(async (art) => {
          await document.fonts.ready;
          const view = art.viewBox.baseVal;
          const rect = art.getBoundingClientRect();
          const papers = [...art.querySelectorAll('.document-scene__sheet')];
          const bounds = (box) => ({
            left: box.x,
            top: box.y,
            right: box.x + box.width,
            bottom: box.y + box.height,
          });
          const contained = (inner, outer, allowance = 0.1) =>
            inner.left >= outer.left - allowance &&
            inner.top >= outer.top - allowance &&
            inner.right <= outer.right + allowance &&
            inner.bottom <= outer.bottom + allowance;
          const content = papers.map((paper) => {
            const body = paper.querySelector('.document-scene__paper');
            const inner = paper.querySelector('.document-scene__paper-content');
            const match = inner
              ?.getAttribute('clip-path')
              ?.match(/^url\(["']?#([^"')]+)["']?\)$/);
            const clip = match && document.getElementById(match[1]);
            const clipRect = clip?.querySelector('rect');
            return {
              kind: paper.dataset.paperKind,
              clipLocal:
                !!clip &&
                art.contains(clip) &&
                clip.getAttribute('clipPathUnits') !== 'objectBoundingBox',
              clipInsidePaper:
                !!body &&
                !!clipRect &&
                contained(bounds(clipRect.getBBox()), bounds(body.getBBox())),
              contentInsideClip:
                !!inner &&
                !!clipRect &&
                contained(bounds(inner.getBBox()), bounds(clipRect.getBBox())),
            };
          });
          const animations = art.getAnimations({ subtree: true });
          const times = animations.map((animation) => animation.currentTime);
          const samples = [];
          try {
            // Seek the real animation, including its negative phase delays, across
            // a complete cycle without replacing CSS keyframes or play state.
            for (let sample = 0; sample <= 16; sample += 1) {
              animations.forEach((animation) => {
                const duration = Number(
                  animation.effect.getComputedTiming().duration,
                );
                animation.currentTime = (duration * sample) / 16;
              });
              await new Promise((resolve) => requestAnimationFrame(resolve));
              const rootInverse = art.getScreenCTM().inverse();
              for (const paper of papers) {
                const body = paper.querySelector('.document-scene__paper');
                const box = body.getBBox();
                const transform = rootInverse.multiply(body.getScreenCTM());
                const points = [
                  [box.x, box.y],
                  [box.x + box.width, box.y],
                  [box.x, box.y + box.height],
                  [box.x + box.width, box.y + box.height],
                ].map(([x, y]) =>
                  new DOMPoint(x, y).matrixTransform(transform),
                );
                samples.push({
                  kind: paper.dataset.paperKind,
                  sample,
                  contained: contained(
                    {
                      left: Math.min(...points.map((point) => point.x)),
                      right: Math.max(...points.map((point) => point.x)),
                      top: Math.min(...points.map((point) => point.y)),
                      bottom: Math.max(...points.map((point) => point.y)),
                    },
                    bounds(view),
                  ),
                  undistorted:
                    Math.abs(
                      Math.hypot(transform.a, transform.b) -
                        Math.hypot(transform.c, transform.d),
                    ) < 0.001 &&
                    Math.abs(
                      transform.a * transform.c + transform.b * transform.d,
                    ) < 0.001,
                });
              }
            }
          } finally {
            animations.forEach((animation, index) => {
              animation.currentTime = times[index];
            });
          }
          return {
            proportionate:
              Math.abs(rect.width / rect.height - view.width / view.height) <
              0.01,
            content,
            samples,
            animations: animations.length,
          };
        });
      assert.equal(
        geometry.proportionate,
        true,
        `${width}px: the whole illustration scales proportionally`,
      );
      assert.deepEqual(geometry.content.map((paper) => paper.kind).sort(), [
        'ledger',
        'supplier',
      ]);
      assert.equal(geometry.animations, 2, 'each paper has its own animation');
      for (const paper of geometry.content) {
        assert.equal(
          paper.clipLocal && paper.clipInsidePaper && paper.contentInsideClip,
          true,
          `${width}px ${paper.kind}: text and table must fit inside the paper, with a valid local content clip (${JSON.stringify(paper)})`,
        );
      }
      for (const sample of geometry.samples) {
        assert.equal(
          sample.contained && sample.undistorted,
          true,
          `${width}px ${sample.kind}, animation sample ${sample.sample}: paper cannot escape the scene or stretch`,
        );
      }
    }
  } finally {
    if (viewport) await page.setViewportSize(viewport);
  }
}

async function verifyUploadInteractions(page) {
  // Keep real import state isolated from the subsequent accounting assertions.
  const uploadPage = await page.context().newPage();
  let transfer;
  try {
    await uploadPage.goto(page.url());
    const input = uploadPage.getByLabel('كشف المورد', { exact: true });
    await uploadPage.waitForFunction(() => {
      const element = document.querySelector('input[aria-label="كشف المورد"]');
      return element && !element.disabled;
    });
    await input.focus();
    await uploadPage.keyboard.press('Shift+Tab');
    await uploadPage.keyboard.press('Tab');
    assert.equal(
      await input.evaluate(
        (element) =>
          document.activeElement === element &&
          element.matches(':focus-visible'),
      ),
      true,
      'the native file input is reachable through the keyboard tab order',
    );
    const help = await input.evaluate((element) =>
      (element.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim()),
    );
    assert.ok(
      help.length >= 2 && help.every(Boolean),
      'upload limits and current state are accessible descriptions',
    );

    const csv = 'date,reference,amount\n2026-08-01,INV-0001,100.00';
    await input.setInputFiles({
      name: 'kept-supplier.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    const card = uploadPage.locator('.source-card[data-side="0"]');
    await card.locator('.source-card__description bdi').waitFor();
    assert.equal(
      await card.locator('.source-card__description bdi').innerText(),
      'kept-supplier.csv',
    );
    await uploadPage.waitForFunction(
      () =>
        document
          .querySelector('.source-card[data-side="0"]')
          ?.getAttribute('aria-disabled') === 'false',
    );
    transfer = await uploadPage.evaluateHandle((contents) => {
      const data = new DataTransfer();
      for (const name of ['unexpected-first.csv', 'unexpected-second.csv']) {
        data.items.add(new File([contents], name, { type: 'text/csv' }));
      }
      return data;
    }, csv);
    await card.dispatchEvent('dragenter', { dataTransfer: transfer });
    assert.equal(await card.getAttribute('data-drag-active'), 'true');
    // Moving over a child must not flicker the whole drop target off.
    await card
      .locator('h3')
      .dispatchEvent('dragenter', { dataTransfer: transfer });
    await card
      .locator('h3')
      .dispatchEvent('dragleave', { dataTransfer: transfer });
    assert.equal(await card.getAttribute('data-drag-active'), 'true');
    await card.dispatchEvent('dragleave', { dataTransfer: transfer });
    assert.equal(await card.getAttribute('data-drag-active'), 'false');
    await card.dispatchEvent('dragenter', { dataTransfer: transfer });
    await card.dispatchEvent('drop', { dataTransfer: transfer });
    await uploadPage
      .getByRole('alert')
      .filter({ hasText: 'أضف ملفًا واحدًا لكل جهة. لم تُستبدل الملفات الحالية.' })
      .waitFor();
    assert.equal(await card.getAttribute('data-drag-active'), 'false');
    assert.equal(
      await card.locator('.source-card__description bdi').innerText(),
      'kept-supplier.csv',
    );
    assert.equal(
      await uploadPage.locator('.source-card.has-file').count(),
      1,
      'a multi-file drop never silently replaces or distributes files',
    );
    assert.equal(
      await uploadPage
        .getByRole('button', { name: 'تأكيد البيانات', exact: true })
        .isDisabled(),
      true,
    );
  } finally {
    await transfer?.dispose();
    await uploadPage.close();
    await page.bringToFront();
  }
}

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
    for (const width of layoutWidths) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.evaluate(async () => {
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return {
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          stepLabelsFit: [
            ...document.querySelectorAll('.steps .step-label'),
          ].every((label) => {
            const text = label.firstChild;
            if (
              !text ||
              text.nodeType !== Node.TEXT_NODE ||
              !text.textContent.trim()
            )
              return false;
            const range = document.createRange();
            range.selectNode(text);
            const item = label.closest('li').getBoundingClientRect();
            return [...range.getClientRects()].every(
              (rect) =>
                rect.left >= item.left - 1 && rect.right <= item.right + 1,
            );
          }),
        };
      });
      assert.equal(layout.viewport, width);
      assert.ok(
        layout.document <= width + 2 && layout.body <= width + 2,
        `${stage}: ${width}px page must not overflow horizontally (${JSON.stringify(layout)})`,
      );
      assert.equal(
        layout.stepLabelsFit,
        true,
        `${stage}: all workflow labels remain readable inside their steps at ${width}px`,
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
  assert.equal(
    await page.locator('.brand-wordmark-latin').count(),
    0,
    'the Arabic identity has no duplicate Latin wordmark',
  );
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
  await verifyUploadInteractions(page);
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

  await verifyPrivacyNavigation(page);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await verifySceneGeometry(page);
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
  await page.locator('.site-footer').scrollIntoViewIfNeeded();
  await scene.scrollIntoViewIfNeeded();
  assert.equal(
    await scene.getAttribute('data-running'),
    'false',
    'scrolling back never overrides the user pause',
  );
  await scene
    .getByRole('button', { name: 'تشغيل حركة المشهد التوضيحي', exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector('.document-scene')?.dataset.running === 'true',
  );

  await page.locator('.site-footer').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const scene = document.querySelector('.document-scene');
    const animations = scene?.getAnimations({ subtree: true }) || [];
    return (
      scene?.dataset.running === 'false' &&
      animations.length === 2 &&
      animations.every((animation) => animation.playState === 'paused')
    );
  });
  await scene.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => document.querySelector('.document-scene')?.dataset.running === 'true',
  );

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => {
    const scene = document.querySelector('.document-scene');
    return (
      scene?.dataset.running === 'false' &&
      [...scene.querySelectorAll('.document-scene__float')].every(
        (element) => getComputedStyle(element).animationName === 'none',
      )
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
  const revealed = await page
    .locator('[data-reveal]')
    .evaluateAll((elements) =>
      elements.every(
        (element) =>
          getComputedStyle(element).opacity === '1' &&
          getComputedStyle(element).transform === 'none',
      ),
    );
  assert.equal(
    revealed,
    true,
    'all sections remain readable when motion preference changes at runtime',
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
  const steps = page.getByRole('navigation', {
    name: 'خطوات التسوية',
    exact: true,
  });
  assert.equal(await steps.locator('ol > li').count(), 4);
  assert.equal(await steps.locator('[aria-current="step"]').count(), 1);
  assert.equal(
    await steps
      .locator('[aria-current="step"]')
      .evaluate((element) =>
        [...element.parentElement.children].indexOf(element),
      ),
    { confirm: 1, review: 2, export: 3 }[step],
    'the ordered workflow announces the actual current stage',
  );
  await page.waitForFunction(
    () =>
      document.activeElement === document.querySelector('h1.workflow-title'),
  );
  await verifyNativeHeading(page, step);
  await verifyNarrowWorkflowTypography(page, step);
}
