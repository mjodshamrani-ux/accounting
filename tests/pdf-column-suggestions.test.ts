import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestPdfColumns } from '../lib/reconciliation/pdf-column-suggestions.ts';
import type { PdfToken } from '../lib/reconciliation/pdf.ts';
const t = (text: string, x: number, y: number, width = 30): PdfToken => ({
  text,
  x,
  y,
  width,
  height: 10,
});
const page = () => ({
  width: 600,
  tokens: [
    t('date', 20, 700),
    t('reference', 200, 700, 50),
    t('amount', 400, 700, 40),
    t('2026-06-01', 20, 680, 65),
    t('SYN-1', 200, 680, 30),
    t('120', 420, 680, 20),
  ],
});
test('only one explicit complete header and consistent gaps produce PDF suggestions', () => {
  const p = page();
  const before = JSON.stringify(p);
  const cuts = suggestPdfColumns([p]);
  assert.equal(cuts?.length, 2);
  assert.equal(JSON.stringify(p), before);
  assert.deepEqual(suggestPdfColumns([p, p]), cuts);
  assert.equal(suggestPdfColumns([]), null);
  const unknown = page();
  unknown.tokens[1].text = 'Unknown';
  assert.equal(suggestPdfColumns([unknown]), null);
  const duplicate = page();
  duplicate.tokens.push(
    t('date', 20, 600),
    t('reference', 200, 600, 50),
    t('amount', 400, 600, 40),
  );
  assert.equal(suggestPdfColumns([duplicate]), null);
});
test('overlapping, incompatible multi-page or floating tokens cancel automatic suggestions', () => {
  const overlap = page();
  overlap.tokens[3].width = 210;
  assert.equal(suggestPdfColumns([overlap]), null);
  const incompatible = page();
  incompatible.tokens[1].text = 'Document No.';
  assert.equal(suggestPdfColumns([page(), incompatible]), null);
  const floating = page();
  floating.tokens.push(t('2026-06-02', 20, 650, 65), t('?', 130, 650, 5));
  assert.equal(suggestPdfColumns([floating]), null);
  const nan = page();
  nan.tokens[0].x = NaN;
  assert.equal(suggestPdfColumns([nan]), null);
});
test('partial rows tighten a gap without splitting an extended reference', () => {
  const p = page();
  p.tokens.push(
    t('2026-06-02', 20, 650, 65),
    t('A long reference', 200, 650, 145),
  );
  const cuts = suggestPdfColumns([p]);
  assert.ok(cuts);
  assert.ok(cuts[1] * 6 > 345);
  assert.ok(cuts[1] * 6 < 400);
});
