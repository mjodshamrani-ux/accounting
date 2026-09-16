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
  parser.on('text', (text) => append(escapeText(text)));
  // Converting CDATA to escaped text preserves the same XML character data.
  parser.on('cdata', (text) => {
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
      attributes.push(`${qualified}="${escapeAttribute(attribute.value)}"`);
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
  parser.on('closetag', () => append(`</${stack.pop()!.name}>`));
  parser.write(xml).close();
  if (!rootSeen || stack.length) throw new Error('جزء XML في Excel غير مكتمل');
  if (!changed) return undefined;
  return render ? output.join('') : compatibleXml(xml, part, true);
}

/** Call only after the original ZIP has passed size, path, CRC and content checks. */
export async function prepareXlsxForExcelJs(
  original: ArrayBuffer,
): Promise<ArrayBuffer> {
  const archive = await JSZip.loadAsync(original);
  let changed = false;
  for (const [path, entry] of Object.entries(archive.files)) {
    const part = supportedPart(path);
    if (entry.dir || !part) continue;
    const bytes = await entry.async('uint8array');
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const compatible = compatibleXml(xml, part);
    if (compatible !== undefined) {
      archive.file(path, compatible);
      changed = true;
    }
  }
  if (!changed) return original;
  return archive.generateAsync({ type: 'arraybuffer', compression: 'STORE' });
}
