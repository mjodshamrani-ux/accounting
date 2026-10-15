import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  readInventoryPdfRegister,
  STOCK_PDF_FAMILY,
} from '../lib/reconciliation/inventory-pdf-register.ts';
import { syntheticPdf } from './helpers/pdf-fixture.ts';

const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'tarasuf-pdf-fields-'));
const foundation = new URL(
  '../audit/inventory-pdf-foundation/',
  import.meta.url,
);
execFileSync(
  process.env.PYTHON ?? 'python3',
  [
    '-B',
    new URL('generate.py', foundation).pathname,
    '--output-dir',
    fixtureRoot,
    '--include-scope-controls',
  ],
  { timeout: 30000 },
);
test.after(async () => rm(fixtureRoot, { recursive: true, force: true }));
const contract = JSON.parse(
  await readFile(
    new URL(
      '../audit/inventory-pdf-local-fields/contract.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { interpreted: string[]; structuralErrors: Record<string, string> };
const manifest = JSON.parse(
  await readFile(new URL('INPUT-MANIFEST.v2.json', foundation), 'utf8'),
) as {
  files: { path: string; bytes: number; sha256: string }[];
};
for (const entry of manifest.files) {
  const b = await readFile(path.join(fixtureRoot, entry.path));
  assert.equal(b.length, entry.bytes);
  assert.equal(createHash('sha256').update(b).digest('hex'), entry.sha256);
}
async function original(code: string) {
  return Uint8Array.from(
    await readFile(path.join(fixtureRoot, 'INV1F-' + code, 'register.pdf')),
  ).buffer;
}
async function reading(code: string) {
  return readInventoryPdfRegister(await original(code));
}
const value = (
  r: Awaited<ReturnType<typeof reading>>,
  item: string,
  field:
    | 'Posted value'
    | 'Quantity'
    | 'Unit'
    | 'Quantity precision'
    | 'Valuation reference',
) => {
  const record = r.records.find(
    (e) => e.fields['Item ID']?.value.text === item,
  );
  assert.ok(record);
  return record.fields[field]!.value.text;
};
for (const code of [
  ...contract.interpreted,
  ...Object.keys(contract.structuralErrors),
]) {
  void test(
    'G2 explicit local roles and source inventory ' + code,
    async () => {
      const r = await reading(code);
      assert.equal(r.family, STOCK_PDF_FAMILY);
      assert.equal(r.financialApproval, false);
      assert.equal('totals' in r, false);
      assert.equal('matches' in r, false);
      assert.equal(
        r.status,
        contract.interpreted.includes(code) ? 'interpreted' : 'source-error',
      );
      if (r.status === 'interpreted') {
        assert.equal(r.records.length, 7);
        assert.deepEqual(r.issues, []);
        assert.equal(Object.keys(r.scope).length, 12);
        assert.equal(r.reportId, 'INV1F-OCT2026');
        assert.ok(r.reportTotal && r.reportEnd);
        assert.equal(r.reportTotal.value.text, '1285.750');
        assert.equal(r.pageControls.length, r.source.pages.length);
        assert.ok(r.inventory.every((e) => e.kind !== 'unresolved'));
        for (const record of r.records) {
          const expectedFields = record.parent ? 6 : 7;
          assert.equal(Object.keys(record.fields).length, expectedFields);
          assert.equal(record.documentScopeEvidence.length, 12);
          for (const [name, field] of Object.entries(record.fields)) {
            assert.equal(field!.role.text, name);
            assert.equal(field!.role.page, record.page);
            assert.equal(field!.value.page, record.page);
            assert.ok(field!.role.line < field!.value.line);
            assert.equal(field!.role.sourceHash, r.source.sha256);
            assert.equal(field!.value.sourceHash, r.source.sha256);
          }
          assert.equal(record.parent === null, code === 'P01');
          if (record.parent) {
            assert.ok(record.batch && record.sectionEnd);
            assert.equal(record.parent.value.page, record.page);
            assert.equal(record.batch.value.page, record.page);
            assert.ok(record.sectionEnd.line > record.line);
          }
        }
      } else {
        assert.equal(r.issues[0].code, contract.structuralErrors[code]);
        // A missing End report has no physical line to mark unresolved.
        if (code === 'N08')
          assert.ok(r.inventory.every((e) => e.kind !== 'unresolved'));
        else assert.ok(r.inventory.some((e) => e.kind === 'unresolved'));
        assert.ok(r.source.pages.length);
      }
      for (const p of r.source.pages) {
        const fromInventory = r.inventory
          .filter((e) => e.page === p.page)
          .flatMap((e) => e.items)
          .sort((a, b) => a - b);
        assert.deepEqual(
          fromInventory,
          p.tokens.map((t) => t.item).sort((a, b) => a - b),
        );
        assert.equal(new Set(fromInventory).size, fromInventory.length);
      }
    },
  );
}
void test('G2 per-page physical field order changes without transferring a role from page one', async () => {
  const r = await reading('P01');
  const first = r.records.find((x) => x.page === 1)!,
    second = r.records.find((x) => x.page === 2)!;
  assert.ok(
    first.fields['Posted value']!.role.box[0] >
      second.fields['Posted value']!.role.box[0],
  );
  assert.equal(value(r, '08', 'Posted value'), '189.875');
  assert.equal(value(r, '00008', 'Posted value'), '0.750');
  assert.equal(value(r, '00', 'Quantity'), '0');
  assert.equal(value(r, '00', 'Posted value'), '0.000');
  assert.equal(value(r, '0008', 'Quantity'), '1.250');
});
void test('G2 equal-total and equal-amount traps remain literal differences for G3', async () => {
  const swapped = await reading('N04');
  assert.equal(value(swapped, '0008', 'Posted value'), '189.875');
  assert.equal(value(swapped, '08', 'Posted value'), '410.125');
  const references = await reading('N05');
  assert.equal(value(references, '8', 'Valuation reference'), 'VAL-FE');
  assert.equal(value(references, '008', 'Valuation reference'), 'VAL-FD');
  assert.equal(value(await reading('N11'), '0008', 'Unit'), 'KG');
});
void test('G2 preserves wrong totals and unrepresentable precision without numeric repair', async () => {
  const badTotal = await reading('N09');
  assert.equal(badTotal.pageControls[1].total.value.text, '189.876');
  assert.equal(badTotal.status, 'interpreted'); // G3 must reject PAGE_TOTAL.
  const badPrecision = await reading('N12');
  assert.equal(value(badPrecision, '0008', 'Quantity precision'), '1');
  assert.equal(value(badPrecision, '0008', 'Quantity'), '1.250');
  assert.equal(badPrecision.status, 'interpreted'); // G3 must reject PRECISION.
});
void test('G2 continuation belongs only to the continued section and explicit local dimensions', async () => {
  const r = await reading('P03');
  const continued = r.records.find(
    (e) => e.fields['Item ID']?.value.text === '00',
  )!;
  const unrelated = r.records.find(
    (e) => e.fields['Item ID']?.value.text === '08',
  )!;
  assert.ok(continued.incomingContinuation);
  assert.equal(continued.parent!.value.text, 'NORTH');
  assert.equal(continued.batch!.value.text, 'LOT-X');
  assert.equal(unrelated.incomingContinuation, null);
  assert.equal(unrelated.batch!.value.text, 'LOT-Y');
  assert.ok(r.records[0].outgoingContinuation);
  assert.equal(continued.outgoingContinuation, null);
});
void test('G2 new warehouse clears batch/header; implicit section ends retain the next physical header', async () => {
  const r = await reading('P04');
  const north = r.records[0];
  assert.equal(north.sectionEnd!.text, 'Continues section');
  const pageTwo = r.records.filter((e) => e.page === 2);
  assert.equal(pageTwo[0].batch!.value.text, 'LOT-X');
  assert.equal(pageTwo[0].sectionEnd!.text, 'Warehouse');
  assert.equal(pageTwo[1].batch!.value.text, 'LOT-Y');
  assert.equal(pageTwo[1].sectionEnd!.text, 'Page total');
  assert.equal(pageTwo[0].scopeEvidence.length, 2);
  assert.equal(pageTwo[0].documentScopeEvidence.length, 12);
  assert.equal((await reading('N13')).issues[0].code, 'HEADER_DIMENSIONS');
});
void test('G2 missing money is retained as a source error, never replaced with zero', async () => {
  const r = await reading('N06');
  assert.equal(r.status, 'source-error');
  assert.equal(r.issues[0].page, 2);
  assert.ok(!r.records.some((e) => e.fields['Item ID']?.value.text === '00'));
  assert.ok(r.inventory.some((e) => e.page === 2 && e.kind === 'unresolved'));
});
void test('G2 original bytes cannot change during an async read; no fixture report ID hardcoding', async () => {
  const raw = await original('P04');
  const input = new TextDecoder()
    .decode(raw)
    .replaceAll('INV1F-OCT2026', 'OTHER-OCT2026');
  const altered = new TextEncoder().encode(input).buffer; // Same byte length/xref.
  const hash = createHash('sha256')
    .update(new Uint8Array(altered))
    .digest('hex');
  const pending = readInventoryPdfRegister(altered);
  new Uint8Array(altered).fill(0);
  const r = await pending.catch((e: unknown) => assert.fail(String(e)));
  assert.equal(r.status, 'interpreted');
  assert.equal(r.reportId, 'OTHER-OCT2026');
  assert.equal(r.source.sha256, hash);
});
void test('G2 display warnings block interpretation while every native item stays visible in inventory', async () => {
  const raw = syntheticPdf(
    [[['Item', '1', '0']]],
    10,
    'BT /F1 10 Tf 1 0 0 1 301 750 Tm (9.00) Tj ET',
  );
  const r = await readInventoryPdfRegister(raw);
  assert.equal(r.status, 'source-error');
  assert.equal(r.issues[0].code, 'SOURCE_DISPLAY');
  assert.ok(r.source.readingIssues.length);
  assert.ok(r.inventory.every((e) => e.kind === 'unresolved'));
});
void test('G2 item names that equal control labels remain data when every local field is present', async () => {
  const raw = new TextDecoder().decode(await original('P02'));
  const changed = raw
    .replaceAll('(0008) Tj', '(Page) Tj')
    .replaceAll('(00008) Tj', '(Batch) Tj');
  assert.notEqual(changed, raw);
  const r = await readInventoryPdfRegister(
    new TextEncoder().encode(changed).buffer,
  );
  assert.equal(r.status, 'interpreted', JSON.stringify(r.issues));
  const namedPage = r.records.filter(
    (e) => e.fields['Item ID']?.value.text === 'Page',
  );
  assert.equal(namedPage.length, 2);
  assert.equal(namedPage[0].fields['Posted value']!.value.text, '410.125');
  assert.equal(namedPage[1].fields['Posted value']!.value.text, '600.000');
  const namedBatch = r.records.find(
    (e) => e.fields['Item ID']?.value.text === 'Batch',
  )!;
  assert.ok(namedBatch);
  assert.equal(namedBatch.batch!.value.text, 'RETURN');
  assert.equal(namedBatch.fields['Posted value']!.value.text, '0.750');
});
void test('G2 fragmented identity gaps stay explicit uncertainty, never a proved whitespace normalization', async () => {
  const raw = new TextDecoder().decode(await original('P02'));
  const changed = raw.replaceAll('(0008) Tj', '(A  B) Tj');
  assert.notEqual(changed, raw);
  const r = await readInventoryPdfRegister(
    new TextEncoder().encode(changed).buffer,
  );
  assert.equal(r.status, 'interpreted');
  const code = r.records[0].fields['Item ID']!.value;
  assert.equal(code.text, 'A B'); // Display only; not the two-space source identity.
  assert.equal(code.textAssembly, 'gap-presentation');
  assert.ok(code.gaps.some((g) => g > 1e-7));
  assert.equal(r.financialApproval, false);
  const amount = r.records[0].fields['Posted value']!.value;
  assert.equal(amount.textAssembly, 'single-native-item');
  assert.deepEqual(amount.gaps, []);
});
