// UX-6: the workpapers the checker reads, the evidence as the existing export
// writes it and the workpaper as the worker hands it to the page, in Arabic
// and in English. GL/TB (6(a)): every frozen case, so every status the engine
// gives. Clearing (6(b)): the frozen source, its decisions (a clear, a reopen,
// a clear again, a reopen of a reference group), and the source changed to
// give every reason the engine gives: a header that does not establish the
// reference role, a duplicate posting, a group over the limit, a zero net,
// and texts that look like formulas or escapes. Customer AR (6(b)): each
// frozen ar-limited-1 contract, the positive one with a reopen and with a
// reopen then a human confirmation, and a statement with an unreadable row so
// its total is unavailable. Bank movements (6(b)): every frozen
// bank-cash-movements-1 case with the decisions its contract records, so
// every reason the engine gives, a source error and an empty source among
// them. Payment allocation (6(b)): every frozen allocation-snapshot-1 case
// with the decisions its contract records (a refused one is not recorded),
// one whose human allocation rests on an external confirmation, and a long
// one built here, thirty payments each allocated in full to its invoice by
// its advice line, so the sheet runs over pages. Suppliers (6(b)): every case
// of supplier-cases.ts, the page's example in memory and from its bytes, its
// balances confirmed or unproven, its decisions, an empty scope, three
// decimals, a long one and the frozen partial-reading cases; the clock is held
// for both of a case's exports, as the evidence writes its export time in
// Export Metadata. Trial balance and financial position (6(c)): every
// frozen case the export accepts, with the decisions its story records, and
// one with eighteen decisions built here. Synthetic sources only.
import { readFile as fsRead, mkdir, writeFile } from 'node:fs/promises';
import { readFile } from '../../lib/reconciliation/io.ts';
import { GL_TB_VERSION } from '../../lib/reconciliation/gl-tb.ts';
import { exportGlTb, replayGlTb } from '../../lib/reconciliation/gl-tb-io.ts';
import { exportGlTbWorkpaper } from '../../lib/reconciliation/gl-tb-sheet.ts';
import { reconcileClearing } from '../../lib/reconciliation/clearing.ts';
import {
  clearingDemoReading,
  clearingDemoScope,
} from '../../lib/reconciliation/clearing-demo.ts';
import { exportClearing } from '../../lib/reconciliation/clearing-io.ts';
import { exportClearingWorkpaper } from '../../lib/reconciliation/clearing-sheet.ts';
import {
  arDemoReadings,
  arDemoScope,
} from '../../lib/reconciliation/ar-demo.ts';
import { exportAr, replayAr } from '../../lib/reconciliation/ar-io.ts';
import { exportArWorkpaper } from '../../lib/reconciliation/ar-sheet.ts';
import { bankTruth, finishedBank } from '../bank/fixtures.ts';
import { exportBank } from '../../lib/reconciliation/bank-io.ts';
import { exportBankWorkpaper } from '../../lib/reconciliation/bank-movements-sheet.ts';
import {
  allocationFixture,
  allocationTruth,
  finishedFixture,
  fixtureEvent,
} from '../allocation/fixtures.ts';
import {
  ALLOCATION_HEADERS,
  reconcileAllocation,
} from '../../lib/reconciliation/allocation.ts';
import { exportAllocation } from '../../lib/reconciliation/allocation-io.ts';
import { exportAllocationWorkpaper } from '../../lib/reconciliation/allocation-sheet.ts';
import { exportWorkbook } from '../../lib/reconciliation/io.ts';
import { exportSupplierWorkpaper } from '../../lib/reconciliation/supplier-sheet.ts';
import { supplierCases } from './supplier-cases.ts';
import {
  financialTruth,
  finishedFinancial,
} from '../tb-financial/fixtures.ts';
import { reconcileFinancialPosition } from '../../lib/reconciliation/tb-financial.ts';
import { exportFinancialPosition } from '../../lib/reconciliation/tb-financial-io.ts';
import { exportFinancialWorkpaper } from '../../lib/reconciliation/financial-sheet.ts';

const out = process.argv[2] ?? 'work/reconciliation-sheet';
const root = 'audit/gl-tb/frozen/';
const truth = JSON.parse(await fsRead(root + 'expected.json', 'utf8'));
await mkdir(out, { recursive: true });
const cases = [];
for (const c of truth.cases) {
  const files = await Promise.all(
    c.files.map(async (f) =>
      readFile(f.file, new Uint8Array(await fsRead(root + f.file)).buffer),
    ),
  );
  const input = {
    files,
    scope: { ...truth.scope, confirmed: true },
    readings: [
      { sheet: 0, role: 'gl-detail', family: GL_TB_VERSION, confirmed: true },
      {
        sheet: 0,
        role: 'trial-balance',
        family: GL_TB_VERSION,
        confirmed: true,
      },
    ],
  };
  const { result } = await replayGlTb(input);
  const written = {
    workspace: 'gl-tb',
    case: c.name,
    evidence: `${c.name}-evidence.xlsx`,
  };
  await writeFile(
    `${out}/${written.evidence}`,
    new Uint8Array(await exportGlTb(input, result)),
  );
  for (const lang of ['ar', 'en']) {
    written[lang] = `${c.name}-${lang}.xlsx`;
    await writeFile(
      `${out}/${written[lang]}`,
      new Uint8Array(await exportGlTbWorkpaper(input, result, lang)),
    );
  }
  cases.push(written);
}

const frozen = await fsRead('audit/clearing/frozen/source.csv', 'utf8');
const lines = frozen.trimEnd().split('\n');
const many = Array.from(
  { length: 102 },
  (_, i) =>
    `Q${String(i + 1).padStart(3, '0')},C900,2026-09-10,${i % 2 ? '-' : ''}1.00,2150,SAR,Within one reference`,
);
const odd = '= مصدر عربي 🧾 e\u0301 _x0041_ _X0041_ _x005F_x0041_ \u007f';
const pair = (r) =>
  r.cases.filter((c) => c.reason === 'missing-reference').flatMap((c) => c.ids);
const reference = (r, ref) => r.cases.find((c) => c.reference === ref).ids;
const clearingCases = [
  { name: 'clearing-plain', csv: frozen, steps: [] },
  {
    name: 'clearing-decided',
    csv: frozen,
    steps: [['clear', pair, 'Synthetic offsetting pair, same contract']],
  },
  {
    name: 'clearing-reopened',
    csv: frozen,
    steps: [
      ['clear', pair, 'Synthetic offsetting pair, same contract'],
      ['reopen', (r) => r.cases.at(-1).ids, 'Synthetic reopen pending the contract copy'],
    ],
  },
  {
    name: 'clearing-cleared-again',
    csv: frozen,
    steps: [
      ['clear', pair, 'Synthetic offsetting pair, same contract'],
      ['reopen', (r) => r.cases.at(-1).ids, 'Synthetic reopen pending the contract copy'],
      ['clear', (r) => r.cases.find((c) => c.reason === 'reopened').ids, 'Contract copy read; the pair offsets'],
    ],
  },
  {
    name: 'clearing-reference-reopened',
    csv: frozen,
    steps: [['reopen', (r) => reference(r, 'C001'), 'Synthetic: the reference is under query']],
  },
  {
    name: 'clearing-unverified-role',
    csv: frozen.replace('Clearing Reference', 'Ref'),
    steps: [],
  },
  {
    name: 'clearing-source-error',
    csv: [...lines, lines[1]].join('\n') + '\n',
    steps: [],
  },
  {
    name: 'clearing-group-limit',
    csv: [...lines, ...many].join('\n') + '\n',
    steps: [],
  },
  {
    name: 'clearing-zero-net',
    csv: lines.slice(0, 6).join('\n') + '\n',
    steps: [],
  },
  {
    name: 'clearing-text',
    csv: frozen,
    file: `${odd}.csv`,
    steps: [['clear', pair, `=SUM(A1:A2) ${odd} ملاحظة المراجع`]],
  },
];
for (const c of clearingCases) {
  const input = {
    file: await readFile(
      c.file ?? 'clearing.csv',
      new TextEncoder().encode(c.csv).buffer,
    ),
    reading: { ...clearingDemoReading },
    scope: { ...clearingDemoScope },
    events: [],
  };
  let result = reconcileClearing(input);
  for (const [action, ids, note] of c.steps) {
    input.events.push({ context: result.context, action, ids: ids(result), note });
    result = reconcileClearing(input);
  }
  const written = {
    workspace: 'clearing',
    case: c.name,
    evidence: `${c.name}-evidence.xlsx`,
    reasons: [...new Set(result.cases.map((r) => r.reason))],
    decisions: input.events.length,
  };
  await writeFile(
    `${out}/${written.evidence}`,
    new Uint8Array(await exportClearing(input, result)),
  );
  for (const lang of ['ar', 'en']) {
    written[lang] = `${c.name}-${lang}.xlsx`;
    await writeFile(
      `${out}/${written[lang]}`,
      new Uint8Array(await exportClearingWorkpaper(input, result, lang)),
    );
  }
  cases.push(written);
}
const arRoot = 'audit/ar-limited/frozen/';
const arCases = [
  ...['positive', 'amount-difference', 'type-collision',
    'receipt-is-not-invoice-allocation', 'duplicate-own-document'].map(
    (name) => ({ name: `ar-${name}`, source: name, steps: [] }),
  ),
  { name: 'ar-reopened', source: 'positive', steps: ['reopen'] },
  { name: 'ar-reconfirmed', source: 'positive', steps: ['reopen', 'accept'] },
  { name: 'ar-unreadable', source: 'positive', steps: [], unread: true },
  { name: 'ar-scope-details', scopeDetails: true, steps: [] },
  { name: 'ar-scope-broken', scopeDetails: true, broken: true, steps: [] },
  // No detail on either side: one item for the whole scope waits, with no
  // document number.
  { name: 'ar-empty-source', scopeDetails: true, empty: true, steps: [] },
];
// The scope-details family (ar-scope-details-1): one scope block over its
// details; a statement without its closing marker cannot be read whole, so
// its total is unavailable.
const scopeSource = (side, broken, empty) =>
  [
    'AR_SCOPE,1',
    'Scope ID,SCOPE-1',
    `Source role,${side === 0 ? 'company-ar-ledger' : 'company-issued-customer-statement'}`,
    'Perspective,seller-receivable',
    'Amount basis,original-movement',
    'Entity,Synthetic Seller',
    'Ledger,AR Book',
    'Customer,C0001',
    'Account,1200',
    'Currency,SAR',
    'Period start,2026-09-01',
    'Period end,2026-09-30',
    'Scope reference,Synthetic source reference',
    'DETAILS',
    'Parent scope ID,Posting ID,Document type,Own document number,Posting date,Original signed amount,Related invoice,Open balance,Description',
    ...(empty
      ? []
      : [
          `SCOPE-1,${side ? 'S' : 'L'}-001,invoice,INV-001,2026-09-10,100.00,,${side ? '40.00' : '90.00'},Synthetic invoice`,
          `SCOPE-1,${side ? 'S' : 'L'}-002,invoice,INV-002,2026-09-12,${side ? '75.00' : '70.00'},,,Synthetic invoice`,
        ]),
    ...(broken && side === 1 ? [] : ['END_DETAILS']),
  ].join('\n');
const scopeReading = (side) => ({
  family: 'ar-scope-details-1',
  sheet: 0,
  header: 14,
  parent: 0,
  posting: 1,
  kind: 2,
  document: 3,
  date: 4,
  amount: 5,
  related: 6,
  open: 7,
  description: 8,
  role: side === 0 ? 'company-ar-ledger' : 'company-issued-customer-statement',
  perspective: 'seller-receivable',
  basis: 'original-movement',
  confirmed: true,
});
for (const c of arCases) {
  const files = await Promise.all(
    ['ledger', 'statement'].map(async (side, index) => {
      if (c.scopeDetails)
        return readFile(
          `scope-${side}.csv`,
          new TextEncoder().encode(scopeSource(index, c.broken, c.empty)).buffer,
        );
      let text = await fsRead(`${arRoot}${c.source}-${side}.csv`, 'utf8');
      if (c.unread && side === 'statement')
        text =
          text.trimEnd() +
          '\nS999,invoice,I999,2026-09-20,unread,Synthetic Seller,AR Book,C0001,1200,SAR,,Unread amount\n';
      return readFile(`${c.source}-${side}.csv`, new TextEncoder().encode(text).buffer);
    }),
  );
  const input = {
    files,
    readings: c.scopeDetails
      ? [scopeReading(0), scopeReading(1)]
      : structuredClone(arDemoReadings),
    scope: { ...arDemoScope },
    events: [],
  };
  let { result } = await replayAr(input);
  const first = result.cases.find((r) => r.status === 'matched' && r.ids.length === 2);
  for (const action of c.steps) {
    input.events.push({
      context: result.context,
      at: '2026-10-06T00:00:00.000Z',
      action,
      ids: first.ids,
      note:
        action === 'reopen'
          ? 'Synthetic document correspondence reopened for review'
          : 'Synthetic source documents independently rechecked',
    });
    ({ result } = await replayAr(input));
  }
  const written = {
    workspace: 'ar',
    case: c.name,
    evidence: `${c.name}-evidence.xlsx`,
    reasons: [...new Set(result.cases.map((r) => r.reason))],
    totals: result.totals,
    decisions: input.events.length,
  };
  await writeFile(
    `${out}/${written.evidence}`,
    new Uint8Array(await exportAr(input, result)),
  );
  for (const lang of ['ar', 'en']) {
    written[lang] = `${c.name}-${lang}.xlsx`;
    await writeFile(
      `${out}/${written[lang]}`,
      new Uint8Array(await exportArWorkpaper(input, result, lang)),
    );
  }
  cases.push(written);
}
for (const c of bankTruth.cases) {
  const { state, result } = await finishedBank(c);
  const name = `bank-${c.name}`;
  const written = {
    workspace: 'bank',
    case: name,
    evidence: `${name}-evidence.xlsx`,
    reasons: [...new Set(result.cases.map((g) => g.reason))],
    decisions: state.events.length,
  };
  await writeFile(
    `${out}/${written.evidence}`,
    new Uint8Array(await exportBank(state, result)),
  );
  for (const lang of ['ar', 'en']) {
    written[lang] = `${name}-${lang}.xlsx`;
    await writeFile(
      `${out}/${written[lang]}`,
      new Uint8Array(await exportBankWorkpaper(state, result, lang)),
    );
  }
  cases.push(written);
}
// Allocation: the frozen cases, then the two built here.
const allocations = [];
for (const c of allocationTruth.cases)
  allocations.push({
    name: `allocation-${c.name}`,
    ...(await finishedFixture(c)),
  });
{
  // The two-choices decision, its basis an external confirmation.
  const c = allocationTruth.cases.find((c) => c.name === 'two-choices');
  const { state } = await finishedFixture(c);
  for (const e of state.events)
    if (e.type === 'allocate')
      for (const l of e.links)
        l.basis = {
          ...l.basis,
          kind: 'external-confirmation',
          reference: 'Synthetic supplier confirmation SC-7',
        };
  allocations.push({
    name: 'allocation-external-confirmation',
    state,
    result: reconcileAllocation(state),
  });
}
{
  // Thirty payments, each allocated in full to its own invoice by its own
  // advice line in one decision.
  const scope = allocationTruth.scope;
  const meta = [
    scope.entity,
    scope.ledger,
    scope.party,
    scope.account,
    scope.currency,
    scope.cutoff,
    scope.basis,
  ];
  const n = Array.from({ length: 30 }, (_, i) => i + 1);
  const csv = (side, rows) =>
    [ALLOCATION_HEADERS[side], ...rows].map((r) => r.join(',')).join('\n') +
    '\n';
  const texts = [
    csv(0, n.map((i) => [`P${i}`, '2026-09-20', ...meta, 100 + i, 100 + i])),
    csv(1, n.map((i) => [`I${i}`, '2026-08-15', ...meta, 100 + i, 100 + i])),
    csv(2, n.map((i) => [`R${i}`, ...meta, `P${i}`, `I${i}`, 100 + i])),
  ];
  const state = await allocationFixture('one-to-many');
  state.files = await Promise.all(
    texts.map((text, side) =>
      readFile(`long-${side}.csv`, new TextEncoder().encode(text).buffer),
    ),
  );
  state.events.push(
    fixtureEvent(
      { type: 'remittance', id: 'D1', proofs: n.map((i) => `R${i}`) },
      reconcileAllocation(state),
    ),
  );
  allocations.push({
    name: 'allocation-long',
    state,
    result: reconcileAllocation(state),
  });
}
for (const { name, state, result } of allocations) {
  const written = {
    workspace: 'allocation',
    case: name,
    evidence: `${name}-evidence.xlsx`,
    status: result.status,
    links: result.links.length,
    decisions: state.events.length,
  };
  await writeFile(
    `${out}/${written.evidence}`,
    new Uint8Array(await exportAllocation(state, result)),
  );
  for (const lang of ['ar', 'en']) {
    written[lang] = `${name}-${lang}.xlsx`;
    await writeFile(
      `${out}/${written[lang]}`,
      new Uint8Array(await exportAllocationWorkpaper(state, result, lang)),
    );
  }
  cases.push(written);
}
// The export time the evidence writes, held for both of a case's exports.
const RealDate = Date;
async function atFixedTime(run) {
  const fixed = RealDate.parse('2026-09-01T10:00:00.000Z');
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  };
  try {
    return await run();
  } finally {
    globalThis.Date = RealDate;
  }
}
for (const { name, result, files, review } of await supplierCases()) {
  const written = {
    workspace: 'supplier',
    case: name,
    evidence: `${name}-evidence.xlsx`,
    review: result.cases.filter(
      (c) => c.status === 'Needs Review' || c.status === 'Rejected',
    ).length,
    unmatched: result.caseCounts.unmatchedCases,
    decisions: review.events.filter((e) => e.action !== 'compare').length,
  };
  await writeFile(
    `${out}/${written.evidence}`,
    new Uint8Array(
      await atFixedTime(() => exportWorkbook(result, files, review)),
    ),
  );
  for (const lang of ['ar', 'en']) {
    written[lang] = `${name}-${lang}.xlsx`;
    await writeFile(
      `${out}/${written[lang]}`,
      new Uint8Array(
        await atFixedTime(() =>
          exportSupplierWorkpaper(result, files, review, lang),
        ),
      ),
    );
  }
  cases.push(written);
}
// Trial balance and financial position (6(c)): every frozen case the
// export accepts, with the decisions its story records, and one built here
// whose six lines are accepted, undone and accepted again, eighteen
// decisions, so the sheet runs over a page.
const financials = [];
for (const c of financialTruth.cases)
  if (!c.reject)
    financials.push({
      name: `financial-${c.name}`,
      ...(await finishedFinancial(c.name)),
    });
{
  const { state } = await finishedFinancial('whole-post-closing');
  let result = reconcileFinancialPosition(state);
  for (const type of ['undo', 'accept'])
    for (const line of result.lines) {
      const n = state.events.length;
      state.events = [
        ...state.events,
        {
          id: `decision-${n}`,
          type,
          context: result.context,
          lineId: line.lineId,
          mappingIds: line.members.map((m) => m.mappingId),
          at: `2026-10-07T00:00:00.${String(n).padStart(3, '0')}Z`,
          reference: 'Synthetic second review',
          note: `Synthetic: line ${line.lineId} reviewed again, ${type}`,
        },
      ];
      result = reconcileFinancialPosition(state);
    }
  financials.push({ name: 'financial-long-decisions', state, result });
}
for (const { name, state, result } of financials) {
  const written = {
    workspace: 'financial',
    case: name,
    evidence: `${name}-evidence.xlsx`,
    status: result.status,
    lines: result.lines.length,
    decisions: result.events.length,
  };
  await writeFile(
    `${out}/${written.evidence}`,
    new Uint8Array(await exportFinancialPosition(state, result)),
  );
  for (const lang of ['ar', 'en']) {
    written[lang] = `${name}-${lang}.xlsx`;
    await writeFile(
      `${out}/${written[lang]}`,
      new Uint8Array(await exportFinancialWorkpaper(state, result, lang)),
    );
  }
  cases.push(written);
}
await writeFile(
  `${out}/cases.json`,
  JSON.stringify({ syntheticOnly: true, cases }, null, 1),
);
console.log(JSON.stringify({ cases: cases.length, out }));
