import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  verifyAcceptanceExport,
  caseAccepted,
} from '../scripts/acceptance-verify-047.mjs';

// The interface round is only worth its name if it fails on the defects it used
// to miss. These build a workbook in the export's own shape, damage one thing at
// a time, and require the verifier to catch it. Nothing here touches production
// code: the damage is applied to bytes, not to the engine.
const columns = 'ABCDEFGHIJKLMNOPQRSTUVWX'.split('');
const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sheetXml = (rows: (string | number)[][]) =>
  `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
    .map(
      (row, i) =>
        `<row r="${i + 1}">${row
          .map((value, c) =>
            typeof value === 'number'
              ? `<c r="${columns[c]}${i + 1}"><v>${value}</v></c>`
              : `<c r="${columns[c]}${i + 1}" t="inlineStr"><is><t>${escape(String(value))}</t></is></c>`,
          )
          .join('')}</row>`,
    )
    .join('')}</sheetData></worksheet>`;

type Row = { reference: string; date: string; minor: number };
const txRows = (rows: Row[]) => [
  [
    'المعرف',
    'الورقة',
    'صف المصدر',
    'التاريخ',
    'المرجع الأصلي',
    'المرجع الموحد',
    'الوصف',
    'المبلغ الموحد',
  ],
  ...rows.map((r, i) => [
    `id-${i}`,
    'Sheet1',
    i + 2,
    r.date,
    r.reference,
    r.reference,
    'line',
    r.minor / 100,
  ]),
];
const matchRows = (links: [string, string][]) => [
  [
    'Case ID',
    'Match Type',
    'Supplier Date',
    'Supplier References',
    'Supplier Amount',
    'Ledger Date',
    'Ledger References',
    'Ledger Amount',
  ],
  ...links.map(([supplier, ledger], i) => [
    `C${i + 1}`,
    '1:1',
    '2026-07-01',
    supplier,
    0,
    '2026-07-01',
    ledger,
    0,
  ]),
];
const reviewRows = (refs: string[]) => [
  [
    'Case ID',
    'Classification',
    'Supplier Members',
    'Ledger Members',
    'Supplier Total',
    'Ledger Total',
    'Variance',
  ],
  ...refs.map((r, i) => [`R${i + 1}`, 'AMOUNT_VARIANCE', r, r, 0, 0, 0]),
];
const unmatchedRows = (items: { side: string; reference: string }[]) => [
  [
    'Case ID',
    'Side',
    'Date',
    'Document Type',
    'Reference',
    'PO / Voucher / Bank Ref',
    'Description',
    'Amount',
    'Reason',
  ],
  ...items.map((u, i) => [
    `U${i + 1}`,
    u.side,
    '2026-07-01',
    'Invoice',
    u.reference,
    '',
    '',
    0,
    'no counterpart',
  ]),
];

async function workbook(sheets: Record<string, (string | number)[][]>) {
  const names = Object.keys(sheets);
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
      .map(
        (n, i) =>
          `<sheet name="${escape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join('')}</sheets></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('')}</Relationships>`,
  );
  zip.file(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>`,
  );
  for (const [i, name] of names.entries())
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheets[name]));
  return zip.generateAsync({ type: 'uint8array' });
}

const supplier: Row[] = [
  { reference: 'INV-1', date: '2026-07-03', minor: 125000 },
  { reference: 'INV-2', date: '2026-07-09', minor: -48000 },
  { reference: 'INV-3', date: '2026-07-14', minor: 96500 },
];
const ledger = supplier.map((r) => ({ ...r }));
const expected = {
  supplierRows: supplier,
  ledgerRows: ledger,
  requiredLinks: supplier.map((r) => [[r.reference], [r.reference]]),
  forbiddenLinks: [],
  unmatched: [],
};
const sound = (): Record<string, (string | number)[][]> => ({
  Matches: matchRows(
    supplier.map((r) => [r.reference, r.reference]) as [string, string][],
  ),
  'Needs Review': reviewRows([]),
  Unmatched: unmatchedRows([]),
  'Supplier transactions': txRows(supplier),
  'Ledger transactions': txRows(ledger),
});

test('047 a sound export passes the round', async () => {
  const result = await verifyAcceptanceExport(
    await workbook(sound()),
    expected,
  );
  assert.deepEqual(result.problems, []);
  assert.equal(result.verified, true);
  assert.equal(result.acceptedLinks, 3);
  assert.match(result.reader, /no ExcelJS/);
});

test('047 swapping two links fails even though the count is unchanged', async () => {
  const sheets = sound();
  sheets['Matches'] = matchRows([
    ['INV-1', 'INV-2'],
    ['INV-2', 'INV-1'],
    ['INV-3', 'INV-3'],
  ]);
  const result = await verifyAcceptanceExport(await workbook(sheets), expected);
  assert.equal(result.verified, false);
  assert.equal(
    result.acceptedLinks,
    3,
    'the count alone would still look right',
  );
  assert.equal(
    result.problems.filter((p: string) => /required link missing/.test(p))
      .length,
    2,
  );
});

test('047 a link the case forbids is caught', async () => {
  const withForbidden = {
    ...expected,
    requiredLinks: expected.requiredLinks.slice(0, 2),
    forbiddenLinks: [[['INV-3'], ['INV-3']]],
    needsReview: ['INV-3'],
  };
  const sheets = sound();
  sheets['Needs Review'] = reviewRows(['INV-3']);
  const result = await verifyAcceptanceExport(
    await workbook(sheets),
    withForbidden,
  );
  assert.equal(result.verified, false);
  assert.ok(
    result.problems.some((p: string) => /forbidden link accepted/.test(p)),
  );
});

test('047 a dropped row on either side is caught', async () => {
  for (const side of ['Supplier transactions', 'Ledger transactions']) {
    const sheets = sound();
    sheets[side] = txRows(supplier.slice(0, 2));
    const result = await verifyAcceptanceExport(
      await workbook(sheets),
      expected,
    );
    assert.equal(result.verified, false, side);
    assert.ok(
      result.problems.some((p: string) => p.startsWith(`${side}: 2 rows`)),
      side,
    );
  }
});

test('047 a changed amount is caught, and a blank one cannot slip through', async () => {
  const changed = sound();
  changed['Supplier transactions'] = txRows([
    { ...supplier[0], minor: supplier[0].minor + 100 },
    ...supplier.slice(1),
  ]);
  const shifted = await verifyAcceptanceExport(
    await workbook(changed),
    expected,
  );
  assert.equal(shifted.verified, false);
  assert.ok(shifted.problems.some((p: string) => /row 1 amount/.test(p)));

  // An amount that is not a number used to survive. The old check did
  // Number(cell) and compared with a tolerance; Number('—') is NaN and every
  // comparison against NaN is false, so the row passed as if it agreed.
  assert.equal(Number.isNaN(Number('—')), true);
  assert.equal(
    Math.abs(Number('—') - 1250) > 1e-9,
    false,
    'the old check let NaN pass',
  );
  for (const damaged of ['—', '', 'n/a']) {
    const broken = sound();
    const rows = txRows(supplier);
    rows[1][7] = damaged;
    broken['Supplier transactions'] = rows;
    const bytes = await workbook(broken);
    await assert.rejects(
      () => verifyAcceptanceExport(bytes, expected),
      /Invalid decimal in output/,
      `amount ${JSON.stringify(damaged)} must not pass`,
    );
  }
});

test('047 an item that must stay for review or unmatched is checked', async () => {
  const sheets = sound();
  const wantsOpen = {
    ...expected,
    requiredLinks: expected.requiredLinks.slice(0, 2),
    unmatched: [{ side: 'المورد', reference: 'INV-3' }],
  };
  const result = await verifyAcceptanceExport(
    await workbook(sheets),
    wantsOpen,
  );
  assert.equal(result.verified, false);
  assert.ok(
    result.problems.some((p: string) => /INV-3 to stay unmatched/.test(p)),
  );
});

// The round's own pass rule. Before this cycle it recorded the expected match
// count without comparing it, and treated a missing export check as success.
test('047 an unchecked export is not an accounting pass', () => {
  const entry = {
    expect: 'completed' as const,
    expected: {
      requiredLinks: [
        [['A'], ['A']],
        [['B'], ['B']],
      ],
    },
  };
  const completed = (verification: unknown, matched = 2) => ({
    outcome: 'completed-without-correction',
    matched,
    verification,
  });
  assert.equal(caseAccepted(entry, completed({ status: 'verified' })), true);
  for (const status of ['not-declared', 'mismatch', 'verifier-error'])
    assert.equal(
      caseAccepted(entry, completed({ status })),
      false,
      `${status} must not pass`,
    );
  assert.equal(
    caseAccepted(entry, completed(undefined)),
    false,
    'no check at all',
  );
});

test('047 a link count that disagrees with the declared links is not a pass', () => {
  const entry = {
    expect: 'completed' as const,
    expected: {
      requiredLinks: [
        [['A'], ['A']],
        [['B'], ['B']],
      ],
    },
  };
  // The export can verify while the screen reports a different number of
  // accepted links; both have to agree.
  assert.equal(
    caseAccepted(entry, {
      outcome: 'completed-without-correction',
      matched: 3,
      verification: { status: 'verified' },
    }),
    false,
  );
});

test('047 reaching the results screen is not the criterion for a stop case', () => {
  const entry = {
    expect: 'blocked-unreadable' as const,
    expectReason: /تعذر التحقق من صيغة/,
  };
  assert.equal(
    caseAccepted(entry, {
      outcome: 'correct-stop',
      reason: 'تعذر التحقق من صيغة التواريخ',
    }),
    true,
  );
  // A stop for a different reason is not the stop the case was written for.
  assert.equal(
    caseAccepted(entry, {
      outcome: 'correct-stop',
      reason: 'حدد عملة الملفين',
    }),
    false,
  );
  assert.equal(
    caseAccepted(entry, {
      outcome: 'completed-without-correction',
      verification: { status: 'verified' },
    }),
    false,
  );
});
