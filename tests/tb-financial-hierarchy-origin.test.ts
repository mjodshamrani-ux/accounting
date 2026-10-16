import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectFinancialHierarchySource4 as inspect } from '../lib/reconciliation/tb-financial-hierarchy-source.ts';
import {
  FIN_HIERARCHY_SCOPE_HEADERS as SCOPE,
  type FinancialHierarchyScope,
} from '../lib/reconciliation/tb-financial-hierarchy-contract.ts';

const contract = JSON.parse(
  await readFile(
    new URL('../audit/tb-financial-hierarchy/contract.json', import.meta.url),
    'utf8',
  ),
);
const scope: FinancialHierarchyScope = contract.scope;
const header = [
  'Node ID',
  'Parent ID',
  'Kind',
  'Line label',
  'Line class',
  'Amount',
  ...SCOPE,
];
const quote = (s: string) =>
  /[,"\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
function make(rows: string[][], ending = '\n') {
  return (
    [header, ...rows.map((r) => [...r, ...SCOPE.map((key) => scope[key])])]
      .map((r) => r.map(quote).join(','))
      .join(ending) + ending
  );
}
const leaf = (id = '001', label = 'Cash'): string[] => [
  id,
  '',
  'leaf',
  label,
  'current-asset',
  '0.00',
];
const encode = (text: string) => new TextEncoder().encode(text).buffer;
const hash = (original: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(original)).digest('hex');
const run = (text: string) =>
  inspect({ name: 'origin.csv', original: encode(text), expectedScope: scope });

void test('original bytes, trusted scope and name are captured synchronously before hashing awaits', async () => {
  const initial = make([leaf()]);
  const original = encode(initial);
  const expectedHash = hash(original);
  const mutableScope = { ...scope };
  const input = { name: 'captured.csv', original, expectedScope: mutableScope };
  const pending = inspect(input);
  new Uint8Array(original).fill(88);
  input.original = encode('foreign');
  input.name = 'foreign.xlsx';
  mutableScope.Entity = 'FOREIGN';
  const result = await pending;
  assert.equal(result.status, 'inspected');
  assert.equal(result.source?.name, 'captured.csv');
  assert.equal(result.scope?.Entity, scope.Entity);
  assert.equal(result.source?.sha256, expectedHash);
  assert.equal(
    result.source?.byteLength,
    new TextEncoder().encode(initial).byteLength,
  );
  assert.notEqual(result.source?.original, original);
  assert.equal(new TextDecoder().decode(result.source!.original), initial);
  assert.equal(hash(result.source!.original), expectedHash);
  assert.ok(result.citations.every((c) => c.sha256 === expectedHash));
});

void test('cache, supplied hash and hidden node lookups cannot replace serialized authority', async () => {
  const input = {
    name: 'real.csv',
    original: encode(make([leaf('__proto__')])),
    expectedScope: scope,
    sha256: '0'.repeat(64),
    get sheets(): never {
      throw Error('CACHE_MUST_NOT_BE_READ');
    },
  };
  const r = await inspect(input);
  assert.equal(r.status, 'inspected');
  assert.notEqual(r.source?.sha256, input.sha256);
  assert.equal(r.nodes[0].id, '__proto__');
  assert.equal(
    r.citations.find((c) => c.row === 2 && c.field === 'Node ID')?.raw,
    '__proto__',
  );
});

void test('CSV record citations preserve CRLF, quoted multiline, commas and doubled quotes', async () => {
  const label = 'نقد، "branch", one\r\ntwo\nthree\rfour';
  const text = make([leaf('0010', label), leaf('001')], '\r\n');
  const r = await run(text);
  assert.equal(r.status, 'inspected');
  assert.deepEqual(
    r.inventory.map((v) => v.row),
    [2, 3],
  );
  assert.equal(
    r.inventory[0].serialized.includes('\r\ntwo\nthree\rfour'),
    true,
  );
  assert.equal(r.nodes[0].label, label);
  assert.equal(r.nodes[1].row, 3);
  const cite = r.citations.find(
    (c) => c.row === 2 && c.field === 'Line label',
  )!;
  assert.equal(cite.column, 4);
  assert.equal(cite.raw, label);
  assert.equal(cite.lexeme, quote(label));
  assert.equal(cite.sourceRole, 'financial-position');
  assert.equal(cite.sha256, hash(encode(text)));
  assert.equal(
    r.citations.find((c) => c.row === 1 && c.column === 4)?.raw,
    'Line label',
  );
  assert.equal(r.inventory[1].raw[0], '001');
  assert.deepEqual(
    r.inventory[0].citationIndices.map((i) => r.citations[i].raw),
    r.inventory[0].raw,
  );
});

void test('UTF-8 is fatal on invalid bytes and a BOM header is blocked without stripping evidence', async () => {
  const bom = await run('\ufeff' + make([leaf()]));
  assert.equal(bom.status, 'blocked');
  assert.ok(bom.issues.some((i) => i.code === 'HEADERS'));
  assert.equal(bom.header?.[0], '\ufeffNode ID');
  assert.equal(bom.citations[0].raw, '\ufeffNode ID');
  assert.equal(bom.inventory.length, 1);
  for (const bytes of [[0xc0, 0xaf], [0xff], [0xe2, 0x82]]) {
    const r = await inspect({
      name: 'bad.csv',
      original: Uint8Array.from(bytes).buffer,
      expectedScope: scope,
    });
    assert.equal(r.status, 'blocked');
    assert.ok(r.issues.some((i) => i.code === 'UTF8'));
    assert.equal(r.inventoryState.complete, false);
    assert.equal(r.source?.sha256, hash(Uint8Array.from(bytes).buffer));
  }
});

void test('Unicode field cap counts code points separately from byte and UTF-16 lengths', async () => {
  for (const count of [1999, 2000]) {
    const r = await run(make([leaf('L', '😀'.repeat(count))]));
    assert.equal(r.status, 'inspected');
    assert.equal(r.nodes[0].label.length, count * 2);
    assert.ok(r.source!.byteLength > count * 4);
  }
  const r = await run(make([leaf('L', '😀'.repeat(2001)), leaf('late')]));
  assert.equal(r.status, 'blocked');
  assert.equal(r.inventoryState.complete, false);
  assert.equal(r.inventoryState.reason, 'TEXT');
  assert.equal(r.inventory.length, 1);
  const issue = r.issues.find(
    (i) => i.code === 'TEXT' && i.field === 'Line label',
  )!;
  assert.equal(
    Array.from(r.citations[issue.citationIndices[0]].raw).length,
    2001,
  );
});

void test('byte cap permits 131071/131072 and refuses 131073 before copying or hashing', async () => {
  function exact(size: number) {
    const rows = Array.from({ length: 100 }, (_, i) => leaf(`N${i}`, ''));
    let remaining = size - new TextEncoder().encode(make(rows)).length;
    for (const row of rows) {
      const length = Math.min(remaining, 2000);
      row[3] = 'x'.repeat(length);
      remaining -= length;
    }
    assert.equal(remaining, 0);
    const text = make(rows);
    assert.equal(new TextEncoder().encode(text).length, size);
    return text;
  }
  for (const size of [131071, 131072]) {
    const r = await run(exact(size));
    assert.equal(r.status, 'inspected');
    assert.equal(r.source?.byteLength, size);
    assert.equal(r.inventory.length, 100);
  }
  const r = await run(exact(131073));
  assert.equal(r.status, 'blocked');
  assert.ok(r.issues.some((i) => i.code === 'BYTES'));
  assert.equal(r.source, null);
  assert.equal(r.inventoryState.complete, false);
  assert.equal(r.inventoryState.reason, 'BYTES');
});

void test('header/width errors inventory all bounded records including extra cells and late faults', async () => {
  const text = make([leaf('A'), leaf('B')]);
  const lines = text.trimEnd().split('\n');
  lines[2] += ',unclaimed';
  const r = await run(lines.join('\n') + '\n');
  assert.equal(r.status, 'blocked');
  assert.equal(r.inventoryState.complete, true);
  assert.equal(r.inventory.length, 2);
  assert.equal(r.inventory[1].raw.at(-1), 'unclaimed');
  const extra = r.citations.find((c) => c.row === 3 && c.column === 19)!;
  assert.equal(extra.field, null);
  assert.equal(extra.raw, 'unclaimed');
  assert.ok(r.issues.some((i) => i.code === 'WIDTH' && i.row === 3));
  for (const bad of [
    text.replace('Node ID,', 'Node ID;'),
    text.replace('Parent ID', 'Node ID'),
    text.replace('Line label', ' Line label'),
  ]) {
    const r = await run(bad);
    assert.equal(r.status, 'blocked');
    assert.equal(r.inventory.length, 2);
    assert.ok(r.issues.some((i) => i.code === 'HEADERS'));
    assert.equal(r.inventoryState.complete, true);
  }
});

void test('malformed quote aborts explicitly and preserves the captured source and completed record prefix', async () => {
  for (const suffix of ['"unterminated', 'un"quoted', '"closed" junk']) {
    const text = make([leaf('A')]) + suffix;
    const r = await run(text);
    assert.equal(r.status, 'blocked');
    assert.equal(r.inventoryState.complete, false);
    assert.equal(r.inventoryState.reason, 'CSV');
    assert.equal(r.inventory.length, 1);
    assert.equal(new TextDecoder().decode(r.source!.original), text);
    assert.ok(r.issues.some((i) => i.code === 'CSV' && i.row === 3));
  }
});

void test('invalid runtime containers, scope and file names always block without throwing', async () => {
  const good = {
    name: 'valid.csv',
    original: encode(make([leaf()])),
    expectedScope: scope,
  };
  const invalid: unknown[] = [
    null,
    undefined,
    [],
    {},
    { ...good, original: new Uint8Array([1, 2]) },
    { ...good, original: new ArrayBuffer(0) },
    { ...good, name: 'report.xlsx' },
    { ...good, name: 'report.pdf' },
    { ...good, name: 42 },
    { ...good, expectedScope: undefined },
    { ...good, expectedScope: { ...scope, unexpected: 'value' } },
    { ...good, expectedScope: { ...scope, Entity: true } },
  ];
  for (const input of invalid) {
    const r = await inspect(input as Parameters<typeof inspect>[0]);
    assert.equal(r.status, 'blocked');
    assert.ok(r.issues.length > 0);
    assert.equal(r.leafSums, null);
  }
  const detached = encode(make([leaf()]));
  structuredClone(detached, { transfer: [detached] });
  assert.equal(
    (await inspect({ ...good, original: detached })).status,
    'blocked',
  );
});

void test('local CLI is deterministic, bounded, read-only on inputs and emits decimal bigint strings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fin-source4-'));
  try {
    const csvPath = join(directory, 'source.csv'),
      scopePath = join(directory, 'scope.json');
    await writeFile(csvPath, make([leaf()]));
    await writeFile(scopePath, JSON.stringify(scope));
    const before = await readFile(csvPath);
    const invoke = (...args: string[]) =>
      spawnSync(
        process.execPath,
        [
          '--experimental-strip-types',
          new URL(
            '../scripts/inspect-financial-hierarchy-source4.mjs',
            import.meta.url,
          ).pathname,
          ...args,
        ],
        { encoding: 'utf8', maxBuffer: 1024 * 1024 },
      );
    const first = invoke(csvPath, scopePath),
      second = invoke(csvPath, scopePath);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, second.stdout);
    const result = JSON.parse(first.stdout);
    assert.equal(result.leafSums.assetsMinor, '0');
    assert.equal(result.source.original, undefined);
    assert.equal(
      result.source.sha256,
      createHash('sha256').update(before).digest('hex'),
    );
    assert.equal(result.scope.Entity, scope.Entity);
    assert.equal(result.inventory[0].raw[0], '001');
    const output = join(directory, 'result.json');
    assert.equal(invoke(csvPath, scopePath, output).status, 0);
    assert.equal(await readFile(output, 'utf8'), first.stdout);
    assert.equal(invoke(csvPath, scopePath, output).status, 1);
    assert.deepEqual(await readFile(csvPath), before);
    assert.equal(invoke(csvPath, scopePath, csvPath).status, 1);
    const forbidden = new URL('../fin-source4-forbidden.json', import.meta.url)
      .pathname;
    const badOutput = invoke(csvPath, scopePath, forbidden);
    assert.equal(badOutput.status, 1);
    assert.match(badOutput.stderr, /OUTPUT_MUST_BE_OUTSIDE_SOURCE_TREE/);
    await assert.rejects(() => stat(forbidden));
    await writeFile(csvPath, new Uint8Array(131073));
    const oversized = invoke(csvPath, scopePath);
    assert.equal(oversized.status, 1);
    assert.match(oversized.stderr, /INPUT_BYTE_LIMIT/);
    await writeFile(csvPath, make([['X', '', 'unknown', '', '', '']]));
    const blocked = invoke(csvPath, scopePath);
    assert.equal(blocked.status, 2);
    assert.equal(JSON.parse(blocked.stdout).status, 'blocked');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
