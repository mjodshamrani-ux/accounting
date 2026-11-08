import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import test from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { glTbStrip } from '../lib/alignment-strip.ts';
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
import { readFile } from '../lib/reconciliation/io.ts';
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
import {
  clearingDemoReading,
  clearingDemoScope,
} from '../lib/reconciliation/clearing-demo.ts';
import {
  clearingSheet,
  exportClearingWorkpaper,
} from '../lib/reconciliation/clearing-sheet.ts';
import { GlTbBindingPort } from './helpers/gl-tb-binding-port.ts';

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
  const lists: Record<string, { count: number; entries: number; body: string }> =
    {};
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
        const id = (key: string) => Number(new RegExp(`${key}="(\\d+)"`).exec(xf[0])![1]);
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
      const xfs = [...now.cellXfs.body.matchAll(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(
        (m) => m[0],
      );
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
      assert.equal(book.getWorksheet('Summary')!.getCell('B4').value, 'consistent');
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
  return { sheet, rows: Array.from(rows, (r) => r ?? [null, null, null, null]) };
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
        assert.deepEqual(rows[at + 1].slice(0, 2), [w.fingerprint, source.hash]);
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
          [w.scope, w.sources, w.alignment, t.balances, w.signature, w.claim].includes(
            String(row[0]),
          ) ||
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

const tiny = (rows: SheetCell[][], language: 'ar' | 'en' = 'en'): ReconciliationSheet => ({
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
    styles.replace(/<fonts count="(\d+)"/, (_, n) => `<fonts count="${Number(n) + 1}"`),
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
  const local = (xml: string) =>
    Number(/localSheetId="(\d+)"/.exec(xml)![1]);
  assert.equal(sheetNames(before)[local(before)], 'Two');
  const after = decode(
    (await parts(await addReconciliationSheet(book, tiny([[{ count: 1 }]])))).get(
      'xl/workbook.xml',
    ),
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
      if (!state.events.length) assert.equal(head, -1, 'no decisions, no table');
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
  const rows = [...xml.matchAll(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g)].map(
    (m) => ({
      n: Number(m[1]),
      height: Number(/ht="([\d.]+)"/.exec(m[2])?.[1] ?? 0),
      custom: m[2].includes('customHeight="1"'),
      cells: [
        ...m[3].matchAll(/<c r="([A-Z]+)\d+"[^>]*?s="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g),
      ].map((c) => ({
        col: c[1],
        wrap: xfs[Number(c[2])].includes('wrapText="1"'),
        text: /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] ?? '')?.[1] ?? null,
      })),
    }),
  );
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
  state.events.push({ context: result.context, action: 'clear', ids: pair, note });
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
    assert.ok(rows.every((r) => r.cells.every((c) => !c.wrap)), lang);
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
  const name =
    '= مصدر عربي 🧾 é _x0041_ _X0041_ _x005F_x0041_ \u007f.csv';
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
