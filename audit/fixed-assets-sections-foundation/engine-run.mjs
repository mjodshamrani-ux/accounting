// FA-1 engine run: fixed-assets-sections-1 through the product's replay from
// bytes, on every sealed story, compared with the sealed expectations in
// full: the refusal, the decimals and the three source hashes, the run codes,
// every section, every asset (its amounts, rows, unread rows, valuation,
// status and codes), every unplaced pair, every account (its component,
// status, codes, amounts, GL row and members), every unplaced row and the
// inventory. The dense stories are regenerated and checked against the seal
// first, and judged against the oracle's output, itself checked against the
// sealed expectation hash.
//
// A refusal carries no result: it is compared as the contract writes it,
// with every other field empty or null.
//
//   node --experimental-strip-types audit/fixed-assets-sections-foundation/engine-run.mjs [--out name] [--assert name]
//
// FA_SECTIONS_SUITE selects another sealed suite (a holdout) with the same
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
const SUITE = process.env.FA_SECTIONS_SUITE;
const suite = SUITE ? resolve(root, SUITE) : here;
const FROZEN = join(suite, 'frozen');
const lib = (name) =>
  pathToFileURL(join(root, 'lib/reconciliation', name)).href;
const { FA_SECTIONS_VERSION } = await import(lib('fixed-assets-sections.ts'));
const { replayAssetSections } = await import(
  lib('fixed-assets-sections-io.ts')
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

export function refusedAs(code) {
  return {
    refused: code,
    decimals: null,
    hashes: [],
    run: [],
    sections: [],
    assets: [],
    unmapped: [],
    accounts: [],
    unplaced: [],
    inventory: null,
  };
}

export function asExpected(r) {
  const { version: _version, ...rest } = r;
  return rest;
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
  let got;
  try {
    got = asExpected((await replayAssetSections(input(folder, sid))).result);
  } catch (error) {
    const message = String(error?.message ?? error);
    if (!message.startsWith('FA_SECTIONS_'))
      return { equal: false, firstDifference: `(threw) ${message}` };
    got = refusedAs(message.slice('FA_SECTIONS_'.length));
  }
  const where = differs(got, want);
  return where
    ? { equal: false, refused: got.refused, firstDifference: where }
    : { equal: true };
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
  if (!SUITE) {
    const dir = mkdtempSync(join(tmpdir(), 'fa1-dense-'));
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
  const equal = Object.values(stories).filter((s) => s.equal).length;
  const record = {
    schema: 'tarasuf-fa1-engine-run/1',
    family: FA_SECTIONS_VERSION,
    suite: SUITE ?? 'audit/fixed-assets-sections-foundation',
    rule: 'replayAssetSections from the sealed bytes, compared with EXPECTED.json in full',
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
}

await main();
