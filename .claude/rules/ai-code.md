---
paths:
  - "lib/reconciliation/local-ai.ts"
  - "lib/reconciliation/local-import-ai.ts"
  - "lib/reconciliation/import-proposals.ts"
  - "lib/reconciliation/visual-*.ts"
  - "audit/local-provider/**"
---

# AI and visual-reading code

- Use the `tarasuf-ai-integration` skill. AI proposes; the deterministic engine decides ([AI boundaries](../../docs/reference/AI-AND-OCR.ar.md)).
- AI-1 to AI-3 and OCR-1 are planned. Do not add a model, provider, download, network call or dependency unless the user authorizes that change.
