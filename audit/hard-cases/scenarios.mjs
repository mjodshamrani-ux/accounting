// Hard-case scenarios for the supplier reconciliation path. Each scenario is
// built from accounting facts the generator decides itself: row keys, integer
// minor amounts, and which rows belong together. The expected outcome is set
// here, before any engine runs, and never from engine functions. Nothing that
// reveals the answer (hidden ids, the expected outcome, the variant name) is
// written into a rendered file; files carry only the columns an accountant's
// report would show.
export const HARD_CASES_VERSION = 'tarasuf-hard-cases-1.0.1';

function rng(seed) {
  let state = seed >>> 0 || 1;
  return (min, max) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return min + (state % (max - min + 1));
  };
}
const pad = (n, w) => String(n).padStart(w, '0');
const day = (d) => `2026-07-${pad(d, 2)}`;

/** Expected outcome classes, fixed before measurement. */
export const OUTCOMES = {
  auto: 'automatic approval is justified by the evidence in the files',
  review:
    'the files do not justify approval; a reviewer or more evidence is needed',
  external:
    'a fact outside the files is needed (an accountant choice or confirmation)',
  difference: 'a real difference exists and must stay visible',
  invalid:
    'the input is not readable as stated; the engine must stop or mark it',
  unsupported: 'the relation has no product path; no approval may appear',
};

/** Families and the variants each can take. The last element of each list is
 * the variant the product should resolve automatically, when one exists. */
export const TEMPLATES = {
  // ---- grouping (G)
  'G01-payment-1n': ['identity', 'missing-identity', 'conflicting-identity'],
  'G02-payment-n1': ['identity', 'missing-identity', 'conflicting-identity'],
  'G03-payment-nm': ['identity'],
  'G04-sum-no-identity': ['plain'],
  'G05-competing-sums': ['plain'],
  'G06-missing-part': ['identity'],
  'G07-extra-member': ['identity'],
  'G08-two-dates': ['identity', 'missing-identity', 'outside-window'],
  'G09-equal-parts': ['distinct-entries', 'duplicate-line'],
  'G10-excluded-member': ['identity'],
  'G11-invoice-lines': ['shared-po', 'no-po', 'conflicting-po'],
  // ---- references (R)
  'R01-voucher-and-reference': ['voucher-differs'],
  'R02-batch-kept': ['batch'],
  'R03-reference-types': ['same-invoice', 'po-only'],
  'R04-leading-zeros': ['zeros'],
  'R05-long-numeric': ['text'],
  'R06-lookalike': ['dash', 'case'],
  'R07-reference-in-text': ['description-only'],
  'R10-placeholders': ['na'],
  // ---- document types (T)
  'T01-type-synonyms': [
    'tax-invoice',
    'arabic-tax-invoice',
    'ap-invoice',
    'vendor-invoice',
  ],
  'T05-unknown-code': ['tx-code'],
  'T06-type-conflict': ['payment-labelled-invoice'],
  'T08-description-only': ['bank-transfer'],
  // ---- numbers and dates (N)
  'N01-arabic-digits': ['arabic'],
  'N02-ambiguous-number': ['withheld', 'answered'],
  'N04-parentheses': ['parenthesized'],
  'N05-precision': ['zero-places', 'three-places'],
  'N07-ambiguous-date': ['withheld', 'answered'],
  'N08-invalid-date': ['feb-30'],
  // ---- file layout (F)
  'F01-column-order': ['permuted'],
  'F03-structure-rows': ['repeated-headers'],
  'F06-extra-sheet': ['summary-sheet'],
  'F07-delimiters': ['semicolon', 'quoted-commas'],
  'F09-missing-amount': ['no-amount-column'],
  'F10-corrupt': ['corrupt'],
  // ---- compound
  'C01-group-with-type-synonym': ['tax-invoice-po'],
  'C02-two-dates-repeated-headers': ['identity'],
  'C03-voucher-with-group': ['identity'],
};

// Background rows keep every scenario honest: they must be matched in every
// variant that reaches a comparison, so refusing everything cannot pass.
function controls(n, random) {
  return [0, 1].map((i) => {
    const minor = random(1000, 900000);
    return {
      reference: `INV-${7000 + n * 3 + i}`,
      date: day(3 + i),
      minor,
      kind: 'Invoice',
      description: 'Goods supplied',
    };
  });
}
/** Unrelated rows on one side only: they add noise and must stay unmatched. */
function noise(n, random, count) {
  return Array.from({ length: count }, (_, i) => ({
    reference: `INV-N${8000 + n * 7 + i}`,
    date: day(random(5, 25)),
    minor: random(500, 400000),
    kind: 'Invoice',
    description: 'Services',
  }));
}

/**
 * One scenario. `approved` lists the groups that must be matched automatically
 * ({a: keys, b: keys}); `expect` is the class for the rows under test.
 */
export function buildHardCase(d) {
  const random = rng(d.seed);
  const n = d.index;
  const [family] = d.template.split('-');
  const bank = `BNK-${400000 + n}`;
  const pay = `PAY-${500000 + n}`;
  const po = `PO-${60000 + n}`;
  let decimals = 2,
    currency = 'SAR';
  const a = [],
    b = [];
  const approved = [];
  let expect = 'auto';
  let externalNeed = null;
  let withholdFormat = false;
  let invalid = [null, null];
  const extraFields = new Set();
  let referenceHeader = 'Reference';
  let dateFormat = 'ymd';
  const payment = (minor, date, extra = {}) => ({
    reference: pay,
    date,
    minor: -minor,
    kind: 'Payment',
    description: 'Bank transfer',
    bankReference: bank,
    ...extra,
  });
  const parts = (total, count) => {
    const values = [];
    let left = total;
    for (let i = 0; i < count - 1; i++) {
      const v = Math.floor(left / (count - i)) + random(-50, 50) * 100;
      values.push(v);
      left -= v;
    }
    values.push(left);
    // Parts that repeat the same amount, date and identity cannot be told
    // apart from a duplicated entry in the file, so a scenario that claims
    // proven parts never generates them (1.0.1: this happened by chance in
    // 1.0.0 and wrongly expected approval).
    if (new Set(values).size !== values.length || values.some((v) => v <= 0))
      return parts(total, count);
    return values;
  };
  const total = random(3000, 90000) * 100;
  const put = (side, rows, tag) =>
    rows.map((r) => {
      const list = side === 'a' ? a : b;
      const row = { ...r, key: `${side}:${list.length + 1}`, tag };
      list.push(row);
      return row.key;
    });
  const group = (aKeys, bKeys) => approved.push({ a: aKeys, b: bKeys });

  switch (d.template) {
    case 'G01-payment-1n':
    case 'G02-payment-n1':
    case 'C02-two-dates-repeated-headers': {
      extraFields.add('bankReference');
      const values = parts(total, 3);
      const single = [payment(total, day(15))];
      const twoDates = d.template.startsWith('C02');
      let many = values.map((v, i) =>
        payment(v, twoDates ? day(15 + (i === 2 ? 1 : 0)) : day(15)),
      );
      if (d.variant === 'missing-identity')
        many = many.map((r) => ({ ...r, bankReference: '' }));
      if (d.variant === 'conflicting-identity')
        many[1] = { ...many[1], bankReference: `BNK-X${n}` };
      const reverse = d.template.startsWith('G02');
      const ka = put('a', reverse ? many : single, 'group');
      const kb = put('b', reverse ? single : many, 'group');
      if (d.variant === 'identity') group(ka, kb);
      else expect = 'review';
      break;
    }
    case 'G03-payment-nm': {
      extraFields.add('bankReference');
      const va = parts(total, 2),
        vb = parts(total, 3);
      put(
        'a',
        va.map((v) => payment(v, day(15))),
        'group',
      );
      put(
        'b',
        vb.map((v) => payment(v, day(15))),
        'group',
      );
      expect = 'unsupported';
      break;
    }
    case 'G04-sum-no-identity': {
      extraFields.add('bankReference');
      const [x, y] = parts(total, 2);
      put('a', [payment(total, day(15), { bankReference: '' })], 'group');
      put(
        'b',
        [
          payment(x, day(15), { reference: `PV-${n}-1`, bankReference: '' }),
          payment(y, day(15), { reference: `PV-${n}-2`, bankReference: '' }),
        ],
        'group',
      );
      expect = 'review';
      break;
    }
    case 'G05-competing-sums': {
      extraFields.add('bankReference');
      const [x, y] = parts(total, 2),
        [u, v] = parts(total, 2);
      put('a', [payment(total, day(15), { bankReference: '' })], 'group');
      put(
        'b',
        [x, y, u, v].map((m, i) =>
          payment(m, day(15), {
            reference: `PV-${n}-${i + 1}`,
            bankReference: '',
          }),
        ),
        'group',
      );
      expect = 'review';
      break;
    }
    case 'G06-missing-part': {
      extraFields.add('bankReference');
      const values = parts(total, 3);
      put('a', [payment(total, day(15))], 'group');
      put(
        'b',
        values.slice(0, 2).map((v) => payment(v, day(15))),
        'group',
      );
      expect = 'difference';
      break;
    }
    case 'G07-extra-member': {
      extraFields.add('bankReference');
      const values = parts(total, 3);
      put('a', [payment(total, day(15))], 'group');
      put(
        'b',
        [...values, random(10, 90) * 100].map((v) => payment(v, day(15))),
        'group',
      );
      expect = 'difference';
      break;
    }
    case 'G08-two-dates': {
      extraFields.add('bankReference');
      const values = parts(total, 3);
      const spread = d.variant === 'outside-window' ? 5 : 1;
      let many = values.map((v, i) =>
        payment(v, day(14 + (i === 2 ? spread : 0))),
      );
      if (d.variant === 'missing-identity')
        many = many.map((r) => ({ ...r, bankReference: '' }));
      const ka = put('a', [payment(total, day(14))], 'group');
      const kb = put('b', many, 'group');
      if (d.variant === 'identity') group(ka, kb);
      else expect = 'review';
      break;
    }
    case 'G09-equal-parts': {
      extraFields.add('bankReference');
      extraFields.add('voucherReference');
      const half = random(10, 900) * 100;
      const many = [half, half, total].map((v, i) =>
        payment(v, day(15), {
          voucherReference:
            d.variant === 'duplicate-line' && i < 2
              ? `JV-${n}-1`
              : `JV-${n}-${i + 1}`,
        }),
      );
      const ka = put(
        'a',
        [payment(half * 2 + total, day(15), { voucherReference: `SV-${n}` })],
        'group',
      );
      const kb = put('b', many, 'group');
      if (d.variant === 'distinct-entries') group(ka, kb);
      else expect = 'review';
      break;
    }
    case 'G10-excluded-member': {
      extraFields.add('bankReference');
      const values = parts(total, 3);
      put('a', [payment(total, day(15))], 'group');
      put(
        'b',
        values.map((v, i) => payment(v, i === 2 ? '2026-08-02' : day(15))),
        'group',
      );
      expect = 'review';
      break;
    }
    case 'G11-invoice-lines':
    case 'C01-group-with-type-synonym': {
      extraFields.add('poReference');
      const values = parts(total, 3);
      const label = d.template.startsWith('C01') ? 'Tax Invoice' : 'Invoice';
      const line = (minor, i) => ({
        reference: `INV-${90000 + n}`,
        date: day(12),
        minor,
        kind: label,
        description: 'Goods supplied',
        poReference:
          d.variant === 'no-po'
            ? ''
            : d.variant === 'conflicting-po' && i === 1
              ? `PO-X${n}`
              : po,
      });
      const ka = put('a', [line(total, 0)], 'group');
      const kb = put('b', values.map(line), 'group');
      if (['shared-po', 'tax-invoice-po'].includes(d.variant)) group(ka, kb);
      else expect = 'review';
      break;
    }
    case 'R01-voucher-and-reference':
    case 'C03-voucher-with-group': {
      extraFields.add('voucherReference');
      const inv = (side, minor) => ({
        reference: `INV-${30000 + n}`,
        date: day(9),
        minor,
        kind: 'Invoice',
        description: 'Goods supplied',
        // Each book numbers its own journal vouchers.
        voucherReference: `${side === 'a' ? 'SJ' : 'JV'}-${n}-${random(100, 999)}`,
      });
      const m = random(1000, 900000);
      group(
        put('a', [inv('a', m)], 'target'),
        put('b', [inv('b', m)], 'target'),
      );
      break;
    }
    case 'R02-batch-kept': {
      extraFields.add('batch');
      const m = random(1000, 900000);
      const row = {
        reference: `INV-${31000 + n}`,
        date: day(9),
        minor: m,
        kind: 'Invoice',
        description: 'Goods supplied',
        batch: `B-${n}`,
      };
      group(put('a', [row], 'target'), put('b', [row], 'target'));
      break;
    }
    case 'R03-reference-types': {
      extraFields.add('poReference');
      extraFields.add('voucherReference');
      referenceHeader = 'Invoice No';
      const m = random(1000, 900000);
      const row = (side) => ({
        reference:
          d.variant === 'po-only'
            ? `INV-${32000 + n}${side}`
            : `INV-${32000 + n}`,
        date: day(9),
        minor: m,
        kind: 'Invoice',
        description: 'Goods supplied',
        poReference: po,
        voucherReference: `${side === 'a' ? 'SJ' : 'JV'}-${n}`,
      });
      const ka = put('a', [row('A')], 'target'),
        kb = put('b', [row('B')], 'target');
      if (d.variant === 'same-invoice') group(ka, kb);
      else expect = 'review';
      break;
    }
    case 'R04-leading-zeros': {
      const m = random(1000, 900000);
      put(
        'a',
        [
          {
            reference: `000${1000 + n}`,
            date: day(9),
            minor: m,
            kind: 'Invoice',
            description: 'Goods supplied',
          },
        ],
        'target',
      );
      put(
        'b',
        [
          {
            reference: `${1000 + n}`,
            date: day(9),
            minor: m,
            kind: 'Invoice',
            description: 'Goods supplied',
          },
        ],
        'target',
      );
      expect = 'review';
      break;
    }
    case 'R05-long-numeric': {
      referenceHeader = 'Invoice No';
      const m = random(1000, 900000);
      const ref = `${pad(n, 6)}${pad(random(0, 99999999), 8)}${pad(random(0, 999999), 6)}`;
      const row = {
        reference: ref,
        date: day(9),
        minor: m,
        kind: 'Invoice',
        description: 'Goods supplied',
      };
      group(put('a', [row], 'target'), put('b', [row], 'target'));
      break;
    }
    case 'R06-lookalike': {
      const m = random(1000, 900000);
      const [ra, rb] =
        d.variant === 'dash'
          ? [`INV-${n}01`, `INV${n}01`]
          : [`Inv-${n}01`, `INV-${n}01`];
      put(
        'a',
        [
          {
            reference: ra,
            date: day(9),
            minor: m,
            kind: 'Invoice',
            description: 'Goods supplied',
          },
        ],
        'target',
      );
      put(
        'b',
        [
          {
            reference: rb,
            date: day(9),
            minor: m,
            kind: 'Invoice',
            description: 'Goods supplied',
          },
        ],
        'target',
      );
      expect = 'review';
      break;
    }
    case 'R07-reference-in-text': {
      const m = random(1000, 900000);
      put(
        'a',
        [
          {
            reference: `INV-${33000 + n}`,
            date: day(9),
            minor: m,
            kind: 'Invoice',
            description: 'Goods supplied',
          },
        ],
        'target',
      );
      put(
        'b',
        [
          {
            reference: '',
            date: day(9),
            minor: m,
            kind: 'Invoice',
            description: `Settles INV-${33000 + n} order 55${n} tel 0500000${pad(n % 1000, 3)}`,
          },
        ],
        'target',
      );
      expect = 'review';
      break;
    }
    case 'R10-placeholders': {
      const m = random(1000, 900000);
      const row = (side, i) => ({
        reference: 'N/A',
        date: day(9 + i),
        minor: m,
        kind: 'Invoice',
        description: 'Goods supplied',
      });
      put('a', [row('a', 0), row('a', 1)], 'target');
      put('b', [row('b', 0), row('b', 1)], 'target');
      expect = 'review';
      break;
    }
    case 'T01-type-synonyms': {
      const label = {
        'tax-invoice': 'Tax Invoice',
        'arabic-tax-invoice': 'فاتورة ضريبية',
        'ap-invoice': 'AP Invoice',
        'vendor-invoice': 'Vendor Invoice',
      }[d.variant];
      const m = random(1000, 900000);
      const row = {
        reference: `INV-${34000 + n}`,
        date: day(9),
        minor: m,
        kind: label,
        description: 'Goods supplied',
      };
      group(put('a', [row], 'target'), put('b', [row], 'target'));
      break;
    }
    case 'T05-unknown-code': {
      const m = random(1000, 900000);
      const row = {
        reference: `INV-${35000 + n}`,
        date: day(9),
        minor: m,
        kind: 'TX-07',
        description: 'Goods supplied',
      };
      put('a', [row], 'target');
      put('b', [row], 'target');
      expect = 'review';
      break;
    }
    case 'T06-type-conflict': {
      const m = random(1000, 900000);
      put(
        'a',
        [
          {
            reference: `DOC-${36000 + n}`,
            date: day(9),
            minor: m,
            kind: 'Invoice',
            description: 'Goods supplied',
          },
        ],
        'target',
      );
      put(
        'b',
        [
          {
            reference: `DOC-${36000 + n}`,
            date: day(9),
            minor: m,
            kind: 'Payment',
            description: 'Invoice for goods supplied',
          },
        ],
        'target',
      );
      expect = 'review';
      break;
    }
    case 'T08-description-only': {
      const m = random(1000, 900000);
      put(
        'a',
        [
          {
            reference: `PAY-${37000 + n}`,
            date: day(20),
            minor: -m,
            kind: 'Payment',
            description: 'Bank transfer',
          },
        ],
        'target',
      );
      put(
        'b',
        [
          {
            reference: `PV-${37000 + n}`,
            date: day(21),
            minor: -m,
            kind: 'Payment',
            description: 'Bank transfer',
          },
        ],
        'target',
      );
      expect = 'review';
      break;
    }
    case 'N02-ambiguous-number':
    case 'N05-precision': {
      decimals =
        d.template.startsWith('N02') || d.variant === 'three-places' ? 3 : 0;
      currency = decimals === 3 ? 'KWD' : 'JPY';
      if (d.template.startsWith('N02') && d.variant === 'withheld') {
        withholdFormat = true;
        expect = 'external';
        externalNeed = 'number format (the accountant must choose)';
      }
      break;
    }
    case 'N07-ambiguous-date': {
      dateFormat = 'dmy';
      if (d.variant === 'withheld') {
        withholdFormat = true;
        expect = 'external';
        externalNeed = 'date format (the accountant must choose)';
      }
      break;
    }
    case 'N08-invalid-date': {
      const m = random(1000, 900000);
      put(
        'a',
        [
          {
            reference: `INV-${38000 + n}`,
            date: '2026-02-30',
            minor: m,
            kind: 'Invoice',
            description: 'Goods supplied',
          },
        ],
        'target',
      );
      put(
        'b',
        [
          {
            reference: `INV-${38000 + n}`,
            date: day(9),
            minor: m,
            kind: 'Invoice',
            description: 'Goods supplied',
          },
        ],
        'target',
      );
      expect = 'invalid';
      break;
    }
    case 'F09-missing-amount-column':
    case 'F09-missing-amount':
      invalid = [null, 'missing-amount-column'];
      expect = 'invalid';
      break;
    case 'F10-corrupt':
      invalid = ['corrupt-file', null];
      expect = 'invalid';
      break;
    default:
      break;
  }
  if (d.template.startsWith('C03')) {
    // Voucher-numbered rows and a proven payment group in the same files.
    extraFields.add('bankReference');
    const values = parts(total, 3);
    group(
      put('a', [payment(total, day(15))], 'group'),
      put(
        'b',
        values.map((v) => payment(v, day(15))),
        'group',
      ),
    );
  }
  // Controls on both sides, noise on one side, in a scenario-specific order.
  const c = controls(n, random);
  const controlKeys = [
    put('a', [c[0]], 'control'),
    put('a', [c[1]], 'control'),
  ];
  const controlKeysB = [
    put('b', [c[1]], 'control'),
    put('b', [c[0]], 'control'),
  ];
  approved.push({ a: controlKeys[0], b: controlKeysB[1], control: true });
  approved.push({ a: controlKeys[1], b: controlKeysB[0], control: true });
  put(random(0, 1) ? 'a' : 'b', noise(n, random, random(0, 6)), 'noise');
  // Amounts and dates are adjusted as a function of the original value, so the
  // two copies of one economic row stay identical.
  for (const row of [...a, ...b]) {
    const sign = Math.sign(row.minor) || 1,
      abs = Math.abs(row.minor);
    if (decimals === 0) row.minor = sign * Math.max(1, Math.round(abs / 100));
    // Three places below 1,000.000: the dot and comma readings both parse and
    // differ, so the format is ambiguous until someone answers.
    if (decimals === 3) row.minor = sign * ((abs % 999) * 1000 + 1250);
    if (d.template.startsWith('N07'))
      row.date = `2026-07-${pad(1 + (Number(row.date.slice(8)) % 12), 2)}`;
  }
  for (const row of [...a, ...b]) {
    row.currency = currency;
    row.account = 'AP-482';
    row.description ??= 'Goods supplied';
  }
  const baseFields = [
    'date',
    'reference',
    'kind',
    'description',
    ...extraFields,
    'amount',
    'currency',
    'account',
  ];
  const meta = (rows) => ({
    supplier: 'Synthetic Supplier',
    entity: 'Synthetic Buyer',
    account: 'AP-482',
    currency,
    decimals,
    cutoff: '2026-07-31',
    periodStart: '2026-07-01',
    reportType: 'transactions',
    dateWindow: 2,
    referenceHeader,
    numberFormat: 'dot',
    dateFormat,
    multiplier: 1,
    opening: 0,
    closing: rows
      .filter((r) => r.date <= '2026-07-31' && r.date >= '2026-07-01')
      .reduce((s, r) => s + r.minor, 0),
    signEvidence: 'Positive amount increases the payable to the supplier',
    periodEvidence: 'Statement covers 2026-07-01 through 2026-07-31',
  });
  const sources = [a, b].map((rows, i) => {
    const layout = { ...d.layouts[i] };
    let fields = [...baseFields];
    if (layout.order)
      fields = layout.order
        .map((k) => fields[k % fields.length])
        .filter((f, j, all) => all.indexOf(f) === j);
    for (const f of baseFields) if (!fields.includes(f)) fields.push(f);
    if (d.template.startsWith('F01')) fields = [...fields].reverse();
    layout.fields = fields;
    if (d.template.startsWith('F03') || d.template.startsWith('C02'))
      Object.assign(layout, {
        repeatedHeader: true,
        blankRows: true,
        banner: true,
      });
    if (d.template.startsWith('F06') && layout.format === 'xlsx')
      Object.assign(layout, { extraSheet: true, writer: 'exceljs' });
    if (d.template.startsWith('F07'))
      Object.assign(
        layout,
        d.variant === 'semicolon'
          ? { format: 'csv', writer: 'csv-delimited', delimiter: ';' }
          : { format: 'csv', writer: 'csv-quoted' },
      );
    if (d.template.startsWith('F07') && d.variant === 'quoted-commas')
      for (const r of rows) r.description = 'Goods, supplied; "boxed"';
    if (d.template.startsWith('N01')) layout.style = 'arabic-numerals';
    if (d.template.startsWith('N04')) layout.style = 'parenthesized-credits';
    const format =
      invalid[i] === 'corrupt-file' ? layout.format : layout.format;
    return {
      side: i ? 'ledger' : 'supplier',
      name: `${i ? 'ledger' : 'supplier'}-statement.${format}`,
      format,
      layout,
      rows,
      metadata: meta(rows),
      invalid: invalid[i],
    };
  });
  // The generator checks its own facts: an approved group balances, and its
  // members can be told apart in the file (no repeated amount, date and
  // identity on one side).
  for (const g of approved) {
    const rows = (side, keys) => keys.map((k) => (side === 'a' ? a : b).find((r) => r.key === k));
    const total = (rs) => rs.reduce((t, r) => t + r.minor, 0);
    if (total(rows('a', g.a)) !== total(rows('b', g.b)))
      throw new Error(`${d.id}: approved group does not balance`);
    for (const side of ['a', 'b']) {
      const ids = rows(side, g[side]).map((r) => `${r.date}|${r.minor}|${r.bankReference ?? ''}|${r.voucherReference ?? ''}|${r.poReference ?? ''}`);
      if (new Set(ids).size !== ids.length) throw new Error(`${d.id}: approved group has indistinguishable members`);
    }
  }
  return {
    id: d.id,
    template: d.template,
    family,
    variant: d.variant,
    split: d.split,
    seed: d.seed,
    sources,
    oracle: {
      expect,
      externalNeed,
      withholdFormat,
      approved,
      targetKeys: [...a, ...b]
        .filter((r) => r.tag === 'group' || r.tag === 'target')
        .map((r) => r.key),
    },
  };
}

// ------------------------------------------------------------- manifests

const LAYOUTS = {
  // Development: English CSV and native XLSX.
  development: [
    [
      { format: 'csv', writer: 'csv-records', language: 'en', style: 'dot' },
      { format: 'xlsx', writer: 'exceljs', language: 'en', style: 'dot' },
    ],
    [
      { format: 'xlsx', writer: 'exceljs', language: 'en', style: 'dot' },
      { format: 'csv', writer: 'csv-records', language: 'en', style: 'dot' },
    ],
    [
      {
        format: 'csv',
        writer: 'csv-records',
        language: 'en',
        style: 'dot',
        order: [1, 0, 3, 2, 5, 4, 6, 7, 8, 9],
      },
      { format: 'csv', writer: 'csv-records', language: 'en', style: 'dot' },
    ],
  ],
  // Validation: Arabic headings, hand-written OOXML, other column orders.
  validation: [
    [
      { format: 'xlsx', writer: 'ooxml-zip', language: 'ar', style: 'dot' },
      {
        format: 'csv',
        writer: 'csv-records',
        language: 'en',
        style: 'dot',
        order: [3, 1, 0, 2, 4, 5, 6, 7, 8, 9],
      },
    ],
    [
      { format: 'csv', writer: 'csv-quoted', language: 'ar', style: 'dot' },
      { format: 'xlsx', writer: 'ooxml-zip', language: 'en', style: 'dot' },
    ],
  ],
  // Final: kept apart until the fixes are frozen; PDF and mixed layouts.
  final: [
    [
      { format: 'pdf', language: 'en', style: 'dot' },
      {
        format: 'xlsx',
        writer: 'exceljs',
        language: 'ar',
        style: 'dot',
        order: [2, 0, 1, 3, 4, 5, 6, 7, 8, 9],
      },
    ],
    [
      {
        format: 'xlsx',
        writer: 'ooxml-zip',
        language: 'en',
        style: 'dot',
        order: [4, 3, 2, 1, 0, 5, 6, 7, 8, 9],
      },
      { format: 'pdf', language: 'en', style: 'dot' },
    ],
    [
      {
        format: 'csv',
        writer: 'csv-delimited',
        delimiter: ';',
        language: 'ar',
        style: 'dot',
      },
      { format: 'xlsx', writer: 'exceljs', language: 'en', style: 'dot' },
    ],
  ],
};
// Templates whose fields a PDF can carry (the PDF writer has five fixed columns).
const PDF_SAFE = /^(T01|T05|T06|R04|R06|R10|N01|N04|N05|R05|N08)/;
// Splits separate templates and variants, not only seeds.
const SPLIT_TEMPLATES = {
  development: (t) =>
    !t.startsWith('C0') &&
    !['G09-equal-parts', 'R06-lookalike', 'N07-ambiguous-date'].includes(t),
  validation: (t) => !t.startsWith('C0'),
  final: () => true,
};

export function hardManifest(split, count, { fileRuns = false } = {}) {
  const templates = Object.entries(TEMPLATES).filter(([t]) =>
    SPLIT_TEMPLATES[split](t),
  );
  const combos = templates.flatMap(([template, variants]) =>
    variants.map((variant) => ({ template, variant })),
  );
  const layouts = LAYOUTS[split];
  const base = { development: 1, validation: 200000, final: 400000 }[split];
  const out = [];
  for (let i = 0; out.length < count; i++) {
    const combo = combos[i % combos.length];
    let pair = layouts[Math.floor(i / combos.length) % layouts.length];
    if (pair.some((l) => l.format === 'pdf') && !PDF_SAFE.test(combo.template))
      pair = layouts.find((p) => !p.some((l) => l.format === 'pdf')) ?? pair;
    out.push({
      id: `HC-${split.slice(0, 3).toUpperCase()}-${pad(i + 1, 5)}`,
      split,
      index: base + i,
      seed: (base + i) * 2654435761,
      ...combo,
      layouts: pair,
      mode: fileRuns ? 'file' : 'logical',
    });
  }
  return out;
}
