// PAY-1 baseline: the product as it is (payroll-posted-run-gl-bank-1,
// unchanged) on the sealed PAY-1 foundation, recorded as it comes. Written
// after the seal was pushed.
//
//   node --experimental-strip-types audit/payroll-long-register-foundation/baseline.mjs [--out file] [--assert file]
//
// The family takes five sources; only the register matters here, so the map,
// policy evidence, GL and bank payout are each the family's own header row and
// nothing else. Every run goes through the product's replay (bytes read again,
// hashes checked, then the engine). The run scope maps the story's seven
// fields onto the family's nineteen; the twelve the long register does not
// print are fixed placeholders. Three ways:
// - As it arrives: the long register file in the register role.
// - Folded by hand: what an accountant must do today. Every row of every
//   section after its column row that is not a total row is copied out by
//   column name, whatever the section's header says, and pivoted by Employee
//   ID and Employee dimensions as written: earnings, deductions, employer and
//   net lines summed as a spreadsheet sums (a cell that is not a plain number,
//   a blank one included, counts nothing; a kind that is not one of the four
//   goes nowhere). Each pivot row becomes one register row restating the
//   scope, its payroll reference the payroll run.
// - Folded, with the posting and payment dates moved to the day after the
//   period end: the family refuses a run posted on or before its period end,
//   which every story is. This is not what the register says; it isolates
//   what the fold does once the family accepts the scope.
// Each employee of the last run is then set beside the sealed expectation.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const FROZEN = resolve(here, 'frozen');
const lib = (name) =>
  import(pathToFileURL(resolve(root, 'lib/reconciliation', name)).href);
const {
  PAYROLL_FIELDS,
  PAYROLL_HEADERS,
  PAYROLL_ROLES,
  PAYROLL_SCOPE_HEADERS,
  PAYROLL_VERSION,
} = await lib('payroll.ts');
const { readPayrollFile, replayPayroll } = await lib('payroll-io.ts');

const KINDS = ['earning', 'deduction', 'employer', 'net'];
const TOTALS = [
  'Total earnings',
  'Total deductions',
  'Total employer',
  'Total net',
];
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const trim = (v) => (v ?? '').replace(/^ +| +$/g, '');
const filled = (r) => r.filter((v) => trim(v)).length;

// The test's own RFC 4180 reading, lenient where a spreadsheet is: a quote
// inside an unquoted field is kept as a character.
function parse(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [],
    cell = '',
    inside = false,
    touched = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inside) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') inside = false;
      else cell += c;
    } else if (c === '"' && !cell) inside = touched = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
      touched = true;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      rows.push(touched || cell ? [...row, cell] : []);
      row = [];
      cell = '';
      touched = false;
    } else {
      cell += c;
      touched = true;
    }
  }
  if (touched || cell) rows.push([...row, cell]);
  return rows;
}

// A plain number, as a spreadsheet sums it, in thousandths; anything else 0.
const thousandths = (v) => {
  const m = /^([0-9]+)(?:\.([0-9]{1,3}))?$/.exec(trim(v));
  return m ? Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0')) : 0;
};
const shown = (n, decimals) => {
  let d = decimals;
  while (d < 3 && n % 10 ** (3 - d)) d++;
  const s = String(Math.round(n / 10 ** (3 - d))).padStart(d + 1, '0');
  return d ? `${s.slice(0, -d)}.${s.slice(-d)}` : s;
};

function fold(rows) {
  const out = new Map();
  let cols = null,
    inside = false;
  for (const r of rows) {
    const first = trim(r[0]);
    if (first === 'Section') {
      inside = true;
      cols = null;
      continue;
    }
    if (
      first === 'End section' ||
      first === 'Run totals' ||
      first === 'End run totals'
    ) {
      inside = false;
      continue;
    }
    if (!inside || !filled(r)) continue;
    if (!cols) {
      if (filled(r) > 2) cols = new Map(r.map((name, j) => [trim(name), j]));
      continue;
    }
    if (TOTALS.includes(first)) continue;
    const get = (name) => (cols.has(name) ? trim(r[cols.get(name)]) : '');
    const kind = get('Kind');
    if (!KINDS.includes(kind)) continue;
    const key = `${get('Employee ID')}|${get('Employee dimensions')}`;
    if (!out.has(key))
      out.set(key, {
        employee: get('Employee ID'),
        dims: get('Employee dimensions'),
        sums: Object.fromEntries(KINDS.map((k) => [k, 0])),
      });
    out.get(key).sums[kind] += thousandths(get('Amount'));
  }
  return out;
}

const csv = (rows) =>
  rows
    .map((r) =>
      r
        .map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v))
        .join(','),
    )
    .join('\n') + '\n';
const buffer = (text) => new TextEncoder().encode(text).buffer;

function scopeOf(story, moved) {
  const s = story.runScope;
  const next = new Date(`${s['Period end']}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const after = next.toISOString().slice(0, 10);
  return {
    entity: s.Entity,
    payrollRun: s['Payroll run'],
    payrollLedger: 'Synthetic payroll ledger',
    glLedger: 'Synthetic GL',
    currency: s.Currency,
    currencyBasis: 'functional',
    postingStatus: 'posted',
    postingLayer: 'actual',
    periodStart: s['Period start'],
    periodEnd: s['Period end'],
    payrollPostingDate: moved ? after : s['Payroll posting date'],
    paymentDate: moved ? after : s['Payment date'],
    bankAccount: 'BANK-PAYROLL-1',
    payoutReference: `PAYOUT-${s['Payroll run']}`,
    chartVersion: 'CH-1',
    mapVersion: 'MAP-1',
    payrollPolicyVersion: 'POL-1',
    bankMappingVersion: 'BMAP-1',
    accountSetVersion: 'SET-1',
    confirmed: true,
  };
}

async function run(register, scope) {
  try {
    const files = [await readPayrollFile('register.csv', register)];
    for (let i = 1; i < 5; i++)
      files.push(
        await readPayrollFile(
          `${PAYROLL_ROLES[i]}.csv`,
          buffer(csv([PAYROLL_HEADERS[i]])),
        ),
      );
    const { result } = await replayPayroll({
      files,
      readings: PAYROLL_ROLES.map((role) => ({
        sheet: 0,
        role,
        family: PAYROLL_VERSION,
        confirmed: true,
      })),
      scope,
      completeness: { confirmed: false, reference: '', note: '' },
      events: [],
    });
    return { result };
  } catch (error) {
    return { refused: error.code ?? String(error.message).slice(0, 80) };
  }
}

function folded(story, pivot, scope) {
  const values = Object.fromEntries(
    PAYROLL_SCOPE_HEADERS.map((h, i) => [h, scope[PAYROLL_FIELDS[i]]]),
  );
  const decimals = { SAR: 2, KWD: 3, JPY: 0 }[story.runScope.Currency] ?? 2;
  const rows = [PAYROLL_HEADERS[0]];
  for (const p of pivot.values()) {
    const v = {
      'Employee ID': p.employee,
      'Employee dimensions': p.dims,
      Gross: shown(p.sums.earning, decimals),
      Deductions: shown(p.sums.deduction, decimals),
      'Employer contribution': shown(p.sums.employer, decimals),
      Net: shown(p.sums.net, decimals),
      'Payroll reference': scope.payrollRun,
      ...values,
    };
    rows.push(PAYROLL_HEADERS[0].map((h) => v[h]));
  }
  return buffer(csv(rows));
}

const verdict = (r) =>
  r.refused
    ? { refused: r.refused }
    : {
        status: r.result.status,
        registerIssues: [
          ...new Set(
            r.result.issues.filter((x) => x.source === 0).map((x) => x.code),
          ),
        ].sort(byText),
      };

function compare(story, expected, r, pivot) {
  const out = {};
  const rows = r.result ? r.result.records[0] : [];
  const issues = r.result ? r.result.issues.filter((x) => x.source === 0) : [];
  const keys = [
    ...new Set([...Object.keys(expected.employees ?? {}), ...pivot.keys()]),
  ].sort(byText);
  [...pivot.keys()].forEach((key, i) => {
    pivot.get(key).row = i + 2;
  });
  for (const key of keys) {
    const want = expected.employees?.[key];
    const p = pivot.get(key);
    const row = p && rows.find((x) => x.row === p.row);
    const codes = p
      ? [
          ...new Set(issues.filter((x) => x.row === p.row).map((x) => x.code)),
        ].sort(byText)
      : [];
    const product = !p
      ? 'not in the fold'
      : r.refused
        ? 'run refused'
        : row
          ? 'row reads'
          : 'row refused';
    const amounts = row
      ? [row.gross, row.deductions, row.employer, row.net]
      : null;
    const contract = want ? want.status : 'not an employee';
    const same =
      want && want.status !== 'held' && amounts
        ? amounts.join() ===
          [want.earnings, want.deductions, want.employer, want.net ?? 0].join()
        : null;
    out[key] = { contract, product, codes, amounts, sameAmounts: same };
  }
  return out;
}

function classify(e) {
  if (e.product === 'row reads' && e.contract === 'consistent')
    return e.sameAmounts ? 'agree' : 'reads with other amounts';
  if (e.product === 'row reads') return 'reads where the contract does not';
  if (e.contract === 'consistent') return 'refused where the contract reads';
  if (e.product === 'not in the fold') return 'not in the fold';
  return 'both stop';
}

async function main() {
  const { values: args } = parseArgs({
    options: { out: { type: 'string' }, assert: { type: 'string' } },
  });
  const facts = JSON.parse(
    readFileSync(resolve(FROZEN, 'stories.json'), 'utf8'),
  );
  const expected = JSON.parse(
    readFileSync(resolve(FROZEN, 'EXPECTED.json'), 'utf8'),
  ).stories;
  const stories = {};
  const counts = {};
  for (const story of facts.stories) {
    const bytes = readFileSync(resolve(FROZEN, story.file.name));
    const original = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const arrives = verdict(await run(original, scopeOf(story, false)));
    let text = null;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(original);
    } catch {
      stories[story.id] = {
        asItArrives: arrives,
        folded: 'not UTF-8: the fold reads nothing',
      };
      continue;
    }
    const pivot = fold(parse(text));
    const plainFold = verdict(
      await run(
        folded(story, pivot, scopeOf(story, false)),
        scopeOf(story, false),
      ),
    );
    const movedScope = scopeOf(story, true);
    const moved = await run(folded(story, pivot, movedScope), movedScope);
    const employees = compare(story, expected[story.id], moved, pivot);
    for (const e of Object.values(employees)) {
      e.class = classify(e);
      counts[e.class] = (counts[e.class] ?? 0) + 1;
    }
    stories[story.id] = {
      asItArrives: arrives,
      folded: plainFold,
      foldedDatesMoved: verdict(moved),
      employees,
    };
  }
  const record = {
    schema: 'tarasuf-pay1-long-register-baseline/1',
    family: PAYROLL_VERSION,
    counts,
    stories,
  };
  const text = JSON.stringify(record, null, 1) + '\n';
  if (args.out) writeFileSync(args.out, text);
  if (args.assert) {
    const want = readFileSync(resolve(root, args.assert), 'utf8');
    if (want !== text) {
      console.error('the baseline differs from its record');
      process.exit(1);
    }
  }
  console.log(JSON.stringify({ counts }, null, 1));
}

await main();
