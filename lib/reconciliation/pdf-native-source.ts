import type { PdfToken } from './pdf.ts';

/** Opt-in glyph evidence. Offsets are UTF-16 offsets into the original paint text. */
export type PdfLiteralTrace = {
  version: 'native-pdf-literals-1';
  text: string;
  items: { item: number; start: number; end: number }[];
  operators: {
    operator: number;
    start: number;
    end: number;
    adjusted: boolean;
  }[];
};
export type NativePdfLiteralSource = Omit<NativePdfSource, 'pages'> & {
  literalVersion: 'native-pdf-literals-1';
  pages: (NativePdfSource['pages'][number] & { literals: PdfLiteralTrace })[];
};

/**
 * Native PDF text after the shared paint/font/stream/visibility guards.
 * This is a source reading, never an accounting result or a completeness claim.
 * Coordinates use PDF units relative to the lower-left of the visible page.
 * item is the 1-based original PDF.js text-content item, including gaps for
 * whitespace/non-text items; it is not a reconstructed row or a financial ID.
 * text retains the existing proved numeric glyph-order correction. When it
 * differs, extractionText and glyphText preserve both readings.
 */
export type NativePdfSource = {
  version: 'native-pdf-source-1';
  sha256: string;
  byteLength: number;
  coordinateSystem: 'visible-page-bottom-left-pdf-units';
  readingIssues: { page: number; line: number; reasons: string[] }[];
  pages: {
    page: number;
    /** Original visible bounds in absolute PDF coordinates. */
    view: [number, number, number, number];
    width: number;
    height: number;
    tokens: (PdfToken & { item: number })[];
  }[];
};
