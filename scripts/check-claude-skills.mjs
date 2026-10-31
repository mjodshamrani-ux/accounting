// Structural check of the Claude Code setup in .claude/: project skills,
// path-scoped rules, the hook settings, and the skills map that documents
// them. It checks form and references, not whether a skill helps: that needs
// a behavioural evaluation (audit/claude-skills).
//
//   node scripts/check-claude-skills.mjs [--root <dir>]
//
// Each problem names the file and what is wrong. Exit 1 when any is found.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

export const SKILL_SECTIONS = [
  'When to use',
  'When not to use',
  'Inputs',
  'Steps',
  'Outputs and evidence',
  'Acceptance, failure and escalation',
  'Limits and related skills',
  'Example',
];
// Fields that would widen tools, run code or change the model when a skill
// loads are left out on purpose; adding one means reviewing this list.
const SKILL_FIELDS = new Set([
  'name',
  'description',
  'when_to_use',
  'disable-model-invocation',
  'user-invocable',
  'argument-hint',
  'paths',
]);
const HOOK_EVENTS = new Set(['PreToolUse']);
const SETTINGS_KEYS = new Set(['hooks']);
const MAP = 'docs/reference/SKILLS.ar.md';
const LESSONS = 'docs/reference/LESSONS-INDEX.ar.md';
const MAX_SKILL_LINES = 150;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'work', 'dist']);
// Secrets and machine paths must not reach skills, rules or their map.
const FORBIDDEN = [
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/, 'an Anthropic key'],
  [/\b(?:ghp|gho|ghs)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/, 'a GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\bSA\d{22}\b/, 'an IBAN-shaped number'],
  [/(?:^|[\s`'"(])(?:\/home\/|\/root\/|\/tmp\/|[A-Z]:\\Users\\)/m, 'a local machine path'],
];

const toPosix = (path) => path.split(sep).join('/');
const read = (file) => readFileSync(file, 'utf8');

export function slug(heading) {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function anchors(text) {
  const seen = new Map();
  const result = new Set();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = !fenced && /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const base = slug(match[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  }
  return result;
}

function frontmatter(text) {
  if (!text.startsWith('---\n')) return { body: text };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { error: 'frontmatter is not closed', body: text };
  try {
    const data = yaml.load(text.slice(4, end));
    return { data, body: text.slice(end + 4) };
  } catch (error) {
    return { error: `frontmatter is not valid YAML: ${error.reason ?? error.message}`, body: text };
  }
}

function trackedFiles(root) {
  try {
    const listed = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const files = listed.split('\0').filter(Boolean);
    if (files.length) return files;
  } catch {
    // Not a Git checkout: walk the directory instead.
  }
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(toPosix(relative(root, full)));
    }
  };
  walk(root);
  return files;
}

export function globRegExp(glob) {
  let pattern = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        pattern += '(?:.*/)?';
      } else pattern += '.*';
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`);
}

function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(full));
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

function checkLinks(root, file, text, problems) {
  const where = toPosix(relative(root, file));
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const plain = line.replace(/`[^`]*`/g, '');
    for (const [, target] of plain.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(?:https?:|mailto:)/.test(target)) continue;
      const [path, anchor] = target.split('#');
      const destination = path ? resolve(dirname(file), decodeURI(path)) : file;
      if (!existsSync(destination)) {
        problems.push(`${where}: link target does not exist: ${target}`);
        continue;
      }
      if (anchor && destination.endsWith('.md')) {
        if (!anchors(read(destination)).has(decodeURIComponent(anchor).toLowerCase()))
          problems.push(`${where}: no heading for anchor #${anchor} in ${path || 'this file'}`);
      }
    }
  }
}

function checkCommands(root, file, text, scripts, tracked, problems) {
  const where = toPosix(relative(root, file));
  for (const [, code] of text.matchAll(/`([^`\n]+)`/g)) {
    for (const [, name] of code.matchAll(/\bpnpm\s+(?:run\s+)?([^\s`]+)/g)) {
      if (name.includes('<') || ['exec', 'install', 'dlx'].includes(name)) continue;
      if (!(name in scripts)) problems.push(`${where}: pnpm script does not exist: ${name}`);
    }
    for (const [path] of code.matchAll(
      /(?<![\w./-])(?:scripts|audit|tests|lib|components|app|docs|styles|public)\/[\w./*@-]*[\w*]/g,
    )) {
      if (path.includes('<')) continue;
      const file = globRegExp(path);
      const directory = globRegExp(`${path}/**`);
      const exists =
        existsSync(resolve(root, path)) ||
        tracked.some((tracked) => file.test(tracked) || directory.test(tracked));
      if (!exists) problems.push(`${where}: path does not exist: ${path}`);
    }
  }
}

function checkHygiene(root, file, text, problems) {
  for (const [pattern, what] of FORBIDDEN)
    if (pattern.test(text)) problems.push(`${toPosix(relative(root, file))}: contains ${what}`);
}

export function checkClaudeSetup(root) {
  const problems = [];
  const claude = join(root, '.claude');
  const scripts = JSON.parse(read(join(root, 'package.json'))).scripts ?? {};
  const tracked = trackedFiles(root);
  const skillsDir = join(claude, 'skills');
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir).filter((name) => statSync(join(skillsDir, name)).isDirectory())
    : [];
  if (!skills.length) problems.push('.claude/skills: no skills found');

  for (const name of skills) {
    const file = join(skillsDir, name, 'SKILL.md');
    const where = `.claude/skills/${name}/SKILL.md`;
    if (!existsSync(file)) {
      problems.push(`${where}: missing`);
      continue;
    }
    const text = read(file);
    if (!text.startsWith('---\n')) {
      problems.push(`${where}: frontmatter must start on line 1`);
      continue;
    }
    const { data, error, body } = frontmatter(text);
    if (error) problems.push(`${where}: ${error}`);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      problems.push(`${where}: frontmatter is not a mapping`);
      continue;
    }
    for (const key of Object.keys(data))
      if (!SKILL_FIELDS.has(key)) problems.push(`${where}: field not allowed here: ${key}`);
    if (data.name !== name) problems.push(`${where}: name must equal the directory name ${name}`);
    if (typeof data.name !== 'string' || !/^tarasuf(?:-[a-z0-9]+)+$/.test(data.name) || data.name.length > 64)
      problems.push(`${where}: name must be kebab-case, start with tarasuf- and be at most 64 characters`);
    const description = data.description;
    if (typeof description !== 'string' || description.trim().length < 80)
      problems.push(`${where}: description must say what the skill does and when to use it`);
    else {
      if (description.length > 1024) problems.push(`${where}: description is longer than 1024 characters`);
      if (/[<>]/.test(description)) problems.push(`${where}: description must not contain < or >`);
    }
    const lines = text.split('\n').length;
    if (lines > MAX_SKILL_LINES)
      problems.push(`${where}: ${lines} lines; keep SKILL.md under ${MAX_SKILL_LINES} and move detail to supporting files`);
    const headings = [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim());
    let at = -1;
    for (const section of SKILL_SECTIONS) {
      const index = headings.indexOf(section);
      if (index < 0) problems.push(`${where}: missing section "${section}"`);
      else if (index < at) problems.push(`${where}: section "${section}" is out of order`);
      else at = index;
    }
  }

  const rulesDir = join(claude, 'rules');
  for (const file of markdownFiles(rulesDir)) {
    const where = toPosix(relative(root, file));
    const { data, error } = frontmatter(read(file));
    if (error) problems.push(`${where}: ${error}`);
    if (data === undefined || data === null) continue;
    if (typeof data !== 'object' || Array.isArray(data)) {
      problems.push(`${where}: frontmatter is not a mapping`);
      continue;
    }
    for (const key of Object.keys(data))
      if (key !== 'paths') problems.push(`${where}: field not allowed in a rule: ${key}`);
    if ('paths' in data) {
      if (!Array.isArray(data.paths) || !data.paths.length || data.paths.some((path) => typeof path !== 'string'))
        problems.push(`${where}: paths must be a non-empty list of globs`);
      else
        for (const glob of data.paths) {
          const expression = globRegExp(glob);
          if (!tracked.some((path) => expression.test(path)))
            problems.push(`${where}: paths glob matches no file: ${glob}`);
        }
    }
  }

  const settingsFile = join(claude, 'settings.json');
  if (existsSync(settingsFile)) {
    let settings;
    try {
      settings = JSON.parse(read(settingsFile));
    } catch (error) {
      problems.push(`.claude/settings.json: not valid JSON: ${error.message}`);
    }
    if (settings) {
      for (const key of Object.keys(settings))
        if (!SETTINGS_KEYS.has(key))
          problems.push(`.claude/settings.json: setting not allowed in the shared project file: ${key}`);
      for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
        if (!HOOK_EVENTS.has(event)) problems.push(`.claude/settings.json: hook event not reviewed: ${event}`);
        for (const group of Array.isArray(groups) ? groups : [])
          for (const hook of group.hooks ?? []) {
            if (hook.type !== 'command') problems.push(`.claude/settings.json: hook type not reviewed: ${hook.type}`);
            if (!(hook.timeout > 0 && hook.timeout <= 30))
              problems.push(`.claude/settings.json: hook needs a timeout of at most 30 seconds`);
            const script = /\$\{CLAUDE_PROJECT_DIR\}\/([^"' ]+)/.exec(hook.command ?? '')?.[1];
            if (!script) problems.push(`.claude/settings.json: hook command must run a script under the project`);
            else if (!existsSync(join(root, script)))
              problems.push(`.claude/settings.json: hook script does not exist: ${script}`);
          }
      }
    }
  }

  const documents = [
    ...skills.flatMap((name) => markdownFiles(join(skillsDir, name))),
    ...markdownFiles(rulesDir),
    ...[MAP, LESSONS, 'CLAUDE.md'].map((path) => join(root, path)).filter(existsSync),
  ];
  const known = new Set(skills);
  for (const file of documents) {
    const text = read(file);
    checkLinks(root, file, text, problems);
    checkHygiene(root, file, text, problems);
    if (file.startsWith(claude)) checkCommands(root, file, text, scripts, tracked, problems);
    for (const [, name] of text.matchAll(/`(tarasuf-[a-z0-9-]+)`/g))
      if (!known.has(name)) problems.push(`${toPosix(relative(root, file))}: names a skill that does not exist: ${name}`);
  }
  if (!existsSync(join(root, MAP))) problems.push(`${MAP}: missing`);
  else {
    const map = read(join(root, MAP));
    for (const name of skills)
      if (!map.includes(`\`${name}\``)) problems.push(`${MAP}: does not list ${name}`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--root');
  const root = resolve(at > 0 ? process.argv[at + 1] : fileURLToPath(new URL('..', import.meta.url)));
  const problems = checkClaudeSetup(root);
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exit(1);
  console.error('Claude Code skills, rules, hook settings and skills map: structure and references checked.');
}
