// INV-3 baseline: the inventory family as it is on the sealed stories. Each
// story's four files go through the product's replay from bytes, as the
// worker runs it; the dense stories are regenerated and checked against their
// sealed hashes first, and judged against the oracle's output, itself checked
// against the sealed expectation hashes. Recorded as it comes:
//   - whether the decision equals the oracle (financial, issues, missing keys,
//     comparisons, totals), which the contract must leave unchanged;
//   - for every unlinked register row, whether the result names the row and
//     its reasons, names its item and dimensions, or says only the kind;
//   - which unlinked rows of different reasons read the same in the result;
//   - for the focused stories, the workbook's sheets and whether any sheet
//     names an unlinked row with its reasons.
//
//   node --experimental-strip-types audit/inventory-links-foundation/baseline.mjs [--out name] [--assert name]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const FROZEN = join(here, 'frozen');
const lib = (name) =>
  pathToFileURL(join(root, 'lib/reconciliation', name)).href;
const { STOCK_ROLES, STOCK_VERSION } = await import(
  lib('inventory-register.ts')
);
const { replayStock, exportStock } = await import(
  lib('inventory-register-io.ts')
);
const ExcelJS = (await import('exceljs')).default;

const ROLES = ['register', 'mapping', 'evidence', 'gl'];
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (list) => [...list].map((v) => JSON.stringify(v)).sort(byText);
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
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

async function judge(folder, sid, want, workbook) {
  let replay;
  try {
    replay = await replayStock(input(folder, sid));
  } catch (error) {
    const refused = String(error.message).replace(/^STOCK_/, '');
    return { refused, refusalEqual: refused === want.refused };
  }
  const r = replay.result;
  if (want.refused) return { refused: null, refusalEqual: false };
  const decision = {
    financial: r.financial === want.financial,
    issues: same(
      r.issues.map((i) => [i.source, i.row, i.code]),
      want.issues,
    ),
    missing: same(r.missing, want.missing),
    comparisons:
      JSON.stringify(r.comparisons) === JSON.stringify(want.comparisons),
    totals: JSON.stringify(r.totals) === JSON.stringify(want.totals),
  };
  const rows = want.links.filter((l) => l[1] === 'unlinked');
  const keyOf = (row) =>
    r.records[0].find((x) => x.row === row)?.values.slice(0, 2);
  const stated = { rowAndReasons: 0, itemKey: 0, kindOnly: 0 };
  const statement = new Map();
  for (const [row, , reasons] of rows) {
    const named = (r.links ?? []).find(
      (l) =>
        l.row === row && JSON.stringify(l.reasons) === JSON.stringify(reasons),
    );
    if (named) stated.rowAndReasons++;
    const kind = r.missing
      .find((m) => m.endsWith(':' + JSON.stringify(keyOf(row))))
      ?.split(':')[0];
    if (kind) stated.itemKey++;
    if (kind) stated.kindOnly++;
    const said = kind ?? 'nothing';
    if (!statement.has(said)) statement.set(said, new Set());
    statement.get(said).add(reasons.join(' '));
  }
  const indistinct = [...statement.entries()]
    .filter(([, reasons]) => reasons.size > 1)
    .map(([said, reasons]) => [said, [...reasons].sort(byText)]);
  const out = {
    refused: null,
    decisionEqual: Object.values(decision).every(Boolean),
    decision,
    registerRows: want.links.length,
    unlinkedRows: rows.length,
    stated,
    indistinct,
    linksInResult: Array.isArray(r.links),
  };
  if (workbook) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await exportStock(replay.state, r));
    const sheets = book.worksheets.map((s) => s.name);
    let named = 0;
    for (const [row, , reasons] of rows) {
      const found = book.worksheets.some((sheet) => {
        let hit = false;
        sheet.eachRow((cells) => {
          const values = cells.values.slice(1).map(String);
          if (
            values.includes(String(row)) &&
            reasons.every((code) => values.some((v) => v.includes(code)))
          )
            hit = true;
        });
        return hit;
      });
      if (found) named++;
    }
    out.workbook = { sheets, unlinkedRowsNamedWithReasons: named };
  }
  return out;
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
    stories[sid] = await judge(FROZEN, sid, focused[sid], true);
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
      stories[sid] = await judge(dir, sid, judged.stories[sid], false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const all = Object.values(stories).filter((s) => !s.refused);
  const record = {
    schema: 'tarasuf-inv3-baseline/1',
    family: STOCK_VERSION,
    rule: 'the product as it is, through its replay from bytes, against the sealed expectations',
    summary: {
      stories: Object.keys(stories).length,
      refusalsEqual: Object.values(stories)
        .filter((s) => s.refused)
        .every((s) => s.refusalEqual),
      decisionsEqual: `${all.filter((s) => s.decisionEqual).length}/${all.length}`,
      unlinkedRows: all.reduce((n, s) => n + s.unlinkedRows, 0),
      namedWithReasons: all.reduce((n, s) => n + s.stated.rowAndReasons, 0),
      keyNamed: all.reduce((n, s) => n + s.stated.itemKey, 0),
      storiesWithIndistinctReasons: all.filter((s) => s.indistinct.length)
        .length,
      workbookRowsNamedWithReasons: all.reduce(
        (n, s) => n + (s.workbook?.unlinkedRowsNamedWithReasons ?? 0),
        0,
      ),
    },
    stories,
  };
  const text = JSON.stringify(record, null, 1) + '\n';
  if (args.out) writeFileSync(join(here, 'results', args.out), text);
  if (
    args.assert &&
    readFileSync(join(here, 'results', args.assert), 'utf8') !== text
  ) {
    console.error('the baseline differs from its record');
    process.exit(1);
  }
  console.log(JSON.stringify(record.summary));
}

await main();
