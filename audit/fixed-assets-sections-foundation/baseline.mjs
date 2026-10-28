// FA-1 baseline: the long fixed-assets family as it is on the sealed stories.
//
//   A. As each story arrives: its register as the family's long register, its
//      category map as the mapping and its GL balances as the GL, with a
//      policy evidence file holding the family's header alone (the family
//      needs four sources and the story has three), through the product's
//      replay from bytes. Recorded: the refusal code, or the family's
//      financial state and issue codes.
//   B. Cut by hand into the family's four files, as an accountant would copy
//      them: every record row under a section's column row copied with the
//      section's Entity, Asset ledger, Currency and As of as its scope (rows
//      under wide columns turned into four component rows); section
//      markers, labels, totals, blank and stray rows dropped, and the
//      location and category with them, which the family has no column for;
//      an invisible second byte order mark before a Section is not seen. For
//      every asset and component, a mapping row and a policy evidence row
//      from the first category map row valid at the as-of date, with that
//      row's class and validity; none when no row is valid. Every GL row
//      copied with its own Entity, GL ledger, Currency and As of. Recorded per
//      account: the contract's status beside the family's difference for it.
//
// The dense stories are regenerated and checked against their sealed hashes
// first, and judged against the oracle's output, itself checked against the
// sealed expectation hash.
//
//   node --experimental-strip-types audit/fixed-assets-sections-foundation/baseline.mjs [--out name] [--assert name]
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
const {
  ASSET_VERSION,
  ASSET_LONG_FAMILY,
  ASSET_ROLES,
  ASSET_HEADERS,
  ASSET_LONG_HEADERS,
} = await import(lib('fixed-assets.ts'));
const { readAssetFile, replayAsset } = await import(lib('fixed-assets-io.ts'));

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const buffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const code = (error) => {
  const m = String(error?.message ?? error);
  return m.startsWith('ASSET_') ? m.slice(6) : `READER: ${m.slice(0, 80)}`;
};
const SIGNS = {
  cost: 'debit-positive',
  depreciation: 'credit-positive',
  impairment: 'credit-positive',
};
const WIDE = {
  Cost: 'cost',
  'Accumulated depreciation': 'depreciation',
  Impairment: 'impairment',
  'Carrying amount': 'carrying',
};

function familyScope(s) {
  return {
    entity: s.entity,
    assetLedger: s.assetLedger,
    glLedger: s.glLedger,
    currency: s.currency,
    currencyBasis: 'functional',
    postingStatus: 'posted',
    postingLayer: 'ledger',
    asOf: s.asOf,
    chartVersion: 'COA-1',
    mapVersion: 'MAP-1',
    componentPolicyVersion: 'POL-1',
    assetAccountSetVersion: 'SET-1',
    confirmed: true,
  };
}
const scopeCells = (s) => [
  s.entity,
  s.assetLedger,
  s.glLedger,
  s.currency,
  s.currencyBasis,
  s.postingStatus,
  s.postingLayer,
  s.asOf,
  s.chartVersion,
  s.mapVersion,
  s.componentPolicyVersion,
  s.assetAccountSetVersion,
];

async function family(files, scope) {
  const input = {
    files,
    readings: ASSET_ROLES.map((role, i) => ({
      sheet: 0,
      role,
      family: i === 0 ? ASSET_LONG_FAMILY : ASSET_VERSION,
      confirmed: true,
    })),
    scope,
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
  try {
    const { result } = await replayAsset(input);
    return {
      financial: result.financial,
      issues: [...new Set(result.issues.map((i) => i.code))].sort(byText),
      missing: [...new Set(result.missing.map((m) => m.reason))].sort(byText),
      comparisons: result.comparisons,
    };
  } catch (error) {
    return { refused: code(error) };
  }
}

const csvCell = (v) =>
  /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
const csv = (rows) =>
  new TextEncoder().encode(
    rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n',
  );

async function asItComes(folder, given) {
  const files = [];
  try {
    for (const name of given.names)
      files.push(
        await readAssetFile(name, buffer(readFileSync(join(folder, name)))),
      );
    files.splice(
      2,
      0,
      await readAssetFile(
        'policy-evidence.csv',
        buffer(csv([ASSET_HEADERS[2]])),
      ),
    );
  } catch (error) {
    return { refused: code(error) };
  }
  const out = await family(files, familyScope(given.scope));
  delete out.comparisons;
  return out;
}

const meaningful = (cells) => {
  let k = cells.length;
  while (k && cells[k - 1] === '') k--;
  return cells.slice(0, k);
};

function cutRegister(rows) {
  const records = [];
  let section = null;
  for (const raw of rows) {
    const cells = raw.map((v, i) => (i === 0 ? v.replace(/^﻿/, '') : v));
    const m = meaningful(cells);
    if (m[0] === 'Section') {
      section = { labels: {}, columns: null };
      continue;
    }
    if (m[0] === 'End section') {
      section = null;
      continue;
    }
    if (!section || !m.length) continue;
    if (!section.columns) {
      if (m.length > 2) section.columns = m;
      else if (m.length === 2) section.labels[m[0]] = m[1];
      continue;
    }
    if (m[0] === 'Section total') continue;
    const get = (h) => cells[section.columns.indexOf(h)] ?? '';
    const base = {
      labels: section.labels,
      asset: get('Asset ID'),
      dims: get('Asset dimensions'),
      valuation: get('Valuation reference'),
    };
    if (section.columns.includes('Component'))
      records.push({
        ...base,
        component: get('Component'),
        amount: get('Amount'),
      });
    else
      for (const [header, component] of Object.entries(WIDE))
        if (section.columns.includes(header))
          records.push({ ...base, component, amount: get(header) });
  }
  return records;
}

async function cutByHand(folder, given) {
  const read = (name) =>
    readAssetFile(name, buffer(readFileSync(join(folder, name))));
  let register, map, gl;
  try {
    [register, map, gl] = await Promise.all(given.names.map(read));
  } catch (error) {
    return { refused: code(error) };
  }
  const scope = familyScope(given.scope);
  const records = cutRegister(register.sheets[0].rows);
  const sectionScope = (labels) =>
    scopeCells({
      ...scope,
      entity: labels.Entity ?? '',
      assetLedger: labels['Asset ledger'] ?? '',
      currency: labels.Currency ?? '',
      asOf: labels['As of'] ?? '',
    });
  const registerRows = [
    ASSET_LONG_HEADERS,
    ...records.map((r) => [
      r.asset,
      r.dims,
      r.component,
      r.amount,
      r.valuation,
      ...sectionScope(r.labels),
    ]),
  ];
  const mapRows = map.sheets[0].rows;
  const mapHead = mapRows[0] ?? [];
  const mapGet = (row, h) => row[mapHead.indexOf(h)] ?? '';
  const valid = (category, component) =>
    mapRows
      .slice(1)
      .find(
        (row) =>
          mapGet(row, 'Category') === category &&
          mapGet(row, 'Component') === component &&
          mapGet(row, 'Valid from') <= scope.asOf &&
          scope.asOf <= mapGet(row, 'Valid to'),
      );
  const assets = new Map();
  for (const r of records)
    assets.set(JSON.stringify([r.asset, r.dims]), {
      asset: r.asset,
      dims: r.dims,
      valuation: r.valuation,
      category: r.labels.Category,
      labels: r.labels,
    });
  const mapping = [ASSET_HEADERS[1]];
  const evidence = [ASSET_HEADERS[2]];
  let n = 0;
  for (const a of assets.values())
    for (const component of ['cost', 'depreciation', 'impairment']) {
      const row = valid(a.category, component);
      if (!row) continue;
      n++;
      const account = mapGet(row, 'GL account'),
        dims = mapGet(row, 'GL dimensions');
      mapping.push([
        `MAP-${n}`,
        a.asset,
        a.dims,
        component,
        account,
        dims,
        `EV-${n}`,
        ...scopeCells(scope),
      ]);
      evidence.push([
        `EV-${n}`,
        a.asset,
        a.dims,
        component,
        a.valuation,
        account,
        dims,
        mapGet(row, 'Account class'),
        SIGNS[component],
        'provided-posted-component',
        mapGet(row, 'Valid from'),
        mapGet(row, 'Valid to'),
        `Category map ${a.category}`,
        ...scopeCells(scope),
      ]);
    }
  const glRows = gl.sheets[0].rows;
  const glHead = glRows[0] ?? [];
  const glGet = (row, h) => row[glHead.indexOf(h)] ?? '';
  const glOut = [
    ASSET_HEADERS[3],
    ...glRows
      .slice(1)
      .filter((row) => row.some((v) => v !== ''))
      .map((row) => [
        glGet(row, 'GL account'),
        glGet(row, 'GL dimensions'),
        glGet(row, 'Account class'),
        glGet(row, 'Debit'),
        glGet(row, 'Credit'),
        ...scopeCells({
          ...scope,
          entity: glGet(row, 'Entity'),
          glLedger: glGet(row, 'GL ledger'),
          currency: glGet(row, 'Currency'),
          asOf: glGet(row, 'As of'),
        }),
      ]),
  ];
  const files = [];
  try {
    for (const [k, rows] of [registerRows, mapping, evidence, glOut].entries())
      files.push(await readAssetFile(`cut-${k}.csv`, buffer(csv(rows))));
  } catch (error) {
    return { refused: code(error), rows: registerRows.length - 1 };
  }
  return {
    ...(await family(files, scope)),
    rows: [registerRows, mapping, evidence, glOut].map((r) => r.length - 1),
  };
}

function compare(want, cut) {
  const out = [];
  for (const a of want.accounts) {
    const c = cut.comparisons?.find(
      (x) => x.account === a.account && x.dimensions === a.dimensions,
    );
    out.push([
      `${a.account}|${a.dimensions}`,
      a.status,
      c === undefined ? 'absent' : c.difference,
    ]);
  }
  return out;
}

async function judge(folder, sid, want) {
  const given = JSON.parse(
    readFileSync(join(folder, `${sid}-input.json`), 'utf8'),
  );
  const first = await asItComes(folder, given);
  if (want.refused) return { contractRefused: want.refused, asItComes: first };
  const cut = await cutByHand(folder, given);
  const accounts = compare(want, cut);
  const count = (f) => accounts.filter(f).length;
  const agrees = (d) => d === 0;
  const result = {
    contractRefused: null,
    asItComes: first,
    cut: {
      refused: cut.refused ?? null,
      financial: cut.financial ?? null,
      issues: cut.issues ?? [],
      missing: cut.missing ?? [],
      rows: cut.rows,
    },
    accounts: accounts.length,
    contractConsistentFamilyAgrees: count(
      ([, s, d]) => s === 'consistent' && agrees(d),
    ),
    contractConsistentFamilyWithholds: count(
      ([, s, d]) => s === 'consistent' && d === null,
    ),
    contractConsistentFamilyOther: count(
      ([, s, d]) => s === 'consistent' && !agrees(d) && d !== null,
    ),
    contractNotConsistentFamilyAgrees: count(
      ([, s, d]) => s !== 'consistent' && agrees(d),
    ),
    contractNotConsistentFamilyOther: count(
      ([, s, d]) => s !== 'consistent' && !agrees(d),
    ),
  };
  if (!sid.startsWith('D')) result.perAccount = accounts;
  return result;
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
  const dir = mkdtempSync(join(tmpdir(), 'fa1-dense-'));
  try {
    execFileSync('python3', ['-B', join(here, 'dense.py'), dir], {
      stdio: 'ignore',
    });
    const raw = execFileSync(
      'python3',
      ['-B', join(here, 'oracle.py'), '--dense', dir],
      { maxBuffer: 1 << 30 },
    );
    const sealed = JSON.parse(
      readFileSync(join(FROZEN, 'DENSE-MANIFEST.json'), 'utf8'),
    ).expectedSha256;
    if (createHash('sha256').update(raw).digest('hex') !== sealed)
      throw Error('the dense expectations differ from the seal');
    const judged = JSON.parse(raw.toString()).stories;
    for (const sid of Object.keys(judged).sort(byText))
      stories[sid] = await judge(dir, sid, judged[sid]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const sum = (k) =>
    Object.values(stories).reduce((n, s) => n + (s[k] ?? 0), 0);
  const tally = (pick) => {
    const out = {};
    for (const s of Object.values(stories)) {
      const k = pick(s);
      if (k !== undefined) out[k] = (out[k] ?? 0) + 1;
    }
    return Object.fromEntries(
      Object.entries(out).sort(([a], [b]) => byText(a, b)),
    );
  };
  const record = {
    schema: 'tarasuf-fa1-baseline/1',
    family: ASSET_LONG_FAMILY,
    rule: 'A: each story as it arrives, its three files in the family roles with a policy evidence file of its header alone; B: cut by hand into the family four files, each section scope copied onto its rows, a mapping and an evidence row per asset and component from the first category map row valid at the as-of date',
    asItComes: tally((s) => s.asItComes.refused ?? s.asItComes.financial),
    cut: tally((s) =>
      s.contractRefused ? undefined : (s.cut.refused ?? s.cut.financial),
    ),
    totals: {
      accounts: sum('accounts'),
      contractConsistentFamilyAgrees: sum('contractConsistentFamilyAgrees'),
      contractConsistentFamilyWithholds: sum(
        'contractConsistentFamilyWithholds',
      ),
      contractConsistentFamilyOther: sum('contractConsistentFamilyOther'),
      contractNotConsistentFamilyAgrees: sum(
        'contractNotConsistentFamilyAgrees',
      ),
      contractNotConsistentFamilyOther: sum('contractNotConsistentFamilyOther'),
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
  console.log(
    JSON.stringify({
      asItComes: record.asItComes,
      cut: record.cut,
      totals: record.totals,
    }),
  );
}

await main();
