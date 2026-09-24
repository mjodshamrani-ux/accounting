import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeSource } from '../lib/reconciliation/core.ts';
import { exportWorkbook } from '../lib/reconciliation/io.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import type {
  Comparison,
  Mapping,
  Scope,
} from '../lib/reconciliation/types.ts';
import {
  isInputReadinessRejection,
  type InputReadinessCode,
} from '../lib/reconciliation/input-readiness.ts';
import {
  decimalMinor,
  readOutputWorkbook,
} from '../audit/reliability/verify-workbook.mjs';
import {
  coreResult,
  productionWorker,
  recomputeCases,
  type RecomputeCase,
  type WorkerReply,
} from './helpers/recompute-cases.ts';

// Comparing, restoring a session and exporting all recompute the reconciliation
// from its sources through one entry point. These tests drive the production
// paths themselves (the worker's actions, the session round trip and the
// export) and hold every one of them to the result computed from core.ts
// directly. The workbook is read back with the independent verifier's reader.
// Each gate stays where it was; the refusals below are what each path refused
// before the paths were joined, including the differences between them.
const cases = await recomputeCases();
const resolved = cases.filter((c) => !c.formatRefusal);
const named = (name: string) => cases.find((c) => c.name.startsWith(name))!;
let worker: Awaited<ReturnType<typeof productionWorker>>;
before(async () => {
  worker = await productionWorker(
    new URL('../lib/reconciliation/worker.ts', import.meta.url).href,
  );
});
after(() => worker.restore());

const review = { name: 'Synthetic reviewer', notes: '', checked: false };
const payload = (c: RecomputeCase, mappings = c.mappings) => ({
  files: c.files,
  mappings,
  scope: c.scope,
  decisions: c.decisions,
  rejected: c.rejected,
});
const exported = (result: Comparison, files = resolved[0].files) =>
  worker.send('export', { result, files, review });
const value = <T>(reply: WorkerReply) => {
  assert.equal(reply.ok, true, reply.error);
  return reply.value as T;
};
const refused = (
  reply: WorkerReply,
  message: RegExp | string,
  code?: string,
) => {
  assert.equal(reply.ok, false, 'the path must refuse');
  if (typeof message === 'string') assert.equal(reply.error, message);
  else assert.match(reply.error!, message);
  assert.equal(
    (reply.readiness as { code?: string } | undefined)?.code,
    code,
    reply.error,
  );
};
const MISMATCH =
  'النتيجة لا تطابق إعادة الحساب من المصدر. أعد المقارنة قبل التصدير.';
const DIRECTION =
  'دليل اتجاه المدين والدائن لا يطابق المصدر. أعد التحقق من اتجاه المبالغ.';
const TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const EXPORT_STAGES = [
  'exportOriginalReadMs',
  'exportRevalidationMs',
  'exportWorkbookConstructionMs',
  'exportSerializationMs',
];

async function workbook(bytes: ArrayBuffer) {
  const { sheets } = await readOutputWorkbook(new Uint8Array(bytes));
  const cells: Record<string, string> = {};
  for (const [name, sheet] of sheets)
    for (const [address, cell] of sheet.cells)
      cells[`${name}!${address}`] = String(cell.value).replace(
        TIMESTAMP,
        '<time>',
      );
  // The export time is the one volatile cell, written as an Excel serial.
  assert.equal(cells['Export Metadata!A5'], 'Export time');
  cells['Export Metadata!B5'] = '<time>';
  return { sheets, cells };
}
/** Each exported source row, as the verifier reads it, against the core. */
async function assertWorkbookRows(bytes: ArrayBuffer, expected: Comparison) {
  const { sheets } = await workbook(bytes);
  for (const [name, source] of [
    ['Supplier transactions', expected.supplier],
    ['Ledger transactions', expected.ledger],
  ] as const) {
    const rows = [...sheets.get(name).rows]
      .filter(([n]) => n !== 1)
      .map(([, row]) => ({
        id: row.get('A')?.value,
        reference: row.get('E')?.value ?? '',
        minor: decimalMinor(row.get('H')?.value, expected.scope.decimals),
        originalAmount: row.get('I')?.value,
      }));
    assert.deepEqual(
      rows,
      source.transactions.map((t) => ({
        id: t.id,
        reference: t.reference,
        minor: BigInt(t.amount),
        originalAmount: t.originalAmount,
      })),
      name,
    );
  }
}

for (const c of resolved)
  test(`every recompute path gives the core result: ${c.name}`, async () => {
    const expected = coreResult(c);
    const a = normalizeSource(c.files[0], c.mappings[0], c.scope, 'supplier');
    const b = normalizeSource(c.files[1], c.mappings[1], c.scope, 'ledger');

    const reconciled = await worker.send('reconcile', payload(c));
    assert.deepEqual(value(reconciled), { a, b, result: expected });
    // The two stage timings keep their names and their order.
    assert.deepEqual(Object.keys(reconciled.timings!), [
      'normalizePairMs',
      'matchingMs',
    ]);
    for (const ms of Object.values(reconciled.timings!))
      assert.ok(Number.isFinite(ms) && ms >= 0);

    const compared = await worker.send('compare', payload(c));
    assert.deepEqual(value(compared), expected);
    assert.deepEqual(compared.timings, {});

    const saved = await worker.send('save-session', {
      ...payload(c),
      events: [],
      review,
    });
    const restoredReply = await worker.send('restore-session', {
      buffer: value<ArrayBuffer>(saved).slice(0),
    });
    const restored = value<{
      result: Comparison;
      decisions: unknown;
      rejected: unknown;
      mappings: Mapping[];
      files: RecomputeCase['files'];
    }>(restoredReply);
    assert.deepEqual(restored.result, expected);
    assert.deepEqual(restored.decisions, c.decisions);
    assert.deepEqual(restored.rejected, c.rejected);

    const fromCompare = await exported(expected, c.files);
    assert.deepEqual(Object.keys(fromCompare.timings!), EXPORT_STAGES);
    const fromSession = await exported(restored.result, restored.files);
    await assertWorkbookRows(value(fromCompare), expected);
    assert.deepEqual(
      (await workbook(value(fromSession))).cells,
      (await workbook(value(fromCompare))).cells,
      'the same workbook from a comparison and from its restored session',
    );
  });

test('the cases hold what they are named for', () => {
  const ordinary = coreResult(named('ordinary'));
  assert.ok(ordinary.matches.some((m) => m.kind === 'auto'));

  const decided = named('manual decision');
  const result = coreResult(decided);
  const manual = result.matches.filter((m) => m.kind === 'manual');
  assert.deepEqual(
    manual.map((m) => [m.supplierId, m.ledgerId, m.note]),
    decided.decisions.map((d) => [d.supplierId, d.ledgerId, d.note]),
  );
  assert.deepEqual(result.rejectedPairs, decided.rejected);
  assert.ok(
    !result.matches.some(
      (m) => `${m.supplierId}|${m.ledgerId}` === decided.rejected[0],
    ),
    'a rejected link is not made again',
  );

  const grouped = coreResult(named('proven one-to-many'));
  assert.deepEqual(
    grouped.matches.map((m) => [m.kind, m.supplierIds, m.ledgerIds]),
    [['auto', ['supplier:0:2'], ['ledger:0:2', 'ledger:0:3']]],
  );

  const answered = coreResult(named('the same ambiguity'));
  assert.deepEqual(
    answered.supplier.transactions.map((t) => t.amount),
    [54321, 12500],
  );

  const direction = coreResult(named('split columns'));
  assert.deepEqual(
    direction.ledger.transactions.map((t) => t.amount),
    direction.supplier.transactions.map((t) => t.amount),
  );
});

/** A refusal from the format guard, identified by its structured code. */
const refusedByFormatGuard = (error: unknown, code: InputReadinessCode) => {
  assert.ok(isInputReadinessRejection(error, code), String(error));
  return true;
};

for (const c of cases.filter((c) => c.formatRefusal))
  test(`every path refuses ${c.formatRefusal}: ${c.name}`, async () => {
    const code = c.formatRefusal!;
    refused(await worker.send('reconcile', payload(c)), /صيغة/, code);
    refused(await worker.send('compare', payload(c)), /صيغة/, code);
    refused(
      await worker.send('save-session', { ...payload(c), events: [], review }),
      /صيغة/,
      code,
    );
    refused(await exported(coreResult(c), c.files), /صيغة/, code);
    await assert.rejects(
      exportWorkbook(coreResult(c), c.files, review),
      (error) => refusedByFormatGuard(error, code),
    );
  });

test('exportWorkbook itself refuses an unanswered format ambiguity', async () => {
  // Called directly, not through the worker: the export holds the invariant.
  const c = named('unresolved');
  await assert.rejects(
    exportWorkbook(coreResult(c), c.files, review),
    (error) => refusedByFormatGuard(error, 'FORMAT_AMBIGUOUS_UNRESOLVED'),
  );
  // The same source with its answer recorded for this reading is exported.
  const answered = named('the same ambiguity');
  const bytes = await exportWorkbook(
    coreResult(answered),
    answered.files,
    review,
  );
  await assertWorkbookRows(bytes, coreResult(answered));
});

test('a result changed after comparing is not exported', async () => {
  const c = named('manual decision');
  const result = coreResult(c);
  value(await exported(result, c.files));
  const amount = structuredClone(result);
  amount.supplier.transactions[0].amount += 1;
  const unrejected = { ...structuredClone(result), rejectedPairs: [] };
  const undecided = structuredClone(result);
  undecided.matches = undecided.matches.filter((m) => m.kind !== 'manual');
  for (const changed of [amount, unrejected, undecided]) {
    refused(await exported(changed, c.files), MISMATCH);
    await assert.rejects(exportWorkbook(changed, c.files, review), {
      message: MISMATCH,
    });
  }
});

test('a saved format choice that no longer fits is refused', async () => {
  const c = named('the same ambiguity');
  const saved = value<ArrayBuffer>(
    await worker.send('save-session', { ...payload(c), events: [], review }),
  );
  const session = JSON.parse(new TextDecoder().decode(saved));
  const code = 'FORMAT_AMBIGUOUS_UNRESOLVED';
  for (const edit of [
    { sourceHash: '0'.repeat(64) },
    { value: 'comma' },
    { decimals: 2 },
  ]) {
    const corrupt = structuredClone(session);
    Object.assign(corrupt.mappings[0].formatChoice.numberFormat, edit);
    const buffer = new TextEncoder().encode(JSON.stringify(corrupt)).buffer;
    refused(
      await worker.send('restore-session', { buffer }),
      /صيغة المبالغ/,
      code,
    );
    const mappings: [Mapping, Mapping] = [corrupt.mappings[0], c.mappings[1]];
    refused(
      await worker.send('reconcile', payload(c, mappings)),
      /صيغة المبالغ/,
      code,
    );
    refused(
      await worker.send('compare', payload(c, mappings)),
      /صيغة المبالغ/,
      code,
    );
    // A result computed under the stale choice is not exported either.
    const stale = coreResult({ ...c, mappings });
    refused(await exported(stale, c.files), /صيغة المبالغ/, code);
    await assert.rejects(exportWorkbook(stale, c.files, review), (error) =>
      refusedByFormatGuard(error, code),
    );
  }
});

const conflictingDirection = (c: RecomputeCase) => {
  const [, ledger] = c.mappings;
  const evidence = ledger.directionEvidence!;
  return {
    checkedRows: {
      ...ledger,
      directionEvidence: { ...evidence, checkedRows: evidence.checkedRows + 1 },
    },
    flippedSign: {
      ...ledger,
      multiplier: -ledger.multiplier,
      directionEvidence: { ...evidence, multiplier: -evidence.multiplier },
    },
  } as Record<string, Mapping>;
};

test('a debit/credit direction claim the source does not prove', async () => {
  const c = named('split columns');
  const honest = coreResult(c);
  const saved = value<ArrayBuffer>(
    await worker.send('save-session', { ...payload(c), events: [], review }),
  );
  const session = JSON.parse(new TextDecoder().decode(saved));
  for (const [name, ledger] of Object.entries(conflictingDirection(c))) {
    const mappings: [Mapping, Mapping] = [c.mappings[0], ledger];
    // Session, restore and export re-prove the claim from the source.
    refused(
      await worker.send('save-session', {
        ...payload(c, mappings),
        events: [],
        review,
      }),
      DIRECTION,
    );
    const corrupt = structuredClone(session);
    corrupt.mappings[1] = ledger;
    refused(
      await worker.send('restore-session', {
        buffer: new TextEncoder().encode(JSON.stringify(corrupt)).buffer,
      }),
      DIRECTION,
    );
    const claimed = structuredClone(honest);
    claimed.ledger.mapping = ledger;
    refused(await exported(claimed, c.files), DIRECTION);
    await assert.rejects(exportWorkbook(claimed, c.files, review), {
      message: DIRECTION,
    });
  }
});

test('compare re-proves a claimed debit/credit direction before showing a result', async () => {
  const c = named('split columns');
  // The direction proof has no structured code: its own message identifies it.
  for (const ledger of Object.values(conflictingDirection(c))) {
    const mappings: [Mapping, Mapping] = [c.mappings[0], ledger];
    const reconciled = await worker.send('reconcile', payload(c, mappings));
    refused(reconciled, DIRECTION);
    assert.equal(reconciled.value, undefined, 'no result is shown');
    refused(await worker.send('compare', payload(c, mappings)), DIRECTION);
  }
  // A claim proven by the source still passes, with the same result as before.
  const honest = coreResult(c);
  assert.deepEqual(
    value<{ result: Comparison }>(await worker.send('reconcile', payload(c)))
      .result,
    honest,
  );
  assert.deepEqual(value(await worker.send('compare', payload(c))), honest);
});

test('a direction claim whose facts hold but whose explanation was edited', async () => {
  // verifyDirectionEvidence accepts it and returns the proven evidence. The
  // session and the export already used that; compare now shows it as well.
  const c = named('split columns');
  const evidence = c.mappings[1].directionEvidence!;
  const edited: Mapping = {
    ...c.mappings[1],
    directionEvidence: { ...evidence, reason: `${evidence.reason} (edited)` },
  };
  const mappings: [Mapping, Mapping] = [c.mappings[0], edited];
  const honest = coreResult(c);
  const reconciled = value<{ result: Comparison }>(
    await worker.send('reconcile', payload(c, mappings)),
  );
  assert.deepEqual(reconciled.result, honest);
  assert.deepEqual(
    value(await worker.send('compare', payload(c, mappings))),
    honest,
  );
  value(await exported(reconciled.result, c.files));
});

test('two faults at once: the format guard, then the direction proof', async () => {
  const c = named('split columns');
  const forged = conflictingDirection(c).flippedSign;
  // A scope the reading refuses. At 8c01b54 the reading reported it; the
  // direction proof now runs before the reading, so it is reported first.
  const badScope = { ...c.scope, currency: 7 } as unknown as Scope;
  const doubled = { ...payload(c, [c.mappings[0], forged]), scope: badScope };
  refused(await worker.send('reconcile', doubled), DIRECTION);
  refused(await worker.send('compare', doubled), DIRECTION);
  // With a proven claim the reading still reports the scope, as before.
  const proven = { ...payload(c), scope: badScope };
  refused(await worker.send('reconcile', proven), /نطاق التسوية/);
  // The format guard still runs first: its refusal wins over a forged claim.
  const ambiguous = named('unresolved');
  const direction = named('split columns');
  refused(
    await worker.send('reconcile', {
      ...payload(ambiguous),
      mappings: [
        ambiguous.mappings[0],
        {
          ...ambiguous.mappings[1],
          directionEvidence: direction.mappings[1].directionEvidence,
        },
      ],
    }),
    /صيغة المبالغ/,
    'FORMAT_AMBIGUOUS_UNRESOLVED',
  );
});

test('the shared recompute reports its stages in order', () => {
  const c = resolved[0];
  const stages: string[] = [];
  const { result } = reconcileSupplierStatement(
    { files: c.files, mappings: c.mappings, scope: c.scope },
    (stage) => stages.push(stage),
  );
  assert.deepEqual(stages, ['normalizePairMs', 'matchingMs']);
  assert.deepEqual(result, coreResult({ ...c, decisions: [], rejected: [] }));
});

test('the recompute paths share one entry point; the verifier does not', () => {
  const read = (file: string) => fs.readFileSync(file, 'utf8');
  for (const file of ['worker.ts', 'session.ts', 'io.ts']) {
    const source = read(`lib/reconciliation/${file}`);
    assert.match(source, /reconcileSupplierStatement\(/, file);
    assert.doesNotMatch(source, /\bcompare\(/, file);
  }
  assert.doesNotMatch(
    read('audit/reliability/verify-workbook.mjs'),
    /supplier-reconciliation|reconcileSupplierStatement|lib\/reconciliation/,
  );
});
