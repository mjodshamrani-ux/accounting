import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindTextPaints,
  visibleOnBackground,
} from '../lib/reconciliation/pdf-paint-order.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { syntheticStyledPdf } from './helpers/styled-pdf-fixture.ts';
test('exact glyph binding records when text was painted, including split and merged runs', () => {
  const ops = { showText: 1 };
  const a = [0, 0, 10, 10],
    b = [20, 0, 30, 10];
  const bound = bindTextPaints(
    ops,
    [1, 1],
    [[[{ unicode: 'INV-' }]], [[{ unicode: '123' }, { unicode: '100.00' }]]],
    ['INV-123', '100.00'],
    [a, b],
  );
  assert.deepEqual(bound.get(0), [a]);
  assert.deepEqual(bound.get(1), [a, b]);
  assert.throws(
    () => bindTextPaints(ops, [1], [[[{ unicode: '999' }]]], ['100'], [a]),
    /لا يطابق/,
  );
  assert.throws(() => bindTextPaints(ops, [], [], ['100'], [a]), /بالكامل/);
});
test('white text requires an opaque dark background covering its entire box', () => {
  const box = [10, 10, 20, 20];
  assert.equal(visibleOnBackground('#ffffff', box, []), false);
  assert.equal(
    visibleOnBackground('#ffffff', box, [
      { box: [0, 0, 30, 30], color: '#17365d' },
    ]),
    true,
  );
  assert.equal(
    visibleOnBackground('#ffffff', box, [
      { box: [0, 0, 15, 30], color: '#17365d' },
    ]),
    false,
  );
  assert.equal(
    visibleOnBackground('#000000', box, [
      { box: [0, 0, 30, 30], color: '#000000' },
    ]),
    false,
  );
});
test('colored statement headers and pale backgrounds drawn after a title load without hiding data', async () => {
  const file = await readFile(
    'synthetic-styled.pdf',
    syntheticStyledPdf(),
    [25, 45],
  );
  assert.deepEqual(file.sheets[0].rows, [
    ['Statement', '', ''],
    ['date', 'reference', 'amount'],
    ['02-Jul-2026', 'SYN-7001', '1250.00'],
    ['12-Jul-2026', 'SYN-CN-2', '-150.00'],
  ]);
  assert.deepEqual(file.sheets[0].rowIssues, {});
});
test('a later opaque rectangle covering transaction text still prevents import', async () => {
  await assert.rejects(
    readFile('synthetic-covered.pdf', syntheticStyledPdf(true), [25, 45]),
    /يغطي|تغط/,
  );
});

test('a hairline table rule grazing black text is not a background, but covers and stripes still are', () => {
  // A glyph box 11.7pt tall; a printed row border 0.75pt thick across its
  // lower edge, as Chromium draws where a page break cuts a table row.
  const glyph = [488.8, 527.2, 643.2, 538.9];
  const rule = (y: number, color = '#555555', thick = 0.75) => ({
    box: [46.5, y, 1000, y + thick],
    color,
  });
  assert.equal(visibleOnBackground('#000000', glyph, [rule(538.17)]), true);
  // The same rule colour as a real background under the text: refused.
  assert.equal(
    visibleOnBackground('#000000', glyph, [
      { box: [480, 520, 650, 545], color: '#555555' },
    ]),
    false,
  );
  // A band 2pt thick is not a rule.
  assert.equal(
    visibleOnBackground('#000000', glyph, [rule(530, '#555555', 2)]),
    false,
  );
  // Stripes: several hairlines together over more than a fifth of the box.
  const stripes = [528, 530.5, 533, 535.5].map((y) => rule(y, '#555555', 1));
  assert.equal(visibleOnBackground('#000000', glyph, stripes), false);
  // White text is never rescued by the allowance.
  assert.equal(
    visibleOnBackground('#ffffff', glyph, [rule(538.17, '#ffffff')]),
    false,
  );
});
