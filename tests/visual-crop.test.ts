import test from 'node:test';
import assert from 'node:assert/strict';
import { cropBetween, moveCrop } from '../lib/reconciliation/visual-crop.ts';
void test('crop drag is direction-independent, bounded and rounds outwards to native pixels', () => {
  const a = [29.7, 20.6],
    b = [10.2, 5.3];
  assert.deepEqual(cropBetween(a, b, 80, 60), {
    x0: 10,
    y0: 5,
    x1: 30,
    y1: 21,
  });
  assert.deepEqual(cropBetween(a, b, 80, 60), cropBetween(b, a, 80, 60));
  assert.deepEqual(cropBetween([-10, -20], [100, 90], 80, 60), {
    x0: 0,
    y0: 0,
    x1: 80,
    y1: 60,
  });
  for (const points of [
    [
      [1, 1],
      [1, 1],
    ],
    [
      [NaN, 0],
      [10, 10],
    ],
    [
      [0, 0],
      [Infinity, 10],
    ],
    [[0], [1, 1]],
    [
      [-4, -4],
      [-1, -1],
    ],
  ])
    assert.equal(cropBetween(points[0], points[1], 80, 60), null);
});
void test('keyboard movement preserves size and image boundaries; resizing cannot invert or empty the crop', () => {
  const box = { x0: 2, y0: 3, x1: 76, y1: 56 };
  assert.deepEqual(moveCrop(box, 'ArrowLeft', false, 80, 60), {
    x0: 0,
    y0: 3,
    x1: 74,
    y1: 56,
  });
  assert.deepEqual(moveCrop(box, 'ArrowRight', false, 80, 60), {
    x0: 6,
    y0: 3,
    x1: 80,
    y1: 56,
  });
  assert.deepEqual(moveCrop(box, 'ArrowDown', false, 80, 60), {
    x0: 2,
    y0: 7,
    x1: 76,
    y1: 60,
  });
  assert.deepEqual(
    moveCrop({ x0: 2, y0: 3, x1: 5, y1: 6 }, 'ArrowLeft', true, 80, 60),
    { x0: 2, y0: 3, x1: 3, y1: 6 },
  );
  assert.equal(moveCrop(box, 'Enter', false, 80, 60), box);
  assert.throws(() => cropBetween([0, 0], [1, 1], 5000, 60));
});
