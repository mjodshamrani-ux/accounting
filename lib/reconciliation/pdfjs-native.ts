import { resolvePDFJSImport, getResolvedPDFJS } from 'unpdf';

// Use unpdf's normal environment stubs and memoization. The audited bundle
// retains the pinned operator-stream API and embedded local worker.
let ready: Promise<void> | undefined;
export async function getNativePDFJS() {
  ready ??= resolvePDFJSImport(() => import('./pdfjs-native.generated.mjs'), {
    reload: true,
  });
  await ready;
  return getResolvedPDFJS();
}
