---
paths:
  - "lib/reconciliation/**"
  - "tests/**"
---

# Engine and test code

- Before changing an engine, reader, session or export path, use the `tarasuf-engine-development` skill, and `tarasuf-accounting-review` for any decision about matches, groups, signs, periods or tolerances.
- Name the contract first: [accounting contract](../../docs/reference/ACCOUNTING-CONTRACT.ar.md), the [integration rules](../../docs/reference/ARCHITECTURE.ar.md#قواعد-التكامل) and the domain plan in [the roadmap](../../docs/roadmap/README.ar.md).
- Run the focused tests for the files you touched first; widen with `tarasuf-regression-release`. Do not run every gate after every edit.
