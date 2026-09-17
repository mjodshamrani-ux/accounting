import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import type { SaxesTagNS } from 'saxes';
import { MAX_ROWS } from './types.ts';

const SPREADSHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const MAX_XML_CHARS = 32 * 1024 * 1024;
const worksheetParents: Record<string, string> = {
  sheetData: 'worksheet',
  row: 'sheetData',
  c: 'row',
  v: 'c',
  f: 'c',
  is: 'c',
};
const singletonParts: Record<string, ReadonlySet<string>> = {
  workbook: new Set(['sheets', 'workbookPr']),
  styleSheet: new Set([
    'numFmts',
    'fonts',
    'fills',
    'borders',
    'cellStyleXfs',
    'cellXfs',
    'cellStyles',
    'dxfs',
  ]),
};

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
  const singletonContainers = new Set<string>();
  const sheetIds = new Set<string>();
  const sheetNames = new Set<string>();
  const relationshipIds = new Set<string>();
  const formatIds = new Set<string>();
  let sheetDataSeen = false;
  let rowAddress = '';
  let previousColumn = 0;
  let cell:
    | {
        address: string;
        type: string;
        value: string;
        hasValue: boolean;
        hasInline: boolean;
        hasFormula: boolean;
      }
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
    if (singletonParts[part.root]?.has(canonical)) {
      if (
        stack.at(-1)?.name !== part.root ||
        singletonContainers.has(canonical)
      )
        throw new Error(
          'بنية Excel متعارضة أو مكررة؛ لا يمكن إسقاط ورقة أو تغيير تفسير قيمة',
        );
      singletonContainers.add(canonical);
    }
    // ExcelJS is intentionally permissive about malformed XML structure: a
    // second sheetData replaces the first, and mixed v/is payloads concatenate.
    // Reject those ambiguities before any values can disappear or change.
    if (part.root === 'worksheet') {
      const parent = stack.at(-1)?.name;
      if (worksheetParents[canonical] && parent !== worksheetParents[canonical])
        throw new Error(
          'بنية جدول Excel غير صالحة؛ لا يمكن إسقاط بيانات خارج موضعها',
        );
      if (canonical === 'sheetData') {
        if (sheetDataSeen)
          throw new Error(
            'جدول sheetData مكرر في ورقة Excel؛ لا يمكن اختيار جدول وإسقاط الآخر',
          );
        sheetDataSeen = true;
      }
    }
    const attribute = (local: string, uri = '') =>
      Object.values(tag.attributes).find(
        (value) => value.local === local && value.uri === uri,
      )?.value ?? '';
    if (
      part.root === 'styleSheet' &&
      canonical === 'numFmt' &&
      stack.at(-1)?.name === 'numFmts'
    ) {
      const rawId = attribute('numFmtId');
      const id = String(Number(rawId));
      if (
        !/^\d+$/.test(rawId) ||
        !Number.isSafeInteger(Number(rawId)) ||
        formatIds.has(id)
      )
        throw new Error(
          'معرّف تنسيق Excel مكرر أو غير صالح؛ لا يمكن تغيير معنى الرقم أو التاريخ',
        );
      formatIds.add(id);
    }
    if (part.root === 'workbook' && canonical === 'sheet') {
      const rawId = attribute('sheetId');
      const id = String(Number(rawId));
      const sheetName = attribute('name');
      if (
        stack.at(-1)?.name !== 'sheets' ||
        !/^\d+$/.test(rawId) ||
        !Number.isSafeInteger(Number(rawId)) ||
        Number(rawId) < 1 ||
        !sheetName.trim() ||
        !attribute('id', RELATIONSHIP) ||
        sheetIds.has(id) ||
        sheetNames.has(sheetName.toLowerCase())
      )
        throw new Error(
          'معرّف أو اسم ورقة Excel مكرر أو غير صالح؛ لا يمكن إسقاط إحدى الأوراق',
        );
      sheetIds.add(id);
      sheetNames.add(sheetName.toLowerCase());
      inspection?.sheets.push({
        name: sheetName,
        relationship: attribute('id', RELATIONSHIP),
      });
    }
    if (part.root === 'Relationships' && canonical === 'Relationship') {
      const id = attribute('Id');
      if (
        stack.at(-1)?.name !== 'Relationships' ||
        !id ||
        relationshipIds.has(id)
      )
        throw new Error(
          'رابط جزء Excel مكرر أو غير صالح؛ لا يمكن اختيار مصدر ضمني',
        );
      relationshipIds.add(id);
    }
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
      if (
        !/^\d+$/.test(rawRow) ||
        !Number.isSafeInteger(Number(rawRow)) ||
        Number(rawRow) < 1 ||
        Number(rawRow) > MAX_ROWS + 30
      )
        throw new Error('إحداثيات صف Excel غير صالحة أو تتجاوز حد الصفوف');
      rowAddress = String(Number(rawRow));
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
      if (
        rawAddress &&
        (!coordinate ||
          Number(coordinate[2]) < 1 ||
          !Number.isSafeInteger(Number(coordinate[2])))
      )
        throw new Error('موضع خلية Excel غير صالح؛ لا يمكن إسقاط الخلية');
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
      if (!address || previousColumn < 1 || previousColumn > 100)
        throw new Error('موضع خلية Excel غير محدد أو يتجاوز حد الأعمدة');
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
        hasInline: false,
        hasFormula: false,
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
    if (part.root === 'worksheet' && canonical === 'is' && cell) {
      if (
        cell.hasInline ||
        cell.hasValue ||
        cell.hasFormula ||
        cell.type !== 'inlineStr'
      )
        throw new Error(
          `خلية Excel ${cell.address} تحتوي بنية نص/قيمة متعارضة`,
        );
      cell.hasInline = true;
    }
    if (part.root === 'worksheet' && canonical === 'f' && cell) {
      if (
        cell.hasFormula ||
        cell.hasInline ||
        ['s', 'inlineStr'].includes(cell.type)
      )
        throw new Error(
          `خلية Excel ${cell.address} تحتوي أكثر من صيغة أو بنية متعارضة`,
        );
      cell.hasFormula = true;
    }
    if (
      part.root === 'worksheet' &&
      canonical === 'v' &&
      stack.at(-1)?.name === 'c' &&
      cell
    ) {
      if (cell.hasValue || cell.hasInline || cell.type === 'inlineStr')
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
  {
    const sheets = inspections.get('xl/workbook.xml')?.sheets ?? [];
    const relationships =
      inspections.get('xl/_rels/workbook.xml.rels')?.relationships ?? [];
    const usedPaths = new Set<string>();
    for (const sheet of sheets) {
      const target = relationships.find(
        (rel) => rel.id === sheet.relationship,
      )?.target;
      if (!target)
        throw new Error(
          'رابط ورقة Excel ناقص أو غير مدعوم؛ لا يمكن إسقاط الورقة',
        );
      const path: string[] = [];
      for (const segment of (target.startsWith('/')
        ? target.slice(1)
        : `xl/${target}`
      ).split('/')) {
        if (segment === '..') {
          if (!path.length) throw new Error('رابط ورقة Excel خارج المصنف');
          path.pop();
        } else if (segment !== '.') path.push(segment);
      }
      const resolved = path.join('/');
      if (usedPaths.has(resolved))
        throw new Error(
          'رابط ورقة Excel مكرر؛ لا يمكن إعادة تسمية المصدر أو إسقاط ورقة',
        );
      usedPaths.add(resolved);
      const inspected = inspections.get(resolved);
      if (!inspected || supportedPart(resolved)?.root !== 'worksheet')
        throw new Error(
          'جزء ورقة Excel ناقص أو غير مدعوم؛ لا يمكن قبول مصنف جزئي',
        );
      if (inspected.numericIssues.length)
        numericIssuesBySheet?.set(sheet.name, inspected.numericIssues);
    }
  }
  if (!changed) return original;
  return archive.generateAsync({ type: 'arraybuffer', compression: 'STORE' });
}
