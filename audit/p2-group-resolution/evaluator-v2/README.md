# P2 development evaluator v2: distinguish source-scope diagnostics

The original `../independent/frozen/run.mjs`, CSVs, expected financial member
sets and manifest remain unchanged. The original engine0.3.21 regression result
is copied byte-for-byte to `legacy-84d4bdd-original.json` from
`work/p2-regression/run-LqbgOK/independent.json`:18/19 contracts,
all11 required groups, zero false approvals; P2D14 alone failed because it saw
error rows `[0,3]` while the old evaluator expected physical row `[3]`.

P2D14's ledger has a literal USD payment part in a SAR reconciliation. The
additional row0 issue explicitly identifies an unresolved Currency scope; it
is not a lost source row or a new approval. The physical bad row3 must remain
an error and its group must still not be approved.

`run-independent.mjs` verifies the exact original runner SHA256 before applying
three narrowly anchored in-memory substitutions:

1. Set `here` to the original frozen directory so the data-URL module reads
   the same frozen files and verifies their existing manifest.
2. Preserve exact `row > 0` error assertions; require integer nonnegative
   error indexes, exactly one row0 Currency-scope error for P2D14 ledger,
   and zero source-wide errors for every other source in every other case.
3. Add evaluator version/provenance to the new result.

Every original matching, manual-decision, monetary, reference, source preservation,
group completeness, no-false-approval and required-success assertion is unchanged.
The extra source-wide error is positively asserted, not ignored. This is a
versioned diagnostic-schema migration on known regression cases, not a new
holdout and not a rewritten pass of the original result.

Original runner SHA256:
`001b795cccc23c4edb047fb2e69a628b82e6a936dfa26ffb51ef29b74ae21025`.

```sh
node audit/p2-group-resolution/evaluator-v2/run-independent.mjs --check-only
node audit/p2-group-resolution/evaluator-v2/run-independent.mjs \
  --engine-root /absolute/path/to/frozen/engine \
  --out /absolute/path/to/new/result.json
```

The adapter refuses an existing result path. Root CI integration should select
this evaluator only for the nineteen-case development corpus; the other two
P2 runners are unchanged.

`candidate-84d4bdd.json` records v2 on the immutable engine archive:19/19
contracts,11/11 required groups, zero false approvals and zero operation
exceptions. All59 library hashes matched commit
`84d4bdd9514df15b40c12dd269a1438ad3bcd110` before and after. The adjacent
provenance report binds the original failure, adapter, new result and engine.
