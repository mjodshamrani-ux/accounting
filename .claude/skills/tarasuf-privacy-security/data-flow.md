# Data-flow map

States: **observed** means a check watched it and the check runs in CI; **read** means seen in code only; **planned** means a roadmap item, not active. Re-check a row before relying on it; this map was written at commit 16e7cd1.

## Product (static site in the user's browser)

| Flow | What moves | Where it goes | State and evidence |
| --- | --- | --- | --- |
| Opening a file | original bytes of CSV, XLSX, PDF or PNG | browser memory and a Worker | read: [worker](../../../lib/reconciliation/worker.ts), [protocol](../../../lib/reconciliation/protocol.ts) |
| Outbound requests | none expected | blocked by CSP `connect-src 'none'` | observed: `scripts/browser-test.mjs` records external requests and asserts none, and checks the CSP; runs in the CI browser job |
| CSP | page policy | built `index.html` | read: `scripts/harden-build.mjs` |
| Worker timings | durations only | stays in the page | read: comment and code in `worker.ts` |
| Local storage | interface language; column mapping templates (positions only) | the browser profile | read: `lib/i18n/language.ts`, [mapping-template](../../../lib/reconciliation/mapping-template.ts) |
| Saved session | sources, decisions, evidence | a file the user downloads | read: [session](../../../lib/reconciliation/session.ts); content is complete by design ([architecture](../../../docs/reference/ARCHITECTURE.ar.md)) |
| Excel export | results with source text and evidence | a file the user downloads | read: `case-workbook.ts`, `export-text.ts`; text kept as text: `tests/ar-export-text.test.ts` |
| OCR assets | Tesseract data from locked packages | served with the site | read: `scripts/prepare-ocr-assets.mjs` |
| Local AI | an English question, only when the browser reports its model API available | the browser's model API | read: [AI boundaries](../../../docs/reference/AI-AND-OCR.ar.md), `local-ai.ts`; no download, no provider |
| Analytics, telemetry, accounts | nothing | none | planned only: [privacy and commercial roadmap](../../../docs/roadmap/accounts-privacy-business.ar.md) |

## Repository, CI and publication

| Flow | What moves | Where it goes | State and evidence |
| --- | --- | --- | --- |
| Private outputs | run outputs, browser captures | `work/` (git-ignored) | read: `.gitignore` |
| Public source | tracked files | GitHub | observed: `node scripts/public-content-check.mjs --source-export` in CI; every file listed in `public-safe-manifest.json` |
| Published site | built files | GitHub Pages | observed: `--dist` check in CI before upload |
| CI logs and summaries | test output, synthetic figures | GitHub Actions | read: `.github/workflows/pages.yml` |

## Development environment and Claude Code

| Flow | What moves | Where it goes | State and evidence |
| --- | --- | --- | --- |
| Agent context | prompts, files the agent reads, command output | the model provider, as for any Claude Code session | read: Claude Code documentation; keep real financial files out of the session |
| Project skills, rules, hook | instructions and one local script | loaded by Claude Code in this repository | read: `.claude/`; the hook runs locally and sends nothing |
| Skill evaluations | synthetic prompts, model replies | the model provider, through `claude -p` | read: `audit/claude-skills/`; synthetic data only |
| skill-creator (account level) | its eval viewer loads Google Fonts; `run_eval.py` writes temporary files into `.claude/commands/` | external font host; the working tree | read: its scripts; not installed in this repository |
