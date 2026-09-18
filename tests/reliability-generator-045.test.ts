import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  buildManifest,
  foundationManifest,
  CATEGORY_COUNTS,
  layoutFamilies,
  summarizeManifest,
} from '../audit/reliability/manifest.mjs';
import { generateCase } from '../audit/reliability/generator.mjs';
import { displayMinor, renderCase } from '../audit/reliability/renderers.mjs';

test('independent corpus manifest has 5000 cases in declared categories and disjoint layout holdout', () => {
  const manifest = buildManifest();
  assert.equal(manifest.length, 5000);
  assert.deepEqual(summarizeManifest(manifest).categories, CATEGORY_COUNTS);
  assert.equal(new Set(manifest.map((d) => d.id)).size, 5000);
  for (const d of manifest) {
    assert.equal(
      layoutFamilies[d.layoutFamilyA as keyof typeof layoutFamilies].split,
      d.split,
    );
    assert.equal(
      layoutFamilies[d.layoutFamilyB as keyof typeof layoutFamilies].split,
      d.split,
    );
  }
  assert.equal(foundationManifest().length, 40);
  assert.deepEqual(
    [...new Set(foundationManifest().map((d) => d.category))].sort(),
    ['ambiguous', 'clear', 'complex', 'invalid', 'reading'],
  );
});

test('all forty hand-calculated anchors independently agree with generated balances and explicit pairs', () => {
  for (const d of foundationManifest()) {
    const c = generateCase(d),
      a = c.oracle.manualAnchor!;
    assert.equal(
      c.oracle.balances.closingA,
      a.closingA,
      d.id + ' supplier closing',
    );
    assert.equal(
      c.oracle.balances.closingB,
      a.closingB,
      d.id + ' ledger closing',
    );
    assert.equal(
      c.oracle.balances.difference,
      a.closingA - a.closingB,
      d.id + ' difference',
    );
    if (c.oracle.outcome === 'compare')
      assert.equal(
        c.oracle.permittedAutoMatches.length,
        a.permittedPairs.length + a.permittedGroups.length,
        d.id + ' manually enumerated decisions',
      );
  }
});

test('truth and observable approval are separate for an unreferenced payment allocation', () => {
  const c = generateCase(foundationManifest()[30]);
  assert.equal(c.oracle.economicLinks.length, 1);
  assert.equal(c.oracle.economicLinks[0].aKeys.length, 1);
  assert.equal(c.oracle.economicLinks[0].bKeys.length, 2);
  assert.equal(c.oracle.permittedAutoMatches.length, 0);
  assert.equal(c.oracle.balances.difference, 0);
  assert.equal(c.oracle.expectedExceptions.length, 3);
});

test('equal balances do not hide countervailing invoice errors', () => {
  const c = generateCase(foundationManifest()[15]);
  assert.equal(c.oracle.balances.difference, 0);
  assert.equal(c.oracle.permittedAutoMatches.length, 0);
  assert.equal(c.oracle.expectedExceptions.length, 4);
});

test('cutoff exclusions are explicit and do not disappear from source observations', () => {
  const c = generateCase(foundationManifest()[21]);
  assert.equal(c.oracle.rows.length, 2);
  assert.equal(c.oracle.activeRows.length, 1);
  assert.deepEqual(c.oracle.expectedExclusions, [
    { key: 'supplier:1', reason: 'after-cutoff' },
  ]);
  assert.equal(c.oracle.balances.rawMovementA, 8000);
  assert.equal(c.oracle.balances.cutoffMovementA, 0);
});

test('integer minor formatting preserves zero and three decimals without production money helpers', () => {
  assert.equal(displayMinor(123456, 3), '123.456');
  assert.equal(displayMinor(-1, 3), '−0.001'.replace('−', '-'));
  assert.equal(displayMinor(123, 0), '123');
  assert.equal(displayMinor(-123456, 2, 'parenthesized-credits'), '(1234.56)');
  assert.equal(displayMinor(123456, 2, 'arabic-numerals'), '١٢٣٤٫٥٦');
  assert.equal(displayMinor(123456, 2, 'comma-decimals'), '1234,56');
  assert.throws(() => displayMinor(0.3, 2));
});

test('development scenarios are reproducible and contain economic diversity beyond labels and layout', () => {
  const development = buildManifest().filter((d) => d.split === 'development');
  const fingerprints = new Set<string>();
  for (const d of development) {
    const c = generateCase(d);
    assert.deepEqual(c, generateCase(d));
    assert.ok(
      !fingerprints.has(c.economicFingerprint),
      `Duplicate economic scenario ${d.id}`,
    );
    fingerprints.add(c.economicFingerprint);
    for (const row of c.oracle.rows) assert.ok(Number.isSafeInteger(row.minor));
    const used = new Set<string>();
    for (const match of c.oracle.permittedAutoMatches)
      for (const key of [...match.aKeys, ...match.bKeys]) {
        assert.ok(!used.has(key));
        used.add(key);
      }
  }
});

test('forty foundation source pairs are real files and never embed hidden lineage or oracle keys', async () => {
  let csv = 0,
    xlsx = 0,
    pdf = 0;
  for (const d of foundationManifest()) {
    const c = generateCase(d),
      rendered = await renderCase(c);
    assert.equal(rendered.files.length, 2);
    for (const file of rendered.files) {
      assert.ok(file.bytes.byteLength > 0);
      if (file.expectedRejection) continue;
      let text = '';
      if (file.format === 'xlsx') {
        xlsx++;
        const zip = await JSZip.loadAsync(file.bytes);
        for (const path of Object.keys(zip.files).filter((path) =>
          path.endsWith('.xml'),
        ))
          text += await zip.file(path)!.async('string');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(file.bytes as never);
        assert.ok(workbook.getWorksheet('Transactions'));
      } else {
        text = new TextDecoder().decode(file.bytes);
        if (file.format === 'pdf') {
          pdf++;
          assert.match(text, /^%PDF-1\.4/);
          assert.match(text, /%%EOF/);
        } else csv++;
      }
      for (const row of c.oracle.rows) {
        assert.ok(
          !text.includes(row.hiddenEventId),
          d.id + ' hidden economic identity',
        );
        assert.ok(!text.includes(row.key), d.id + ' row key');
      }
    }
  }
  assert.ok(csv > 0 && xlsx > 0 && pdf > 0);
});

test('generator, manifest and renderers cannot import production reconciliation code', async () => {
  for (const file of ['generator.mjs', 'manifest.mjs', 'renderers.mjs']) {
    const source = await fs.readFile(
      new URL('../audit/reliability/' + file, import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(source, /from\s+['"][^'"]*lib\/reconciliation/);
    assert.doesNotMatch(source, /import\s*\([^)]*lib\/reconciliation/);
  }
});

test('a wrong closing balance blocks balance verification without banning independently proved movement matches', () => {
  const d = buildManifest().find(
    (d) => d.split === 'development' && d.scenario === 'wrong-total',
  )!;
  const c = generateCase(d);
  assert.equal(c.oracle.expectedBalanceValidationFailure, true);
  assert.equal(c.oracle.balances.comparable, false);
  assert.equal(c.oracle.requiresScopeStop, false);
  assert.equal(
    c.oracle.balances.closingA! - c.oracle.balances.computedClosingA,
    137,
  );
  assert.equal(c.oracle.permittedAutoMatches.length, c.sources[0].rows.length);
});

test('invalid source values affect their rows while scope conflicts stop the affected comparison', () => {
  const manifest = buildManifest();
  const c = generateCase(
    manifest.find(
      (d) => d.split === 'development' && d.scenario === 'invalid-amount',
    )!,
  );
  assert.deepEqual(c.oracle.unreadableKeys, ['supplier:1']);
  assert.equal(c.oracle.requiresScopeStop, false);
  assert.ok(
    c.oracle.permittedAutoMatches.every((m) => !m.aKeys.includes('supplier:1')),
  );
  assert.ok(c.oracle.permittedAutoMatches.length > 0);
  const scoped = generateCase(
    manifest.find(
      (d) => d.split === 'development' && d.scenario === 'cross-currency',
    )!,
  );
  assert.equal(scoped.oracle.requiresScopeStop, true);
  assert.equal(scoped.oracle.permittedAutoMatches.length, 0);
});

test('numeric invoice identity is explicit while an equally long generic reference needs review', () => {
  const verified = generateCase(foundationManifest()[5]);
  assert.equal(verified.sources[0].metadata.referenceHeader, 'Invoice No');
  assert.equal(verified.sources[1].metadata.referenceHeader, 'Invoice No');
  assert.equal(verified.oracle.permittedAutoMatches.length, 1);
  const generic = generateCase(
    buildManifest().find(
      (d) =>
        d.split === 'development' && d.scenario === 'numeric-generic-reference',
    )!,
  );
  assert.equal(generic.sources[0].metadata.referenceHeader, 'Reference');
  assert.ok(
    generic.oracle.permittedAutoMatches.every(
      (m) => !m.aKeys.includes('supplier:1'),
    ),
  );
});

test('file-specific scenarios really contain their named structures', async () => {
  const manifest = buildManifest();
  const formula = await renderCase(
    generateCase(
      manifest.find(
        (d) =>
          d.split === 'development' && d.scenario === 'formula-without-cache',
      )!,
    ),
  );
  assert.equal(formula.files[0].format, 'xlsx');
  const zip = await JSZip.loadAsync(formula.files[0].bytes);
  const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  assert.match(sheet, /<f>SUM\(1,2\)<\/f>/);
  assert.doesNotMatch(sheet, /<f>SUM\(1,2\)<\/f><v>[^<]+<\/v>/);
  const multi = await renderCase(
    generateCase(
      manifest.find(
        (d) => d.split === 'development' && d.scenario === 'multi-page',
      )!,
    ),
  );
  assert.equal(multi.files[0].format, 'pdf');
  assert.ok((multi.files[0].pages ?? 0) > 1);
  assert.ok(
    multi.files[0].expectedRows.some((row: { page: number }) => row.page > 1),
  );
  const open = await renderCase(generateCase(foundationManifest()[20]));
  assert.equal(open.case.sources[1].metadata.periodEvidence, null);
  assert.equal(open.case.sources[1].metadata.opening, null);
});

test('revision 1.0.1 keeps allocation lineage shared while physical row identities remain distinct', () => {
  for (const index of [18, 19]) {
    const c = generateCase(foundationManifest()[index]);
    assert.equal(c.oracle.economicLinks.length, 1);
    const group = c.oracle.economicLinks[0];
    assert.equal(group.aKeys.length, 2);
    assert.equal(group.bKeys.length, index === 18 ? 1 : 2);
    const keys = [...group.aKeys, ...group.bKeys];
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(c.oracle.permittedAutoMatches.length, 0);
    if (index === 18)
      assert.equal(c.oracle.groupAssessments[0].classification, 'review');
  }
});

test('ambiguous decimal case exposes two defensible interpretations and requires format confirmation before normalization', async () => {
  const d = buildManifest().find(
    (d) => d.split === 'development' && d.scenario === 'ambiguous-number',
  )!;
  const c = generateCase(d),
    rendered = await renderCase(c);
  assert.equal(c.sources[0].metadata.currency, 'KWD');
  assert.equal(c.sources[0].metadata.decimals, 3);
  assert.equal(c.sources[0].metadata.numberFormat, null);
  assert.deepEqual(c.oracle.requiresFormatReview, ['supplier']);
  assert.equal(c.oracle.outcome, 'review');
  assert.equal(c.oracle.permittedAutoMatches.length, 0);
  assert.equal(c.oracle.unreadableKeys.length, 0);
  const minor = c.sources[0].rows[0].minor,
    shown = displayMinor(minor, 3, 'comma-decimals');
  assert.match(shown, /^\d{1,3},\d{3}$/);
  assert.equal(
    Number(shown.replace(',', '')) * 1000,
    minor * 1000,
    'thousands interpretation differs from decimal interpretation by 1000',
  );
  assert.ok(rendered.files[0].bytes.byteLength > 0);
});

test('PDF monetary banners use the same decimal convention as transaction cells', async () => {
  const d = buildManifest().find(
    (d) =>
      d.split === 'development' &&
      d.scenario === 'comma-decimals' &&
      (layoutFamilies[d.layoutFamilyA as keyof typeof layoutFamilies].format ===
        'pdf' ||
        layoutFamilies[d.layoutFamilyB as keyof typeof layoutFamilies]
          .format === 'pdf'),
  )!;
  const c = generateCase(d),
    rendered = await renderCase(c),
    i = rendered.files.findIndex((f) => f.format === 'pdf');
  const source = c.sources[i],
    text = new TextDecoder().decode(rendered.files[i].bytes);
  const expected = displayMinor(
    source.metadata.closing!,
    source.metadata.decimals,
    'comma-decimals',
  );
  assert.ok(text.includes(`Closing balance: ${expected}`));
});
