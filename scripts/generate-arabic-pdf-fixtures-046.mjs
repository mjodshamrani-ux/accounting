// Small hand-audited import fixtures, separate from the existing seeded corpus.
import { mkdir, writeFile } from 'node:fs/promises';
import { renderArabicStatement } from '../tests/helpers/arabic-pdf-fixture-046.mjs';
const dir = new URL('../tests/fixtures/pdf-arabic-046/', import.meta.url);
await mkdir(dir, { recursive: true });
const rows = [
  {
    date: '٢٠٢٦-٠٧-٠١',
    reference: 'INV-00123',
    amount: '١٬٢٣٤٫٥٠',
    description: 'شراء مواد',
  },
  {
    date: '2026-07-02',
    reference: 'CN-00042',
    amount: '(٢٥٠٫٧٥)',
    description: 'إشعار دائن',
  },
  {
    date: '۲۰۲۶-۰۷-۰۳',
    reference: 'INV-0000009',
    amount: '−٩٨٫٠٥',
    description: 'تسوية مبلغ',
  },
];
const expected = [
  ['2026-07-01', 'INV-00123', 123450],
  ['2026-07-02', 'CN-00042', -25075],
  ['2026-07-03', 'INV-0000009', -9805],
];
const fixtures = [
  {
    id: 'reportlab-arabic-balances',
    producer: 'reportlab',
    pages: [
      {
        rows: [
          ['العملة', 'SAR', '', ''],
          ['Period: 2026-07-01 to 2026-07-31', '', '', ''],
          ['الوصف', 'المبلغ', 'رقم الفاتورة', 'التاريخ'],
          ['الرصيد الافتتاحي', '٠٫٠٠', '', ''],
          ...rows.map((r) => [r.description, r.amount, r.reference, r.date]),
          ['الرصيد الختامي', '٨٨٥٫٧٠', '', ''],
        ],
      },
    ],
    expected,
    expectedBalances: {
      opening: 0,
      closing: 88570,
      currency: 'SAR',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
    },
  },
  {
    id: 'reportlab-rtl',
    producer: 'reportlab',
    language: 'ar',
    rows,
    expected,
  },
  {
    id: 'reportlab-permuted',
    producer: 'reportlab',
    language: 'ar',
    columns: ['reference', 'date', 'description', 'amount'],
    rows,
    expected,
  },
  {
    id: 'reportlab-wrapped-header',
    producer: 'reportlab',
    pages: [
      {
        rows: [
          ['الوصف', 'المبلغ', 'رقم\nالفاتورة', 'التاريخ'],
          ...rows.map((r) => [r.description, r.amount, r.reference, r.date]),
        ],
      },
    ],
    expected,
  },
  {
    id: 'reportlab-multipage',
    producer: 'reportlab',
    pages: [
      {
        rows: [
          ['Description', 'Amount', 'Reference', 'Date'],
          ...rows.map((r) => [r.description, r.amount, r.reference, r.date]),
          ['', '', '', 'Page 1'],
        ],
      },
      {
        rows: [
          ['Description', 'Amount', 'Reference', 'Date'],
          ...rows.map((r) => [
            r.description,
            r.amount,
            r.reference + '-B',
            r.date,
          ]),
          ['', '', '', 'Page 2'],
        ],
      },
    ],
    expected: [...expected, ...expected.map((r) => [r[0], r[1] + '-B', r[2]])],
  },
  {
    id: 'libreoffice-arabic',
    producer: 'libreoffice',
    rows: rows.map((r) => ({
      ...r,
      date: r.date.replace(/[٠-٩۰-۹]/g, (c) =>
        String(c.charCodeAt(0) - (c >= '۰' ? 0x6f0 : 0x660)),
      ),
    })),
    expected,
  },
  {
    id: 'libreoffice-mixed',
    producer: 'libreoffice',
    language: 'mixed',
    columns: ['date', 'reference', 'amount', 'description'],
    rows: rows.map((r) => ({
      ...r,
      date: r.date.replace(/[٠-٩۰-۹]/g, (c) =>
        String(c.charCodeAt(0) - (c >= '۰' ? 0x6f0 : 0x660)),
      ),
      description: 'مواد ' + r.reference,
    })),
    expected,
  },
  {
    id: 'reportlab-wrapped-reference',
    producer: 'reportlab',
    pages: [
      {
        rows: [
          ['الوصف', 'المبلغ', 'رقم الفاتورة', 'التاريخ'],
          ['شراء مواد', '100.00', 'INV-\n00123', '2026-07-01'],
          ['شراء مواد', '200.00', 'INV-234', '2026-07-02'],
        ],
      },
    ],
    expected: null,
    reason: 'wrapped-reference-review',
  },
  {
    id: 'reportlab-mixed-image',
    producer: 'reportlab',
    pages: [
      {
        rows: [
          ['الوصف', 'المبلغ', 'رقم الفاتورة', 'التاريخ'],
          ...rows.map((r) => [r.description, r.amount, r.reference, r.date]),
        ],
      },
      { raster: true },
    ],
    expected: null,
    reason: 'image-page-blocked',
  },
  {
    id: 'reportlab-second-table',
    producer: 'reportlab',
    pages: [
      {
        rows: [
          ['الوصف', 'المبلغ', 'رقم الفاتورة', 'التاريخ'],
          ...rows.map((r) => [r.description, r.amount, r.reference, r.date]),
          ['', 'Account: OTHER', '', ''],
          ['الوصف', 'المبلغ', 'رقم الفاتورة', 'التاريخ'],
          ...rows.map((r) => [
            r.description,
            r.amount,
            r.reference + '-ALT',
            r.date,
          ]),
        ],
      },
    ],
    expected: null,
    reason: 'different-account-review',
  },
];
for (const fixture of fixtures) {
  const bytes = await renderArabicStatement(fixture);
  await writeFile(new URL(fixture.id + '.pdf', dir), bytes);
  console.log(fixture.id, bytes.length);
}
await writeFile(
  new URL('manifest.json', dir),
  JSON.stringify(
    {
      schemaVersion: 1,
      producerVersions: {
        reportlab: '4.4.9',
        uharfbuzz: '0.56.1',
        libreoffice: '26.8.0.0.alpha0 2c87e51eeaa2b413ff4ae097b2705eea1995d8e5',
      },
      fixtures,
    },
    null,
    2,
  ) + '\n',
);
