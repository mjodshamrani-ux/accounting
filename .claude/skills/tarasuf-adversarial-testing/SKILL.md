---
name: tarasuf-adversarial-testing
description: Design Tarasuf test cases that can expose a wrong match, wrong member, silent misread or lost row. Covers duplicates, similar or misleading references, equal amounts across parties, split payments, credit notes and reversals, currency, rounding, sign and date differences, corrupt or oversized inputs, property and metamorphic checks, expected results built independently of the engine, seeds and minimized failing cases, development versus holdout splits, and mutation testing with surviving-mutant analysis. Use when writing or reviewing tests, fixtures, oracles, holdouts or mutation gates. اختبارات عدائية، حالات صعبة، holdout، أوراكل مستقل، طفرات. Not for running the existing suite or choosing which gates to run.
---

# Tarasuf adversarial testing

A test is worth adding only if a plausible wrong engine would fail it. More seeds of one layout do not establish generalization.

## When to use

- Writing new tests, fixtures, oracles, holdouts or mutants for an engine, reader or export.
- Reviewing whether an existing test can fail for the defect it claims to guard.

## When not to use

- Selecting and running existing checks, or recording results: `tarasuf-regression-release`.
- Deciding the accounting answer itself: `tarasuf-accounting-review` first, then encode it here.

## Inputs

- [Quality and test design](../../../docs/reference/QUALITY.ar.md), the [source-diversity protocol](../../../docs/roadmap/source-diversity.ar.md), and the acceptance proposals in the [challenge register](../../../docs/reference/CHALLENGES.ar.md).
- Existing machinery: `audit/hard-cases/` (scenarios, gate, triage, `minimize.mjs`), `audit/reliability/manifest.mjs` (splits), domain oracles under `audit/<domain>/`, mutation scripts `scripts/test-*-mutations.mjs`.
- The case families in [catalog.md](catalog.md).

## Steps

1. Start from the defect class, not the generator. For each rule write the correct case, a near case that differs in one decisive piece of evidence, a competitor with the same amount, and limits before, at and after any cap.
2. Build the expected result without the engine: from the story facts, or an oracle in another language or library. Expect only what the files let a reader prove; a relation known only to the generator is needs-review (DEV-17).
3. Test the verifier: one correct file passes, and files with one changed member, sign, text or dropped row fail. A verifier that only accepts is not evidence (DEV-20, DEV-21).
4. Add metamorphic pairs: changes that must keep facts and members (row or column order without meaning, file name, page break, repeated header) and changes that must block the result (currency, account, sign, member, cut-off, source), even when the net stays equal.
5. Vary structure, producer and semantics before volume, following the protocol's diversity matrix. Record seed, generator version, verifier version and contract.
6. Keep splits apart. Seal a holdout (input manifest, expected, verification) before any product run, and never run the product on a draft (DEV-61). A holdout seen while fixing becomes regression; a new independent claim needs new cases.
7. Save each failing case, minimized while the same verdict holds (`audit/hard-cases/minimize.mjs` shows the method). Name each known failure in the triage register with its class; false approvals, wrong members, silent misreads, lost rows and crashes are never excused.
8. For each new guard add a mutant that removes or weakens it. A kill needs an assertion failure, not an environment error (DEV-22). For a surviving mutant, write whether it is equivalent or a missing test, and add the test when it is missing.

## Outputs and evidence

- Cases with their expected results, how each expectation was derived, and the split each belongs to.
- Verifier self-test results (pass on correct, fail on each planted fault).
- Seeds, versions, minimized failing cases, and mutation results with notes on survivors.

## Acceptance, failure and escalation

- A case is accepted when it fails on a plausible wrong implementation and its expectation is provable from the inputs.
- Never reclassify a hard positive, change an expected value or relax a gate to raise a score. A fixture defect is fixed with independent evidence, the old version kept, and before/after re-measured on the same corrected reference.
- Escalate when the right expectation depends on an accounting choice the contract does not make.

## Limits and related skills

- Synthetic cases expose defects; they are not field accuracy or model training. Cases this assistant wrote and has seen are not a blind evaluation; say so.
- `tarasuf-accounting-review` decides the expected answer; `tarasuf-source-evidence` designs reading faults; `tarasuf-regression-release` runs and records.

## Example

Rule: a payment cites one of two equal invoices. Cases: the right citation (match), the citation swapped (match moves), the citation missing (needs-review), a third invoice of another party with the same amount (no match), and rows reordered (same members). The oracle reads citations with its own parser. A mutant that drops the reference check must fail the swapped case.
