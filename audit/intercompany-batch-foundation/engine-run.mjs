// IC-1: the intercompany-batch-1 engine on the sealed IC-1 foundation,
// compared with EXPECTED.json in full: every batch's status, codes, side rows
// and findings, every relation's status, residual, nets, members and rows,
// the unassigned rows and the run codes. Written after the seal; the first
// run is recorded as it comes.
//
//   node --experimental-strip-types audit/intercompany-batch-foundation/engine-run.mjs [--out file] [--assert file]
//
// The files are read by the product's reader (readIntercompanyFile); each
// file's role is the one its name gives, as the accountant would name it.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const FROZEN = resolve(here, 'frozen');
const lib = (name) =>
  import(pathToFileURL(resolve(root, 'lib/reconciliation', name)).href);
const { readIntercompanyFile } = await lib('intercompany-source.ts');
const { IC_BATCH_VERSION, reconcileIntercompanyBatches } = await lib(
  'intercompany-batch.ts',
);

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byList = (a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c =
      typeof a[i] === 'number' && typeof b[i] === 'number'
        ? a[i] - b[i]
        : byText(String(a[i]), String(b[i]));
    if (c) return c;
  }
  return a.length - b.length;
};
const roleOf = (name) =>
  name.endsWith('-batches.csv')
    ? 'batch-declaration'
    : name.endsWith('-relations.csv')
      ? 'relation-members'
      : 'entity-ledger';

async function judge(sid) {
  const names = readdirSync(FROZEN)
    .filter((n) => n.startsWith(`${sid}-`) && n.endsWith('.csv'))
    .sort(byText);
  const files = [];
  for (const name of names) {
    const bytes = readFileSync(resolve(FROZEN, name));
    files.push(
      await readIntercompanyFile(
        name,
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      ),
    );
  }
  const r = reconcileIntercompanyBatches({
    files,
    readings: names.map((n) => ({
      sheet: 0,
      role: roleOf(n),
      family: IC_BATCH_VERSION,
      confirmed: true,
    })),
  });
  const place = (p) => [names[p.source], p.row];
  const batches = {};
  for (const b of r.batches) {
    const relations = {};
    for (const x of b.relations)
      relations[`${b.id}/${x.relationId}`] =
        x.status === 'ready' || x.status === 'difference'
          ? {
              status: x.status,
              residual: x.residual,
              net: x.net,
              members: x.members,
              rows: { A: x.rows.A.map(place), B: x.rows.B.map(place) },
            }
          : { status: x.status, residual: null, members: null, rows: null };
    batches[b.id] = {
      status: b.status,
      codes: b.codes,
      sides: {
        A: b.sides.A.map(place).sort(byList),
        B: b.sides.B.map(place).sort(byList),
      },
      relations,
      findings: b.findings.map((f) => [f.code, ...place(f)]).sort(byList),
    };
  }
  return {
    batches,
    unassigned: r.unassigned.map((u) => [...place(u), u.code]).sort(byList),
    run: r.run,
  };
}

const git = (...c) =>
  spawnSync('git', c, { cwd: root, encoding: 'utf8' }).stdout.trim();

export async function engineRun() {
  const expected = JSON.parse(
    readFileSync(resolve(FROZEN, 'EXPECTED.json'), 'utf8'),
  ).stories;
  const stories = {};
  const tally = {
    stories: 0,
    batches: 0,
    statuses: 0,
    relations: 0,
    residuals: 0,
  };
  for (const [sid, want] of Object.entries(expected)) {
    let got,
      error = null;
    try {
      got = await judge(sid);
    } catch (e) {
      error = String(e?.message ?? e);
    }
    const differ = [];
    if (!error) {
      for (const k of ['unassigned', 'run'])
        if (!isDeepStrictEqual(got[k], want[k])) differ.push(k);
      const ids = [
        ...new Set([...Object.keys(want.batches), ...Object.keys(got.batches)]),
      ];
      for (const bid of ids) {
        const g = got.batches[bid],
          w = want.batches[bid];
        tally.batches++;
        if (
          g &&
          w &&
          g.status === w.status &&
          isDeepStrictEqual(g.codes, w.codes)
        )
          tally.statuses++;
        for (const k of ['status', 'codes', 'sides', 'relations', 'findings'])
          if (!isDeepStrictEqual(g?.[k], w?.[k])) differ.push(`${bid}.${k}`);
        for (const [rid, wr] of Object.entries(w?.relations ?? {})) {
          tally.relations++;
          if (isDeepStrictEqual(g?.relations?.[rid], wr)) tally.residuals++;
        }
      }
    }
    const equal = !error && !differ.length;
    if (equal) tally.stories++;
    stories[sid] = {
      equal,
      error,
      differ,
      statuses: got
        ? Object.fromEntries(
            Object.entries(got.batches).map(([k, v]) => [
              k,
              [v.status, v.codes],
            ]),
          )
        : null,
    };
  }
  return {
    schema: 'tarasuf-ic1-batch-engine-run/1',
    engine: IC_BATCH_VERSION,
    commit: git('rev-parse', 'HEAD'),
    summary: {
      stories: `${tally.stories}/${Object.keys(expected).length}`,
      batchStatuses: `${tally.statuses}/${tally.batches}`,
      relations: `${tally.residuals}/${tally.relations}`,
    },
    stories,
  };
}

async function main() {
  const { values: args } = parseArgs({
    options: { out: { type: 'string' }, assert: { type: 'string' } },
  });
  const report = await engineRun();
  for (const [sid, s] of Object.entries(report.stories))
    console.log(
      sid,
      s.equal ? 'equal' : `DIFFERS ${s.error ?? s.differ.join(', ')}`,
    );
  console.log(JSON.stringify(report.summary));
  if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 1) + '\n');
  if (args.assert) {
    const want = JSON.parse(readFileSync(args.assert, 'utf8'));
    const strip = (r) =>
      JSON.stringify({ summary: r.summary, stories: r.stories });
    if (strip(want) !== strip(report)) {
      console.error('the run differs from', args.assert);
      process.exit(1);
    }
    console.log('the run equals', args.assert);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
