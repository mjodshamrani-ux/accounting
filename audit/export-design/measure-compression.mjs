/** Isolated ZIP experiment, NOT a browser/ExcelJS end-to-end benchmark.
 * Recompresses the exact existing XML bytes in a fresh Node process per trial.
 * Source inflation and independent package verification are outside the clock.
 */
import JSZip from 'jszip';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.find((arg) => arg.startsWith(name + '='))?.slice(name.length + 1) ??
  fallback;
const input = path.resolve(option('--input', ''));
const output = path.resolve(option('--output', ''));
assert.ok(
  option('--input') && option('--output'),
  '--input and --output are required',
);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const shell = promisify(execFile);
const script = fileURLToPath(import.meta.url);
const checker = path.join(path.dirname(script), 'check_package_identity.py');

if (option('--child')) {
  const source = await readFile(input);
  const original = await JSZip.loadAsync(source, { checkCRC32: true });
  const zip = new JSZip();
  let uncompressedBytes = 0;
  for (const [name, part] of Object.entries(original.files)) {
    if (part.dir) continue;
    const bytes = await part.async('nodebuffer');
    uncompressedBytes += bytes.length;
    // Buffer inputs force recompression instead of reusing compressed members.
    zip.file(name, bytes, { date: part.date, createFolders: false });
  }
  const variant = option('--child');
  const settings = { type: 'nodebuffer', compression: 'DEFLATE' };
  if (variant !== 'default')
    settings.compressionOptions = { level: Number(variant) };
  const started = performance.now();
  const compressed = await zip.generateAsync(settings);
  const compressionMs = performance.now() - started;
  await writeFile(output, compressed);
  console.log(
    JSON.stringify({
      variant,
      compressionMs,
      outputBytes: compressed.length,
      uncompressedBytes,
      sourceSha256: sha256(source),
      outputSha256: sha256(compressed),
    }),
  );
} else {
  await mkdir(output, { recursive: true });
  const report = {
    schema: 'tarasuf-isolated-compression-1',
    createdAt: new Date().toISOString(),
    node: process.version,
    jszip: '3.10.1',
    machine: {
      cpu: os.cpus()[0].model,
      memoryBytes: os.totalmem(),
      platform: os.platform(),
      arch: os.arch(),
    },
    input,
    scope:
      'ZIP compression of already generated workbook parts only; excludes parsing, reconciliation, original revalidation, workbook construction, XML generation, UI and download. Not a browser memory or end-to-end speed claim.',
    trials: [],
  };
  const order = ['default', '1', '3'];
  for (let round = 0; round < 3; round++) {
    for (let offset = 0; offset < order.length; offset++) {
      const variant = order[(round + offset) % order.length];
      const destination = path.join(
        output,
        `round-${round + 1}-${variant}.xlsx`,
      );
      const { stdout } = await shell(
        process.execPath,
        [
          script,
          `--input=${input}`,
          `--output=${destination}`,
          `--child=${variant}`,
        ],
        { maxBuffer: 1024 * 1024 },
      );
      const trial = { round: round + 1, ...JSON.parse(stdout) };
      const verified = await shell('python3', [checker, input, destination], {
        maxBuffer: 1024 * 1024,
      });
      trial.packageIdentity = JSON.parse(verified.stdout);
      report.trials.push(trial);
      await writeFile(
        path.join(output, 'results.json'),
        JSON.stringify(report, null, 2) + '\n',
      );
      console.log(
        JSON.stringify({
          round: trial.round,
          variant,
          ms: Math.round(trial.compressionMs),
          bytes: trial.outputBytes,
        }),
      );
    }
  }
  const median = (values) =>
    values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  report.summary = order.map((variant) => {
    const trials = report.trials.filter((trial) => trial.variant === variant);
    return {
      variant,
      medianCompressionMs: median(trials.map((trial) => trial.compressionMs)),
      outputBytes: trials[0].outputBytes,
      identicalPackageTrials: trials.length,
    };
  });
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
