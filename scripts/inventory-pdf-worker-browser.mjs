// Backend acceptance probe for the built native browser Worker; no PDF UI claim.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  cp,
} from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { runInNewContext } from 'node:vm';
import {
  pdfLifecycleFixture,
  g3Contract,
} from '../tests/helpers/inventory-pdf-lifecycle-fixture.ts';
const root = path.resolve(import.meta.dirname, '..'),
  dist = path.join(root, 'dist');
const withWorkbooks = process.argv.includes('--workbooks');
const exported = {};
const output =
  (withWorkbooks ? process.env.INV_PDF_WORKBOOK_BROWSER_DIR : undefined) ??
  process.env.INV_PDF_WORKER_BROWSER_DIR ??
  path.join(root, 'work/inventory-pdf-worker-browser');
await mkdir(output, { recursive: true });
const out = await mkdtemp(path.join(output, 'run-'));
const fixture = await pdfLifecycleFixture();
await cp(fixture.root, path.join(out, 'sources'), { recursive: true });
// Vite's production inline Worker is a JS string literal in the entry chunk.
// Extract only that literal, evaluate in an empty VM and run those exact bytes.
const entries = (await readdir(path.join(dist, 'assets'))).filter((f) =>
  /^index-[A-Za-z0-9_-]+\.js$/.test(f),
);
assert.equal(entries.length, 1);
const entry = await readFile(path.join(dist, 'assets', entries[0]), 'utf8');
const marker =
  /new Blob\(\[`URL\.revokeObjectURL\(import\.meta\.url\);`,([A-Za-z_$][\w$]*)\]/.exec(
    entry,
  );
assert.ok(marker, 'Expected production inline Worker marker');
const assignment = new RegExp('\\b' + marker[1] + '=([\\"\'])', 'g');
let match,
  start = -1;
while ((match = assignment.exec(entry)) && match.index < marker.index)
  start = match.index + match[0].length - 1;
assert.ok(start >= 0, 'Worker string assignment');
const quote = entry[start];
let end = start + 1;
for (; end < entry.length; end++) {
  if (entry[end] === '\\') {
    end++;
    continue;
  }
  if (entry[end] === quote) break;
}
const worker = entries[0] + '#inline-accounting-worker';
const workerSource = runInNewContext(
  entry.slice(start, end + 1),
  Object.create(null),
  { timeout: 1000 },
);
assert.equal(typeof workerSource, 'string');
assert.ok(
  workerSource.includes('stock-pdf-reconcile') &&
    workerSource.includes('mizan-accounting-v1'),
);
const workerSha256 = createHash('sha256').update(workerSource).digest('hex');
const productionHtml = await readFile(path.join(dist, 'index.html'), 'utf8');
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(
  productionHtml,
)?.[1];
assert.ok(
  csp && csp.includes("connect-src 'none'") && csp.includes('worker-src blob:'),
);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Security-Policy', csp);
      return res.end(
        '<!doctype html><title>Local G4 backend Worker probe</title>',
      );
    }
    const file = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
    assert.ok(file.startsWith(dist + path.sep));
    res.setHeader(
      'Content-Type',
      {
        '.js': 'text/javascript',
        '.wasm': 'application/wasm',
        '.json': 'application/json',
      }[path.extname(file)] ?? 'application/octet-stream',
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true }),
  page = await browser.newPage();
const external = [],
  nonGet = [],
  errors = [];
page.on('request', (r) => {
  if (
    !r.url().startsWith(origin + '/') &&
    !r.url().startsWith('blob:') &&
    !r.url().startsWith('data:')
  )
    external.push(r.url());
  if (r.method() !== 'GET') nonGet.push(r.method());
});
page.on('pageerror', (e) => errors.push(e.message));
const proof = { version: 'inventory-pdf-lifecycle-1', cases: {} };
try {
  await page.goto(origin);
  await page.evaluate((worker) => {
    const url = URL.createObjectURL(
      new Blob([worker], { type: 'text/javascript' }),
    );
    const port = new Worker(url, { type: 'module' });
    let id = 0;
    const waiting = new Map();
    port.onmessage = (e) => {
      const m = e.data;
      if (m.channel !== 'mizan-accounting-v1') return;
      const p = waiting.get(m.id);
      if (!p) return;
      waiting.delete(m.id);
      clearTimeout(p.timer);
      if (m.action !== p.action || typeof m.ok !== 'boolean')
        p.reject(Error('Invalid reply'));
      else if (m.ok) p.resolve(m.value);
      else p.reject(Error(m.error));
    };
    port.onerror = (e) => {
      for (const p of waiting.values()) {
        clearTimeout(p.timer);
        p.reject(Error(e.message));
      }
      waiting.clear();
    };
    window.g4 = {
      request: (action, payload) =>
        new Promise((resolve, reject) => {
          const serial = ++id;
          const timer = setTimeout(() => {
            waiting.delete(serial);
            reject(Error('G4 timeout'));
          }, 60000);
          waiting.set(serial, { action, resolve, reject, timer });
          port.postMessage({
            channel: 'mizan-accounting-v1',
            id: serial,
            action,
            payload,
          });
        }),
      close: () => port.terminate(),
    };
  }, workerSource);
  for (const code of [
    ...g3Contract.ready,
    ...g3Contract.difference,
    ...g3Contract.missing,
    ...Object.keys(g3Contract.sourceErrors),
  ]) {
    const state = await fixture.input(code),
      serializable = {
        ...state,
        files: state.files.map((f) => ({
          name: f.name,
          sha256: f.sha256,
          data: Buffer.from(f.original).toString('base64'),
        })),
      };
    const captured = await page.evaluate(
      async ({ state, positive, withWorkbooks }) => {
        const decode = (data) =>
          Uint8Array.from(atob(data), (c) => c.charCodeAt(0)).buffer;
        const encode = (data) => {
          const b = new Uint8Array(data);
          let s = '';
          for (let i = 0; i < b.length; i += 16384)
            s += String.fromCharCode(...b.subarray(i, i + 16384));
          return btoa(s);
        };
        const input = {
          ...state,
          files: state.files.map(({ name, sha256, data }) => ({
            name,
            sha256,
            original: decode(data),
          })),
        };
        const pack = (v) => ({
          ...v,
          state: {
            ...v.state,
            files: v.state.files.map((f) => ({
              name: f.name,
              sha256: f.sha256,
              data: encode(f.original),
            })),
          },
        });
        const phases = {},
          workbookData = {};
        const capture = async (phase) => {
          const value = await window.g4.request('stock-pdf-reconcile', input),
            saved = await window.g4.request('stock-pdf-save', input),
            restored = await window.g4.request('stock-pdf-restore', {
              buffer: saved,
            });
          if (withWorkbooks)
            workbookData[phase] = encode(
              await window.g4.request('stock-pdf-export', {
                state: value.state,
                result: value.result,
              }),
            );
          phases[phase] = {
            value: pack(value),
            restored: pack(restored),
            session: JSON.parse(new TextDecoder().decode(saved)),
          };
          return value;
        };
        await capture('unreviewed');
        if (positive) {
          input.completeness = {
            confirmed: true,
            reference: 'Synthetic completeness review',
            note: 'All original pages reviewed',
          };
          let r = await capture('complete');
          for (const [i, [type, phase]] of [
            ['accept', 'accepted'],
            ['undo', 'undone'],
            ['reject', 'rejected'],
            ['undo', 'reopened'],
          ].entries()) {
            input.events.push({
              id: 'decision-' + i,
              type,
              memberIds: [...r.result.memberIds],
              context: r.result.context,
              at: '2026-10-16T09:00:00.000Z',
              reference: 'Synthetic source review',
              note: 'All supplied scope reviewed',
            });
            r = await capture(phase);
          }
        }
        return withWorkbooks ? { phases, workbookData } : phases;
      },
      {
        state: serializable,
        positive: g3Contract.ready.includes(code),
        withWorkbooks,
      },
    );
    proof.cases['INV1F-' + code] = withWorkbooks ? captured.phases : captured;
    if (withWorkbooks) {
      exported['INV1F-' + code] = Object.fromEntries(
        Object.entries(captured.phases).map(([phase, e]) => [
          phase,
          e.value.result,
        ]),
      );
      for (const [phase, data] of Object.entries(captured.workbookData))
        await writeFile(
          path.join(out, 'INV1F-' + code + '-' + phase + '.xlsx'),
          Buffer.from(data, 'base64'),
        );
    }
  }
  await page.evaluate(() => window.g4.close());
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await fixture.close();
}
const file = path.join(out, 'results.json');
await writeFile(file, JSON.stringify(proof));
const r = spawnSync(
  process.env.PYTHON ?? 'python3',
  [
    '-B',
    path.join(root, 'audit/inventory-pdf-lifecycle/check_lifecycle.py'),
    '--root',
    path.join(out, 'sources'),
    '--result',
    file,
  ],
  { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
);
await writeFile(path.join(out, 'independent.log'), r.stdout + r.stderr);
assert.equal(r.status, 0, r.stderr);
assert.deepEqual(external, []);
assert.deepEqual(nonGet, []);
assert.deepEqual(errors, []);
let workbookCheck;
if (withWorkbooks) {
  const f = path.join(out, 'export-results.json');
  await writeFile(f, JSON.stringify(exported));
  const check = spawnSync(
    process.env.PYTHON ?? 'python3',
    [
      '-B',
      path.join(root, 'audit/inventory-pdf-workbook/check_export.py'),
      '--root',
      path.join(out, 'sources'),
      '--result',
      f,
      '--books',
      out,
    ],
    { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
  );
  await writeFile(
    path.join(out, 'independent-workbooks.log'),
    check.stdout + check.stderr,
  );
  assert.equal(check.status, 0, check.stderr);
  workbookCheck = JSON.parse(check.stdout);
}
const report = {
  ...(withWorkbooks ? { workbookCheck } : {}),
  passed: true,
  worker,
  workerSha256,
  csp,
  independent: JSON.parse(r.stdout),
  external,
  nonGet,
  errors,
};
await writeFile(path.join(out, 'checks.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out, ...report }, null, 2));
