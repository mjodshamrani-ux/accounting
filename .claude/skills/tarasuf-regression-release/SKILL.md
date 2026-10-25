---
name: tarasuf-regression-release
description: Choose, run and record Tarasuf checks for a change. Selects tests by changed files, risk and contracts; runs focused checks first, then wider and cross-engine ones; compares performance when it matters; records command, result and tested commit; separates failures that existed before from new ones; never relaxes oracles, expectations or financial limits to pass, and never reports a check that could not run as passed. Use before committing, before asking for review, or when CI fails. اختيار الاختبارات وتشغيلها وتسجيل النتائج، الانحدار، فشل CI. Grants no permission to push, merge, deploy or release.
---

# Tarasuf regression and release checks

Record what ran, on which commit, with what result. "Not run" is a valid result; "passed" without a run is not.

## When to use

- Before a commit, a push the user authorized, or a review request.
- When CI fails, or a check fails locally and you need to know whether the change caused it.

## When not to use

- Designing new cases: `tarasuf-adversarial-testing`. Making the code change: `tarasuf-engine-development`.

## Inputs

- `git diff --name-only <base>...HEAD` and `git status --short`.
- The selection table in [selection.md](selection.md), the [delivery guide](../../../docs/reference/DELIVERY.ar.md#الاختبارات), and `.github/workflows/pages.yml` for what CI runs.

## Steps

1. Record the base and head commits and whether the tree is clean. Never test or report a different commit than the one you name.
2. Map each changed path to its checks with [selection.md](selection.md). Add checks for every contract the change touches (session, worker, export, interface), not only for the edited file.
3. Run focused checks first. Widen only when they pass, in the order the table gives. Do not run every gate after every edit, and do not loop re-running a failing check.
4. For a failure, decide whether it existed before: run the same command on the base commit in a separate worktree. Report preexisting and new failures separately.
5. A test that fails for an environment reason (missing browser, network, tool) is "not run", with the reason. It is never a pass and never a mutation kill.
6. If reading or search cost changed, compare timings on the same inputs at base and head, and state the sizes.
7. Do not edit frozen inputs, oracles, expected values, mutation gates, recorded results or tolerances to get green. If one is wrong, stop and escalate with independent evidence.
8. For new or changed tracked files, update their `public-safe-manifest.json` entries one by one, and refresh distribution entries after a build when `lib/` or the app changed. Run the public-content guard on a clean export.
9. Report in the format below. After an authorized push, read CI on that exact head before saying it passed.

## Outputs and evidence

A results table: command, commit, result (passed, failed, not run), and for failures whether they are new or preexisting, with the first failing assertion.

## Acceptance, failure and escalation

- Accept the change for review when all selected checks pass on the recorded commit, or the user accepts named "not run" items.
- A new failure blocks. A preexisting failure is reported with its evidence and left for its own task unless it is in scope.
- Escalate when a check can only pass by changing recorded evidence, or when CI and local results disagree.

## Limits and related skills

- Invoking this skill gives no permission to push, merge, deploy or release. Those follow the user's standing authorization and the [delivery guide](../../../docs/reference/DELIVERY.ar.md#إغلاق-المهمة).
- Local runs show behaviour in one environment; CI on the pushed head is the reference.

## Example

A change to `lib/reconciliation/xlsx-namespaces.ts`. Focused: `node --experimental-strip-types --test tests/xlsx-namespaces.test.ts`. Then `pnpm typecheck`, `pnpm lint`, `pnpm test`, the XLSX mutants with `node scripts/test-mutations.mjs --filter <name>`, the bank holdouts that read workbooks, and `pnpm build` with the distribution check. Report each with the commit; mark the browser holdout "not run" if no browser is available.
