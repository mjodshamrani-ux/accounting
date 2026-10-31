// PAY-1 engine run: payroll-long-register-1 on sealed stories through the
// replay from bytes, compared with the sealed EXPECTED.json in full: the
// refusal, or every employee's status, codes and components and lines, the
// excluded sections, the shared payee accounts, the unplaced rows, the run
// sums and the run codes.
//
//   node --experimental-strip-types audit/payroll-long-register-foundation/engine-run.mjs [--out name] [--assert name]
//
// PLR_SUITE selects another sealed suite (a holdout) with the same layout;
// --out and --assert name a file in that suite's results/.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const suite = resolve(
  root,
  process.env.PLR_SUITE ?? 'audit/payroll-long-register-foundation',
);
const FROZEN = resolve(suite, 'frozen');
const { replayLongRegister } = await import(
  pathToFileURL(resolve(root, 'lib/reconciliation/payroll-long-register-io.ts'))
    .href
);
const { PLR_ROLE, PLR_VERSION } = await import(
  pathToFileURL(resolve(root, 'lib/reconciliation/payroll-long-register.ts'))
    .href
);

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const minor = (v) => {
  if (v === null) return null;
  const n = BigInt(v);
  return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : v;
};

function asExpected(r) {
  if (r.refused) return { refused: r.refused };
  const employees = {};
  for (const e of r.employees)
    employees[e.key] = {
      status: e.status,
      codes: e.codes,
      earnings: minor(e.earnings),
      deductions: minor(e.deductions),
      employer: minor(e.employer),
      net: minor(e.net),
      payee: e.payee,
      lines:
        e.lines &&
        e.lines.map((l) => [l.id, l.component, l.kind, minor(l.amount)]),
    };
  return {
    employees,
    excludedSections: r.excludedSections,
    sharedPayees: r.sharedPayees.map((s) => [s.payee, s.employees]),
    unplaced: r.unplaced.map((u) => [u.row, u.code]),
    totals:
      r.totals &&
      Object.fromEntries(
        Object.entries(r.totals).map(([k, v]) => [k, minor(v)]),
      ),
    run: r.run,
  };
}

// Deep equality with key order ignored, and the first path that differs.
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
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(
    byText,
  );
  for (const k of keys) {
    const d = differs(a[k], b[k], `${path}/${k}`);
    if (d) return d;
  }
  return null;
}

async function main() {
  const { values: args } = parseArgs({
    options: { out: { type: 'string' }, assert: { type: 'string' } },
  });
  const expected = JSON.parse(
    readFileSync(resolve(FROZEN, 'EXPECTED.json'), 'utf8'),
  ).stories;
  const ids = readdirSync(FROZEN)
    .filter((n) => n.endsWith('-scope.json'))
    .map((n) => n.slice(0, -'-scope.json'.length))
    .sort(byText);
  const stories = {};
  for (const id of ids) {
    const bytes = readFileSync(resolve(FROZEN, `${id}-register.csv`));
    const fields = JSON.parse(
      readFileSync(resolve(FROZEN, `${id}-scope.json`), 'utf8'),
    );
    let got;
    try {
      const { result } = await replayLongRegister({
        files: [
          {
            name: `${id}-register.csv`,
            original: bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ),
          },
        ],
        readings: [{ role: PLR_ROLE, family: PLR_VERSION, confirmed: true }],
        scope: { confirmed: true, fields },
      });
      got = asExpected(result);
    } catch (error) {
      got = { thrown: String(error.message) };
    }
    const where = differs(got, expected[id]);
    stories[id] = where
      ? {
          equal: false,
          firstDifference: where,
          engine: got,
          expected: expected[id],
        }
      : { equal: true };
  }
  const equal = Object.values(stories).filter((s) => s.equal).length;
  const record = {
    schema: 'tarasuf-pay1-long-register-engine-run/1',
    family: PLR_VERSION,
    suite: process.env.PLR_SUITE ?? 'audit/payroll-long-register-foundation',
    rule: 'equal to EXPECTED.json in full',
    equal,
    of: ids.length,
    stories,
  };
  const text = JSON.stringify(record, null, 1) + '\n';
  if (args.out) writeFileSync(resolve(suite, 'results', args.out), text);
  if (args.assert) {
    const want = readFileSync(resolve(suite, 'results', args.assert), 'utf8');
    if (want !== text) {
      console.error('the engine run differs from its record');
      process.exit(1);
    }
  }
  console.log(JSON.stringify({ equal, of: ids.length }));
  for (const [id, s] of Object.entries(stories))
    if (!s.equal) console.log(id, s.firstDifference);
}

await main();
