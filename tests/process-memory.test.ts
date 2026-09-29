import test from 'node:test';
import assert from 'node:assert/strict';
import {
  processRssBytes,
  withinMemoryDeadline,
} from '../scripts/process-memory.mjs';

void test('RSS sums every requested process independent of ps ordering', () => {
  assert.equal(processRssBytes([401, 402], ' 402 80\n 401 120\n'), 204800);
});

void test('an incomplete process snapshot cannot masquerade as lower memory use', () => {
  for (const text of [
    '401 120',
    '401 120\n401 80',
    '401 120\n403 80',
    '401 120\n402 80\n403 1',
    '',
  ])
    assert.throws(() => processRssBytes([401, 402], text));
});

void test('RSS rejects invalid counters and process identifiers', () => {
  for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740991'])
    assert.throws(() => processRssBytes([401], `401 ${value}`));
  for (const ids of [[], [401, 401], [0], [-1], [1.5], [NaN]])
    assert.throws(() => processRssBytes(ids, '401 10'));
  assert.throws(() => processRssBytes([401], '401 10 extra'));
});

void test(
  'a hung memory sample fails within a deadline so browser cleanup can run',
  { timeout: 2000 },
  async () => {
    await assert.rejects(
      withinMemoryDeadline(() => new Promise<number>(() => {}), 20),
      /timed out/,
    );
    assert.equal(await withinMemoryDeadline(async () => 204800, 100), 204800);
    await assert.rejects(
      withinMemoryDeadline(async () => {
        throw new Error('CDP failed');
      }, 100),
      /CDP failed/,
    );
  },
);
