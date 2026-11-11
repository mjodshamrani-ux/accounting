import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import { readFile } from '../lib/reconciliation/io.ts';
import { GL_TB_VERSION, type GlTbInput } from '../lib/reconciliation/gl-tb.ts';
import { replayGlTb } from '../lib/reconciliation/gl-tb-io.ts';
import { glTbSheet } from '../lib/reconciliation/gl-tb-sheet.ts';
import { payrollSheet } from '../lib/reconciliation/payroll-sheet.ts';
import type { ReconciliationSheet } from '../lib/reconciliation/reconciliation-sheet.ts';
import {
  sheetAmountText,
  sheetPrint,
} from '../lib/reconciliation/sheet-print.ts';
import { sheetPrintCopy } from '../lib/i18n/sheet-print.ts';
import { reconciliationSheetCopy } from '../lib/i18n/reconciliation-sheet.ts';
import { payrollCase } from '../audit/reconciliation-sheet/payroll-cases.ts';

// UX-6(d): the reconciliation sheet on paper is the model the workbook's
// first sheet is written from, row for row and cell for cell, each amount as
// the workbook's number format shows it. The browser check
// (scripts/reconciliation-sheet-print-browser.mjs) holds the printed page to
// the downloaded workbook; this holds the layout to the model.

// An amount as the workbook's #,##0.00;-#,##0.00;0.00 shows it, written here
// from the digits apart from the module.
function shown(minor: number, decimals: number) {
  const sign = minor < 0 ? '-' : '';
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  let grouped = '';
  for (let i = 0; i < whole.length; i++) {
    if (i && (whole.length - i) % 3 === 0) grouped += ',';
    grouped += whole[i];
  }
  return sign + grouped + (decimals ? '.' + digits.slice(-decimals) : '');
}

void test('an amount is written as the workbook shows it, from minor units', () => {
  const cases: [number, number, string][] = [
    [0, 2, '0.00'],
    [5, 2, '0.05'],
    [-5, 2, '-0.05'],
    [100, 2, '1.00'],
    [123456789, 2, '1,234,567.89'],
    [-100000, 2, '-1,000.00'],
    [1234567, 3, '1,234.567'],
    [-1, 3, '-0.001'],
    [999, 0, '999'],
    [1000, 0, '1,000'],
    [-1000000, 0, '-1,000,000'],
    [12345, 4, '1.2345'],
    [Number.MAX_SAFE_INTEGER, 2, '90,071,992,547,409.91'],
  ];
  for (const [minor, decimals, text] of cases) {
    assert.equal(sheetAmountText(minor, decimals), text, `${minor}/${decimals}`);
    assert.equal(shown(minor, decimals), text, `the reference: ${minor}`);
  }
  for (const [minor, decimals] of [
    [1.5, 2],
    [Number.MAX_SAFE_INTEGER + 1, 2],
    [1, 5],
    [1, -1],
    [1, 1.5],
  ])
    assert.throws(() => sheetAmountText(minor, decimals), /SHEET_PRINT_/);
});

// What a model's row says, column by column, written from the model alone.
function modelColumns(sheet: ReconciliationSheet, r: number) {
  const n = sheet.widths.length;
  return Array.from({ length: n }, (_, c) => {
    const cell = sheet.rows[r][c] ?? null;
    if (cell === null || 'line' in cell) return '';
    if ('text' in cell) return cell.text;
    if ('minor' in cell) return shown(cell.minor, cell.decimals);
    return String(cell.count);
  });
}

function check(sheet: ReconciliationSheet, name: string) {
  const paper = sheetPrint(sheet);
  assert.equal(paper.language, sheet.language, `${name}: language`);
  // The widths in proportion, all of the page.
  const total = sheet.widths.reduce((a, b) => a + b, 0);
  paper.widths.forEach((w, i) =>
    assert.ok(Math.abs(w - (100 * sheet.widths[i]) / total) < 1e-9),
  );
  assert.ok(Math.abs(paper.widths.reduce((a, b) => a + b, 0) - 100) < 1e-9);
  const rows = paper.groups.flatMap((g) => g.rows);
  assert.equal(rows.length, sheet.rows.length, `${name}: every row, once`);
  for (const [r, row] of rows.entries()) {
    if (!sheet.rows[r].length) {
      assert.deepEqual(row, [], `${name}: row ${r} is blank`);
      continue;
    }
    // The row's columns as printed, each cell over the columns it covers.
    const columns: string[] = [];
    for (const cell of row) {
      columns.push('text' in cell ? cell.text : '');
      for (let i = 1; i < cell.span; i++) columns.push('');
      // Only a text runs on, and only over empty cells.
      if (cell.span > 1) {
        assert.equal(cell.kind, 'text', `${name}: row ${r}`);
        const at = columns.length - cell.span;
        for (let i = 1; i < cell.span; i++)
          assert.equal(sheet.rows[r][at + i] ?? null, null);
      }
      if (cell.kind === 'amount') {
        const at = columns.length - 1;
        const model = sheet.rows[r][at];
        assert.ok(model && 'minor' in model);
        assert.equal(cell.start, model.start === true);
      }
      if (cell.kind === 'line') {
        const model = sheet.rows[r][columns.length - 1];
        assert.ok(model && 'line' in model, `${name}: row ${r} line`);
      }
    }
    assert.deepEqual(columns, modelColumns(sheet, r), `${name}: row ${r}`);
  }
  // The rows the model keeps together are one group each; any other row is
  // a group of its own.
  const kept = [...(sheet.keep ?? [])].sort((a, b) => a[0] - b[0]);
  let at = 0;
  const groups: [number, number, boolean][] = paper.groups.map((g) => {
    const range: [number, number, boolean] = [at, at + g.rows.length - 1, g.keep];
    at += g.rows.length;
    return range;
  });
  for (const [a, b] of kept)
    assert.ok(
      groups.some(([x, y, keep]) => keep && x === a && y === b),
      `${name}: rows ${a} to ${b} kept together`,
    );
  for (const [x, y, keep] of groups)
    if (!keep) assert.equal(x, y, `${name}: a row not kept is alone`);
  assert.equal(
    groups.filter(([, , keep]) => keep).length,
    kept.length,
    `${name}: no group the model does not keep`,
  );
}

const glRoot = new URL('../audit/gl-tb/frozen/', import.meta.url);
const truth = JSON.parse(await fsRead(new URL('expected.json', glRoot), 'utf8'));
async function glTbResult(name: string) {
  const files = await Promise.all(
    ['gl', 'tb'].map(async (side) => {
      const file = `${name}-${side}.csv`;
      return readFile(
        file,
        new Uint8Array(await fsRead(new URL(file, glRoot))).buffer,
      );
    }),
  );
  const input: GlTbInput = {
    files: files as GlTbInput['files'],
    scope: { ...truth.scope, confirmed: true },
    readings: [
      { sheet: 0, role: 'gl-detail', family: GL_TB_VERSION, confirmed: true },
      {
        sheet: 0,
        role: 'trial-balance',
        family: GL_TB_VERSION,
        confirmed: true,
      },
    ],
  };
  return (await replayGlTb(input)).result;
}

void test('the sheet on paper is the model row for row and cell for cell', async () => {
  const sheets: [string, ReconciliationSheet][] = [];
  // The balanced case, and one with a difference, whose alignment strip
  // holds an amount at the start of its cell.
  const gl = await Promise.all(
    ['positive', 'tb-bridge-broken'].map(
      async (name) => [name, await glTbResult(name)] as const,
    ),
  );
  for (const lang of ['ar', 'en'] as const) {
    for (const [name, result] of gl)
      sheets.push([`gl-tb ${name} ${lang}`, glTbSheet(result, lang)]);
    // Two, three and no decimals, every state, and fifteen decisions.
    for (const name of [
      'seven-components-and-bank-positive',
      'kwd-precision-positive',
      'jpy-precision-positive',
      'gross-missing',
      'many-decisions',
    ]) {
      const { state, result } = await payrollCase(name);
      sheets.push([
        `payroll ${name} ${lang}`,
        payrollSheet(
          result,
          state.files.map((f) => ({ name: f.name, sha256: f.sha256 })),
          lang,
        ),
      ]);
    }
  }
  for (const [name, sheet] of sheets) check(sheet, name);
  // The cases reach what the layout must carry: amounts at three and at no
  // decimals and at the start of their cell, counts, lines to sign on,
  // fingerprints and kept groups.
  const all = sheets.flatMap(([, s]) => s.rows.flat());
  assert.ok(all.some((c) => c && 'minor' in c && c.decimals === 3));
  assert.ok(all.some((c) => c && 'minor' in c && c.decimals === 0));
  assert.ok(all.some((c) => c && 'minor' in c && c.start === true));
  assert.ok(all.some((c) => c && 'count' in c));
  assert.ok(all.some((c) => c && 'line' in c));
  assert.ok(all.some((c) => c && 'text' in c && c.style === 'hash'));
});

void test('a row wider than the sheet is refused, not cut', () => {
  const sheet: ReconciliationSheet = {
    name: 'x',
    language: 'en',
    widths: [10, 10],
    rows: [[{ text: 'a', style: 'value' }, null, { count: 1 }]],
  };
  assert.throws(() => sheetPrint(sheet), /SHEET_PRINT_WIDTHS/);
});

void test('the print command names the sheet by its own name, in each language', () => {
  for (const lang of ['ar', 'en'] as const)
    assert.ok(
      sheetPrintCopy[lang].print
        .toLowerCase()
        .includes(reconciliationSheetCopy[lang].name.toLowerCase()),
      lang,
    );
});
