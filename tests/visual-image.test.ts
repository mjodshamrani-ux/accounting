import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectVisualImage } from '../lib/reconciliation/visual-image.ts';
function png(width = 200, height = 100, animated = false) {
  const b = Buffer.alloc(45 + (animated ? 12 : 0));
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  if (animated) b.write('acTL', 37);
  b.write('IEND', animated ? 49 : 37);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
function jpeg(width = 200, height = 100) {
  const b = Buffer.from([255, 216, 255, 192, 0, 8, 8, 0, 0, 0, 0, 1, 255, 217]);
  b.writeUInt16BE(height, 7);
  b.writeUInt16BE(width, 9);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
void test('PNG dimensions are bounded before any image decoder is called', () => {
  assert.deepEqual(inspectVisualImage(png()), {
    width: 200,
    height: 100,
    mime: 'image/png',
  });
  for (const b of [
    png(5000, 100),
    png(4000, 4000),
    png(0, 10),
    png(200, 100, true),
    png().slice(0, 30),
  ])
    assert.throws(() => inspectVisualImage(b));
});
void test('JPEG dimensions are read from SOF; oversized, truncated and disguised images reject', () => {
  assert.deepEqual(inspectVisualImage(jpeg()), {
    width: 200,
    height: 100,
    mime: 'image/jpeg',
  });
  for (const b of [
    jpeg(4097, 100),
    jpeg(3000, 3000),
    jpeg().slice(0, 12),
    new TextEncoder().encode('<svg/>').buffer,
  ])
    assert.throws(() => inspectVisualImage(b));
});
void test('PNG chunk lengths and all image byte counts are bounded', () => {
  const b = png();
  new DataView(b).setUint32(33, 0xffffffff);
  assert.throws(() => inspectVisualImage(b));
  assert.throws(() => inspectVisualImage(new ArrayBuffer(8 * 1024 * 1024 + 1)));
});
