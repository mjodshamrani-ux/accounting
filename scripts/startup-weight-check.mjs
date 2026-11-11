// UX-9 startup weight gate on a built dist. It follows what index.html loads
// before anything runs: the entry module, its modulepreload links and every
// static import of those files, transitively. Dynamic import() is not
// followed, because nothing behind it is requested before it is called.
//
//   node scripts/startup-weight-check.mjs [dist] --require engine[,workspaces,libraries,budget]
//
// engine:     no startup file holds Vite's inline worker, the engine text.
// workspaces: each of the eleven workspaces has its own chunk, none of them
//             at startup.
// libraries:  no ExcelJS or JSZip at startup, by chunk name or by the global
//             each UMD bundle names as it defines itself.
// budget:     the startup scripts are at most BUDGET_GZIP bytes with gzip -9.
import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUDGET_GZIP = 650_000;
export const WORKSPACES = [
  'payroll-workspace',
  'fixed-assets-workspace',
  'inventory-register-workspace',
  'payment-gateway-workspace',
  'intercompany-workspace',
  'tb-financial-workspace',
  'bank-workspace',
  'allocation-workspace',
  'gl-tb-workspace',
  'ar-workspace',
  'clearing-workspace',
];
export const REQUIREMENTS = ['engine', 'workspaces', 'libraries', 'budget'];
// Both branches of Vite's inline worker carry the text: a blob made from it
// and, failing that, a data URL of it.
const INLINE_WORKER = 'data:text/javascript;charset=utf-8,';
const LIBRARY = /^(exceljs\.min|jszip\.min)-[\w-]+\.js$/;
// The bundler can merge a library into a chunk of another name (seen when one
// startup module imported ExcelJS: no exceljs.min chunk, 818,974 bytes at
// startup). Both are UMD bundles that assign their global as they define
// themselves, and that assignment survives the merge.
const LIBRARY_GLOBAL = [
  /\.ExcelJS=[A-Za-z_$][\w$]*\(\)/,
  /\.JSZip=[A-Za-z_$][\w$]*\(\)/,
];

const staticImports = (code) => {
  const found = new Set();
  // Minified static forms: import"./a.js", import{x}from"./a.js",
  // import*as x from"./a.js", export{x}from"./a.js". import("./a.js") is dynamic.
  const pattern =
    /(?:^|[;}\s])(?:import|export)\s*(?:(?:[\w$*{][^;'"`]*?)\s*from\s*)?["']([^"']+\.js)["']/g;
  for (const m of code.matchAll(pattern)) found.add(m[1]);
  return [...found];
};

export async function startupFiles(dist) {
  const html = await readFile(path.join(dist, 'index.html'), 'utf8');
  const roots = [
    ...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g),
    ...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g),
  ].map((m) => path.posix.normalize(m[1].replace(/^\.\//, '')));
  if (!roots.length) throw Error('index.html loads no module script');
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const code = await readFile(path.join(dist, rel), 'utf8');
    for (const spec of staticImports(code))
      queue.push(
        path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)),
      );
  }
  return [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export async function checkStartupWeight(dist, required) {
  for (const r of required)
    if (!REQUIREMENTS.includes(r)) throw Error('unknown requirement ' + r);
  const files = await startupFiles(dist);
  const contents = new Map();
  for (const f of files) contents.set(f, await readFile(path.join(dist, f)));
  const failures = [];
  if (required.includes('engine'))
    for (const [f, bytes] of contents)
      if (bytes.includes(INLINE_WORKER))
        failures.push(
          `engine: ${f} holds the inline worker text (${bytes.length} bytes)`,
        );
  const assets = await readdir(path.join(dist, 'assets'));
  if (required.includes('workspaces'))
    for (const name of WORKSPACES) {
      const own = assets.filter(
        (a) => a.startsWith(name + '-') && a.endsWith('.js'),
      );
      if (!own.length)
        failures.push(`workspaces: ${name} has no chunk of its own`);
      for (const a of own)
        if (files.includes('assets/' + a))
          failures.push(`workspaces: ${a} is loaded at startup`);
    }
  if (required.includes('libraries'))
    for (const [f, bytes] of contents) {
      const text = bytes.toString('latin1');
      if (
        LIBRARY.test(path.posix.basename(f)) ||
        LIBRARY_GLOBAL.some((global) => global.test(text))
      )
        failures.push(`libraries: ${f} is loaded at startup`);
    }
  let gzip = 0;
  let raw = 0;
  for (const [, bytes] of contents) {
    raw += bytes.length;
    gzip += gzipSync(bytes, { level: 9 }).length;
  }
  if (required.includes('budget') && gzip > BUDGET_GZIP)
    failures.push(
      `budget: startup scripts are ${gzip} bytes with gzip, over ${BUDGET_GZIP}`,
    );
  return { files, raw, gzip, required, failures };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--require');
  if (at < 0 || !args[at + 1])
    throw Error('Pass --require with one or more of ' + REQUIREMENTS.join(','));
  const required = args[at + 1].split(',');
  const rest = args.filter((_, i) => i !== at && i !== at + 1);
  const dist = path.resolve(
    rest[0] ?? path.join(import.meta.dirname, '..', 'dist'),
  );
  const result = await checkStartupWeight(dist, required);
  console.log(
    JSON.stringify({
      startupWeightCheck: result.failures.length ? 'failed' : 'passed',
      required,
      files: result.files.length,
      raw: result.raw,
      gzip: result.gzip,
      failures: result.failures,
    }),
  );
  if (result.failures.length) process.exit(1);
}
