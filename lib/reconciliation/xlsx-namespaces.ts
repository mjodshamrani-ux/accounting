import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import type { SaxesTagNS } from 'saxes';

const SPREADSHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const MAX_XML_CHARS = 32 * 1024 * 1024;

const criticalNames = new Set([
  'workbook',
  'worksheet',
  'sheets',
  'sheet',
  'sheetData',
  'row',
  'c',
  'v',
  'f',
  'sst',
  'si',
  'is',
  't',
  'styleSheet',
  'cellXfs',
  'cellStyleXfs',
  'xf',
  'numFmts',
  'numFmt',
  'Relationships',
  'Relationship',
]);
const escapeText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (value: string) =>
  escapeText(value)
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');

type Part = { root: string; namespace: string };
export type NumericLexemeIssue = { cell: string; originalValue: string };
type PartInspection = {
  numericIssues: NumericLexemeIssue[];
  sheets: { name: string; relationship: string }[];
  relationships: { id: string; target: string }[];
};

// Compare decimal coefficients/exponents as strings. Converting both operands
// to Number would hide the very precision loss this check needs to detect.
function decimalIdentity(text: string): string {
  const negative = text.startsWith('-');
  const [mantissa, power = '0'] = text
    .replace(/^[+-]/, '')
    .toLowerCase()
    .split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  let digits = (whole + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  let exponent = Number(power) - fraction.length;
  const trimmed = digits.replace(/0+$/, '');
  exponent += digits.length - trimmed.length;
  digits = trimmed;
  return `${negative ? '-' : ''}${digits}e${exponent}`;
}
function supportedPart(path: string): Part | undefined {
  if (path === 'xl/workbook.xml')
    return { root: 'workbook', namespace: SPREADSHEET };
  if (path === 'xl/styles.xml')
    return { root: 'styleSheet', namespace: SPREADSHEET };
  if (path === 'xl/sharedStrings.xml')
    return { root: 'sst', namespace: SPREADSHEET };
  if (/^xl\/worksheets\/[^/]+\.xml$/i.test(path))
    return { root: 'worksheet', namespace: SPREADSHEET };
  if (
    path === '_rels/.rels' ||
    /^xl\/(?:[^/]+\/)*_rels\/[^/]+\.rels$/i.test(path)
  )
    return { root: 'Relationships', namespace: PACKAGE_RELATIONSHIP };
  return undefined;
}

/**
 * ExcelJS matches literal tag names, although x:worksheet and worksheet are
 * equivalent when their resolved namespace is SpreadsheetML. Canonicalize only
 * the XML vocabulary, never the text/numbers/formulas held inside those tags.
 */
function compatibleXml(
  xml: string,
  part: Part,
  render = false,
  inspection?: PartInspection,
): string | undefined {
  if (xml.length > MAX_XML_CHARS)
    throw new Error('جزء XML في Excel يتجاوز الحد المدعوم');
  const parser = new SaxesParser({ xmlns: true });
  const output: string[] = [];
  const stack: { name: string; bindings: Map<string, string> }[] = [];
  const foreignPrefixes = new Map<string, string>();
  let changed = false,
    rootSeen = false,
    outputChars = 0;
  const seenRows = new Set<string>();
  const seenCells = new Set<string>();
  let rowAddress = '';
  let previousColumn = 0;
  let cell:
    | { address: string; type: string; value: string; hasValue: boolean }
    | undefined;
  let inValue = false;
  const append = (value: string) => {
    if (!render) return;
    outputChars += value.length;
    if (outputChars > MAX_XML_CHARS)
      throw new Error('XML المتوافق يتجاوز الحد المدعوم');
    output.push(value);
  };
  const foreignPrefix = (uri: string) => {
    let prefix = foreignPrefixes.get(uri);
    if (!prefix) {
      prefix = `mizanNs${foreignPrefixes.size}`;
      foreignPrefixes.set(uri, prefix);
    }
    return prefix;
  };
  const name = (local: string, uri: string, attribute: boolean) => {
    if (!uri) return local;
    if (!attribute && uri === part.namespace) return local;
    if (uri === XML) return `xml:${local}`;
    if (uri === RELATIONSHIP) return `r:${local}`;
    return `${foreignPrefix(uri)}:${local}`;
  };
  parser.on('error', () => {
    throw new Error('XML داخل ملف Excel غير صالح؛ لم تُغيَّر البيانات');
  });
  parser.on('doctype', () => {
    throw new Error('تعريفات DTD داخل Excel غير مدعومة');
  });
  parser.on('xmldecl', () => append('<?xml version="1.0" encoding="UTF-8"?>'));
  parser.on('processinginstruction', (instruction) =>
    append(
      `<?${instruction.target}${instruction.body ? ` ${instruction.body}` : ''}?>`,
    ),
  );
  parser.on('comment', (text) => append(`<!--${text}-->`));
  parser.on('text', (text) => {
    if (inValue && cell) cell.value += text;
    append(escapeText(text));
  });
  // Converting CDATA to escaped text preserves the same XML character data.
  parser.on('cdata', (text) => {
    if (inValue && cell) cell.value += text;
    changed = true;
    append(escapeText(text));
  });
  parser.on('opentag', (tag: SaxesTagNS) => {
    if (!rootSeen) {
      rootSeen = true;
      if (tag.local !== part.root || tag.uri !== part.namespace)
        throw new Error(
          'مساحة أسماء XML في Excel غير مدعومة؛ يلزم ملف XLSX قياسي',
        );
    }
    if (stack.length >= 128)
      throw new Error('تداخل XML داخل Excel يتجاوز الحد المدعوم');
    if (criticalNames.has(tag.local) && tag.uri !== part.namespace)
      throw new Error(
        'وسم بيانات Excel يستخدم مساحة أسماء غير صحيحة؛ لا يمكن الوثوق بقراءته',
      );
    const canonical = name(tag.local, tag.uri, false);
    const attribute = (local: string, uri = '') =>
      Object.values(tag.attributes).find(
        (value) => value.local === local && value.uri === uri,
      )?.value ?? '';
    if (part.root === 'workbook' && canonical === 'sheet')
      inspection?.sheets.push({
        name: attribute('name'),
        relationship: attribute('id', RELATIONSHIP),
      });
    if (
      part.root === 'Relationships' &&
      canonical === 'Relationship' &&
      attribute('Type').endsWith('/worksheet')
    )
      inspection?.relationships.push({
        id: attribute('Id'),
        target: attribute('Target'),
      });
    if (
      part.root === 'worksheet' &&
      canonical === 'row' &&
      stack.at(-1)?.name === 'sheetData'
    ) {
      const rawRow = attribute('r');
      rowAddress = /^\d+$/.test(rawRow) ? String(Number(rawRow)) : rawRow;
      previousColumn = 0;
      if (rowAddress && seenRows.has(rowAddress))
        throw new Error(
          `صف Excel مكرر داخل XML (${rowAddress})؛ لا يمكن إسقاط إحدى النسختين`,
        );
      if (rowAddress) seenRows.add(rowAddress);
    }
    if (
      part.root === 'worksheet' &&
      canonical === 'c' &&
      stack.at(-1)?.name === 'row'
    ) {
      const rawAddress = attribute('r');
      const coordinate = /^([A-Z]+)(\d+)$/.exec(rawAddress);
      let address = coordinate
        ? `${coordinate[1]}${Number(coordinate[2])}`
        : rawAddress;
      if (coordinate)
        previousColumn = [...coordinate[1]].reduce(
          (n, char) => n * 26 + char.charCodeAt(0) - 64,
          0,
        );
      else if (!rawAddress && previousColumn && rowAddress) {
        // ExcelJS supports an omitted r after an explicit cell by taking the
        // next column. Include that same deterministic address in uniqueness.
        let column = ++previousColumn;
        let letters = '';
        while (column) {
          column--;
          letters = String.fromCharCode(65 + (column % 26)) + letters;
          column = Math.floor(column / 26);
        }
        address = `${letters}${rowAddress}`;
      }
      if (address && seenCells.has(address))
        throw new Error(
          `خلية Excel مكررة داخل XML (${address})؛ لا يمكن اختيار إحدى القيمتين`,
        );
      if (address) seenCells.add(address);
      if (address && rowAddress && /\d+$/.exec(address)?.[0] !== rowAddress)
        throw new Error(
          `موضع خلية Excel ${address} لا يطابق صف المصدر ${rowAddress}`,
        );
      cell = {
        address,
        type: attribute('t') || 'n',
        value: '',
        hasValue: false,
      };
      if (!['n', 's', 'str', 'inlineStr', 'b', 'e', 'd'].includes(cell.type))
        throw new Error(
          `نوع خلية Excel ${cell.address} غير صالح؛ لا يمكن تحويله إلى رقم افتراضي`,
        );
      // ExcelJS treats ISO-date cells as numbers and parseFloat truncates them
      // to the year. Keep the complete lexical date as text instead: date-only
      // values are supported by the date parser, other forms require review.
      if (cell.type === 'd') changed = true;
    }
    if (
      part.root === 'worksheet' &&
      canonical === 'v' &&
      stack.at(-1)?.name === 'c' &&
      cell
    ) {
      if (cell.hasValue)
        throw new Error(`خلية Excel ${cell.address} تحتوي أكثر من قيمة XML`);
      cell.hasValue = true;
      inValue = true;
    }
    if (tag.uri === part.namespace && canonical !== tag.name) changed = true;
    const bindings = new Map(stack.at(-1)?.bindings ?? [['xml', XML]]);
    const declarations = new Map<string, string>();
    // Keep original aliases as well: extension attributes can contain QNames.
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.uri === XMLNS) {
        const prefix = attribute.name === 'xmlns' ? '' : attribute.local;
        declarations.set(prefix, attribute.value);
        bindings.set(prefix, attribute.value);
      }
    }
    const bind = (qualified: string, uri: string, attribute: boolean) => {
      const prefix = qualified.includes(':') ? qualified.split(':')[0] : '';
      if (!prefix && attribute) return;
      if (bindings.get(prefix) !== uri) {
        declarations.set(prefix, uri);
        bindings.set(prefix, uri);
      }
    };
    bind(canonical, tag.uri, false);
    const attributes: string[] = [];
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.uri === XMLNS) continue;
      const qualified = name(attribute.local, attribute.uri, true);
      if (attribute.uri === RELATIONSHIP && qualified !== attribute.name)
        changed = true;
      bind(qualified, attribute.uri, true);
      const value =
        part.root === 'worksheet' &&
        canonical === 'c' &&
        attribute.local === 't' &&
        !attribute.uri &&
        attribute.value === 'd'
          ? 'str'
          : attribute.value;
      attributes.push(`${qualified}="${escapeAttribute(value)}"`);
    }
    const namespaces = Array.from(
      declarations,
      ([prefix, uri]) =>
        `${prefix ? `xmlns:${prefix}` : 'xmlns'}="${escapeAttribute(uri)}"`,
    );
    append(
      `<${canonical}${[...namespaces, ...attributes].map((attribute) => ` ${attribute}`).join('')}>`,
    );
    stack.push({ name: canonical, bindings });
  });
  parser.on('closetag', () => {
    const closing = stack.pop()!.name;
    if (closing === 'v') inValue = false;
    if (closing === 'c' && cell) {
      const raw = cell.value.trim();
      if (
        cell.type === 's' &&
        cell.hasValue &&
        (!/^\+?\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      )
        throw new Error(
          `فهرس نص Excel غير صالح في ${cell.address}؛ لم يُقبل جزء منه كمعرف`,
        );
      if (cell.type === 'n' && cell.hasValue && raw) {
        if (
          raw.length > 4096 ||
          !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) ||
          !Number.isFinite(Number(raw))
        )
          throw new Error(
            `قيمة رقمية غير صالحة في XML للخلية ${cell.address}؛ لم يُقبل جزء منها كرقم`,
          );
        if (decimalIdentity(raw) !== decimalIdentity(String(Number(raw))))
          inspection?.numericIssues.push({
            cell: cell.address,
            originalValue: raw,
          });
      }
      cell = undefined;
    }
    if (closing === 'row') rowAddress = '';
    append(`</${closing}>`);
  });
  parser.write(xml).close();
  if (!rootSeen || stack.length) throw new Error('جزء XML في Excel غير مكتمل');
  if (!changed) return undefined;
  return render ? output.join('') : compatibleXml(xml, part, true);
}

/** Call only after the original ZIP has passed size, path, CRC and content checks. */
export async function prepareXlsxForExcelJs(
  original: ArrayBuffer,
  numericIssuesBySheet?: Map<string, NumericLexemeIssue[]>,
): Promise<ArrayBuffer> {
  const archive = await JSZip.loadAsync(original);
  let changed = false;
  const inspections = new Map<string, PartInspection>();
  for (const [path, entry] of Object.entries(archive.files)) {
    const part = supportedPart(path);
    if (entry.dir || !part) continue;
    const bytes = await entry.async('uint8array');
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const inspection: PartInspection = {
      numericIssues: [],
      sheets: [],
      relationships: [],
    };
    const compatible = compatibleXml(xml, part, false, inspection);
    inspections.set(path, inspection);
    if (compatible !== undefined) {
      archive.file(path, compatible);
      changed = true;
    }
  }
  if (numericIssuesBySheet) {
    const sheets = inspections.get('xl/workbook.xml')?.sheets ?? [];
    const relationships =
      inspections.get('xl/_rels/workbook.xml.rels')?.relationships ?? [];
    for (const sheet of sheets) {
      const target = relationships.find(
        (rel) => rel.id === sheet.relationship,
      )?.target;
      if (!target) continue;
      const path: string[] = [];
      for (const segment of (target.startsWith('/')
        ? target.slice(1)
        : `xl/${target}`
      ).split('/')) {
        if (segment === '..') path.pop();
        else if (segment !== '.') path.push(segment);
      }
      const issues = inspections.get(path.join('/'))?.numericIssues;
      if (issues?.length) numericIssuesBySheet.set(sheet.name, issues);
    }
  }
  if (!changed) return original;
  return archive.generateAsync({ type: 'arraybuffer', compression: 'STORE' });
}
