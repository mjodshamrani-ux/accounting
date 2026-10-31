// IC-1 baseline: the product as it is (intercompany-ledger-1, unchanged) on
// the sealed IC-1 foundation, recorded as it comes. Written after the seal.
//
//   node --experimental-strip-types audit/intercompany-batch-foundation/baseline.mjs [--out file] [--assert file]
//
// Two readings of each story:
// - As it is: the story's own files in the four roles the product has, in
//   their order (ledger 1 as the left ledger, ledger 2 as the right, the
//   relation members as relationship evidence, the batch declaration as
//   timing evidence), with the first declared batch as the scope. There is no
//   role for a batch declaration, and none for a second pair.
// - Split by hand: what an accountant must do today, one run per declared
//   batch. Each ledger is filtered by the batch's declared identity, as a
//   spreadsheet filter would (a row matching two batches goes into both; a
//   row matching none goes nowhere); the relation members of the batch become
//   relation rows of the existing form, one transaction per side; timing
//   evidence is a header alone; the scope is the declaration. A relation the
//   existing form cannot hold (not exactly one member on each side) makes the
//   batch inexpressible, and it is not run. A posting date the accountant
//   cannot see (a member absent from the ledger) is the period end.
// Completeness is not confirmed and nothing is accepted, so a batch the
// product finds consistent reads needs-review, compared as ready.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const FROZEN = resolve(here, 'frozen');
const lib = (name) =>
  import(pathToFileURL(resolve(root, 'lib/reconciliation', name)).href);
const { readIntercompanyFile } = await lib('intercompany-source.ts');
const {
  IC_HEADERS,
  IC_ROLES,
  IC_SCOPE_FIELDS,
  IC_SCOPE_HEADERS,
  IC_VERSION,
  reconcileIntercompany,
} = await lib('intercompany.ts');

const COMMON = IC_SCOPE_HEADERS.slice(8);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function parse(text) {
  const rows = [];
  let row = [],
    cell = '',
    inside = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inside) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') inside = false;
      else cell += c;
    } else if (c === '"') inside = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

const table = (name) => {
  const [head, ...rows] = parse(readFileSync(resolve(FROZEN, name), 'utf8'));
  // Each record with its physical row; a row of another width has no fields.
  return rows
    .map((r, i) => [r, i + 2])
    .filter(([r]) => r.some((v) => v.trim()))
    .map(([r, row]) =>
      r.length === head.length
        ? { ...Object.fromEntries(head.map((h, i) => [h, r[i]])), row }
        : null,
    );
};

const csv = (rows) =>
  rows
    .map((r) =>
      r
        .map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v))
        .join(','),
    )
    .join('\n') + '\n';

async function source(name, bytes) {
  return readIntercompanyFile(
    name,
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

const scopeOf = (d) =>
  Object.fromEntries(
    IC_SCOPE_FIELDS.map((k, i) => [k, d[IC_SCOPE_HEADERS[i]]]),
  );

async function product(named, scope) {
  try {
    const files = [];
    for (const [name, bytes] of named) files.push(await source(name, bytes));
    const r = reconcileIntercompany({
      files,
      readings: IC_ROLES.map((role) => ({
        sheet: 0,
        role,
        family: IC_VERSION,
        confirmed: true,
      })),
      scope: { ...scope, confirmed: true },
      completeness: { confirmed: false, reference: '', note: '' },
      events: [],
    });
    return {
      status: r.status,
      issues: [...new Set(r.issues.map((i) => i.code))].sort(byText),
      missing: [...new Set(r.missing.map((m) => m.kind))].sort(byText),
      pairs: r.pairs.map((p) => ({
        relationId: p.relationId,
        status: p.status,
        residual: p.residual,
        left: p.left?.transactionId ?? null,
        right: p.right?.transactionId ?? null,
      })),
    };
  } catch (error) {
    return { refused: String(error?.message ?? error) };
  }
}

const VERDICT = {
  'source-error': 'blocked',
  missing: 'missing',
  difference: 'difference',
  'needs-review': 'ready',
  'consistent-with-evidence': 'ready',
};

function key(d, side) {
  const [me, other] = side === 'A' ? ['A', 'B'] : ['B', 'A'];
  return JSON.stringify([
    d[`Entity ${me}`],
    d[`Entity ${other}`],
    d[`Ledger ${me}`],
    d[`Account ${me}`],
    d[`Dimensions ${me}`],
    ...COMMON.map((h) => d[h]),
  ]);
}
const rowKey = (r) =>
  JSON.stringify([
    r.Entity,
    r.Counterparty,
    r.Ledger,
    r['Account ID'],
    r['Complete dimensions'],
    ...COMMON.map((h) => r[h]),
  ]);

function classify(verdict, oracle) {
  if (verdict === oracle) return 'agree';
  if (verdict === 'inexpressible' || verdict === 'refused') return verdict;
  const open = (v) => v === 'ready' || v === 'difference';
  if (open(verdict) && !open(oracle)) return 'unsafe';
  if (!open(verdict) && open(oracle)) return 'held';
  return 'other';
}

async function story(sid, expected) {
  const files = readdirSync(FROZEN)
    .filter((n) => n.startsWith(`${sid}-ledger-`))
    .sort(
      (a, b) =>
        Number(a.match(/-(\d+)\.csv$/)[1]) - Number(b.match(/-(\d+)\.csv$/)[1]),
    );
  const decls = table(`${sid}-batches.csv`).filter(Boolean);
  const ledgers = files.flatMap((name) =>
    table(name)
      .filter(Boolean)
      .map((r) => ({ ...r, file: name })),
  );
  const members = table(`${sid}-relations.csv`).filter(Boolean);
  const bytes = (name) => readFileSync(resolve(FROZEN, name));
  const asIs = await product(
    [files[0], files[1], `${sid}-relations.csv`, `${sid}-batches.csv`].map(
      (n) => [n, bytes(n)],
    ),
    scopeOf(decls[0]),
  );
  const placed = new Map();
  const batches = {};
  for (const d of decls) {
    const bid = d['Batch ID'];
    const sides = Object.fromEntries(
      ['A', 'B'].map((s) => [
        s,
        ledgers.filter((r) => rowKey(r) === key(d, s)),
      ]),
    );
    for (const s of ['A', 'B'])
      for (const r of sides[s])
        placed.set(
          JSON.stringify([r.file, r.row]),
          (placed.get(JSON.stringify([r.file, r.row])) ?? 0) + 1,
        );
    const groups = new Map();
    for (const m of members.filter((m) => m['Batch ID'] === bid)) {
      const g = groups.get(m['Relation ID']) ?? { A: [], B: [], m };
      g[m.Side]?.push(m['Transaction ID']);
      groups.set(m['Relation ID'], g);
    }
    const shapes = [...groups]
      .filter(([, g]) => g.A.length !== 1 || g.B.length !== 1)
      .map(([rid, g]) => `${rid} ${g.A.length}:${g.B.length}`);
    const truth = expected.batches[bid];
    const entry = { oracle: truth.status, oracleCodes: truth.codes };
    if (shapes.length) {
      batches[bid] = {
        ...entry,
        verdict: 'inexpressible',
        inexpressible: shapes,
        class: classify('inexpressible', truth.status),
      };
      continue;
    }
    const dateOf = (s, tx) =>
      sides[s].find((r) => r['Transaction ID'] === tx)?.['Posting date'] ??
      d['Period end'];
    const scope = scopeOf(d);
    const relations = [...groups].map(([rid, g]) => [
      rid,
      g.A[0],
      g.B[0],
      d['Account A'],
      d['Dimensions A'],
      d['Account B'],
      d['Dimensions B'],
      dateOf('A', g.A[0]),
      dateOf('B', g.B[0]),
      g.m['Valid from'],
      g.m['Valid to'],
      g.m['Relationship reference'],
      ...IC_SCOPE_HEADERS.map((h) => d[h]),
    ]);
    const write = (rows, head) =>
      new TextEncoder().encode(csv([head, ...rows]));
    const ledger = (rows) =>
      write(
        rows.map((r) => IC_HEADERS[0].map((h) => r[h])),
        IC_HEADERS[0],
      );
    const run = await product(
      [
        [`${sid}-${bid}-left.csv`, ledger(sides.A)],
        [`${sid}-${bid}-right.csv`, ledger(sides.B)],
        [`${sid}-${bid}-relations.csv`, write(relations, IC_HEADERS[2])],
        [`${sid}-${bid}-timing.csv`, write([], IC_HEADERS[3])],
      ],
      scope,
    );
    const verdict = run.refused ? 'refused' : VERDICT[run.status];
    const residuals = {};
    for (const p of run.pairs ?? [])
      residuals[`${bid}/${p.relationId}`] = p.residual;
    const want = Object.fromEntries(
      Object.entries(truth.relations).map(([k, v]) => [k, v.residual]),
    );
    let cls = classify(verdict, truth.status);
    if (
      cls === 'agree' &&
      (verdict === 'ready' || verdict === 'difference') &&
      JSON.stringify(residuals) !== JSON.stringify(want)
    )
      cls = 'residuals';
    batches[bid] = { ...entry, verdict, run, residuals, class: cls };
  }
  const dropped = ledgers
    .filter((r) => !placed.get(JSON.stringify([r.file, r.row])))
    .map((r) => [r.file, r.row]);
  const twice = ledgers
    .filter((r) => (placed.get(JSON.stringify([r.file, r.row])) ?? 0) > 1)
    .map((r) => [r.file, r.row]);
  return { asIs, batches, dropped, placedTwice: twice };
}

const git = (...c) =>
  spawnSync('git', c, { cwd: root, encoding: 'utf8' }).stdout.trim();

export async function baseline() {
  const expected = JSON.parse(
    readFileSync(resolve(FROZEN, 'EXPECTED.json'), 'utf8'),
  );
  const stories = {};
  for (const [sid, e] of Object.entries(expected.stories))
    stories[sid] = await story(sid, e);
  const all = Object.values(stories).flatMap((s) => Object.entries(s.batches));
  const count = (f) => all.filter(([, b]) => f(b)).length;
  const classes = {};
  for (const [, b] of all) classes[b.class] = (classes[b.class] ?? 0) + 1;
  return {
    schema: 'tarasuf-ic1-batch-baseline/1',
    engine: IC_VERSION,
    commit: git('rev-parse', 'HEAD'),
    summary: {
      stories: Object.keys(stories).length,
      asIsRefusedOrBlocked: Object.values(stories).filter(
        (s) => s.asIs.refused || s.asIs.status === 'source-error',
      ).length,
      batches: all.length,
      agree: count((b) => b.class === 'agree'),
      classes,
      unsafe: all
        .filter(([, b]) => b.class === 'unsafe')
        .map(([bid, b]) => `${bid}: ${b.verdict} where ${b.oracle}`),
      droppedRows: Object.values(stories).reduce(
        (n, s) => n + s.dropped.length,
        0,
      ),
      rowsPlacedTwice: Object.values(stories).reduce(
        (n, s) => n + s.placedTwice.length,
        0,
      ),
    },
    stories,
  };
}

async function main() {
  const { values: args } = parseArgs({
    options: { out: { type: 'string' }, assert: { type: 'string' } },
  });
  const report = await baseline();
  for (const [sid, s] of Object.entries(report.stories))
    console.log(
      sid,
      s.asIs.refused ?? `${s.asIs.status} ${s.asIs.issues.join(',')}`,
      '|',
      Object.entries(s.batches)
        .map(
          ([bid, b]) =>
            `${bid}: ${b.verdict}${b.class === 'agree' ? '' : ` (${b.class}, oracle ${b.oracle})`}`,
        )
        .join('; '),
      s.dropped.length ? `| dropped ${s.dropped.length}` : '',
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
