import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as bytes } from 'node:fs/promises';
import { readFile } from '../lib/reconciliation/io.ts';
import { normalizeSource } from '../lib/reconciliation/core.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import {
  makeColumnRequest,
  bindColumnProposal,
} from '../audit/local-provider/proposal.ts';
import type {
  Mapping,
  SourceFile,
  Scope,
} from '../lib/reconciliation/types.ts';

const scope: Scope = {
  supplier: 'Synthetic',
  entity: 'Synthetic',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 7,
  confirmed: true,
  coverageConfirmed: true,
};
async function native(
  rows = [
    [
      'Booking day',
      'Own document token',
      'Item count',
      'Value of this movement',
    ],
    ['2026-07-01', 'INV-1', '5', '100.00'],
    ['2026-07-02', 'INV-2', '3', '200.00'],
  ],
) {
  const content = new TextEncoder().encode(
    rows
      .map((row) =>
        row.map((v) => '"' + v.replaceAll('"', '""') + '"').join(','),
      )
      .join('\r\n') + '\r\n',
  );
  return readFile('native-fixture.csv', content.buffer);
}
function response(
  file: SourceFile,
  mapping: Mapping,
  columns: Record<string, number> = { date: 0, reference: 1, amount: 3 },
) {
  const request = makeColumnRequest(file, mapping);
  assert.ok(request);
  return {
    request,
    output: {
      columns,
      citations: Object.fromEntries(
        Object.entries(columns).map(([k, i]) => [k, `r1c${i + 1}`]),
      ),
    },
  };
}

void test('real-model experiment binding keeps bilingual proposals advisory and native source evidence unchanged', async () => {
  const contract = JSON.parse(
    await bytes(
      new URL('../audit/local-provider/contract.json', import.meta.url),
      'utf8',
    ),
  ) as {
    cases: {
      id: string;
      mode: Mapping['mode'];
      headers: Record<string, string[]>;
      rows: string[][];
      expected: Record<string, number>;
    }[];
  };
  for (const fixture of contract.cases)
    for (const language of ['en', 'ar']) {
      const file = await native([fixture.headers[language], ...fixture.rows]);
      const mapping = { ...defaultMapping(), mode: fixture.mode },
        before = JSON.stringify({ file, mapping });
      const { request, output } = response(file, mapping, fixture.expected);
      const result = bindColumnProposal(
        file,
        mapping,
        request,
        JSON.stringify(output),
      );
      assert.equal(result.kind, 'needs-review', `${fixture.id}-${language}`);
      if (result.kind === 'needs-review') {
        assert.equal(result.verified.status, 'needs-review');
        assert.deepEqual(result.verified.patch, fixture.expected);
        assert.ok(
          result.verified.evidence.every(
            (e) => e.header.row === 1 && e.header.column === e.index + 1,
          ),
        );
      }
      assert.equal(JSON.stringify({ file, mapping }), before);
    }
});

void test('local model cannot supply invented numbers, signs, exclusions, approvals or uncited roles', async () => {
  const file = await native(),
    mapping = defaultMapping(),
    { request, output } = response(file, mapping);
  const invalid = [
    { ...output, approved: true },
    { ...output, confidence: 1 },
    { ...output, values: [100] },
    { ...output, balance: 0 },
    { ...output, excluded: { 2: 'omit' } },
    {
      ...output,
      columns: { multiplier: -1 },
      citations: { multiplier: 'r1c1' },
    },
    { ...output, columns: { amount: 40 }, citations: { amount: 'r1c41' } },
    { ...output, columns: { amount: 1.5 }, citations: { amount: 'r1c2' } },
    {
      ...output,
      citations: { date: 'r2c1', reference: 'r1c2', amount: 'r1c4' },
    },
    { ...output, citations: { date: 'r1c1', reference: 'r1c2' } },
    {
      ...output,
      columns: { date: 0, reference: 0 },
      citations: { date: 'r1c1', reference: 'r1c1' },
    },
    { ...output, columns: [], citations: [] },
    { ...output, columns: { credit: 3 }, citations: { credit: 'r1c4' } },
  ];
  const before = JSON.stringify({ file, mapping });
  for (const payload of invalid)
    assert.equal(
      bindColumnProposal(file, mapping, request, JSON.stringify(payload)).kind,
      'rejected',
    );
  assert.equal(
    bindColumnProposal(
      file,
      mapping,
      request,
      '```json\n' + JSON.stringify(output) + '\n```',
    ).kind,
    'rejected',
  );
  assert.equal(JSON.stringify({ file, mapping }), before);
});

void test('late model proposals are invalidated by unsampled source rows and reading settings', async () => {
  const initial = await native([
    ['Booking day', 'Own document token', 'Units', 'Value of this movement'],
    ...Array.from({ length: 8 }, (_, i) => [
      '2026-07-01',
      `INV-${i}`,
      '1',
      '100.00',
    ]),
  ]);
  for (const alter of [
    (f: SourceFile, _m: Mapping) => {
      f.sheets[0].rows[8][3] = '999.00';
    },
    (f: SourceFile, _m: Mapping) => {
      f.sha256 = 'f'.repeat(64);
    },
    (_f: SourceFile, m: Mapping) => {
      m.multiplier = -1;
    },
    (_f: SourceFile, m: Mapping) => {
      m.dateFormat = 'dmy';
    },
    (_f: SourceFile, m: Mapping) => {
      m.excluded['2'] = 'User review';
    },
  ]) {
    const file = structuredClone(initial),
      mapping = defaultMapping(),
      { request, output } = response(file, mapping);
    alter(file, mapping);
    assert.deepEqual(
      bindColumnProposal(file, mapping, request, JSON.stringify(output)),
      { kind: 'rejected', reason: 'stale-source' },
    );
  }
});

void test('a correct citation does not prove that Quantity is Amount or confer financial authority', async () => {
  const file = await native(),
    mapping = defaultMapping(),
    { request, output } = response(file, mapping, { amount: 2 });
  const result = bindColumnProposal(
    file,
    mapping,
    request,
    JSON.stringify(output),
  );
  assert.equal(result.kind, 'needs-review');
  if (result.kind === 'needs-review') {
    assert.equal(result.verified.status, 'needs-review');
    assert.ok(result.verified.warnings.length >= 2);
  }
  assert.equal(mapping.amount, -1);
});

void test('explicit human review of a correct role preserves malformed amounts as native read errors', async () => {
  const file = await native([
    ['Booking day', 'Own document token', 'Units', 'Value of this movement'],
    ['2026-07-01', 'INV-1', '5', '100.00'],
    ['2026-07-02', 'INV-2', '3', '1O0.00'],
    ['2026-07-03', 'INV-3', '2', '-25.00'],
  ]);
  const mapping = defaultMapping(),
    { request, output } = response(file, mapping);
  const result = bindColumnProposal(
    file,
    mapping,
    request,
    JSON.stringify(output),
  );
  assert.equal(result.kind, 'needs-review');
  if (result.kind !== 'needs-review') return;
  const source = normalizeSource(
    file,
    { ...mapping, ...result.verified.patch },
    scope,
    'supplier',
  );
  assert.deepEqual(
    source.errors.map((e) => e.row),
    [3],
  );
  assert.deepEqual(
    source.transactions.map((t) => [t.row, t.amountMinor]),
    [
      [2, 10000],
      [4, -2500],
    ],
  );
  assert.equal(file.sheets[0].rows[2][3], '1O0.00');
});

void test('empty model advice abstains and UTF-8 limits do not silently truncate native evidence', async () => {
  const file = await native(),
    mapping = defaultMapping(),
    { request } = response(file, mapping);
  assert.deepEqual(
    bindColumnProposal(file, mapping, request, '{"columns":{},"citations":{}}'),
    { kind: 'abstained' },
  );
  assert.deepEqual(
    bindColumnProposal(file, mapping, request, 'س'.repeat(3000)),
    { kind: 'rejected', reason: 'oversized-output' },
  );
  const wide = await native([
    Array.from({ length: 16 }, (_, i) => `حقل ${i} ` + 'س'.repeat(100)),
    Array.from({ length: 16 }, () => 'ق'.repeat(100)),
  ]);
  assert.equal(makeColumnRequest(wide, defaultMapping()), null);
});
