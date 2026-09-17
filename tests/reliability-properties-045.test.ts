import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManifest,
  layoutFamilies,
} from '../audit/reliability/manifest.mjs';
import { generateCase } from '../audit/reliability/generator.mjs';
import { displayMinor, renderCase } from '../audit/reliability/renderers.mjs';
import { readFile } from '../lib/reconciliation/io.ts';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import {
  defaultMapping,
  MAX_ROWS,
  MAX_FILE_BYTES,
} from '../lib/reconciliation/types.ts';
import type {
  Comparison,
  Scope,
  SourceFile,
  SourceResult,
} from '../lib/reconciliation/types.ts';

const descriptor = buildManifest().find(
  (d) =>
    d.split === 'development' &&
    d.scenario === 'mixed-movements' &&
    generateCase(d).sources[0].metadata.decimals === 2 &&
    generateCase(d).sources[0].rows.length >= 6,
)!;
function fixture() {
  const c = generateCase(descriptor);
  for (const source of c.sources) {
    source.format = 'csv';
    source.name = `${source.side}.csv`;
    source.layout = {
      ...layoutFamilies['dev-flat'],
      family: 'dev-flat',
      style: 'mixed-movements',
    };
  }
  return c;
}
async function pipeline(c: ReturnType<typeof fixture>) {
  const rendered = await renderCase(c),
    m = c.sources[0].metadata;
  const scope: Scope = {
    supplier: m.supplier,
    entity: m.entity,
    account: m.account,
    currency: m.currency,
    decimals: m.decimals,
    cutoff: m.cutoff,
    dateWindow: m.dateWindow,
    confirmed: true,
    coverageConfirmed: true,
  };
  const files: SourceFile[] = [],
    sources: SourceResult[] = [];
  for (let i = 0; i < 2; i++) {
    const output = rendered.files[i],
      meta = c.sources[i].metadata;
    const bytes = new Uint8Array(output.bytes).buffer;
    const file = await readFile(output.name, bytes);
    files.push(file);
    const binding = output.bindings;
    const mapping = {
      ...defaultMapping(),
      sheet: output.sheetIndex ?? 0,
      header: output.headerRow,
      date: binding.date,
      reference: binding.reference,
      description: binding.description,
      amount: binding.amount,
      debit: binding.debit,
      credit: binding.credit,
      currencyColumn: binding.currency,
      mode: binding.mode as 'signed' | 'split',
      numberFormat: meta.numberFormat as 'dot' | 'comma',
      dateFormat: meta.dateFormat as 'ymd' | 'dmy' | 'mdy',
      periodStart: meta.periodStart,
      opening: displayMinor(
        meta.opening ?? 0,
        meta.decimals,
        meta.numberFormat === 'comma' ? 'comma-decimals' : 'dot',
      ),
      closing: displayMinor(
        meta.closing ?? 0,
        meta.decimals,
        meta.numberFormat === 'comma' ? 'comma-decimals' : 'dot',
      ),
    };
    // Column and date/number format choices simulate the visible confirmation UI.
    // They never provide hidden event IDs or oracle matches to the engine.
    sources.push(
      normalizeSource(
        file,
        mapping,
        scope,
        c.sources[i].side as 'supplier' | 'ledger',
      ),
    );
  }
  return {
    files,
    sources,
    scope,
    result: compare(sources[0], sources[1], scope),
  };
}
function economicSignature(result: Comparison) {
  return result.cases
    .map((c) => ({
      status: c.status,
      a: c.supplierMembers.map((t) => [t.reference, t.date, t.amount]).sort(),
      b: c.ledgerMembers.map((t) => [t.reference, t.date, t.amount]).sort(),
      variance: c.variance,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function verifyPartitionAndAmounts(
  result: Comparison,
  c: ReturnType<typeof fixture>,
) {
  const expected = c.sources.flatMap((source) =>
    source.rows.map(
      (row: { reference: string; date: string; minor: number }) => ({
        side: source.side,
        ...row,
      }),
    ),
  );
  const actual = [
    ...result.supplier.transactions,
    ...result.ledger.transactions,
  ];
  assert.equal(actual.length, expected.length, 'source transaction count');
  for (const transaction of actual) {
    const row = expected.find(
      (r) =>
        r.side === transaction.side && r.reference === transaction.reference,
    );
    assert.ok(row, 'every transaction has an independent source observation');
    assert.equal(transaction.amount, row.minor, 'source amount and sign');
    assert.equal(transaction.date, row.date, 'source date');
  }
  const members = result.cases.flatMap((item) => [
    ...item.supplierMembers,
    ...item.ledgerMembers,
  ]);
  assert.equal(
    new Set(members.map((t) => t.id)).size,
    members.length,
    'no reused source item',
  );
  assert.deepEqual(
    members.map((t) => t.id).sort(),
    actual.map((t) => t.id).sort(),
    'cases partition all source items',
  );
  const integerSum = (values: number[]) =>
    values.reduce((total, value) => total + BigInt(value), 0n);
  assert.equal(
    integerSum(result.cases.map((item) => item.supplierTotal)),
    integerSum(c.sources[0].rows.map((row: { minor: number }) => row.minor)),
  );
  assert.equal(
    integerSum(result.cases.map((item) => item.ledgerTotal)),
    integerSum(c.sources[1].rows.map((row: { minor: number }) => row.minor)),
  );
  for (const item of result.cases) {
    assert.equal(
      BigInt(item.supplierTotal),
      integerSum(item.supplierMembers.map((t) => t.amount)),
    );
    assert.equal(
      BigInt(item.ledgerTotal),
      integerSum(item.ledgerMembers.map((t) => t.amount)),
    );
    assert.equal(item.variance, item.supplierTotal - item.ledgerTotal);
    if (item.status === 'Matched') assert.equal(item.variance, 0);
  }
}

test('metamorphic real CSV files preserve decisions after reordering columns and plain transaction rows', async () => {
  const original = fixture(),
    baseline = await pipeline(original);
  assert.deepEqual(
    baseline.sources.flatMap((s) => s.errors),
    [],
  );
  assert.equal(
    baseline.result.matches.length,
    original.oracle.permittedAutoMatches.length,
  );
  verifyPartitionAndAmounts(baseline.result, original);
  const variant = fixture();
  variant.sources[0].layout.columns = 'reordered';
  variant.sources[1].layout.columns = 'split';
  // These fixtures contain no running-balance sequence. Reordering is not asserted for such sequences.
  variant.sources[0].rows.reverse();
  variant.sources[1].rows.reverse();
  const changed = await pipeline(variant);
  assert.deepEqual(
    changed.sources.flatMap((s) => s.errors),
    [],
  );
  verifyPartitionAndAmounts(changed.result, variant);
  assert.deepEqual(
    economicSignature(changed.result),
    economicSignature(baseline.result),
  );
});

test('Arabic money digits, decimal comma and alternate explicit date formats preserve economic meaning', async () => {
  const original = fixture(),
    baseline = await pipeline(original),
    variant = fixture();
  variant.sources[0].layout.style = 'arabic-numerals';
  variant.sources[0].metadata.dateFormat = 'dmy';
  variant.sources[1].layout.style = 'comma-decimals';
  variant.sources[1].metadata.numberFormat = 'comma';
  variant.sources[1].metadata.dateFormat = 'mdy';
  const changed = await pipeline(variant);
  assert.deepEqual(
    changed.sources.flatMap((s) => s.errors),
    [],
  );
  verifyPartitionAndAmounts(changed.result, variant);
  assert.deepEqual(
    economicSignature(changed.result),
    economicSignature(baseline.result),
  );
});

test('determinism includes complete decisions, evidence, bridge and source row identities', async () => {
  const c = fixture(),
    { result, sources, scope } = await pipeline(c);
  for (let i = 0; i < 3; i++)
    assert.deepEqual(compare(sources[0], sources[1], scope), result);
  verifyPartitionAndAmounts(result, c);
});

test('a currency conflict cannot cross into automatic matches or a proven balance bridge', async () => {
  const c = fixture();
  c.sources[1].metadata.currency = 'USD';
  for (const row of c.sources[1].rows) row.currency = 'USD';
  let evaluated;
  try {
    evaluated = await pipeline(c);
  } catch (error) {
    assert.match(
      (error as Error).message,
      /لا توجد حركات كافية في أحد الطرفين|عملة|نطاق/,
    );
    return;
  }
  const { result, sources } = evaluated;
  assert.ok(sources[1].errors.length > 0 || result.diagnostics.length > 0);
  assert.equal(result.matches.length, 0);
  assert.equal(result.balanceComparable, false);
  assert.equal(result.bridge, null);
});

test('reference normalization collisions do not become identities merely because amounts agree', async () => {
  const c = fixture();
  c.sources[0].rows[0].reference = 'AB-12';
  c.sources[1].rows[0].reference = 'A-B12';
  const { result } = await pipeline(c);
  const matched = result.cases
    .filter((item) => item.status === 'Matched')
    .flatMap((item) => [...item.supplierMembers, ...item.ledgerMembers]);
  assert.ok(!matched.some((t) => ['AB-12', 'A-B12'].includes(t.reference)));
  verifyPartitionAndAmounts(result, c);
});

test('independent invariant probes detect deliberate source reuse, numeric alteration and sign inversion', async () => {
  const c = fixture(),
    { result } = await pipeline(c);
  verifyPartitionAndAmounts(result, c);
  const reused = structuredClone(result);
  reused.cases.push(structuredClone(reused.cases[0]));
  assert.throws(
    () => verifyPartitionAndAmounts(reused, c),
    /no reused source item/,
  );
  const amount = structuredClone(result);
  amount.supplier.transactions[0].amount += 1;
  assert.throws(
    () => verifyPartitionAndAmounts(amount, c),
    /source amount and sign/,
  );
  const sign = structuredClone(result);
  sign.supplier.transactions[0].amount *= -1;
  assert.throws(
    () => verifyPartitionAndAmounts(sign, c),
    /source amount and sign/,
  );
});

test('published file-size and parsed-row limits reject at import rather than returning partial success', async () => {
  await assert.rejects(
    () => readFile('oversize.csv', new ArrayBuffer(MAX_FILE_BYTES + 1)),
    /حجم الملف|MB/,
  );
  const rows =
    'Date,Reference,Amount\n' + '2026-07-01,INV-1,1.00\n'.repeat(MAX_ROWS + 31);
  await assert.rejects(
    () => readFile('too-many-rows.csv', new TextEncoder().encode(rows).buffer),
    /الحد/,
  );
});
