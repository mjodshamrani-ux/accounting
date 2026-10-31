---
paths:
  - "components/**"
  - "app/**"
  - "styles/**"
  - "lib/i18n/**"
---

# Interface code

- Use the `tarasuf-product-workflow` skill for changes to upload, review, decisions, export, navigation or copy.
- Use the `tarasuf-ui-craft` skill to audit, refine, design or review the interface: layout, tables, upload surfaces, scenes, motion and accessibility. Its canonical rules live in `.agents/skills/tarasuf-ui-craft/`; with both skills, this one owns visual craft and `tarasuf-product-workflow` the journey and state.
- Read the [design guide](../../docs/reference/DESIGN.ar.md), the [visual implementation reference](../../docs/reference/VISUAL-IMPLEMENTATION.ar.md) and [workspace identity](../../docs/WORKSPACE-IDENTITY.ar.md) before visual changes.
- Keep the native file input, keyboard access, reduced motion and right-to-left layout. Decorative motion is not engine progress.
