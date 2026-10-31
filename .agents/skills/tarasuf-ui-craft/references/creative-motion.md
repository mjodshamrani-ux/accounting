# Purposeful invention and motion

Use [identity](identity.md) and the current [scene construction reference](../../../../docs/reference/VISUAL-IMPLEMENTATION.ar.md). Source artwork lives in React/CSS/SVG; descriptions of depth do not authorize WebGL or a new visual identity.

## Build a direction from the accountant's task

1. Name the decision: identify a discrepancy, follow a source, compare members, review an exception, resume work. Name the audience and operational/explanatory context.
2. State a precise character: technically exact, calm under density, transparent about uncertainty. Avoid an adjective pile without a visual consequence.
3. Choose a product-world motif: aligned records, two comparable ledgers, a row connected to evidence, a visible unresolved gap. Explain what it teaches and what it must not imply.
4. Choose one distinctive detail tied to that task, then build hierarchy and rhythm around it. Examples: a source-row focus that carries into evidence detail; a difference marker connecting aligned values. Keep meanings available without animation/color.
5. For substantial work, compare two compositions against comprehension, identity, accessibility, financial risk and cost. Choose one; do not default to bento, oversized hero type or generic dashboard cards.
6. Prototype using native assets and synthetic content. Inspect actual geometry, text, states and interaction. Preserve successful features while refining the weak part.

## Example brief, not a component to copy

Goal: explain how a reviewed row links to its source. Direction A extends the existing paired A4 scene with a quiet row outline and evidence callout. Direction B expands papers into a larger review spread. Prefer A if it explains the link with less space/motion and preserves the existing portal; choose B only when the additional content earns its cost. This is a proposal, not a verified usability improvement.

In an introduction, label synthetic records as illustration and do not animate a green seal or invented confidence. In operational UI, the same metaphor can only use real existing evidence navigation and state. A proposed connection must remain visibly proposed. No graphic can certify balances, authorship or completeness beyond the contract.

## Construct with existing geometry

- Retain A4 proportions, original paths, clipping and layer order. Inspect `DocumentScene`/`StatementSheet`, UploadIllustration, FeatureArt and PrivacyBoundary before inventing a replacement.
- Separate positioning/rotation from animated transforms so animation does not override layout. Keep scan/content inside each paper's local clip. Use independent IDs for gradients/filters/clips when inactive workspaces remain mounted.
- Scale the whole composition proportionally; test diacritics and long EN text at 320/390/1440. Do not widen or distort papers to fix a text overflow.
- Evaluate depth by legibility and relationship, not number of shadows. Do not remove the blue–purple gradient because an external checklist calls it generic. Avoid adding unrelated orbs/mesh/stock photography.
- References may inspire composition; do not copy websites' assets, text, screenshots or trade dress. No hero image is mandatory when the native scene already serves the product.

## Motion with an accountable purpose

Choose duration/easing by purpose. A control's response and a leisurely scene do not share a universal 150ms rule. Current scene float/scan cycles are about 9s/8.5s; inspect current CSS before changing them. These cycles are decorative, not processing progress.

Keep reduced-motion static alternatives, pause controls where required, offscreen/document-hidden suspension and content visible if observers/scripts fail. Keyboard focus and hash navigation must reveal content. Clean up timers, animation frames, observers and event listeners. Do not split Arabic glyphs into independently animated inline blocks.

Prefer transform/opacity where suitable, but profile painting/compositing instead of declaring all animation free. Avoid large backdrop blur, repeated SVG filters and per-row motion on dense tables. Do not add a rendering library without measured need and a safe fallback.

## Acceptance

Compare a static state, a full motion cycle, hover, keyboard focus, drag, busy/disabled and reduced-motion state. Check clipping, seams, overlapping layers, hit targets and native input activation. Sampled geometry tests supplement actual motion inspection; they do not prove every phase combination.

The result should have a clear focal point, distinctive purposeful detail, intact brand and readable accounting information. Ask what the user understands or can do better. If the only answer is “it looks less AI-generated,” the direction lacks a product reason.
