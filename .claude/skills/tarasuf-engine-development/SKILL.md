---
name: tarasuf-engine-development
description: Discipline for changing Tarasuf reconciliation engines, readers, normalization, matching, sessions and exports under lib/reconciliation. Contract first, reading kept apart from proposal and acceptance, integer minor units and determinism, bounded search measured at real sizes, the smallest change with a test that failed first, and its effect on sources, review, session and Excel. Use when fixing or extending engine, reader or matching code, and when someone proposes a matching rule, tie-break, ordering, tolerance or shortcut for the engine, even as a quick question. تطوير محرك التسوية، إصلاح خلل في القراءة أو المطابقة، اقتراح قاعدة أو ترجيح في المحرك، تعديل lib/reconciliation. Not for designing test cases alone, interface-only work, or documentation-only edits.
---

# Tarasuf engine development

The most important rule comes first: a change starts from the contract it serves and ends with a test that failed for the right reason before the change.

## When to use

- A change to `lib/reconciliation/**` that alters what is read, normalized, matched, grouped, refused, saved, restored or exported.
- An engine defect report, or a new source family or domain rule.

## When not to use

- Designing cases or holdouts without a code change: `tarasuf-adversarial-testing`.
- Choosing and running gates or recording results: `tarasuf-regression-release`.
- Copy, layout or motion only: `tarasuf-product-workflow`. Documentation only: no skill needed.

## Inputs

- The engine file and its tests: `lib/reconciliation/<engine>.ts`, `tests/<engine>*.test.ts`, the domain proof or mutation script under `scripts/`.
- [Accounting contract](../../../docs/reference/ACCOUNTING-CONTRACT.ar.md), [architecture and integration rules](../../../docs/reference/ARCHITECTURE.ar.md), the domain plan in [the roadmap](../../../docs/roadmap/README.ar.md), and the matching CH entry in the [challenge register](../../../docs/reference/CHALLENGES.ar.md).
- The relevant incidents in [development lessons](../../../docs/reference/DEVELOPMENT-LESSONS.ar.md) and the [lessons index](../../../docs/reference/LESSONS-INDEX.ar.md).

## Steps

1. Fill the work card in the [delivery guide](../../../docs/reference/DELIVERY.ar.md#بطاقة-العمل). Classify the task as a proven defect, an evidence gap or a scope extension. A documented risk is not a confirmed defect until reproduced.
2. Name the contract and the accounting question it answers. Write the expected truth from the source (facts, oracle, independent check) before writing reader or engine code. If the contract does not decide the case, stop and escalate; do not decide it in code.
3. Keep the layers apart, as in the architecture code map: reading (`io.ts`, `pdf.ts`, `xlsx-display.ts`), interpretation (`header-view.ts`, `*-source.ts`, `*-native.ts`), engine decision, review decisions (`session.ts`, `*-lifecycle.ts`), export (`case-workbook.ts`, `export-text.ts`, `*-io.ts`). A later layer never repairs an earlier one silently, and a refused row keeps its place and reason.
4. Money is an integer in minor units, with the precision from `currency-precision.ts`; an unknown currency needs an explicit choice. Never sum floats or treat a formatted display string as an amount. Keep engine output deterministic: no clock, randomness or locale-dependent ordering; break ties by source position.
5. Respect search limits such as `INVOICE_GROUP_SEARCH_LIMITS` in `invoice-group-search.ts`. Exhausting a budget yields needs-review, never a guess. If reading or search cost changes, measure at representative sizes and state the sizes; the browser benchmark is `pnpm test:reliability:performance` and needs a build and Chromium.
6. Make the smallest change. Show the focused test failing on the base for an assertion, not an environment error (DEV-22), then passing. Add a mutant for any new guard to the domain mutation script; a kill needs an assertion failure.
7. Trace the effect through the worker protocol (`protocol.ts`, `worker.ts`, `source-boundary.ts`), session version and restore, Excel output, the assistant and interface copy. Changing reading or scope invalidates decisions that depended on it.
8. Hand selection, widening and recording of checks to `tarasuf-regression-release`.

## Outputs and evidence

- A diff limited to the named contract.
- The focused test: its name, the failing output on the base commit and the passing run after.
- Mutation result for any new guard, and measured sizes and times when reading or search changed.
- For each path in step 7: what was checked, with command and result, or "not run" and why.

## Acceptance, failure and escalation

- Accept when the focused tests, `pnpm typecheck` and `pnpm lint` pass and the gates chosen with `tarasuf-regression-release` pass on the recorded commit.
- Stop and escalate when the contract is silent, when a fix would need a frozen input, oracle, expected value or tolerance to change, when totals agree but membership is unproven, or when a resource budget is exceeded.
- Escalation states the case, the options, the evidence for each, and what stays unknown.

## Limits and related skills

- A passing change shows behaviour on the cases tested. It is not field accuracy and not a release.
- `tarasuf-accounting-review` judges whether results are accounting-correct; `tarasuf-source-evidence` covers reading and provenance; `tarasuf-adversarial-testing` designs cases; `tarasuf-regression-release` selects and records checks.

## Example

Report: a credit note was matched to the wrong one of two invoices with equal amounts. This is CH-02 (competing groups). Build a two-invoice synthetic case whose credit note cites the second invoice. Expect the cited member or needs-review, never the first by order. Show `node --experimental-strip-types --test tests/invoice-group-search.test.ts` failing on the base, fix, add a mutant, then check session replay and the Excel membership columns.
