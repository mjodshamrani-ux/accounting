import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkClaudeSetup, globRegExp, slug, SKILL_SECTIONS } from './check-claude-skills.mjs';

const sections = SKILL_SECTIONS.map(
  (section) => `## ${section}\n\nText for ${section.toLowerCase()}.\n`,
).join('\n');
const skill = (name = 'tarasuf-example', extra = '', body = sections) => `---
name: ${name}
description: Synthetic example skill used only by the validator tests. Use when checking that a well formed skill passes. ${extra}
---

# Example

See [the contract](../../../docs/contract.ar.md#قراءة-ومعنى-المال) and run \`pnpm test\` or \`node scripts/run.mjs\`.

${body}`;

function fixture(edit = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'claude-skills-'));
  const files = {
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    'scripts/run.mjs': '',
    'docs/contract.ar.md': '# العقد\n\n## قراءة ومعنى المال\n\nنص.\n',
    'docs/reference/SKILLS.ar.md': '# المهارات\n\n- `tarasuf-example`: [المهارة](../../.claude/skills/tarasuf-example/SKILL.md)\n',
    'CLAUDE.md': '# Project\n\nSee the [skills map](docs/reference/SKILLS.ar.md).\n',
    '.claude/skills/tarasuf-example/SKILL.md': skill(),
    '.claude/rules/scripts.md': '---\npaths:\n  - "scripts/**"\n---\n\n# Scripts\n\nUse `tarasuf-example`.\n',
    '.claude/hooks/guard.mjs': '',
    '.claude/settings.json': JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Edit|Write',
            hooks: [
              { type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/guard.mjs"', timeout: 10 },
            ],
          },
        ],
      },
    }),
  };
  edit(files);
  for (const [path, content] of Object.entries(files)) {
    if (content === undefined) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  try {
    return checkClaudeSetup(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const SKILL = '.claude/skills/tarasuf-example/SKILL.md';
function fails(edit, expected) {
  const problems = fixture(edit);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], expected);
}

void test('a well formed skill, rule, hook setting and map pass', () => {
  assert.deepEqual(fixture(), []);
});

void test('the repository setup passes', () => {
  assert.deepEqual(checkClaudeSetup(new URL('..', import.meta.url).pathname), []);
});

void test('skill frontmatter: name, fields, description and position', () => {
  fails((f) => (f[SKILL] = skill('tarasuf-other')), /name must equal the directory name/);
  fails((f) => (f[SKILL] = skill().replace('description:', 'allowed-tools: Bash\ndescription:')), /field not allowed here: allowed-tools/);
  fails((f) => (f[SKILL] = skill().replace('description:', 'hooks: {}\ndescription:')), /field not allowed here: hooks/);
  fails((f) => (f[SKILL] = skill('tarasuf-example', 'x'.repeat(1000))), /longer than 1024/);
  fails((f) => (f[SKILL] = skill('tarasuf-example', 'Use <script>.')), /must not contain < or >/);
  fails((f) => (f[SKILL] = skill().replace(/description: .*/, 'description: Too short.')), /description must say/);
  fails((f) => (f[SKILL] = `\n${skill()}`), /frontmatter must start on line 1/);
});

void test('a SKILL.md whose YAML does not parse is reported, not skipped', () => {
  const problems = fixture((f) => (f[SKILL] = skill().replace('name: tarasuf-example', 'name: [tarasuf-example')));
  assert.ok(problems.some((problem) => /not valid YAML/.test(problem)), problems.join('\n'));
});

void test('skill body: required sections, their order and length', () => {
  fails((f) => (f[SKILL] = skill('tarasuf-example', '', sections.replace('## Inputs', '## Sources'))), /missing section "Inputs"/);
  const swapped = sections.replace('## Steps', '## TMP').replace('## Inputs', '## Steps').replace('## TMP', '## Inputs');
  fails((f) => (f[SKILL] = skill('tarasuf-example', '', swapped)), /out of order/);
  fails((f) => (f[SKILL] = skill('tarasuf-example', '', sections + '\nline\n'.repeat(160))), /lines; keep SKILL.md under/);
});

void test('links: missing files and missing anchors fail, including Arabic headings', () => {
  fails((f) => (f[SKILL] = f[SKILL].replace('contract.ar.md#', 'missing.ar.md#')), /link target does not exist/);
  fails((f) => (f[SKILL] = f[SKILL].replace('#قراءة-ومعنى-المال', '#قراءة-المال')), /no heading for anchor/);
  fails((f) => (f['CLAUDE.md'] = '# Project\n\n[map](docs/reference/MISSING.md)\n'), /CLAUDE\.md: link target does not exist/);
});

void test('commands and paths named in skills must exist', () => {
  fails((f) => (f[SKILL] = f[SKILL].replace('`pnpm test`', '`pnpm test:missing`')), /pnpm script does not exist: test:missing/);
  fails((f) => (f[SKILL] = f[SKILL].replace('scripts/run.mjs', 'scripts/gone.mjs')), /path does not exist: scripts\/gone\.mjs/);
  assert.deepEqual(fixture((f) => (f[SKILL] = f[SKILL].replace('`pnpm test`', '`pnpm test:<domain>`'))), []);
});

void test('rules: path globs must match a file and only paths is allowed', () => {
  fails((f) => (f['.claude/rules/scripts.md'] = f['.claude/rules/scripts.md'].replace('scripts/**', 'nowhere/**')), /paths glob matches no file/);
  fails((f) => (f['.claude/rules/scripts.md'] = f['.claude/rules/scripts.md'].replace('paths:', 'model: x\npaths:')), /field not allowed in a rule: model/);
});

void test('settings: no permission or environment changes, reviewed hook events, existing scripts, a timeout', () => {
  const settings = (change) => (f) => {
    const value = JSON.parse(f['.claude/settings.json']);
    change(value);
    f['.claude/settings.json'] = JSON.stringify(value);
  };
  fails(settings((s) => (s.permissions = { allow: ['Bash(*)'] })), /setting not allowed .*: permissions/);
  fails(settings((s) => (s.env = { A: '1' })), /setting not allowed .*: env/);
  fails(settings((s) => (s.hooks.Stop = s.hooks.PreToolUse)), /hook event not reviewed: Stop/);
  fails(settings((s) => (s.hooks.PreToolUse[0].hooks[0].command = 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/none.mjs"')), /hook script does not exist/);
  fails(settings((s) => delete s.hooks.PreToolUse[0].hooks[0].timeout), /timeout of at most 30/);
  fails((f) => (f['.claude/settings.json'] = '{'), /not valid JSON/);
});

void test('hygiene: secrets and local machine paths are refused', () => {
  fails((f) => (f[SKILL] += '\nKey sk-ant-api03-abcdefghijklmnop\n'), /contains an Anthropic key/);
  fails((f) => (f[SKILL] += '\nSee /home/someone/private.xlsx\n'), /contains a local machine path/);
  fails((f) => (f['.claude/rules/scripts.md'] += '\nAccount SA0380000000608010167519\n'), /IBAN-shaped/);
});

void test('the map lists every skill and every named skill exists', () => {
  fails((f) => (f['docs/reference/SKILLS.ar.md'] = '# المهارات\n'), /does not list tarasuf-example/);
  fails((f) => (f['.claude/rules/scripts.md'] += '\nAlso `tarasuf-missing`.\n'), /names a skill that does not exist: tarasuf-missing/);
});

void test('helpers: GitHub heading slugs and globs', () => {
  assert.equal(slug('الجسر وExcel'), 'الجسر-وexcel');
  assert.equal(slug('DEV-63 طبقة النص: خريطة'), 'dev-63-طبقة-النص-خريطة');
  assert.ok(globRegExp('audit/**/frozen/**').test('audit/a/b/frozen/c.json'));
  assert.ok(!globRegExp('lib/reconciliation/visual-*.ts').test('lib/reconciliation/sub/visual-a.ts'));
  assert.ok(globRegExp('scripts/**').test('scripts/run.mjs'));
});

void test('the package script runs these tests and the check', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['test:claude-skills'], /check-claude-skills\.test\.mjs/);
  assert.match(pkg.scripts['test:claude-skills'], /node scripts\/check-claude-skills\.mjs/);
});
