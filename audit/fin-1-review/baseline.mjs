// FIN-1 baseline: the product as it is (tb-financial-position-1, the flat
// family, unchanged) on FIN-1A's 18 frozen cases and the sealed FIN-1 H1
// holdout, recorded as it comes. Written after H1 was sealed and pushed.
//
//   node --experimental-strip-types audit/fin-1-review/baseline.mjs [--out file] [--assert file]
//
// Each case goes through the product's own replay (bytes read by the
// product's reader, hashes checked, then the engine), three ways:
// - As it arrives: the four files as they are, in their four roles, with the
//   case's scope confirmed and the completeness left unconfirmed, no events.
// - Leaves by hand: what an accountant must do today. The statement is cut
//   to its rows whose Kind is exactly "leaf", as a spreadsheet filter would,
//   Node ID renamed Line ID, Parent ID and Kind dropped; the other three files
//   as they are.
// - Every row by hand: the same, keeping every row but the title, so parents
//   become lines too.
// The best the flat family can say without the accountant's events is
// "needs-review" with every line at no difference: that is read as eligible,
// anything else as blocked.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const lib = (name) =>
  import(pathToFileURL(resolve(root, 'lib/reconciliation', name)).href);
const { readFile } = await lib('io.ts');
const {
  FINANCIAL_ROLES,
  FINANCIAL_SCOPE_FIELDS,
  FINANCIAL_SCOPE_HEADERS,
  FINANCIAL_VERSION,
} = await lib('tb-financial.ts');
const { replayFinancialPosition } = await lib('tb-financial-io.ts');

const FIN1A = resolve(root, 'audit/tb-financial-hierarchy');
const H1 = resolve(root, 'audit/fin-hierarchy-holdout-h1/frozen');
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function parse(text) {
  const rows = [];
  let row = [],
    cell = '',
    inside = false;
  text = text.replace(/^﻿/, '');
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

const csv = (rows) =>
  rows
    .map((r) =>
      r
        .map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v))
        .join(','),
    )
    .join('\n') + '\n';

// The flat statement an accountant makes from the hierarchical one.
function flatten(bytes, keep) {
  const [head, ...rows] = parse(new TextDecoder().decode(bytes));
  const at = (name) => head.indexOf(name);
  const columns = head
    .map((name, i) => [name, i])
    .filter(([name]) => name !== 'Parent ID' && name !== 'Kind');
  const out = [
    columns.map(([name]) => (name === 'Node ID' ? 'Line ID' : name)),
  ];
  for (const r of rows) {
    if (r.length === 1 && r[0] === '') continue;
    if (keep(r[at('Kind')] ?? '')) out.push(columns.map(([, i]) => r[i] ?? ''));
  }
  return new TextEncoder().encode(csv(out));
}

async function product(id, files, scopeRow) {
  try {
    const sources = [];
    for (const [i, bytes] of files.entries())
      sources.push(
        await readFile(
          `${id}-${FINANCIAL_ROLES[i]}.csv`,
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        ),
      );
    const { result: r } = await replayFinancialPosition({
      files: sources,
      readings: FINANCIAL_ROLES.map((role) => ({
        sheet: 0,
        role,
        family: FINANCIAL_VERSION,
        confirmed: true,
      })),
      scope: {
        ...Object.fromEntries(
          FINANCIAL_SCOPE_FIELDS.map((k, i) => [
            k,
            scopeRow[FINANCIAL_SCOPE_HEADERS[i]],
          ]),
        ),
        confirmed: true,
      },
      completeness: { confirmed: false, reference: '', note: '' },
      events: [],
    });
    const codes = [
      ...new Set([
        ...r.issues.map((i) => i.code),
        ...r.missing.map((m) => `missing:${m.kind}`),
      ]),
    ].sort(byText);
    return {
      status: r.status,
      reads: r.status === 'needs-review' ? 'eligible' : 'blocked',
      codes,
      lines: r.lines.length,
      differences: r.lines.filter(
        (l) => l.difference !== null && l.difference !== 0,
      ).length,
      equation: r.grandTotals ? r.grandTotals.reported.equation : null,
    };
  } catch (error) {
    return {
      status: 'refused',
      reads: 'blocked',
      codes: [String(error?.message ?? error)],
    };
  }
}

function cases() {
  const out = [];
  const contract = json(resolve(FIN1A, 'contract.json'));
  for (const c of json(resolve(FIN1A, 'frozen/cases.json')).cases)
    out.push({
      suite: 'FIN-1A',
      id: c.id,
      folder: resolve(FIN1A, 'frozen', c.id),
      scope: contract.scope,
      contract: { status: c.expected, codes: c.requiredCodes },
    });
  const expected = json(resolve(H1, 'EXPECTED.json')).stories;
  for (const id of readdirSync(H1)
    .filter((n) => existsSync(resolve(H1, n, 'scope.json')))
    .sort())
    out.push({
      suite: 'H1',
      id,
      folder: resolve(H1, id),
      scope: json(resolve(H1, id, 'scope.json')),
      contract: { status: expected[id].status, codes: expected[id].codes },
    });
  return out;
}

async function main() {
  const { values } = parseArgs({
    options: { out: { type: 'string' }, assert: { type: 'string' } },
  });
  const rows = [];
  for (const c of cases()) {
    const files = FINANCIAL_ROLES.map((role) =>
      readFileSync(resolve(c.folder, `${role}.csv`)),
    );
    const statement = files[3];
    const run = async (last) =>
      product(c.id, [...files.slice(0, 3), last], c.scope);
    rows.push({
      suite: c.suite,
      id: c.id,
      contract: c.contract,
      asArrives: await run(statement),
      leavesByHand: await run(flatten(statement, (kind) => kind === 'leaf')),
      everyRowByHand: await run(flatten(statement, (kind) => kind !== 'title')),
    });
  }
  const tally = (way) => {
    const agree = rows.filter((r) => r[way].reads === r.contract.status);
    return {
      agree: agree.length,
      readsEligibleWhereContractBlocks: rows
        .filter(
          (r) => r[way].reads === 'eligible' && r.contract.status === 'blocked',
        )
        .map((r) => `${r.suite} ${r.id}`),
      blocksWhereContractEligible: rows
        .filter(
          (r) => r[way].reads === 'blocked' && r.contract.status === 'eligible',
        )
        .map((r) => `${r.suite} ${r.id}`),
    };
  };
  const report = {
    schema: 'tarasuf-fin1-flat-baseline/1',
    product:
      'tb-financial-position-1 through replayFinancialPosition, unchanged',
    cases: rows.length,
    asArrives: tally('asArrives'),
    leavesByHand: tally('leavesByHand'),
    everyRowByHand: tally('everyRowByHand'),
    rows,
  };
  const text = JSON.stringify(report, null, 1) + '\n';
  if (values.out) writeFileSync(resolve(here, values.out), text);
  const { rows: _rows, ...summary } = report;
  console.log(JSON.stringify(summary, null, 1));
  if (
    values.assert &&
    readFileSync(resolve(here, values.assert), 'utf8') !== text
  ) {
    console.error('FIN-1 baseline differs from the record');
    process.exit(1);
  }
}

await main();
