import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile as fsRead } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import {
  intercompanyTruth,
  intercompanyFixture,
  finishedIntercompany,
} from '../audit/intercompany/fixtures.ts';
import {
  replayIntercompany,
  saveIntercompany,
  restoreIntercompany,
  exportIntercompany,
} from '../lib/reconciliation/intercompany-io.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { readIntercompanyFile } from '../lib/reconciliation/intercompany-source.ts';
const directory = new URL('../work/intercompany/exports/', import.meta.url);
const contracts = JSON.parse(
  await fsRead(
    new URL('../audit/intercompany/export-contract.json', import.meta.url),
    'utf8',
  ),
) as { sheets: Record<string, string[]> };
void test('Intercompany IO: real asynchronous SHA cannot race original bytes or decision metadata into a financially accepted pair', async () => {
  const s = await intercompanyFixture('amount-difference');
  const { reconcileIntercompany } =
    await import('../lib/reconciliation/intercompany.ts');
  const r = reconcileIntercompany(s);
  assert.equal(r.pairs[0].residual, 1);
  s.events = r.pairs.map((p, i) => ({
    id: `RACE-${i}`,
    type: 'accept',
    relationId: p.relationId,
    memberIds: [p.left!.id, p.right!.id],
    context: r.context,
    at: '2026-10-06T00:00:00.000Z',
    reference: 'Original whole pair',
    note: 'Independent review',
  }));
  const oldBytes = s.files[0].original!;
  const replacement = new TextEncoder().encode(
    new TextDecoder().decode(oldBytes).replace('100.00', '099.99'),
  );
  assert.equal(replacement.byteLength, oldBytes.byteLength);
  const subtle = crypto.subtle;
  // oxlint-disable-next-line typescript/unbound-method -- Always invoked with apply(subtle, args) and restored unchanged.
  const originalDigest = subtle.digest;
  let calls = 0;
  subtle.digest = function (...args: Parameters<typeof originalDigest>) {
    const pending = originalDigest.apply(subtle, args); // Actual WebCrypto copies input; no fabricated digest.
    if (++calls === 2) new Uint8Array(oldBytes).set(replacement);
    return pending;
  };
  try {
    await assert.rejects(() => replayIntercompany(s), /IC_EVENT_FINANCIAL/);
  } finally {
    subtle.digest = originalDigest;
  }
  assert.notEqual(
    createHash('sha256').update(new Uint8Array(oldBytes)).digest('hex'),
    s.files[0].sha256,
  );
  // All later sources and metadata are captured before hashing source zero.
  const base = await finishedIntercompany('reciprocal-three-including-zero');
  const expected = structuredClone(base.result);
  calls = 0;
  subtle.digest = function (...args: Parameters<typeof originalDigest>) {
    const pending = originalDigest.apply(subtle, args);
    if (++calls === 1) {
      base.state.scope.policyVersion = 'CHANGED';
      base.state.events = [];
      new Uint8Array(base.state.files[1].original!).fill(0);
      base.state.files[2].name = 'changed.csv';
    }
    return pending;
  };
  try {
    const replay = await replayIntercompany(base.state);
    assert.deepEqual(replay.result, expected);
    for (const f of replay.state.files)
      assert.equal(
        createHash('sha256').update(new Uint8Array(f.original!)).digest('hex'),
        f.sha256,
      );
  } finally {
    subtle.digest = originalDigest;
  }
});
void test('Intercompany source read owns its input bytes across a real asynchronous digest', async () => {
  const s = await intercompanyFixture('pending');
  const old = s.files[0];
  const input = old.original!;
  const subtle = crypto.subtle;
  // oxlint-disable-next-line typescript/unbound-method -- Bound explicitly through apply and restored unchanged.
  const digest = subtle.digest;
  let calls = 0;
  subtle.digest = function (...args: Parameters<typeof digest>) {
    const p = digest.apply(subtle, args);
    if (++calls === 1) new Uint8Array(input).fill(0);
    return p;
  };
  try {
    const file = await readIntercompanyFile(old.name, input);
    assert.equal(file.sha256, old.sha256);
    assert.equal(file.sheets[0].rows[1][8], '100.00');
    assert.equal(
      createHash('sha256').update(new Uint8Array(file.original!)).digest('hex'),
      old.sha256,
    );
  } finally {
    subtle.digest = digest;
  }
});
void test('Intercompany source: an asynchronous read preserves the original snapshot and actual digest when its caller changes the buffer', async () => {
  const s = await intercompanyFixture('pending'),
    original = s.files[0].original!,
    oldHash = s.files[0].sha256;
  const changed = new TextEncoder().encode(
    new TextDecoder().decode(original).replace('100.00', '099.99'),
  );
  const subtle = crypto.subtle;
  // oxlint-disable-next-line typescript/unbound-method -- Explicit receiver and exact restoration.
  const digest = subtle.digest;
  let calls = 0;
  subtle.digest = function (...args: Parameters<typeof digest>) {
    const pending = digest.apply(subtle, args);
    if (++calls === 1) new Uint8Array(original).set(changed);
    return pending;
  };
  try {
    const f = await readIntercompanyFile(s.files[0].name, original);
    assert.equal(f.sha256, oldHash);
    assert.equal(f.sheets[0].rows[1][8], '100.00');
    assert.equal(
      createHash('sha256').update(new Uint8Array(f.original!)).digest('hex'),
      oldHash,
    );
  } finally {
    subtle.digest = digest;
  }
});
void test('Intercompany IO: every non-reject pre-engine contract rereads four originals, roundtrips sessions and retains all16 export sheets', async () => {
  await mkdir(directory, { recursive: true });
  for (const c of intercompanyTruth.cases) {
    if (c.reject) continue;
    const { state, result } = await finishedIntercompany(c.name);
    assert.deepEqual((await replayIntercompany(state)).result, result, c.name);
    const restored = await restoreIntercompany(await saveIntercompany(state));
    assert.deepEqual(restored.result, result, c.name);
    for (const [suffix, s, r] of [
      ['direct', state, result],
      ['restored', restored.state, restored.result],
    ] as const) {
      const data = await exportIntercompany(s, r);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(data);
      assert.deepEqual(
        book.worksheets.map((s) => s.name),
        Object.keys(contracts.sheets),
        c.name,
      );
      for (const sheet of book.worksheets)
        assert.deepEqual(
          (sheet.getRow(1).values as unknown[]).slice(1),
          contracts.sheets[sheet.name],
        );
      await writeFile(
        new URL(`${c.name}-${suffix}.xlsx`, directory),
        new Uint8Array(data),
      );
    }
  }
});
void test('Intercompany IO: invented cached rows cannot replace originals, changed hashes and stale exports fail', async () => {
  const { state, result } = await finishedIntercompany(
    'reciprocal-three-including-zero',
  );
  state.files[0].sheets[0].rows[1][8] = '999999';
  assert.deepEqual((await replayIntercompany(state)).result, result);
  const stale = structuredClone(result);
  stale.pairs[0].residual = 1;
  await assert.rejects(
    () => exportIntercompany(state, stale),
    /IC_STALE_EXPORT/,
  );
  state.files[0].original = new TextEncoder().encode('invented').buffer;
  await assert.rejects(() => replayIntercompany(state), /IC_SOURCE_HASH/);
});
void test('Intercompany IO: strict sessions reject cache injection, bad base64/version, hash/source reuse and changed context', async () => {
  const { state } = await finishedIntercompany(
    'reciprocal-three-including-zero',
  );
  const p = JSON.parse(new TextDecoder().decode(await saveIntercompany(state)));
  const run = (v: unknown) =>
    restoreIntercompany(new TextEncoder().encode(JSON.stringify(v)).buffer);
  await assert.rejects(
    () => run({ ...p, result: { status: 'consistent-with-evidence' } }),
    /IC_SESSION/,
  );
  for (const [edit, code] of [
    [
      (v: typeof p) => {
        v.files[0].cache = [];
      },
      'SESSION',
    ],
    [
      (v: typeof p) => {
        v.version = 'later';
      },
      'SESSION',
    ],
    [
      (v: typeof p) => {
        v.files[0].data += '!';
      },
      'SESSION',
    ],
    [
      (v: typeof p) => {
        v.files[0].sha256 = '0'.repeat(64);
      },
      'SOURCE_HASH',
    ],
    [
      (v: typeof p) => {
        v.files[1] = { ...v.files[0] };
      },
      'INDEPENDENT_SOURCES',
    ],
    [
      (v: typeof p) => {
        v.scope.policyVersion = 'CHANGED';
      },
      'EVENT_CONTEXT',
    ],
  ] as const) {
    const v = structuredClone(p);
    edit(v);
    await assert.rejects(() => run(v), new RegExp(`IC_${code}`));
  }
});
async function nativeState() {
  const s = await intercompanyFixture('pending');
  for (let i = 0; i < 4; i++) {
    const bytes = await fsRead(
      new URL(`../audit/intercompany/native/source-${i}.xlsx`, import.meta.url),
    );
    s.files[i] = await readIntercompanyFile(
      `source-${i}.xlsx`,
      Uint8Array.from(bytes).buffer,
    );
  }
  return s;
}
void test('Intercompany IO: four pre-engine native originals roundtrip and retain exact exported bytes', async () => {
  const { state, result } = await replayIntercompany(await nativeState());
  assert.equal(result.status, 'needs-review');
  assert.equal(result.totals![0].debit, 10000);
  const restored = await restoreIntercompany(await saveIntercompany(state));
  assert.deepEqual(restored.result, result);
  for (const [suffix, s, r] of [
    ['direct', state, result],
    ['restored', restored.state, restored.result],
  ] as const)
    await writeFile(
      new URL(`native-pending-${suffix}.xlsx`, directory),
      new Uint8Array(await exportIntercompany(s, r)),
    );
});
void test('Intercompany IO: native visibility, literal money/identity/date and rich-text counterexamples reject at every original action', async () => {
  const base = await nativeState();
  const { result } = await replayIntercompany(base);
  const first = base.files[0].original!;
  const variants: [string, string, (s: string) => string][] = [
    [
      'white',
      'xl/styles.xml',
      (s) => s.replace('color theme="1"', 'color rgb="FFFFFFFF"'),
    ],
    [
      'hidden',
      'xl/worksheets/sheet1.xml',
      (s) => s.replace('<row r="2"', '<row r="2" hidden="1"'),
    ],
    [
      'formula',
      'xl/worksheets/sheet1.xml',
      (s) => s.replace('<v>100</v>', '<f>100</f><v>100</v>'),
    ],
    [
      'identity-number',
      'xl/worksheets/sheet1.xml',
      (s) =>
        s.replace(
          '<c r="F2" t="inlineStr"><is><t>A-001</t></is></c>',
          '<c r="F2"><v>1</v></c>',
        ),
    ],
    [
      'money-text',
      'xl/worksheets/sheet1.xml',
      (s) =>
        s.replace(
          '<c r="I2" s="1" t="n"><v>100</v></c>',
          '<c r="I2" t="inlineStr"><is><t>100.00</t></is></c>',
        ),
    ],
    [
      'rich-inline',
      'xl/worksheets/sheet1.xml',
      (s) => s.replace('<is><t>A-001</t></is>', '<is><r><t>A-001</t></r></is>'),
    ],
  ];
  const bad = await fsRead(
    new URL(
      '../audit/intercompany/regressions/native-white-font.xlsx',
      import.meta.url,
    ),
  );
  const fractional = await fsRead(
    new URL(
      '../audit/intercompany/regressions/native-fractional-date.xlsx',
      import.meta.url,
    ),
  );
  const originals: [string, ArrayBuffer][] = [
    ['independent-fractional-date', Uint8Array.from(fractional).buffer],
    ['independent-white', Uint8Array.from(bad).buffer],
  ];
  for (const [name, path, edit] of variants) {
    const zip = await JSZip.loadAsync(first);
    const old = await zip.file(path)!.async('string');
    const changed = edit(old);
    assert.notEqual(changed, old, name);
    zip.file(path, changed);
    originals.push([name, await zip.generateAsync({ type: 'arraybuffer' })]);
  }
  for (const [name, data] of originals) {
    // Read the exact changed bytes with the legacy reader to give fresh actions
    // a structurally valid candidate; never bypass the new family boundary.
    const s = structuredClone(base);
    s.files[0] = await readFile(`${name}.xlsx`, data);
    const payload = {
      format: 'tarasuf-intercompany-session',
      version: result.version,
      files: s.files.map((f) => ({
        name: f.name,
        sha256: f.sha256,
        data: Buffer.from(f.original!).toString('base64'),
      })),
      readings: s.readings,
      scope: s.scope,
      completeness: s.completeness,
      events: [],
    };
    const actions = [
      () => replayIntercompany(s),
      () => saveIntercompany(s),
      () =>
        restoreIntercompany(
          new TextEncoder().encode(JSON.stringify(payload)).buffer,
        ),
      () => exportIntercompany(s, result),
      () => readIntercompanyFile(`${name}.xlsx`, data),
    ];
    for (const action of actions)
      await assert.rejects(
        action,
        /IC_NATIVE_DISPLAY|BANK_NATIVE_DISPLAY/,
        name,
      );
  }
});
void test('Intercompany IO: oversized cell evidence rejects before allocating an export workbook', async () => {
  const s = await intercompanyFixture('pending');
  const line = Array.from({ length: 100 }, () => 'x').join(',');
  const csv = Array.from({ length: 10500 }, () => line).join('\n');
  s.files[0] = await readIntercompanyFile(
    'many-columns.csv',
    new TextEncoder().encode(csv).buffer,
  );
  const { state, result } = await replayIntercompany(s);
  assert.ok(result.cells.length > 1_048_575);
  const Original = ExcelJS.Workbook;
  let constructions = 0;
  ExcelJS.Workbook = class {
    constructor() {
      constructions++;
      throw Error('Workbook must not be allocated');
    }
  } as unknown as typeof ExcelJS.Workbook;
  try {
    await assert.rejects(
      () => exportIntercompany(state, result),
      /IC_EXPORT_ROWS/,
    );
    assert.equal(constructions, 0);
  } finally {
    ExcelJS.Workbook = Original;
  }
});
void test('Intercompany IO: whole rejection retains malformed physical contenders through original replay/session/export', async () => {
  const state = await intercompanyFixture('malformed-duplicate-contender');
  const { reconcileIntercompany } =
    await import('../lib/reconciliation/intercompany.ts');
  const result = reconcileIntercompany(state),
    pair = result.pairs.find((p) => p.relationId === 'R-001')!;
  assert.equal(pair.members.length, 3);
  assert.deepEqual(
    pair.members.map((m) => [m.source, m.row, m.net]),
    [
      [0, 2, 10000],
      [0, 5, null],
      [1, 2, -10000],
    ],
  );
  const event = {
    id: 'PHYSICAL-REJECT',
    type: 'reject' as const,
    relationId: pair.relationId,
    memberIds: pair.members.map((m) => m.id),
    context: result.context,
    at: '2026-10-07T00:00:00.000Z',
    reference: 'Independent malformed ledger review',
    note: 'Reject all three actual ledger records including the unparsed contender',
  };
  state.events = [{ ...event, memberIds: [pair.left!.id, pair.right!.id] }];
  await assert.rejects(() => replayIntercompany(state), /IC_EVENT_MEMBERS/);
  state.events = [event];
  const reviewed = await replayIntercompany(state);
  assert.equal(reviewed.result.status, 'source-error');
  assert.equal(reviewed.result.pairs[0].review, 'rejected');
  const session = await saveIntercompany(state),
    restored = await restoreIntercompany(session);
  assert.deepEqual(restored.result, reviewed.result);
  const book = await exportIntercompany(restored.state, restored.result);
  await mkdir(
    new URL('../work/intercompany/physical-closure/', import.meta.url),
    { recursive: true },
  );
  await writeFile(
    new URL(
      '../work/intercompany/physical-closure/full-physical-reject.xlsx',
      import.meta.url,
    ),
    new Uint8Array(book),
  );
  await writeFile(
    new URL(
      '../work/intercompany/physical-closure/full-physical-reject-session.json',
      import.meta.url,
    ),
    new Uint8Array(session),
  );
  state.events = [{ ...event, type: 'accept' }];
  await assert.rejects(() => replayIntercompany(state), /IC_EVENT_FINANCIAL/);
});
