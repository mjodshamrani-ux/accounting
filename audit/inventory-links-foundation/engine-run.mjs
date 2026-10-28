// INV-3 engine run: the inventory family with its links, through the
// product's replay from bytes, on every sealed story, compared with the sealed
// expectations in full: the refusal, or the decision (financial outcome,
// issues, missing keys, comparisons, totals) and every link (row, status,
// reasons, mapping, evidence and GL rows, account) and unlinked record. The
// dense stories are regenerated and checked against the seal first.
//
//   node --experimental-strip-types audit/inventory-links-foundation/engine-run.mjs [--out name] [--assert name]
//
// INV_LINKS_SUITE selects another sealed suite (a holdout) with the same
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
const SUITE = process.env.INV_LINKS_SUITE;
const suite = SUITE ? resolve(root, SUITE) : here;
const FROZEN = join(suite, 'frozen');
const lib = (name) =>
  pathToFileURL(join(root, 'lib/reconciliation', name)).href;
const { STOCK_ROLES, STOCK_VERSION } = await import(
  lib('inventory-register.ts')
);
const { replayStock } = await import(lib('inventory-register-io.ts'));

const ROLES = ['register', 'mapping', 'evidence', 'gl'];
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const buffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

function input(folder, sid) {
  const scope = JSON.parse(
    readFileSync(join(folder, `${sid}-scope.json`), 'utf8'),
  );
  return {
    files: ROLES.map((role) => {
      const bytes = readFileSync(join(folder, `${sid}-${role}.csv`));
      return {
        name: `${sid}-${role}.csv`,
        original: buffer(bytes),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sheets: [],
      };
    }),
    readings: STOCK_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: STOCK_VERSION,
      confirmed: true,
    })),
    scope: { ...scope, confirmed: true },
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
}

export function asExpected(r) {
  // Numerically by source and row, then by code, as the oracle sorts them.
  const sortedIssues = r.issues
    .map((i) => [i.source, i.row, i.code])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || byText(a[2], b[2]));
  return {
    financial: r.financial,
    issues: sortedIssues,
    missing: [...r.missing].sort(byText),
    links: r.links.map((l) => [
      l.row,
      l.status,
      l.reasons,
      l.mappings.map((m) => m.row),
      l.evidence.map((e) => e.row),
      l.account && `${l.account.account}|${l.account.dimensions}`,
      l.gl.map((g) => g.row),
    ]),
    unlinked: r.unlinked.map((u) => [
      u.role,
      u.record?.row ?? null,
      u.key.join('|'),
      u.reason,
    ]),
    comparisons: r.comparisons,
    totals: r.totals,
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
  let got;
  try {
    got = asExpected((await replayStock(input(folder, sid))).result);
  } catch (error) {
    got = { refused: String(error.message).replace(/^STOCK_/, '') };
  }
  const expected = want.refused
    ? { refused: want.refused }
    : Object.fromEntries(
        [
          'financial',
          'issues',
          'missing',
          'links',
          'unlinked',
          'comparisons',
          'totals',
        ].map((k) => [k, want[k]]),
      );
  const where = differs(got, expected);
  return where ? { equal: false, firstDifference: where } : { equal: true };
}

async function dense(stories) {
  const dir = mkdtempSync(join(tmpdir(), 'inv3-dense-'));
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
    schema: 'tarasuf-inv3-engine-run/1',
    family: STOCK_VERSION,
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
    if (!s.equal) console.log(sid, s.firstDifference);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
