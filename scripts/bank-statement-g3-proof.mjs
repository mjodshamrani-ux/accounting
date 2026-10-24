// BNK-PDF-1 G3 proof: the statement session from original bytes to workbook.
// Every frozen statement is replayed from its PDF and cashbook bytes, saved,
// restored and exported; BS01 also as a CSV and an XLSX table, held until the
// accountant confirms its closing balance. Decision scenarios accept, reject
// and undo by the contract's rules, and the rules' refusals are held: an
// unacceptable reason, another context, other members, a held statement, an
// undo with nothing to undo, a tampered session and a stale result. Every
// workbook is then checked by audit/bank-statement-foundation/check_export.py,
// which reads it from its OOXML parts against the sealed facts and the
// oracle's EXPECTED.json, and tests itself on altered copies of one workbook.
// Decisions are stated here in the foundation's keys, not in the engine's
// case ids.
//   node --experimental-strip-types scripts/bank-statement-g3-proof.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/bank-statement-foundation');
const frozen = path.join(suite, 'frozen');
const outDir =
  process.env.BNK_G3_PROOF_DIR ?? path.join(root, 'work/bank-statement-g3');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));

const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const e of manifest.files)
  assert.equal(
    sha(await readFile(path.join(frozen, e.file))),
    e.sha256,
    e.file,
  );
const { factsJson } = await import(path.join(suite, 'stories.mjs'));
const factsText = factsJson();
assert.equal(
  sha(factsText),
  manifest.facts.sha256,
  'facts differ from the seal',
);
const facts = JSON.parse(factsText);
const expected = await json(path.join(frozen, 'EXPECTED.json'));

const {
  replayBankStatement,
  saveBankStatement,
  restoreBankStatement,
  exportBankStatement,
} = await import(
  path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts')
);
const { sameStatementData } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-request.ts')
);

const source = async (name, bytes) => {
  const b = bytes ?? (await readFile(path.join(frozen, name)));
  return { name, sha256: sha(b), original: Uint8Array.from(b).buffer };
};
const PDF_SCOPE = { currency: null, period: null, confirmedClosing: null };
const stateOf = async (statement, cashbook, scope = PDF_SCOPE) => ({
  version: 'bank-statement-lifecycle-1',
  files: [await source(statement), await source(cashbook)],
  scope,
  decisions: [],
});
const storyOf = (id) => facts.stories.find((s) => s.id === id);
const wantOf = (id) => expected.stories.find((s) => s.id === id);
/** The engine's ids for a group stated in the foundation's keys. */
function idsOf(story, bank, cash) {
  const movementKeys = story.statement.pages
    .flatMap((p) => p.lines)
    .filter((l) => l.kind === 'movement')
    .map((l) => l.key);
  const voucher = new Map(story.cashbook.map((r) => [r.key, r.voucher]));
  return {
    statement: bank.map((k) => `S${movementKeys.indexOf(k) + 1}`),
    cashbook: cash.map((k) => voucher.get(k)),
  };
}
const sorted = (xs) => [...xs].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
const sameSet = (a, b) =>
  a.length === b.length && sorted(a).join('|') === sorted(b).join('|');
/** A decision on the case holding exactly these members. */
function decide(story, result, d) {
  const want = idsOf(story, d.bank, d.cash);
  const c = result.cases.find(
    (x) =>
      sameSet(x.statement, want.statement) &&
      sameSet(x.cashbook, want.cashbook),
  );
  assert.ok(c, `${story.id}: no case holds ${d.bank} / ${d.cash}`);
  return {
    id: d.id,
    type: d.type,
    context: result.context,
    at: d.at,
    case: c.id,
    statement: c.statement,
    cashbook: c.cashbook,
    note: d.note,
  };
}
const refused = async (promise, code, label) =>
  assert.rejects(promise, new RegExp(`BANK_STATEMENT_${code}\\b`), label);

await mkdir(path.join(outDir, 'exports'), { recursive: true });
const exports = [];
const report = { statements: [], scenarios: [], refusals: [] };
const started = performance.now();
/** Replays, saves, restores and exports one state; returns its result. */
async function lifecycle(name, story, state, decisions, confirmedClosing) {
  // Each step of a valid state must succeed; a refusal here is a failure.
  const step = async (label, run) => {
    let value;
    await assert.doesNotReject(async () => {
      value = await run();
    }, `${name}: ${label}`);
    return value;
  };
  const { result } = await step('replay', () => replayBankStatement(state));
  const session = await step('save', () => saveBankStatement(state));
  const restored = await step('restore', () => restoreBankStatement(session));
  assert.ok(
    sameStatementData(restored, await replayBankStatement(state)),
    `${name}: restore differs`,
  );
  const workbook = await step('export', () =>
    exportBankStatement(restored.state, result),
  );
  const file = path.join(outDir, 'exports', `${name}.xlsx`);
  await writeFile(file, new Uint8Array(workbook));
  exports.push({
    name,
    story: story.id,
    path: file,
    statement: state.files[0].name,
    cashbook: state.files[1].name,
    confirmedClosing,
    decisions,
  });
  return { result, sessionBytes: session.byteLength };
}

// Every frozen statement, without decisions.
for (const story of facts.stories) {
  const state = await stateOf(
    `${story.id}-statement.pdf`,
    `${story.id}-cashbook.csv`,
  );
  const { result, sessionBytes } = await lifecycle(
    story.id,
    story,
    state,
    [],
    null,
  );
  const want = wantOf(story.id);
  assert.equal(
    result.status === 'held',
    want.statement !== 'verified',
    story.id,
  );
  report.statements.push({
    id: story.id,
    status: result.status,
    cases: result.cases.length,
    outstanding: result.outstanding.length,
    sessionBytes,
  });
}

// Decision scenarios, stated in the foundation's keys.
const at = (n) => `2026-10-21T09:0${n}:00.000Z`;
const scenarios = [
  {
    name: 'BS04-accept-suggestion',
    id: 'BS04',
    status: 'reviewed',
    decisions: (w) => [
      {
        id: 'D1',
        type: 'accept',
        bank: w.review[0].bank,
        cash: w.review[0].cash,
        at: at(1),
        note: 'Deposit slip matches the receipt',
      },
    ],
  },
  {
    name: 'BS12-reject-suggestion',
    id: 'BS12',
    status: 'reviewed',
    decisions: (w) => [
      {
        id: 'D1',
        type: 'reject',
        bank: w.review[0].bank,
        cash: w.review[0].cash,
        at: at(1),
        note: 'Different payee on the voucher',
      },
    ],
  },
  {
    name: 'BS02-reject-undo-reject-automatic',
    id: 'BS02',
    status: 'reviewed',
    decisions: (w) =>
      ['reject', 'undo', 'reject'].map((type, i) => ({
        id: `D${i + 1}`,
        type,
        bank: [w.auto[0][0]],
        cash: [w.auto[0][1]],
        at: at(i + 1),
        note: type === 'undo' ? 'Rejected in error' : 'Cheque recorded twice',
      })),
  },
  {
    name: 'BS07-reject-duplicate-reference',
    id: 'BS07',
    status: 'reviewed',
    decisions: (w) => [
      {
        id: 'D1',
        type: 'reject',
        bank: w.review[0].bank,
        cash: w.review[0].cash,
        at: at(1),
        note: 'Bank charged twice; raised with the bank',
      },
    ],
  },
  {
    name: 'BS03-reject-undo-automatic',
    id: 'BS03',
    status: 'reviewed',
    decisions: (w) =>
      ['reject', 'undo'].map((type, i) => ({
        id: `D${i + 1}`,
        type,
        bank: [w.auto[0][0]],
        cash: [w.auto[0][1]],
        at: at(i + 1),
        note: type === 'undo' ? 'Rejected in error' : 'Amount looked wrong',
      })),
  },
];
for (const s of scenarios) {
  const story = storyOf(s.id);
  const decisions = s.decisions(wantOf(s.id));
  const state = await stateOf(`${s.id}-statement.pdf`, `${s.id}-cashbook.csv`);
  const { result: before } = await replayBankStatement(state);
  state.decisions = decisions.map((d) => decide(story, before, d));
  const { result } = await lifecycle(s.name, story, state, decisions, null);
  assert.equal(result.status, s.status, s.name);
  report.scenarios.push({
    name: s.name,
    status: result.status,
    decisions: decisions.map((d) => d.type),
    outstanding: result.outstanding.map((o) => `${o.side}:${o.id}:${o.origin}`),
  });
}

// BS01 as a table: held until its closing balance is confirmed.
const bs01 = storyOf('BS01');
const closing = bs01.statement.pages
  .flatMap((p) => p.lines)
  .find((l) => l.kind === 'closing').balance;
for (const [statement, cashbook] of [
  ['BS01-statement.csv', 'BS01-cashbook.csv'],
  ['BS01-statement.xlsx', 'BS01-cashbook.xlsx'],
]) {
  const format = statement.slice(-4).replace('.', '');
  for (const confirmedClosing of [null, closing]) {
    const scope = { currency: 'SAR', period: facts.period, confirmedClosing };
    const name = `BS01-${format}-${confirmedClosing === null ? 'held' : 'confirmed'}`;
    const { result } = await lifecycle(
      name,
      bs01,
      await stateOf(statement, cashbook, scope),
      [],
      confirmedClosing,
    );
    assert.equal(result.status === 'held', confirmedClosing === null, name);
    report.scenarios.push({ name, status: result.status });
  }
  // A closing that differs by one minor unit is no confirmation.
  const wrong = await replayBankStatement(
    await stateOf(statement, cashbook, {
      currency: 'SAR',
      period: facts.period,
      confirmedClosing: closing + 1,
    }),
  );
  assert.equal(wrong.result.status, 'held', statement);
  assert.match(wrong.result.match.held.reason, /^confirmed closing/u);
}

// The rules' refusals.
async function refusal(label, code, make) {
  await refused(make(), code, label);
  report.refusals.push({ label, code });
}
const decisionOn = async (id, type, group, extra = {}) => {
  const state = await stateOf(`${id}-statement.pdf`, `${id}-cashbook.csv`);
  const { result } = await replayBankStatement(state);
  const d = decide(storyOf(id), result, {
    id: 'D1',
    type,
    bank: group.bank,
    cash: group.cash,
    at: at(1),
    note: 'Tested refusal',
  });
  state.decisions = [{ ...d, ...extra }];
  return { state, result };
};
for (const id of ['BS05', 'BS06', 'BS07'])
  await refusal(
    `${id}: accept ${wantOf(id).review[0].reason}`,
    'INELIGIBLE',
    async () =>
      replayBankStatement(
        (await decisionOn(id, 'accept', wantOf(id).review[0])).state,
      ),
  );
const bs04 = wantOf('BS04').review[0];
const bs12 = await replayBankStatement(
  await stateOf('BS12-statement.pdf', 'BS12-cashbook.csv'),
);
await refusal('BS04: a decision taken under BS12', 'DECISION', async () =>
  replayBankStatement(
    (await decisionOn('BS04', 'accept', bs04, { context: bs12.result.context }))
      .state,
  ),
);
await refusal(
  'BS04: the same decision after one cashbook description changed',
  'DECISION',
  async () => {
    const { state } = await decisionOn('BS04', 'accept', bs04);
    const text = (await readFile(path.join(frozen, 'BS04-cashbook.csv')))
      .toString('utf8')
      .replace('Customer receipt', 'Customer receipt.');
    state.files[1] = await source(
      'BS04-cashbook.csv',
      Buffer.from(text, 'utf8'),
    );
    // The changed file itself reads and matches; only the decision is stale.
    assert.equal(
      (await replayBankStatement({ ...state, decisions: [] })).result.status,
      'needs-review',
    );
    return replayBankStatement(state);
  },
);
await refusal('BS04: a member left out', 'MEMBERS', async () =>
  replayBankStatement(
    (await decisionOn('BS04', 'accept', bs04, { cashbook: [] })).state,
  ),
);
await refusal(
  'BS04: another case id for the same members',
  'MEMBERS',
  async () =>
    replayBankStatement(
      (await decisionOn('BS04', 'accept', bs04, { case: 'C1' })).state,
    ),
);
await refusal('BS04: undo with nothing to undo', 'UNDO', async () =>
  replayBankStatement((await decisionOn('BS04', 'undo', bs04)).state),
);
await refusal('BS04: the same decision id twice', 'DECISION', async () => {
  const { state } = await decisionOn('BS04', 'reject', bs04);
  state.decisions.push({ ...state.decisions[0], type: 'undo' });
  return replayBankStatement(state);
});
await refusal('BS09: a decision on a held statement', 'HELD', async () => {
  const state = await stateOf('BS09-statement.pdf', 'BS09-cashbook.csv');
  const { result } = await replayBankStatement(state);
  state.decisions = [
    {
      id: 'D1',
      type: 'reject',
      context: result.context,
      at: at(1),
      case: 'C1',
      statement: ['S1'],
      cashbook: [],
      note: 'Tested refusal',
    },
  ];
  return replayBankStatement(state);
});
await refusal(
  'BS04: accept a case already rejected',
  'INELIGIBLE',
  async () => {
    const { state } = await decisionOn('BS04', 'reject', bs04);
    state.decisions.push({ ...state.decisions[0], id: 'D2', type: 'accept' });
    return replayBankStatement(state);
  },
);
await refusal(
  'BS02: reject an automatic case twice',
  'INELIGIBLE',
  async () => {
    const w = wantOf('BS02');
    const group = { bank: [w.auto[0][0]], cash: [w.auto[0][1]] };
    const { state } = await decisionOn('BS02', 'reject', group);
    state.decisions.push({ ...state.decisions[0], id: 'D2' });
    return replayBankStatement(state);
  },
);
await refusal('BS07: the members in another order', 'MEMBERS', async () => {
  const { state } = await decisionOn(
    'BS07',
    'reject',
    wantOf('BS07').review[0],
  );
  const d = state.decisions[0];
  assert.equal(d.statement.length, 2);
  d.statement = [...d.statement].reverse();
  return replayBankStatement(state);
});
await refusal('BS04: a decision without a note', 'DECISION', async () =>
  replayBankStatement(
    (await decisionOn('BS04', 'accept', bs04, { note: '' })).state,
  ),
);
await refusal(
  'BS04: a parsed reading beside the originals',
  'INPUT',
  async () => {
    const { state, result } = await decisionOn('BS04', 'accept', bs04);
    return replayBankStatement({ ...state, reading: result.reading });
  },
);
await refusal(
  'BS01 as a table that prints its closing: a confirmation besides it',
  'STATE_SCOPE',
  async () => {
    const csv = (await readFile(path.join(frozen, 'BS01-statement.csv')))
      .toString('utf8')
      .trimEnd();
    const balance = csv.split('\r\n').at(-1).split(',').at(-1);
    const state = await stateOf('BS01-statement.csv', 'BS01-cashbook.csv', {
      currency: 'SAR',
      period: facts.period,
      confirmedClosing: closing,
    });
    state.files[0] = await source(
      'BS01-statement.csv',
      Buffer.from(`${csv}\r\n,,Closing balance,,,,${balance}\r\n`),
    );
    // Without the confirmation the printed closing proves the table.
    assert.equal(
      (
        await replayBankStatement({
          ...state,
          scope: { ...state.scope, confirmedClosing: null },
        })
      ).result.match.statement.completeness,
      'printed',
    );
    return replayBankStatement(state);
  },
);
await refusal('BS04: a currency given for a PDF', 'STATE_SCOPE', async () =>
  replayBankStatement(
    await stateOf('BS04-statement.pdf', 'BS04-cashbook.csv', {
      ...PDF_SCOPE,
      currency: 'SAR',
    }),
  ),
);
{
  const { state, result } = await decisionOn('BS04', 'accept', bs04);
  const session = JSON.parse(
    new TextDecoder().decode(await saveBankStatement(state)),
  );
  const tamper = async (change) => {
    const copy = structuredClone(session);
    change(copy);
    return restoreBankStatement(
      new TextEncoder().encode(JSON.stringify(copy)).buffer,
    );
  };
  await refusal(
    'a session with one statement byte changed',
    'SOURCE_HASH',
    () =>
      tamper((s) => {
        const bytes = Buffer.from(s.files[0].data, 'base64');
        bytes[bytes.length >> 1] ^= 1;
        s.files[0].data = bytes.toString('base64');
      }),
  );
  await refusal('a session with one cashbook byte changed', 'SOURCE_HASH', () =>
    tamper((s) => {
      const bytes = Buffer.from(s.files[1].data, 'base64');
      bytes[bytes.length >> 1] ^= 1;
      s.files[1].data = bytes.toString('base64');
    }),
  );
  await refusal('a session of another format', 'SESSION', () =>
    tamper((s) => {
      s.format = 'tarasuf-bank-session';
    }),
  );
  await refusal(
    'a session whose decision was moved to another case',
    'MEMBERS',
    () =>
      tamper((s) => {
        s.decisions[0].case = 'C1';
      }),
  );
  const stale = structuredClone(result);
  stale.cases.at(-1).status = 'needs-review';
  await refusal(
    'an export of a result that is no longer current',
    'STALE_RESULT',
    async () => {
      const current = await replayBankStatement(state);
      assert.equal(current.result.status, 'reviewed');
      return exportBankStatement(state, stale);
    },
  );
}
const seconds = (performance.now() - started) / 1000;

// The independent check of every workbook, and of the checker itself.
await writeFile(path.join(outDir, 'stories.json'), factsText);
const request = JSON.stringify({
  facts: path.join(outDir, 'stories.json'),
  frozen,
  exports,
  selfTest: 'BS12-reject-suggestion',
});
await writeFile(path.join(outDir, 'check-request.json'), request);
const check = spawnSync(
  process.env.PYTHON ?? 'python3',
  ['-B', path.join(suite, 'check_export.py')],
  {
    cwd: suite,
    input: request,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  },
);
assert.equal(check.status, 0, check.stderr);
const checked = JSON.parse(check.stdout);
assert.equal(checked.exports.length, exports.length);
assert.ok(checked.selfTest.alterations >= 12, 'self-test too small');
report.check = checked;
report.seconds = Math.round(seconds);

assert.equal(report.statements.length, 16);
await writeFile(
  path.join(outDir, 'proof.json'),
  `${JSON.stringify(report, null, 1)}\n`,
);
console.log(
  JSON.stringify({
    statements: report.statements.length,
    held: report.statements.filter((s) => s.status === 'held').map((s) => s.id),
    scenarios: report.scenarios.map((s) => `${s.name}: ${s.status}`),
    refusals: report.refusals.length,
    workbooksChecked: checked.exports.length,
    selfTest: `${checked.selfTest.caught.length}/${checked.selfTest.alterations} alterations caught`,
    seconds: report.seconds,
    out: path.relative(root, outDir),
  }),
);
