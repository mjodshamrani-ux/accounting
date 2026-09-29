# Third independent P1 safety corpus

8 fresh literal CSV contracts: 3 positive cases require **8 exact pairs**; 5
negative cases require no automatic pairs. Authored and frozen before the next
candidate implementation or execution, without inspecting engine code. This is
synthetic engineering evidence, not field validation or general accuracy.

The declared V3 scope retains a conservative rule: missing or unsafe reference
evidence in a repeated-document component leaves that component unresolved.
Clean unrelated document components should still resolve. This new, explicit
scope does not change the frozen V2 oracle or erase its unmet positive contract.

The cases combine valid contextual identities with unsafe or missing siblings,
cross-document isolation, asymmetric evidence, expression prefixes, spreadsheet
error cells, and literal codes containing interior punctuation. Unsafe data must
remain visible and cannot become automatic relationship evidence. A visible,
explained row error is allowed where stated. Operation exceptions and dropped
source rows are not accepted.

The source-row pairs and cell facts are literal authored expectations; no engine
function calculates them. All imports have explicit mappings. This is not a test
of unaided mapping, AI, PDF, UI, save/restore, export or field accounting policy.
The runner is reused from the already-frozen V2 public-API harness; input facts,
contracts and interactions are newly authored. No automatic groups are required.

Run only after the parent declares a candidate freeze:

```sh
node --experimental-strip-types audit/p1-reference-resolution/independent-v3/frozen/run.mjs \
  --engine-root "$PWD" \
  --out /tmp/p1-independent-v3-result.json
```

Hashes are verified before import, and all `lib/` files are recorded before and
after execution. Save outputs outside `frozen/`. Preserve original failures and
never alter expected outcomes to fit them. Once exposed, this set is consumed;
subsequent executions are regressions.
