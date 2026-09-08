import { getResolvedPDFJS } from 'unpdf';
import type { SheetData } from './types.ts';

export type PdfToken = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export function checkPdfOperators(
  ops: Record<string, number>,
  fn: number[],
  args: unknown[][],
  _area: number,
) {
  let state = {
    mode: 0,
    fillColor: '#000000',
    strokeColor: '#000000',
    fillAlpha: 1,
    strokeAlpha: 1,
    masked: false,
    blended: false,
    transferred: false,
    clipped: false,
  };
  const stack: (typeof state)[] = [];
  // PDF.js resolves supported solid color spaces to RGB. Patterns and unknown
  // colors cannot prove visibility, even when their text is extractable.
  const solidColor = (args: unknown[]) =>
    typeof args[0] === 'string' && /^#[0-9a-f]{6}$/i.test(args[0])
      ? args[0].toLowerCase()
      : '';
  for (let i = 0; i < fn.length; i++) {
    const op = fn[i],
      a = args[i] ?? [];
    if (
      op === ops.save ||
      op === ops.paintFormXObjectBegin ||
      op === ops.beginGroup
    ) {
      stack.push({ ...state });
      // Form bounding boxes and transparency groups introduce clipping or
      // compositing that this text-only importer does not visually validate.
      if (op === ops.paintFormXObjectBegin && a[1]) state.clipped = true;
      if (op === ops.beginGroup) state.masked = true;
    } else if (
      op === ops.restore ||
      op === ops.paintFormXObjectEnd ||
      op === ops.endGroup
    ) {
      const previous = stack.pop();
      if (previous) state = previous;
    } else if (op === ops.setGState) {
      if (!Array.isArray(a[0]))
        throw new Error(
          'حالة عرض PDF غير مفهومة؛ اطلب PDF نصيًا بسيطًا أو Excel',
        );
      for (const entry of a[0] as unknown[]) {
        if (!Array.isArray(entry))
          throw new Error('حالة عرض PDF غير مفهومة؛ اطلب Excel');
        const [key, value] = entry;
        if (key === 'ca') state.fillAlpha = Number(value);
        else if (key === 'CA') state.strokeAlpha = Number(value);
        else if (key === 'SMask')
          state.masked = value !== false && value !== null;
        else if (key === 'BM') state.blended = value !== 'source-over';
        else if (key === 'TR') state.transferred = value !== null;
      }
    } else if (op === ops.setTextRenderingMode) state.mode = Number(a[0]);
    else if (op === ops.setFillRGBColor) state.fillColor = solidColor(a);
    else if (op === ops.setStrokeRGBColor) state.strokeColor = solidColor(a);
    else if ([ops.setFillColorN, ops.setFillTransparent].includes(op))
      state.fillColor = '';
    else if ([ops.setStrokeColorN, ops.setStrokeTransparent].includes(op))
      state.strokeColor = '';
    else if (op === ops.clip || op === ops.eoClip) state.clipped = true;
    else if (
      [
        ops.showText,
        ops.showSpacedText,
        ops.nextLineShowText,
        ops.nextLineSetSpacingShowText,
      ].includes(op)
    ) {
      if (state.mode === 3 || state.mode === 7)
        throw new Error(
          'PDF يحتوي نصًا مخفيًا أو طبقة OCR؛ اطلب كشفًا نصيًا أصليًا أو Excel',
        );
      if (
        state.clipped ||
        state.mode >= 4 ||
        state.mode < 0 ||
        !Number.isInteger(state.mode)
      )
        throw new Error(
          'PDF يحتوي نصًا مقصوصًا أو قناع قص غير مدعوم؛ اطلب نسخة نصية بسيطة أو Excel',
        );
      const fill = state.mode === 0 || state.mode === 2;
      const stroke = state.mode === 1 || state.mode === 2;
      if (
        state.masked ||
        state.blended ||
        state.transferred ||
        (fill && state.fillAlpha !== 1) ||
        (stroke && state.strokeAlpha !== 1)
      )
        throw new Error(
          'PDF يحتوي شفافية أو قناع عرض يؤثر في النص؛ لا يمكن إثبات ظهوره، اطلب Excel',
        );
      const visibleFill =
        fill && state.fillColor && state.fillColor !== '#ffffff';
      const visibleStroke =
        stroke && state.strokeColor && state.strokeColor !== '#ffffff';
      if (
        (!visibleFill && !visibleStroke) ||
        (fill && !state.fillColor) ||
        (stroke && !state.strokeColor)
      )
        throw new Error(
          'PDF يحتوي نصًا أبيض أو لون عرض غير قابل للتحقق؛ اطلب نسخة نصية بسيطة أو Excel',
        );
    } else if (
      [
        ops.paintImageXObject,
        ops.paintInlineImageXObject,
        ops.paintImageMaskXObject,
        ops.paintImageXObjectRepeat,
        ops.paintInlineImageXObjectGroup,
        ops.paintImageMaskXObjectRepeat,
        ops.paintImageMaskXObjectGroup,
        ops.paintSolidColorImageMask,
      ].includes(op)
    )
      throw new Error(
        'PDF يحتوي صورة قد تحمل بيانات لا تُقرأ نصيًا، حتى لو كانت صغيرة؛ OCR غير مدعوم حاليًا، اطلب PDF بلا صور أو Excel',
      );
  }
}
export function validateCuts(cuts: number[]): void {
  if (
    !Array.isArray(cuts) ||
    cuts.length > 19 ||
    cuts.some(
      (c, i) =>
        !Number.isFinite(c) ||
        c <= 0 ||
        c >= 100 ||
        (i > 0 && c <= cuts[i - 1]),
    )
  )
    throw new Error(
      'حدود أعمدة PDF يجب أن تكون نسبًا متزايدة بين 0 و100، بحد أقصى 19 حدًا',
    );
}
// Geometry only: never infer dates, signs, amounts, headers or missing cells.
export function layoutPdfPage(
  tokens: PdfToken[],
  cuts: number[],
  width: number,
) {
  validateCuts(cuts);
  if (!Number.isFinite(width) || width <= 0)
    throw new Error('عرض صفحة PDF غير صالح');
  const lines: { y: number; tokens: PdfToken[] }[] = [];
  for (const t of [...tokens].sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (
      ![t.x, t.y, t.width, t.height].every(Number.isFinite) ||
      t.width < 0 ||
      t.height <= 0 ||
      t.text.includes('\uFFFD')
    )
      throw new Error('ترميز أو موضع نص PDF غير موثوق؛ اطلب نسخة Excel');
    if (!t.text.trim()) continue;
    const previous = lines.at(-1);
    if (previous && Math.abs(previous.y - t.y) <= Math.min(1, t.height / 8))
      previous.tokens.push(t);
    else lines.push({ y: t.y, tokens: [t] });
  }
  return lines.map((line) => {
    const cells = Array.from(
      { length: cuts.length + 1 },
      () => [] as PdfToken[],
    );
    const issues: string[] = [];
    for (const t of line.tokens.sort((a, b) => a.x - b.x)) {
      const left = (t.x / width) * 100,
        right = ((t.x + t.width) / width) * 100;
      if (left < -0.1 || right > 100.1) issues.push('نص خارج حدود الصفحة');
      if (cuts.some((c) => c > left + 0.05 && c < right - 0.05))
        issues.push(
          'نص يعبر حد عمود؛ عدّل حدود أعمدة PDF دون تقسيم الرقم أو المرجع',
        );
      const col = cuts.findIndex((c) => left < c);
      cells[col < 0 ? cuts.length : col].push(t);
    }
    const row = cells.map((cell) => {
      for (let i = 1; i < cell.length; i++)
        if (cell[i].x < cell[i - 1].x + cell[i - 1].width - 0.2)
          issues.push('نصوص متراكبة؛ لا يمكن إثبات القراءة');
      return cell.map((t) => t.text).join(' ');
    });
    return { row, issues: [...new Set(issues)] };
  });
}
export async function readPdf(buffer: ArrayBuffer, cuts: number[] = []) {
  validateCuts(cuts);
  if (new TextDecoder().decode(buffer.slice(0, 5)) !== '%PDF-')
    throw new Error('محتوى الملف ليس PDF صالحًا');
  const { getDocument } = await getResolvedPDFJS();
  const loading = getDocument({
    data: new Uint8Array(buffer.slice(0)),
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: true,
    isOffscreenCanvasSupported: false,
    useWasm: false,
    stopAtErrors: true,
    enableXfa: false,
  });
  try {
    const doc = await loading.promise;
    if (doc.numPages < 1 || doc.numPages > 20)
      throw new Error('الحد الحالي 20 صفحة PDF؛ اطلب كشفًا أقصر أو Excel');
    if ((await doc.getPermissions()) !== null)
      throw new Error('PDF المحمي غير مدعوم؛ اطلب نسخة غير محمية من المورد');
    const layers = await doc.getOptionalContentConfig();
    if (layers.getOrder()?.length)
      throw new Error('PDF يحتوي طبقات عرض؛ اطلب نسخة مسطحة أو Excel');
    const sheet: SheetData = {
      name: 'PDF',
      rows: [],
      formulaRows: [],
      hiddenRows: [],
      rowIssues: {},
      rowPages: {},
    };
    let count = 0,
      chars = 0;
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      if (page.rotate !== 0)
        throw new Error(
          `الصفحة ${pageNo} مدورة؛ اطلب PDF باتجاه صحيح أو Excel`,
        );
      if ((await page.getAnnotations()).some((a) => a.subtype === 'Widget'))
        throw new Error('نماذج PDF التفاعلية غير مدعومة؛ اطلب نسخة مسطحة');
      const operators = await page.getOperatorList();
      const { OPS } = await getResolvedPDFJS();
      checkPdfOperators(
        OPS,
        operators.fnArray,
        operators.argsArray,
        (page.view[2] - page.view[0]) * (page.view[3] - page.view[1]),
      );
      const text = await page.getTextContent({ disableNormalization: true });
      const tokens: PdfToken[] = [];
      for (const item of text.items) {
        if (!('str' in item)) continue;
        if (++count > 100000 || (chars += item.str.length) > 2000000)
          throw new Error('نص PDF يتجاوز حدود المعالجة الآمنة');
        if (
          item.str.trim() &&
          (Math.abs(item.transform[1]) > 0.01 ||
            Math.abs(item.transform[2]) > 0.01 ||
            item.transform[0] <= 0 ||
            item.transform[3] <= 0)
        )
          throw new Error(`نص مائل أو معكوس في الصفحة ${pageNo}؛ اطلب Excel`);
        if (item.str.trim())
          tokens.push({
            text: item.str,
            x: item.transform[4] - page.view[0],
            y: item.transform[5],
            width: item.width,
            height: item.height,
          });
      }
      if (!tokens.length)
        throw new Error(
          `الصفحة ${pageNo} مصورة أو بلا نص قابل للتحقق. OCR غير متاح حاليًا؛ اطلب PDF نصيًا أو Excel`,
        );
      for (const line of layoutPdfPage(
        tokens,
        cuts,
        page.view[2] - page.view[0],
      )) {
        sheet.rows.push(line.row);
        const rn = String(sheet.rows.length);
        sheet.rowPages![rn] = pageNo;
        if (line.issues.length) sheet.rowIssues![rn] = line.issues;
        if (sheet.rows.length > 20000) throw new Error('الحد 20,000 صف مستخرج');
      }
      page.cleanup();
    }
    return { sheets: [sheet], pdf: { cuts: [...cuts], pages: doc.numPages } };
  } finally {
    await loading.destroy();
  }
}
