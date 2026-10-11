import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ASSET_VERSION,
  ASSET_LONG_FAMILY,
  ASSET_LONG_COMPONENTS,
  ASSET_COMPONENTS,
  reconcileAsset,
  type AssetEvent,
  type AssetResult,
} from '../lib/reconciliation/fixed-assets.ts';
import {
  assetLongRoot,
  assetLongHash,
  assetLongFixture,
  editAssetLongRows,
  assetLongSource,
} from './helpers/fixed-assets-long-fixtures.ts';

type OracleResult = {
  financial: string;
  totals: AssetResult['totals'];
  comparisons: (Omit<AssetResult['comparisons'][number], 'registerRows'> & {
    physicalMembers: { source: number; row: number }[];
  })[];
  issues: AssetResult['issues'];
  missing: (AssetResult['missing'][number] & {
    asset?: string;
    dimensions?: string;
  })[];
  physicalMembers: { source: number; row: number }[];
  inventory: (AssetResult['inventory'][number] & { values: string[] })[];
  evidence: {
    source: number;
    row: number;
    column: number;
    header: string;
    present: boolean;
    text: string | null;
    minor: number | null;
    component: string | null;
    asset: string | null;
    dimensions: string | null;
    valuation: string | null;
  }[];
};

void test('asset long: 54 accepted independent CSV/Decimal truths preserve four supplied components, source errors, missing links and per-account differences', async () => {
  const manifestBytes = await readFile(
      new URL('frozen/INPUT-MANIFEST.json', assetLongRoot),
    ),
    oracleBytes = await readFile(
      new URL('accepted-oracle-results.json', assetLongRoot),
    );
  assert.equal(
    assetLongHash(manifestBytes),
    'a466e5375aeb97cf9787e46a39dc3af5e0a969a062b771905c2d86796c5faaf7',
  );
  assert.equal(
    assetLongHash(oracleBytes),
    '7465d1924aa7a42672cd3b8a71e772dfbe9aa61fe85214d29cf413dfe0eda412',
  );
  const manifest = JSON.parse(manifestBytes.toString()) as {
      files: { path: string; sha256: string; bytes: number }[];
    },
    oracle = JSON.parse(oracleBytes.toString()) as {
      allPassed: boolean;
      independentOracle: boolean;
      cases: { case: string; result: OracleResult }[];
    };
  assert.equal(oracle.allPassed, true);
  assert.equal(oracle.independentOracle, true);
  assert.equal(oracle.cases.length, 54);
  for (const entry of manifest.files) {
    const b = await readFile(new URL(`frozen/${entry.path}`, assetLongRoot));
    assert.equal(assetLongHash(b), entry.sha256, entry.path);
    assert.equal(b.length, entry.bytes, entry.path);
  }
  for (const c of oracle.cases) {
    const input = await assetLongFixture(c.case),
      before = structuredClone(input),
      r = reconcileAsset(input),
      expected = c.result;
    assert.equal(r.financial, expected.financial, c.case);
    assert.deepEqual(r.totals, expected.totals, c.case + ' totals');
    assert.deepEqual(
      r.comparisons,
      expected.comparisons.map(({ physicalMembers, ...v }) => ({
        ...v,
        registerRows: physicalMembers.map((m) => m.row),
      })),
      c.case + ' comparisons',
    );
    assert.deepEqual(
      r.missing,
      expected.missing.map(({ asset: _a, dimensions: _d, ...v }) => v),
      c.case + ' missing',
    );
    const codes = (v: AssetResult['issues']) =>
      v
        .map((i) =>
          JSON.stringify({
            ...i,
            code: i.code === 'AMOUNT_BOUND' ? 'BOUND' : i.code,
          }),
        )
        .sort();
    assert.deepEqual(
      codes(r.issues),
      codes(expected.issues),
      c.case + ' issues',
    );
    assert.deepEqual(
      r.inventory,
      expected.inventory.map(({ values: _v, ...v }) => v),
      c.case + ' inventory',
    );
    assert.deepEqual(
      r.memberIds.map((id) => {
        const value = JSON.parse(id);
        assert.equal(value[0], ASSET_VERSION);
        assert.equal(value[2], input.files[value[1]].sha256);
        return { source: value[1], row: value[4] };
      }),
      expected.physicalMembers,
      c.case + ' physical members',
    );
    const evidenceFields = [
      'source',
      'row',
      'column',
      'header',
      'present',
      'text',
      'minor',
      'component',
      'asset',
      'dimensions',
      'valuation',
    ] as const;
    const project = (e: Record<string, unknown>) =>
      Object.fromEntries(evidenceFields.map((k) => [k, e[k]]));
    assert.deepEqual(
      r.componentEvidence!.map((e) => project(e)),
      expected.evidence.filter((e) => e.source === 0).map((e) => project(e)),
      c.case + ' original component cells',
    );
    for (const e of r.componentEvidence!) {
      assert.equal(e.context, r.context);
      assert.equal(e.sourceHash, input.files[0].sha256);
      assert.equal(e.sheet, 0);
      assert.equal(e.role, 'register');
      assert.ok(r.memberIds.includes(e.memberId));
      const raw = input.files[0].sheets[0].rows[e.row - 1];
      assert.equal(e.present, e.column <= raw.length);
      assert.equal(e.text, e.present ? raw[e.column - 1] : null);
    }
    for (const item of r.records[0]) {
      assert.equal(item.representation, 'long-components');
      assert.equal(item.memberIds!.length, 4);
      assert.equal(new Set(item.memberIds).size, 4);
      assert.equal(item.memberId, item.memberIds![0]);
      assert.deepEqual(
        item
          .componentEvidence!.map((e) => e.component)
          .sort((a, b) => String(a).localeCompare(String(b))),
        [...ASSET_LONG_COMPONENTS].sort(),
      );
      for (const e of item.componentEvidence!)
        assert.equal(
          item[e.component as (typeof ASSET_LONG_COMPONENTS)[number]],
          e.minor,
        );
    }
    assert.equal(ASSET_COMPONENTS.length, 3);
    assert.deepEqual(input, before, c.case + ' immutable inputs');
  }
});

void test('asset long: missing Amount cell differs from present empty Amount and cannot become a supplied zero', async () => {
  for (const [name, row, present, value] of [
    ['42-malformed-last-row-width', 10, false, null],
    ['20-blank-amount-not-zero', 8, true, ''],
  ] as const) {
    const r = reconcileAsset(await assetLongFixture(name)),
      e = r.componentEvidence!.find((e) => e.row === row)!;
    assert.equal(e.present, present);
    assert.equal(e.text, value);
    assert.equal(e.minor, null);
    assert.equal(r.financial, 'source-error');
    assert.equal(r.totals, null);
    assert.ok(
      r.comparisons.every(
        (c) => c.register === null && c.gl === null && c.difference === null,
      ),
    );
  }
});

void test('asset long: complete review includes every raw member and cannot accept missing zero, duplicate or malformed competitors', async () => {
  const input = await assetLongFixture();
  input.completeness = {
    confirmed: true,
    reference: 'SYN-COMPLETE',
    note: 'Synthetic complete selected account set',
  };
  const original = reconcileAsset(input),
    event = (type: AssetEvent['type'], id: string): AssetEvent => ({
      id,
      type,
      memberIds: original.memberIds,
      context: original.context,
      at: '2026-10-10T00:00:00.000Z',
      reference: 'SYN-REVIEW',
      note: 'Whole physical component scope',
    });
  const accepted = reconcileAsset({ ...input, events: [event('accept', 'A')] });
  assert.equal(accepted.status, 'consistent-with-evidence');
  assert.deepEqual(accepted.componentEvidence, original.componentEvidence);
  const undone = reconcileAsset({
    ...input,
    events: [event('accept', 'A'), event('undo', 'U')],
  });
  assert.equal(undone.review, 'needs-review');
  assert.deepEqual(undone.totals, original.totals);
  assert.throws(
    () =>
      reconcileAsset({
        ...input,
        events: [
          { ...event('accept', 'P'), memberIds: original.memberIds.slice(1) },
        ],
      }),
    /ASSET_EVENT_MEMBERS/,
  );
  for (const name of [
    '11-missing-written-zero-component',
    '12-missing-carrying-no-derivation',
    '54-noncontiguous-extra-zero-duplicate',
    '42-malformed-last-row-width',
  ]) {
    const broken = await assetLongFixture(name),
      r = reconcileAsset(broken),
      e = {
        ...event('accept', 'B'),
        context: r.context,
        memberIds: r.memberIds,
      };
    assert.equal(r.financial, 'source-error', name);
    assert.equal(r.totals, null, name);
    assert.throws(
      () =>
        reconcileAsset({
          ...broken,
          completeness: {
            confirmed: true,
            reference: 'SYN-COMPLETE',
            note: 'Synthetic scope',
          },
          events: [
            {
              ...e,
              context: reconcileAsset({
                ...broken,
                completeness: {
                  confirmed: true,
                  reference: 'SYN-COMPLETE',
                  note: 'Synthetic scope',
                },
              }).context,
            },
          ],
        }),
      /ASSET_EVENT_ACCEPT/,
      name,
    );
    assert.equal(
      reconcileAsset({ ...broken, events: [{ ...e, type: 'reject' }] }).review,
      'rejected',
    );
  }
});

void test('asset long: physical rows include blanks across all four sources at the inclusive 20000 limit', async () => {
  const input = await assetLongFixture(),
    initial = reconcileAsset(input),
    physical = input.files.reduce(
      (n, file) => n + file.sheets[0].rows.length - 1,
      0,
    );
  editAssetLongRows(input, 0, (rows) => {
    for (let i = physical; i < 20000; i++) rows.push([]);
  });
  const r = reconcileAsset(input);
  assert.equal(r.financial, 'ready');
  assert.equal(r.inventory.filter((v) => v.kind !== 'header').length, 20000);
  assert.equal(r.memberIds.length, initial.memberIds.length);
  assert.equal(r.componentEvidence!.length, initial.componentEvidence!.length);
  assert.deepEqual(r.totals, initial.totals);
  editAssetLongRows(input, 0, (rows) => {
    rows.push([]);
  });
  assert.throws(() => reconcileAsset(input), /ASSET_ROWS/);
});

void test('asset long: forbidden raw text rejects before blank classification and leading BOM keeps its original identity', async () => {
  for (const forbidden of ['\u000b', '\u0000', '\uffff', '\ufffe']) {
    assert.throws(() =>
      assetLongSource(
        'forbidden.csv',
        new TextEncoder().encode(forbidden + '\n').buffer,
      ),
    );
  }
  const input = await assetLongFixture(),
    original = reconcileAsset(input);
  input.files[0] = assetLongSource(
    'bom.csv',
    new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new Uint8Array(input.files[0].original!),
    ]).buffer,
  );
  const withBom = reconcileAsset(input);
  assert.equal(withBom.financial, 'ready');
  assert.notEqual(withBom.context, original.context);
  assert.deepEqual(withBom.totals, original.totals);
  assert.deepEqual(
    withBom.componentEvidence!.map((e) => e.text),
    original.componentEvidence!.map((e) => e.text),
  );
});

void test('asset long: family is explicit for register only, CSV only, and carrying never becomes a fourth mapping', async () => {
  const input = await assetLongFixture();
  for (const source of [0, 1, 2, 3]) {
    const bad = structuredClone(input);
    bad.readings[source].family =
      source === 0 ? ASSET_VERSION : ASSET_LONG_FAMILY;
    if (source === 0)
      assert.equal(reconcileAsset(bad).financial, 'source-error');
    else assert.throws(() => reconcileAsset(bad), /ASSET_READING/);
  }
  const xlsx = structuredClone(input);
  xlsx.files[0].name = 'register.xlsx';
  assert.throws(() => reconcileAsset(xlsx), /ASSET_SOURCE/);
  const mapping = structuredClone(input);
  editAssetLongRows(mapping, 1, (rows) => {
    rows[1][rows[0].indexOf('Component')] = 'carrying';
  });
  assert.equal(reconcileAsset(mapping).financial, 'source-error');
  const original = reconcileAsset(input),
    wrongFamilyContext = JSON.parse(original.context);
  wrongFamilyContext[2][0].family = ASSET_VERSION;
  const event: AssetEvent = {
    id: 'OLD',
    type: 'reject',
    memberIds: original.memberIds,
    context: JSON.stringify(wrongFamilyContext),
    at: '2026-10-10T00:00:00.000Z',
    reference: 'SYN-OLD',
    note: 'Other family context',
  };
  assert.throws(
    () => reconcileAsset({ ...input, events: [event] }),
    /ASSET_EVENT/,
  );
});

void test('asset long: written zero and lexical money bounds are preserved without normalization or derivation', async () => {
  const allZero = reconcileAsset(
    await assetLongFixture('10-all-zero-members-retained'),
  );
  assert.equal(allZero.financial, 'ready');
  assert.ok(
    allZero.componentEvidence!.every((e) => e.present && e.minor === 0),
  );
  for (const bad of [
    '-0',
    '+0',
    '.5',
    '1.',
    '1e3',
    '1,000',
    '٠',
    ' ',
    '\u00a0',
    '0.000',
  ]) {
    const input = await assetLongFixture();
    editAssetLongRows(input, 0, (rows) => {
      rows[4][rows[0].indexOf('Amount')] = bad;
    });
    assert.equal(
      reconcileAsset(input).financial,
      'source-error',
      JSON.stringify(bad),
    );
  }
  const bom = await assetLongFixture();
  bom.files[0] = assetLongSource(
    'bom.csv',
    new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new Uint8Array(bom.files[0].original!),
    ]).buffer,
  );
  assert.equal(reconcileAsset(bom).financial, 'ready');
});
