import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { APP_VERSION } from '../lib/brand.ts';

void test('the displayed application version matches the released package version', async () => {
  const metadata: unknown = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.ok(metadata && typeof metadata === 'object' && 'version' in metadata);
  assert.equal(APP_VERSION, metadata.version);
});
