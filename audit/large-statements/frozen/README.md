# Frozen independent long-statement contracts

Seven synthetic native-PDF contracts, authored without reading the P4 changes.
Literal transaction records were written to the two oracle JSON files before
rendering the PDFs. Expected values, source row/page identities and required
positive pairs never come from PDF.js or engine output. The 70-page statement
has 2,240 movements; the 100-page statement has 2,800. Matching CSV ledger
exports are independent file representations of those authored records.

Repeated headers, explicit page totals and carried/closing balances remain
visible source rows with a required excluded disposition. The 100-page positive
also saves/restores a session and exports all original page/amount facts. This
uses explicit column mappings and boundaries, not an unaided-inference claim.

Negatives cover page 101, an empty page70, covered text on page70, final-page
column drift, and a malformed operator stream on page100. Late failure must not
return an accepted prefix. Read errors retain the late page; unresolved geometry
blocks automatic approval and preserves each affected monetary row as an error.
This is neither field validation nor a new bank principal/fee interpretation.

The existing 8 MiB, 20,000 extracted-row, 100,000 text-item and two-million-character
budgets remain the scope. More pages alone do not authorize larger content or
unbounded drawing work. These normal synthetic inputs are below those budgets.

```sh
node --experimental-strip-types audit/large-statements/frozen/run.mjs \
  --engine-root "$ENGINE_SNAPSHOT" --out /tmp/large-statements-new-result.json
```

Frozen hashes are checked before execution. The runner preserves all library
digests before/after. Use a new output path for every run and retain failures.
Timings separate read/compare/roundtrip/export work. Peak RSS is cumulative for
the process, not a per-case memory bound; no speed guarantee is inferred.
