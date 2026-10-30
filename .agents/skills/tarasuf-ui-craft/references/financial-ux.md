# Financial UX: decisions, evidence and continuity

Read the current [accounting contract](../../../../docs/reference/ACCOUNTING-CONTRACT.ar.md), [workspace identity](../../../../docs/WORKSPACE-IDENTITY.ar.md) and affected row of [domains](domains.md). This reference governs presentation, not new matching policies or financial enums.

## Model the whole job

Sources → execute reconciliation → review results/exceptions → explain evidence when needed → export. Keep orientation, file roles and unfinished work across these stages. Explanation supports review; it must not obstruct ordinary reconciliation or imply an AI service is required. Preserve current local-first processing.

Keep five facts separate: source readability/completeness; meaning/scope eligibility; matching evidence; balance reconciliation; decision origin. Equal totals prove neither membership nor completeness. A single green badge must not collapse these facts.

## Sources and processing

- Label each upload by financial role before file name. Show supported format, current file, readable status and next required action. Preserve original UploadIllustration/native input and rejection behavior.
- Reveal additional sources progressively, but mark required roles explicitly. Collapsed does not mean optional. Essential identity, sign, currency and scope confirmations remain visible when relevant.
- Display file/read diagnostics with physical source coordinates and affected scope. Missing value is not zero. Partial isolated output may remain useful only where the existing domain contract permits isolation; unknown impact must not become a clean result.
- Separate loading tool readiness, reading, validating, reconciling, cancellation and failure. Use real phase/progress signals. Late worker responses cannot restore canceled or outdated results.
- Replacing a source or changing mapping/policy follows existing invalidation. Do not keep a visually approved result beside new source data. Do not reorder engine source arrays to match RTL or card order.

## Result and decision language

| Underlying meaning | Presentation requirement |
| --- | --- |
| Confirmed by existing deterministic contract | State what is established and its scope; expose evidence; do not imply all balances/reports are complete |
| Proposed/candidate | Explicit “اقتراح يحتاج مراجعة”; show reason, competing possibilities and needed action; no approved/complete success treatment |
| Pending/incomplete | Identify missing evidence, scope or processing step and affected output; no fabricated percentage of completion |
| Rejected/invalid | Preserve reason and origin; offer correction/replacement where allowed; do not hide it as an empty state |
| Human-reviewed decision | Distinguish reviewer decision from automatic evidence; preserve reason and actual undo/invalidation rules |
| Useful partial result | Name accepted and blocked scopes separately and retain material warnings in summary/detail/export |

Map these meanings to actual domain types/selectors. Do not invent a new “approved” status layer or let frontend state override gates. Approval is not available just because a review button is attractive. Bulk actions require clear scope and cannot bypass duplicate-use, currency, membership or evidence constraints.

## Amounts, differences and charts

Use the existing formatter and currency precision. Inspect [core money](../../../../lib/reconciliation/core.ts): its input is minor units. Changing precision from 3 to 2 can display `0.001` as `0.01`, changing value rather than just typography. Never round away a material difference; show exact values in operational views. Compact overview values need units, scale and accessible exact detail, and cannot hide warnings.

Keep document original amount, paid, remaining, allocated, movement and running balance distinct. Preserve negative sign, debit/credit meaning, zero versus missing, and textual references with leading zeros. Define difference direction explicitly, e.g. A−B according to the actual contract. Do not infer sign from whichever closes a gap. Do not aggregate currencies or sum both sides of a match as completed money.

Separate group count, source-row count, document count and amount. State metric scope and filter effect. Any chart needs a real data mapping, unit, scale, denominator and accessible table/summary. Choose time, category, bridge or distribution according to the question; do not impose a time axis or reuse decorative Bézier curves as financial data. No invented accuracy, saved time or confidence percentage.

## Evidence and comparison

Offer a path from summary → result/group → all members and competitors → original file/hash/sheet/physical row/cell or PDF page as available. Preserve raw evidence versus interpreted value, rule, sign, currency, period and limitations. A formatted row number is not necessarily the source's physical row.

For comparisons, label source roles and align comparable fields while preserving chronological/member order where meaningful. Show differences with text plus visual emphasis, not red/green alone. Do not truncate away identity collisions, negative signs, meaningful decimal places or source warnings. Allow copying exact references. Return from evidence to the same filter, selection, scroll position and focus.

For a multi-member match, show the complete member set and the reason the relation is supported. Do not suppress competing rows to manufacture uniqueness. A rejected row with related identity may affect membership even when its amount cannot be read.

## Save, restore, export and exceptional states

Retain work across language/type changes; one selector does not imply one domain's state can replace another. Current processing navigation locks and unload warnings must include inactive workspaces. Reuse established session validation/invalidation; opening a saved session does not certify it anew.

Use honest local-save language: files are processed on device; downloaded sessions/workbooks contain user data and are not encrypted by this app. Do not claim that no data is ever saved. Do not change session/protocol IDs or export schemas as visual cleanup.

Export respects the existing financial scope, warnings, decisions, member identity and exact values. If filtering affects export by current contract, make that scope explicit; otherwise filtering must not silently shrink output. Never export only mounted virtual rows. Saving XLSX successfully is not proof of its content: use independent export checks when the path changes.

Acceptance cases: initial empty; missing required source; no matches; no exceptions; empty filter; many columns/rows; multiple currencies; three-decimal difference; ambiguous group; invalid related row; partial isolated result; processing/cancel/late response; rejected restore; save→restore→review→export parity. Choose cases affected by the task; do not claim all ran when only inspecting markup.
