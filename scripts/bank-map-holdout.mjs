// WF-1 MAP-1 M4: the product on the sealed holdout audit/bank-map-holdout-m4,
// recorded as it comes. Each story starts with no saved map and its actions
// are taken in order as the accountant takes them, as
// scripts/bank-map-proof.mjs and scripts/bank-map-lifecycle.mjs take the
// foundation's: a map file imported, a saved map exported, a cashbook read
// with the declared columns, by hand (the choice checked, then saved under a
// name if the story says so) or by a saved map (its fit decided first). Each
// action is held against the sealed EXPECTED.json:
//   1. an import: accepted or its code, and the names saved after;
//   2. an export: the map file;
//   3. a read: the refused choice, or every fit problem, or the reading (its
//      refusal and row, or every entry, the rows above the header and the
//      columns not read); and for a reading the oracle settles, the period
//      replayed by the lifecycle from the original bytes with those columns:
//      held or not, every case with its kind, reason, status and members,
//      every item left outstanding; the session saved and restored to the
//      same result; and the workbook judged by
//      audit/bank-map-foundation/check_export.py against the sealed package,
//      never against the product.
// A difference, a refusal or an error is recorded, not thrown. With
// --record=<file> the outcome is written to the holdout's results/ as that
// run's record; with --assert=<file> it must equal that record.
//   node --experimental-strip-types scripts/bank-map-holdout.mjs [--record=run-1.json | --assert=run-1.json]
// BANK_MAP_HOLDOUT_SUITE names another sealed map package (the foundation),
// to try this runner without reading the holdout.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.resolve(
  root,
  process.env.BANK_MAP_HOLDOUT_SUITE ?? 'audit/bank-map-holdout-m4',
);
const frozen = path.join(suite, 'frozen');
const checker = path.join(root, 'audit/bank-map-foundation/check_export.py');
const option = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const io = await import(path.join(root, 'lib/reconciliation/io.ts'));
const match = await import(
  path.join(root, 'lib/reconciliation/bank-statement-match.ts')
);
const map = await import(
  path.join(root, 'lib/reconciliation/bank-cashbook-map.ts')
);
const lifecycle = await import(
  path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts')
);
const { sameStatementData } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-request.ts')
);

// The seal first.
const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(
    sha(await readFile(path.join(frozen, name))),
    entry.sha256,
    name,
  );
for (const [name, digest] of Object.entries(manifest.external ?? {}))
  assert.equal(
    sha(await readFile(path.join(root, 'audit', name))),
    digest,
    name,
  );
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const plain = (x) => JSON.parse(JSON.stringify(x));
const message = (error) =>
  error instanceof Error ? error.message : String(error);
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const same = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
assert.ok(
  same({ b: [1, { y: 1, x: 2 }], a: 1 }, { a: 1, b: [1, { x: 2, y: 1 }] }),
);
assert.ok(!same({ a: [1, 2] }, { a: [2, 1] }));
const STATUS = {
  'matched-automatic': 'matched',
  'matched-accepted': 'accepted',
};
const base = process.env.BANK_MAP_HOLDOUT_DIR ?? path.join(root, 'work');
await mkdir(base, { recursive: true });
const out = await mkdtemp(path.join(base, 'bank-map-holdout-'));

const currencies = new Map();
async function currency(action) {
  if (!currencies.has(action.source)) {
    const source = await json(
      path.join(root, 'audit', action.source, 'frozen', 'stories.json'),
    );
    for (const s of source.stories)
      for (const p of s.periods)
        currencies.set(`${action.source}/${p.id}`, p.statement.currency);
    currencies.set(action.source, true);
  }
  return currencies.get(`${action.source}/${action.period}`);
}

/** The reading as the oracle states it. */
function reading(file, columns, read) {
  const shape = columns
    ? map.cashbookColumnsUnread(file, columns)
    : { above: 0, unread: [] };
  const got = {
    header: columns?.header ?? 1,
    above: shape.above,
    unread: shape.unread,
    refused: null,
    entries: [],
  };
  try {
    got.entries = read().map((e) => ({
      voucher: e.id,
      row: e.row,
      date: e.date,
      description: e.description,
      reference: e.reference,
      direction: e.direction,
      amount: e.amount,
    }));
  } catch (error) {
    if (!(error instanceof match.CashbookReadError)) throw error;
    got.refused = { code: error.code, row: error.row };
  }
  return plain(got);
}

function state(action, statement, cashbook, name, columns) {
  return {
    version: 'bank-statement-lifecycle-1',
    files: [
      {
        name: `${action.period}-statement.pdf`,
        sha256: sha(statement),
        original: statement,
      },
      {
        name,
        sha256: sha(cashbook),
        original: cashbook,
        ...(columns ? { columns } : {}),
      },
    ],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions: [],
  };
}

/** The period as the lifecycle settles it, in the oracle's form. */
async function period(action, cashbookPath, name, columns) {
  const source = path.join(root, 'audit', action.source, 'frozen');
  const statement = Uint8Array.from(
    await readFile(path.join(source, `${action.period}-statement.pdf`)),
  ).buffer;
  const cashbook = Uint8Array.from(await readFile(cashbookPath)).buffer;
  const s = state(action, statement, cashbook, name, columns);
  const replay = await lifecycle.replayBankStatement(s);
  const { result } = replay;
  const got = {
    held: result.status === 'held',
    cases: result.cases.map((c) => ({
      id: c.id,
      kind: c.kind,
      reason: c.reason,
      statement: c.statement,
      cashbook: c.cashbook,
      status: STATUS[c.status] ?? c.status,
    })),
    outstanding: result.outstanding.map((o) => [
      o.side === 'statement' ? 'S' : 'C',
      o.id,
      o.origin,
    ]),
  };
  return { got: plain(got), s, replay };
}

const stories = {};
const exports = [];
for (const story of facts.stories) {
  let store = [];
  const actions = [];
  for (const [k, action] of story.actions.entries()) {
    const want = expected[story.id][k];
    const label = `${story.id}#${k + 1}`;
    const record = { do: action.do, equal: false };
    actions.push(record);
    try {
      if (action.do === 'import') {
        const data = await readFile(path.join(frozen, action.file));
        let got;
        try {
          store = map.withCashbookMap(store, map.parseCashbookMap(data));
          got = { accepted: true };
        } catch (error) {
          if (!(error instanceof map.CashbookMapError)) throw error;
          got = { accepted: false, code: error.code };
        }
        got.store = store.map((m) => m.name);
        const wanted = {
          accepted: want.accepted,
          ...(want.accepted ? {} : { code: want.code }),
          store: want.store,
        };
        record.equal = same(got, wanted);
        if (!record.equal) record.got = got;
        continue;
      }
      if (action.do === 'export') {
        const saved = store.find((m) => m.name === action.map);
        const got = {
          map: saved ? JSON.parse(map.serializeCashbookMap(saved)) : null,
          store: store.map((m) => m.name),
        };
        record.equal = same(got, { map: want.map, store: want.store });
        if (!record.equal) record.got = got;
        continue;
      }
      // A read.
      record.by = action.by;
      const cashbookPath = action.twin
        ? path.join(root, 'audit', action.source, 'frozen', action.file)
        : path.join(frozen, action.file);
      const name = action.as ?? action.file;
      const bytes = Uint8Array.from(await readFile(cashbookPath)).buffer;
      const file = await io.readFile(name, bytes);
      const cur = await currency(action);
      const got = {};
      let columns = null;
      if (action.by === 'declared')
        got.reading = reading(file, null, () =>
          match.readBankCashbookTable(file, cur),
        );
      else {
        try {
          if (action.by === 'hand') {
            const chosen = map.chooseCashbookColumns(file, {
              header: action.header,
              columns: action.columns,
            });
            if ('problems' in chosen)
              got.fit = { fits: false, problems: plain(chosen.problems) };
            else columns = chosen.columns;
          } else {
            const saved = store.find((m) => m.name === action.map);
            if (!saved) got.missing = action.map;
            else {
              const problems = map.cashbookMapProblems(
                file,
                map.mapColumns(saved),
              );
              if (problems.length)
                got.fit = { fits: false, problems: plain(problems) };
              else columns = map.mapColumns(saved);
            }
          }
        } catch (error) {
          if (!(error instanceof map.CashbookMapError)) throw error;
          got.invalid = error.code;
        }
        if (columns) {
          got.fit = { fits: true, problems: [] };
          got.reading = reading(file, columns, () =>
            match.readMappedBankCashbook(file, cur, columns),
          );
          if (action.by === 'hand' && action.save) {
            store = map.withCashbookMap(
              store,
              map.namedCashbookMap(action.save, columns),
            );
            got.saved = action.save;
          }
        }
      }
      got.store = store.map((m) => m.name);
      const wanted = {
        ...(want.invalid ? { invalid: want.invalid } : {}),
        ...(want.fit ? { fit: plain(want.fit) } : {}),
        ...(want.reading ? { reading: want.reading } : {}),
        ...(want.saved ? { saved: want.saved } : {}),
        store: want.store,
      };
      record.reading = same(got, wanted);
      if (!record.reading) record.got = got;
      record.equal = record.reading;
      // The period, where the oracle settles one.
      if (!want.period) continue;
      const settled = await period(action, cashbookPath, name, columns);
      record.period = same(settled.got, want.period);
      if (!record.period) record.gotPeriod = settled.got;
      record.equal &&= record.period;
      if (settled.got.held) continue;
      const session = await lifecycle.saveBankStatement(settled.s);
      const saved = JSON.parse(new TextDecoder().decode(session));
      record.session =
        saved.files[0].columns === undefined &&
        same(saved.files[1].columns ?? null, columns ? plain(columns) : null) &&
        sameStatementData(
          await lifecycle.restoreBankStatement(session),
          settled.replay,
        );
      record.equal &&= record.session;
      const workbook = await lifecycle.exportBankStatement(
        settled.s,
        settled.replay.result,
      );
      const xlsx = path.join(out, `${story.id}-${k + 1}.xlsx`);
      await writeFile(xlsx, new Uint8Array(workbook));
      exports.push({
        label,
        story: story.id,
        action: k,
        path: xlsx,
        cashbook: cashbookPath,
      });
      record.workbook = null; // judged below, all at once
    } catch (error) {
      record.error = message(error);
    }
  }
  stories[story.id] = actions;
}

// Every workbook, judged independently against the sealed package.
const check = spawnSync(process.env.PYTHON ?? 'python3', ['-B', checker], {
  input: JSON.stringify({
    frozen,
    selfTest: exports.map((e) => e.label),
    exports,
  }),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
let judged;
try {
  judged = JSON.parse(check.stdout);
} catch {
  judged = { passed: false, workbooks: 0, failed: [], selfTest: [] };
}
assert.equal(judged.workbooks, exports.length, check.stdout + check.stderr);
const failed = new Map(judged.failed.map((f) => [f.label, f.problem]));
for (const e of exports) {
  const record = stories[e.story][e.action];
  record.workbook = !failed.has(e.label);
  if (!record.workbook) record.workbookProblem = failed.get(e.label);
  record.equal &&= record.workbook;
}

const all = Object.values(stories).flat();
const reads = all.filter((r) => r.do === 'read');
const summary = {
  stories: facts.stories.length,
  storiesEqual: Object.values(stories).filter((a) => a.every((r) => r.equal))
    .length,
  actions: all.length,
  equal: all.filter((r) => r.equal).length,
  imports: all.filter((r) => r.do === 'import').length,
  importsEqual: all.filter((r) => r.do === 'import' && r.equal).length,
  exports: all.filter((r) => r.do === 'export').length,
  reads: reads.length,
  readingsEqual: reads.filter((r) => r.reading).length,
  periods: reads.filter((r) => 'period' in r).length,
  periodsEqual: reads.filter((r) => r.period).length,
  sessions: reads.filter((r) => 'session' in r).length,
  sessionsEqual: reads.filter((r) => r.session).length,
  workbooks: exports.length,
  workbooksAccepted: exports.length - failed.size,
  errors: all.filter((r) => r.error).length,
  checkerSelfTest: judged.selfTest.every((t) => t.rejected),
};
const report = { holdout: path.relative(root, suite), summary, stories };
await writeFile(
  path.join(out, 'holdout.json'),
  `${JSON.stringify(report, null, 1)}\n`,
);
const record = option('record');
if (record) {
  await mkdir(path.join(suite, 'results'), { recursive: true });
  await writeFile(
    path.join(suite, 'results', record),
    `${JSON.stringify(report, null, 1)}\n`,
  );
}
const against = option('assert');
if (against)
  assert.deepEqual(
    canonical(report),
    canonical(await json(path.join(suite, 'results', against))),
    `the run differs from results/${against}`,
  );
console.log(JSON.stringify({ out, ...summary }));
