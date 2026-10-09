import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from '../lib/reconciliation/io.ts';
void test('Default source reader: stored original, SHA and cells retain the same bytes across actual asynchronous hashing', async () => {
  const input = new TextEncoder().encode('ID,Amount\n001,100.00\n').buffer;
  const expected = createHash('sha256')
    .update(new Uint8Array(input))
    .digest('hex');
  const subtle = crypto.subtle;
  // oxlint-disable-next-line typescript/unbound-method -- Invoked with an explicit receiver, then restored unchanged.
  const digest = subtle.digest;
  let calls = 0;
  subtle.digest = function (...args: Parameters<typeof digest>) {
    const task = digest.apply(subtle, args);
    if (++calls === 1) new Uint8Array(input).fill(0);
    return task;
  };
  try {
    const file = await readFile('original.csv', input);
    assert.equal(file.sha256, expected);
    assert.equal(file.sheets[0].rows[1][0], '001');
    assert.equal(file.sheets[0].rows[1][1], '100.00');
    assert.equal(
      createHash('sha256').update(new Uint8Array(file.original!)).digest('hex'),
      expected,
    );
  } finally {
    subtle.digest = digest;
  }
});
