import test from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_PAGE, pageOfRow, recordPage } from '../lib/record-page.ts';
import { recordTableCopy } from '../lib/i18n/record-table.ts';

void test('a page shows fifty rows, and the last page the rest', () => {
  assert.equal(RECORD_PAGE, 50);
  assert.deepEqual(recordPage(0, 0), { pages: 1, at: 0, from: 0, to: 0 });
  assert.deepEqual(recordPage(50, 0), { pages: 1, at: 0, from: 0, to: 50 });
  assert.deepEqual(recordPage(51, 0), { pages: 2, at: 0, from: 0, to: 50 });
  assert.deepEqual(recordPage(51, 1), { pages: 2, at: 1, from: 50, to: 51 });
  assert.deepEqual(recordPage(140, 2), { pages: 3, at: 2, from: 100, to: 140 });
});

void test('a page past the end shows the last page, and a page before the first the first', () => {
  assert.deepEqual(recordPage(120, 9), { pages: 3, at: 2, from: 100, to: 120 });
  assert.deepEqual(recordPage(30, 4), { pages: 1, at: 0, from: 0, to: 30 });
  assert.deepEqual(recordPage(120, -1), { pages: 3, at: 0, from: 0, to: 50 });
  assert.deepEqual(recordPage(120, Number.NaN), {
    pages: 3,
    at: 0,
    from: 0,
    to: 50,
  });
});

void test('every row is on exactly one page, in its order', () => {
  for (const length of [0, 1, 49, 50, 51, 99, 100, 101, 250]) {
    const seen: number[] = [];
    const { pages } = recordPage(length, 0);
    for (let page = 0; page < pages; page++) {
      const { from, to } = recordPage(length, page);
      for (let row = from; row < to; row++) seen.push(row);
    }
    assert.deepEqual(
      seen,
      Array.from({ length }, (_, i) => i),
      `${length} rows`,
    );
  }
});

void test('a row is found again on the page that shows it', () => {
  assert.equal(pageOfRow(0), 0);
  assert.equal(pageOfRow(49), 0);
  assert.equal(pageOfRow(50), 1);
  assert.equal(pageOfRow(139), 2);
  assert.equal(pageOfRow(-3), 0);
  for (const row of [0, 49, 50, 77, 139]) {
    const { from, to } = recordPage(140, pageOfRow(row));
    assert.ok(from <= row && row < to, `row ${row}`);
  }
});

void test('the pager names the page and the rows it shows in both languages, in Western digits', () => {
  assert.equal(
    recordTableCopy.en.status(2, 3, 51, 100, 140),
    'Page 2 of 3 · rows 51–100 of 140',
  );
  assert.equal(
    recordTableCopy.ar.status(2, 3, 51, 100, 140),
    'الصفحة 2 من 3 · الصفوف 51–100 من 140',
  );
  for (const copy of [recordTableCopy.en, recordTableCopy.ar])
    assert.doesNotMatch(
      [
        copy.previous,
        copy.next,
        copy.pages('x'),
        copy.status(1, 2, 1, 50, 60),
        copy.wide('x'),
      ].join(' '),
      /[٠-٩۰-۹]/u,
    );
});
