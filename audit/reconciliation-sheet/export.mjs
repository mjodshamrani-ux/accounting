// UX-6: the workpapers the checker reads, the evidence as the existing export
// writes it and the workpaper as the worker hands it to the page, in Arabic
// and in English. GL/TB (6(a)): every frozen case, so every status the engine
// gives. Clearing (6(b)): the frozen source, its decisions (a clear, a reopen,
// a clear again, a reopen of a reference group), and the source changed to
// give every reason the engine gives: a header that does not establish the
// reference role, a duplicate posting, a group over the limit, a zero net,
// and texts that look like formulas or escapes. Synthetic sources only.
import { readFile as fsRead, mkdir, writeFile } from 'node:fs/promises';
import { readFile } from '../../lib/reconciliation/io.ts';
import { GL_TB_VERSION } from '../../lib/reconciliation/gl-tb.ts';
import { exportGlTb, replayGlTb } from '../../lib/reconciliation/gl-tb-io.ts';
import { exportGlTbWorkpaper } from '../../lib/reconciliation/gl-tb-sheet.ts';
import { reconcileClearing } from '../../lib/reconciliation/clearing.ts';
import {
  clearingDemoReading,
  clearingDemoScope,
} from '../../lib/reconciliation/clearing-demo.ts';
import { exportClearing } from '../../lib/reconciliation/clearing-io.ts';
import { exportClearingWorkpaper } from '../../lib/reconciliation/clearing-sheet.ts';

const out = process.argv[2] ?? 'work/reconciliation-sheet';
const root = 'audit/gl-tb/frozen/';
const truth = JSON.parse(await fsRead(root + 'expected.json', 'utf8'));
await mkdir(out, { recursive: true });
const cases = [];
for (const c of truth.cases) {
  const files = await Promise.all(
    c.files.map(async (f) =>
      readFile(f.file, new Uint8Array(await fsRead(root + f.file)).buffer),
    ),
  );
  const input = {
    files,
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
  const { result } = await replayGlTb(input);
  const written = {
    workspace: 'gl-tb',
    case: c.name,
    evidence: `${c.name}-evidence.xlsx`,
  };
  await writeFile(
    `${out}/${written.evidence}`,
    new Uint8Array(await exportGlTb(input, result)),
  );
  for (const lang of ['ar', 'en']) {
    written[lang] = `${c.name}-${lang}.xlsx`;
    await writeFile(
      `${out}/${written[lang]}`,
      new Uint8Array(await exportGlTbWorkpaper(input, result, lang)),
    );
  }
  cases.push(written);
}

const frozen = await fsRead('audit/clearing/frozen/source.csv', 'utf8');
const lines = frozen.trimEnd().split('\n');
const many = Array.from(
  { length: 102 },
  (_, i) =>
    `Q${String(i + 1).padStart(3, '0')},C900,2026-09-10,${i % 2 ? '-' : ''}1.00,2150,SAR,Within one reference`,
);
const odd = '= مصدر عربي 🧾 e\u0301 _x0041_ _X0041_ _x005F_x0041_ \u007f';
const pair = (r) =>
  r.cases.filter((c) => c.reason === 'missing-reference').flatMap((c) => c.ids);
const reference = (r, ref) => r.cases.find((c) => c.reference === ref).ids;
const clearingCases = [
  { name: 'clearing-plain', csv: frozen, steps: [] },
  {
    name: 'clearing-decided',
    csv: frozen,
    steps: [['clear', pair, 'Synthetic offsetting pair, same contract']],
  },
  {
    name: 'clearing-reopened',
    csv: frozen,
    steps: [
      ['clear', pair, 'Synthetic offsetting pair, same contract'],
      ['reopen', (r) => r.cases.at(-1).ids, 'Synthetic reopen pending the contract copy'],
    ],
  },
  {
    name: 'clearing-cleared-again',
    csv: frozen,
    steps: [
      ['clear', pair, 'Synthetic offsetting pair, same contract'],
      ['reopen', (r) => r.cases.at(-1).ids, 'Synthetic reopen pending the contract copy'],
      ['clear', (r) => r.cases.find((c) => c.reason === 'reopened').ids, 'Contract copy read; the pair offsets'],
    ],
  },
  {
    name: 'clearing-reference-reopened',
    csv: frozen,
    steps: [['reopen', (r) => reference(r, 'C001'), 'Synthetic: the reference is under query']],
  },
  {
    name: 'clearing-unverified-role',
    csv: frozen.replace('Clearing Reference', 'Ref'),
    steps: [],
  },
  {
    name: 'clearing-source-error',
    csv: [...lines, lines[1]].join('\n') + '\n',
    steps: [],
  },
  {
    name: 'clearing-group-limit',
    csv: [...lines, ...many].join('\n') + '\n',
    steps: [],
  },
  {
    name: 'clearing-zero-net',
    csv: lines.slice(0, 6).join('\n') + '\n',
    steps: [],
  },
  {
    name: 'clearing-text',
    csv: frozen,
    file: `${odd}.csv`,
    steps: [['clear', pair, `=SUM(A1:A2) ${odd} ملاحظة المراجع`]],
  },
];
for (const c of clearingCases) {
  const input = {
    file: await readFile(
      c.file ?? 'clearing.csv',
      new TextEncoder().encode(c.csv).buffer,
    ),
    reading: { ...clearingDemoReading },
    scope: { ...clearingDemoScope },
    events: [],
  };
  let result = reconcileClearing(input);
  for (const [action, ids, note] of c.steps) {
    input.events.push({ context: result.context, action, ids: ids(result), note });
    result = reconcileClearing(input);
  }
  const written = {
    workspace: 'clearing',
    case: c.name,
    evidence: `${c.name}-evidence.xlsx`,
    reasons: [...new Set(result.cases.map((r) => r.reason))],
    decisions: input.events.length,
  };
  await writeFile(
    `${out}/${written.evidence}`,
    new Uint8Array(await exportClearing(input, result)),
  );
  for (const lang of ['ar', 'en']) {
    written[lang] = `${c.name}-${lang}.xlsx`;
    await writeFile(
      `${out}/${written[lang]}`,
      new Uint8Array(await exportClearingWorkpaper(input, result, lang)),
    );
  }
  cases.push(written);
}
await writeFile(
  `${out}/cases.json`,
  JSON.stringify({ syntheticOnly: true, cases }, null, 1),
);
console.log(JSON.stringify({ cases: cases.length, out }));
