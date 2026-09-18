// Local diagnostic: classify why PDF sources fail automatic format proof.
// Uses the same generator/renderer/engine as the reliability harness.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { buildManifest, DEFAULT_SEED } from './manifest.mjs';
import { generateCase } from './generator.mjs';
import { renderCase } from './renderers.mjs';
import { loadEngine } from './evaluate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const engine = await loadEngine(root);
const args = process.argv.slice(2);
const value = (n, d) => {
  const i = args.indexOf(n);
  return i < 0 ? d : args[i + 1];
};
const limit = Number(value('--limit', '150'));
const only = value('--family', '');
const pdfFamilies = [
  'dev-text-page',
  'validation-text-page',
  'final-fragmented-page',
];
const all = buildManifest({ seed: DEFAULT_SEED, count: 5000 }).filter((c) =>
  [c.layoutFamilyA, c.layoutFamilyB].some((f) =>
    only ? f === only : pdfFamilies.includes(f),
  ),
);
// Sample evenly per family so one large split cannot hide another's defects.
const buckets = new Map();
for (const c of all)
  for (const f of [c.layoutFamilyA, c.layoutFamilyB])
    if (only ? f === only : pdfFamilies.includes(f)) {
      const list = buckets.get(f) ?? [];
      if (!list.includes(c)) list.push(c);
      buckets.set(f, list);
    }
const per = Math.max(1, Math.ceil(limit / buckets.size));
const picked = new Map();
for (const list of buckets.values())
  for (const c of list.slice(0, per)) picked.set(c.id, c);
const manifest = [...picked.values()];
const rows = [];
for (const descriptor of manifest) {
  const spec = generateCase(descriptor);
  let rendered;
  try {
    rendered = await renderCase(spec);
  } catch (e) {
    rows.push({
      id: descriptor.id,
      stage: 'render',
      detail: String(e.message).slice(0, 120),
    });
    continue;
  }
  for (let i = 0; i < 2; i++) {
    const source = spec.sources[i],
      output = rendered.files[i];
    if (output.format !== 'pdf') continue;
    const entry = {
      id: spec.id,
      side: source.side,
      family: source.layout.family,
      category: spec.category,
      invalid: !!source.invalid,
    };
    const ab = output.bytes.buffer.slice(
      output.bytes.byteOffset,
      output.bytes.byteOffset + output.bytes.byteLength,
    );
    let file;
    try {
      file = await engine.readFile(output.name, ab, undefined, true);
    } catch (e) {
      entry.stage = 'read';
      entry.detail = String(e.message).slice(0, 160);
      rows.push(entry);
      continue;
    }
    const sel = engine.selectImportMapping(file, source.side);
    const mapping = sel.mapping;
    entry.autoMapping =
      mapping.date >= 0 &&
      (mapping.mode === 'signed'
        ? mapping.amount >= 0
        : mapping.debit >= 0 && mapping.credit >= 0);
    if (!entry.autoMapping) {
      entry.stage = 'mapping';
      rows.push(entry);
      continue;
    }
    const f = engine.suggestFormats(file, mapping, source.metadata.decimals);
    entry.stage = 'format';
    entry.date = f.dateFormat.status;
    entry.number = f.numberFormat.status;
    entry.dateReason = f.dateFormat.reason.slice(0, 140);
    entry.numberReason = f.numberFormat.reason.slice(0, 140);
    entry.autoColumns = !!file.pdf?.autoColumns;
    // Verification only, never an input: a proven format must equal the one the
    // independent generator printed, or the proof is wrong rather than helpful.
    entry.trueDate = source.metadata.dateFormat;
    entry.trueNumber = source.metadata.numberFormat;
    entry.dateCandidates = f.dateFormat.candidates;
    entry.numberCandidates = f.numberFormat.candidates;
    entry.datePatch = f.patch.dateFormat ?? null;
    entry.numberPatch = f.patch.numberFormat ?? null;
    if (
      f.dateFormat.status === 'proven' &&
      !f.dateFormat.candidates.includes(source.metadata.dateFormat)
    )
      entry.dateProofWrong = true;
    if (
      f.numberFormat.status === 'proven' &&
      !f.numberFormat.candidates.includes(source.metadata.numberFormat)
    )
      entry.numberProofWrong = true;
    rows.push(entry);
  }
}
await writeFile(
  resolve(root, 'work', value('--out', 'pdf-diagnosis.json')),
  JSON.stringify(rows, null, 1),
);
const tally = (key, filter = () => true) => {
  const out = {};
  for (const r of rows) if (filter(r)) out[r[key]] = (out[r[key]] ?? 0) + 1;
  return out;
};
console.log('sources inspected:', rows.length);
console.log('stage:', JSON.stringify(tally('stage')));
console.log(
  'date status:',
  JSON.stringify(tally('date', (r) => r.stage === 'format')),
);
console.log(
  'number status:',
  JSON.stringify(tally('number', (r) => r.stage === 'format')),
);
const reasons = {};
for (const r of rows)
  if (r.stage === 'format' && r.date !== 'proven')
    reasons[r.dateReason.replace(/\d+/g, 'N')] =
      (reasons[r.dateReason.replace(/\d+/g, 'N')] ?? 0) + 1;
console.log('date failure reasons:');
for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1]))
  console.log('  ', v, k);
const nreasons = {};
for (const r of rows)
  if (r.stage === 'format' && r.number !== 'proven')
    nreasons[r.numberReason.replace(/\d+/g, 'N')] =
      (nreasons[r.numberReason.replace(/\d+/g, 'N')] ?? 0) + 1;
console.log('number failure reasons:');
for (const [k, v] of Object.entries(nreasons).sort((a, b) => b[1] - a[1]))
  console.log('  ', v, k);
const fam = {};
for (const r of rows) {
  const k =
    r.family +
    '/' +
    r.stage +
    (r.stage === 'format' ? ':' + r.date + ',' + r.number : '');
  fam[k] = (fam[k] ?? 0) + 1;
}
console.log(
  'proof disagreements with the generator:',
  rows.filter((r) => r.dateProofWrong).length,
  'date,',
  rows.filter((r) => r.numberProofWrong).length,
  'number',
);
console.log('family breakdown:');
for (const [k, v] of Object.entries(fam).sort((a, b) => b[1] - a[1]))
  console.log('  ', v, k);
