// The reader rules the BNK-PDF-1 holdout ablation switches off, one at a
// time: shared by scripts/bank-statement-holdout-ablation.mjs and
// audit/bank-statement-eligibility/measure_rows.mjs, so that both switch a
// rule off by the same change.
const PDF = 'lib/reconciliation/pdf.ts',
  READER = 'lib/reconciliation/bank-statement-native.ts',
  MATCH = 'lib/reconciliation/bank-statement-match.ts';
// [rule, unit, gate mutant, file, from, to]: each change is the named
// mutant of that gate, so a drift in either fails here and there.
export const rules = [
  [
    'drawing by ink',
    'G8',
    'g1:drawing-by-metrics',
    PDF,
    'const inkBoxes = textBoxes.map(clipBoxOf);',
    'const inkBoxes = textBoxes;',
  ],
  [
    'rows by ink',
    'G8',
    'g1:rows-by-metrics',
    PDF,
    '.flatMap((t) => glyphs?.get(t) ?? [ink?.get(t) ?? glyphBounds(t)])',
    '.flatMap((t) => [glyphBounds(t)])',
  ],
  [
    'DR after its amount',
    'G8',
    'g1:debit-mark-ignored',
    READER,
    'if (!amount) continue;',
    'continue;',
  ],
  [
    'date runs joined',
    'G8',
    'g1:date-runs-not-joined',
    READER,
    'if (cells[col].length > 1 && !/\\s/u.test(joined))',
    'if (false)',
  ],
  [
    'typed cashbook amounts',
    'G8',
    'g2:typed-amount-as-text',
    MATCH,
    '(numeric?.[`${at}:${column}`] ? typedMoney : money)',
    'money',
  ],
  [
    'rectangle traced back to its start',
    'G10',
    'g1:rectangle-return-unclosed',
    PDF,
    'path.points.length === 5 &&',
    'false &&',
  ],
  [
    'drawings by glyph boxes',
    'G10',
    'g1:glyph-boxes-ignored',
    PDF,
    'const inkTargets = inkBoxes.flatMap((box, i) => glyphBoxes.get(i) ?? [box]);',
    'const inkTargets = inkBoxes;',
  ],
  [
    'rows by glyph boxes',
    'G10',
    'g1:rows-glyphs-ignored',
    PDF,
    '.flatMap((t) => glyphs?.get(t) ?? [ink?.get(t) ?? glyphBounds(t)])',
    '.flatMap((t) => [ink?.get(t) ?? glyphBounds(t)])',
  ],
  [
    'visibility by ink',
    'G12',
    'g1:visibility-by-metrics',
    PDF,
    'visibleOnBackground(color, clipBoxOf(box), backgrounds),',
    'visibleOnBackground(color, box, backgrounds),',
  ],
];
