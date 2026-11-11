// UX-9(c): the eleven workspaces load their code on first choice, but their
// stylesheets stay in the page's one stylesheet, imported by app/page.tsx in
// the order the page met them when it imported the workspaces itself. A
// stylesheet that only a workspace reached would load later, after the rest,
// and could win a tie it used to lose. This walks the static import graph
// from main.tsx, and from each workspace module, and requires every
// stylesheet a workspace reaches to be reached from main.tsx without it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const WORKSPACES = [
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
const IMPORT =
  /^\s*(import|export)\s+(type\s+)?(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]/gms;

function resolve(spec: string, from: string) {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(root, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (spec.includes('?')) return null;
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx'])
    if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile())
      return base + ext;
  return null;
}

/** Stylesheets reached by static imports from `start`, in first-reach order. */
function stylesheets(
  start: string,
  source = (f: string) => fs.readFileSync(f, 'utf8'),
) {
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (file.endsWith('.css')) {
      order.push(path.relative(root, file));
      return;
    }
    if (!/\.tsx?$/.test(file)) return;
    for (const m of source(file).matchAll(IMPORT)) {
      if (m[2]) continue;
      const next = resolve(m[3], file);
      if (next) visit(next);
    }
  };
  visit(start);
  return order;
}

function missing(source?: (f: string) => string) {
  const shell = new Set(stylesheets(path.join(root, 'main.tsx'), source));
  const out: string[] = [];
  for (const name of WORKSPACES)
    for (const css of stylesheets(
      path.join(root, 'components', name + '.tsx'),
      source,
    ))
      if (!shell.has(css)) out.push(`${name}: ${css}`);
  return [...new Set(out)];
}

void test('every stylesheet a workspace reaches is in the page stylesheet from the start', () => {
  assert.deepEqual(missing(), []);
});

void test('the page imports no workspace module statically', () => {
  const page = fs.readFileSync(path.join(root, 'app/page.tsx'), 'utf8');
  for (const name of WORKSPACES)
    assert.ok(
      !new RegExp(`^import[^;]*from '@/components/${name}';`, 'm').test(page),
      `${name} is imported statically`,
    );
});

void test('the check sees a workspace stylesheet the page stops importing', () => {
  const page = path.join(root, 'app/page.tsx');
  const without = (f: string) => {
    const text = fs.readFileSync(f, 'utf8');
    return f === page
      ? text.replace("import '@/components/bank-workspace.css';\n", '')
      : text;
  };
  assert.deepEqual(missing(without), [
    'bank-workspace: components/bank-workspace.css',
  ]);
});
