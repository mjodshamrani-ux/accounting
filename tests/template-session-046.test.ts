import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mappingTemplate,
  readMappingTemplate,
  templatePatch,
  migrateMappingTemplates,
} from '../lib/reconciliation/mapping-template.ts';
import { defaultMapping, ENGINE_VERSION } from '../lib/reconciliation/types.ts';
import {
  demoFiles,
  demoMappings,
  demoScope,
} from '../lib/reconciliation/demo.ts';
import { restoreSession, saveSession } from '../lib/reconciliation/session.ts';
import { normalizeSource, compare } from '../lib/reconciliation/core.ts';
import { exportWorkbook } from '../lib/reconciliation/io.ts';

test('legacy templates lose source facts, sign conventions and format assumptions when migrated', () => {
  const old = {
    ...demoMappings[0],
    multiplier: -1,
    numberFormat: 'comma',
    dateFormat: 'mdy',
    reportType: 'open-items',
    pdfReviewed: true,
    excluded: { '2': 'financial note' },
    directionEvidence: {
      multiplier: -1,
      balanceColumn: 7,
      checkedRows: 500,
      reason: 'private source',
    },
    account: 'OLD',
    currency: 'USD',
  };
  const store = new Map([['mizan.mapping.0.v1', JSON.stringify(old)]]);
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  migrateMappingTemplates(storage);
  const text = store.get('mizan.mapping.0.v1')!;
  assert.equal(
    /financial note|private source|OLD|USD|multiplier|numberFormat|dateFormat|reportType|Evidence|opening|closing/.test(
      text,
    ),
    false,
  );
  const saved = readMappingTemplate(text)!;
  assert.equal(saved.version, 2);
  assert.equal(saved.columns.amount, 3);
  const current = {
    ...defaultMapping(),
    multiplier: 1 as const,
    numberFormat: 'dot' as const,
    dateFormat: 'dmy' as const,
    reportType: 'transactions' as const,
  };
  const restored = { ...current, ...templatePatch(saved) };
  assert.equal(restored.multiplier, 1);
  assert.equal(restored.numberFormat, 'dot');
  assert.equal(restored.dateFormat, 'dmy');
  assert.equal(restored.reportType, 'transactions');
  assert.equal(restored.pdfReviewed, false);
  assert.deepEqual(restored.excluded, {});
  migrateMappingTemplates(storage);
  assert.equal(
    store.get('mizan.mapping.0.v1'),
    text,
    'migration is idempotent',
  );
});

test('templates never recover financial values or proof even through forged v2 fields', () => {
  const safe = mappingTemplate(demoMappings[0])!;
  const forged = {
    ...safe,
    columns: {
      ...safe.columns,
      multiplier: -1,
      directionEvidence: { checkedRows: 10 },
      opening: '500',
    },
    scope: { currency: 'USD' },
  };
  const patch = templatePatch(forged);
  assert.equal(Object.hasOwn(patch, 'multiplier'), false);
  assert.equal(patch.directionEvidence, undefined);
  assert.equal(patch.opening, '');
  assert.equal(readMappingTemplate('{'), null);
  assert.equal(mappingTemplate({ ...demoMappings[0], date: 100 }), null);
  assert.equal(mappingTemplate({ ...safe, version: 3 }), null);
  assert.equal(mappingTemplate({ ...safe, format: 'unknown' }), null);
  assert.equal(mappingTemplate({ ...demoMappings[0], sheet: -1 }), null);
});

test('old-engine sessions cannot bypass reprocessing by carrying old approvals', async () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      format: 'mizan-session',
      version: 1,
      engine: ENGINE_VERSION + '-old',
      review: { checked: true },
    }),
  ).buffer;
  await assert.rejects(restoreSession(bytes), /غير متوافق/);
});

test('current sessions re-read originals and recompute; forged source and stale export cannot survive', async () => {
  const scope = { ...demoScope, confirmed: true };
  const bytes = await saveSession({
    files: structuredClone(demoFiles),
    mappings: structuredClone(demoMappings),
    scope,
    decisions: [],
    rejected: [],
    events: [],
    review: { checked: true, name: 'Synthetic reviewer', notes: '' },
  });
  const restored = await restoreSession(bytes);
  assert.equal(restored.review.checked, false);
  assert.deepEqual(
    restored.result,
    compare(
      normalizeSource(
        restored.files[0],
        restored.mappings[0],
        scope,
        'supplier',
      ),
      normalizeSource(restored.files[1], restored.mappings[1], scope, 'ledger'),
      scope,
    ),
  );
  const forged = JSON.parse(new TextDecoder().decode(bytes));
  forged.files[0].sha256 = 'a'.repeat(64);
  await assert.rejects(
    restoreSession(new TextEncoder().encode(JSON.stringify(forged)).buffer),
    /بصمة/,
  );
  const stale = structuredClone(restored.result);
  stale.scope.cutoff = '2026-08-10';
  await assert.rejects(
    exportWorkbook(stale, restored.files, {
      checked: false,
      name: '',
      notes: '',
    }),
    /إعادة الحساب/,
  );
});
