import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import { readArFile } from '../lib/reconciliation/ar-source.ts';
import {
  reconcileAr,
  suggestArScopeReading,
  isArScopeReading,
  type ArInput,
  type ArReading,
} from '../lib/reconciliation/ar.ts';

const fixtures = new URL(
  '../audit/ar-scope-details/fixtures/',
  import.meta.url,
);
export async function scopeDetailsFixture(
  name = 'one-invoice-open-differs',
  fixtureRoot = fixtures,
): Promise<ArInput> {
  const root = new URL(`${name}/`, fixtureRoot);
  const bundle = JSON.parse(await fsRead(new URL('bundle.json', root), 'utf8'));
  const files = await Promise.all(
    bundle.files.map(async (name: string, side: number) =>
      readArFile(
        name,
        new Uint8Array(await fsRead(new URL(name, root))).buffer,
        bundle.families[side] === 'ar-scope-details-1'
          ? ({
              family: 'ar-scope-details-1',
              sheet: bundle.sheets[side],
            } as ArReading)
          : undefined,
      ),
    ),
  );
  const readings = files.map((file, index) => {
    const side = index as 0 | 1;
    if (bundle.families[side] === 'ar-scope-details-1') {
      const reading = suggestArScopeReading(file, side, bundle.sheets[side]);
      reading.confirmed = bundle.readingConfirmed[side];
      if (bundle.selectedAmountHeaders)
        reading.amount = file.sheets[reading.sheet].rows[
          reading.header
        ].indexOf(bundle.selectedAmountHeaders[side]);
      return reading;
    }
    return {
      sheet: bundle.sheets[side],
      header: 0,
      posting: 0,
      kind: 1,
      document: 2,
      date: 3,
      amount: 4,
      entity: 5,
      ledger: 6,
      customer: 7,
      account: 8,
      currency: 9,
      related: 10,
      description: 11,
      role:
        side === 0 ? 'company-ar-ledger' : 'company-issued-customer-statement',
      perspective: 'seller-receivable',
      basis: 'original-movement',
      confirmed: bundle.readingConfirmed[side],
    } as ArReading;
  });
  return {
    files: files as ArInput['files'],
    readings: readings as ArInput['readings'],
    scope: bundle.scope,
    events: [],
  };
}
// These literal truths were sealed before product implementation, independently
// of the oracle. No oracle output is used as an expected product result.
void test('AR scope-details sealed 75 raw CSV/native bundles match independent manual financial truths', async (t) => {
  const truths = JSON.parse(
    await fsRead(new URL('TRUTHS.json', fixtures), 'utf8'),
  );
  assert.equal(Object.keys(truths).length, 75);
  for (const [name, entry] of Object.entries(truths))
    await t.test(name, async () => {
      const input = await scopeDetailsFixture(name),
        result = reconcileAr(input);
      const expected = (
        entry as {
          expected: {
            status: string;
            matchedPairCount: number;
            totalsMinor?: number[];
            validRowCounts?: number[];
            requiredReasons?: string[];
            requiredIssueCategories?: string[];
          };
        }
      ).expected;
      assert.equal(result.version, 'ar-scope-details-1');
      assert.equal(result.status, expected.status);
      assert.equal(
        result.cases.filter((c) => c.status === 'matched').length,
        expected.matchedPairCount,
      );
      assert.deepEqual(result.receiptAllocations, []);
      assert.equal(result.financialCompletenessAsserted, false);
      if (expected.totalsMinor)
        assert.deepEqual(result.totals, expected.totalsMinor);
      if (expected.validRowCounts)
        assert.deepEqual(
          [0, 1].map(
            (side) => result.rows.filter((r) => r.side === side).length,
          ),
          expected.validRowCounts,
        );
      for (const reason of expected.requiredReasons ?? [])
        assert.ok(
          result.cases.some((c) => c.reason === reason),
          reason,
        );
      for (const category of expected.requiredIssueCategories ?? [])
        assert.ok(
          result.sourceIssues!.some((issue) => issue.category === category),
          category,
        );
      assert.equal(
        new Set(result.cases.flatMap((c) => c.ids)).size,
        result.rows.length,
      );
      assert.equal(
        result.cases.reduce((n, c) => n + c.ids.length, 0),
        result.rows.length,
      );
      for (const side of [0, 1] as const)
        assert.deepEqual(
          result.inventory.filter((i) => i.side === side).map((i) => i.values),
          input.files[side].sheets[input.readings[side].sheet].rows,
        );
      assert.equal(
        new Set(result.inventory.map((i) => i.inventoryId)).size,
        result.inventory.length,
      );
      if (result.status === 'source-error') {
        assert.ok(result.sourceIssues!.length > 0);
        assert.ok(result.errorInventoryRefs!.length > 0);
        assert.equal(
          result.cases.filter((c) => c.status === 'matched').length,
          0,
        );
      }
    });
});
void test('AR provenance points to actual parent/header/raw original and open cells without repeated scope rows', async () => {
  const input = await scopeDetailsFixture('blanks-and-multiline-description'),
    result = reconcileAr(input);
  for (const row of result.rows) {
    const reading = input.readings[row.side];
    assert.ok(isArScopeReading(reading));
    const sheet = input.files[row.side].sheets[reading.sheet];
    assert.equal(row.originalRaw, sheet.rows[row.row - 1][reading.amount]);
    assert.equal(row.openBalanceRaw, sheet.rows[row.row - 1][reading.open]);
    assert.equal(row.openBalanceRole, 'descriptive-unverified');
    assert.equal(row.parentCell, `${row.row}:${reading.parent + 1}`);
    assert.equal(row.parentScopeId, sheet.rows[row.row - 1][reading.parent]);
    assert.ok(row.id.endsWith(`:${row.row}`));
    for (const [field, cell] of Object.entries(row.inheritedSourceCells!)) {
      assert.equal(cell.hash, input.files[row.side].sha256);
      assert.equal(cell.sheet, reading.sheet);
      assert.equal(cell.raw, sheet.rows[cell.row - 1][cell.column - 1]);
      assert.equal(cell.detailRow, row.row);
      assert.equal(cell.parentCell, row.parentCell);
      assert.equal(cell.parentScopeId, row.parentScopeId);
      assert.equal(sheet.rows[cell.row - 1][0].toLowerCase(), field);
    }
    const item = result.inventory.find(
      (i) => i.side === row.side && i.row === row.row,
    )!;
    assert.ok(item.lineSpan![1] >= item.lineSpan![0]);
  }
  assert.ok(
    result.inventory.some(
      (item) => item.lineSpan && item.lineSpan[1] > item.lineSpan[0],
    ),
  );
});
void test('AR structural failure preserves every row and makes affected totals unavailable', async () => {
  for (const name of [
    'missing-end-marker',
    'second-scope-header',
    'detail-after-end',
    'map-open-as-original',
  ]) {
    const input = await scopeDetailsFixture(name),
      result = reconcileAr(input);
    assert.equal(result.totals[0], null, name);
    assert.equal(
      result.rows.some((row) => row.side === 0),
      false,
    );
    assert.equal(result.status, 'source-error');
  }
  const input = await scopeDetailsFixture('aggregate-over-bound'),
    result = reconcileAr(input);
  assert.equal(result.totals[0], null);
  assert.equal(
    result.cases.some((c) => c.status === 'matched'),
    false,
  );
});
void test('AR source defects cannot gain financial membership or be bypassed through human acceptance', async () => {
  const input = await scopeDetailsFixture('late-invalid-competitor'),
    result = reconcileAr(input);
  assert.equal(result.rows.filter((row) => row.side === 0).length, 1);
  assert.ok(result.inventory.some((item) => item.kind === 'error'));
  input.events.push({
    context: result.context,
    at: '2026-10-11T00:00:00.000Z',
    action: 'accept',
    ids: result.cases[0].ids,
    note: 'Manually reviewed correspondence',
  });
  assert.throws(() => reconcileAr(input), /AR_DECISION/);
});
void test('AR new-family confirmations reject truthy/nontext external scope values with preserved errors', async () => {
  for (const value of ['true', 1, {}, false]) {
    const input = await scopeDetailsFixture();
    input.scope.confirmed = value as never;
    assert.equal(reconcileAr(input).status, 'source-error');
    const other = await scopeDetailsFixture();
    other.readings[0].confirmed = value as never;
    assert.equal(reconcileAr(other).status, 'source-error');
  }
  for (const value of [0, {}, null]) {
    const input = await scopeDetailsFixture();
    input.scope.customer = value as never;
    assert.equal(reconcileAr(input).status, 'source-error');
  }
});
void test('AR scope-detail discovery is unconfirmed and corrupted headers remain reviewable', async () => {
  const input = await scopeDetailsFixture('missing-original-header');
  const reading = suggestArScopeReading(input.files[0], 0);
  assert.equal(reading.confirmed, false);
  reading.confirmed = true;
  input.readings[0] = reading;
  assert.equal(reconcileAr(input).status, 'source-error');
});
void test('AR detail limit is inclusive and counts rejected nonblank records before financial membership', async () => {
  const input = await scopeDetailsFixture();
  for (const side of [0, 1] as const) {
    const reading = input.readings[side];
    assert.ok(isArScopeReading(reading));
    const source = input.files[side].sheets[0].rows;
    const detail = source[reading.header + 1];
    input.files[side].sheets[0].rows = [
      ...source.slice(0, reading.header + 1),
      ...Array.from({ length: 20000 }, (_, index) => {
        const row = [...detail];
        row[reading.posting] = `${side}:P:${index}`;
        row[reading.document] = `I:${index}`;
        return row;
      }),
      source[source.length - 1],
    ];
  }
  const result = reconcileAr(input);
  assert.equal(result.rows.length, 40000);
  assert.equal(
    result.cases.filter((c) => c.status === 'matched').length,
    20000,
  );
  assert.deepEqual(result.totals, [200000000, 200000000]);
  const source = input.files[0].sheets[0].rows;
  const lateInvalid = [...source[source.length - 2]];
  lateInvalid[5] = '';
  source.splice(source.length - 1, 0, lateInvalid);
  const rejected = reconcileAr(input);
  assert.equal(rejected.status, 'source-error');
  assert.equal(rejected.totals[0], null);
  assert.ok(
    rejected.sourceIssues!.some((issue) => issue.code === 'AR_DETAIL_LIMIT'),
  );
  assert.equal(
    rejected.cases.some((c) => c.status === 'matched'),
    false,
  );
});
void test('AR native numeric date and hidden display notes cannot authorize textual dates or blank rows', async () => {
  const input = await scopeDetailsFixture();
  const reading = input.readings[0];
  assert.ok(isArScopeReading(reading));
  const sheet = input.files[0].sheets[0];
  sheet.numericCells = {
    [`${reading.header + 2}:${reading.date + 1}`]: {
      value: 46297,
      format: 'yyyy-mm-dd',
    },
  };
  assert.equal(reconcileAr(input).status, 'source-error');
  delete sheet.numericCells;
  sheet.cellNotes = {
    [`${reading.header + 2}:${reading.open + 1}`]: [
      'XLSX_NATIVE_DISPLAY: zero-height source row',
    ],
  };
  const result = reconcileAr(input);
  assert.equal(result.status, 'source-error');
  assert.equal(
    result.rows.some((row) => row.side === 0),
    false,
  );
});

void test('AR rejects all three sealed native concealment controls while preserving original inventory', async () => {
  const controls = new URL(
    '../audit/ar-scope-details/native-controls/',
    import.meta.url,
  );
  for (const name of [
    'hidden-text-format',
    'zero-width-column',
    'zero-height-row',
  ]) {
    const input = await scopeDetailsFixture(name, controls),
      result = reconcileAr(input);
    assert.equal(result.status, 'source-error', name);
    assert.equal(
      result.cases.some((c) => c.status === 'matched'),
      false,
    );
    for (const side of [0, 1] as const)
      assert.deepEqual(
        result.inventory
          .filter((item) => item.side === side)
          .map((item) => item.values),
        input.files[side].sheets[0].rows,
      );
    assert.ok(result.errorInventoryRefs!.length > 0);
  }
});
