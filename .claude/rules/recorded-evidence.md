---
paths:
  - "audit/**/frozen/**"
  - "audit/**/results/**"
  - "audit/**/oracle/**"
  - "scripts/lint-frozen-originals.json"
  - "public-safe-manifest.json"
---

# Recorded evidence

- Files under `frozen/` are sealed inputs and expectations. Do not change them; a new holdout or run gets new files.
- Files under `results/` record what happened, failures included. Add a new record; do not rewrite an old one to agree with today's code.
- An oracle change needs a documented reason and its own test of the oracle, never "the engine disagrees".
- `public-safe-manifest.json` entries are reviewed one by one for the files you changed or added ([delivery guide](../../docs/reference/DELIVERY.ar.md#النشر-العام)). Never regenerate it from the whole directory.
- A local hook asks or refuses before Claude Code edits existing files here with its edit tools. It does not see shell commands, so it is an early warning, not protection.
