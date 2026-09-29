# Frozen independent P1 reference contracts

12 new literal CSV accounting cases: 7 cases require **15 exact positive pairs**;
5 cases forbid every automatic pair. This is independently authored synthetic
evidence, not field data or a general accuracy measurement. Expectations were
written before candidate execution without inspecting the upcoming P1 fix.
Public API shape was taken from the earlier frozen release-check harness only.

The set checks three-way reorderings inside a repeated document, three distinct
zero-padded numeric references, decoys on both sides, a unique pair beside true
duplicates, reference reuse across different documents, Arabic/English column
layouts, date-proximity decoys, local-voucher duplicate ambiguity, conflicting
references, differing documents, and a crossed document/reference collision.

Exact source-row pairs are stated in `contracts.json`. The facts and expectations
come from visible cells, not engine normalization or matching. Shared document
number plus amount is insufficient when chosen references disagree; shared
chosen reference is insufficient when explicit document numbers disagree.
Local voucher numbers are per-book labels and cannot arbitrarily resolve a true
duplicate. Every expected source row must remain accounted for. No automatic
group is requested in this narrow P1 set.

All imports use explicitly declared mappings. This evaluates reading and supplier
recompute behavior under that declared reading, not unaided mapping inference,
AI, PDF, UI, session or export completion. An all-review engine fails 7 cases.

Only run once the parent announces an engine freeze:

```sh
node --experimental-strip-types audit/p1-reference-resolution/independent/frozen/run.mjs \
  --engine-root "$PWD" \
  --out /tmp/p1-independent-reference-result.json
```

The runner verifies `SHA256SUMS`, records commit and all `lib/` hashes before and
after, and imports the production CSV reader and supplier recompute entry from
the supplied root. Store results outside `frozen/`. Candidate failure does not
authorize editing the oracle. Preserve failures; once opened, the corpus is
consumed and subsequent runs are regressions. No candidate or baseline execution
was used to author this set.
