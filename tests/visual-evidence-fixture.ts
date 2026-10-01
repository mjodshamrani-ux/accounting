// Independent byte writer: it does not import the PNG decoder or its CRC.
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { createVisualDraft } from '../lib/reconciliation/visual-draft.ts';
import { VISUAL_ENGINE } from '../lib/reconciliation/visual-assets.ts';
export const sha = (b: Uint8Array) =>
  createHash('sha256').update(b).digest('hex');
export function chunk(type: string, bytes: Uint8Array) {
  const payload = Buffer.concat([Buffer.from(type), Buffer.from(bytes)]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let i = 0; i < 8; i++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const out = Buffer.alloc(bytes.length + 12);
  out.writeUInt32BE(bytes.length);
  payload.copy(out, 4);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}
export function pngFixture(
  options: {
    channels?: 3 | 4;
    filters?: number[];
    transparent?: boolean;
    extra?: Buffer;
    raw?: Uint8Array;
    width?: number;
    height?: number;
    changed?: boolean;
  } = {},
) {
  const width = options.width ?? 80,
    height = options.height ?? 60,
    channels = options.channels ?? 3;
  const raw = Buffer.alloc(width * height * channels),
    rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * channels,
        q = (y * width + x) * 4;
      // Vary both axes and channels, including 0/255 and byte wraparound.
      const color = [
        (x * 17 + y * 31) & 255,
        (x * 43 + y * 7) & 255,
        (x * 3 + y * 11) & 255,
        255,
      ];
      if (options.changed && x === 2 && y === 2) color[0] ^= 1;
      if (options.transparent && x === 1 && y === 1) color[3] = 254;
      raw.set(color.slice(0, channels), p);
      rgba.set(color, q);
    }
  const stride = width * channels,
    scan = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = (options.filters ?? [0])[
      y % (options.filters ?? [0]).length
    ];
    scan[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x,
        left = x < channels ? 0 : raw[i - channels],
        up = y ? raw[i - stride] : 0,
        upperLeft = y && x >= channels ? raw[i - stride - channels] : 0;
      const candidate = left + up - upperLeft,
        distances = [left, up, upperLeft].map((v) => Math.abs(candidate - v));
      const paeth = [left, up, upperLeft][
        distances.indexOf(Math.min(...distances))
      ];
      const predictor =
        [0, left, up, Math.floor((left + up) / 2), paeth][filter] ?? 0;
      scan[y * (stride + 1) + x + 1] = (raw[i] - predictor + 256) % 256;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 3 ? 2 : 6;
  const compressed = deflateSync(options.raw ?? scan),
    split = Math.floor(compressed.length / 2);
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...(options.extra ? [options.extra] : []),
    chunk('IDAT', compressed.subarray(0, split)),
    chunk('IDAT', compressed.subarray(split)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { bytes, rgba, scan, width, height };
}
export function draftFixture(
  bytes: Uint8Array = pngFixture().bytes,
  image: Uint8Array = bytes,
) {
  return createVisualDraft(
    {
      source: { name: 'opaque.png', sha256: sha(bytes) },
      expectedPages: 1,
      engine: VISUAL_ENGINE,
      pages: [
        {
          page: 1,
          width: 80,
          height: 60,
          imageDataUrl:
            'data:image/png;base64,' + Buffer.from(image).toString('base64'),
          blocks: [
            {
              paragraphs: [
                {
                  lines: [
                    {
                      words: [
                        {
                          text: '-250.00',
                          confidence: 99,
                          bbox: { x0: 20, y0: 10, x1: 40, y1: 20 },
                        },
                        {
                          text: 'INV-700',
                          confidence: 99,
                          bbox: { x0: 10, y0: 35, x1: 45, y1: 45 },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    sha(bytes),
  );
}
