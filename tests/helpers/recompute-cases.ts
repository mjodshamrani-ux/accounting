// Synthetic inputs for the supplier reconciliation recompute paths, and a way
// to drive the production worker in Node. Every expected relationship below is
// computed from core.ts directly (normalizeSource + compare), never from the
// shared recompute entry point under test.
import { readFile } from '../../lib/reconciliation/io.ts';
import {
  demoFiles,
  demoMappings,
  demoScope,
} from '../../lib/reconciliation/demo.ts';
import {
  compare,
  inferMapping,
  normalizeSource,
} from '../../lib/reconciliation/core.ts';
import { identityConflicts } from '../../lib/reconciliation/cases.ts';
import { suggestFormats } from '../../lib/reconciliation/format-inference.ts';
import { formatChoice } from '../../lib/reconciliation/input-readiness.ts';
import { inferStatementDirection } from '../../lib/reconciliation/statement-direction.ts';
import { WORKER_CHANNEL } from '../../lib/reconciliation/protocol.ts';
import { defaultMapping } from '../../lib/reconciliation/types.ts';
import type {
  Decision,
  Mapping,
  Scope,
  SourceFile,
} from '../../lib/reconciliation/types.ts';

export type RecomputeCase = {
  name: string;
  files: [SourceFile, SourceFile];
  mappings: [Mapping, Mapping];
  scope: Scope;
  decisions: Decision[];
  rejected: string[];
  /** The ambiguity gate must refuse this case on every path. */
  unresolved?: boolean;
};

const csv = (rows: string[][]) =>
  new TextEncoder().encode(
    rows
      .map((row) => row.map((c) => '"' + c.replace(/"/g, '""') + '"').join(','))
      .join('\n'),
  ).buffer as ArrayBuffer;
const upload = (name: string, rows: string[][]) => readFile(name, csv(rows));
/** The reference result, straight from the engine core. */
export const coreResult = (c: RecomputeCase) =>
  compare(
    normalizeSource(c.files[0], c.mappings[0], c.scope, 'supplier'),
    normalizeSource(c.files[1], c.mappings[1], c.scope, 'ledger'),
    c.scope,
    c.decisions,
    c.rejected,
  );

async function demoCase(): Promise<RecomputeCase> {
  const files = (await Promise.all(
    demoFiles.map((f) => upload(f.name, f.sheets[0].rows)),
  )) as [SourceFile, SourceFile];
  return {
    name: 'ordinary match, amount variance, balances (demo)',
    files,
    mappings: structuredClone(demoMappings),
    scope: { ...demoScope, confirmed: true, coverageConfirmed: true },
    decisions: [],
    rejected: [],
  };
}

async function decisionsCase(): Promise<RecomputeCase> {
  const base = await demoCase();
  const result = coreResult(base);
  // Reject the first automatic link, and confirm by hand a supplier-only and a
  // ledger-only row with the same signed amount and no conflicting evidence.
  const auto = result.matches.find((m) => m.kind === 'auto')!;
  const pair = result.supplierOnly
    .flatMap((s) =>
      result.ledgerOnly
        .filter((l) => l.amount === s.amount && !identityConflicts(s, l).length)
        .map((l) => [s, l] as const),
    )
    .at(0)!;
  return {
    ...base,
    name: 'manual decision and rejected link (demo)',
    decisions: [
      {
        supplierId: pair[0].id,
        ledgerId: pair[1].id,
        note: 'Confirmed against the remittance advice (synthetic)',
      },
    ],
    rejected: [`${auto.supplierId}|${auto.ledgerId}`],
  };
}

const groupHeaders = [
  'Date',
  'Invoice No',
  'Document Type',
  'AP Voucher',
  'PO',
  'Bank Ref',
  'Description',
  'Amount',
  'Currency',
];
const groupMapping: Mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 1,
  description: 6,
  amount: 7,
  currencyColumn: 8,
};
async function groupingCase(): Promise<RecomputeCase> {
  const row = (amount: string, voucher = '') => [
    '2026-09-12',
    'DOC-GRP-81',
    'Invoice',
    voucher,
    'PO-387',
    '',
    'Synthetic invoice',
    amount,
    'SAR',
  ];
  return {
    name: 'proven one-to-many group',
    files: [
      await upload('group-supplier.csv', [groupHeaders, row('184')]),
      await upload('group-ledger.csv', [
        groupHeaders,
        row('80', 'AP-711'),
        row('104', 'AP-711'),
      ]),
    ],
    mappings: [structuredClone(groupMapping), structuredClone(groupMapping)],
    scope: {
      supplier: 'Synthetic Supplier',
      entity: 'Synthetic Entity',
      account: 'TEST-701',
      currency: 'SAR',
      decimals: 2,
      cutoff: '2026-09-30',
      dateWindow: 3,
      confirmed: true,
      coverageConfirmed: false,
    },
    decisions: [],
    rejected: [],
  };
}

const ambiguityScope: Scope = {
  supplier: 'Synthetic vendor',
  entity: 'Synthetic buyer',
  account: 'AP-047',
  currency: 'KWD',
  decimals: 3,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
/** 54.321 is 54 dinars 321 fils under one reading and 54,321 under the other. */
const ambiguousRows = [
  ['Date', 'Reference', 'Amount'],
  ['2026-07-01', 'INV-1', '54.321'],
  ['2026-07-02', 'INV-2', '12.500'],
];
export const answerNumberFormat = (
  file: SourceFile,
  mapping: Mapping,
  scope: Scope,
  value: 'dot' | 'comma',
): Mapping => ({
  ...mapping,
  numberFormat: value,
  formatChoice: {
    numberFormat: formatChoice(
      file,
      { ...mapping, numberFormat: value },
      'numberFormat',
      value,
      suggestFormats(file, mapping, scope.decimals).numberFormat.candidates,
      scope.decimals,
    ),
  },
});
async function ambiguityCases(): Promise<RecomputeCase[]> {
  const files: [SourceFile, SourceFile] = [
    await upload('supplier.csv', ambiguousRows),
    await upload('ledger.csv', ambiguousRows),
  ];
  const bare = files.map((f) => inferMapping(f)) as [Mapping, Mapping];
  return [
    {
      name: 'unresolved number-format ambiguity',
      files,
      mappings: bare,
      scope: ambiguityScope,
      decisions: [],
      rejected: [],
      unresolved: true,
    },
    {
      name: 'the same ambiguity, answered',
      files,
      mappings: files.map((f, i) =>
        answerNumberFormat(f, bare[i], ambiguityScope, 'dot'),
      ) as [Mapping, Mapping],
      scope: ambiguityScope,
      decisions: [],
      rejected: [],
    },
  ];
}

/** Split debit/credit statements whose sign is proven by a running balance. */
export const directionRows = (reverse: boolean) => [
  [
    'Date',
    'Type',
    'Reference',
    'Debit',
    'Credit',
    reverse ? 'Running AP Balance' : 'Running Balance',
  ],
  [
    '2026-07-01',
    'Opening Balance',
    'B/F',
    reverse ? '0' : '100',
    reverse ? '100' : '0',
    '100',
  ],
  [
    '2026-07-02',
    'Invoice',
    'INV-100',
    reverse ? '0' : '25',
    reverse ? '25' : '0',
    '125',
  ],
  [
    '2026-07-03',
    'Payment',
    'PAY-100',
    reverse ? '10' : '0',
    reverse ? '0' : '10',
    '115',
  ],
];
export const directionMapping: Mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 2,
  debit: 3,
  credit: 4,
  mode: 'split',
};
async function directionCase(): Promise<RecomputeCase> {
  const files: [SourceFile, SourceFile] = [
    await upload('direction-supplier.csv', directionRows(false)),
    await upload('direction-ledger.csv', directionRows(true)),
  ];
  const mappings = files.map((file) => {
    const proof = inferStatementDirection(file, directionMapping, 2)!;
    return {
      ...structuredClone(directionMapping),
      multiplier: proof.multiplier,
      directionEvidence: proof,
    };
  }) as [Mapping, Mapping];
  return {
    name: 'split columns with proven direction',
    files,
    mappings,
    scope: {
      supplier: 'Synthetic Supplier',
      entity: 'Synthetic Entity',
      account: 'DIR-1',
      currency: 'SAR',
      decimals: 2,
      cutoff: '2026-07-31',
      dateWindow: 2,
      confirmed: true,
      coverageConfirmed: false,
    },
    decisions: [],
    rejected: [],
  };
}

export async function recomputeCases(): Promise<RecomputeCase[]> {
  return [
    await demoCase(),
    await decisionsCase(),
    await groupingCase(),
    ...(await ambiguityCases()),
    await directionCase(),
  ];
}

export type WorkerReply = {
  ok: boolean;
  value?: unknown;
  error?: string;
  readiness?: unknown;
  timings?: Record<string, number>;
};
/** Loads the production worker module against a stand-in `self` and returns a
 * function that sends it one request and resolves with its reply. */
export async function productionWorker(workerModule: string) {
  const replies: WorkerReply[] = [];
  const worker: {
    onmessage?: (event: { data: unknown }) => Promise<void>;
    postMessage: (value: WorkerReply) => void;
  } = { postMessage: (value) => void replies.push(value) };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', {
    value: worker,
    writable: true,
    configurable: true,
  });
  await import(workerModule);
  let id = 0;
  return {
    send: async (action: string, payload: unknown): Promise<WorkerReply> => {
      await worker.onmessage!({
        data: { channel: WORKER_CHANNEL, id: ++id, action, payload },
      });
      return replies.at(-1)!;
    },
    restore: () => {
      if (previous) Object.defineProperty(globalThis, 'self', previous);
      else Reflect.deleteProperty(globalThis, 'self');
    },
  };
}
