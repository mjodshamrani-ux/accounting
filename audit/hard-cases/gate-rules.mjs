// The decision rules of the EVAL-1 gate, as a pure function over evaluator
// records, so the gate itself is under test (tests/hard-cases-gate.test.ts).
import { TRIAGE } from './triage.mjs';

const isUnsafe = (r) =>
  ['fail-unsafe', 'fail-crash'].includes(r.verdict) ||
  !!r.counts?.falseApprovals ||
  !!r.counts?.wrongMemberGroups ||
  !!r.counts?.silentMisreads ||
  !!r.counts?.rowsLost;

/** Does a triage entry cover this record (template|variant or '*', mode and,
 * when the entry names formats, a source in one of them)? */
const covers = (t, r) =>
  (t.keys.includes('*') || t.keys.includes(`${r.template}|${r.variant}`)) &&
  t.assist.includes(r.assist) &&
  (!t.formats || !!r.formats?.some((f) => t.formats.includes(f)));

export function triageFor(record, triage = TRIAGE) {
  return triage.find(
    (t) => covers(t, record) && t.verdicts.includes(record.verdict),
  );
}

/** unsafe: never excusable; untriaged: a failure no entry names; stale: an
 * entry key whose covered records ran and none failed. */
export function judge(records, triage = TRIAGE) {
  const unsafe = [];
  const untriaged = [];
  const triaged = new Map();
  for (const r of records) {
    const key = `${r.template}|${r.variant}`;
    if (isUnsafe(r)) {
      unsafe.push(`${r.id} ${key} [${r.assist}] ${r.verdict}`);
      continue;
    }
    if (r.verdict === 'pass') continue;
    const t = triageFor(r, triage);
    if (!t) {
      untriaged.push(`${r.id} ${key} [${r.assist}] ${r.verdict}`);
      continue;
    }
    const k = `${key} [${r.assist}] ${r.verdict} — ${t.class}`;
    triaged.set(k, (triaged.get(k) ?? 0) + 1);
  }
  const stale = [];
  for (const t of triage)
    for (const key of t.keys)
      for (const assist of t.assist) {
        const ran = records.filter((r) =>
          covers({ ...t, keys: [key], assist: [assist] }, r),
        );
        if (
          ran.length &&
          !ran.some(
            (r) => r.verdict !== 'pass' && t.verdicts.includes(r.verdict),
          )
        )
          stale.push(
            `${key} [${assist}]${t.formats ? ` {${t.formats.join(',')}}` : ''} (${t.class})`,
          );
      }
  return {
    unsafe,
    untriaged,
    stale,
    triaged,
    passed: !unsafe.length && !untriaged.length && !stale.length,
  };
}
