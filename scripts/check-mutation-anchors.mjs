// Every mutation and fault gate changes product files at text anchors. An
// anchor found twice, or not at all, stops the gate only when CI reaches that
// fault, often after many minutes (DEV-75). This check reads the fault list of
// every scripts/test-*mutations.mjs, scripts/*faults.mjs and
// scripts/*-differential.mjs without running a
// fault or writing a file, applies each fault's edits in order to its own copy
// of the target text, and requires each anchor exactly once.
//
// A fault whose shape it does not know, a gate whose list it cannot read, a
// target file that is absent, or a gate with no faults, is a failure, never a
// skip. It first runs itself on a planted tree, where each planted problem
// must be reported by its fault name and each sound fault must pass.
//
//   node scripts/check-mutation-anchors.mjs [--root dir]
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

// Gates whose faults name no file, and the one file each changes, as the gate
// itself reads it. A gate with such faults that is not here, and that has no
// `const file`, is reported.
const DEFAULT_TARGET = {
  'test-gl-tb-binding-mutations.mjs': 'lib/reconciliation/worker-client.ts',
  'test-gl-tb-vertical-mutations.mjs': 'lib/reconciliation/gl-tb.ts',
};

const gateNames = (root) =>
  readdirSync(join(root, 'scripts'))
    .filter(
      (n) =>
        (n.startsWith('test-') && n.endsWith('mutations.mjs')) ||
        n.endsWith('faults.mjs') ||
        n.endsWith('-differential.mjs'),
    )
    .sort();

// The fault list as the gate writes it, evaluated with the gate's own path
// constants. Returns null when the gate has no list of this form.
function faultList(text) {
  const start = text.search(/^const (?:mutations|faults) = \[/m);
  if (start < 0) return null;
  const end = text.indexOf('\n];', start);
  if (end < 0) throw Error('the list does not end');
  const body = text.slice(text.indexOf('[', start), end + 2);
  const consts = {
    mutation: (id, files, pattern, edits) => ({ name: id, edits }),
    edit: (file, find, replacement) => ({ file, find, replacement }),
  };
  for (const m of text.matchAll(
    /^(?:const|let)?\s*([A-Za-z_$][\w$]*)\s*=\s*(['"])([\w./-]+\.(?:tsx?|mjs|js|css|json|html|py))\2[,;]?$/gm,
  ))
    consts[m[1]] = m[3];
  for (const m of text.matchAll(/^const (byNumber) = (['"])(.*)\2;$/gm))
    consts[m[1]] = m[3];
  // Its own context: the list sees the path constants and nothing else.
  return runInNewContext(`(${body})`, consts, { timeout: 5000 });
}

// The list comes from another context, where `instanceof RegExp` is false.
const isRegExp = (v) => Object.prototype.toString.call(v) === '[object RegExp]';
const isAnchor = (v) => typeof v === 'string' || isRegExp(v);
const isText = (v) => typeof v === 'string' || typeof v === 'function';

// One fault as its name and its ordered edits [file, anchor, replacement].
function normalize(entry, fallback) {
  if (Array.isArray(entry)) {
    const [name, ...rest] = entry;
    if (rest.length === 3 && typeof rest[0] === 'string' && isAnchor(rest[1]))
      return { name, edits: [[rest[0], rest[1], rest[2]]] };
    if (rest.length === 2 && isAnchor(rest[0]) && isText(rest[1]))
      return { name, edits: [[fallback, rest[0], rest[1]]] };
    return { name, edits: null };
  }
  if (!entry || typeof entry !== 'object') return { name: '?', edits: null };
  const name = entry.name ?? entry.id ?? '?';
  if (Array.isArray(entry.edits)) {
    const edits = entry.edits.map((e) => [
      e.file ?? entry.file ?? fallback,
      e.find ?? e.from ?? e.before,
      e.replacement ?? e.replace ?? e.to ?? e.after,
    ]);
    return { name, edits };
  }
  if (Array.isArray(entry.changes)) {
    const edits = entry.changes.map((c) =>
      Array.isArray(c) && c.length === 2
        ? [entry.file ?? fallback, c[0], c[1]]
        : Array.isArray(c) && c.length === 3
          ? [c[0], c[1], c[2]]
          : [undefined, undefined, undefined],
    );
    return { name, edits };
  }
  const find = entry.find ?? entry.from ?? entry.before ?? entry.needle;
  const replacement =
    entry.replacement ?? entry.replace ?? entry.to ?? entry.after;
  if (find !== undefined)
    return { name, edits: [[entry.file ?? fallback, find, replacement]] };
  return { name, edits: null };
}

const count = (text, anchor) =>
  isRegExp(anchor)
    ? [
        ...text.matchAll(
          new RegExp(anchor.source, anchor.flags.replace('g', '') + 'g'),
        ),
      ].length
    : text.split(anchor).length - 1;

export function scan(root) {
  const gates = [];
  const problems = [];
  for (const gate of gateNames(root)) {
    const text = readFileSync(join(root, 'scripts', gate), 'utf8');
    let list;
    try {
      list = faultList(text);
    } catch (error) {
      problems.push([gate, '-', '-', `list not readable: ${error.message}`]);
      continue;
    }
    if (list === null) {
      // A runner module shared by fault gates holds no list of its own.
      if (!/^const (?:mutations|faults) =/m.test(text)) continue;
      problems.push([gate, '-', '-', 'list not readable']);
      continue;
    }
    if (!Array.isArray(list) || list.length === 0) {
      problems.push([gate, '-', '-', 'no faults']);
      continue;
    }
    const own = /^const file = (['"])([\w./-]+)\1;$/m.exec(text)?.[2];
    const fallback = own ?? DEFAULT_TARGET[gate];
    if (
      DEFAULT_TARGET[gate] &&
      !text.includes(DEFAULT_TARGET[gate].split('/').pop())
    )
      problems.push([
        gate,
        '-',
        DEFAULT_TARGET[gate],
        'default target not named by the gate',
      ]);
    let anchors = 0;
    for (const entry of list) {
      const { name, edits } = normalize(entry, fallback);
      if (!edits || edits.length === 0) {
        problems.push([gate, String(name), '-', 'fault shape not known']);
        continue;
      }
      const copies = new Map();
      for (const [file, anchor, replacement] of edits) {
        if (
          typeof file !== 'string' ||
          !isAnchor(anchor) ||
          !isText(replacement)
        ) {
          problems.push([
            gate,
            String(name),
            String(file),
            'edit shape not known',
          ]);
          break;
        }
        const path = join(root, file);
        if (!copies.has(file)) {
          if (!existsSync(path)) {
            problems.push([gate, String(name), file, 'file absent']);
            break;
          }
          copies.set(file, readFileSync(path, 'utf8'));
        }
        const before = copies.get(file);
        const found = count(before, anchor);
        anchors++;
        if (found !== 1) {
          problems.push([
            gate,
            String(name),
            file,
            `anchor found ${found} times`,
          ]);
          break;
        }
        copies.set(
          file,
          before.replace(
            anchor,
            typeof replacement === 'function' ? replacement : () => replacement,
          ),
        );
      }
    }
    gates.push({ gate, faults: list.length, anchors });
  }
  return { gates, problems };
}

// A tree with one sound fault of each shape and one planted problem of each
// kind. Every planted fault must be reported by name; no sound one may be.
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'mutation-anchors-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'lib'));
    writeFileSync(
      join(dir, 'lib/a.ts'),
      'const one = 1;\nconst two = 2;\nconst twice = 0;\nconst twice = 0;\nlet x = 5;\n',
    );
    writeFileSync(join(dir, 'lib/b.ts'), 'export const b = 1;\n');
    const gate = (name, body) =>
      writeFileSync(join(dir, 'scripts', name), body);
    gate(
      'test-sound-mutations.mjs',
      `const A = 'lib/a.ts';
const B = 'lib/b.ts';
const mutation = () => 0;
const edit = () => 0;
const mutations = [
  ['tuple', A, 'const one = 1;', 'const one = 0;'],
  ['regex-tuple', A, /let x = \\d;/, 'let x = 6;'],
  { name: 'object-edits', edits: [{ file: B, find: 'b = 1', replacement: 'b = 2' }] },
  { name: 'object-from', file: A, from: 'two = 2', to: 'two = 3' },
  { name: 'object-before', file: A, before: 'two = 2', after: 'two = 4' },
  { name: 'object-changes', file: A, changes: [['one = 1', 'one = 9'], ['one = 9', 'one = 8']] },
  mutation('helper', [A], /x/, [edit(B, 'export const b', 'const b')]),
];
`,
    );
    gate(
      'test-default-mutations.mjs',
      `const file = 'lib/b.ts';
const mutations = [
  ['three-tuple', 'export const b', 'const b'],
  ['three-tuple-twice', 'NOT-THERE', 'x'],
];
`,
    );
    gate(
      'test-planted-mutations.mjs',
      `const A = 'lib/a.ts';
const mutations = [
  ['planted-duplicate', A, 'const twice = 0;', ''],
  ['planted-missing', A, 'const three = 3;', ''],
  ['planted-file-absent', 'lib/c.ts', 'c', 'd'],
  ['planted-regex-twice', A, /const t\\w+ = /, ''],
  { name: 'planted-shape', weird: true },
  { name: 'planted-consumed', file: A, changes: [['one = 1', 'one = 2'], ['one = 1', 'one = 3']] },
  ['planted-no-target', 'const one = 1;', ''],
];
`,
    );
    gate('test-empty-mutations.mjs', 'const mutations = [\n];\n');
    gate(
      'test-broken-mutations.mjs',
      'const mutations = [\n  [UNKNOWN_NAME],\n];\n',
    );
    gate('shared-faults.mjs', 'export const runFaults = () => 0;\n');
    const { gates, problems } = scan(dir);
    const named = (gateName, fault) =>
      problems.filter(([g, f]) => g === gateName && f === fault);
    for (const fault of [
      'planted-duplicate',
      'planted-missing',
      'planted-file-absent',
      'planted-regex-twice',
      'planted-shape',
      'planted-consumed',
      'planted-no-target',
    ])
      assert.equal(named('test-planted-mutations.mjs', fault).length, 1, fault);
    assert.equal(
      named('test-default-mutations.mjs', 'three-tuple-twice').length,
      1,
    );
    assert.equal(
      named('test-empty-mutations.mjs', '-').length,
      1,
      'empty list',
    );
    assert.equal(
      named('test-broken-mutations.mjs', '-').length,
      1,
      'broken list',
    );
    assert.deepEqual(
      problems.filter(([g]) => g === 'test-sound-mutations.mjs'),
      [],
      'sound faults',
    );
    assert.deepEqual(named('test-default-mutations.mjs', 'three-tuple'), []);
    assert.equal(problems.length, 10, JSON.stringify(problems));
    const sound = gates.find((g) => g.gate === 'test-sound-mutations.mjs');
    assert.deepEqual(sound, {
      gate: 'test-sound-mutations.mjs',
      faults: 7,
      anchors: 8,
    });
    assert.equal(
      gates.some((g) => g.gate === 'shared-faults.mjs'),
      false,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const at = process.argv.indexOf('--root');
  const root = resolve(
    at > 0 ? process.argv[at + 1] : join(import.meta.dirname, '..'),
  );
  selfTest();
  const { gates, problems } = scan(root);
  const anchors = gates.reduce((n, g) => n + g.anchors, 0);
  console.log(
    JSON.stringify(
      { selfTest: 'passed', gates: gates.length, anchors, problems },
      null,
      1,
    ),
  );
  if (problems.length) process.exit(1);
}
