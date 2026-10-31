import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The deployed release is stated in one place: the status table at the top of
// docs/reference/STATE.ar.md. Other entry documents point to it. Four
// documents once named four different deployed versions (DEV-45).
const read = (file: string) => fs.readFileSync(file, 'utf8');
const pkg = JSON.parse(read('package.json')) as { version: string };
const state = read('docs/reference/STATE.ar.md');
const STATUS_LINK = 'reference/STATE.ar.md#الحالة-الحالية';
const entries = ['README.md', 'docs/README.ar.md', 'docs/CURRENT-PLAN.ar.md'];

function statusRow(label: string) {
  const table = state.split('## الحالة الحالية')[1]?.split('\n## ')[0] ?? '';
  const row = table.split('\n').find((line) => line.startsWith(`| ${label} |`));
  assert.ok(row, `status table row missing: ${label}`);
  return row.split('|')[2].trim();
}
const semver = (v: string) => v.split('.').map(Number);
const notAfter = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return true;
};

void test('the status table names the package version and a deployed version not ahead of it', () => {
  assert.equal(statusRow('إصدار الحزمة في `package.json`'), pkg.version);
  const deployed = statusRow('آخر إصدار منشور متحقق منه');
  assert.match(deployed, /^\d+\.\d+\.\d+$/);
  assert.ok(notAfter(deployed, pkg.version), `${deployed} > ${pkg.version}`);
});

void test('entry documents point to the status table and claim no other deployed version', () => {
  const deployed = statusRow('آخر إصدار منشور متحقق منه');
  for (const file of entries) {
    const text = read(file);
    assert.ok(text.includes(STATUS_LINK), `${file} must link the status table`);
    // A sentence that calls a version the deployed or published base.
    for (const m of text.matchAll(
      /(?:أساس منشور|الإصدار المنشور|منشور متحقق منه|التطبيق المنشور)[^.\n]{0,60}?(\d+\.\d+\.\d+)/g,
    ))
      assert.equal(m[1], deployed, `${file}: "${m[0]}"`);
  }
  // The root README states the package version it describes.
  const pkgClaim = read('README.md').match(/إصدار الحزمة (\d+\.\d+\.\d+)/);
  assert.equal(pkgClaim?.[1], pkg.version);
});

void test('the check above catches a stale deployed version', () => {
  const stale = 'آخر أساس منشور متحقق منه **0.4.48** عند';
  const m = stale.match(
    /(?:أساس منشور|الإصدار المنشور|منشور متحقق منه|التطبيق المنشور)[^.\n]{0,60}?(\d+\.\d+\.\d+)/,
  );
  assert.equal(m?.[1], '0.4.48');
  assert.notEqual(m?.[1], statusRow('آخر إصدار منشور متحقق منه'));
});

// Every relative link in the reference documents resolves to a file, and every
// #anchor to a heading or explicit anchor in it.
const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
function anchors(file: string) {
  const text = read(file);
  const found = new Set<string>();
  const seen = new Map<string, number>();
  for (const m of text.matchAll(/^#{1,6}\s+(.*)$/gm)) {
    const key = slug(m[1]);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    found.add(n ? `${key}-${n}` : key);
  }
  for (const m of text.matchAll(/<a id="([^"]+)"/g)) found.add(m[1]);
  return found;
}
const docs = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  ...fs
    .readdirSync('docs', { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join('docs', f)),
];

void test('relative links and anchors in the reference documents resolve', () => {
  const broken: string[] = [];
  for (const file of docs)
    for (const m of read(file).matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(?:https?:|mailto:)/.test(target)) continue;
      const [rel, anchor] = target.split('#');
      const resolved = rel
        ? path.resolve(path.dirname(file), rel)
        : path.resolve(file);
      if (!fs.existsSync(resolved)) {
        broken.push(`${file} → ${target}`);
        continue;
      }
      if (
        anchor &&
        resolved.endsWith('.md') &&
        !anchors(resolved).has(decodeURIComponent(anchor))
      )
        broken.push(`${file} → ${target} (anchor)`);
    }
  assert.deepEqual(broken, []);
});
