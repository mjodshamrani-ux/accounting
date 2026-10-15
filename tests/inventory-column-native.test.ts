import { parseInventoryColumnHierarchy } from '../lib/reconciliation/inventory-column-hierarchy.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { columnInput } from './inventory-column-fixture.ts';
import {
  readStockFile,
  replayStock,
  saveStock,
  restoreStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import { reconcileStock } from '../lib/reconciliation/inventory-register.ts';
import {
  createWorkerClient,
  type WorkerPort,
} from '../lib/reconciliation/worker-client.ts';
import { WORKER_CHANNEL } from '../lib/reconciliation/protocol.ts';
async function edited(edit: (s: ExcelJS.Worksheet) => void) {
  const input = await columnInput('C02'),
    b = new ExcelJS.Workbook();
  await b.xlsx.load(input.files[0].original!);
  edit(b.worksheets[0]);
  input.files[0] = await readStockFile(
    'register.xlsx',
    Uint8Array.from(new Uint8Array(await b.xlsx.writeBuffer())).buffer,
  );
  return input;
}
void test('INV-1E native numeric quantity/money and proved variable-width parent intervals', async () => {
  const r = await replayStock(
    await edited((s) => {
      s.getCell('B18').value = 1.25;
      s.getCell('B20').value = 3;
      s.getCell('B21').value = 310.125;
      s.getCell('B21').numFmt = '0.000';
    }),
  );
  assert.equal(r.result.financial, 'ready', JSON.stringify(r.result.issues));
  assert.deepEqual(r.result.records[0][0].values, [
    '0007',
    'warehouse=NORTH;batch=LOT-A',
    1250,
    'KG',
    3,
    310125,
    'VAL-A',
  ]);
  assert.deepEqual(r.result.columnEvidence!.records[0].parent.merge, {
    top: 14,
    left: 2,
    bottom: 14,
    right: 4,
    text: 'NORTH',
  });
  assert.deepEqual(
    (await restoreStock(await saveStock(r.state))).result,
    r.result,
  );
});
void test('INV-1E numeric identity, rounded money, cash quantity and foreign currency cannot approve', async () => {
  for (const edit of [
    (s: ExcelJS.Worksheet) => {
      s.getCell('B17').value = 7;
      s.getCell('B17').numFmt = '0000';
    },
    (s: ExcelJS.Worksheet) => {
      s.getCell('B21').value = 310.125;
      s.getCell('B21').numFmt = '0.00';
    },
    (s: ExcelJS.Worksheet) => {
      s.getCell('B18').value = 1.25;
      s.getCell('B18').numFmt = '"KWD" 0.000';
    },
    (s: ExcelJS.Worksheet) => {
      s.getCell('B21').value = 310.125;
      s.getCell('B21').numFmt = '"USD" 0.000';
    },
    (s: ExcelJS.Worksheet) => {
      s.getRow(14).hidden = true;
    },
    (s: ExcelJS.Worksheet) => {
      s.getColumn(3).hidden = true;
    },
    (s: ExcelJS.Worksheet) => {
      s.getCell('B21').value = { formula: '300+10.125', result: 310.125 };
    },
  ]) {
    const r = await replayStock(await edited(edit));
    assert.equal(r.result.financial, 'source-error');
    assert.equal(r.result.totals, null);
    assert.ok(r.result.issues.length);
  }
});
void test('INV-1E original covered numeric zero is retained as a native source violation', async () => {
  const input = await columnInput('C02'),
    z = await JSZip.loadAsync(input.files[0].original!);
  const part = 'xl/worksheets/sheet1.xml';
  let xml = await z.file(part)!.async('string');
  xml = xml.replace(
    /(<row r="14">)(.*?)(<\/row>)/,
    (_all, a, b, c) => a + b + '<c r="C14"><v>0</v></c>' + c,
  );
  z.file(part, xml);
  input.files[0] = await readStockFile(
    'register.xlsx',
    await z.generateAsync({ type: 'arraybuffer' }),
  );
  const r = await replayStock(input);
  assert.equal(r.result.financial, 'source-error');
  assert.ok(
    Object.values(input.files[0].sheets[0].rowIssues ?? {})
      .flat()
      .some((v) => v.includes('NATIVE_COLUMN_MERGE')),
  );
});

void test('INV-1E a covered shared-string index is resolved before distinguishing blank from literal zero', async () => {
  for (const [text, financial] of [
    ['', 'ready'],
    ['0', 'source-error'],
  ] as const) {
    const input = await columnInput('C02'),
      zip = await JSZip.loadAsync(input.files[0].original!);
    const part = 'xl/worksheets/sheet1.xml';
    zip.file(
      part,
      (await zip.file(part)!.async('string')).replace(
        /(<row r="14">)(.*?)(<\/row>)/,
        (_all, a, b, c) => a + b + '<c r="C14" t="s"><v>0</v></c>' + c,
      ),
    );
    zip.file(
      'xl/sharedStrings.xml',
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t>' +
        text +
        '</t></si></sst>',
    );
    const rel = 'xl/_rels/workbook.xml.rels';
    zip.file(
      rel,
      (await zip.file(rel)!.async('string')).replace(
        '</Relationships>',
        '<Relationship Id="shared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
      ),
    );
    zip.file(
      '[Content_Types].xml',
      (await zip.file('[Content_Types].xml')!.async('string')).replace(
        '</Types>',
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
      ),
    );
    input.files[0] = await readStockFile(
      'register.xlsx',
      await zip.generateAsync({ type: 'arraybuffer' }),
    );
    const r = (await replayStock(input)).result;
    assert.equal(r.financial, financial, JSON.stringify(r.issues));
    if (financial === 'ready') {
      assert.deepEqual(r.totals, { registerMinor: 1125000, glMinor: 1125000 });
      assert.equal(r.records[0][0].values[5], 310125);
    } else
      assert.ok(
        Object.values(input.files[0].sheets[0].rowIssues ?? {})
          .flat()
          .some((v) => v.includes('NATIVE_COLUMN_MERGE')),
      );
  }
});
void test('INV-1E existing currency contract stays authoritative', async () => {
  const input = await columnInput('P02');
  input.scope.currency = 'BHD';
  await assert.rejects(() => replayStock(input), /STOCK_CURRENCY/);
});

void test('INV-1E SAR and JPY money precision stays separate from fractional quantity precision', async () => {
  for (const [currency, decimals, money, scaled] of [
    [
      'SAR',
      2,
      ['310.12', '189.88', '500.00', '62.50', '0.00', '62.50'],
      [31012, 18988, 0, 50000, 6250, 6250],
    ],
    [
      'JPY',
      0,
      ['310', '190', '500', '63', '0', '62'],
      [310, 190, 0, 500, 63, 62],
    ],
  ] as const) {
    const input = await columnInput('C01');
    const byReference = Object.fromEntries(
      ['VAL-A', 'VAL-B', 'VAL-C', 'VAL-D', 'VAL-Z', 'VAL-F'].map((ref, i) => [
        ref,
        money[i],
      ]),
    );
    for (let i = 0; i < 4; i++) {
      const rows = structuredClone(input.files[i].sheets[0].rows);
      if (i === 0) {
        rows.find((r) => r[0] === 'Currency')![1] = currency;
        const refs = rows.find((r) => r[0] === 'Valuation reference')!;
        const values = rows.find((r) => r[0] === 'Posted value')!;
        for (let c = 1; c < values.length; c++)
          values[c] = byReference[refs[c]];
        rows.find((r) => r[0] === 'Report total')![1] =
          decimals === 0 ? '1125' : '1125.00';
      } else {
        const currencyColumn = rows[0].indexOf('Currency');
        rows.slice(1).forEach((r, n) => {
          r[currencyColumn] = currency;
          if (i === 3) {
            r[3] = money[n];
            r[4] = decimals === 0 ? '0' : '0.00';
          }
        });
      }
      const text =
        rows
          .map((r) =>
            r
              .map((v) =>
                /[",\r\n]/.test(v) ? '"' + v.replaceAll('"', '""') + '"' : v,
              )
              .join(','),
          )
          .join('\n') + '\n';
      input.files[i] = await readStockFile(
        input.files[i].name,
        new TextEncoder().encode(text).buffer,
      );
    }
    input.scope.currency = currency;
    const r = (await replayStock(input)).result;
    assert.equal(r.financial, 'ready', JSON.stringify(r.issues));
    assert.equal(r.decimals, decimals);
    assert.deepEqual(r.totals, {
      registerMinor: decimals === 0 ? 1125 : 112500,
      glMinor: decimals === 0 ? 1125 : 112500,
    });
    assert.deepEqual(
      r.records[0].map((r) => r.values[5]),
      scaled,
    );
    assert.deepEqual(
      r.records[0].map((r) => [r.values[2], r.values[4]]),
      [
        [1250, 3],
        [275, 2],
        [0, 0],
        [1250, 0],
        [3, 0],
        [50, 2],
      ],
    );
  }
});
void test('INV-1E foreign parent column with identical text cannot pass worker replay', async () => {
  const input = await columnInput('C01'),
    checked = await replayStock(input),
    fake = structuredClone(checked);
  fake.result.columnEvidence!.records[0].parent.value.column = 3;
  const port: WorkerPort = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminate() {},
    postMessage(raw) {
      const r = raw as { id: number; action: string };
      queueMicrotask(() =>
        this.onmessage?.call(
          this as unknown as Worker,
          {
            data: {
              channel: WORKER_CHANNEL,
              id: r.id,
              action: r.action,
              ok: true,
              value: fake,
            },
          } as MessageEvent,
        ),
      );
    },
  };
  const client = createWorkerClient(() => port);
  await assert.rejects(() => client.request('stock-reconcile', input));
});
void test('INV-1E logical column budget is checked before numeric parsing across panels', async () => {
  const input = await columnInput('C04');
  assert.throws(
    () =>
      parseInventoryColumnHierarchy(
        input.files[0],
        input.scope,
        3,
        () => {
          throw Error('Unexpected numeric parsing');
        },
        5,
      ),
    /STOCK_LOGICAL_ROWS/,
  );
});
void test('INV-1E differences and foreign references stay unapprovable after completeness confirmation', async () => {
  for (const code of ['D01', 'D02', 'D14', 'D15']) {
    const input = await columnInput(code);
    input.completeness = {
      confirmed: true,
      reference: 'SYN',
      note: 'Synthetic coverage',
    };
    const value = await replayStock(input);
    value.state.events = [
      {
        id: 'bad',
        type: 'accept',
        context: value.result.context,
        memberIds: value.result.memberIds,
        at: '2026-11-01T00:00:00.000Z',
        reference: 'SYN',
        note: 'Invalid approval',
      },
    ];
    assert.throws(() => reconcileStock(value.state));
  }
});

void test('INV-1E Plant ownership uses literal changed source keys in CSV and native Excel', async () => {
  for (const code of ['C01', 'C02']) {
    const input = await columnInput(code);
    for (let i = 0; i < 4; i++) {
      const f = input.files[i];
      if (i === 0 && code === 'C02') {
        const b = new ExcelJS.Workbook();
        await b.xlsx.load(f.original!);
        b.worksheets[0].getCell('A14').value = 'Plant';
        input.files[i] = await readStockFile(
          f.name,
          Uint8Array.from(new Uint8Array(await b.xlsx.writeBuffer())).buffer,
        );
      } else {
        const raw = new TextDecoder()
          .decode(f.original!)
          .replaceAll('Warehouse', 'Plant')
          .replaceAll('warehouse=', 'plant=');
        input.files[i] = await readStockFile(
          f.name,
          new TextEncoder().encode(raw).buffer,
        );
      }
    }
    const r = await replayStock(input);
    assert.equal(r.result.financial, 'ready', JSON.stringify(r.result.issues));
    assert.deepEqual(r.result.totals, {
      registerMinor: 1125000,
      glMinor: 1125000,
    });
    assert.deepEqual(
      r.result.records[0].map((r) => r.values),
      [
        ['0007', 'plant=NORTH;batch=LOT-A', 1250, 'KG', 3, 310125, 'VAL-A'],
        ['07', 'plant=NORTH;batch=LOT-B', 275, 'KG', 2, 189875, 'VAL-B'],
        ['00', 'plant=NORTH;batch=Z0', 0, 'EA', 0, 0, 'VAL-Z'],
        ['0007', 'plant=SOUTH;batch=LOT-A', 1250, 'G', 0, 500000, 'VAL-C'],
        ['7', 'plant=SOUTH;batch=LOT-C', 3, 'EA', 0, 62500, 'VAL-D'],
        ['007', 'plant=EAST;batch=LOT-A', 50, 'KG', 2, 62500, 'VAL-F'],
      ],
    );
  }
});
