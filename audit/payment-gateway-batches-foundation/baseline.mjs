// PG-1 baseline: the payment gateway family as it is on the sealed stories.
//
//   A. As each story arrives: its transactions, fee evidence, settlements and
//      bank credits given to payment-gateway-batch-1 as its four sources
//      (it has no payout-lines role), through the product's replay from
//      bytes. Recorded: the refusal code, or the family's financial state.
//   B. Split by hand, one batch at a time, into the family's own format: the
//      batch's transactions and fees, its settlement row with its one payout,
//      and the bank credit naming that payout, under the family's scope for
//      that batch (as-of equal to the period end, as the family requires).
//      A batch that the payout lines pay in more than one payout cannot be
//      written in that format, and is recorded so. Recorded per batch: the
//      family's financial state and its residuals beside the contract's
//      status and reasons; and per story, the bank credits no batch carries.
//
// The dense stories are regenerated and checked against their sealed hashes
// first, and judged against the oracle's output, itself checked against the
// sealed expectation hash.
//
//   node --experimental-strip-types audit/payment-gateway-batches-foundation/baseline.mjs [--out name] [--assert name]
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
const { PG_VERSION, PG_HEADERS } = await import(lib('payment-gateway.ts'));
const { replayGateway } = await import(lib('payment-gateway-io.ts'));
const { readGatewayFile } = await import(lib('payment-gateway-source.ts'));
const { readFile } = await import(lib('io.ts'));
const { MAX_ROWS } = await import(lib('types.ts'));
const ceiling = `\u0627\u0644\u062d\u062f ${MAX_ROWS} \u062d\u0631\u0643\u0629 \u062a\u0642\u0631\u064a\u0628\u064b\u0627 \u0645\u0639 \u0635\u0641\u0648\u0641 \u0627\u0644\u0639\u0646\u0627\u0648\u064a\u0646`;

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const buffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const ROLES = ['transactions', 'fee-evidence', 'settlement', 'payout'];
const code = (error) => {
  const m = String(error?.message ?? error);
  return m.startsWith('PG_') ? m.slice(3) : `READER: ${m.slice(0, 80)}`;
};

function scopeFor(story, batchId) {
  const s = story.scope;
  return {
    entity: s.entity,
    gateway: s.gateway,
    merchantAccount: s.merchantAccount,
    bankAccount: s.bankAccount,
    dimensions: 'None',
    currency: s.currency,
    currencyBasis: 'functional',
    fxPolicy: 'same-currency-no-conversion',
    start: s.start,
    end: s.end,
    asOf: s.end,
    policyVersion: 'PG-1',
    batchId,
    confirmed: true,
  };
}

async function family(files, scope) {
  const input = {
    files,
    readings: ROLES.map((role) => ({
      sheet: 0,
      role,
      family: PG_VERSION,
      confirmed: true,
    })),
    scope,
    completeness: {
      confirmed: true,
      reference: 'Synthetic supplied inventory',
      note: 'All supplied transactions and fees reviewed',
    },
    events: [],
  };
  try {
    const { result } = await replayGateway(input);
    return {
      financial: result.financial,
      issues: [...new Set(result.issues.map((i) => i.code))].sort(byText),
      missing: result.missing,
      residuals: result.residuals,
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

async function readStory(folder, sid) {
  const given = JSON.parse(
    readFileSync(join(folder, `${sid}-input.json`), 'utf8'),
  );
  const sheets = [];
  for (const name of given.names) {
    const bytes = readFileSync(join(folder, name));
    sheets.push({ name, bytes, file: await readFile(name, buffer(bytes)) });
  }
  return { given, sheets };
}

function table(sheet) {
  const rows = sheet.file.sheets[0].rows;
  const head = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .map((r, i) => ({ row: i + 2, get: (h) => r[head.indexOf(h)] ?? '' }))
    .filter((r) => rows[r.row - 1].some((v) => v.trim()));
}

async function asItComes({ given, sheets }) {
  const files = [];
  for (const k of [0, 1, 2, 4]) {
    try {
      files.push(
        await readGatewayFile(sheets[k].name, buffer(sheets[k].bytes)),
      );
    } catch (error) {
      return { refused: code(error) };
    }
  }
  return family(files, scopeFor({ scope: given.scope }, 'B1'));
}

async function splitByHand(story, want) {
  const scopeValues = (batchId) => {
    const s = scopeFor(story, batchId);
    return [
      s.entity,
      s.gateway,
      s.merchantAccount,
      s.bankAccount,
      s.dimensions,
      s.currency,
      s.currencyBasis,
      s.fxPolicy,
      s.start,
      s.end,
      s.asOf,
      s.policyVersion,
      s.batchId,
    ];
  };
  const [tx, fees, settlements, lines, credits] = story.sheets.map(table);
  const out = [];
  for (const b of want.batches) {
    const batchId = b.batch;
    const payouts = b.payouts;
    if (payouts.length > 1) {
      out.push({
        batch: batchId,
        contract: [b.status, b.reasons],
        family: `not expressible: ${payouts.length} payouts`,
      });
      continue;
    }
    const scope = scopeValues(batchId);
    const s = settlements.find((r) => r.get('Batch ID') === batchId);
    const credit = payouts.length
      ? credits.find((r) => r.get('Payout ID') === payouts[0])
      : null;
    const rows = [
      [
        PG_HEADERS[0],
        ...tx
          .filter((r) => r.get('Batch ID') === batchId)
          .map((r) => [
            r.get('Transaction ID'),
            r.get('Kind'),
            r.get('Posting date'),
            r.get('Amount'),
            r.get('Reference'),
            ...scope,
          ]),
      ],
      [
        PG_HEADERS[1],
        ...fees
          .filter((r) => r.get('Batch ID') === batchId)
          .map((r) => [
            r.get('Fee ID'),
            r.get('Fee ID'),
            r.get('Amount'),
            r.get('Reference'),
            story.given.scope.start,
            story.given.scope.end,
            ...scope,
          ]),
      ],
      [
        PG_HEADERS[2],
        [
          batchId,
          s.get('Settlement date'),
          s.get('Gross sales'),
          s.get('Refunds'),
          s.get('Fees'),
          s.get('Net'),
          payouts[0] ?? '',
          `Settlement ${batchId}`,
          ...scope,
        ],
      ],
      [
        PG_HEADERS[3],
        ...(credit
          ? [
              [
                credit.get('Payout ID'),
                credit.get('Value date'),
                credit.get('Credit'),
                credit.get('Bank reference'),
                ...scope,
              ],
            ]
          : []),
      ],
    ];
    const files = [];
    for (const [k, r] of rows.entries())
      files.push(
        await readGatewayFile(
          `${story.given.names[0].split('-')[0]}-${batchId}-${k}.csv`,
          buffer(csv(r)),
        ),
      );
    out.push({
      batch: batchId,
      contract: [b.status, b.reasons],
      family: await family(files, scopeFor(story.given, batchId)),
    });
  }
  return out;
}

async function judge(folder, sid, want) {
  let story;
  try {
    story = await readStory(folder, sid);
  } catch (error) {
    // The reader's own ceiling, by its exact message: nothing reaches the
    // family.
    const m = String(error?.message ?? error);
    return {
      contractRefused: want.refused,
      asItComes: { refused: m === ceiling ? 'ROWS' : 'READER' },
    };
  }
  story.scope = story.given.scope;
  const first = await asItComes(story);
  if (want.refused) return { contractRefused: want.refused, asItComes: first };
  const batches = await splitByHand(story, want);
  const ready = (f) => typeof f === 'object' && f.financial === 'ready';
  const expressible = batches.filter((b) => typeof b.family === 'object');
  const count = (f) => expressible.filter(f).length;
  return {
    contractRefused: null,
    asItComes: first,
    batches: batches.length,
    notExpressible: batches.length - expressible.length,
    familyRefusedSplit: count((b) => b.family.refused),
    contractConsistentFamilyReady: count(
      (b) => b.contract[0] !== 'review' && ready(b.family),
    ),
    contractConsistentFamilyNot: count(
      (b) => b.contract[0] !== 'review' && !ready(b.family),
    ),
    contractReviewFamilyReady: count(
      (b) => b.contract[0] === 'review' && ready(b.family),
    ),
    contractReviewFamilyNot: count(
      (b) => b.contract[0] === 'review' && !ready(b.family),
    ),
    unlinkedCreditsNoBatchCarries: want.credits.length,
    perBatch: sid.startsWith('D') ? undefined : batches,
  };
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
  const dir = mkdtempSync(join(tmpdir(), 'pg1-dense-'));
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
  const record = {
    schema: 'tarasuf-pg1-baseline/1',
    family: PG_VERSION,
    rule: 'A: each story as it arrives, its four sources but the payout lines; B: split by hand into one batch at a time in the family format, as-of equal to the period end',
    asItComes: Object.fromEntries(
      Object.entries(stories).map(([k, s]) => [k, s.asItComes]),
    ),
    totals: {
      batches: sum('batches'),
      notExpressible: sum('notExpressible'),
      familyRefusedSplit: sum('familyRefusedSplit'),
      contractConsistentFamilyReady: sum('contractConsistentFamilyReady'),
      contractConsistentFamilyNot: sum('contractConsistentFamilyNot'),
      contractReviewFamilyReady: sum('contractReviewFamilyReady'),
      contractReviewFamilyNot: sum('contractReviewFamilyNot'),
      unlinkedCreditsNoBatchCarries: sum('unlinkedCreditsNoBatchCarries'),
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
  console.log(JSON.stringify(record.totals));
}

await main();
