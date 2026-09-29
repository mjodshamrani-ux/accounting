# Independent competing-reference check

18 fresh synthetic CSV cases with contracts written before candidate execution.
The author read public API shapes from commit `9fbe481`; the H03 fix implementation
and existing hard-case evaluator were not used to derive expectations.

Each CSV explicitly maps its `Reference` / `المرجع` column. Contracts use source-row
numbers and literal visible reference cells as the oracle. Equal amount, date,
description or `Document No` cannot erase a conflicting selected reference.
An unchanged true reference/document pair must still match despite different local
voucher numbers, column layouts or neutral descriptions.

The set contains 11 cases with 14 required positive automatic pairs and 7 cases
requiring no automatic pair. An engine that puts every row into review fails.
Cases include duplicate ambiguous identities, leading zeros, Arabic headings,
reordered columns, same amounts, neutral descriptions and a valid pair adjacent
to a contradiction. No expected result is calculated by the engine.

Run only after the parent confirms the candidate engine is frozen:

```sh
node --experimental-strip-types work/release-049/independent-reference-check/run.mjs \
  --engine-root /absolute/path/to/frozen/engine \
  --out /absolute/path/to/result.json
```

The harness verifies `SHA256SUMS` before importing the selected engine. It calls
the real CSV reader and supplier recompute entry, checks exact automatic pairs,
literal selected-reference retention, input amounts, absence of read errors,
and row coverage across cases. It records engine version, commit and tree status.

This is a narrow independent synthetic release check. It does not establish field
accuracy, validate other file formats, or prove UI/session/export lifecycle.
Do not revise these contracts in response to candidate failures. Record any
contract concern separately and preserve the original frozen input set.
