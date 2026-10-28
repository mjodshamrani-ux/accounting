// INV-2 engine run: inventory-movement-bridge-1 on sealed stories through the
// replay from bytes, compared with the sealed EXPECTED.json in full: the
// refusal, or every position's status, codes, components, lines and rows,
// every account's status, codes and sides, the excluded and dated lines, the
// unseen origins, the repeated headers, the unplaced rows, the totals and the
// run codes.
//
//   node --experimental-strip-types audit/inventory-movement-foundation/engine-run.mjs [--out name] [--assert name]
//
// IMB_SUITE selects another sealed suite (a holdout) with the same layout;
// --out and --assert name a file in that suite's results/.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const suite = resolve(
  root,
  process.env.IMB_SUITE ?? 'audit/inventory-movement-foundation',
);
const FROZEN = resolve(suite, 'frozen');
const { replayMovementBridge } = await import(
  pathToFileURL(
    resolve(root, 'lib/reconciliation/inventory-movement-bridge-io.ts'),
  ).href
);
const { IMB_ROLES, IMB_VERSION } = await import(
  pathToFileURL(
    resolve(root, 'lib/reconciliation/inventory-movement-bridge.ts'),
  ).href
);

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const int = (v) => {
  if (v === null) return null;
  const n = BigInt(v);
  return n <= BigInt(Number.MAX_SAFE_INTEGER) &&
    n >= -BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(n)
    : v;
};
const ints = (o) =>
  o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, int(v)]));

function asExpected(r) {
  if (r.refused) return { refused: r.refused };
  const positions = {};
  for (const p of r.positions)
    positions[p.key] = {
      status: p.status,
      codes: p.codes,
      unit: p.unit,
      account: p.account,
      opening: ints(p.opening),
      closing: ints(p.closing),
      flows:
        p.flows &&
        Object.fromEntries(
          Object.entries(p.flows).map(([k, v]) => [k, ints(v)]),
        ),
      computed: ints(p.computed),
      lines:
        p.lines &&
        p.lines.map((l) => [l.id, l.kind, int(l.quantity), int(l.value)]),
      rows: p.rows,
    };
  const accounts = {};
  for (const a of r.accounts)
    accounts[a.account] = {
      status: a.status,
      codes: a.codes,
      register: ints(a.register),
      gl: ints(a.gl),
      difference: ints(a.difference),
    };
  return {
    positions,
    accounts,
    excluded: r.excluded.map((x) => [x.row, x.id]),
    datedOutside: r.datedOutside.map((x) => [x.row, x.id]),
    unseenOrigins: r.unseenOrigins.map((x) => [x.row, x.id, x.origin]),
    repeatedHeaders: r.repeatedHeaders.map((x) => [x.file, x.row]),
    unplaced: r.unplaced.map((x) => [x.file, x.row, x.code]),
    totals: ints(r.totals),
    run: r.run,
  };
}

// Deep equality with key order ignored, and the first path that differs.
function differs(a, b, path = '') {
  if (a === b) return null;
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  )
    return path || '(root)';
  if (Array.isArray(a) !== Array.isArray(b)) return path || '(root)';
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(
    byText,
  );
  for (const k of keys) {
    const d = differs(a[k], b[k], `${path}/${k}`);
    if (d) return d;
  }
  return null;
}

const buffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

async function main() {
  const { values: args } = parseArgs({
    options: { out: { type: 'string' }, assert: { type: 'string' } },
  });
  const expected = JSON.parse(
    readFileSync(resolve(FROZEN, 'EXPECTED.json'), 'utf8'),
  ).stories;
  const ids = readdirSync(FROZEN)
    .filter((n) => n.endsWith('-scope.json'))
    .map((n) => n.slice(0, -'-scope.json'.length))
    .sort(byText);
  const stories = {};
  for (const id of ids) {
    const fields = JSON.parse(
      readFileSync(resolve(FROZEN, `${id}-scope.json`), 'utf8'),
    );
    let got;
    try {
      const { result } = await replayMovementBridge({
        files: ['register', 'gl'].map((part) => ({
          name: `${id}-${part}.csv`,
          original: buffer(readFileSync(resolve(FROZEN, `${id}-${part}.csv`))),
        })),
        readings: IMB_ROLES.map((role) => ({
          role,
          family: IMB_VERSION,
          confirmed: true,
        })),
        scope: { confirmed: true, fields },
      });
      got = asExpected(result);
    } catch (error) {
      got = { thrown: String(error.message) };
    }
    const where = differs(got, expected[id]);
    stories[id] = where
      ? {
          equal: false,
          firstDifference: where,
          engine: got,
          expected: expected[id],
        }
      : { equal: true };
  }
  const equal = Object.values(stories).filter((s) => s.equal).length;
  const record = {
    schema: 'tarasuf-inv2-movement-bridge-engine-run/1',
    family: IMB_VERSION,
    suite: process.env.IMB_SUITE ?? 'audit/inventory-movement-foundation',
    rule: 'equal to EXPECTED.json in full',
    equal,
    of: ids.length,
    stories,
  };
  const text = JSON.stringify(record, null, 1) + '\n';
  if (args.out) writeFileSync(resolve(suite, 'results', args.out), text);
  if (args.assert) {
    const want = readFileSync(resolve(suite, 'results', args.assert), 'utf8');
    if (want !== text) {
      console.error('the engine run differs from its record');
      process.exit(1);
    }
  }
  console.log(JSON.stringify({ equal, of: ids.length }));
  for (const [id, s] of Object.entries(stories))
    if (!s.equal) console.log(id, s.firstDifference);
}

await main();
