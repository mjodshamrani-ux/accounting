// The interface census: what is counted in a rendered workspace, how a fault
// of each class is planted for the self-test, and how a run is compared with
// the recorded baseline. The in-page functions run through page.evaluate, so
// each one stands alone and reads nothing from this module.
export const DOMAINS = [
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
// One state is a language at a width, after the workspace's synthetic
// example has run. The baseline sums every state of a domain.
export const STATES = [
  { language: 'ar', width: 390 },
  { language: 'ar', width: 1440 },
  { language: 'en', width: 390 },
  { language: 'en', width: 1440 },
];
export const METRICS = [
  'minorUnits',
  'minorUnitsInText',
  'minusAfterDigits',
  'unisolatedAmounts',
  'brokenInsideWord',
  'pageOverflow',
  'disabledUnexplained',
  'focusLost',
  'wideUnnamed',
  'focusAfterDecision',
  'clippedText',
  'jsonText',
  'emptyTable',
  'zeroCounter',
  'commandAsNoun',
  'longIntro',
  'lowContrast',
  'smallText',
];

// The decision each workspace offers after its example, by the names the
// reader sees (UX-3): the fields its decisions need, what the reader runs or
// selects first where the workspace asks for it, and the decision buttons
// tried in order, the first open one pressed. The census decides once per
// language, after the states are measured, and reads where the focus went.
// A workspace without an entry is not decided on.
export const DECISIONS = {
  'tb-financial': {
    fields: {
      ar: ['مرجع القرار', 'سبب القرار'],
      en: ['Decision reference', 'Decision reason'],
    },
    press: { ar: ['ارفض البند كاملًا'], en: ['Reject whole line'] },
  },
  intercompany: {
    fields: {
      ar: ['مرجع قرار معاملات المنشآت', 'تفسير قرار معاملات المنشآت'],
      en: [
        'Intercompany decision reference',
        'Intercompany decision explanation',
      ],
    },
    press: { ar: ['ارفض الزوج كاملًا'], en: ['Reject whole pair'] },
  },
  gateway: {
    fields: {
      ar: ['مرجع قرار بوابة الدفع', 'شرح قرار بوابة الدفع'],
      en: ['Gateway decision reference', 'Gateway decision explanation'],
    },
    press: { ar: ['ارفض الدفعة كاملة'], en: ['Reject whole batch'] },
  },
  stock: {
    fields: {
      ar: ['مرجع قرار المخزون', 'توضيح قرار المخزون'],
      en: ['Inventory decision reference', 'Inventory decision explanation'],
    },
    press: {
      ar: ['ارفض كامل نطاق المخزون'],
      en: ['Reject whole inventory scope'],
    },
  },
  assets: {
    fields: {
      ar: ['مرجع قرار الأصول', 'توضيح قرار الأصول'],
      en: ['Asset decision reference', 'Asset decision explanation'],
    },
    press: { ar: ['ارفض كامل نطاق الأصول'], en: ['Reject whole asset scope'] },
  },
  payroll: {
    fields: {
      ar: ['مرجع قرار الرواتب', 'توضيح قرار الرواتب'],
      en: ['Payroll decision reference', 'Payroll decision explanation'],
    },
    press: {
      ar: ['ارفض كامل نطاق الرواتب'],
      en: ['Reject whole payroll scope'],
    },
  },
  ar: {
    fields: { ar: ['سبب مراجعة المستند'], en: ['Document review reason'] },
    press: { ar: ['أعد فتح زوج المستندات'], en: ['Reopen document pair'] },
  },
  clearing: {
    run: { ar: 'افحص المقاصة', en: 'Check clearing' },
    fields: { ar: ['سبب قرار المراجعة'], en: ['Review decision reason'] },
    press: { ar: ['ألغ مقاصة المجموعة'], en: ['Reopen cleared group'] },
  },
  allocation: {
    fields: { ar: ['سبب القرار أو الإلغاء'], en: ['Decision or undo reason'] },
    select: '[data-testid="allocation-proof"] input:not(:disabled)',
    press: {
      ar: ['اعتمد الخطوط المحددة كاملة'],
      en: ['Approve selected advice atomically'],
    },
  },
  bank: {
    fields: {
      ar: ['مرجع الدليل', 'سبب القرار أو الإلغاء'],
      en: ['Evidence reference', 'Decision or undo reason'],
    },
    press: {
      ar: ['اعتمد الحالة المؤهلة كاملة', 'ألغ حالة الحركات كاملة'],
      en: ['Approve complete eligible case', 'Undo complete movement case'],
    },
  },
};

/** Counts the defect classes inside one domain panel, with samples. */
export function censusInPage(selector) {
  const root = document.querySelector(selector);
  if (!root) throw new Error(`no element for ${selector}`);
  const visible = (el) => {
    if (!el) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const skip = 'pre, code, input, textarea, option, script, style';
  const texts = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || el.closest(skip) || !visible(el) || !node.textContent.trim())
      continue;
    texts.push(node);
  }
  const rect = (node, at) => {
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + 1);
    return range.getClientRects()[0];
  };
  // A money amount shown as a bare integer of five digits or more: minor
  // units a formatter never saw. Counted per cell, by its column header.
  const minorUnitsByHeader = {};
  let minorUnits = 0;
  for (const cell of root.querySelectorAll('td')) {
    if (!visible(cell) || !/^-?\d{5,}$/u.test(cell.textContent.trim()))
      continue;
    minorUnits++;
    const header =
      cell
        .closest('table')
        ?.querySelectorAll('thead th')
        [cell.cellIndex]?.textContent.trim() ?? '?';
    minorUnitsByHeader[header] = (minorUnitsByHeader[header] ?? 0) + 1;
  }
  // The same integer in running text outside a cell, as in a label line
  // "Debit / Credit / Residual: 150000 / 150000 / 0". A token runs between
  // spaces and the separators of such a line, so an identifier, a date or a
  // file name stays one token and is not counted.
  const textSamples = [];
  let minorUnitsInText = 0;
  for (const node of texts) {
    if (node.parentElement.closest('td, th')) continue;
    for (const token of node.textContent.split(/[\s/:()·،؛;|=]+/u)) {
      if (!/^-?\d{5,}$/u.test(token.replace(/[.,،]+$/u, ''))) continue;
      minorUnitsInText++;
      if (textSamples.length < 5)
        textSamples.push(node.textContent.trim().slice(0, 60));
    }
  }
  // A minus drawn to the right of its digits: a negative number laid out by
  // the bidi algorithm without isolation. A negative number follows the
  // start, a space, a bracket or a separator, so the hyphen of a date or an
  // identifier is not one; and a digit carried to the next line by a wrap
  // is not a reordering, so both must share a line.
  const minusSamples = [];
  let minusAfterDigits = 0;
  for (const node of texts) {
    const text = node.textContent;
    for (const match of text.matchAll(/(^|[\s(:/=[,،؛;])-(?=\d)/gu)) {
      const at = match.index + match[1].length;
      const minus = rect(node, at),
        digit = rect(node, at + 1);
      if (!minus || !digit) continue;
      if (
        Math.abs(minus.top - digit.top) < minus.height / 2 &&
        minus.left >= digit.left
      ) {
        minusAfterDigits++;
        if (minusSamples.length < 5)
          minusSamples.push(text.trim().slice(Math.max(0, at - 10), at + 10));
      }
    }
  }
  // A formatted amount in running text that is not laid out left to right.
  // The nearest element that sets a direction decides, as the browser
  // computed it: a dir attribute, a block, or an inline isolate or
  // embedding. A plain inline element such as a span sets none, so an amount
  // in it takes the direction of the Arabic text around it.
  const unisolatedSamples = [];
  let unisolatedAmounts = 0;
  const amount =
    /(?:^|[^\d.,-])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,])|(?:^|[^\d.,])-\d+\.\d+(?!\d)/u;
  const leftToRight = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const attribute = e.getAttribute('dir');
      if (attribute === 'ltr' || attribute === 'rtl')
        return attribute === 'ltr';
      const s = getComputedStyle(e);
      if (
        s.display !== 'inline' ||
        /isolate|embed|plaintext|override/u.test(s.unicodeBidi)
      )
        return s.direction === 'ltr';
    }
    return false;
  };
  for (const node of texts) {
    if (!amount.test(node.textContent)) continue;
    if (leftToRight(node.parentElement)) continue;
    unisolatedAmounts++;
    if (unisolatedSamples.length < 5)
      unisolatedSamples.push(node.textContent.trim().slice(0, 40));
  }
  // A table cell whose word, amount or identity continues on the next line.
  const brokenSamples = [];
  let brokenInsideWord = 0,
    cells = 0;
  for (const cell of root.querySelectorAll('td, th')) {
    if (!visible(cell)) continue;
    cells++;
    const inner = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement.closest('pre')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    let broken = false;
    for (
      let node = inner.nextNode();
      node && !broken;
      node = inner.nextNode()
    ) {
      const text = node.textContent;
      let line = null;
      for (let i = 0; i < text.length && !broken; i++) {
        if (/\s/u.test(text[i])) {
          line = null;
          continue;
        }
        const box = rect(node, i);
        if (!box) continue;
        if (line !== null && Math.abs(box.top - line) > box.height / 2) {
          broken = true;
          if (brokenSamples.length < 5)
            brokenSamples.push(text.trim().slice(0, 40));
        }
        line = box.top;
      }
    }
    if (broken) brokenInsideWord++;
  }
  // The page itself scrolling sideways.
  const overflowPx =
    document.documentElement.scrollWidth - document.documentElement.clientWidth;
  // A disabled button that says nothing about why: no description, or one
  // that names elements missing, empty or not shown, so the reader who sees
  // the page reads no reason either (UX-3).
  const buttons = [...root.querySelectorAll('button')].filter(visible);
  const disabled = buttons.filter((b) => b.matches(':disabled'));
  const said = (b) =>
    (b.getAttribute('aria-describedby') ?? '')
      .split(/\s+/u)
      .map((id) => id && document.getElementById(id))
      .some((el) => el && visible(el) && el.textContent.trim()) ||
    !!b.getAttribute('aria-description')?.trim() ||
    !!b.title.trim();
  const disabledUnexplained = disabled.filter((b) => !said(b)).length;
  // A frame the reader sees scrolling sideways with no name: Chromium lets
  // the keyboard reach it, but nothing says what it holds or that it
  // scrolls. Content inside a closed section is not seen, so it counts once
  // the section is opened.
  const wideUnnamed = [...root.querySelectorAll('*')].filter(
    (el) =>
      el.scrollWidth > el.clientWidth + 1 &&
      el.checkVisibility() &&
      /^(auto|scroll)$/u.test(getComputedStyle(el).overflowX) &&
      !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')),
  ).length;
  // A cell the reader sees cut off: its text runs past the cell and the cell
  // hides the rest (the global table rule ends it with an ellipsis), so a
  // reason, a source row or a label is read only in part (UX-3).
  const clippedSamples = [];
  const clippedText = [...root.querySelectorAll('td, th')].filter((cell) => {
    if (!cell.checkVisibility() || cell.scrollWidth <= cell.clientWidth + 1)
      return false;
    if (!/^(hidden|clip)$/u.test(getComputedStyle(cell).overflowX))
      return false;
    if (clippedSamples.length < 5)
      clippedSamples.push(cell.textContent.trim().slice(0, 60));
    return true;
  }).length;
  // A source row or a list of ids shown as JSON, with the brackets and
  // quotes the program wrote, where the reader expects its fields (audit
  // B6). Counted shown, or one closed disclosure away as a reader opens it.
  const jsonSamples = [];
  let jsonText = 0;
  const all = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = all.nextNode(); node; node = all.nextNode()) {
    const el = node.parentElement,
      text = node.textContent.trim();
    if (!el || el.closest('script, style, template, [hidden]')) continue;
    if (!/^[[{][\s\S]*"[\s\S]*[\]}]$/u.test(text)) continue;
    const shut = el.closest('details:not([open])');
    if (!(el.checkVisibility() || (shut && shut.checkVisibility()))) continue;
    try {
      if (typeof JSON.parse(text) !== 'object') continue;
    } catch {
      continue;
    }
    jsonText++;
    if (jsonSamples.length < 5) jsonSamples.push(text.slice(0, 60));
  }
  // A table of column headers over no row says nothing of what is absent
  // (UX-3). Counted shown, or one closed disclosure away.
  const emptySamples = [];
  const emptyTable = [...root.querySelectorAll('table')].filter((table) => {
    if (table.closest('[hidden]')) return false;
    const shut = table.closest('details:not([open])');
    if (!(table.checkVisibility() || (shut && shut.checkVisibility())))
      return false;
    if (!table.querySelector('th') || table.querySelector('tbody tr'))
      return false;
    if (emptySamples.length < 5)
      emptySamples.push((table.getAttribute('aria-label') ?? '').slice(0, 60));
    return true;
  }).length;
  // A section titled with a count of none: a disclosure, heading or legend
  // the reader sees whose title ends in "(0)", so the reader opens it, or
  // reads past its title, to find nothing (audit B3). An absence is news,
  // said once in words; a title with a zero is not how to say it (UX-4).
  const zeroSamples = [];
  const zeroCounter = [
    ...root.querySelectorAll('summary, h2, h3, h4, h5, h6, legend'),
  ].filter((el) => {
    if (el.closest('[hidden]') || !el.checkVisibility()) return false;
    if (!/\(\s*0\s*\)$/u.test(el.textContent.trim())) return false;
    if (zeroSamples.length < 5)
      zeroSamples.push(el.textContent.trim().slice(0, 60));
    return true;
  }).length;
  // A command written as a verbal noun, «فتح» or «استعادة», where other
  // buttons say what to do, «افتح» or «استعد»: one imperative form for
  // every command, as the English already reads (UX-5). A button, or the
  // label of a file input drawn as one, the reader sees or sees once a
  // closed disclosure is opened, whose words begin with the noun of an
  // action. «تحقق» and «فك» read as either and are not counted.
  const verbalNoun =
    /^(?:فتح|استعادة|حفظ|فحص|تصدير|تنزيل|إعادة|اعتماد|رفض|إلغاء|التراجع|مقارنة|قراءة|إضافة|عرض|إخفاء|مسح|إزالة|استخدام|تأكيد|تطبيق|تحميل|إنشاء|بدء|اختيار|قبول|تسجيل|نسخ|طباعة|تشغيل|تجربة|استئناف|مراجعة|حذف|تعديل|إغلاق|العودة|متابعة|انتقال|الانتقال|استبدال|إنهاء|إظهار|تحديد|إيقاف|اقتراح|إعداد|استبعاد|تغيير|عكس)(?:\s|$)/u;
  const nounSamples = [];
  const commandAsNoun = [
    ...root.querySelectorAll('button, label:has(input[type="file"])'),
  ].filter((el) => {
    if (el.closest('[hidden]')) return false;
    const shut = el.closest('details:not([open])');
    if (!(el.checkVisibility() || (shut && shut.checkVisibility())))
      return false;
    const words = el.textContent.trim().replace(/\s+/gu, ' ');
    if (!verbalNoun.test(words)) return false;
    if (nounSamples.length < 5) nounSamples.push(words.slice(0, 60));
    return true;
  }).length;
  // A workspace intro the reader sees running past two lines: at a phone's
  // width it pushed the start row and the sources down a third of a screen
  // (UX-5). Lines are counted from where its words are drawn.
  const introSamples = [];
  const longIntro = [
    ...root.querySelectorAll('.workspace-intro__heading > p'),
  ].filter((p) => {
    if (!p.checkVisibility()) return false;
    const range = document.createRange();
    range.selectNodeContents(p);
    const lines = new Set(
      [...range.getClientRects()]
        .filter((r) => r.width > 0)
        .map((r) => Math.round(r.top)),
    ).size;
    if (lines <= 2) return false;
    if (introSamples.length < 5)
      introSamples.push(`${lines}: ${p.textContent.trim().slice(0, 40)}`);
    return true;
  }).length;
  // Text the reader sees standing under 4.5 to 1 against what is drawn
  // behind it, and text drawn under 13 px (UX-8; audit D2 found 11 and 12 px
  // text at 4.23 to 4.41). Counted once per element that holds the text.
  // Colours are read through a canvas, so any colour space the styles use
  // becomes sRGB. The backdrop is every background up the tree, laid over
  // white from the first opaque one down; a gradient gives each of its stops
  // as a backdrop the text may stand on, and the worst one counts. The text
  // takes its own alpha and the opacity of every ancestor in the panel. A
  // disabled control is not counted for contrast (WCAG 1.4.3 exempts an
  // inactive control), nor what is hidden from assistive technology as
  // decoration; text over an image is not measured and is counted apart.
  const paint = document.createElement('canvas').getContext('2d', {
    willReadFrequently: true,
  });
  const rgba = (css) => {
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = '#000';
    paint.fillStyle = css;
    paint.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = ([r, g, b, a], [R, G, B]) => [
    r * a + R * (1 - a),
    g * a + G * (1 - a),
    b * a + B * (1 - a),
  ];
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const inactive =
    'button:disabled, input:disabled, select:disabled, textarea:disabled, fieldset:disabled, [aria-disabled="true"]';
  const holders = new Set(texts.map((node) => node.parentElement));
  const contrastSamples = [];
  const smallSamples = [];
  // How the counts spread, for the design record: each failing colour on
  // its worst backdrop, and each size under 13 px.
  const contrastPairs = {};
  const smallSizes = {};
  const hex = (rgb) =>
    '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  // The palette the panel draws with, as the reader sees it: each text
  // colour, each surface and each border colour, by role (UX-8 sets its
  // target on these, not on the stylesheets, which also paint the art).
  const palette = { text: {}, surface: {}, border: {} };
  const tally = (role, css) => {
    const c = rgba(css);
    if (c[3] === 0) return;
    const key = hex(c.slice(0, 3)) + (c[3] < 1 ? `/${c[3].toFixed(2)}` : '');
    palette[role][key] = (palette[role][key] ?? 0) + 1;
  };
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('svg') || !visible(el)) continue;
    const own = getComputedStyle(el);
    tally('surface', own.backgroundColor);
    for (const side of ['Top', 'Right', 'Bottom', 'Left'])
      if (parseFloat(own[`border${side}Width`]) > 0)
        tally('border', own[`border${side}Color`]);
  }
  let lowContrast = 0,
    contrastUnmeasured = 0,
    smallText = 0;
  for (const el of holders) {
    if (el.closest('svg, [aria-hidden="true"]')) continue;
    const style = getComputedStyle(el);
    tally('text', style.color);
    const size = parseFloat(style.fontSize);
    const words = el.textContent.trim().replace(/\s+/gu, ' ').slice(0, 40);
    if (size < 13) {
      smallText++;
      smallSizes[`${size}px`] = (smallSizes[`${size}px`] ?? 0) + 1;
      if (smallSamples.length < 5) smallSamples.push(`${size}px: ${words}`);
    }
    if (el.closest(inactive)) continue;
    // Each layer is the set of colours it may show: one for a fill, every
    // stop for a gradient. The walk ends at a layer that hides what is under.
    const layers = [];
    let alpha = 1,
      image = false;
    for (let at = el; at; at = at.parentElement) {
      const own = getComputedStyle(at);
      if (/url\(/u.test(own.backgroundImage)) image = true;
      const stops =
        own.backgroundImage === 'none'
          ? []
          : (own.backgroundImage.match(/rgba?\([^)]*\)/gu) ?? []).map(rgba);
      const fill = rgba(own.backgroundColor);
      if (stops.length) layers.push(stops);
      if (fill[3] > 0) layers.push([fill]);
      if (image) break;
      if (fill[3] >= 1 || (stops.length && stops.every((c) => c[3] >= 1)))
        break;
    }
    for (let at = el; at && root.contains(at); at = at.parentElement)
      alpha *= parseFloat(getComputedStyle(at).opacity);
    if (image) {
      contrastUnmeasured++;
      continue;
    }
    // Layers were read from the text outward; the fill of an element lies
    // under its own gradient, so it was read after it.
    let backdrops = [[255, 255, 255]];
    for (const layer of layers.reverse())
      backdrops = layer.flatMap((colour) =>
        backdrops.map((under) => over(colour, under)),
      );
    const ink = rgba(style.color);
    let ratio = Infinity,
      worst = null;
    for (const backdrop of backdrops) {
      const drawn = over([ink[0], ink[1], ink[2], ink[3] * alpha], backdrop);
      const r = contrast(drawn, backdrop);
      if (r < ratio) [ratio, worst] = [r, `${hex(drawn)} on ${hex(backdrop)}`];
    }
    if (ratio < 4.5) {
      lowContrast++;
      const pair = `${worst} ${ratio.toFixed(2)}`;
      contrastPairs[pair] = (contrastPairs[pair] ?? 0) + 1;
      if (contrastSamples.length < 5)
        contrastSamples.push(`${ratio.toFixed(2)}: ${words}`);
    }
  }
  return {
    cells,
    controls: buttons.length,
    disabled: disabled.length,
    minorUnits,
    minorUnitsByHeader,
    minorUnitsInText,
    textSamples,
    minusAfterDigits,
    minusSamples,
    unisolatedAmounts,
    unisolatedSamples,
    brokenInsideWord,
    brokenSamples,
    pageOverflow: overflowPx > 0 ? 1 : 0,
    overflowPx,
    disabledUnexplained,
    wideUnnamed,
    clippedText,
    clippedSamples,
    jsonText,
    jsonSamples,
    emptyTable,
    emptySamples,
    zeroCounter,
    zeroSamples,
    commandAsNoun,
    nounSamples,
    longIntro,
    introSamples,
    lowContrast,
    contrastSamples,
    contrastPairs,
    contrastUnmeasured,
    smallText,
    smallSamples,
    smallSizes,
    palette,
  };
}

/** Where keyboard focus is after an action: inside the panel, or lost. */
export function focusInPage(selector) {
  const root = document.querySelector(selector);
  const active = document.activeElement;
  const inside = !!(
    active &&
    active !== document.body &&
    root?.contains(active)
  );
  return {
    inside,
    tag: active?.tagName ?? null,
    text: (active?.getAttribute('aria-label') || active?.textContent || '')
      .trim()
      .slice(0, 40),
  };
}

/** Plants one fault of each counted class into a rendered panel. */
export function plantInPage(selector) {
  const root = document.querySelector(selector);
  const planted = [];
  const formatted = [...root.querySelectorAll('td')].find(
    (c) =>
      c.getBoundingClientRect().width > 0 &&
      /^-?\d{1,3}(,\d{3})*\.\d{2,3}$/u.test(c.textContent.trim()),
  );
  if (formatted) {
    formatted.textContent = formatted.textContent.trim().replace(/[.,]/gu, '');
    planted.push('minorUnits');
  }
  const line = document.createElement('p');
  line.textContent = 'planted: 150000 / 150000 / 0';
  root.append(line);
  planted.push('minorUnitsInText');
  const table = [...root.querySelectorAll('table')].find(
    (t) => t.tBodies[0] && t.getBoundingClientRect().width > 0,
  );
  if (table) {
    const row = document.createElement('tr');
    const negative = document.createElement('td');
    negative.textContent = '-5000';
    const amount = document.createElement('td');
    amount.textContent = '1,234.56';
    const span = document.createElement('span');
    span.textContent = '-2,500.00';
    amount.append(' ', span);
    const narrow = document.createElement('td');
    const block = document.createElement('div');
    block.textContent = '1,000.00';
    block.style.cssText =
      'width:2ch;overflow-wrap:anywhere;word-break:break-all';
    narrow.append(block);
    // A long reason in a cell that hides what does not fit, as the global
    // table rule does.
    const clipped = document.createElement('td');
    clipped.textContent =
      'planted reason long enough to run past its cell and be cut off';
    clipped.style.cssText =
      'max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    row.append(negative, amount, narrow, clipped);
    table.tBodies[0].append(row);
    planted.push(
      'minusAfterDigits',
      'unisolatedAmounts',
      'brokenInsideWord',
      'clippedText',
    );
  }
  const wide = document.createElement('div');
  wide.style.cssText = 'width:6000px;height:1px';
  document.body.append(wide);
  planted.push('pageOverflow');
  // Disabled buttons described by nothing a reader sees: one by an empty
  // element and one by text that is not shown. A rule that only asked for
  // aria-describedby would count neither (UX-3).
  const empty = document.createElement('span');
  empty.id = 'census-planted-empty';
  const hidden = document.createElement('span');
  hidden.id = 'census-planted-hidden';
  hidden.textContent = 'planted reason';
  hidden.hidden = true;
  root.append(empty, hidden);
  for (const id of [empty.id, hidden.id]) {
    const button = document.createElement('button');
    button.disabled = true;
    button.textContent = 'planted';
    button.setAttribute('aria-describedby', id);
    root.append(button);
  }
  planted.push('disabledUnexplained');
  const frame = document.createElement('div');
  frame.style.cssText = 'overflow-x:auto;width:120px';
  const content = document.createElement('div');
  content.style.cssText = 'width:600px;height:4px';
  frame.append(content);
  root.append(frame);
  planted.push('wideUnnamed');
  // A source row shown as JSON inside a closed disclosure, one click away,
  // as the trial balance inventory showed it (audit B6).
  const disclosure = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'planted source row';
  const json = document.createElement('pre');
  json.textContent = JSON.stringify(['planted', 'source row']);
  disclosure.append(summary, json);
  root.append(disclosure);
  planted.push('jsonText');
  // A table of headers over no row, as an empty evidence table showed.
  const blank = document.createElement('table');
  blank.innerHTML = '<thead><tr><th>planted</th></tr></thead><tbody></tbody>';
  root.append(blank);
  planted.push('emptyTable');
  // A closed section titled with a zero count, as the evidence of a result
  // listed its empty sections (audit B3).
  const zero = document.createElement('details');
  const zeroTitle = document.createElement('summary');
  zeroTitle.textContent = 'planted evidence (0)';
  zero.append(zeroTitle);
  root.append(zero);
  planted.push('zeroCounter');
  // A command named by the noun of its action, as seven workspaces named
  // their example, restore, run, save and decision buttons.
  const noun = document.createElement('button');
  noun.type = 'button';
  noun.textContent = 'فتح المثال المزروع';
  root.append(noun);
  planted.push('commandAsNoun');
  // An intro that runs to four lines, as eleven workspaces' did at a phone's
  // width.
  const heading = document.createElement('div');
  heading.className = 'workspace-intro__heading';
  heading.style.cssText = 'width:160px';
  const intro = document.createElement('p');
  intro.textContent =
    'planted intro long enough to run past two lines in a narrow column';
  heading.append(intro);
  root.append(heading);
  planted.push('longIntro');
  // Grey text on white at 2.85 to 1, and text at 11 px, as the audit found
  // text of the result screens at 4.23 and at 11 and 12 px (D2).
  const faint = document.createElement('p');
  faint.textContent = 'planted faint words';
  faint.style.cssText = 'color:#999999;background:#ffffff;font-size:14px';
  const tiny = document.createElement('p');
  tiny.textContent = 'planted tiny words';
  tiny.style.cssText = 'color:#0a1b2e;background:#ffffff;font-size:11px';
  root.append(faint, tiny);
  planted.push('lowContrast', 'smallText');
  return planted;
}

/** The baseline figure of a domain: each metric summed over its states. */
export function sumStates(states) {
  const sum = Object.fromEntries(METRICS.map((m) => [m, 0]));
  for (const state of states)
    for (const metric of METRICS) sum[metric] += state[metric] ?? 0;
  return sum;
}

/**
 * Compares a run with the baseline. Any difference is reported: a higher
 * count is a new defect, a lower one an improvement the baseline must record.
 */
export function compare(baseline, current) {
  const increases = [],
    decreases = [],
    missing = [];
  for (const domain of Object.keys(current)) {
    const recorded = baseline[domain];
    if (!recorded) {
      missing.push(`${domain}: no baseline`);
      continue;
    }
    for (const metric of METRICS) {
      if (!(metric in recorded)) {
        missing.push(`${domain}.${metric}: no baseline`);
        continue;
      }
      const was = recorded[metric],
        now = current[domain][metric];
      if (now > was) increases.push(`${domain}.${metric}: ${was} → ${now}`);
      else if (now < was)
        decreases.push(`${domain}.${metric}: ${was} → ${now}`);
    }
  }
  for (const domain of Object.keys(baseline))
    if (!(domain in current)) missing.push(`${domain}: not measured`);
  return { increases, decreases, missing };
}
