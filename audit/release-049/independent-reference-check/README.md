# Independent reference check — release 0.4.9

The frozen check on commit `246324a8fe73c2a3602a68ee1087f29137f58adf`, engine
`0.3.17-experimental`, passed **15 of 18 cases**. It satisfied **9 of 14 required
positive pairs**, with **5 missed positive pairs**, **0 false-approved pairs**,
**0 unexpected automatic groups**, and **0 operation exceptions**.

The remaining capability gaps are preserved: IR03 and IR18 each miss two unique
selected-reference matches within a shared `Document No`; IR17 misses the exact
selected-reference counterpart beside a different-reference decoy. The engine
returns `AMBIGUOUS_CANDIDATE / Needs Review` for these three cases. All seven
negative cases passed. The contracts were not changed after seeing the results.

`frozen/` contains the original 36 synthetic CSV files, contracts, runner, README
and hash manifest, copied byte for byte from the pre-execution freeze. Its 11
positive cases require 14 automatic pairs, so putting every row into review does
not pass. The fixture author did not inspect the fix implementation.

The original outcome and provenance are preserved in `result-246324a.json`,
`summary-246324a.json`, and `engine-before.json`. Hashes of all 53 files under
`lib/` were unchanged before and after the recorded run. The original records
retain the local source paths present when that run occurred; the runner accepts
any engine directory through `--engine-root`.

From the repository root, using Node with TypeScript stripping support:

```sh
node --experimental-strip-types audit/release-049/independent-reference-check/frozen/run.mjs \
  --engine-root "$PWD" \
  --out /tmp/independent-reference-check-result.json
```

The runner verifies the frozen hashes before importing the engine, then calls
the production CSV reader and supplier recompute entry. Its exit status is **1**
when any contract fails; that is the recorded outcome for this release. Write
new runs to separate files and retain the original failure evidence.

Frozen manifest SHA-256:
`020373400ae35b07d2530aeaaac7d7435f8e838dd4f1325e6aa96175c778b1d7`.

This is a narrow synthetic capability check, not a field-accuracy measurement or
proof of UI, session, export, PDF, or other file-format behavior.
