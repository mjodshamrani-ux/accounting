import { getResolvedPDFJS } from 'unpdf';
import { guardPdfOperatorStreams } from './pdf-stream-integrity.ts';

export type VisualPdfPage = {
  page: number;
  totalPages: number;
  width: number;
  height: number;
  rotation: number;
  viewBox: [number, number, number, number];
  transform: [number, number, number, number, number, number];
  png: Blob;
};
type PdfRuntime = Awaited<ReturnType<typeof getResolvedPDFJS>>;
type PdfDocument = Awaited<ReturnType<PdfRuntime['getDocument']>['promise']>;
type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;
type PageConsumer = (page: VisualPdfPage) => void | Promise<void>;
type RenderOptions = { signal?: AbortSignal };
type RendererDependencies = {
  loadPdfJs: () => Promise<PdfRuntime>;
  createCanvas: () => HTMLCanvasElement;
};
export const VISUAL_PDF_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  pages: 5,
  outputPixels: 8_000_000,
  outputEdge: 4096,
  imagePixels: 16_000_000,
  activeCanvasPixels: 32_000_000,
  pageMilliseconds: 15_000,
  dpi: 200,
});
const failed = (detail: string) =>
  new Error(`تعذر إعداد المعاينة البصرية المحلية: ${detail}`);
const cancelled = () => failed('أُلغيت العملية');
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;

// This timer is cooperative. A DOM-thread image decode cannot be forcibly
// interrupted until it yields; the UI must not describe this as a hard CPU cap.
async function bounded<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  stop: () => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => {
          stop();
          reject(cancelled());
        };
        if (signal?.aborted) return abort();
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => {
          stop();
          reject(failed('استغرق عرض الصفحة أكثر من 15 ثانية'));
        }, VISUAL_PDF_LIMITS.pageMilliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

// Dependency injection exists to test lifecycle/omission guards without browser
// globals. The app uses renderVisualPdf below, with native DOM canvases only.
export class VisualPdfRenderer {
  private dependencies: RendererDependencies;
  constructor(
    dependencies: RendererDependencies = {
      loadPdfJs: getResolvedPDFJS,
      createCanvas: () => document.createElement('canvas'),
    },
  ) {
    this.dependencies = dependencies;
  }

  async render(
    buffer: ArrayBuffer,
    onPage: PageConsumer,
    { signal }: RenderOptions = {},
  ): Promise<{ totalPages: number }> {
    if (signal?.aborted) throw cancelled();
    if (
      !(buffer instanceof ArrayBuffer) ||
      !buffer.byteLength ||
      buffer.byteLength > VISUAL_PDF_LIMITS.bytes
    )
      throw failed('الحد الأقصى لحجم كل PDF هو 8 MB');
    if (new TextDecoder().decode(buffer.slice(0, 5)) !== '%PDF-')
      throw failed('الملف ليس PDF');
    const runtime = await this.dependencies.loadPdfJs();
    if (signal?.aborted) throw cancelled();
    let resourceFailure = false;
    class NoExternalResources {
      async fetch() {
        resourceFailure = true;
        throw failed('الملف يحتاج موارد خطوط أو صور غير متاحة محليًا');
      }
    }
    const canvases = new Set<HTMLCanvasElement>();
    const sizes = new Map<HTMLCanvasElement, number>();
    const createCanvas = this.dependencies.createCanvas;
    let canvasFailure = false;
    const resize = (
      canvas: HTMLCanvasElement,
      width: number,
      height: number,
    ) => {
      width = Math.ceil(width);
      height = Math.ceil(height);
      const active =
        [...sizes.values()].reduce((sum, pixels) => sum + pixels, 0) -
        (sizes.get(canvas) ?? 0);
      if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > 16384 ||
        height > 16384 ||
        width * height > VISUAL_PDF_LIMITS.imagePixels ||
        active + width * height > VISUAL_PDF_LIMITS.activeCanvasPixels
      ) {
        canvasFailure = true;
        throw failed('تتطلب الصفحة ذاكرة تتجاوز الحد المسموح للمعاينة');
      }
      canvas.width = width;
      canvas.height = height;
      sizes.set(canvas, width * height);
    };
    class LimitedCanvasFactory {
      create(width: number, height: number) {
        const canvas = createCanvas();
        canvases.add(canvas);
        resize(canvas, width, height);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
          canvasFailure = true;
          throw failed('الرسم المحلي غير متاح في هذا المتصفح');
        }
        return { canvas, context };
      }
      reset(
        target: { canvas: HTMLCanvasElement },
        width: number,
        height: number,
      ) {
        resize(target.canvas, width, height);
      }
      destroy(target: {
        canvas: HTMLCanvasElement | null;
        context?: CanvasRenderingContext2D | null;
      }) {
        if (target.canvas) {
          target.canvas.width = 0;
          target.canvas.height = 0;
          sizes.delete(target.canvas);
          canvases.delete(target.canvas);
        }
        target.canvas = null;
        target.context = null;
      }
    }
    const loading = runtime.getDocument({
      data: new Uint8Array(buffer.slice(0)),
      useWorkerFetch: false,
      useSystemFonts: false,
      disableFontFace: true,
      useWasm: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      stopAtErrors: true,
      enableXfa: false,
      maxImageSize: VISUAL_PDF_LIMITS.imagePixels,
      canvasMaxAreaInBytes: VISUAL_PDF_LIMITS.imagePixels * 4,
      BinaryDataFactory: NoExternalResources,
      CanvasFactory: LimitedCanvasFactory,
    });
    let streamGuard: ReturnType<typeof guardPdfOperatorStreams> | undefined;
    let activeRender: ReturnType<PdfPage['render']> | undefined;
    const stop = () => {
      activeRender?.cancel();
      void loading.destroy().catch(() => {});
    };
    const assertResources = () => {
      if (resourceFailure)
        throw failed(
          'أحد الخطوط أو الموارد المطلوبة مفقود. لا يمكن اعتماد صورة تستخدم خطًا بديلًا.',
        );
      if (canvasFailure)
        throw failed('يتطلب الرسم ذاكرة تتجاوز الحد المسموح للمعاينة');
    };
    try {
      const pdf = await bounded(loading.promise, signal, stop);
      streamGuard = guardPdfOperatorStreams(pdf, runtime.version);
      if (
        !Number.isInteger(pdf.numPages) ||
        pdf.numPages < 1 ||
        pdf.numPages > VISUAL_PDF_LIMITS.pages
      )
        throw failed('الحد التجريبي لقراءة الصور هو 5 صفحات PDF');
      await bounded(
        (async () => {
          if (pdf.isPureXfa || (await pdf.getPermissions()) !== null)
            throw failed('PDF المحمي أو التفاعلي غير مدعوم');
          const layers = await pdf.getOptionalContentConfig();
          if (layers.getOrder()?.length)
            throw failed(
              'يحتوي PDF طبقات عرض. استخدم نسخة مسطحة تظهر كل البيانات.',
            );
        })(),
        signal,
        stop,
      );
      const factory = new LimitedCanvasFactory();
      for (let number = 1; number <= pdf.numPages; number++) {
        if (signal?.aborted) throw cancelled();
        let page: PdfPage | undefined;
        let surface: ReturnType<LimitedCanvasFactory['create']> | undefined;
        try {
          const rendered = await bounded(
            (async (): Promise<VisualPdfPage> => {
              page = await pdf.getPage(number);
              // Annotation appearances and widgets may require a separate canvas
              // or HTML layer. This first slice accepts already-flattened pages.
              if ((await page.getAnnotations()).length)
                throw failed(
                  'يحتوي PDF تعليقات أو نماذج تفاعلية. استخدم نسخة مسطحة تظهر كل البيانات.',
                );
              if (![0, 90, 180, 270].includes(page.rotate))
                throw failed('اتجاه الصفحة غير مدعوم');
              const viewBox = [...page.view];
              if (
                viewBox.length !== 4 ||
                !viewBox.every(Number.isFinite) ||
                viewBox[2] <= viewBox[0] ||
                viewBox[3] <= viewBox[1]
              )
                throw failed('حدود الصفحة غير صالحة');
              const viewport = page.getViewport({
                scale: VISUAL_PDF_LIMITS.dpi / 72,
              });
              const width = Math.ceil(viewport.width),
                height = Math.ceil(viewport.height);
              if (
                !Number.isSafeInteger(width) ||
                !Number.isSafeInteger(height) ||
                width < 1 ||
                height < 1 ||
                width > VISUAL_PDF_LIMITS.outputEdge ||
                height > VISUAL_PDF_LIMITS.outputEdge ||
                width * height > VISUAL_PDF_LIMITS.outputPixels
              )
                throw failed(
                  'حجم الصفحة يتجاوز دقة العرض الآمنة. لم تُخفّض دقتها تلقائيًا.',
                );
              const transform = [...viewport.transform];
              if (transform.length !== 6 || !transform.every(Number.isFinite))
                throw failed('تحويل إحداثيات الصفحة غير صالح');
              surface = factory.create(width, height);
              activeRender = page.render({
                canvas: surface.canvas,
                viewport,
                background: 'rgb(255,255,255)',
                annotationMode: runtime.AnnotationMode.ENABLE,
              });
              await activeRender.promise;
              await streamGuard!.assertComplete();
              // Decode failures can be replaced with null image objects by PDF.js.
              // Verify every image/font used in its final display list explicitly.
              const operators = await page.getOperatorList({
                annotationMode: runtime.AnnotationMode.ENABLE,
              });
              await streamGuard!.assertComplete();
              await assertPaintResources(page, operators, runtime.OPS);
              assertResources();
              const png = await new Promise<Blob>((resolve, reject) =>
                surface!.canvas.toBlob(
                  (blob) =>
                    blob?.type === 'image/png' && blob.size
                      ? resolve(blob)
                      : reject(failed('تعذر حفظ المعاينة بصيغة PNG')),
                  'image/png',
                ),
              );
              return {
                page: number,
                totalPages: pdf.numPages,
                width,
                height,
                rotation: page.rotate,
                viewBox: viewBox as VisualPdfPage['viewBox'],
                transform: transform as VisualPdfPage['transform'],
                png,
              };
            })(),
            signal,
            stop,
          );
          if (signal?.aborted) throw cancelled();
          // Consumer results are provisional until render() resolves. A later
          // page failure must discard the complete document's OCR draft.
          await onPage(rendered);
        } finally {
          activeRender = undefined;
          if (surface) factory.destroy(surface);
          page?.cleanup();
        }
      }
      if (signal?.aborted) throw cancelled();
      return { totalPages: pdf.numPages };
    } finally {
      activeRender?.cancel();
      streamGuard?.restore();
      try {
        await loading.destroy();
      } finally {
        for (const canvas of canvases) {
          canvas.width = 0;
          canvas.height = 0;
        }
        canvases.clear();
        sizes.clear();
      }
    }
  }
}

async function assertPaintResources(
  page: PdfPage,
  operators: Awaited<ReturnType<PdfPage['getOperatorList']>>,
  ops: Record<string, number>,
) {
  if (
    operators.fnArray.length > 200000 ||
    operators.fnArray.length !== operators.argsArray.length
  )
    throw failed('تعليمات الصفحة تتجاوز الحدود المدعومة');
  const checked = new Set<unknown>();
  let imagePixels = 0;
  const image = (value: unknown) => {
    if (checked.has(value)) return;
    checked.add(value);
    const data = asRecord(value);
    if (
      !data ||
      !Number.isSafeInteger(data.width) ||
      !Number.isSafeInteger(data.height) ||
      (data.width as number) < 1 ||
      (data.height as number) < 1 ||
      !(data.bitmap || (ArrayBuffer.isView(data.data) && data.data.byteLength))
    )
      throw failed('تعذر فك صورة داخل PDF بالكامل');
    const pixels = (data.width as number) * (data.height as number);
    imagePixels += pixels;
    if (
      pixels > VISUAL_PDF_LIMITS.imagePixels ||
      imagePixels > VISUAL_PDF_LIMITS.activeCanvasPixels
    )
      throw failed('الصور المفكوكة تتجاوز الحدود الآمنة');
  };
  const object = (id: string) =>
    new Promise<unknown>((resolve) =>
      (id.startsWith('g_') ? page.commonObjs : page.objs).get(id, resolve),
    );
  for (let i = 0; i < operators.fnArray.length; i++) {
    const op = operators.fnArray[i],
      args = operators.argsArray[i];
    if (op === ops.setFont) {
      if (typeof args?.[0] !== 'string') throw failed('مرجع خط غير صالح');
      const font = asRecord(await object(args[0]));
      if (
        !font ||
        font.isInvalidPDFjsFont ||
        (font.missingFile && !font.isType3Font)
      )
        throw failed('أحد الخطوط مفقود. لا يمكن تخمين شكل الأرقام.');
    } else if (
      op === ops.paintImageXObject ||
      op === ops.paintImageXObjectRepeat
    ) {
      if (typeof args?.[0] !== 'string') throw failed('مرجع صورة غير صالح');
      image(await object(args[0]));
    } else if (
      [
        ops.paintInlineImageXObject,
        ops.paintInlineImageXObjectGroup,
        ops.paintImageMaskXObject,
        ops.paintImageMaskXObjectRepeat,
      ].includes(op)
    )
      image(args?.[0]);
    else if (op === ops.paintImageMaskXObjectGroup) {
      if (!Array.isArray(args?.[0])) throw failed('مجموعة صور غير صالحة');
      for (const mask of args[0]) image(mask);
    }
  }
}

export function renderVisualPdf(
  buffer: ArrayBuffer,
  onPage: PageConsumer,
  options: RenderOptions = {},
) {
  return new VisualPdfRenderer().render(buffer, onPage, options);
}
