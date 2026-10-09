import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

void test('every concrete package script entry exists, and performance aliases use the maintained entry', async () => {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  for (const [name, command] of Object.entries(pkg.scripts)) {
    for (const [target] of command.matchAll(
      /(?:scripts|audit)\/[\w./-]+\.mjs/g,
    ))
      await assert.doesNotReject(
        access(new URL(target, root)),
        `${name}: missing executable ${target}`,
      );
  }
  assert.equal(
    pkg.scripts['test:browser:performance'],
    'node scripts/performance-check.mjs',
  );
  assert.equal(
    pkg.scripts['test:reliability:performance'],
    pkg.scripts['test:browser:performance'],
  );
});
