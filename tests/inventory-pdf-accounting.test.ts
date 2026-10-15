import test from 'node:test';
import {
  rewriteSyntheticPdf,
  compressSyntheticPdf,
} from './helpers/pdf-rewrite-fixture.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  compareInventoryPdfSources as compareOriginals,
  reconcileStock,
  STOCK_FIELDS,
  STOCK_HEADERS,
  type StockScope,
  type StockPdfOriginalRequest,
  type StockInput,
} from '../lib/reconciliation/inventory-register.ts';
import {
  STOCK_PDF_FAMILY,
  readInventoryLiteralPdfRegister,
} from '../lib/reconciliation/inventory-pdf-register.ts';
import { inventoryPdfLiteral } from '../lib/reconciliation/inventory-pdf-accounting.ts';
import { readNativePdfSource } from '../lib/reconciliation/pdf.ts';
import { bindTextPaints } from '../lib/reconciliation/pdf-paint-order.ts';
import type { PdfLiteralTrace } from '../lib/reconciliation/pdf-native-source.ts';

const compareInventoryPdfSources = async (request: StockPdfOriginalRequest) =>
  (await compareOriginals(request)).result;
const root = await mkdtemp(path.join(tmpdir(), 'tarasuf-g3-'));
execFileSync(
  process.env.PYTHON ?? 'python3',
  [
    '-B',
    new URL('../audit/inventory-pdf-foundation/generate.py', import.meta.url)
      .pathname,
    '--output-dir',
    root,
    '--include-scope-controls',
  ],
  { timeout: 30000 },
);
test.after(async () => rm(root, { recursive: true, force: true }));
const contract = JSON.parse(
  await readFile(
    new URL('../audit/inventory-pdf-accounting/contract.json', import.meta.url),
    'utf8',
  ),
) as {
  ready: string[];
  difference: string[];
  missing: string[];
  sourceErrors: Record<string, string>;
  facts: (string | number)[][];
  reportMinor: number;
};
const manifest = JSON.parse(
  await readFile(
    new URL(
      '../audit/inventory-pdf-foundation/INPUT-MANIFEST.v2.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { files: { path: string; bytes: number; sha256: string }[] };
for (const f of manifest.files) {
  const b = await readFile(path.join(root, f.path));
  assert.equal(b.length, f.bytes);
  assert.equal(createHash('sha256').update(b).digest('hex'), f.sha256);
}
const scope = Object.fromEntries([
  ...STOCK_FIELDS.map((k, i) => [
    k,
    [
      'Synthetic INV1F Owner',
      'STOCK-PDF',
      'GL-PDF',
      'KWD',
      'functional',
      'posted',
      'Current',
      '2026-10-31',
      'CHART-F',
      'MAP-F',
      'SUPPLIED-F',
      'SET-F',
    ][i],
  ]),
  ['confirmed', true],
]) as StockScope;
async function request(code = 'P02'): Promise<StockPdfOriginalRequest> {
  const names = ['register.pdf', 'mapping.csv', 'policy.csv', 'gl.csv'];
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      original: Uint8Array.from(
        await readFile(path.join(root, 'INV1F-' + code, name)),
      ).buffer,
    })),
  );
  return {
    files: files as StockPdfOriginalRequest['files'],
    scope: { ...scope },
  };
}
const decoded = (b: ArrayBuffer) => new TextDecoder().decode(b);
const encoded = (s: string) => new TextEncoder().encode(s).buffer;
for (const code of [
  ...contract.ready,
  ...contract.difference,
  ...contract.missing,
  ...Object.keys(contract.sourceErrors),
])
  void test('G3 original-source accounting ' + code, async () => {
    const r = await compareInventoryPdfSources(await request(code));
    const expected = contract.sourceErrors[code]
      ? 'source-error'
      : contract.difference.includes(code)
        ? 'difference'
        : contract.missing.includes(code)
          ? 'missing'
          : 'ready';
    assert.equal(r.financial, expected, JSON.stringify(r.issues));
    assert.equal(r.review, 'needs-review');
    assert.equal(r.pdfEvidence!.reading.financialApproval, false);
    if (expected === 'source-error') {
      assert.ok(
        r.issues.some((e) => e.code === contract.sourceErrors[code]),
        JSON.stringify(r.issues),
      );
      assert.equal(r.totals, null);
      for (const c of r.comparisons)
        assert.ok(
          [
            c.registerMinor,
            c.glMinor,
            c.differenceMinor,
            c.debitMinor,
            c.creditMinor,
          ].every((v) => v === null),
        );
    } else {
      assert.deepEqual(r.issues, []);
      assert.deepEqual(
        r.records.map((rows) => rows.length),
        [7, 7, 7, 7],
      );
      assert.equal(r.memberIds.length, 28);
      assert.equal(new Set(r.memberIds).size, 28);
      assert.equal(r.pdfEvidence!.links.length, 7);
      assert.equal(
        r.pdfEvidence!.reportTotal!.actualMinor,
        contract.reportMinor,
      );
      assert.equal(
        r.pdfEvidence!.reportTotal!.declaredMinor,
        contract.reportMinor,
      );
      assert.ok(
        r.pdfEvidence!.pageTotals.every(
          (t) => t.actualMinor === t.declaredMinor,
        ),
      );
      const wanted = structuredClone(contract.facts);
      if (code === 'N04')
        [wanted[0][5], wanted[1][5]] = [wanted[1][5], wanted[0][5]];
      if (code === 'N05')
        [wanted[3][6], wanted[4][6]] = [wanted[4][6], wanted[3][6]];
      if (code === 'N11') wanted[2][3] = 'KG';
      for (let i = 0; i < wanted.length; i++) {
        const row = r.records[0].find(
          (v) => v.values[0] === wanted[i][0] && v.values[1] === wanted[i][1],
        )!;
        assert.ok(row);
        assert.deepEqual(row.values, wanted[i]);
        const link = r.pdfEvidence!.links.find((l) => l.registerId === row.id)!;
        assert.deepEqual(link.mappingIds, [r.records[1][i].id]);
        assert.deepEqual(link.policyIds, [r.records[2][i].id]);
        assert.deepEqual(link.glIds, [r.records[3][i].id]);
        assert.equal(
          link.supported,
          !(
            (code === 'N05' && [3, 4].includes(i)) ||
            (code === 'N11' && i === 2)
          ),
        );
        assert.deepEqual(link.account, r.records[3][i].values.slice(0, 2));
        assert.deepEqual(JSON.parse(row.id).slice(0, 3), [
          STOCK_PDF_FAMILY,
          0,
          r.pdfEvidence!.reading.source.sha256,
        ]);
      }
      assert.deepEqual(r.totals, {
        registerMinor:
          code === 'N05'
            ? 1200750
            : code === 'N11'
              ? 685750
              : contract.reportMinor,
        glMinor: contract.reportMinor,
      });
      if (code === 'N04')
        assert.deepEqual(
          r.comparisons.map((c) => c.differenceMinor),
          [-220250, 220250, 0, 0, 0, 0, 0],
        );
    }
  });
void test('G3 actual double-space identity is preserved and cannot alias a single-space mapping', async () => {
  const input = await request();
  input.files[0].original = encoded(
    decoded(input.files[0].original).replaceAll('(0008) Tj', '(A  B) Tj'),
  );
  for (const f of input.files.slice(1))
    f.original = encoded(
      decoded(f.original).replaceAll(',0008,warehouse=', ',A B,warehouse='),
    );
  const r = await compareInventoryPdfSources(input);
  assert.equal(r.financial, 'missing', JSON.stringify(r.issues));
  assert.ok(r.records[0].some((e) => e.values[0] === 'A  B'));
  assert.equal(r.totals!.registerMinor, 275625);
  assert.ok(r.missing.some((s) => s.includes('A  B')));
  assert.ok(
    !r
      .pdfEvidence!.links.filter((l) =>
        r.records[0].some(
          (e) => e.id === l.registerId && e.values[0] === 'A  B',
        ),
      )
      .some((l) => l.supported),
  );
  for (const f of input.files.slice(1))
    f.original = encoded(
      decoded(f.original).replaceAll(',A B,warehouse=', ',A  B,warehouse='),
    );
  const exact = await compareInventoryPdfSources(input);
  assert.equal(exact.financial, 'ready', JSON.stringify(exact.issues));
  assert.equal(exact.totals!.registerMinor, 1285750);
});
void test('G3 equal-looking scope display is not source identity', async () => {
  const input = await request();
  input.files[0].original = rewriteSyntheticPdf(input.files[0].original, (s) =>
    s.replaceAll('Synthetic INV1F Owner', 'Synthetic  INV1F Owner'),
  );
  const display = await readInventoryLiteralPdfRegister(
    input.files[0].original,
  );
  assert.equal(display.status, 'interpreted');
  assert.equal(display.scope.Entity.value.text, scope.entity);
  const r = await compareInventoryPdfSources(input);
  assert.equal(r.financial, 'source-error');
  assert.equal(r.totals, null);
  assert.ok(r.issues.some((e) => e.code === 'PDF_SCOPE'));
});
void test('G3 owns all original buffers and scope before the first await', async () => {
  const input = await request('P03');
  const hashes = input.files.map((f) =>
    createHash('sha256').update(new Uint8Array(f.original)).digest('hex'),
  );
  const pending = compareInventoryPdfSources(input);
  input.scope.entity = 'Caller changed';
  for (const f of input.files) {
    new Uint8Array(f.original).fill(0);
    f.name = 'changed.csv';
  }
  const r = await pending.catch((e: unknown) => assert.fail(String(e)));
  assert.equal(r.financial, 'ready');
  assert.equal(r.scope.entity, scope.entity);
  assert.equal(r.pdfEvidence!.reading.source.sha256, hashes[0]);
  assert.ok(r.memberIds.every((id) => hashes.includes(JSON.parse(id)[2])));
});
void test('G3 caller cache, approval and geometry are not request fields', async () => {
  for (const field of [
    'sheets',
    'sha256',
    'result',
    'events',
    'completeness',
    'geometry',
  ]) {
    const input = await request();
    const target = ['sheets', 'sha256'].includes(field)
      ? input.files[0]
      : input;
    Object.assign(target, { [field]: [] });
    await assert.rejects(
      compareInventoryPdfSources(input),
      /STOCK_PDF_REQUEST/,
    );
  }
});
void test('G3 does not activate PDF on the existing pure engine', async () => {
  const input = await request();
  assert.throws(
    () =>
      reconcileStock({
        ...input,
        readings: ['register', 'mapping', 'policy-evidence', 'gl'].map(
          (role, i) => ({
            sheet: 0,
            role,
            family: i ? 'inventory-posted-register-gl-1' : STOCK_PDF_FAMILY,
            confirmed: true,
          }),
        ),
        completeness: { confirmed: false, reference: '', note: '' },
        events: [],
      } as unknown as StockInput),
    /STOCK_READING/,
  );
});
void test('G3 source role boundaries cannot borrow another field, and literal evidence cannot lose its hash', async () => {
  const r = await readInventoryLiteralPdfRegister(
    (await request('P01')).files[0].original,
  );
  const span = r.records[0].fields['Item ID']!.value;
  assert.throws(
    () =>
      inventoryPdfLiteral(r.source, { ...span, sourceHash: '0'.repeat(64) }),
    /LITERAL_SOURCE/,
  );
  assert.throws(
    () =>
      inventoryPdfLiteral(r.source, {
        ...span,
        items: [span.items[0], span.items[0]],
      }),
    /LITERAL_ITEMS/,
  );
});
void test('G3 exact glyph trace retains spaces and marks spacing adjustments', () => {
  const ops = {
    showText: 1,
    showSpacedText: 2,
    nextLineShowText: 3,
    nextLineSetSpacingShowText: 4,
    setCharSpacing: 5,
    setWordSpacing: 6,
    setHScale: 7,
  };
  const glyph = (unicode: string) => ({ unicode });
  const trace: PdfLiteralTrace = {
    version: 'native-pdf-literals-1',
    text: '',
    items: [],
    operators: [],
  };
  bindTextPaints(
    ops,
    [1, 1],
    [[[glyph('A  B')]], [[glyph('C'), 50, glyph('D')]]],
    ['A', 'B', 'CD'],
    [
      [0, 0, 1, 1],
      [3, 0, 4, 1],
      [5, 0, 7, 1],
    ],
    undefined,
    { trace, maxChars: 100 },
  );
  assert.equal(trace.text, 'A  BCD');
  assert.deepEqual(
    trace.items.map((r) => trace.text.slice(r.start, r.end)),
    ['A', 'B', 'CD'],
  );
  assert.deepEqual(
    trace.operators.map((o) => o.adjusted),
    [false, true],
  );
  assert.throws(
    () =>
      bindTextPaints(
        ops,
        [1],
        [[[glyph('A  B')]]],
        ['A', 'B'],
        [[0], [1]],
        undefined,
        { trace: { ...trace, items: [], operators: [] }, maxChars: 3 },
      ),
    /PDF_LITERAL_CAPACITY/,
  );
});

for (const [name, from, to, code] of [
  ['negative posted value', '(410.125) Tj', '(-10.125) Tj', 'NUMBER'],
  ['invalid quantity', '(1.250) Tj', '(1.25x) Tj', 'NUMBER'],
  ['wrong report total', '(1285.750) Tj', '(1285.751) Tj', 'REPORT_TOTAL'],
  ['trailing identity whitespace', '(0008) Tj', '(008 ) Tj', 'IDENTITY'],
  [
    'geometric identity spacing',
    '(0008) Tj',
    '[(00) 40 (08)] TJ',
    'LITERAL_SPACING',
  ],
  [
    'character spacing',
    '(0008) Tj',
    '0.1 Tc (0008) Tj 0 Tc',
    'LITERAL_SPACING',
  ],
  [
    'source role extra space',
    '(Item ID) Tj',
    '(Item  ID) Tj',
    'UNCLASSIFIED_ROW',
  ],
] as const)
  void test(
    'G3 original PDF rejects ' + name + ' without financial output',
    async () => {
      const input = await request();
      input.files[0].original = rewriteSyntheticPdf(
        input.files[0].original,
        (s) => s.replaceAll(from, to),
      );
      const r = await compareInventoryPdfSources(input);
      assert.equal(r.financial, 'source-error', JSON.stringify(r.issues));
      assert.equal(r.totals, null);
      assert.ok(
        r.issues.some((i) => i.code === code),
        JSON.stringify(r.issues),
      );
    },
  );
void test('G3 scope identity with exact double spaces succeeds only when all four originals and choice agree', async () => {
  const input = await request('P04');
  input.scope.entity = 'Synthetic  INV1F Owner';
  input.files[0].original = rewriteSyntheticPdf(input.files[0].original, (s) =>
    s.replaceAll('Synthetic INV1F Owner', input.scope.entity),
  );
  for (const f of input.files.slice(1))
    f.original = encoded(
      decoded(f.original).replaceAll(
        'Synthetic INV1F Owner',
        input.scope.entity,
      ),
    );
  const r = await compareInventoryPdfSources(input);
  assert.equal(r.financial, 'ready', JSON.stringify(r.issues));
  assert.equal(r.scope.entity, 'Synthetic  INV1F Owner');
});
for (const [name, source, alter, expected, issue] of [
  [
    'mapping ownership',
    1,
    (s: string) =>
      s.replace(
        'MAP-F-0,0008,warehouse=NORTH;batch=LOT-X',
        'MAP-F-0,0008,warehouse=SOUTH;batch=LOT-X',
      ),
    'source-error',
    'DUPLICATE_MAPPING',
  ],
  [
    'policy quantity precision',
    2,
    (s: string) => s.replace('LOT-X,KG,3,VAL-FA', 'LOT-X,KG,2,VAL-FA'),
    'missing',
    null,
  ],
  [
    'policy sign',
    2,
    (s: string) => s.replace('debit-positive', 'credit-positive'),
    'source-error',
    'POLICY',
  ],
  [
    'policy validity',
    2,
    (s: string) => s.replaceAll('2026-12-31', '2026-10-01'),
    'source-error',
    'VALIDITY',
  ],
  [
    'duplicate GL competitor',
    3,
    (s: string) => s + s.split('\n')[1] + '\n',
    'source-error',
    'DUPLICATE',
  ],
] as const)
  void test('G3 original companion controls ' + name, async () => {
    const input = await request();
    const before = decoded(input.files[source].original),
      after = alter(before);
    assert.notEqual(after, before);
    input.files[source].original = encoded(after);
    const r = await compareInventoryPdfSources(input);
    assert.equal(r.financial, expected, JSON.stringify(r.issues));
    if (issue)
      assert.ok(
        r.issues.some((i) => i.code === issue),
        JSON.stringify(r.issues),
      );
    if (expected === 'source-error') assert.equal(r.totals, null);
  });
void test('G3 equal GL grand total cannot conceal different branch ownership', async () => {
  const input = await request();
  const raw = decoded(input.files[3].original);
  input.files[3].original = encoded(
    raw
      .replace('410.125', 'SWAP')
      .replace('189.875', '410.125')
      .replace('SWAP', '189.875'),
  );
  const r = await compareInventoryPdfSources(input);
  assert.equal(r.financial, 'difference');
  assert.deepEqual(r.totals, { registerMinor: 1285750, glMinor: 1285750 });
  assert.deepEqual(
    r.comparisons.map((c) => c.differenceMinor),
    [220250, -220250, 0, 0, 0, 0, 0],
  );
});

void test('G3 a literal cannot take only one word from another source text-show field', async () => {
  const r = await readInventoryLiteralPdfRegister(
    (await request()).files[0].original,
  );
  const span = r.scope.Entity.value;
  assert.ok(span.items.length > 1);
  assert.throws(
    () =>
      inventoryPdfLiteral(r.source, {
        ...span,
        items: [span.items[0]],
        gaps: [],
      }),
    /LITERAL_BOUNDARY/,
  );
});

void test('G3 compressed PDF can contain more extracted text than serialized bytes, without losing source membership', async () => {
  const input = await request();
  const scopeValues = STOCK_FIELDS.map((k) => String(input.scope[k]));
  const table: string[][] = [
    ['Inventory carrying-value register'],
    ['Report ID', 'COMPRESSED-BOUNDARY'],
    ['Page', '1 of 1'],
    ...STOCK_HEADERS[0].slice(7).map((label, i) => [label, scopeValues[i]]),
    STOCK_HEADERS[0].slice(0, 7),
    ...Array.from({ length: 25 }, (_, i) => [
      'C' + String(i).padStart(4, '0'),
      'warehouse=COMPRESSED;batch=MONTH-END',
      String(i + 1) + '.25',
      'EA',
      '2',
      String(i + 1) + '.001',
      'CV-' + i,
    ]),
    ['Page total', '325.025'],
    ['End page'],
    ['Report total', '325.025'],
    ['End report'],
  ];
  const xs = [20, 100, 350, 410, 470, 550, 650];
  const escaped = (s: string) =>
    s.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = table
    .flatMap((row, r) =>
      row.map(
        (v, c) =>
          'BT /F1 7 Tf 1 0 0 1 ' +
          (r < 15 || r > 40 ? [20, 200][c] : xs[c]) +
          ' ' +
          (575 - r * 12) +
          ' Tm (' +
          escaped(v) +
          ') Tj ET',
      ),
    )
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
  ];
  let raw = '%PDF-1.7\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(raw.length);
    raw += i + 1 + ' 0 obj\n' + object + '\nendobj\n';
  }
  const xref = raw.length;
  raw +=
    'xref\n0 6\n0000000000 65535 f \n' +
    offsets
      .slice(1)
      .map((v) => String(v).padStart(10, '0') + ' 00000 n \n')
      .join('') +
    'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' +
    xref +
    '\n%%EOF\n';
  input.files[0].original = compressSyntheticPdf(encoded(raw));
  const mapping = Array.from({ length: 25 }, (_, i) => [
    'CM-' + i,
    'C' + String(i).padStart(4, '0'),
    'warehouse=COMPRESSED;batch=MONTH-END',
    'INV-C',
    'branch=C',
    'CP-' + i,
    ...scopeValues,
  ]);
  const policies = Array.from({ length: 25 }, (_, i) => [
    'CP-' + i,
    'C' + String(i).padStart(4, '0'),
    'warehouse=COMPRESSED;batch=MONTH-END',
    'EA',
    '2',
    'CV-' + i,
    'INV-C',
    'branch=C',
    'inventory',
    'debit-positive',
    'provided-posted-carrying-value',
    '2026-01-01',
    '2026-12-31',
    'CITE-' + i,
    ...scopeValues,
  ]);
  const tables = [
    mapping,
    policies,
    [['INV-C', 'branch=C', 'inventory', '325.025', '0.000', ...scopeValues]],
  ];
  for (let i = 1; i < 4; i++)
    input.files[i].original = encoded(
      [STOCK_HEADERS[i], ...tables[i - 1]].map((r) => r.join(',')).join('\n') +
        '\n',
    );
  const r = await compareInventoryPdfSources(input).catch((e: unknown) =>
    assert.fail(String(e)),
  );
  assert.equal(r.financial, 'ready', JSON.stringify(r.issues));
  assert.deepEqual(r.totals, { registerMinor: 325025, glMinor: 325025 });
  const source = r.pdfEvidence!.reading.source;
  const chars = source.pages
    .flatMap((p) => p.tokens)
    .reduce((n, t) => n + t.text.length, 0);
  assert.ok(
    chars > input.files[0].original.byteLength,
    chars + ' versus ' + input.files[0].original.byteLength,
  );
  assert.equal(
    source.sha256,
    createHash('sha256')
      .update(new Uint8Array(input.files[0].original))
      .digest('hex'),
  );
  assert.equal(r.records[0].length, 25);
  for (let i = 0; i < 25; i++)
    assert.deepEqual(r.records[0][i].values, [
      'C' + String(i).padStart(4, '0'),
      'warehouse=COMPRESSED;batch=MONTH-END',
      (i + 1) * 100 + 25,
      'EA',
      2,
      (i + 1) * 1000 + 1,
      'CV-' + i,
    ]);
  assert.ok(
    r.records[0].every((row) => JSON.parse(row.id)[2] === source.sha256),
  );
  assert.ok(
    r.pdfEvidence!.links.every((l) => l.supported && l.glIds.length === 1),
  );
});

void test('G3 opt-in does not silently add glyph evidence to the G1 projection', async () => {
  const source = await readNativePdfSource((await request()).files[0].original);
  assert.equal('literalVersion' in source, false);
  assert.ok(source.pages.every((p) => !('literals' in p)));
});
void test('G3 explicit operator budget cannot allocate unbounded empty show evidence', () => {
  const trace: PdfLiteralTrace = {
    version: 'native-pdf-literals-1',
    text: '',
    items: [],
    operators: [],
  };
  assert.throws(
    () =>
      bindTextPaints({ showText: 1 }, [1, 1], [[[]], [[]]], [], [], undefined, {
        trace,
        maxChars: 10,
        maxOperators: 1,
      }),
    /PDF_LITERAL_OPERATOR_CAPACITY/,
  );
});

void test('G3 returns owned originals as a separate versioned envelope for later audit and replay', async () => {
  const input = await request('P03');
  const expected = input.files.map((f) => ({
    name: f.name,
    bytes: Buffer.from(f.original.slice(0)),
    sha256: createHash('sha256')
      .update(new Uint8Array(f.original))
      .digest('hex'),
  }));
  const pending = compareOriginals(input);
  for (const f of input.files) new Uint8Array(f.original).fill(0);
  const comparison = await pending.catch((e: unknown) =>
    assert.fail(String(e)),
  );
  assert.equal(comparison.version, 'inventory-pdf-original-comparison-1');
  assert.equal(comparison.result.financial, 'ready');
  assert.equal(comparison.sources.length, 4);
  for (const [i, source] of comparison.sources.entries()) {
    assert.equal(source.name, expected[i].name);
    assert.equal(source.sha256, expected[i].sha256);
    assert.deepEqual(Buffer.from(source.original), expected[i].bytes);
    assert.notEqual(source.original, input.files[i].original);
  }
});
for (const [name, from, to, code] of [
  ['duplicate physical item', '(00) Tj', '(0008) Tj', 'DUPLICATE'],
  [
    'embedded section delimiter',
    '(NORTH) Tj',
    '(NORTH;batch=OTHER) Tj',
    'DIMENSION',
  ],
] as const)
  void test('G3 original source ownership rejects ' + name, async () => {
    const input = await request();
    input.files[0].original = rewriteSyntheticPdf(
      input.files[0].original,
      (s) => s.replaceAll(from, to),
    );
    const r = await compareInventoryPdfSources(input);
    assert.equal(r.financial, 'source-error');
    assert.equal(r.totals, null);
    assert.ok(
      r.issues.some((e) => e.code === code),
      JSON.stringify(r.issues),
    );
  });
