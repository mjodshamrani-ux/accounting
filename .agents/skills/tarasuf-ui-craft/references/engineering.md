# Engineering, interaction and bilingual access

Start from [workspace chrome](../../../../components/workspace-chrome.tsx), [primitives](../../../../components/ui), [page](../../../../app/page.tsx), [globals](../../../../app/globals.css) and [architecture](../../../../docs/reference/ARCHITECTURE.ar.md). This is React/TypeScript/Vite; `app/` does not imply Next.js. Inspect consumers before changing shared primitives.

## Visual construction

- Inventory spacing, typography, width, radius, elevation and density at the affected component. Prefer existing tokens/utilities. Do not impose a new 4px scale or fixed control height without evidence.
- Group by task and evidence relationship. Establish page title, current decision, primary action and subordinate detail. Use whitespace/alignment before adding containers; containers should explain relationships.
- Align baselines, labels, values and adjacent controls. Choose density for the reading task; do not shrink fonts to fit more columns or fill wide screens with oversized cards.
- Preserve Thmanyah headings, readable body line height and Arabic diacritics. Do not apply Latin tracking or character-by-character animation to Arabic. Test long EN labels and Arabic wrapping.
- Use the existing icon family, stroke and optical sizing. Name icon-only controls; expose explanations on focus as well as hover. Hide decorative icons from assistive technology. Brand/scene geometry is not an ordinary UI icon.
- Use depth to explain overlap/elevation, not financial authority. Check text, focus and selected states against actual backgrounds.

## Component states

| Component/state | Implement and check |
| --- | --- |
| File input | Native input + label; click/keyboard/drop; accepted formats and financial role; existing SVG; rejection does not silently clear previous source |
| Field | Persistent label, hint, linked error; preserve entered value; focus actionable error after submission; explain disabled required fields |
| Button | Real button/link; visible focus/hover/pressed/busy/disabled; prevent duplicate execution; meaningful busy label |
| Processing | Announce phase; numeric progress only with valid denominator; indeterminate if unknown; usable cancellation; no adoption of late response |
| Dialog/detail | Accessible name, initial focus, safe keyboard dismissal, containment and return; opening evidence preserves review position |
| Error/notice | What happened, affected scope, next action; material warnings persist rather than disappearing in a toast |
| Empty/dense | Distinguish no files, no results, no exceptions, no filter matches; retain filters and clear action; dense data stays inspectable |

Do not implement search as a styled div. Avoid whole-row click traps with nested actions/text selection. Immediate feedback may acknowledge a click without claiming accounting completion. Use actual worker/state contracts, not timers or decorative progress.

## Tables and responsive layout

Use semantic tables, headers and scope for ordinary data. ARIA grids require a full keyboard model; do not add `role=grid` decoratively. Give the table a name/caption and sort state via `aria-sort`. Use stable selection IDs through sorting/filtering. Name row checkboxes and clarify whether select-all means visible, filtered or all records.

Keep units, signs, differences and headers legible. Sticky columns/headers cannot cover focus or evidence links. Contain essential two-dimensional table scrolling on small screens, with an indication. Do not allow page-wide overflow or remove necessary values. Row details may supplement the table without changing scope. Cards are suitable only when comparison/reference identity survive.

Virtualize/paginate after measurement with representative density. Preserve accessible navigation, totals, identity and review position. DOM rows are never the source for financial totals/export. Avoid expensive per-row animation, blur or observers.

## Arabic and English

Read [context](../../../../lib/i18n/context.tsx), [Arabic](../../../../lib/i18n/locales/ar.ts), [English](../../../../lib/i18n/locales/en.ts). Set direction deliberately; use logical spacing/alignment for reading-direction roles. RTL does not reverse source arrays, strings, signs or chronology.

Isolate mixed references, currency codes and filenames with `bdi` or an appropriate local direction. For `INV-00042/A` inside Arabic, preserve literal identity, leading zeros and copied text. Keep labels and values separate. Inspect negative signs, parentheses, decimal separators, percentages and currency placement in both languages. Align consistent numeric columns; do not blindly force every amount to a physical side.

Use tabular numerals when supported by the actual body font; do not replace headings to obtain them. Do not translate stored identities. Locale display and canonical values are separate contracts.

## Accessibility acceptance

Apply [WCAG 2.2](https://www.w3.org/TR/WCAG22/) AA to affected states: normal text 4.5:1, large text 3:1; necessary non-text controls/states 3:1 where applicable. Decorative hairlines do not all need 3:1. Keep focus visible and not entirely obscured by authored content. A blanket 1px focus border is not a guarantee.

Test keyboard-only upload, selection, sort, review, evidence, dialog return and export: logical order, no traps. Screen readers receive names, states, linked errors and meaningful progress without noisy repeated announcements. Preserve one visible h1 and one main landmark per active workspace; inspect heading order.

Check 200% text resize, narrow 320 CSS-pixel reflow and AR/EN at 1440/390/320. Essential data tables may need two-dimensional scrolling; contain it. AA target size is generally 24×24 CSS pixels or an applicable exception; 44×44 is a comfortable design target, not a universal AA rule. Support reduced motion and persistent pause where needed. Automated checks do not replace keyboard/screen-reader verification.

## Performance and privacy

Measure initial render, loaded interactions, scrolling, cancellation and memory on stated hardware/data. Compare baseline/candidate. Do not promise 60fps from screenshots. Reuse CSS/SVG and current libraries; justify dependencies by user need, runtime/bundle cost and fallback. Do not unmount inactive workspaces for speed: it can erase work. Preserve existing lifecycle/state ownership.

No external fonts, remote financial processing, telemetry, CDN illustrations or automatic model downloads for visual improvement. Inspect network requests when dependencies/assets change. Captures use synthetic fixtures; private financial evidence and local paths must not enter commits or public reports.
