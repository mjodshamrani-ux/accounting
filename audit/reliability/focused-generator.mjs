// Targeted extensions reuse the 0.4.5 accounting model and independent writers.
// New holdout combinations are descriptors only until the runner is frozen.
import { createHash } from 'node:crypto';
import { foundationManifest, GENERATOR_VERSION } from './manifest.mjs';
import { generateCase } from './generator.mjs';
import { classifyVisibleGroup } from './group-evidence.mjs';
export const FOCUSED_VERSION = 'tarasuf-focused-groups-1.1.0';
const development = [
  'payment-bank-1n',
  'payment-bank-n1',
  'payment-receipt-1n',
  'invoice-po-1n',
  'invoice-po-n1',
  'generic-payment',
  'unreferenced-sum',
  'conflicting-bank',
  'repeated-component',
  'missing-component',
  'competing-bank-use',
  'currency-conflict',
  'opposite-sign',
  'mixed-amount-basis',
  'mixed-types',
  'many-to-many',
  'bank-extra-component',
  'invoice-po-1n',
  'payment-bank-n1',
  'payment-receipt-1n',
];
const reserved = [
  'payment-bank-1n',
  'invoice-po-n1',
  'payment-receipt-1n',
  'repeated-component',
  'mixed-amount-basis',
  'payment-bank-n1',
  'conflicting-bank',
  'invoice-po-1n',
];
// Second reserved batch: descriptors only. Do not materialize before the new freeze.
const reservedB = [
  'invoice-po-n1',
  'payment-bank-1n',
  'payment-receipt-1n',
  'invoice-po-1n',
  'payment-bank-n1',
  'opposite-sign',
  'repeated-component',
  'mixed-amount-basis',
];
export function focusedManifest() {
  return [
    ...development.map((scenario, index) => ({
      id: `G046-${String(index + 1).padStart(3, '0')}`,
      scenario,
      index,
      split: 'development-046',
      category: 'focused-development',
      layoutFamilyA: '046-register-csv',
      layoutFamilyB: '046-register-xlsx',
    })),
    ...reserved.map((scenario, index) => ({
      id: `H046-${String(index + 1).padStart(3, '0')}`,
      scenario,
      index: index + 100,
      split: 'final-046',
      category: 'focused-opened-holdout',
      layoutFamilyA: '046-reserved-ooxml-0',
      layoutFamilyB: '046-reserved-ooxml-1',
    })),
    ...reservedB.map((scenario, index) => ({
      id: `J046-${String(index + 1).padStart(3, '0')}`,
      scenario,
      index: index + 300,
      split: 'final-046-b',
      category: 'focused-reserved-b',
      layoutFamilyA: `046-b-reserved-${index % 2 ? 'csv' : 'native-xlsx'}-a`,
      layoutFamilyB: `046-b-reserved-${index % 2 ? 'native-xlsx' : 'ooxml'}-b`,
    })),
  ];
}
export function generateFocusedCase(descriptor) {
  const base = generateCase(foundationManifest()[10]),
    scenario = descriptor.scenario,
    n = descriptor.index,
    holdout = descriptor.split.startsWith('final-046'),
    batchB = descriptor.split === 'final-046-b';
  const invoice = scenario.startsWith('invoice'),
    kind = invoice ? 'Invoice' : 'Payment',
    sign = invoice ? 1 : -1;
  const component = [
    invoice ? 250000 : 13000,
    invoice ? 225000 : 17000,
    invoice ? 200000 : 12000,
  ];
  component[0] += descriptor.id === 'G046-004' ? 0 : n * 113;
  if (batchB) {
    component[0] += 791;
    component[1] += 2371;
    component[2] -= 419;
  }
  if (holdout && ['payment-bank-1n', 'invoice-po-n1'].includes(scenario)) {
    component[0] -= 731;
    component.push(731);
  }
  const total = component.reduce((a, b) => a + b, 0),
    common = `${invoice ? 'INV' : 'PAY'}-${76321 + n}`,
    bank = `BNK-${480193 + n}`,
    receipt = `RCT-${680121 + n}`,
    po = `PO-${24017 + n}`;
  const row = (side, i, minor) => ({
    key: `${side}:${i + 1}`,
    hiddenEventId: `economic-hidden-${descriptor.id}`,
    reference: invoice
      ? common
      : `${side === 'supplier' ? 'PAY' : 'PV'}-${76321 + n}-${i + 1}`,
    date: '2026-07-15',
    minor,
    kind,
    description: invoice ? 'Goods supplied' : 'Bank transfer',
    currency: 'SAR',
    account: 'AP-482',
    bankReference: invoice ? '' : bank,
    receiptReference: scenario === 'payment-receipt-1n' ? receipt : '',
    poReference: invoice ? po : '',
    amountBasis: 'Movement',
  });
  let a = [row('supplier', 0, sign * total)],
    b = component.map((value, i) => row('ledger', i, sign * value));
  if (scenario.endsWith('n1'))
    [a, b] = [
      b.map((r, i) => ({ ...r, key: `supplier:${i + 1}` })),
      a.map((r, i) => ({ ...r, key: `ledger:${i + 1}` })),
    ];
  if (scenario === 'payment-receipt-1n')
    for (const r of [...a, ...b]) r.bankReference = '';
  if (scenario === 'generic-payment')
    for (const r of [...a, ...b]) {
      r.bankReference = '';
      r.reference = common;
    }
  if (scenario === 'unreferenced-sum')
    for (const r of [...a, ...b]) r.bankReference = '';
  if (scenario === 'conflicting-bank') b[0].bankReference = 'BNK-OTHER-983';
  if (scenario === 'repeated-component') {
    b[1].minor = b[0].minor;
    b[2].minor = a[0].minor - b[0].minor - b[1].minor;
  }
  if (scenario === 'missing-component') b.pop();
  if (scenario === 'competing-bank-use') {
    const extra = {
      ...row('supplier', a.length, 32100),
      kind: 'Invoice',
      reference: `INV-COMP-${n}`,
      description: 'Separate invoice',
      hiddenEventId: `separate-${n}`,
    };
    a.push(extra);
    b.push({ ...extra, key: `ledger:${b.length + 1}` });
  }
  if (scenario === 'currency-conflict') for (const r of b) r.currency = 'USD';
  if (scenario === 'opposite-sign') for (const r of b) r.minor = -r.minor;
  if (scenario === 'mixed-amount-basis') b[0].amountBasis = 'Outstanding';
  if (scenario === 'mixed-types') b[0].kind = 'Credit Note';
  if (scenario === 'many-to-many')
    a = [row('supplier', 0, -11101), row('supplier', 1, -total + 11101)];
  if (scenario === 'bank-extra-component')
    b.push(row('ledger', b.length, -1937));
  const meta = {
    ...base.sources[0].metadata,
    supplier: 'Cedar Trading',
    entity: 'North Distribution',
    account: 'AP-482',
    currency: 'SAR',
    decimals: 2,
    opening: 0,
    cutoff: '2026-07-31',
    periodStart: '2026-07-01',
    dateFormat: 'ymd',
    numberFormat: 'dot',
    referenceHeader: invoice ? 'Invoice No' : 'Reference',
  };
  const fields = [
    'date',
    'reference',
    'kind',
    'description',
    scenario === 'payment-receipt-1n'
      ? 'receiptReference'
      : invoice
        ? 'poReference'
        : 'bankReference',
    'amountBasis',
    'amount',
    'currency',
    'account',
  ];
  const source = (side, rows, i) => {
    const format = batchB
      ? i === 0 && n % 2
        ? 'csv'
        : 'xlsx'
      : holdout
        ? 'xlsx'
        : i
          ? 'xlsx'
          : 'csv';
    const layout = {
      family: holdout ? `046-reserved-ooxml-${i}` : `046-register-${format}`,
      split: descriptor.split,
      format,
      writer: holdout
        ? 'ooxml-zip'
        : format === 'xlsx'
          ? 'exceljs'
          : 'csv-records',
      language: holdout && i === 0 ? 'ar' : 'en',
      columns: 'explicit',
      fields: holdout
        ? [
            fields[1],
            fields[4],
            fields[2],
            fields[0],
            fields[5],
            fields[6],
            fields[3],
            fields[7],
            fields[8],
          ]
        : fields,
      banner: true,
      extraSheet: holdout,
      repeatedHeader: holdout,
      style: 'dot',
    };
    if (batchB) {
      layout.family =
        i === 0 ? descriptor.layoutFamilyA : descriptor.layoutFamilyB;
      layout.writer =
        format === 'csv'
          ? 'csv-records'
          : i === 1 && n % 2 === 0
            ? 'ooxml-zip'
            : 'exceljs';
      layout.language = (n + i) % 2 ? 'en' : 'ar';
      const orders = [
        [6, 3, 0, 1, 4, 2, 8, 7, 5],
        [4, 6, 1, 0, 2, 8, 3, 5, 7],
        [0, 2, 6, 4, 3, 1, 5, 7, 8],
        [8, 7, 3, 6, 1, 0, 4, 2, 5],
      ];
      layout.fields = orders[(n + i) % orders.length].map(
        (index) => fields[index],
      );
      layout.style =
        format === 'xlsx' && layout.writer === 'exceljs'
          ? 'dot'
          : n % 2
            ? 'comma-decimals'
            : 'arabic-numerals';
      layout.blankRows = true;
      layout.extraSheet = format === 'xlsx';
      layout.repeatedHeader = true;
    }
    return {
      side,
      name: `${side}-statement.${format}`,
      format,
      layout,
      rows,
      metadata: { ...meta, closing: rows.reduce((s, r) => s + r.minor, 0) },
      invalid: null,
    };
  };
  const sources = [source('supplier', a, 0), source('ledger', b, 1)],
    keysA = a.filter((r) => r.kind === kind).map((r) => r.key),
    keysB = b.filter((r) => r.kind === kind).map((r) => r.key);
  const candidate = {
    aKeys: keysA,
    bKeys: keysB,
    rule: invoice
      ? 'explicit-invoice-purchase-order-lines'
      : 'explicit-bank-or-receipt-payment-components',
  };
  const shell = { sources },
    assessment = classifyVisibleGroup(shell, candidate);
  const clear = [
    'payment-bank-1n',
    'payment-bank-n1',
    'payment-receipt-1n',
    'invoice-po-1n',
    'invoice-po-n1',
  ].includes(scenario);
  if (clear && assessment.classification !== 'required')
    throw Error(
      `Fixture construction contradicts explicit evidence: ${descriptor.id} ${assessment.reason}`,
    );
  const permits = clear
    ? [
        {
          ...candidate,
          required: true,
          businessTask: invoice ? 'document-lines' : 'payment-matching',
        },
      ]
    : [];
  if (scenario === 'competing-bank-use')
    permits.push({
      aKeys: [a.at(-1).key],
      bKeys: [b.at(-1).key],
      rule: 'separate-unrelated-invoice',
      required: true,
    });
  const all = [...a, ...b],
    covered = new Set(permits.flatMap((p) => [...p.aKeys, ...p.bKeys])),
    sum = (rows) => rows.reduce((s, r) => s + r.minor, 0);
  const scopeStop = ['currency-conflict', 'mixed-amount-basis'].includes(
    scenario,
  );
  return {
    ...base,
    id: descriptor.id,
    category: clear ? 'clear-groups' : 'group-counterexamples',
    split: descriptor.split,
    scenario,
    foundation: null,
    repro: {
      generatorVersion: GENERATOR_VERSION,
      focusedVersion: FOCUSED_VERSION,
      descriptor,
    },
    novelty: batchB
      ? 'new-reserved-combination'
      : holdout
        ? 'opened-holdout-now-regression'
        : 'new-development',
    economicFingerprint: createHash('sha256')
      .update(JSON.stringify({ a, b, scenario }))
      .digest('hex'),
    sources,
    oracle: {
      rows: all,
      activeRows: all,
      permittedAutoMatches: permits,
      groupAssessments: [
        {
          ...assessment,
          classification: clear
            ? 'required'
            : assessment.classification === 'required'
              ? 'review'
              : assessment.classification,
          reason: clear ? assessment.reason : scenario,
        },
      ],
      economicLinks: [
        {
          eventId: `economic-hidden-${descriptor.id}`,
          aKeys: keysA,
          bKeys: keysB,
        },
      ],
      expectedExceptions: all
        .filter((r) => !covered.has(r.key))
        .map((r) => ({ key: r.key, code: scenario })),
      expectedExclusions: [],
      unreadableKeys: scopeStop ? b.map((r) => r.key) : [],
      requiresFormatReview: [],
      expectedRowErrors: [],
      expectedBalanceValidationFailure: false,
      manualAnchor: null,
      invalid: null,
      requiresScopeStop: scopeStop,
      outcome: scopeStop ? 'review' : 'compare',
      balances: {
        openingA: 0,
        openingB: 0,
        closingA: sum(a),
        closingB: sum(b),
        computedClosingA: sum(a),
        computedClosingB: sum(b),
        difference: sum(a) - sum(b),
        rawMovementA: sum(a),
        rawMovementB: sum(b),
        cutoffMovementA: sum(a),
        cutoffMovementB: sum(b),
        comparable: !scopeStop,
      },
    },
  };
}
