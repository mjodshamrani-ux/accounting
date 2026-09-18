import { createHash } from 'node:crypto';
import { classifyVisibleGroup } from './group-evidence.mjs';
import { GENERATOR_VERSION, layoutFamilies } from './manifest.mjs';

function rng(seed) {
  let state = seed >>> 0;
  return (min, max) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return min + (state % (max - min + 1));
  };
}
const sum = (rows) => rows.reduce((total, row) => total + row.minor, 0);
const doc = (
  reference,
  minor,
  kind = minor < 0 ? 'Payment' : 'Invoice',
  date = '2026-07-15',
) => ({ reference, minor, kind, date });
// This table is the hand-calculated oracle anchor. Values are integer minor units.
// aa/bb are source observations; permitted is a list of explicit row-index pairs.
// An equal closing balance does not grant any match.
const foundations = [
  {
    a: [doc('INV-101', 10000)],
    b: [doc('INV-101', 10000)],
    p: [[0, 0]],
    totals: [10000, 10000],
  },
  {
    a: [doc('PAY-204', -7500)],
    b: [doc('PAY-204', -7500)],
    p: [[0, 0]],
    totals: [-7500, -7500],
  },
  {
    a: [doc('CN-19', -1250, 'Credit Note')],
    b: [doc('CN-19', -1250, 'Credit Note')],
    p: [[0, 0]],
    totals: [-1250, -1250],
  },
  {
    a: [doc('INV-102', 45000), doc('PAY-205', -12000)],
    b: [doc('PAY-205', -12000), doc('INV-102', 45000)],
    p: [
      [0, 1],
      [1, 0],
    ],
    totals: [33000, 33000],
  },
  {
    a: [doc('INV-103', 12345)],
    b: [doc('INV-103', 12345)],
    p: [[0, 0]],
    opening: [20000, 20000],
    totals: [32345, 32345],
  },
  {
    a: [doc('000000000000003782901', 7890)],
    b: [doc('000000000000003782901', 7890)],
    p: [[0, 0]],
    totals: [7890, 7890],
    referenceHeader: 'Invoice No',
  },
  {
    a: [doc('INV-104', 6000), doc('INV-105', 6000)],
    b: [doc('INV-105', 6000), doc('INV-104', 6000)],
    p: [
      [0, 1],
      [1, 0],
    ],
    totals: [12000, 12000],
  },
  {
    a: [doc('INV-106', 5100, 'Invoice', '2026-07-14')],
    b: [doc('INV-106', 5100, 'Invoice', '2026-07-15')],
    p: [[0, 0]],
    totals: [5100, 5100],
  },
  {
    a: [doc('INV-107', 331)],
    b: [doc('INV-107', 331)],
    p: [[0, 0]],
    currency: 'JPY',
    decimals: 0,
    totals: [331, 331],
  },
  {
    a: [doc('INV-108', 123456)],
    b: [doc('INV-108', 123456)],
    p: [[0, 0]],
    currency: 'KWD',
    decimals: 3,
    totals: [123456, 123456],
  },
  {
    a: [
      doc('INV-109', 9000),
      doc('CN-20', -1000, 'Credit Note'),
      doc('PAY-206', -4000),
    ],
    b: [
      doc('INV-109', 9000),
      doc('CN-20', -1000, 'Credit Note'),
      doc('PAY-206', -4000),
    ],
    p: [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
    totals: [4000, 4000],
  },
  {
    a: [doc('INV-110', 1)],
    b: [doc('INV-110', 1)],
    p: [[0, 0]],
    totals: [1, 1],
  },
  {
    a: [doc('INV-111', 10000), doc('INV-112', 3500)],
    b: [doc('INV-111', 10000)],
    p: [[0, 0]],
    totals: [13500, 10000],
    exception: 'supplier-only',
  },
  {
    a: [doc('INV-113', 12000)],
    b: [doc('INV-113', 12000), doc('PAY-207', -5000)],
    p: [[0, 0]],
    totals: [12000, 7000],
    exception: 'ledger-only',
  },
  {
    a: [doc('INV-114', 9999)],
    b: [doc('INV-114', 10000)],
    p: [],
    totals: [9999, 10000],
    exception: 'amount-variance',
  },
  {
    a: [doc('INV-115', 10000), doc('INV-116', 20000)],
    b: [doc('INV-115', 11000), doc('INV-116', 19000)],
    p: [],
    totals: [30000, 30000],
    exception: 'opposite-errors',
  },
  {
    a: [doc('INV-117', 6000)],
    b: [doc('INV-117', 6000)],
    p: [[0, 0]],
    opening: [10000, 9000],
    totals: [16000, 15000],
    exception: 'opening-variance',
  },
  {
    a: [doc('PAY-208', -10000)],
    b: [doc('PAY-208', -4000), doc('PAY-208', -6000)],
    p: [],
    g: [{ a: [0], b: [0, 1] }],
    totals: [-10000, -10000],
    exception: 'explicit-payment-group',
  },
  {
    a: [doc('PAY-209', -3000), doc('PAY-209', -7000)],
    b: [doc('PAY-209', -10000)],
    p: [],
    g: [{ a: [0, 1], b: [0] }],
    totals: [-10000, -10000],
    exception: 'explicit-payment-group',
  },
  {
    a: [doc('PAY-210', -8000), doc('PAY-210', -2000)],
    b: [doc('PAY-210', -7000), doc('PAY-210', -3000)],
    p: [],
    totals: [-10000, -10000],
    exception: 'many-to-many-review',
  },
  {
    a: [doc('INV-118', 10000)],
    b: [doc('INV-118', 6000)],
    p: [],
    totals: [10000, 6000],
    exception: 'report-basis-mismatch',
    reportB: 'open-items',
  },
  {
    a: [doc('INV-119', 8000, 'Invoice', '2026-08-01')],
    b: [doc('INV-119', 8000, 'Invoice', '2026-07-31')],
    p: [],
    totals: [0, 8000],
    exception: 'after-cutoff',
  },
  {
    a: [doc('INV-120', 456789)],
    b: [doc('INV-120', 456789)],
    p: [[0, 0]],
    totals: [456789, 456789],
    style: 'arabic-numerals',
  },
  {
    a: [doc('CN-21', -125025, 'Credit Note')],
    b: [doc('CN-21', -125025, 'Credit Note')],
    p: [[0, 0]],
    totals: [-125025, -125025],
    style: 'parenthesized-credits',
  },
  {
    a: [doc('INV-121', 123456)],
    b: [doc('INV-121', 123456)],
    p: [[0, 0]],
    totals: [123456, 123456],
    style: 'comma-decimals',
  },
  {
    a: [doc('INV-122', 15000), doc('INV-123', 25000)],
    b: [doc('INV-122', 15000), doc('INV-123', 25000)],
    p: [
      [0, 0],
      [1, 1],
    ],
    totals: [40000, 40000],
    style: 'repeated-headers',
  },
  {
    a: [doc('INV-124', 654321)],
    b: [doc('INV-124', 654321)],
    p: [[0, 0]],
    totals: [654321, 654321],
    style: 'blank-rows',
  },
  {
    a: [doc('=1+1', 5300)],
    b: [doc('=1+1', 5300)],
    p: [],
    totals: [5300, 5300],
    exception: 'unsafe-reference-review',
    style: 'text-formula-reference',
  },
  {
    a: [doc('', 10000)],
    b: [doc('', 10000)],
    p: [],
    totals: [10000, 10000],
    exception: 'missing-reference',
  },
  {
    a: [doc('INV-125', 10000), doc('INV-125', 10000)],
    b: [doc('INV-125', 10000)],
    p: [],
    totals: [20000, 10000],
    exception: 'duplicate-reference',
  },
  {
    a: [doc('PAY-211', -10000)],
    b: [doc('PMT-126', -4000, 'Payment'), doc('PMT-127', -6000, 'Payment')],
    p: [],
    totals: [-10000, -10000],
    exception: 'sum-without-evidence',
  },
  {
    a: [doc('AB-12', 8000)],
    b: [doc('A-B12', 8000)],
    p: [],
    totals: [8000, 8000],
    exception: 'normalization-collision',
  },
  {
    a: [doc('ADJ-31', -9000, 'Credit Note')],
    b: [doc('ADJ-31', -9000, 'Payment')],
    p: [],
    totals: [-9000, -9000],
    exception: 'type-conflict',
  },
  {
    a: [doc('INV-128', 9000, 'Invoice', '2026-07-01')],
    b: [doc('INV-128', 9000, 'Invoice', '2026-07-28')],
    p: [],
    totals: [9000, 9000],
    exception: 'date-conflict',
  },
  {
    a: [doc('INV-129', 10000), doc('INV-129', 10000)],
    b: [doc('INV-129', 10000), doc('INV-129', 10000)],
    p: [],
    totals: [20000, 20000],
    exception: 'duplicate-accounting-entry',
  },
  {
    a: [doc('INV-130', 10000)],
    b: [doc('INV-130', 10001)],
    p: [],
    totals: [10000, 10001],
    exception: 'near-equal-amount',
  },
  {
    a: [doc('INV-131', 10000)],
    b: [doc('INV-131', 10000)],
    p: [],
    totals: [10000, 10000],
    invalid: 'corrupt-file',
  },
  {
    a: [doc('INV-132', 10000)],
    b: [doc('INV-132', 10000)],
    p: [],
    totals: [10000, 10000],
    invalid: 'invalid-amount',
  },
  {
    a: [doc('INV-133', 10000, 'Invoice', '2026-02-30')],
    b: [doc('INV-133', 10000)],
    p: [],
    totals: [10000, 10000],
    invalid: 'invalid-date',
  },
  {
    a: [doc('INV-134', 10000)],
    b: [doc('INV-134', 10000)],
    p: [],
    totals: [10000, 10000],
    invalid: 'wrong-currency',
  },
];
function copyRows(rows, side, metadata, events) {
  return rows.map((row, i) => ({
    ...row,
    key: `${side}:${i + 1}`,
    hiddenEventId: row.hiddenEventId ?? `economic-${events}-${i}`,
    account: row.account ?? metadata.account,
    currency: row.currency ?? metadata.currency,
    description:
      row.description ??
      `${row.kind} ${row.kind === 'Invoice' ? 'goods supplied' : row.kind === 'Credit Note' ? 'returned goods' : 'bank transfer'}`,
  }));
}
function canonical(rows, cutoff) {
  return rows.filter((row) => row.date <= cutoff);
}
function economicLinks(a, b) {
  const groups = new Map();
  for (const [side, rows] of [
    ['a', a],
    ['b', b],
  ])
    for (const row of rows) {
      const entry = groups.get(row.hiddenEventId) ?? {
        eventId: row.hiddenEventId,
        aKeys: [],
        bKeys: [],
      };
      entry[`${side}Keys`].push(row.key);
      groups.set(row.hiddenEventId, entry);
    }
  return [...groups.values()];
}
export function generateCase(descriptor) {
  const random = rng(descriptor.seed);
  const anchor = descriptor.foundation
    ? foundations[descriptor.foundation - 1]
    : null;
  const decimals =
    anchor?.decimals ??
    (descriptor.scenario === 'ambiguous-number' ? 3 : [0, 2, 3][random(0, 2)]);
  const currency =
    anchor?.currency ?? { 0: 'JPY', 2: 'SAR', 3: 'KWD' }[decimals];
  const metadata = {
    supplier: 'Cedar Trading',
    entity: 'North Distribution',
    account: 'AP-231',
    currency,
    decimals,
    cutoff: '2026-07-31',
    periodStart: '2026-07-01',
    reportType: 'transactions',
    dateWindow: 2,
    referenceHeader:
      anchor?.referenceHeader ??
      (descriptor.scenario === 'long-references' ? 'Invoice No' : 'Reference'),
    numberFormat: 'dot',
    dateFormat: 'ymd',
    multiplier: 1,
    opening: 0,
    closing: null,
    signEvidence: 'Positive amount increases the payable to the supplier',
    periodEvidence: 'Statement covers 2026-07-01 through 2026-07-31',
  };
  const ma = { ...metadata },
    mb = { ...metadata };
  if (!anchor) {
    ma.dateFormat = ['ymd', 'dmy', 'mdy'][descriptor.index % 3];
    mb.dateFormat = ['ymd', 'dmy', 'mdy'][(descriptor.index + 1) % 3];
  }
  let a,
    b,
    explicitPairs = null;
  let problem = anchor?.exception ?? null;
  let invalid =
    anchor?.invalid ??
    (descriptor.category === 'invalid' ? descriptor.scenario : null);
  const style = anchor?.style ?? descriptor.scenario;
  if (anchor) {
    a = anchor.a.map((row, i) => ({
      ...row,
      hiddenEventId: `foundation-${descriptor.foundation}-${i}`,
    }));
    b = anchor.b.map((row, i) => ({
      ...row,
      hiddenEventId: `foundation-${descriptor.foundation}-b-${i}`,
    }));
    const assigned = new Set();
    for (const br of b) {
      const ai = a.findIndex(
        (ar, i) => ar.reference === br.reference && !assigned.has(i),
      );
      if (ai >= 0) {
        br.hiddenEventId = a[ai].hiddenEventId;
        assigned.add(ai);
      }
    }
    for (const [ai, bi] of anchor.p) b[bi].hiddenEventId = a[ai].hiddenEventId;
    for (const group of anchor.g ?? []) {
      const eventId = a[group.a[0]].hiddenEventId;
      for (const ai of group.a) a[ai].hiddenEventId = eventId;
      for (const bi of group.b) b[bi].hiddenEventId = eventId;
    }
    if (descriptor.foundation === 20)
      for (const row of [...a, ...b]) row.hiddenEventId = a[0].hiddenEventId;
    if (descriptor.foundation === 31)
      for (const br of b) br.hiddenEventId = a[0].hiddenEventId;
    explicitPairs = anchor.p;
    [ma.opening, mb.opening] = anchor.opening ?? [0, 0];
    mb.reportType = anchor.reportB ?? 'transactions';
    if (mb.reportType === 'open-items') {
      mb.opening = null;
      mb.periodEvidence = null;
    }
  } else {
    const n = style === 'multi-page' ? random(35, 60) : random(3, 18);
    const prefix = random(1000, 8999);
    const events = Array.from({ length: n }, (_, i) => {
      const kind =
        style === 'payments'
          ? 'Payment'
          : style === 'credit-notes'
            ? 'Credit Note'
            : ['invoices', 'long-references'].includes(style)
              ? 'Invoice'
              : ['Invoice', 'Invoice', 'Payment', 'Credit Note'][random(0, 3)];
      const magnitude = random(11, 9999999);
      const minor = kind === 'Invoice' ? magnitude : -magnitude;
      const reference =
        style === 'long-references'
          ? `000000000000${prefix}${String(i + 1).padStart(8, '0')}`
          : `${kind === 'Invoice' ? 'INV' : kind === 'Payment' ? 'PAY' : 'CN'}-${prefix}-${i + 1}`;
      return {
        ...doc(
          reference,
          minor,
          kind,
          `2026-07-${String(random(3, 25)).padStart(2, '0')}`,
        ),
        hiddenEventId: `hidden-${descriptor.seed}-${i}`,
      };
    });
    a = events.map((row) => ({ ...row }));
    b = events.map((row) => ({ ...row }));
    ma.opening = mb.opening = random(0, 999999);
    if (
      descriptor.category === 'complex' ||
      descriptor.category === 'ambiguous'
    )
      problem = style;
    if (style === 'date-shift')
      b.forEach((row) => {
        row.date =
          row.date.slice(0, 8) +
          String(Number(row.date.slice(8)) + 1).padStart(2, '0');
      });
    if (style === 'same-amount-distinct-references')
      a.forEach((row, i) => {
        row.minor = b[i].minor = row.kind === 'Invoice' ? 54321 : -54321;
      });
    if (style === 'supplier-only') b.splice(0, random(1, Math.min(3, n - 1)));
    if (style === 'ledger-only') a.splice(0, random(1, Math.min(3, n - 1)));
    if (style === 'amount-variance' || style === 'near-equal-amount')
      b[0].minor += style === 'near-equal-amount' ? 1 : random(11, 10000);
    if (style === 'opposite-errors') {
      const difference = random(100, 9999);
      b[0].minor += difference;
      b[1].minor -= difference;
    }
    if (style === 'opening-variance') mb.opening += random(1, 99000);
    if (
      [
        'one-to-many-evidence',
        'many-to-one-evidence',
        'many-to-many',
        'sum-without-evidence',
        'partial-payment',
      ].includes(style)
    ) {
      const total = random(10000, 999999),
        part = random(1000, total - 1000);
      const base = {
        ...doc(`PAY-${prefix}-R`, -total, 'Payment'),
        hiddenEventId: `payment-${descriptor.seed}`,
      };
      const split = [
        { ...base, minor: -part },
        { ...base, minor: -(total - part) },
      ];
      a = [base, ...a];
      b = [...split, ...b];
      if (style === 'many-to-one-evidence') [a, b] = [b, a];
      if (style === 'many-to-many') {
        const other = part === 1000 ? 1001 : part - 1;
        a = [
          { ...base, minor: -other },
          { ...base, minor: -(total - other) },
          ...a.slice(1),
        ];
      }
      if (style === 'sum-without-evidence') {
        b[0].reference = `PMT-${prefix}-78`;
        b[1].reference = `PMT-${prefix}-79`;
        b[0].kind = b[1].kind = 'Payment';
      }
      if (style === 'partial-payment') {
        b = [{ ...base, minor: -part }, ...b.slice(2)];
      }
    }
    if (style === 'cutoff-movement') a[0].date = '2026-08-02';
    if (style === 'report-basis-mismatch') {
      mb.reportType = 'open-items';
      b[0].minor = Math.trunc(b[0].minor / 2);
      mb.periodEvidence = null;
      mb.opening = null;
    }
    if (style === 'cross-account') {
      mb.account = 'AP-992';
      b.forEach((row) => {
        row.account = mb.account;
      });
    }
    if (style === 'cross-currency') {
      mb.currency = currency === 'SAR' ? 'USD' : 'SAR';
      b.forEach((row) => {
        row.currency = mb.currency;
      });
    }
    if (style === 'numeric-generic-reference') {
      a[0].reference = b[0].reference = '0000921786';
      a[0].kind = b[0].kind = 'Invoice';
      a[0].minor = b[0].minor = Math.abs(a[0].minor);
    }
    if (style === 'missing-reference') {
      a[0].reference = '';
      b[0].reference = '';
    }
    if (style === 'duplicate-reference') {
      a.push({ ...a[0], hiddenEventId: `separate-${descriptor.seed}` });
    }
    if (style === 'duplicate-accounting-entry') {
      a.push({ ...a[0], hiddenEventId: `separate-${descriptor.seed}` });
      b.push({ ...b[0], hiddenEventId: `separate-${descriptor.seed}` });
    }
    if (style === 'normalization-collision') {
      a[0].reference = 'AB-12';
      b[0].reference = 'A-B12';
      b[0].hiddenEventId = `unrelated-${descriptor.seed}`;
    }
    if (style === 'same-reference-conflicting-types') {
      a[0].minor = b[0].minor = -Math.abs(a[0].minor);
      a[0].kind = 'Credit Note';
      b[0].kind = 'Payment';
    }
    if (style === 'same-reference-date-conflict') {
      a[0].date = '2026-07-01';
      b[0].date = '2026-07-29';
    }
    if (style === 'text-formula-reference') {
      a[0].reference = b[0].reference = '=1+1';
    }
    if (style === 'row-permutation') b.reverse();
    // Final only: reserve a compound accounting context, not just a new seed/layout.
    if (
      descriptor.reservedCombination &&
      ['complex', 'ambiguous'].includes(descriptor.category)
    ) {
      a.push({
        ...doc(
          `INV-${prefix}-RES`,
          123457 + random(1, 999),
          'Invoice',
          '2026-08-04',
        ),
        hiddenEventId: `after-cutoff-${descriptor.seed}`,
      });
      ma.opening += 913;
    }
  }
  if (invalid === 'ambiguous-number') {
    const minor = random(1001, 999999);
    const observation = {
      ...a[0],
      reference: `INV-${random(10000, 99999)}`,
      kind: 'Invoice',
      minor,
    };
    a = [{ ...observation }];
    b = [{ ...observation }];
    ma.opening = mb.opening = 0;
    ma.numberFormat = null;
    ma.numberFormatEvidence = 'unconfirmed';
  }
  if (invalid === 'wrong-currency')
    mb.currency = currency === 'SAR' ? 'USD' : 'SAR';
  if (invalid === 'unsupported-aging') {
    ma.reportType = 'aging';
    ma.periodEvidence = null;
  }
  if (invalid === 'invalid-date') a[0].date = '2026-02-30';
  if (style === 'comma-decimals') ma.numberFormat = mb.numberFormat = 'comma';
  a = copyRows(a, 'supplier', ma, descriptor.id);
  b = copyRows(b, 'ledger', mb, descriptor.id);
  const activeA = canonical(a, ma.cutoff),
    activeB = canonical(b, mb.cutoff);
  ma.closing = (ma.opening ?? 0) + sum(activeA);
  mb.closing = (mb.opening ?? 0) + sum(activeB);
  if (invalid === 'wrong-total') ma.closing += 137;
  const sourceWideInvalid = [
    'corrupt-file',
    'empty-file',
    'unsupported-aging',
    'missing-amount-column',
    'wrong-currency',
  ].includes(invalid);
  const rowInvalid = [
    'formula-without-cache',
    'invalid-amount',
    'invalid-date',
  ].includes(invalid);
  const unreadableKeys = sourceWideInvalid
    ? a.map((row) => row.key)
    : rowInvalid
      ? [a[0].key]
      : [];
  const eligibleSource =
    ma.currency === mb.currency &&
    ma.account === mb.account &&
    ma.reportType === mb.reportType &&
    !sourceWideInvalid;
  const formatUnconfirmed = invalid === 'ambiguous-number';
  const permittedAutoMatches = [];
  if (explicitPairs && eligibleSource && !formatUnconfirmed)
    for (const [ai, bi] of explicitPairs)
      permittedAutoMatches.push({
        aKeys: [a[ai].key],
        bKeys: [b[bi].key],
        rule: 'explicit-manual-oracle',
      });
  else if (eligibleSource && !formatUnconfirmed) {
    for (const ar of activeA) {
      if (unreadableKeys.includes(ar.key)) continue;
      if (!ar.reference || /^[=+@]/.test(ar.reference)) continue;
      if (
        /^\d+$/.test(ar.reference) &&
        (ma.referenceHeader !== 'Invoice No' ||
          mb.referenceHeader !== 'Invoice No')
      )
        continue;
      // Exact, business-visible references only. No hidden IDs are consulted here.
      const sameA = activeA.filter((row) => row.reference === ar.reference),
        sameB = activeB.filter((row) => row.reference === ar.reference);
      if (sameA.length !== 1 || sameB.length !== 1) continue;
      const br = sameB[0];
      if (
        ar.minor !== br.minor ||
        ar.kind !== br.kind ||
        ar.currency !== br.currency ||
        ar.account !== br.account
      )
        continue;
      const gap =
        Math.abs(Date.parse(ar.date) - Date.parse(br.date)) / 86400000;
      if (gap > 2 || !Number.isFinite(gap)) continue;
      permittedAutoMatches.push({
        aKeys: [ar.key],
        bKeys: [br.key],
        rule: 'unique-exact-reference-amount-type-scope-date',
      });
    }
  }
  const covered = new Set(
    permittedAutoMatches.flatMap((entry) => [...entry.aKeys, ...entry.bKeys]),
  );
  if (eligibleSource && anchor?.g)
    for (const group of anchor.g)
      permittedAutoMatches.push({
        aKeys: group.a.map((i) => a[i].key),
        bKeys: group.b.map((i) => b[i].key),
        rule: 'explicit-payment-reference-balanced-group',
      });
  if (
    eligibleSource &&
    !anchor &&
    ['one-to-many-evidence', 'many-to-one-evidence'].includes(style)
  ) {
    const payment = a.find((row) => row.reference.endsWith('-R'));
    const ga = activeA.filter((row) => row.reference === payment.reference),
      gb = activeB.filter((row) => row.reference === payment.reference);
    permittedAutoMatches.push({
      aKeys: ga.map((row) => row.key),
      bKeys: gb.map((row) => row.key),
      rule: 'explicit-payment-reference-balanced-group',
    });
  }
  for (const entry of permittedAutoMatches)
    for (const key of [...entry.aKeys, ...entry.bKeys]) covered.add(key);
  const expectedExclusions = [...a, ...b]
    .filter((row) => row.date > ma.cutoff)
    .map((row) => ({ key: row.key, reason: 'after-cutoff' }));
  const expectedExceptions = [...activeA, ...activeB]
    .filter((row) => !covered.has(row.key))
    .map((row) => ({
      code: invalid ?? problem ?? 'unproven-reference',
      key: row.key,
    }));
  const referenceClasses = new Map();
  const referencePattern = [...a, ...b].map((row) => {
    if (!row.reference) return null;
    if (!referenceClasses.has(row.reference))
      referenceClasses.set(row.reference, referenceClasses.size);
    return referenceClasses.get(row.reference);
  });
  const economicFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        a: a.map(({ minor, kind, date }) => ({ minor, kind, date })),
        b: b.map(({ minor, kind, date }) => ({ minor, kind, date })),
        opening: [ma.opening, mb.opening],
        report: [ma.reportType, mb.reportType],
        currency: [ma.currency, mb.currency],
        account: [ma.account, mb.account],
        referencePattern,
        invalid,
      }),
    )
    .digest('hex');
  const source = (side, rows, meta, family) => ({
    side,
    name:
      side === 'supplier'
        ? `supplier-statement.${layoutFamilies[family].format}`
        : `accounts-payable.${layoutFamilies[family].format}`,
    format: layoutFamilies[family].format,
    layout: {
      ...layoutFamilies[family],
      family,
      style:
        invalid === 'ambiguous-number' && side === 'supplier'
          ? 'comma-decimals'
          : style,
    },
    metadata: meta,
    rows,
    invalid: side === 'supplier' ? invalid : null,
  });
  const spec = {
    id: descriptor.id,
    category: descriptor.category,
    split: descriptor.split,
    scenario: descriptor.scenario,
    foundation: descriptor.foundation,
    repro: {
      generatorVersion: GENERATOR_VERSION,
      seed: descriptor.seed,
      descriptor,
    },
    economicFingerprint,
    sources: [
      source('supplier', a, ma, descriptor.layoutFamilyA),
      source('ledger', b, mb, descriptor.layoutFamilyB),
    ],
    oracle: {
      rows: [...a, ...b],
      activeRows: [...activeA, ...activeB],
      permittedAutoMatches,
      groupAssessments: /** @type {Array<Record<string,any>>} */ ([]),
      economicLinks: economicLinks(a, b),
      expectedExceptions,
      expectedExclusions,
      balances: {
        openingA: ma.opening,
        openingB: mb.opening,
        closingA: ma.closing,
        closingB: mb.closing,
        computedClosingA: (ma.opening ?? 0) + sum(activeA),
        computedClosingB: (mb.opening ?? 0) + sum(activeB),
        difference: ma.closing - mb.closing,
        rawMovementA: sum(a),
        rawMovementB: sum(b),
        cutoffMovementA: sum(activeA),
        cutoffMovementB: sum(activeB),
        comparable:
          eligibleSource &&
          ma.reportType === 'transactions' &&
          !rowInvalid &&
          invalid !== 'wrong-total' &&
          !formatUnconfirmed,
      },
      manualAnchor: anchor
        ? {
            closingA: anchor.totals[0],
            closingB: anchor.totals[1],
            permittedPairs: anchor.p,
            permittedGroups: anchor.g ?? [],
          }
        : null,
      outcome:
        invalid && !['wrong-total', 'ambiguous-number'].includes(invalid)
          ? 'reject'
          : !eligibleSource ||
              ['wrong-total', 'ambiguous-number'].includes(invalid)
            ? 'review'
            : 'compare',
      unreadableKeys,
      requiresFormatReview: formatUnconfirmed ? ['supplier'] : [],
      expectedRowErrors: rowInvalid ? [{ key: a[0].key, code: invalid }] : [],
      expectedBalanceValidationFailure: invalid === 'wrong-total',
      invalid,
      requiresScopeStop: !eligibleSource,
      groupPolicy:
        'Only explicit bank/receipt identities or document-line evidence permit groups; generic payment references and many-to-many allocation remain review.',
    },
  };
  const candidates = spec.oracle.permittedAutoMatches.filter(
    (g) => g.aKeys.length + g.bKeys.length > 2,
  );
  spec.oracle.groupAssessments = candidates.map((group) =>
    classifyVisibleGroup(spec, group),
  );
  spec.oracle.permittedAutoMatches = spec.oracle.permittedAutoMatches.filter(
    (g) => g.aKeys.length + g.bKeys.length === 2,
  );
  for (const assessment of spec.oracle.groupAssessments)
    if (assessment.classification === 'required')
      spec.oracle.permittedAutoMatches.push({ ...assessment, required: true });
  const accepted = new Set(
    spec.oracle.permittedAutoMatches.flatMap((g) => [...g.aKeys, ...g.bKeys]),
  );
  for (const group of spec.oracle.groupAssessments)
    for (const key of [...group.aKeys, ...group.bKeys])
      if (
        !accepted.has(key) &&
        !spec.oracle.expectedExceptions.some((e) => e.key === key)
      )
        spec.oracle.expectedExceptions.push({
          key,
          code: 'group-relationship-unproven',
        });
  if (spec.oracle.manualAnchor) {
    spec.oracle.manualAnchor.candidateGroups =
      spec.oracle.manualAnchor.permittedGroups;
    spec.oracle.manualAnchor.permittedGroups = [];
  }
  return spec;
}
