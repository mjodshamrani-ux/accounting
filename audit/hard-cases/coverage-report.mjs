// Prints the V1.1 coverage matrix as a Markdown table: the judgements of
// coverage.mjs, plus, for rows measured by generated scenarios, the unaided
// and declared-assistance results read from the run summaries of one engine.
//   node audit/hard-cases/coverage-report.mjs --dir audit/hard-cases/results/v1.1/final --tag v11
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { CATALOG } from './catalog.mjs';
import { COVERAGE } from './coverage.mjs';

const { values: args } = parseArgs({
  options: {
    dir: { type: 'string', default: 'audit/hard-cases/results/v1.1/final' },
    tag: { type: 'string', default: 'v11' },
  },
});

// Sum every split and mode of one engine, per template.
const per = new Map();
const add = (template, mode, s) => {
  const t = per.get(template) ?? {
    declared: { n: 0, pass: 0, unsafe: 0 },
    unaided: { n: 0, pass: 0, assist: 0, unsafe: 0 },
  };
  t[mode].n += s.scenarios;
  t[mode].pass += s.verdicts.pass ?? 0;
  t[mode].unsafe += s.falseApprovals + s.wrongMemberGroups;
  if (mode === 'unaided')
    t.unaided.assist += s.verdicts['needs-assistance'] ?? 0;
  per.set(template, t);
};
// Either run folders (<tag>-<split>-<mode>/summary.json) or the committed
// copies (<tag>-<split>-<mode>.summary.json).
const summaryOf = (entry) =>
  entry.endsWith('.summary.json')
    ? join(args.dir, entry)
    : join(args.dir, entry, 'summary.json');
const runs = readdirSync(args.dir).filter(
  (d) => d.startsWith(`${args.tag}-`) && existsSync(summaryOf(d)),
);
for (const run of runs) {
  const s = JSON.parse(readFileSync(summaryOf(run), 'utf8'));
  for (const [t, v] of Object.entries(s.byTemplate)) add(t, 'declared', v);
  for (const [t, v] of Object.entries(s.unaided.byTemplate))
    add(t, 'unaided', v);
}

const label = {
  test: {
    scenario: 'سيناريوهات مولَّدة',
    'composite-pdf': 'PDF مركّب',
    'fixed-test': 'اختبار ثابت',
    'existing-tests': 'اختبارات قائمة',
    spike: 'نموذج spike',
    none: 'لا',
  },
  proves: {
    capability: 'القدرة',
    'safe-refusal': 'رفض آمن فقط',
    'not-measured': 'غير مقيس',
  },
  product: {
    production: 'إنتاجي',
    experimental: 'تجريبي',
    unimplemented: 'غير منفذ',
    unverified: 'غير متحقق منه',
  },
  scope: { full: 'كاملة', partial: 'جزئية', none: 'لا' },
};
const pct = (a, n) => (n ? `${a}/${n}` : '—');
const assistance = (templates) => {
  const sum = {
    declared: { n: 0, pass: 0, unsafe: 0 },
    unaided: { n: 0, pass: 0, assist: 0, unsafe: 0 },
  };
  for (const t of templates) {
    const v = per.get(t);
    if (!v) continue;
    for (const m of ['declared', 'unaided'])
      for (const k of Object.keys(sum[m])) sum[m][k] += v[m][k];
  }
  if (!sum.declared.n) return ['—', '—'];
  const { declared: d, unaided: u } = sum;
  const kind =
    d.pass < d.n
      ? 'ناقص حتى بعد المساعدة'
      : u.pass === u.n
        ? 'دون مساعدة'
        : 'يلزم مساعدة معلنة لبعضها';
  const unsafe =
    d.unsafe || u.unsafe ? ` · اعتماد خاطئ ${d.unsafe}/${u.unsafe}` : '';
  return [kind, `${pct(u.pass, u.n)} · ${pct(d.pass, d.n)}${unsafe}`];
};

const title = new Map(CATALOG.map((c) => [c.id, c.title]));
const lines = [
  '| المعرّف | التحدي | الاختبار | يثبت | المنتج | دون مساعدة أم بعدها | ناجح دون مساعدة · بعد مساعدة معلنة | التغطية | ما لم يُختبر من المواصفة |',
  '|---|---|---|---|---|---|---|---|---|',
];
for (const c of COVERAGE) {
  const [kind, counts] = assistance(c.templates);
  lines.push(
    `| ${c.id} | ${title.get(c.id)} | ${label.test[c.test]} | ${label.proves[c.proves]} | ${label.product[c.product]} | ${kind} | ${counts} | ${label.scope[c.scope]} | ${c.gap} |`,
  );
}
const count = (key) =>
  Object.entries(
    COVERAGE.reduce((a, c) => ({ ...a, [c[key]]: (a[c[key]] ?? 0) + 1 }), {}),
  )
    .map(([k, v]) => `${label[key][k]} ${v}`)
    .join('، ');
console.log(lines.join('\n'));
console.log(
  `\nالمجموع (${COVERAGE.length}): يثبت — ${count('proves')}. المنتج — ${count('product')}. التغطية — ${count('scope')}.`,
);
console.log(
  `المحرك: ${args.tag}؛ التشغيلات: ${runs
    .map((r) => r.replace('.summary.json', ''))
    .sort((a, b) => a.localeCompare(b))
    .join('، ')}`,
);
