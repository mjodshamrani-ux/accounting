import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertInputFormats,
  formatChoice,
  isInputReadinessRejection,
  InputReadinessError,
} from '../lib/reconciliation/input-readiness.ts';
import {
  compare,
  inferMapping,
  normalizeSource,
} from '../lib/reconciliation/core.ts';
import { suggestFormats } from '../lib/reconciliation/format-inference.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { WORKER_CHANNEL } from '../lib/reconciliation/protocol.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';

// Acceptance condition for this candidate, both directions. An unanswered
// ambiguity must not reach an accepted result through ANY entry path, and the
// answered one must complete. A refusal only counts when the guard states its
// own code: any other throw is a defect, never protection.
const scope: Scope = {
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
/** 54.321 is 54 dinars 321 fils under one reading and 54,321 dinars under the
 * other. Both parse the whole column, so only the accountant can settle it. */
const rows = [
  ['Date', 'Reference', 'Amount'],
  ['2026-07-01', 'INV-1', '54.321'],
  ['2026-07-02', 'INV-2', '12.500'],
];
const csv = () =>
  new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n'))
    .buffer as ArrayBuffer;
const answered = (
  file: SourceFile,
  mapping: Mapping,
  value: 'dot' | 'comma',
) => {
  const candidates = suggestFormats(file, mapping, scope.decimals).numberFormat
    .candidates;
  return {
    ...mapping,
    numberFormat: value,
    formatChoice: {
      numberFormat: formatChoice(
        file,
        { ...mapping, numberFormat: value },
        'numberFormat',
        value,
        candidates,
        scope.decimals,
      ),
    },
  } as Mapping;
};

test('047 only the guard’s own refusal counts as protection', () => {
  const file = {
    name: 'a.csv',
    sha256: 'a'.repeat(64),
    sheets: [
      {
        name: 'S',
        rows: rows.map((r) => [...r]),
        formulaRows: [],
        hiddenRows: [],
      },
    ],
  };
  const mapping = inferMapping(file);
  let caught: unknown;
  try {
    assertInputFormats([file], [mapping], scope);
  } catch (error) {
    caught = error;
  }
  assert.ok(isInputReadinessRejection(caught, 'FORMAT_AMBIGUOUS_UNRESOLVED'));
  assert.deepEqual((caught as InputReadinessError).readiness.candidates, [
    'dot',
    'comma',
  ]);
  assert.equal((caught as InputReadinessError).readiness.field, 'numberFormat');
  // Nothing else may be mistaken for the guard doing its job.
  for (const impostor of [
    new TypeError('x is not a function'),
    new RangeError('out of range'),
    new Error('تعذر التحقق من صيغة المبالغ'),
    {
      readiness: {
        code: 'FORMAT_AMBIGUOUS_UNRESOLVED',
        source: 'a',
        field: 'numberFormat',
        candidates: [],
      },
    },
    Object.assign(new Error('fake'), { name: 'InputReadinessError' }),
    undefined,
    null,
  ])
    assert.equal(isInputReadinessRejection(impostor), false, String(impostor));
  // A refusal of one code is not a refusal of another.
  assert.equal(isInputReadinessRejection(caught, 'FORMAT_INVALID'), false);
});

test('047 the answered ambiguity is accepted and produces the chosen values', () => {
  const file = {
    name: 'a.csv',
    sha256: 'a'.repeat(64),
    sheets: [
      {
        name: 'S',
        rows: rows.map((r) => [...r]),
        formulaRows: [],
        hiddenRows: [],
      },
    ],
  };
  const mapping = inferMapping(file);
  for (const [value, first] of [
    ['dot', 54321],
    ['comma', 54321000],
  ] as const) {
    const chosen = answered(file, mapping, value);
    assert.doesNotThrow(() => assertInputFormats([file], [chosen], scope));
    const result = normalizeSource(file, chosen, scope, 'supplier');
    assert.equal(result.transactions[0].amount, first);
  }
});

test('047 the worker refuses an unanswered ambiguity on reconcile, compare and export, and completes once answered', async () => {
  const supplierFile = await readFile('supplier.csv', csv());
  const ledgerFile = await readFile('ledger.csv', csv());
  const files = [supplierFile, ledgerFile];
  const bare = files.map((f) => inferMapping(f)) as [Mapping, Mapping];
  const chosen = files.map((f, i) => answered(f, bare[i], 'dot')) as [
    Mapping,
    Mapping,
  ];
  const ready = compare(
    normalizeSource(supplierFile, chosen[0], scope, 'supplier'),
    normalizeSource(ledgerFile, chosen[1], scope, 'ledger'),
    scope,
  );
  const messages: Record<string, unknown>[] = [];
  const worker: {
    onmessage?: (event: { data: unknown }) => Promise<void>;
    postMessage: (value: Record<string, unknown>) => void;
  } = { postMessage: (value) => void messages.push(value) };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', {
    value: worker,
    writable: true,
    configurable: true,
  });
  try {
    await import('../lib/reconciliation/worker.ts');
    assert.equal(typeof worker.onmessage, 'function');
    const send = async (id: number, action: string, payload: unknown) => {
      await worker.onmessage!({
        data: { channel: WORKER_CHANNEL, id, action, payload },
      });
      return messages.at(-1)!;
    };
    const unanswered = (action: string) =>
      action === 'export'
        ? {
            files,
            result: {
              ...ready,
              supplier: { ...ready.supplier, mapping: bare[0] },
              ledger: { ...ready.ledger, mapping: bare[1] },
            },
            review: { checked: true, name: 'Simulated reviewer', notes: '' },
          }
        : { files, mappings: bare, scope, decisions: [], rejected: [] };
    let id = 0;
    for (const action of ['reconcile', 'compare', 'export']) {
      const reply = await send(++id, action, unanswered(action));
      assert.equal(reply.ok, false, action);
      assert.equal(Object.hasOwn(reply, 'value'), false, action);
      // The code crosses the worker boundary, so the caller need not read Arabic
      // prose to know a guarded stop happened rather than a crash.
      assert.deepEqual(
        reply.readiness as { code: string; field: string },
        {
          code: 'FORMAT_AMBIGUOUS_UNRESOLVED',
          source: 'supplier.csv',
          field: 'numberFormat',
          candidates: ['dot', 'comma'],
        },
        action,
      );
    }
    // Answered: the same paths must now complete, or the guard is a blanket block.
    const reconciled = await send(++id, 'reconcile', {
      files,
      mappings: chosen,
      scope,
      decisions: [],
      rejected: [],
    });
    assert.equal(reconciled.ok, true);
    const value = reconciled.value as { result: typeof ready };
    assert.equal(value.result.supplier.transactions[0].amount, 54321);
    assert.equal(value.result.matches.length, 2);
    const exported = await send(++id, 'export', {
      files,
      result: value.result,
      review: { checked: true, name: 'Simulated reviewer', notes: '' },
    });
    assert.equal(exported.ok, true);
    assert.ok((exported.value as ArrayBuffer).byteLength > 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'self', previous);
    else Reflect.deleteProperty(globalThis, 'self');
  }
});

test('047 session restore refuses an unanswered ambiguity with the same code', async () => {
  const supplierFile = await readFile('supplier.csv', csv());
  const ledgerFile = await readFile('ledger.csv', csv());
  const bare = [inferMapping(supplierFile), inferMapping(ledgerFile)] as [
    Mapping,
    Mapping,
  ];
  const chosen = [
    answered(supplierFile, bare[0], 'dot'),
    answered(ledgerFile, bare[1], 'dot'),
  ] as [Mapping, Mapping];
  const state = {
    files: [supplierFile, ledgerFile] as [SourceFile, SourceFile],
    mappings: chosen,
    scope,
    decisions: [],
    rejected: [],
    events: [],
    review: { name: '', notes: '', checked: false },
  };
  const bytes = await saveSession(state);
  const restored = await restoreSession(bytes);
  assert.equal(restored.result.supplier.transactions[0].amount, 54321);

  // Strip the recorded answer from the saved file: restore must refuse, and say
  // why with its own code rather than failing somewhere deeper.
  const tampered = JSON.parse(new TextDecoder().decode(bytes));
  delete tampered.mappings[0].formatChoice;
  let caught: unknown;
  try {
    await restoreSession(
      new TextEncoder().encode(JSON.stringify(tampered)).buffer as ArrayBuffer,
    );
  } catch (error) {
    caught = error;
  }
  assert.ok(isInputReadinessRejection(caught, 'FORMAT_AMBIGUOUS_UNRESOLVED'));
  assert.equal(
    (caught as InputReadinessError).readiness.source,
    'supplier.csv',
  );
});
