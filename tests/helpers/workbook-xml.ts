import assert from 'node:assert/strict';
import JSZip from 'jszip';

// One cell of a workbook changed in the workbook's own XML, every other part
// left as it was written. An ExcelJS round trip rewrites every part, so a
// page that compares parts refuses it whatever was changed, and a test that
// changes a cell that way cannot tell the change from the rewrite. A test
// written with these helpers also checks that the workbook re-zipped
// unchanged (`rezip`) is accepted, so that a refusal is the cell's.

/** The part a sheet of the workbook is written in, by its name. */
export async function sheetPart(zip: JSZip, name: string): Promise<string> {
  const book = await zip.file('xl/workbook.xml')!.async('string'),
    rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  const tag = [...book.matchAll(/<sheet [^>]*\/>/g)]
    .map((m) => m[0])
    .find((t) => t.includes(`name="${name}"`));
  assert.ok(tag, `sheet ${name}`);
  const id = /r:id="([^"]+)"/.exec(tag)![1];
  const target = new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`).exec(rels);
  assert.ok(target, `relationship ${id}`);
  return 'xl/' + target[1].replace(/^\/?xl\//, '');
}

const cellPattern = (ref: string) =>
  new RegExp(`<c r="${ref}"(?=[\\s>/])[^>]*?(?:/>|>[\\s\\S]*?</c>)`);

// The cell's style attribute, kept when its content is replaced.
const styleOf = (cell: string) => / s="\d+"/.exec(cell)?.[0] ?? '';

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function edit(
  buffer: ArrayBuffer,
  change: (zip: JSZip) => Promise<void>,
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);
  await change(zip);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

async function editCell(
  buffer: ArrayBuffer,
  sheet: string,
  ref: string,
  replace: (cell: string) => string,
) {
  return edit(buffer, async (zip) => {
    const part = await sheetPart(zip, sheet),
      xml = await zip.file(part)!.async('string'),
      cell = cellPattern(ref).exec(xml);
    assert.ok(cell, `${sheet}!${ref}`);
    const changed = xml.replace(cell[0], replace(cell[0]));
    assert.notEqual(changed, xml, `${sheet}!${ref} changed`);
    zip.file(part, changed);
  });
}

/** The workbook re-zipped with every part unchanged: the control. */
export const rezip = (buffer: ArrayBuffer) => edit(buffer, async () => {});

/** One cell's value replaced, its style kept. */
export const setCell = (
  buffer: ArrayBuffer,
  sheet: string,
  ref: string,
  value: number | string,
) =>
  editCell(buffer, sheet, ref, (cell) =>
    typeof value === 'number'
      ? `<c r="${ref}"${styleOf(cell)}><v>${value}</v></c>`
      : `<c r="${ref}"${styleOf(cell)} t="inlineStr"><is><t>${escape(value)}</t></is></c>`,
  );

/** One cell's value written as a formula that gives the same value. */
export const formulaCell = (
  buffer: ArrayBuffer,
  sheet: string,
  ref: string,
  value: number,
) =>
  editCell(
    buffer,
    sheet,
    ref,
    (cell) =>
      `<c r="${ref}"${styleOf(cell)}><f>${value}</f><v>${value}</v></c>`,
  );

/** One cell's value kept and its display hidden (number format ";;;"). */
export async function maskCell(
  buffer: ArrayBuffer,
  sheet: string,
  ref: string,
): Promise<ArrayBuffer> {
  return edit(buffer, async (zip) => {
    const part = await sheetPart(zip, sheet),
      xml = await zip.file(part)!.async('string'),
      styles = await zip.file('xl/styles.xml')!.async('string'),
      cell = cellPattern(ref).exec(xml);
    assert.ok(cell, `${sheet}!${ref}`);
    const xfs = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/.exec(styles);
    assert.ok(xfs, 'cellXfs');
    const index = Number(/ s="(\d+)"/.exec(cell[0])?.[1] ?? 0),
      xf = [...xfs[2].matchAll(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)][index][0],
      count = Number(xfs[1]);
    const hidden = (
      /numFmtId="\d+"/.test(xf)
        ? xf.replace(/numFmtId="\d+"/, 'numFmtId="200"')
        : xf.replace('<xf ', '<xf numFmtId="200" ')
    )
      .replace(/ applyNumberFormat="[^"]*"/, '')
      .replace('<xf ', '<xf applyNumberFormat="1" ');
    const format = '<numFmt numFmtId="200" formatCode=";;;"/>';
    let masked = /<numFmts count="(\d+)">/.test(styles)
      ? styles.replace(
          /<numFmts count="(\d+)">/,
          (_, n) => `<numFmts count="${Number(n) + 1}">${format}`,
        )
      : styles.replace(
          /<styleSheet([^>]*)>/,
          (open) => `${open}<numFmts count="1">${format}</numFmts>`,
        );
    masked = masked.replace(
      xfs[0],
      `<cellXfs count="${count + 1}">${xfs[2]}${hidden}</cellXfs>`,
    );
    assert.notEqual(masked, styles);
    zip.file('xl/styles.xml', masked);
    const styled = / s="\d+"/.test(cell[0])
      ? cell[0].replace(/ s="\d+"/, ` s="${count}"`)
      : cell[0].replace(`<c r="${ref}"`, `<c r="${ref}" s="${count}"`);
    zip.file(part, xml.replace(cell[0], styled));
  });
}
