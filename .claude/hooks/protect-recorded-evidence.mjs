// Claude Code PreToolUse hook: stop the agent's own file-edit tools from
// rewriting recorded evidence. It refuses edits to existing files under an
// audit `frozen/` directory and to the byte-exact originals listed in
// scripts/lint-frozen-originals.json, and asks the person before an existing
// file under an audit `results/` or `oracle/` directory changes. New files
// pass: sealing a new holdout or recording a new run writes new files.
//
// Limits: it sees only Edit, Write, MultiEdit and NotebookEdit calls, not
// shell commands, and it fails open on input it cannot read. CI (seal tests,
// lint originals, the public-content guard) is the enforcement.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const decide = (permissionDecision, permissionDecisionReason) => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision,
        permissionDecisionReason,
      },
    }),
  );
};

export function judge(input, root) {
  const target = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
  if (typeof target !== 'string' || !target) return undefined;
  const absolute = isAbsolute(target) ? target : resolve(input.cwd ?? root, target);
  const path = relative(root, absolute).split(sep).join('/');
  if (!path || path === '..' || path.startsWith('../') || isAbsolute(path))
    return undefined;
  if (!existsSync(absolute)) return undefined;
  const parts = path.split('/');
  const inAudit = (name) => parts[0] === 'audit' && parts.slice(1, -1).includes(name);
  let frozenOriginals = [];
  try {
    frozenOriginals = JSON.parse(
      readFileSync(resolve(root, 'scripts/lint-frozen-originals.json'), 'utf8'),
    ).files.map((file) => file.path);
  } catch {
    // Without the list, the directory rules below still apply.
  }
  if (inAudit('frozen') || frozenOriginals.includes(path))
    return [
      'deny',
      `${path} is sealed evidence. Do not edit it; a new holdout or run gets new files (.claude/rules/recorded-evidence.md).`,
    ];
  if (inAudit('results') || inAudit('oracle'))
    return [
      'ask',
      `${path} is a recorded result or an oracle. Change it only with a documented reason, never to make a check pass.`,
    ];
  return undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const decision = judge(input, resolve(root));
  if (decision) decide(...decision);
}
