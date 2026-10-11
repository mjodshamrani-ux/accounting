import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import { assertBankNativeDisplay } from './bank-native-display.ts';
import { PG_HEADERS, PG_SIGNED_HEADERS } from './payment-gateway.ts';
import { signedGatewayMoney } from './payment-gateway-signed.ts';
import { MAX_ROWS, type SourceFile } from './types.ts';
const fail = (): never => {
  throw Error('PG_NATIVE_DISPLAY');
};
// Run after bounded ZIP checks and before any numeric coercion. Namespace and
// relationship validation still runs before ExcelJS can read the package.
// Only a declared monetary column grants authority to its original XML v text.
export async function gatewayNativeMoneyLexemes(
  original: ArrayBuffer,
  strictSignedBatch = false,
) {
  const zip = await JSZip.loadAsync(original);
  const worksheets = Object.values(zip.files).filter((f) =>
    /^xl\/worksheets\/[^/]+\.xml$/i.test(f.name),
  );
  if (worksheets.length !== 1) fail();
  const strings: string[] = [];
  const shared = zip.file('xl/sharedStrings.xml');
  if (shared) {
    const p = new SaxesParser({ xmlns: true });
    let inText = false,
      depth = 0,
      value = '';
    p.on('doctype', fail);
    p.on('opentag', (t) => {
      if (++depth > 128) fail();
      if (t.local === 'si') value = '';
      if (t.local === 't') inText = true;
    });
    const capture = (s: string) => {
      if (inText) value += s;
    };
    p.on('text', capture);
    p.on('cdata', capture);
    p.on('closetag', (t) => {
      depth--;
      if (t.local === 't') inText = false;
      if (t.local === 'si') strings.push(value);
    });
    p.write(await shared.async('string')).close();
  }
  type Cell = {
    row: number;
    column: number;
    type: string;
    value: string;
    inline: string;
  };
  const cells: Cell[] = [];
  const p = new SaxesParser({ xmlns: true });
  let cell: Cell | undefined,
    inValue = false,
    inText = false,
    merged = false,
    depth = 0;
  p.on('doctype', fail);
  p.on('opentag', (t) => {
    if (++depth > 128) fail();
    if (t.local === 'f') fail();
    if (t.local === 'mergeCell') merged = true;
    if (t.local === 'c') {
      const attr = (k: string) => {
        const a = t.attributes[k];
        return typeof a === 'object' ? a.value : undefined;
      };
      const ref = attr('r')?.match(/^([A-Z]+)([1-9]\d*)$/) ?? fail();
      let column = 0;
      for (const c of ref[1]) column = column * 26 + c.charCodeAt(0) - 64;
      if (column > 100 || Number(ref[2]) > MAX_ROWS + 30) fail();
      cell = {
        row: Number(ref[2]),
        column,
        type: attr('t') ?? 'n',
        value: '',
        inline: '',
      };
    }
    if (t.local === 'v') inValue = true;
    if (t.local === 't') inText = true;
  });
  const capture = (s: string) => {
    if (cell && inValue) cell.value += s;
    if (cell && inText) cell.inline += s;
  };
  p.on('text', capture);
  p.on('cdata', capture);
  p.on('closetag', (t) => {
    depth--;
    if (t.local === 'v') inValue = false;
    if (t.local === 't') inText = false;
    if (t.local === 'c' && cell) {
      cells.push(cell);
      if (cells.length > 1_000_000) fail();
      cell = undefined;
    }
  });
  p.write(await worksheets[0].async('string')).close();
  const literal = (c: Cell) =>
    c.type === 's'
      ? (strings[Number(c.value)] ?? fail())
      : c.type === 'inlineStr'
        ? c.inline
        : c.value;
  const headers: string[] = [];
  for (const c of cells.filter((c) => c.row === 1))
    headers[c.column - 1] = literal(c);
  const signed =
    headers.length === PG_SIGNED_HEADERS.length &&
    PG_SIGNED_HEADERS.every((h) => headers.includes(h));
  if (merged && (signed || strictSignedBatch)) fail();
  const source = signed
    ? 0
    : PG_HEADERS.findIndex(
        (h) =>
          headers.length === h.length && h.every((v) => headers.includes(v)),
      );
  if (source < 0 || new Set(headers).size !== headers.length) fail();
  const fields =
    source === 0
      ? [signed ? 'Signed amount' : 'Amount']
      : source === 1
        ? ['Amount']
        : source === 2
          ? ['Gross sales', 'Refunds', 'Fees', 'Net']
          : ['Credit'];
  const kinds = new Map<number, string>();
  if (signed)
    for (const c of cells) {
      if (c.row > 1 && headers[c.column - 1] === 'Kind')
        kinds.set(c.row, literal(c));
      if (
        c.row > 1 &&
        headers[c.column - 1] === 'Currency' &&
        literal(c) !== 'SAR'
      )
        fail();
    }
  const lexemes = new Map<string, string>();
  for (const c of signed || strictSignedBatch ? cells : []) {
    if (c.row === 1 || !fields.includes(headers[c.column - 1])) continue;
    if (c.type !== 'n') fail();
    const raw = c.value;
    if (signed) {
      const kind = kinds.get(c.row) ?? fail();
      try {
        signedGatewayMoney(raw, 2, kind, false);
      } catch {
        fail();
      }
      lexemes.set(`${c.row}:${c.column}`, raw);
    } else if (
      !/^[0-9]+(?:\.[0-9]+)?$/.test(raw) ||
      (raw.split('.')[1]?.length ?? 0) > 2
    )
      fail();
  }
  return lexemes;
}
// The established display guard supplies fonts/theme/visibility/geometry checks.
// This family adds role-specific literal types and formatting, never a guessed
// accounting interpretation of arbitrary Excel display formats.
export async function assertGatewayNative(
  file: SourceFile,
  source?: number,
  decimals = 2,
  strictSignedBatch = false,
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
  const signed =
    head.length === PG_SIGNED_HEADERS.length &&
    PG_SIGNED_HEADERS.every((h) => head.includes(h));
  source ??= PG_HEADERS.findIndex(
    (h) => head.length === h.length && h.every((v) => head.includes(v)),
  );
  if (signed && source === -1) source = 0;
  if (source < 0 || source > 3) fail();
  if (
    head.length !==
      (signed && source === 0 ? PG_SIGNED_HEADERS : PG_HEADERS[source])
        .length ||
    !(signed && source === 0 ? PG_SIGNED_HEADERS : PG_HEADERS[source]).every(
      (h) => head.includes(h),
    )
  )
    fail();
  const money =
    source < 2
      ? [signed && source === 0 ? 'Signed amount' : 'Amount']
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
  const lexemes = await gatewayNativeMoneyLexemes(
    file.original!,
    strictSignedBatch,
  );
  for (const [position, lexeme] of lexemes) {
    const [row, column] = position.split(':').map(Number);
    if (file.sheets[0].rows[row - 1]?.[column - 1] !== lexeme) fail();
  }
}
