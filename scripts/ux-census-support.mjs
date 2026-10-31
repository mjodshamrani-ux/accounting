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
];

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
  // A disabled button that says nothing about why.
  const buttons = [...root.querySelectorAll('button')].filter(visible);
  const disabled = buttons.filter((b) => b.matches(':disabled'));
  const disabledUnexplained = disabled.filter(
    (b) =>
      !(
        b.getAttribute('aria-describedby') ||
        b.getAttribute('aria-description') ||
        b.title
      ),
  ).length;
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
    row.append(negative, amount, narrow);
    table.tBodies[0].append(row);
    planted.push('minusAfterDigits', 'unisolatedAmounts', 'brokenInsideWord');
  }
  const wide = document.createElement('div');
  wide.style.cssText = 'width:6000px;height:1px';
  document.body.append(wide);
  planted.push('pageOverflow');
  const button = document.createElement('button');
  button.disabled = true;
  button.textContent = 'planted';
  root.append(button);
  planted.push('disabledUnexplained');
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
