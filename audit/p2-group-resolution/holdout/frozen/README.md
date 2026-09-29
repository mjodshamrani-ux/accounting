# Frozen synthetic P2 holdout

Ten new literal CSV contracts require seven exact automatic member sets across
four positive cases. Six further cases forbid automatic relations. Every expected
source row, disposition and signed total is explicit. This is synthetic evidence
with supplied column mappings, not field validation or unaided UI completion.

The author did not inspect P2 candidate implementation or new unit fixtures.
Authoring occurred during implementation. Inputs, oracle and runner were frozen
before any execution of this corpus; individual case details were withheld from
the implementer until candidate freeze. Once evaluated, this set is consumed.

The runner uses the production read/prepare/normalize/compare boundary and exact
whole-group membership assertions. It reuses the development runner structure
with explicit normalized source facts so this different column layout is checked
without assuming the development CSV positions. No engine output supplies truth.

```sh
node --experimental-strip-types audit/p2-group-resolution/holdout/frozen/run.mjs \
  --engine-root "$ENGINE_SNAPSHOT" \
  --out /tmp/p2-holdout-new-result.json
```

Frozen hashes are verified before imports. All library files are hashed before
and after execution. Preserve the first result, including any failure, outside
this directory. Never revise these contracts to fit the result.
