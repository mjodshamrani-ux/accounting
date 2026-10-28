// ALL-1 baseline: the allocation family as it is on the sealed stories. Each
// snapshot and its decisions go through the product's replay from bytes, as
// the worker runs it; the dense stories are regenerated and checked against
// their sealed hashes first, and judged against the oracle's output, itself
// checked against the sealed expectation hash. Recorded as it comes, per
// story and in total:
//   - refusals, the product's beside the contract's;
//   - every readable advice line as the product offers it (allocated, or
//     offered for approval with no mark) beside the contract's status;
//   - on the focused stories, an accountant who approves every offered line
//     in row order, each as its own decision, through the family's own
//     replay: which lines are accepted and which refused, and by what code;
//     which competing lines win by that order; and twins allocated twice.
//
//   node --experimental-strip-types audit/allocation-advice-foundation/baseline.mjs [--out name] [--assert name]
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
const { ALLOCATION_VERSION, reconcileAllocation } = await import(
  lib('allocation.ts')
);
const { replayAllocation } = await import(lib('allocation-io.ts'));
const { MAX_ROWS } = await import(lib('types.ts'));

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const buffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const ceiling = `الحد ${MAX_ROWS} حركة تقريبًا مع صفوف العناوين`;

export function input(folder, sid) {
  const given = JSON.parse(
    readFileSync(join(folder, `${sid}-input.json`), 'utf8'),
  );
  return {
    files: given.names.map((name) => {
      const bytes = readFileSync(join(folder, name));
      return {
        name,
        original: buffer(bytes),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sheets: [],
      };
    }),
    readings: given.readings,
    scope: given.scope,
    events: given.events,
  };
}

const code = (error) => {
  const m = String(error?.message ?? error);
  if (m.startsWith('ALLOCATION_')) return m.slice('ALLOCATION_'.length);
  return m === ceiling ? 'ROWS' : 'READER';
};

function approve(state, result, proof, n) {
  const pay = result.items.find(
    (i) => i.side === 0 && i.reference === proof.payment,
  );
  const inv = result.items.find(
    (i) => i.side === 1 && i.reference === proof.invoice,
  );
  return {
    id: `BASELINE-${n}`,
    context: result.context,
    at: new Date(Date.UTC(2026, 9, 2, 9, 0, n)).toISOString(),
    note: 'Baseline: approve every offered line in row order',
    type: 'allocate',
    links: [
      {
        paymentId: pay.id,
        invoiceId: inv.id,
        amount: proof.amount,
        basis: {
          kind: 'remittance',
          reference: proof.reference,
          reason: 'Remittance advice reviewed',
          proofId: proof.id,
        },
      },
    ],
  };
}

async function judge(folder, sid, want, simulate) {
  let state, result;
  try {
    ({ state, result } = await replayAllocation(input(folder, sid)));
  } catch (error) {
    return { productRefused: code(error), contractRefused: want.refused };
  }
  if (result.status !== 'ready')
    return { productRefused: 'SOURCE_ERRORS', contractRefused: want.refused };
  if (want.refused)
    return { productRefused: null, contractRefused: want.refused };
  const used = new Set(
    result.links
      .filter((l) => l.basis.kind === 'remittance')
      .map((l) => l.basis.proofId),
  );
  const contract = new Map(want.lines.map((l) => [l.row, l]));
  const lines = result.proofs.map((p) => ({
    row: p.row,
    product: used.has(p.id) ? 'allocated' : 'offered',
    contract: contract.get(p.row)?.status ?? 'absent',
    reasons: contract.get(p.row)?.reasons ?? [],
  }));
  const count = (f) => lines.filter(f).length;
  const out = {
    productRefused: null,
    contractRefused: null,
    lines: lines.length,
    contractFits: count((l) => l.contract === 'fits'),
    contractReview: count((l) => l.contract === 'review'),
    contractAllocated: count((l) => l.contract === 'allocated'),
    productOffered: count((l) => l.product === 'offered'),
    productAllocated: count((l) => l.product === 'allocated'),
    offeredButReview: count(
      (l) => l.product === 'offered' && l.contract === 'review',
    ),
    allocatedDisagree: count(
      (l) => (l.product === 'allocated') !== (l.contract === 'allocated'),
    ),
  };
  if (!simulate) return out;
  // The accountant approves every offered line in row order, one decision
  // each, through the family's own replay of the read files.
  const events = [...state.events];
  const accepted = [],
    refused = [];
  let n = 0;
  for (const p of result.proofs.filter((p) => !used.has(p.id))) {
    const e = approve(state, result, p, ++n);
    try {
      reconcileAllocation({ ...state, events: [...events, e] });
      events.push(e);
      accepted.push(p.row);
    } catch (error) {
      refused.push([p.row, code(error)]);
    }
  }
  const competing = lines.filter((l) =>
    l.reasons.some((r) => r.startsWith('COMPETES_')),
  );
  const twinRows = want.lines.filter((l) => l.reasons.includes('TWIN'));
  const allocatedAfter = new Set([
    ...accepted,
    ...lines.filter((l) => l.product === 'allocated').map((l) => l.row),
  ]);
  const twinPairs = new Set(
    twinRows
      .filter(
        (l) =>
          allocatedAfter.has(l.row) &&
          l.twins.some((t) => allocatedAfter.has(t)),
      )
      .map((l) => JSON.stringify([l.row, ...l.twins].sort((a, b) => a - b))),
  );
  return {
    ...out,
    approvedInRowOrder: accepted,
    refusedWhenTried: refused,
    competingAccepted: competing.filter((l) => accepted.includes(l.row)).length,
    competingRefused: competing.filter((l) =>
      refused.some(([r]) => r === l.row),
    ).length,
    overAccepted: lines.filter(
      (l) =>
        l.reasons.some((r) => r.startsWith('OVER_')) &&
        accepted.includes(l.row),
    ).length,
    twinsAllocatedTogether: twinPairs.size,
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
    stories[sid] = await judge(FROZEN, sid, focused[sid], true);
  const dir = mkdtempSync(join(tmpdir(), 'all1-dense-'));
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
      stories[sid] = await judge(dir, sid, judged[sid], false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const all = Object.values(stories);
  const sum = (k) => all.reduce((n, s) => n + (s[k] ?? 0), 0);
  const record = {
    schema: 'tarasuf-all1-baseline/1',
    family: ALLOCATION_VERSION,
    rule: 'the product as it is, on the sealed stories, beside the proposed contract',
    summary: {
      stories: all.length,
      refusalsAgree: all.filter((s) => s.productRefused === s.contractRefused)
        .length,
      lines: sum('lines'),
      contractFits: sum('contractFits'),
      contractReview: sum('contractReview'),
      contractAllocated: sum('contractAllocated'),
      productOffered: sum('productOffered'),
      productAllocated: sum('productAllocated'),
      offeredButReview: sum('offeredButReview'),
      allocatedDisagree: sum('allocatedDisagree'),
      approvedInRowOrder: all.reduce(
        (n, s) => n + (s.approvedInRowOrder?.length ?? 0),
        0,
      ),
      refusedWhenTried: all.reduce(
        (n, s) => n + (s.refusedWhenTried?.length ?? 0),
        0,
      ),
      competingAccepted: sum('competingAccepted'),
      competingRefused: sum('competingRefused'),
      overAccepted: sum('overAccepted'),
      twinsAllocatedTogether: sum('twinsAllocatedTogether'),
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

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
