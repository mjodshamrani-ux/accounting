import test from 'node:test';
import assert from 'node:assert/strict';
import { scaledText } from '../lib/amount-text.ts';

void test('an amount reads in major units at the precision of its currency', () => {
  assert.equal(scaledText(150000, 2), '1,500.00');
  assert.equal(scaledText(150000, 0), '150,000');
  assert.equal(scaledText(150000, 3), '150.000');
  assert.equal(scaledText(1234567890, 3), '1,234,567.890');
  assert.equal(scaledText(7, 2), '0.07');
  assert.equal(scaledText(7, 3), '0.007');
  assert.equal(scaledText(0, 2), '0.00');
  assert.equal(scaledText(0, 0), '0');
});

void test('a negative amount keeps its minus before the digits', () => {
  assert.equal(scaledText(-700000, 2), '-7,000.00');
  assert.equal(scaledText(-5, 2), '-0.05');
  assert.equal(scaledText(-1000, 0), '-1,000');
  assert.equal(scaledText(-1, 3), '-0.001');
});

void test('an amount the engine keeps as an integer string is placed digit by digit, beyond the safe range too', () => {
  assert.equal(scaledText('150000', 2), '1,500.00');
  assert.equal(scaledText('-5', 2), '-0.05');
  assert.equal(scaledText('150000', 0), '150,000');
  assert.equal(scaledText('0007', 3), '0.007');
  assert.equal(
    scaledText('123456789012345678901', 2),
    '1,234,567,890,123,456,789.01',
  );
  assert.equal(scaledText('-9007199254740993', 2), '-90,071,992,547,409.93');
  assert.equal(scaledText('12.5', 2), '12.5');
  assert.equal(scaledText('', 2), '');
  // The string path agrees with the number path wherever both apply.
  for (const value of [
    0, 1, -1, 7, -42, 999, 1000, -100000, 123456789, -987654321012,
  ])
    for (const places of [0, 1, 2, 3])
      assert.equal(
        scaledText(String(value), places),
        scaledText(value, places),
        `${value} at ${places}`,
      );
});

void test('a missing amount is a dash, and a value the formatter cannot place is shown as it came', () => {
  assert.equal(scaledText(null, 2), '—');
  assert.equal(scaledText(undefined, 2), '—');
  assert.equal(scaledText(1.5, 2), '1.5');
  assert.equal(scaledText(Number.MAX_SAFE_INTEGER + 1, 2), '9007199254740992');
  assert.equal(scaledText(150000, -1), '150000');
  assert.equal(scaledText(150000, 1.5), '150000');
});
