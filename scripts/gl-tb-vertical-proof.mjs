// Independent frozen CSV/Decimal expectations are checked before product calls.
// This driver exercises the product; the Python checker never imports it.
import assert from 'node:assert/strict';
import { readFile as fsRead, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  GL_TB_VERSION,
  GL_TB_VERTICAL_FAMILY,
  BALANCE_FIELDS,
  reconcileGlTb,
} from '../lib/reconciliation/gl-tb.ts';
import {
  replayGlTb,
  saveGlTb,
  restoreGlTb,
  exportGlTb,
} from '../lib/reconciliation/gl-tb-io.ts';
const out = path.resolve(
  process.env.GL_TB_VERTICAL_REPORT_DIR || 'work/gl-tb-vertical-proof',
);
const frozen = path.resolve(
  process.env.GL_TB_VERTICAL_FIXTURE_DIR || 'tests/fixtures/gl-tb-vertical',
);
const python = process.env.PYTHON || 'python3';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ab = (bytes) => Uint8Array.from(bytes).buffer;
const independent = spawnSync(
  python,
  [
    '-B',
    'scripts/check-gl-tb-vertical-exports.py',
    out,
    '--prepare',
    '--fixtures',
    frozen,
  ],
  { encoding: 'utf8' },
);
assert.equal(independent.status, 0, independent.stdout + independent.stderr);
const expectations = JSON.parse(
  await fsRead(path.join(out, 'source-expectations.json'), 'utf8'),
);
const report = {
  syntheticOnly: true,
  expectedFromProduct: false,
  expectationsCheckedBeforeProduct: true,
  cases: [],
  horizontalControls: [],
  lifecycleRejections: [],
  passed: false,
};
const numeric = (value) =>
  value === null
    ? null
    : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]));
function reading(family, side) {
  return {
    sheet: 0,
    role: side ? 'trial-balance' : 'gl-detail',
    family,
    confirmed: true,
  };
}
function checkResult(result, item, format) {
  const { facts, oracle } = item;
  assert.equal(
    result.status,
    facts.requiredStatus,
    `${item.id}/${format}: status`,
  );
  assert.equal(result.version, GL_TB_VERSION);
  assert.deepEqual(result.scope, facts.scope);
  assert.equal(result.readings[1].family, GL_TB_VERTICAL_FAMILY);
  const hashes =
    format === 'csv'
      ? [facts.sourceSha256['gl.csv'], facts.sourceSha256['tb-vertical.csv']]
      : [item.nativeHashes.gl, item.nativeHashes.tb];
  assert.deepEqual(
    result.sources.map((s) => s.hash),
    hashes,
  );
  assert.deepEqual(
    result.sources.map((s) => s.sheet),
    [
      format === 'csv' ? 'CSV' : 'Native source',
      format === 'csv' ? 'CSV' : 'Native source',
    ],
  );
  const context = JSON.parse(result.context);
  assert.deepEqual(context[1], hashes);
  assert.deepEqual(context[2], [
    [0, 'gl-detail', GL_TB_VERSION, true],
    [0, 'trial-balance', GL_TB_VERTICAL_FAMILY, true],
  ]);
  for (const [side, key] of [
    [0, 'gl'],
    [1, 'tb'],
  ]) {
    assert.deepEqual(
      result.inventory.filter((i) => i.side === side).map((i) => i.values),
      facts.inventory[key],
      `${item.id}/${format}: inventory ${key}`,
    );
    for (const row of result.rows.filter((r) => r.side === side)) {
      assert.equal(row.id, `${side}:${hashes[side]}:0:${row.row}`);
      const originals = facts.inventory[key];
      for (const trace of row.trace) {
        assert.equal(trace.text, originals[row.row - 1][trace.column - 1]);
        assert.equal(trace.field, originals[0][trace.column - 1].trim());
      }
      if (side === 1) {
        const header = originals[0].map((v) => v.trim());
        assert.equal(
          row.record,
          originals[row.row - 1][header.indexOf('Snapshot ID')].trim(),
        );
        assert.equal(
          row.kind,
          originals[row.row - 1][header.indexOf('Balance role')].trim(),
        );
        assert.equal(row.date, '');
      }
    }
  }
  if (facts.financialExpectationsApplicable) {
    assert.deepEqual(numeric(result.gl), facts.glComponentsMinor);
    assert.deepEqual(numeric(result.tb), facts.tbAuthoredComponentsMinor);
    assert.deepEqual(
      numeric(result.differences),
      facts.componentDifferencesMinor,
    );
    assert.equal(String(result.glBridge), facts.glBridgeMinor);
    assert.equal(String(result.tbBridge), facts.tbBridgeMinor);
    for (const [side, key] of [
      [0, 'gl'],
      [1, 'tb'],
    ]) {
      for (const field of BALANCE_FIELDS) {
        const component = result.components.find(
          (c) => c.side === side && c.field === field,
        );
        assert.ok(component, `${item.id}: ${key}/${field} component`);
        const members = oracle[key].members[field];
        assert.deepEqual(
          component.cells,
          members.map((e) => ({
            id: `${side}:${hashes[side]}:0:${e.row}`,
            column: e.column,
          })),
          `${item.id}: ${key}/${field} actual cell origins`,
        );
        assert.equal(
          String(component.amount),
          String(oracle[key].amounts[field]),
        );
      }
    }
    assert.equal(
      result.components.filter((c) => c.side === 1).flatMap((c) => c.cells)
        .length,
      6,
    );
    assert.equal(
      new Set(result.rows.filter((r) => r.side === 1).map((r) => r.row)).size,
      3,
    );
  } else if (facts.requiredStatus === 'missing') {
    assert.equal(result.tb, null);
    assert.equal(result.tbBridge, null);
    assert.equal(result.differences, null);
    assert.deepEqual(
      result.missing,
      oracle.tb.missing.map((role) => 'tb-' + role),
    );
    assert.equal(result.components.filter((c) => c.side === 1).length, 0);
  } else if (facts.requiredStatus === 'source-error') {
    assert.ok(result.inventory.some((i) => i.kind === 'error'));
    assert.ok(oracle.errors.length > 0);
    const diagnosticMap = {
      DUPLICATE_ROLE: 'GL_TB_DUPLICATE',
      SNAPSHOT_CONFLICT: 'GL_TB_SNAPSHOT',
      ROW_SCOPE: 'GL_TB_ROW_SCOPE',
      ROLE: 'GL_TB_KIND',
      IDENTITY: 'GL_TB_IDENTITY',
    };
    for (const diagnostic of facts.requiredDiagnostics) {
      if (diagnosticMap[diagnostic])
        assert.ok(
          result.inventory.some((i) => i.error === diagnosticMap[diagnostic]),
          `${item.id}: ${diagnostic} diagnostic`,
        );
    }
    for (const error of oracle.errors.filter(
      (e) =>
        e.source === 'tb-vertical.csv' &&
        e.row > 1 &&
        facts.requiredDiagnostics.includes(e.code),
    ))
      assert.ok(
        result.inventory.some(
          (i) => i.side === 1 && i.row === error.row && i.kind === 'error',
        ),
        `${item.id}: independently invalid original row ${error.row}`,
      );
  }
}
try {
  for (const item of expectations.cases) {
    const { id, facts } = item;
    for (const format of ['csv', 'xlsx']) {
      const directory = path.join(out, id, format);
      await mkdir(directory, { recursive: true });
      const names =
        format === 'csv'
          ? ['gl.csv', 'tb-vertical.csv']
          : ['gl.xlsx', 'tb-vertical.xlsx'];
      const files = [];
      for (const [side, name] of names.entries()) {
        const original = await fsRead(
          format === 'csv'
            ? path.join(frozen, id, name)
            : path.join(out, id, 'native', name),
        );
        const expectedHash =
          format === 'csv'
            ? facts.sourceSha256[name]
            : item.nativeHashes[side ? 'tb' : 'gl'];
        assert.equal(sha(original), expectedHash);
        files.push(await readFile(name, ab(original)));
        assert.deepEqual(
          files[side].sheets[0].rows,
          facts.inventory[side ? 'tb' : 'gl'],
        );
      }
      const input = {
        files,
        readings: [
          reading(GL_TB_VERSION, 0),
          reading(GL_TB_VERTICAL_FAMILY, 1),
        ],
        scope: facts.scope,
      };
      const record = {
        id,
        format,
        status: facts.requiredStatus,
        passed: false,
        financialExpectationsApplicable: facts.financialExpectationsApplicable,
        authoredVectorUsedToFillMissing: false,
      };
      report.cases.push(record);
      if (facts.requiredStatus === 'refused') {
        assert.throws(() => reconcileGlTb(input), /GL_TB_COLUMNS/);
        await assert.rejects(replayGlTb(input), /GL_TB_COLUMNS/);
        await assert.rejects(saveGlTb(input), /GL_TB_COLUMNS/);
        record.readReplayAndSaveRefused = true;
        record.passed = true;
        continue;
      }
      const { state, result } = await replayGlTb(input);
      checkResult(result, item, format);
      await writeFile(
        path.join(directory, 'result.json'),
        JSON.stringify(result, null, 2) + '\n',
      );
      const session = await saveGlTb(state);
      await writeFile(
        path.join(directory, 'session.json'),
        Buffer.from(session),
      );
      const restored = await restoreGlTb(session);
      checkResult(restored.result, item, format);
      assert.deepEqual(restored.result, result);
      assert.deepEqual(restored.state.readings, state.readings);
      for (const side of [0, 1])
        assert.deepEqual(
          Buffer.from(restored.state.files[side].original),
          Buffer.from(state.files[side].original),
        );
      await writeFile(
        path.join(directory, 'direct.xlsx'),
        Buffer.from(await exportGlTb(state, result)),
      );
      await writeFile(
        path.join(directory, 'restored.xlsx'),
        Buffer.from(await exportGlTb(restored.state, restored.result)),
      );
      record.savedRestoredAndExported = true;
      record.passed = true;
      if (id === 'P01-two-sided-six-components') {
        const changedFamily = {
          ...state,
          readings: [
            state.readings[0],
            { ...state.readings[1], family: GL_TB_VERSION },
          ],
        };
        await assert.rejects(
          exportGlTb(changedFamily, result),
          /GL_TB_COLUMNS|GL_TB_STALE_RESULT/,
        );
        const changedRole = {
          ...state,
          readings: [
            state.readings[0],
            { ...state.readings[1], role: 'gl-detail' },
          ],
        };
        await assert.rejects(exportGlTb(changedRole, result), /GL_TB_READING/);
        const changedScope = {
          ...state,
          scope: {
            ...state.scope,
            dimensions: state.scope.dimensions + '|Changed=yes',
          },
        };
        await assert.rejects(
          exportGlTb(changedScope, result),
          /GL_TB_STALE_RESULT/,
        );
        const changedSheet = {
          ...state,
          readings: [state.readings[0], { ...state.readings[1], sheet: 1 }],
        };
        await assert.rejects(exportGlTb(changedSheet, result), /GL_TB_COLUMNS/);
        const cached = structuredClone(state);
        cached.files[1].sheets[0].rows[1][0] = 'Cache mutation';
        const reread = await replayGlTb(cached);
        assert.deepEqual(reread.result, result);
        const tampered = JSON.parse(Buffer.from(session).toString());
        tampered.files[1].sha256 = '0'.repeat(64);
        await assert.rejects(
          restoreGlTb(ab(Buffer.from(JSON.stringify(tampered)))),
          /GL_TB_SOURCE_HASH/,
        );
        const wrongSchema = JSON.parse(Buffer.from(session).toString());
        wrongSchema.readings[1].family = GL_TB_VERSION;
        await assert.rejects(
          restoreGlTb(ab(Buffer.from(JSON.stringify(wrongSchema)))),
          /GL_TB_COLUMNS/,
        );
        report.lifecycleRejections.push({
          format,
          family: true,
          role: true,
          sheet: true,
          scope: true,
          sourceHash: true,
          wrongSchemaSession: true,
          parsedCacheIgnored: true,
        });
      }
    }
    if (facts.sourceSha256['tb-horizontal-control.csv']) {
      const originals = await Promise.all(
        ['gl.csv', 'tb-horizontal-control.csv'].map((name) =>
          fsRead(path.join(frozen, id, name)),
        ),
      );
      const files = await Promise.all(
        originals.map((original, side) =>
          readFile(side ? 'tb-horizontal-control.csv' : 'gl.csv', ab(original)),
        ),
      );
      const input = {
        files,
        readings: [reading(GL_TB_VERSION, 0), reading(GL_TB_VERSION, 1)],
        scope: facts.scope,
      };
      const { state, result } = await replayGlTb(input);
      assert.equal(result.status, 'consistent');
      assert.deepEqual(numeric(result.gl), facts.glComponentsMinor);
      assert.deepEqual(numeric(result.tb), facts.tbAuthoredComponentsMinor);
      const saved = await saveGlTb(state);
      const restored = await restoreGlTb(saved);
      assert.deepEqual(restored.result, result);
      await exportGlTb(restored.state, restored.result);
      report.horizontalControls.push({
        id,
        status: result.status,
        oldFamilyPreserved: true,
        savedRestoredAndExported: true,
      });
    }
  }
  assert.equal(report.cases.length, 60);
  assert.equal(report.horizontalControls.length, 9);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
} finally {
  await writeFile(
    path.join(out, 'product-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      cycles: report.cases.length,
      passedCycles: report.cases.filter((c) => c.passed).length,
      horizontalControls: report.horizontalControls.length,
      lifecycleRejections: report.lifecycleRejections.length,
      error: report.error,
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
