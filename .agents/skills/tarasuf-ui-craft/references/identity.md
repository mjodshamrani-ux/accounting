# Identity and source authority

Read current [AGENTS](../../../../AGENTS.md) and [CLAUDE](../../../../CLAUDE.md), then task-relevant source. This map is grounded at `013b464f8152abe5f26082ccb4f82f3b630e6f57`; it is not permission to freeze future decisions.

| Question | Governing source |
| --- | --- |
| Product purpose and financial meaning | [Vision](../../../../docs/reference/VISION.ar.md), [accounting contract](../../../../docs/reference/ACCOUNTING-CONTRACT.ar.md) |
| Approved identity | [Design](../../../../docs/reference/DESIGN.ar.md) |
| Scene construction and timing | [Visual implementation](../../../../docs/reference/VISUAL-IMPLEMENTATION.ar.md) plus current components/CSS |
| Source roles and retained work | [Workspace identity](../../../../docs/WORKSPACE-IDENTITY.ar.md) |
| Implemented versus planned | [State](../../../../docs/reference/STATE.ar.md), [plan](../../../../docs/CURRENT-PLAN.ar.md) and relevant domain plan |
| Verification and delivery | [Quality](../../../../docs/reference/QUALITY.ar.md), [delivery](../../../../docs/reference/DELIVERY.ar.md) |

## Preserve the recognizable system

| Element | Actual identity and use |
| --- | --- |
| Surfaces/text | White `#FFFFFF`, navy `#0A1B2E`, pale surface `#F6F8FC` |
| Brand gradient | Blue `#2D8CFF` → purple `#7C3AED`; logo, native artwork and deliberate emphasis |
| Functional tokens | Existing `--primary: #6738D3`, secondary text `#64748B`, border `#E3E7EF`; inspect consumers before replacing shades |
| Supporting colors | Indigo `#6366F1`, gray `#94A3B8`; gray is not an automatic small-text color on white |
| Arabic display | Genuine local **Thmanyah Serif Display Bold 700**, live text; no synthesized weight, stretched letters or substitute font |
| Body/fields | Local Noto Sans Arabic; English display uses current Arial/Helvetica stack |
| Wordmark | Approved Arabic string in [brand.ts](../../../../lib/brand.ts) remains Arabic in EN; preserve diacritics and elongation characters |

These are observed values, not a new token file. Reuse semantic tokens and variants; justify additions by a missing role. Measure contrast in the actual state. Status colors need words/icons; a gradient never certifies financial success.

## Asset map

| Asset | Edit source and preservation check |
| --- | --- |
| Logo/headings | [brand.tsx](../../../../components/brand.tsx), [mark SVG](../../../../public/brand/tarasuf-mark.svg): original paths, aspect `82/116`, per-instance `useId`, no RTL mirroring |
| Font | [font](../../../../public/fonts/thmanyah-serif-display-bold.woff2), [license](../../../../public/fonts/Thmanyah-LICENSE.txt), [provenance](../../../../public/fonts/Thmanyah-PROVENANCE.txt): preserve bytes and verify actual rendered glyph font |
| Intro | [document-scene.tsx](../../../../components/document-scene.tsx), [scene CSS](../../../../app/document-scene.css): A4 ratio, clips, layer order, local IDs |
| Shared upload | [source-upload.tsx](../../../../components/source-upload.tsx), [workspace-chrome.tsx](../../../../components/workspace-chrome.tsx): UploadIllustration and genuine input |
| Features/privacy/process | [feature-art.tsx](../../../../components/feature-art.tsx), [landing.tsx](../../../../components/landing.tsx), [landing CSS](../../../../app/landing-details.css) |
| Typography/tokens | [globals.css](../../../../app/globals.css): inspect cascade, language rules and active overrides |

Keep operational surfaces quiet and introductions expressive. Do not turn all work into a white-card SaaS grid or strip depth as a shortcut to professionalism.

## Resolve disagreements explicitly

1. Cite the conflicting statement and active consumer. Separate historical snapshot, approved intent, current implementation and planned change.
2. Reproduce the consequence through computed styles/rendered states before calling it a defect. Preserve financial/accessibility constraints.
3. Propose a bounded resolution within identity. Escalate an unresolved brand/contract decision; do not repeatedly seek permission for authorized fixes.
4. Update the governing reference only with an intentional change and its evidence.

Inspection leads, **not newly reproduced defects**: old `.reveal-ready` wording versus `.tarasuf-reveal-pending`; early negative tracking overridden later; `TableHead` physical alignment; `Button` broad transitions; social assets using a different display stack from live headings. Do not silently repair them in a skill task. Current font SHA-256: `d36da84ee5423145415425bdd9c10dc27f57a66afec031bd7b78e662572846ce`. The project's stated hosting permission does not grant general redistribution rights.
