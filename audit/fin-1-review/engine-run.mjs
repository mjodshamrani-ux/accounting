// The FIN-1 engine (tb-financial-hierarchy-1) through its byte replay on
// FIN-1A's 18 frozen cases, or, with FINH_SUITE=audit/fin-hierarchy-holdout-h1,
// on the sealed H1 stories. Compared with the FIN-1A oracle as it is:
// - the same status;
// - every code the case requires (FIN-1A's requiredCodes, or the H1 intent)
//   among the engine's codes, and every engine code among the oracle's;
// - for an eligible case, the same facts and ownership.
//
//   node --experimental-strip-types audit/fin-1-review/engine-run.mjs [--out file] [--assert file]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isDeepStrictEqual } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const lib = (name) =>
  import(pathToFileURL(resolve(root, 'lib/reconciliation', name)).href);
const { FINH_ROLES, FINH_VERSION } = await lib('tb-financial-hierarchy.ts');
const { replayFinancialHierarchy } = await lib('tb-financial-hierarchy-io.ts');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function suite() {
  const h1 = process.env.FINH_SUITE;
  if (h1) {
    const frozen = resolve(root, h1, 'frozen');
    const facts = json(resolve(frozen, 'stories.json'));
    const expected = json(resolve(frozen, 'EXPECTED.json')).stories;
    return {
      name: h1,
      record: resolve(root, h1, 'results'),
      cases: facts.stories.map((s) => ({
        id: s.id,
        folder: resolve(frozen, s.id),
        scope: json(resolve(frozen, s.id, 'scope.json')),
        required: s.intent.codes,
        oracle: expected[s.id],
      })),
    };
  }
  const fin1a = resolve(root, 'audit/tb-financial-hierarchy');
  const scope = json(resolve(fin1a, 'contract.json')).scope;
  const oracle = JSON.parse(
    execFileSync('python3', ['-B', resolve(here, 'oracle_codes.py')], {
      encoding: 'utf8',
    }),
  );
  return {
    name: 'audit/tb-financial-hierarchy',
    record: resolve(here, 'results'),
    cases: json(resolve(fin1a, 'frozen/cases.json')).cases.map((c) => ({
      id: c.id,
      folder: resolve(fin1a, 'frozen', c.id),
      scope,
      required: c.requiredCodes,
      oracle: oracle[c.id],
    })),
  };
}

async function engine(c) {
  try {
    const files = FINH_ROLES.map((role) => {
      const bytes = readFileSync(resolve(c.folder, `${role}.csv`));
      return {
        name: `${c.id}-${role}.csv`,
        original: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      };
    });
    const { result } = await replayFinancialHierarchy({
      files,
      readings: FINH_ROLES.map((role) => ({
        role,
        family: FINH_VERSION,
        confirmed: true,
      })),
      scope: { confirmed: true, fields: c.scope },
    });
    return result;
  } catch (error) {
    return { refused: String(error?.message ?? error) };
  }
}

async function main() {
  const { values } = parseArgs({
    options: { out: { type: 'string' }, assert: { type: 'string' } },
  });
  const s = suite();
  const rows = [];
  for (const c of s.cases) {
    const r = await engine(c);
    const codes = r.refused
      ? [r.refused]
      : [...new Set(r.issues.map((i) => i.code))].sort(byText);
    const problems = [];
    if (r.refused) problems.push(`refused ${r.refused}`);
    else {
      if (r.status !== c.oracle.status)
        problems.push(`status ${r.status}, oracle ${c.oracle.status}`);
      const missing = c.required.filter((k) => !codes.includes(k));
      if (missing.length)
        problems.push(`required codes absent: ${missing.join(', ')}`);
      const beyond = codes.filter((k) => !c.oracle.codes.includes(k));
      if (beyond.length)
        problems.push(`codes the oracle does not give: ${beyond.join(', ')}`);
      if (c.oracle.status === 'eligible') {
        if (!isDeepStrictEqual(r.facts, c.oracle.facts))
          problems.push('facts differ');
        if (!isDeepStrictEqual(r.ownership, c.oracle.ownership))
          problems.push('ownership differs');
      }
    }
    rows.push({
      id: c.id,
      oracle: { status: c.oracle.status, codes: c.oracle.codes },
      required: c.required,
      engine: { status: r.status ?? 'refused', codes },
      agrees: problems.length === 0,
      problems,
    });
  }
  const report = {
    schema: 'tarasuf-fin1-engine-run/1',
    suite: s.name,
    engine: `${FINH_VERSION} through replayFinancialHierarchy`,
    rule: 'same status; required codes within the engine codes, engine codes within the oracle codes; eligible: same facts and ownership',
    cases: rows.length,
    agree: rows.filter((r) => r.agrees).length,
    rows,
  };
  const text = JSON.stringify(report, null, 1) + '\n';
  if (values.out) writeFileSync(resolve(s.record, values.out), text);
  console.log(
    JSON.stringify({
      suite: s.name,
      cases: report.cases,
      agree: report.agree,
      disagree: rows.filter((r) => !r.agrees).map((r) => [r.id, r.problems]),
    }),
  );
  if (
    values.assert &&
    readFileSync(resolve(s.record, values.assert), 'utf8') !== text
  ) {
    console.error('FIN-1 engine run differs from the record');
    process.exit(1);
  }
}

await main();
