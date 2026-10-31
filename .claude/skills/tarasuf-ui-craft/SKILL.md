---
name: tarasuf-ui-craft
description: Audit, refine, design and review Tarasuf interfaces while preserving its identity, Arabic/English access, financial evidence and existing contracts. Use for Tarasuf UI, tables, source uploads, scenes, motion and accessibility.
---

# Tarasuf UI Craft — Claude entry

Read and follow the [canonical skill](../../../.agents/skills/tarasuf-ui-craft/SKILL.md), then its task-relevant references. Resolve those references relative to their containing files. The canonical file owns all mode, design and verification rules; do not duplicate them here.

Pass the user's requested mode and scope through unchanged. Follow repository instructions and existing financial contracts.

The sections below only route to the canonical skill, because `pnpm test:claude-skills` requires them in every Claude skill. They add no rule of their own.

## When to use

- Interface work the canonical skill's description covers, in one of its four modes: Audit, Refine, Design or Review.

## When not to use

- Engine, reader, matching, session or export logic: `tarasuf-engine-development` and `tarasuf-source-evidence`. A UI task that needs such a change reports it as a separate task, as the canonical skill says.
- Journey and state agreement (upload, decisions, invalidation, export parity): `tarasuf-product-workflow`, alongside this skill when a change touches both.

## Inputs

- The canonical skill, the references its tables name for the work, and the repository instructions it requires first.

## Steps

1. Read the canonical skill and take the mode the user named; with none, choose as its mode table says.
2. Follow its bounded design loop and load only the references it names for the affected work.

## Outputs and evidence

- What the canonical mode table and its verification reference require for the chosen mode.

## Acceptance, failure and escalation

- The canonical verification reference decides each gate. Escalate as the canonical skill's decision boundaries say.

## Limits and related skills

- No authority beyond the canonical skill: no engine, contract, brand or service change. `tarasuf-regression-release` selects and records checks; `tarasuf-privacy-security` covers new assets, dependencies or network requests.

## Example

`/tarasuf-ui-craft Audit راجع شاشة نتائج البنك دون تعديل`: read the canonical skill, stay in Audit with no edits, load identity, verification, financial UX and the bank row of domains, and report evidence-linked findings.
