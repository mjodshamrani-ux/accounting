import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSource, compare } from '../lib/reconciliation/core.ts';
import { exportWorkbook } from '../lib/reconciliation/io.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import {
  demoFiles,
  demoMappings,
  demoScope,
} from '../lib/reconciliation/demo.ts';
import type { SourceFile } from '../lib/reconciliation/types.ts';
import type { SessionState } from '../lib/reconciliation/session.ts';

const scope = { ...demoScope, confirmed: true, coverageConfirmed: true };
const files = (): [SourceFile, SourceFile] => structuredClone(demoFiles);
const run = () =>
  compare(
    normalizeSource(demoFiles[0], demoMappings[0], scope, 'supplier'),
    normalizeSource(demoFiles[1], demoMappings[1], scope, 'ledger'),
    scope,
  );
const state = (): SessionState => ({
  files: files(),
  mappings: structuredClone(demoMappings),
  scope: { ...scope },
  decisions: [],
  rejected: [],
  events: [],
  review: { name: '', notes: '', checked: false },
});
const forbidden = /المسودة البصرية غير متحققة/;

void test('visual drafts cannot normalize even with plausible fabricated accounting sheets and approval flags', () => {
  const draft = {
    ...structuredClone(demoFiles[0]),
    kind: 'visual-draft',
    status: 'verified',
    approved: true,
  };
  assert.throws(
    () => normalizeSource(draft, demoMappings[0], scope, 'supplier'),
    forbidden,
  );
  assert.throws(
    () =>
      normalizeSource(
        { kind: 'visual-draft' } as unknown as SourceFile,
        demoMappings[0],
        scope,
        'supplier',
      ),
    forbidden,
  );
  assert.equal(
    normalizeSource(demoFiles[0], demoMappings[0], scope, 'supplier').errors
      .length,
    0,
  );
});

void test('workpaper export rejects a visual draft before original reread or no-original fallback on either side', async () => {
  const result = run();
  for (const side of [0, 1])
    for (const withOriginal of [false, true]) {
      const sourceFiles = files();
      sourceFiles[side] = {
        ...sourceFiles[side],
        kind: 'visual-draft',
        ...(withOriginal
          ? { original: new TextEncoder().encode('NOT AN ORIGINAL').buffer }
          : {}),
      } as SourceFile;
      await assert.rejects(
        exportWorkbook(result, sourceFiles, {
          checked: false,
          name: '',
          notes: '',
        }),
        forbidden,
      );
    }
  assert.ok(
    (
      await exportWorkbook(result, files(), {
        checked: false,
        name: '',
        notes: '',
      })
    ).byteLength > 0,
  );
});

void test('session save rejects visual drafts instead of laundering their sheets through demoBytes', async () => {
  for (const side of [0, 1]) {
    const input = state();
    input.files[side] = {
      ...input.files[side],
      kind: 'visual-draft',
    } as SourceFile;
    assert.equal(input.files[side].original, undefined);
    await assert.rejects(saveSession(input), forbidden);
  }
  const saved = await saveSession(state());
  assert.equal(
    (await restoreSession(saved)).result.matches.length,
    run().matches.length,
  );
});

void test('session restore does not discard a visual-draft marker and treat accompanying CSV bytes as native', async () => {
  const saved = await saveSession(state());
  const json = JSON.parse(new TextDecoder().decode(saved));
  for (const side of [0, 1]) {
    const modified = structuredClone(json);
    modified.files[side].kind = 'visual-draft';
    modified.files[side].status = 'verified';
    modified.files[side].reviewed = true;
    await assert.rejects(
      restoreSession(new TextEncoder().encode(JSON.stringify(modified)).buffer),
      forbidden,
    );
  }
});
