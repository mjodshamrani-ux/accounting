// PG-1 engine run: payment-gateway-batches-1 through the product's replay
// from bytes, on every sealed story, compared with the sealed expectations in
// full: the refusal and the decimals, every batch (its settlement row,
// members by row, components, settlement values, paid amount, payouts,
// status and reasons), every payout (its lines, batches, amount, credit,
// status and reasons), every unlinked credit, and the five source hashes. The
// dense stories are regenerated and checked against the seal first, and
// judged against the oracle's output, itself checked against the sealed
// expectation hash.
//
// A refusal thrown before any result carries no hashes or decimals of its
// own: the run then takes the hashes of the bytes it gave, and the decimals
// from the engine's own scope check once READING and SCOPE pass.
//
//   node --experimental-strip-types audit/payment-gateway-batches-foundation/engine-run.mjs [--out name] [--assert name]
//
// PG_BATCHES_SUITE selects another sealed suite (a holdout) with the same
// layout and no dense stories; --out and --assert name a file in that suite's
// results/.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const SUITE = process.env.PG_BATCHES_SUITE;
const suite = SUITE ? resolve(root, SUITE) : here;
const FROZEN = join(suite, 'frozen');
const lib = (name) =>
  pathToFileURL(join(root, 'lib/reconciliation', name)).href;
const { PG_BATCHES_VERSION, gatewayBatchesPlaces } = await import(
  lib('payment-gateway-batches.ts')
);
const { replayGatewayBatches } = await import(
  lib('payment-gateway-batches-io.ts')
);

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const buffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

export function input(folder, sid) {
  const given = JSON.parse(
    readFileSync(join(folder, `${sid}-input.json`), 'utf8'),
  );
  const files = given.names.map((name) => {
    const bytes = readFileSync(join(folder, name));
    return {
      name,
      original: buffer(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
  return { files, readings: given.readings, scope: given.scope };
}

export function asExpected(r) {
  return {
    refused: r.refused,
    decimals: r.decimals,
    batches: r.batches,
    payouts: r.payouts,
    credits: r.credits,
    sha256: r.sources.map((s) => s.sha256),
  };
}

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
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(
    byText,
  )) {
    const d = differs(a[k], b[k], `${path}/${k}`);
    if (d) return d;
  }
  return null;
}

async function judge(folder, sid, want) {
  const given = input(folder, sid);
  let got;
  try {
    got = asExpected((await replayGatewayBatches(given)).result);
  } catch (error) {
    const message = String(error?.message ?? error);
    if (!message.startsWith('PG_BATCHES_'))
      return { equal: false, firstDifference: `(threw) ${message}` };
    const refused = message.slice('PG_BATCHES_'.length);
    let decimals = null;
    try {
      decimals = gatewayBatchesPlaces(given.readings, given.scope);
    } catch {
      decimals = null;
    }
    got = {
      refused,
      decimals,
      batches: [],
      payouts: [],
      credits: [],
      sha256: given.files.map((f) => f.sha256),
    };
  }
  const where = differs(got, want);
  return where
    ? { equal: false, refused: got.refused, firstDifference: where }
    : { equal: true };
}

async function dense(stories) {
  const dir = mkdtempSync(join(tmpdir(), 'pg1-dense-'));
  try {
    execFileSync('python3', ['-B', join(here, 'dense.py'), dir], {
      stdio: 'ignore',
    });
    const raw = execFileSync(
      'python3',
      ['-B', join(here, 'oracle.py'), '--dense', dir],
      { maxBuffer: 1 << 30 },
    );
    const sealed = JSON.parse(
      readFileSync(join(FROZEN, 'DENSE-MANIFEST.json'), 'utf8'),
    ).expectedSha256;
    if (createHash('sha256').update(raw).digest('hex') !== sealed)
      throw Error('the dense expectations differ from the seal');
    const judged = JSON.parse(raw.toString()).stories;
    for (const sid of Object.keys(judged).sort(byText))
      stories[sid] = await judge(dir, sid, judged[sid]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const { values: args } = parseArgs({
    options: { out: { type: 'string' }, assert: { type: 'string' } },
  });
  const focused = JSON.parse(
    readFileSync(join(FROZEN, 'EXPECTED.json'), 'utf8'),
  ).stories;
  const stories = {};
  for (const sid of Object.keys(focused).sort(byText))
    stories[sid] = await judge(FROZEN, sid, focused[sid]);
  if (!SUITE) await dense(stories);
  const equal = Object.values(stories).filter((s) => s.equal).length;
  const record = {
    schema: 'tarasuf-pg1-engine-run/1',
    family: PG_BATCHES_VERSION,
    ...(SUITE ? { suite: SUITE } : {}),
    rule: 'equal to the sealed expectations in full',
    equal,
    of: Object.keys(stories).length,
    stories,
  };
  const text = JSON.stringify(record, null, 1) + '\n';
  if (args.out) writeFileSync(join(suite, 'results', args.out), text);
  if (
    args.assert &&
    readFileSync(join(suite, 'results', args.assert), 'utf8') !== text
  ) {
    console.error('the engine run differs from its record');
    process.exit(1);
  }
  console.log(JSON.stringify({ equal, of: record.of }));
  for (const [sid, s] of Object.entries(stories))
    if (!s.equal) console.log(sid, s.refused ?? '', s.firstDifference);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
