// Prints a compact table from one or more hard-case summaries.
//   node audit/hard-cases/report.mjs work/hard/base-dev-logical [work/hard/after-dev-logical]
// Each run shows two results: after declared assistance, and unaided.
import { readFileSync } from 'node:fs';
const runs = process.argv
  .slice(2)
  .map((dir) => ({
    dir,
    s: JSON.parse(readFileSync(`${dir}/summary.json`, 'utf8')),
  }));
const verdicts = (a) =>
  Object.entries(a.verdicts)
    .filter(([v]) => v !== 'pass')
    .map(([v, n]) => `${v}:${n}`)
    .join(' ');
const cell = (a) =>
  a
    ? `${a.verdicts.pass ?? 0}/${a.scenarios} pass · approved ${a.approvedAchieved}/${a.approvedExpected} · controls ${a.controlsAchieved}/${a.controlsExpected} · FA ${a.falseApprovals} · WM ${a.wrongMemberGroups} · mis ${a.silentMisreads} · lost ${a.rowsLost} · evLost ${a.evidenceLost}/${a.evidenceRequired ?? '?'}`
    : '—';
for (const { dir, s } of runs) {
  const p = s.provenance;
  console.log(
    `\n## ${dir} (${s.split}, ${s.mode}; engine ${p?.engine.commit ?? s.engineRoot}${p?.engine.engineFilesModified ? ' +modified' : ''}; generator ${s.versions.scenarios}; evaluator ${s.versions.evaluator}; p50 ${s.timingMs.p50}ms p95 ${s.timingMs.p95}ms)`,
  );
  console.log(`declared  ${cell(s.overall)} · crashes ${s.overall.crashes}`);
  if (s.unaided)
    console.log(
      `unaided   ${cell(s.unaided.overall)} · crashes ${s.unaided.overall.crashes}`,
    );
  for (const [t, a] of Object.entries(s.byTemplate)) {
    const u = s.unaided?.byTemplate[t];
    const fails = verdicts(a);
    const ufails = u ? verdicts(u) : '';
    console.log(
      `${t.padEnd(32)} ${cell(a)}${fails ? ' · ' + fails : ''}${u ? ` || unaided ${u.verdicts.pass ?? 0}/${u.scenarios}${ufails ? ' ' + ufails : ''}` : ''}`,
    );
  }
}
