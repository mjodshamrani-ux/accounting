---
name: tarasuf-product-workflow
description: Check a Tarasuf user journey end to end in the interface. Covers opening files and import errors, matching, review, user decisions and export; that the screen, the engine result and the source agree; a clear needs-review state; no lost decisions and no stale results after a change; Arabic, right-to-left layout and accessibility; and behaviour-focused browser tests with the existing tools. Use when changing or reviewing upload, review screens, decisions, navigation, export buttons, copy or workspace state. مسار المستخدم، الواجهة، الرفع، المراجعة، القرارات، التصدير، العربية واتجاه RTL، الوصول. Not for engine logic or visual artwork alone.
---

# Tarasuf product workflow

What the accountant sees must be what the engine decided from the source, and a decision must not survive the evidence it rested on.

## When to use

- Changes in `app/`, `components/`, `styles/` or `lib/i18n/` that affect upload, errors, review, decisions, navigation, saved work or export.
- A report that the screen, the session or Excel disagree, or that work was lost when switching type or file.

## When not to use

- Engine or reader logic: `tarasuf-engine-development` and `tarasuf-source-evidence`.
- Artwork, scene and motion only: the [visual implementation reference](../../../docs/reference/VISUAL-IMPLEMENTATION.ar.md) and its checks.

## Inputs

- `app/page.tsx`, `components/source-upload.tsx`, `components/workspace-chrome.tsx`, `components/reconciliation-navigation.tsx`, the domain `components/*-workspace.tsx`, `lib/i18n/`.
- [Design guide](../../../docs/reference/DESIGN.ar.md), [workspace identity](../../../docs/WORKSPACE-IDENTITY.ar.md), [workflow plan](../../../docs/roadmap/workflow.ar.md), [architecture integration rules](../../../docs/reference/ARCHITECTURE.ar.md#قواعد-التكامل).
- Browser checks: `scripts/browser-test.mjs`, `scripts/reconciliation-entry-browser.mjs`, `scripts/domain-navigation-browser.mjs`, `scripts/unified-workspace-browser.mjs`, `scripts/startup-readiness-browser.mjs`, and the domain browser scripts.

## Steps

1. Write the journey as user actions: choose the type, open files (by the native file input, drag and drop, and keyboard), see import errors, map, compare, review, decide, save, restore, export. Mark which steps the change touches.
2. For each touched step, state what the user should see in Arabic and English, including the needs-review state: what is undecided, why, and what evidence would decide it. A single "success" badge must not stand in for confirmed, suggestion and needs-review.
3. Check agreement: the figures, members and statuses on screen equal the engine result, and the source cells shown are the ones the engine used.
4. Check state: switching type, replacing a file, changing scope or cancelling must not apply an old result to new sources; decisions tied to changed evidence are invalidated and shown as such; work kept while hidden stays intact.
5. Check language and access: right-to-left layout, mixed Arabic and Latin text and numbers, keyboard order and visible focus, reduced motion, readable at a phone width, no text clipped.
6. Test behaviour, not markup: extend the domain browser script with the user steps and assert on what is visible and on the downloaded file, checked independently. Keep the native file input; do not replace it with a custom control.
7. Hand check selection and recording to `tarasuf-regression-release`.

## Outputs and evidence

- The journey with each touched step, what was checked, and the command and result, or "not run" with the reason.
- Screens or downloads used as evidence stay in `work/` and are not committed unless reviewed as public synthetic assets.

## Acceptance, failure and escalation

- Accept when the touched journey steps pass in a browser run, the downloads pass their independent check, and no decision outlives its evidence.
- Fail on a screen that disagrees with the engine, a lost or stale decision, an unclear needs-review state, or lost keyboard access. Escalate wording that would change an accounting meaning to `tarasuf-accounting-review`.

## Limits and related skills

- Browser checks run one engine version of Chromium; they do not prove every browser or assistive technology.
- `tarasuf-privacy-security` covers what downloads and storage contain; `tarasuf-source-evidence` covers provenance shown in review.

## Example

A change adds a "replace file" button to the bank workspace. Journey: open statement and cashbook, decide one match, replace the cashbook with a corrected copy. Expect the earlier decision to be marked invalid with the reason, the result recomputed, and Excel to contain only the new evidence. Extend the bank workspace browser script to do these steps with the keyboard and check the download.
