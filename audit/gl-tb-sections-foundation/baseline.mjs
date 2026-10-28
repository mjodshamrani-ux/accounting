// GLT-1 baseline: the product as it is (gl-tb-canonical-1, unchanged) on the
// sealed GLT-1 foundation, recorded as it comes. Written after the seal.
//
//   node --experimental-strip-types audit/gl-tb-sections-foundation/baseline.mjs [--out file] [--assert file]
//
// Each story is read through the product's own replay (bytes read again,
// hashes checked, then the engine), twice:
// - As it is: the story's GL file as the GL detail and its TB file as the
//   trial balance, with the run scope and the first section's account and
//   dimensions. There is no role for sections or pages.
// - Split by hand: what an accountant must do today, one run per account and
//   dimensions. Each GL section is copied out: its records under the
//   product's GL header, by column name (a column the product does not name
//   is left out, one it needs and the section lacks stays blank), each record
//   restating the section's labels as written (an absent label stays blank,
//   nothing is filled down). Each TB row whose Row type is exactly account is
//   copied out the same way under the product's TB header, with its page's
//   labels and the page ID as its snapshot. Rows outside every section or
//   page, and TB rows of another type, go nowhere. The keys are every
//   section's and every copied TB row's account and dimensions as written;
//   each key is filtered as a spreadsheet filter would (exact text) and run
//   with the run scope and that account and dimensions.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const FROZEN = resolve(here, 'frozen');
const lib = (name) =>
  import(pathToFileURL(resolve(root, 'lib/reconciliation', name)).href);
const { readFile } = await lib('io.ts');
const {
  BALANCE_FIELDS,
  GL_HEADERS,
  GL_TB_VERSION,
  GL_SCOPE_FIELDS,
  TB_HEADERS,
} = await lib('gl-tb.ts');
const { replayGlTb } = await lib('gl-tb-io.ts');

const LABELS = [
  'Entity',
  'Ledger',
  'Account',
  'Complete dimensions',
  'Currency',
  'Currency basis',
  'Posting status',
  'Posting layer',
  'Period start',
  'Period end',
];
const TB_AMOUNTS = TB_HEADERS.slice(-6);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const trim = (v) => (v ?? '').trim();
const filled = (r) => r.filter((v) => trim(v)).length;

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

// The blocks an accountant sees: a start row, label rows (key, value), the
// first row with more than two filled cells as the column row, then rows,
// until an end row or the next start row. Rows outside every block are kept
// apart, as rows the split leaves behind.
function blocks(rows, start, end) {
  const out = [],
    outside = [];
  let b = null;
  for (const [i, r] of rows.entries()) {
    if (!filled(r)) continue;
    const first = trim(r[0]);
    if (first === start) {
      b = { id: trim(r[1]), labels: {}, columns: null, rows: [] };
      out.push(b);
    } else if (!b) outside.push(i + 1);
    else if (first === end) b = null;
    else if (!b.columns && filled(r) > 2) b.columns = r.map(trim);
    else if (!b.columns) b.labels[first] ??= trim(r[1]);
    else b.rows.push({ row: i + 1, cells: r });
  }
  return { blocks: out, outside };
}

const field = (block, r, name) => {
  const j = block.columns?.indexOf(name) ?? -1;
  return j < 0 ? '' : (r.cells[j] ?? '');
};

async function product(name, gl, tb, scope) {
  try {
    const files = [];
    for (const [suffix, bytes] of [
      ['gl', gl],
      ['tb', tb],
    ])
      files.push(
        await readFile(
          `${name}-${suffix}.csv`,
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        ),
      );
    const { result: r } = await replayGlTb({
      files,
      readings: [
        { sheet: 0, role: 'gl-detail', family: GL_TB_VERSION, confirmed: true },
        {
          sheet: 0,
          role: 'trial-balance',
          family: GL_TB_VERSION,
          confirmed: true,
        },
      ],
      scope: { ...scope, confirmed: true },
    });
    return {
      status: r.status,
      errors: [
        ...new Set(r.inventory.filter((i) => i.error).map((i) => i.error)),
      ].sort(byText),
      missing: [...r.missing].sort(byText),
      differences: r.differences
        ? BALANCE_FIELDS.filter((f) => r.differences[f] !== 0)
        : null,
      glBridge: r.glBridge,
      tbBridge: r.tbBridge,
      gl: r.gl ? BALANCE_FIELDS.map((f) => r.gl[f]) : null,
      tb: r.tb ? BALANCE_FIELDS.map((f) => r.tb[f]) : null,
    };
  } catch (error) {
    return { refused: String(error?.message ?? error) };
  }
}

const scopeOf = (run, account, dims) => {
  const v = { ...run, Account: account, 'Complete dimensions': dims };
  return Object.fromEntries(GL_SCOPE_FIELDS.map((k, i) => [k, v[LABELS[i]]]));
};

// The product's run in the contract's words.
function verdict(run) {
  if (run.refused) return { status: 'refused', codes: [run.refused] };
  if (run.status === 'source-error')
    return { status: 'held', codes: run.errors };
  if (run.status === 'missing') {
    const gone =
      run.missing.includes('gl-opening') &&
      run.missing.includes('gl-closing') &&
      !run.gl;
    const codes = run.missing.map(
      (m) =>
        ({
          'gl-opening': 'GL_OPENING_ABSENT',
          'gl-closing': 'GL_CLOSING_ABSENT',
          'tb-balance': 'TB_ROW_ABSENT',
        })[m] ?? m,
    );
    return {
      status: 'missing',
      codes: (gone
        ? ['GL_SECTION_ABSENT', ...codes.filter((c) => !c.startsWith('GL_'))]
        : codes
      ).sort(byText),
    };
  }
  if (run.status === 'inconsistent')
    return {
      status: 'inconsistent',
      codes: [
        ...(run.glBridge ? ['GL_BRIDGE'] : []),
        ...(run.tbBridge ? ['TB_BRIDGE'] : []),
      ],
    };
  if (run.status === 'difference')
    return { status: 'difference', codes: [...run.differences].sort(byText) };
  return { status: run.status, codes: [] };
}

function classify(got, oracle) {
  if (!oracle) return 'not-an-account';
  if (got.status === oracle.status)
    return JSON.stringify(got.codes) === JSON.stringify(oracle.codes) ||
      got.status === 'held'
      ? 'agree'
      : 'codes';
  if (got.status === 'refused') return 'refused';
  if (got.status === 'consistent') return 'unsafe';
  if (got.status === 'difference' && oracle.status !== 'consistent')
    return 'unsafe';
  if (got.status === 'held') return 'held';
  return 'other';
}

async function story(sid, expected) {
  const bytes = (name) => readFileSync(resolve(FROZEN, name));
  const run = JSON.parse(bytes(`${sid}-scope.json`).toString('utf8'));
  const glRows = parse(bytes(`${sid}-gl.csv`).toString('utf8'));
  const tbRows = parse(bytes(`${sid}-tb.csv`).toString('utf8'));
  const gl = blocks(glRows, 'Section', 'End section');
  const tb = blocks(tbRows, 'Page', 'End page');
  const first = gl.blocks[0]?.labels ?? {};
  const asIs = await product(
    sid,
    bytes(`${sid}-gl.csv`),
    bytes(`${sid}-tb.csv`),
    scopeOf(run, first.Account ?? '', first['Complete dimensions'] ?? ''),
  );

  const glCopy = gl.blocks.flatMap((b) =>
    b.rows.map((r) => {
      const v = { ...b.labels };
      for (const h of [
        'Record ID',
        'Record kind',
        'Posting date',
        'Debit',
        'Credit',
      ])
        v[h] = field(b, r, h);
      return {
        key: [b.labels.Account ?? '', b.labels['Complete dimensions'] ?? ''],
        cells: GL_HEADERS.map((h) => trim(v[h])),
      };
    }),
  );
  const tbLeft = [];
  const tbCopy = tb.blocks.flatMap((b) =>
    b.rows.flatMap((r) => {
      if (trim(field(b, r, 'Row type')) !== 'account') {
        tbLeft.push(r.row);
        return [];
      }
      const account = trim(field(b, r, 'Account')),
        dims = trim(field(b, r, 'Complete dimensions'));
      const v = {
        ...b.labels,
        Account: account,
        'Complete dimensions': dims,
        'Snapshot ID': b.id,
      };
      for (const h of TB_AMOUNTS) v[h] = field(b, r, h);
      return [
        { key: [account, dims], cells: TB_HEADERS.map((h) => trim(v[h])) },
      ];
    }),
  );
  const keys = [
    ...new Set([...glCopy, ...tbCopy].map((c) => JSON.stringify(c.key))),
  ]
    .map((k) => JSON.parse(k))
    .sort((a, b) => byText(a.join('|'), b.join('|')));
  const accounts = {};
  for (const [account, dims] of keys) {
    const name = `${account}|${dims}`;
    const pick = (copy) =>
      copy
        .filter((c) => c.key[0] === account && c.key[1] === dims)
        .map((c) => c.cells);
    const out = await product(
      `${sid}-split`,
      new TextEncoder().encode(csv([GL_HEADERS, ...pick(glCopy)])),
      new TextEncoder().encode(csv([TB_HEADERS, ...pick(tbCopy)])),
      scopeOf(run, account, dims),
    );
    const got = verdict(out);
    const oracle = expected.accounts[name];
    accounts[name] = {
      oracle: oracle ? [oracle.status, oracle.codes] : null,
      product: [got.status, got.codes],
      class: classify(got, oracle),
      run: out,
    };
  }
  const notRun = Object.keys(expected.accounts).filter((k) => !(k in accounts));
  return {
    asIs,
    accounts,
    notRun,
    leftBehind: {
      gl: gl.outside,
      tb: [...tb.outside, ...tbLeft].sort((a, b) => a - b),
    },
  };
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
  const all = Object.values(stories).flatMap((s) => Object.entries(s.accounts));
  const classes = {};
  for (const [, a] of all) classes[a.class] = (classes[a.class] ?? 0) + 1;
  return {
    schema: 'tarasuf-glt1-sections-baseline/1',
    engine: GL_TB_VERSION,
    commit: git('rev-parse', 'HEAD'),
    summary: {
      stories: Object.keys(stories).length,
      asIsRefusedOrHeld: Object.values(stories).filter(
        (s) => s.asIs.refused || s.asIs.status === 'source-error',
      ).length,
      runs: all.length,
      classes,
      unsafe: Object.entries(stories).flatMap(([sid, s]) =>
        Object.entries(s.accounts)
          .filter(([, a]) => a.class === 'unsafe')
          .map(([k, a]) => `${sid} ${k}: ${a.product[0]} where ${a.oracle[0]}`),
      ),
      notRun: Object.values(stories).reduce((n, s) => n + s.notRun.length, 0),
      rowsLeftBehind: Object.values(stories).reduce(
        (n, s) => n + s.leftBehind.gl.length + s.leftBehind.tb.length,
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
      s.asIs.refused ?? `${s.asIs.status} ${s.asIs.errors.join(',')}`,
      '|',
      Object.entries(s.accounts)
        .map(
          ([k, a]) =>
            `${k}: ${a.product[0]}${a.class === 'agree' ? '' : ` (${a.class}, oracle ${a.oracle?.[0] ?? '-'})`}`,
        )
        .join('; '),
      s.notRun.length ? `| not run ${s.notRun.join(',')}` : '',
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
