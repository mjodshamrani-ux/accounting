// Prints a compact table from one or more hard-case summaries.
//   node audit/hard-cases/report.mjs work/hard/base-dev-logical [work/hard/after-dev-logical]
import { readFileSync } from 'node:fs';
const runs = process.argv.slice(2).map((dir) => ({ dir, s: JSON.parse(readFileSync(`${dir}/summary.json`, 'utf8')) }));
const cell = (a) =>
  a ? `${a.verdicts.pass ?? 0}/${a.scenarios} pass · approved ${a.approvedAchieved}/${a.approvedExpected} · controls ${a.controlsAchieved}/${a.controlsExpected} · FA ${a.falseApprovals} · WM ${a.wrongMemberGroups} · mis ${a.silentMisreads} · lost ${a.rowsLost} · evLost ${a.evidenceLost}` : '—';
for (const { dir, s } of runs) {
  console.log(`\n## ${dir} (${s.split}, ${s.mode}, engine ${s.engineRoot}, p50 ${s.timingMs.p50}ms p95 ${s.timingMs.p95}ms)`);
  console.log(`overall   ${cell(s.overall)} · crashes ${s.overall.crashes} · confirmations ${s.overall.confirmations}`);
  for (const [t, a] of Object.entries(s.byTemplate)) {
    const fails = Object.entries(a.verdicts).filter(([v]) => v !== 'pass').map(([v, n]) => `${v}:${n}`).join(' ');
    console.log(`${t.padEnd(32)} ${cell(a)}${fails ? ' · ' + fails : ''}`);
  }
}
