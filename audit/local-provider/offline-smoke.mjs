// Run under no-network.sb. A short actual inference verifies offline execution;
// it does not measure semantic quality or a second physical device.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  env,
  AutoTokenizer,
  AutoModelForCausalLM,
} from './node_modules/@huggingface/transformers/dist/transformers.node.mjs';
const root = path.resolve('.');
const manifest = JSON.parse(await readFile('audit/local-provider/model.json'));
for (const spec of manifest.files) {
  const bytes = await readFile(
    path.join(root, 'work/local-provider-assets', manifest.model, spec.path),
  );
  if (
    bytes.length !== spec.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== spec.sha256
  )
    throw Error('Unverified local model asset');
}
let fetchAttempts = 0;
globalThis.fetch = async () => {
  fetchAttempts++;
  throw Error('No network permitted');
};
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = path.join(root, 'work/local-provider-assets/');
env.useFSCache = false;
env.useBrowserCache = false;
const beforeLoad = performance.now();
const tokenizer = await AutoTokenizer.from_pretrained(manifest.model, {
  local_files_only: true,
});
const model = await AutoModelForCausalLM.from_pretrained(manifest.model, {
  local_files_only: true,
  device: 'cpu',
  dtype: manifest.dtype,
  session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
});
const loadMs = performance.now() - beforeLoad;
const inputs = tokenizer.apply_chat_template(
  [{ role: 'user', content: 'Return the JSON object {}. لا تضف شرحًا' }],
  {
    tokenize: true,
    return_dict: true,
    add_generation_prompt: true,
    enable_thinking: false,
  },
);
const start = performance.now();
const ids = await model.generate({
  ...inputs,
  max_new_tokens: 8,
  do_sample: false,
});
const result = {
  actualLocalInferenceCompleted: true,
  networkPolicy: 'macOS deny network* inherited from sandbox-exec',
  fetchAttempts,
  modelRevision: manifest.revision,
  threads: 1,
  loadMs,
  generationMs: performance.now() - start,
  raw: tokenizer.decode(ids.tolist()[0].slice(inputs.input_ids.dims[1]), {
    skip_special_tokens: true,
  }),
  rssBytes: process.memoryUsage().rss,
  financialApproval: false,
  syntheticInputOnly: true,
  qualityMeasured: false,
  secondPhysicalDevice: false,
};
await model.dispose();
await writeFile(
  'audit/local-provider/offline-smoke.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result));
