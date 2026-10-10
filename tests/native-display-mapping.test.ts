import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  defaultMapping,
  type SourceFile,
} from '../lib/reconciliation/types.ts';
import { WORKER_CHANNEL } from '../lib/reconciliation/protocol.ts';
import {
  ALLOCATION_HEADERS,
  ALLOCATION_ROLES,
  ALLOCATION_VERSION,
  reconcileAllocation,
  type AllocationInput,
} from '../lib/reconciliation/allocation.ts';

// New fictional sources. Hand-fixed truth: one 10025-unit invoice/payment,
// a +10025/-10025 clearing pair, and one 10025-unit requested allocation.
const scope = {
  entity: 'Synthetic Display Entity',
  ledger: 'Synthetic Display Ledger',
  account: '00100',
  currency: 'SAR',
  start: '2034-01-01',
  end: '2034-01-31',
  confirmed: true,
};
const mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 1,
  amount: 2,
  description: 3,
  currencyColumn: 4,
};
type Domain = 'supplier' | 'ar' | 'clearing' | 'allocation';
type Defect =
  | 'normal'
  | 'white amount'
  | 'white reference'
  | 'hidden sheet'
  | 'veryHidden sheet'
  | 'zero height'
  | 'zero width'
  | 'hidden column'
  | 'hidden auxiliary'
  | 'inverted header'
  | 'hidden row'
  | 'row hidden format'
  | 'column hidden format'
  | 'black format'
  | 'conditional black format'
  | 'visible black format'
  | 'white text format'
  | 'visible text format';
const domains: Domain[] = ['supplier', 'ar', 'clearing', 'allocation'];
async function native(
  name: string,
  rows: (string | number)[][],
  amount: number,
  reference: number,
  defect: Defect,
) {
  const book = new ExcelJS.Workbook(),
    s = book.addWorksheet('Selected');
  s.addRows(rows);
  s.columns.forEach((c) => {
    c.width = 24;
  });
  if (defect === 'white amount' || defect === 'white reference')
    s.getCell(2, defect === 'white amount' ? amount : reference).font = {
      color: { argb: 'FFFFFFFF' },
    };
  if (defect === 'hidden sheet' || defect === 'veryHidden sheet') {
    s.state = defect === 'hidden sheet' ? 'hidden' : 'veryHidden';
    book.addWorksheet('Visible auxiliary').addRow(['Synthetic helper']);
  }
  if (defect === 'hidden auxiliary') {
    const aux = book.addWorksheet('Hidden auxiliary');
    aux.state = 'veryHidden';
    aux.addRow(['Unused synthetic helper']);
  }
  if (defect === 'inverted header') {
    s.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };
    s.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF000000' },
    };
  }
  if (defect === 'hidden row') s.getRow(2).hidden = true;
  if (defect === 'hidden column') s.getColumn(amount).hidden = true;
  if (defect === 'row hidden format') s.getRow(2).numFmt = ';;;';
  if (defect === 'column hidden format') s.getColumn(reference).numFmt = ';;;';
  if (defect === 'black format' || defect === 'conditional black format') {
    const cell = s.getCell(2, amount);
    cell.value = String(rows[1][amount - 1]);
    cell.font = { color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF000000' },
    };
    const colorFormat = '0.00;[Black]-0.00;0.00;[Black]@';
    if (defect === 'black format') cell.numFmt = colorFormat;
    else
      s.addConditionalFormatting({
        ref: cell.address,
        rules: [
          {
            type: 'expression',
            priority: 1,
            formulae: ['TRUE'],
            style: { numFmt: colorFormat },
          },
        ],
      });
  }
  if (defect === 'visible black format') {
    // Text-money is admitted by each fixed schema. AR's prior numeric identity
    // format boundary remains intact; this control does not widen that profile.
    s.getCell(2, amount).value = String(rows[1][amount - 1]);
    s.getCell(2, amount).numFmt = '0.00;[Black]-0.00;0.00;[Black]@';
  }
  if (defect === 'white text format' || defect === 'visible text format') {
    const visible = defect === 'visible text format';
    s.getCell(2, reference).font = {
      color: { argb: visible ? 'FFFFFFFF' : 'FF000000' },
    };
    s.getCell(2, reference).numFmt = visible ? '[Black]@' : '[White]@';
  }
  let bytes = new Uint8Array(await book.xlsx.writeBuffer()).buffer;
  if (defect === 'row hidden format' || defect === 'column hidden format') {
    const zip = await JSZip.loadAsync(bytes),
      path = 'xl/worksheets/sheet1.xml';
    const address = `${s.getColumn(reference).letter}2`;
    const xml = (await zip.file(path)!.async('string')).replace(
      /<c\b[^>]*>/g,
      (tag) => {
        const selected = new RegExp(`r="${address}"`).test(tag);
        return tag
          .replace(/ s="\d+"/, '')
          .replace(/>$/, selected ? '>' : ' s="0">');
      },
    );
    zip.file(path, xml);
    bytes = await zip.generateAsync({ type: 'arraybuffer' });
  }
  if (defect === 'zero height' || defect === 'zero width') {
    const zip = await JSZip.loadAsync(bytes),
      path = 'xl/worksheets/sheet1.xml';
    let xml = await zip.file(path)!.async('string');
    xml =
      defect === 'zero height'
        ? xml.replace('<row r="2"', '<row ht="0" customHeight="1" r="2"')
        : xml.replace(
            '</cols>',
            `<col min="${amount}" max="${amount}" width="0" customWidth="1"/></cols>`,
          );
    zip.file(path, xml);
    bytes = await zip.generateAsync({ type: 'arraybuffer' });
  }
  return readFile(name, bytes);
}
async function input(domain: Domain, defect: Defect) {
  if (domain === 'supplier') {
    const rows = [
      ['Date', 'Reference', 'Amount', 'Description', 'Currency'],
      ['2034-01-10', 'SYN-DISPLAY-REF-001', 100.25, 'Synthetic invoice', 'SAR'],
    ];
    return {
      files: [
        await native('supplier.xlsx', rows, 3, 2, defect),
        await native(
          'ledger.xlsx',
          rows.map((r, i) =>
            i ? [...r.slice(0, 3), 'Synthetic ledger invoice', 'SAR'] : r,
          ),
          3,
          2,
          'normal',
        ),
      ],
      mappings: [mapping, mapping],
      scope: {
        supplier: 'Synthetic Display Vendor',
        entity: scope.entity,
        account: scope.account,
        currency: 'SAR',
        cutoff: scope.end,
        decimals: 2,
        dateWindow: 2,
        confirmed: true,
        coverageConfirmed: false,
      },
      decisions: [],
      rejected: [],
      events: [],
      review: {
        checked: true,
        name: 'Synthetic Reviewer',
        notes: 'Synthetic visibility contract',
      },
    };
  }
  if (domain === 'ar') {
    const rows = [
      [
        'Posting ID',
        'Document type',
        'Own document number',
        'Posting date',
        'Original signed amount',
        'Entity',
        'Ledger',
        'Customer',
        'Account',
        'Currency',
        'Related invoice',
        'Description',
      ],
      [
        'SYN-POST-001',
        'invoice',
        'SYN-DOC-001',
        '2034-01-10',
        100.25,
        scope.entity,
        scope.ledger,
        'SYN-CUSTOMER',
        scope.account,
        'SAR',
        '',
        'Synthetic invoice',
      ],
    ];
    return {
      files: [
        await native('ar-ledger.xlsx', rows, 5, 3, defect),
        await native(
          'ar-statement.xlsx',
          rows.map((r, i) => (i ? ['SYN-STATEMENT-POST', ...r.slice(1)] : r)),
          5,
          3,
          'normal',
        ),
      ],
      readings: [0, 1].map((side) => ({
        sheet: 0,
        header: 0,
        posting: 0,
        kind: 1,
        document: 2,
        date: 3,
        amount: 4,
        entity: 5,
        ledger: 6,
        customer: 7,
        account: 8,
        currency: 9,
        related: 10,
        description: 11,
        role: side ? 'company-issued-customer-statement' : 'company-ar-ledger',
        perspective: 'seller-receivable',
        basis: 'original-movement',
        confirmed: true,
      })),
      scope: { ...scope, customer: 'SYN-CUSTOMER' },
      events: [],
    };
  }
  if (domain === 'clearing') {
    const rows = [
      [
        'Posting ID',
        'Clearing Reference',
        'Date',
        'Amount',
        'Account',
        'Currency',
        'Description',
      ],
      [
        'SYN-P1',
        'SYN-CLEAR',
        '2034-01-10',
        100.25,
        scope.account,
        'SAR',
        'Synthetic debit',
      ],
      [
        'SYN-P2',
        'SYN-CLEAR',
        '2034-01-10',
        -100.25,
        scope.account,
        'SAR',
        'Synthetic credit',
      ],
    ];
    return {
      file: await native('clearing.xlsx', rows, 4, 2, defect),
      reading: {
        sheet: 0,
        header: 0,
        posting: 0,
        reference: 1,
        date: 2,
        amount: 3,
        debit: -1,
        credit: -1,
        account: 4,
        currency: 5,
        description: 6,
        mode: 'signed',
      },
      scope,
      events: [],
    };
  }
  const allocationScope = {
    entity: scope.entity,
    ledger: scope.ledger,
    party: 'Synthetic Display Party',
    account: scope.account,
    currency: 'SAR',
    cutoff: scope.end,
    basis: 'before-proposed-allocation',
    confirmed: true,
  };
  const metadata = [
    allocationScope.entity,
    allocationScope.ledger,
    allocationScope.party,
    allocationScope.account,
    'SAR',
    allocationScope.cutoff,
    allocationScope.basis,
  ];
  const files = await Promise.all([
    native(
      'payments.xlsx',
      [
        ALLOCATION_HEADERS[0],
        ['SYN-PAY', '2034-01-10', ...metadata, 100.25, 100.25],
      ],
      11,
      1,
      defect,
    ),
    native(
      'invoices.xlsx',
      [
        ALLOCATION_HEADERS[1],
        ['SYN-INV', '2034-01-10', ...metadata, 100.25, 100.25],
      ],
      11,
      1,
      'normal',
    ),
    native(
      'advice.xlsx',
      [
        ALLOCATION_HEADERS[2],
        ['SYN-ADVICE', ...metadata, 'SYN-PAY', 'SYN-INV', 100.25],
      ],
      11,
      1,
      'normal',
    ),
  ]);
  const state: AllocationInput = {
    files: files as AllocationInput['files'],
    scope: allocationScope,
    readings: ALLOCATION_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: ALLOCATION_VERSION,
      confirmed: true,
    })) as AllocationInput['readings'],
    events: [],
  };
  // Simulate a previously accepted cached result. Fresh replay must independently
  // rediscover the original display hazard; it cannot trust this old cache.
  const cached = structuredClone(state);
  for (const f of cached.files)
    for (const sheet of f.sheets) {
      sheet.cellIssues = {};
      sheet.rowIssues = {};
      sheet.hiddenRows = [];
      if (sheet.xlsxHeaders) sheet.xlsxHeaders.hiddenColumns = [];
    }
  const r = reconcileAllocation(cached);
  state.events = [
    {
      id: 'SYN-DECISION',
      context: r.context,
      at: '2034-02-01T00:00:00.000Z',
      note: 'Synthetic explicit requested remittance',
      type: 'allocate',
      links: [
        {
          paymentId: r.items.find((i) => i.side === 0)!.id,
          invoiceId: r.items.find((i) => i.side === 1)!.id,
          amount: 10025,
          basis: {
            kind: 'remittance',
            reference: 'SYN-ADVICE',
            reason: 'Synthetic advice',
            proofId: r.proofs[0].id,
          },
        },
      ],
    },
  ];
  return state;
}
const record = (v: unknown) => v as Record<string, unknown>;
void test('format colors follow the active numeric or text section without changing literal values', async () => {
  const cases: [string | number, string, string, string, boolean][] = [
    [100.25, '[Black]0.00;[White]-0.00;[White]0.00', 'FFFFFF', '000000', false],
    [100.25, '[Black]0.00;[White]-0.00;[White]0.00', 'FFFFFF', 'FFFFFF', true],
    [
      -100.25,
      '[Black]0.00;[Black]-0.00;[White]0.00',
      'FFFFFF',
      '000000',
      false,
    ],
    [-100.25, '[Black]0.00;[Black]-0.00;[White]0.00', 'FFFFFF', 'FFFFFF', true],
    [0, '[Black]0.00;[Black]-0.00;[Black]0.00', 'FFFFFF', '000000', false],
    [0, '[Black]0.00;[Black]-0.00;[Black]0.00', 'FFFFFF', 'FFFFFF', true],
    ['SYN-ID-001', '[White]@', '000000', 'FFFFFF', false],
    ['SYN-ID-001', '[Black]@', 'FFFFFF', 'FFFFFF', true],
    ['100.25', '[White]@', '000000', 'FFFFFF', false],
    ['100.25', '[Black]@', 'FFFFFF', 'FFFFFF', true],
    [100.25, '[>0][Black]0.00;[Black]-0.00', 'FFFFFF', 'FFFFFF', false],
  ];
  for (const [value, format, foreground, background, expected] of cases) {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('Selected');
    sheet.addRows([['Amount'], [value]]);
    const cell = sheet.getCell('A2');
    cell.numFmt = format;
    cell.font = { color: { argb: `FF${foreground}` } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${background}` },
    };
    const file = await readFile(
      'active-format.xlsx',
      new Uint8Array(await book.xlsx.writeBuffer()).buffer,
    );
    assert.equal(file.sheets[0].rows[1][0], String(value));
    assert.equal(
      !file.sheets[0].cellIssues?.['2:1']?.length,
      expected,
      `${value}/${format}/${background}`,
    );
  }
});
void test('explicit applyNumberFormat false uses the base display format and preserves visible base controls', async () => {
  for (const hidden of [true, false]) {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('Selected');
    sheet.addRows([
      ['Reference', 'Amount'],
      ['SYN-ID-001', 100.25],
    ]);
    sheet.getCell('A2').numFmt = hidden ? 'General' : ';;;';
    // Force a distinct cell XF even when its number format is General.
    sheet.getCell('A2').font = { bold: true };
    const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
    const path = 'xl/styles.xml';
    let xml = await zip.file(path)!.async('string');
    xml = xml.replace(
      /<cellStyleXfs[^>]*>[\s\S]*?<\/cellStyleXfs>/,
      `<cellStyleXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`,
    );
    if (hidden)
      xml = xml
        .replace(/<numFmts[^>]*>[\s\S]*?<\/numFmts>/, '')
        .replace(
          '<fonts',
          '<numFmts count="1"><numFmt numFmtId="164" formatCode=";;;"/></numFmts><fonts',
        );
    xml = xml.replace(
      /<cellXfs([^>]*)>([\s\S]*?)<\/cellXfs>/,
      (_, attrs: string, contents: string) => {
        let index = 0;
        return `<cellXfs${attrs}>${contents.replace(/<xf\b[^>]*>/g, (tag) =>
          index++ === 1
            ? tag
                .replace(/ xfId="\d+"/, '')
                .replace(/ applyNumberFormat="[^"]*"/, '')
                .replace(
                  /\/>$/,
                  ` xfId="${hidden ? 1 : 0}" applyNumberFormat="0"/>`,
                )
            : tag,
        )}</cellXfs>`;
      },
    );
    zip.file(path, xml);
    const bytes = await zip.generateAsync({ type: 'arraybuffer' });
    const file = await readFile('base-format.xlsx', bytes);
    assert.equal(file.sheets[0].rows[1][0], 'SYN-ID-001');
    assert.equal(file.sheets[0].rows[1][1], '100.25');
    assert.equal(!!file.sheets[0].cellIssues?.['2:1']?.length, hidden);
    assert.deepEqual(file.original, bytes);
  }
});
const clean = (domain: Domain, value: unknown) => {
  const r =
    domain === 'supplier' ? record(record(value).result) : record(value);
  if (domain === 'supplier' || domain === 'ar')
    return (r.cases as Record<string, unknown>[]).some(
      (c) => c.status === (domain === 'supplier' ? 'Matched' : 'matched'),
    );
  if (domain === 'clearing')
    return (r.cases as Record<string, unknown>[]).some(
      (c) => c.status === 'cleared',
    );
  return (r.links as unknown[]).length > 0;
};
void test('flexible native reader scopes display issues while preserving inverted headers and unrelated helpers', async () => {
  const rows = [
    ['Date', 'Reference', 'Amount', 'Unused helper'],
    ['2034-01-10', 'SYN-001', 100.25, 'Synthetic helper'],
  ];
  for (const defect of [
    'normal',
    'hidden auxiliary',
    'inverted header',
  ] as const) {
    const f = await native('source.xlsx', rows, 3, 2, defect);
    assert.deepEqual(f.sheets[0].cellIssues, {});
    assert.equal(f.sheets[0].rowIssues, undefined);
  }
  const f = await native('source.xlsx', rows, 3, 2, 'white amount');
  assert.ok(
    f.sheets[0].cellIssues?.['2:3']?.some((i) =>
      i.startsWith('XLSX_NATIVE_DISPLAY:'),
    ),
  );
  assert.equal(f.sheets[0].cellIssues?.['2:2'], undefined);
});
void test('raw row/column styles cannot disappear when cell styles are omitted, and explicit visible overrides win', async () => {
  for (const kind of [
    'row font',
    'column font',
    'row fill',
    'column fill',
    'row format',
    'column format',
  ] as const) {
    for (const override of [false, true]) {
      const book = new ExcelJS.Workbook(),
        sheet = book.addWorksheet('Selected');
      sheet.addRows([
        ['Date', 'Reference', 'Amount'],
        ['2034-01-10', 'SYN-INHERITED', 100.25],
      ]);
      sheet.columns.forEach((c) => {
        c.width = 24;
      });
      const holder = kind.startsWith('row')
        ? sheet.getRow(2)
        : sheet.getColumn(3);
      if (kind.endsWith('font')) holder.font = { color: { argb: 'FFFFFFFF' } };
      else if (kind.endsWith('format')) holder.numFmt = ';;;';
      else
        holder.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF000000' },
        };
      if (override) {
        sheet.getCell('C2').numFmt = 'General';
        sheet.getCell('C2').font = { color: { argb: 'FF000000' } };
        sheet.getCell('C2').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' },
        };
      }
      const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer()),
        path = 'xl/worksheets/sheet1.xml';
      let xml = await zip.file(path)!.async('string');
      const explicit = /<c\b[^>]*r="C2"[^>]*>/.exec(xml)?.[0];
      assert.ok(explicit);
      const strip = (tag: string) => tag.replace(/ s="\d+"/g, '');
      if (kind.startsWith('row'))
        xml = xml.replace(
          /(<row\b[^>]*r="2"[^>]*>)([\s\S]*?)(<\/row>)/,
          (_, open: string, cells: string, close: string) =>
            open + cells.replace(/<c\b[^>]*>/g, strip) + close,
        );
      else xml = xml.replace(/<c\b[^>]*r="C[12]"[^>]*>/g, strip);
      if (override) xml = xml.replace(/<c\b[^>]*r="C2"[^>]*>/, explicit);
      zip.file(path, xml);
      const file = await readFile(
        'inherited.xlsx',
        await zip.generateAsync({ type: 'arraybuffer' }),
      );
      const issues = file.sheets[0].cellIssues?.['2:3'] ?? [];
      assert.equal(
        kind.endsWith('format')
          ? issues.length > 0
          : issues.some((i) => i.startsWith('XLSX_NATIVE_DISPLAY:')),
        !override,
        `${kind}/override=${override}`,
      );
      assert.equal(file.sheets[0].rows[1][2], '100.25');
    }
  }
});
void test('explicit false apply flags use the referenced base font/fill, while omitted flags retain cell styles', async () => {
  for (const component of ['font', 'fill'] as const) {
    for (const adverse of [false, true]) {
      const book = new ExcelJS.Workbook(),
        sheet = book.addWorksheet('Selected');
      sheet.addRows([
        ['Date', 'Reference', 'Amount'],
        ['2034-01-10', 'SYN-BASE', 100.25],
      ]);
      sheet.getCell('C2').font = { color: { argb: 'FFFFFFFF' } };
      sheet.getCell('C2').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF000000' },
      };
      const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
      let styles = await zip.file('xl/styles.xml')!.async('string');
      const section = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)!;
      const cell = [...section[1].matchAll(/<xf\b[^>]*>/g)].at(-1)![0];
      const componentId = Number(
        new RegExp(`${component}Id="(\\d+)"`).exec(cell)![1],
      );
      const baseId = adverse ? componentId : 0,
        directId = adverse ? 0 : componentId;
      const flag = component === 'font' ? 'applyFont' : 'applyFill';
      styles = styles.replace(
        /<cellStyleXfs[^>]*>[\s\S]*?<\/cellStyleXfs>/,
        `<cellStyleXfs count="2"><xf fontId="0" fillId="0"/><xf fontId="${component === 'font' ? baseId : 0}" fillId="${component === 'fill' ? baseId : 0}"/></cellStyleXfs>`,
      );
      const replacement = `<xf numFmtId="0" fontId="${component === 'font' ? directId : 0}" fillId="${component === 'fill' ? directId : 0}" borderId="0" xfId="1" ${flag}="0"/>`;
      styles = styles.replace(
        /<cellXfs[^>]*>[\s\S]*?<\/cellXfs>/,
        `<cellXfs count="2"><xf fontId="0" fillId="0"/>${replacement}</cellXfs>`,
      );
      zip.file('xl/styles.xml', styles);
      const sheetXml = await zip
        .file('xl/worksheets/sheet1.xml')!
        .async('string');
      zip.file(
        'xl/worksheets/sheet1.xml',
        sheetXml.replace(/(<c\b[^>]*r="C2"[^>]*?) s="\d+"/, '$1 s="1"'),
      );
      const file = await readFile(
        'base-style.xlsx',
        await zip.generateAsync({ type: 'arraybuffer' }),
      );
      assert.equal(
        (file.sheets[0].cellIssues?.['2:3'] ?? []).some((i) =>
          i.startsWith('XLSX_NATIVE_DISPLAY:'),
        ),
        adverse,
        `${component}/adverse=${adverse}`,
      );
      assert.equal(file.sheets[0].rows[1][2], '100.25');
    }
  }
});
void test('theme-less default text remains readable, while default light text is refused', async () => {
  for (const theme of [0, 1]) {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('Selected');
    sheet.addRows([
      ['Date', 'Reference', 'Amount'],
      ['2034-01-10', 'SYN-DEFAULT-THEME', 100.25],
    ]);
    sheet.getCell('C2').font = { color: { theme } };
    const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
    zip.remove('xl/theme/theme1.xml');
    const file = await readFile(
      'theme-less.xlsx',
      await zip.generateAsync({ type: 'arraybuffer' }),
    );
    assert.equal(
      (file.sheets[0].cellIssues?.['2:3'] ?? []).some((i) =>
        i.startsWith('XLSX_NATIVE_DISPLAY:'),
      ),
      theme === 0,
    );
    assert.equal(file.sheets[0].rows[1][2], '100.25');
  }
});
void test('explicit positive dimensions override zero defaults and hidden headerless first rows remain diagnosed', async () => {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Selected');
  sheet.addRows([
    ['Date', 'Reference', 'Amount'],
    ['2034-01-10', 'SYN-DIMENSIONS', 100.25],
  ]);
  sheet.columns.forEach((c) => {
    c.width = 24;
  });
  sheet.eachRow((r) => {
    r.height = 20;
  });
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer()),
    path = 'xl/worksheets/sheet1.xml';
  const xml = (await zip.file(path)!.async('string')).replace(
    /defaultRowHeight="[^"]+"/,
    'defaultRowHeight="0" defaultColWidth="0" zeroHeight="1"',
  );
  zip.file(path, xml);
  const file = await readFile(
    'dimensions.xlsx',
    await zip.generateAsync({ type: 'arraybuffer' }),
  );
  assert.deepEqual(file.sheets[0].hiddenRows, []);
  assert.deepEqual(file.sheets[0].cellIssues, {});
  sheet.state = 'hidden';
  book.addWorksheet('Visible helper').addRow(['Unused helper']);
  const hidden = await readFile(
    'hidden.xlsx',
    new Uint8Array(await book.xlsx.writeBuffer()).buffer,
  );
  assert.ok(
    hidden.sheets[0].rowIssues?.['1']?.some((i) =>
      i.startsWith('XLSX_NATIVE_DISPLAY:'),
    ),
  );
});
void test('actual worker replay/save/old restore/export prevents false-clean flexible native sources', async () => {
  const replies: Record<string, unknown>[] = [];
  const worker = {
    onmessage: undefined as unknown as (event: {
      data: unknown;
    }) => Promise<void>,
    postMessage: (value: Record<string, unknown>) => {
      replies.push(value);
    },
  };
  Object.defineProperty(globalThis, 'self', {
    value: worker,
    configurable: true,
  });
  try {
    await import('../lib/reconciliation/worker.ts');
    let id = 1;
    const call = async (action: string, payload: unknown) => {
      await worker.onmessage({
        data: structuredClone({
          channel: WORKER_CHANNEL,
          id: id++,
          action,
          payload,
        }),
      });
      return replies.pop()!;
    };
    for (const domain of domains) {
      const reconcile =
          domain === 'supplier' ? 'reconcile' : `${domain}-reconcile`,
        save = domain === 'supplier' ? 'save-session' : `${domain}-save`,
        restore =
          domain === 'supplier' ? 'restore-session' : `${domain}-restore`,
        exp = domain === 'supplier' ? 'export' : `${domain}-export`;
      const positive = await input(domain, 'normal');
      const good = await call(reconcile, positive);
      assert.equal(good.ok, true, `${domain} normal`);
      const goodResult =
        domain === 'supplier' ? good.value : record(good.value).result;
      assert.ok(clean(domain, goodResult), `${domain} normal clean`);
      const savedGood = await call(save, positive);
      assert.equal(savedGood.ok, true, `${domain} normal save`);
      for (const defect of [
        'hidden auxiliary',
        'inverted header',
        'visible black format',
        'visible text format',
      ] as const) {
        const control = await input(domain, defect),
          response = await call(reconcile, control);
        assert.equal(response.ok, true, `${domain}/${defect}`);
        assert.ok(
          clean(
            domain,
            domain === 'supplier'
              ? response.value
              : record(response.value).result,
          ),
          `${domain}/${defect}`,
        );
      }
      for (const defect of [
        'white amount',
        'white reference',
        'hidden sheet',
        'veryHidden sheet',
        'zero height',
        'zero width',
        'hidden column',
        'row hidden format',
        'column hidden format',
        'black format',
        'conditional black format',
        'white text format',
      ] as const) {
        const state = await input(domain, defect),
          response = await call(reconcile, state);
        if (response.ok)
          assert.equal(
            clean(
              domain,
              domain === 'supplier'
                ? response.value
                : record(response.value).result,
            ),
            false,
            `${domain}/${defect}`,
          );
        const saved = await call(save, state);
        if (saved.ok) {
          const restored = await call(restore, { buffer: saved.value });
          if (restored.ok)
            assert.equal(
              clean(
                domain,
                domain === 'supplier'
                  ? { result: record(restored.value).result }
                  : record(restored.value).result,
              ),
              false,
              `${domain}/${defect}/restore`,
            );
        }
        const legacy = JSON.parse(
          new TextDecoder().decode(savedGood.value as ArrayBuffer),
        );
        const files =
          'files' in state
            ? (state.files as SourceFile[])
            : [state.file as SourceFile];
        const entries = files.map((f) => ({
          name: f.name,
          sha256: f.sha256,
          data: Buffer.from(f.original!).toString('base64'),
        }));
        if (domain === 'clearing') legacy.file = entries[0];
        else legacy.files = entries;
        if ('events' in state) legacy.events = state.events;
        const restoredOld = await call(restore, {
          buffer: new TextEncoder().encode(JSON.stringify(legacy)).buffer,
        });
        if (restoredOld.ok) {
          const value = record(restoredOld.value);
          // Supplier restore returns a session, recomputed by its real compare route.
          const reread =
            domain === 'supplier' ? await call(reconcile, value) : restoredOld;
          if (reread.ok)
            assert.equal(
              clean(
                domain,
                domain === 'supplier'
                  ? reread.value
                  : record(reread.value).result,
              ),
              false,
              `${domain}/${defect}/old restore`,
            );
        }
        const exported = await call(
          exp,
          domain === 'supplier'
            ? {
                files,
                result: record(good.value).result,
                review: record(positive).review,
              }
            : { state, result: goodResult },
        );
        assert.equal(
          exported.ok,
          false,
          `${domain}/${defect}/old clean export`,
        );
      }
      if (domain === 'supplier') {
        const hidden = await call(reconcile, await input(domain, 'hidden row'));
        assert.equal(hidden.ok, true);
        const value = record(hidden.value);
        assert.equal(record(value.a).total, 10025);
        assert.equal(record(value.b).total, 10025);
        assert.equal(clean(domain, value), false);
        assert.ok(
          (record(value.a).warnings as string[]).some((w) =>
            w.includes('مخفي'),
          ),
        );
      }
    }
  } finally {
    Reflect.deleteProperty(globalThis, 'self');
  }
});
