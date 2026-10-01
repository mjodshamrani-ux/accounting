// Actual local ONNX inference. Run from repository root with Node >=22.13.
// No network is permitted during model loading or inference, even for assets.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { env, AutoTokenizer, AutoModelForCausalLM, StoppingCriteria } from './node_modules/@huggingface/transformers/dist/transformers.node.mjs';
import { readFile as readSource } from '../../lib/reconciliation/io.ts';
import { inferMapping, normalizeSource } from '../../lib/reconciliation/core.ts';
import { defaultMapping, ENGINE_VERSION } from '../../lib/reconciliation/types.ts';
import { makeColumnRequest, bindColumnProposal } from './proposal.ts';

const root = path.resolve('.'), experiment = 'audit/local-provider';
const threads = Number(process.argv[2] ?? 4), runName = process.argv[3] ?? `cpu-${threads}`;
if (![1, 4].includes(threads) || !/^[a-z0-9-]+$/.test(runName)) throw Error('Invalid frozen run configuration');
const out = path.join(experiment, 'results', runName);
await mkdir(out, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const contractBytes = await readFile(path.join(experiment, 'contract.json'));
const manifestBytes = await readFile(path.join(experiment, 'model.json'));
const promptBytes = await readFile(path.join(experiment, 'prompt.txt'));
const contract = JSON.parse(contractBytes), manifest = JSON.parse(manifestBytes);
const freeze = JSON.parse(await readFile(path.join(experiment, 'freeze-v2.json')));
for (const [name, bytes] of [['contract.json', contractBytes], ['model.json', manifestBytes], ['prompt.txt', promptBytes]])
  if (sha(bytes) !== freeze.files[name]) throw Error(`Frozen ${name} changed: create a NEW experiment instead of replacing results`);
for (const name of ['proposal.ts', 'run-v2.mjs', 'supervise.mjs'])
  if (sha(await readFile(path.join(experiment, name))) !== freeze.files[name]) throw Error(`Frozen implementation ${name} changed`);
const assets = path.join(root, 'work/local-provider-assets', manifest.model);
for (const spec of manifest.files) {
  const bytes = await readFile(path.join(assets, spec.path));
  if (bytes.length !== spec.bytes || sha(bytes) !== spec.sha256) throw Error(`Unverified model asset: ${spec.path}`);
}
const networkAttempts = [];
globalThis.fetch = async (...args) => {
  networkAttempts.push({ method: 'fetch', target: String(args[0]).slice(0, 120) });
  throw Error('Network is forbidden during the local experiment');
};
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = path.join(root, 'work/local-provider-assets/');
env.useFSCache = false;
env.useBrowserCache = false;
const beforeLoad = performance.now();
const tokenizer = await AutoTokenizer.from_pretrained(manifest.model, { local_files_only: true });
const model = await AutoModelForCausalLM.from_pretrained(manifest.model, {
  local_files_only: true, device: 'cpu', dtype: manifest.dtype,
  session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 },
});
const loadMs = performance.now() - beforeLoad;
class Deadline extends StoppingCriteria {
  constructor(start) { super(); this.start = start; this.timedOut = false; }
  _call(ids) {
    this.timedOut ||= performance.now() - this.start > contract.perCaseTimeoutMs;
    return ids.map(() => this.timedOut);
  }
}
const csv = rows => rows.map(row => row.map(v => '"' + v.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';
function evaluate(columns, expected) {
  const correct = Object.keys(expected).filter(k => columns[k] === expected[k]);
  const wrong = Object.keys(columns).filter(k => columns[k] !== expected[k]);
  const missing = Object.keys(expected).filter(k => !(k in columns));
  return { correctRoles: correct, wrongRoles: wrong, missingRoles: missing, exact: !wrong.length && !missing.length };
}
const report = {
  experiment: freeze, engineVersion: ENGINE_VERSION, modelRevision: manifest.revision,
  platform: { type: os.type(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, physicalRamBytes: os.totalmem(), threads },
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  modelAssetBytes: manifest.files.reduce((sum, f) => sum + f.bytes, 0),
  loadMs, modelProcessRssAfterLoad: process.memoryUsage().rss,
  networkAttempts, cases: [], productEnabled: false,
};
const save = () => writeFile(path.join(out, 'observations.json'), JSON.stringify(report, null, 2) + '\n');
await save();
for (const fixture of contract.cases) for (const language of ['en', 'ar']) {
  const name = `${fixture.id}-${language}.csv`, nativeBytes = Buffer.from(csv([fixture.headers[language], ...fixture.rows]));
  const file = await readSource(name, nativeBytes.buffer.slice(nativeBytes.byteOffset, nativeBytes.byteOffset + nativeBytes.length));
  const mapping = { ...defaultMapping(), mode: fixture.mode };
  const request = makeColumnRequest(file, mapping);
  if (!request) throw Error(`Missing native evidence request: ${name}`);
  const auto = inferMapping(file, 0);
  const baselineColumns = Object.fromEntries(request.allowed.filter(k => auto[k] >= 0).map(k => [k, auto[k]]));
  const before = JSON.stringify({ file, mapping });
  const inputs = tokenizer.apply_chat_template([
    { role: 'system', content: promptBytes.toString('utf8') },
    { role: 'user', content: 'DATA=' + request.data },
  ], {
    tokenize: true, return_dict: true, add_generation_prompt: true, enable_thinking: false,
  });
  console.log(JSON.stringify({ stage: 'case-start', id: `${fixture.id}-${language}` }));
  const start = performance.now(), deadline = new Deadline(start);
  let raw = '', error = null;
  try {
    const ids = await model.generate({
      ...inputs, max_new_tokens: contract.maxNewTokens, do_sample: false,
      stopping_criteria: [deadline],
    });
    raw = tokenizer.decode(ids.tolist()[0].slice(inputs.input_ids.dims[1]), { skip_special_tokens: true });
  } catch (e) { error = String(e); }
  const elapsedMs = performance.now() - start;
  const bound = error || deadline.timedOut ? { kind: 'rejected', reason: error ? 'runtime-error' : 'timeout' }
    : bindColumnProposal(file, mapping, request, raw);
  const proposedColumns = bound.kind === 'needs-review' ? bound.verified.patch : {};
  let rawColumns = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.columns && !Array.isArray(parsed.columns) && typeof parsed.columns === 'object')
      rawColumns = parsed.columns;
  } catch {}
  let reviewedReading = null;
  const quality = evaluate(proposedColumns, fixture.expected);
  // A deliberately recorded HUMAN reference review, never an automated Apply.
  // Only exact expected roles are normalized; no bad interpretation is blessed by arithmetic.
  if (quality.exact && fixture.expected.date !== undefined && fixture.expected.amount !== undefined) {
    const reviewed = { ...mapping, ...proposedColumns };
    const source = normalizeSource(file, reviewed, {
      supplier: 'Synthetic fixture', entity: 'Synthetic company', account: 'AP',
      currency: fixture.id === 'currency-value' ? 'USD' : 'SAR', decimals: 2,
      cutoff: '2026-07-31', dateWindow: 7, confirmed: true, coverageConfirmed: true,
    }, 'supplier');
    reviewedReading = {
      reviewer: 'frozen reference contract; NOT automatic model approval',
      transactions: source.transactions.map(t => ({ sourceRow: t.row, date: t.date, reference: t.reference, signedMinorUnits: t.amountMinor })),
      readErrors: source.errors, warnings: source.warnings,
    };
  }
  const observation = {
    id: fixture.id, language, sourceSha256: sha(nativeBytes), sourceBytes: nativeBytes.length,
    nativeRequest: JSON.parse(request.data), baselineColumns, baselineQuality: evaluate(baselineColumns, fixture.expected),
    inputTokens: inputs.input_ids.dims[1], elapsedMs, runtimeError: error, timedOut: deadline.timedOut,
    raw, boundKind: bound.kind, rejectedReason: bound.kind === 'rejected' ? bound.reason : null,
    rawColumns, rawQuality: rawColumns ? evaluate(rawColumns, fixture.expected) : null,
    proposedColumns, modelQuality: quality, sourceUnchanged: before === JSON.stringify({ file, mapping }),
    modelAuthority: bound.kind === 'needs-review' ? bound.verified.status : 'none', reviewedReading,
    processRssBytes: process.memoryUsage().rss,
  };
  report.cases.push(observation);
  await save();
  console.log(JSON.stringify({ id: `${fixture.id}-${language}`, elapsedMs: Math.round(elapsedMs), bound: bound.kind, exact: quality.exact, wrong: quality.wrongRoles }));
}
await model.dispose();
report.summary = {
  semanticFamilies: contract.cases.length,
  languagePresentations: report.cases.length,
  baselineExact: report.cases.filter(c => c.baselineQuality.exact).length,
  modelExact: report.cases.filter(c => c.modelQuality.exact).length,
  rawWrongSemanticProposals: report.cases.filter(c => c.rawQuality?.wrongRoles.length).length,
  wrongSemanticProposals: report.cases.filter(c => c.modelQuality.wrongRoles.length).length,
  refusedOrAbstained: report.cases.filter(c => c.boundKind !== 'needs-review').length,
  sourceMutations: report.cases.filter(c => !c.sourceUnchanged).length,
  authorityViolations: report.cases.filter(c => !['none', 'needs-review'].includes(c.modelAuthority)).length,
  networkAttempts: networkAttempts.length,
  activationDecision: 'not activated: actual browser and second physical device gates incomplete; semantic scores must be reviewed',
};
await save();
console.log(JSON.stringify(report.summary));
