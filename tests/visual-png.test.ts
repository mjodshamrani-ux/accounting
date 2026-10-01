import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pngPixelEvidence,
  decodePngUrl,
  encodePngUrl,
  VisualEvidenceError,
} from '../lib/reconciliation/visual-png.ts';
import { pngFixture, chunk, sha } from './visual-evidence-fixture.ts';

for (const channels of [3, 4] as const)
  for (const filters of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]]) {
    void test(`PNG full decoding: ${channels} channels, filters ${filters.join(',')}, independent expected RGBA`, async () => {
      const f = pngFixture({ channels, filters });
      assert.deepEqual(await pngPixelEvidence(f.bytes), {
        width: f.width,
        height: f.height,
        pixelSha256: sha(f.rgba),
      });
      assert.deepEqual(
        decodePngUrl(encodePngUrl(f.bytes)),
        new Uint8Array(f.bytes),
      );
    });
  }
void test('PNG rejects CRC damage, missing end, trailing data and ambiguous colour/orientation/animation chunks', async () => {
  const f = pngFixture();
  const crc = Buffer.from(f.bytes);
  crc[crc.length - 1] ^= 1;
  const data = Buffer.from(f.bytes);
  data[50] ^= 1;
  const cases = [
    crc,
    data,
    f.bytes.subarray(0, -12),
    Buffer.concat([f.bytes, Buffer.from([0])]),
    ...['sRGB', 'iCCP', 'eXIf', 'acTL', 'tRNS'].map(
      (type) => pngFixture({ extra: chunk(type, Buffer.from([0])) }).bytes,
    ),
  ];
  for (const bytes of cases)
    await assert.rejects(
      pngPixelEvidence(bytes),
      (e: unknown) => e instanceof VisualEvidenceError && e.code === 'format',
    );
});
void test('PNG bounds decompressed data and rejects wrong filters, short scanlines and nonopaque RGBA', async () => {
  const f = pngFixture();
  for (const raw of [
    f.scan.subarray(0, -1),
    Buffer.concat([f.scan, Buffer.from([0])]),
    Buffer.alloc(2_000_000),
  ])
    await assert.rejects(
      pngPixelEvidence(pngFixture({ raw }).bytes),
      /visual-evidence:pixels/,
    );
  await assert.rejects(
    pngPixelEvidence(pngFixture({ filters: [5] }).bytes),
    /visual-evidence:pixels/,
  );
  await assert.rejects(
    pngPixelEvidence(pngFixture({ channels: 4, transparent: true }).bytes),
    /visual-evidence:format/,
  );
});
void test('PNG dimensions, byte budget and canonical base64 are bounded before large allocation', async () => {
  const bytes = Buffer.from(pngFixture().bytes),
    hdr = Buffer.from(bytes.subarray(16, 29));
  hdr.writeUInt32BE(4097);
  chunk('IHDR', hdr).copy(bytes, 8);
  await assert.rejects(pngPixelEvidence(bytes), /visual-evidence:limit/);
  await assert.rejects(
    pngPixelEvidence(new Uint8Array(2 * 1024 * 1024 + 1)),
    /visual-evidence:limit/,
  );
  for (const url of [
    'https://example.org/image.png',
    'data:image/png;base64,AB==',
    'data:image/png;base64,AA= ',
    'data:image/jpeg;base64,AAAA',
  ])
    assert.throws(() => decodePngUrl(url), /visual-evidence:format/);
});

void test('valid chunk CRC cannot hide a corrupt, truncated or trailing zlib stream', async () => {
  const f = pngFixture(),
    parts: Buffer[] = [];
  for (let offset = 8; offset < f.bytes.length;) {
    const length = f.bytes.readUInt32BE(offset),
      end = offset + length + 12;
    if (f.bytes.subarray(offset + 4, offset + 8).toString() === 'IDAT')
      parts.push(f.bytes.subarray(offset + 8, end - 4));
    offset = end;
  }
  const compressed = Buffer.concat(parts),
    wrongAdler = Buffer.from(compressed);
  wrongAdler[wrongAdler.length - 1] ^= 1;
  for (const data of [
    wrongAdler,
    compressed.subarray(0, -1),
    Buffer.concat([compressed, Buffer.from([1, 2, 3])]),
    Buffer.concat([compressed, compressed]),
  ]) {
    const bytes = Buffer.concat([
      f.bytes.subarray(0, 33),
      chunk('IDAT', data),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    await assert.rejects(pngPixelEvidence(bytes), /visual-evidence:pixels/);
  }
});
