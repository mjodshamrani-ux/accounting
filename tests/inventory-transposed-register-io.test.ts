// Known synthetic matrix regression and independent original-source financial proof.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, basename } from 'node:path';
import {
  readStockFile,
  replayStock,
  saveStock,
  restoreStock,
  exportStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import {
  STOCK_VERSION,
  STOCK_ROLES,
  STOCK_FIELDS,
  STOCK_SCOPE_HEADERS,
  STOCK_VALUES,
  type StockInput,
} from '../lib/reconciliation/inventory-register.ts';

import type { StockMatrixBandEvidence } from '../lib/reconciliation/inventory-transposed-register.ts';

const suite = resolve(
  import.meta.dirname,
  '../audit/inventory-transposed-register',
);
const temp = await mkdtemp(join(tmpdir(), 'tarasuf-inv1c-'));
const sources = join(temp, 'sources');
const python = process.env.PYTHON || 'python3';
const run = (file: string, args: string[]) =>
  execFileSync(python, ['-B', join(suite, file), ...args], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 20 * 1024 * 1024,
  });
run('generate.py', ['--output-dir', sources]);
type Cite = { source: number; row: number; column: number; raw: string };
type OracleRecord = {
  sourceRow: number;
  column: number;
  raw: Record<string, string>;
  citations: Record<string, Cite>;
  roleCitations: Record<string, Cite>;
  scopeCitations: Record<string, Cite>;
  scope: Record<string, string>;
  quantityUnits: number;
  postedValueMinor: number;
  axisCitation: Cite;
};
type OracleSource = {
  role: number;
  name: string;
  sha256: string;
  sheetName: string;
  inventory: { row: number; fate: string; cells: Cite[] }[];
  records: OracleRecord[];
  matrixBands: {
    header: Cite;
    columns: { column: number; key: string }[];
    boundary: { kind: 'field' | 'report-total' | 'report-end'; citation: Cite };
  }[];
};
type Observation = {
  id: string;
  financial: string;
  totals: unknown;
  sources: OracleSource[];
};
const index = JSON.parse(
  await readFile(join(sources, 'corpus.json'), 'utf8'),
) as { cases: { id: string; files: string[] }[] };
const observed = JSON.parse(run('oracle.py', ['--root', sources])) as {
  cases: Observation[];
};
after(async () => {
  await rm(temp, { recursive: true, force: true });
});
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const id = (source: OracleSource, record: OracleRecord) =>
  JSON.stringify([
    STOCK_VERSION,
    source.role,
    source.sha256,
    0,
    record.sourceRow,
    ...(source.role === 0 ? [record.column] : []),
  ]);
const physical = (source: OracleSource, row: number) =>
  JSON.stringify([STOCK_VERSION, source.role, source.sha256, 0, row]);
async function input(caseID: string): Promise<StockInput> {
  const entry = index.cases.find((c) => c.id === caseID)!;
  const files = [];
  for (const file of entry.files)
    files.push(
      await readStockFile(
        basename(file),
        new Uint8Array(await readFile(join(sources, file))).buffer,
      ),
    );
  const scope: StockInput['scope'] = {
    entity: 'Synthetic INV1C Owner',
    inventoryLedger: 'STOCK-MATRIX',
    glLedger: 'GL-MATRIX',
    currency: 'KWD',
    currencyBasis: 'functional',
    postingStatus: 'posted',
    postingLayer: 'Current',
    asOf: '2026-10-31',
    chartVersion: 'CHART-MX',
    mapVersion: 'MAP-MX',
    valuationPolicyVersion: 'SUPPLIED-MX',
    inventoryAccountSetVersion: 'INV-MX',
    confirmed: true,
  };
  return {
    files: [files[0], files[1], files[2], files[3]],
    scope: { ...scope, confirmed: true },
    readings: STOCK_ROLES.map((role, i) => ({
      role,
      sheet: 0,
      family: i === 0 ? 'inventory-transposed-register-1' : STOCK_VERSION,
      confirmed: true,
    })) as StockInput['readings'],
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
}
const money = (raw: string) => {
  const [integer, fraction = ''] = raw.split('.');
  return Number(BigInt(integer + fraction.padEnd(3, '0')));
};
function values(record: OracleRecord, role: number) {
  return STOCK_VALUES[role].map((field) =>
    field === 'Quantity'
      ? record.quantityUnits
      : field === 'Posted value'
        ? record.postedValueMinor
        : field === 'Quantity precision'
          ? Number(record.raw[field])
          : ['Debit', 'Credit'].includes(field)
            ? money(record.raw[field])
            : record.raw[field],
  );
}

void test('INV1C exact pre-evaluation source seal and independently tested control outputs', async () => {
  const manifest = JSON.parse(
    await readFile(join(suite, 'INPUT-MANIFEST.json'), 'utf8'),
  ) as { files: { path: string; bytes: number; sha256: string }[] };
  assert.equal(manifest.files.length, 57);
  for (const source of manifest.files) {
    const original = await readFile(join(sources, source.path));
    assert.equal(original.byteLength, source.bytes);
    assert.equal(hash(original), source.sha256);
  }
  assert.equal(index.cases.length, 14);
  execFileSync(
    python,
    [
      '-B',
      '-m',
      'unittest',
      'discover',
      '-s',
      suite,
      '-p',
      'test_oracle.py',
      '-v',
    ],
    { timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] },
  );
});
void test('INV1C matrices prove exact Qty/value/Item IDs and account-dimension membership, not grand totals only', async () => {
  for (const entry of index.cases.filter((c) => c.id.startsWith('INV1C-P'))) {
    const truth = observed.cases.find((c) => c.id === entry.id)!;
    const current = await replayStock(await input(entry.id));
    const r = current.result;
    assert.equal(r.financial, 'ready', entry.id);
    assert.equal(r.review, 'needs-review');
    assert.equal(r.decimals, 3);
    assert.deepEqual(r.totals, { registerMinor: 667134, glMinor: 667134 });
    for (let source = 0; source < 4; source++) {
      const document = truth.sources[source];
      assert.equal(current.state.files[source].sha256, document.sha256);
      assert.deepEqual(
        r.records[source],
        document.records.map((record) => ({
          id: id(document, record),
          source,
          row: record.sourceRow,
          ...(source === 0 ? { column: record.column } : {}),
          values: values(record, source),
        })),
        entry.id + ':exact-record-' + source,
      );
    }
    assert.equal(
      new Set(r.records[0].map((record) => record.id)).size,
      4,
      'same Item-ID row cannot collapse different source columns',
    );
    assert.deepEqual(
      new Set(r.records[0].map((record) => record.values[0])),
      new Set(['0014', '014', '14']),
    );
    assert.deepEqual(
      r.comparisons.map((c) => [
        c.account,
        c.dimensions,
        c.registerMinor,
        c.glMinor,
        c.differenceMinor,
      ]),
      [
        ['INV-RM', 'plant=P1;branch=10', 123456, 123456, 0],
        ['INV-RM', 'plant=P2;branch=20', 210111, 210111, 0],
        ['INV-PACK', 'plant=P1;branch=10', 333567, 333567, 0],
        ['INV-PACK', 'plant=P2;branch=20', 0, 0, 0],
      ],
    );
    assert.deepEqual(
      r.memberIds,
      truth.sources.flatMap((source) =>
        source.inventory
          .filter(
            (row) => row.row > 1 && row.cells.some((cell) => cell.raw !== ''),
          )
          .map((row) => physical(source, row.row)),
      ),
    );
    assert.deepEqual(
      r.inventory,
      truth.sources.flatMap((source) =>
        source.inventory.map((row) => ({
          source: source.role,
          row: row.row,
          kind: row.fate,
        })),
      ),
    );
    const evidence = r.matrixEvidence;
    assert.ok(evidence);
    assert.equal(evidence.family, 'inventory-transposed-register-1');
    const document = truth.sources[0];
    const cite = (value: Cite) => ({
      sourceHash: document.sha256,
      sheet: 0,
      sheetName: document.sheetName,
      row: value.row,
      column: value.column,
      raw: value.raw,
    });
    assert.deepEqual(evidence.format, cite(document.inventory[0].cells[1]));
    assert.deepEqual(
      evidence.scope,
      Object.fromEntries(
        STOCK_FIELDS.map((key, i) => [
          key,
          cite(document.records[0].scopeCitations[STOCK_SCOPE_HEADERS[i]]),
        ]),
      ),
    );
    const projected = evidence.bands.flatMap((band) => band.records);
    assert.equal(projected.length, 4);
    for (let i = 0; i < 4; i++) {
      const actual = projected[i],
        record = document.records[i];
      assert.equal(actual.recordId, id(document, record));
      assert.equal(actual.column, record.column);
      assert.deepEqual(actual.anchor, cite(record.citations['Item ID']));
      assert.deepEqual(actual.axis, cite(record.axisCitation));
      assert.deepEqual(
        actual.fields,
        Object.fromEntries(
          STOCK_VALUES[0].map((field) => [
            field,
            {
              value: cite(record.citations[field]),
              role: cite(record.roleCitations[field]),
            },
          ]),
        ),
      );
    }
    for (let i = 0; i < evidence.bands.length; i++) {
      const band: StockMatrixBandEvidence = evidence.bands[i];
      const expected = document.matrixBands[i];
      assert.deepEqual(band.header, cite(expected.header));
      assert.deepEqual(
        band.columns,
        expected.columns.map((column) => ({
          column: column.column,
          key: cite(
            document.inventory[expected.header.row - 1].cells[
              column.column - 1
            ],
          ),
        })),
      );
      assert.deepEqual(band.boundary, {
        kind: expected.boundary.kind,
        citation: cite(expected.boundary.citation),
      });
    }
    const restored = await restoreStock(await saveStock(current.state));
    assert.deepEqual(restored.result, r);
    for (let i = 0; i < 4; i++)
      assert.deepEqual(
        restored.state.files[i].original,
        current.state.files[i].original,
      );
  }
});
void test('INV1C actual native workpapers match original columns/roles/money and source bytes independently', async () => {
  for (const entry of index.cases.filter(
    (c) =>
      c.id.startsWith('INV1C-P') || ['INV1C-N01', 'INV1C-N02'].includes(c.id),
  )) {
    const current = await replayStock(await input(entry.id));
    const restored = await restoreStock(await saveStock(current.state));
    for (const [kind, value] of [
      ['direct', current],
      ['restored', restored],
    ] as const) {
      const file = join(temp, entry.id + '-' + kind + '.xlsx');
      await writeFile(
        file,
        new Uint8Array(await exportStock(value.state, value.result)),
      );
      assert.equal(
        JSON.parse(
          run('check_export.py', [
            '--workbook',
            file,
            '--case-dir',
            join(sources, 'cases', entry.id),
          ]),
        ).pass,
        true,
        entry.id + kind,
      );
    }
  }
});
void test('INV1C balanced amount/identity competitors and malformed columns cannot be accepted', async () => {
  for (const entry of index.cases.filter((c) => c.id.startsWith('INV1C-N'))) {
    const truth = observed.cases.find((c) => c.id === entry.id)!;
    const current = await replayStock(await input(entry.id));
    const r = current.result;
    assert.equal(r.financial, truth.financial, entry.id);
    assert.equal(r.review, 'needs-review');
    if (truth.financial === 'source-error') {
      assert.equal(r.totals, null);
      assert.ok(r.issues.length);
      assert.ok(
        r.comparisons.every((c) =>
          Object.entries(c)
            .filter(([key]) => key.endsWith('Minor'))
            .every(([, value]) => value === null),
        ),
      );
    }
    if (entry.id === 'INV1C-N01') {
      assert.deepEqual(r.totals, { registerMinor: 667134, glMinor: 667134 });
      assert.deepEqual(
        r.comparisons.map((c) => c.differenceMinor),
        [86655, -86655, 0, 0],
      );
    }
    if (entry.id === 'INV1C-N02') {
      assert.deepEqual(r.totals, { registerMinor: 333567, glMinor: 667134 });
      assert.equal(
        r.records[0].reduce((total, row) => total + Number(row.values[5]), 0),
        667134,
      );
    }
    const restored = await restoreStock(await saveStock(current.state));
    assert.deepEqual(restored.result, r);
    current.state.completeness = {
      confirmed: true,
      reference: 'INV1C synthetic whole scope',
      note: 'Synthetic matrix attestation only',
    };
    const complete = await replayStock(current.state);
    complete.state.events = [
      {
        id: 'ILLEGAL',
        type: 'accept',
        memberIds: complete.result.memberIds,
        context: complete.result.context,
        at: '2026-11-01T00:00:00.000Z',
        reference: 'Illegal synthetic acceptance',
        note: 'Must stay blocked',
      },
    ];
    await assert.rejects(
      () => replayStock(complete.state),
      /STOCK_EVENT_ACCEPT/,
    );
  }
});
void test('INV1C approval requires original physical rows rather than six-tuple derived logical IDs', async () => {
  for (const identity of ['INV1C-P01', 'INV1C-P04']) {
    const state = await input(identity);
    state.completeness = {
      confirmed: true,
      reference: 'INV1C synthetic whole scope',
      note: 'Synthetic matrix attestation only',
    };
    const current = await replayStock(state);
    const event: StockInput['events'][number] = {
      id: 'INV1C-ACCEPT',
      type: 'accept',
      memberIds: current.result.memberIds,
      context: current.result.context,
      at: '2026-11-01T00:00:00.000Z',
      reference: 'INV1C synthetic approval',
      note: 'Synthetic matrix review only',
    };
    const wrong = structuredClone(state);
    wrong.events = [
      {
        ...event,
        memberIds: current.result.records.flatMap((rows) =>
          rows.map((row) => row.id),
        ),
      },
    ];
    await assert.rejects(() => replayStock(wrong), /STOCK_EVENT_MEMBERS/);
    state.events = [event];
    const accepted = await restoreStock(await saveStock(state));
    assert.equal(accepted.result.status, 'consistent-with-evidence');
    const other = await input(
      identity === 'INV1C-P01' ? 'INV1C-P04' : 'INV1C-P01',
    );
    other.completeness = structuredClone(state.completeness);
    other.events = structuredClone(state.events);
    await assert.rejects(() => replayStock(other), /STOCK_EVENT/);
    state.events.push({
      ...event,
      id: 'INV1C-UNDO',
      type: 'undo',
      at: '2026-11-01T00:00:01.000Z',
    });
    assert.equal(
      (await restoreStock(await saveStock(state))).result.review,
      'needs-review',
    );
  }
});
