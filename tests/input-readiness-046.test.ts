import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertInputFormats,
  formatChoice,
} from '../lib/reconciliation/input-readiness.ts';
import {
  compare,
  inferMapping,
  normalizeSource,
} from '../lib/reconciliation/core.ts';
import { suggestFormats } from '../lib/reconciliation/format-inference.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import type { Scope, SourceFile } from '../lib/reconciliation/types.ts';
import { syntheticPdf } from './helpers/pdf-fixture.ts';
import { WORKER_CHANNEL } from '../lib/reconciliation/protocol.ts';
import { readSeparately, separateSheets } from './helpers/separate-export.ts';

const scope: Scope = {
  supplier: 'Synthetic vendor',
  entity: 'Synthetic buyer',
  account: 'AP-046',
  currency: 'KWD',
  decimals: 3,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
const fixture = (rows: string[][]): SourceFile => ({
  name: 'synthetic-readiness.csv',
  sheets: [{ name: 'Data', rows, formulaRows: [], hiddenRows: [] }],
});

test('046 invalid PDF layout cannot use a default locale to emit a silently scaled KWD row even after confirmation', async () => {
  // A real PDF glyph run crosses the bad boundary. The comma-only first amount
  // establishes the locale; the second token alone supports two interpretations.
  const bytes = syntheticPdf([
    [
      ['Date', 'Reference', 'Amount'],
      ['2026-07-01', 'INV-REFERENCE-00046', '100,50'],
      ['2026-07-02', 'INV-2', '1,234'],
    ],
  ]);
  const file = await readFile('synthetic-comma-layout.pdf', bytes, [22, 47]);
  const mapping = { ...inferMapping(file), pdfReviewed: true };
  assert.ok(file.sheets[0].rowIssues?.['2']?.length);
  const format = suggestFormats(file, mapping, scope.decimals);
  assert.equal(format.numberFormat.status, 'invalid');
  assert.equal(format.patch.numberFormat, undefined);
  // Demonstrate the pre-guard failure mechanism without claiming this partial,
  // erroneous source is a legitimate completed reconciliation.
  const unsafePartial = normalizeSource(file, mapping, scope, 'supplier');
  assert.equal(unsafePartial.errors.length, 1);
  assert.equal(
    unsafePartial.transactions.find((t) => t.row === 3)?.amount,
    1234000,
  );
  assert.throws(() =>
    assertInputFormats([file, file], [mapping, mapping], scope),
  );
  assert.equal(scope.confirmed, true);

  const corrected = await readFile(file.name, bytes, [22, 49]);
  assert.deepEqual(corrected.sheets[0].rowIssues, {});
  assert.equal(corrected.sha256, file.sha256);
  assert.deepEqual(corrected.sheets[0].rows, file.sheets[0].rows);
  const fresh = suggestFormats(corrected, mapping, scope.decimals);
  assert.equal(fresh.numberFormat.status, 'proven');
  assert.equal(fresh.patch.numberFormat, 'comma');
  const correctedMapping = { ...mapping, ...fresh.patch };
  assert.doesNotThrow(() =>
    assertInputFormats(
      [corrected, corrected],
      [correctedMapping, correctedMapping],
      scope,
    ),
  );
  const result = normalizeSource(
    corrected,
    correctedMapping,
    scope,
    'supplier',
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.transactions.map((t) => t.amount),
    [100500, 1234],
  );
  assert.deepEqual(
    result.transactions.map((t) => t.originalAmount),
    ['100,50', '1,234'],
  );
});

test('046 input readiness preserves native Excel value semantics and legitimate empty-period balances', () => {
  const native = fixture([
    ['Date', 'Reference', 'Amount'],
    ['2026-07-01', 'INV-001', '1,234'],
    ['2026-07-02', 'INV-002', '25,500'],
  ]);
  native.name = 'synthetic-native.xlsx';
  native.sheets[0].numericCells = {
    '2:3': { value: 1.234, format: '0.000' },
    '3:3': { value: 25.5, format: '0.000' },
  };
  const nativeMapping = {
    ...inferMapping(native),
    numberFormat: 'dot' as const,
  };
  assert.equal(
    suggestFormats(native, nativeMapping, 3).numberFormat.status,
    'proven',
  );
  assert.doesNotThrow(() =>
    assertInputFormats([native, native], [nativeMapping, nativeMapping], scope),
  );
  assert.deepEqual(
    normalizeSource(native, nativeMapping, scope, 'supplier').transactions.map(
      (t) => t.amount,
    ),
    [1234, 25500],
  );

  const empty = fixture([
    ['Period: 2026-07-01 to 2026-07-31'],
    ['Date', 'Reference', 'Amount'],
    ['Opening balance', '', '100.000'],
    ['Closing balance', '', '100.000'],
  ]);
  const emptyMapping = inferMapping(empty);
  const emptyFormat = suggestFormats(empty, emptyMapping, 3);
  assert.equal(emptyFormat.numberFormat.status, 'unavailable');
  assert.equal(emptyFormat.dateFormat.status, 'unavailable');
  assert.doesNotThrow(() =>
    assertInputFormats([empty, empty], [emptyMapping, emptyMapping], scope),
  );
  const source = normalizeSource(empty, emptyMapping, scope, 'supplier');
  assert.deepEqual(source.errors, []);
  assert.equal(source.transactions.length, 0);
  assert.equal(source.opening, 100000);
  assert.equal(source.closing, 100000);
});

test('046 an explicit choice for ambiguous valid formats remains valid but impossible dates do not', () => {
  const file = fixture([
    ['Date', 'Reference', 'Amount'],
    ['01/02/2026', 'INV-046', '1,234'],
  ]);
  const bare = {
    ...inferMapping(file),
    dateFormat: 'dmy' as const,
    numberFormat: 'comma' as const,
  };
  const format = suggestFormats(file, bare, 3);
  assert.equal(format.dateFormat.status, 'ambiguous');
  assert.equal(format.numberFormat.status, 'ambiguous');
  // 0.4.7: a value sitting in the mapping is not evidence that anyone chose it.
  // The guard now needs the choice the accountant made for this source, so the
  // worker, a restored session and the export cannot be reached past the card.
  assert.throws(() => assertInputFormats([file, file], [bare, bare], scope));
  const mapping = {
    ...bare,
    formatChoice: {
      dateFormat: formatChoice(
        file,
        bare,
        'dateFormat',
        'dmy',
        format.dateFormat.candidates,
        3,
      ),
      numberFormat: formatChoice(
        file,
        bare,
        'numberFormat',
        'comma',
        format.numberFormat.candidates,
        3,
      ),
    },
  };
  assert.doesNotThrow(() =>
    assertInputFormats([file, file], [mapping, mapping], scope),
  );
  const result = normalizeSource(file, mapping, scope, 'supplier');
  assert.equal(result.transactions[0].date, '2026-02-01');
  assert.equal(result.transactions[0].amount, 1234);

  const invalid = fixture([
    ['Date', 'Reference', 'Amount'],
    ['2026-02-30', 'INV-047', '100.00'],
  ]);
  const invalidMapping = inferMapping(invalid);
  assert.equal(
    suggestFormats(invalid, invalidMapping, 3).dateFormat.status,
    'invalid',
  );
  assert.equal(
    suggestFormats(invalid, invalidMapping, 3).numberFormat.status,
    'proven',
  );
  assert.throws(() =>
    assertInputFormats([file, invalid], [mapping, invalidMapping], scope),
  );
});

test('046 real worker entry rejects invalid formats for reconcile, compare and export before returning financial values', async () => {
  const bytes = syntheticPdf([
    [
      ['Date', 'Reference', 'Amount'],
      ['2026-07-01', 'INV-REFERENCE-00046', '100,50'],
      ['2026-07-02', 'INV-2', '1,234'],
    ],
  ]);
  const file = await readFile('synthetic-worker-comma.pdf', bytes, [22, 47]);
  const ledgerFile = await readSeparately(file, [22, 47]);
  const mapping = { ...inferMapping(file), pdfReviewed: true };
  const supplier = normalizeSource(file, mapping, scope, 'supplier');
  const ledger = normalizeSource(ledgerFile, mapping, scope, 'ledger');
  const partial = compare(supplier, ledger, scope);
  const messages: Record<string, unknown>[] = [];
  const worker: {
    onmessage?: (event: { data: unknown }) => Promise<void>;
    postMessage: (value: Record<string, unknown>) => void;
  } = {
    postMessage(value) {
      messages.push(value);
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', {
    value: worker,
    writable: true,
    configurable: true,
  });
  try {
    await import('../lib/reconciliation/worker.ts');
    assert.equal(typeof worker.onmessage, 'function');
    for (const [index, action] of [
      'reconcile',
      'compare',
      'export',
    ].entries()) {
      const payload =
        action === 'export'
          ? {
              files: [file, ledgerFile],
              result: partial,
              review: { checked: true, name: 'Synthetic reviewer', notes: '' },
            }
          : {
              files: [file, ledgerFile],
              mappings: [mapping, mapping],
              scope,
              decisions: [],
              rejected: [],
            };
      await worker.onmessage!({
        data: { channel: WORKER_CHANNEL, id: index + 1, action, payload },
      });
      assert.equal(messages.length, index + 1);
      assert.equal(messages[index].action, action);
      assert.equal(messages[index].ok, false);
      assert.match(String(messages[index].error), /تعذر التحقق من صيغة/);
      assert.equal(Object.hasOwn(messages[index], 'value'), false);
    }
    // Confirm that the real worker was invoked and the guard is selective.
    const valid = fixture([
      ['Date', 'Reference', 'Amount'],
      ['2026-07-01', 'INV-046', '1.234'],
    ]);
    valid.sheets[0].numericCells = { '2:3': { value: 1.234, format: '0.000' } };
    const validMapping = inferMapping(valid);
    await worker.onmessage!({
      data: {
        channel: WORKER_CHANNEL,
        id: 4,
        action: 'reconcile',
        payload: {
          files: [valid, separateSheets(valid)],
          mappings: [validMapping, validMapping],
          scope,
          decisions: [],
          rejected: [],
        },
      },
    });
    assert.equal(messages[3].ok, true);
    const value = messages[3].value as { result: ReturnType<typeof compare> };
    assert.equal(value.result.supplier.transactions[0].amount, 1234);
    assert.equal(value.result.matches.length, 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'self', previous);
    else Reflect.deleteProperty(globalThis, 'self');
  }
});
