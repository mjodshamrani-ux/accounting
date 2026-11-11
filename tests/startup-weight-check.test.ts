// Self-test of the UX-9 startup weight gate on small synthetic builds: a clean
// build passes, and each planted fault fails for its own requirement.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BUDGET_GZIP,
  REQUIREMENTS,
  WORKSPACES,
  checkStartupWeight,
  startupFiles,
} from '../scripts/startup-weight-check.mjs';

const INLINE =
  'new Worker(`data:text/javascript;charset=utf-8,`+encodeURIComponent(t))';

async function build(
  files: Record<string, string | Buffer>,
  preload: string[] = [],
) {
  const dist = await mkdtemp(path.join(tmpdir(), 'startup-weight-'));
  await mkdir(path.join(dist, 'assets'));
  const links = preload
    .map((p) => `<link rel="modulepreload" crossorigin href="./assets/${p}">`)
    .join('');
  await writeFile(
    path.join(dist, 'index.html'),
    `<script type="module" crossorigin src="./assets/index-A.js"></script>${links}`,
  );
  const all: Record<string, string | Buffer> = {
    'index-A.js':
      'import{a as b}from"./core-B.js";import"./side-C.js";export{z}from"./re-D.js";import*as q from"./ns-E.js";' +
      'const w=()=>import("./worker-engine-F.js");',
    'core-B.js': 'export const a=1;',
    'side-C.js': 'console.log(1);',
    're-D.js': 'export const z=2;',
    'ns-E.js': 'export const n=3;',
    'worker-engine-F.js': `export default ()=>${INLINE};`,
    ...Object.fromEntries(
      WORKSPACES.map((w) => [`${w}-W.js`, 'export const x=1;']),
    ),
    ...files,
  };
  for (const [name, body] of Object.entries(all))
    await writeFile(path.join(dist, 'assets', name), body);
  return dist;
}

void test('a clean build passes every requirement, behind dynamic import nothing is counted', async () => {
  const dist = await build({});
  const result = await checkStartupWeight(dist, REQUIREMENTS);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.files, [
    'assets/core-B.js',
    'assets/index-A.js',
    'assets/ns-E.js',
    'assets/re-D.js',
    'assets/side-C.js',
  ]);
});

void test('every minified static import form is followed', async () => {
  const files = await startupFiles(await build({}));
  for (const f of ['core-B', 'side-C', 're-D', 'ns-E'])
    assert.ok(files.includes(`assets/${f}.js`), f);
  assert.ok(!files.includes('assets/worker-engine-F.js'));
});

void test('the engine text at startup fails engine', async () => {
  const dist = await build({ 'side-C.js': `const t='';${INLINE};` });
  const result = await checkStartupWeight(dist, ['engine']);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /^engine: assets\/side-C\.js/);
});

void test('a workspace imported at startup fails workspaces', async () => {
  const dist = await build({
    'core-B.js': 'import"./bank-workspace-W.js";export const a=1;',
  });
  const result = await checkStartupWeight(dist, ['workspaces']);
  assert.deepEqual(result.failures, [
    'workspaces: bank-workspace-W.js is loaded at startup',
  ]);
});

void test('a workspace with no chunk of its own fails workspaces', async () => {
  const dist = await build({});
  const { rm } = await import('node:fs/promises');
  await rm(path.join(dist, 'assets', 'payroll-workspace-W.js'));
  const result = await checkStartupWeight(dist, ['workspaces']);
  assert.deepEqual(result.failures, [
    'workspaces: payroll-workspace has no chunk of its own',
  ]);
});

void test('ExcelJS or JSZip preloaded fails libraries', async () => {
  const dist = await build(
    {
      'exceljs.min-X1.js': 'export default 1;',
      'jszip.min-X2.js': 'export default 2;',
    },
    ['exceljs.min-X1.js', 'jszip.min-X2.js'],
  );
  const result = await checkStartupWeight(dist, ['libraries']);
  assert.deepEqual(result.failures, [
    'libraries: assets/exceljs.min-X1.js is loaded at startup',
    'libraries: assets/jszip.min-X2.js is loaded at startup',
  ]);
});

void test('startup scripts over the budget fail budget, and only budget', async () => {
  const noise = randomBytes(BUDGET_GZIP + 10_000).toString('base64');
  const dist = await build({ 'side-C.js': `const s="${noise}";` });
  const all = await checkStartupWeight(dist, REQUIREMENTS);
  assert.equal(all.failures.length, 1);
  assert.match(
    all.failures[0],
    /^budget: startup scripts are \d+ bytes with gzip, over 650000$/,
  );
  assert.deepEqual((await checkStartupWeight(dist, ['engine'])).failures, []);
});

void test('an unknown requirement is refused', async () => {
  await assert.rejects(
    checkStartupWeight(await build({}), ['engines']),
    /unknown requirement engines/,
  );
});
