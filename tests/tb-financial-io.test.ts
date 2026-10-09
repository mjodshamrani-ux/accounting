import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile as fsRead } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  financialTruth,
  financialFixture,
  finishedFinancial,
} from '../audit/tb-financial/fixtures.ts';
import {
  replayFinancialPosition,
  saveFinancialPosition,
  restoreFinancialPosition,
  exportFinancialPosition,
} from '../lib/reconciliation/tb-financial-io.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';
const contracts = JSON.parse(
  await fsRead(
    new URL('../audit/tb-financial/export-contract.json', import.meta.url),
    'utf8',
  ),
) as { sheets: Record<string, string[]> };
const directory = new URL('../work/tb-financial/exports/', import.meta.url);
void test('Financial workpapers: original replay, strict sessions and all non-reject frozen exports preserve 16 frozen sheets', async () => {
  await mkdir(directory, { recursive: true });
  for (const c of financialTruth.cases) {
    if (c.reject) continue;
    const { state, result } = await finishedFinancial(c.name);
    const replay = await replayFinancialPosition(state);
    assert.deepEqual(replay.result, result, c.name);
    const session = await saveFinancialPosition(state);
    const restored = await restoreFinancialPosition(session);
    assert.deepEqual(restored.result, result, c.name);
    for (const [suffix, s, r] of [
      ['direct', state, result],
      ['restored', restored.state, restored.result],
    ] as const) {
      const bytes = await exportFinancialPosition(s, r);
      assert.ok(bytes instanceof ArrayBuffer);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes);
      assert.deepEqual(
        book.worksheets.map((s) => s.name),
        Object.keys(contracts.sheets),
      );
      for (const sheet of book.worksheets)
        assert.deepEqual(
          (sheet.getRow(1).values as unknown[]).slice(1),
          contracts.sheets[sheet.name],
        );
      await writeFile(
        new URL(`${c.name}-${suffix}.xlsx`, directory),
        new Uint8Array(bytes),
      );
    }
  }
});
void test('Financial workpapers: cached invented rows cannot replace originals or authorize a stale export', async () => {
  const { state, result } = await finishedFinancial(
    financialTruth.cases[0].name,
  );
  state.files[0].sheets[0].rows[1][4] = '999999';
  assert.deepEqual((await replayFinancialPosition(state)).result, result);
  const stale = structuredClone(result);
  stale.lines[0].calculated = 0;
  await assert.rejects(
    () => exportFinancialPosition(state, stale),
    /TB_FIN_STALE_EXPORT/,
  );
  state.files[0].original = new TextEncoder().encode('invented').buffer;
  await assert.rejects(
    () => replayFinancialPosition(state),
    /TB_FIN_SOURCE_HASH/,
  );
});
void test('Financial workpapers: unknown session members, hash changes, source reuse and stale histories reject', async () => {
  const { state } = await finishedFinancial(financialTruth.cases[0].name);
  const p = JSON.parse(
    new TextDecoder().decode(await saveFinancialPosition(state)),
  );
  const run = (v: unknown) =>
    restoreFinancialPosition(
      new TextEncoder().encode(JSON.stringify(v)).buffer,
    );
  await assert.rejects(
    () => run({ ...p, result: { status: 'consistent-with-evidence' } }),
    /TB_FIN_SESSION/,
  );
  const hash = structuredClone(p);
  hash.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(() => run(hash), /TB_FIN_SOURCE_HASH/);
  const extra = structuredClone(p);
  extra.files[0].cache = [];
  await assert.rejects(() => run(extra), /TB_FIN_SESSION/);
  const reuse = structuredClone(p);
  reuse.files[1] = { ...reuse.files[0] };
  await assert.rejects(() => run(reuse), /TB_FIN_INDEPENDENT_SOURCES/);
  const stale = structuredClone(p);
  stale.scope.mapVersion = 'CHANGED';
  await assert.rejects(() => run(stale), /TB_FIN_EVENT_CONTEXT/);
});
async function nativeFixture(
  change?: (
    sheet: ExcelJS.Worksheet,
    book: ExcelJS.Workbook,
    source: number,
  ) => void,
) {
  const state = await financialFixture(financialTruth.cases[0].name);
  for (let source = 0; source < 4; source++) {
    const b = new ExcelJS.Workbook(),
      sheet = b.addWorksheet('Data');
    const rows = state.files[source].sheets[0].rows,
      head = rows[0];
    sheet.addRow(head);
    sheet.columns = head.map(() => ({ width: 24 }));
    for (const row of rows.slice(1)) {
      const added = sheet.addRow(row);
      for (const h of source === 0
        ? ['Debit', 'Credit']
        : source === 3
          ? ['Amount']
          : []) {
        const cell = added.getCell(head.indexOf(h) + 1);
        cell.value = Number(row[head.indexOf(h)]);
        cell.numFmt = '0.00';
      }
    }
    change?.(sheet, b, source);
    const bytes = await b.xlsx.writeBuffer();
    state.files[source] = await readFile(
      `source-${source}.xlsx`,
      Uint8Array.from(bytes as unknown as Uint8Array).buffer,
    );
  }
  return state;
}
void test('Financial native originals: supported plain sources pass; misleading display, types, formulas and extra sheets reject in replay/save/restore', async () => {
  const state = await nativeFixture();
  const r = await replayFinancialPosition(state);
  assert.equal(r.result.status, 'needs-review');
  assert.equal(r.result.tb?.debit, 210000);
  await saveFinancialPosition(state);
  const nativeDirectory = new URL(
    '../work/tb-financial/native/',
    import.meta.url,
  );
  await mkdir(nativeDirectory, { recursive: true });
  for (const [i, file] of state.files.entries())
    await writeFile(
      new URL(`source-${i}.xlsx`, nativeDirectory),
      new Uint8Array(file.original!),
    );
  await writeFile(
    new URL('pending.xlsx', nativeDirectory),
    new Uint8Array(await exportFinancialPosition(state, r.result)),
  );
  const changes: ((
    s: ExcelJS.Worksheet,
    b: ExcelJS.Workbook,
    i: number,
  ) => void)[] = [
    (s, _b, i) => {
      if (i === 0) s.getCell('E2').font = { color: { argb: 'FFFFFFFF' } };
    },
    (s, _b, i) => {
      if (i === 0) s.getCell('E2').numFmt = 'General';
    },
    (s, _b, i) => {
      if (i === 0) s.getCell('A2').numFmt = 'mm-dd-yy';
    },
    (s, _b, i) => {
      if (i === 0) s.getCell('E2').value = { formula: '1000', result: 1000 };
    },
    (s, _b, i) => {
      if (i === 0) s.getCell('E2').value = '1000.00';
    },
    (_s, b, i) => {
      if (i === 0) b.addWorksheet('Omitted accounts').addRow(['001', '999999']);
    },
  ];
  for (const [index, change] of changes.entries()) {
    const bad = await nativeFixture(change);
    await assert.rejects(
      () => replayFinancialPosition(bad),
      `native change ${index}`,
    );
    await assert.rejects(() => saveFinancialPosition(bad));
    const p = {
      format: 'tarasuf-tb-financial-session',
      version: 'tb-financial-position-1',
      files: bad.files.map((f) => ({
        name: f.name,
        sha256: f.sha256,
        data: Buffer.from(f.original!).toString('base64'),
      })),
      readings: bad.readings,
      scope: bad.scope,
      completeness: bad.completeness,
      events: [],
    };
    await assert.rejects(() =>
      restoreFinancialPosition(
        new TextEncoder().encode(JSON.stringify(p)).buffer,
      ),
    );
  }
});
void test('Financial worker values: binary downloads and four-source result envelopes reject malformed responses', async () => {
  const { state, result } = await replayFinancialPosition(
    await financialFixture(financialTruth.cases[0].name),
  );
  validateWorkerValue('tb-financial-reconcile', { state, result }, state);
  for (const altered of [
    { ...result, context: 'other-original-context' },
    {
      ...result,
      lines: result.lines.map((l, i) => (i ? l : { ...l, calculated: 999 })),
    },
    { ...result, events: [{ id: 'foreign' }] },
  ])
    assert.throws(() =>
      validateWorkerValue(
        'tb-financial-reconcile',
        { state, result: altered },
        state,
      ),
    );
  assert.throws(() =>
    validateWorkerValue(
      'tb-financial-reconcile',
      { state: { ...state, files: state.files.slice(0, 3) }, result },
      state,
    ),
  );
  assert.throws(() =>
    validateWorkerValue('tb-financial-export', new Uint8Array(4), {}),
  );
  assert.throws(() =>
    validateWorkerValue('tb-financial-save', new ArrayBuffer(0), {}),
  );
});

void test('Financial native originals: rich hidden shared and inline identities reject all public actions', async () => {
  for (const inline of [false, true]) {
    const state = await nativeFixture();
    const file = state.files[0],
      zip = await JSZip.loadAsync(file.original!);
    const rich =
      '<r><rPr><color rgb="FFFFFFFF"/><sz val="1"/></rPr><t>001</t></r>';
    if (inline) {
      const p = 'xl/worksheets/sheet1.xml',
        xml = await zip.file(p)!.async('string');
      const replaced = xml.replace(
        /<c r="A2"[^>]*>[\s\S]*?<\/c>/,
        `<c r="A2" t="inlineStr"><is>${rich}</is></c>`,
      );
      assert.notEqual(xml, replaced);
      zip.file(p, replaced);
    } else {
      const p = 'xl/sharedStrings.xml',
        xml = await zip.file(p)!.async('string');
      const replaced = xml.replace('<si><t>001</t></si>', `<si>${rich}</si>`);
      assert.notEqual(xml, replaced);
      zip.file(p, replaced);
    }
    state.files[0] = await readFile(
      'rich.xlsx',
      await zip.generateAsync({ type: 'arraybuffer' }),
    );
    assert.equal(state.files[0].sheets[0].rows[1][0], '001');
    await assert.rejects(
      () => replayFinancialPosition(state),
      /TB_FIN_NATIVE_DISPLAY/,
    );
    await assert.rejects(
      () => saveFinancialPosition(state),
      /TB_FIN_NATIVE_DISPLAY/,
    );
    const p = {
      format: 'tarasuf-tb-financial-session',
      version: 'tb-financial-position-1',
      files: state.files.map((f) => ({
        name: f.name,
        sha256: f.sha256,
        data: Buffer.from(f.original!).toString('base64'),
      })),
      readings: state.readings,
      scope: state.scope,
      completeness: state.completeness,
      events: [],
    };
    await assert.rejects(
      () =>
        restoreFinancialPosition(
          new TextEncoder().encode(JSON.stringify(p)).buffer,
        ),
      /TB_FIN_NATIVE_DISPLAY/,
    );
    await assert.rejects(
      () =>
        exportFinancialPosition(state, {
          version: 'tb-financial-position-1',
        } as never),
      /TB_FIN_NATIVE_DISPLAY/,
    );
  }
});

void test('Financial export: complete decision history beyond worksheet cardinality rejects before writing', async () => {
  const state = await financialFixture(financialTruth.cases[0].name);
  const count = 1050;
  const tables = state.files.map((f) => f.sheets[0].rows);
  for (let source = 0; source < 4; source++) {
    const template = tables[source][1],
      rows: string[][] = [];
    for (let i = 0; i < (source === 3 ? 1 : count); i++) {
      const row = [...template];
      if (source === 0) {
        row[0] = `A${i}`;
        row[4] = row[5] = '0.00';
      }
      if (source === 1) {
        row[0] = `M${i}`;
        row[1] = `A${i}`;
        row[5] = `P${i}`;
      }
      if (source === 2) {
        row[0] = `P${i}`;
        row[1] = `A${i}`;
      }
      if (source === 3) row[3] = '0.00';
      rows.push(row);
    }
    state.files[source] = await readFile(
      `cardinality-${source}.csv`,
      new TextEncoder().encode(
        [tables[source][0], ...rows].map((row) => row.join(',')).join('\n'),
      ).buffer,
    );
  }
  const initial = await replayFinancialPosition(state);
  assert.equal(initial.result.status, 'needs-review');
  for (let i = 0; i < 1000; i++)
    state.events.push({
      id: `decision-${i}`,
      type: i % 2 ? 'undo' : 'accept',
      context: initial.result.context,
      lineId: 'CASH',
      mappingIds: Array.from({ length: count }, (_, n) => `M${n}`),
      at: '2026-09-30T12:00:00.000Z',
      reference: 'Synthetic cardinality reference',
      note: 'Whole supplied zero-account inventory reviewed',
    });
  const result = (await replayFinancialPosition(state)).result;
  assert.equal(result.events.length, 1000);
  const originalWorkbook = ExcelJS.Workbook;
  let constructions = 0;
  ExcelJS.Workbook = class {
    constructor() {
      constructions++;
      throw Error('UNEXPECTED_FINANCIAL_WORKBOOK_ALLOCATION');
    }
  } as unknown as typeof ExcelJS.Workbook;
  try {
    await assert.rejects(
      () => exportFinancialPosition(state, result),
      /TB_FIN_EXPORT_ROWS/,
    );
    assert.equal(
      constructions,
      0,
      'the whole history must reject before allocating a workbook',
    );
  } finally {
    ExcelJS.Workbook = originalWorkbook;
  }
});
