import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  ImportDiagnosticError,
  isImportDiagnosis,
} from '../lib/reconciliation/import-diagnostics.ts';
import type { ImportDiagnosis } from '../lib/reconciliation/import-diagnostics.ts';
import { syntheticPdf } from './helpers/pdf-fixture.ts';

const rows = [
  ['Date', 'Reference', 'Amount'],
  ['2026-07-01', 'PRIVATE-REF-42', '100.00'],
];
const raster = (size = 30) =>
  `q ${size} 0 0 ${size} 0 0 cm\nBI /W 1 /H 1 /CS /G /BPC 8 ID\nX\nEI\nQ`;
const imageMessage =
  'PDF يحتوي صورة قد تحمل بيانات لا تُقرأ نصيًا، حتى لو كانت صغيرة؛ أرقام OCR لا تدخل التسوية حاليًا، اطلب PDF نصيًا أو Excel';
const noTextMessage = (page: number) =>
  `الصفحة ${page} مصورة أو بلا نص قابل للتحقق. استخدم PDF نصيًا أو Excel للتسوية؛ القراءة البصرية OCR مسودة غير متحققة`;
const emptyDiagnosis = (): ImportDiagnosis => ({
  schemaVersion: 1,
  format: 'pdf',
  totalPages: 1,
  page: 1,
  contentKind: 'no-extractable-text',
  textItems: 0,
  textChars: 0,
  imagePaints: 0,
  code: 'PDF_NO_EXTRACTABLE_TEXT',
  route: 'visual-extraction-required',
  inspectedAllPages: false,
});

async function failedRead(bytes: ArrayBuffer) {
  try {
    await readFile('diagnostic-fixture.pdf', bytes, undefined, true);
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  assert.fail(
    'Unsupported PDF must fail without returning partial financial rows',
  );
}

test('PDF diagnosis: blank and vector-only pages report no extractable text without claiming a scan', async () => {
  for (const decoration of ['', 'q 0 g 20 20 50 50 re f Q']) {
    const error = await failedRead(syntheticPdf([[]], 10, decoration));
    assert.ok(error instanceof ImportDiagnosticError);
    assert.equal(error.message, noTextMessage(1));
    assert.deepEqual(error.diagnosis, emptyDiagnosis());
  }
});

test('PDF diagnosis: image-only bytes report factual image presence with the legacy no-text message', async () => {
  const error = await failedRead(syntheticPdf([[]], 10, raster()));
  assert.ok(error instanceof ImportDiagnosticError);
  assert.equal(error.message, noTextMessage(1));
  assert.deepEqual(error.diagnosis, {
    ...emptyDiagnosis(),
    contentKind: 'image-only',
    imagePaints: 1,
  });
});

test('PDF diagnosis: both small and large images mixed with native text retain the original rejection', async () => {
  for (const size of [1, 600]) {
    const error = await failedRead(syntheticPdf([rows], 10, raster(size)));
    assert.ok(error instanceof ImportDiagnosticError);
    assert.equal(error.message, imageMessage);
    assert.deepEqual(error.diagnosis, {
      ...emptyDiagnosis(),
      contentKind: 'mixed',
      code: 'PDF_IMAGE_CONTENT',
      textItems: 6,
      textChars: rows.flat().reduce((sum, value) => sum + value.length, 0),
      imagePaints: 1,
    });
    const serialized = JSON.stringify(error.diagnosis);
    for (const privateValue of rows[1])
      assert.equal(serialized.includes(privateValue), false);
  }
});

test('PDF diagnosis: image-paint counts count occurrences without inferring image content', async () => {
  const error = await failedRead(
    syntheticPdf([rows], 10, `${raster()}\n${raster(15)}`),
  );
  assert.ok(error instanceof ImportDiagnosticError);
  assert.equal(error.diagnosis.imagePaints, 2);
  assert.equal(error.diagnosis.contentKind, 'mixed');
});

test('PDF diagnosis: first blocking page is explicit and never claims the remaining pages were inspected', async () => {
  const error = await failedRead(syntheticPdf([rows, [], rows]));
  assert.ok(error instanceof ImportDiagnosticError);
  assert.equal(error.message, noTextMessage(2));
  assert.deepEqual(error.diagnosis, {
    ...emptyDiagnosis(),
    totalPages: 3,
    page: 2,
  });
});

test('PDF diagnosis: clean native-text PDFs retain the same exact extracted rows', async () => {
  const file = await readFile(
    'native.pdf',
    syntheticPdf([rows]),
    undefined,
    true,
  );
  assert.deepEqual(file.sheets[0].rows, rows);
  assert.deepEqual(file.sheets[0].rowIssues, {});
  assert.equal(Object.hasOwn(file, 'diagnosis'), false);
});

test('PDF diagnosis: earlier occlusion and hidden-text failures retain precedence over a later image', async () => {
  const decorations = [
    ['q 1 g 298 725 60 15 re f Q', /رسم PDF لاحق يغطي نصًا مرسومًا/],
    ['3 Tr\nBT /F1 10 Tf 1 0 0 1 40 690 Tm (HIDDEN) Tj ET', /مخفي|غير مرئي/],
  ] as const;
  for (const [decoration, message] of decorations) {
    const error = await failedRead(
      syntheticPdf([rows], 10, `${decoration}\n${raster()}`),
    );
    assert.equal(error instanceof ImportDiagnosticError, false);
    assert.match(error.message, message);
  }
});

test('PDF diagnosis schema: exact bounded worker round-trip is accepted', () => {
  const diagnoses: ImportDiagnosis[] = [
    emptyDiagnosis(),
    { ...emptyDiagnosis(), contentKind: 'image-only', imagePaints: 1 },
    {
      ...emptyDiagnosis(),
      contentKind: 'mixed',
      code: 'PDF_IMAGE_CONTENT',
      textItems: 2,
      textChars: 10,
      imagePaints: 4,
    },
    {
      ...emptyDiagnosis(),
      totalPages: 20,
      page: 20,
      contentKind: 'mixed',
      code: 'PDF_IMAGE_CONTENT',
      textItems: 100000,
      textChars: 2000000,
      imagePaints: 1000000,
    },
  ];
  for (const diagnosis of diagnoses) {
    assert.equal(
      isImportDiagnosis(JSON.parse(JSON.stringify(diagnosis))),
      true,
    );
    assert.equal(
      isImportDiagnosis(Object.assign(Object.create(null), diagnosis)),
      true,
    );
  }
});

test('PDF diagnosis schema: malformed, contradictory and extended payloads are rejected', () => {
  const patches: Record<string, unknown>[] = [
    { schemaVersion: 2 },
    { format: 'xlsx' },
    { totalPages: 0 },
    { totalPages: 21 },
    { page: 0 },
    { page: 2 },
    { page: 1.5 },
    { page: NaN },
    { page: Infinity },
    { textItems: -1 },
    { textItems: 100001 },
    { textChars: 2000001 },
    { imagePaints: -1 },
    { imagePaints: 1000001 },
    { imagePaints: 0.5 },
    { textItems: 0, textChars: 1 },
    { textItems: 2, textChars: 1 },
    { textItems: 1, textChars: 1 },
    { contentKind: 'image-only' },
    { imagePaints: 1 },
    { code: 'PDF_IMAGE_CONTENT' },
    { code: 'OTHER' },
    { route: 'accept' },
    { inspectedAllPages: true },
    { rawText: 'private amount' },
    { contentKind: 'native-text', textItems: 1, textChars: 1 },
    { contentKind: 'mixed', textItems: 1, textChars: 1, imagePaints: 1 },
    { totalPages: '1' },
    { page: null },
  ];
  for (const patch of patches) {
    assert.equal(
      isImportDiagnosis({ ...emptyDiagnosis(), ...patch }),
      false,
      JSON.stringify(patch),
    );
  }
  for (const value of [null, undefined, [], 'pdf', 1, new Date()])
    assert.equal(isImportDiagnosis(value), false);
  const missing = { ...emptyDiagnosis() } as Partial<ImportDiagnosis>;
  delete missing.page;
  assert.equal(isImportDiagnosis(missing), false);
  assert.equal(
    isImportDiagnosis({ ...emptyDiagnosis(), [Symbol('extra')]: true }),
    false,
  );
  assert.equal(
    isImportDiagnosis(
      Object.assign(Object.create({ inherited: true }), emptyDiagnosis()),
    ),
    false,
  );
});

test('PDF diagnosis schema: rejects accessors without reading them and tolerates hostile objects', () => {
  let getterCalled = false;
  const accessor = Object.defineProperty({ ...emptyDiagnosis() }, 'page', {
    get() {
      getterCalled = true;
      return 1;
    },
  });
  assert.equal(isImportDiagnosis(accessor), false);
  assert.equal(getterCalled, false);
  assert.equal(
    isImportDiagnosis(
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('trap');
          },
        },
      ),
    ),
    false,
  );
});

test('PDF diagnosis error: immutable validated copy prevents later diagnostic mutation', () => {
  const input = emptyDiagnosis();
  const error = new ImportDiagnosticError('legacy message', input);
  input.page = 10;
  assert.equal(error.message, 'legacy message');
  assert.equal(error.name, 'ImportDiagnosticError');
  assert.equal(error.diagnosis.page, 1);
  assert.equal(Object.isFrozen(error.diagnosis), true);
  assert.throws(() => new ImportDiagnosticError('bad', input), TypeError);
});
