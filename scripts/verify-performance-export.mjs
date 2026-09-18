// Bounded independent check for large performance outputs. Does not load the
// workbook through ExcelJS or retain an XML tree for every audit worksheet.
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import { decimalMinor } from '../audit/reliability/verify-workbook.mjs';

function parse(xml, handlers) {
  const parser = new SaxesParser();
  parser.on('doctype', () => {
    throw Error('Unexpected DTD');
  });
  for (const [name, handler] of Object.entries(handlers))
    parser.on(name, handler);
  parser.write(xml).close();
}
export async function verifyPerformanceExport(bytes, sources, totals) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const text = async (name) => {
    assert.ok(zip.file(name), `missing ${name}`);
    return zip.file(name).async('string');
  };
  const paths = new Map(),
    sheets = new Map(),
    strings = [];
  parse(await text('xl/_rels/workbook.xml.rels'), {
    opentag: (t) => {
      if (t.name === 'Relationship') {
        assert.notEqual(t.attributes.TargetMode, 'External');
        paths.set(t.attributes.Id, t.attributes.Target);
      }
    },
  });
  parse(await text('xl/workbook.xml'), {
    opentag: (t) => {
      if (t.name === 'sheet')
        sheets.set(t.attributes.name, paths.get(t.attributes['r:id']));
      if (t.name === 'workbookPr')
        assert.ok(!['1', 'true'].includes(t.attributes.date1904));
    },
  });
  if (zip.file('xl/sharedStrings.xml')) {
    let value = '',
      reading = false;
    parse(await text('xl/sharedStrings.xml'), {
      opentag: (t) => {
        if (t.name === 'si') value = '';
        if (t.name === 't') reading = true;
      },
      text: (t) => {
        if (reading) value += t;
      },
      closetag: (t) => {
        if (t.name === 't') reading = false;
        if (t.name === 'si') strings.push(value);
      },
    });
  }
  for (const [side, name] of [
    'Supplier transactions',
    'Ledger transactions',
  ].entries()) {
    const target = sheets.get(name);
    assert.ok(target, `missing ${name}`);
    const filename = target.startsWith('/')
      ? target.slice(1)
      : 'xl/' + target.replace(/^\.\//, '');
    let row = 0,
      cell = null,
      reading = '',
      count = 0,
      sum = 0n,
      current = new Map();
    parse(await text(filename), {
      opentag: (t) => {
        if (t.name === 'row') {
          row = Number(t.attributes.r);
          current = new Map();
        }
        if (t.name === 'c')
          cell = {
            address: t.attributes.r,
            type: t.attributes.t ?? 'n',
            value: '',
            formula: false,
          };
        if (cell && t.name === 'f') cell.formula = true;
        if (cell && ['v', 't'].includes(t.name)) reading = t.name;
      },
      text: (t) => {
        if (cell && reading) cell.value += t;
      },
      closetag: (t) => {
        if (['v', 't'].includes(t.name)) reading = '';
        if (t.name === 'c' && cell) {
          assert.equal(cell.formula, false, 'Source text became formula');
          if (cell.type === 's') cell.value = strings[Number(cell.value)];
          current.set(cell.address.replace(/\d+$/, ''), cell);
          cell = null;
        }
        if (t.name === 'row' && row > 1) {
          const source = sources[side].rows[row - 2];
          assert.ok(source, `unexpected source row ${row}`);
          const ref =
            source[2] === 'Payment' && source[5] ? source[5] : source[1];
          assert.equal(current.get('E')?.value, ref);
          const amount = current.get('H');
          assert.equal(amount.type, 'n');
          assert.equal(
            decimalMinor(amount.value, 2),
            decimalMinor(source[7], 2),
          );
          assert.equal(
            current.get('D')?.type,
            'n',
            'Date must be native Excel numeric serial',
          );
          assert.equal(
            Number(current.get('D').value),
            (Date.parse(source[0] + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) /
              86400000,
          );
          sum += decimalMinor(amount.value, 2);
          count++;
        }
      },
    });
    assert.equal(count, sources[side].rows.length);
    assert.equal(String(sum), String(totals[side]));
  }
  return {
    sourceRows: sources.map((s) => s.rows.length),
    amountsReferencesAndDates: true,
  };
}
