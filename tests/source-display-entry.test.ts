import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  BANK_HEADERS,
  BANK_VERSION,
  reconcileBank,
  type BankInput,
} from '../lib/reconciliation/bank.ts';
import {
  replayBank,
  saveBank,
  restoreBank,
  exportBank,
} from '../lib/reconciliation/bank-io.ts';
import {
  GL_HEADERS,
  TB_HEADERS,
  GL_TB_VERSION,
  BALANCE_FIELDS,
  type GlTbInput,
} from '../lib/reconciliation/gl-tb.ts';
import {
  replayGlTb,
  saveGlTb,
  restoreGlTb,
  exportGlTb,
} from '../lib/reconciliation/gl-tb-io.ts';
import { WORKER_CHANNEL } from '../lib/reconciliation/protocol.ts';

// Fictional sources authored here, with integer expectations fixed by hand before
// execution in the private P1 expectations record. No private/audit bytes or
// product-generated expected values are introduced into the public repository.
const common = {
  entity: 'Synthetic Entity',
  ledger: 'Synthetic Ledger',
  account: '00100',
  currency: 'SAR',
  start: '2034-01-01',
  end: '2034-01-31',
  confirmed: true,
};
const money = {
  SAR: {
    amount: '100.25',
    parts: ['100.00', '20.10', '5.05', '115.05'],
    minor: [10000, 0, 2010, 505, 11505, 0],
    bank: 10025,
    dp: 2,
  },
  JPY: {
    amount: '100',
    parts: ['100', '20', '5', '115'],
    minor: [100, 0, 20, 5, 115, 0],
    bank: 100,
    dp: 0,
  },
  KWD: {
    amount: '100.251',
    parts: ['100.000', '20.101', '5.050', '115.051'],
    minor: [100000, 0, 20101, 5050, 115051, 0],
    bank: 100251,
    dp: 3,
  },
};
type Currency = keyof typeof money;
type Edit = (book: ExcelJS.Workbook, sheet: ExcelJS.Worksheet) => void;
async function source(
  name: string,
  rows: string[][],
  numeric: number[],
  currency: Currency,
  edit?: Edit,
  xmlEdit?: (xml: string) => string,
) {
  if (name.endsWith('.csv'))
    return readFile(
      name,
      new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n')).buffer,
    );
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Visible source');
  sheet.addRows(rows);
  sheet.columns.forEach((c) => {
    c.width = 24;
  });
  for (let r = 2; r <= sheet.rowCount; r++)
    for (const c of numeric) {
      sheet.getCell(r, c).value = Number(rows[r - 1][c - 1]);
      // GL's 3-place format is intentionally accepted independently of bank.
      sheet.getCell(r, c).numFmt = money[currency].dp
        ? '0.' + '0'.repeat(money[currency].dp)
        : 'General';
    }
  edit?.(book, sheet);
  let buffer = new Uint8Array(await book.xlsx.writeBuffer()).buffer;
  if (xmlEdit) {
    const zip = await JSZip.loadAsync(buffer);
    const path = 'xl/worksheets/sheet1.xml';
    zip.file(path, xmlEdit(await zip.file(path)!.async('string')));
    buffer = await zip.generateAsync({ type: 'arraybuffer' });
  }
  return readFile(name, buffer);
}
async function bank(
  extension = 'xlsx',
  currency: Currency = 'SAR',
  numeric = false,
  edit?: Edit,
  xmlEdit?: (xml: string) => string,
): Promise<BankInput> {
  const scope = { ...common, currency };
  const files = await Promise.all(
    [0, 1].map((side) =>
      source(
        `bank-${side}.${extension}`,
        [
          BANK_HEADERS,
          [
            side ? 'SYN-CASH-001' : 'SYN-BANK-001',
            'SYN-SET-001',
            scope.start,
            scope.start,
            'inflow',
            'principal',
            '',
            '',
            'individual',
            side ? 'posted' : 'booked',
            scope.entity,
            scope.ledger,
            scope.account,
            currency,
            scope.start,
            scope.end,
            money[currency].amount,
          ],
        ],
        numeric ? [17] : [],
        currency,
        side === 0 ? edit : undefined,
        side === 0 ? xmlEdit : undefined,
      ),
    ),
  );
  return {
    files: files as BankInput['files'],
    scope,
    events: [],
    readings: [0, 1].map((side) => ({
      sheet: 0,
      role: side ? 'cashbook' : 'bank-statement',
      family: BANK_VERSION,
      perspective: 'company-cash',
      confirmed: true,
    })) as BankInput['readings'],
  };
}
async function gl(
  extension = 'xlsx',
  currency: Currency = 'SAR',
  numeric = false,
  edit?: Edit,
  xmlEdit?: (xml: string) => string,
): Promise<GlTbInput> {
  const scope = {
    ...common,
    currency,
    dimensions: 'Synthetic Division=001',
    currencyBasis: 'functional',
    postingStatus: 'posted',
    postingLayer: 'actual',
  };
  const s = [
    scope.entity,
    scope.ledger,
    scope.account,
    scope.dimensions,
    currency,
    scope.currencyBasis,
    scope.postingStatus,
    scope.postingLayer,
    scope.start,
    scope.end,
  ];
  const [opening, debit, credit, closing] = money[currency].parts;
  const files = await Promise.all([
    source(
      `gl.${extension}`,
      [
        GL_HEADERS,
        ['SYN-OPEN', 'opening', scope.start, ...s, opening, '0'],
        ['SYN-DEBIT', 'movement', '2034-01-08', ...s, debit, '0'],
        ['SYN-CREDIT', 'movement', '2034-01-09', ...s, '0', credit],
        ['SYN-CLOSE', 'closing', scope.end, ...s, closing, '0'],
      ],
      numeric ? [14, 15] : [],
      currency,
      edit,
      xmlEdit,
    ),
    source(
      `tb.${extension}`,
      [
        TB_HEADERS,
        ['SYN-SNAP', ...s, opening, '0', debit, credit, closing, '0'],
      ],
      numeric ? [12, 13, 14, 15, 16, 17] : [],
      currency,
    ),
  ]);
  return {
    files: files as GlTbInput['files'],
    scope,
    readings: [
      { sheet: 0, role: 'gl-detail', family: GL_TB_VERSION, confirmed: true },
      {
        sheet: 0,
        role: 'trial-balance',
        family: GL_TB_VERSION,
        confirmed: true,
      },
    ],
  };
}
function legacy(input: BankInput | GlTbInput, domain: 'bank' | 'gl-tb') {
  return new TextEncoder().encode(
    JSON.stringify({
      format: `tarasuf-${domain}-session`,
      version: domain === 'bank' ? BANK_VERSION : GL_TB_VERSION,
      files: input.files.map((f) => ({
        name: f.name,
        sha256: f.sha256,
        data: Buffer.from(f.original!).toString('base64'),
      })),
      scope: input.scope,
      readings: input.readings,
      ...(domain === 'bank' ? { events: [] } : {}),
    }),
  ).buffer;
}
const defects: [
  string,
  Edit | undefined,
  ((xml: string) => string) | undefined,
][] = [
  [
    'hidden sheet',
    (_, s) => {
      s.state = 'hidden';
    },
    undefined,
  ],
  [
    'veryHidden sheet',
    (_, s) => {
      s.state = 'veryHidden';
    },
    undefined,
  ],
  [
    'hidden row',
    (_, s) => {
      s.getRow(2).hidden = true;
    },
    undefined,
  ],
  [
    'hidden column',
    (_, s) => {
      s.getColumn(14).hidden = true;
    },
    undefined,
  ],
  [
    'white font',
    (_, s) => {
      s.getCell('N2').font = { color: { argb: 'FFFFFFFF' } };
    },
    undefined,
  ],
  [
    'transparent font',
    (_, s) => {
      s.getCell('N2').font = { color: { argb: '00000000' } };
    },
    undefined,
  ],
  [
    'white row font',
    (_, s) => {
      s.getRow(2).font = { color: { argb: 'FFFFFFFF' } };
    },
    undefined,
  ],
  [
    'white column font',
    (_, s) => {
      s.getColumn(14).font = { color: { argb: 'FFFFFFFF' } };
    },
    undefined,
  ],
  [
    'white rich text',
    (_, s) => {
      s.getCell('N2').value = {
        richText: [{ text: '20.10', font: { color: { argb: 'FFFFFFFF' } } }],
      };
    },
    undefined,
  ],
  [
    'black fill',
    (_, s) => {
      s.getCell('N2').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF000000' },
      };
    },
    undefined,
  ],
  [
    'conditional font',
    (_, s) => {
      s.addConditionalFormatting({
        ref: 'N2',
        rules: [
          {
            type: 'expression',
            formulae: ['TRUE'],
            priority: 1,
            style: { font: { color: { argb: 'FFFFFFFF' } } },
          },
        ],
      });
    },
    undefined,
  ],
  [
    'zero height',
    undefined,
    (x) => x.replace('<row r="2"', '<row ht="0" customHeight="1" r="2"'),
  ],
  ['zero width', undefined, (x) => x.replace(/width="24"/g, 'width="0"')],
  [
    'zero default geometry',
    undefined,
    (x) => x.replace(/defaultRowHeight="[^"]+"/, 'defaultRowHeight="0"'),
  ],
];
void test('P1 bank genuine IO boundaries and old sessions reject invisible originals without changing bytes', async () => {
  for (const [name, edit, xmlEdit] of defects) {
    const input = await bank('xlsx', 'SAR', false, edit, xmlEdit);
    const original = input.files[0].original!.slice(0),
      hash = input.files[0].sha256;
    const unsafeExpected = reconcileBank(await bank());
    for (const action of [
      () => replayBank(input),
      () => saveBank(input),
      () => restoreBank(legacy(input, 'bank')),
      () => exportBank(input, unsafeExpected),
    ])
      await assert.rejects(action, /BANK_NATIVE_DISPLAY/, name);
    assert.deepEqual(input.files[0].original, original);
    assert.equal(
      createHash('sha256').update(new Uint8Array(original)).digest('hex'),
      hash,
    );
  }
});
void test('P1 GL IO boundaries retain inventory refusal and exact original bytes/hash; no clean Summary', async () => {
  for (const [name, edit, xmlEdit] of defects) {
    const input = await gl('xlsx', 'SAR', false, edit, xmlEdit);
    const original = input.files[0].original!.slice(0),
      hash = input.files[0].sha256;
    // Existing hidden-column header rejection is retained.
    if (
      [
        'hidden column',
        'zero width',
        'white column font',
        'zero default geometry',
      ].includes(name)
    ) {
      for (const action of [
        () => replayGlTb(input),
        () => saveGlTb(input),
        () => restoreGlTb(legacy(input, 'gl-tb')),
        () => exportGlTb(input, {} as never),
      ])
        await assert.rejects(action, /COLUMNS/, name);
      continue;
    }
    const replay = await replayGlTb(input);
    assert.equal(replay.result.status, 'source-error', name);
    assert.ok(
      replay.result.inventory.some((r) => !!r.error),
      name,
    );
    assert.equal(replay.result.inventory.length, 7, name);
    const restored = await restoreGlTb(await saveGlTb(input));
    assert.deepEqual(restored.result, replay.result, name);
    assert.equal(
      (await restoreGlTb(legacy(input, 'gl-tb'))).result.status,
      'source-error',
      name,
    );
    const exported = new ExcelJS.Workbook();
    await exported.xlsx.load(await exportGlTb(restored.state, restored.result));
    assert.equal(
      exported.getWorksheet('Summary')!.getCell('B4').value,
      'source-error',
      name,
    );
    const sources = exported.getWorksheet('Sources')!;
    const chunks: string[] = [];
    sources.eachRow((row, n) => {
      if (n > 1 && row.getCell(1).value === 0) {
        const data = row.getCell(7).value;
        assert.equal(typeof data, 'string');
        chunks.push(data as string);
      }
    });
    assert.deepEqual(
      Buffer.from(chunks.join(''), 'base64'),
      Buffer.from(original),
      name,
    );
    assert.deepEqual(input.files[0].original, original, name);
    assert.equal(replay.state.files[0].sha256, hash, name);
    await assert.rejects(
      () => exportGlTb(input, { ...replay.result, status: 'consistent' }),
      /STALE/,
      name,
    );
  }
});
void test('P1 positive source contracts keep literal and numeric monies, IDs, dimensions, dates and currency precision', async () => {
  for (const currency of Object.keys(money) as Currency[]) {
    for (const [extension, numeric] of [
      ['csv', false],
      ['xlsx', false],
      ['xlsx', true],
    ] as const) {
      const g = await gl(extension, currency, numeric),
        replay = await replayGlTb(g);
      assert.equal(replay.result.status, 'consistent');
      assert.deepEqual(
        BALANCE_FIELDS.map((f) => replay.result.gl![f]),
        money[currency].minor,
      );
      assert.deepEqual(replay.result.tb, replay.result.gl);
      assert.equal(replay.result.scope.account, '00100');
      assert.equal(replay.result.scope.dimensions, 'Synthetic Division=001');
      assert.deepEqual(
        (await restoreGlTb(await saveGlTb(g))).result,
        replay.result,
      );
      const exported = new ExcelJS.Workbook();
      await exported.xlsx.load(await exportGlTb(g, replay.result));
      assert.deepEqual(
        exported.getWorksheet('Balances')!.getColumn(2).values.slice(2),
        money[currency].minor,
      );
      const b = await bank(extension, currency, numeric && currency !== 'KWD'),
        bankReplay = await replayBank(b);
      assert.equal(bankReplay.result.status, 'movements-consistent');
      assert.ok(
        bankReplay.result.records.every(
          (r) => r.amount === money[currency].bank,
        ),
      );
      assert.deepEqual(
        (await restoreBank(await saveBank(b))).result,
        bankReplay.result,
      );
      await exportBank(b, bankReplay.result);
    }
  }
  const nativeDates: Edit = (_, s) => {
    for (const r of s.getRows(2, s.rowCount - 1)!)
      for (const col of [3, 12, 13]) {
        const c = r.getCell(col);
        const date = c.value;
        assert.equal(typeof date, 'string');
        c.value = new Date((date as string) + 'T00:00:00Z');
        c.numFmt = 'yyyy-mm-dd';
      }
  };
  assert.equal(
    (await replayGlTb(await gl('xlsx', 'SAR', true, nativeDates))).result
      .status,
    'consistent',
  );
  const multi: Edit = (b) => {
    b.addWorksheet('Visible extra').addRow(['Synthetic note']);
  };
  assert.equal(
    (await replayGlTb(await gl('xlsx', 'SAR', false, multi))).result.status,
    'consistent',
  );
  assert.equal(
    (await replayBank(await bank('xlsx', 'SAR', false, multi))).result.status,
    'movements-consistent',
  );
  const opposite: Edit = (_, s) => {
    s.getCell('N3').value = '21.10';
    s.getCell('O4').value = '6.05';
  };
  const result = (await replayGlTb(await gl('xlsx', 'SAR', false, opposite)))
    .result;
  assert.equal(result.status, 'difference');
  assert.equal(result.differences!.periodDebit, 100);
  assert.equal(result.differences!.periodCredit, 100);
});
void test('P1 actual worker message handler enforces reconcile/save/old restore/export for both domains', async () => {
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
    const request = async (action: string, payload: unknown) => {
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
    for (const [name, edit, xmlEdit] of defects) {
      const b = await bank('xlsx', 'SAR', false, edit, xmlEdit);
      for (const [action, payload] of [
        ['bank-reconcile', b],
        ['bank-save', b],
        ['bank-restore', { buffer: legacy(b, 'bank') }],
        ['bank-export', { state: b, result: reconcileBank(await bank()) }],
      ] as const) {
        const reply = await request(action, payload);
        assert.equal(reply.ok, false, `${name}/${action}`);
        assert.match(String(reply.error), /BANK_NATIVE_DISPLAY/);
      }
      if (
        [
          'hidden column',
          'zero width',
          'white column font',
          'zero default geometry',
        ].includes(name)
      )
        continue;
      const g = await gl('xlsx', 'SAR', false, edit, xmlEdit);
      const replay = await request('gl-tb-reconcile', g);
      assert.equal(replay.ok, true, name);
      const value = replay.value as Awaited<ReturnType<typeof replayGlTb>>;
      assert.equal(value.result.status, 'source-error', name);
      const saved = await request('gl-tb-save', g);
      assert.equal(saved.ok, true, name);
      const restored = await request('gl-tb-restore', {
        buffer: legacy(g, 'gl-tb'),
      });
      assert.equal(
        (restored.value as typeof value).result.status,
        'source-error',
        name,
      );
      const exported = await request('gl-tb-export', {
        state: g,
        result: value.result,
      });
      assert.equal(exported.ok, true, name);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(exported.value as ArrayBuffer);
      assert.equal(
        book.getWorksheet('Summary')!.getCell('B4').value,
        'source-error',
      );
      assert.equal(
        (
          await request('gl-tb-export', {
            state: g,
            result: { ...value.result, status: 'consistent' },
          })
        ).ok,
        false,
      );
    }
    const goodB = await request('bank-reconcile', await bank());
    assert.equal(
      (goodB.value as Awaited<ReturnType<typeof replayBank>>).result.status,
      'movements-consistent',
    );
    const goodG = await request('gl-tb-reconcile', await gl());
    assert.equal(
      (goodG.value as Awaited<ReturnType<typeof replayGlTb>>).result.status,
      'consistent',
    );
  } finally {
    Reflect.deleteProperty(globalThis, 'self');
  }
});
