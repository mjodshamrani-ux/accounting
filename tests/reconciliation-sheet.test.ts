import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import test from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  financialStrip,
  glTbStrip,
  intercompanyStrip,
} from '../lib/alignment-strip.ts';
import { stripView } from '../lib/alignment-strip-view.ts';
import { alignmentStripCopy } from '../lib/i18n/alignment-strip.ts';
import { ar } from '../lib/i18n/locales/ar.ts';
import { en } from '../lib/i18n/locales/en.ts';
import { reconciliationSheetCopy } from '../lib/i18n/reconciliation-sheet.ts';
import {
  BALANCE_FIELDS,
  GL_SCOPE_FIELDS,
  GL_TB_VERSION,
  type GlTbInput,
  type GlTbResult,
} from '../lib/reconciliation/gl-tb.ts';
import { exportGlTb, replayGlTb } from '../lib/reconciliation/gl-tb-io.ts';
import {
  exportGlTbWorkpaper,
  glTbSheet,
} from '../lib/reconciliation/gl-tb-sheet.ts';
import { exportWorkbook, readFile } from '../lib/reconciliation/io.ts';
import {
  addReconciliationSheet,
  composeSheet,
  sheetLanguage,
  type ReconciliationSheet,
  type SheetCell,
} from '../lib/reconciliation/reconciliation-sheet.ts';
import { createWorkerClient } from '../lib/reconciliation/worker-client.ts';
import {
  reconcileClearing,
  type ClearingInput,
} from '../lib/reconciliation/clearing.ts';
import { exportClearing } from '../lib/reconciliation/clearing-io.ts';
import type { ArInput } from '../lib/reconciliation/ar.ts';
import { arDemoReadings, arDemoScope } from '../lib/reconciliation/ar-demo.ts';
import { exportAr, replayAr } from '../lib/reconciliation/ar-io.ts';
import { arSheet, exportArWorkpaper } from '../lib/reconciliation/ar-sheet.ts';
import {
  clearingDemoReading,
  clearingDemoScope,
} from '../lib/reconciliation/clearing-demo.ts';
import {
  clearingSheet,
  exportClearingWorkpaper,
} from '../lib/reconciliation/clearing-sheet.ts';
import { GlTbBindingPort } from './helpers/gl-tb-binding-port.ts';
import { bankTruth, finishedBank } from '../audit/bank/fixtures.ts';
import { exportBank } from '../lib/reconciliation/bank-io.ts';
import {
  bankMovementsSheet,
  exportBankWorkpaper,
} from '../lib/reconciliation/bank-movements-sheet.ts';
import {
  allocationTruth,
  finishedFixture,
} from '../audit/allocation/fixtures.ts';
import { ALLOCATION_SCOPE_FIELDS } from '../lib/reconciliation/allocation.ts';
import { exportAllocation } from '../lib/reconciliation/allocation-io.ts';
import {
  allocationSheet,
  exportAllocationWorkpaper,
} from '../lib/reconciliation/allocation-sheet.ts';
import {
  exportSupplierWorkpaper,
  supplierSheet,
} from '../lib/reconciliation/supplier-sheet.ts';
import { readingStatus } from '../lib/reconciliation/reading-issues.ts';
import { reconciliationDirectoryCopy } from '../lib/i18n/reconciliation-directory.ts';
import {
  supplierCases,
  type SupplierCase,
} from '../audit/reconciliation-sheet/supplier-cases.ts';
import {
  financialTruth,
  finishedFinancial,
} from '../audit/tb-financial/fixtures.ts';
import { FINANCIAL_SCOPE_FIELDS } from '../lib/reconciliation/tb-financial.ts';
import { exportFinancialPosition } from '../lib/reconciliation/tb-financial-io.ts';
import {
  exportFinancialWorkpaper,
  financialSheet,
} from '../lib/reconciliation/financial-sheet.ts';
import {
  finishedIntercompany,
  intercompanyTruth,
} from '../audit/intercompany/fixtures.ts';
import { intercompanyCopy } from '../lib/i18n/intercompany.ts';
import { IC_SCOPE_FIELDS } from '../lib/reconciliation/intercompany.ts';
import { exportIntercompany } from '../lib/reconciliation/intercompany-io.ts';
import {
  exportIntercompanyWorkpaper,
  intercompanySheet,
} from '../lib/reconciliation/intercompany-sheet.ts';

// UX-6(a): the reconciliation sheet is added to a workpaper whose evidence is
// already written, and leaves that evidence byte for byte as it was. Its words
// are the screen's, in the interface's language. The design record is
// docs/audits/UX-6-RECONCILIATION-SHEET.ar.md; the independent check is
// audit/reconciliation-sheet/check_sheet.py.

const root = new URL('../audit/gl-tb/frozen/', import.meta.url);
const truth = JSON.parse(await fsRead(new URL('expected.json', root), 'utf8'));

async function glTbCase(name: string) {
  const files = await Promise.all(
    ['gl', 'tb'].map(async (side) => {
      const file = `${name}-${side}.csv`;
      return readFile(
        file,
        new Uint8Array(await fsRead(new URL(file, root))).buffer,
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
  return replayGlTb(input);
}

const WORKBOOK_PARTS = [
  '[Content_Types].xml',
  'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels',
  'xl/styles.xml',
];
async function parts(book: ArrayBuffer) {
  const zip = await JSZip.loadAsync(book);
  const out = new Map<string, Uint8Array>();
  for (const name of Object.keys(zip.files))
    if (!zip.files[name].dir)
      out.set(name, await zip.files[name].async('uint8array'));
  return out;
}
const decode = (bytes: Uint8Array | undefined) =>
  new TextDecoder().decode(bytes);
const sheetNames = (workbook: string) =>
  [...workbook.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => m[1]);
/** Each style list's body, and its count as written. */
function styleLists(styles: string) {
  const lists: Record<
    string,
    { count: number; entries: number; body: string }
  > = {};
  for (const [tag, child] of [
    ['numFmts', 'numFmt'],
    ['fonts', 'font'],
    ['fills', 'fill'],
    ['borders', 'border'],
    ['cellXfs', 'xf'],
  ]) {
    const m = new RegExp(`<${tag}(?=[\\s>])([^>]*)>([\\s\\S]*?)</${tag}>`).exec(
      styles,
    );
    if (!m) continue;
    lists[tag] = {
      count: Number(/count="(\d+)"/.exec(m[1])![1]),
      entries: (m[2].match(new RegExp(`<${child}(?=[\\s>/])`, 'g')) ?? [])
        .length,
      body: m[2],
    };
  }
  return lists;
}

void test('the evidence stays byte for byte: only the four workbook parts change and one sheet part is added', async () => {
  for (const name of ['positive', 'same-net-different-turnover', 'missing-tb'])
    for (const lang of ['ar', 'en'] as const) {
      const { state, result } = await glTbCase(name);
      const evidence = await exportGlTb(state, result);
      const book = await addReconciliationSheet(
        evidence,
        glTbSheet(result, lang),
      );
      const before = await parts(evidence),
        after = await parts(book);
      const added = [...after.keys()].filter((k) => !before.has(k));
      assert.deepEqual(added, ['xl/worksheets/sheet11.xml'], name);
      assert.deepEqual(
        [...before.keys()].filter((k) => !after.has(k)),
        [],
        `${name}: no part removed`,
      );
      for (const [part, bytes] of before)
        if (!WORKBOOK_PARTS.includes(part))
          assert.deepEqual(after.get(part), bytes, `${name} ${lang}: ${part}`);
      // The evidence sheets keep their names and order, after the sheet.
      const names = sheetNames(decode(after.get('xl/workbook.xml')));
      assert.deepEqual(names, [
        reconciliationSheetCopy[lang].name,
        ...sheetNames(decode(before.get('xl/workbook.xml'))),
      ]);
      // The evidence's styles are a prefix of the new ones, every count
      // says how many entries its list holds, and every index the cell
      // formats use stands in its list.
      const was = styleLists(decode(before.get('xl/styles.xml'))),
        now = styleLists(decode(after.get('xl/styles.xml')));
      for (const [tag, list] of Object.entries(now)) {
        assert.equal(list.count, list.entries, `${tag} count`);
        if (was[tag]) assert.ok(list.body.startsWith(was[tag].body), tag);
      }
      for (const xf of now.cellXfs.body.matchAll(/<xf [^>]*>/g)) {
        const id = (key: string) =>
          Number(new RegExp(`${key}="(\\d+)"`).exec(xf[0])![1]);
        assert.ok(id('fontId') < now.fonts.entries, xf[0]);
        assert.ok(id('borderId') < now.borders.entries, xf[0]);
        assert.ok(id('fillId') < now.fills.entries, xf[0]);
        const fmt = id('numFmtId');
        assert.ok(
          fmt <= 49 || new RegExp(`numFmtId="${fmt}"`).test(now.numFmts.body),
          xf[0],
        );
      }
      // A number keeps a left-to-right reading order in either language, so
      // its sign stays before it in print («-50.00», never «50.00-»).
      const xfs = [
        ...now.cellXfs.body.matchAll(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g),
      ].map((m) => m[0]);
      const sheetPart = decode(after.get('xl/worksheets/sheet11.xml'));
      for (const c of sheetPart.matchAll(/<c r="[A-Z]+\d+" s="(\d+)"><v>/g))
        assert.doesNotMatch(xfs[Number(c[1])], /readingOrder="2"/, c[0]);
      // The new sheet holds its own strings, no shared one, no formula.
      const sheet = sheetPart;
      assert.doesNotMatch(sheet, /t="s"/);
      assert.doesNotMatch(sheet, /<f[ >]/);
      assert.equal(
        /rightToLeft="1"/.test(sheet),
        lang === 'ar',
        'an Arabic sheet reads right to left',
      );
    }
});

void test('the worker function writes the same evidence, after replaying it, and refuses an unknown language first', async () => {
  const { state, result } = await glTbCase('positive');
  const direct = await parts(
    await addReconciliationSheet(
      await exportGlTb(state, result),
      glTbSheet(result, 'ar'),
    ),
  );
  const worker = await parts(await exportGlTbWorkpaper(state, result, 'ar'));
  assert.deepEqual([...worker.keys()].sort(), [...direct.keys()].sort());
  // The document properties carry the time the workbook was written.
  const stamp = (bytes: Uint8Array | undefined) =>
    decode(bytes).replace(/<dcterms:(created|modified)[^>]*>[^<]*</g, '<');
  for (const [part, bytes] of direct)
    if (part === 'docProps/core.xml')
      assert.equal(stamp(worker.get(part)), stamp(bytes));
    else assert.deepEqual(worker.get(part), bytes, part);
  for (const lang of ['fr', undefined, 'AR', ['ar'], null])
    await assert.rejects(
      exportGlTbWorkpaper(state, result, lang),
      /RECONCILIATION_SHEET_LANGUAGE/,
      String(lang),
    );
  // The language is refused before the export replays anything.
  const changed = structuredClone(result);
  changed.gl!.openingDebit++;
  await assert.rejects(
    exportGlTbWorkpaper(state, changed, 'xx'),
    /RECONCILIATION_SHEET_LANGUAGE/,
  );
  await assert.rejects(
    exportGlTbWorkpaper(state, changed, 'en'),
    /GL_TB_STALE_RESULT/,
  );
});

void test('the real worker hands the page the workpaper with the sheet first, in the language asked', async () => {
  const { state, result } = await glTbCase('positive');
  const port = new GlTbBindingPort();
  try {
    const client = createWorkerClient(() => port);
    for (const lang of ['ar', 'en'] as const) {
      const bytes = await client.request<ArrayBuffer>('gl-tb-export', {
        state,
        result,
        lang,
      });
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes);
      assert.deepEqual(
        book.worksheets.slice(0, 2).map((s) => s.name),
        [reconciliationSheetCopy[lang].name, 'Summary'],
      );
      assert.equal(
        book.getWorksheet('Summary')!.getCell('B4').value,
        'consistent',
      );
    }
    await assert.rejects(
      client.request('gl-tb-export', { state, result }),
      /RECONCILIATION_SHEET_LANGUAGE/,
    );
  } finally {
    port.terminate();
  }
});

/** The sheet's rows as text and numbers, as a reader of the cells sees them. */
async function firstSheet(book: ArrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(book);
  const sheet = wb.worksheets[0];
  const rows: (string | number | null)[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, n) => {
    rows[n - 1] = [1, 2, 3, 4].map((c) => {
      const v = row.getCell(c).value;
      return v === null || v === undefined
        ? null
        : typeof v === 'object' && 'richText' in v
          ? v.richText.map((r) => r.text).join('')
          : (v as string | number);
    });
  });
  return {
    sheet,
    rows: Array.from(rows, (r) => r ?? [null, null, null, null]),
  };
}
const rowOf = (rows: (string | number | null)[][], label: string) => {
  const at = rows.findIndex((r) => r[0] === label);
  assert.ok(at >= 0, `a row labelled ${label}`);
  return at;
};

void test('the sheet says what the screen says: scope, sources, the strip, every balance, an empty sign-off, the claim', async () => {
  for (const name of ['positive', 'same-net-different-turnover', 'missing-tb'])
    for (const lang of ['ar', 'en'] as const) {
      const { state, result } = await glTbCase(name);
      const w = reconciliationSheetCopy[lang],
        t = w.glTb,
        s = alignmentStripCopy[lang];
      const { sheet, rows } = await firstSheet(
        await exportGlTbWorkpaper(state, result, lang),
      );
      assert.equal(sheet.name, w.name);
      assert.equal(rows[0][0], w.name);
      assert.equal(rows[1][0], t.title);
      // Scope: each field in the screen's words, the two fixed values as
      // the scope card names them, never the engine's code.
      for (const key of GL_SCOPE_FIELDS) {
        const row = rows[rowOf(rows, t.fields[key])];
        assert.equal(
          row[1],
          key === 'currencyBasis'
            ? t.functionalLabel
            : key === 'postingStatus'
              ? t.postedLabel
              : result.scope[key],
          key,
        );
      }
      // Sources: each role, its file and its whole fingerprint.
      for (const [side, source] of result.sources.entries()) {
        const at = rowOf(rows, t.sides[side]);
        assert.equal(rows[at][1], source.name);
        assert.deepEqual(rows[at + 1].slice(0, 2), [
          w.fingerprint,
          source.hash,
        ]);
      }
      // The strip, cell by cell, from the function the screen draws with.
      const view = stripView(glTbStrip(result), s, {
        name: (key) => t.components[key as keyof typeof t.components] ?? key,
        state: t.status[result.status],
      });
      for (const cell of view) {
        const at = rowOf(rows, cell.label),
          row = rows[at];
        if (cell.value.kind === 'count')
          assert.deepEqual(
            row.slice(1),
            cell.value.of === undefined
              ? [cell.value.count, null, null]
              : [cell.value.count, w.of, cell.value.of],
          );
        else if (cell.value.kind === 'amount')
          assert.equal(
            row[1],
            cell.value.minor / 10 ** result.decimals,
            'the amount the engine signed',
          );
        else assert.equal(row[1], cell.value.text);
        cell.notes.forEach((n, i) =>
          assert.deepEqual(rows[at + 1 + i].slice(0, 3), [
            null,
            n.text,
            n.value ?? null,
          ]),
        );
      }
      // What is missing, as the screen lists it under the strip.
      for (const k of result.missing)
        assert.ok(
          rows.some((r) => r[1] === t.missingLabels[k]),
          `missing ${k}`,
        );
      // Every balance as the engine wrote it, at the currency's precision.
      const head = rowOf(rows, t.component);
      assert.deepEqual(rows[head], [t.component, t.gl, t.tb, t.difference]);
      BALANCE_FIELDS.forEach((f, i) => {
        const shown = (minor: number | null | undefined) =>
          minor === null || minor === undefined
            ? t.missing
            : minor / 10 ** result.decimals;
        assert.deepEqual(rows[head + 1 + i], [
          t.components[f],
          shown(result.gl?.[f]),
          shown(result.tb?.[f]),
          shown(result.differences?.[f]),
        ]);
      });
      // Sign-off lines are left for people: no name, no date.
      for (const who of [w.prepared, w.reviewed])
        assert.deepEqual(rows[rowOf(rows, who)], [who, null, w.date, null]);
      assert.equal(rows.at(-1)![0], t.claim);
      // Each row carries something, or heads a section.
      for (const [i, row] of rows.entries()) {
        const filled = row.filter((v) => v !== null && v !== '');
        if (!filled.length) continue;
        const heading =
          i < 2 ||
          [
            w.scope,
            w.sources,
            w.alignment,
            t.balances,
            w.signature,
            w.claim,
          ].includes(String(row[0])) ||
          i === head ||
          i === rows.length - 1;
        assert.ok(
          heading || row.slice(1).some((v) => v !== null) || row[0] === null,
          `row ${i + 1} carries a value: ${JSON.stringify(row)}`,
        );
      }
    }
});

void test('the words are the screen words: the GL/TB catalogue and the strip as the interface writes them', async () => {
  for (const [lang, locale] of [
    ['ar', ar],
    ['en', en],
  ] as const) {
    const t = reconciliationSheetCopy[lang].glTb;
    for (const key of Object.keys(t) as (keyof typeof t)[])
      if (key !== 'claim')
        assert.deepEqual(
          t[key],
          (locale.glTb as Record<string, unknown>)[key],
          `${lang} glTb.${key}`,
        );
    // The strip writes «4 من 6» in one phrase; the sheet puts each in a cell.
    const of = reconciliationSheetCopy[lang].of;
    assert.equal(alignmentStripCopy[lang].of(4, 6), `4 ${of} 6`);
  }
  // The claim in English is the evidence's own words.
  const { state, result } = await glTbCase('positive');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await exportGlTb(state, result));
  const claim = wb
    .getWorksheet('Summary')!
    .getRows(1, 40)!
    .find((r) => r.getCell(1).value === 'Claim')!
    .getCell(2).value;
  assert.equal(reconciliationSheetCopy.en.glTb.claim, claim);
  assert.notEqual(reconciliationSheetCopy.ar.glTb.claim, claim);
});

const tiny = (
  rows: SheetCell[][],
  language: 'ar' | 'en' = 'en',
): ReconciliationSheet => ({
  name: 'First',
  language,
  widths: [10],
  rows,
});
async function bookWith(
  build: (wb: ExcelJS.Workbook) => void,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

void test('guards: a selected tab, a taken or invalid name, and values the sheet cannot hold are refused', async () => {
  const plain = await bookWith((wb) => {
    const s = wb.addWorksheet('Summary');
    s.addRow(['a']);
    // A view, as the evidence sheets have one (frozen header).
    s.views = [{ state: 'frozen', ySplit: 1 }];
  });
  // A workbook whose sheet marks itself the selected tab, as Excel writes it.
  const zip = await JSZip.loadAsync(plain);
  const part = 'xl/worksheets/sheet1.xml';
  const xml = await zip.file(part)!.async('string');
  assert.match(xml, /<sheetView /);
  zip.file(part, xml.replace('<sheetView ', '<sheetView tabSelected="1" '));
  const selected = await zip.generateAsync({ type: 'arraybuffer' });
  await assert.rejects(
    addReconciliationSheet(selected, tiny([[{ count: 1 }]])),
    /RECONCILIATION_SHEET_TAB_SELECTED/,
  );
  for (const name of ['summary', 'SUMMARY'])
    await assert.rejects(
      addReconciliationSheet(plain, { ...tiny([]), name }),
      /RECONCILIATION_SHEET_NAME_TAKEN/,
    );
  for (const name of ['', 'a/b', 'a:b', "'quoted", 'x'.repeat(32), 'a[1]'])
    await assert.rejects(
      addReconciliationSheet(plain, { ...tiny([]), name }),
      /RECONCILIATION_SHEET_NAME/,
      name,
    );
  for (const [cell, code] of [
    [{ minor: 2 ** 53, decimals: 2 }, 'AMOUNT'],
    [{ minor: 1.5, decimals: 2 }, 'AMOUNT'],
    [{ minor: 1, decimals: 5 }, 'DECIMALS'],
    [{ minor: 1, decimals: -1 }, 'DECIMALS'],
    [{ count: -1 }, 'COUNT'],
    [{ count: 0.5 }, 'COUNT'],
  ] as const)
    await assert.rejects(
      addReconciliationSheet(plain, tiny([[cell as SheetCell]])),
      new RegExp(`RECONCILIATION_SHEET_${code}`),
      JSON.stringify(cell),
    );
  // A style list whose count disagrees with its entries is not extended.
  const miscounted = await JSZip.loadAsync(plain);
  const styles = await miscounted.file('xl/styles.xml')!.async('string');
  assert.match(styles, /<fonts count="\d+"/);
  miscounted.file(
    'xl/styles.xml',
    styles.replace(
      /<fonts count="(\d+)"/,
      (_, n) => `<fonts count="${Number(n) + 1}"`,
    ),
  );
  await assert.rejects(
    addReconciliationSheet(
      await miscounted.generateAsync({ type: 'arraybuffer' }),
      tiny([[{ count: 1 }]]),
    ),
    /RECONCILIATION_SHEET_STYLES/,
  );
  // A text passes the check every exported text passes, with its words.
  await assert.rejects(
    addReconciliationSheet(
      plain,
      tiny([[{ text: 'a\u0007b', style: 'value' }]]),
    ),
    /محارف تحكم/,
  );
  await assert.rejects(
    addReconciliationSheet(plain, { ...tiny([]), language: 'fr' as 'en' }),
    /RECONCILIATION_SHEET_LANGUAGE/,
  );
  assert.throws(() => sheetLanguage('EN'), /RECONCILIATION_SHEET_LANGUAGE/);
});

void test('a text that a spreadsheet would run as a formula stays a text', async () => {
  const plain = await bookWith((wb) => {
    wb.addWorksheet('Summary').addRow(['a']);
  });
  const book = await addReconciliationSheet(
    plain,
    tiny([[{ text: '=1+1', style: 'value' }]]),
  );
  const { rows } = await firstSheet(book);
  assert.equal(typeof rows[0][0], 'string');
  assert.notEqual(rows[0][0], 2);
  const sheet = decode((await parts(book)).get('xl/worksheets/sheet2.xml'));
  assert.doesNotMatch(sheet, /<f[ >]/);
});

void test('a name tied to a sheet position keeps its sheet when the first sheet is added', async () => {
  const book = await bookWith((wb) => {
    wb.addWorksheet('One').addRow(['a']);
    const two = wb.addWorksheet('Two');
    two.addRow(['b']);
    two.pageSetup.printArea = 'A1:B2';
  });
  const before = decode((await parts(book)).get('xl/workbook.xml'));
  const local = (xml: string) => Number(/localSheetId="(\d+)"/.exec(xml)![1]);
  assert.equal(sheetNames(before)[local(before)], 'Two');
  const after = decode(
    (
      await parts(await addReconciliationSheet(book, tiny([[{ count: 1 }]])))
    ).get('xl/workbook.xml'),
  );
  assert.deepEqual(sheetNames(after), ['First', 'One', 'Two']);
  assert.equal(sheetNames(after)[local(after)], 'Two');
});

void test('an empty section is not written, and the sign-off is lines, not values', () => {
  const sheet = composeSheet('ar', {
    title: 'عنوان',
    sections: [
      { kind: 'pairs', title: 'فارغ', rows: [] },
      { kind: 'sources', title: 'مصادر', evidence: 'Sources', sources: [] },
      { kind: 'table', title: 'جدول', evidence: 'X', head: ['a'], rows: [] },
      { kind: 'signature' },
    ],
  });
  const texts = sheet.rows.flatMap((r) =>
    r.flatMap((c) => (c && 'text' in c ? [c.text] : [])),
  );
  for (const absent of ['فارغ', 'مصادر', 'جدول'])
    assert.ok(!texts.includes(absent), absent);
  const w = reconciliationSheetCopy.ar;
  const lines = sheet.rows.filter((r) => r.some((c) => c && 'line' in c));
  assert.deepEqual(
    lines.map((r) => r.map((c) => (c && 'text' in c ? c.text : c))),
    [
      [w.prepared, { line: true }, w.date, { line: true }],
      [w.reviewed, { line: true }, w.date, { line: true }],
    ],
  );
});

void test('every frozen GL/TB case, in either language, yields a sheet whose figures are the result’s fields', async () => {
  for (const c of truth.cases as { name: string; status: string }[]) {
    const { result } = await glTbCase(c.name);
    assert.equal(result.status, c.status, c.name);
    for (const lang of ['ar', 'en'] as const) {
      const sheet = glTbSheet(result as GlTbResult, lang);
      const figures = sheet.rows.flatMap((r) =>
        r.flatMap((cell) => (cell && 'minor' in cell ? [cell.minor] : [])),
      );
      const fields = BALANCE_FIELDS.flatMap((f) => [
        result.gl?.[f],
        result.tb?.[f],
        result.differences?.[f],
      ]).filter((v): v is number => typeof v === 'number');
      // The strip's gap, when there is one, is one of the differences.
      for (const minor of figures)
        assert.ok(fields.includes(minor), `${c.name}: ${minor} is a field`);
      assert.ok(
        sheet.rows.every((r) => r.length <= sheet.widths.length),
        `${c.name}: four columns`,
      );
    }
  }
});

// UX-6(b), clearing: the case workspace whose sheet carries the decisions
// recorded with their reasons.
async function clearingCase(decisions: 'none' | 'clear' | 'reopen') {
  const bytes = await fsRead(
    new URL('../audit/clearing/frozen/source.csv', import.meta.url),
  );
  const input: ClearingInput = {
    file: await readFile('clearing.csv', new Uint8Array(bytes).buffer),
    reading: { ...clearingDemoReading },
    scope: { ...clearingDemoScope },
    events: [],
  };
  let result = reconcileClearing(input);
  if (decisions !== 'none') {
    // The two movements without a reference that offset each other.
    const pair = result.cases
      .filter((c) => c.reason === 'missing-reference')
      .flatMap((c) => c.ids);
    assert.equal(pair.length, 2);
    input.events.push({
      context: result.context,
      action: 'clear',
      ids: pair,
      note: 'Synthetic offsetting pair, same contract',
    });
    result = reconcileClearing(input);
    if (decisions === 'reopen') {
      input.events.push({
        context: result.context,
        action: 'reopen',
        ids: pair,
        note: 'Synthetic reopen pending the contract copy',
      });
      result = reconcileClearing(input);
    }
  }
  return { state: input, result };
}

void test('clearing: the evidence stays byte for byte, and the sheet says the decisions with their reasons', async () => {
  for (const decisions of ['none', 'clear', 'reopen'] as const)
    for (const lang of ['ar', 'en'] as const) {
      const { state, result } = await clearingCase(decisions);
      const evidence = await exportClearing(state, result);
      const book = await addReconciliationSheet(
        evidence,
        clearingSheet(state, result, lang),
      );
      const before = await parts(evidence),
        after = await parts(book);
      for (const [part, bytes] of before)
        if (!WORKBOOK_PARTS.includes(part))
          assert.deepEqual(after.get(part), bytes, `${decisions}: ${part}`);
      const w = reconciliationSheetCopy[lang],
        t = w.clearing;
      const { rows } = await firstSheet(
        await exportClearingWorkpaper(state, result, lang),
      );
      assert.equal(rows[1][0], t.title);
      const posting = new Map(result.rows.map((r) => [r.id, r.posting]));
      const members = (ids: string[]) =>
        ids.map((id) => posting.get(id)).join(', ');
      // What the engine left for a person, each with its net and reason.
      const review = result.cases.filter((c) => c.status === 'review');
      const top = rowOf(rows, t.members);
      assert.deepEqual(rows[top], [t.members, t.reference, t.net, t.basis]);
      review.forEach((c, i) =>
        assert.deepEqual(rows[top + 1 + i], [
          members(c.ids),
          c.reference || t.missing,
          c.net / 10 ** result.decimals,
          t.reason[c.reason as keyof typeof t.reason],
        ]),
      );
      // Each decision, what it did and the reason the reviewer gave.
      const head = rows.findIndex((r) => r[0] === w.decision);
      if (!state.events.length)
        assert.equal(head, -1, 'no decisions, no table');
      state.events.forEach((event, i) =>
        assert.deepEqual(rows[head + 1 + i].slice(0, 3), [
          t.reason[event.action === 'clear' ? 'human-decision' : 'reopened'],
          members(event.ids),
          event.note,
        ]),
      );
      // The figures beside the strip.
      assert.deepEqual(rows[rowOf(rows, t.valid)].slice(0, 2), [
        t.valid,
        result.rows.length,
      ]);
      assert.deepEqual(rows[rowOf(rows, t.cleared)].slice(0, 2), [
        t.cleared,
        result.cases
          .filter((c) => c.status === 'cleared')
          .reduce((n, c) => n + c.ids.length, 0),
      ]);
      assert.deepEqual(rows[rowOf(rows, t.errors)].slice(0, 2), [
        t.errors,
        result.inventory.filter((r) => r.kind === 'error').length,
      ]);
      // The source by its file and whole fingerprint.
      const source = rowOf(rows, t.upload);
      assert.deepEqual(rows[source].slice(0, 2), [t.upload, state.file.name]);
      assert.deepEqual(rows[source + 1].slice(0, 2), [
        w.fingerprint,
        result.sourceHash,
      ]);
      assert.equal(rows.at(-1)![0], t.claim);
    }
});

void test('clearing: a source with errors counts them, and every group waits for that reason', async () => {
  // The frozen source with its first movement written twice: both rows are
  // errors, so nothing clears and every group waits for the source.
  const lines = (
    await fsRead(
      new URL('../audit/clearing/frozen/source.csv', import.meta.url),
      'utf8',
    )
  )
    .trimEnd()
    .split('\n');
  const state: ClearingInput = {
    file: await readFile(
      'clearing.csv',
      new TextEncoder().encode([...lines, lines[1]].join('\n') + '\n')
        .buffer as ArrayBuffer,
    ),
    reading: { ...clearingDemoReading },
    scope: { ...clearingDemoScope },
    events: [],
  };
  const result = reconcileClearing(state);
  const errors = result.inventory.filter((r) => r.kind === 'error').length;
  assert.equal(errors, 2, 'both rows of the posting written twice');
  for (const lang of ['ar', 'en'] as const) {
    const t = reconciliationSheetCopy[lang].clearing;
    const { rows } = await firstSheet(
      await exportClearingWorkpaper(state, result, lang),
    );
    assert.deepEqual(rows[rowOf(rows, t.errors)].slice(0, 2), [t.errors, 2]);
    assert.deepEqual(rows[rowOf(rows, t.cleared)].slice(0, 2), [t.cleared, 0]);
    const top = rowOf(rows, t.members);
    const waiting = result.cases.filter((c) => c.status === 'review');
    assert.equal(waiting.length, result.cases.length);
    waiting.forEach((_, i) =>
      assert.equal(rows[top + 1 + i][3], t.reason['source-errors']),
    );
  }
});

/** The first sheet's XML, its cell formats, and each row's cells. */
async function sheetParts(book: ArrayBuffer) {
  const all = await parts(book);
  const workbook = decode(all.get('xl/workbook.xml'));
  const rid = /<sheet [^>]*r:id="([^"]+)"/.exec(workbook)![1];
  const target = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(
    decode(all.get('xl/_rels/workbook.xml.rels')),
  )![1];
  const xml = decode(all.get(`xl/${target.replace(/^\/?xl\//, '')}`));
  const xfs = [
    ...decode(all.get('xl/styles.xml'))
      .match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)![1]
      .matchAll(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g),
  ].map((m) => m[0]);
  const rows = [
    ...xml.matchAll(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g),
  ].map((m) => ({
    n: Number(m[1]),
    height: Number(/ht="([\d.]+)"/.exec(m[2])?.[1] ?? 0),
    custom: m[2].includes('customHeight="1"'),
    cells: [
      ...m[3].matchAll(
        /<c r="([A-Z]+)\d+"[^>]*?s="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g,
      ),
    ].map((c) => ({
      col: c[1],
      wrap: xfs[Number(c[2])].includes('wrapText="1"'),
      text: /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] ?? '')?.[1] ?? null,
    })),
  }));
  return { xml, rows };
}

void test('a text longer than the room beside it wraps in its own cell, its row written tall enough; a text that fits runs on', async () => {
  const note =
    'Synthetic reviewer reason, long enough to need several lines in its column: the two postings offset under the same contract, read from the copy.';
  const { state } = await clearingCase('none');
  let result = reconcileClearing(state);
  const pair = result.cases
    .filter((c) => c.reason === 'missing-reference')
    .flatMap((c) => c.ids);
  state.events.push({
    context: result.context,
    action: 'clear',
    ids: pair,
    note,
  });
  result = reconcileClearing(state);
  for (const lang of ['ar', 'en'] as const) {
    const { rows } = await sheetParts(
      await exportClearingWorkpaper(state, result, lang),
    );
    const row = rows.find((r) => r.cells.some((c) => c.text === note))!;
    const cell = row.cells.find((c) => c.text === note)!;
    assert.equal(cell.col, 'C', `${lang}: the reason in its own cell`);
    assert.equal(cell.wrap, true, `${lang}: the long reason wraps`);
    // 150 characters in a column 22 wide: no fewer than seven lines of 15
    // points, so no line of it is cut.
    assert.ok(row.custom && row.height >= 7 * 15, `${lang}: ${row.height}`);
    // Its members, short, stay on one line, unwrapped.
    assert.equal(row.cells.find((c) => c.col === 'B')!.wrap, false);
  }
  // The room is the cell and the empty cells after it: a text of 60
  // characters runs on from the first column when the three after it are
  // empty, and wraps when the second holds a value.
  const long = 'word '.repeat(12).trim();
  const evidence = await exportClearing(state, result);
  const { rows: laid } = await sheetParts(
    await addReconciliationSheet(
      evidence,
      composeSheet('en', {
        title: 'Synthetic',
        sections: [
          {
            kind: 'table',
            title: 'Synthetic table',
            evidence: 'Summary',
            head: ['One', 'Two', 'Three', 'Four'],
            rows: [
              [{ text: long, style: 'value' }, null, null, null],
              [
                { text: long, style: 'value' },
                { text: 'ref', style: 'value' },
                null,
                null,
              ],
            ],
          },
        ],
      }),
    ),
  );
  const [runs, wraps] = laid.filter((r) =>
    r.cells.some((c) => c.text === long),
  );
  assert.deepEqual(
    [runs.cells[0].wrap, runs.custom, wraps.cells[0].wrap, wraps.custom],
    [false, false, true, true],
  );
  // A GL/TB sheet whose texts all fit is written as before: nothing wraps,
  // no row is given a height.
  const { state: gl, result: glResult } = await glTbCase('positive');
  for (const lang of ['ar', 'en'] as const) {
    const { xml, rows } = await sheetParts(
      await exportGlTbWorkpaper(gl, glResult, lang),
    );
    assert.ok(!xml.includes('customHeight'), `${lang}: no row height`);
    assert.ok(
      rows.every((r) => r.cells.every((c) => !c.wrap)),
      lang,
    );
  }
});

void test('clearing: the words are the screen words, and the claim in English is the evidence words', async () => {
  for (const [lang, locale] of [
    ['ar', ar],
    ['en', en],
  ] as const) {
    const t = reconciliationSheetCopy[lang].clearing;
    for (const key of Object.keys(t) as (keyof typeof t)[])
      if (key !== 'claim')
        assert.deepEqual(
          t[key],
          (locale.clearing as Record<string, unknown>)[key],
          `${lang} clearing.${key}`,
        );
  }
  const { state, result } = await clearingCase('none');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await exportClearing(state, result));
  const claim = wb
    .getWorksheet('Summary')!
    .getRows(1, 40)!
    .find((r) => r.getCell(1).value === 'Economic coverage')!
    .getCell(2).value;
  assert.equal(reconciliationSheetCopy.en.clearing.claim, claim);
});

/** A stored text as a spreadsheet reads it: each _xHHHH_ is the character it
 * names (OOXML ST_Xstring). ExcelJS decodes shared strings so, but returns an
 * inline string as stored. */
const ooxmlText = (stored: string) =>
  stored.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );

void test('a source name that looks like a formula or an escape reads back from the sheet as it was written', async () => {
  const name = '= مصدر عربي 🧾 é _x0041_ _X0041_ _x005F_x0041_ \u007f.csv';
  const { state } = await clearingCase('none');
  state.file.name = name;
  for (const lang of ['ar', 'en'] as const) {
    const book = await exportClearingWorkpaper(
      state,
      reconcileClearing(state),
      lang,
    );
    const { rows } = await firstSheet(book);
    const stored = rows[
      rowOf(rows, reconciliationSheetCopy[lang].clearing.upload)
    ][1] as string;
    // Stored escaped, and read as written: a literal escape stays literal,
    // not the character it would name, as the evidence's own cell reads.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(book);
    const evidence = wb
      .getWorksheet('Summary')!
      .getRows(1, 40)!
      .find((r) => r.getCell(1).value === 'Source name')!
      .getCell(2).value;
    assert.equal(evidence, name);
    assert.notEqual(stored, name);
    assert.equal(ooxmlText(stored), name);
  }
});

void test('the real worker writes the clearing sheet in the language asked, and refuses none', async () => {
  const { state, result } = await clearingCase('clear');
  const port = new GlTbBindingPort();
  try {
    const client = createWorkerClient(() => port);
    for (const lang of ['ar', 'en'] as const) {
      const bytes = await client.request<ArrayBuffer>('clearing-export', {
        state,
        result,
        lang,
      });
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes);
      assert.deepEqual(
        book.worksheets.slice(0, 2).map((s) => s.name),
        [reconciliationSheetCopy[lang].name, 'Summary'],
      );
    }
    await assert.rejects(
      client.request('clearing-export', { state, result }),
      /RECONCILIATION_SHEET_LANGUAGE/,
    );
  } finally {
    port.terminate();
  }
});

/** A frozen bank-cash-movements-1 case with the decisions its contract
 * records. */
const bankCase = (name: string) => {
  const c = bankTruth.cases.find((c: { name: string }) => c.name === name);
  assert.ok(c, name);
  return finishedBank(c);
};

void test('bank: the evidence stays byte for byte, each case left for review with its difference and members, each decision with its reason', async () => {
  for (const name of [
    'no-identity',
    'timing-after-cutoff',
    'wrong-fee-parent',
    'individual',
    'outgoing-fees',
    'empty-sources',
  ])
    for (const lang of ['ar', 'en'] as const) {
      const { state, result } = await bankCase(name);
      const evidence = await exportBank(state, result);
      const book = await addReconciliationSheet(
        evidence,
        bankMovementsSheet(state, result, lang),
      );
      const before = await parts(evidence),
        after = await parts(book);
      for (const [part, bytes] of before)
        if (!WORKBOOK_PARTS.includes(part))
          assert.deepEqual(after.get(part), bytes, `${name}: ${part}`);
      const w = reconciliationSheetCopy[lang],
        t = w.bank;
      const { rows } = await firstSheet(
        await exportBankWorkpaper(state, result, lang),
      );
      assert.equal(rows[1][0], t.title, name);
      const record = new Map(result.records.map((r) => [r.id, r]));
      const unit = 10 ** result.decimals;
      // What the strip counts as waiting, each case with its kind, its
      // identity where it has one, its reason, the engine's difference, then
      // each complete member with its side, signed amount and reference.
      const waiting = result.cases.filter(
        (c) => c.status === 'needs-review' || c.status === 'source-error',
      );
      const top = rows.findIndex((r) => r[0] === t.caseStatus['needs-review']);
      if (!waiting.length) assert.equal(top, -1, `${name}: nothing waits`);
      let at = top + 1;
      for (const c of waiting) {
        assert.deepEqual(
          rows[at++].slice(0, 3),
          [
            t.caseKinds[c.kind],
            c.kind === 'reference' ? c.key : null,
            t.reasons[c.reason],
          ],
          `${name} ${c.id}`,
        );
        assert.deepEqual(rows[at++].slice(0, 3), [
          null,
          t.difference,
          c.deltaMinor / unit,
        ]);
        for (const id of [...c.bankIds, ...c.cashIds]) {
          const r = record.get(id)!;
          assert.deepEqual(rows[at++], [
            null,
            t.sides[r.side],
            r.signed / unit,
            r.reference,
          ]);
        }
      }
      // Each decision: what it did, its members, the reference and reason.
      const names = (ids: string[]) =>
        ids.map((id) => record.get(id)!.reference).join(' · ');
      const head = rows.findIndex((r) => r[0] === w.decision);
      if (!state.events.length)
        assert.equal(head, -1, 'no decisions, no table');
      else
        assert.deepEqual(rows[head], [
          w.decision,
          t.members,
          t.reference,
          t.reason,
        ]);
      state.events.forEach((event, i) =>
        assert.deepEqual(rows[head + 1 + i], [
          t.reasons[event.type === 'accept' ? 'human-review' : 'undone'],
          `${names(event.bankIds)} · ${names(event.cashIds)}`,
          event.reference,
          event.note,
        ]),
      );
      // The two sources by their roles and whole fingerprints.
      for (const side of [0, 1] as const) {
        const source = rowOf(rows, t.sides[side]);
        assert.deepEqual(rows[source].slice(0, 2), [
          t.sides[side],
          result.sources[side].name,
        ]);
        assert.deepEqual(rows[source + 1].slice(0, 2), [
          w.fingerprint,
          result.sources[side].hash,
        ]);
      }
      assert.equal(rows.at(-1)![0], t.claim);
    }
});

void test('bank: the words are the screen words, and the claim in English is the evidence words', async () => {
  for (const [lang, locale] of [
    ['ar', ar],
    ['en', en],
  ] as const) {
    const t = reconciliationSheetCopy[lang].bank;
    for (const key of Object.keys(t) as (keyof typeof t)[])
      if (key !== 'claim')
        assert.deepEqual(
          t[key],
          (locale.bank as Record<string, unknown>)[key],
          `${lang} bank.${key}`,
        );
  }
  const { state, result } = await bankCase('individual');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await exportBank(state, result));
  const claim = wb
    .getWorksheet('Summary')!
    .getRows(1, 40)!
    .find((r) => r.getCell(1).value === 'Claim')!
    .getCell(2).value;
  assert.equal(reconciliationSheetCopy.en.bank.claim, claim);
});

void test('the real worker writes the bank movements sheet in the language asked, and refuses none', async () => {
  const { state, result } = await bankCase('no-identity');
  const port = new GlTbBindingPort();
  try {
    const client = createWorkerClient(() => port);
    for (const lang of ['ar', 'en'] as const) {
      const bytes = await client.request<ArrayBuffer>('bank-export', {
        state,
        result,
        lang,
      });
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes);
      assert.deepEqual(
        book.worksheets.slice(0, 2).map((s) => s.name),
        [reconciliationSheetCopy[lang].name, 'Summary'],
      );
      const { rows } = await firstSheet(bytes);
      assert.equal(rows[1][0], reconciliationSheetCopy[lang].bank.title);
    }
    await assert.rejects(
      client.request('bank-export', { state, result }),
      /RECONCILIATION_SHEET_LANGUAGE/,
    );
  } finally {
    port.terminate();
  }
});

/** A frozen allocation-snapshot-1 case with the decisions its contract
 * records (a refused action is not recorded). */
const allocationCase = (name: string) => {
  const c = allocationTruth.cases.find((c) => c.name === name);
  assert.ok(c, name);
  return finishedFixture(c);
};
/** A section's heading row: its title, then the evidence it stands in. */
const headingOf = (
  rows: (string | number | null)[][],
  title: string,
  evidence: string,
  lang: 'ar' | 'en',
) =>
  rows.findIndex(
    (r) =>
      r[0] === title &&
      r[1] === null &&
      r[2] === reconciliationSheetCopy[lang].evidence &&
      r[3] === evidence,
  );

void test('allocation: the evidence stays byte for byte, the value ledger by side, each active allocation with its basis and members, each decision with its reason', async () => {
  for (const name of [
    'one-to-many',
    'many-to-one',
    'stages',
    'undo',
    'two-choices',
    'part-paid',
    'no-evidence',
    'currency-mismatch',
  ])
    for (const lang of ['ar', 'en'] as const) {
      const { state, result } = await allocationCase(name);
      const evidence = await exportAllocation(state, result);
      const book = await addReconciliationSheet(
        evidence,
        allocationSheet(result, lang),
      );
      const before = await parts(evidence),
        after = await parts(book);
      for (const [part, bytes] of before)
        if (!WORKBOOK_PARTS.includes(part))
          assert.deepEqual(after.get(part), bytes, `${name}: ${part}`);
      const w = reconciliationSheetCopy[lang],
        t = w.allocation;
      const { rows } = await firstSheet(
        await exportAllocationWorkpaper(state, result, lang),
      );
      assert.equal(rows[1][0], t.paymentAllocation, name);
      const unit = 10 ** result.decimals;
      // The strip: the links decided, the result's state in the screen's
      // words.
      const s = alignmentStripCopy[lang];
      assert.deepEqual(rows[rowOf(rows, s.agreed)].slice(0, 2), [
        s.agreed,
        result.links.length,
      ]);
      assert.deepEqual(rows[rowOf(rows, s.state)].slice(0, 2), [
        s.state,
        result.status === 'ready' ? t.ready : t.sourceError,
      ]);
      // The scope in the screen's words, each field's value as the result
      // holds it.
      ALLOCATION_SCOPE_FIELDS.forEach((field, i) =>
        assert.deepEqual(rows[rowOf(rows, t.fields[i])].slice(0, 2), [
          t.fields[i],
          result.scope[field],
        ]),
      );
      // The three sources by their roles and whole fingerprints.
      for (const side of [0, 1, 2] as const) {
        const source = rowOf(rows, t.sides[side]);
        assert.deepEqual(rows[source].slice(0, 2), [
          t.sides[side],
          result.sources[side].name,
        ]);
        assert.deepEqual(rows[source + 1].slice(0, 2), [
          w.fingerprint,
          result.sources[side].hash,
        ]);
      }
      // The value ledger of each side, every item by its own reference with
      // what is available, allocated and remaining, as the result holds them.
      const balance = new Map(result.balances.map((b) => [b.id, b]));
      for (const side of [0, 1] as const) {
        const items = result.items.filter((i) => i.side === side);
        const top = headingOf(rows, t.sides[side], 'Value ledger', lang);
        if (!items.length) {
          assert.equal(top, -1, `${name}: no item, no table`);
          continue;
        }
        assert.deepEqual(rows[top + 1], [
          t.ownReference,
          t.available,
          t.allocated,
          t.remaining,
        ]);
        items.forEach((item, k) => {
          const b = balance.get(item.id)!;
          assert.deepEqual(rows[top + 2 + k], [
            item.reference,
            b.available / unit,
            b.allocated / unit,
            b.remaining / unit,
          ]);
        });
        assert.deepEqual(rows[top + 2 + items.length], [
          null,
          null,
          null,
          null,
        ]);
      }
      // Each active allocation: its basis, reference and reason, then the
      // payment and the invoice it joins, each with the amount it takes.
      const reference = new Map(result.items.map((i) => [i.id, i.reference]));
      const links = headingOf(rows, t.activeAllocations, 'Active links', lang);
      if (!result.links.length)
        assert.equal(links, -1, `${name}: nothing active, no table`);
      result.links.forEach((l, k) => {
        const at = links + 1 + 3 * k;
        assert.deepEqual(rows[at].slice(0, 3), [
          t.basisTypes[l.basis.kind],
          l.basis.reference,
          l.basis.reason,
        ]);
        assert.deepEqual(rows[at + 1], [
          null,
          t.sides[0],
          l.amount / unit,
          reference.get(l.paymentId),
        ]);
        assert.deepEqual(rows[at + 2], [
          null,
          t.sides[1],
          l.amount / unit,
          reference.get(l.invoiceId),
        ]);
      });
      // The active allocations and no more: one an undo took back is not
      // listed, even when a later decision allocates the same link.
      if (result.links.length)
        assert.deepEqual(
          rows[links + 1 + 3 * result.links.length],
          [null, null, null, null],
          `${name}: the active allocations end`,
        );
      // Each dated decision: what it did, its number and time, then the
      // reason given, an undo with the decision it undoes.
      const events = headingOf(rows, w.decisions, 'Events', lang);
      if (!state.events.length)
        assert.equal(events, -1, `${name}: no decisions, no table`);
      state.events.forEach((e, k) => {
        const at = events + 1 + 2 * k;
        assert.deepEqual(rows[at].slice(0, 3), [
          t.eventTypes[e.type],
          e.id,
          e.at,
        ]);
        assert.deepEqual(rows[at + 1].slice(0, 3), [
          null,
          e.type === 'undo' ? `→ ${e.target}` : null,
          e.note,
        ]);
      });
      if (state.events.length)
        assert.deepEqual(
          rows[events + 1 + 2 * state.events.length],
          [null, null, null, null],
          `${name}: the decisions end`,
        );
      assert.equal(rows.at(-1)![0], t.claim);
    }
});

void test('allocation: the words are the screen words, and the claim in English is the evidence words', async () => {
  for (const [lang, locale] of [
    ['ar', ar],
    ['en', en],
  ] as const) {
    const t = reconciliationSheetCopy[lang].allocation;
    for (const key of Object.keys(t) as (keyof typeof t)[])
      if (key !== 'claim')
        assert.deepEqual(
          t[key],
          (locale.allocation as Record<string, unknown>)[key],
          `${lang} allocation.${key}`,
        );
  }
  const { state, result } = await allocationCase('one-to-many');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await exportAllocation(state, result));
  const claim = wb
    .getWorksheet('Summary')!
    .getRows(1, 40)!
    .find((r) => r.getCell(1).value === 'Claim')!
    .getCell(2).value;
  assert.equal(reconciliationSheetCopy.en.allocation.claim, claim);
});

void test('the real worker writes the allocation sheet in the language asked, and refuses none', async () => {
  const { state, result } = await allocationCase('undo');
  const port = new GlTbBindingPort();
  try {
    const client = createWorkerClient(() => port);
    for (const lang of ['ar', 'en'] as const) {
      const bytes = await client.request<ArrayBuffer>('allocation-export', {
        state,
        result,
        lang,
      });
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes);
      assert.deepEqual(
        book.worksheets.slice(0, 2).map((s) => s.name),
        [reconciliationSheetCopy[lang].name, 'Summary'],
      );
      const { rows } = await firstSheet(bytes);
      assert.equal(
        rows[1][0],
        reconciliationSheetCopy[lang].allocation.paymentAllocation,
      );
    }
    await assert.rejects(
      client.request('allocation-export', { state, result }),
      /RECONCILIATION_SHEET_LANGUAGE/,
    );
  } finally {
    port.terminate();
  }
});

/** A frozen AR case, with no decision, a reopen, or a reopen then a human
 * confirmation of the first matched pair. */
async function arCase(
  name: string,
  decisions: 'none' | 'reopen' | 'reconfirm' = 'none',
) {
  const files = await Promise.all(
    (['ledger', 'statement'] as const).map(async (side) =>
      readFile(
        `${name}-${side}.csv`,
        new Uint8Array(
          await fsRead(
            new URL(
              `../audit/ar-limited/frozen/${name}-${side}.csv`,
              import.meta.url,
            ),
          ),
        ).buffer,
      ),
    ),
  );
  const state: ArInput = {
    files: files as ArInput['files'],
    readings: structuredClone(arDemoReadings),
    scope: { ...arDemoScope },
    events: [],
  };
  let { result } = await replayAr(state);
  if (decisions !== 'none') {
    const first = result.cases.find(
      (c) => c.status === 'matched' && c.ids.length === 2,
    )!;
    state.events.push({
      context: result.context,
      at: '2026-10-06T00:00:00.000Z',
      action: 'reopen',
      ids: first.ids,
      note: 'Synthetic document correspondence reopened for review',
    });
    if (decisions === 'reconfirm')
      state.events.push({
        context: result.context,
        at: '2026-10-06T00:00:00.000Z',
        action: 'accept',
        ids: first.ids,
        note: 'Synthetic source documents independently rechecked',
      });
    ({ result } = await replayAr(state));
  }
  return { state, result };
}

void test('receivables: the evidence stays byte for byte, each document left for review with its movements, each decision with its reason', async () => {
  for (const [name, decisions] of [
    ['positive', 'none'],
    ['positive', 'reopen'],
    ['positive', 'reconfirm'],
    ['amount-difference', 'none'],
    ['duplicate-own-document', 'none'],
  ] as const)
    for (const lang of ['ar', 'en'] as const) {
      const { state, result } = await arCase(name, decisions);
      const what = `${name}/${decisions}/${lang}`;
      const evidence = await exportAr(state, result);
      const book = await addReconciliationSheet(
        evidence,
        arSheet(state, result, lang),
      );
      const before = await parts(evidence),
        after = await parts(book);
      for (const [part, bytes] of before)
        if (!WORKBOOK_PARTS.includes(part))
          assert.deepEqual(after.get(part), bytes, `${what}: ${part}`);
      const w = reconciliationSheetCopy[lang],
        t = w.receivables;
      const { rows } = await firstSheet(
        await exportArWorkpaper(state, result, lang),
      );
      assert.equal(rows[1][0], t.title, what);
      const scale = 10 ** result.decimals;
      // Each record's own total, as the strip draws it at either end.
      result.totals.forEach((minor, side) =>
        assert.deepEqual(
          rows[rowOf(rows, t.sides[side])].slice(0, 2),
          [t.sides[side], result.sources[side].name],
          `${what}: source ${side}`,
        ),
      );
      const strip = rowOf(rows, w.alignment);
      result.totals.forEach((minor, side) =>
        assert.deepEqual(
          rows[strip + 1 + side].slice(0, 2),
          [t.sides[side], minor === null ? t.unavailableTotal : minor / scale],
          `${what}: total ${side}`,
        ),
      );
      // Each document left for review: its type, number and reason, then
      // each movement with its record, amount and date.
      const byId = new Map(result.rows.map((r) => [r.id, r]));
      const waiting = result.cases.filter((c) => c.status === 'review');
      if (!waiting.length)
        assert.equal(
          rows.findIndex((r) => r[0] === t.review),
          -1,
          `${what}: nothing waits, so no review section`,
        );
      let at = waiting.length ? rowOf(rows, t.review) + 1 : 0;
      for (const c of waiting) {
        assert.deepEqual(
          rows[at++].slice(0, 3),
          [
            t.kind[c.kind as keyof typeof t.kind],
            c.document,
            t.reason[c.reason as keyof typeof t.reason],
          ],
          `${what}: ${c.id}`,
        );
        for (const id of c.ids) {
          const r = byId.get(id)!;
          assert.deepEqual(
            rows[at++],
            [null, t.sides[r.side], r.amount / scale, r.date],
            `${what}: ${id}`,
          );
        }
      }
      // Each decision: what it did, its document and the reason given.
      const head = rows.findIndex((r) => r[0] === w.decision);
      if (!state.events.length) assert.equal(head, -1, 'no decision, no table');
      state.events.forEach((event, i) => {
        const target = result.cases.find((c) => c.ids.includes(event.ids[0]))!;
        assert.deepEqual(
          rows[head + 1 + i],
          [
            t.reason[
              event.action === 'accept' ? 'human-confirmation' : 'reopened'
            ],
            t.kind[target.kind as keyof typeof t.kind],
            target.document,
            event.note,
          ],
          `${what}: decision ${i + 1}`,
        );
      });
      assert.deepEqual(rows[rowOf(rows, t.valid)].slice(0, 2), [
        t.valid,
        result.rows.length,
      ]);
      assert.deepEqual(rows[rowOf(rows, t.errors)].slice(0, 2), [
        t.errors,
        result.inventory.filter((i) => i.kind === 'error').length,
      ]);
      assert.equal(rows.at(-1)![0], t.claim);
    }
});

void test('receivables: a statement with an unreadable amount counts its reading error, and every document waits for it', async () => {
  const { state } = await arCase('positive');
  const statement = new TextDecoder().decode(state.files[1].original!);
  state.files[1] = await readFile(
    'positive-statement.csv',
    new TextEncoder().encode(
      statement.trimEnd() +
        '\nS999,invoice,I999,2026-09-20,unread,Synthetic Seller,AR Book,C0001,1200,SAR,,Unread amount\n',
    ).buffer,
  );
  const { result } = await replayAr(state);
  const errors = result.inventory.filter((i) => i.kind === 'error').length;
  assert.equal(errors, 1);
  for (const lang of ['ar', 'en'] as const) {
    const t = reconciliationSheetCopy[lang].receivables;
    const { rows } = await firstSheet(
      await exportArWorkpaper(state, result, lang),
    );
    assert.deepEqual(rows[rowOf(rows, t.errors)].slice(0, 2), [t.errors, 1]);
    const waiting = result.cases.filter((c) => c.status === 'review');
    assert.equal(waiting.length, result.cases.length);
    assert.equal(
      rows.filter((r) => r[2] === t.reason['source-errors']).length,
      waiting.length + 1,
      'each document, and the main reason in the strip',
    );
  }
});

void test('receivables: a record without a total says why, and its words are the screen words', async () => {
  const { state, result } = await arCase('positive');
  const missing = structuredClone(result);
  missing.totals = [missing.totals[0], null];
  for (const lang of ['ar', 'en'] as const) {
    const t = reconciliationSheetCopy[lang].receivables;
    const sheet = arSheet(state, missing, lang);
    const at = sheet.rows.findIndex(
      (r) =>
        r[0] &&
        'text' in r[0] &&
        r[0].text === reconciliationSheetCopy[lang].alignment,
    );
    assert.deepEqual(sheet.rows[at + 2][1], {
      text: t.unavailableTotal,
      style: 'value',
    });
  }
  for (const [lang, locale] of [
    ['ar', ar],
    ['en', en],
  ] as const) {
    const t = reconciliationSheetCopy[lang].receivables;
    const screen = locale.arDocuments as Record<string, unknown>;
    for (const key of Object.keys(t) as (keyof typeof t)[]) {
      if (key === 'claim') continue;
      if (key === 'fields')
        for (const [field, word] of Object.entries(t.fields))
          assert.equal(
            word,
            (screen.fields as Record<string, string>)[field],
            `${lang} fields.${field}`,
          );
      else assert.deepEqual(t[key], screen[key], `${lang} receivables.${key}`);
    }
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await exportAr(state, result));
  const claim = wb
    .getWorksheet('Summary')!
    .getRows(1, 40)!
    .find((r) => r.getCell(1).value === 'Economic coverage')!
    .getCell(2).value;
  assert.equal(reconciliationSheetCopy.en.receivables.claim, claim);
});

void test('the real worker writes the AR sheet in the language asked, and the binding refuses a request without one', async () => {
  const { state, result } = await arCase('positive', 'reopen');
  // What the worker itself sent, before the page checks it; and, when set,
  // another workbook put in its place.
  const sent: ArrayBuffer[] = [];
  let replaced: ArrayBuffer | null = null;
  const port = new GlTbBindingPort((response, deliver) => {
    if (response.action === 'ar-export' && response.ok) {
      sent.push((response.value as ArrayBuffer).slice(0));
      if (replaced) response = { ...response, value: replaced.slice(0) };
    }
    deliver(response);
  });
  const names = async (bytes: ArrayBuffer) => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    return book.worksheets.slice(0, 2).map((s) => s.name);
  };
  try {
    const client = createWorkerClient(() => port);
    for (const lang of ['ar', 'en'] as const) {
      const reply = await client
        .request<ArrayBuffer>('ar-export', { state, result, lang })
        .catch((error: unknown) => error);
      // The worker wrote the language asked, whatever the page then does.
      assert.deepEqual(await names(sent.at(-1)!), [
        reconciliationSheetCopy[lang].name,
        'Summary',
      ]);
      // And the page, writing the same workpaper itself, accepted it.
      assert.ok(
        reply instanceof ArrayBuffer,
        `the page accepted the ${lang} workpaper`,
      );
      assert.deepEqual(await names(reply), [
        reconciliationSheetCopy[lang].name,
        'Summary',
      ]);
    }
    // A reply in the other language is not the one asked for.
    replaced = sent[0];
    await assert.rejects(
      client.request('ar-export', { state, result, lang: 'en' }),
      /AR_WORKER_BINDING/,
    );
    replaced = null;
    // Refused by the binding before the worker, with no language or another.
    for (const payload of [
      { state, result },
      { state, result, lang: 'fr' },
    ])
      await assert.rejects(
        client.request('ar-export', payload),
        /AR_WORKER_INPUT/,
      );
  } finally {
    port.terminate();
  }
});

void test('a printed page is broken above a whole section or document, never inside one; a sheet that fits one page is not broken', async () => {
  const breaks = (xml: string) => {
    const list =
      /<rowBreaks count="(\d+)" manualBreakCount="(\d+)">([\s\S]*?)<\/rowBreaks>/.exec(
        xml,
      );
    if (!list) return [];
    const ids = [
      ...list[3].matchAll(/<brk id="(\d+)" max="16383" man="1"\/>/g),
    ].map((m) => Number(m[1]));
    assert.deepEqual(
      [Number(list[1]), Number(list[2])],
      [ids.length, ids.length],
    );
    return ids;
  };
  // The zero-based row whose first cell says label: a break stands above it.
  const above = (
    rows: Awaited<ReturnType<typeof sheetParts>>['rows'],
    label: string,
  ) => {
    const row = rows.find(
      (r) => r.cells[0]?.col === 'A' && r.cells[0].text === label,
    );
    assert.ok(row, label);
    return row.n - 1;
  };
  // A GL/TB sheet fits one page: no break.
  const { state: gl, result: glResult } = await glTbCase('positive');
  for (const lang of ['ar', 'en'] as const) {
    const { xml } = await sheetParts(
      await exportGlTbWorkpaper(gl, glResult, lang),
    );
    assert.equal(breaks(xml).length, 0, lang);
    assert.ok(!xml.includes('<brk'), lang);
  }
  // A reopened AR document runs past one page. In English the page is
  // broken above the recorded decisions, so their heading, head and first
  // decision print together, as LibreOffice showed them cut apart; in
  // Arabic, above the sign-off, so both its lines print with its heading.
  const { state, result } = await arCase('positive', 'reopen');
  const words = reconciliationSheetCopy;
  const en = await sheetParts(await exportArWorkpaper(state, result, 'en'));
  assert.deepEqual(breaks(en.xml), [above(en.rows, words.en.decisions)]);
  const arabic = await sheetParts(await exportArWorkpaper(state, result, 'ar'));
  assert.deepEqual(breaks(arabic.xml), [
    above(arabic.rows, words.ar.signature),
  ]);
  // The document waiting for review is kept whole with its two movements,
  // and with the heading above it, as the first of its list.
  const sheet = arSheet(state, result, 'en');
  const heading = sheet.rows.findIndex(
    (r) => r[0] && 'text' in r[0] && r[0].text === words.en.receivables.review,
  );
  assert.deepEqual(sheet.rows[heading + 1].slice(0, 2), [
    { text: 'Invoice', style: 'value' },
    { text: 'I001', style: 'value' },
  ]);
  assert.ok(
    sheet.keep?.some(([a, b]) => a === heading && b === heading + 3),
    JSON.stringify(sheet.keep),
  );
  // Laid out from sections: 43 rows, then a section of three that would not
  // fit what is left of the first page, is broken above that section's
  // heading; with 10 rows first, all fits and nothing is broken; and a
  // section taller than a page is not sent to a page of its own.
  const { state: base } = await clearingCase('none');
  const evidence = await exportClearing(base, reconcileClearing(base));
  const pairs = (title: string, n: number) => ({
    kind: 'pairs' as const,
    title,
    rows: Array.from({ length: n }, (_, i) => ({
      label: `${title} ${i + 1}`,
      value: { text: 'x', style: 'value' as const },
    })),
  });
  const laid = async (...sections: ReturnType<typeof pairs>[]) =>
    sheetParts(
      await addReconciliationSheet(
        evidence,
        composeSheet('en', { title: 'Synthetic', sections }),
      ),
    );
  const straddles = await laid(pairs('First', 43), pairs('Second', 3));
  assert.deepEqual(breaks(straddles.xml), [above(straddles.rows, 'Second')]);
  const fits = await laid(pairs('First', 10), pairs('Second', 3));
  assert.deepEqual(breaks(fits.xml), []);
  const tall = await laid(
    pairs('First', 3),
    pairs('Long', 60),
    pairs('Last', 3),
  );
  assert.ok(!breaks(tall.xml).includes(above(tall.rows, 'Long')));
});

const supplierAll = await supplierCases();
const supplierCase = (name: string): SupplierCase =>
  structuredClone(supplierAll.find((c) => c.name === `supplier-${name}`)!);

void test('supplier: the evidence stays byte for byte, the balances as the workpaper step writes them, each case under review with its members, each unmatched one, each decision with its reason', async () => {
  for (const name of [
    'example',
    'example-bytes',
    'balance-unproven',
    'decided',
    'blank-scope',
    'three-decimals',
    'partial-PR03',
    'partial-PR12',
  ])
    for (const lang of ['ar', 'en'] as const) {
      const { result, files, review } = supplierCase(name);
      const evidence = await exportWorkbook(result, files, review);
      const book = await addReconciliationSheet(
        evidence,
        supplierSheet(result, files, review, lang),
      );
      const before = await parts(evidence),
        after = await parts(book);
      assert.deepEqual(
        [...after.keys()].filter((k) => !before.has(k)),
        [
          `xl/worksheets/sheet${[...before.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).length + 1}.xml`,
        ],
        `${name}: one sheet part added`,
      );
      for (const [part, bytes] of before)
        if (!WORKBOOK_PARTS.includes(part))
          assert.deepEqual(after.get(part), bytes, `${name} ${lang}: ${part}`);
      const w = reconciliationSheetCopy[lang],
        t = w.supplier,
        b = t.balances,
        s = alignmentStripCopy[lang];
      const { rows } = await firstSheet(
        await exportSupplierWorkpaper(result, files, review, lang),
      );
      assert.equal(rows[1][0], t.title, name);
      const unit = 10 ** result.scope.decimals;
      const blankRow = [null, null, null, null];
      // The scope: each field the evidence's Summary writes, in the screen's
      // words; one it leaves empty is not written.
      const scopeAt = headingOf(rows, w.scope, 'Summary', lang);
      const written = [
        [t.fields.supplier, result.scope.supplier],
        [t.fields.entity, result.scope.entity],
        [t.fields.account, result.scope.account],
        [t.fields.currency, result.scope.currency],
        [t.fields.cutoff, result.scope.cutoff],
      ].filter(([, v]) => v);
      written.forEach(([label, v], k) =>
        assert.deepEqual(rows[scopeAt + 1 + k].slice(0, 2), [label, v], name),
      );
      assert.deepEqual(rows[scopeAt + 1 + written.length], blankRow);
      // The two sources by the page's names for them, each with its whole
      // fingerprint, or the word for a source built with no original file.
      for (const side of [0, 1] as const) {
        const at = rowOf(rows, t.sides[side]);
        assert.deepEqual(rows[at].slice(0, 2), [
          t.sides[side],
          files[side].name,
        ]);
        assert.deepEqual(rows[at + 1].slice(0, 2), [
          w.fingerprint,
          files[side].sha256 ?? t.noOriginal,
        ]);
      }
      // The strip: the cases aligned, those waiting and those without a
      // counterpart, and the closing difference where the engine computed it.
      const counts = result.caseCounts;
      assert.deepEqual(rows[rowOf(rows, s.agreed)].slice(0, 2), [
        s.agreed,
        counts.autoMatchedCases + counts.manualMatches,
      ]);
      const review0 = rowOf(rows, s.review);
      assert.deepEqual(rows[review0].slice(0, 2), [
        s.review,
        counts.needsReviewCases,
      ]);
      assert.deepEqual(rows[review0 + 1].slice(1, 3), [
        s.alone,
        counts.unmatchedCases,
      ]);
      assert.deepEqual(
        rows[rowOf(rows, s.gap)].slice(0, 2),
        [
          s.gap,
          result.bridge === null
            ? s.notComputed
            : result.bridge.delta
              ? result.bridge.delta / unit
              : s.noDifference,
        ],
        name,
      );
      // The balances, where the workpaper step writes them.
      const balances = headingOf(
        rows,
        b.heading,
        'Reconciliation Bridge',
        lang,
      );
      if (!result.scope.coverageConfirmed && !result.bridge)
        assert.equal(balances, -1, `${name}: no balances section`);
      else {
        const minor = (v: number | null) =>
          v === null ? b.notAvailable : v / unit;
        const expected: [string, string | number][] = [
          [b.supplierBalance, minor(result.supplier.closing)],
          [b.ledgerBalance, minor(result.ledger.closing)],
          [
            b.balanceCheck,
            result.bridge
              ? result.balanceComparable
                ? b.consistentConfirmed
                : b.consistentUnconfirmed
              : b.notProven,
          ],
          ...(result.bridge
            ? ([
                [b.openingAdjustment, result.bridge.openingAdjustment / unit],
                [b.itemAdjustment, result.bridge.itemAdjustment / unit],
                [b.adjusted, result.bridge.adjusted / unit],
                [b.residual, result.bridge.residual / unit],
              ] as [string, number][])
            : []),
        ];
        expected.forEach((row, k) =>
          assert.deepEqual(rows[balances + 1 + k].slice(0, 2), row, name),
        );
        assert.deepEqual(rows[balances + 1 + expected.length], blankRow);
      }
      // Each case the review tab lists, in the result's order: its state in
      // the table's word on its first member, then every member with its
      // side, signed amount and reference.
      const waiting = result.cases.filter(
        (c) => c.status === 'Needs Review' || c.status === 'Rejected',
      );
      const reviewAt = headingOf(
        rows,
        t.status.needsReview,
        'Needs Review',
        lang,
      );
      if (!waiting.length) assert.equal(reviewAt, -1, `${name}: none waits`);
      let at = reviewAt + 1;
      for (const c of waiting) {
        const word =
          t.status[
            c.classification === 'AMOUNT_VARIANCE'
              ? 'amountVariance'
              : c.classification === 'PAYMENT_CANDIDATE'
                ? 'paymentCandidate'
                : c.status === 'Rejected'
                  ? 'rejected'
                  : 'needsReview'
          ];
        [...c.supplierMembers, ...c.ledgerMembers].forEach((tx, i) =>
          assert.deepEqual(
            rows[at++],
            [
              i ? null : word,
              t.sideShort[tx.side],
              tx.amount / unit,
              tx.reference || t.noReference,
            ],
            `${name}: ${c.caseId}`,
          ),
        );
      }
      if (waiting.length)
        assert.deepEqual(rows[at], blankRow, `${name}: the review cases end`);
      // Each case the unmatched tab lists: its first member's date, side and
      // reference, with the case's amount.
      const unmatched = result.cases.filter((c) => c.status === 'Unmatched');
      const unmatchedAt = headingOf(rows, t.unmatched, 'Unmatched', lang);
      if (!unmatched.length) assert.equal(unmatchedAt, -1);
      unmatched.forEach((c, k) => {
        const tx = c.supplierMembers[0] ?? c.ledgerMembers[0];
        assert.deepEqual(rows[unmatchedAt + 1 + k], [
          tx.date,
          t.sideShort[tx.side],
          (c.supplierMembers.length ? c.supplierTotal : c.ledgerTotal) / unit,
          tx.reference || t.noReference,
        ]);
      });
      if (unmatched.length)
        assert.deepEqual(
          rows[unmatchedAt + 1 + unmatched.length],
          blankRow,
          `${name}: the unmatched cases end`,
        );
      // Each decision recorded, in its order, in the word the screen gives
      // the state it leaves, its members by their references, the reason as
      // written; a comparison run is not a decision.
      const decisions = review.events.filter((e) => e.action !== 'compare');
      const eventsAt = headingOf(rows, w.decisions, 'Review History', lang);
      if (!decisions.length) assert.equal(eventsAt, -1, `${name}: no decision`);
      else {
        assert.deepEqual(rows[eventsAt + 1].slice(0, 3), [
          w.decision,
          t.reference,
          t.reason,
        ]);
        const all = [
          ...result.supplier.transactions,
          ...result.ledger.transactions,
        ];
        decisions.forEach((e, k) =>
          assert.deepEqual(rows[eventsAt + 2 + k].slice(0, 3), [
            e.action === 'link'
              ? t.status.manual
              : e.action === 'unlink'
                ? t.status.rejected
                : t.reviewedStillOpen,
            e.ids
              .map((id) => all.find((tx) => tx.id === id)!.reference)
              .join(' · '),
            e.note,
          ]),
        );
        assert.deepEqual(
          rows[eventsAt + 2 + decisions.length],
          blankRow,
          `${name}: the decisions end`,
        );
      }
      assert.equal(
        rows.at(-1)![0],
        readingStatus([result.supplier, result.ledger]).partial
          ? t.claim.partial
          : t.claim.verified,
        name,
      );
    }
});

void test('supplier: the words are the screen words, and the claim and a missing original in English are the evidence words', async () => {
  for (const [lang, locale] of [
    ['ar', ar],
    ['en', en],
  ] as const) {
    const t = reconciliationSheetCopy[lang].supplier,
      app = locale.app;
    assert.equal(t.title, reconciliationDirectoryCopy[lang].supplierTitle);
    assert.deepEqual(t.sides, app.sides);
    assert.deepEqual(t.sideShort, app.sideShort);
    assert.deepEqual(t.fields, app.scopeFields);
    assert.deepEqual(t.status, app.results.status);
    assert.equal(t.reviewedStillOpen, app.results.reviewedStillOpen);
    assert.equal(t.unmatched, app.results.tabUnmatched);
    assert.equal(t.noReference, app.results.noReference);
    assert.equal(t.reference, app.results.columns[2]);
    assert.equal(t.reason, locale.transactionReview.noteLabel);
    const { heading, ...lines } = t.balances;
    assert.equal(heading, app.finish.balancesHeading);
    for (const [key, word] of Object.entries(lines))
      assert.equal(
        word,
        (app.finish as Record<string, unknown>)[key],
        `${lang} finish.${key}`,
      );
  }
  const summary = async (c: SupplierCase) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await exportWorkbook(c.result, c.files, c.review));
    const field = (sheet: string, label: string) =>
      wb
        .getWorksheet(sheet)!
        .getRows(1, 60)!
        .find((r) => r.getCell(1).value === label)!
        .getCell(2).value;
    return {
      mode: field('Summary', 'Workbook Mode'),
      hash: field('Export Metadata', 'Supplier SHA-256'),
    };
  };
  const t = reconciliationSheetCopy.en.supplier;
  const example = await summary(supplierCase('example'));
  assert.equal(example.mode, t.claim.verified);
  assert.equal(example.hash, t.noOriginal);
  assert.equal(
    (await summary(supplierCase('partial-PR03'))).mode,
    t.claim.partial,
  );
});

void test('the real worker writes the supplier sheet in the language asked, and refuses none before any work', async () => {
  const { result, files, review } = supplierCase('decided');
  // A refused request ends its worker, and the client starts a new one for
  // the next, as the page's does.
  const ports: GlTbBindingPort[] = [];
  try {
    const client = createWorkerClient(() => {
      const port = new GlTbBindingPort();
      ports.push(port);
      return port;
    });
    for (const lang of ['ar', 'en'] as const) {
      const bytes = await client.request<ArrayBuffer>('export', {
        result,
        files,
        review,
        lang,
      });
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes);
      assert.deepEqual(
        book.worksheets.slice(0, 2).map((s) => s.name),
        [reconciliationSheetCopy[lang].name, 'Summary'],
      );
      const { rows } = await firstSheet(bytes);
      assert.equal(rows[1][0], reconciliationSheetCopy[lang].supplier.title);
    }
    await assert.rejects(
      client.request('export', { result, files, review }),
      /RECONCILIATION_SHEET_LANGUAGE/,
    );
    // The language is refused before the export recomputes anything: a
    // stale result with no language is refused for the language.
    const stale = structuredClone(result);
    stale.supplier.transactions[0].amount += 1;
    await assert.rejects(
      client.request('export', { result: stale, files, review, lang: 'fr' }),
      /RECONCILIATION_SHEET_LANGUAGE/,
    );
    await assert.rejects(
      client.request('export', { result: stale, files, review, lang: 'en' }),
      /لا تطابق إعادة الحساب/,
    );
  } finally {
    for (const port of ports) port.terminate();
  }
});

// UX-6(c), the trial balance and financial position: frozen cases with the
// decisions their story records, and without them.
const FINANCIAL_CASES = [
  'whole-post-closing',
  'pending',
  'undo',
  'reject',
  'reject-undo-accept',
  'offsetting-line-differences',
  'unbalanced-tb',
  'incomplete-attestation',
  'missing-mapping',
  'empty-tb',
  'wrong-sign',
  'kwd-three-decimals',
];
const FINANCIAL_ONLY = {
  currencyBasis: 'functional',
  postingStatus: 'posted',
  closingBasis: 'post-closing',
} as const;

void test('financial position: the evidence stays byte for byte, the trial balance, the position by basis, each line with its state and difference, each decision with its reason', async () => {
  const seen = new Set<string>();
  for (const name of FINANCIAL_CASES)
    for (const lang of ['ar', 'en'] as const) {
      assert.ok(
        financialTruth.cases.some((c) => c.name === name && !c.reject),
        name,
      );
      const { state, result } = await finishedFinancial(name);
      seen.add(result.status);
      const evidence = await exportFinancialPosition(state, result);
      const book = await addReconciliationSheet(
        evidence,
        financialSheet(result, lang),
      );
      const before = await parts(evidence),
        after = await parts(book);
      for (const [part, bytes] of before)
        if (!WORKBOOK_PARTS.includes(part))
          assert.deepEqual(after.get(part), bytes, `${name}: ${part}`);
      const w = reconciliationSheetCopy[lang],
        t = w.financial;
      const { rows } = await firstSheet(
        await exportFinancialWorkpaper(state, result, lang),
      );
      assert.equal(rows[1][0], t.trialBalanceAndFinancialPosition, name);
      const unit = 10 ** result.decimals;
      const blank = (at: number, what: string) =>
        assert.deepEqual(
          rows[at] ?? [null, null, null, null],
          [null, null, null, null],
          `${name}: ${what} end`,
        );
      // The scope in the screen's words; the three one-option fields in the
      // card's words for their one value.
      FINANCIAL_SCOPE_FIELDS.forEach((key, i) =>
        assert.deepEqual(
          rows[rowOf(rows, t.scope[i])].slice(0, 2),
          [
            t.scope[i],
            key in FINANCIAL_ONLY &&
            result.scope[key] ===
              FINANCIAL_ONLY[key as keyof typeof FINANCIAL_ONLY]
              ? t.only[key as keyof typeof FINANCIAL_ONLY]
              : result.scope[key],
          ],
          `${name}: ${key}`,
        ),
      );
      // The four sources by their roles and whole fingerprints.
      result.sources.forEach((source, i) => {
        const at = rows.findIndex(
          (r) => r[0] === t.roles[i] && r[1] === source.name,
        );
        assert.ok(at >= 0, `${name}: ${t.roles[i]}`);
        assert.deepEqual(rows[at + 1].slice(0, 2), [
          w.fingerprint,
          source.hash,
        ]);
      });
      // The strip, cell by cell, from the function the screen draws with,
      // the result's state in the screen's words.
      const s = alignmentStripCopy[lang];
      assert.deepEqual(rows[rowOf(rows, s.review)].slice(0, 2), [
        s.review,
        result.lines.filter((l) => l.review === 'needs-review').length,
      ]);
      for (const cell of stripView(financialStrip(result), s, {
        state: t.status[result.status],
      })) {
        const at = rowOf(rows, cell.label),
          row = rows[at];
        if (cell.value.kind === 'count')
          assert.deepEqual(
            row.slice(1),
            cell.value.of === undefined
              ? [cell.value.count, null, null]
              : [cell.value.count, w.of, cell.value.of],
          );
        else if (cell.value.kind === 'amount')
          assert.equal(row[1], cell.value.minor / unit, `${name}: the gap`);
        else assert.equal(row[1], cell.value.text, `${name}: ${cell.cell}`);
        cell.notes.forEach((n, i) =>
          assert.deepEqual(
            rows[at + 1 + i].slice(0, 3),
            [null, n.text, n.value ?? null],
            `${name}: ${cell.cell} note ${i + 1}`,
          ),
        );
      }
      // The completeness attestation, written once given.
      const attest = headingOf(
        rows,
        t.suppliedInventoryAttestation,
        'Summary',
        lang,
      );
      if (!result.completeness.confirmed)
        assert.equal(attest, -1, `${name}: no attestation, no section`);
      else {
        assert.deepEqual(rows[attest + 1].slice(0, 2), [
          t.attestationReference,
          result.completeness.reference,
        ]);
        assert.deepEqual(rows[attest + 2].slice(0, 2), [
          t.attestationReason,
          result.completeness.note,
        ]);
        blank(attest + 3, 'the attestation');
      }
      // The trial balance's three figures, where the engine reads one.
      const tb = headingOf(rows, t.roles[0], 'Summary', lang);
      if (!result.tb) assert.equal(tb, -1, `${name}: no trial balance`);
      else {
        [result.tb.debit, result.tb.credit, result.tb.residual].forEach(
          (minor, i) =>
            assert.deepEqual(rows[tb + 1 + i].slice(0, 2), [
              t.trialBalanceFigures[i],
              minor / unit,
            ]),
        );
        blank(tb + 4, 'the trial balance');
      }
      // The position by basis: each figure a row, calculated and reported.
      const position = headingOf(
        rows,
        t.tableNames.position,
        'Grand totals',
        lang,
      );
      if (!result.grandTotals)
        assert.equal(position, -1, `${name}: no position`);
      else {
        assert.deepEqual(rows[position + 1].slice(0, 3), [
          t.basis,
          t.lineFigures[0],
          t.lineFigures[1],
        ]);
        (
          [
            ['assets', t.assets],
            ['liabilities', t.liabilities],
            ['equity', t.equity],
            ['equation', t.positionEquation],
          ] as const
        ).forEach(([key, label], k) =>
          assert.deepEqual(rows[position + 2 + k].slice(0, 3), [
            label,
            result.grandTotals!.calculated[key] / unit,
            result.grandTotals!.reported[key] / unit,
          ]),
        );
        blank(position + 6, 'the position');
        // The four figures print on one page, with the heading and head.
        assert.ok(
          financialSheet(result, lang).keep!.some(
            ([from, to]) => from === position && to === position + 5,
          ),
          `${name}: the position is kept whole`,
        );
      }
      // Every statement line by its number, its class, its state and the
      // difference, or the screen's dash where the engine computes none.
      const lines = headingOf(rows, t.statementLines, 'Lines', lang);
      if (!result.lines.length)
        assert.equal(lines, -1, `${name}: no line, no table`);
      else {
        assert.deepEqual(rows[lines + 1], [
          t.line,
          t.class,
          t.state,
          t.lineFigures[2],
        ]);
        result.lines.forEach((l, k) =>
          assert.deepEqual(rows[lines + 2 + k], [
            l.lineId,
            t.categories[l.category],
            t.status[l.review],
            l.difference === null ? '—' : l.difference / unit,
          ]),
        );
        blank(lines + 2 + result.lines.length, 'the lines');
      }
      // Each recorded decision: its button's word, the line and its time,
      // then the evidence reference and the reason given.
      const events = headingOf(rows, w.decisions, 'Events', lang);
      if (!result.events.length)
        assert.equal(events, -1, `${name}: no decisions, no table`);
      result.events.forEach((e, k) => {
        const at = events + 1 + 2 * k;
        assert.deepEqual(rows[at].slice(0, 3), [
          t.decisionLabels[e.type],
          e.lineId,
          e.at,
        ]);
        assert.deepEqual(rows[at + 1].slice(0, 3), [null, e.reference, e.note]);
      });
      if (result.events.length)
        blank(events + 1 + 2 * result.events.length, 'the decisions');
      assert.equal(rows.at(-1)![0], t.claim);
    }
  // The cases cover a result of every state the engine gives.
  assert.deepEqual([...seen].sort(), [
    'consistent-with-evidence',
    'difference',
    'inconsistent',
    'missing',
    'needs-review',
    'source-error',
  ]);
});

void test('financial position: the words are the screen words, and the claim in English is the evidence words', async () => {
  for (const [lang, locale] of [
    ['ar', ar],
    ['en', en],
  ] as const) {
    const t = reconciliationSheetCopy[lang].financial;
    for (const key of Object.keys(t) as (keyof typeof t)[])
      if (key !== 'claim')
        assert.deepEqual(
          t[key],
          (locale.financial as Record<string, unknown>)[key],
          `${lang} financial.${key}`,
        );
  }
  const { state, result } = await finishedFinancial('whole-post-closing');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await exportFinancialPosition(state, result));
  const claim = wb
    .getWorksheet('Summary')!
    .getRows(1, 40)!
    .find((r) => r.getCell(1).value === 'Claim')!
    .getCell(2).value;
  assert.equal(reconciliationSheetCopy.en.financial.claim, claim);
  assert.notEqual(reconciliationSheetCopy.ar.financial.claim, claim);
});

void test('the real worker writes the financial position sheet in the language asked, and refuses none', async () => {
  const { state, result } = await finishedFinancial('reject');
  const port = new GlTbBindingPort();
  try {
    const client = createWorkerClient(() => port);
    for (const lang of ['ar', 'en'] as const) {
      const bytes = await client.request<ArrayBuffer>('tb-financial-export', {
        state,
        result,
        lang,
      });
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes);
      assert.deepEqual(
        book.worksheets.slice(0, 2).map((s) => s.name),
        [reconciliationSheetCopy[lang].name, 'Summary'],
      );
      const { rows } = await firstSheet(bytes);
      assert.equal(
        rows[1][0],
        reconciliationSheetCopy[lang].financial
          .trialBalanceAndFinancialPosition,
      );
    }
    await assert.rejects(
      client.request('tb-financial-export', { state, result }),
      /RECONCILIATION_SHEET_LANGUAGE/,
    );
  } finally {
    port.terminate();
  }
});

// UX-6(c), intercompany: frozen cases with the decisions their story
// records, and without them, covering every state the engine gives a result
// and a pair, an attestation given and not, and three precisions.
const INTERCOMPANY_CASES = [
  'pending',
  'undo',
  'reject',
  'reject-undo-accept',
  'amount-difference',
  'one-counterparty-missing',
  'missing-relationship',
  'future-right-timing-evidence',
  'incomplete-inventory',
  'timing-with-present-counterpart',
  'jpy',
  'kwd',
];
const INTERCOMPANY_ONLY = {
  currencyBasis: 'functional',
  fxPolicy: 'same-currency-no-conversion',
  postingStatus: 'posted',
} as const;

void test('intercompany: the evidence stays byte for byte, the result state, debit, credit and net by side, each pair with its state, review and figures, each decision with its reason', async () => {
  const seen = new Set<string>(),
    pairSeen = new Set<string>();
  for (const name of INTERCOMPANY_CASES)
    for (const lang of ['ar', 'en'] as const) {
      assert.ok(
        intercompanyTruth.cases.some((c) => c.name === name && !c.reject),
        name,
      );
      const { state, result } = await finishedIntercompany(name);
      seen.add(result.status);
      for (const p of result.pairs) pairSeen.add(`${p.status}/${p.review}`);
      const evidence = await exportIntercompany(state, result);
      const book = await addReconciliationSheet(
        evidence,
        intercompanySheet(result, lang),
      );
      const before = await parts(evidence),
        after = await parts(book);
      for (const [part, bytes] of before)
        if (!WORKBOOK_PARTS.includes(part))
          assert.deepEqual(after.get(part), bytes, `${name}: ${part}`);
      const w = reconciliationSheetCopy[lang],
        t = w.intercompany;
      const { rows } = await firstSheet(
        await exportIntercompanyWorkpaper(state, result, lang),
      );
      assert.equal(rows[1][0], t.title, name);
      const unit = 10 ** result.decimals;
      const amount = (minor: number | null | undefined) =>
        minor === null || minor === undefined ? '—' : minor / unit;
      const blank = (at: number, what: string) =>
        assert.deepEqual(
          rows[at] ?? [null, null, null, null],
          [null, null, null, null],
          `${name}: ${what} end`,
        );
      // The scope in the screen's words; the three one-option fields in the
      // card's words for their one value.
      IC_SCOPE_FIELDS.forEach((key, i) =>
        assert.deepEqual(
          rows[rowOf(rows, t.scope[i])].slice(0, 2),
          [
            t.scope[i],
            key in INTERCOMPANY_ONLY &&
            result.scope[key] ===
              INTERCOMPANY_ONLY[key as keyof typeof INTERCOMPANY_ONLY]
              ? t.only[key as keyof typeof INTERCOMPANY_ONLY]
              : result.scope[key],
          ],
          `${name}: ${key}`,
        ),
      );
      // The four sources by their roles and whole fingerprints.
      result.sources.forEach((source, i) => {
        const at = rows.findIndex(
          (r) => r[0] === t.roles[i] && r[1] === source.name,
        );
        assert.ok(at >= 0, `${name}: ${t.roles[i]}`);
        assert.deepEqual(rows[at + 1].slice(0, 2), [
          w.fingerprint,
          source.hash,
        ]);
      });
      // The strip, cell by cell, from the function the screen draws with,
      // its reason in the screen's words; then the result's state as the
      // screen's heading writes it, the alignment's last row.
      const s = alignmentStripCopy[lang];
      const status = (code: string) =>
        (t.status as Record<string, string>)[code];
      assert.deepEqual(rows[rowOf(rows, s.review)].slice(0, 2), [
        s.review,
        result.pairs.filter((p) => p.review === 'needs-review').length,
      ]);
      for (const cell of stripView(intercompanyStrip(result), s, {
        reason: status,
        state: status(result.status),
      })) {
        const at = rowOf(rows, cell.label),
          row = rows[at];
        if (cell.value.kind === 'count')
          assert.deepEqual(
            row.slice(1),
            cell.value.of === undefined
              ? [cell.value.count, null, null]
              : [cell.value.count, w.of, cell.value.of],
          );
        else if (cell.value.kind === 'amount')
          assert.equal(row[1], cell.value.minor / unit, `${name}: the gap`);
        else assert.equal(row[1], cell.value.text, `${name}: ${cell.cell}`);
        cell.notes.forEach((n, i) =>
          assert.deepEqual(
            rows[at + 1 + i].slice(0, 3),
            [null, n.text, n.value ?? null],
            `${name}: ${cell.cell} note ${i + 1}`,
          ),
        );
      }
      const stateAt = rowOf(rows, s.state);
      assert.deepEqual(
        rows[stateAt].slice(0, 2),
        [s.state, status(result.status)],
        `${name}: the result's state`,
      );
      assert.ok(status(result.status), `${name}: a word for the state`);
      blank(stateAt + 1, 'the alignment');
      // The supplied inventory attestation, written once given.
      const attest = headingOf(rows, t.completenessTitle, 'Summary', lang);
      if (!result.completeness.confirmed)
        assert.equal(attest, -1, `${name}: no attestation, no section`);
      else {
        assert.deepEqual(rows[attest + 1].slice(0, 2), [
          t.completeReference,
          result.completeness.reference,
        ]);
        assert.deepEqual(rows[attest + 2].slice(0, 2), [
          t.completeNote,
          result.completeness.note,
        ]);
        blank(attest + 3, 'the attestation');
      }
      // Debit, credit and net by side, where the engine computes them, on
      // one printed page.
      const sides = headingOf(rows, t.tableNames.totals, 'Totals', lang);
      if (!result.totals) assert.equal(sides, -1, `${name}: no totals`);
      else {
        assert.deepEqual(rows[sides + 1], t.totals);
        result.totals.forEach((total, k) =>
          assert.deepEqual(rows[sides + 2 + k], [
            t.roles[k],
            total.debit / unit,
            total.credit / unit,
            total.net / unit,
          ]),
        );
        blank(sides + 4, 'the totals');
        assert.ok(
          intercompanySheet(result, lang).keep!.some(
            ([from, to]) => from === sides && to === sides + 3,
          ),
          `${name}: the totals are kept whole`,
        );
      }
      // Every pair as the screen draws it: its relation, state and review,
      // then its two nets and the residual, or the screen's dash where the
      // engine computes none.
      const pairs = headingOf(rows, t.pairs, 'Pairs', lang);
      if (!result.pairs.length)
        assert.equal(pairs, -1, `${name}: no pair, no table`);
      const kept = intercompanySheet(result, lang).keep!;
      result.pairs.forEach((p, k) => {
        const at = pairs + 1 + 4 * k;
        // A pair prints with its figures, the first with the heading.
        assert.ok(
          kept.some(([from, to]) => from === (k ? at : pairs) && to === at + 3),
          `${name}: ${p.relationId} kept whole`,
        );
        assert.deepEqual(
          rows[at],
          [p.relationId, status(p.status), status(p.review), null],
          `${name}: ${p.relationId}`,
        );
        (
          [
            [t.residualFigures[0], p.left?.net],
            [t.residualFigures[1], p.right?.net],
            [t.residualFigures[2], p.residual],
          ] as const
        ).forEach(([label, minor], j) =>
          assert.deepEqual(
            rows[at + 1 + j],
            [null, label, amount(minor), null],
            `${name}: ${p.relationId} ${label}`,
          ),
        );
      });
      if (result.pairs.length)
        blank(pairs + 1 + 4 * result.pairs.length, 'the pairs');
      // Each recorded decision: its button's word, the relation and its
      // time, then the reference and the explanation given.
      const events = headingOf(rows, w.decisions, 'Events', lang);
      if (!result.events.length)
        assert.equal(events, -1, `${name}: no decisions, no table`);
      result.events.forEach((e, k) => {
        const at = events + 1 + 2 * k;
        assert.deepEqual(rows[at].slice(0, 3), [t[e.type], e.relationId, e.at]);
        assert.deepEqual(rows[at + 1].slice(0, 3), [null, e.reference, e.note]);
      });
      if (result.events.length)
        blank(events + 1 + 2 * result.events.length, 'the decisions');
      assert.equal(rows.at(-1)![0], t.claim);
    }
  // The cases cover a result of every state the engine gives, and a pair
  // of every state and review.
  assert.deepEqual([...seen].sort(), [
    'consistent-with-evidence',
    'difference',
    'missing',
    'needs-review',
    'source-error',
  ]);
  assert.deepEqual([...pairSeen].sort(), [
    'blocked/needs-review',
    'difference/needs-review',
    'missing/needs-review',
    'ready/accepted',
    'ready/needs-review',
    'ready/rejected',
    'timing-evidence/needs-review',
  ]);
});

void test('intercompany: the words are the screen words, and the claim in English is the evidence words', async () => {
  for (const lang of ['ar', 'en'] as const) {
    const t = reconciliationSheetCopy[lang].intercompany;
    for (const key of Object.keys(t) as (keyof typeof t)[])
      if (key !== 'claim')
        assert.deepEqual(
          t[key],
          (intercompanyCopy[lang] as Record<string, unknown>)[key],
          `${lang} intercompany.${key}`,
        );
  }
  const { state, result } = await finishedIntercompany('pending');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await exportIntercompany(state, result));
  const claim = wb
    .getWorksheet('Summary')!
    .getRows(1, 40)!
    .find((r) => r.getCell(1).value === 'Claim')!
    .getCell(2).value;
  assert.equal(reconciliationSheetCopy.en.intercompany.claim, claim);
  assert.notEqual(reconciliationSheetCopy.ar.intercompany.claim, claim);
});

void test('the real worker writes the intercompany sheet in the language asked, and refuses none', async () => {
  const { state, result } = await finishedIntercompany('reject');
  const port = new GlTbBindingPort();
  try {
    const client = createWorkerClient(() => port);
    for (const lang of ['ar', 'en'] as const) {
      const bytes = await client.request<ArrayBuffer>('intercompany-export', {
        state,
        result,
        lang,
      });
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes);
      assert.deepEqual(
        book.worksheets.slice(0, 2).map((s) => s.name),
        [reconciliationSheetCopy[lang].name, 'Summary'],
      );
      const { rows } = await firstSheet(bytes);
      assert.equal(
        rows[1][0],
        reconciliationSheetCopy[lang].intercompany.title,
      );
    }
    await assert.rejects(
      client.request('intercompany-export', { state, result }),
      /RECONCILIATION_SHEET_LANGUAGE/,
    );
  } finally {
    port.terminate();
  }
});
