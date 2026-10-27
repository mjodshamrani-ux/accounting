// WF-1 MAP-1 M2: a cashbook read with columns through the bank statement
// lifecycle, on the sealed foundation (audit/bank-map-foundation). For every
// read the oracle settles, the period is replayed from the original bytes
// with the columns the story reads with (none for the declared reading), and
// compared with EXPECTED.json: every case with its kind, reason, status and
// members, and every item left outstanding; the columns, the rows above the
// header and the columns not read in the result; the session saved, holding
// the columns with the cashbook and nothing for the declared reading,
// restored to the same result; and the workbook judged by the independent
// audit/bank-map-foundation/check_export.py. A reading the oracle refuses at
// a row is refused by the lifecycle with the same code and row; columns
// that do not fit their file are refused with BANK_CASHBOOK_MAP. And a
// decision taken under one set of columns is refused under another.
//   node --experimental-strip-types scripts/bank-map-lifecycle.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const frozen = path.join(root, 'audit/bank-map-foundation/frozen');
const checker = path.join(root, 'audit/bank-map-foundation/check_export.py');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const lifecycle = await import(
  path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts')
);
const view = await import(
  path.join(root, 'lib/reconciliation/bank-statement-view.ts')
);
const io = await import(path.join(root, 'lib/reconciliation/io.ts'));
const map = await import(
  path.join(root, 'lib/reconciliation/bank-cashbook-map.ts')
);
const { sameStatementData } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-request.ts')
);

const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(
    sha(await readFile(path.join(frozen, name))),
    entry.sha256,
    name,
  );
for (const [name, digest] of Object.entries(manifest.external))
  assert.equal(
    sha(await readFile(path.join(root, 'audit', name))),
    digest,
    name,
  );
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const buffer = async (p) => Uint8Array.from(await readFile(p)).buffer;
const STATUS = {
  'matched-automatic': 'matched',
  'matched-accepted': 'accepted',
};
const plain = (x) => JSON.parse(JSON.stringify(x));
const base = process.env.BANK_MAP_LIFECYCLE_DIR ?? path.join(root, 'work');
await mkdir(base, { recursive: true });
const out = await mkdtemp(path.join(base, 'bank-map-lifecycle-'));

function state(
  action,
  statement,
  cashbook,
  cashbookName,
  columns,
  decisions = [],
) {
  return {
    version: 'bank-statement-lifecycle-1',
    files: [
      {
        name: `${action.period}-statement.pdf`,
        sha256: sha(statement),
        original: statement,
      },
      {
        name: cashbookName,
        sha256: sha(cashbook),
        original: cashbook,
        ...(columns ? { columns } : {}),
      },
    ],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions,
  };
}
const refusal = async (s) => {
  try {
    await lifecycle.replayBankStatement(s);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/** A lifecycle step that must succeed: its error fails an assertion naming
 * it, so a planted defect is caught by assertion, not by a throw (DEV-22). */
async function must(step, where) {
  try {
    return await step();
  } catch (error) {
    assert.fail(
      `${where}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const counts = {
  periods: 0,
  refused: 0,
  misfits: 0,
  sessions: 0,
  workbooks: 0,
  cases: 0,
  decisions: 0,
};
const exports = [];
for (const story of facts.stories) {
  let store = [];
  for (const [k, action] of story.actions.entries()) {
    const want = expected[story.id][k];
    const where = `${story.id}#${k + 1}`;
    if (action.do === 'import') {
      if (want.accepted)
        store = map.withCashbookMap(
          store,
          map.parseCashbookMap(await readFile(path.join(frozen, action.file))),
        );
      continue;
    }
    if (action.do !== 'read') continue;
    const source = path.join(root, 'audit', action.source, 'frozen');
    const cashbookPath = action.twin
      ? path.join(source, action.file)
      : path.join(frozen, action.file);
    const statement = await buffer(
      path.join(source, `${action.period}-statement.pdf`),
    );
    const cashbook = await buffer(cashbookPath);
    const name = action.as ?? action.file;
    // The columns the story reads with: a choice by hand, or a saved map.
    let columns = null;
    if (action.by === 'hand') {
      if (want.invalid || !want.fit.fits) continue;
      const chosen = map.chooseCashbookColumns(
        await io.readFile(name, cashbook.slice(0)),
        {
          header: action.header,
          columns: action.columns,
        },
      );
      columns = chosen.columns;
    } else if (action.by === 'map')
      columns = map.mapColumns(store.find((m) => m.name === action.map));
    if (action.by === 'hand' && action.save)
      store = map.withCashbookMap(
        store,
        map.namedCashbookMap(action.save, columns),
      );
    const s = state(action, statement, cashbook, name, columns);
    if (want.fit && !want.fit.fits) {
      // A map that does not fit is refused by the lifecycle too.
      const message = await refusal(s);
      assert.match(
        message ?? '',
        new RegExp(`^BANK_CASHBOOK_MAP: row ${columns.header}:`),
        where,
      );
      counts.misfits++;
      continue;
    }
    if (want.reading.refused) {
      const message = await refusal(s);
      assert.match(
        message ?? '',
        new RegExp(
          `^BANK_CASHBOOK_${want.reading.refused.code}: row ${want.reading.refused.row}:`,
        ),
        where,
      );
      counts.refused++;
      continue;
    }
    const replay = await must(() => lifecycle.replayBankStatement(s), where);
    const { result } = replay;
    assert.deepEqual(
      result.cases.map((c) => ({
        id: c.id,
        kind: c.kind,
        reason: c.reason,
        statement: c.statement,
        cashbook: c.cashbook,
        status: STATUS[c.status] ?? c.status,
      })),
      want.period.cases,
      `${where} cases`,
    );
    assert.deepEqual(
      result.outstanding.map((o) => [
        o.side === 'statement' ? 'S' : 'C',
        o.id,
        o.origin,
      ]),
      want.period.outstanding,
      `${where} outstanding`,
    );
    const cited = result.sources[1];
    if (columns) {
      assert.deepEqual(
        plain(cited.columns),
        plain(columns),
        `${where} columns`,
      );
      assert.deepEqual(
        [cited.above, plain(cited.unread)],
        [want.reading.above, want.reading.unread],
        `${where} unread`,
      );
    } else assert.ok(!('columns' in cited), `${where} declared`);
    counts.periods++;
    counts.cases += result.cases.length;
    // The session keeps the columns with the cashbook, and only there.
    const session = await must(
      () => lifecycle.saveBankStatement(s),
      `${where} save`,
    );
    const saved = JSON.parse(new TextDecoder().decode(session));
    assert.deepEqual(saved.files[0].columns, undefined, where);
    assert.deepEqual(
      saved.files[1].columns ?? null,
      columns ? plain(columns) : null,
      `${where} session`,
    );
    assert.ok(
      sameStatementData(
        await must(
          () => lifecycle.restoreBankStatement(session),
          `${where} restore`,
        ),
        replay,
      ),
      `${where} restore`,
    );
    counts.sessions++;
    // The workbook, judged independently.
    const workbook = await must(
      () => lifecycle.exportBankStatement(s, result),
      `${where} export`,
    );
    const file = path.join(out, `${story.id}-${k + 1}.xlsx`);
    await writeFile(file, new Uint8Array(workbook));
    exports.push({
      label: `${story.id}#${k + 1}`,
      story: story.id,
      action: k,
      path: file,
      cashbook: cashbookPath,
    });
    counts.workbooks++;
  }
}

// A decision taken under one set of columns is refused under another. R07's
// August cashbook (M10) has a date gap to decide; describing it from the
// Document No column instead of the Narration column still fits, and is
// another reading.
{
  const story = facts.stories.find((s) => s.id === 'M10');
  const action = story.actions[2];
  const source = path.join(root, 'audit', action.source, 'frozen');
  const statement = await buffer(
    path.join(source, `${action.period}-statement.pdf`),
  );
  const cashbook = await buffer(path.join(frozen, action.file));
  const file = await io.readFile(action.file, cashbook.slice(0));
  const first = map.chooseCashbookColumns(file, {
    header: action.header,
    columns: action.columns,
  }).columns;
  const other = map.chooseCashbookColumns(file, {
    header: action.header,
    columns: { ...action.columns, description: 3 },
  }).columns;
  const { result } = await must(
    () =>
      lifecycle.replayBankStatement(
        state(action, statement, cashbook, action.file, first),
      ),
    'M10 under its columns',
  );
  const gap = result.cases.find((c) => c.reason === 'date-gap');
  assert.ok(gap, 'M10 has a date gap');
  const decision = view.statementDecision(
    result,
    gap,
    'accept',
    'synthetic MAP-1 decision',
    'D1',
    '2026-12-01T09:00:00.000Z',
  );
  const decided = await must(
    () =>
      lifecycle.replayBankStatement(
        state(action, statement, cashbook, action.file, first, [decision]),
      ),
    'M10 decided under its columns',
  );
  assert.equal(
    decided.result.cases.find((c) => c.id === gap.id).status,
    'matched-accepted',
  );
  assert.match(
    (await refusal(
      state(action, statement, cashbook, action.file, other, [decision]),
    )) ?? '',
    /^BANK_STATEMENT_DECISION/u,
    'a decision under other columns',
  );
  counts.decisions++;
}

const check = spawnSync(process.env.PYTHON ?? 'python3', ['-B', checker], {
  input: JSON.stringify({
    frozen,
    selfTest: exports.map((e) => e.label),
    exports,
  }),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
const report = JSON.parse(check.stdout);
assert.equal(check.status, 0, check.stdout + check.stderr);
assert.equal(report.workbooks, counts.workbooks);
console.log(
  JSON.stringify({
    ...counts,
    checker: {
      passed: report.passed,
      selfTest: report.selfTest.map(
        (t) => `${t.alteration}:${t.caught}/${t.applied}`,
      ),
    },
  }),
);
