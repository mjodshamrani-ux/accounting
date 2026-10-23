// BNK-PDF-1 holdout ablation: which reader rule each completed statement of a
// holdout package needs. The product is copied to a private tree once per
// rule, the rule is switched off there by the same change its mutation gate
// makes, and the package is run by scripts/bank-statement-holdout.mjs in that
// tree. A positive that completes in the plain tree and not with the rule off
// needed the rule. It is a diagnostic beside a recorded run, never a result:
// the run itself is the result, and the rules are those G8 and later units
// added after seeing earlier holdouts (DEV-52).
//   node scripts/bank-statement-holdout-ablation.mjs --suite=<package under audit/> [--out=<file>]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const option = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
assert.ok(option('suite'), 'Usage: --suite=<holdout package under audit/>');
const suite = option('suite');

const PDF = 'lib/reconciliation/pdf.ts',
  READER = 'lib/reconciliation/bank-statement-native.ts',
  MATCH = 'lib/reconciliation/bank-statement-match.ts';
// [rule, unit, gate mutant, file, from, to]: each change is the named
// mutant of that gate, so a drift in either fails here and there.
const rules = [
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
];

async function run(change) {
  const tree = await mkdtemp(path.join(tmpdir(), 'bnk-ablation-'));
  try {
    for (const name of [
      'lib',
      'scripts/bank-statement-holdout.mjs',
      suite,
      'package.json',
    ])
      await cp(path.join(root, name), path.join(tree, name), {
        recursive: true,
      });
    await symlink(
      path.join(root, 'node_modules'),
      path.join(tree, 'node_modules'),
      'dir',
    );
    if (change) {
      const [, , , file, from, to] = change;
      const target = path.join(tree, file);
      const text = await readFile(target, 'utf8');
      assert.equal(text.split(from).length, 2, 'anchor drift: ' + change[2]);
      await writeFile(target, text.replace(from, to));
    }
    const r = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        path.join(tree, 'scripts/bank-statement-holdout.mjs'),
        `--suite=${suite}`,
      ],
      {
        cwd: tree,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, BNK_HOLDOUT_DIR: path.join(tree, 'work') },
      },
    );
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(
      await readFile(
        path.join(tree, 'work', path.basename(suite), 'run.json'),
        'utf8',
      ),
    );
    return {
      summary: report.summary,
      refusals: Object.fromEntries(
        report.statements
          .filter((s) => s.refused)
          .map((s) => [s.id, s.refused]),
      ),
    };
  } finally {
    await rm(tree, { recursive: true, force: true });
  }
}

const plain = await run();
const ablations = [];
for (const change of rules) {
  const off = await run(change);
  const lost = (key) =>
    plain.summary[key].filter((id) => !off.summary[key].includes(id));
  ablations.push({
    rule: change[0],
    unit: change[1],
    mutant: change[2],
    file: change[3],
    lostPositives: lost('positivesCompleted'),
    lostHeld: lost('heldCorrectly'),
    gainedPositives: off.summary.positivesCompleted.filter(
      (id) => !plain.summary.positivesCompleted.includes(id),
    ),
    falseAutomatic: off.summary.falseAutomatic,
    refusals: off.refusals,
  });
  console.log(JSON.stringify(ablations.at(-1)));
}
const record = {
  schema: 'tarasuf-bnk-pdf1-holdout-ablation/1',
  suite,
  commit: spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).stdout.trim(),
  productSourceChanged:
    spawnSync('git', ['status', '--porcelain', '--', 'lib'], {
      cwd: root,
      encoding: 'utf8',
    }).stdout.trim() !== '',
  plain: plain.summary,
  ablations,
};
const out = option('out');
if (out)
  await writeFile(path.join(root, out), `${JSON.stringify(record, null, 1)}\n`);
console.log(
  JSON.stringify({ plain: plain.summary.positivesCompleted, out: out ?? null }),
);
