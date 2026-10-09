import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import { assertBankNativeDisplay } from './bank-native-display.ts';
import { PG_HEADERS } from './payment-gateway.ts';
import type { SourceFile } from './types.ts';
const fail = (): never => {
  throw Error('PG_NATIVE_DISPLAY');
};
// The established display guard supplies fonts/theme/visibility/geometry checks.
// This family adds role-specific literal types and formatting, never a guessed
// accounting interpretation of arbitrary Excel display formats.
export async function assertGatewayNative(
  file: SourceFile,
  source?: number,
  decimals = 2,
) {
  if (!/\.xlsx$/i.test(file.name)) return;
  if (decimals !== 2 || !(file.original instanceof ArrayBuffer)) fail();
  await assertBankNativeDisplay(file);
  const zip = await JSZip.loadAsync(file.original!);
  const worksheets = Object.values(zip.files).filter((f) =>
    /^xl\/worksheets\/[^/]+\.xml$/i.test(f.name),
  );
  if (worksheets.length !== 1 || file.sheets.length !== 1) fail();
  const shared = zip.file('xl/sharedStrings.xml');
  if (shared) {
    const strings = new SaxesParser({ xmlns: true });
    const stack: string[] = [];
    let textCount = 0;
    strings.on('doctype', fail);
    strings.on('opentag', (t) => {
      const parent = stack.at(-1);
      if (
        !(
          (parent === undefined && t.local === 'sst') ||
          (parent === 'sst' && t.local === 'si') ||
          (parent === 'si' && t.local === 't')
        )
      )
        fail();
      if (t.local === 'si') textCount = 0;
      if (t.local === 't' && ++textCount !== 1) fail();
      stack.push(t.local);
    });
    strings.on('closetag', (t) => {
      if (t.local === 'si' && textCount !== 1) fail();
      stack.pop();
    });
    strings.write(await shared.async('string')).close();
  }
  const xfs: number[] = [];
  let inside = false;
  const style = new SaxesParser({ xmlns: true });
  style.on('doctype', fail);
  style.on('opentag', (t) => {
    if (t.local === 'cellXfs') inside = true;
    if (inside && t.local === 'xf')
      xfs.push(Number(t.attributes.numFmtId?.value ?? 0));
  });
  style.on('closetag', (t) => {
    if (t.local === 'cellXfs') inside = false;
  });
  style
    .write(await (zip.file('xl/styles.xml') ?? fail()).async('string'))
    .close();
  const head = file.sheets[0].rows[0] ?? [];
  source ??= PG_HEADERS.findIndex(
    (h) => head.length === h.length && h.every((v) => head.includes(v)),
  );
  if (source < 0 || source > 3) fail();
  if (
    head.length !== PG_HEADERS[source].length ||
    !PG_HEADERS[source].every((h) => head.includes(h))
  )
    fail();
  const money =
    source < 2
      ? ['Amount']
      : source === 2
        ? ['Gross sales', 'Refunds', 'Fees', 'Net']
        : ['Credit'];
  const dates = [
    'Period start',
    'Period end',
    'As of',
    'Posting date',
    'Settlement date',
    'Value date',
    'Valid from',
    'Valid to',
  ];
  const sheet = new SaxesParser({ xmlns: true });
  sheet.on('doctype', fail);
  let inlineDepth = 0,
    inlineTexts = 0;
  let dateSerial = false,
    readingValue = false,
    serial = '';
  sheet.on('opentag', (t) => {
    if (inlineDepth) {
      if (inlineDepth !== 1 || t.local !== 't' || ++inlineTexts !== 1) fail();
      inlineDepth++;
    } else if (t.local === 'is') {
      inlineDepth = 1;
      inlineTexts = 0;
    }
    const attr = (k: string) => {
      const a = t.attributes[k];
      return typeof a === 'object' ? a.value : undefined;
    };
    if (t.local === 'col' && (xfs[Number(attr('style') ?? 0)] ?? fail()) !== 0)
      fail();
    if (t.local === 'f') fail();
    if (t.local === 'v') {
      readingValue = dateSerial;
      serial = '';
    }
    if (t.local !== 'c') return;
    const ref = attr('r')?.match(/^([A-Z]+)([1-9]\d*)$/) ?? fail();
    let column = 0;
    for (const c of ref[1]) column = column * 26 + c.charCodeAt(0) - 64;
    const field = head[column - 1] ?? fail();
    const fmt = xfs[Number(attr('s') ?? 0)] ?? fail();
    const numeric = attr('t') === undefined || attr('t') === 'n';
    const literal = ['s', 'inlineStr'].includes(attr('t') ?? '');
    dateSerial =
      Number(ref[2]) > 1 && dates.includes(field) && numeric && fmt === 14;
    if (Number(ref[2]) === 1) {
      if (!literal || fmt !== 0) fail();
    } else if (money.includes(field)) {
      if (!numeric || fmt !== 2) fail();
    } else if (dates.includes(field)) {
      if (!(numeric && fmt === 14) && !(literal && fmt === 0)) fail();
    } else if (!literal || fmt !== 0) fail();
  });
  sheet.on('text', (text) => {
    if (readingValue) serial += text;
  });
  sheet.on('closetag', (t) => {
    if (t.local === 'v' && readingValue) {
      if (
        !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(serial) ||
        !Number.isSafeInteger(Number(serial))
      )
        fail();
      readingValue = false;
    }
    if (inlineDepth) {
      inlineDepth--;
      if (t.local === 'is' && inlineTexts !== 1) fail();
    }
  });
  sheet.write(await worksheets[0].async('string')).close();
}
