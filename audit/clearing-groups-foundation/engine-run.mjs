// CLR-1 engine run: clearing-groups-1 through the product's replay from
// bytes, on every sealed story, compared with the sealed expectations in
// full: the refusal, or the decimals, the reference role, every group (its
// reference, members by row, posting, amount and basis, net, status,
// reasons, connected lines and duplicate sets), every faulty line with its
// code and isolation, the blank lines, the unisolated lines, the total and
// the source hash. The dense stories are regenerated and checked against the
// seal first.
//
//   node --experimental-strip-types audit/clearing-groups-foundation/engine-run.mjs [--out name] [--assert name]
//
// CLR_GROUPS_SUITE selects another sealed suite (a holdout) with the same
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
const SUITE = process.env.CLR_GROUPS_SUITE;
const suite = SUITE ? resolve(root, SUITE) : here;
const FROZEN = join(suite, 'frozen');
const { CLEARING_GROUPS_VERSION, replayClearingGroups } = await import(
  pathToFileURL(join(root, 'lib/reconciliation/clearing-groups.ts')).href
);

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
  };
}

export function asExpected(r) {
  return {
    refused: null,
    decimals: r.decimals,
    role: r.role,
    groups: r.groups.map((g) => ({
      reference: g.reference,
      members: g.members.map((m) => [m.row, m.posting, m.amount, m.basis]),
      net: g.net,
      status: g.status,
      reasons: g.reasons,
      connected: g.connected.map((c) => [c.row, c.code]),
      duplicates: g.duplicates,
    })),
    errors: r.faulty.map((f) => [f.row, f.code, f.isolated]),
    blank: r.blank,
    unisolated: r.faulty.filter((f) => !f.isolated).map((f) => f.row),
    total: r.total,
    sha256: r.sourceHash,
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
    got = asExpected((await replayClearingGroups(input(folder, sid))).result);
  } catch (error) {
    got = {
      refused: String(error.message).replace(/^CLEARING_GROUPS_/, ''),
    };
  }
  const expected = want.refused ? { refused: want.refused } : want;
  const where = differs(got, expected);
  return where ? { equal: false, firstDifference: where } : { equal: true };
}

async function dense(stories) {
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
    schema: 'tarasuf-clr1-engine-run/1',
    family: CLEARING_GROUPS_VERSION,
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
