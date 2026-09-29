# Frozen P2 second synthetic holdout

Eight literal CSV contracts require six automatic member sets across four
positive cases, one of which also forbids matches in a separate conflicting
component. Four other cases forbid every automatic relation. Expected rows,
identities, totals and dispositions are authored directly from literal fields.

This set was authored independently during candidate-2 implementation without
reading that implementation or new unit fixtures. It was frozen before any
execution, with individual details withheld until candidate freeze. It is
synthetic evidence using explicit mappings, not field validation or a measure
of unaided import, UI lifecycle or accounting completion.

The unchanged production-boundary runner verifies all frozen file hashes, invokes
read/prepare/normalize/compare, checks exact automatic member sets and source
preservation, and hashes every library file before and after execution.

```sh
node --experimental-strip-types audit/p2-group-resolution/holdout-v2/frozen/run.mjs \
  --engine-root "$ENGINE_SNAPSHOT" \
  --out /tmp/p2-holdout-v2-new-result.json
```

Preserve the first result and every failure outside frozen. After first execution
this set is consumed; future runs are regression evidence. Never adjust these
contracts to fit a candidate.
