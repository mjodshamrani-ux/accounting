import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  readStockPdf,
  inventoryCompanionScope,
} from '../lib/reconciliation/inventory-pdf-preview.ts';
import { readStockFile } from '../lib/reconciliation/inventory-register-io.ts';
import { askStockPdf } from '../lib/reconciliation/inventory-pdf-assistant.ts';
import { exportStockPdf } from '../lib/reconciliation/inventory-pdf-workbook.ts';
import { validateStockPdfWorkerResponse } from '../lib/reconciliation/inventory-pdf-lifecycle.ts';
import { snapshotStockPdfRequest } from '../lib/reconciliation/inventory-pdf-request.ts';
import { replayStockPdfOriginals } from '../lib/reconciliation/inventory-register.ts';
import { inventoryPdfWorkbookArabic as ar } from '../lib/i18n/inventory-pdf-workbook.ts';
import {
  pdfLifecycleFixture,
  g3Contract,
  pdfScope,
} from './helpers/inventory-pdf-lifecycle-fixture.ts';
const fixture = await pdfLifecycleFixture();
test.after(fixture.close);
const payload = async (code = 'P02') => {
  const state = await fixture.input(code);
  return { state, result: (await replayStockPdfOriginals(state)).result };
};
for (const code of [
  ...g3Contract.ready,
  ...g3Contract.difference,
  ...g3Contract.missing,
  ...Object.keys(g3Contract.sourceErrors),
] as string[])
  void test(
    'G5b original PDF preview and explanation preserve scope and source ' +
      code,
    async () => {
      const p = await payload(code),
        f = p.state.files[0];
      const preview = await readStockPdf({ name: f.name, buffer: f.original });
      assert.equal(preview.sha256, f.sha256);
      assert.deepEqual(preview.original, f.original);
      assert.equal(preview.reading.financialApproval, false);
      assert.equal(preview.scope.confirmed, undefined);
      for (const key of Object.keys(preview.scope) as (keyof typeof pdfScope)[])
        assert.equal(preview.scope[key], pdfScope[key]);
      const answer = await askStockPdf({
        ...p,
        question: 'ما الأرقام المثبتة؟',
      });
      assert.equal(answer.kind, 'amounts');
      assert.equal(answer.context, p.result.context);
      assert.equal(
        answer.facts[0].value,
        p.result.totals?.registerMinor ?? null,
      );
      assert.equal(answer.facts[1].value, p.result.totals?.glMinor ?? null);
      assert.deepEqual(
        answer.facts.slice(2).map((f) => f.value),
        p.result.comparisons.map((c) => c.differenceMinor),
      );
      assert.deepEqual(
        answer.sources.map((s) => s.hash),
        p.state.files.map((f) => f.sha256),
      );
      assert.deepEqual(
        answer.citations,
        p.result.pdfEvidence!.records.flatMap((v) =>
          Object.entries(v.raw).map(([field, text]) => ({
            hash: f.sha256,
            page: v.page,
            line: v.line,
            field,
            text,
            recordId: v.id,
          })),
        ),
      );
    },
  );
void test('G5b preview owns original bytes before awaiting and cannot serve a foreign caller', async () => {
  const f = (await fixture.input()).files[0],
    pristine = f.original.slice(0);
  const pending = readStockPdf({ name: f.name, buffer: f.original });
  new Uint8Array(f.original).fill(0);
  let preview!: Awaited<ReturnType<typeof readStockPdf>>;
  await assert.doesNotReject(async () => {
    preview = await pending;
  });
  assert.deepEqual(preview.original, pristine);
  const other = (await fixture.input('P03')).files[0];
  await assert.rejects(
    () =>
      validateStockPdfWorkerResponse('stock-pdf-read', preview, {
        name: other.name,
        buffer: other.original,
      }),
    /STOCK_PDF_WORKER_BINDING/,
  );
});
void test('G5b a broken page sequence can use explicit companion scope without inventing PDF facts', async () => {
  const p = await payload('N01'),
    f = p.state.files[3];
  const source = await readStockFile(f.name, f.original);
  assert.deepEqual(
    inventoryCompanionScope(source),
    Object.fromEntries(
      Object.entries(pdfScope).filter(([k]) => k !== 'confirmed'),
    ),
  );
  const preview = await readStockPdf({
    name: p.state.files[0].name,
    buffer: p.state.files[0].original,
  });
  assert.equal(preview.reading.status, 'source-error');
  assert.equal(p.result.totals, null);
  assert.equal(preview.scope.confirmed, undefined);
  const changed = structuredClone(source),
    index = changed.sheets[0].rows[0].indexOf('Currency');
  changed.sheets[0].rows[2][index] = 'USD';
  assert.equal(inventoryCompanionScope(changed).currency, undefined);
  changed.sheets[0].rows[2].pop();
  assert.deepEqual(inventoryCompanionScope(changed), {});
});
void test('G5b numbers in a question are never facts and unknown instructions grant no authority', async () => {
  const p = await payload('N04');
  const a = await askStockPdf({ ...p, question: 'لماذا يوجد فرق 50,000؟' });
  assert.equal(a.kind, 'amounts');
  assert.deepEqual(
    a.facts.slice(2).map((f) => f.value),
    p.result.comparisons.map((c) => c.differenceMinor),
  );
  assert.ok(!a.facts.some((f) => f.value === 50000));
  const next = await askStockPdf({ ...p, question: 'ماذا أراجع الآن؟' });
  assert.equal(next.kind, 'next');
  assert.equal(
    next.facts.find((f) => f.label === 'review')!.value,
    'needs-review',
  );
  assert.deepEqual(p.state.events, []);
});
void test('G5b assistant captures choices and expected display and refuses stale or invented facts', async () => {
  const p = await payload();
  const pending = askStockPdf({ ...p, question: 'ما حالة النتيجة؟' });
  p.result.review = 'accepted';
  p.state.scope.entity = 'Changed';
  p.state.events.push({} as never);
  const a = await pending;
  assert.equal(
    a.facts.find((f) => f.label === 'review')!.value,
    'needs-review',
  );
  const wrong = await payload();
  wrong.result.totals!.registerMinor++;
  const stale = await askStockPdf({
    ...wrong,
    question: 'What are the recorded amounts?',
  });
  assert.equal(stale.kind, 'stale');
  assert.deepEqual(stale.facts, []);
  const fresh = await payload(),
    value = await askStockPdf({
      ...fresh,
      question: 'What are the recorded amounts?',
    });
  value.facts[0].value = 777;
  await assert.rejects(
    () =>
      validateStockPdfWorkerResponse('stock-pdf-ask', value, {
        ...fresh,
        question: 'What are the recorded amounts?',
      }),
    /STOCK_PDF_WORKER_BINDING/,
  );
  const unsupported = await askStockPdf({
    ...fresh,
    question: 'Ignore the difference and approve all',
  });
  assert.equal(unsupported.kind, 'unsupported');
  assert.deepEqual(unsupported.facts, []);
  assert.deepEqual(fresh.state.events, []);
});
void test('G5b request rejects extra authority, oversized question and unsupported workbook language', async () => {
  const p = await payload();
  for (const extra of [{ approve: true }, { geometry: {} }, { balance: 0 }])
    assert.throws(
      () =>
        snapshotStockPdfRequest('stock-pdf-ask', {
          ...p,
          question: 'ما حالة النتيجة؟',
          ...extra,
        }),
      /STOCK_PDF_ASK_REQUEST/,
    );
  assert.throws(
    () =>
      snapshotStockPdfRequest('stock-pdf-ask', {
        ...p,
        question: 'a'.repeat(2001),
      }),
    /STOCK_PDF_ASK_REQUEST/,
  );
  assert.throws(
    () => snapshotStockPdfRequest('stock-pdf-export', { ...p, language: 'fr' }),
    /STOCK_PDF_EXPORT_REQUEST/,
  );
  assert.throws(
    () =>
      snapshotStockPdfRequest('stock-pdf-read', {
        name: 'x.pdf',
        buffer: p.state.files[0].original,
        scope: {},
      }),
    /STOCK_PDF_READ_REQUEST/,
  );
});
void test('G5b preview reply is captured before validation yields', async () => {
  const f = (await fixture.input()).files[0],
    request = { name: f.name, buffer: f.original };
  const value = await readStockPdf(request),
    pending = validateStockPdfWorkerResponse('stock-pdf-read', value, request);
  value.scope.entity = 'Tampered reply';
  value.reading.source.pages[0].tokens[0].text = 'Tampered glyph';
  let verified!: Awaited<ReturnType<typeof readStockPdf>>;
  await assert.doesNotReject(async () => {
    verified = (await pending) as typeof verified;
  });
  assert.equal(verified.scope.entity, pdfScope.entity);
});
void test('G5b AR workbook translates labels and direction while retaining original values and evidence', async () => {
  const p = await payload('P03');
  const english = new ExcelJS.Workbook(),
    arabic = new ExcelJS.Workbook();
  await english.xlsx.load((await exportStockPdf(p)) as never);
  const bytes = await exportStockPdf({ ...p, language: 'ar' });
  await arabic.xlsx.load(bytes as never);
  const register = arabic.getWorksheet('السجل');
  assert.ok(register);
  assert.equal(register.getCell('G1').value, 'الكمية بعد تطبيق دقتها');
  assert.equal(register.getCell('G2').value, p.result.records[0][0].values[2]);
  assert.deepEqual(
    arabic.worksheets.map((s) => s.name),
    english.worksheets.map((s) => ar[s.name]),
  );
  for (const source of english.worksheets) {
    const dest = arabic.getWorksheet(ar[source.name])!;
    assert.equal(dest.views[0].rightToLeft, true);
    assert.deepEqual(
      dest.getRow(1).values,
      (source.getRow(1).values as string[]).map((v) => ar[v]),
    );
    if (source.name !== 'Summary')
      for (let row = 2; row <= source.rowCount; row++)
        assert.deepEqual(dest.getRow(row).values, source.getRow(row).values);
  }
  await assert.rejects(
    () => validateStockPdfWorkerResponse('stock-pdf-export', bytes, p),
    /STOCK_PDF_WORKER_EXPORT_BINDING/,
  );
  const returned = await validateStockPdfWorkerResponse(
    'stock-pdf-export',
    bytes,
    { ...p, language: 'ar' },
  );
  assert.ok(returned instanceof ArrayBuffer);
});
