# Second frozen independent P1 corpus

12 newly constructed literal CSV contracts: 6 positive cases require **17 exact
source-row pairs**; 6 negative cases require no automatic pairs. Expectations
were authored before candidate-2 execution without inspecting its implementation.
This is narrow synthetic engineering evidence, not field validation or a general
accuracy estimate. The first independent corpus remains untouched.

The contracts exercise document-context identity, short and alphabetic reference
labels, Arabic and Arabic-Indic text, misleading alternatives, reference reuse,
missing/placeholder/unsafe reference values, true duplicates and literal identity
collisions. Positive cases require completion; an all-review engine fails.

The oracle consists of manually listed row pairs and literal source facts, never
engine-derived normalization or matching. The source cell for every selected
reference must survive. Usable references must also survive in the transaction's
chosen-reference field. Missing-value and unsafe tokens are retained as source
facts, never promoted into positive evidence. The unsafe-cell case explicitly
permits a visible, explained row-level error instead of a transaction; it permits
neither dropped rows nor an unexplained operation exception.

This set uses explicit mappings. It does not measure unaided mapping inference,
AI, PDF, UI assistance, session restoration or export completion. No automatic
group is requested. Each imported transaction must occur in exactly one case.

Run only after the parent announces the candidate freeze:

```sh
node --experimental-strip-types audit/p1-reference-resolution/independent-v2/frozen/run.mjs \
  --engine-root "$PWD" \
  --out /tmp/p1-independent-v2-result.json
```

The runner verifies `SHA256SUMS` and records all engine `lib/` hashes before and
after execution. Outputs belong outside `frozen/`. Any baseline uses a separately
verified immutable archive. Freeze precedes every engine execution of this set.
Do not change the contracts to fit a candidate result. Preserve all outcomes;
after its first candidate execution, the set is consumed and reruns are regression.
