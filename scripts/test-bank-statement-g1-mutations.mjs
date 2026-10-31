// BNK-PDF-1 G1 code mutations: each planted defect in a private copy of the
// source must make the G1 tests fail with an assertion. A survivor is a rule
// no test holds.
//   node scripts/test-bank-statement-g1-mutations.mjs
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createPrivateTree,
  removePrivateTree,
  completedSuccessfully,
  isAssertionKill,
} from './mutation-runner-support.mjs';

const root = resolve(import.meta.dirname, '..');
const output =
  process.env.BNK_G1_MUTATION_DIR ??
  join(root, 'work/bank-statement-g1-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = [
  'tests/pdf-glyph-ink.test.ts',
  'tests/pdf-glyph-geometry.test.ts',
  'tests/bank-statement-native.test.ts',
  'tests/bank-statement-writers.test.ts',
  'tests/pdf-glyph-order.test.ts',
  'tests/pdf-ink-guards.test.ts',
  'tests/pdf-glyph-boxes.test.ts',
];
const PDF = 'lib/reconciliation/pdf.ts',
  PAINT = 'lib/reconciliation/pdf-paint-order.ts',
  FONT = 'lib/reconciliation/pdf-font-integrity.ts',
  GEOMETRY = 'lib/reconciliation/pdf-glyph-geometry.ts',
  READER = 'lib/reconciliation/bank-statement-native.ts',
  ORDER = 'lib/reconciliation/pdf-glyph-order.ts';
const mutations = [
  // The clip test by glyph ink.
  [
    'ink-ignored',
    PDF,
    'return (padded) => boxes.get(padded) ?? padded;',
    'return (padded) => padded;',
  ],
  [
    'ink-margin',
    PDF,
    'const GLYPH_INK_MARGIN = 0.01;',
    'const GLYPH_INK_MARGIN = 0;',
  ],
  [
    'ink-unknown-glyph',
    PDF,
    'if (!extent) {\n        low = NaN;\n        break;\n      }',
    'if (!extent) continue;',
  ],
  [
    'ink-rise',
    PDF,
    'fn.some((op, i) => op === ops.setTextRise && Number(args[i]?.[0]) !== 0)',
    'false',
  ],
  ['ink-accent', PAINT, '!glyph.accent &&', ''],
  [
    'ink-control-points',
    FONT,
    'for (let k = 1; k < points; k += 2) {',
    'for (let k = points - 1; k < points; k += 2) {',
  ],
  // Glyph placement and item splitting.
  [
    'tj-sign',
    GEOMETRY,
    'advance -= (glyph * size) / 1000;',
    'advance += (glyph * size) / 1000;',
  ],
  [
    'char-spacing',
    GEOMETRY,
    '(g?.isSpace ? state.wordSpacing : 0) + state.charSpacing',
    '(g?.isSpace ? state.wordSpacing : 0)',
  ],
  [
    'horizontal-scale',
    GEOMETRY,
    'const step = state.scale * direction;',
    'const step = direction;',
  ],
  [
    'restore-text-state',
    GEOMETRY,
    'else if (op === ops.restore) state = stack.pop() ?? state;',
    'else if (op === ops.restore) state = { ...(stack.pop() ?? state), textMatrix: state.textMatrix, x: state.x, y: state.y };',
  ],
  [
    'split-start-unchecked',
    GEOMETRY,
    'Math.abs(Math.min(...boxes.map((g) => g.x0)) - start) > ITEM_TOLERANCE ||',
    'false ||',
  ],
  ['split-rtl', GEOMETRY, "token.direction === 'rtl' ||", ''],
  // A space the writer drew, kept however tight the kerning (G17).
  [
    'drawn-space-ignored',
    READER,
    'gap > 0.15 * Math.min(p.height, q.height) || spaceDrawn(p, q)',
    'gap > 0.15 * Math.min(p.height, q.height)',
  ],
  [
    'drawn-space-any-item',
    READER,
    'later.token.drawnSpaceAfter === earlier.token.item;',
    'true;',
  ],
  [
    'drawn-space-between-items-unrecorded',
    PAINT,
    'spaceAfter.set(runs[run].index, runs[run - 1].index);',
    'void 0;',
  ],
  [
    'drawn-space-in-every-split',
    GEOMETRY,
    'drawn.length === words.length && drawn.every((w, k) => w === words[k]);',
    'true;',
  ],
  // The statement reader and its proof.
  ['column-left-edge', READER, 'p.x0 >= c.start[k] - PADDING &&', 'true &&'],
  // G6: headers aligned with their column's end, and the heading's words.
  [
    'end-aligned-headers-ignored',
    READER,
    'if (k < 0) return undefined;',
    'return undefined;',
  ],
  [
    'end-edge-unchecked',
    READER,
    'return ends && clear ? k : undefined;',
    'return clear ? k : undefined;',
  ],
  [
    'other-headers-unchecked',
    READER,
    'return ends && clear ? k : undefined;',
    'return ends ? k : undefined;',
  ],
  // G7: right-to-left runs read by glyph.
  [
    'glyph-order-unused',
    PDF,
    'const text = glyphOrderText(token.text, raw, pieces);',
    'const text: string | undefined = undefined;',
  ],
  [
    'glyph-order-unverified',
    ORDER,
    'if (!inside[k] && byGlyph[k] !== reading[k]) return undefined;',
    '',
  ],
  [
    'glyph-order-any-letters',
    ORDER,
    'group.every((c) => RTL_LETTER.test(c))',
    'true',
  ],
  [
    'glyph-order-stand-in-collision',
    ORDER,
    'STAND_INS.filter((s) => !raw.includes(s) && !text.includes(s))',
    'STAND_INS',
  ],
  // G8: the DR run after its amount in either direction, date runs, and
  // drawings and rows judged by proved ink.
  ['debit-mark-ignored', READER, 'if (!amount) continue;', 'continue;'],
  [
    'debit-mark-right-to-left-only',
    READER,
    'const out = [...pieces];',
    'const out = [...pieces];\n  if (!rtl) return out;',
  ],
  [
    'debit-mark-same-side',
    READER,
    'const gap = rtl ? q.x0 - mark.x1 : mark.x0 - q.x1;',
    'const gap = q.x0 - mark.x1;',
  ],
  ['debit-mark-either-side', READER, 'gap >= -UNDER &&', 'true &&'],
  [
    'debit-mark-any-distance',
    READER,
    'gap <= Math.min(q.height, mark.height)',
    'true',
  ],
  [
    'date-runs-not-joined',
    READER,
    'if (cells[col].length > 1 && !/\\s/u.test(joined))',
    'if (false)',
  ],
  [
    'date-runs-apart-joined',
    READER,
    'if (cells[col].length > 1 && !/\\s/u.test(joined))',
    'if (cells[col].length > 1)',
  ],
  [
    'drawing-by-metrics',
    PDF,
    'const inkBoxes = textBoxes.map(clipBoxOf);',
    'const inkBoxes = textBoxes;',
  ],
  [
    'rows-by-metrics',
    PDF,
    '.flatMap((t) => glyphs?.get(t) ?? [ink?.get(t) ?? glyphBounds(t)])',
    '.flatMap((t) => [glyphBounds(t)])',
  ],
  [
    'ink-unproved-returned',
    PDF,
    'return inkBoxes.map((box, i) => (box === textBoxes[i] ? undefined : box));',
    'return inkBoxes;',
  ],
  // G10: a rectangle traced back to its start, and each glyph's own box.
  ['rectangle-return-unclosed', PDF, 'path.points.length === 5 &&', 'false &&'],
  [
    'visibility-by-metrics',
    PDF,
    'visibleOnBackground(color, clipBoxOf(box), backgrounds),',
    'visibleOnBackground(color, box, backgrounds),',
  ],
  [
    'glyph-boxes-ignored',
    PDF,
    'const inkTargets = inkBoxes.flatMap((box, i) => glyphBoxes.get(i) ?? [box]);',
    'const inkTargets = inkBoxes;',
  ],
  [
    'glyph-advance-only',
    PDF,
    'const outline = ink.box(id);',
    'const outline = ink.box(id) && ([0, ink.box(id)![1], 0.6, ink.box(id)![3]] as const);',
  ],
  [
    'glyph-replay-unchecked',
    PDF,
    'Math.abs(left - padded[0]) <= 0.5 &&\n      Math.abs(right - padded[2]) <= 0.5',
    'true',
  ],
  [
    'glyph-baseline-unchecked',
    PDF,
    ' || Math.abs(at.y - run.baseline) > 0.5) break;',
    ') break;',
  ],
  [
    'glyph-partial',
    PDF,
    'boxes.length === glyphs.length &&',
    'boxes.length > 0 &&',
  ],
  [
    'rows-glyphs-ignored',
    PDF,
    '.flatMap((t) => glyphs?.get(t) ?? [ink?.get(t) ?? glyphBounds(t)])',
    '.flatMap((t) => [ink?.get(t) ?? glyphBounds(t)])',
  ],
  [
    'rows-window',
    PDF,
    'bounds[j][start][0] < a[0] - widest[j]',
    'bounds[j][start][0] < a[0]',
  ],
  [
    'outline-across-ignored',
    FONT,
    'left = Math.min(left, x);',
    'left = Math.min(left, 0);',
  ],
  [
    'glyph-space-scale',
    GEOMETRY,
    'const sx = state.size * state.scale,',
    'const sx = state.size,',
  ],
  [
    'glyph-space-pen',
    GEOMETRY,
    'pen = state.x + advance * step;',
    'pen = state.x;',
  ],
  [
    'heading-runs-not-joined',
    READER,
    'textOf(l.tokens.flatMap(partsOf), STATEMENT_VOCABULARY[layout].direction)',
    "''",
  ],
  [
    'label-case-folded',
    READER,
    '.find(([, text]) => text === labelText)',
    '.find(([, text]) => text.toLowerCase() === labelText.toLowerCase())',
  ],
  [
    'date-reversed-ltr',
    READER,
    "if (layout === 'ar') forms.push(",
    'if (true) forms.push(',
  ],
  [
    'date-ambiguous',
    READER,
    'return found.size === 1 ? [...found][0] : undefined;',
    'return [...found][0];',
  ],
  [
    'debit-anywhere',
    READER,
    'if (!m || (m[3] && !allowDebit)) return undefined;',
    'if (!m) return undefined;',
  ],
  [
    'page-sequence',
    READER,
    'pages.some((p, i) => p.number !== i + 1)',
    'false',
  ],
  [
    'balance-unchecked',
    READER,
    'if (l.balance !== running)\n          return broken(\n            `page ${l.page}: printed balance',
    'if (false)\n          return broken(\n            `page ${l.page}: printed balance',
  ],
  [
    'totals-unchecked',
    READER,
    'if (l.withdrawal !== totalW + pageW || l.deposit !== totalD + pageD)',
    'if (false)',
  ],
  [
    'page-totals-unchecked',
    READER,
    'if (l.withdrawal !== pageW || l.deposit !== pageD)',
    'if (false)',
  ],
  [
    'heading-unchecked',
    READER,
    'const differs = pages.find((p) => p.heading !== pages[0].heading);',
    'const differs = undefined as PageRead | undefined;',
  ],
  [
    'currency-not-unique',
    READER,
    'currencies.length === 1 ? currencyPrecision(currencies[0]) : undefined',
    'currencyPrecision(currencies[0])',
  ],
  [
    'reading-issues-ignored',
    READER,
    'if (source.readingIssues.length)',
    'if (false)',
  ],
  [
    'continuation-unchecked',
    READER,
    "if (lines[j]?.kind !== 'movement' || lines[j].page !== l.page - 1)",
    'if (false)',
  ],
  [
    'table-completeness',
    READER,
    'if (!pages && closing === null)',
    'if (false)',
  ],
];
const files = [...new Set(mutations.map(([, file]) => file)), ...tests];
const digest = (b) => createHash('sha256').update(b).digest('hex');
const before = Object.fromEntries(
  await Promise.all(
    files.map(async (p) => [p, digest(await readFile(join(root, p)))]),
  ),
);
const run = (cwd) =>
  spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', ...tests],
    { cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 },
  );
const log = (name, r) =>
  writeFile(join(out, name + '.log'), (r.stdout ?? '') + (r.stderr ?? ''));
const baseline = run(root);
await log('baseline', baseline);
const report = {
  baselinePassed: completedSuccessfully(baseline),
  mutations: [],
  passed: false,
};
if (report.baselinePassed)
  for (const [id, file, from, to] of mutations) {
    const tree = await createPrivateTree();
    try {
      for (const name of [
        'lib',
        ...tests,
        'audit/bank-statement-foundation/frozen',
        'audit/bank-statement-holdout-g6/frozen',
        'audit/bank-statement-holdout-g8/frozen',
        'audit/bank-statement-holdout-g10/frozen',
        'audit/bank-statement-holdout-g17/frozen',
        'package.json',
      ])
        await cp(join(root, name), join(tree, name), { recursive: true });
      await symlink(
        join(root, 'node_modules'),
        join(tree, 'node_modules'),
        'dir',
      );
      const target = join(tree, file);
      const text = await readFile(target, 'utf8');
      if (text.split(from).length !== 2)
        throw Error('Mutation anchor drift: ' + id);
      await writeFile(target, text.replace(from, to));
      const result = run(tree);
      await log(id, result);
      report.mutations.push({
        id,
        file,
        killed: isAssertionKill(result),
        exitCode: result.status,
        signal: result.signal,
        error: result.error?.message ?? null,
      });
    } catch (error) {
      report.mutations.push({
        id,
        file,
        killed: false,
        infrastructureError: error.message,
      });
    } finally {
      await removePrivateTree(tree);
    }
  }
for (const [p, hash] of Object.entries(before))
  if (digest(await readFile(join(root, p))) !== hash)
    throw Error('Mutation touched source');
report.passed =
  report.baselinePassed &&
  report.mutations.length === mutations.length &&
  report.mutations.every((r) => r.killed);
await writeFile(join(out, 'checks.json'), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      out,
      baselinePassed: report.baselinePassed,
      killed: report.mutations.filter((r) => r.killed).length,
      total: mutations.length,
      survivors: report.mutations.filter((r) => !r.killed).map((r) => r.id),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
