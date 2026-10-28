// INV-2 baseline: the product as it is (inventory-posted-register-gl-1,
// unchanged) on the sealed INV-2 foundation, recorded as it comes. Written
// after the seal was pushed.
//
//   node --experimental-strip-types audit/inventory-movement-foundation/baseline.mjs [--out file] [--assert file]
//
// The family takes four sources: a register of posted values, a map, policy
// evidence and the GL, each row restating twelve scope fields. Every run goes
// through the product's replay (bytes read again, hashes checked, then the
// engine). The scope maps the story's period onto the family's twelve fields;
// as of is the period end, the rest fixed placeholders. Two ways:
// - As it arrives: the movement register in the register role and the GL
//   summary in the GL role; the map and policy evidence are each the family's
//   own header row and nothing else, since the accountant has neither.
// - Folded by hand: what an accountant must do today. The family has no
//   opening, movement or period, so only the printed closings can go in. Every
//   row whose Kind reads closing is copied out by column name as one register
//   row (its quantity, unit and value as printed, its quantity precision the
//   number of decimals printed), one map row to the GL account on the line and
//   one policy row; every GL summary row becomes one GL row with its printed
//   closing as a debit, or as a credit when it carries a minus sign.
// Each position of the sealed expectation is then set beside the fold's
// comparison of its account.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const FROZEN = resolve(here, 'frozen');
const lib = (name) =>
  import(pathToFileURL(resolve(root, 'lib/reconciliation', name)).href);
const { STOCK_HEADERS, STOCK_ROLES, STOCK_SCOPE_HEADERS, STOCK_VERSION } =
  await lib('inventory-register.ts');
const { readStockFile, replayStock } = await lib('inventory-register-io.ts');

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const trim = (v) => (v ?? '').replace(/^ +| +$/g, '');

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

const csv = (rows) =>
  rows
    .map((r) =>
      r
        .map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v))
        .join(','),
    )
    .join('\n') + '\n';
const buffer = (text) => new TextEncoder().encode(text).buffer;

function scopeOf(story) {
  const s = story.runScope;
  return {
    entity: s.Entity,
    inventoryLedger: 'STOCK-BOOK',
    glLedger: 'GL-BOOK',
    currency: s.Currency,
    currencyBasis: 'functional',
    postingStatus: 'posted',
    postingLayer: 'Current',
    asOf: s['Period end'],
    chartVersion: 'CHART-1',
    mapVersion: 'MAP-1',
    valuationPolicyVersion: 'provided-posted-values-1',
    inventoryAccountSetVersion: 'INV-SET-1',
    confirmed: true,
  };
}

async function run(sources, scope) {
  try {
    const files = [];
    for (let i = 0; i < 4; i++)
      files.push(await readStockFile(`${STOCK_ROLES[i]}.csv`, sources[i]));
    const { result } = await replayStock({
      files,
      readings: STOCK_ROLES.map((role) => ({
        sheet: 0,
        role,
        family: STOCK_VERSION,
        confirmed: true,
      })),
      scope,
      completeness: { confirmed: false, reference: '', note: '' },
      events: [],
    });
    return { result };
  } catch (error) {
    return { refused: String(error.message).slice(0, 80) };
  }
}

const verdict = (r) =>
  r.refused
    ? { refused: r.refused }
    : {
        status: r.result.status,
        financial: r.result.financial,
        issues: [...new Set(r.result.issues.map((x) => x.code))].sort(byText),
      };

function fold(story, register, gl) {
  const scope = scopeOf(story);
  const values = STOCK_SCOPE_HEADERS.map(
    (h) =>
      ({
        Entity: scope.entity,
        'Inventory ledger': scope.inventoryLedger,
        'GL ledger': scope.glLedger,
        Currency: scope.currency,
        'Currency basis': scope.currencyBasis,
        'Posting status': scope.postingStatus,
        'Posting layer': scope.postingLayer,
        'As of': scope.asOf,
        'Chart version': scope.chartVersion,
        'Map version': scope.mapVersion,
        'Valuation policy version': scope.valuationPolicyVersion,
        'Inventory account set version': scope.inventoryAccountSetVersion,
      })[h],
  );
  const rows = parse(register).filter((r) => r.some((v) => trim(v)));
  const cols = new Map(rows[0].map((name, j) => [trim(name), j]));
  const get = (r, name) => (cols.has(name) ? trim(r[cols.get(name)]) : '');
  const reg = [STOCK_HEADERS[0]],
    map = [STOCK_HEADERS[1]],
    pol = [STOCK_HEADERS[2]],
    led = [STOCK_HEADERS[3]];
  const positions = [];
  let n = 0;
  for (const r of rows.slice(1)) {
    if (get(r, 'Kind') !== 'closing') continue;
    n++;
    const quantity = get(r, 'Quantity');
    const precision = String((quantity.split('.')[1] ?? '').length);
    const item = get(r, 'Item ID'),
      dims = get(r, 'Item dimensions'),
      account = get(r, 'GL account');
    positions.push({ key: `${item}|${dims}`, row: n + 1, account });
    reg.push([
      item,
      dims,
      quantity,
      get(r, 'Unit'),
      precision,
      get(r, 'Value'),
      `V-${n}`,
      ...values,
    ]);
    map.push([`MAP-${n}`, item, dims, account, 'all', `POL-${n}`, ...values]);
    pol.push([
      `POL-${n}`,
      item,
      dims,
      get(r, 'Unit'),
      precision,
      `V-${n}`,
      account,
      'all',
      'inventory',
      'debit-positive',
      'provided-posted-carrying-value',
      story.runScope['Period start'],
      story.runScope['Period end'],
      `SYN-POL-${n}`,
      ...values,
    ]);
  }
  if (gl !== null) {
    const glRows = parse(gl).filter((r) => r.some((v) => trim(v)));
    const gc = new Map(glRows[0].map((name, j) => [trim(name), j]));
    const at = (r, name) => (gc.has(name) ? trim(r[gc.get(name)]) : '');
    for (const r of glRows.slice(1)) {
      const closing = at(r, 'Closing');
      const negative = closing.startsWith('-');
      led.push([
        at(r, 'GL account'),
        'all',
        'inventory',
        negative ? '0' : closing,
        negative ? closing.slice(1) : '0',
        ...values,
      ]);
    }
  }
  return {
    sources: [reg, map, pol, led].map((t) => buffer(csv(t))),
    positions,
  };
}

function compare(expected, r, positions) {
  const out = {};
  const comparisons = r.result ? r.result.comparisons : [];
  const issues = r.result ? r.result.issues.filter((x) => x.source === 0) : [];
  const keys = [
    ...new Set([
      ...Object.keys(expected.positions ?? {}),
      ...positions.map((p) => p.key),
    ]),
  ].sort(byText);
  for (const key of keys) {
    const want = expected.positions?.[key];
    const mine = positions.filter((p) => p.key === key);
    const codes = [
      ...new Set(
        issues
          .filter((x) => mine.some((p) => p.row === x.row))
          .map((x) => x.code),
      ),
    ].sort(byText);
    const accounts = [...new Set(mine.map((p) => p.account))];
    const compared = comparisons.filter((c) => accounts.includes(c.account));
    let product;
    if (!mine.length) product = 'not in the fold';
    else if (r.refused) product = 'run refused';
    else if (codes.length) product = 'row refused';
    else if (!compared.length) product = 'account not compared';
    else if (compared.every((c) => c.differenceMinor === 0))
      product = 'account agrees';
    else product = 'account differs';
    out[key] = {
      contract: want ? want.status : 'not a position',
      product,
      codes,
      run: r.result ? r.result.status : null,
    };
  }
  return out;
}

function classify(e) {
  const reads = e.product === 'account agrees';
  if (e.contract === 'consistent')
    return reads ? 'agree' : 'stops where the contract reads';
  if (reads) return 'agrees where the contract stops';
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
  const header = (i) => buffer(csv([STOCK_HEADERS[i]]));
  for (const story of facts.stories) {
    const bytes = (name) => {
      const b = readFileSync(resolve(FROZEN, name));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    };
    const register = bytes(story.files.register.name);
    const gl = bytes(story.files.gl.name);
    const arrives = verdict(
      await run([register, header(1), header(2), gl], scopeOf(story)),
    );
    const text = (b) => {
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(b);
      } catch {
        return null;
      }
    };
    const registerText = text(register);
    if (registerText === null) {
      stories[story.id] = {
        asItArrives: arrives,
        folded: 'not UTF-8: the fold reads nothing',
      };
      continue;
    }
    const { sources, positions } = fold(story, registerText, text(gl));
    const result = await run(sources, scopeOf(story));
    const compared = compare(expected[story.id], result, positions);
    for (const e of Object.values(compared)) {
      e.class = classify(e);
      counts[e.class] = (counts[e.class] ?? 0) + 1;
    }
    stories[story.id] = {
      asItArrives: arrives,
      folded: verdict(result),
      positions: compared,
    };
  }
  const record = {
    schema: 'tarasuf-inv2-movement-bridge-baseline/1',
    family: STOCK_VERSION,
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
