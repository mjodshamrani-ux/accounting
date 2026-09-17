import test from 'node:test';
import assert from 'node:assert/strict';
import { getResolvedPDFJS } from 'unpdf';
import {
  VisualPdfRenderer,
  VISUAL_PDF_LIMITS,
} from '../lib/reconciliation/visual-renderer.ts';
import type { VisualPdfPage } from '../lib/reconciliation/visual-renderer.ts';
import { PdfOperatorStreamError } from '../lib/reconciliation/pdf-stream-integrity.ts';

const bytes = () => new TextEncoder().encode('%PDF-renderer-test').buffer;
const ops = {
  setFont: 1,
  paintImageXObject: 2,
  paintImageXObjectRepeat: 3,
  paintInlineImageXObject: 4,
  paintInlineImageXObjectGroup: 5,
  paintImageMaskXObject: 6,
  paintImageMaskXObjectRepeat: 7,
  paintImageMaskXObjectGroup: 8,
};
type Setup = {
  pages?: number;
  protected?: boolean;
  layers?: boolean;
  annotations?: boolean;
  width?: number;
  height?: number;
  rotation?: number;
  viewportTransform?: number[];
  missingResource?: boolean;
  missingFont?: boolean;
  missingImage?: boolean;
  oversizedImage?: boolean;
  streamErrorPage?: number;
  failurePage?: number;
  onRender?: () => void;
  pngFails?: boolean;
};

function fixture(settings: Setup = {}) {
  let destroyed = 0,
    cancelled = 0;
  let options: Record<string, unknown> = {};
  const rendered: number[] = [],
    cleaned: number[] = [];
  const canvases: HTMLCanvasElement[] = [];
  const renderArguments: Record<string, unknown>[] = [];
  const viewportScales: number[] = [];
  const handler = {
    sendWithStream(_action: string, pageNumber: number) {
      let sent = false;
      return new ReadableStream({
        pull(controller) {
          if (settings.streamErrorPage === pageNumber) {
            if (!sent) {
              sent = true;
              controller.enqueue({ lastChunk: false });
            } else controller.error(new Error('late display failure'));
          } else {
            controller.enqueue({ lastChunk: true });
            controller.close();
          }
        },
      });
    },
  };
  const consume = async (number: number) => {
    const reader = handler
      .sendWithStream('GetOperatorList', number)
      .getReader();
    try {
      while (!(await reader.read()).done) {
        /* PDF.js display prefix */
      }
    } catch {
      /* model the upstream swallowed stream error */
    }
  };
  const pdf = {
    _transport: { messageHandler: handler },
    numPages: settings.pages ?? 1,
    isPureXfa: false,
    async getPermissions() {
      return settings.protected ? [1] : null;
    },
    async getOptionalContentConfig() {
      return { getOrder: () => (settings.layers ? ['layer'] : null) };
    },
    async getPage(number: number) {
      if (number === settings.failurePage) throw new Error('page failure');
      const resolveObject = (id: string, callback: (value: unknown) => void) =>
        callback(
          id.startsWith('g_')
            ? {
                missingFile: settings.missingFont,
                isType3Font: false,
                isInvalidPDFjsFont: false,
              }
            : settings.missingImage
              ? null
              : {
                  width: settings.oversizedImage ? 4100 : 2,
                  height: settings.oversizedImage ? 4100 : 2,
                  data: new Uint8Array(4),
                },
        );
      return {
        rotate: settings.rotation ?? 0,
        view: [10, 20, 610, 820],
        async getAnnotations() {
          return settings.annotations ? [{ subtype: 'Widget' }] : [];
        },
        getViewport({ scale }: { scale: number }) {
          viewportScales.push(scale);
          return {
            width: settings.width ?? 600 * scale,
            height: settings.height ?? 800 * scale,
            transform: settings.viewportTransform ?? [
              scale,
              0,
              0,
              -scale,
              -10 * scale,
              820 * scale,
            ],
          };
        },
        render(args: Record<string, unknown>) {
          renderArguments.push(args);
          rendered.push(number);
          const promise = (async () => {
            await consume(number);
            if (settings.missingResource) {
              const Factory = options.BinaryDataFactory as new () => {
                fetch(): Promise<unknown>;
              };
              try {
                await new Factory().fetch();
              } catch {
                /* swallowed upstream fallback */
              }
            }
            settings.onRender?.();
          })();
          return {
            promise,
            cancel() {
              cancelled++;
            },
          };
        },
        async getOperatorList() {
          await consume(number);
          return settings.missingFont
            ? { fnArray: [ops.setFont], argsArray: [['g_font']] }
            : { fnArray: [ops.paintImageXObject], argsArray: [['img_1']] };
        },
        objs: { get: resolveObject },
        commonObjs: { get: resolveObject },
        cleanup() {
          cleaned.push(number);
        },
      };
    },
  };
  const runtime = {
    version: '6.1.200',
    OPS: ops,
    AnnotationMode: { ENABLE: 1 },
    getDocument(value: Record<string, unknown>) {
      options = value;
      return {
        promise: Promise.resolve(pdf),
        async destroy() {
          destroyed++;
        },
      };
    },
  } as unknown as Awaited<ReturnType<typeof getResolvedPDFJS>>;
  const renderer = new VisualPdfRenderer({
    loadPdfJs: async () => runtime,
    createCanvas() {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({}),
        toBlob(callback: (value: Blob | null) => void) {
          callback(
            settings.pngFails
              ? null
              : new Blob(['synthetic PNG boundary'], { type: 'image/png' }),
          );
        },
      } as unknown as HTMLCanvasElement;
      canvases.push(canvas);
      return canvas;
    },
  });
  return {
    renderer,
    pdf,
    rendered,
    cleaned,
    canvases,
    renderArguments,
    viewportScales,
    get options() {
      return options;
    },
    get destroyed() {
      return destroyed;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

void test('visual PDF renderer: sequential complete pages provide exact geometry and await consumers before releasing canvases', async () => {
  const f = fixture({ pages: 2 });
  const received: VisualPdfPage[] = [];
  const result = await f.renderer.render(bytes(), async (page) => {
    assert.equal(f.rendered.length, page.page);
    assert.ok(f.canvases.at(-1)!.width > 0);
    received.push(page);
    await Promise.resolve();
  });
  assert.deepEqual(result, { totalPages: 2 });
  assert.deepEqual(
    received.map((page) => [
      page.page,
      page.totalPages,
      page.width,
      page.height,
      page.rotation,
    ]),
    [
      [1, 2, 1667, 2223, 0],
      [2, 2, 1667, 2223, 0],
    ],
  );
  const scale = 200 / 72;
  assert.deepEqual(received[0].viewBox, [10, 20, 610, 820]);
  assert.deepEqual(received[0].transform, [
    scale,
    0,
    0,
    -scale,
    -10 * scale,
    820 * scale,
  ]);
  assert.deepEqual(f.viewportScales, [scale, scale]);
  assert.ok(received.every((page) => page.png.type === 'image/png'));
  assert.ok(
    f.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0),
  );
  assert.deepEqual(f.cleaned, [1, 2]);
  assert.equal(f.destroyed, 1);
});

void test('visual PDF renderer: source bytes are copied and resource/network fallbacks are disabled', async () => {
  const f = fixture(),
    source = bytes();
  await f.renderer.render(source, () => {});
  assert.notEqual((f.options.data as Uint8Array).buffer, source);
  for (const key of [
    'useWorkerFetch',
    'useSystemFonts',
    'useWasm',
    'isOffscreenCanvasSupported',
    'isImageDecoderSupported',
    'enableXfa',
  ])
    assert.equal(f.options[key], false, key);
  assert.equal(f.options.disableFontFace, true);
  assert.equal(f.options.stopAtErrors, true);
  assert.equal(f.options.maxImageSize, 16_000_000);
  assert.equal(f.renderArguments[0].background, 'rgb(255,255,255)');
  assert.equal(f.renderArguments[0].annotationMode, 1);
});

void test('visual PDF renderer: missing fonts, missing resources and null decoded images never reach OCR', async () => {
  for (const settings of [
    { missingResource: true },
    { missingFont: true },
    { missingImage: true },
    { oversizedImage: true },
  ]) {
    const f = fixture(settings);
    let handedOff = false;
    await assert.rejects(
      f.renderer.render(bytes(), () => {
        handedOff = true;
      }),
      /خط|صورة|صور|موارد/,
    );
    assert.equal(handedOff, false);
    assert.ok(f.canvases.every((canvas) => canvas.width === 0));
    assert.equal(f.destroyed, 1);
  }
});

void test('visual PDF renderer: a swallowed render stream failure cannot deliver a plausible PNG', async () => {
  const f = fixture({ streamErrorPage: 1 });
  let calls = 0;
  await assert.rejects(
    f.renderer.render(bytes(), () => {
      calls++;
    }),
    PdfOperatorStreamError,
  );
  assert.equal(calls, 0);
  assert.equal(f.destroyed, 1);
});

void test('visual PDF renderer: page, byte, pixel, edge and geometry limits reject before drawing', async () => {
  for (const settings of [
    { pages: 6 },
    { pages: 0 },
    { width: 4097 },
    { width: 3000, height: 3000 },
    { width: Infinity },
    { height: 0 },
    { rotation: 15 },
    { viewportTransform: [1, 0, 0, NaN, 0, 0] },
  ]) {
    const f = fixture(settings);
    await assert.rejects(
      f.renderer.render(bytes(), () => assert.fail('must not hand off')),
    );
    assert.deepEqual(f.rendered, []);
  }
  for (const source of [
    new ArrayBuffer(VISUAL_PDF_LIMITS.bytes + 1),
    new ArrayBuffer(0),
    new TextEncoder().encode('not a PDF').buffer,
  ]) {
    const f = fixture();
    await assert.rejects(f.renderer.render(source, () => {}));
    assert.equal(f.destroyed, 0);
  }
});

void test('visual PDF renderer: protected, layered and interactive sources require a flattened supported source', async () => {
  for (const settings of [
    { protected: true },
    { layers: true },
    { annotations: true },
  ]) {
    const f = fixture(settings);
    await assert.rejects(
      f.renderer.render(bytes(), () => assert.fail('must not hand off')),
    );
    assert.deepEqual(f.rendered, []);
    assert.equal(f.destroyed, 1);
  }
});

void test('visual PDF renderer: cancellation and PNG failure release resources without any handoff', async () => {
  const controller = new AbortController();
  const f = fixture({ onRender: () => controller.abort() });
  await assert.rejects(
    f.renderer.render(bytes(), () => assert.fail('cancelled'), {
      signal: controller.signal,
    }),
    /أُلغيت/,
  );
  assert.ok(f.cancelled >= 1);
  assert.ok(f.destroyed >= 1);
  assert.ok(f.canvases.every((canvas) => canvas.width === 0));
  const brokenPng = fixture({ pngFails: true });
  await assert.rejects(
    brokenPng.renderer.render(bytes(), () => assert.fail('broken PNG')),
    /PNG/,
  );
  assert.equal(brokenPng.destroyed, 1);
});

void test('visual PDF renderer: later-page failure invalidates the document and consumer errors stop subsequent processing', async () => {
  const f = fixture({ pages: 2, failurePage: 2 });
  const provisional: VisualPdfPage[] = [];
  let completed = false;
  await assert.rejects(
    f.renderer
      .render(bytes(), (page) => {
        provisional.push(page);
      })
      .then(() => {
        completed = true;
      }),
    /page failure/,
  );
  assert.equal(provisional.length, 1);
  assert.equal(
    completed,
    false,
    'Only the fully resolved operation can commit the document draft',
  );
  const consumerFailure = fixture({ pages: 2 });
  await assert.rejects(
    consumerFailure.renderer.render(bytes(), () => {
      throw new Error('OCR failed');
    }),
    /OCR failed/,
  );
  assert.deepEqual(consumerFailure.rendered, [1]);
  assert.ok(consumerFailure.canvases.every((canvas) => canvas.width === 0));
});

void test('visual PDF renderer: rotated pages retain their actual viewport transform instead of rewriting coordinates', async () => {
  const transform = [0, 2, 2, 0, 50, -30];
  const f = fixture({ rotation: 90, viewportTransform: transform });
  await f.renderer.render(bytes(), (page) => {
    assert.equal(page.rotation, 90);
    assert.deepEqual(page.transform, transform);
  });
});
