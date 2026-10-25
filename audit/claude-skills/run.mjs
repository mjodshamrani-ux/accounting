// Behavioural evaluation of the project skills, rules and hook.
//
//   node audit/claude-skills/run.mjs --with <checkout> [--without <checkout>]
//     [--cases audit/claude-skills/cases.json] [--only id,id] [--out file.json]
//     [--concurrency 3] [--votes 3]
//
// Each case runs as a headless `claude -p` session in the named checkout:
// 'with' holds .claude/ and the CLAUDE.md that imports AGENTS.md, 'without'
// the commit before them. Give throwaway Git worktrees, never the working
// copy: a run may edit files there (the hook case does by design). Runs use
// the person's own Claude Code credentials and count against their usage.
//
// A case records which skills the session invoked through the Skill tool,
// which SKILL.md files it read, permission denials, cost and the final reply.
// Rubrics are judged by separate `claude -p` calls with no tools, by majority
// of --votes. Prompts and data are synthetic; the output holds no local paths.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    with: { type: 'string' },
    without: { type: 'string' },
    cases: { type: 'string', default: 'audit/claude-skills/cases.json' },
    only: { type: 'string', default: '' },
    out: { type: 'string', default: '' },
    concurrency: { type: 'string', default: '3' },
    votes: { type: 'string', default: '3' },
    help: { type: 'boolean', default: false },
  },
});
if (args.help || !args.with) {
  console.error(readFileSync(new URL(import.meta.url), 'utf8').split('\nimport ')[0]);
  process.exit(args.help ? 0 : 2);
}

const DEFAULT_TOOLS = 'Read Grep Glob Skill';
const DENIED = 'Bash Edit Write MultiEdit NotebookEdit WebFetch WebSearch Agent';
// The child is a separate session: it must not inherit this session's
// identity or extra instruction directories.
const env = { ...process.env };
for (const key of [
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_REMOTE_SESSION_ID',
  'CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD',
  'CLAUDE_ADDITIONAL_DIRECTORIES',
])
  delete env[key];

function claude(cwd, argv, timeoutMs) {
  return new Promise((done) => {
    const child = spawn('claude', argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      done({ code, signal, out, err });
    });
  });
}

const sha = (file) => (existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null);

async function session(testCase, arm, dir) {
  const argv = ['-p', testCase.prompt, '--output-format', 'stream-json', '--verbose', '--no-session-persistence'];
  argv.push('--max-turns', String(testCase.maxTurns ?? 30));
  if (testCase.tools !== undefined) argv.push('--tools', testCase.tools);
  else {
    argv.push('--allowedTools', testCase.allowedTools ?? DEFAULT_TOOLS);
    const allowed = new Set((testCase.allowedTools ?? DEFAULT_TOOLS).split(' '));
    argv.push('--disallowedTools', DENIED.split(' ').filter((tool) => !allowed.has(tool)).join(' '));
  }
  const watched = testCase.unchangedFile && join(dir, testCase.unchangedFile);
  const before = watched && sha(watched);
  const started = Date.now();
  const run = await claude(dir, argv, (testCase.timeoutSeconds ?? 600) * 1000);
  const record = {
    id: testCase.id,
    skill: testCase.skill,
    kind: testCase.kind,
    arm,
    seconds: Math.round((Date.now() - started) / 1000),
    exit: run.signal ? `signal ${run.signal}` : run.code,
    projectSkillsLoaded: 0,
    invoked: [],
    readSkillFiles: [],
    toolCalls: 0,
    denials: [],
    final: '',
    costUsd: null,
    turns: null,
    resultSubtype: null,
  };
  for (const line of run.out.split('\n')) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'system' && event.subtype === 'init')
      record.projectSkillsLoaded = (event.skills ?? []).filter((name) => String(name).startsWith('tarasuf-')).length;
    if (event.type === 'assistant')
      for (const block of event.message?.content ?? []) {
        if (block.type !== 'tool_use') continue;
        record.toolCalls++;
        if (block.name === 'Skill') record.invoked.push(String(block.input?.skill ?? block.input?.command ?? ''));
        const path = String(block.input?.file_path ?? '');
        const match = /\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(path);
        if (block.name === 'Read' && match) record.readSkillFiles.push(match[1]);
      }
    if (event.type === 'result') {
      record.final = String(event.result ?? '');
      record.costUsd = event.total_cost_usd ?? null;
      record.turns = event.num_turns ?? null;
      record.resultSubtype = event.subtype ?? null;
      record.denials = (event.permission_denials ?? []).map((denial) => ({
        tool: denial.tool_name,
        target: String(denial.tool_input?.file_path ?? '').replace(`${dir}/`, ''),
      }));
    }
  }
  // Keep machine paths out of the record.
  record.final = record.final.replaceAll(dir, '<checkout>');
  if (!record.final && run.err) record.error = run.err.slice(-600).replaceAll(dir, '<checkout>');
  if (watched) record.fileUnchanged = sha(watched) === before;
  return record;
}

async function judge(rubric, reply, votes) {
  const scratch = mkdtempSync(join(tmpdir(), 'skill-judge-'));
  try {
    const prompt = [
      'You grade one reply against a rubric. Judge substance, not formatting or language; the reply may be in Arabic or English.',
      'Answer with one line of JSON only: {"verdict":"PASS"} or {"verdict":"FAIL","reason":"<short reason>"}.',
      '',
      `RUBRIC:\n${rubric}`,
      '',
      `REPLY:\n${reply.slice(0, 12000)}`,
    ].join('\n');
    const results = [];
    for (let vote = 0; vote < votes; vote++) {
      const run = await claude(scratch, ['-p', prompt, '--tools', '', '--max-turns', '1', '--no-session-persistence', '--output-format', 'json'], 180000);
      let verdict = 'ERROR';
      let reason = '';
      try {
        const text = String(JSON.parse(run.out).result ?? '');
        const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
        verdict = parsed.verdict === 'PASS' ? 'PASS' : 'FAIL';
        reason = parsed.reason ?? '';
      } catch {
        reason = 'unparsed judge reply';
      }
      results.push({ verdict, reason });
    }
    const passes = results.filter((result) => result.verdict === 'PASS').length;
    return { pass: passes * 2 > votes, passes, votes, reasons: results.map((result) => result.reason).filter(Boolean) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function grade(testCase, record) {
  const checks = {};
  if (testCase.expectSkills)
    checks.trigger = { pass: testCase.expectSkills.every((name) => record.invoked.includes(name)), expected: testCase.expectSkills };
  if (testCase.forbidSkills)
    checks.noTrigger = { pass: !testCase.forbidSkills.some((name) => record.invoked.includes(name)), forbidden: testCase.forbidSkills };
  if (testCase.mustMatch) checks.mustMatch = { pass: record.final.includes(testCase.mustMatch), pattern: testCase.mustMatch };
  if (testCase.unchangedFile) {
    checks.fileUnchanged = { pass: record.fileUnchanged === true };
    checks.hookDenied = { pass: record.denials.some((denial) => denial.tool === 'Edit') };
  }
  return checks;
}

const suite = JSON.parse(readFileSync(args.cases, 'utf8'));
const only = new Set(args.only.split(',').filter(Boolean));
const dirs = { with: resolve(args.with), without: args.without && resolve(args.without) };
const jobs = [];
for (const testCase of suite.cases) {
  if (only.size && !only.has(testCase.id)) continue;
  for (const arm of testCase.arms) if (dirs[arm]) jobs.push({ testCase, arm });
}

const records = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const { testCase, arm } = jobs[next++];
    const record = await session(testCase, arm, dirs[arm]);
    record.checks = grade(testCase, record);
    if (testCase.rubric && record.final)
      record.checks.rubric = await judge(testCase.rubric, record.final, Number(args.votes));
    else if (testCase.rubric) record.checks.rubric = { pass: false, reason: 'no final reply' };
    console.error(
      `${testCase.id} [${arm}] invoked=${record.invoked.join(',') || '-'} ` +
        Object.entries(record.checks).map(([name, check]) => `${name}=${check.pass ? 'pass' : 'FAIL'}`).join(' '),
    );
    records.push(record);
  }
}
await Promise.all(Array.from({ length: Number(args.concurrency) }, worker));
records.sort((a, b) => jobs.findIndex((job) => job.testCase.id === a.id && job.arm === a.arm) - jobs.findIndex((job) => job.testCase.id === b.id && job.arm === b.arm));

const output = {
  harness: 'audit/claude-skills/run.mjs',
  cases: args.cases,
  votes: Number(args.votes),
  arms: Object.fromEntries(Object.entries(dirs).filter(([, dir]) => dir).map(([arm]) => [arm, true])),
  totalCostUsd: Number(records.reduce((sum, record) => sum + (record.costUsd ?? 0), 0).toFixed(4)),
  records,
};
const text = `${JSON.stringify(output, null, 2)}\n`;
if (args.out) writeFileSync(args.out, text);
else process.stdout.write(text);
