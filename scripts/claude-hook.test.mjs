import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../.claude/hooks/protect-recorded-evidence.mjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'claude-hook-'));
for (const path of [
  'audit/holdout/frozen/INPUT-MANIFEST.json',
  'audit/holdout/results/run-1.json',
  'audit/domain/oracle/oracle.py',
  'audit/old/reviews/original/probe.mjs',
  'lib/engine.ts',
]) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), '{}');
}
mkdirSync(join(root, 'scripts'), { recursive: true });
writeFileSync(
  join(root, 'scripts/lint-frozen-originals.json'),
  JSON.stringify({ files: [{ path: 'audit/old/reviews/original/probe.mjs' }] }),
);
test.after(() => rmSync(root, { recursive: true, force: true }));

function run(input, raw) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: raw ?? JSON.stringify({ cwd: root, hook_event_name: 'PreToolUse', ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : undefined;
}
const edit = (file_path, tool_name = 'Edit') => run({ tool_name, tool_input: { file_path } });

void test('existing sealed files and listed frozen originals are refused', () => {
  for (const path of ['audit/holdout/frozen/INPUT-MANIFEST.json', join(root, 'audit/old/reviews/original/probe.mjs')]) {
    const out = edit(path, 'Write');
    assert.equal(out.permissionDecision, 'deny');
    assert.match(out.permissionDecisionReason, /sealed evidence/);
  }
});

void test('traversal and notebook edits into sealed files are refused', () => {
  assert.equal(edit('lib/../audit/holdout/frozen/./INPUT-MANIFEST.json').permissionDecision, 'deny');
  const out = run({ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'audit/holdout/frozen/INPUT-MANIFEST.json' } });
  assert.equal(out.permissionDecision, 'deny');
});

void test('existing recorded results and oracles ask the person', () => {
  assert.equal(edit('audit/holdout/results/run-1.json').permissionDecision, 'ask');
  assert.equal(edit('audit/domain/oracle/oracle.py', 'MultiEdit').permissionDecision, 'ask');
});

void test('new evidence files, ordinary files and files outside the project pass without a decision', () => {
  assert.equal(edit('audit/holdout/frozen/NEW.json', 'Write'), undefined);
  assert.equal(edit('audit/holdout/results/run-2.json', 'Write'), undefined);
  assert.equal(edit('lib/engine.ts'), undefined);
  assert.equal(edit(join(tmpdir(), 'elsewhere', 'frozen', 'x.json')), undefined);
  assert.equal(run({ tool_name: 'Edit', tool_input: {} }), undefined);
});

void test('unreadable input fails open, as documented', () => {
  assert.equal(run({}, 'not json'), undefined);
});

void test('the project settings register the hook for every file-edit tool', () => {
  const settings = JSON.parse(readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8'));
  const [group] = settings.hooks.PreToolUse;
  assert.deepEqual(group.matcher.split('|').sort(), ['Edit', 'MultiEdit', 'NotebookEdit', 'Write']);
  assert.match(group.hooks[0].command, /\.claude\/hooks\/protect-recorded-evidence\.mjs/);
});
