// UX-6(a): the GL/TB workpapers the checker reads. For each frozen GL/TB
// case (every status the engine gives), the evidence as the existing export
// writes it, and the workpaper as the worker hands it to the page, in Arabic
// and in English. Synthetic sources only.
import { readFile as fsRead, mkdir, writeFile } from 'node:fs/promises';
import { readFile } from '../../lib/reconciliation/io.ts';
import { GL_TB_VERSION } from '../../lib/reconciliation/gl-tb.ts';
import { exportGlTb, replayGlTb } from '../../lib/reconciliation/gl-tb-io.ts';
import { exportGlTbWorkpaper } from '../../lib/reconciliation/gl-tb-sheet.ts';

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
  const written = { case: c.name, evidence: `${c.name}-evidence.xlsx` };
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
await writeFile(
  `${out}/cases.json`,
  JSON.stringify({ syntheticOnly: true, workspace: 'gl-tb', cases }, null, 1),
);
console.log(JSON.stringify({ cases: cases.length, out }));
