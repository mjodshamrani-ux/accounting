import JSZip from 'jszip';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { readFile, validateCellText } from './io.ts';
import { MAX_FILE_BYTES, MAX_ROWS, type SourceFile } from './types.ts';
import { isArScopeReading, type ArReading } from './ar.ts';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const DOCUMENT_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL =
  'http://schemas.openxmlformats.org/package/2006/relationships';
function fail(code = 'SOURCE'): never {
  throw new Error(`AR_${code}`);
}
const attribute = (tag: SaxesTagNS, key: string) => {
  const value = tag.attributes[key];
  return typeof value === 'object' ? value.value : undefined;
};
function parseXml(
  xml: string,
  open: (tag: SaxesTagNS) => void,
  text?: (value: string) => void,
  close?: (tag: SaxesTagNS) => void,
) {
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  parser.on('doctype', () => fail());
  parser.on('opentag', (tag) => {
    if (++depth > 128) fail();
    open(tag);
  });
  parser.on('closetag', (tag) => {
    depth--;
    close?.(tag);
  });
  if (text) {
    parser.on('text', text);
    parser.on('cdata', text);
  }
  parser.write(xml).close();
}
// The new family declares comma grammar. Keep every original logical record,
// including [] blank records; delimiter inference is not an authority here.
function scopeCsv(original: ArrayBuffer) {
  const input = new TextDecoder('utf-8', { fatal: true })
    .decode(original)
    .replace(/^\uFEFF/, '');
  validateCellText(input);
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false,
    touched = false;
  const finish = () => {
    if (rows.length >= MAX_ROWS + 30) fail('SOURCE_LIMIT');
    rows.push(touched ? [...row, cell] : []);
    row = [];
    cell = '';
    closed = false;
    touched = false;
  };
  const append = (value: string) => {
    if (cell.length + value.length > 4096) fail('CELL_LIMIT');
    cell += value;
  };
  for (let index = 0; index < input.length; index++) {
    const value = input[index];
    if (quoted) {
      if (value === '"') {
        if (input[index + 1] === '"') {
          append('"');
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else append(value);
    } else if (value === '"') {
      if (cell || closed) fail('CSV');
      quoted = true;
      touched = true;
    } else if (value === ',') {
      if (row.length >= 99) fail('SOURCE_LIMIT');
      row.push(cell);
      cell = '';
      closed = false;
      touched = true;
    } else if (value === '\r' || value === '\n') {
      finish();
      if (value === '\r' && input[index + 1] === '\n') index++;
    } else {
      if (closed) fail('CSV');
      append(value);
      touched = true;
    }
  }
  if (quoted) fail('CSV');
  if (touched) finish();
  return rows;
}
/** Read authoritative original bytes. Only an explicit scope-details reading
 * enables raw numeric spellings; the legacy reader and original bytes stay exact. */
export async function readArFile(
  name: string,
  original: ArrayBuffer,
  reading?: ArReading,
): Promise<SourceFile> {
  if (
    typeof name !== 'string' ||
    name.length > 255 ||
    !/\.(csv|xlsx)$/i.test(name) ||
    !(original instanceof ArrayBuffer) ||
    !original.byteLength ||
    original.byteLength > MAX_FILE_BYTES
  )
    fail();
  const captured = original.slice(0);
  reading = structuredClone(reading);
  if (!isArScopeReading(reading)) return readFile(name, captured);
  if (/\.csv$/i.test(name)) {
    const rows = scopeCsv(captured);
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', captured)),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
    return {
      name,
      original: captured,
      sha256: hash,
      sheets: [{ name: 'CSV', rows, formulaRows: [], hiddenRows: [] }],
    };
  }
  // Generic reading verifies ZIP expansion, namespaces/relationships, geometry,
  // display and native errors. Original XML is consulted only after that guard.
  const file = await readFile(name, captured);
  if (
    !Number.isSafeInteger(reading.sheet) ||
    reading.sheet < 0 ||
    !file.sheets[reading.sheet]
  )
    return file;
  const zip = await JSZip.loadAsync(captured);
  const sheetRelations: { name: string; id: string }[] = [];
  const targets = new Map<string, string>();
  parseXml(await zip.file('xl/workbook.xml')!.async('string'), (tag) => {
    if (tag.uri !== MAIN || tag.local !== 'sheet') return;
    const rel = Object.values(tag.attributes).find(
      (attr) =>
        typeof attr === 'object' &&
        attr.uri === DOCUMENT_REL &&
        attr.local === 'id',
    );
    if (!rel || typeof rel !== 'object') fail();
    sheetRelations.push({
      name: attribute(tag, 'name') ?? fail(),
      id: rel.value,
    });
  });
  parseXml(
    await zip.file('xl/_rels/workbook.xml.rels')!.async('string'),
    (tag) => {
      if (tag.uri !== PACKAGE_REL || tag.local !== 'Relationship') return;
      const id = attribute(tag, 'Id'),
        target = attribute(tag, 'Target');
      if (!id || !target || attribute(tag, 'TargetMode') === 'External') return;
      targets.set(id, target);
    },
  );
  const selected = sheetRelations[reading.sheet],
    sheet = file.sheets[reading.sheet];
  if (!selected || selected.name !== sheet.name) fail();
  const target = targets.get(selected.id) ?? fail();
  const part = new URL(target, 'https://ar.invalid/xl/').pathname.slice(1);
  if (!part.startsWith('xl/') || !zip.file(part)) fail();
  // Rebuild literal cells, rather than patching only monetary values. ExcelJS
  // propagates merged masters and interprets booleans/date/number formats; those
  // interpretations must never replace rejected-source inventory evidence.
  const decodeXstring = (value: string) =>
    value.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  const strings: string[] = [];
  const shared = zip.file('xl/sharedStrings.xml');
  if (shared) {
    let value = '',
      inText = false,
      phonetic = 0;
    parseXml(
      await shared.async('string'),
      (tag) => {
        if (tag.uri !== MAIN) return;
        if (tag.local === 'si') value = '';
        if (tag.local === 'rPh') phonetic++;
        if (tag.local === 't' && !phonetic) inText = true;
      },
      (text) => {
        if (inText) value += text;
      },
      (tag) => {
        if (tag.uri !== MAIN) return;
        if (tag.local === 't') inText = false;
        if (tag.local === 'rPh') phonetic--;
        if (tag.local === 'si') strings.push(decodeXstring(value));
      },
    );
  }
  const rawRows = sheet.rows.map((row) => row.map(() => ''));
  let cell:
    | {
        row: number;
        column: number;
        type: string;
        raw: string;
        inline: string;
        formula: boolean;
      }
    | undefined;
  let inValue = false,
    inText = false,
    phonetic = 0;
  parseXml(
    await zip.file(part)!.async('string'),
    (tag) => {
      if (tag.uri !== MAIN) return;
      if (tag.local === 'c') {
        const ref =
          attribute(tag, 'r')?.match(/^([A-Z]+)([1-9]\d*)$/) ?? fail();
        let column = 0;
        for (const letter of ref[1])
          column = column * 26 + letter.charCodeAt(0) - 64;
        const row = Number(ref[2]);
        if (row > MAX_ROWS + 30 || column > 100) fail('SOURCE_LIMIT');
        cell = {
          row,
          column,
          type: attribute(tag, 't') ?? 'n',
          raw: '',
          inline: '',
          formula: false,
        };
      }
      if (tag.local === 'f' && cell) cell.formula = true;
      if (tag.local === 'v' && cell) inValue = true;
      if (tag.local === 'rPh') phonetic++;
      if (tag.local === 't' && cell && !phonetic) inText = true;
    },
    (value) => {
      if (cell && inValue) cell.raw += value;
      if (cell && inText) cell.inline += value;
    },
    (tag) => {
      if (tag.uri !== MAIN) return;
      if (tag.local === 'v') inValue = false;
      if (tag.local === 't') inText = false;
      if (tag.local === 'rPh') phonetic--;
      if (tag.local === 'c' && cell) {
        const raw =
          cell.type === 's'
            ? cell.raw === ''
              ? ''
              : /^\d+$/.test(cell.raw)
                ? (strings[Number(cell.raw)] ?? fail())
                : fail()
            : cell.type === 'inlineStr'
              ? decodeXstring(cell.inline)
              : cell.type === 'str'
                ? decodeXstring(cell.raw)
                : cell.raw;
        if (raw.length > 4096) fail('CELL_LIMIT');
        validateCellText(raw);
        if (!rawRows[cell.row - 1]) fail();
        rawRows[cell.row - 1][cell.column - 1] = raw;
        if (cell.type === 'n' && cell.raw !== '' && !cell.formula) {
          // Retain numeric origin even when the generic reader converted a date.
          sheet.numericCells ??= {};
          sheet.numericCells[`${cell.row}:${cell.column}`] ??= {
            value: Number(cell.raw),
            format: '',
          };
        }
        cell = undefined;
      }
    },
  );
  sheet.rows = rawRows;
  return file;
}
