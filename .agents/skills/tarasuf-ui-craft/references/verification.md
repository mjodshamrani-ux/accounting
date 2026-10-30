# Evidence and acceptance

Follow current [delivery](../../../../docs/reference/DELIVERY.ar.md), [quality](../../../../docs/reference/QUALITY.ar.md) and [development lessons](../../../../docs/reference/DEVELOPMENT-LESSONS.ar.md). Scope checks to the change, keep required CI gates intact, and distinguish source inspection from executed behavior. Do not rerun unrelated full financial suites for a documentation-only change or borrow old successful results.

## Evidence record

For each finding record: mode, file/component, language, viewport/data/state, observed behavior, consequence, severity, evidence type (reproduced/source risk/hypothesis), proposed action and preservation constraint. Baseline/candidate captures use the same inputs and state. Keep real financial files, raw proofs, screenshots and local paths private; publish synthetic examples only.

| Affected surface | Checks and existing entry points |
| --- | --- |
| Brand/scene/typography | `pnpm build`, `pnpm test:browser`; [brand cases](../../../../scripts/brand-browser-cases.mjs) invoked by [browser runner](../../../../scripts/browser-test.mjs), not standalone success from importing the module |
| Shared upload/type/layout | `pnpm test:browser:unified-workspace`, `pnpm test:browser:reconciliation-entry`, `pnpm test:browser:domain-navigation`; all twelve roles and state retention |
| Financial results or evidence | Affected domain tests and browser runner from [package](../../../../package.json); exact amounts/members, ambiguity, incomplete/rejected state, source link and actual decisions |
| Session/export interaction | Existing lifecycle and independent export checks for affected domain; AR/EN, values/signs/precision, warnings, members and source coordinates |
| Dependencies/asset changes | Bundle/runtime comparison and network inspection; no new external processing/fonts/telemetry |
| Skill/docs only | Skill validator, basic frontmatter validator if available, links, scope diff and source publication guard; do not claim app rendering tested |

Browser runners need the current build and installed browser per delivery guide. The geometry tests sample motion; synthetic drag does not prove native OS drops in every browser. State these limits.

## Required acceptance by relevant change

- **Visual:** intact original font/mark/art, useful hierarchy, coherent spacing/alignment, legible dense table/signs, no cropped diacritics, intended contrast and full cycle without clipping.
- **Interaction:** keyboard reachability, visible focus, busy/disabled/errors, cancellation, dialog return, source replacement, no double execution or adoption of stale response.
- **Financial:** proposal/incomplete/manual/rejected states cannot look certified; differences/material warnings remain; exact currency precision and evidence members; no value made zero by display convenience.
- **Continuity:** filters/position retained through evidence return; switch type/language and restore do not erase or certify work; actual engine source order unchanged.
- **Accessibility:** AR/EN, 320/390/1440, zoom/reflow, contrast, labels, main/h1, keyboard and reduced motion. Screen reader/device claims require actual runs.
- **Performance/privacy:** measured representative density if altered; no new calls containing financial content; no heavy effects without justified cost.

Use positive, incomplete and failure fixtures. Useful probes: three-decimal currency difference; long mixed reference with leading zeros; same total but different members; related invalid row; no filter matches; inactive domain with work; canceled worker with late result; restored stale policy; export after virtualization. Inspect current safeguards first rather than assume each risk is an existing defect.

## Decision rubric

Mark each relevant gate Pass / Fail / Unverified / Not applicable, with reason/evidence. P0 or P1 introduced by a candidate prevents acceptance. A design proposal may be valuable while implementation remains unverified; say so. Audit/Review must not edit without task authorization. Cosmetic improvement does not justify a new contract or hidden warning.

For skill changes run:

```sh
python3 .agents/skills/tarasuf-ui-craft/scripts/validate.py --self-test
node --test scripts/public-content-check.test.mjs
node scripts/public-content-check.mjs --source
node scripts/public-content-check.mjs --source-export
```

The last command uses tracked files; stage the reviewed candidate first. Update only explicitly reviewed source manifest records, preserving distribution records. Preserve licenses verbatim even if an upstream blank line triggers whitespace checking. The validator checks structure/links and selected bindings, not accounting semantics or design quality.

Report outcome first, then scope, preserved qualities, unresolved severity, commands/results, evidence limits and delivery status. No universal accuracy, full WCAG compliance, performance or deployment claim from a static audit. No main merge or publication unless separately authorized.
