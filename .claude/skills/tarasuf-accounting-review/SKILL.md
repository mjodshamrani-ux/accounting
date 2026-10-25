---
name: tarasuf-accounting-review
description: Review whether a Tarasuf reconciliation result, rule or proposed engine change is accounting-correct. Checks parties, currencies, signs, dates and periods, references, the right group members (not just equal totals), no reuse of one movement or amount, partial allocation and remainder, rounding and tolerance as the contract states them, confirmed versus suggested versus needs-review, and a verifiable reason for every accepted result. Use when judging matches, groups, differences, tolerances or a rule that decides them. مراجعة محاسبية لنتيجة تسوية، صحة أعضاء المجموعة، الإشارة والعملة والفترة، السماحية. Not for code style, test selection, or interface copy.
---

# Tarasuf accounting review

Equal totals and full row coverage can hide wrong group membership. Review membership and evidence, then totals.

## When to use

- Before accepting an engine change that decides matches, groups, signs, periods, tolerances or statuses.
- When reviewing a reconciliation result, a holdout outcome, an expected-value file, or a proposed accounting rule.

## When not to use

- Writing the code change: `tarasuf-engine-development`. Designing cases: `tarasuf-adversarial-testing`.
- Reading and provenance questions (was the cell read correctly): `tarasuf-source-evidence`.

## Inputs

- The result or rule under review, with its source rows and the policy it claims.
- [Accounting contract](../../../docs/reference/ACCOUNTING-CONTRACT.ar.md), the domain plan in [the roadmap](../../../docs/roadmap/README.ar.md), and the matching CH entries in the [challenge register](../../../docs/reference/CHALLENGES.ar.md).
- The question list in [checklist.md](checklist.md).

## Steps

1. Separate the five questions in [the contract](../../../docs/reference/ACCOUNTING-CONTRACT.ar.md#افصل-الأسئلة-قبل-الإجابة): read completely, comparable scope, relation proven, difference explained, decision type. Answer each on its own.
2. Fix scope before comparing: legal entity, party, account, dimensions, currency and its precision, sign policy by role, the date that applies, the period and cut-off.
3. For each accepted group, list its members and the evidence for each member: reference, role, party, sign, date. Then ask whether another member set fits the same evidence. If one does and the evidence cannot separate them, the result is needs-review, however unique its total.
4. Check that no movement or amount is used twice and that allocations stay within capacity. Partial allocation and a remainder are allowed only where the domain contract supports them, with the remainder shown.
5. Check rounding and tolerance against the declared policy: its value, reason, scope and effect. A tolerance never corrects an amount or closes a difference by itself.
6. Classify every result as confirmed, suggestion or needs-review, with the rule and evidence that put it there. A confirmed result needs a reason another reviewer can verify from the sources.
7. Check the bridge: direction of the difference, opening, movement, closing and coverage; proven cause, hypothesis and unexplained remainder kept apart; no generated balancing entry.
8. Write findings with the case, the rows, the contract line, and a severity: wrong confirmation, wrong members, silent loss, unclear status, wording only.

## Outputs and evidence

- A findings list. Each finding names the source rows, the contract section and the expected status.
- For each confirmed group checked: its members, the evidence per member, and the alternatives considered.
- What the review could not decide, and the evidence that would decide it.

## Acceptance, failure and escalation

- Accept a result only when steps 1 to 7 hold for it. Zero wrong confirmations and zero wrong members outweigh any rate of completed matches.
- A wrong confirmation or wrong member is a blocking finding. Report it to the engine task; do not change expectations to agree with the engine.
- When the contract is silent or the evidence is ambiguous, escalate to the user with the competing readings. Do not choose one.

## Limits and related skills

- This review is an engineering check by a model against the project contract. It is not a professional accounting opinion, an audit, or independent assurance, and must not be presented as one.
- It does not prove field accuracy. Use `tarasuf-adversarial-testing` to turn findings into cases and `tarasuf-regression-release` to run them.

## Example

Two invoices of 1,150.00 and one payment of 1,150.00 cite "INV-2207". The engine confirms the payment against INV-2206, the first by date. The totals agree and every row is covered. Review: the reference names the second invoice, so the members are wrong. Classify it as a wrong confirmation; the expected status is a match with INV-2207, or needs-review if the reference cannot be read.
