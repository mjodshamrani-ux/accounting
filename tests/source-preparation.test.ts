import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import { isInputReadinessRejection } from '../lib/reconciliation/input-readiness.ts';
import {
  prepareVerifiedSources,
  verifyDirectionEvidence,
} from '../lib/reconciliation/source-preparation.ts';
import { verifyDirectionEvidence as fromIo } from '../lib/reconciliation/io.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type { Mapping, Scope } from '../lib/reconciliation/types.ts';
import {
  SOURCE_FAULTS,
  gateOrderSources,
  gateScope,
  type SourceFault,
} from './helpers/gate-order-cases.ts';
import {
  productionWorker,
  type WorkerReply,
} from './helpers/recompute-cases.ts';

// The source boundary every reconciliation shares before its own matching:
// formats of every source, then every claimed direction re-proved, then
// normalisation. These tests hold it to that order on its own and through
// every supplier path, and show it takes one source as readily as two. One
// source here means a guarded reading, not support for any new reconciliation.
const { files, proven, reading } = await gateOrderSources();
const DIRECTION =
  'دليل اتجاه المدين والدائن لا يطابق المصدر. أعد التحقق من اتجاه المبالغ.';
const NOT_A_READING = 'إعدادات قراءة المصدر غير صالحة';
const review = { name: 'Synthetic reviewer', notes: '', checked: false };
let worker: Awaited<ReturnType<typeof productionWorker>>;
before(async () => {
  worker = await productionWorker(
    new URL('../lib/reconciliation/worker.ts', import.meta.url).href,
  );
});
after(() => worker.restore());

/** The refusal the target order gives: any unanswered format, on either
 * source, before any direction claim; then any claim; otherwise none. */
const expected = (faults: SourceFault[]) =>
  faults.some((f) => f.includes('format'))
    ? 'FORMAT_AMBIGUOUS_UNRESOLVED'
    : faults.some((f) => f.includes('direction'))
      ? 'direction'
      : 'ok';
const kind = (error: unknown) =>
  isInputReadinessRejection(error, 'FORMAT_AMBIGUOUS_UNRESOLVED')
    ? 'FORMAT_AMBIGUOUS_UNRESOLVED'
    : error instanceof Error && error.message === DIRECTION
      ? 'direction'
      : `unexpected: ${String(error)}`;
const replyKind = (reply: WorkerReply) =>
  reply.ok
    ? 'ok'
    : (reply.readiness as { code?: string } | undefined)?.code ===
        'FORMAT_AMBIGUOUS_UNRESOLVED'
      ? 'FORMAT_AMBIGUOUS_UNRESOLVED'
      : reply.error === DIRECTION
        ? 'direction'
        : `unexpected: ${reply.error}`;
const attempt = (run: () => unknown) => {
  try {
    run();
    return 'ok';
  } catch (error) {
    return kind(error);
  }
};
const attemptAsync = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return 'ok';
  } catch (error) {
    return kind(error);
  }
};

test('one source: a guarded reading becomes a normalised source', () => {
  const { mappings, sources } = prepareVerifiedSources(
    [files[0]],
    [proven[0]],
    gateScope,
    ['ledger'],
  );
  assert.deepEqual(mappings, [verifyDirectionEvidence(files[0], proven[0], 3)]);
  assert.deepEqual(sources, [
    normalizeSource(files[0], mappings[0], gateScope, 'ledger'),
  ]);
  assert.deepEqual(
    sources[0].transactions.map((t) => t.amount),
    // The opening balance row is excluded as a balance row by the reader.
    [25500, -10250],
  );
  for (const fault of SOURCE_FAULTS)
    assert.equal(
      attempt(() =>
        prepareVerifiedSources([files[0]], [reading(0, fault)], gateScope, [
          'ledger',
        ]),
      ),
      expected([fault]),
      fault,
    );
});

test('two sources: the same boundary the supplier recompute uses', () => {
  const prepared = prepareVerifiedSources(files, proven, gateScope, [
    'supplier',
    'ledger',
  ]);
  const recomputed = reconcileSupplierStatement({
    files,
    mappings: proven,
    scope: gateScope,
  });
  assert.deepEqual([recomputed.a, recomputed.b], prepared.sources);
  assert.deepEqual(recomputed.mappings, prepared.mappings);
  assert.deepEqual(
    recomputed.result,
    compare(prepared.sources[0], prepared.sources[1], gateScope),
  );
});

test('an edited explanation of a proven direction comes back canonical', () => {
  const edited: Mapping = {
    ...proven[1],
    directionEvidence: {
      ...proven[1].directionEvidence!,
      reason: `${proven[1].directionEvidence!.reason} (edited)`,
    },
  };
  const { mappings } = prepareVerifiedSources(
    files,
    [proven[0], edited],
    gateScope,
    ['supplier', 'ledger'],
  );
  assert.deepEqual(mappings[1], proven[1]);
});

for (const supplierFault of SOURCE_FAULTS)
  for (const ledgerFault of SOURCE_FAULTS) {
    const faults = [supplierFault, ledgerFault];
    const want = expected(faults);
    test(`first refusal on every path: ${supplierFault} | ${ledgerFault} → ${want}`, async () => {
      const mappings = [reading(0, supplierFault), reading(1, ledgerFault)] as [
        Mapping,
        Mapping,
      ];
      const payload = {
        files,
        mappings,
        scope: gateScope,
        decisions: [],
        rejected: [],
      };
      assert.equal(
        attempt(() =>
          prepareVerifiedSources(files, mappings, gateScope, [
            'supplier',
            'ledger',
          ]),
        ),
        want,
        'prepareVerifiedSources',
      );
      assert.equal(
        replyKind(await worker.send('reconcile', payload)),
        want,
        'reconcile',
      );
      assert.equal(
        replyKind(await worker.send('compare', payload)),
        want,
        'compare',
      );
      // A saved session whose readings were changed afterwards.
      const saved = await worker.send('save-session', {
        ...payload,
        mappings: proven,
        events: [],
        review,
      });
      const session = JSON.parse(
        new TextDecoder().decode(saved.value as ArrayBuffer),
      );
      const buffer = new TextEncoder().encode(
        JSON.stringify({ ...session, mappings }),
      ).buffer;
      assert.equal(
        replyKind(await worker.send('restore-session', { buffer })),
        want,
        'restore',
      );
      // A result computed without any gate, then exported.
      const unchecked = compare(
        normalizeSource(files[0], mappings[0], gateScope, 'supplier'),
        normalizeSource(files[1], mappings[1], gateScope, 'ledger'),
        gateScope,
      );
      assert.equal(
        await attemptAsync(() => exportWorkbook(unchecked, files, review)),
        want,
        'direct export',
      );
      assert.equal(
        replyKind(
          await worker.send('export', { result: unchecked, files, review }),
        ),
        want,
        'worker export',
      );
    });
  }

test('a reading that is not an object is named as such first', async () => {
  const broken = [null, proven[1]] as unknown as Mapping[];
  assert.throws(
    () =>
      prepareVerifiedSources(files, broken, gateScope, ['supplier', 'ledger']),
    { message: NOT_A_READING },
  );
  const reply = await worker.send('reconcile', {
    files,
    mappings: broken,
    scope: gateScope,
  });
  assert.equal(reply.error, NOT_A_READING);
});

test('after the gates, scope, currency and cutoff stay with normalisation', async () => {
  // A scope the reading refuses: the gates pass, normalisation refuses it.
  assert.throws(
    () =>
      prepareVerifiedSources(
        files,
        proven,
        { ...gateScope, currency: 7 } as unknown as Scope,
        ['supplier', 'ledger'],
      ),
    /نطاق التسوية/,
  );
  // After the cutoff: excluded with its reason, not dropped.
  const early = prepareVerifiedSources(
    files,
    proven,
    { ...gateScope, cutoff: '2026-07-02' },
    ['supplier', 'ledger'],
  );
  assert.deepEqual(
    early.sources[0].transactions.map((t) => t.row),
    [3],
  );
  assert.deepEqual(
    early.sources[0].excluded.find((x) => x.row === 4)?.reason,
    'بعد تاريخ المقارنة',
  );
  // Another currency on a row: a reading error on that row, kept visible.
  const csv = [
    'Date,Reference,Amount,Currency',
    '2026-07-01,INV-1,100.00,SAR',
    '2026-07-02,INV-2,50.00,USD',
  ].join('\n');
  const file = await readFile(
    'currency.csv',
    new TextEncoder().encode(csv).buffer,
  );
  const mapping: Mapping = {
    ...defaultMapping(),
    date: 0,
    reference: 1,
    amount: 2,
    currencyColumn: 3,
  };
  const sar = { ...gateScope, currency: 'SAR', decimals: 2 };
  const { sources } = prepareVerifiedSources([file], [mapping], sar, [
    'ledger',
  ]);
  assert.deepEqual(
    sources[0].transactions.map((t) => t.row),
    [2],
  );
  assert.deepEqual(sources[0].errors, [
    { row: 3, message: 'عملة الصف لا تطابق العملة المؤكدة' },
  ]);
});

test('an export of a proven direction with an edited explanation still succeeds', async () => {
  const edited: Mapping = {
    ...proven[1],
    directionEvidence: {
      ...proven[1].directionEvidence!,
      reason: `${proven[1].directionEvidence!.reason} (edited)`,
    },
  };
  const claimed = compare(
    normalizeSource(files[0], proven[0], gateScope, 'supplier'),
    normalizeSource(files[1], edited, gateScope, 'ledger'),
    gateScope,
  );
  const bytes = await exportWorkbook(claimed, files, review);
  assert.ok(bytes.byteLength > 0);
  assert.equal(
    replyKind(await worker.send('export', { result: claimed, files, review })),
    'ok',
  );
});

test('the gates are assembled in one place', () => {
  // io.ts keeps the name for its importers; the proof itself is not copied.
  assert.equal(fromIo, verifyDirectionEvidence);
  const read = (file: string) =>
    fs.readFileSync(`lib/reconciliation/${file}`, 'utf8');
  for (const file of ['io.ts', 'session.ts', 'supplier-reconciliation.ts'])
    assert.doesNotMatch(read(file), /assertInputFormats\(/, file);
  // The worker keeps its own format guard in front of export only.
  assert.equal(read('worker.ts').match(/assertInputFormats\(/g)?.length, 1);
  // saveSession stores proven readings and needs no normalised source; the
  // full boundary runs in the restore it performs before saving.
  const callers = fs
    .readdirSync('lib/reconciliation')
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => /verifyDirectionEvidence\(/.test(read(f)));
  assert.deepEqual(callers.sort(), ['session.ts', 'source-preparation.ts']);
});
