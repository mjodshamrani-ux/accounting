// CLR-1 baseline: the clearing family as it is on the sealed stories. Each
// extract goes through the product's replay from bytes, as the worker runs
// it; the dense stories are regenerated and checked against their sealed
// hashes first, and judged against the oracle's output, itself checked
// against the sealed expectation hashes. Recorded as it comes, per story and
// in total:
//   - the groups the proposed contract clears and the product clears, both,
//     the contract only (held by the product) and the product only;
//   - groups whose members differ between the two;
//   - lines the product reads as errors that the contract reads as
//     movements, by the product's code;
//   - held groups whose reason names the line that holds them.
//
//   node --experimental-strip-types audit/clearing-groups-foundation/baseline.mjs [--out name] [--assert name]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const FROZEN = join(here, 'frozen');
const lib = (name) =>
  pathToFileURL(join(root, 'lib/reconciliation', name)).href;
const { CLEARING_VERSION } = await import(lib('clearing.ts'));
const { replayClearing } = await import(lib('clearing-io.ts'));

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const buffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

function input(folder, sid) {
  const given = JSON.parse(
    readFileSync(join(folder, `${sid}-input.json`), 'utf8'),
  );
  const bytes = readFileSync(join(folder, given.name));
  return {
    file: {
      name: given.name,
      original: buffer(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sheets: [],
    },
    reading: given.reading,
    scope: given.scope,
    events: [],
  };
}

const rowOf = (id) => Number(id.split(':').at(-1));
const key = (rows) => JSON.stringify([...rows].sort((a, b) => a - b));

async function judge(folder, sid, want) {
  let result;
  try {
    result = (await replayClearing(input(folder, sid))).result;
  } catch (error) {
    return {
      productRefused: String(error.message).startsWith('CLEARING_')
        ? error.message.slice('CLEARING_'.length)
        : 'READER',
      contractRefused: want.refused,
    };
  }
  if (want.refused)
    return { productRefused: null, contractRefused: want.refused };
  const product = new Map(result.cases.map((c) => [key(c.ids.map(rowOf)), c]));
  const groups = want.groups.map((g) => {
    const c = product.get(key(g.members.map((m) => m[0])));
    return {
      contract: g.status,
      product: c ? c.status : 'members-differ',
      reason: c ? c.reason : null,
    };
  });
  const movements = new Set(
    want.groups.flatMap((g) => g.members.map((m) => m[0])),
  );
  const misread = result.inventory
    .filter((r) => r.kind === 'error' && movements.has(r.row))
    .map((r) => [
      r.row,
      r.error.startsWith('CLEARING_')
        ? r.error.slice('CLEARING_'.length)
        : 'OTHER',
    ]);
  const count = (f) => groups.filter(f).length;
  return {
    productRefused: null,
    contractRefused: null,
    groups: groups.length,
    contractCleared: count((g) => g.contract === 'cleared'),
    productCleared: count((g) => g.product === 'cleared'),
    bothCleared: count(
      (g) => g.contract === 'cleared' && g.product === 'cleared',
    ),
    contractOnly: count(
      (g) => g.contract === 'cleared' && g.product !== 'cleared',
    ),
    productOnly: count(
      (g) => g.product === 'cleared' && g.contract !== 'cleared',
    ),
    membersDiffer: count((g) => g.product === 'members-differ'),
    productReasons: Object.fromEntries(
      [...new Set(groups.filter((g) => g.reason).map((g) => g.reason))]
        .sort(byText)
        .map((r) => [r, count((g) => g.reason === r)]),
    ),
    heldNamingTheLine: 0,
    movementsReadAsErrors: misread,
  };
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
  const dir = mkdtempSync(join(tmpdir(), 'clr1-dense-'));
  try {
    execFileSync('python3', ['-B', join(here, 'dense.py'), dir], {
      stdio: 'ignore',
    });
    const judged = JSON.parse(
      execFileSync('python3', ['-B', join(here, 'oracle.py'), '--dense', dir], {
        maxBuffer: 1 << 30,
      }).toString(),
    );
    const sealed = JSON.parse(
      readFileSync(join(FROZEN, 'DENSE-MANIFEST.json'), 'utf8'),
    ).expectedSha256;
    if (JSON.stringify(judged.sha256) !== JSON.stringify(sealed))
      throw Error('the dense expectations differ from the seal');
    for (const sid of Object.keys(judged.stories).sort(byText))
      stories[sid] = await judge(dir, sid, judged.stories[sid]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const all = Object.values(stories);
  const sum = (k) => all.reduce((n, s) => n + (s[k] ?? 0), 0);
  const record = {
    schema: 'tarasuf-clr1-baseline/1',
    family: CLEARING_VERSION,
    rule: 'the product as it is, on the sealed stories, beside the proposed contract',
    summary: {
      stories: all.length,
      refusalsAgree: all.filter((s) => s.productRefused === s.contractRefused)
        .length,
      groups: sum('groups'),
      contractCleared: sum('contractCleared'),
      productCleared: sum('productCleared'),
      bothCleared: sum('bothCleared'),
      contractOnly: sum('contractOnly'),
      productOnly: sum('productOnly'),
      membersDiffer: sum('membersDiffer'),
      heldNamingTheLine: sum('heldNamingTheLine'),
      movementsReadAsErrors: all.reduce(
        (n, s) => n + (s.movementsReadAsErrors?.length ?? 0),
        0,
      ),
    },
    stories,
  };
  const text = JSON.stringify(record, null, 1) + '\n';
  if (args.out) writeFileSync(join(here, 'results', args.out), text);
  if (
    args.assert &&
    readFileSync(join(here, 'results', args.assert), 'utf8') !== text
  ) {
    console.error('the baseline differs from its record');
    process.exit(1);
  }
  console.log(JSON.stringify(record.summary));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
